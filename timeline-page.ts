// pantry/timeline-page.ts, split out of app.ts. The page markup for one surface; app.ts keeps the routing.
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { buildTimelinePayload, type TimelinePayload, type TimelinePlan } from "./timeline.ts";

// /timeline (piece 11e sub-unit 3) — the RETROSPECTIVE project timeline: one bar per plan spanning its
// git-derived created→end span, `depends` arrows between bars, commit and run activity, and dated
// audit-report markers. Same model (buildTimelinePayload) backs both the SVG and the
// machine twin at /timeline.json, so they never drift. Built to the FIGURES data-viz scaffold: a
// self-contained e-ink palette on the root, one coral accent (the "now" marker), no <style> block, no
// hardcoded hex below the root, status shown by a within-family fill tone AND a direct text label (not
// colour-alone). NO forecast, NO projected bar, NO "target" date anywhere — every date drawn comes
// from git history, a run report, an audit-report mtime, or generatedAt ("now"). An absent git repo /
// no plans degrades to guidance, never a crash — same posture as every other absent-source surface.
export const isoDay = (iso: string): string => iso.slice(0, 10);
export const monthsRound = (days: number): number => Math.max(0, Math.round(days / 30));

// The within-family fill tones for the four PROOF statuses — never the sole signal (every bar also
// carries a direct text label of its status, per FIGURES' colour-not-alone rule).
export const STATUS_TONE: Record<string, string> = {
  todo: "var(--bar)", doing: "var(--muted)", done: "var(--ink)", blocked: "var(--edge)",
};

// The ordered (date, status) waypoints a plan's bar is segmented at: `created` (with the first known
// status, or the plan's current status if history never captured one) followed by every later
// transition. Empty when the plan has no readable git history (created is null) — the row then renders
// a "no git history" note instead of a bar.
export function timelineWaypoints(p: TimelinePlan): { date: string; status: string }[] {
  if (!p.created) return [];
  const wp: { date: string; status: string }[] = [];
  if (!p.transitions.length || p.transitions[0].date !== p.created)
    wp.push({ date: p.created, status: p.transitions[0]?.status ?? p.status });
  for (const t of p.transitions) wp.push({ date: t.date, status: t.status });
  return wp;
}

// The bar's right edge: a done plan's bar ends where it was marked done (or its last touch, as a
// fallback); anything else — still open, or a plan that moved on from done again — ends at its last
// git activity, or generatedAt ("now") when even that is unknown. Never a future date.
export function timelineEnd(p: TimelinePlan, generatedAt: string): string {
  if (p.status === "done") return p.done ?? p.lastActivity ?? generatedAt;
  return p.lastActivity ?? generatedAt;
}

export function timelineSvg(payload: TimelinePayload): string {
  const plans = payload.plans;
  const minIso = payload.axisStart ?? payload.generatedAt;
  const minT = new Date(minIso).getTime();
  const maxT = new Date(payload.generatedAt).getTime();
  const span = Math.max(maxT - minT, 86_400_000); // never a zero/negative span (avoids a NaN scale)
  const CANVAS_W = 620, ML = 134, MR = 78, PW = CANVAS_W - ML - MR;
  const x = (iso: string): number => {
    const t = new Date(iso).getTime();
    const f = Number.isFinite(t) ? Math.min(1, Math.max(0, (t - minT) / span)) : 0;
    return ML + f * PW;
  };
  const ROW_H = 20, BAR_H = 10;
  const byId = new Map(plans.map((p) => [p.id, p]));

  let y = 8;
  const titleY = (y += 14);
  const legendY = (y += 20);
  const rowsTop = (y += 12);
  const rowSvg: string[] = [];
  plans.forEach((p, i) => {
    const cy = rowsTop + i * ROW_H + ROW_H / 2;
    const label = p.id.length > 20 ? `${p.id.slice(0, 19)}…` : p.id;
    rowSvg.push(`<text x="4" y="${(cy + 4).toFixed(1)}" style="fill:var(--ink);font-size:14px">${escapeHtml(label)}</text>`);
    const waypoints = timelineWaypoints(p);
    if (!p.created || waypoints.length === 0) {
      rowSvg.push(`<text x="${ML}" y="${(cy + 4).toFixed(1)}" style="fill:var(--muted);font-size:12.5px">no git history</text>`);
      return;
    }
    const end = timelineEnd(p, payload.generatedAt);
    // depends arrows: a thin connector from each dependency's own bar-end into this plan's start
    for (const dep of p.depends) {
      const di = plans.findIndex((o) => o.id === dep);
      const depPlan = byId.get(dep);
      if (di === -1 || !depPlan || !depPlan.created) continue;
      const x0 = x(timelineEnd(depPlan, payload.generatedAt));
      const y0 = rowsTop + di * ROW_H + ROW_H / 2;
      const x1 = x(p.created), y1 = cy;
      rowSvg.push(`<path d="M${x0.toFixed(1)},${y0.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)}" style="fill:none;stroke:var(--muted);stroke-width:0.75;opacity:0.6"/>`);
      rowSvg.push(`<path d="M${(x1 - 4).toFixed(1)},${(y1 - 2.5).toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} L${(x1 - 4).toFixed(1)},${(y1 + 2.5).toFixed(1)}" style="fill:none;stroke:var(--muted);stroke-width:0.75;opacity:0.6"/>`);
    }
    for (let s = 0; s < waypoints.length; s++) {
      const segStart = waypoints[s].date;
      const segEnd = waypoints[s + 1]?.date ?? end;
      const x0 = x(segStart), x1 = Math.max(x(segEnd), x0 + 1);
      const tone = STATUS_TONE[waypoints[s].status] ?? "var(--muted)";
      const outline = waypoints[s].status === "blocked" ? "var(--muted)" : "var(--edge)";
      rowSvg.push(`<rect x="${x0.toFixed(1)}" y="${(cy - BAR_H / 2).toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${BAR_H}" rx="2" style="fill:${tone};stroke:${outline};stroke-width:0.75"><title>${escapeHtml(p.id)} — ${escapeHtml(waypoints[s].status)}, ${escapeHtml(isoDay(segStart))} to ${escapeHtml(isoDay(segEnd))}</title></rect>`);
    }
    // the status label — never colour-alone; the word itself is the signal, the tone is a reinforcement
    rowSvg.push(`<text x="${(x(end) + 5).toFixed(1)}" y="${(cy + 4).toFixed(1)}" style="fill:var(--muted);font-size:12.5px">${escapeHtml(waypoints[waypoints.length - 1].status)}</text>`);
  });
  y = rowsTop + plans.length * ROW_H + 6;
  const axisY = y;
  const axisLabelY = (y += 16);
  const densityY = (y += 10);
  const DENSITY_H = 16;
  const maxCount = Math.max(1, ...payload.density.map((d) => d.count));
  const densitySvg = payload.density.map((d) => {
    const bx = x(d.date);
    const h = 2 + (d.count / maxCount) * (DENSITY_H - 2);
    return `<rect x="${(bx - 1).toFixed(1)}" y="${(densityY + DENSITY_H - h).toFixed(1)}" width="2" height="${h.toFixed(1)}" style="fill:var(--bar)"><title>${escapeHtml(d.date)}: ${d.count} commit${d.count === 1 ? "" : "s"}</title></rect>`;
  }).join("");
  y += DENSITY_H + 6;
  const densityLabelY = (y += 10);
  y += 6;

  let runSvg = "";
  if (payload.runsEnabled) {
    const RUN_H = 12;
    const runY = (y += 10);
    const maxRuns = Math.max(1, ...payload.runActivity.map((d) => d.count));
    const runBars = payload.runActivity.map((d) => {
      const bx = x(d.date);
      const h = 2 + (d.count / maxRuns) * (RUN_H - 2);
      return `<rect x="${(bx - 1.5).toFixed(1)}" y="${(runY + RUN_H - h).toFixed(1)}" width="3" height="${h.toFixed(1)}" style="fill:var(--ink)"><title>${escapeHtml(d.date)}: ${d.count} run close${d.count === 1 ? "" : "s"}</title></rect>`;
    }).join("");
    y += RUN_H + 6;
    const runLabelY = (y += 10);
    y += 6;
    runSvg = `<text x="14" y="${runLabelY}" style="fill:var(--muted);font-size:12.5px">run closes</text>${runBars}`;
  }

  // audit markers — thin ticks on the axis; a native <title> carries the label + date (no JS needed)
  const markerSvg = payload.auditMarkers.map((m) => {
    const mx = x(m.date);
    return `<line x1="${mx.toFixed(1)}" y1="${(axisY - 5).toFixed(1)}" x2="${mx.toFixed(1)}" y2="${(axisY + 5).toFixed(1)}" style="stroke:var(--ink);stroke-width:1"><title>${escapeHtml(m.label)} — ${escapeHtml(isoDay(m.date))}</title></line>`;
  }).join("");

  // "now" marker — the ONE coral accent, used exactly once (the FIGURES non-negotiable); the label
  // beside it stays on the neutral palette so the accent reads as a single mark, not a repeated hue.
  const nowX = x(payload.generatedAt);
  const nowSvg = `<line x1="${nowX.toFixed(1)}" y1="${(rowsTop - 6).toFixed(1)}" x2="${nowX.toFixed(1)}" y2="${(axisY + 5).toFixed(1)}" style="stroke:var(--accent);stroke-width:1"/>
  <text x="${nowX.toFixed(1)}" y="${(rowsTop - 10).toFixed(1)}" text-anchor="middle" style="fill:var(--muted);font-size:12.5px">now</text>`;

  const payoffY = (y += 14);
  const H = Math.round(y + 10);

  const doneCount = plans.filter((p) => p.status === "done").length;
  const activeCount = plans.length - doneCount;
  const months = monthsRound(payload.spanDays);
  const runDescription = payload.runsEnabled
    ? `; ${payload.runDatedCount} dated run reports shown across ${payload.runActivity.length} ${payload.densityBucket === "day" ? "days" : "weeks"}`
    : "";
  const ariaLabel = `Retrospective timeline of ${plans.length} plan${plans.length === 1 ? "" : "s"} over ${months} month${months === 1 ? "" : "s"}; ${doneCount} done, ${activeCount} in progress${runDescription}.`;

  const legendItems = Object.keys(STATUS_TONE);
  const legend = legendItems.map((status, i) => {
    const lx = ML + i * ((PW) / legendItems.length);
    return `<rect x="${lx.toFixed(1)}" y="${(legendY - 9).toFixed(1)}" width="9" height="9" rx="1.5" style="fill:${STATUS_TONE[status]};stroke:var(--edge);stroke-width:0.75"/>
  <text x="${(lx + 13).toFixed(1)}" y="${legendY.toFixed(1)}" style="fill:var(--muted);font-size:12.5px">${status}</text>`;
  }).join("\n  ");

  return `<svg viewBox="0 0 ${CANVAS_W} ${H}" width="100%" role="img"
     aria-label="${escapeHtml(ariaLabel)}"
     style="max-width:560px;height:auto;font-family:Georgia,'Times New Roman',serif;
            --paper:#faf7f1;--edge:#e6ddd0;--ink:#2b2b2b;--muted:#6b6259;--bar:#cbc1b3;--accent:#d97757"
     xmlns="http://www.w3.org/2000/svg">
  <rect x="0.5" y="0.5" width="${CANVAS_W - 1}" height="${H - 1}" style="fill:var(--paper);stroke:var(--edge)"/>
  <text x="14" y="${titleY}" style="fill:var(--muted);font-size:15px">Retrospective timeline — ${escapeHtml(payload.project)}</text>
  ${legend}
  ${rowSvg.join("\n  ")}
  <line x1="${ML}" y1="${axisY}" x2="${ML + PW}" y2="${axisY}" style="stroke:var(--edge);stroke-width:1"/>
  ${markerSvg}
  ${nowSvg}
  <text x="${ML}" y="${axisLabelY}" style="fill:var(--muted);font-size:12.5px">${escapeHtml(isoDay(minIso))}</text>
  <text x="${ML + PW}" y="${axisLabelY}" text-anchor="end" style="fill:var(--muted);font-size:12.5px">${escapeHtml(isoDay(payload.generatedAt))}</text>
  <text x="14" y="${densityLabelY}" style="fill:var(--muted);font-size:12.5px">commit density</text>
  ${densitySvg}
  ${runSvg}
  <text x="14" y="${payoffY}" style="fill:var(--ink);font-size:13px">No forecast — dates come from git, run reports, audit reports, or "now".</text>
</svg>`;
}

export function timelineBody(payload: TimelinePayload): string {
  const header = `<header>
  <h1 class="proof-masthead">Timeline</h1>
  <p class="proof-lede">A retrospective picture of ${escapeHtml(payload.project)}'s own history: plan bars from git-derived status changes, dependency arrows, commit density, ${payload.runsEnabled ? "run-close activity, " : ""}and audit-report markers. PANTRY runs no model; dates come from git history, dated run reports, audit-report modification times, or "now". Machine twin at <a href="/timeline.json">/timeline.json</a>.</p>
</header>`;
  if (!payload.available) {
    return `${header}
<div class="card pantry-map-empty" data-pad="md">
  <h2 class="card__title">No timeline yet</h2>
  <p class="pantry-member__role">${escapeHtml(payload.reason ?? "Nothing to draw yet.")}</p>
</div>`;
  }
  const months = monthsRound(payload.spanDays);
  const stat = (n: number | string, label: string) =>
    `<div class="pantry-stat"><span class="pantry-stat__n">${escapeHtml(String(n))}</span><span class="pantry-stat__label">${escapeHtml(label)}</span></div>`;
  const auditList = payload.auditMarkers.length
    ? `<ul class="pantry-timeline-audit-list">${payload.auditMarkers.map((m) =>
        `<li><code>${escapeHtml(m.label)}</code> <span class="pantry-member__role">${escapeHtml(isoDay(m.date))}</span></li>`).join("")}</ul>`
    : `<p class="pantry-member__role">No dated audit reports found (this repo's artifacts/, reports/, docs/, or root).</p>`;
  return `${header}
<section class="pantry-stats">
  ${stat(payload.plans.length, "plans")}
  ${stat(months, "months working on this")}
  ${stat(payload.activeDays, "active days")}
</section>
<figure class="pantry-timeline" data-grade="smooth">
  ${timelineSvg(payload)}
</figure>
${payload.runsEnabled ? `<p class="pantry-member__role"><em>Run closes are grouped by ${payload.densityBucket === "day" ? "day" : "week"}; ${payload.runDatedCount} of ${payload.runCount} reports carry a date.</em> <a href="/runs">Browse the run ledger →</a></p>` : ""}
<section class="pantry-timeline-audits">
  <h2 class="pantry-section-title">Audit markers</h2>
  ${auditList}
</section>`;
}
