// pantry/retrieval.test.ts — the AI-retrieval brain (piece 9). We assert the EFFECT: the machine
// payload and the llms.txt context pack are DERIVED from the same real sources (PROOF plans + MILL
// collections + grain vocab), deterministic, and drift-free by construction — not that a function
// merely returns. Model-free, pure reads (PLAN §AI-legible, not AI-powered).
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import type { MillCollection } from "@tjakoen/mill/serve.ts";
import type { ResolvedPantryConfig } from "./config.ts";
import { buildKnowledge, renderLlmsTxt } from "./retrieval.ts";

const EXAMPLE = join(import.meta.dir, "..", "proof", "example");
const AT = "2026-07-10T00:00:00.000Z";

const configWith = (surfaces: Partial<ResolvedPantryConfig["surfaces"]> = {}): ResolvedPantryConfig => ({
  projectName: "test-project", plansDir: EXAMPLE, docsDirs: [], graphPath: null,
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true, ...surfaces },
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
});
