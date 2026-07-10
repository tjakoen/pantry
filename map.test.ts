// pantry/map.test.ts — the mindmap model (piece 10). We assert the EFFECT: the code graph an agent
// builds is turned into one deterministic model with central ("god") nodes surfaced by degree,
// repos + communities counted, and drift-free ordering — model-free, pure over the parsed graph
// (PLAN §AI-legible, not AI-powered). IO (loadGraphifyGraph) is tested against a temp file so the
// model tests never depend on a generated graphify-out artifact.
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildMap, buildMapPayload, loadGraphifyGraph, type GraphifyGraph } from "./map.ts";

const AT = "2026-07-10T00:00:00.000Z";

// A tiny two-repo graph: a code hub (a) with three neighbours, one document node, one dangling link
// (to a node that doesn't exist) to prove endpoint filtering.
const fixture: GraphifyGraph = {
  nodes: [
    { id: "batch::a", label: "a.ts", repo: "batch", community: 0, file_type: "code" },
    { id: "batch::b", label: "b.ts", repo: "batch", community: 0, file_type: "code" },
    { id: "batch::c", label: "c.ts", repo: "batch", community: 1, file_type: "code" },
    { id: "grain::d", label: "GRAIN.md", repo: "grain", community: 0, file_type: "document" },
  ],
  links: [
    { source: "batch::a", target: "batch::b", relation: "calls" },
    { source: "batch::a", target: "batch::c", relation: "imports" },
    { source: "batch::a", target: "grain::d", relation: "references" },
    { source: "batch::b", target: "batch::ghost", relation: "calls" }, // dangling — dropped
  ],
};

describe("buildMap — the mindmap model", () => {
  test("states the AI-legible-not-powered invariant and is deterministic", () => {
    const m = buildMap(fixture, "test-project", AT);
    expect(m.available).toBe(true);
    expect(m.runsModel).toBe(false);
    expect(m.project).toBe("test-project");
    expect(m.generatedAt).toBe(AT);
  });

  test("degree comes from real links only — the dangling link is dropped", () => {
    const m = buildMap(fixture, "p", AT);
    expect(m.stats.linkCount).toBe(3);                       // 4 links, 1 dangling → 3
    const a = m.nodes.find((n) => n.id === "batch::a")!;
    expect(a.degree).toBe(3);                                // hub
    const b = m.nodes.find((n) => n.id === "batch::b")!;
    expect(b.degree).toBe(1);                                // its dangling call didn't count
  });

  test("the central node is surfaced first by degree", () => {
    const m = buildMap(fixture, "p", AT);
    expect(m.gods[0].id).toBe("batch::a");
    expect(m.gods[0].degree).toBe(3);
    expect(m.stats.godNodeCount).toBe(m.gods.length);
  });

  test("a vendored/minified hub stays a node but is never surfaced as a central node", () => {
    const withVendor: GraphifyGraph = {
      nodes: [
        { id: "portfolio::vendor_htmx_min", label: "htmx.min.js", repo: "portfolio", community: 0, file_type: "code" },
        { id: "portfolio::app", label: "app.ts", repo: "portfolio", community: 0, file_type: "code" },
      ],
      // htmx is the higher-degree node, so a naive ranking would surface it first
      links: [
        { source: "portfolio::app", target: "portfolio::vendor_htmx_min", relation: "imports" },
        { source: "portfolio::vendor_htmx_min", target: "portfolio::app", relation: "references" },
        { source: "portfolio::app", target: "portfolio::vendor_htmx_min", relation: "calls" },
      ],
    };
    const m = buildMap(withVendor, "p", AT);
    expect(m.nodes.some((n) => n.id === "portfolio::vendor_htmx_min")).toBe(true); // still a node
    expect(m.gods.some((g) => g.label === "htmx.min.js")).toBe(false);            // not a central node
    expect(m.gods[0].id).toBe("portfolio::app");                                   // the real hub wins
  });

  test("repos and communities are counted; document vs code is preserved", () => {
    const m = buildMap(fixture, "p", AT);
    expect(m.stats.nodeCount).toBe(4);
    expect(m.stats.repos).toEqual([{ repo: "batch", nodes: 3 }, { repo: "grain", nodes: 1 }]);
    expect(m.stats.communityCount).toBe(3);                  // batch:0, batch:1, grain:0
    expect(m.nodes.find((n) => n.id === "grain::d")!.kind).toBe("document");
  });

  test("nodes and links sort by stable keys (drift-free)", () => {
    const ids = buildMap(fixture, "p", AT).nodes.map((n) => n.id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("loadGraphifyGraph + buildMapPayload — the IO edge", () => {
  test("a missing path yields an available:false payload, never a throw", async () => {
    const p = await buildMapPayload({ projectName: "p", graphPath: null }, AT);
    expect(p.available).toBe(false);
    if (!p.available) expect(p.reason).toContain("graphify");
  });

  test("a nonexistent file loads as null (surface auto-disables)", async () => {
    expect(await loadGraphifyGraph(join(tmpdir(), "does-not-exist-graph.json"))).toBeNull();
  });

  test("a real file round-trips into the model", async () => {
    const file = join(tmpdir(), `pantry-map-fixture-${Date.now()}.json`);
    await Bun.write(file, JSON.stringify(fixture));
    const p = await buildMapPayload({ projectName: "p", graphPath: file }, AT);
    expect(p.available).toBe(true);
    if (p.available) expect(p.stats.nodeCount).toBe(4);
  });

  test("a malformed graph loads as null", async () => {
    const file = join(tmpdir(), `pantry-map-bad-${Date.now()}.json`);
    await Bun.write(file, "{ not: valid json");
    expect(await loadGraphifyGraph(file)).toBeNull();
  });
});
