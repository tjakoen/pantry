// pantry/retrieval.test.ts — the AI-retrieval brain (piece 9). We assert the EFFECT: the machine
// payload and the llms.txt context pack are DERIVED from the same real sources (PROOF plans + MILL
// collections + grain vocab), deterministic, and drift-free by construction — not that a function
// merely returns. Model-free, pure reads (PLAN §AI-legible, not AI-powered).
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile } from "node:fs/promises";
import type { MillCollection } from "@tjakoen/mill/serve.ts";
import type { ResolvedPantryConfig } from "./config.ts";
import { DEFAULT_HYGIENE } from "./hygiene.ts";
import { DEFAULT_CONTEXT_BUDGET } from "./context.ts";
import { buildKnowledge, renderLlmsTxt } from "./retrieval.ts";
import { PROOF_EXAMPLE as EXAMPLE } from "./fixtures.ts";

const AT = "2026-07-10T00:00:00.000Z";

const configWith = (surfaces: Partial<ResolvedPantryConfig["surfaces"]> = {}): ResolvedPantryConfig => ({
  cwd: EXAMPLE, projectName: "test-project", plansDir: EXAMPLE, docsDirs: [], graphPath: null, graphDir: join(EXAMPLE, "graphify-out"), decisionsDir: join(EXAMPLE, "decisions"), answersLog: join(EXAMPLE, "decisions", "answers.jsonl"), sessionsLog: "/tmp/pantry-test-sessions.jsonl", artifactsDir: join(EXAMPLE, "artifacts"), runsDir: join(EXAMPLE, "artifacts", "runs"), previewTarget: null, previewCommand: null, previewCommandCwd: EXAMPLE, toursDir: null,
  hygiene: DEFAULT_HYGIENE,
  contextBudgetChars: DEFAULT_CONTEXT_BUDGET,
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true, decisions: true, artifacts: true, timeline: true, runs: true, control: true, ...surfaces },
});

// A ContentSource-backed collection with a fixed slug list (one nonconforming, to prove filtering).
const fakeCollection = (prefix: string, title: string, description: string, slugs: string[]): MillCollection => ({
  prefix, title, description, source: { list: async () => slugs, read: async () => "" },
});

describe("buildKnowledge — the machine brain", () => {
  test("states the AI-legible-not-powered invariant for the machine", async () => {
    const k = await buildKnowledge(configWith(), [], AT);
    expect(k.runsModel).toBe(false);
    expect(k.project).toBe("test-project");
    expect(k.generatedAt).toBe(AT);               // injected → deterministic
  });

  test("plans come from PROOF's derived index over the host's real plans folder", async () => {
    const k = await buildKnowledge(configWith(), [], AT);
    expect(k.plans).not.toBeNull();
    expect(k.plans!.plans.length).toBeGreaterThan(0);
    expect(k.plans!.generatedAt).toBe(AT);
  });

  test("the board off → no plan index, and /plans drops from the surfaces", async () => {
    const k = await buildKnowledge(configWith({ plans: false }), [], AT);
    expect(k.plans).toBeNull();
    expect(k.surfaces.some((s) => s.route === "/plans")).toBe(false);
  });

  test("doc pages carry the human route + the raw .md source twin; nonconforming slugs are dropped", async () => {
    const k = await buildKnowledge(configWith(), [fakeCollection("/docs/x", "X docs", "the x docs", ["intro", "Bad Slug"])], AT);
    const col = k.docs.find((c) => c.prefix === "/docs/x")!;
    expect(col.title).toBe("X docs");
    expect(col.pages.map((p) => p.slug)).toEqual(["intro"]);          // "Bad Slug" filtered (404-safe)
    expect(col.pages[0].route).toBe("/docs/x/intro");
    expect(col.pages[0].source).toBe("/docs/x/intro.md");
  });

  test("grain's AI vocabulary is exported for the machine", async () => {
    const k = await buildKnowledge(configWith(), [], AT);
    expect(k.vocabulary.endpoints.some((e) => e.path === "/intent")).toBe(true);
    expect(k.vocabulary.renderOps.length).toBeGreaterThan(0);
  });

  test("surfaces gate on the resolved config", async () => {
    const k = await buildKnowledge(configWith({ reference: false, catalog: false }), [], AT);
    const routes = k.surfaces.map((s) => s.route);
    expect(routes).toContain("/standards");
    expect(routes).not.toContain("/reference");
    expect(routes).not.toContain("/catalog");
  });
});

describe("renderLlmsTxt — the session context pack (same brain, human projection)", () => {
  test("llmstxt.org shape: H1 project, summary blockquote, plan + doc sections with fetchable links", async () => {
    const k = await buildKnowledge(configWith(), [fakeCollection("/docs/x", "X docs", "the x docs", ["intro"])], AT);
    const txt = renderLlmsTxt(k);
    expect(txt.startsWith("# test-project")).toBe(true);
    expect(txt).toContain("> ");
    expect(txt).toContain("runs no model");                  // the invariant is stated in prose too
    expect(txt).toContain("## Plans");
    expect(txt).toContain("/plans/plan/");                   // a real plan-detail route
    expect(txt).toContain("## Docs");
    expect(txt).toContain("[X docs](/docs/x)");
    expect(txt).toContain("(/docs/x/intro)");
  });

  test("the board off drops the Plans section", async () => {
    const txt = renderLlmsTxt(await buildKnowledge(configWith({ plans: false }), [], AT));
    expect(txt).not.toContain("## Plans");
  });

  test("open decisions lead the pack (LOOP.md §4) + are listed as a machine surface; empty inbox is silent", async () => {
    // no decisions dir → openDecisions 0, no callout, no /decisions surface
    const quiet = await buildKnowledge(configWith(), [], AT);
    expect(quiet.openDecisions).toBe(0);
    expect(renderLlmsTxt(quiet)).not.toContain("## Decisions");
    expect(quiet.surfaces.some((s) => s.route === "/decisions")).toBe(false);

    // an open decision → counted, surfaced, and shouted first in the context pack
    const decisionsDir = join(tmpdir(), `pantry-retr-decisions-${Date.now()}`);
    await Bun.write(join(decisionsDir, "pick.md"), `---\ntitle: Pick one\nstatus: open\n---\n`);
    const loud = await buildKnowledge({ ...configWith(), decisionsDir }, [], AT);
    expect(loud.openDecisions).toBe(1);
    expect(loud.surfaces.some((s) => s.route === "/decisions")).toBe(true);
    const txt = renderLlmsTxt(loud);
    expect(txt).toContain("## Decisions — resolve before proceeding");
    // it precedes the Plans section (it gates the run)
    expect(txt.indexOf("## Decisions")).toBeLessThan(txt.indexOf("## Plans"));
  });

  test("run reports missing §9 evidence lead the pack too; a clean ledger stays silent", async () => {
    // no runs dir → nothing to inherit, no callout, no surface
    const quiet = await buildKnowledge(configWith(), [], AT);
    expect(quiet.incompleteRuns).toBe(0);
    expect(renderLlmsTxt(quiet)).not.toContain("## Loop hygiene");
    expect(quiet.surfaces.some((s) => s.route === "/runs.json")).toBe(false);

    // a report missing evidence → counted, surfaced, and read BEFORE this run writes its own
    const runsDir = join(tmpdir(), `pantry-retr-runs-${Date.now()}`);
    await Bun.write(join(runsDir, "2026-08-07-a.md"), `---\ntitle: a thin report\n---\nIt went well.`);
    const loud = await buildKnowledge({ ...configWith(), runsDir }, [], AT);
    expect(loud.incompleteRuns).toBe(1);
    expect(loud.surfaces.some((s) => s.route === "/runs.json")).toBe(true);
    const txt = renderLlmsTxt(loud);
    expect(txt).toContain("## Loop hygiene — the last runs' own record");
    expect(txt.indexOf("## Loop hygiene")).toBeLessThan(txt.indexOf("## Plans"));
    // the callout is the only place it appears — not duplicated into the Reference tail
    expect(txt.split("/runs.json")).toHaveLength(2);
  });

  test("a COMPLETE run report contributes nothing to the pack — only gaps are worth an agent's attention", async () => {
    const runsDir = join(tmpdir(), `pantry-retr-runs-ok-${Date.now()}`);
    await Bun.write(
      join(runsDir, "2026-08-07-ok.md"),
      `---\nscope:\n  - a.ts\ntouched:\n  - a.ts\ndiffstat: 1 file changed\nunpushed: 0\nverifiedBy: someone else\ndoctor: 0 failing\n---\n## Gate output\n\`\`\`\n1 pass\n\`\`\`\n## What was not done\nNothing.\n## What needs human eyes\nNothing.\n`,
    );
    const k = await buildKnowledge({ ...configWith(), runsDir }, [], AT);
    expect(k.incompleteRuns).toBe(0);
    expect(renderLlmsTxt(k)).not.toContain("## Loop hygiene");
  });

  test("the runs surface off → the ledger is not read at all", async () => {
    const runsDir = join(tmpdir(), `pantry-retr-runs-off-${Date.now()}`);
    await Bun.write(join(runsDir, "2026-08-07-a.md"), `---\ntitle: thin\n---\nbody`);
    const k = await buildKnowledge({ ...configWith({ runs: false, control: true }), runsDir }, [], AT);
    expect(k.incompleteRuns).toBe(0);
    expect(k.surfaces.some((s) => s.route === "/runs.json")).toBe(false);
  });
});

// The control center's machine twin in the index a model actually consults. The one surface built
// for a machine reader was invisible to it, which is the gap these cover.
describe("sessions in flight, in the pack", () => {
  const ago = (ms: number) => new Date(Date.parse(AT) - ms).toISOString();

  // A config whose session log is a real file we control, since the shared fixture points at a path
  // that does not exist (which is itself the "nothing observed this repo" case, tested below).
  const withLog = async (events: object[], surfaces: Partial<ResolvedPantryConfig["surfaces"]> = {}) => {
    const dir = await mkdtemp(join(tmpdir(), "pantry-retrieval-sessions-"));
    const sessionsLog = join(dir, "sessions.jsonl");
    await writeFile(sessionsLog, events.map((e) => JSON.stringify(e)).join("\n"));
    return { ...configWith(surfaces), cwd: EXAMPLE, sessionsLog };
  };

  const alive = { kind: "tool", at: ago(30_000), session: "s-alive", cwd: EXAMPLE, tool: "Edit", path: join(EXAMPLE, "a.ts") };
  const stale = { kind: "tool", at: ago(6 * 3_600_000), session: "s-old", cwd: EXAMPLE, tool: "Edit", path: join(EXAMPLE, "b.ts") };

  test("a live session is listed, with the count and the reason it matters to an agent", async () => {
    const k = await buildKnowledge(await withLog([alive]), [], AT);
    expect(k.aliveSessions).toBe(1);
    const entry = k.surfaces.find((s) => s.route === "/sessions.json");
    expect(entry).toBeDefined();
    expect(entry!.description).toContain("1 other session(s)");
    expect(entry!.description).toContain("leave alone");
  });

  test("nothing alive means no entry, even though sessions were recorded here", async () => {
    // Recorded is not the gate. An entry for a repo whose last session ended hours ago is noise in
    // an index whose whole job is to be short.
    const k = await buildKnowledge(await withLog([stale]), [], AT);
    expect(k.aliveSessions).toBe(0);
    expect(k.surfaces.find((s) => s.route === "/sessions.json")).toBeUndefined();
  });

  test("the surface off means no entry, however alive the sessions are", async () => {
    const k = await buildKnowledge(await withLog([alive], { control: false }), [], AT);
    expect(k.aliveSessions).toBe(0);
    expect(k.surfaces.find((s) => s.route === "/sessions.json")).toBeUndefined();
  });

  test("llms.txt and knowledge.json agree, because both are one brain in two projections", async () => {
    const live = await buildKnowledge(await withLog([alive]), [], AT);
    expect(renderLlmsTxt(live)).toContain("/sessions.json");
    expect(renderLlmsTxt(live)).toContain("you are not alone in this repo");

    const quiet = await buildKnowledge(await withLog([stale]), [], AT);
    expect(renderLlmsTxt(quiet)).not.toContain("/sessions.json");
  });

  test("a log nothing has written costs the entry and never the pack", async () => {
    // The pack is what an agent reads to orient. Failing to build it over a telemetry file nobody
    // promised would be there would be a poor trade.
    const k = await buildKnowledge(configWith(), [], AT);
    expect(k.aliveSessions).toBe(0);
    expect(k.surfaces.length).toBeGreaterThan(0);
    expect(k.runsModel).toBe(false);
  });
});
