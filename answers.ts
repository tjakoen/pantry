// pantry/answers.ts — the ONE channel an answer comes back on (standards/DECISIONS.md §4), and the
// only thing in PANTRY that writes.
//
// The contract this satisfies, restated because the whole module exists to hold it:
//   - **One channel, append only.** A card, a form and a paste all land in the same log, so the next
//     thing to run reads one path and not three.
//   - **The answer carries its own question.** The session that reads an entry is rarely the one that
//     asked, so the question, the options and what it unblocks are written INTO the entry rather than
//     left as a reference to a file that may since have been rewritten. This is enforced here, not
//     asked for politely: an entry with no question is refused.
//   - **The wait is an optimization; the read on wake is the contract.** Both live on this file — a
//     session that survives polls it (`pantry answers wait`), a session that does not reads it at
//     start (`pantry answers`). Neither needs the other to have happened.
//
// The format is JSONL: one entry per line, appended, never rewritten. That choice is against this
// estate's habit of markdown everywhere, and it is deliberate. An append-only log has two properties
// markdown cannot give it cheaply: a partial write can only ever corrupt the last line, and two
// writers appending at once cannot interleave into a single malformed record. A human still reads it
// (PANTRY renders it at /answers, and `pantry answers` prints it), so the cost is paid by nobody.
//
// PANTRY's read-only promise survives intact. It may append HERE and nowhere else: the path comes
// from config, never from a request, and a path that looks like plan corpus is refused outright.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync, lstatSync } from "node:fs";

/** Which surface an answer came from. Not a behaviour switch — it is provenance, so a reader can
 *  tell an answer given while looking at the change from one typed into a chat window. */
export type AnswerSource = "decision" | "tour" | "chat" | "cli";

export const ANSWER_SOURCES: readonly AnswerSource[] = ["decision", "tour", "chat", "cli"];

/** Caps, so a write-back reachable from a page cannot fill a disk. Generous enough that no honest
 *  answer hits them, small enough that a runaway one is a rejection rather than a file. */
export const MAX_FIELD_CHARS = 4_000;
export const MAX_COMPOSED_CHARS = 20_000;
export const MAX_OPTIONS = 20;
/** The biggest POST body the write-back reads. An answer is text a person typed. */
export const MAX_ANSWER_BODY_BYTES = 64 * 1024;

/** The question an answer is answering, copied into the answer rather than pointed at. */
export interface AnswerRequest {
  source: AnswerSource;
  /** the decision id, the tour id, or a label the asker chose — what a `wait` matches on */
  ref: string;
  /** the decision-request file, when the question came from one; absent for a tour card */
  file?: string;
  /** stated so it can be answered without reading the code (DECISIONS §3) */
  question: string;
  /** the closed set that was offered, when there was one */
  options?: string[];
  /** what the asker recommended, verbatim */
  recommendation?: string;
  /** what changes once this is answered — DECISIONS §3's fourth item, the one most often left out */
  unblocks?: string;
}

export interface AnswerEntry {
  kind: "answer";
  id: string;
  at: string;
  /** the surface that wrote it, for debugging a write path rather than for judging an answer */
  via: string;
  request: AnswerRequest;
  /** the option picked, or whatever was typed into the escape */
  choice: string;
  notes?: string;
  /** the text the card composed, when the answer came from one — kept so a paste-back and a recorded
   *  answer are the same words, not two paraphrases of one decision */
  composed?: string;
}

/** A session saying it has acted on an answer. An ack is an ENTRY, not a mutation: append-only holds,
 *  and "which answers are still unread" stays derivable from the file alone. */
export interface AckEntry {
  kind: "ack";
  id: string;
  at: string;
  /** the AnswerEntry id this acknowledges */
  for: string;
  /** who acted — a run id, a session name, anything a later reader can place */
  by?: string;
  note?: string;
}

export type LogEntry = AnswerEntry | AckEntry;

export interface AnswerLog {
  /** the log file, absolute; it may not exist yet, which is the healthy empty state */
  path: string;
  entries: LogEntry[];
  /** lines that would not parse. Counted rather than thrown: one bad line must never cost the rest,
   *  and a silent skip would make a lost answer indistinguishable from an answer never given. */
  malformed: number;
}

/** What a caller hands `appendAnswer`. Everything a reader needs is required; everything else is not. */
export interface AnswerInput {
  request: AnswerRequest;
  choice: string;
  notes?: string;
  composed?: string;
  via?: string;
}

export class AnswerRejected extends Error {}

const trimmed = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function requireField(value: string, field: string, cap = MAX_FIELD_CHARS): string {
  if (!value) throw new AnswerRejected(`${field} is required`);
  if (value.length > cap) throw new AnswerRejected(`${field} is over the ${cap} character cap`);
  return value;
}

function optionalField(value: string, field: string, cap = MAX_FIELD_CHARS): string | undefined {
  if (!value) return undefined;
  if (value.length > cap) throw new AnswerRejected(`${field} is over the ${cap} character cap`);
  return value;
}

/**
 * Validate and normalize one answer before it is written.
 *
 * This is where "the answer carries its own question" stops being a rule in a document. A caller that
 * sends only a choice is refused, because the entry it would have written is the exact thing
 * DECISIONS §4 calls unactionable: a decision with nothing to place it against.
 *
 * An answer needs a choice OR notes, not both. "None of these, here is why" is a real answer and the
 * one a decision card exists to catch; refusing it would push the reviewer into picking an option
 * they do not mean.
 */
export function normalizeAnswer(input: unknown): AnswerInput {
  if (!input || typeof input !== "object") throw new AnswerRejected("expected a JSON object");
  const raw = input as Record<string, unknown>;
  const req = (raw.request && typeof raw.request === "object" ? raw.request : {}) as Record<string, unknown>;

  const source = trimmed(req.source) as AnswerSource;
  if (!ANSWER_SOURCES.includes(source)) {
    throw new AnswerRejected(`request.source must be one of ${ANSWER_SOURCES.join(", ")}`);
  }

  // Capped per ELEMENT, not just in count. The first version capped how MANY options there could be
  // and said nothing about how long each one was, so a single 60,000-character option sailed past
  // while the identical string in `notes` was refused. A cap that one field escapes is not a cap.
  const options = Array.isArray(req.options)
    ? req.options.map((o) => trimmed(o)).filter(Boolean).slice(0, MAX_OPTIONS)
      .map((o, i) => requireField(o, `request.options[${i}]`))
    : [];

  const choice = trimmed(raw.choice);
  const notes = optionalField(trimmed(raw.notes), "notes");
  if (!choice && !notes) throw new AnswerRejected("an answer needs a choice or notes");

  const request: AnswerRequest = {
    source,
    ref: requireField(trimmed(req.ref), "request.ref", 200),
    question: requireField(trimmed(req.question), "request.question"),
  };
  const file = optionalField(trimmed(req.file), "request.file", 1_000);
  if (file) request.file = file;
  if (options.length) request.options = options;
  const recommendation = optionalField(trimmed(req.recommendation), "request.recommendation");
  if (recommendation) request.recommendation = recommendation;
  const unblocks = optionalField(trimmed(req.unblocks), "request.unblocks");
  if (unblocks) request.unblocks = unblocks;

  const out: AnswerInput = { request, choice: optionalField(choice, "choice") ?? "" };
  if (notes) out.notes = notes;
  const composed = optionalField(trimmed(raw.composed), "composed", MAX_COMPOSED_CHARS);
  if (composed) out.composed = composed;
  const via = optionalField(trimmed(raw.via), "via", 200);
  if (via) out.via = via;
  return out;
}

// The write-back accepts a POST from a page, which is a bigger door than any other PANTRY route has,
// so what bounds it is stated here rather than assumed from "it is only localhost". Loopback is
// checked on the SOCKET, not on a header: Origin, Referer and X-Forwarded-For are all things a
// request can simply claim, and the whole point of this check is to believe none of them. IPv4-mapped
// IPv6 (`::ffff:127.0.0.1`) is the shape Bun reports on a dual-stack listener and is the same machine.
const LOOPBACK_ADDRESS = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

/**
 * Is this request from this machine?
 *
 * A missing address is NOT treated as local. That case is a caller with no way to tell, and defaulting
 * an unanswerable security question to "yes" is how a dev-only door ends up open in the one deployment
 * nobody modelled. A test that wants the write-back has to say which address it came from, which is
 * the right amount of friction.
 */
export function isLoopbackRequest(address: string | null | undefined): boolean {
  return !!address && LOOPBACK_ADDRESS.test(address);
}

/** A sortable, collision-resistant id. The timestamp half is for a human scanning the file; the
 *  random half is because two surfaces can write in the same second. */
export function makeEntryId(prefix: "a" | "k", now: Date, rand = randomTag()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${prefix}-${stamp}-${rand}`;
}

function randomTag(): string {
  // crypto.randomUUID is available in Bun and in any browser on localhost; the fallback exists so a
  // test or an odd runtime never turns id generation into the reason a write fails.
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  }
}

/** The only shapes this log may take. An ALLOWLIST, not a denylist, and that is the whole lesson of
 *  the first version: it refused markdown and let `.ts`, `.json` and `.env` straight through, so a
 *  mistyped config key would have appended JSONL into a source file. "Everything except the corpus"
 *  is not a list anyone can finish writing; "these two extensions" is. */
const WRITABLE_LOG_EXTENSIONS = /\.(jsonl|ndjson)$/i;

/**
 * Refuse a log path that is anything but a log.
 *
 * PANTRY's read-only promise is what makes every other surface safe to point at a real repo, and the
 * one exception carved for this log is exactly the kind of exception that widens. So the boundary is
 * mechanical rather than remembered, and it is drawn twice, because a path is two different things:
 *
 *   - **The NAME must be one this module writes.** An allowlist, so a config that names a plan, a
 *     source file, a dotfile or an extensionless path is refused rather than appended to. It also
 *     disposes of the trailing-dot case (`PLAN.md.`), which a markdown denylist missed and which
 *     resolves back to the markdown file on a filesystem that strips the dot.
 *   - **The FILE must not be a door to somewhere else.** The name check is a string check, and a
 *     symlink is precisely the thing that makes a string check wrong: `answers.jsonl` pointing at
 *     `PLAN.md` passes every name rule while the bytes land in the plan. Appending follows symlinks
 *     by default, so the link is refused before the append rather than reasoned about after it.
 *
 * The symlink check is a check and not a guarantee: something could swap the file between this call
 * and the write. That race needs an O_NOFOLLOW open to close properly, and on loopback dev tooling
 * the check is worth having and the race is not worth the complexity. Said plainly here rather than
 * left for someone to discover the limit on their own.
 */
export function assertWritableLogPath(path: string): void {
  if (!WRITABLE_LOG_EXTENSIONS.test(path)) {
    throw new AnswerRejected(`answersLog must end in .jsonl or .ndjson (got ${path}) — PANTRY writes nothing else`);
  }
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new AnswerRejected(`answersLog is a symlink (${path}) — PANTRY will not write through one`);
    }
  } catch (err) {
    if (err instanceof AnswerRejected) throw err;
    // ENOENT is the first-write case and the healthy one: there is no link because there is no file.
  }
}

/**
 * Append one answer. Creates the containing directory if it is missing, because the default sits
 * beside the decision requests and a repo with no open decisions yet has no such folder.
 *
 * Appending a whole line in one call is what keeps two concurrent writers from interleaving: the
 * write is a single append of a single record, so the worst case is ordering, never a torn entry.
 */
export async function appendAnswer(logPath: string, input: AnswerInput, now: Date): Promise<AnswerEntry> {
  assertWritableLogPath(logPath);
  const entry: AnswerEntry = {
    kind: "answer",
    id: makeEntryId("a", now),
    at: now.toISOString(),
    via: input.via ?? "unknown",
    request: input.request,
    choice: input.choice,
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.composed ? { composed: input.composed } : {}),
  };
  await writeLine(logPath, entry);
  return entry;
}

/** Append an ack: a session recording that it has acted on an answer. */
export async function appendAck(
  logPath: string,
  ack: { for: string; by?: string; note?: string },
  now: Date,
): Promise<AckEntry> {
  assertWritableLogPath(logPath);
  const forId = requireField(trimmed(ack.for), "for", 200);
  const entry: AckEntry = {
    kind: "ack",
    id: makeEntryId("k", now),
    at: now.toISOString(),
    for: forId,
    ...(ack.by ? { by: trimmed(ack.by).slice(0, 200) } : {}),
    ...(ack.note ? { note: trimmed(ack.note).slice(0, MAX_FIELD_CHARS) } : {}),
  };
  await writeLine(logPath, entry);
  return entry;
}

async function writeLine(logPath: string, entry: LogEntry): Promise<void> {
  const dir = dirname(logPath);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

/**
 * Read the whole log. An absent file is the empty state, not an error — a repo that has never been
 * asked anything is the healthy case and must not read as a broken one.
 */
export async function readAnswerLog(logPath: string): Promise<AnswerLog> {
  if (!existsSync(logPath)) return { path: logPath, entries: [], malformed: 0 };
  let text: string;
  try {
    text = await readFile(logPath, "utf8");
  } catch {
    return { path: logPath, entries: [], malformed: 0 };
  }
  const entries: LogEntry[] = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as LogEntry;
      if (parsed && (parsed.kind === "answer" || parsed.kind === "ack") && typeof parsed.id === "string") {
        entries.push(parsed);
      } else {
        malformed++;
      }
    } catch {
      malformed++;
    }
  }
  return { path: logPath, entries, malformed };
}

export const isAnswer = (e: LogEntry): e is AnswerEntry => e.kind === "answer";
export const isAck = (e: LogEntry): e is AckEntry => e.kind === "ack";

/** Every answer, newest first. */
export function answers(log: AnswerLog): AnswerEntry[] {
  return log.entries.filter(isAnswer).toReversed();
}

/**
 * Answers no session has acked. This is what "read on wake" actually reads: not the whole log, which
 * grows forever, but the tail nobody has acted on. Deriving it from acks rather than tracking it
 * separately is what keeps a second place from disagreeing with the first.
 */
export function unacked(log: AnswerLog): AnswerEntry[] {
  const acked = new Set(log.entries.filter(isAck).map((a) => a.for));
  return answers(log).filter((a) => !acked.has(a.id));
}

/** Answers to one question, oldest first — a reviewer may answer twice, and the later one wins. */
export function answersFor(log: AnswerLog, ref: string): AnswerEntry[] {
  return log.entries.filter(isAnswer).filter((a) => a.request.ref === ref);
}

/**
 * Wait for an unacked answer to `ref`.
 *
 * The polling is the honest shape here, and worth naming rather than apologizing for: nothing
 * interrupts a run when a file changes (DECISIONS §4), so a session that raised a question and did
 * not block simply carries on and the answer sits unread. This is the block. It returns null on
 * timeout rather than throwing, because a run that waited and got nothing should say so in its report
 * and continue, not crash.
 *
 * **What counts as "the answer" is unacked, not newer-than-now, and the first version had that
 * wrong.** Matching on a timestamp taken when the wait began meant an answer given in the seconds
 * between raising the question and getting around to waiting was invisible: the command blocked for
 * its full timeout and reported nothing, while the list command showed the answer sitting unread two
 * lines up. Acks are already the record of what has been consumed, so they are what this reads too,
 * and a stale answer is one somebody acked rather than one that arrived early. `after` survives as an
 * option for a caller that genuinely wants a fresh answer and not merely an unconsumed one.
 */
export async function waitForAnswer(
  logPath: string,
  ref: string,
  opts: { timeoutMs?: number; pollMs?: number; after?: Date; now?: () => number } = {},
): Promise<AnswerEntry | null> {
  // Every bound is finite-checked. A NaN timeout made the loop's deadline comparison false forever
  // and Bun.sleep(NaN) return immediately, which is a hot spin that never ends and never errors.
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(0, opts.timeoutMs!) : 15 * 60_000;
  const pollMs = Number.isFinite(opts.pollMs) ? Math.max(1, opts.pollMs!) : 2_000;
  const after = opts.after?.getTime();
  const clock = opts.now ?? Date.now;
  const deadline = clock() + timeoutMs;
  for (;;) {
    const log = await readAnswerLog(logPath);
    const acked = new Set(log.entries.filter(isAck).map((a) => a.for));
    const hit = answersFor(log, ref).find((a) =>
      !acked.has(a.id) && (after === undefined || Date.parse(a.at) >= after));
    if (hit) return hit;
    if (clock() >= deadline) return null;
    await Bun.sleep(Math.min(pollMs, Math.max(1, deadline - clock())));
  }
}

/** One entry as a human line, for the CLI and for a handoff that has to quote one. */
export function formatAnswer(a: AnswerEntry, opts: { acked?: boolean } = {}): string {
  const head = `${a.id}  ${a.at}  [${a.request.source}] ${a.request.ref}${opts.acked ? "" : "  ← unread"}`;
  const lines = [head, `  Q: ${a.request.question}`];
  if (a.request.unblocks) lines.push(`  unblocks: ${a.request.unblocks}`);
  if (a.choice) lines.push(`  A: ${a.choice}`);
  if (a.notes) lines.push(`  notes: ${a.notes}`);
  return lines.join("\n");
}

/** The CLI's whole report: what is unread first, because that is the only part that needs doing. */
export function formatAnswerLog(log: AnswerLog): string {
  if (log.entries.length === 0) {
    return `No answers recorded yet.\n  log: ${log.path}\nA run raises a question on a decision request or a tour's decision card; the answer lands here.`;
  }
  const pending = unacked(log);
  const ackedSet = new Set(log.entries.filter(isAck).map((a) => a.for));
  const done = answers(log).filter((a) => ackedSet.has(a.id));
  const out: string[] = [`log: ${log.path}`];
  if (log.malformed) out.push(`${log.malformed} unparseable line(s) skipped.`);
  out.push("", pending.length ? `UNREAD (${pending.length}) — act on these, then \`pantry answers ack <id>\`` : "Nothing unread.");
  for (const a of pending) out.push("", formatAnswer(a));
  if (done.length) {
    out.push("", `Acted on (${done.length}):`);
    for (const a of done) out.push("", formatAnswer(a, { acked: true }));
  }
  return out.join("\n");
}
