// pantry/drift.test.ts — piece 9c: the doc-drift lint. We assert the EFFECT: a doc that links a live
// route / .md twin passes; a doc that links a route or twin the brain doesn't know FAILS with a dead-
// reference error; and out-of-namespace / external / anchor links are left alone (no false positives).
// Deterministic, pure reads over an in-memory brain — same discipline as retrieval.test.ts.
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MillCollection } from "@tjakoen/mill/serve.ts";
import type { ResolvedPantryConfig } from "./config.ts";
import { checkDrift, checkSymbolDrift, formatDriftReport, usesMergedGraph } from "./drift.ts";
import { PROOF_EXAMPLE as EXAMPLE } from "./fixtures.ts";   // real plans → real /plans/plan/:id routes
const AT = "2026-07-10T00:00:00.000Z";

const config = (surfaces: Partial<ResolvedPantryConfig["surfaces"]> = {}): ResolvedPantryConfig => ({
  cwd: EXAMPLE, projectName: "test-project", plansDir: EXAMPLE, docsDirs: [], graphPath: null, graphDir: join(EXAMPLE, "graphify-out"), decisionsDir: join(EXAMPLE, "decisions"), answersLog: join(EXAMPLE, "decisions", "answers.jsonl"), artifactsDir: join(EXAMPLE, "artifacts"), runsDir: join(EXAMPLE, "artifacts", "runs"), previewTarget: null, previewCommand: null, previewCommandCwd: EXAMPLE, toursDir: null,
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true, decisions: true, artifacts: true, timeline: true, runs: true, ...surfaces },
});

// A collection whose pages are (slug → markdown body), backed by an in-memory ContentSource.
const docs = (prefix: string, pages: Record<string, string>): MillCollection => ({
  prefix, title: prefix, description: "",
  source: { list: async () => Object.keys(pages), read: async (s) => pages[s] ?? null },
});

describe("checkDrift — the doc-drift lint (piece 9c)", () => {
  test("a live cross-page route + a live .md twin resolve → OK", async () => {
    const col = docs("/docs/x", {
      intro: "See [the guide](/docs/x/guide) and its [source](/docs/x/guide.md).",
      guide: "# Guide",
    });
    const report = await checkDrift(config(), [col], { generatedAt: AT });
    expect(report.ok).toBe(true);
    expect(report.problems).toHaveLength(0);
    expect(report.planCount).toBe(2);                 // both pages were read + scanned
  });

  test("a dead in-namespace route is flagged, attributed to the page it's on", async () => {
    const col = docs("/docs/x", { intro: "Read [the missing page](/docs/x/gone)." });
    const report = await checkDrift(config(), [col], { generatedAt: AT });
    expect(report.ok).toBe(false);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatchObject({ planId: "/docs/x/intro", severity: "error", field: "link" });
    expect(report.problems[0].message).toContain("/docs/x/gone");
  });

  test("a dead .md twin is flagged distinctly from a dead route", async () => {
    const col = docs("/docs/x", { intro: "The [raw source](/docs/x/gone.md)." });
    const report = await checkDrift(config(), [col], { generatedAt: AT });
    expect(report.ok).toBe(false);
    expect(report.problems[0].message).toContain(".md twin");
  });

  test("out-of-namespace, external, and anchor links are left alone (no false positives)", async () => {
    const col = docs("/docs/x", {
      intro: "Home is [here](/), see [about](/about), [grain](https://grain.example), [below](#section), "
        + "[reference](/reference), and [some app route](/whatever/else).",
    });
    const report = await checkDrift(config(), [col], { generatedAt: AT });
    expect(report.problems).toHaveLength(0);
    expect(report.ok).toBe(true);
  });

  test("a dead reference is caught across collections (the brain spans them)", async () => {
    const a = docs("/docs/a", { intro: "Jump to [b](/docs/b/exists) and [missing](/docs/b/nope)." });
    const b = docs("/docs/b", { exists: "# Exists" });
    const report = await checkDrift(config(), [a, b], { generatedAt: AT });
    expect(report.ok).toBe(false);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0].message).toContain("/docs/b/nope");
  });

  // The REAL plan id is the half of this test that was doing nothing. While the fixture path was
  // broken the corpus was empty, so every plan route was dead, and a test named "a live plan route
  // resolves" passed by flagging the bogus one and never noticing there was no live one to resolve.
  // Linking a plan the fixture actually contains is what makes the first clause of the name true.
  test("a live plan route resolves; a bogus plan id is flagged", async () => {
    const col = docs("/docs/x", {
      intro: "The [board](/plans), a [real plan](/plans/plan/001-core-parser) and a [bad plan](/plans/plan/does-not-exist).",
    });
    const report = await checkDrift(config(), [col], { generatedAt: AT });
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.message.includes("does-not-exist"))).toBe(true);
    expect(report.problems.some((p) => p.message.includes("001-core-parser"))).toBe(false);
  });

  test("the board off → no plan routes to link into, so a plan link is dead", async () => {
    const col = docs("/docs/x", { intro: "A [plan](/plans/plan/anything)." });
    const report = await checkDrift(config({ plans: false }), [col], { generatedAt: AT });
    expect(report.ok).toBe(false);                     // brain gates plans off → the route doesn't exist
  });

  test("formatDriftReport reads pages (not plans) and states pass/fail", async () => {
    const clean = await checkDrift(config(), [docs("/docs/x", { intro: "no links here" })], { generatedAt: AT });
    const out = formatDriftReport(clean);
    expect(out).toContain("1 pages, 0 problems");
    expect(out.trim().endsWith("OK")).toBe(true);
  });
});

// checkSymbolDrift (S4) — one level down from the link lint: a doc NAMING code that no longer exists.
// Same in-memory doc-collection fixtures as above; the graph itself is a small real graph.json in a
// temp dir, since graphSymbols reads it off disk. Info-severity-in-spirit, but CheckProblem only
// carries error/warning, so this reports "warning" and never gates — the tests pin that explicitly.
describe("checkSymbolDrift — the doc-symbol lint (piece S4)", () => {
  let graphDir: string;
  beforeEach(async () => {
    graphDir = await mkdtemp(join(tmpdir(), "pantry-drift-graph-"));
  });
  afterEach(async () => {
    await rm(graphDir, { recursive: true, force: true });
  });

  // A graph.json with the given nodes; returns the path checkSymbolDrift is pointed at. Always pass at
  // least one node — an empty list reads to graphSymbols as "unparseable" (it returns null, same as no
  // graph at all), which would skip the check rather than exercise it.
  const writeGraph = async (nodes: Array<{ label?: string; norm_label?: string }>): Promise<string> => {
    const path = join(graphDir, "graph.json");
    await writeFile(path, JSON.stringify({ nodes }));
    return path;
  };

  test("a symbol the graph HAS → no problems", async () => {
    const graphPath = await writeGraph([{ label: "fetchData", norm_label: "fetchData()" }]);
    const col = docs("/docs/x", { intro: "Call `fetchData()` to load it." });
    const report = await checkSymbolDrift({ ...config(), graphPath }, [col]);
    expect(report.problems).toHaveLength(0);
    expect(report.ok).toBe(true);
  });

  test("a symbol the graph LACKS → one warning problem, report stays ok (this lint never gates)", async () => {
    const graphPath = await writeGraph([{ label: "fetchData" }]);
    const col = docs("/docs/x", { intro: "Call `longGoneHelper()` to load it." });
    const report = await checkSymbolDrift({ ...config(), graphPath }, [col]);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatchObject({ field: "symbol", severity: "warning" });
    expect(report.problems[0].message).toContain("longGoneHelper()");
    expect(report.ok).toBe(true);
  });

  test("the same unknown identifier three times on one page → one problem (dedupe per identifier per page)", async () => {
    const graphPath = await writeGraph([{ label: "placeholder" }]);
    const col = docs("/docs/x", { intro: "`ghost()` ... later `ghost()` ... and again `ghost()`." });
    const report = await checkSymbolDrift({ ...config(), graphPath }, [col]);
    expect(report.problems).toHaveLength(1);
  });

  test("identifiers inside a fenced code block are ignored entirely", async () => {
    const graphPath = await writeGraph([{ label: "placeholder" }]);
    const col = docs("/docs/x", { intro: "```\n`ghost()`\n```" });
    const report = await checkSymbolDrift({ ...config(), graphPath }, [col]);
    expect(report.problems).toHaveLength(0);
  });

  test("method form thing.method() is out of scope by design", async () => {
    const graphPath = await writeGraph([{ label: "placeholder" }]);
    const col = docs("/docs/x", { intro: "Call `thing.method()`." });
    const report = await checkSymbolDrift({ ...config(), graphPath }, [col]);
    expect(report.problems).toHaveLength(0);
  });

  test("a builtin like toISOString() is ignored even though no graph node has it", async () => {
    const graphPath = await writeGraph([{ label: "placeholder" }]);
    const col = docs("/docs/x", { intro: "Format it with `toISOString()`." });
    const report = await checkSymbolDrift({ ...config(), graphPath }, [col]);
    expect(report.problems).toHaveLength(0);
  });

  test("no graph → zero problems, but planCount still counts the pages walked", async () => {
    const col = docs("/docs/x", { intro: "Call `ghost()`.", guide: "# Guide" });
    const report = await checkSymbolDrift({ ...config(), graphPath: null }, [col]);
    expect(report.problems).toHaveLength(0);
    expect(report.ok).toBe(true);
    expect(report.planCount).toBe(2);
  });
});

describe("usesMergedGraph", () => {
  test("true for a path ending merged-graph.json", () => {
    expect(usesMergedGraph({ ...config(), graphPath: "/x/graphify-out/merged-graph.json" })).toBe(true);
  });

  test("false for a path ending graph.json (the per-repo graph, not merged)", () => {
    expect(usesMergedGraph({ ...config(), graphPath: "/x/graphify-out/graph.json" })).toBe(false);
  });

  test("false when there is no graph at all", () => {
    expect(usesMergedGraph({ ...config(), graphPath: null })).toBe(false);
  });
});
