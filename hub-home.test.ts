import { describe, expect, test } from "bun:test";
import { hubHomePage, sortRows, summarize, type HubRow, type HubSummary } from "./hub-home.ts";
import { assembleBrief } from "./brief.ts";

const NOW = "2026-11-05T12:00:00.000Z";
const sum = (over: Partial<HubSummary> = {}): HubSummary => ({ live: 0, agentsRunning: 0, waiting: 0, answered: 0, drift: 0, outOfScope: 0, next: null, lastSeenAt: null, ...over });
const r = (name: string, over: Partial<HubRow> = {}): HubRow => ({ name, path: `/p/${name}`, url: `http://localhost:4401/`, up: true, summary: sum(), ...over });

describe("hub home", () => {
  test("a brief folds to counts, with running subagents counted once per session", () => {
    const b = assembleBrief({ now: NOW, project: "x", repoRoot: "/repo", plans: [{ id: "a", title: "A", status: "doing", owner: "ai", depends: [], touches: ["src"] }],
      decisions: [{ id: "d1", status: "open", blocks: ["a"] }], claims: new Map(), checks: [],
      sessions: [{ id: "s1", repo: "repo", cwd: "/repo", parent: null, state: "alive", firstSeenAt: NOW, lastSeenAt: NOW, idleSeconds: 0, stopped: false, skewedEvents: 0, toolEvents: 1, lastTool: "Edit", paths: ["/repo/src/a.ts"], pathsOmitted: 0,
        agents: [{ id: "a1", type: "Explore", task: "t", state: "running", startedAt: NOW, lastSeenAt: NOW, endedAt: null, toolEvents: 1, lastTool: "Read", paths: [] }] }] });
    expect(summarize(b)).toMatchObject({ live: 1, agentsRunning: 1, waiting: 1 });
  });

  test("live projects sort first, then waiting, then quiet; down ones last", () => {
    const rows = sortRows([r("down", { up: false, summary: null }), r("quiet"), r("waits", { summary: sum({ waiting: 2 }) }), r("live", { summary: sum({ live: 1 }) })]);
    expect(rows.map((x) => x.name)).toEqual(["live", "waits", "quiet", "down"]);
  });

  test("the page links each project and borrows styles from one that is up", () => {
    const html = hubHomePage([r("alpha", { summary: sum({ live: 1, agentsRunning: 2 }) })]);
    expect(html).toContain(`href="http://localhost:4401/"`);
    expect(html).toContain("2 subagent(s) running");
    expect(html).toContain(`href="http://localhost:4401/pantry.css"`);
  });
});
