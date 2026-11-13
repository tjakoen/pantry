/**
 * The command center: PANTRY's home page, drawn from the alignment brief (brief.ts). Three columns,
 * one question each, so the first screen answers everything without scrolling:
 *
 *   Agents  what the AI is doing now, and whether it strayed from the plan it is meant to be on
 *   Queue   what it can take next, in the order pantry_next will hand it out
 *   Inbox   what needs the owner: decisions answered in place, plans only he can move, drift
 *
 * PANTRY stays pull-only. Nothing here starts or messages an agent session; every control either
 * records an answer in the one log PANTRY writes, opens the page that settles a row, or copies a
 * prompt for the owner to give the agent. The page refreshes itself, so it can be left open beside
 * the chat as the place the work is watched from.
 *
 * One payload feeds three projections (this page, /brief.json, /brief.txt), so the owner and the
 * agent are never told two different things.
 */
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { briefText, buildBrief, type BriefAction, type BriefAgent, type BriefPayload, type InFlightRow, type WaitingRow } from "./brief.ts";
import type { ResolvedPantryConfig } from "./config.ts";

const e = (s: string) => escapeHtml(s);

/** Seconds the page waits between refreshes. Slow enough not to load the hub, quick enough to watch. */
export const REFRESH_SECONDS = 20;

function actions(list: BriefAction[]): string {
  if (!list.length) return "";
  return `<div class="cc-actions">${list.map((a) => a.kind === "link"
    ? `<a class="cc-btn" href="${e(a.value)}">${e(a.label)}</a>`
    : `<button type="button" class="cc-btn${a.label.startsWith("Copy") && list.indexOf(a) === 0 ? " is-primary" : ""}" data-copy="${e(a.value)}">${e(a.label)}</button>`).join("")}</div>`;
}

const ago = (iso: string, now: string) => {
  const m = Math.max(0, Math.round((Date.parse(now) - Date.parse(iso)) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function column(id: string, title: string, question: string, count: number, body: string): string {
  return `<section class="cc-col" id="cc-${id}" aria-labelledby="cc-${id}-h">
  <header class="cc-col-head"><h2 id="cc-${id}-h">${e(title)} <span class="cc-count">${count}</span></h2><p>${e(question)}</p></header>
  <div class="cc-col-body">${body}</div>
</section>`;
}

const empty = (text: string) => `<p class="cc-empty">${e(text)}</p>`;

// The subagents a session spawned, under it. Running and quiet ones always show; finished ones show
// only the last few, because a session that ran forty lookups is a wall nobody reads.
const AGENT_DONE_SHOWN = 3;
function subagents(agents: BriefAgent[] | undefined, now: string): string {
  if (!agents?.length) return "";
  const open = agents.filter((a) => a.state !== "done");
  const done = agents.filter((a) => a.state === "done");
  const shown = [...open, ...done.slice(0, AGENT_DONE_SHOWN)];
  const rows = shown.map((a) => {
    const what = a.task ?? (a.lastTool ? `last: ${a.lastTool}` : "no tool yet");
    const when = a.state === "done" ? `done ${ago(a.lastSeenAt, now)}` : a.state === "quiet" ? `quiet ${ago(a.lastSeenAt, now)}` : `running ${ago(a.startedAt, now).replace(/ ago$/, "")}`;
    return `<li class="cc-agent is-${a.state}"><span class="cc-dot" aria-hidden="true"></span><span class="cc-agent-type">${e(a.type ?? "subagent")}</span> ${e(what)} <span class="cc-agent-when">${e(when)}</span></li>`;
  }).join("");
  const more = done.length > AGENT_DONE_SHOWN ? `<li class="cc-agent is-done">and ${done.length - AGENT_DONE_SHOWN} more finished</li>` : "";
  return `<li class="cc-agents-wrap"><ul class="cc-agents" aria-label="Subagents">${rows}${more}</ul></li>`;
}

function agentCard(r: InFlightRow, now: string): string {
  const tag = r.claim
    ? `<span class="cc-tag">${e(r.claim.tool)} · ${e(r.claim.state)}</span>`
    : r.planId ? `<span class="cc-tag is-warn">no claim</span>` : `<span class="cc-tag is-alert">unplanned</span>`;
  const sessions = r.sessions.map((s) => {
    const live = s.state === "alive" ? "is-live" : s.state === "idle" ? "is-idle" : "is-ended";
    const doing = s.state === "ended" ? `ended ${ago(s.lastSeenAt, now)}` : `${s.lastTool ? `last: ${s.lastTool}` : "no tool yet"} · ${ago(s.lastSeenAt, now)}`;
    return `<li class="cc-session ${live}"><span class="cc-dot" aria-hidden="true"></span><code>${e(s.id)}</code> ${e(doing)}</li>${subagents(s.agents, now)}`;
  }).join("");
  const stray = r.outOfScope.length
    ? `<div class="cc-stray"><strong>${r.planId ? `Wrote ${r.outOfScope.length} file(s) outside the plan` : `Wrote ${r.outOfScope.length} file(s) with no plan`}</strong><ul>${r.outOfScope.slice(0, 6).map((f) => `<li><code>${e(f)}</code></li>`).join("")}${r.outOfScope.length > 6 ? `<li>and ${r.outOfScope.length - 6} more</li>` : ""}</ul>${r.unrecorded ? `<p class="cc-meta">${r.unrecorded} more writes were not recorded.</p>` : ""}</div>`
    : "";
  const title = r.planId ? `<a href="/plan/${encodeURIComponent(r.planId)}">${e(r.title)}</a>` : e(r.title);
  return `<article class="cc-card${r.outOfScope.length ? " is-alert" : ""}" tabindex="0">
  <header><h3>${title}</h3>${tag}</header>
  ${sessions ? `<ul class="cc-sessions">${sessions}</ul>` : `<p class="cc-meta">No session has written inside this plan yet.</p>`}
  ${stray}${actions(r.actions)}
</article>`;
}

function decisionCard(w: WaitingRow): string {
  const d = w.decision!;
  const opts = d.options.map((o, i) => `<label class="cc-opt"><input type="radio" name="opt-${e(w.id)}" value="${e(o)}"${i === 0 && !d.recommendation ? "" : ""}> <span>${e(o)}${d.recommendation && o.trim() === d.recommendation.trim() ? ` <em class="cc-rec">recommended</em>` : ""}</span></label>`).join("");
  return `<article class="cc-card cc-decision" tabindex="0" data-decision="${e(JSON.stringify({ id: w.id, title: w.title, file: d.file, options: d.options, recommendation: d.recommendation, unblocks: d.unblocks }))}">
  <header><h3>${e(w.title)}</h3><span class="cc-tag is-warn">decide</span></header>
  <p class="cc-meta">${e(w.detail)}</p>
  ${d.recommendation && !d.options.some((o) => o.trim() === d.recommendation!.trim()) ? `<p class="cc-meta">Recommended: ${e(d.recommendation)}</p>` : ""}
  ${opts ? `<fieldset class="cc-opts"><legend class="cc-sr">Options</legend>${opts}</fieldset>` : ""}
  <details class="cc-note"><summary>Add a note</summary><textarea rows="3" aria-label="Note for the agent"></textarea></details>
  <div class="cc-actions"><button type="button" class="cc-btn is-primary" data-record>Record answer</button>${actions(w.actions).replace(/^<div class="cc-actions">|<\/div>$/g, "")}</div>
  <p class="cc-status" role="status" hidden></p>
</article>`;
}

/** How PANTRY works, in the order the work moves. Shown on the command center itself, so the page
 *  explains its own columns to someone who has never read INSTALL.md. */
const HOW = [
  ["Plans", "You, or an agent with your go-ahead, write plans in plans/: the goal, the files it touches, a done line and an owner. PANTRY reads them and never edits them."],
  ["Queue", "A plan whose owner is ai, whose dependencies are done and that no decision holds is ready. Agents take the first one with pantry_next and pantry_claim. Claims live on this machine, so two agents never take the same plan."],
  ["Agents", "A hook records each session's tool calls and the files it writes. That is how the Agents column knows who is working, and flags a file written outside the plan the agent claimed."],
  ["Inbox", "When an agent needs you, it writes a decision in plans/decisions/. Answer it here. The answer goes to the answer log, or to this machine's inbox when the hub cannot write the repo."],
  ["Back to the agent", "A running agent gets your unread answers with its next heartbeat, about every ten minutes, and a new session gets them from pantry_orient. It acts, then acks with pantry answers ack."],
  ["Drift", "The doctor's quick checks run on every refresh. Each one names its fix, and the copy buttons hand it to you or to the agent."],
] as const;

function howItWorks(): string {
  return `<details class="cc-how" data-key="how"><summary>How PANTRY works</summary>
  <ol class="cc-how-steps">${HOW.map(([t, d]) => `<li><strong>${e(t)}</strong><span>${e(d)}</span></li>`).join("")}</ol>
  <p class="cc-meta">PANTRY runs no model and never starts or messages an agent. It is where you watch and steer; the agents pull their work and their answers from it. The agent reads this same page as <a href="/brief.txt">text</a> through pantry_orient.</p>
</details>`;
}

function answeredCard(a: BriefPayload["answered"][number], now: string): string {
  return `<article class="cc-card is-done-ish" tabindex="0"><header><h3>${e(a.question)}</h3><span class="cc-tag">answered</span></header>
  <p class="cc-meta">You chose <strong>${e(a.choice || "(a note)")}</strong> ${e(ago(a.at, now))}.${a.holds.length ? ` Frees ${e(a.holds.join(", "))}.` : ""} ${a.owner ? `Held by ${e(a.owner.tool)} session <code>${e(a.owner.sessionId.slice(0, 8))}</code> (${e(a.owner.planId)}), which gets it on its next heartbeat.` : "No session has it yet. A running agent sees it on its next heartbeat, or start one with the session brief."}</p>
  ${actions(a.actions)}
</article>`;
}

function plainCard(w: WaitingRow): string {
  return `<article class="cc-card" tabindex="0"><header><h3>${e(w.title)}</h3><span class="cc-tag">${w.kind === "human-plan" ? "yours" : "blocked"}</span></header><p class="cc-meta">${e(w.detail)}</p>${actions(w.actions)}</article>`;
}

export function briefBody(b: BriefPayload): string {
  const strayed = b.inFlight.filter((r) => r.outOfScope.length).length;
  const decisions = b.waiting.filter((w) => w.kind === "decision" && w.decision);
  const otherWaiting = b.waiting.filter((w) => !(w.kind === "decision" && w.decision));
  const inboxCount = b.waiting.filter((w) => !b.answered.some((a) => a.ref === w.id)).length;

  const chips = [
    ["inbox", "Needs you", inboxCount, inboxCount ? " is-warn" : ""],
    ["inbox", "Drift", b.drift.length, b.drift.length ? " is-warn" : ""],
    ["agents", "Agents", b.inFlight.length, ""],
    ["agents", "Strayed", strayed, strayed ? " is-alert" : ""],
    ["queue", "Ready", b.next.queue.length, ""],
  ] as const;

  const agents = b.inFlight.length
    ? b.inFlight.map((r) => agentCard(r, b.generated)).join("")
    : empty("No agent is at work. No plan is doing or claimed, and no session wrote files. Take one from the queue.");

  const queue = (b.next.queue.length
    ? `<ol class="cc-queue">${b.next.queue.map((q, i) => `<li><article class="cc-card${i === 0 ? " is-next" : ""}" tabindex="0">
  <header><h3><a href="/plan/${encodeURIComponent(q.id)}">${e(q.title)}</a></h3>${i === 0 ? `<span class="cc-tag">next</span>` : ""}</header>
  ${q.touches.length ? `<p class="cc-meta">Touches ${q.touches.slice(0, 4).map((t) => `<code>${e(t)}</code>`).join(" ")}${q.touches.length > 4 ? ` and ${q.touches.length - 4} more` : ""}</p>` : `<p class="cc-meta">No touches listed, so scope cannot be checked.</p>`}
  ${actions(q.actions)}
</article></li>`).join("")}</ol>`
    : empty("Nothing is ready for an agent to take."))
    + (b.next.skipped.length
      ? `<details class="cc-more" data-key="skipped"><summary>${b.next.skipped.length} not ready, and why</summary><ul>${b.next.skipped.map((s) => `<li><a href="/plan/${encodeURIComponent(s.id)}">${e(s.title)}</a><span class="cc-meta"> ${e(s.reasons.join("; "))}</span></li>`).join("")}</ul></details>`
      : "");

  const drift = b.drift.length
    ? `<details class="cc-more" data-key="drift"${decisions.length + otherWaiting.length === 0 ? " open" : ""}><summary>Drift: ${b.drift.length} check(s) due</summary>${b.drift.map((d) => `<article class="cc-card cc-drift" tabindex="0"><header><h3>${e(d.label)}</h3><span class="cc-tag${d.severity === "error" ? " is-alert" : ""}">${e(d.severity)}</span></header><p class="cc-meta">${e(d.detail)}</p>${actions(d.actions)}</article>`).join("")}</details>`
    : `<p class="cc-empty">The doctor's quick checks pass.</p>`;

  const answeredIds = new Set(b.answered.map((a) => a.ref));
  const open = decisions.filter((w) => !answeredIds.has(w.id));
  const inbox = (open.length || otherWaiting.length
    ? open.map(decisionCard).join("") + otherWaiting.map(plainCard).join("")
    : empty("Nothing is waiting on you."))
    + (b.answered.length ? `<details class="cc-more" data-key="answered" open><summary>Answered, waiting for an agent: ${b.answered.length}</summary>${b.answered.map((a) => answeredCard(a, b.generated)).join("")}</details>` : "")
    + drift;

  return `<div class="cc" id="cc" data-generated="${e(b.generated)}">
<header class="cc-head">
  <div class="cc-title"><h1>${e(b.project)}</h1><p>Command center for this project's AI. Read from disk, refreshed every ${REFRESH_SECONDS} s; PANTRY runs no model and starts no session.</p></div>
  <nav class="cc-chips" aria-label="Summary">${chips.map(([to, l, n, t]) => `<a class="cc-chip${t}" href="#cc-${to}"><span class="cc-chip-n">${n}</span> ${e(l)}</a>`).join("")}</nav>
  <p class="cc-sub"><span class="cc-live" data-live>updated ${e(b.generated.slice(11, 19))} UTC</span> · <a href="/plans">board</a> · <a href="/brief.json">json</a> · <a href="/brief.txt">agent's copy</a> · <span class="cc-keys">j k move · c copy · o open · r refresh</span></p>
  ${howItWorks()}
  ${b.notes.length ? `<ul class="cc-notes">${b.notes.map((n) => `<li>${e(n)}</li>`).join("")}</ul>` : ""}
</header>
<div class="cc-grid">
${column("inbox", "Needs you", "What needs you before the work can move.", inboxCount, inbox)}
${column("agents", "Agents", "What the AI is doing, and whether it kept to its plan.", b.inFlight.length, agents)}
${column("queue", "Queue", "What it can take next, in the order it will be handed out.", b.next.queue.length, queue)}
</div>
</div>
<script>${CLIENT}</script>`;
}

/** The page's behaviour: copy, record an answer, keyboard moves, and the refresh. Plain JS, no build. */
const CLIENT = `(() => {
  const meta = document.querySelector('meta[name="pantry-base"]');
  const base = (meta && meta.getAttribute("content")) || "";
  const flash = (el, text) => { const t = el.textContent; el.textContent = text; setTimeout(() => (el.textContent = t), 1500); };
  async function copy(el) {
    try { await navigator.clipboard.writeText(el.dataset.copy); flash(el, "Copied"); }
    catch { window.prompt("Copy this:", el.dataset.copy); }
  }
  async function record(card, btn) {
    const d = JSON.parse(card.dataset.decision);
    const picked = card.querySelector("input[type=radio]:checked");
    const choice = picked ? picked.value : "";
    const notes = (card.querySelector("textarea")?.value || "").trim();
    const status = card.querySelector(".cc-status");
    const say = (m) => { status.hidden = false; status.textContent = m; };
    if (!choice && !notes) return say("Pick an option or add a note first.");
    const composed = "Decision " + d.id + " (" + d.title + ") is answered: " + (choice || "see note") + "." + (notes ? " Note: " + notes : "") + (d.file ? " Act on it, then mark " + d.file + " resolved." : "");
    btn.disabled = true;
    try {
      const res = await fetch(base + "/answers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        via: "pantry-brief", choice, notes, composed,
        request: { source: "decision", ref: d.id, file: d.file || undefined, question: d.title, options: d.options, recommendation: d.recommendation || undefined, unblocks: d.unblocks || undefined },
      }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { btn.disabled = false; return say(body.error || "Not recorded (" + res.status + ")."); }
      card.classList.add("is-done");
      say("Recorded. The next session reads it from the answer log.");
      const c = document.createElement("button"); c.type = "button"; c.className = "cc-btn"; c.dataset.copy = composed; c.textContent = "Copy prompt for a running session";
      status.after(c);
    } catch (err) { btn.disabled = false; say("Not recorded: " + err); }
  }
  document.addEventListener("click", (ev) => {
    const c = ev.target.closest("[data-copy]"); if (c) return copy(c);
    const r = ev.target.closest("[data-record]"); if (r) return record(r.closest(".cc-decision"), r);
  });
  const cards = () => [...document.querySelectorAll(".cc-card")];
  document.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) return;
    const list = cards(); const i = list.indexOf(document.activeElement?.closest(".cc-card"));
    if (ev.key === "j" || ev.key === "k") { ev.preventDefault(); const n = list[Math.min(list.length - 1, Math.max(0, i + (ev.key === "j" ? 1 : -1)))] || list[0]; n?.focus(); n?.scrollIntoView({ block: "nearest" }); }
    else if (ev.key === "c" && i >= 0) { const b = list[i].querySelector("[data-copy]"); if (b) copy(b); }
    else if (ev.key === "o" && i >= 0) { const a = list[i].querySelector("a[href]"); if (a) location.href = a.href; }
    else if (ev.key === "r") refresh();
  });
  // The refresh swaps the whole center for a fresh render, and skips a turn while the owner is in the
  // middle of something: typing a note, or with an option picked and not yet recorded.
  async function refresh() {
    const busy = document.querySelector(".cc-decision:not(.is-done) input:checked, .cc textarea:focus") || (document.querySelector(".cc textarea") && [...document.querySelectorAll(".cc textarea")].some((t) => t.value));
    if (busy) return;
    try {
      const res = await fetch(location.pathname, { headers: { Accept: "text/html" } });
      if (!res.ok) throw new Error(String(res.status));
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const next = doc.getElementById("cc"); const cur = document.getElementById("cc");
      if (!next || !cur) return;
      const open = new Set([...cur.querySelectorAll("details[data-key][open]")].map((d) => d.dataset.key));
      cur.replaceWith(next);
      for (const d of next.querySelectorAll("details[data-key]")) if (open.has(d.dataset.key)) d.open = true;
    } catch { const l = document.querySelector("[data-live]"); if (l) l.textContent = "refresh failed; showing the last good read"; }
  }
  setInterval(refresh, ${REFRESH_SECONDS} * 1000);
})();`;

/** The brief's routes, or null when the path is not one of them. `/` is included when on. */
export async function briefRoute(
  path: string,
  config: ResolvedPantryConfig,
  page: (title: string, body: string) => string,
): Promise<Response | null> {
  if (!config.surfaces.brief) return null;
  if (path !== "/" && path !== "/brief" && path !== "/brief.json" && path !== "/brief.txt") return null;
  const payload = await buildBrief(config, new Date().toISOString());
  if (path === "/brief.json") return Response.json(payload);
  if (path === "/brief.txt") return new Response(briefText(payload), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
  return new Response(page("Command center", briefBody(payload)), { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
