// pantry/timeline-page.ts: the plan timeline, the project's history read from git. One row per plan,
// grouped by where it stands now, its bar split into the stretches it spent at each status. Under the
// plans, three strips on the same axis: commits, run reports and audits. Every date comes from git
// history, a run report, an audit report's modification time or "now"; nothing is forecast.
//
// It is drawn in HTML on the page's own tokens rather than as a standalone SVG, so it follows the
// theme and the dark scheme like every other surface, and the plan names are real links. Status is
// carried by fill weight and pattern plus a text label, never by hue alone.
import { escapeHtml as e } from "@tjakoen/mill/core/engine.ts";
import type { TimelinePayload, TimelinePlan } from "./timeline.ts";

export const isoDay = (iso: string): string => iso.slice(0, 10);
export const monthsRound = (days: number): number => Math.max(0, Math.round(days / 30));

const STATUS_ORDER = ["doing", "blocked", "todo", "done"] as const;
const STATUS_LABEL: Record<string, string> = { doing: "In progress", blocked: "Blocked", todo: "To do", done: "Done" };

// The ordered (date, status) waypoints a plan's bar is segmented at: `created` (with the first known
// status, or the plan's current status if history never captured one) followed by every later
// transition. Empty when the plan has no readable git history.
export function timelineWaypoints(p: TimelinePlan): { date: string; status: string }[] {
  if (!p.created) return [];
  const wp: { date: string; status: string }[] = [];
  if (!p.transitions.length || p.transitions[0].date !== p.created)
    wp.push({ date: p.created, status: p.transitions[0]?.status ?? p.status });
  for (const t of p.transitions) wp.push({ date: t.date, status: t.status });
  return wp;
}

// The bar's right edge: a done plan ends where it was marked done (or its last touch); anything else
// ends at its last git activity, or now when even that is unknown. Never a future date.
export function timelineEnd(p: TimelinePlan, generatedAt: string): string {
  if (p.status === "done") return p.done ?? p.lastActivity ?? generatedAt;
  return p.lastActivity ?? generatedAt;
}

export interface TimelineView { sort: "start" | "recent"; titles: Map<string, string> }

const DAY = 86_400_000;
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const pct = (t: number, from: number, span: number) => Math.min(100, Math.max(0, ((t - from) / span) * 100));

function bar(p: TimelinePlan, gen: string, from: number, span: number): string {
  const wp = timelineWaypoints(p);
  if (!wp.length) return `<div class="tl-track"><span class="tl-nohist">no git history</span></div>`;
  const end = Date.parse(timelineEnd(p, gen));
  const segs = wp.map((w, i) => {
    const a = Date.parse(w.date);
    const b = Math.max(i + 1 < wp.length ? Date.parse(wp[i + 1].date) : end, a + DAY / 2);
    const left = pct(a, from, span), width = Math.max(0.5, pct(b, from, span) - left);
    const label = `${STATUS_LABEL[w.status] ?? w.status} from ${fmtDay(w.date)}${i + 1 < wp.length ? ` to ${fmtDay(wp[i + 1].date)}` : ""}`;
    return `<span class="tl-seg" data-status="${e(w.status)}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="${e(label)}"></span>`;
  }).join("");
  const doneMark = p.status === "done" && p.done ? `<span class="tl-done" style="left:${pct(Date.parse(p.done), from, span).toFixed(2)}%" title="${e(`Done ${fmtDay(p.done)}`)}"></span>` : "";
  return `<div class="tl-track">${segs}${doneMark}</div>`;
}

function row(p: TimelinePlan, payload: TimelinePayload, view: TimelineView, from: number, span: number): string {
  const title = view.titles.get(p.id) ?? p.id;
  const start = p.created ? fmtDay(p.created) : "unknown";
  const took = p.created ? Math.max(1, Math.round((Date.parse(timelineEnd(p, payload.generatedAt)) - Date.parse(p.created)) / DAY)) : null;
  const meta = [
    p.status === "done" ? `${took ?? "?"}d, done ${p.done ? fmtDay(p.done) : ""}` : `started ${start}${p.lastActivity ? `, last touched ${fmtDay(p.lastActivity)}` : ""}`,
    p.depends.length ? `after ${p.depends.join(", ")}` : "",
    p.track ?? "",
  ].filter(Boolean).join(" · ");
  return `<div class="tl-row" data-status="${e(p.status)}">
  <div class="tl-name"><a href="/plan/${encodeURIComponent(p.id)}">${e(title)}</a><span class="tl-meta">${e(meta)}</span></div>
  ${bar(p, payload.generatedAt, from, span)}
</div>`;
}

function axis(from: number, span: number): string {
  const ticks: string[] = [];
  const d = new Date(from);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  const months = span / (30 * DAY);
  const every = months > 18 ? 3 : months > 9 ? 2 : 1;
  let i = 0;
  while (t <= from + span) {
    if (i++ % every === 0) {
      const label = new Date(t).toLocaleDateString("en-GB", { month: "short", year: new Date(t).getUTCMonth() === 0 || i === 1 ? "numeric" : undefined, timeZone: "UTC" });
      ticks.push(`<span class="tl-tick" style="left:${pct(t, from, span).toFixed(2)}%">${label}</span>`);
    }
    const n = new Date(t);
    t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1);
  }
  return `<div class="tl-row tl-axis"><div class="tl-name"></div><div class="tl-track">${ticks.join("")}<span class="tl-now" style="left:100%" title="now"></span></div></div>`;
}

function strip(label: string, note: string, marks: string): string {
  return `<div class="tl-row tl-strip"><div class="tl-name"><span>${label}</span><span class="tl-meta">${note}</span></div><div class="tl-track">${marks}</div></div>`;
}

export function timelineBody(payload: TimelinePayload, view: TimelineView = { sort: "start", titles: new Map() }): string {
  const head = `<header class="tl-head"><div><h1>Plan timeline</h1>
  <p class="cc-meta">How ${e(payload.project)}'s plans moved, read from git: when each was written, every status change, and when it was done. Commits, run reports and audits sit underneath on the same dates. Machine twin at <a href="/timeline.json">/timeline.json</a>.</p></div>
  <nav class="act-window" aria-label="Sort">${view.sort === "start" ? `<strong aria-current="true">By start</strong><a href="/timeline?sort=recent">By last touch</a>` : `<a href="/timeline">By start</a><strong aria-current="true">By last touch</strong>`}</nav>
</header>`;
  if (!payload.available || !payload.plans.length || !payload.axisStart) {
    return `<section class="tl">${head}<p class="cc-empty">${e(payload.reason ?? "No plans with git history yet.")}</p></section>`;
  }
  const from = Date.parse(payload.axisStart);
  const span = Math.max(DAY, Date.parse(payload.generatedAt) - from);
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, payload.plans.filter((p) => p.status === s).length]));
  const stats = `<div class="act-stats">
  <div><strong>${payload.plans.length}</strong><span>plans</span></div>
  <div><strong>${counts.doing}</strong><span>in progress</span></div>
  <div><strong>${counts.done}</strong><span>done</span></div>
  <div><strong>${monthsRound(payload.spanDays)}</strong><span>months of history</span></div>
  <div><strong>${payload.activeDays}</strong><span>days with commits</span></div>
</div>`;
  const legend = `<p class="act-legend">${STATUS_ORDER.map((s) => `<span class="act-key"><span class="tl-seg tl-key" data-status="${s}"></span>${STATUS_LABEL[s]}</span>`).join("")}<span class="act-key"><span class="tl-done tl-key"></span>marked done</span></p>`;
  const sortKey = (p: TimelinePlan) => view.sort === "recent" ? -(Date.parse(p.lastActivity ?? p.created ?? payload.generatedAt)) : Date.parse(p.created ?? payload.generatedAt);
  const groups = [...STATUS_ORDER, ...new Set(payload.plans.map((p) => p.status).filter((s) => !(STATUS_ORDER as readonly string[]).includes(s)))].map((status) => {
    const plans = payload.plans.filter((p) => p.status === status).toSorted((a, b) => sortKey(a) - sortKey(b));
    if (!plans.length) return "";
    const rows = plans.map((p) => row(p, payload, view, from, span)).join("");
    // Done is the long tail and the least actionable, so it starts folded once it has grown.
    const open = status !== "done" || plans.length <= 8 ? " open" : "";
    return `<details class="tl-group"${open}><summary><span class="tl-seg tl-key" data-status="${e(status)}"></span>${e(STATUS_LABEL[status] ?? status)} <span class="cc-count">${plans.length}</span></summary>${rows}</details>`;
  }).join("");
  const maxCommits = Math.max(1, ...payload.density.map((d) => d.count));
  const bucketMs = payload.densityBucket === "week" ? 7 * DAY : DAY;
  const commits = payload.density.map((d) => {
    const left = pct(Date.parse(d.date), from, span), width = Math.max(0.3, (bucketMs / span) * 100);
    return `<span class="tl-dens" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;height:${Math.max(8, (d.count / maxCommits) * 100).toFixed(0)}%" title="${e(`${d.count} commit(s), ${payload.densityBucket} of ${fmtDay(d.date)}`)}"></span>`;
  }).join("");
  const runs = payload.runActivity.map((d) => `<span class="tl-pin" style="left:${pct(Date.parse(d.date), from, span).toFixed(2)}%" title="${e(`${d.count} run report(s), ${fmtDay(d.date)}`)}"></span>`).join("");
  const audits = payload.auditMarkers.map((a) => `<span class="tl-pin is-audit" style="left:${pct(Date.parse(a.date), from, span).toFixed(2)}%" title="${e(`${a.label}, ${fmtDay(a.date)}`)}"></span>`).join("");
  const strips = `<div class="tl-strips">
  ${strip("Commits", `per ${payload.densityBucket}`, commits)}
  ${payload.runsEnabled ? strip("Run reports", `${payload.runDatedCount} dated`, runs) : ""}
  ${payload.auditMarkers.length ? strip("Audits", `${payload.auditMarkers.length}`, audits) : ""}
</div>`;
  return `<section class="tl">${head}${stats}${legend}
<div class="act-sticky">${axis(from, span)}</div>
${groups}
${strips}
</section>`;
}
