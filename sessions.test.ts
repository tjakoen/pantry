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
  harnessConfigDir,
  parseSessionLine,
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
const logOf = (events: SessionEvent[]): SessionLog =>
  ({ path: "/tmp/x.jsonl", events, malformed: 0, malformedTail: false, unknownKinds: 0, readError: null, truncated: false });
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
    expect(log.malformed).toBe(1);        // the truncated line
    expect(log.unknownKinds).toBe(1);     // "nope" is a newer emitter, not a defect
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

// Everything below came out of an independent review pass. Each one is a claim the module made in
// prose and did not keep, which is the argument for the second pass rather than for more prose.
describe("what the second pass found", () => {
  test("a stop only ends a session when nothing happened after it", () => {
    // The harness fires Stop at the end of every TURN. A stop treated as final made every session
    // read as ended from its first turn onward, which was the one new claim this module exists for.
    const [row] = summarizeSessions(logOf([
      start("s1", ago(600_000)),
      { kind: "stop", at: ago(300_000), session: "s1", cwd: "/repo" },
      tool("s1", ago(5_000), { tool: "Edit" }),
    ]), NOW);
    expect(row.stopped).toBe(false);
    expect(row.state).toBe("alive");
  });

  test("an event dated past the tolerance is ignored, not clamped, so a ghost cannot pin a row alive", () => {
    const rows = summarizeSessions(logOf([
      tool("ghost", new Date(Date.parse(NOW) + 31_536_000_000).toISOString()),
      tool("real", ago(2_000)),
    ]), NOW);
    expect(rows.map((r) => r.id)).toEqual(["real"]);
  });

  test("a clock a minute out is still a clock", () => {
    const [row] = summarizeSessions(logOf([tool("skewed", new Date(Date.parse(NOW) + 30_000).toISOString())]), NOW);
    expect(row.state).toBe("alive");
    expect(row.idleSeconds).toBe(0);
  });

  test("the cwd filter resolves both sides, so a trailing slash does not empty a full log", () => {
    const rows = summarizeSessions(logOf([tool("s1", ago(1_000))]), NOW, "/repo/");
    expect(rows).toHaveLength(1);
  });

  test("a kind this reader does not know is skipped quietly and never counted as malformed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pantry-sessions-"));
    const path = join(dir, "sessions.jsonl");
    await writeFile(path, [
      '{"kind":"start","at":"2026-08-22T11:00:00Z","session":"s1","cwd":"/repo"}',
      '{"kind":"decision","at":"2026-08-22T11:00:01Z","session":"s1","cwd":"/repo"}',
    ].join("\n"));
    const log = await readSessionLog(path);
    expect(log.events).toHaveLength(1);
    expect(log.unknownKinds).toBe(1);
    expect(log.malformed).toBe(0);
    expect(parseSessionLine('{"kind":"decision","at":"2026-08-22T11:00:01Z","session":"s1","cwd":"/repo"}')).toBe("unknown-kind");
  });

  test("a bad final line is a race, and a bad line anywhere else is a defect", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pantry-sessions-"));
    const racing = join(dir, "racing.jsonl");
    await writeFile(racing, '{"kind":"start","at":"2026-08-22T11:00:00Z","session":"s1","cwd":"/repo"}\n{half writ');
    const a = await readSessionLog(racing);
    expect(a.malformed).toBe(1);
    expect(a.malformedTail).toBe(true);

    const broken = join(dir, "broken.jsonl");
    await writeFile(broken, 'garbage\n{"kind":"start","at":"2026-08-22T11:00:00Z","session":"s1","cwd":"/repo"}\n');
    const b = await readSessionLog(broken);
    expect(b.malformedTail).toBe(false);
  });

  test("a log that exists and cannot be read says so, instead of looking like a quiet day", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pantry-sessions-"));
    const log = await readSessionLog(dir);          // a directory, not a file
    expect(log.readError).not.toBeNull();
    const payload = await buildSessionsPayload({ cwd: "/repo", projectName: "d", sessionsLog: dir } as never, NOW);
    expect(payload.readError).not.toBeNull();
  });

  test("an oversized log is read from the tail, and the payload admits it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pantry-sessions-"));
    const path = join(dir, "big.jsonl");
    const lines: string[] = [];
    for (let i = 0; i < 400; i++) {
      lines.push(JSON.stringify({ kind: "tool", at: ago(1_000), session: `s${i}`, cwd: "/repo", tool: "Bash" }));
    }
    await writeFile(path, lines.join("\n") + "\n");
    const log = await readSessionLog(path, 2_000);   // a cap far under the file
    expect(log.truncated).toBe(true);
    expect(log.events.length).toBeGreaterThan(0);
    expect(log.events.length).toBeLessThan(400);
    expect(log.malformed).toBe(0);                   // the partial first line is dropped, not counted
  });

  test("the config dir follows CLAUDE_CONFIG_DIR, because this machine splits accounts by it", () => {
    const before = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = "/cfg-work";
    try {
      expect(harnessConfigDir()).toBe("/cfg-work");
      expect(defaultSessionsLog("/repo")).toBe("/cfg-work/projects/-repo/sessions.jsonl");
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
    }
  });

  // The emitter is a bash + python hook in another repo, so nothing here can execute it. This is the
  // pantry half of the contract: a line copied verbatim from a real run of session-event.sh. Its twin
  // lives in the config repo and asserts the emitter still produces this shape. Either half failing
  // means the two have drifted, which is the failure no fixture written by hand can see.
  test("a line the real emitter wrote parses, field for field", () => {
    const emitted = '{"kind":"tool","at":"2026-08-23T03:55:36Z","session":"s1","cwd":"/tmp/demo","tool":"Edit","path":"/tmp/demo/ok.ts"}';
    expect(parseSessionEvent(emitted)).toEqual({
      kind: "tool", at: "2026-08-23T03:55:36Z", session: "s1", cwd: "/tmp/demo", tool: "Edit", path: "/tmp/demo/ok.ts",
    });
  });
});
