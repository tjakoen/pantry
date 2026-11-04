// orchestrator.ts: agents take work from PANTRY, and the owner sees who has what.
//
// The design is plans/pantry-orchestrator.md, reviewed to GO by fresh-context goldfish agents; the
// review record is artifacts/reviews/pantry-orchestrator.md. In short:
//
//   - Pull, never push. Agents ask for work; PANTRY never starts a session or edits a plan.
//   - Only plans whose frontmatter says exactly `owner: ai` are offered. PROOF defaults a missing
//     owner to "ai" and records an error, so a plan with an owner error is treated as not offered.
//   - Claims are append-only JSON lines in $PANTRY_HOME/claims/<project>.jsonl. Only the hub process
//     writes them, and it serializes each read-check-append per project through an in-process queue,
//     so there is no lock file to go stale and no cross-process locking across the Docker mount.
//
// The fold, from the plan's state table:
//   claim/heartbeat younger than the timeout   active      blocks
//   claim/heartbeat older than the timeout     expired     does not block
//   release                                    released    does not block
//   done, < 24h, plan file not yet done        done        blocks
//   done, >= 24h, plan file not yet done       stale-done  does not block

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const CLAIM_TOOLS = ["claude", "codex"] as const;
export type ClaimTool = (typeof CLAIM_TOOLS)[number];
export type ClaimEvent = "claim" | "heartbeat" | "release" | "done";
export type ClaimState = "active" | "expired" | "released" | "done" | "stale-done";

export interface ClaimLine {
  project: string;
  planId: string;
  sessionId: string;
  tool: ClaimTool;
  at: string;
  event: ClaimEvent;
}

export interface ClaimView {
  planId: string;
  sessionId: string;
  tool: ClaimTool;
  claimedAt: string;
  lastAt: string;
  state: ClaimState;
}

/** The minimal shape the orchestrator needs from a PROOF plan, so tests need no PROOF fixtures. */
export interface PlanLike {
  id: string;
  title: string;
  status: string;
  owner: string;
  depends: string[];
  touches: string[];
  ownerError?: boolean;
  file?: string;
}
export interface DecisionLike { id: string; status: string; blocks: string[] }

export const DONE_HOLD_MS = 24 * 60 * 60 * 1000;
export const RECENT_MS = 24 * 60 * 60 * 1000;

export function ttlMs(env: Record<string, string | undefined> = process.env): number {
  const minutes = Number(env.PANTRY_CLAIM_TTL_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;
}

export function parseLines(text: string): ClaimLine[] {
  const out: ClaimLine[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const c = JSON.parse(line) as ClaimLine;
      if (c.planId && c.sessionId && c.event && c.at) out.push(c);
    } catch { /* a torn or foreign line is skipped, never fatal */ }
  }
  return out;
}

/** Reduce the event log to the current claim per plan. `doneInFile` says which plans the checkout
 *  already shows as done, which decides whether a done claim still blocks. */
export function foldClaims(lines: ClaimLine[], now: number, ttl: number, doneInFile: Set<string> = new Set()): Map<string, ClaimView> {
  const views = new Map<string, ClaimView>();
  for (const l of lines) {
    const cur = views.get(l.planId);
    if (l.event === "claim") {
      views.set(l.planId, { planId: l.planId, sessionId: l.sessionId, tool: l.tool, claimedAt: l.at, lastAt: l.at, state: "active" });
    } else if (cur && cur.sessionId === l.sessionId) {
      cur.lastAt = l.at;
      cur.state = l.event === "heartbeat" ? "active" : l.event === "release" ? "released" : "done";
    }
  }
  for (const v of views.values()) {
    const age = now - Date.parse(v.lastAt);
    if (v.state === "active" && age >= ttl) v.state = "expired";
    if (v.state === "done" && !doneInFile.has(v.planId) && age >= DONE_HOLD_MS) v.state = "stale-done";
  }
  return views;
}

export function blocks(view: ClaimView | undefined, doneInFile: Set<string>): boolean {
  if (!view) return false;
  if (view.state === "active") return true;
  return view.state === "done" && !doneInFile.has(view.planId);
}

export interface Offer { id: string; title: string; file?: string; touches: string[] }
export interface Skip { id: string; title: string; reasons: string[] }

/** Ready plans in board order (ascending id, as PROOF's renderBoard sorts a column), and every
 *  other todo plan with all of its reasons in the fixed order owner, depends, decision, claimed. */
export function readyPlans(plans: PlanLike[], decisions: DecisionLike[], claims: Map<string, ClaimView>): { ready: Offer[]; skipped: Skip[] } {
  const status = new Map(plans.map((p) => [p.id, p.status]));
  const doneInFile = new Set(plans.filter((p) => p.status === "done").map((p) => p.id));
  const ready: Offer[] = [];
  const skipped: Skip[] = [];
  for (const p of [...plans].sort((a, b) => a.id.localeCompare(b.id))) {
    if (p.status !== "todo") continue;
    const reasons: string[] = [];
    if (p.owner !== "ai" || p.ownerError) reasons.push(`owner: ${p.ownerError ? "missing" : p.owner}`);
    for (const d of p.depends) if (status.get(d) !== "done") reasons.push(`depends: ${d}${status.has(d) ? "" : " (no such plan)"}`);
    for (const d of decisions) if (d.status === "open" && d.blocks.includes(p.id)) reasons.push(`decision: ${d.id}`);
    const c = claims.get(p.id);
    if (blocks(c, doneInFile)) reasons.push(`claimed by ${c!.tool} ${c!.sessionId.slice(0, 8)} (${c!.state})`);
    if (reasons.length) skipped.push({ id: p.id, title: p.title, reasons });
    else ready.push({ id: p.id, title: p.title, file: p.file, touches: p.touches });
  }
  return { ready, skipped };
}

export function claimsFile(home: string, project: string): string {
  return join(home, "claims", `${project}.jsonl`);
}

export async function readClaims(file: string): Promise<ClaimLine[]> {
  if (!existsSync(file)) return [];
  return parseLines(await readFile(file, "utf8"));
}

// One promise chain per claims file: every read-check-append runs after the previous one finished.
const queues = new Map<string, Promise<unknown>>();
export function serialized<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(file) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(file, next.catch(() => undefined));
  return next;
}

async function append(file: string, line: ClaimLine): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(line) + "\n", "utf8");
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ClaimContext {
  file: string;
  project: string;
  plans: PlanLike[];
  decisions: DecisionLike[];
  /** ids of the owner's answers no session has acked; `answer:<id>` is claimable only for these */
  answers?: string[];
  now?: () => number;
  ttl?: number;
}

/** The claim id for an answer. Answers are claimed like plans, so two sessions handed the same answer
 *  cannot both act on it: the second claim is refused. */
export const ANSWER_CLAIM_PREFIX = "answer:";

/** Who is already on an unread answer: a session holding the answer itself, or one holding a plan
 *  the answered decision blocks (that session gets the answer on its next heartbeat). */
export interface AnswerOwner { via: "answer" | "plan"; planId: string; sessionId: string; tool: ClaimTool }

export function answerOwner(answerId: string, decisionRef: string, decisions: DecisionLike[], claims: Map<string, ClaimView>): AnswerOwner | null {
  const own = claims.get(ANSWER_CLAIM_PREFIX + answerId);
  if (own?.state === "active") return { via: "answer", planId: own.planId, sessionId: own.sessionId, tool: own.tool };
  const held = decisions.find((d) => d.id === decisionRef)?.blocks ?? [];
  for (const planId of held) {
    const c = claims.get(planId);
    if (c?.state === "active") return { via: "plan", planId, sessionId: c.sessionId, tool: c.tool };
  }
  return null;
}

export function claimPlan(ctx: ClaimContext, planId: string, sessionId: string, tool: string): Promise<Result<ClaimView>> {
  return serialized(ctx.file, async () => {
    if (!(CLAIM_TOOLS as readonly string[]).includes(tool)) return { ok: false, error: `tool must be one of: ${CLAIM_TOOLS.join(", ")}` };
    if (!sessionId) return { ok: false, error: "sessionId is required" };
    const now = (ctx.now ?? Date.now)();
    const ttl = ctx.ttl ?? ttlMs();
    const doneInFile = new Set(ctx.plans.filter((p) => p.status === "done").map((p) => p.id));
    const views = foldClaims(await readClaims(ctx.file), now, ttl, doneInFile);
    if (planId.startsWith(ANSWER_CLAIM_PREFIX)) {
      const id = planId.slice(ANSWER_CLAIM_PREFIX.length);
      if (!(ctx.answers ?? []).includes(id)) return { ok: false, error: `${id} is not an unread answer in ${ctx.project}` };
      const held = views.get(planId);
      if (blocks(held, doneInFile)) return { ok: false, error: `${planId} is already held by ${held!.tool} ${held!.sessionId}; leave it to that session` };
      const at = new Date(now).toISOString();
      await append(ctx.file, { project: ctx.project, planId, sessionId, tool: tool as ClaimTool, at, event: "claim" });
      return { ok: true, value: { planId, sessionId, tool: tool as ClaimTool, claimedAt: at, lastAt: at, state: "active" } };
    }
    const { ready, skipped } = readyPlans(ctx.plans, ctx.decisions, views);
    if (!ready.some((r) => r.id === planId)) {
      const skip = skipped.find((s) => s.id === planId);
      return { ok: false, error: skip ? `${planId} is not ready: ${skip.reasons.join("; ")}` : `${planId} is not a todo plan in ${ctx.project}` };
    }
    const at = new Date(now).toISOString();
    await append(ctx.file, { project: ctx.project, planId, sessionId, tool: tool as ClaimTool, at, event: "claim" });
    return { ok: true, value: { planId, sessionId, tool: tool as ClaimTool, claimedAt: at, lastAt: at, state: "active" } };
  });
}

/** Heartbeat or release. Only the holder may act. A heartbeat cannot revive an expired claim; a
 *  `done` release is accepted after expiry as long as nobody claimed the plan since, so a slow
 *  session can still record its work. */
export function updateClaim(ctx: ClaimContext, planId: string, sessionId: string, event: "heartbeat" | "release" | "done"): Promise<Result<ClaimView>> {
  return serialized(ctx.file, async () => {
    const now = (ctx.now ?? Date.now)();
    const lines = await readClaims(ctx.file);
    const view = foldClaims(lines, now, ctx.ttl ?? ttlMs()).get(planId);
    if (!view) return { ok: false, error: `${planId} has no claim` };
    if (view.sessionId !== sessionId) return { ok: false, error: `${planId} is held by ${view.tool} ${view.sessionId}, not this session` };
    const lateDone = event === "done" && view.state === "expired";
    if (view.state !== "active" && !lateDone) return { ok: false, error: `${planId}'s claim is ${view.state}; claim it again` };
    const at = new Date(now).toISOString();
    await append(ctx.file, { project: ctx.project, planId, sessionId, tool: view.tool, at, event });
    return { ok: true, value: { ...view, lastAt: at, state: event === "heartbeat" ? "active" : event === "release" ? "released" : "done" } };
  });
}

/** Active claims, and claims whose last event is within 24 hours. */
export function listClaims(lines: ClaimLine[], now: number, ttl: number, doneInFile: Set<string>): ClaimView[] {
  return [...foldClaims(lines, now, ttl, doneInFile).values()]
    .filter((v) => v.state === "active" || now - Date.parse(v.lastAt) < RECENT_MS)
    .sort((a, b) => a.planId.localeCompare(b.planId));
}

// --- loading a project's plans and decisions, for the hub process ---------------------------------

/** Read a registered project's plans and decisions. Plan modification times are skipped: the
 *  default loader runs one `git log` per plan, which is the cost that once pinned the hub. */
export async function loadProjectWork(projectPath: string): Promise<{ plans: PlanLike[]; decisions: DecisionLike[] }> {
  const { loadPantryConfig } = await import("./config.ts");
  const { loadPlans } = await import("@tjakoen/proof/loader.ts");
  const { buildDecisionsPayload } = await import("./decisions.ts");
  const config = await loadPantryConfig(projectPath);
  const loaded = existsSync(config.plansDir) ? await loadPlans(config.plansDir, async () => null) : { plans: [] };
  const plans: PlanLike[] = loaded.plans.map((lp) => ({
    id: lp.plan.id,
    title: lp.plan.title,
    status: lp.plan.status,
    owner: lp.plan.owner,
    depends: lp.plan.depends,
    touches: lp.plan.touches,
    ownerError: lp.errors.some((e) => e.field === "owner"),
    file: join(config.plansDir, `${lp.plan.id}.md`),
  }));
  const decisions = (await buildDecisionsPayload(config, new Date().toISOString())).decisions
    .map((d) => ({ id: d.id, status: d.status, blocks: d.blocks }));
  return { plans, decisions };
}

/** Ready and claimed counts for one project, for /health. */
export async function workCounts(home: string, project: string, projectPath: string, now = Date.now()): Promise<{ ready: number; claimed: number }> {
  const { plans, decisions } = await loadProjectWork(projectPath);
  const doneInFile = new Set(plans.filter((p) => p.status === "done").map((p) => p.id));
  const views = foldClaims(await readClaims(claimsFile(home, project)), now, ttlMs(), doneInFile);
  return {
    ready: readyPlans(plans, decisions, views).ready.length,
    claimed: [...views.values()].filter((v) => v.state === "active").length,
  };
}

// --- the board: who holds what -----------------------------------------------------------------

function age(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

/** One short label per plan card: who holds it and for how long, or that it is ready. */
export async function boardAnnotations(projectPath: string, home: string, project: string, now = Date.now()): Promise<Map<string, { kind: "claimed" | "ready" | "done-pending"; label: string }>> {
  const { plans, decisions } = await loadProjectWork(projectPath);
  const doneInFile = new Set(plans.filter((p) => p.status === "done").map((p) => p.id));
  const views = foldClaims(await readClaims(claimsFile(home, project)), now, ttlMs(), doneInFile);
  const out = new Map<string, { kind: "claimed" | "ready" | "done-pending"; label: string }>();
  for (const v of views.values()) {
    if (v.state === "active") out.set(v.planId, { kind: "claimed", label: `${v.tool} ${v.sessionId.slice(0, 8)} · ${age(now - Date.parse(v.claimedAt))}` });
    else if (v.state === "done" && !doneInFile.has(v.planId)) out.set(v.planId, { kind: "done-pending", label: `done by ${v.tool}, status not yet done` });
  }
  for (const r of readyPlans(plans, decisions, views).ready) out.set(r.id, { kind: "ready", label: "ready for an agent" });
  return out;
}

/** Insert the labels into PROOF's card markup, right after each card's top row opens. Cards are
 *  matched by their plan link, before or after PANTRY rewrites it to /plans/plan/. */
export function annotateBoard(html: string, notes: Map<string, { kind: string; label: string }>): string {
  if (!notes.size) return html;
  return html.replace(/(href="(?:[^"]*)\/plan\/([^"]+)">\s*<div class="proof-card__top">)/g, (whole, _m, rawId: string) => {
    const n = notes.get(decodeURIComponent(rawId).replace(/&amp;/g, "&"));
    if (!n) return whole;
    const safe = n.label.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    return `${whole}\n    <span class="badge" data-claim="${n.kind}">${safe}</span>`;
  });
}
