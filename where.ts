// pantry/where.ts: where the work ran, read back from the claims logs and the harnesses' own logs.
//
// One plan can run on two machines, three harnesses and four models before it is done, and the
// owner asked which of those did what, how long each took, how long the plan sat stalled on a usage
// limit, and whether a handover from one place to another was picked up. Every claim line already
// says which session, harness and machine held the plan and when, so the history is a fold over the
// log rather than a new store.
//
// Tokens come from where each harness writes them. Claude's are read by usage.ts; Codex writes a
// running total into every session log under ~/.codex/sessions, read here. A harness that writes
// neither is counted as unknown rather than as zero. All of this stays on the machine: the state
// file other machines read carries none of it.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ClaimLine } from "./orchestrator.ts";

/** One stretch of a plan, from a session's claim to its last event. */
export interface Segment {
  project: string;
  planId: string;
  sessionId: string;
  tool: string;
  machine: string;
  model: string;
  account: string;
  from: number;
  to: number;
  /** done, release, or open when the claim ended by going quiet */
  end: "done" | "release" | "open";
  reason?: string;
}

/** A plan moving from one machine or harness to another. */
export interface Handover {
  project: string;
  planId: string;
  from: string;
  to: string;
  gapMs: number;
  /** the plan was finished by a later stretch */
  landed: boolean;
}

export interface CodexSession { sessionId: string; cwd: string; model: string; from: number; to: number; tokens: number; limitHit: boolean }

export interface WhereReport {
  segments: number;
  byTool: { key: string; sessions: number; activeMs: number }[];
  byMachine: { key: string; sessions: number; activeMs: number }[];
  byModel: { key: string; sessions: number; activeMs: number }[];
  /** time on plans with a session holding them, time between stretches, and the part of that gap that followed a usage limit */
  activeMs: number;
  waitingMs: number;
  stalledMs: number;
  handovers: Handover[];
  tokens: { tool: string; tokens: number | null; sessions: number }[];
}

/** Below this many stretches the report shows counts only, because a share of five says nothing. */
export const WHERE_MIN_N = 10;

const label = (s: Segment) => `${s.tool} on ${s.machine}`;

export function segmentsOf(lines: ClaimLine[]): Segment[] {
  const open = new Map<string, Segment>();
  const out: Segment[] = [];
  for (const l of [...lines].sort((a, b) => a.at.localeCompare(b.at))) {
    const t = Date.parse(l.at);
    if (!Number.isFinite(t)) continue;
    const key = `${l.sessionId}\u0000${l.planId}`;
    if (l.event === "claim") {
      const s: Segment = { project: l.project, planId: l.planId, sessionId: l.sessionId, tool: l.tool, machine: (l.where?.machine || "unknown").replace(/\.local$/, ""), model: l.where?.model || "unknown", account: l.where?.account || "", from: t, to: t, end: "open" };
      open.set(key, s);
      out.push(s);
      continue;
    }
    const s = open.get(key);
    if (!s) continue;
    s.to = t;
    if (l.event === "heartbeat") continue;
    s.end = l.event === "done" ? "done" : "release";
    if (l.reason) s.reason = l.reason;
    open.delete(key);
  }
  return out;
}

/** Each plan's stretches in order; a handover is a move to another machine or harness. */
export function handoversOf(segs: Segment[]): Handover[] {
  const byPlan = new Map<string, Segment[]>();
  for (const s of segs) {
    const k = `${s.project}\u0000${s.planId}`;
    byPlan.set(k, [...(byPlan.get(k) ?? []), s]);
  }
  const out: Handover[] = [];
  for (const list of byPlan.values()) {
    list.sort((a, b) => a.from - b.from);
    const landed = list.some((s) => s.end === "done");
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      // A line written before machines were recorded says unknown; that is no evidence of a move.
      const sameMachine = a.machine === b.machine || a.machine === "unknown" || b.machine === "unknown";
      if (a.tool === b.tool && sameMachine) continue;
      out.push({ project: b.project, planId: b.planId, from: label(a), to: label(b), gapMs: Math.max(0, b.from - a.to), landed });
    }
  }
  return out;
}

/** Codex sessions that started on or after `since`, read from their own logs. */
export function readCodexSessions(root: string, since: number): CodexSession[] {
  const out: CodexSession[] = [];
  if (!existsSync(root)) return out;
  const walk = (dir: string, depth: number) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (depth < 3) { if (statSync(p).isDirectory()) walk(p, depth + 1); continue; }
      if (!name.endsWith(".jsonl") || statSync(p).mtimeMs < since) continue;
      const s = codexSession(readFileSync(p, "utf8"));
      if (s && s.to >= since) out.push(s);
    }
  };
  walk(root, 0);
  return out;
}

export function codexSession(text: string): CodexSession | null {
  let meta: { session_id?: string; id?: string; cwd?: string } | null = null;
  let model = "unknown", tokens = 0, from = NaN, to = NaN, limitHit = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let j: { timestamp?: string; type?: string; payload?: Record<string, any> };
    try { j = JSON.parse(line); } catch { continue; }
    const t = Date.parse(j.timestamp ?? "");
    if (Number.isFinite(t)) { if (!Number.isFinite(from)) from = t; to = t; }
    if (j.type === "session_meta") meta = j.payload ?? {};
    const m = /"model":"([^"]+)"/.exec(line);
    if (m) model = m[1];
    if (j.payload?.type === "token_count") {
      const total = j.payload.info?.total_token_usage?.total_tokens;
      if (typeof total === "number") tokens = total;
      if ((j.payload.rate_limits?.primary?.used_percent ?? 0) >= 100) limitHit = true;
    }
  }
  if (!meta?.cwd || !Number.isFinite(from)) return null;
  return { sessionId: meta.session_id ?? meta.id ?? "", cwd: meta.cwd, model, from, to, tokens, limitHit };
}

/** The project a Codex session belongs to: the registered path its working directory sits under. */
export function projectOfCwd(cwd: string, projects: { name: string; path: string }[]): string | null {
  const c = resolve(cwd);
  const hit = projects.filter((p) => c === resolve(p.path) || c.startsWith(resolve(p.path) + "/")).sort((a, b) => b.path.length - a.path.length)[0];
  return hit?.name ?? null;
}

export function buildWhere(segs: Segment[], since: number, codex: CodexSession[], claudeTokens: number | null): WhereReport {
  const inPeriod = segs.filter((s) => s.to >= since);
  const group = (key: (s: Segment) => string) => {
    const m = new Map<string, { sessions: number; activeMs: number }>();
    for (const s of inPeriod) {
      const g = m.get(key(s)) ?? { sessions: 0, activeMs: 0 };
      g.sessions++; g.activeMs += s.to - s.from;
      m.set(key(s), g);
    }
    return [...m].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.activeMs - a.activeMs);
  };
  // Waiting is the time between one stretch of a plan and the next; it is stalled when the earlier
  // stretch was released on a usage limit.
  let waitingMs = 0, stalledMs = 0;
  const byPlan = new Map<string, Segment[]>();
  for (const s of inPeriod) byPlan.set(`${s.project}\u0000${s.planId}`, [...(byPlan.get(`${s.project}\u0000${s.planId}`) ?? []), s]);
  for (const list of byPlan.values()) {
    list.sort((a, b) => a.from - b.from);
    for (let i = 1; i < list.length; i++) {
      const gap = Math.max(0, list[i].from - list[i - 1].to);
      waitingMs += gap;
      if (list[i - 1].reason === "limit") stalledMs += gap;
    }
  }
  const tools = new Set(inPeriod.map((s) => s.tool));
  const tokens = [...tools].sort().map((tool) => {
    const sessions = new Set(inPeriod.filter((s) => s.tool === tool).map((s) => s.sessionId)).size;
    if (tool === "codex") return { tool, tokens: codex.reduce((n, c) => n + c.tokens, 0), sessions: codex.length };
    if (tool === "claude") return { tool, tokens: claudeTokens, sessions };
    return { tool, tokens: null, sessions };
  });
  return {
    segments: inPeriod.length,
    byTool: group((s) => s.tool),
    byMachine: group((s) => s.machine),
    byModel: group((s) => s.model),
    activeMs: inPeriod.reduce((n, s) => n + (s.to - s.from), 0),
    waitingMs,
    stalledMs,
    handovers: handoversOf(segs).filter((h) => inPeriod.some((s) => s.planId === h.planId && s.project === h.project)),
    tokens,
  };
}
