// pantry/design.test.ts — the Design surface over a small sample design/ folder: the model, the
// cross-references each view promises, every alignment rule (clean, then broken one at a time on a
// copy), the doctor rows, and the routes the pages are served on.
import { test, expect, describe, beforeEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, cp, utimes, writeFile, readFile, rm } from "node:fs/promises";
import {
  loadDesign, checkAlignment, schemaHash, refIndex, resolves, refHref, plansForTable, flowsForTable, crossesRegion, tableFor, buildDesignPayload,
} from "./design.ts";
import { annotateDesign, annotatePlanPage, wireframeRaw, WIREFRAME_SHIM } from "./design-page.ts";
import { createPantryHandler } from "./app.ts";
import { runDoctor } from "./doctor.ts";
import type { ResolvedPantryConfig } from "./config.ts";
import type { DesignChecks } from "./design.ts";
import { DEFAULT_HYGIENE } from "./hygiene.ts";
import { DEFAULT_CONTEXT_BUDGET } from "./context.ts";

const FIXTURE = join(import.meta.dir, "tools", "fixtures", "design-host");

// A fresh copy per test, with the ERD dated after the schemas, because a checkout sets mtimes in
// whatever order git writes files and the freshness rule must not depend on that.
async function host(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pantry-design-"));
  await cp(FIXTURE, dir, { recursive: true });
  const past = new Date("2026-01-01T00:00:00Z"), later = new Date("2026-02-01T00:00:00Z");
  await utimes(join(dir, "supabase", "schemas", "shares.sql"), past, past);
  await utimes(join(dir, "design", "erd.yaml"), later, later);
  return dir;
}
const rules = async (dir: string, checks: DesignChecks = {}) => Object.fromEntries((await checkAlignment(dir, await loadDesign(dir), checks)).map((r) => [r.id, r]));
const edit = async (file: string, from: string, to: string) => {
  const s = await readFile(file, "utf8");
  if (!s.includes(from)) throw new Error(`fixture edit: "${from}" not in ${file}`);
  await writeFile(file, s.replace(from, to));
};

describe("the design model", () => {
  test("reads every artifact in the contract's layout", async () => {
    const m = await loadDesign(await host());
    expect(m.available).toBe(true);
    expect(m.errors).toEqual([]);
    expect(m.erd!.entities.map((e) => e.id)).toEqual(["documents", "shares", "auth.users"]);
    expect(m.erd!.relations.find((r) => r.id === "shares.document_id")).toMatchObject({ from: "shares", to: "documents", cardinality: "many-to-one", onDelete: "cascade" });
    expect(m.erd!.skipped).toEqual(["create extension pgcrypto"]);
    expect(m.dictionary!.find((t) => t.id === "shares")!.columns.token).toBe("The secret in the link.");
    expect(m.dfd!.nodes.find((n) => n.id === "open-share")!.boundary).toBe("eu-app");
    expect(m.flows.map((f) => f.id)).toEqual(["share-link"]);
    expect(m.wireframes).toEqual(["share-expired", "share-open"]);
    expect(m.decisions.map((d) => [d.file, d.status])).toEqual([["001-share-tokens", "accepted"], ["002-signed-urls", "superseded"]]);
    expect(m.plans.find((p) => p.id === "share-links")!.design).toContain("erd#shares");
    expect(m.tests["supabase/tests/shares.test.sql::expired share opens nothing"]).toBe("pass");
  });

  test("a missing design/ folder is unavailable with a reason, never a throw", async () => {
    const m = await loadDesign(await mkdtemp(join(tmpdir(), "pantry-nodesign-")));
    expect(m.available).toBe(false);
    expect(m.reason).toContain("No design/ folder");
  });

  test("a file that will not parse is reported and its view stays empty", async () => {
    const dir = await host();
    await writeFile(join(dir, "design", "dfd.yaml"), "flows: [unclosed");
    const m = await loadDesign(dir);
    expect(m.dfd).toBeNull();
    expect(m.errors[0]!.file).toBe("dfd.yaml");
  });

  test("test states: pass from results, unrun without one, missing when the file is absent", async () => {
    const dir = await host();
    await rm(join(dir, "design", "test-results.json"));
    await edit(join(dir, "design", "requirements.yaml"), "tests: []", `tests: ["supabase/tests/nope.sql::x"]`);
    const m = await loadDesign(dir);
    expect(m.resultsAvailable).toBe(false);
    expect(m.tests["supabase/tests/shares.test.sql::expired share opens nothing"]).toBe("unrun");
    expect(m.tests["supabase/tests/nope.sql::x"]).toBe("missing");
  });
});

describe("cross-references", () => {
  test("refs resolve to ids in their file, including dotted erd ids", async () => {
    const idx = refIndex(await loadDesign(await host()));
    for (const ok of ["erd#shares", "erd#auth.users", "erd#memberships.client_id".replace("memberships.client_id", "shares.document_id"), "dictionary#shares-expired", "dfd#flow-share-open", "flows/share-link#open", "wireframes/share-open", "decisions/001-share-tokens", "requirements#R1", "erd"])
      expect(resolves(idx, ok)).toBe(true);
    for (const bad of ["erd#nope", "flows/missing", "decisions/009-x", "dfd#flow-nope"]) expect(resolves(idx, bad)).toBe(false);
  });

  test("an erd or dictionary id opens its table", async () => {
    const m = await loadDesign(await host());
    expect(tableFor(m, "shares.document_id")).toBe("shares");
    expect(tableFor(m, "shares-expired")).toBe("shares");
    expect(tableFor(m, "auth.users")).toBe("auth.users");
    expect(refHref("erd#auth.users")).toBe("/design/erd/auth.users");
    expect(refHref("flows/share-link#open")).toBe("/design/flows/share-link#step-open");
  });

  test("a table knows the plans that cite it and the flows that carry it", async () => {
    const m = await loadDesign(await host());
    expect(plansForTable(m, "shares").map((p) => p.id)).toEqual(["share-links"]);
    expect(flowsForTable(m, "shares").map((f) => f.id)).toEqual(["flow-share-read", "flow-share-analytics"]);
  });

  test("a flow between regions is flagged, one inside a region is not", async () => {
    const m = await loadDesign(await host());
    const f = (id: string) => m.dfd!.flows.find((x) => x.id === id)!;
    expect(crossesRegion(m, f("flow-share-analytics"))).toBe(true);   // eu-app → us
    expect(crossesRegion(m, f("flow-share-read"))).toBe(false);       // eu → eu
  });
});

describe("the alignment rules", () => {
  let dir: string;
  beforeEach(async () => { dir = await host(); });

  test("the sample folder is aligned", async () => {
    const r = await rules(dir);
    expect(Object.keys(r).sort()).toEqual(["design-done-tests", "design-erd-fresh", "design-refs", "design-schema-plans", "design-screens", "design-superseded"]);
    for (const x of Object.values(r)) expect([x.id, x.ok, x.detail]).toEqual([x.id, true, x.detail]);
  });

  test("erd-fresh fails when a schema is newer than erd.yaml", async () => {
    const now = new Date("2026-03-01T00:00:00Z");
    await utimes(join(dir, "supabase", "schemas", "shares.sql"), now, now);
    expect((await rules(dir))["design-erd-fresh"]).toMatchObject({ ok: false });
  });

  test("erd-fresh judges content, not file times, once erd.yaml records a schema hash", async () => {
    const erd = join(dir, "design", "erd.yaml");
    await writeFile(erd, `schemas_sha256: ${await schemaHash(join(dir, "supabase", "schemas"))}\n` + (await readFile(erd, "utf8")));
    const now = new Date("2026-03-01T00:00:00Z");
    await utimes(join(dir, "supabase", "schemas", "shares.sql"), now, now);
    expect((await rules(dir))["design-erd-fresh"]).toMatchObject({ ok: true });
  });

  test("erd-fresh fails when a schema's content changes after the recorded hash", async () => {
    const erd = join(dir, "design", "erd.yaml");
    await writeFile(erd, `schemas_sha256: ${await schemaHash(join(dir, "supabase", "schemas"))}\n` + (await readFile(erd, "utf8")));
    const sql = join(dir, "supabase", "schemas", "shares.sql");
    await writeFile(sql, (await readFile(sql, "utf8")) + "\n-- changed\n");
    expect((await rules(dir))["design-erd-fresh"]!.detail).toContain("changed since design/erd.yaml was generated");
  });

  test("schema-plans fails when a plan touches the schemas without an erd or dictionary ref", async () => {
    await edit(join(dir, "plans", "share-links.md"), "design: [erd#shares, dictionary#shares-expired, ", "design: [");
    expect((await rules(dir))["design-schema-plans"]!.detail).toContain("share-links touches supabase/schemas");
  });

  test("refs fails on a reference to an id that does not exist", async () => {
    await edit(join(dir, "design", "dfd.yaml"), "data: [erd#shares]", "data: [erd#nope]");
    expect((await rules(dir))["design-refs"]!.detail).toContain("dfd#flow-share-analytics → erd#nope");
  });

  test("refs also catches a plan ref and a flow step's missing screen", async () => {
    await edit(join(dir, "plans", "analytics.md"), "dfd#flow-share-analytics", "dfd#flow-gone");
    await edit(join(dir, "design", "flows", "share-link.yaml"), "screen: share-expired", "screen: share-gone");
    const d = (await rules(dir))["design-refs"]!;
    expect(d.ok).toBe(false);
    expect(d.problems.join("\n")).toContain("plan analytics → dfd#flow-gone");
    expect(d.problems.join("\n")).toContain("wireframes/share-gone");
  });

  test("done-tests fails for a done plan with an untested requirement", async () => {
    await edit(join(dir, "plans", "analytics.md"), "status: todo", "status: done");
    expect((await rules(dir))["design-done-tests"]!.detail).toContain("analytics is done but requirement R3 has no test");
  });

  test("done-tests fails for a failing test when results exist, and does not judge without them", async () => {
    await writeFile(join(dir, "design", "test-results.json"), JSON.stringify({ "supabase/tests/shares.test.sql::expired share opens nothing": "fail", "supabase/tests/shares.test.sql::owner reads own documents": "pass" }));
    expect((await rules(dir))["design-done-tests"]!.detail).toContain("is fail");
    await rm(join(dir, "design", "test-results.json"));
    expect((await rules(dir))["design-done-tests"]!.ok).toBe(true);
  });

  test("superseded fails when a plan cites a superseded decision", async () => {
    await edit(join(dir, "plans", "share-links.md"), "decisions/001-share-tokens", "decisions/002-signed-urls");
    expect((await rules(dir))["design-superseded"]!.detail).toContain("superseded by 001-share-tokens");
  });

  test("pantry doctor carries each rule as a tier 1 row, and fails on one", async () => {
    await edit(join(dir, "design", "dfd.yaml"), "data: [erd#shares]", "data: [erd#nope]");
    const report = await runDoctor({ cwd: dir, runDrift: false, runDeps: false, runSkills: false, runSymbols: false, runContext: false, home: dir, registryFile: join(dir, "none.json") });
    const row = report.checks.find((c) => c.id === "design-refs")!;
    expect(row).toMatchObject({ ok: false, severity: "error", tier: 1 });
    expect(report.checks.filter((c) => c.id.startsWith("design-")).length).toBe(6);
    expect(report.ok).toBe(false);
  });
});

describe("the screen rules", () => {
  let dir: string;
  beforeEach(async () => { dir = await host(); });
  const uiPlan = (touches: string, design: string) =>
    writeFile(join(dir, "plans", "portal.md"), `---\nstatus: todo\nowner: ai\ntouches: [${touches}]\ndesign: [${design}]\n---\n# Portal\n`);

  test("ui-plans is skipped until the project names its UI paths", async () => {
    await uiPlan("src/portal/", "erd#shares");
    expect((await rules(dir))["design-ui-plans"]).toBeUndefined();
  });

  test("ui-plans flags a plan touching a UI path with no wireframe or flow", async () => {
    await uiPlan("src/portal/desk.tsx", "erd#shares");
    const r = (await rules(dir, { uiPaths: ["src/portal/"] }))["design-ui-plans"]!;
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("portal touches src/portal/desk.tsx");
  });

  test("ui-plans counts a broader touch as covering the UI path, and passes on a wireframe or flow ref", async () => {
    await uiPlan("src/", "erd#shares");
    expect((await rules(dir, { uiPaths: ["./src/portal"] }))["design-ui-plans"]!.ok).toBe(false);
    await uiPlan("src/", "wireframes/share-open");
    expect((await rules(dir, { uiPaths: ["src/portal/"] }))["design-ui-plans"]!.ok).toBe(true);
    await uiPlan("src/", "flows/share-link#open");
    expect((await rules(dir, { uiPaths: ["src/portal/"] }))["design-ui-plans"]!.ok).toBe(true);
    await uiPlan("src/site/", "erd#shares");
    expect((await rules(dir, { uiPaths: ["src/portal/"] }))["design-ui-plans"]!.ok).toBe(true);
  });

  test("screens flags a wireframe no flow step reaches", async () => {
    await writeFile(join(dir, "design", "wireframes", "orphan.html"), "<p>orphan</p>");
    const r = (await rules(dir))["design-screens"]!;
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("wireframes/orphan.html is not the screen of any flow step");
  });

  test("screens flags a flow step whose screen has no wireframe", async () => {
    await edit(join(dir, "design", "flows", "share-link.yaml"), "screen: share-expired", "screen: share-gone");
    const r = (await rules(dir))["design-screens"]!;
    expect(r.problems).toContain("flows/share-link#expired names screen share-gone, which has no wireframe");
    expect(r.problems).toContain("wireframes/share-expired.html is not the screen of any flow step");
  });

  test("mockups flags a mockup changed after its ADR, and passes once the ADR catches up", async () => {
    const mock = join(dir, "mockups", "desk.html");
    await mkdir(join(dir, "mockups"));
    await writeFile(mock, "<p>desk</p>");
    const adr = join(dir, "design", "decisions", "001-share-tokens.md");
    const early = new Date("2026-03-01T00:00:00Z"), late = new Date("2026-04-01T00:00:00Z");
    const checks = { mockups: [{ file: "mockups/desk.html", decision: "001-share-tokens" }] };
    await utimes(adr, early, early); await utimes(mock, late, late);
    const r = (await rules(dir, checks))["design-mockups"]!;
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("mockups/desk.html changed after decisions/001-share-tokens.md");
    await utimes(adr, late, late); await utimes(mock, early, early);
    expect((await rules(dir, checks))["design-mockups"]!.ok).toBe(true);
  });

  test("mockups flags a missing mockup or an unknown decision", async () => {
    const r = (await rules(dir, { mockups: [{ file: "nope.html", decision: "001-share-tokens" }, { file: "plans/analytics.md", decision: "decisions/999-gone.md" }] }))["design-mockups"]!;
    expect(r.problems).toEqual(["nope.html does not exist", "plans/analytics.md names decision decisions/999-gone.md, which does not exist"]);
  });
});

describe("the views", () => {
  const configFor = (dir: string): ResolvedPantryConfig => ({
    cwd: dir, projectName: "design-host", plansDir: join(dir, "plans"), docsDirs: [], graphPath: null, graphDir: join(dir, "graphify-out"),
    decisionsDir: join(dir, "plans", "decisions"), answersLog: join(dir, "plans", "decisions", "answers.jsonl"),
    sessionsLog: "/tmp/pantry-test-sessions.jsonl", artifactsDir: join(dir, "artifacts"), runsDir: join(dir, "artifacts", "runs"),
    previewTarget: null, previewCommand: null, previewCommandCwd: dir, toursDir: null, hygiene: DEFAULT_HYGIENE, contextBudgetChars: DEFAULT_CONTEXT_BUDGET,
    surfaces: { plans: true, docs: false, reference: false, catalog: false, standards: false, decisions: true, artifacts: true, timeline: true, runs: true, brief: false, control: false },
  });
  const serve = async () => { const dir = await host(); const h = createPantryHandler({ plansDir: join(dir, "plans"), config: configFor(dir) }); return (p: string) => h(new Request(`http://localhost${p}`)); };

  test("overview shows counts and the alignment rows", async () => {
    const html = await (await (await serve())("/design")).text();
    expect(html).toContain("Alignment");
    expect(html).toContain("design: references resolve");
    expect(html).toContain(`href="/design/erd"`);
  });

  test("ERD: a table shows columns, meanings, RLS with test state, plans and flows", async () => {
    const html = await (await (await serve())("/design/erd/shares")).text();
    expect(html).toContain(`data-table="shares"`);
    expect(html).toContain("The secret in the link.");
    expect(html).toContain("An expired share opens nothing.");
    expect(html).toContain(`data-test="pass"`);
    expect(html).toContain(`href="/plans/plan/share-links"`);
    expect(html).toContain(`href="/design/dfd/flow-share-analytics"`);
    expect(html).toContain("create extension pgcrypto");                   // skipped statements are shown
  });

  test("ERD: a foreign key id opens its owning table", async () => {
    expect(await (await (await serve())("/design/erd/shares.document_id")).text()).toContain(`data-table="shares"`);
  });

  test("DFD: a flow shows data, region, retention and purpose, and a crossing is highlighted", async () => {
    const html = await (await (await serve())("/design/dfd/flow-share-analytics")).text();
    expect(html).toContain(`data-flow="flow-share-analytics"`);
    expect(html).toContain("30 days");
    expect(html).toContain("Usage counts");
    expect(html).toContain("crosses a region boundary");
    expect(html).toContain(`href="/design/erd/shares"`);
  });

  test("user flow: a step opens its wireframe and shows its test", async () => {
    const html = await (await (await serve())("/design/flows/share-link")).text();
    expect(html).toContain(`href="/design/wireframes/share-open"`);
    expect(html).toContain(`id="step-open"`);
    expect(html).toContain(`data-test="pass"`);
  });

  test("wireframe: a sandboxed iframe, and the raw screen carries the data-screen shim under a CSP sandbox", async () => {
    const get = await serve();
    const page = await (await get("/design/wireframes/share-open")).text();
    expect(page).toContain(`sandbox="allow-scripts"`);
    expect(page).toContain(`src="/design/wireframe-raw/share-open"`);
    const raw = await get("/design/wireframe-raw/share-open");
    expect(raw.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
    expect(await raw.text()).toContain(`data-screen="share-expired"`);
    expect(wireframeRaw("<body></body>")).toBe(`<body>${WIREFRAME_SHIM}</body>`);
    expect((await get("/design/wireframe-raw/nope")).status).toBe(404);
  });

  test("decisions list each status, and traceability marks gaps with a link to the plan", async () => {
    const get = await serve();
    const dec = await (await get("/design/decisions")).text();
    expect(dec).toContain(`id="adr-002-signed-urls" data-status="superseded"`);
    const req = await (await get("/design/requirements")).text();
    expect(req).toContain(`id="req-R3" data-gap`);
    expect(req).toContain(`href="/plans/plan/analytics">no test`);
    expect(req).toContain(`data-test="pass"`);
  });

  test("plan cards and the plan page show the artifacts their design field names", async () => {
    const get = await serve();
    const board = await (await get("/plans")).text();
    expect(board).toContain(`data-design-ref="erd#shares"`);
    const plan = await (await get("/plans/plan/share-links")).text();
    expect(plan).toContain(`<dt>Design</dt>`);
    expect(plan).toContain(`href="/design/erd/shares"`);
    const m = await loadDesign(await host());
    expect(annotatePlanPage("<p>no facts</p>", m, "share-links")).toBe("<p>no facts</p>");
    expect(annotateDesign("", m)).toBe("");
  });

  test("/design.json is the machine twin, and a host without design/ degrades to guidance", async () => {
    const get = await serve();
    const json = await (await get("/design.json")).json() as Awaited<ReturnType<typeof buildDesignPayload>>;
    expect(json.available).toBe(true);
    expect(json.alignment.every((r) => r.ok)).toBe(true);
    const empty = await mkdtemp(join(tmpdir(), "pantry-nodesign-"));
    const h = createPantryHandler({ plansDir: join(empty, "plans"), config: configFor(empty) });
    const res = await h(new Request("http://localhost/design"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("No design folder");
  });

  test("an unknown design view is a 404", async () => {
    expect((await (await serve())("/design/nope")).status).toBe(404);
  });
});
