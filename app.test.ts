// pantry/app.test.ts — the cockpit's surfaces render (the composition holds). We drive the handler
// directly (no socket) and assert the EFFECT — a 200 with real content, not just that a route
// exists — per CONVENTIONS §6. Surface toggles gate their routes; an off surface is a 404.
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPantryHandler } from "./app.ts";
import type { ResolvedPantryConfig } from "./config.ts";

const EXAMPLE = join(import.meta.dir, "..", "proof", "example");

const configWith = (surfaces: Partial<ResolvedPantryConfig["surfaces"]> = {}): ResolvedPantryConfig => ({
  projectName: "test-project",
  plansDir: EXAMPLE,
  docsDirs: [],
  graphPath: null,
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true, ...surfaces },
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
