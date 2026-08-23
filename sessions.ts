// pantry/sessions.ts — C0 of the control center: what is moving right now, and who is moving it.
//
// PANTRY can already say what the project meant to do (/plans), what it finished (/runs), what it is
// asking a human (/decisions) and what the code looks like to an agent (/map). It has never had any
// concept of a SESSION, which is why six of them across three repos leave nobody oriented. This
// module is the missing record, and only the record: the page that joins it to the plan board is C1.
//
// **PANTRY still writes exactly one file, and it is not this one.** The events are appended by a
// harness hook (~/.claude/tools/session-event.sh); everything here is a read. That is deliberate and
// it is why the default log lives OUTSIDE the repo, under the harness config dir beside the project's
// memory: session events are machine state, they are noisy, and a repo that gains a churning tracked
// file for the privilege of being observed has paid too much. The path rule is the one context.ts
// already documents, so the log is per-project without a registry, and C4's several-repos step is a
// directory listing rather than a new mechanism.
//
// **The transcript was the obvious source and it is not the one.** The harness writes a far richer
// JSONL per session in the same directory, free and already on disk. It is also an undocumented
// format owned by a vendor who can change it in a point release, so a surface built on it breaks on
// somebody else's schedule. The heartbeat below is a schema we own, it is a few hundred bytes a
// session, and its failure mode is an empty list. If transcript parsing ever lands it enriches a row
// that already renders without it.
//
// **What a row may honestly claim.** Alive, idle, or ended, from timestamps and a stop event. Not
// what the model is thinking: nothing here observes that, and a surface that animates a thought it
// cannot see is a lie with a spinner on it.
import { existsSync } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { harnessProjectDir } from "./context.ts";
import type { ResolvedPantryConfig } from "./config.ts";

/** The three moments the emitter records. Anything else in the log is malformed, by design: a
 *  vocabulary that grows silently is one no reader can be held to. */
export const SESSION_EVENT_KINDS = ["start", "tool", "stop"] as const;
export type SessionEventKind = (typeof SESSION_EVENT_KINDS)[number];

/** One line of the log. Every field beyond the four required ones is best-effort: the harness does
 *  not promise a parent id, and a tool event for a read carries no path. */
export interface SessionEvent {
  kind: SessionEventKind;
  /** ISO 8601, written by the emitter at the moment the hook fired */
  at: string;
  /** the harness session id */
  session: string;
  /** the absolute working directory the session was in */
  cwd: string;
  /** the tool name, on a tool event */
  tool?: string;
  /** the file a write-shaped tool touched, absolute, on a tool event that had one */
  path?: string;
  /** the session that spawned this one, where the harness supplied it */
  parent?: string;
}

export interface SessionLog {
  path: string;
  events: SessionEvent[];
  /** lines that did not parse or did not match the schema. Reported rather than thrown: a truncated
   *  last line is the normal state of a file something is appending to right now, which is why the
   *  doctor only calls this a schema disagreement when the bad line is not the last one. */
  malformed: number;
  /** true when the bad line was the final one, so a reader can tell a race from a defect */
  malformedTail: boolean;
  /** lines carrying a kind this reader does not know. NOT malformed: the emitter is allowed to grow
   *  its vocabulary before this file learns the new word, and an older PANTRY reporting a defect on
   *  every line of a newer log is how a check gets muted. */
  unknownKinds: number;
  /** why the log could not be read, when it exists and could not be. Folding this into the empty
   *  case would make an unreadable log byte-identical to one nobody has written. */
  readError: string | null;
  /** true when the log was longer than the cap and only its tail was read */
  truncated: boolean;
}

/** How long after its last event a session is still called alive. Five minutes is longer than a
 *  model turn and shorter than a coffee, which is the distinction the word has to carry. */
export const ALIVE_WINDOW_MS = 5 * 60_000;
/** After this, a session with no stop event is presumed gone rather than idle. A harness that is
 *  killed rather than closed never writes its stop, and a row that says "alive" for a week is the
 *  reason nobody trusts a dashboard. */
export const ENDED_WINDOW_MS = 60 * 60_000;
/** Paths kept per row. A long session touches hundreds and the join C1 needs is satisfied by a
 *  sample, so the cap is stated here rather than discovered as a slow page. */
export const MAX_PATHS_PER_SESSION = 50;
/** How much of the log is read. The file is append-only and nothing rotates it, so an unbounded read
 *  is a request that gets slower for the life of the machine: a million lines measured at 169MB,
 *  375ms of parsing and 769MB of memory, on every page load and every doctor run. Above this the
 *  tail is read and the payload says so. */
export const MAX_LOG_BYTES = 4 * 1024 * 1024;
/** How far ahead of the reader an event may be dated before it is ignored. A clock a minute out is a
 *  clock; a row dated next century pins itself to the top of the list and can never retire, because
 *  every window is measured from a timestamp that is always in the future. */
export const FUTURE_TOLERANCE_MS = 60_000;

export type SessionState = "alive" | "idle" | "ended";

export interface SessionRow {
  id: string;
  /** the folder name of cwd, which is what a person calls the repo */
  repo: string;
  cwd: string;
  parent: string | null;
  state: SessionState;
  /** ISO, from the first event seen for this session, which is not always a start event: a log that
   *  was rotated or an emitter mounted mid-session both begin in the middle. */
  firstSeenAt: string;
  lastSeenAt: string;
  /** whole seconds since the last event, so a caller never re-derives it from two timestamps */
  idleSeconds: number;
  /** true when the LAST thing this session did was stop. A stop followed by more events is a session
   *  that carried on, which is the normal shape when the harness closes and reopens one. */
  stopped: boolean;
  /** events dated further ahead than FUTURE_TOLERANCE_MS, ignored for every other field here */
  skewedEvents: number;
  toolEvents: number;
  lastTool: string | null;
  /** the files this session was seen writing, in first-touch order, capped */
  paths: string[];
  /** paths dropped by the cap, so a truncated list never reads as a complete one */
  pathsOmitted: number;
}

export interface SessionsPayload {
  generated: string;
  project: string;
  logPath: string;
  /** false when no log exists at all, which is the emitter not being mounted rather than a quiet day */
  present: boolean;
  sessions: SessionRow[];
  malformed: number;
  /** set when the log exists and could not be read at all, which is a different state from empty */
  readError: string | null;
  /** true when only the tail of an oversized log was read */
  truncated: boolean;
}

/**
 * Where the events land when the host names nothing: beside the project's agent memory, under the
 * harness config dir. See the header for why this is outside the repo.
 */
export function defaultSessionsLog(cwd: string, configDir = harnessConfigDir()): string {
  return join(harnessProjectDir(cwd, configDir), "sessions.jsonl");
}

/**
 * The harness config dir, with the SAME precedence the emitter uses. This estate splits two accounts
 * by CLAUDE_CONFIG_DIR, so a reader that only knows about ~/.claude looks in the wrong place for
 * every session started through the work wrapper and reports "nothing has observed this repo"
 * forever while the emitter is appending happily a directory away.
 */
export const harnessConfigDir = (): string => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

const isKind = (v: unknown): v is SessionEventKind =>
  typeof v === "string" && (SESSION_EVENT_KINDS as readonly string[]).includes(v);

/**
 * One line to an event, to the string "unknown-kind", or to null for a line this reader calls
 * malformed. The three-way answer is the point: a kind nobody here recognises is a NEWER emitter,
 * which is a thing to skip quietly, and a half-written line is a race, and only the rest is a defect.
 * Strict on the four fields a row is built from, tolerant of every field beyond them.
 */
export function parseSessionLine(line: string): SessionEvent | "unknown-kind" | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.kind === "string" && !isKind(o.kind)) return "unknown-kind";
  if (!isKind(o.kind)) return null;
  if (typeof o.session !== "string" || !o.session) return null;
  if (typeof o.cwd !== "string" || !o.cwd) return null;
  if (typeof o.at !== "string" || Number.isNaN(Date.parse(o.at))) return null;
  const event: SessionEvent = { kind: o.kind, at: o.at, session: o.session, cwd: o.cwd };
  if (typeof o.tool === "string" && o.tool) event.tool = o.tool;
  if (typeof o.path === "string" && o.path) event.path = o.path;
  if (typeof o.parent === "string" && o.parent) event.parent = o.parent;
  return event;
}

/** The strict form: an event, or null for anything this reader cannot use. */
export const parseSessionEvent = (line: string): SessionEvent | null => {
  const parsed = parseSessionLine(line);
  return parsed === "unknown-kind" ? null : parsed;
};

/**
 * Read the whole log. An absent file is the empty state and not an error, the same posture the answer
 * log takes: a repo nothing has observed yet is the healthy case, and the caller is told which of the
 * two it got through `present` rather than having to guess from a zero.
 */
export async function readSessionLog(logPath: string, maxBytes = MAX_LOG_BYTES): Promise<SessionLog> {
  const empty: SessionLog = { path: logPath, events: [], malformed: 0, malformedTail: false, unknownKinds: 0, readError: null, truncated: false };
  if (!existsSync(logPath)) return empty;

  let text: string;
  let truncated = false;
  try {
    const info = await stat(logPath);
    if (!info.isFile()) return { ...empty, readError: "not a regular file" };
    if (info.size > maxBytes) {
      // The tail, and the first line of it thrown away: reading from an arbitrary byte offset lands
      // mid-line far more often than not, and half a line parsed is a malformed count that means
      // nothing. Losing the oldest partial line costs a session nobody was going to look at.
      const handle = await open(logPath, "r");
      try {
        const buf = Buffer.alloc(maxBytes);
        await handle.read(buf, 0, maxBytes, info.size - maxBytes);
        text = buf.toString("utf8");
        text = text.slice(text.indexOf("\n") + 1);
        truncated = true;
      } finally {
        await handle.close();
      }
    } else {
      text = await readFile(logPath, "utf8");
    }
  } catch (err) {
    return { ...empty, readError: err instanceof Error ? err.message : String(err) };
  }

  const events: SessionEvent[] = [];
  let malformed = 0;
  let unknownKinds = 0;
  let malformedTail = false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parsed = parseSessionLine(line);
    if (parsed === "unknown-kind") unknownKinds++;
    else if (parsed) events.push(parsed);
    else {
      malformed++;
      // The last non-empty line being bad is a read that raced an append, not a schema defect.
      if (lines.slice(i + 1).every((rest) => !rest.trim())) malformedTail = true;
    }
  }
  return { path: logPath, events, malformed, malformedTail, unknownKinds, readError: null, truncated };
}

/**
 * Fold the events into one row per session, most recently seen first.
 *
 * Two decisions worth knowing before changing this. The clock is passed in rather than read, so the
 * whole thing is testable and a payload is reproducible from its own timestamp. And an event dated in
 * the future is clamped to now instead of producing a negative idle time: clock skew between a hook
 * and a reader is real, and a row reading "idle for -12 seconds" discredits the surface faster than
 * being a few seconds wrong ever would.
 */
export function summarizeSessions(log: SessionLog, nowIso: string, cwdFilter?: string): SessionRow[] {
  const now = Date.parse(nowIso);
  const rows = new Map<string, SessionRow>();
  const pathSeen = new Map<string, Set<string>>();
  const stoppedAt = new Map<string, string>();
  // Both sides through resolve, because the emitter writes an absolute path and a host may have
  // started PANTRY with a trailing slash or a ".." segment. A string compare there finds the log and
  // then filters every row out of it, which renders as a calm empty page over a full file.
  const want = cwdFilter ? resolve(cwdFilter) : null;

  for (const e of log.events) {
    if (want && resolve(e.cwd) !== want) continue;
    // A clock a minute out is a clock. A row dated next century pins itself alive forever, because
    // every window here is measured from a timestamp that never falls behind now.
    const at = Date.parse(e.at);
    if (at > now + FUTURE_TOLERANCE_MS) {
      const known = rows.get(e.session);
      if (known) known.skewedEvents++;
      continue;
    }

    let row = rows.get(e.session);
    if (!row) {
      row = {
        id: e.session,
        repo: basename(e.cwd),
        cwd: e.cwd,
        parent: e.parent ?? null,
        state: "ended",
        firstSeenAt: e.at,
        lastSeenAt: e.at,
        idleSeconds: 0,
        stopped: false,
        skewedEvents: 0,
        toolEvents: 0,
        lastTool: null,
        paths: [],
        pathsOmitted: 0,
      };
      rows.set(e.session, row);
      pathSeen.set(e.session, new Set());
    }
    // A parent arrives on the start event and nowhere else, so a row that met a tool event first
    // still learns its lineage when the start line turns up later in a re-ordered log.
    if (e.parent && !row.parent) row.parent = e.parent;
    if (Date.parse(e.at) < Date.parse(row.firstSeenAt)) row.firstSeenAt = e.at;
    if (Date.parse(e.at) > Date.parse(row.lastSeenAt)) row.lastSeenAt = e.at;
    if (e.kind === "stop") stoppedAt.set(e.session, e.at);
    if (e.kind === "tool") {
      row.toolEvents++;
      if (e.tool) row.lastTool = e.tool;
      if (e.path) {
        const seen = pathSeen.get(e.session)!;
        if (!seen.has(e.path)) {
          seen.add(e.path);
          if (row.paths.length < MAX_PATHS_PER_SESSION) row.paths.push(e.path);
          else row.pathsOmitted++;
        }
      }
    }
  }

  for (const row of rows.values()) {
    // A stop only ends a session when nothing happened after it. The harness closes and reopens a
    // session often enough that a stop treated as final made live rows read as ended.
    const stop = stoppedAt.get(row.id);
    row.stopped = stop !== undefined && Date.parse(stop) >= Date.parse(row.lastSeenAt);
    const since = Math.max(0, now - Date.parse(row.lastSeenAt));
    row.idleSeconds = Math.round(since / 1000);
    row.state = row.stopped || since > ENDED_WINDOW_MS ? "ended" : since <= ALIVE_WINDOW_MS ? "alive" : "idle";
  }

  return [...rows.values()].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}

/**
 * The machine twin behind /sessions.json. Scoped to the host's own cwd: the log is per project
 * already, and a session that ran here under a different path is a different project wearing the
 * same folder name.
 */
export async function buildSessionsPayload(config: ResolvedPantryConfig, nowIso: string): Promise<SessionsPayload> {
  const logPath = config.sessionsLog;
  const log = await readSessionLog(logPath);
  return {
    generated: nowIso,
    project: config.projectName,
    logPath,
    present: existsSync(logPath),
    sessions: summarizeSessions(log, nowIso, config.cwd),
    malformed: log.malformed,
    readError: log.readError,
    truncated: log.truncated,
  };
}

/** Absolute-ise a host-supplied path the same way config.ts does, exported so the CLI and the tests
 *  do not each grow their own copy. */
export const resolveSessionsLog = (cwd: string, given?: string): string =>
  given ? (isAbsolute(given) ? given : join(cwd, given)) : defaultSessionsLog(cwd);
