// pantry/activity.ts: the session timeline. What ran in this project over a window, which plan each
// session was working on, which subagents it spawned and what they were asked to do, which files it
// wrote and when, and where everything sat idle. It answers "what did my AI do while I was away?",
// which the command center cannot, because the command center is about now.
//
// It is a projection of the same session log the command center reads, folded differently: the
// command center keeps one row per session, and this keeps the times. A session is a card with one
// track on a shared axis; its bars are the stretches it was busy, split wherever it went quiet for
// longer than IDLE_GAP_MS, and a tick on the bar marks each file written. Subagents are tracks under
// their parent. Nothing here writes, and nothing runs a model.
import { escapeHtml as e } from "@tjakoen/mill/core/engine.ts";
import { readSessionLog, planTouchesPath, type SessionEvent } from "./sessions.ts";
import type { PlanLike } from "./orchestrator.ts";
import type { ResolvedPantryConfig } from "./config.ts";
import { basename, relative, resolve } from "node:path";

/** A stretch with no event longer than this splits a bar, because nobody calls twenty minutes of
 *  silence "working". Long enough that a slow test run does not break a bar in two. */
export const IDLE_GAP_MS = 15 * 60_000;
/** The windows the page offers, in hours. A day is the default: "since I last looked". */
export const ACTIVITY_WINDOWS = [6, 24, 72, 168] as const;
/** A bar shorter than this is widened to it, so a subagent that ran for four seconds is still visible. */
const MIN_BAR_MS = 60_000;

export interface Segment { from: string; to: string; events: number }
export interface Write { path: string; at: string; by: string | null }

export interface ActivityLane {
  id: string;
  /** "session", or the subagent's type when this lane is a subagent */
  label: string;
  /** the worktree folder name, which is the nearest thing a session has to a title */
  worktree: string | null;
  /** what the subagent was asked to do; null on a session lane */
  task: string | null;
  /** the plans whose touches this lane's writes fall inside, so the lane says what it was working on */
  plans: string[];
  segments: Segment[];
  firstAt: string;
  lastAt: string;
  /** milliseconds inside bars, never the wall-clock span */
  busyMs: number;
  /** true when the lane stopped (SessionEnd, SubagentStop) rather than going quiet */
  ended: boolean;
  /** files written, repo-relative, first write first; a session's list includes its subagents' */
  writes: Write[];
  /** tool name to the number of calls seen. Sampled: the hook drops a read within ten seconds of the last event */
  tools: Record<string, number>;
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
  agentCount: number;
  fileCount: number;
  /** plan id to the number of sessions that wrote inside it, busiest first */
  planTouches: { id: string; title: string; sessions: number }[];
}

interface LaneAcc {
  id: string; label: string; task: string | null; worktree: string | null; times: number[]; ended: boolean;
  writes: Map<string, Write>; tools: Map<string, number>; agents: Map<string, LaneAcc>;
}

const newAcc = (id: string, label: string): LaneAcc =>
  ({ id, label, task: null, worktree: null, times: [], ended: false, writes: new Map(), tools: new Map(), agents: new Map() });

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

const busyOf = (segs: Segment[]) => segs.reduce((n, s) => n + Math.max(MIN_BAR_MS, Date.parse(s.to) - Date.parse(s.from)), 0);

/** The pure fold, so the tests hand it events and plans directly. */
export function assembleActivity(input: {
  events: SessionEvent[]; plans: PlanLike[]; repoRoot: string; now: string; windowHours: number; project: string; present: boolean;
}): ActivityPayload {
  const to = Date.parse(input.now);
  const from = to - input.windowHours * 3600_000;
  const want = resolve(input.repoRoot);
  const rel = (p: string) => { const r = relative(want, resolve(p)); return r.startsWith("..") ? p : r; };
  const sessions = new Map<string, LaneAcc>();
  for (const ev of input.events) {
    if (resolve(ev.cwd) !== want) continue;
    const t = Date.parse(ev.at);
    if (t < from || t > to + 60_000) continue;
    let s = sessions.get(ev.session);
    if (!s) { s = newAcc(ev.session, "session"); sessions.set(ev.session, s); }
    if (ev.worktree && !s.worktree) s.worktree = basename(ev.worktree);
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
    if (ev.kind === "tool" && ev.tool) lane.tools.set(ev.tool, (lane.tools.get(ev.tool) ?? 0) + 1);
    if (ev.path) {
      const w: Write = { path: rel(ev.path), at: ev.at, by: ev.agent ? (ev.agentType ?? "subagent") : null };
      if (!lane.writes.has(w.path)) lane.writes.set(w.path, w);
      if (lane !== s && !s.writes.has(w.path)) s.writes.set(w.path, w);
    }
  }
  const plansFor = (writes: Map<string, Write>) =>
    input.plans.filter((p) => (p.touches ?? []).length && [...writes.values()].some((w) => planTouchesPath(p.touches ?? [], input.repoRoot, resolve(want, w.path)))).map((p) => p.id);
  const toLane = (a: LaneAcc): ActivityLane => {
    const times = a.times.toSorted((x, y) => x - y);
    const segments = segmentsOf(times);
    return {
      id: a.id, label: a.label, worktree: a.worktree, task: a.task, plans: plansFor(a.writes), segments,
      firstAt: new Date(times[0]).toISOString(), lastAt: new Date(times.at(-1)!).toISOString(),
      busyMs: busyOf(segments), ended: a.ended,
      writes: [...a.writes.values()].sort((x, y) => x.at.localeCompare(y.at)),
      tools: Object.fromEntries([...a.tools.entries()].sort((x, y) => y[1] - x[1])),
      agents: [...a.agents.values()].filter((x) => x.times.length).map(toLane).sort((x, y) => Date.parse(x.firstAt) - Date.parse(y.firstAt)),
    };
  };
  const lanes = [...sessions.values()].filter((s) => s.times.length).map(toLane).sort((x, y) => Date.parse(y.lastAt) - Date.parse(x.lastAt));
  const touchCount = new Map<string, number>();
  for (const l of lanes) for (const p of l.plans) touchCount.set(p, (touchCount.get(p) ?? 0) + 1);
  const title = new Map(input.plans.map((p) => [p.id, p.title ?? p.id]));
  return {
    generated: input.now, project: input.project, windowHours: input.windowHours,
    from: new Date(from).toISOString(), to: input.now, present: input.present,
    lanes, agentCount: lanes.reduce((n, l) => n + l.agents.length, 0),
    fileCount: new Set(lanes.flatMap((l) => l.writes.map((w) => w.path))).size,
    planTouches: [...touchCount.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, title: title.get(id) ?? id, sessions: n })),
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

/** Local wall-clock time in the viewer's zone is not knowable server-side, so the page writes UTC
 *  into datetime attributes and a small script rewrites them; the UTC text is the no-script fallback. */
const clock = (iso: string) => `<time datetime="${iso}" data-local="time">${iso.slice(11, 16)}</time>`;
const dayClock = (iso: string) => `<time datetime="${iso}" data-local="day">${iso.slice(5, 10)} ${iso.slice(11, 16)}</time>`;
const dur = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
};
const pos = (iso: string, from: number, span: number) => ((Date.parse(iso) - from) / span) * 100;

function track(lane: ActivityLane, from: number, span: number): string {
  const bars = lane.segments.map((s) => {
    const a = Date.parse(s.from), b = Math.max(Date.parse(s.to), a + MIN_BAR_MS);
    const left = Math.max(0, ((a - from) / span) * 100), width = Math.max(0.4, ((b - a) / span) * 100);
    const label = `${s.from.slice(11, 16)} to ${s.to.slice(11, 16)} UTC, ${dur(Date.parse(s.to) - a)}`;
    return `<span class="act-bar" style="left:${left.toFixed(2)}%;width:${Math.min(width, 100 - left).toFixed(2)}%" title="${e(label)}"></span>`;
  }).join("");
  const ticks = lane.writes.map((w) => `<span class="act-write" style="left:${pos(w.at, from, span).toFixed(2)}%" title="${e(`${w.at.slice(11, 16)} UTC: wrote ${w.path}`)}"></span>`).join("");
  return `<div class="act-track">${bars}${ticks}</div>`;
}

function toolLine(tools: Record<string, number>): string {
  const list = Object.entries(tools);
  if (!list.length) return "";
  return list.slice(0, 6).map(([t, n]) => `${e(t)} ${n}`).join(" · ") + (list.length > 6 ? ` · ${list.length - 6} more` : "");
}

/** One plain sentence for the card: what this session did, in the terms a person asks about. */
export function laneSummary(l: ActivityLane): string {
  const bits: string[] = [];
  bits.push(l.writes.length ? `Wrote ${l.writes.length} file${l.writes.length === 1 ? "" : "s"}` : "Read and ran commands, wrote nothing");
  if (l.plans.length) bits.push(`inside ${l.plans.length === 1 ? "plan" : "plans"} ${l.plans.join(", ")}`);
  else if (l.writes.length) bits.push("outside every plan");
  if (l.agents.length) bits.push(`ran ${l.agents.length} subagent${l.agents.length === 1 ? "" : "s"}`);
  return bits.join(", ") + ".";
}

function agentRow(a: ActivityLane, from: number, span: number): string {
  return `<div class="act-row is-agent${a.ended ? " is-ended" : ""}">
  <div class="act-name"><span class="act-type">${e(a.label)}</span><span class="act-task">${a.task ? e(a.task) : "no task recorded"}</span>
  <span class="act-meta">${clock(a.firstAt)} · ${dur(a.busyMs)}${a.writes.length ? ` · ${a.writes.length} write(s)` : ""}${a.ended ? "" : " · still going"}</span></div>
  ${track(a, from, span)}
</div>`;
}

function sessionCard(l: ActivityLane, from: number, span: number): string {
  const live = !l.ended && Date.now() - Date.parse(l.lastAt) < 5 * 60_000;
  const title = l.worktree ?? "main checkout";
  const state = l.ended ? "ended" : live ? "live" : `quiet since ${l.lastAt.slice(11, 16)} UTC`;
  const plans = l.plans.map((p) => `<a class="act-chip" href="/plan/${encodeURIComponent(p)}">${e(p)}</a>`).join("");
  const files = l.writes.length
    ? `<ol class="act-files">${l.writes.map((w) => `<li>${clock(w.at)} <code>${e(w.path)}</code>${w.by ? ` <span class="act-by">by ${e(w.by)}</span>` : ""}</li>`).join("")}</ol>`
    : `<p class="cc-meta">No files written.</p>`;
  const agents = l.agents.length
    ? `<ul class="act-agentlist">${l.agents.map((a) => `<li><strong>${e(a.label)}</strong> ${a.task ? e(a.task) : "<em>no task recorded</em>"} <span class="act-meta">${clock(a.firstAt)}, ${dur(a.busyMs)}${toolLine(a.tools) ? `, ${toolLine(a.tools)}` : ""}</span></li>`).join("")}</ul>` : "";
  return `<article class="act-card${live ? " is-live" : ""}${l.ended ? " is-ended" : ""}">
  <header class="act-card-head">
    <div><h2>${live ? `<span class="cc-dot" aria-hidden="true"></span>` : ""}${e(title)}</h2>
    <p class="act-meta"><code>${e(l.id.slice(0, 8))}</code> · ${dayClock(l.firstAt)} to ${clock(l.lastAt)} · busy ${dur(l.busyMs)} · ${e(state)}</p></div>
    <div class="act-chips">${plans}</div>
  </header>
  <p class="act-summary">${e(laneSummary(l))}</p>
  <div class="act-row is-session"><div class="act-name"><span class="act-type">session</span></div>${track(l, from, span)}</div>
  ${l.agents.map((a) => agentRow(a, from, span)).join("")}
  <details class="act-detail"><summary>What it did</summary>
    <div class="act-detail-grid">
      <section><h3>Files written</h3>${files}</section>
      <section><h3>Tools seen</h3><p class="cc-meta">${toolLine(l.tools) || "none recorded"}</p><p class="cc-meta">Sampled: a run of reads within ten seconds is logged once.</p>
      ${agents ? `<h3>Subagents</h3>${agents}` : ""}</section>
    </div>
  </details>
</article>`;
}

function axis(from: number, span: number, hours: number): string {
  const step = hours <= 6 ? 1 : hours <= 24 ? 3 : hours <= 72 ? 12 : 24;
  const ticks: string[] = [];
  const first = Math.ceil(from / (step * 3600_000)) * step * 3600_000;
  for (let t = first; t <= from + span; t += step * 3600_000) {
    const iso = new Date(t).toISOString();
    ticks.push(`<span class="act-tick" style="left:${(((t - from) / span) * 100).toFixed(2)}%">${step >= 12 ? dayClock(iso) : clock(iso)}</span>`);
  }
  return `<div class="act-row act-axis"><div class="act-name"></div><div class="act-track">${ticks.join("")}<span class="act-now" style="left:100%" title="now"></span></div></div>`;
}

const LOCAL_TIME_SCRIPT = `<script>for(const t of document.querySelectorAll("time[data-local]")){const d=new Date(t.dateTime);if(isNaN(d))continue;const hm=d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",hour12:false});t.textContent=t.dataset.local==="day"?d.toLocaleDateString([], {month:"short",day:"numeric"})+" "+hm:hm;}</script>`;

export function activityBody(p: ActivityPayload): string {
  const from = Date.parse(p.from), span = Date.parse(p.to) - from;
  const pick = (h: number) => {
    const label = h === 168 ? "7d" : `${h}h`;
    return h === p.windowHours ? `<strong aria-current="true">${label}</strong>` : `<a href="/activity?hours=${h}">${label}</a>`;
  };
  const busiest = p.planTouches[0];
  const stats = `<div class="act-stats">
  <div><strong>${p.lanes.length}</strong><span>sessions</span></div>
  <div><strong>${p.agentCount}</strong><span>subagents</span></div>
  <div><strong>${p.fileCount}</strong><span>files written</span></div>
  <div><strong>${busiest ? e(busiest.id) : "none"}</strong><span>${busiest ? `busiest plan, ${busiest.sessions} session(s)` : "no plan was written inside"}</span></div>
</div>`;
  const head = `<header class="act-head">
  <div><h1>Activity</h1>
  <p class="cc-meta">What the AI did in ${e(p.project)}: each session, the plans it wrote inside, the files it touched and the subagents it ran. Times are in your time zone.</p></div>
  <nav class="act-window" aria-label="Window">${ACTIVITY_WINDOWS.map(pick).join("")}</nav>
</header>`;
  const legend = `<p class="act-legend"><span class="act-key"><span class="act-bar"></span>working</span><span class="act-key"><span class="act-write"></span>a file written</span><span class="act-key"><span class="act-gap"></span>quiet ${IDLE_GAP_MS / 60_000}m or more</span></p>`;
  if (!p.lanes.length) {
    return `<section class="act">${head}<p class="cc-empty">${p.present ? "Nothing ran here in this window. Try a longer one." : "No session log yet. The session-event hook writes it; see INSTALL.md."}</p></section>`;
  }
  return `<section class="act">${head}${stats}${legend}
<div class="act-sticky">${axis(from, span, p.windowHours)}</div>
${p.lanes.map((l) => sessionCard(l, from, span)).join("")}
</section>${LOCAL_TIME_SCRIPT}`;
}
