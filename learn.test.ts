import { describe, expect, test } from "bun:test";
import { explainerOf, explainPrompt, withExplainer, type Explainer } from "./learn.ts";
import { assembleBrief } from "./brief.ts";
import { learnedBand, summarize, type HubRow } from "./hub-home.ts";

const NOW = "2026-11-19T13:00:00.000Z";
const x: Explainer = { topic: "hub", changed: "The hub lists what waits on the owner.", why: "A count said how many, never what.", dropped: "A live hub over the tunnel.", remember: "Every line names its next action.", at: "2026-11-19T12:00:00.000Z", by: "claude on air" };
const plan = "---\nid: a\nstatus: done\nowner: ai\n---\n\n# A\n";

describe("explainers", () => {
  test("an explainer round-trips through the plan file and replaces an older one", () => {
    const raw = withExplainer(withExplainer(plan, { ...x, remember: "old" }), x);
    expect(raw.match(/## What we learned/g)?.length).toBe(1);
    expect(explainerOf(raw)).toEqual(x);
    expect(explainerOf(plan)).toBeNull();
  });

  test("a plan closed this week reaches the hub grouped by topic, folded, with an Explain this prompt", () => {
    const old = { ...x, at: "2026-11-01T00:00:00.000Z" };
    const b = assembleBrief({ now: NOW, project: "pantry", repoRoot: "/r", plans: [
      { id: "a", title: "A", status: "done", owner: "ai", depends: [], touches: [], explainer: x },
      { id: "b", title: "B", status: "done", owner: "ai", depends: [], touches: [], explainer: old },
    ], decisions: [], claims: new Map(), checks: [], sessions: [] });
    expect(b.learned.map((l) => l.planId)).toEqual(["a"]);
    const row: HubRow = { name: "pantry", path: "/p", url: "http://localhost:4402/", up: true, summary: summarize(b) };
    const html = learnedBand([row]);
    expect(html).toContain("<details");
    expect(html).toContain(`<h3 class="hub-topic">hub</h3>`);
    expect(html).toContain("Every line names its next action.");
    expect(html).toContain("data-copy=");
    expect(explainPrompt("pantry", "a", "A")).toContain("Do not change anything.");
  });
});
