import { describe, expect, test } from "bun:test";
import { assembleActivity, activityBody, laneSummary, segmentsOf, IDLE_GAP_MS } from "./activity.ts";
import { parseSessionLine, summarizeSessions, type SessionEvent } from "./sessions.ts";

const NOW = "2026-11-05T12:00:00.000Z";
const at = (minAgo: number) => new Date(Date.parse(NOW) - minAgo * 60_000).toISOString();
const ev = (minAgo: number, extra: Partial<SessionEvent> = {}): SessionEvent => ({ kind: "tool", at: at(minAgo), session: "s1", cwd: "/repo", ...extra });
const build = (events: SessionEvent[], plans = [{ id: "p1", title: "P1", status: "doing", owner: "ai", depends: [], touches: ["src"] }]) =>
  assembleActivity({ events, plans, repoRoot: "/repo", now: NOW, windowHours: 24, project: "repo", present: true });

describe("segments", () => {
  test("a silence longer than the gap splits a bar", () => {
    const t = [0, 60_000, 60_000 + IDLE_GAP_MS + 1, 60_000 + IDLE_GAP_MS + 2];
    expect(segmentsOf(t).map((s) => s.events)).toEqual([2, 2]);
  });
});

describe("lanes", () => {
  test("subagent events nest under their session with type and task, and their writes join a plan", () => {
    const a = build([
      ev(30, { kind: "start" }),
      ev(20, { kind: "agent-start", agent: "a1", agentType: "Explore", task: "Find the routes" }),
      ev(19, { agent: "a1", agentType: "Explore", path: "/repo/src/x.ts", tool: "Edit" }),
      ev(18, { kind: "agent-stop", agent: "a1", agentType: "Explore" }),
      ev(10),
    ]);
    expect(a.lanes).toHaveLength(1);
    expect(a.agentCount).toBe(1);
    const [agent] = a.lanes[0].agents;
    expect(agent).toMatchObject({ id: "a1", label: "Explore", task: "Find the routes", ended: true, plans: ["p1"] });
    expect(a.lanes[0].plans).toEqual(["p1"]);
  });

  test("events outside the window or another checkout are left out", () => {
    const a = build([ev(25 * 60), ev(5, { cwd: "/elsewhere" })]);
    expect(a.lanes).toHaveLength(0);
  });

  test("a session card names its worktree, says what it did, and lists the files with who wrote them", () => {
    const html = activityBody(build([
      ev(30, { worktree: "/repo/.claude/worktrees/fix-nav" }),
      ev(20, { agent: "a1", agentType: "locator", task: "Map it" }),
      ev(19, { agent: "a1", agentType: "locator", path: "/repo/src/x.ts", tool: "Edit" }),
    ]));
    expect(html).toContain("fix-nav");
    expect(html).toContain("Map it");
    expect(html).toContain("Wrote 1 file, inside plan p1, ran 1 subagent.");
    expect(html).toContain("<code>src/x.ts</code> <span class=\"act-by\">by locator</span>");
    expect(html.match(/class="act-row is-(session|agent)/g)?.length).toBe(2);
  });

  test("a session that only read says so instead of looking idle", () => {
    expect(laneSummary(build([ev(30, { tool: "Read" })]).lanes[0])).toBe("Read and ran commands, wrote nothing.");
  });
});

describe("the session reader folds subagents", () => {
  test("agent kinds parse, and a stopped subagent is done while its session stays alive", () => {
    const lines = [
      { kind: "start", at: at(3), session: "s1", cwd: "/repo" },
      { kind: "agent-start", at: at(2), session: "s1", cwd: "/repo", agent: "a1", agentType: "Explore", task: "Look" },
      { kind: "tool", at: at(2), session: "s1", cwd: "/repo", agent: "a2", agentType: "implementer", tool: "Edit", path: "/repo/a.ts" },
      { kind: "agent-stop", at: at(1), session: "s1", cwd: "/repo", agent: "a1" },
    ].map((l) => parseSessionLine(JSON.stringify(l)) as SessionEvent);
    expect(lines.every((l) => typeof l === "object")).toBe(true);
    const [row] = summarizeSessions({ path: "x", events: lines, malformed: 0, malformedTail: false, unknownKinds: 0, readError: null, truncated: false }, NOW);
    expect(row.state).toBe("alive");
    expect(row.lastTool).toBeNull();
    const byId = Object.fromEntries(row.agents.map((a) => [a.id, a]));
    expect(byId.a1).toMatchObject({ type: "Explore", task: "Look", state: "done" });
    expect(byId.a2).toMatchObject({ type: "implementer", state: "running", lastTool: "Edit" });
    expect(row.paths).toEqual(["/repo/a.ts"]);
  });
});

test("every class the activity and timeline pages draw with has a rule in pantry.css", async () => {
  const css = await Bun.file(new URL("./pantry.css", import.meta.url)).text();
  for (const cls of ["act-card", "act-stats", "act-legend", "act-window", "act-row", "act-track", "act-bar", "act-write", "act-sticky", "tl-row", "tl-seg", "ax-type", "ax-tree"])
    expect(css).toContain(`.${cls}`);
});

describe("subagent spend", () => {
  test("the stop event's model and tokens land on the subagent lane and show on the page", () => {
    const a = build([
      ev(12, { kind: "start" }),
      ev(10, { kind: "agent-start", agent: "a1", agentType: "locator" }),
      ev(9, { agent: "a1", agentType: "locator", tool: "Grep" }),
      ev(8, { kind: "agent-stop", agent: "a1", agentType: "locator", model: "claude-haiku-5-5", tokensIn: 41_200, tokensOut: 1_800 }),
    ]);
    const [agent] = a.lanes[0].agents;
    expect(agent).toMatchObject({ model: "claude-haiku-5-5", tokensIn: 41_200, tokensOut: 1_800 });
    expect(a.lanes[0].model).toBeNull();
    expect(activityBody(a)).toContain("haiku-5-5, 41k in, 2k out");
  });

  test("the stop line parses the new fields and drops a negative count", () => {
    const line = JSON.stringify({ kind: "agent-stop", at: NOW, session: "s1", cwd: "/repo", agent: "a1", model: "claude-sonnet-5-5", tokensIn: 5, tokensOut: -1 });
    const parsed = parseSessionLine(line);
    expect(parsed).toMatchObject({ model: "claude-sonnet-5-5", tokensIn: 5 });
    expect(typeof parsed === "object" && parsed !== null && "tokensOut" in parsed).toBe(false);
  });
});
