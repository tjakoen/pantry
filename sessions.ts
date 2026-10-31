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
// somebody else's schedule. The heartbeat below is a schema we own and its failure mode is an empty
// list. If transcript parsing ever lands it enriches a row that already renders without it.
//
// IT IS NOT "A FEW HUNDRED BYTES A SESSION", which is what this file used to claim and what nobody
// had checked. Replaying eight real transcripts from this estate through the emitter's own rules
// gives a mean of 275 lines and 56 KiB per session, and 120 KiB for the heaviest of them. The claim
// was wrong by roughly two orders of magnitude, in the safe direction for correctness and the
// expensive direction for the cap below.
//
// **What a row may honestly claim.** Alive, idle, or ended, from timestamps and a stop event. Not
// what the model is thinking: nothing here observes that, and a surface that animates a thought it
// cannot see is a lie with a spinner on it.
import { existsSync } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { loadPlans } from "@tjakoen/proof/loader.ts";
import type { PlanOwner, PlanStatus } from "@tjakoen/proof/core/types.ts";
import { harnessConfigDir, harnessProjectDir } from "./context.ts";
import { buildDecisionsPayload } from "./decisions.ts";
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
 *  tail is read and the payload says so.
 *
 *  MEASURED, and the number is smaller than it looks. At the 56 KiB a real session turns out to
 *  cost, this cap holds about seventy of them. The busiest repo in this estate started 146 sessions
 *  in a month, so the log crosses four mebibytes in roughly a fortnight and nothing rotates it. The
 *  truncated flag is therefore the NORMAL state of an active repo rather than a theoretical
 *  safeguard, which is the argument for the payload admitting to it on the page. */
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
export { harnessConfigDir } from "./context.ts";

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

// ── C1: the join, the lamps, and the payload behind /control ─────────────────────────────────────
//
// C0 above answers "which sessions have been here". C1 answers the question a person actually has,
// which is where the project is: every plan with an open step, the sessions attached to each, what
// is waiting on a human, and whether the loop ran at all. The control center is a projection of the
// PLAN with sessions as an attribute of a row. It is deliberately not a list of sessions: a list of
// sessions is a monitor, it duplicates the editor, and it goes stale the moment nobody watches it.
//
// Everything here is a read, and it reads the same files every other surface reads, which is what
// makes the page replayable for a session that ended last week rather than a live view nobody is
// sitting in front of.

/** How many open steps a plan row shows before it says how many it left out. A plan with forty open
 *  boxes is a plan nobody is reading on this page, and a wall of them buries the row that matters. */
export const MAX_OPEN_TASKS_SHOWN = 8;

/**
 * Does a file this session wrote fall under one of a plan's declared areas?
 *
 * The plan frontmatter carries `touches`, a list of paths relative to the repo root, and a session
 * row carries the absolute files it was seen writing. That overlap is the whole join, and it is
 * honest precisely because it is narrow: it attaches a session to a plan on evidence rather than on
 * a name that happens to match.
 *
 * THERE IS NO GLOB ENGINE HERE, on purpose. A trailing star is stripped and treated as the directory
 * it sits in, and anything with a star in the middle, such as a doubled star between two segments,
 * will simply not match. Bringing in a matcher would mean the page could claim to know every file a
 * plan covers, and it cannot: the emitter only records write-shaped tools, and its path list is
 * capped. So the page says the attachment list is evidence of work, never an inventory of it.
 */
export function planTouchesPath(touches: string[], repoRoot: string, absPath: string): boolean {
  const target = resolve(absPath);
  for (const entry of touches) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().replace(/\/?\*+$/, "");
    if (!trimmed) continue;
    const area = resolve(repoRoot, trimmed);
    // The separator matters. Without it a plan touching "src" claims every file under "src2",
    // which is the kind of wrong that nobody notices because the row still looks plausible.
    if (target === area || target.startsWith(area + sep)) return true;
  }
  return false;
}

export type LampState = "lit" | "dark" | "unobserved";

export interface LoopLamp {
  id: string;
  label: string;
  state: LampState;
  /** One sentence, and it is required for every state including the lit one. An unobserved lamp has
   *  to say what WOULD observe it, otherwise it reads as a mechanism that failed rather than as one
   *  nothing is watching. */
  detail: string;
  /** True when the evidence is repo-level rather than per-session, so a concurrent session in the
   *  same tree could have caused it. The page must not present a shared lamp as proof. */
  shared: boolean;
  observedAt: string | null;
}

/**
 * What a lamp is allowed to look at. Either a file under the harness config dir whose NAME carries
 * the session id, which is per-session evidence and the only kind worth the word "lit", or a file in
 * the repo whose modification time falls inside the session's window, which is weaker and says so.
 */
export interface LampProbe {
  id: string;
  label: string;
  /** relative to the harness config dir, containing the literal token {session} */
  session?: string;
  /** relative to the repo root */
  repo?: string;
  /** what this lamp can honestly claim, carried into the detail so the page never has to invent it */
  note: string;
}

/**
 * The probe list, written out in full so a reader sees the whole truth in one place rather than
 * discovering it a lamp at a time.
 *
 * THREE OF THE FOUR LAMPS THE PLAN NAMES CANNOT HONESTLY LIGHT TODAY, and that is recorded here
 * rather than papered over. The session-start doctor prints into the transcript and writes nothing
 * to disk, so nothing can observe whether it ran. The review gate and the handoff nudge share one
 * marker file, so from disk alone they are one fact wearing two names, and both details say so
 * instead of the page showing two independent lamps. Only the context trigger writes a file keyed by
 * the session id, which makes it the one lamp on this machine that means what the word says.
 *
 * On a machine carrying none of this tooling every probe file is simply absent, so every lamp reads
 * unobserved. That is the correct degrade for a package that ships into other people's projects: an
 * unobserved lamp is a statement about the observer, and a dark one is a statement about the run.
 */
export const LOOP_LAMPS: LampProbe[] = [
  {
    id: "doctor",
    label: "doctor at session start",
    note: "The session-start doctor prints its report into the transcript and leaves nothing on disk, so nothing here can observe whether it ran. Read the top of the session to see it.",
  },
  {
    id: "graphify",
    label: "code graph rebuilt",
    repo: "graphify-out",
    note: "The graph output directory is shared by every session in this tree, so a rebuild seen inside this session's window may belong to a session running beside it.",
  },
  {
    id: "gate",
    label: "review gate",
    repo: join(".git", "handoff-nudged"),
    note: "The gate and the handoff nudge share one marker file in the git directory, so from disk alone they are a single fact. The marker also does not exist until the gate has fired here at least once.",
  },
  {
    id: "handoff",
    label: "handoff written",
    repo: join(".git", "handoff-nudged"),
    note: "This reads the same marker the review gate reads, because the gate is what writes it. A lit lamp here means the gate noticed something closed, not that a handoff was actually written.",
  },
  {
    id: "context-trigger",
    label: "context budget trigger",
    session: join("state", "ctx-{session}"),
    note: "The trigger writes a file named for the session, which is the one piece of per-session evidence on disk.",
  },
];

/**
 * Light the lamps for one session.
 *
 * THE LAMPS STAT, THEY NEVER READ. Existence and a modification time is the whole of what is taken
 * from a probe file, and that is a privacy posture rather than an optimisation: these files belong
 * to the harness and to other sessions, they are outside the repo being served, and a surface that
 * opened them would be reading work nobody offered it.
 *
 * Any probe that cannot be checked, for a missing file or a refused permission or anything else,
 * degrades to unobserved with the reason in its detail. One unreadable file costs one lamp and never
 * the page.
 */
export async function readLoopLamps(
  repoRoot: string,
  session: SessionRow | null,
  configDir: string = harnessConfigDir(),
): Promise<LoopLamp[]> {
  // The window is the session's own span, opened a little at both ends. A hook fires either side of
  // the tool call that provoked it, and the emitter throttles the quiet events, so an exact-bounds
  // test would leave the truest lamp on the page dark for a timing difference of seconds.
  const from = session ? Date.parse(session.firstSeenAt) - ALIVE_WINDOW_MS : 0;
  const to = session ? Date.parse(session.lastSeenAt) + ALIVE_WINDOW_MS : 0;

  return Promise.all(LOOP_LAMPS.map(async (probe): Promise<LoopLamp> => {
    const lamp: LoopLamp = {
      id: probe.id, label: probe.label, state: "unobserved",
      detail: probe.note, shared: probe.repo !== undefined, observedAt: null,
    };

    if (!session) {
      lamp.detail = `No session is selected, so nothing here describes a run. ${probe.note}`;
      return lamp;
    }
    if (!probe.session && !probe.repo) return lamp;

    const target = probe.session
      ? join(configDir, probe.session.replace("{session}", session.id))
      : join(repoRoot, probe.repo!);

    let mtime: Date;
    try {
      mtime = (await stat(target)).mtime;
    } catch (err) {
      const why = err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT"
        ? `Nothing has written ${target}.`
        : `${target} could not be checked: ${err instanceof Error ? err.message : String(err)}.`;
      lamp.detail = `${why} ${probe.note}`;
      return lamp;
    }

    lamp.observedAt = mtime.toISOString();
    const at = mtime.getTime();
    if (at >= from && at <= to) {
      lamp.state = "lit";
      return lamp;
    }
    lamp.state = "dark";
    lamp.detail = `Last touched ${lamp.observedAt}, which is outside this session's window, so it did not run here. ${probe.note}`;
    return lamp;
  }));
}

export interface ControlPlanRow {
  id: string;
  title: string;
  status: PlanStatus;
  track: string | null;
  owner: PlanOwner;
  /** the unticked step texts, capped */
  openTasks: string[];
  openTasksOmitted: number;
  openCount: number;
  doneCount: number;
  touches: string[];
  /** session ids attached by the path join, most recently seen first */
  sessions: string[];
}

export interface ControlWaiting {
  kind: "decision" | "blocked-plan";
  id: string;
  title: string;
  detail: string;
  href: string | null;
}

export interface ControlPayload {
  generated: string;
  project: string;
  /** False when NOTHING has observed this repo: there is no session log at all. The page says this
   *  out loud rather than rendering a calm empty board, which is the silent degrade the doctor row
   *  exists to catch. */
  present: boolean;
  logPath: string;
  /** C0's payload, reused whole, so the page and the machine twin cannot disagree about a session */
  sessions: SessionsPayload;
  /** the session the lamps describe, named on the page so a reader knows whose run they are reading */
  lampSession: string | null;
  lamps: LoopLamp[];
  plans: ControlPlanRow[];
  /** sessions still alive or idle here that attached to no plan at all */
  unattached: SessionRow[];
  waiting: ControlWaiting[];
  /** Set when the plans directory could not be read, so a page never renders zero plans as if the
   *  project had none. An empty board and an unreadable one are different claims. */
  planError: string | null;
}

/** Left to right on the board, so the row a person needs first is the row they meet first. */
const STATUS_ORDER: Record<string, number> = { doing: 0, blocked: 1, todo: 2, done: 3 };

/**
 * The control centre payload. Everything it knows comes from files already on disk, which is what
 * lets it replay a session that ended last Tuesday rather than only describing the one in front of
 * you. C2 puts a tail on this same renderer; nothing here assumes a live transport exists.
 */
export async function buildControlPayload(
  config: ResolvedPantryConfig,
  nowIso: string,
  opts: { session?: string } = {},
): Promise<ControlPayload> {
  const sessions = await buildSessionsPayload(config, nowIso);
  const repoRoot = config.cwd;

  // The requested session, then the most recent one. A request that names a session this log has
  // never seen must not silently become "the latest": the whole point of the parameter is replay,
  // and quietly answering about a different run is worse than answering about none.
  const asked = opts.session ? sessions.sessions.find((s) => s.id === opts.session) ?? null : null;
  const missed = opts.session !== undefined && asked === null;
  const lampRow = asked ?? sessions.sessions[0] ?? null;
  const lamps = await readLoopLamps(repoRoot, lampRow);
  if (missed) {
    const instead = lampRow ? lampRow.id : "no session at all";
    for (const l of lamps) l.detail = `This log has no session ${opts.session}, so these lamps describe ${instead}. ${l.detail}`;
  }

  let planError: string | null = null;
  const planRows: ControlPlanRow[] = [];
  try {
    if (!existsSync(config.plansDir)) {
      planError = `No plans directory at ${config.plansDir}, so this page cannot say what the project set out to do.`;
    } else {
      // The age of a plan is not shown here, and PROOF's default reads it by spawning git once per
      // file. Passing a lastModified that answers null keeps a page load off the process table.
      const loaded = await loadPlans(config.plansDir, async () => null);
      for (const { plan } of loaded.plans) {
        const openTasks = plan.tasks.filter((t) => !t.done);
        if (openTasks.length === 0) continue;
        const attached = sessions.sessions
          .filter((row) => row.paths.some((p) => planTouchesPath(plan.touches, repoRoot, p)))
          .map((row) => row.id);
        planRows.push({
          id: plan.id,
          title: plan.title,
          status: plan.status,
          track: plan.track,
          owner: plan.owner,
          openTasks: openTasks.slice(0, MAX_OPEN_TASKS_SHOWN).map((t) => t.text),
          openTasksOmitted: Math.max(0, openTasks.length - MAX_OPEN_TASKS_SHOWN),
          openCount: openTasks.length,
          doneCount: plan.tasks.length - openTasks.length,
          touches: plan.touches,
          sessions: attached,
        });
      }
    }
  } catch (err) {
    planError = `The plans directory at ${config.plansDir} could not be read: ${err instanceof Error ? err.message : String(err)}.`;
  }

  planRows.sort((a, b) => {
    if ((a.sessions.length > 0) !== (b.sessions.length > 0)) return a.sessions.length > 0 ? -1 : 1;
    const byStatus = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    return byStatus !== 0 ? byStatus : a.id.localeCompare(b.id);
  });

  const attachedIds = new Set(planRows.flatMap((p) => p.sessions));
  const unattached = sessions.sessions.filter((s) => s.state !== "ended" && !attachedIds.has(s.id));

  const waiting: ControlWaiting[] = [];
  try {
    const decisions = await buildDecisionsPayload(config, nowIso);
    for (const d of decisions.decisions) {
      if (d.status !== "open") continue;
      waiting.push({
        kind: "decision",
        id: d.id,
        title: d.title,
        detail: d.unblocks ? d.unblocks : "Waiting on an answer.",
        href: `/decisions/${encodeURIComponent(d.id)}`,
      });
    }
  } catch (err) {
    // Reported rather than swallowed. A decision inbox that cannot be read is exactly the state
    // where the page would otherwise say nothing is waiting on you, which is the worst thing it
    // could say wrongly.
    waiting.push({
      kind: "decision",
      id: "decisions-unreadable",
      title: "The decision inbox could not be read",
      detail: `${err instanceof Error ? err.message : String(err)}. Anything waiting on you is not listed below.`,
      href: null,
    });
  }
  for (const plan of planRows) {
    if (plan.status !== "blocked") continue;
    waiting.push({
      kind: "blocked-plan",
      id: plan.id,
      title: plan.title,
      detail: `Blocked with ${plan.openCount} step(s) still open.`,
      href: `/plans/${encodeURIComponent(plan.id)}`,
    });
  }

  return {
    generated: nowIso,
    project: config.projectName,
    present: sessions.present,
    logPath: sessions.logPath,
    sessions,
    lampSession: lampRow ? lampRow.id : null,
    lamps,
    plans: planRows,
    unattached,
    waiting,
    planError,
  };
}
