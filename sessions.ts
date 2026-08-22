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
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
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
   *  last line is the normal state of a file something is appending to right now. */
  malformed: number;
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
  /** true when a stop event was seen, which is a different claim from "ended by the clock" */
  stopped: boolean;
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
}

/**
 * Where the events land when the host names nothing: beside the project's agent memory, under the
 * harness config dir. See the header for why this is outside the repo.
 */
export function defaultSessionsLog(cwd: string, configDir = join(homedir(), ".claude")): string {
  return join(harnessProjectDir(cwd, configDir), "sessions.jsonl");
}

const isKind = (v: unknown): v is SessionEventKind =>
  typeof v === "string" && (SESSION_EVENT_KINDS as readonly string[]).includes(v);

/** One line to an event, or null. Strict on the four fields a row is built from and tolerant of
 *  everything else, because the emitter may gain a field before this reader knows about it. */
export function parseSessionEvent(line: string): SessionEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
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

/**
 * Read the whole log. An absent file is the empty state and not an error, the same posture the answer
 * log takes: a repo nothing has observed yet is the healthy case, and the caller is told which of the
 * two it got through `present` rather than having to guess from a zero.
 */
export async function readSessionLog(logPath: string): Promise<SessionLog> {
  if (!existsSync(logPath)) return { path: logPath, events: [], malformed: 0 };
  let text: string;
  try {
    text = await readFile(logPath, "utf8");
  } catch {
    return { path: logPath, events: [], malformed: 0 };
  }
  const events: SessionEvent[] = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const event = parseSessionEvent(line);
    if (event) events.push(event);
    else malformed++;
  }
  return { path: logPath, events, malformed };
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

  for (const e of log.events) {
    if (cwdFilter && e.cwd !== cwdFilter) continue;
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
    if (e.kind === "stop") row.stopped = true;
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
  };
}

/** Absolute-ise a host-supplied path the same way config.ts does, exported so the CLI and the tests
 *  do not each grow their own copy. */
export const resolveSessionsLog = (cwd: string, given?: string): string =>
  given ? (isAbsolute(given) ? given : join(cwd, given)) : defaultSessionsLog(cwd);
