// pantry/activity.ts: the session timeline. What ran in this project over the last day, which plan
// each session was working on, which subagents it spawned and what they were asked to do, and where
// everything sat idle. It answers "what did my AI do while I was away?", which the command center
// cannot, because the command center is about now.
//
// It is a projection of the same session log the command center reads, folded differently: the
// command center keeps one row per session, and this keeps the times. A lane is a session; its bars
// are the stretches it was busy, split wherever it went quiet for longer than IDLE_GAP_MS. Subagents
// are lanes nested under their parent, drawn the same way. Nothing here writes, and nothing runs a
// model.
import { escapeHtml as e } from "@tjakoen/mill/core/engine.ts";
import { readSessionLog, planTouchesPath, type SessionEvent } from "./sessions.ts";
import type { PlanLike } from "./orchestrator.ts";
import type { ResolvedPantryConfig } from "./config.ts";
import { resolve } from "node:path";

/** A stretch with no event longer than this splits a bar, because nobody calls twenty minutes of
 *  silence "working". Long enough that a slow test run does not break a bar in two. */
export const IDLE_GAP_MS = 15 * 60_000;
/** The windows the page offers, in hours. A day is the default: "since I last looked". */
export const ACTIVITY_WINDOWS = [6, 24, 72] as const;
/** A bar shorter than this is widened to it, so a subagent that ran for four seconds is still visible. */
const MIN_BAR_MS = 60_000;

export interface Segment { from: string; to: string; events: number }

export interface ActivityLane {
  id: string;
  /** "session", or the subagent's type when this lane is a subagent */
  label: string;
  /** what the subagent was asked to do; null on a session lane */
  task: string | null;
  /** the plans whose touches this lane's writes fall inside, so the lane says what it was working on */
  plans: string[];
  segments: Segment[];
  firstAt: string;
  lastAt: string;
  /** true when the lane stopped (SessionEnd, SubagentStop) rather than going quiet */
  ended: boolean;
  writes: number;
  agents: ActivityLane[];
}

export interface ActivityPayload {
  generated: string;
  project: string;
  windowHours: number;
  from: string;
  to: string;
  present: boolean;
  lanes: ActivityLane[];
  /** subagents across every lane, so the page can say the count without walking the tree */
  agentCount: number;
}

interface LaneAcc { id: string; label: string; task: string | null; times: number[]; ended: boolean; paths: Set<string>; agents: Map<string, LaneAcc> }

const newAcc = (id: string, label: string): LaneAcc => ({ id, label, task: null, times: [], ended: false, paths: new Set(), agents: new Map() });

/** Split a sorted list of event times into busy stretches. */
export function segmentsOf(times: number[], gap = IDLE_GAP_MS): Segment[] {
  const out: Segment[] = [];
  let start = -1, last = -1, n = 0;
  for (const t of times) {
    if (start < 0) { start = last = t; n = 1; continue; }
    if (t - last > gap) {
      out.push({ from: new Date(start).toISOString(), to: new Date(last).toISOString(), events: n });
      start = t; n = 0;
    }
    last = t; n++;
  }
  if (start >= 0) out.push({ from: new Date(start).toISOString(), to: new Date(last).toISOString(), events: n });
  return out;
}

/** The pure fold, so the tests hand it events and plans directly. */
export function assembleActivity(input: {
  events: SessionEvent[]; plans: PlanLike[]; repoRoot: string; now: string; windowHours: number; project: string; present: boolean;
}): ActivityPayload {
  const to = Date.parse(input.now);
  const from = to - input.windowHours * 3600_000;
  const want = resolve(input.repoRoot);
  const sessions = new Map<string, LaneAcc>();
  for (const ev of input.events) {
    if (resolve(ev.cwd) !== want) continue;
    const t = Date.parse(ev.at);
    if (t < from || t > to + 60_000) continue;
    let s = sessions.get(ev.session);
    if (!s) { s = newAcc(ev.session, "session"); sessions.set(ev.session, s); }
    let lane = s;
    if (ev.agent) {
      let a = s.agents.get(ev.agent);
      if (!a) { a = newAcc(ev.agent, ev.agentType ?? "subagent"); s.agents.set(ev.agent, a); }
      if (ev.agentType && a.label === "subagent") a.label = ev.agentType;
      if (ev.task && !a.task) a.task = ev.task;
      lane = a;
    }
    lane.times.push(t);
    if (ev.kind === "stop" || ev.kind === "agent-stop") lane.ended = true;
    if (ev.path) { lane.paths.add(ev.path); if (lane !== s) s.paths.add(ev.path); }
  }
  const plansFor = (paths: Set<string>) =>
    input.plans.filter((p) => (p.touches ?? []).length && [...paths].some((f) => planTouchesPath(p.touches ?? [], input.repoRoot, f))).map((p) => p.id);
  const toLane = (a: LaneAcc): ActivityLane => {
    const times = a.times.toSorted((x, y) => x - y);
    return {
      id: a.id, label: a.label, task: a.task, plans: plansFor(a.paths), segments: segmentsOf(times),
      firstAt: new Date(times[0]).toISOString(), lastAt: new Date(times.at(-1)!).toISOString(),
      ended: a.ended, writes: a.paths.size,
      agents: [...a.agents.values()].filter((x) => x.times.length).map(toLane).sort((x, y) => Date.parse(x.firstAt) - Date.parse(y.firstAt)),
    };
  };
  const lanes = [...sessions.values()].filter((s) => s.times.length).map(toLane).sort((x, y) => Date.parse(y.lastAt) - Date.parse(x.lastAt));
  return {
    generated: input.now, project: input.project, windowHours: input.windowHours,
    from: new Date(from).toISOString(), to: input.now, present: input.present,
    lanes, agentCount: lanes.reduce((n, l) => n + l.agents.length, 0),
  };
}

export async function buildActivity(config: ResolvedPantryConfig, now: string, windowHours: number): Promise<ActivityPayload> {
  const log = await readSessionLog(config.sessionsLog);
  const { loadProjectWork } = await import("./orchestrator.ts");
  const work = await loadProjectWork(config.cwd).catch(() => ({ plans: [] as PlanLike[] }));
  return assembleActivity({
    events: log.events, plans: work.plans, repoRoot: config.cwd, now, windowHours,
    project: config.projectName, present: log.events.length > 0 || !log.readError,
  });
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

const clock = (iso: string) => iso.slice(11, 16);
const dur = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

function bars(lane: ActivityLane, from: number, span: number): string {
  return lane.segments.map((s) => {
    const a = Date.parse(s.from), b = Math.max(Date.parse(s.to), a + MIN_BAR_MS);
    const left = ((a - from) / span) * 100, width = Math.max(0.4, ((b - a) / span) * 100);
    const label = `${clock(s.from)} to ${clock(s.to)} UTC, ${dur(Date.parse(s.to) - a)}, ${s.events} event(s)`;
    return `<span class="act-bar" style="left:${left.toFixed(2)}%;width:${Math.min(width, 100 - left).toFixed(2)}%" title="${e(label)}"></span>`;
  }).join("");
}

function laneRow(lane: ActivityLane, from: number, span: number, nested: boolean): string {
  const busy = lane.segments.reduce((n, s) => n + Math.max(MIN_BAR_MS, Date.parse(s.to) - Date.parse(s.from)), 0);
  const name = nested
    ? `<span class="act-type">${e(lane.label)}</span>${lane.task ? ` <span class="act-task">${e(lane.task)}</span>` : ""}`
    : `<code>${e(lane.id.slice(0, 8))}</code>`;
  const plans = lane.plans.length
    ? lane.plans.map((p) => `<a href="/plan/${encodeURIComponent(p)}">${e(p)}</a>`).join(", ")
    : lane.writes ? "no plan" : "read only";
  const meta = `${plans} · busy ${dur(busy)}${lane.agents.length ? ` · ${lane.agents.length} subagent(s)` : ""}${lane.ended ? " · ended" : ""}`;
  return `<div class="act-lane${nested ? " is-agent" : ""}${lane.ended ? " is-ended" : ""}">
  <div class="act-name">${name}<span class="act-meta">${meta}</span></div>
  <div class="act-track">${bars(lane, from, span)}</div>
</div>`;
}

function axis(from: number, span: number, hours: number): string {
  const step = hours <= 6 ? 1 : hours <= 24 ? 3 : 12;
  const ticks: string[] = [];
  const first = Math.ceil(from / (step * 3600_000)) * step * 3600_000;
  for (let t = first; t <= from + span; t += step * 3600_000) {
    const iso = new Date(t).toISOString();
    const label = step >= 12 ? `${iso.slice(5, 10)} ${clock(iso)}` : clock(iso);
    ticks.push(`<span class="act-tick" style="left:${(((t - from) / span) * 100).toFixed(2)}%">${label}</span>`);
  }
  return `<div class="act-lane act-axis"><div class="act-name"><span class="act-meta">UTC</span></div><div class="act-track">${ticks.join("")}</div></div>`;
}

export function activityBody(p: ActivityPayload): string {
  const from = Date.parse(p.from), span = Date.parse(p.to) - from;
  const pick = (h: number) => h === p.windowHours ? `<strong>${h}h</strong>` : `<a href="/activity?hours=${h}">${h}h</a>`;
  const head = `<header class="act-head">
  <h1>Activity</h1>
  <p class="cc-meta">Sessions and their subagents in ${e(p.project)} over the last ${p.windowHours} hours. A bar is a stretch of work; a gap is ${IDLE_GAP_MS / 60_000} minutes or more of silence. Window: ${ACTIVITY_WINDOWS.map(pick).join(" · ")}</p>
  <p class="act-sum">${p.lanes.length} session(s), ${p.agentCount} subagent(s)</p>
</header>`;
  if (!p.lanes.length) {
    return `<section class="act">${head}<p class="cc-empty">${p.present ? "Nothing ran here in this window." : "No session log yet. The session-event hook writes it; see INSTALL.md."}</p></section>`;
  }
  const rows = p.lanes.map((l) => laneRow(l, from, span, false) + l.agents.map((a) => laneRow(a, from, span, true)).join("")).join("");
  return `<section class="act">${head}<div class="act-chart">${axis(from, span, p.windowHours)}${rows}</div></section>`;
}
