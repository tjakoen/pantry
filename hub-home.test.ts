import { describe, expect, test } from "bun:test";
import { hubHomePage, sortRows, summarize, waitingBand, type HubRow, type HubSummary } from "./hub-home.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { worktreeMain } from "./hub.ts";
import { assembleBrief } from "./brief.ts";

const NOW = "2026-11-05T12:00:00.000Z";
const sum = (over: Partial<HubSummary> = {}): HubSummary => ({ live: 0, agentsRunning: 0, waiting: 0, answered: 0, drift: 0, outOfScope: 0, next: null, lastSeenAt: null, items: [], threads: [], ...over });
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

describe("tray summary", () => {
  const { trayPayload } = require("./hub-home.ts") as typeof import("./hub-home.ts");
  const S = (over: Partial<HubSummary> = {}): HubSummary => ({ live: 0, agentsRunning: 0, waiting: 0, answered: 0, drift: 0, outOfScope: 0, next: null, lastSeenAt: null, items: [], threads: [], ...over });
  const it = (title: string) => ({ kind: "decision", title, detail: "", label: "Answer", path: `/decisions/${title}` });
  const NOW = Date.parse("2026-11-19T08:00:00.000Z");

  test("counts local items, answers and fresh remote items, and caps the lines it lists", () => {
    const rows: HubRow[] = [{ name: "alpha", path: "/a", url: "http://localhost:4401/", up: true, summary: S({ answered: 1, items: Array.from({ length: 8 }, (_, i) => it(`d${i}`)) }) }];
    const others = [
      { machine: "pro", writtenAt: "2026-11-19T07:00:00.000Z", projects: [{ name: "grain", live: 0, lastSeenAt: null, next: null, items: [{ kind: "decision", title: "x", detail: "" }] }] },
      { machine: "pc", writtenAt: "2026-11-10T07:00:00.000Z", projects: [{ name: "hau", live: 0, lastSeenAt: null, next: null, items: [{ kind: "decision", title: "old", detail: "" }] }] },
    ];
    const t = trayPayload(rows, others, NOW);
    expect(t.needsYou).toBe(8 + 1 + 1);
    expect(t.items.length).toBe(6);
    expect(t.more).toBe(2);
    expect(t.items[0]).toEqual({ label: "alpha · d0", project: "alpha", path: "/decisions/d0" });
    expect(t.elsewhere).toBe("1 more on pro");
  });

  test("paused plans are listed with their resume time", () => {
    const rows: HubRow[] = [{ name: "pantry", path: "/p", url: "http://localhost:4402/", up: true, summary: S({ threads: [{ title: "Slice 4", state: "paused", who: null, until: "2026-11-19T13:00:00.000Z", next: "x", path: "/plan/a" }] }) }];
    expect(trayPayload(rows, [], NOW).paused).toEqual([{ label: "Slice 4 · resumes 13:00 UTC", project: "pantry", path: "/plan/a" }]);
  });
});
