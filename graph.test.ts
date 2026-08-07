// pantry/graph.test.ts — `pantry graph merge`. Hermetic: sibling discovery runs against a real temp
// tree (no real graphify needed for that part), and the merge orchestration is asserted against an
// INJECTED GraphifyRunner so these tests never depend on the graphify binary being installed. The one
// exception is the timeout test, which spawns a real short-lived process (`sleep`) through
// createGraphifyRunner to exercise the actual Bun.spawn + kill path, capped well under a second so it
// stays fast. Style mirrors deps.test.ts / timeline.test.ts.
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findSiblingGraphs,
  mergeGraphs,
  createGraphifyRunner,
  formatGraphMergeReport,
  type GraphifyRunner,
  affectedBy,
  scopeRadius,
  formatScopeRadius,
  type GraphifyRunResult,
} from "./graph.ts";

let root: string; // siblings root — a fake monorepo-parent dir
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pantry-graph-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const writeGraph = async (repo: string, nodes: unknown[] = [{ id: "n1", label: "foo" }]) => {
  const dir = join(root, repo, "graphify-out");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "graph.json"), JSON.stringify({ nodes, links: [] }));
};

describe("findSiblingGraphs", () => {
  test("finds every immediate subdir with a graphify-out/graph.json, sorted by name", async () => {
    await writeGraph("bread");
    await writeGraph("grain");
    const { found } = await findSiblingGraphs(root);
    expect(found.map((f) => f.name)).toEqual(["bread", "grain"]);
    expect(found[0].graphPath).toBe(join(root, "bread", "graphify-out", "graph.json"));
  });

  test("a graphify-out with no graph.json is reported as skipped, not silently dropped", async () => {
    await writeGraph("grain");
    await mkdir(join(root, "batch", "graphify-out"), { recursive: true }); // graphify-out present, no graph.json
    const { found, skipped } = await findSiblingGraphs(root);
    expect(found.map((f) => f.name)).toEqual(["grain"]);
    expect(skipped).toEqual([{ name: "batch", reason: expect.stringContaining("no graph.json") }]);
  });

  test("a plain subdir with no graphify-out at all is neither found nor skipped — not a candidate", async () => {
    await writeGraph("grain");
    await mkdir(join(root, "node_modules"), { recursive: true });
    const { found, skipped } = await findSiblingGraphs(root);
    expect(found.map((f) => f.name)).toEqual(["grain"]);
    expect(skipped).toEqual([]);
  });

  test("an unreadable siblingsRoot resolves to nothing found, never throws", async () => {
    const { found, skipped } = await findSiblingGraphs(join(root, "does-not-exist"));
    expect(found).toEqual([]);
    expect(skipped).toEqual([]);
  });

  test("the edge repo is never a candidate even when it has a graph.json", async () => {
    const savedHome = process.env.HOME;
    const fakeHome = await mkdtemp(join(tmpdir(), "pantry-graph-home-"));
    process.env.HOME = fakeHome;
    try {
      // siblingsRoot IS the fake home's Documents/Programming, matching the real edge layout
      const siblingsRoot = join(fakeHome, "Documents", "Programming");
      await mkdir(siblingsRoot, { recursive: true });
      const edgeDir = join(siblingsRoot, "edge", "graphify-out");
      await mkdir(edgeDir, { recursive: true });
      await writeFile(join(edgeDir, "graph.json"), JSON.stringify({ nodes: [{ id: "n1" }], links: [] }));
      const okDir = join(siblingsRoot, "grain", "graphify-out");
      await mkdir(okDir, { recursive: true });
      await writeFile(join(okDir, "graph.json"), JSON.stringify({ nodes: [{ id: "n1" }], links: [] }));

      const { found } = await findSiblingGraphs(siblingsRoot);
      expect(found.map((f) => f.name)).toEqual(["grain"]); // edge is excluded, grain is not
    } finally {
      process.env.HOME = savedHome;
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
});

describe("mergeGraphs (orchestration, injected runner)", () => {
  const okRunner = (stdout: string, code = 0): GraphifyRunner => async () => ({ kind: "ok", stdout, stderr: "", code });
  const neverCalledRunner: GraphifyRunner = async () => {
    throw new Error("runner should never be invoked when there are <2 graphs");
  };

  test("fewer than 2 graphs found is a clean failure — the runner is never invoked", async () => {
    await writeGraph("grain"); // only one
    const report = await mergeGraphs({ hostRoot: join(root, "grain"), siblingsRoot: root, runner: neverCalledRunner });
    expect(report.ok).toBe(false);
    expect(report.reason).toContain("need at least 2");
    expect(report.found).toHaveLength(1);
  });

  test("zero graphs found is a clean failure too", async () => {
    const report = await mergeGraphs({ hostRoot: join(root, "host"), siblingsRoot: root, runner: neverCalledRunner });
    expect(report.ok).toBe(false);
    expect(report.reason).toContain("found 0 graphs");
  });

  test("a successful merge parses graphify's node/edge counts and points at the host's own output path", async () => {
    await writeGraph("bread");
    await writeGraph("grain");
    const hostRoot = join(root, "bread");
    const report = await mergeGraphs({
      hostRoot,
      siblingsRoot: root,
      runner: okRunner("Merged 2 graphs -> 42 nodes, 7 edges\nWritten to: /whatever/merged-graph.json\n"),
    });
    expect(report.ok).toBe(true);
    expect(report.nodeCount).toBe(42);
    expect(report.edgeCount).toBe(7);
    expect(report.outPath).toBe(join(hostRoot, "graphify-out", "merged-graph.json"));
  });

  test("output path is always under hostRoot, never under siblingsRoot or a sibling", async () => {
    await writeGraph("bread");
    await writeGraph("grain");
    const hostRoot = join(root, "bread");
    const report = await mergeGraphs({ hostRoot, siblingsRoot: root, runner: okRunner("Merged 2 graphs -> 1 nodes, 0 edges\n") });
    expect(report.outPath.startsWith(hostRoot)).toBe(true);
    expect(report.outPath.startsWith(join(root, "grain"))).toBe(false);
  });

  test("graphify absent (runner reports not-found) is a clean failure, not a throw", async () => {
    await writeGraph("bread");
    await writeGraph("grain");
    const notFoundRunner: GraphifyRunner = async () => ({ kind: "not-found" });
    const report = await mergeGraphs({ hostRoot: join(root, "bread"), siblingsRoot: root, runner: notFoundRunner });
    expect(report.ok).toBe(false);
    expect(report.reason).toContain("not on PATH");
  });

  test("a timeout result is reported, not thrown", async () => {
    await writeGraph("bread");
    await writeGraph("grain");
    const timeoutRunner: GraphifyRunner = async () => ({ kind: "timeout" });
    const report = await mergeGraphs({ hostRoot: join(root, "bread"), siblingsRoot: root, runner: timeoutRunner });
    expect(report.ok).toBe(false);
    expect(report.reason).toContain("did not finish within");
  });

  test("a non-zero exit from graphify is reported with stderr, not thrown", async () => {
    await writeGraph("bread");
    await writeGraph("grain");
    const failRunner: GraphifyRunner = async () => ({ kind: "ok", stdout: "", stderr: "boom: bad json", code: 2 });
    const report = await mergeGraphs({ hostRoot: join(root, "bread"), siblingsRoot: root, runner: failRunner });
    expect(report.ok).toBe(false);
    expect(report.reason).toContain("exited 2");
    expect(report.reason).toContain("boom: bad json");
  });

  test("skipped repos are carried through to the report even on a successful merge", async () => {
    await writeGraph("bread");
    await writeGraph("grain");
    await mkdir(join(root, "batch", "graphify-out"), { recursive: true }); // no graph.json
    const report = await mergeGraphs({ hostRoot: join(root, "bread"), siblingsRoot: root, runner: okRunner("Merged 2 graphs -> 5 nodes, 2 edges\n") });
    expect(report.skipped.map((s) => s.name)).toEqual(["batch"]);
  });
});

describe("createGraphifyRunner (real spawn, real timeout+kill)", () => {
  test("a binary not on PATH resolves to not-found, not a thrown error", async () => {
    const runner = createGraphifyRunner("definitely-not-a-real-binary-xyz", 5_000);
    const result = await runner(["merge-graphs"], root);
    expect(result.kind).toBe("not-found");
  });

  test("an overrunning process is killed and reported as timeout, never hangs the caller", async () => {
    // `sleep 5` capped at 100ms — the runner must resolve well inside the test's own timeout, not wait
    // out the full 5s, proving the kill actually took effect rather than merely racing a promise.
    const runner = createGraphifyRunner("sleep", 100);
    const start = Date.now();
    const result: GraphifyRunResult = await runner(["5"], root);
    const elapsed = Date.now() - start;
    expect(result.kind).toBe("timeout");
    expect(elapsed).toBeLessThan(4_000); // proves it did not wait for sleep's real 5s
  });

  test("a fast real process reports ok with its exit code", async () => {
    const runner = createGraphifyRunner("sleep", 5_000);
    const result = await runner(["0"], root);
    expect(result).toEqual({ kind: "ok", stdout: "", stderr: "", code: 0 });
  });
});

describe("formatGraphMergeReport", () => {
  test("a successful merge reads OK with counts, names, and the output path", () => {
    const out = formatGraphMergeReport({
      ok: true,
      hostRoot: "/host",
      siblingsRoot: "/parent",
      found: [{ name: "bread", graphPath: "/parent/bread/graphify-out/graph.json" }, { name: "grain", graphPath: "/parent/grain/graphify-out/graph.json" }],
      skipped: [{ name: "batch", reason: "no graph.json" }],
      outPath: "/host/graphify-out/merged-graph.json",
      nodeCount: 10,
      edgeCount: 3,
    });
    expect(out).toContain("repos found (2): bread, grain");
    expect(out).toContain("skipped batch — no graph.json");
    expect(out).toContain("merged -> 10 nodes, 3 edges");
    expect(out).toContain("/host/graphify-out/merged-graph.json");
    expect(out.trim().endsWith("OK")).toBe(true);
  });

  test("a failed merge reads FAIL with the reason, no counts", () => {
    const out = formatGraphMergeReport({
      ok: false,
      hostRoot: "/host",
      siblingsRoot: "/parent",
      found: [],
      skipped: [],
      outPath: "/host/graphify-out/merged-graph.json",
      nodeCount: null,
      edgeCount: null,
      reason: "found 0 graphs under /parent — need at least 2 to merge",
    });
    expect(out).toContain("found 0 graphs under /parent — need at least 2 to merge");
    expect(out.trim().endsWith("FAIL")).toBe(true);
  });
});

// ── Blast radius ─────────────────────────────────────────────────────────────
//
// The traversal is a reimplementation of `graphify affected`, so the bar is that it agrees with the
// real binary. That agreement was established empirically before these tests existed (8 seeds in
// pantry's own graph, including the 22-file config.ts case, all exact matches). What is pinned HERE is
// the behaviour that agreement rests on, against hand-built graphs a reader can hold in their head.
describe("affectedBy — the reverse walk `graphify affected` performs", () => {
  // a -> b -> c, plus a `contains` edge that must never be followed.
  const graph = {
    nodes: [
      { id: "a", label: "a.ts" },
      { id: "b", label: "b.ts" },
      { id: "c", label: "c.ts" },
      { id: "sym", label: "helper()" },
    ],
    links: [
      { relation: "imports_from", source: "b", target: "a" }, // b imports a
      { relation: "imports_from", source: "c", target: "b" }, // c imports b
      { relation: "contains", source: "a", target: "sym" },   // a.ts contains helper()
    ],
  };

  test("returns what depends on the seed, not what the seed depends on", () => {
    expect(affectedBy(graph, ["a.ts"], 1)).toEqual(["b.ts"]);
    expect(affectedBy(graph, ["c.ts"], 1)).toEqual([]); // nothing imports c
  });

  test("depth controls how far the impact is followed", () => {
    expect(affectedBy(graph, ["a.ts"], 1)).toEqual(["b.ts"]);
    expect(affectedBy(graph, ["a.ts"], 2)).toEqual(["b.ts", "c.ts"]);
  });

  test("`contains` is never traversed — it is location, not impact", () => {
    // helper() lives IN a.ts. Walking `contains` in reverse would report a.ts as affected by its own
    // symbol, which is how a radius quietly fills up with noise.
    expect(affectedBy(graph, ["helper()"], 2)).toEqual([]);
  });

  test("the seed is never part of its own radius", () => {
    expect(affectedBy(graph, ["a.ts"], 5)).not.toContain("a.ts");
  });

  test("an unknown seed contributes nothing rather than throwing", () => {
    expect(affectedBy(graph, ["nope.ts"], 2)).toEqual([]);
    expect(affectedBy(graph, ["nope.ts", "a.ts"], 1)).toEqual(["b.ts"]);
  });

  test("a cycle terminates instead of looping forever", () => {
    const cyclic = {
      nodes: [{ id: "x", label: "x.ts" }, { id: "y", label: "y.ts" }],
      links: [
        { relation: "imports", source: "x", target: "y" },
        { relation: "imports", source: "y", target: "x" },
      ],
    };
    expect(affectedBy(cyclic, ["x.ts"], 10)).toEqual(["y.ts"]);
  });

  test("a graph with no links, or a malformed one, yields an empty radius", () => {
    expect(affectedBy({ nodes: [{ id: "a", label: "a.ts" }] }, ["a.ts"], 2)).toEqual([]);
    expect(affectedBy({}, ["a.ts"], 2)).toEqual([]);
  });
});

describe("scopeRadius — the pre-flight query behind `pantry scope`", () => {
  const writeLocalGraph = async (nodes: unknown[], links: unknown[]) => {
    const p = join(root, "graph.json");
    await writeFile(p, JSON.stringify({ nodes, links }));
    return p;
  };

  test("a seed given as a path matches the graph's bare filename label", async () => {
    const p = await writeLocalGraph(
      [{ id: "a", label: "a.ts" }, { id: "b", label: "b.ts" }],
      [{ relation: "imports_from", source: "b", target: "a" }],
    );
    const r = await scopeRadius(p, ["pantry/a.ts"]);
    expect(r.ok).toBe(true);
    expect(r.known).toEqual(["pantry/a.ts"]);
    expect(r.radius).toEqual(["b.ts"]);
  });

  test("a seed the graph does not carry is REPORTED, not silently dropped", async () => {
    // The failure this guards: an unknown seed contributes no radius, so a typo produces a
    // reassuringly small answer. Saying which seeds landed is what makes the number readable.
    const p = await writeLocalGraph([{ id: "a", label: "a.ts" }], []);
    const r = await scopeRadius(p, ["a.ts", "typo.ts"]);
    expect(r.known).toEqual(["a.ts"]);
    expect(formatScopeRadius(r)).toContain("not in the graph, contributing no radius: typo.ts");
  });

  test("no graph and no seeds are both clean failures, never throws", async () => {
    const noGraph = await scopeRadius(null, ["a.ts"]);
    expect(noGraph.ok).toBe(false);
    expect(formatScopeRadius(noGraph)).toContain("no graph");

    const p = await writeLocalGraph([{ id: "a", label: "a.ts" }], []);
    const noSeeds = await scopeRadius(p, []);
    expect(noSeeds.ok).toBe(false);
    expect(formatScopeRadius(noSeeds)).toContain("no files given");
  });

  test("an empty radius says so rather than printing an empty list", async () => {
    const p = await writeLocalGraph([{ id: "a", label: "a.ts" }], []);
    expect(formatScopeRadius(await scopeRadius(p, ["a.ts"]))).toContain("nothing depends on these");
  });
});

describe("scopeRadius — label collisions are reported, not inherited", () => {
  // Found by review against pantry's own graph: `isoDay()` is both app.ts:L541 and timeline.ts:L103,
  // and 19 labels there collide. Seeding one of them unions two unrelated radii, which is the only
  // defensible behaviour when we cannot know which was meant — but it used to be silent, so the answer
  // looked precise while being a merge of two different things.
  const collidingGraph = {
    nodes: [
      { id: "a_iso", label: "isoDay()", source_file: "a.ts", source_location: "L10" },
      { id: "b_iso", label: "isoDay()", source_file: "b.ts", source_location: "L20" },
      { id: "a_dep", label: "aDep.ts", source_file: "aDep.ts", source_location: "L1" },
      { id: "b_dep", label: "bDep.ts", source_file: "bDep.ts", source_location: "L1" },
      { id: "solo", label: "solo.ts", source_file: "solo.ts", source_location: "L1" },
    ],
    links: [
      { relation: "calls", source: "a_dep", target: "a_iso" },
      { relation: "calls", source: "b_dep", target: "b_iso" },
    ],
  };

  test("a colliding seed names every location and says the radius unions them", async () => {
    const p = join(root, "collide.json");
    await writeFile(p, JSON.stringify(collidingGraph));
    const r = await scopeRadius(p, ["isoDay()"]);
    expect(r.ambiguous).toEqual([{ seed: "isoDay()", locations: ["a.ts:L10", "b.ts:L20"] }]);
    // both sides' dependents are present — the union is real, which is exactly why it must be said
    expect(r.radius).toEqual(["aDep.ts", "bDep.ts"]);
    const out = formatScopeRadius(r);
    expect(out).toContain("AMBIGUOUS isoDay() matches 2 nodes (a.ts:L10, b.ts:L20)");
  });

  test("an unambiguous seed stays quiet", async () => {
    const p = join(root, "collide.json");
    await writeFile(p, JSON.stringify(collidingGraph));
    const r = await scopeRadius(p, ["solo.ts"]);
    expect(r.ambiguous).toEqual([]);
    expect(formatScopeRadius(r)).not.toContain("AMBIGUOUS");
  });
});
