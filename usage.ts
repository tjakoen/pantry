// pantry/usage.ts — where the tokens went: per project, per part of the project, per model.
//
// The numbers come from the harness transcripts, the per-session JSONL that Claude Code writes under
// <configDir>/projects/<slug>/. sessions.ts explains why it does not build on that format: it is
// undocumented and owned by a vendor who can change it in a point release. That reasoning still
// holds, and token counts exist nowhere else, so this module takes the risk with its eyes open and
// keeps the failure mode the same one sessions.ts chose: a line it cannot read is skipped and
// counted, and a format change shows up as an empty table plus a rising "skipped" number rather
// than as a crash or a wrong total.
//
// What a turn is attributed to:
//   - model: the model field on the assistant message, so a mid-session switch is split correctly.
//   - plan: the PANTRY claim whose session id matches the transcript's and whose claim window (claim
//     to release or done) contains the turn's timestamp. A turn outside every claim is "(unclaimed)",
//     which is the honest label for work the owner asked for in chat.
//   - area: the top-level directory of the files that turn's tool calls named (file_path or path
//     inputs inside the project). Several areas in one turn split the turn evenly between them. A
//     turn that named no file is "(no files)". This is a heuristic and is reported as one.
//
// Subagent transcripts (<session>/subagents/*.jsonl) roll up into their parent session, so a plan
// pays for the agents it spawned. The harness writes one line per content block of a message, all
// carrying the same usage, so lines are deduplicated by message id before anything is summed.
//
// Cache reads are kept in their own column. They dominate raw totals and cost a fraction of fresh
// input, so a single "total" would make a long cached session look like the most expensive thing in
// the project. The payload carries token counts only; pricing is left to whoever reads it.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { harnessProjectDir } from "./context.ts";
import type { ClaimLine } from "./orchestrator.ts";

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface UsageTurn {
  sessionId: string;
  messageId: string;
  at: string;
  model: string;
  tokens: TokenCounts;
  /** top-level areas this turn's tool calls touched, already relative to the project root */
  areas: string[];
  subagent: boolean;
}

export interface UsageRow extends TokenCounts {
  key: string;
  turns: number;
}

export interface UsagePayload {
  project: string;
  generatedAt: string;
  /** the transcript directory read, so a reader can tell "no usage" from "looked in the wrong place" */
  source: string;
  sessions: number;
  turns: number;
  /** lines that were not JSON or not an assistant message with usage; a format change shows up here */
  skipped: number;
  totals: TokenCounts;
  byModel: UsageRow[];
  byPlan: UsageRow[];
  byArea: UsageRow[];
  byPlanModel: UsageRow[];
}

const zero = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** The top-level area a path falls in, relative to the project root, or null when it sits outside. */
export function areaOf(root: string, p: string): string | null {
  const abs = isAbsolute(p) ? p : resolve(root, p);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  const parts = rel.split(sep);
  // A single segment is a root file, unless it has no extension: then it is a directory a search or
  // listing was pointed at, and that directory is the area.
  if (parts.length === 1) return parts[0].includes(".") ? "(root)" : parts[0];
  return parts[0];
}

function areasFromContent(content: unknown, root: string): string[] {
  if (!Array.isArray(content)) return [];
  const out = new Set<string>();
  for (const block of content) {
    if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "tool_use") continue;
    const input = (block as { input?: Record<string, unknown> }).input ?? {};
    for (const k of ["file_path", "path", "notebook_path"]) {
      const v = input[k];
      if (typeof v === "string" && v) {
        const a = areaOf(root, v);
        if (a) out.add(a);
      }
    }
  }
  return [...out];
}

/** Parse one transcript's text into turns, deduplicated by message id. Unknown lines are counted. */
export function parseTranscript(text: string, root: string, subagent = false): { turns: UsageTurn[]; skipped: number } {
  const byId = new Map<string, UsageTurn>();
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (rec.type !== "assistant") continue; // user, system and summary lines are not usage, not skips
    const msg = rec.message as Record<string, unknown> | undefined;
    const usage = msg?.usage as Record<string, unknown> | undefined;
    if (!msg || !usage || typeof msg.model !== "string" || typeof rec.sessionId !== "string") {
      skipped++;
      continue;
    }
    if (msg.model === "<synthetic>") continue; // harness-made placeholder, no tokens spent
    const id = typeof msg.id === "string" ? msg.id : `${rec.sessionId}:${rec.uuid ?? byId.size}`;
    const areas = areasFromContent(msg.content, root);
    const prev = byId.get(id);
    if (prev) {
      for (const a of areas) if (!prev.areas.includes(a)) prev.areas.push(a);
      continue;
    }
    byId.set(id, {
      sessionId: rec.sessionId,
      messageId: id,
      at: typeof rec.timestamp === "string" ? rec.timestamp : "",
      model: msg.model,
      tokens: {
        input: num(usage.input_tokens),
        output: num(usage.output_tokens),
        cacheRead: num(usage.cache_read_input_tokens),
        cacheWrite: num(usage.cache_creation_input_tokens),
      },
      areas,
      subagent,
    });
  }
  return { turns: [...byId.values()], skipped };
}

interface ClaimWindow { planId: string; sessionId: string; from: number; to: number }

/** Fold claim lines into windows: a claim opens one, a release or done closes it. An open window runs
 *  to the last heartbeat, or to now when there is none yet. */
export function claimWindows(lines: ClaimLine[], nowMs: number): ClaimWindow[] {
  const open = new Map<string, ClaimWindow>();
  const out: ClaimWindow[] = [];
  for (const l of [...lines].sort((a, b) => a.at.localeCompare(b.at))) {
    const key = `${l.sessionId}\u0000${l.planId}`;
    const t = Date.parse(l.at);
    if (!Number.isFinite(t)) continue;
    if (l.event === "claim") {
      const w = { planId: l.planId, sessionId: l.sessionId, from: t, to: nowMs };
      open.set(key, w);
      out.push(w);
    } else {
      const w = open.get(key);
      if (!w) continue;
      if (l.event === "heartbeat") continue;
      w.to = t;
      open.delete(key);
    }
  }
  return out;
}

export function planFor(turn: UsageTurn, windows: ClaimWindow[]): string {
  const t = Date.parse(turn.at);
  for (const w of windows) if (w.sessionId === turn.sessionId && t >= w.from && t <= w.to) return w.planId;
  return "(unclaimed)";
}

function add(rows: Map<string, UsageRow>, key: string, t: TokenCounts, share = 1, turns = 1): void {
  const r = rows.get(key) ?? { key, turns: 0, ...zero() };
  r.input += t.input * share;
  r.output += t.output * share;
  r.cacheRead += t.cacheRead * share;
  r.cacheWrite += t.cacheWrite * share;
  r.turns += turns;
  rows.set(key, r);
}

const ranked = (rows: Map<string, UsageRow>): UsageRow[] =>
  [...rows.values()]
    .map((r) => ({ ...r, input: Math.round(r.input), output: Math.round(r.output), cacheRead: Math.round(r.cacheRead), cacheWrite: Math.round(r.cacheWrite) }))
    .sort((a, b) => b.input + b.output + b.cacheWrite - (a.input + a.output + a.cacheWrite) || a.key.localeCompare(b.key));

/** Pure aggregation, so the tests do not need a transcript directory. */
export function aggregateUsage(project: string, source: string, turns: UsageTurn[], windows: ClaimWindow[], skipped: number, nowIso: string): UsagePayload {
  const totals = zero();
  const byModel = new Map<string, UsageRow>();
  const byPlan = new Map<string, UsageRow>();
  const byArea = new Map<string, UsageRow>();
  const byPlanModel = new Map<string, UsageRow>();
  const sessions = new Set<string>();
  for (const t of turns) {
    sessions.add(t.sessionId);
    totals.input += t.tokens.input;
    totals.output += t.tokens.output;
    totals.cacheRead += t.tokens.cacheRead;
    totals.cacheWrite += t.tokens.cacheWrite;
    const plan = planFor(t, windows);
    add(byModel, t.model, t.tokens);
    add(byPlan, plan, t.tokens);
    add(byPlanModel, `${plan} · ${t.model}`, t.tokens);
    const areas = t.areas.length ? t.areas : ["(no files)"];
    for (const a of areas) add(byArea, a, t.tokens, 1 / areas.length);
  }
  return {
    project,
    generatedAt: nowIso,
    source,
    sessions: sessions.size,
    turns: turns.length,
    skipped,
    totals,
    byModel: ranked(byModel),
    byPlan: ranked(byPlan),
    byArea: ranked(byArea),
    byPlanModel: ranked(byPlanModel),
  };
}

/** Every transcript in a harness project directory: the top-level session files plus each session's
 *  subagents. sessions.jsonl is PANTRY's own event log, not a transcript, and is left out. */
export async function listTranscripts(dir: string): Promise<{ file: string; subagent: boolean }[]> {
  if (!existsSync(dir)) return [];
  const out: { file: string; subagent: boolean }[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".jsonl") && e.name !== "sessions.jsonl") out.push({ file: join(dir, e.name), subagent: false });
    if (e.isDirectory()) {
      const sub = join(dir, e.name, "subagents");
      if (!existsSync(sub)) continue;
      for (const s of await readdir(sub)) if (s.endsWith(".jsonl")) out.push({ file: join(sub, s), subagent: true });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

export async function buildUsagePayload(opts: {
  project: string;
  root: string;
  configDir: string;
  claims: ClaimLine[];
  nowIso: string;
}): Promise<UsagePayload> {
  const dir = harnessProjectDir(opts.root, opts.configDir);
  const turns: UsageTurn[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const { file, subagent } of await listTranscripts(dir)) {
    const parsed = parseTranscript(await readFile(file, "utf8"), opts.root, subagent);
    skipped += parsed.skipped;
    for (const t of parsed.turns) {
      if (seen.has(t.messageId)) continue; // a resumed session repeats earlier messages
      seen.add(t.messageId);
      turns.push(t);
    }
  }
  return aggregateUsage(opts.project, dir, turns, claimWindows(opts.claims, Date.parse(opts.nowIso)), skipped, opts.nowIso);
}

/** A plain-text table for the CLI. */
export function formatUsage(p: UsagePayload): string {
  const n = (v: number) => v.toLocaleString("en-US");
  const table = (title: string, rows: UsageRow[]) =>
    [
      `\n${title}`,
      `  ${"".padEnd(36)} ${"turns".padStart(6)} ${"input".padStart(10)} ${"output".padStart(10)} ${"cache write".padStart(12)} ${"cache read".padStart(13)}`,
      ...rows.map((r) => `  ${r.key.slice(0, 36).padEnd(36)} ${String(r.turns).padStart(6)} ${n(r.input).padStart(10)} ${n(r.output).padStart(10)} ${n(r.cacheWrite).padStart(12)} ${n(r.cacheRead).padStart(13)}`),
    ].join("\n");
  return [
    `Token usage for ${p.project}: ${p.sessions} sessions, ${p.turns} turns, ${p.skipped} unreadable lines skipped`,
    `  from ${p.source}`,
    `  totals: input ${n(p.totals.input)}, output ${n(p.totals.output)}, cache write ${n(p.totals.cacheWrite)}, cache read ${n(p.totals.cacheRead)}`,
    table("By model", p.byModel),
    table("By plan", p.byPlan),
    table("By area (heuristic: top-level directory of the files each turn named)", p.byArea),
  ].join("\n");
}

/** The payload for a loaded project config. Claims come from the hub's home under the project's
 *  registry name; with no hub or no claims every turn is "(unclaimed)", which is still a true table. */
export async function buildUsageForConfig(
  config: { cwd: string; projectName: string },
  nowIso: string,
  env: Record<string, string | undefined> = process.env,
): Promise<UsagePayload> {
  const { harnessConfigDir } = await import("./context.ts");
  const { readRegistry, registryPath, projectFor } = await import("./hub.ts");
  const { claimsFile, readClaims } = await import("./orchestrator.ts");
  const home = env.PANTRY_HOME ?? join(homedir(), ".pantry");
  let project = env.PANTRY_PROJECT;
  if (!project) {
    try { project = projectFor(readRegistry(registryPath(env)), config.cwd)?.name; } catch { /* no registry */ }
  }
  const claims = project ? await readClaims(claimsFile(home, project)) : [];
  return buildUsagePayload({ project: project ?? config.projectName, root: config.cwd, configDir: harnessConfigDir(), claims, nowIso });
}
