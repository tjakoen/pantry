// pantry/hub-home.ts: the hub's front page, one row per registered project. It answers the question
// a person has before they know which project to open: where are agents working right now, and where
// is something waiting on me. Each row is read from that project's own /brief.json, so the hub holds
// no second copy of any project's state and can never disagree with the project's command center.
//
// The brief runs the doctor's fast checks and reads git, which is cheap once and expensive eighteen
// times at once: probing every project in parallel once pinned the container's CPU. So the fetches
// run a few at a time and each result is cached for HUB_BRIEF_TTL_MS.
import { explainPrompt } from "./learn.ts";
import { escapeHtml as e } from "@tjakoen/mill/core/engine.ts";
import type { BriefPayload } from "./brief.ts";
import { STYLESHEETS } from "./chrome.ts";
import { STATE_STALE_MS, type MachineState } from "./hub-sync.ts";

export const HUB_BRIEF_TTL_MS = 30_000;
const CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 8_000;

export interface HubStatus { name: string; path: string; port: number; up: boolean; url: string; note?: string }

export interface HubRow {
  name: string;
  path: string;
  url: string;
  up: boolean;
  note?: string;
  /** null when the project answers but has no command center (surface off, or an older PANTRY) */
  summary: HubSummary | null;
  /** true while the first read of this project's brief is still running */
  pending?: boolean;
}

export interface HubSummary {
  /** sessions alive or idle right now */
  live: number;
  /** subagents still running across those sessions */
  agentsRunning: number;
  /** decisions, blocked plans and human plans waiting on the owner */
  waiting: number;
  /** answers recorded and not yet acted on */
  answered: number;
  drift: number;
  /** files written outside every in-flight plan */
  outOfScope: number;
  next: string | null;
  lastSeenAt: string | null;
  /** the waiting rows themselves, so the hub can say what waits and not only how many */
  items: HubItem[];
  /** plans being worked, and plans paused on a usage limit, for the In flight band */
  threads: HubThread[];
  /** plans closed this week with their explainer */
  learned: HubLearned[];
}

export interface HubLearned { planId: string; title: string; topic: string; changed: string; why: string; dropped: string; remember: string; at: string; path: string }

export interface HubThread { title: string; state: "active" | "paused"; who: string | null; until: string | null; next: string | null; path: string }

/** One thing waiting on the owner, with the address inside its project that acts on it. */
export interface HubItem { kind: string; title: string; detail: string; label: string; path: string }

/** The seeded first plan every new board carries. It is a welcome, not a next step. */
const SEED_NEXT = /^welcome to your plan board$/i;

const KIND_LABEL: Record<string, string> = { decision: "Decision", "blocked-plan": "Blocked plan", "human-plan": "Your plan", answer: "Answer to act on" };

export function summarize(b: BriefPayload): HubSummary {
  const sessions = b.inFlight.flatMap((r) => r.sessions);
  const seen = new Map(sessions.map((s) => [s.id, s]));
  const unique = [...seen.values()];
  const items: HubItem[] = b.waiting.map((w) => {
    const link = w.actions.find((a) => a.kind === "link" && a.value.startsWith("/"));
    return { kind: w.kind, title: w.title, detail: w.detail, label: link?.label ?? "Open", path: link?.value ?? "/" };
  });
  const nextTitle = b.next.ready?.title ?? null;
  const pausedIds = new Set((b.paused ?? []).map((p) => p.planId));
  const threads: HubThread[] = [
    ...b.inFlight.filter((r) => r.planId && !pausedIds.has(r.planId)).map((r) => ({ title: r.title, state: "active" as const, who: r.claim && r.claim.state === "active" ? r.claim.tool : null, until: null, next: null, path: `/plan/${encodeURIComponent(r.planId!)}` })),
    ...(b.paused ?? []).map((p) => ({ title: p.title, state: "paused" as const, who: null, until: p.until, next: p.next, path: `/plan/${encodeURIComponent(p.planId)}` })),
  ];
  const learned: HubLearned[] = (b.learned ?? []).map((l) => ({ planId: l.planId, title: l.title, ...l.explainer, path: `/plan/${encodeURIComponent(l.planId)}` }));
  return {
    learned,
    threads,
    items,
    live: unique.filter((s) => s.state !== "ended").length,
    agentsRunning: unique.reduce((n, s) => n + (s.agents ?? []).filter((a) => a.state === "running").length, 0),
    waiting: b.waiting.length,
    answered: b.answered.length,
    drift: b.drift.length,
    outOfScope: b.inFlight.reduce((n, r) => n + r.outOfScope.length, 0),
    next: nextTitle && !SEED_NEXT.test(nextTitle.trim()) ? nextTitle : null,
    lastSeenAt: unique.map((s) => s.lastSeenAt).sort().at(-1) ?? null,
  };
}

const cache = new Map<string, { at: number; summary: HubSummary | null }>();
const inFlight = new Map<string, Promise<HubSummary | null>>();
/** How long the page waits for briefs before it renders what it has. Under Bun's ten-second request
 *  timeout with room to spare: a cold hub reading eighteen projects takes longer than that. */
export const HUB_RENDER_WAIT_MS = 4_000;

function fetchSummary(s: HubStatus): Promise<HubSummary | null> {
  const hit = cache.get(s.name);
  if (hit && Date.now() - hit.at < HUB_BRIEF_TTL_MS) return Promise.resolve(hit.summary);
  const running = inFlight.get(s.name);
  if (running) return running;
  const p = readSummary(s).finally(() => inFlight.delete(s.name));
  inFlight.set(s.name, p);
  return p;
}

async function readSummary(s: HubStatus): Promise<HubSummary | null> {
  let summary: HubSummary | null = null;
  try {
    // The status url is the browser's address (localhost); inside the container the child answers on
    // loopback at the same port, so swap the host and keep the base the probe found.
    const base = new URL(s.url);
    const res = await fetch(`http://127.0.0.1:${base.port}${base.pathname.replace(/\/$/, "")}/brief.json`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.ok) summary = summarize((await res.json()) as BriefPayload);
  } catch { /* down or slow: the row says so */ }
  cache.set(s.name, { at: Date.now(), summary });
  return summary;
}

export async function hubRows(statuses: HubStatus[], waitMs = HUB_RENDER_WAIT_MS): Promise<HubRow[]> {
  const up = statuses.filter((s) => s.up);
  const queue = [...up];
  const work = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) await fetchSummary(s);
  };
  // The reads carry on after the page is sent, so the next refresh finds them in the cache.
  const all = Promise.all(Array.from({ length: CONCURRENCY }, work));
  await Promise.race([all, new Promise((r) => setTimeout(r, waitMs))]);
  return sortRows(statuses.map((s) => {
    const hit = cache.get(s.name);
    return { name: s.name, path: s.path, url: s.url, up: s.up, note: s.note, summary: hit?.summary ?? null, pending: s.up && !hit };
  }));
}

/** Live agents first, then whatever waits on the owner, then most recently worked; down projects last. */
export function sortRows(rows: HubRow[]): HubRow[] {
  const rank = (r: HubRow) => !r.up ? 4 : !r.summary ? 3 : r.summary.live ? 0 : r.summary.waiting + r.summary.answered ? 1 : 2;
  return rows.toSorted((a, b) => rank(a) - rank(b) || (b.summary?.lastSeenAt ?? "").localeCompare(a.summary?.lastSeenAt ?? "") || a.name.localeCompare(b.name));
}

const ago = (iso: string | null, now: number) => {
  if (!iso) return "no sessions logged";
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

/** A counter renders only when it counts something: twenty rows of zeros gave the eye nothing to land on. */
function stat(n: number, label: string, href: string, loud = false): string {
  return n ? `<a class="hub-stat${loud ? " is-loud" : " is-some"}" href="${href}"><strong>${n}</strong> ${label}</a>` : "";
}

/** Plans closed this week, grouped by topic and folded, each with what changed, why, what was
 *  dropped and the one thing to remember, plus an Explain this button that copies a prompt a session
 *  can teach from. Folded by default: this is for learning when there is time, not a call to act. */
export function learnedBand(rows: HubRow[]): string {
  const all = rows.flatMap((r) => (r.summary?.learned ?? []).map((l) => ({ r, l })));
  if (!all.length) return "";
  const topics = new Map<string, typeof all>();
  for (const x of all) topics.set(x.l.topic, [...(topics.get(x.l.topic) ?? []), x]);
  const groups = [...topics].map(([topic, xs]) => `<h3 class="hub-topic">${e(topic)}</h3><ul class="hub-items">${xs.map(({ r, l }) => `<li class="hub-learned"><div class="hub-learned__head"><span class="hub-item__project">${e(r.name)}</span><span class="hub-item__title">${e(l.title)}</span><span class="hub-item__where">${e(l.at.slice(0, 10))}</span></div><dl><dt>Changed</dt><dd>${e(l.changed)}</dd><dt>Why</dt><dd>${e(l.why)}</dd><dt>Dropped</dt><dd>${e(l.dropped)}</dd><dt>Remember</dt><dd>${e(l.remember)}</dd></dl><div class="hub-learned__acts"><a class="hub-item__act" href="${e(r.url.replace(/\/$/, "") + l.path)}">Open plan</a><button type="button" class="hub-item__act" data-copy="${e(explainPrompt(r.name, l.planId, l.title))}">Copy Explain this prompt</button></div></li>`).join("")}</ul>`).join("");
  return `<details class="hub-band"><summary><h2 id="hub-learned">Done this week <span class="hub-meta">${all.length}</span></h2></summary>${groups}</details>`;
}

/** What the menu bar shows: the count, the top items with where they open, paused plans, and one
 *  line for the other machines. The dropdown is the shortest form of the front page, so it reads the
 *  same rows and never disagrees with it. */
export interface TrayLine { label: string; project: string | null; path: string }
export interface TrayPayload { ok: true; needsYou: number; items: TrayLine[]; more: number; paused: TrayLine[]; elsewhere: string | null }

export const TRAY_ITEMS = 6;

export function trayPayload(rows: HubRow[], others: MachineState[] = [], now = Date.now()): TrayPayload {
  const local = rows.flatMap((r) => (r.summary?.items ?? []).map((i) => ({ label: `${r.name} · ${i.title}`, project: r.name, path: i.path })));
  const answered = rows.reduce((n, r) => n + (r.summary?.answered ?? 0), 0);
  const fresh = others.filter((m) => now - Date.parse(m.writtenAt) <= STATE_STALE_MS);
  const remoteCount = fresh.reduce((n, m) => n + m.projects.reduce((k, p) => k + p.items.length, 0), 0);
  const paused = rows.flatMap((r) => (r.summary?.threads ?? []).filter((t) => t.state === "paused").map((t) => ({ label: `${t.title} · resumes ${t.until!.slice(11, 16)} UTC`, project: r.name, path: t.path })));
  const elsewhere = remoteCount ? `${remoteCount} more on ${fresh.filter((m) => m.projects.some((p) => p.items.length)).map((m) => m.machine).join(", ")}` : null;
  return { ok: true, needsYou: local.length + answered + remoteCount, items: local.slice(0, TRAY_ITEMS), more: Math.max(local.length - TRAY_ITEMS, 0), paused, elsewhere };
}

/** Every plan being worked or paused on a limit, one line each. Paused lines say when they can
 *  resume and what the card says comes next, so a thread waiting on a reset stops looking dead. */
export function inFlightBand(rows: HubRow[], now = Date.now()): string {
  // Only threads someone holds or that wait on a reset. A plan marked doing that nobody holds is not
  // in flight; it is a stale status, counted in one line rather than listed (the live hub had forty).
  const all = rows.flatMap((r) => (r.summary?.threads ?? []).map((t) => ({ r, t })));
  const lines = all.filter(({ t }) => t.state === "paused" || t.who);
  const stale = all.length - lines.length;
  const staleNote = stale ? `<p class="hub-stale">${stale} plan(s) are marked doing with no session holding them. Return them to todo, or claim them.</p>` : "";
  if (!lines.length) return staleNote ? `<section class="hub-band" aria-labelledby="hub-flight"><h2 id="hub-flight">In flight</h2>${staleNote}</section>` : "";
  const when = (iso: string) => { const m = Math.round((Date.parse(iso) - now) / 60_000); return m < 60 ? `in ${Math.max(m, 1)}m` : m < 48 * 60 ? `in ${Math.round(m / 60)}h` : `on ${iso.slice(0, 10)}`; };
  const li = lines.map(({ r, t }) => {
    const state = t.state === "paused" ? `Paused, resumes ${when(t.until!)}` : `Active, ${e(t.who ?? "")}`;
    return `<li class="hub-item${t.state === "paused" ? " is-paused" : ""}"><span class="hub-item__kind">${state}</span><span class="hub-item__project">${e(r.name)}</span><span class="hub-item__title">${e(t.title)}</span>${t.next ? `<span class="hub-item__detail">Next: ${e(t.next)}</span>` : ""}<a class="hub-item__act" href="${e(r.url.replace(/\/$/, "") + t.path)}">Open plan</a></li>`;
  }).join("");
  return `<section class="hub-band" aria-labelledby="hub-flight"><h2 id="hub-flight">In flight <span class="hub-meta">${lines.length}</span></h2><ul class="hub-items">${li}</ul>${staleNote}</section>`;
}

/** Every waiting item across every project, one line each, above the project list. Drift and
 *  out-of-scope writes stay off this band: they are an agent's diagnostics, read in the project. */
export function waitingBand(rows: HubRow[], others: MachineState[] = [], now = Date.now()): string {
  const lines = rows.flatMap((r) => (r.summary?.items ?? []).map((i) => ({ r, i })));
  const remote = others.flatMap((m) => m.projects.flatMap((p) => p.items.map((i) => ({ m, p, i }))));
  const stale = others.filter((m) => now - Date.parse(m.writtenAt) > STATE_STALE_MS);
  const staleNote = stale.length ? `<p class="hub-stale">${stale.map((m) => `${e(m.machine)} last reported ${ago(m.writtenAt, now)}`).join("; ")}, so its items may be out of date.</p>` : "";
  const remoteLi = remote.map(({ m, p, i }) => `<li class="hub-item is-remote"><span class="hub-item__kind">${e(KIND_LABEL[i.kind] ?? i.kind)}</span><span class="hub-item__project">${e(p.name)}</span><span class="hub-item__title">${e(i.title)}</span><span class="hub-item__detail">${e(i.detail)}</span><span class="hub-item__where">on ${e(m.machine)}, ${ago(m.writtenAt, now)}</span></li>`).join("");
  if (!lines.length && !remote.length) return `<section class="hub-band" aria-labelledby="hub-waiting"><h2 id="hub-waiting">Waiting on you</h2><p class="cc-empty">Nothing is waiting on you in any project.</p>${staleNote}</section>`;
  const li = lines.map(({ r, i }) => {
    const href = e(r.url.replace(/\/$/, "") + i.path);
    return `<li class="hub-item"><span class="hub-item__kind">${e(KIND_LABEL[i.kind] ?? i.kind)}</span><span class="hub-item__project">${e(r.name)}</span><span class="hub-item__title">${e(i.title)}</span><span class="hub-item__detail">${e(i.detail)}</span><a class="hub-item__act" href="${href}">${e(i.label)}</a></li>`;
  }).join("");
  return `<section class="hub-band" aria-labelledby="hub-waiting"><h2 id="hub-waiting">Waiting on you <span class="hub-meta">${lines.length + remote.length}</span></h2><ul class="hub-items">${li}${remoteLi}</ul>${staleNote}</section>`;
}

function row(r: HubRow, now: number): string {
  const name = `<a class="hub-name" href="${e(r.url)}">${e(r.name)}</a>`;
  if (!r.up) return `<li class="hub-row is-down">${name}<span class="hub-meta">down${r.note ? `: ${e(r.note)}` : ""}</span></li>`;
  if (r.pending) return `<li class="hub-row is-quiet">${name}<span class="hub-meta">reading its command center</span></li>`;
  if (!r.summary) return `<li class="hub-row is-quiet">${name}<span class="hub-meta">up, no command center to read</span></li>`;
  const s = r.summary;
  const u = (p: string) => e(r.url.replace(/\/$/, "") + p);
  const live = s.live ? `<span class="hub-live"><span class="cc-dot" aria-hidden="true"></span>${s.live} live${s.agentsRunning ? `, ${s.agentsRunning} subagent(s) running` : ""}</span>` : "";
  return `<li class="hub-row${s.live ? " is-live" : ""}">
  <div class="hub-head">${name}${live}<span class="hub-meta">${ago(s.lastSeenAt, now)}</span></div>
  <div class="hub-stats">
    ${stat(s.waiting, "waiting on you", u("/"), true)}
    ${stat(s.answered, "answers unread", u("/"), true)}
    ${s.next ? `<span class="hub-next">Next: ${e(s.next)}</span>` : ""}
  </div>
</li>`;
}

/** The whole page. Styles come from the first project that is up, since the hub serves none itself. */
export function hubHomePage(rows: HubRow[], now = Date.now(), others: MachineState[] = []): string {
  const styleBase = rows.find((r) => r.up)?.url.replace(/\/$/, "") ?? "";
  const links = styleBase ? STYLESHEETS.map((h) => `<link rel="stylesheet" href="${e(styleBase + h)}">`).join("\n  ") : "";
  const live = rows.reduce((n, r) => n + (r.summary?.live ?? 0), 0);
  const waiting = rows.reduce((n, r) => n + (r.summary ? r.summary.waiting + r.summary.answered : 0), 0);
  const body = rows.length
    ? `<ul class="hub-list">${rows.map((r) => row(r, now)).join("")}</ul>`
    : `<p class="cc-empty">No projects registered. Run <code>pantry register</code> in a project.</p>`;
  return `<!DOCTYPE html>
<html lang="en" data-themes="sourdough baguette brioche">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="${rows.some((r) => r.pending) ? 8 : 60}">
  <title>All projects · PANTRY</title>
  ${styleBase ? `<script src="${e(styleBase)}/scripts/theme-boot.js"></script>` : ""}
  ${links}
</head>
<body class="pantry-body" data-grade="smooth">
<nav class="pantry-nav"><a class="pantry-nav__brand" href="/">PANTRY</a><span class="hub-meta">All projects</span></nav>
<main class="pantry-main">
  <header class="hub-top">
    <h1>All projects</h1>
    <p class="cc-meta">${rows.length} registered · ${live} live session(s) · ${waiting} item(s) waiting on you. Each row is read from that project's command center and refreshes every minute.</p>
  </header>
  ${rows.length || others.length ? waitingBand(rows, others, now) : ""}
  ${inFlightBand(rows, now)}
  ${learnedBand(rows)}
  ${rows.length ? `<h2 class="hub-list-title">Projects</h2>` : ""}
  ${body}
</main>
${styleBase ? `<script src="${e(styleBase)}/scripts/theme.js" defer></script>` : ""}
<script>document.addEventListener("click", (ev) => { const b = ev.target.closest("[data-copy]"); if (!b) return; navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy Explain this prompt"; }, 1500); }).catch(() => {}); });</script>
</body>
</html>`;
}
