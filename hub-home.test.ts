import { describe, expect, test } from "bun:test";
import { hubHomePage, sortRows, summarize, waitingBand, type HubRow, type HubSummary } from "./hub-home.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { worktreeMain } from "./hub.ts";
import { assembleBrief } from "./brief.ts";

const NOW = "2026-11-05T12:00:00.000Z";
const sum = (over: Partial<HubSummary> = {}): HubSummary => ({ live: 0, agentsRunning: 0, waiting: 0, answered: 0, drift: 0, outOfScope: 0, next: null, lastSeenAt: null, items: [], ...over });
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

  test("the brief's waiting rows reach the hub as items with their own address", () => {
    const b = assembleBrief({ now: NOW, project: "x", repoRoot: "/repo", plans: [{ id: "a", title: "A", status: "blocked", owner: "ai", depends: [], touches: [] }],
      decisions: [], claims: new Map(), checks: [], sessions: [] });
    const s = summarize(b);
    expect(s.items).toEqual([{ kind: "blocked-plan", title: "A", detail: "Marked blocked.", label: "Open plan", path: "/plan/a" }]);
  });

  test("the waiting band lists every project's items, each linking into its project", () => {
    const html = waitingBand([r("alpha", { url: "http://localhost:4401/", summary: sum({ waiting: 1, items: [{ kind: "decision", title: "Pick a name", detail: "Blocks a.", label: "Answer", path: "/decisions/d1" }] }) })]);
    expect(html).toContain("Pick a name");
    expect(html).toContain(`href="http://localhost:4401/decisions/d1"`);
    expect(html).toContain("Decision");
  });

  test("an empty band says so in one sentence", () => {
    expect(waitingBand([r("alpha")])).toContain("Nothing is waiting on you in any project.");
  });

  test("zero counters, drift and out-of-scope writes stay off the row", () => {
    const html = hubHomePage([r("alpha", { summary: sum({ drift: 3, outOfScope: 10 }) })]);
    expect(html).not.toContain("0 answers unread");
    expect(html).not.toContain("out-of-scope writes");
    expect(html).not.toContain(">3</strong> drift");
  });

  test("the seeded welcome plan is not offered as next", () => {
    const b = assembleBrief({ now: NOW, project: "x", repoRoot: "/repo", plans: [{ id: "w", title: "Welcome to your plan board", status: "todo", owner: "ai", depends: [], touches: [] }],
      decisions: [], claims: new Map(), checks: [], sessions: [] });
    expect(summarize(b).next).toBeNull();
  });

  test("a git worktree resolves to its main checkout, a plain checkout to null", () => {
    const root = mkdtempSync(join(tmpdir(), "wt-"));
    const main = join(root, "main"), wt = join(root, "wt");
    mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
    mkdirSync(wt);
    writeFileSync(join(wt, ".git"), `gitdir: ${main}/.git/worktrees/wt\n`);
    expect(worktreeMain(wt)).toBe(main);
    expect(worktreeMain(main)).toBeNull();
  });
});
