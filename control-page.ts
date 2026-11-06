// pantry/control-page.ts, split out of app.ts. The page markup for one surface; app.ts keeps the routing.
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import type { ControlPayload, SessionRow } from "./sessions.ts";
import { relativeAge } from "./artifacts-page.ts";

// /control (C1) — the control center: the plan board joined to what is moving right now.
//
// The four questions a person actually has at nine in the morning, on one page: what is this project
// meant to do, what is moving and who is moving it, did the loop run this time, and what is waiting
// on me. Every one of them is read from files that were already on disk, which is what lets this
// replay a session that ended last Tuesday instead of only describing the one in front of you. C2
// puts a tail on this same renderer; nothing here assumes a live transport.
//
// This is a projection of the PLAN with sessions as an attribute of a row, and never a list of
// sessions. A list of sessions is a monitor: it duplicates the editor and it goes stale the moment
// nobody is watching it.
export function sessionChip(row: SessionRow, now: Date): string {
  // data-last-seen is what pantry-control.js ages in place. The server-rendered text is the truth at
  // render time and stays readable with no JavaScript at all.
  return `<span class="pantry-session" data-state="${escapeHtml(row.state)}" data-last-seen="${escapeHtml(row.lastSeenAt)}">
  <span class="pantry-session__dot" aria-hidden="true"></span>
  <code class="pantry-session__id">${escapeHtml(row.id.slice(0, 8))}</code>
  <span class="pantry-session__state">${escapeHtml(row.state)}</span>
  <span class="pantry-session__age" data-age>${escapeHtml(relativeAge(row.lastSeenAt, now))}</span>
</span>`;
}

export function controlBody(payload: ControlPayload): string {
  const now = new Date(payload.generated);
  const parts: string[] = [`<header>
  <h1 class="proof-masthead">Control</h1>
  <p class="proof-lede">Where ${escapeHtml(payload.project)} is: every plan with an open step, whatever is working in it, and what is waiting on a person. Read from files, so this page is the record rather than a monitor. The machine twin is <a href="/sessions.json">/sessions.json</a>.</p>
</header>`];

  // The loud empty state, and the reason this page has one. A calm dashboard over a log nothing has
  // ever written is the exact silent degrade the doctor row exists to catch: every section below
  // would render, correctly and emptily, and read as a quiet morning rather than as a blind surface.
  if (!payload.present) {
    parts.push(`<div class="card pantry-control-blind" data-pad="md">
  <h2 class="card__title">Nothing has observed this repo</h2>
  <p>There is no session event log at <code>${escapeHtml(payload.logPath)}</code>. The sessions on this page are empty because nothing is watching, not because nothing has happened here. Mount the harness session emitter and the rows appear on the next tool call.</p>
  <p class="pantry-member__role">The plan board below is still true either way: those are files in the repo.</p>
</div>`);
  } else if (payload.sessions.readError) {
    parts.push(`<div class="card pantry-control-blind" data-pad="md">
  <h2 class="card__title">The session log could not be read</h2>
  <p><code>${escapeHtml(payload.logPath)}</code> exists and could not be opened: ${escapeHtml(payload.sessions.readError)}. Treat every session below as missing rather than as absent.</p>
</div>`);
  }
  if (payload.sessions.truncated) {
    parts.push(`<p class="pantry-control-note">The log was longer than this reader will take in one go, so only its tail was read. Sessions older than that tail are not on this page.</p>`);
  }

  // Waiting first. It is the only block on the page that asks something of the reader, and a page
  // that buries the ask under a status board is a page that gets read as a status board.
  const waiting = payload.waiting.length === 0
    ? `<p class="pantry-member__role">Nothing is waiting on you.</p>`
    : `<ul class="pantry-waiting">${payload.waiting.map((w) => `<li data-kind="${escapeHtml(w.kind)}">
  ${w.href ? `<a href="${escapeHtml(w.href)}">${escapeHtml(w.title)}</a>` : escapeHtml(w.title)}
  <span class="pantry-member__role">${escapeHtml(w.detail)}</span>
</li>`).join("\n")}</ul>`;
  parts.push(`<section class="pantry-control-section">
  <h2 class="pantry-section-title">Waiting on you</h2>
  ${waiting}
</section>`);

  // The release gate, as a row of tiles: the verdict first, then the three numbers it rests on. The
  // tile row is adapted from the Tests dashboard of C.R.I.S.S.P. by Richard Edens
  // (github.com/richardedens/crissp, Apache-2.0); see NOTICE.
  parts.push(gateSection(payload.gate, now));

  // The lamps. The wording here is doing real work: lit is a claim about THIS session, dark is a
  // claim about the run, and unobserved is a claim about the observer. Saying so on the page is the
  // difference between a grey lamp reading as a failure and reading as an absence of evidence.
  const lampSource = payload.lampSession
    ? `These describe session <code>${escapeHtml(payload.lampSession)}</code>.`
    : `No session has been recorded here, so none of these describes a run.`;
  const lamps = payload.lamps.map((l) => `<li class="pantry-lamp" data-state="${escapeHtml(l.state)}">
  <span class="pantry-lamp__dot" aria-hidden="true"></span>
  <span class="pantry-lamp__label">${escapeHtml(l.label)}</span>
  <span class="pantry-lamp__state">${escapeHtml(l.state)}${l.shared ? `<span class="pantry-lamp__shared" title="Repo-level evidence, not per-session">shared</span>` : ""}</span>
  <p class="pantry-lamp__detail">${escapeHtml(l.detail)}</p>
</li>`).join("\n");
  parts.push(`<section class="pantry-control-section">
  <h2 class="pantry-section-title">Did the loop run</h2>
  <p class="pantry-member__role">${lampSource} Lit means the mechanism ran in this session, not that it is configured. Unobserved means nothing on disk can answer the question, which is a different thing from a mechanism that did not run.</p>
  <ul class="pantry-lamps">${lamps}</ul>
</section>`);

  // The plan board half.
  if (payload.planError) {
    parts.push(`<section class="pantry-control-section">
  <h2 class="pantry-section-title">Open plans</h2>
  <div class="card pantry-control-blind" data-pad="md"><p>${escapeHtml(payload.planError)}</p></div>
</section>`);
  } else {
    const rows = payload.sessions.sessions;
    const plans = payload.plans.length === 0
      ? `<p class="pantry-member__role">No plan here has an open step.</p>`
      : payload.plans.map((plan) => {
        const attached = plan.sessions
          .map((id) => rows.find((r) => r.id === id))
          .filter((r): r is SessionRow => r !== undefined)
          .map((r) => sessionChip(r, now)).join("\n");
        const steps = plan.openTasks.map((t) => `<li>${escapeHtml(t)}</li>`).join("\n");
        const omitted = plan.openTasksOmitted > 0
          ? `<li class="pantry-member__role">and ${plan.openTasksOmitted} more</li>` : "";
        return `<article class="card pantry-plan-row" data-pad="md" data-status="${escapeHtml(plan.status)}">
  <h3 class="card__title"><a href="/plans">${escapeHtml(plan.title)}</a> <span class="pantry-decision-badge" data-status="${escapeHtml(plan.status)}">${escapeHtml(plan.status)}</span></h3>
  <p class="pantry-member__role">${plan.openCount} open, ${plan.doneCount} done${plan.track ? ` · track ${escapeHtml(plan.track)}` : ""} · owner ${escapeHtml(plan.owner)}</p>
  <ul class="pantry-plan-steps">${steps}${omitted}</ul>
  ${attached
    ? `<div class="pantry-plan-sessions"><span class="pantry-member__role">Seen writing here:</span> ${attached}</div>`
    : `<p class="pantry-member__role">Nothing has been seen writing in the areas this plan touches.</p>`}
</article>`;
      }).join("\n");
    parts.push(`<section class="pantry-control-section">
  <h2 class="pantry-section-title">Open plans</h2>
  <p class="pantry-member__role">A session is attached to a plan when a file it was seen writing falls under one of the areas that plan declares. That is evidence of work rather than an inventory of it: only write-shaped tools are recorded, and the path list per session is capped.</p>
  ${plans}
</section>`);
  }

  if (payload.unattached.length > 0) {
    parts.push(`<section class="pantry-control-section">
  <h2 class="pantry-section-title">Not attached to a plan</h2>
  <p class="pantry-member__role">Still going, and nothing it wrote falls under any open plan's declared areas. Often that is a session doing something no plan covers.</p>
  <div class="pantry-session-list">${payload.unattached.map((r) => sessionChip(r, now)).join("\n")}</div>
</section>`);
  }

  parts.push(`<p class="pantry-control-note">Rendered ${escapeHtml(payload.generated)} from files alone. Add a session id to the address to replay a run that has already ended.</p>
<script src="/pantry-control.js" defer></script>`);
  return parts.join("\n");
}

function ring(done: number, total: number): string {
  // A total of zero is a full ring: nothing after the full run means nothing left unchecked.
  const frac = total === 0 ? 1 : done / total;
  const c = 2 * Math.PI * 16;
  return `<svg class="pantry-gate__ring" viewBox="0 0 40 40" role="img" aria-label="${done} of ${total} checked">
  <circle cx="20" cy="20" r="16" class="pantry-gate__track"/>
  <circle cx="20" cy="20" r="16" class="pantry-gate__fill" stroke-dasharray="${(frac * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 20 20)"/>
</svg>`;
}

export function gateSection(gate: ControlPayload["gate"], now: Date): string {
  if (!gate) return "";
  const head = `<h2 class="pantry-section-title">Release gate</h2>`;
  if (!gate.recorded) {
    return `<section class="pantry-control-section">${head}
  <p class="pantry-member__role">No full run is on record for this repo, so nothing here may ship yet. Run <code>pantry certify full</code> on a clean tree to start the certificate.</p>
</section>`;
  }
  const full = gate.full!;
  const tile = (label: string, value: string, note: string, extra = "") =>
    `<li class="pantry-gate__tile">${extra}<span class="pantry-gate__label">${label}</span><span class="pantry-gate__value">${value}</span><span class="pantry-gate__note">${note}</span></li>`;
  const tiles = [
    tile("Verdict", gate.open ? "Open" : "Closed",
      gate.open ? `${escapeHtml(gate.head.slice(0, 7))} may ship` : escapeHtml(gate.problems[0] ?? "")),
    tile("Last full run", full.ok ? "Green" : "Red",
      `${escapeHtml(full.sha.slice(0, 7))}, ${escapeHtml(relativeAge(full.at, now))}; the limit is seven days`),
    tile("Checked since", `${gate.checked} of ${gate.since}`,
      gate.since === 0 ? "no commits after the full run" : "commits after the full run with a green check",
      ring(gate.checked, gate.since)),
    tile("Coverage", gate.coverageFloor === null ? "None" : `${gate.coverageFloor}%`,
      gate.coverageFloor !== null ? "the floor: it may go up, never down"
        : full.coverage !== undefined ? `${full.coverage}% on a red run, which sets no floor`
        : "no coverage table in the full gate's output"),
  ];
  const more = gate.problems.length > 1
    ? `<ul class="pantry-gate__problems">${gate.problems.slice(1).map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : "";
  return `<section class="pantry-control-section pantry-gate" data-open="${gate.open}">${head}
  <ul class="pantry-gate__tiles">${tiles.join("\n")}</ul>${more}
</section>`;
}
