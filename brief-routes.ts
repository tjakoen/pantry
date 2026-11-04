/**
 * The brief's three projections: the page (the home page when the surface is on), the JSON twin, and
 * the Markdown the agent reads through pantry_orient. One payload feeds all three, so the owner and
 * the agent can never be told two different things.
 */
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { briefText, buildBrief, type BriefAction, type BriefPayload } from "./brief.ts";
import type { ResolvedPantryConfig } from "./config.ts";

const e = (s: string) => escapeHtml(s);

function actions(list: BriefAction[]): string {
  if (!list.length) return "";
  return `<div class="brief-actions">${list.map((a) => a.kind === "link"
    ? `<a class="brief-act" href="${e(a.value)}">${e(a.label)}</a>`
    : `<button type="button" class="brief-act" data-copy="${e(a.value)}">${e(a.label)}</button>`).join("")}</div>`;
}

function section(title: string, count: number, empty: string, body: string, tone = ""): string {
  return `<section class="brief-section${tone}"><h2>${e(title)} <span class="brief-count">${count}</span></h2>${count ? body : `<p class="brief-empty">${e(empty)}</p>`}</section>`;
}

const ago = (iso: string, now: string) => {
  const m = Math.max(0, Math.round((Date.parse(now) - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function briefBody(b: BriefPayload): string {
  const offScope = b.inFlight.filter((r) => r.outOfScope.length).length;
  const stats = [
    ["In flight", b.inFlight.length, ""],
    ["Out of scope", offScope, offScope ? " is-alert" : ""],
    ["Waiting on you", b.waiting.length, b.waiting.length ? " is-warn" : ""],
    ["Drift", b.drift.length, b.drift.length ? " is-warn" : ""],
  ] as const;

  const inFlight = b.inFlight.map((r) => {
    const claim = r.claim
      ? `<span class="brief-tag">${e(r.claim.tool)} ${e(r.claim.sessionId)} · ${e(r.claim.state)} · ${e(ago(r.claim.lastAt, b.generated))}</span>`
      : r.planId ? `<span class="brief-tag is-warn">no claim</span>` : `<span class="brief-tag is-alert">unplanned</span>`;
    const sessions = r.sessions.length
      ? `<p class="brief-meta">${r.sessions.map((s) => `${e(s.id)} (${e(s.state)}, ${e(ago(s.lastSeenAt, b.generated))})`).join(", ")}</p>`
      : `<p class="brief-meta">No session has written inside this plan's touches yet.</p>`;
    const scope = r.outOfScope.length
      ? `<div class="brief-scope"><strong>${r.planId ? "Written outside every in-flight plan" : "Written with no plan"}:</strong><ul>${r.outOfScope.map((f) => `<li><code>${e(f)}</code></li>`).join("")}</ul>${r.unrecorded ? `<p class="brief-meta">and ${r.unrecorded} more not recorded</p>` : ""}</div>`
      : r.unrecorded ? `<p class="brief-meta">${r.unrecorded} written paths were not recorded, so scope is not fully checked.</p>` : "";
    return `<article class="brief-row${r.outOfScope.length ? " is-alert" : ""}">
  <header><h3>${r.planId ? `<a href="/plan/${encodeURIComponent(r.planId)}">${e(r.title)}</a>` : e(r.title)}</h3>${claim}</header>
  ${r.touches.length ? `<p class="brief-meta">Meant to touch: ${r.touches.map((t) => `<code>${e(t)}</code>`).join(" ")}</p>` : ""}
  ${sessions}${scope}${actions(r.actions)}
</article>`;
  }).join("");

  const waiting = b.waiting.map((w) => `<article class="brief-row"><header><h3>${e(w.title)}</h3><span class="brief-tag">${e(w.kind)}</span></header><p>${e(w.detail)}</p>${actions(w.actions)}</article>`).join("");
  const drift = b.drift.map((d) => `<article class="brief-row"><header><h3>${e(d.label)}</h3><span class="brief-tag is-${d.severity === "error" ? "alert" : "warn"}">${e(d.severity)}</span></header><p>${e(d.detail)}</p>${actions(d.actions)}</article>`).join("");
  const next = b.next.ready
    ? `<article class="brief-row is-next"><header><h3>${e(b.next.ready.title)}</h3><span class="brief-tag">ready</span></header>${actions(b.next.ready.actions)}</article>`
    : "";
  const skipped = b.next.skipped.length
    ? `<details class="brief-skipped"><summary>${b.next.skipped.length} plan(s) not ready, and why</summary><ul>${b.next.skipped.map((s) => `<li><a href="/plan/${encodeURIComponent(s.id)}">${e(s.title)}</a>: ${e(s.reasons.join("; "))}</li>`).join("")}</ul></details>`
    : "";

  return `<header class="brief-head">
  <h1 class="proof-masthead">${e(b.project)}</h1>
  <p class="proof-lede">Where the AI work stands: what is in flight, what strayed from its plan, what waits on you, and what comes next. Read from files on disk; PANTRY runs no model. <a href="/brief.json">JSON</a> · <a href="/brief.txt">the agent's copy</a> · <a href="/plans">plan board</a></p>
</header>
<div class="brief-stats">${stats.map(([l, n, t]) => `<div class="brief-stat${t}"><span class="brief-stat-n">${n}</span><span class="brief-stat-l">${e(l)}</span></div>`).join("")}</div>
${b.notes.length ? `<ul class="brief-notes">${b.notes.map((n) => `<li>${e(n)}</li>`).join("")}</ul>` : ""}
${section("In flight", b.inFlight.length, "Nothing is in flight. No plan is doing or claimed, and no session wrote files.", inFlight)}
${section("Waiting on you", b.waiting.length, "Nothing is waiting on you.", waiting)}
${section("Next", b.next.ready ? 1 : 0, "Nothing is ready for an agent to take.", next)}${skipped}
${section("Drift", b.drift.length, "The doctor's quick checks are all passing.", drift)}
<script>
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-copy]");
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); const t = b.textContent; b.textContent = "Copied"; setTimeout(() => (b.textContent = t), 1500); }
  catch { prompt("Copy this:", b.dataset.copy); }
});
</script>`;
}

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
  return new Response(page("Brief", briefBody(payload)), { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
