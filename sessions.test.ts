// pantry/sessions.test.ts — the session record, held to the claims sessions.ts makes in prose.
//
// The interesting tests are not the round trips. They are the honesty ones: a log nobody has written
// reads as absent rather than as a quiet day, a clock that runs backwards does not produce a negative
// idle time, a truncated path list says how much it dropped, and a session with no stop event stops
// claiming to be alive after an hour. Each of those is a sentence in the module header, and a
// sentence with no test is a wish.
import { test, expect, describe } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALIVE_WINDOW_MS,
  ENDED_WINDOW_MS,
  MAX_PATHS_PER_SESSION,
  buildSessionsPayload,
  defaultSessionsLog,
  parseSessionEvent,
  readSessionLog,
  resolveSessionsLog,
  summarizeSessions,
  type SessionEvent,
  type SessionLog,
} from "./sessions.ts";

const NOW = "2026-08-22T12:00:00.000Z";
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
const logOf = (events: SessionEvent[]): SessionLog => ({ path: "/tmp/x.jsonl", events, malformed: 0 });
const start = (session: string, at: string, extra: Partial<SessionEvent> = {}): SessionEvent =>
  ({ kind: "start", at, session, cwd: "/repo", ...extra });
const tool = (session: string, at: string, extra: Partial<SessionEvent> = {}): SessionEvent =>
  ({ kind: "tool", at, session, cwd: "/repo", tool: "Bash", ...extra });

describe("parseSessionEvent", () => {
  test("takes a well-formed line and keeps only the fields it knows", () => {
    const e = parseSessionEvent('{"kind":"tool","at":"2026-08-22T11:00:00Z","session":"s1","cwd":"/repo","tool":"Edit","path":"/repo/a.ts","junk":1}');
    expect(e).toEqual({ kind: "tool", at: "2026-08-22T11:00:00Z", session: "s1", cwd: "/repo", tool: "Edit", path: "/repo/a.ts" });
  });

  test("refuses a kind outside the vocabulary rather than inventing a state", () => {
    expect(parseSessionEvent('{"kind":"thinking","at":"2026-08-22T11:00:00Z","session":"s1","cwd":"/repo"}')).toBeNull();
  });

  test("refuses a line with no session, no cwd, an unparseable date, or no JSON at all", () => {
    expect(parseSessionEvent('{"kind":"start","at":"2026-08-22T11:00:00Z","cwd":"/repo"}')).toBeNull();
    expect(parseSessionEvent('{"kind":"start","at":"2026-08-22T11:00:00Z","session":"s1"}')).toBeNull();
    expect(parseSessionEvent('{"kind":"start","at":"whenever","session":"s1","cwd":"/repo"}')).toBeNull();
    expect(parseSessionEvent("{half a line")).toBeNull();
  });
});

describe("readSessionLog", () => {
  test("an absent file is the empty state and not an error", async () => {
    const log = await readSessionLog(join(tmpdir(), "pantry-sessions-does-not-exist.jsonl"));
    expect(log.events).toEqual([]);
    expect(log.malformed).toBe(0);
  });

  test("counts the lines it could not parse instead of throwing on them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pantry-sessions-"));
    const path = join(dir, "sessions.jsonl");
    await writeFile(path, [
      '{"kind":"start","at":"2026-08-22T11:00:00Z","session":"s1","cwd":"/repo"}',
      "",
      "{truncated because something is appending right now",
      '{"kind":"nope","at":"2026-08-22T11:00:01Z","session":"s1","cwd":"/repo"}',
    ].join("\n"));
    const log = await readSessionLog(path);
    expect(log.events).toHaveLength(1);
    expect(log.malformed).toBe(2);
  });
});

describe("summarizeSessions", () => {
  test("alive, idle and ended are decided by the clock, and a stop event outranks it", () => {
    const rows = summarizeSessions(logOf([
      tool("fresh", ago(60_000)),
      tool("resting", ago(ALIVE_WINDOW_MS + 60_000)),
      tool("gone", ago(ENDED_WINDOW_MS + 60_000)),
      tool("closed", ago(1_000)),
      { kind: "stop", at: ago(500), session: "closed", cwd: "/repo" },
    ]), NOW);
    const state = (id: string) => rows.find((r) => r.id === id)!.state;
    expect(state("fresh")).toBe("alive");
    expect(state("resting")).toBe("idle");
    expect(state("gone")).toBe("ended");
    expect(state("closed")).toBe("ended");
    expect(rows.find((r) => r.id === "closed")!.stopped).toBe(true);
  });

  test("an event dated in the future clamps to now rather than reading as negative idle time", () => {
    const [row] = summarizeSessions(logOf([tool("skewed", new Date(Date.parse(NOW) + 90_000).toISOString())]), NOW);
    expect(row.idleSeconds).toBe(0);
    expect(row.state).toBe("alive");
  });

  test("keeps first-touch order, drops duplicate paths, and says how many it left out", () => {
    const events = [start("s1", ago(600_000))];
    for (let i = 0; i < MAX_PATHS_PER_SESSION + 5; i++) {
      events.push(tool("s1", ago(500_000 - i), { tool: "Edit", path: `/repo/f${i}.ts` }));
    }
    events.push(tool("s1", ago(1_000), { tool: "Edit", path: "/repo/f0.ts" }));
    const [row] = summarizeSessions(logOf(events), NOW);
    expect(row.paths).toHaveLength(MAX_PATHS_PER_SESSION);
    expect(row.paths[0]).toBe("/repo/f0.ts");
    expect(row.pathsOmitted).toBe(5);
  });

  test("learns the parent from a start event that arrives after the tool events", () => {
    const [row] = summarizeSessions(logOf([
      tool("child", ago(300_000)),
      start("child", ago(400_000), { parent: "parent-1" }),
    ]), NOW);
    expect(row.parent).toBe("parent-1");
    expect(row.firstSeenAt).toBe(ago(400_000));
  });

  test("scopes to one working directory, because a folder name is not an identity", () => {
    const rows = summarizeSessions(logOf([
      tool("here", ago(1_000)),
      { kind: "tool", at: ago(1_000), session: "elsewhere", cwd: "/other/repo", tool: "Bash" },
    ]), NOW, "/repo");
    expect(rows.map((r) => r.id)).toEqual(["here"]);
  });

  test("orders by what moved most recently, and counts only the tool events", () => {
    const rows = summarizeSessions(logOf([
      start("old", ago(900_000)),
      tool("old", ago(800_000)),
      start("new", ago(200_000)),
      tool("new", ago(100_000)),
      tool("new", ago(90_000), { tool: "Read" }),
    ]), NOW);
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
    expect(rows[0].toolEvents).toBe(2);
    expect(rows[0].lastTool).toBe("Read");
    expect(rows[1].toolEvents).toBe(1);
  });
});

describe("where the log lives", () => {
  test("the default sits beside the agent memory, under the harness slug for the project", () => {
    expect(defaultSessionsLog("/Users/x/Code/site", "/cfg")).toBe("/cfg/projects/-Users-x-Code-site/sessions.jsonl");
  });

  test("a host-named path is honoured, relative to the project when it is relative", () => {
    expect(resolveSessionsLog("/repo", "/var/log/s.jsonl")).toBe("/var/log/s.jsonl");
    expect(resolveSessionsLog("/repo", "tmp/s.jsonl")).toBe("/repo/tmp/s.jsonl");
  });
});

describe("buildSessionsPayload", () => {
  test("says outright that nothing has observed this repo, rather than rendering a calm empty page", async () => {
    const payload = await buildSessionsPayload(
      { cwd: "/repo", projectName: "demo", sessionsLog: join(tmpdir(), "pantry-nothing-here.jsonl") } as never,
      NOW,
    );
    expect(payload.present).toBe(false);
    expect(payload.sessions).toEqual([]);
    expect(payload.generated).toBe(NOW);
  });

  test("reads a real log and scopes it to the host project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pantry-sessions-"));
    const path = join(dir, "sessions.jsonl");
    await writeFile(path, [
      JSON.stringify({ kind: "start", at: ago(60_000), session: "s1", cwd: "/repo" }),
      JSON.stringify({ kind: "tool", at: ago(30_000), session: "s1", cwd: "/repo", tool: "Edit", path: "/repo/a.ts" }),
      JSON.stringify({ kind: "start", at: ago(30_000), session: "s2", cwd: "/elsewhere" }),
    ].join("\n"));
    const payload = await buildSessionsPayload({ cwd: "/repo", projectName: "demo", sessionsLog: path } as never, NOW);
    expect(payload.present).toBe(true);
    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions[0].state).toBe("alive");
    expect(payload.sessions[0].paths).toEqual(["/repo/a.ts"]);
  });
});
