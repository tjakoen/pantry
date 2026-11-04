/**
 * The alignment brief (plans/pantry-brief.md): one account of where a project's AI work stands, read
 * by the owner as PANTRY's home page and by the agent at the start of pantry_orient. It answers five
 * questions in order: what is in flight, what was written outside the plan it was meant for, what is
 * waiting on the owner, what has drifted, and what comes next.
 *
 * Everything here is a read of files PANTRY already reads. The brief stores nothing and runs no
 * model. `assembleBrief` is pure so each rule can be tested against plain objects; `buildBrief` is
 * the loader that reads the disk and hands the result to it.
 *
 * Every row carries actions. An action is either a link to the page that settles it or a piece of
 * text to copy, usually a prompt written for the agent, because the owner's usual move on a
 * misaligned row is to tell the agent what to do about it.
 */
import { join } from "node:path";
import { homedir } from "node:os";
import type { ResolvedPantryConfig } from "./config.ts";
import { buildSessionsPayload, planTouchesPath, type SessionRow } from "./sessions.ts";
import { claimsFile, foldClaims, loadProjectWork, readClaims, readyPlans, ttlMs, type ClaimView, type DecisionLike, type PlanLike } from "./orchestrator.ts";
import { buildDecisionsPayload } from "./decisions.ts";
import { runDoctor, type DoctorCheck } from "./doctor.ts";
import { readAnswerLog, unacked, type AnswerEntry } from "./answers.ts";

/** Sessions that ended this recently still count, so unplanned work does not vanish on close. */
export const ENDED_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface BriefAction {
  label: string;
  kind: "link" | "copy";
  /** a URL for a link, the text to copy for a copy */
  value: string;
}

export interface BriefSession {
  id: string;
  state: SessionRow["state"];
  lastSeenAt: string;
  paths: string[];
  pathsOmitted: number;
  /** the last tool the session used, the nearest thing to "what it is doing now" */
  lastTool: string | null;
  idleSeconds: number;
}

export interface InFlightRow {
  /** null for the row that gathers sessions attached to no plan */
  planId: string | null;
  title: string;
  status: string | null;
  touches: string[];
  claim: { tool: string; sessionId: string; state: string; lastAt: string } | null;
  sessions: BriefSession[];
  /** written files that match the touches of no in-flight plan, repo-relative */
  outOfScope: string[];
  /** paths the session log dropped, so a short list never reads as a complete one */
  unrecorded: number;
  actions: BriefAction[];
}

export interface WaitingRow {
  kind: "decision" | "blocked-plan" | "human-plan";
  id: string;
  title: string;
  detail: string;
  actions: BriefAction[];
  /** for a decision: what the inline answer card needs to record an answer that carries its question */
  decision?: { options: string[]; recommendation: string | null; unblocks: string | null; file: string | null };
}

export interface DriftRow {
  id: string;
  severity: DoctorCheck["severity"];
  label: string;
  detail: string;
  actions: BriefAction[];
}

export interface QueueRow { id: string; title: string; touches: string[]; actions: BriefAction[] }

export interface NextRow {
  /** the first of `queue`, kept as its own field for readers of the first version */
  ready: QueueRow | null;
  /** every ready plan, in the order pantry_next offers them */
  queue: QueueRow[];
  skipped: { id: string; title: string; reasons: string[] }[];
}

/** An answer the owner recorded that no session has acted on yet. */
export interface AnsweredRow {
  id: string;
  at: string;
  ref: string;
  question: string;
  choice: string;
  notes: string | null;
  /** the plans an open decision with this id holds, so an agent on one of them knows it is for it */
  holds: string[];
  actions: BriefAction[];
}

export interface BriefPayload {
  generated: string;
  project: string;
  inFlight: InFlightRow[];
  waiting: WaitingRow[];
  drift: DriftRow[];
  next: NextRow;
  /** answers recorded and not yet acted on, oldest first: the agent's to pick up */
  answered: AnsweredRow[];
  /** one line each, said on the page instead of rendering a section as if it were calm */
  notes: string[];
}

export interface BriefInputs {
  now: string;
  project: string;
  repoRoot: string;
  plans: PlanLike[];
  decisions: (DecisionLike & { title?: string; unblocks?: string | null; options?: string[]; recommendation?: string | null; file?: string | null })[];
  /** null when the claims file could not be read, which the page says out loud */
  claims: Map<string, ClaimView> | null;
  sessions: SessionRow[];
  checks: DoctorCheck[] | null;
  /** unacked answers from the answer log, inbox merged */
  answers?: AnswerEntry[];
  notes?: string[];
}

const rel = (root: string, p: string) => (p.startsWith(root + "/") ? p.slice(root.length + 1) : p);
const short = (id: string) => id.slice(0, 8);

/** Tools a doctor detail may name as its fix. Anything else after "run" is prose ("close a run with a
 *  report"), and copying prose into a terminal is worse than offering nothing. */
const FIX_TOOLS = /^(?:pantry|bun|bunx|git|graphify|tokensave|docker|npm|deps:)/;

/** The fix a doctor row names, when its detail says "run X" or "(run: X)" and X starts with a tool. */
export function commandFromDetail(detail: string): string | null {
  for (const m of detail.matchAll(/\brun:?\s+`?([a-z][\w .:/@=-]*?[\w/])`?\s*(?:[),;]|$|\s—|\s-\s)/gi)) {
    if (FIX_TOOLS.test(m[1])) return m[1].trim();
  }
  return null;
}

export function assembleBrief(input: BriefInputs): BriefPayload {
  const nowMs = Date.parse(input.now);
  const notes = [...(input.notes ?? [])];
  const claims = input.claims ?? new Map<string, ClaimView>();
  if (!input.claims) notes.push("Claims not readable here, so in-flight work is read from plan status alone.");

  const live = input.sessions.filter((s) => s.state !== "ended" || nowMs - Date.parse(s.lastSeenAt) < ENDED_WINDOW_MS);
  const holds = (c: ClaimView | undefined) => !!c && (c.state === "active" || c.state === "done");
  const flying = input.plans
    .filter((p) => p.status === "doing" || holds(claims.get(p.id)))
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const inScopeOfAny = (abs: string) => flying.some((p) => planTouchesPath(p.touches, input.repoRoot, abs));

  const attached = new Set<string>();
  const inFlight: InFlightRow[] = flying.map((p) => {
    const mine = live.filter((s) => s.paths.some((abs) => planTouchesPath(p.touches, input.repoRoot, abs)));
    for (const s of mine) attached.add(s.id);
    const outOfScope = [...new Set(mine.flatMap((s) => s.paths).filter((abs) => !inScopeOfAny(abs)).map((abs) => rel(input.repoRoot, abs)))];
    const c = claims.get(p.id);
    const actions: BriefAction[] = [{ label: "Open plan", kind: "link", value: `/plan/${encodeURIComponent(p.id)}` }];
    if (outOfScope.length) {
      actions.push({
        label: "Copy realign prompt",
        kind: "copy",
        value: `You are working on plan ${p.id}. These files were written outside its touches list: ${outOfScope.join(", ")}. For each one, either revert it, or say why it belongs to this plan and add it to touches in ${p.file ? rel(input.repoRoot, p.file) : `plans/${p.id}.md`}. Do not continue other work until this is settled.`,
      });
    }
    if (!c && p.status === "doing") {
      actions.push({ label: "Copy claim prompt", kind: "copy", value: `Plan ${p.id} is marked doing but nobody holds a claim on it. If you are working it, call pantry_claim for ${p.id}; if not, set its status back to todo.` });
    }
    return {
      planId: p.id,
      title: p.title,
      status: p.status,
      touches: p.touches,
      claim: c ? { tool: c.tool, sessionId: short(c.sessionId), state: c.state, lastAt: c.lastAt } : null,
      sessions: mine.map(toBriefSession),
      outOfScope,
      unrecorded: mine.reduce((n, s) => n + s.pathsOmitted, 0),
      actions,
    };
  });

  const loose = live.filter((s) => !attached.has(s.id) && s.paths.length > 0);
  if (loose.length) {
    const files = [...new Set(loose.flatMap((s) => s.paths).map((abs) => rel(input.repoRoot, abs)))];
    inFlight.push({
      planId: null,
      title: "No plan",
      status: null,
      touches: [],
      claim: null,
      sessions: loose.map(toBriefSession),
      outOfScope: files,
      unrecorded: loose.reduce((n, s) => n + s.pathsOmitted, 0),
      actions: [{
        label: "Copy plan-it prompt",
        kind: "copy",
        value: `These files were written by a session that is attached to no plan: ${files.join(", ")}. Write a plan for this work in plans/ with a touches list covering them, or revert them.`,
      }],
    });
  }

  const waiting: WaitingRow[] = [];
  for (const d of input.decisions) {
    if (d.status !== "open") continue;
    waiting.push({
      kind: "decision",
      id: d.id,
      title: d.title ?? d.id,
      detail: d.blocks.length ? `Holds ${d.blocks.join(", ")}.` : (d.unblocks || "Waiting on an answer."),
      actions: [{ label: "Open", kind: "link", value: `/decisions/${encodeURIComponent(d.id)}` }],
      decision: { options: d.options ?? [], recommendation: d.recommendation ?? null, unblocks: d.unblocks ?? null, file: d.file ?? null },
    });
  }
  for (const p of input.plans) {
    if (p.status === "blocked") {
      waiting.push({ kind: "blocked-plan", id: p.id, title: p.title, detail: "Marked blocked.", actions: [{ label: "Open plan", kind: "link", value: `/plan/${encodeURIComponent(p.id)}` }] });
    }
  }
  for (const h of input.plans) {
    if (h.owner !== "human" || h.status === "done" || h.status === "blocked") continue;
    const held = input.plans.filter((p) => p.owner === "ai" && p.status === "todo" && p.depends.includes(h.id)).map((p) => p.id);
    if (!held.length) continue;
    waiting.push({ kind: "human-plan", id: h.id, title: h.title, detail: `Yours, and it holds ${held.join(", ")}.`, actions: [{ label: "Open plan", kind: "link", value: `/plan/${encodeURIComponent(h.id)}` }] });
  }

  const drift: DriftRow[] = [];
  if (input.checks === null) notes.push("The doctor did not run, so drift is not listed.");
  for (const c of input.checks ?? []) {
    if (c.ok || c.severity === "info") continue;
    const cmd = commandFromDetail(c.detail);
    drift.push({
      id: c.id,
      severity: c.severity,
      label: c.label,
      detail: c.detail,
      actions: [
        ...(cmd ? [{ label: "Copy fix", kind: "copy" as const, value: cmd }] : []),
        { label: "Copy agent prompt", kind: "copy", value: `PANTRY's doctor reports ${c.id}: ${c.detail} Fix it, or say in the run report why it is carried.` },
      ],
    });
  }

  const { ready, skipped } = readyPlans(input.plans, input.decisions, claims);
  const queue: QueueRow[] = ready.map((r) => ({
    id: r.id,
    title: r.title,
    touches: r.touches,
    actions: [
      { label: "Copy start prompt", kind: "copy", value: `Call pantry_next for this project, then pantry_claim plan ${r.id}, set its status to doing, and work it to its done line. Heartbeat every ten minutes and release when you finish.` },
      { label: "Open plan", kind: "link", value: `/plan/${encodeURIComponent(r.id)}` },
    ],
  }));
  const next: NextRow = { ready: queue[0] ?? null, queue, skipped };

  const answered: AnsweredRow[] = (input.answers ?? []).toSorted((a, b) => a.at.localeCompare(b.at)).map((a) => ({
    id: a.id,
    at: a.at,
    ref: a.request.ref,
    question: a.request.question,
    choice: a.choice,
    notes: a.notes ?? null,
    holds: input.decisions.find((d) => d.id === a.request.ref)?.blocks ?? [],
    actions: [{ label: "Copy prompt", kind: "copy", value: a.composed || `The owner answered ${a.request.ref} (${a.request.question}): ${a.choice || "see note"}.${a.notes ? ` Note: ${a.notes}` : ""} Act on it, then run: pantry answers ack ${a.id}` }],
  }));

  return { generated: input.now, project: input.project, inFlight, waiting, drift, next, answered, notes };
}

function toBriefSession(s: SessionRow): BriefSession {
  return { id: short(s.id), state: s.state, lastSeenAt: s.lastSeenAt, paths: s.paths, pathsOmitted: s.pathsOmitted, lastTool: s.lastTool, idleSeconds: s.idleSeconds };
}

/** Read the disk and assemble. Each source that fails becomes a note, never a 500. */
export async function buildBrief(
  config: ResolvedPantryConfig,
  now: string,
  claim: { home?: string; project?: string } = {},
): Promise<BriefPayload> {
  const repoRoot = config.cwd;
  const notes: string[] = [];
  let plans: PlanLike[] = [];
  let decisions: BriefInputs["decisions"] = [];
  try {
    plans = (await loadProjectWork(repoRoot)).plans;
  } catch (err) {
    notes.push(`Plans could not be read: ${err instanceof Error ? err.message : String(err)}.`);
  }
  try {
    decisions = (await buildDecisionsPayload(config, now)).decisions.map((d) => ({ id: d.id, status: d.status, blocks: d.blocks, title: d.title, unblocks: d.unblocks ?? null, options: d.options, recommendation: d.recommendation ?? null, file: d.file }));
  } catch (err) {
    notes.push(`The decision inbox could not be read: ${err instanceof Error ? err.message : String(err)}. Anything waiting on you may be missing.`);
  }
  let claims: Map<string, ClaimView> | null = null;
  const home = claim.home ?? process.env.PANTRY_HOME ?? join(homedir(), ".pantry");
  const project = claim.project ?? process.env.PANTRY_PROJECT;
  if (project) {
    try {
      const doneInFile = new Set(plans.filter((p) => p.status === "done").map((p) => p.id));
      claims = foldClaims(await readClaims(claimsFile(home, project)), Date.parse(now), ttlMs(), doneInFile);
    } catch {
      claims = null;
    }
  }
  let sessions: SessionRow[] = [];
  try {
    const payload = await buildSessionsPayload(config, now);
    sessions = payload.sessions;
    if (!payload.present) notes.push("No session log exists for this repo, so what agents wrote is not shown.");
  } catch (err) {
    notes.push(`The session log could not be read: ${err instanceof Error ? err.message : String(err)}.`);
  }
  let answers: AnswerEntry[] = [];
  try {
    const log = await readAnswerLog(config.answersLog);
    if (log.readError) notes.push(`The answer log could not be read: ${log.readError}.`);
    answers = unacked(log);
  } catch (err) {
    notes.push(`The answer log could not be read: ${err instanceof Error ? err.message : String(err)}.`);
  }
  let checks: DoctorCheck[] | null = null;
  try {
    checks = (await runDoctor({ cwd: repoRoot, config, now: new Date(now), runDrift: false, runDeps: false })).checks;
    notes.push("Drift skips the slow doc-drift and layer-pin checks; the full report is one command: pantry doctor.");
  } catch {
    checks = null;
  }
  return assembleBrief({ now, project: config.projectName, repoRoot, plans, decisions, claims, sessions, checks, answers, notes });
}

/** The brief as Markdown, the agent's copy of the page: same sections, same order. */
export function briefText(b: BriefPayload): string {
  const out: string[] = [`# ${b.project}: where the AI work stands`, "", `Generated ${b.generated}.`, ""];
  for (const n of b.notes) out.push(`> ${n}`);
  if (b.notes.length) out.push("");
  out.push("## In flight", "");
  if (!b.inFlight.length) out.push("Nothing is in flight.");
  for (const r of b.inFlight) {
    const who = r.claim ? ` (claimed by ${r.claim.tool} ${r.claim.sessionId}, ${r.claim.state})` : r.planId ? " (no claim)" : "";
    out.push(`- ${r.planId ?? "no plan"}: ${r.title}${who}; ${r.sessions.length} session(s)`);
    if (r.outOfScope.length) out.push(`  - out of scope: ${r.outOfScope.join(", ")}`);
    if (r.unrecorded) out.push(`  - and ${r.unrecorded} more not recorded`);
  }
  out.push("", "## Answered by the owner, not yet acted on", "");
  if (!b.answered.length) out.push("No unread answers.");
  for (const a of b.answered) {
    out.push(`- ${a.id} on ${a.ref}${a.holds.length ? ` (holds ${a.holds.join(", ")})` : ""}: ${a.question} Answer: ${a.choice || "(see note)"}${a.notes ? `. Note: ${a.notes}` : ""}`);
    out.push(`  - when acted on, run: pantry answers ack ${a.id}`);
  }
  out.push("", "## Waiting on the owner", "");
  if (!b.waiting.length) out.push("Nothing is waiting on the owner.");
  for (const w of b.waiting) out.push(`- ${w.kind} ${w.id}: ${w.title}. ${w.detail}`);
  out.push("", "## Drift", "");
  if (!b.drift.length) out.push("No drift reported.");
  for (const d of b.drift) out.push(`- [${d.severity}] ${d.label}: ${d.detail}`);
  out.push("", "## Next", "");
  if (b.next.ready) out.push(`- Ready: ${b.next.ready.id}: ${b.next.ready.title}`);
  else out.push("Nothing is ready.");
  for (const s of b.next.skipped) out.push(`- Not ready: ${s.id} (${s.reasons.join("; ")})`);
  return out.join("\n") + "\n";
}
