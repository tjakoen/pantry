// pantry/drift.test.ts — piece 9c: the doc-drift lint. We assert the EFFECT: a doc that links a live
// route / .md twin passes; a doc that links a route or twin the brain doesn't know FAILS with a dead-
// reference error; and out-of-namespace / external / anchor links are left alone (no false positives).
// Deterministic, pure reads over an in-memory brain — same discipline as retrieval.test.ts.
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import type { MillCollection } from "@tjakoen/mill/serve.ts";
import type { ResolvedPantryConfig } from "./config.ts";
import { checkDrift, formatDriftReport } from "./drift.ts";

const EXAMPLE = join(import.meta.dir, "..", "proof", "example");   // real plans → real /plans/plan/:id routes
const AT = "2026-07-10T00:00:00.000Z";

const config = (surfaces: Partial<ResolvedPantryConfig["surfaces"]> = {}): ResolvedPantryConfig => ({
  projectName: "test-project", plansDir: EXAMPLE, docsDirs: [],
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true, ...surfaces },
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

  test("a live plan route resolves; a bogus plan id is flagged", async () => {
    const col = docs("/docs/x", { intro: "The [board](/plans) and a [bad plan](/plans/plan/does-not-exist)." });
    const report = await checkDrift(config(), [col], { generatedAt: AT });
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.message.includes("does-not-exist"))).toBe(true);
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
