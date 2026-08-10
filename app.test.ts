// pantry/app.test.ts — the cockpit's surfaces render (the composition holds). We drive the handler
// directly (no socket) and assert the EFFECT — a 200 with real content, not just that a route
// exists — per CONVENTIONS §6. Surface toggles gate their routes; an off surface is a 404.
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir } from "node:fs/promises";
import { createPantryHandler, homeBody } from "./app.ts";
import type { ResolvedPantryConfig } from "./config.ts";
import type { DoctorReport } from "./doctor.ts";

const EXAMPLE = join(import.meta.dir, "..", "proof", "example");

const configWith = (surfaces: Partial<ResolvedPantryConfig["surfaces"]> = {}): ResolvedPantryConfig => ({
  cwd: EXAMPLE,
  projectName: "test-project",
  plansDir: EXAMPLE,
  docsDirs: [],
  graphPath: null,
  graphDir: join(EXAMPLE, "graphify-out"),
  decisionsDir: join(EXAMPLE, "decisions"), answersLog: join(EXAMPLE, "decisions", "answers.jsonl"),
  artifactsDir: join(EXAMPLE, "artifacts"),
  runsDir: join(EXAMPLE, "artifacts", "runs"),
  previewTarget: null,
  previewCommand: null,
  previewCommandCwd: EXAMPLE,
  toursDir: null,
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true, decisions: true, artifacts: true, timeline: true, runs: true, ...surfaces },
});

const get = async (handler: (r: Request) => Promise<Response>, path: string) =>
  handler(new Request(`http://localhost${path}`));

describe("pantry cockpit surfaces", () => {
  const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith() });

  test("home is the project's own front door (reshape): names the project, board-forward, not the stack pitch", async () => {
    const res = await get(handler, "/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("test-project");        // the project, not the stack, is the headline
    expect(html).toContain("PANTRY");               // the app brand stays (nav + lede)
    expect(html).toContain(`href="/plans"`);        // the board is the home's primary call
    expect(html).not.toContain("The BREAD stack, in one place."); // the pitch moved to /about
  });

  test("the stack showcase + member cards live at /about (reshape)", async () => {
    const res = await get(handler, "/about");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("The BREAD stack, in one place.");
    expect(html).toContain("BATCH");
    expect(html).toContain("PROOF");
  });

  test("docs/reference/catalog are DEMOTED from the front nav but still mounted + reachable", async () => {
    const home = await (await get(handler, "/")).text();
    // the front nav (its own <nav class="pantry-nav">…</nav> block) no longer carries the demoted surfaces
    const frontNav = home.slice(home.indexOf(`<nav class="pantry-nav">`), home.indexOf("</nav>"));
    for (const s of ["/docs", "/reference", "/catalog"]) expect(frontNav).not.toContain(s);
    expect(frontNav).toContain("/plans");
    expect(frontNav).toContain("/about");
    // …yet the home body still links them (the "Reference surfaces" row) and they're still served — never cut
    expect(home).toContain(`href="/docs"`);
    expect((await get(handler, "/docs")).status).toBe(200);
    expect((await get(handler, "/reference")).status).toBe(200);
    expect((await get(handler, "/catalog")).status).toBe(200);
  });

  test("framework docs render through MILL", async () => {
    for (const p of ["/docs", "/docs/batch", "/docs/grain"]) {
      const res = await get(handler, p);
      expect(res.status).toBe(200);
      expect((await res.text()).length).toBeGreaterThan(500);
    }
  });

  test("layer PLANs mount as a docs collection distinct from the board", async () => {
    const detail = await get(handler, "/docs/plans/proof");
    expect(detail.status).toBe(200);
    expect((await detail.text())).toContain("PROOF");
  });

  test("the generated reference is served (read from the real registries)", async () => {
    const res = await get(handler, "/reference");
    expect(res.status).toBe(200);
    expect((await res.text())).toContain("Reference");
  });

  test("the GRAIN catalog is served", async () => {
    const res = await get(handler, "/catalog");
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBeGreaterThan(1000);
  });

  test("standards render through MILL", async () => {
    const res = await get(handler, "/standards");
    expect(res.status).toBe(200);
    expect((await res.text())).toContain("Standards");
  });

  test("the PROOF board mounts at /plans", async () => {
    const res = await get(handler, "/plans");
    expect(res.status).toBe(200);
    expect((await res.text())).toContain("Plans");
  });

  test("an unknown route is a 404", async () => {
    expect((await get(handler, "/nope")).status).toBe(404);
  });

  test("AI-retrieval (piece 9): /knowledge.json is the machine brain over this project", async () => {
    const res = await get(handler, "/knowledge.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const k = await res.json();
    expect(k.project).toBe("test-project");
    expect(k.runsModel).toBe(false);                 // AI-legible, not AI-powered
    expect(k.plans.plans.length).toBeGreaterThan(0); // the host's real plans
    expect(Array.isArray(k.docs)).toBe(true);
  });

  test("AI-retrieval (piece 9): /llms.txt is the plain-text session context pack", async () => {
    const res = await get(handler, "/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const txt = await res.text();
    expect(txt).toContain("# test-project");
    expect(txt).toContain("## Plans");
  });

  test("the home surfaces AI-retrieval AND the mindmap as LIVE links (pieces 9 + 10)", async () => {
    const home = await (await get(handler, "/")).text();
    expect(home).toContain(`href="/llms.txt"`);      // AI-retrieval is live
    expect(home).toContain(`href="/map"`);           // the mindmap is live now, not a teaser
    expect(home).not.toContain("pantry-teaser");     // no unbuilt teasers remain on home
  });

  test("mindmap (piece 10): /map degrades to guidance when the host has no graphify-out", async () => {
    const res = await get(handler, "/map");           // configWith() has graphPath null
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Mindmap");
    expect(html).toContain("graphify update .");       // teaches the command instead of crashing
  });

  test("mindmap (piece 10): /map.json is the machine twin — available:false without a graph", async () => {
    const res = await get(handler, "/map.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const m = await res.json();
    expect(m.available).toBe(false);
    expect(m.runsModel).toBe(false);
  });

  test("mindmap (piece 10): the viz client ships + reads its graph from /map.json", async () => {
    const res = await get(handler, "/pantry-map.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("javascript");
    expect(await res.text()).toContain("/map.json");
  });

  test("⌘K (piece 9b): the palette client ships + reads its index from /knowledge.json", async () => {
    const res = await get(handler, "/pantry-cmdk.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("javascript");
    const js = await res.text();
    expect(js).toContain("/knowledge.json");         // same brain as the machine retrieval
    // every page shell wires the palette
    const home = await (await get(handler, "/")).text();
    expect(home).toContain(`src="/pantry-cmdk.js"`);
  });
});

describe("surface toggles gate their routes", () => {
  test("reference + catalog + standards off → 404, the nav drops them", async () => {
    const handler = createPantryHandler({
      plansDir: EXAMPLE,
      config: configWith({ reference: false, catalog: false, standards: false }),
    });
    expect((await get(handler, "/reference")).status).toBe(404);
    expect((await get(handler, "/catalog")).status).toBe(404);
    expect((await get(handler, "/standards")).status).toBe(404);
    const home = await (await get(handler, "/")).text();
    expect(home).not.toContain(`href="/reference"`);
    expect(home).not.toContain(`href="/catalog"`);
  });

  test("decisions off → /decisions 404, the nav drops the link", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith({ decisions: false }) });
    expect((await get(handler, "/decisions")).status).toBe(404);
    expect((await get(handler, "/decisions.json")).status).toBe(404);
    const home = await (await get(handler, "/")).text();
    expect(home).not.toContain(`href="/decisions"`);
  });

  test("artifacts off → /artifacts 404, the nav + home teaser drop the link", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith({ artifacts: false }) });
    expect((await get(handler, "/artifacts")).status).toBe(404);
    expect((await get(handler, "/artifacts.json")).status).toBe(404);
    const home = await (await get(handler, "/")).text();
    expect(home).not.toContain(`href="/artifacts"`);
  });

  test("runs off → all three run routes 404, the nav + home teaser drop the link", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith({ runs: false }) });
    expect((await get(handler, "/runs")).status).toBe(404);
    expect((await get(handler, "/runs/anything")).status).toBe(404);
    expect((await get(handler, "/runs.json")).status).toBe(404);
    const home = await (await get(handler, "/")).text();
    expect(home).not.toContain(`href="/runs"`);
  });
});

describe("the decision inbox (piece 11d)", () => {
  test("with no decisions dir, /decisions renders the empty-state guidance (still 200, nav link present)", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith() });
    const res = await get(handler, "/decisions");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No decision inbox yet");
    expect(html).toContain(`href="/decisions"`);       // the nav link is present when the surface is on
    const j = await (await get(handler, "/decisions.json")).json();
    expect(j.available).toBe(false);
  });

  test("real decision files render as cards + a resolvable detail; the machine twin agrees", async () => {
    const decisionsDir = join(tmpdir(), `pantry-app-decisions-${Date.now()}`);
    await Bun.write(join(decisionsDir, "datastore.md"), `---
title: Which datastore for the ledger?
status: open
options:
  - Postgres — durable
  - SQLite — zero-ops
recommendation: SQLite — zero-ops
evidence:
  - piece 11c | /docs/plans/pantry
---
The context to decide.`);
    await Bun.write(join(decisionsDir, "old.md"), `---\ntitle: A settled call\nstatus: resolved\n---\ndone`);
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: { ...configWith(), decisionsDir } });

    // index: both cards, open-before-resolved, counts in the machine twin
    const index = await (await get(handler, "/decisions")).text();
    expect(index).toContain("Which datastore for the ledger?");
    expect(index).toContain("A settled call");
    const j = await (await get(handler, "/decisions.json")).json();
    expect(j.available).toBe(true);
    expect(j.openCount).toBe(1);
    expect(j.resolvedCount).toBe(1);
    expect(j.decisions[0].id).toBe("datastore");        // open sorts first

    // detail: options as radios, the recommendation flagged, the generate-prompt wiring present
    const detailRes = await get(handler, "/decisions/datastore");
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.text();
    expect(detail).toContain("Which datastore for the ledger?");
    expect(detail).toContain(`name="decision-option"`);
    expect(detail).toContain("recommended");            // the recommendation tag
    expect(detail).toContain(`href="/docs/plans/pantry"`); // evidence link rendered
    expect(detail).toContain("decision-generate");      // the button the client wires
    expect(detail).toContain("/pantry-decisions.js");   // the client script is loaded
    expect(detail).toContain(`data-decision-file`);     // the file path the prompt names

    // a missing id is a 404, not a crash
    expect((await get(handler, "/decisions/nope")).status).toBe(404);
  });
});

describe("the run ledger surface (piece 11c, human half)", () => {
  test("with no runs dir, /runs renders the empty-state guidance (still 200, nav link present)", async () => {
    const handler = createPantryHandler({
      plansDir: EXAMPLE,
      config: { ...configWith(), runsDir: join(EXAMPLE, "no-such-runs-dir") },
    });
    const res = await get(handler, "/runs");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No run ledger yet");
    expect(html).toContain(`href="/runs"`);            // the nav link is present when the surface is on
    const j = await (await get(handler, "/runs.json")).json();
    expect(j.available).toBe(false);
  });

  // The load-bearing test: a report that is MISSING evidence must say so on both views. A ledger the
  // page could flatter is a ledger with no reason to exist, which is the whole argument for linking
  // the owner here rather than summarising the run in chat.
  test("a thin report names its gaps and its scope growth; a complete one says so; the twin agrees", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "pantry-app-runs-"));
    await Bun.write(join(runsDir, "2026-08-09-thin.md"), `---
title: A run that hid its homework
date: 2026-08-09
status: partial
branch: main
scope:
  - runs.ts
touched:
  - runs.ts
  - doctor.ts
gates:
  - bun test | 227 pass, 0 fail
plans:
  - skills-runtime | /plans/skills-runtime
---
## Gate output
Everything passed.
## What was not done
Nothing.
`);
    await Bun.write(join(runsDir, "2026-08-08-complete.md"), `---
title: A run that carried its evidence
date: 2026-08-08
status: complete
scope:
  - app.ts
touched:
  - app.ts
diffstat: 1 file changed, 4 insertions(+)
unpushed: 0
verifiedBy: a reviewer that did not write the change
doctor: 0 failing, 0 carried
---
## Gate output
\`\`\`
227 pass, 0 fail
\`\`\`
## What was not done
The CSS pass.
## What needs human eyes
The wording on the empty state.
`);
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: { ...configWith(), runsDir } });

    // index: newest first, and the summary counts the incomplete ones rather than hiding them
    const index = await (await get(handler, "/runs")).text();
    expect(index).toContain("A run that hid its homework");
    expect(index).toContain("A run that carried its evidence");
    expect(index).toContain("2 runs, 1 missing evidence.");
    expect(index).toContain("Carries its evidence.");
    expect(index).toContain("7 of 9 evidence items missing");
    expect(index).toContain("Scope grew: 1 path outside the declared envelope");

    const j = await (await get(handler, "/runs.json")).json();
    expect(j.available).toBe(true);
    expect(j.count).toBe(2);
    expect(j.incompleteCount).toBe(1);
    expect(j.runs[0].id).toBe("2026-08-09-thin");      // newest date first

    // detail of the thin one: the gaps, the growth, and the gate pair all render
    const thin = await (await get(handler, "/runs/2026-08-09-thin")).text();
    expect(thin).toContain("Missing evidence");
    expect(thin).toContain("no diffstat");
    expect(thin).toContain("'What needs human eyes' missing or empty");
    expect(thin).toContain("gate output is not a verbatim fenced block");
    expect(thin).toContain("Scope growth");
    expect(thin).toContain("doctor.ts");              // the path that grew past the envelope
    expect(thin).toContain("bun test");               // the gate label
    expect(thin).toContain(`href="/plans/skills-runtime"`);  // the claimed plan links out
    expect(thin).toContain(`href="/runs"`);           // back to the index

    // detail of the complete one: no gap list, and the gate output survives as a fenced block
    const complete = await (await get(handler, "/runs/2026-08-08-complete")).text();
    expect(complete).toContain("Evidence complete");
    expect(complete).not.toContain("Missing evidence");
    expect(complete).toContain("227 pass, 0 fail");
    expect(complete).toContain("a reviewer that did not write the change");

    // a missing id is a 404, not a crash
    expect((await get(handler, "/runs/nope")).status).toBe(404);
  });

  // The detail page reads at two altitudes: a summary strip that answers "do I need to read this",
  // and a middle that folds so the strip is not buried. The one thing the fold may never swallow is
  // the evidence — LOOP §4a wants gate output present, and behind a click is not present.
  test("the detail page leads with a summary strip, folds only the run's own inventory, and never folds the evidence", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "pantry-app-runs-fold-"));
    await Bun.write(join(runsDir, "2026-08-10-full.md"), `---
title: A run with a long middle
date: 2026-08-10
status: partial
lane: gated
branch: main
scope:
  - app.ts
touched:
  - app.ts
  - pantry.css
skills:
  - loop-standard
plans:
  - runs-surface-polish | /plans/runs-surface-polish
gates:
  - bun test | 300 pass, 0 fail
dirty:
  - PLAN.md | lands with the next commit
diffstat: 3 files changed, 210 insertions(+), 3 deletions(-)
---
## Gate output
\`\`\`
300 pass, 0 fail
\`\`\`
## What was not done
The timeline layer.
## What needs human eyes
The fold's default state.
`);
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: { ...configWith(), runsDir } });
    const html = await (await get(handler, "/runs/2026-08-10-full")).text();

    // the strip: outcome, date, diffstat, evidence score, scope verdict — before the first section
    expect(html).toContain("evidence carried");
    expect(html).toContain("3 files changed, 210 insertions(+), 3 deletions(-)");
    expect(html).toContain("grew by 1");             // pantry.css was touched outside the envelope
    expect(html).toContain(">lane<");                // the §4b lane the run declared…
    expect(html).toContain(">gated</b>");            // …and which one it was
    expect(html.indexOf("pantry-run-summary-block")).toBeLessThan(html.indexOf("Missing evidence"));

    // the inventory folds, and says how much it is hiding
    expect(html).toContain(`<summary class="pantry-section-title">Touched`);
    expect(html).toContain(`<summary class="pantry-section-title">Declared scope`);
    expect(html).toContain(`<summary class="pantry-section-title">Skills`);

    // …and the evidence does not. Everything from the gate-output fence to the end of the body sits
    // outside every <details>, which is what makes "present rather than summarized" true here.
    const afterLastFold = html.slice(html.lastIndexOf("</details>"));
    expect(afterLastFold).toContain("300 pass, 0 fail");
    for (const heading of ["Missing evidence", "Scope growth", ">Gates<", "Left dirty"]) {
      const before = html.slice(0, html.indexOf(heading));
      expect(before.split("<details").length).toBe(before.split("</details>").length);  // no open fold
    }
  });
});

describe("run artifacts (piece 11e sub-unit 1)", () => {
  test("with no artifacts dir, /artifacts renders empty-state guidance (still 200, nav link present)", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith() });
    const res = await get(handler, "/artifacts");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No artifacts yet");
    expect(html).toContain(`href="/artifacts"`);
    const j = await (await get(handler, "/artifacts.json")).json();
    expect(j.available).toBe(false);
  });

  test("the run ledger (piece 11c) has a machine twin at /runs.json, and its reports are fetchable as raw bytes", async () => {
    const artifactsDir = join(tmpdir(), `pantry-app-runs-${Date.now()}`);
    await Bun.write(join(artifactsDir, "runs", "2026-08-07-a.md"), `---\ntitle: a thin report\n---\nIt went well.`);
    const config = { ...configWith(), artifactsDir, runsDir: join(artifactsDir, "runs") };
    const handler = createPantryHandler({ plansDir: EXAMPLE, config });

    const j = await (await get(handler, "/runs.json")).json();
    expect(j.available).toBe(true);
    expect(j.count).toBe(1);
    expect(j.incompleteCount).toBe(1);
    expect(j.runs[0].gaps.map((g: { id: string }) => g.id)).toContain("diffstat");

    // Reports live under artifacts/, so the existing raw route serves the source with no new surface.
    const raw = await get(handler, "/artifacts/raw/runs/2026-08-07-a.md");
    expect(raw.status).toBe(200);
    expect(await raw.text()).toContain("It went well.");
  });

  test("the runs surface off → /runs.json 404s like any other disabled surface", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith({ runs: false }) });
    expect((await get(handler, "/runs.json")).status).toBe(404);
  });

  test("real artifact files render as cards, newest first; the machine twin agrees; raw bytes are servable", async () => {
    const artifactsDir = join(tmpdir(), `pantry-app-artifacts-${Date.now()}`);
    await Bun.write(join(artifactsDir, "old-report.md"), "# an old report");
    await Bun.write(join(artifactsDir, "run-1", "shot.png"), "not-really-a-png");
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: { ...configWith(), artifactsDir } });

    const index = await (await get(handler, "/artifacts")).text();
    expect(index).toContain("old-report.md");
    expect(index).toContain("shot.png");

    const j = await (await get(handler, "/artifacts.json")).json();
    expect(j.available).toBe(true);
    expect(j.count).toBe(2);

    const rawRes = await get(handler, "/artifacts/raw/run-1/shot.png");
    expect(rawRes.status).toBe(200);
    expect(await rawRes.text()).toBe("not-really-a-png");
    expect(rawRes.headers.get("Content-Type")).toBe("image/png");
  });

  test("SECURITY: a traversal relPath cannot escape artifactsDir — 404, never the outside file's bytes", async () => {
    // artifactsDir and the "secret" are siblings under tmpdir(), so one ".." from artifactsDir
    // reaches the secret — the shape a `../../etc/passwd`-style attack takes, just fewer hops.
    const artifactsDir = join(tmpdir(), `pantry-app-artifacts-traversal-${Date.now()}`);
    await Bun.write(join(artifactsDir, "inside.txt"), "safe");
    const secretName = `pantry-app-secret-${Date.now()}.txt`;
    await Bun.write(join(tmpdir(), secretName), "SECRET");
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: { ...configWith(), artifactsDir } });

    // "../<secret>" with the slash percent-encoded, as a browser/curl would send it
    const res1 = await handler(new Request(`http://localhost/artifacts/raw/..%2F${secretName}`));
    expect(res1.status).toBe(404);

    // the doubled form named in the spec: ../../<something>
    const res2 = await handler(new Request(`http://localhost/artifacts/raw/..%2f..%2f${secretName}`));
    expect(res2.status).toBe(404);

    // a nonexistent file inside the dir is also a clean 404, not a crash
    expect((await get(handler, "/artifacts/raw/nope.txt")).status).toBe(404);

    // the legitimate file is still servable (the guard doesn't over-block)
    const ok = await get(handler, "/artifacts/raw/inside.txt");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("safe");
  });
});

describe("the home heartbeat row (piece 11e sub-unit 2)", () => {
  const stubReport = (overrides: Partial<Record<string, { severity: "error" | "warn" | "info"; ok: boolean; detail: string }>> = {}): DoctorReport => {
    const base: Record<string, { label: string; severity: "error" | "warn" | "info"; ok: boolean; detail: string }> = {
      "audit-freshness": { label: "audit freshness", severity: "warn", ok: true, detail: "last audit 3 days old (AUDIT-2026-07-26.md)" },
      "deps-drift": { label: "layer pins current", severity: "warn", ok: true, detail: "3 pins, none behind" },
      "doc-drift": { label: "doc links resolve", severity: "error", ok: true, detail: "12 pages, 0 problems" },
      "graphify-freshness": { label: "graphify freshness", severity: "warn", ok: true, detail: "graph 5 days old" },
      // a non-heartbeat check that must NOT appear in the strip
      "claude-md": { label: "CLAUDE.md present", severity: "error", ok: true, detail: "found" },
    };
    const checks = Object.entries(base).map(([id, c]) => ({ id, ...c, ...overrides[id] }));
    return { ok: true, checks };
  };

  test("renders exactly the four heartbeat pills, in order, and drops non-heartbeat checks", async () => {
    const html = homeBody(configWith(), configWith().surfaces, stubReport());
    expect(html).toContain("pantry-heartbeat");
    // the four labels, in the fixed order (deps-drift — the control-plane layer-pin surface — sits
    // right after the audit pill, ahead of the doc/graph freshness checks)
    const iAudit = html.indexOf("audit freshness");
    const iPins = html.indexOf("layer pins current");
    const iDrift = html.indexOf("doc links resolve");
    const iGraph = html.indexOf("graphify freshness");
    expect(iAudit).toBeGreaterThan(-1);
    expect(iPins).toBeGreaterThan(iAudit);
    expect(iDrift).toBeGreaterThan(iPins);
    expect(iGraph).toBeGreaterThan(iDrift);
    // doctor's own detail strings are surfaced verbatim (no re-derivation)
    expect(html).toContain("last audit 3 days old (AUDIT-2026-07-26.md)");
    expect(html).toContain("3 pins, none behind");
    expect(html).toContain("graph 5 days old");
    // a non-heartbeat check does not leak into the strip
    expect(html).not.toContain("CLAUDE.md present");
  });

  test("tone maps outcome → status class: ok, due (warn), danger (error)", async () => {
    const report = stubReport({
      "audit-freshness": { severity: "warn", ok: false, detail: "last audit 40 days old — over 30d, run AUDIT.md" }, // due
      "doc-drift": { severity: "error", ok: false, detail: "12 pages, 2 problems" },                                  // danger
      "graphify-freshness": { severity: "warn", ok: true, detail: "graph 5 days old" },                               // ok
    });
    const html = homeBody(configWith(), configWith().surfaces, report);
    expect(html).toContain(`data-tone="due"`);
    expect(html).toContain(`data-tone="danger"`);
    expect(html).toContain(`data-tone="ok"`);
  });

  test("a null report renders NO strip (graceful, no heartbeat markup)", async () => {
    const html = homeBody(configWith(), configWith().surfaces, null);
    expect(html).not.toContain("pantry-heartbeat");
    expect(html).not.toContain("pantry-pill");
    // the rest of the home still renders
    expect(html).toContain("test-project");
    expect(html).toContain(`href="/plans"`);
  });

  test("a report missing every heartbeat id renders no strip", async () => {
    const report: DoctorReport = { ok: true, checks: [{ id: "claude-md", severity: "error", ok: true, label: "CLAUDE.md present", detail: "found" }] };
    const html = homeBody(configWith(), configWith().surfaces, report);
    expect(html).not.toContain("pantry-heartbeat");
  });

  test("GET / is 200 in a bare repo (runDoctor may warn/throw) — the row degrades, never a 500", async () => {
    // a temp cwd with a plans/ dir but no CLAUDE.md/AUDIT.md/config — doctor will warn, drift may throw
    const cwd = await mkdtemp(join(tmpdir(), "pantry-bare-"));
    await mkdir(join(cwd, "plans"));
    const config = { ...configWith(), plansDir: join(cwd, "plans") };
    const handler = createPantryHandler({ plansDir: config.plansDir, config, cwd });
    const res = await get(handler, "/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("test-project"); // real home rendered, not an error page
  });
});

describe("mindmap with a real graphify-out (piece 10)", () => {
  // A tiny two-node graph written to a temp file, wired through config.graphPath — proves the whole
  // path (config → map model → route) draws a real map, not just the empty state.
  const graphFile = join(tmpdir(), `pantry-app-map-${Date.now()}.json`);
  const withGraph = (): ResolvedPantryConfig => ({ ...configWith(), graphPath: graphFile });

  test("/map renders the graph, /map.json is available, and it's listed in the machine brain", async () => {
    await Bun.write(graphFile, JSON.stringify({
      nodes: [
        { id: "batch::a", label: "a.ts", repo: "batch", community: 0, file_type: "code" },
        { id: "grain::b", label: "GRAIN.md", repo: "grain", community: 0, file_type: "document" },
      ],
      links: [{ source: "batch::a", target: "grain::b", relation: "references" }],
    }));
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: withGraph() });

    const page = await (await get(handler, "/map")).text();
    expect(page).toContain("Central nodes");            // the god-node list rendered
    expect(page).toContain("pantry-map-canvas");        // the canvas mount is present
    expect(page).not.toContain("graphify update .");    // NOT the empty state

    const m = await (await get(handler, "/map.json")).json();
    expect(m.available).toBe(true);
    expect(m.stats.nodeCount).toBe(2);
    expect(m.stats.repos.map((r: { repo: string }) => r.repo).sort()).toEqual(["batch", "grain"]);

    // when a graph exists the machine brain points agents at it; without one it stays silent
    const k = await (await get(handler, "/knowledge.json")).json();
    expect(k.surfaces.some((s: { route: string }) => s.route === "/map")).toBe(true);
  });
});

// ── the answer write-back (P2 of plans/pantry-review-layer.md) ────────────────
// PANTRY's ONLY write, so what is tested here is mostly what it REFUSES. Each refusal below is a
// bullet in that plan's security section, and a bullet whose test does not exist is a sentence.
describe("the answer channel — the one route in PANTRY that writes", () => {
  const withLog = async () => {
    const dir = await mkdtemp(join(tmpdir(), "pantry-answers-route-"));
    const config = { ...configWith(), answersLog: join(dir, "answers.jsonl") };
    return { dir, handler: createPantryHandler({ plansDir: EXAMPLE, config }), log: config.answersLog };
  };

  // Bun hands the server to the fetch handler; the tests stand in the one method the handler reads,
  // so a test that wants the write-back has to SAY which address it came from.
  const from = (address: string | null) =>
    ({ requestIP: () => (address ? { address } : null) });

  const post = (
    handler: (r: Request, s?: { requestIP?: (r: Request) => { address: string } | null }) => Promise<Response>,
    body: unknown,
    address: string | null = "127.0.0.1",
  ) => handler(
    new Request("http://localhost/answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    from(address),
  );

  const goodBody = {
    via: "test",
    choice: "SQLite",
    request: { source: "decision", ref: "run-ledger", question: "Which datastore for the run ledger?" },
  };

  test("a loopback POST appends and says where it landed", async () => {
    const { handler, log } = await withLog();
    const res = await post(handler, goodBody);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.path).toBe(log);
    expect((await Bun.file(log).text()).trim().split("\n")).toHaveLength(1);
  });

  test("a POST from off this machine is refused, and nothing is written", async () => {
    const { handler, log } = await withLog();
    const res = await post(handler, goodBody, "203.0.113.9");
    expect(res.status).toBe(403);
    expect(await Bun.file(log).exists()).toBe(false);
  });

  test("a POST with no knowable address is refused too — the unanswerable case defaults to no", async () => {
    const { handler } = await withLog();
    expect((await post(handler, goodBody, null)).status).toBe(403);
  });

  test("an answer with no question is refused, so the log cannot hold an unusable entry", async () => {
    const { handler, log } = await withLog();
    const res = await post(handler, { choice: "SQLite", request: { source: "decision", ref: "x" } });
    expect(res.status).toBe(400);
    expect(await Bun.file(log).exists()).toBe(false);
  });

  test("a body that is not JSON is a 400, not a 500", async () => {
    const { handler } = await withLog();
    expect((await post(handler, "{not json")).status).toBe(400);
  });

  test("a body over the cap is refused on the bytes actually read", async () => {
    const { handler } = await withLog();
    const huge = JSON.stringify({ ...goodBody, notes: "x".repeat(100_000) });
    expect((await post(handler, huge)).status).toBe(413);
  });

  // The cap has to STOP the read, not measure it afterwards. A reviewer caught the first version
  // buffering the whole body and then deciding, which caps what gets written and nothing else. This
  // streams, so a body that never ends is refused rather than held: the test would hang otherwise.
  test("an oversized body is refused without being read to the end", async () => {
    const { handler, log } = await withLog();
    let pushed = 0;
    const chunk = new TextEncoder().encode("x".repeat(8 * 1024));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pushed += chunk.byteLength;
        // Far past the cap. If the handler drained this instead of stopping, `pushed` would run away.
        if (pushed > 40 * 1024 * 1024) { controller.close(); return; }
        controller.enqueue(chunk);
      },
    });
    const res = await handler(
      new Request("http://localhost/answers", { method: "POST", body, duplex: "half" } as RequestInit),
      from("127.0.0.1"),
    );
    expect(res.status).toBe(413);
    expect(pushed).toBeLessThan(1024 * 1024);   // stopped near the cap, nowhere near the stream's end
    expect(await Bun.file(log).exists()).toBe(false);
  });

  test("GET /answers renders the log and marks what is unread; /answers.json is its twin", async () => {
    const { handler } = await withLog();
    await post(handler, goodBody);
    const page = await (await get(handler, "/answers")).text();
    expect(page).toContain("Which datastore for the run ledger?");
    expect(page).toContain("Unread (1)");
    const json = await (await get(handler, "/answers.json")).json();
    expect(json.unread).toHaveLength(1);
    expect(json.answers[0].choice).toBe("SQLite");
  });

  test("with the decisions surface off, the channel is off too — write and read alike", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pantry-answers-off-"));
    const config = { ...configWith({ decisions: false }), answersLog: join(dir, "answers.jsonl") };
    const handler = createPantryHandler({ plansDir: EXAMPLE, config });
    expect((await post(handler, goodBody)).status).toBe(404);
    expect((await get(handler, "/answers")).status).toBe(404);
    expect(await Bun.file(config.answersLog).exists()).toBe(false);
  });

  test("a GET to /answers never writes, whatever it carries", async () => {
    const { handler, log } = await withLog();
    await get(handler, "/answers");
    expect(await Bun.file(log).exists()).toBe(false);
  });
});
