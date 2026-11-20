// pantry/hub-home.ts: the hub's front page, one row per registered project. It answers the question
// a person has before they know which project to open: where are agents working right now, and where
// is something waiting on me. Each row is read from that project's own /brief.json, so the hub holds
// no second copy of any project's state and can never disagree with the project's command center.
//
// The brief runs the doctor's fast checks and reads git, which is cheap once and expensive eighteen
// times at once: probing every project in parallel once pinned the container's CPU. So the fetches
// run a few at a time and each result is cached for HUB_BRIEF_TTL_MS.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { explainPrompt } from "./learn.ts";
import { escapeHtml as e } from "@tjakoen/mill/core/engine.ts";
import type { BriefPayload } from "./brief.ts";
import { SIDE_MODE_BOOT, STYLESHEETS, themeSwitch, themeSyncTag } from "./chrome.ts";
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
  /** "held" or "sunset" when the project's pantry.config.json says so; absent means active */
  lifecycle?: "held" | "sunset";
}

/** A project with no session for this long, and nothing live or waiting, counts as inactive. */
export const INACTIVE_AFTER_MS = 14 * 24 * 60 * 60_000;

/** Reads the owner's call from pantry.config.json: `"lifecycle": "held"` or `"sunset"`. */
export function readLifecycle(path: string): "held" | "sunset" | undefined {
  try {
    const v = (JSON.parse(readFileSync(join(path, "pantry.config.json"), "utf8")) as { lifecycle?: string }).lifecycle;
    return v === "held" || v === "sunset" ? v : undefined;
  } catch { return undefined; }
}

/** Why a row belongs on the shelf rather than the main list, or null when it is active. */
export function shelfReason(r: HubRow, now = Date.now()): string | null {
  if (r.lifecycle) return r.lifecycle;
  if (!r.up) return "inactive";
  const s = r.summary;
  if (!s || s.live || s.waiting || s.answered) return null;
  if (!s.lastSeenAt || now - Date.parse(s.lastSeenAt) > INACTIVE_AFTER_MS) return "inactive";
  return null;
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
    return { name: s.name, path: s.path, url: s.url, up: s.up, note: s.note, summary: hit?.summary ?? null, pending: s.up && !hit, lifecycle: readLifecycle(s.path) };
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

/** The sidebar every PANTRY page wears, for the hub's own pages. A project page builds the same
 *  shell in chrome.ts; this one lists the hub's views first and every project under them, so moving
 *  from the hub into a project keeps the frame and changes only the content. */
export function hubShell(current: "home" | "report", projects: { name: string; url: string; up?: boolean; shelved?: boolean }[]): { head: string; side: string } {
  const item = (href: string, label: string, icon: string, on: boolean) => on
    ? `<span class="pantry-side__item is-current" aria-current="page"><span class="pantry-side__icon" aria-hidden="true">${icon}</span>${label}</span>`
    : `<a class="pantry-side__item" href="${href}"><span class="pantry-side__icon" aria-hidden="true">${icon}</span>${label}</a>`;
  const link = (p: { name: string; url: string; up?: boolean }) => `<a class="pantry-side__item${p.up === false ? " is-down" : ""}" href="${e(p.url)}">${e(p.name)}</a>`;
  const sorted = projects.toSorted((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  const shelf = sorted.filter((p) => p.shelved);
  const list = sorted.filter((p) => !p.shelved).map(link).join("")
    + (shelf.length ? `<details class="pantry-side__shelf"><summary class="pantry-side__item">Inactive, held or sunset (${shelf.length})</summary>${shelf.map(link).join("")}</details>` : "");
  return {
    head: `<script>${SIDE_MODE_BOOT}</script>`,
    side: `<button type="button" class="pantry-side-toggle" aria-controls="pantry-side" aria-expanded="false" onclick="const o=document.body.classList.toggle('side-open');this.setAttribute('aria-expanded',String(o))">☰ Menu</button>
<nav class="pantry-nav pantry-side" id="pantry-side" aria-label="PANTRY">
  <a class="pantry-nav__brand" href="/">PANTRY</a>
  ${themeSwitch("pantry-nav__theme pantry-nav__theme--top")}
  <div class="pantry-side__group"><p class="pantry-side__label">Across projects</p>${item("/", "All projects", "◉", current === "home")}${item("/report", "Report", "▤", current === "report")}</div>
  ${projects.length ? `<div class="pantry-side__group"><p class="pantry-side__label">Projects</p>${list}</div>` : ""}
</nav>`,
  };
}

/** One dash-panel, GRAIN's dashboards layer, with a data-surface address an agent can point at. */
const panel = (id: string, title: string, count: number | null, body: string, span?: "2" | "full") =>
  `<section class="dash-panel" id="${id}" data-surface="panel:${id}"${span ? ` data-span="${span}"` : ""}><header class="dash-panel__head"><h3 class="dash-panel__title" id="hub-${id}">${e(title)}${count !== null ? ` <span class="hub-meta">${count}</span>` : ""}</h3></header>${body}</section>`;

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
  return panel("learned", "Done this week", all.length, `<details class="hub-learned-fold"><summary>What changed, why, and what to remember</summary>${groups}</details>`, "full");
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
  if (!lines.length) return staleNote ? panel("flight", "In flight", null, staleNote, "2") : "";
  const when = (iso: string) => { const m = Math.round((Date.parse(iso) - now) / 60_000); return m < 60 ? `in ${Math.max(m, 1)}m` : m < 48 * 60 ? `in ${Math.round(m / 60)}h` : `on ${iso.slice(0, 10)}`; };
  const li = lines.map(({ r, t }) => {
    const state = t.state === "paused" ? `Paused, resumes ${when(t.until!)}` : `Active, ${e(t.who ?? "")}`;
    return `<li class="rp-decide__row${t.state === "paused" ? " is-paused" : ""}"><span class="rp-sev">${t.state === "paused" ? "Paused" : "Active"}</span><div class="rp-decide__body"><p><b>${e(t.title)}</b> <span class="hub-item__project">${e(r.name)}</span></p><p class="hub-meta">${state}</p>${t.next ? `<p class="rp-act">Next: ${e(t.next)}</p>` : ""}</div><a class="btn" data-size="sm" href="${e(r.url.replace(/\/$/, "") + t.path)}">Open plan</a></li>`;
  }).join("");
  return panel("flight", "In flight", lines.length, `<ol class="rp-decide">${li}</ol>${staleNote}`, "2");
}

/** Waiting and in-flight work as one board, so the column says what to do: answer, do, unblock, or
 *  leave it to the session that holds it. A card names the item; its drawer, GRAIN's modal side
 *  panel, holds the detail and the one action, with the board still visible behind it. The columns
 *  are PROOF's, the same board every project page shows its plans on. */
export const WORK_COLUMNS = [
  { id: "answer", title: "Answer", hint: "Questions only you can answer." },
  { id: "do", title: "Do", hint: "Your plans; agent work waits on them." },
  { id: "unblock", title: "Unblock", hint: "Marked blocked with no reason recorded." },
  { id: "active", title: "Active", hint: "A session holds it." },
  { id: "paused", title: "Paused", hint: "Waiting on a usage limit to reset." },
] as const;

interface WorkCard { col: string; title: string; project: string; meta: string; detail: string; holds: string[]; next: string | null; href: string | null; label: string; weight: number }

export function workBoard(rows: HubRow[], others: MachineState[] = [], now = Date.now()): string {
  const colOf: Record<string, string> = { decision: "answer", "human-plan": "do", "blocked-plan": "unblock" };
  const holdsOf = (detail: string) => /(?:holds|Holds) (.+?)\.?$/.exec(detail)?.[1].split(/,\s*/).filter(Boolean) ?? [];
  const cards: WorkCard[] = [];
  const merged = new Map<string, WorkCard>();
  const add = (c: WorkCard) => {
    const k = `${c.col}\u0000${c.title}`;
    const had = merged.get(k);
    if (had) { had.project = `${had.project}, ${c.project}`; return; }
    merged.set(k, c); cards.push(c);
  };
  for (const r of rows) for (const i of r.summary?.items ?? []) {
    const holds = holdsOf(i.detail);
    add({ col: colOf[i.kind] ?? "answer", title: i.title, project: r.name, meta: holds.length ? `holds ${holds.length}` : "", detail: i.detail, holds, next: null, href: r.url.replace(/\/$/, "") + i.path, label: i.label, weight: -holds.length });
  }
  for (const m of others) for (const p of m.projects) for (const i of p.items) {
    const holds = holdsOf(i.detail);
    add({ col: colOf[i.kind] ?? "answer", title: i.title, project: p.name, meta: `on ${m.machine}, ${ago(m.writtenAt, now)}`, detail: i.detail, holds, next: null, href: null, label: "", weight: -holds.length });
  }
  const until = (iso: string) => { const m = Math.round((Date.parse(iso) - now) / 60_000); return m < 60 ? `in ${Math.max(m, 1)}m` : m < 48 * 60 ? `in ${Math.round(m / 60)}h` : `on ${iso.slice(0, 10)}`; };
  let stale = 0;
  for (const r of rows) for (const t of r.summary?.threads ?? []) {
    if (t.state !== "paused" && !t.who) { stale++; continue; }
    add({ col: t.state === "paused" ? "paused" : "active", title: t.title, project: r.name, meta: t.state === "paused" ? `resumes ${until(t.until!)}` : (t.who ?? ""), detail: t.state === "paused" ? `Paused on a usage limit; it can resume ${until(t.until!)}.` : `Held by ${t.who ?? "a session"}.`, holds: [], next: t.next, href: r.url.replace(/\/$/, "") + t.path, label: "Open plan", weight: 0 });
  }
  if (!cards.length && !stale) return `<p class="cc-empty">Nothing is waiting on you and nothing is in flight.</p>`;
  let n = 0;
  const drawers: string[] = [];
  const colHtml = WORK_COLUMNS.map((c) => {
    const list = cards.filter((x) => x.col === c.id).toSorted((a, b) => a.weight - b.weight);
    const html = list.map((x) => {
      const id = `work-${++n}`;
      drawers.push(`<aside class="drawer" id="${id}" data-drawer hidden><div class="drawer__backdrop" data-drawer-close></div><div class="drawer__panel" role="dialog" aria-modal="true" aria-labelledby="${id}-title"><header class="drawer__head"><h2 id="${id}-title">${e(x.title)}</h2><button class="icon-btn" data-variant="ghost" data-drawer-close aria-label="Close">✕</button></header><div class="drawer__body">
<p><span class="badge">${e(c.title)}</span> <span class="hub-item__project">${e(x.project)}</span></p>
${x.holds.length ? "" : `<p>${e(x.detail)}</p>`}
${x.holds.length ? `<h3>It holds ${x.holds.length} plan(s)</h3><ul>${x.holds.map((h) => `<li>${e(h)}</li>`).join("")}</ul>` : ""}
${x.next ? `<h3>Next</h3><p>${e(x.next)}</p>` : ""}
<p class="hub-meta">${e(c.hint)}</p>
${x.href ? `<p><a class="btn" href="${e(x.href)}">${e(x.label)}</a></p>` : `<p class="hub-meta">${e(x.meta)}. Open it on that machine.</p>`}
</div></div></aside>`);
      return `<button type="button" class="card proof-card" data-pad="sm" data-drawer-open="${id}" data-surface="card:${id}"><div class="proof-card__top"><span class="badge">${e(c.title)}</span></div><h3 class="card__title">${e(x.title)}</h3><p class="proof-card__meta">${e([x.project, x.meta].filter(Boolean).join(" · "))}</p></button>`;
    }).join("");
    return `<section class="proof-col" data-col="${c.id}"${list.length ? "" : " data-empty"}><header class="proof-col__head"><h2 class="proof-col__title">${e(c.title)}</h2><span class="proof-col__count">${list.length}</span></header><div class="proof-col__cards">${html || `<p class="proof-col__empty">${e(c.hint)}</p>`}</div></section>`;
  }).join("");
  const staleNote = stale ? `<p class="hub-stale">${stale} plan(s) are marked doing with no session holding them. Return them to todo, or claim them.</p>` : "";
  return `<div class="proof-board hub-board">${colHtml}</div>${staleNote}${drawers.join("")}`;
}

/** Every waiting item across every project, one line each, above the project list. Drift and
 *  out-of-scope writes stay off this band: they are an agent's diagnostics, read in the project. */
export function waitingBand(rows: HubRow[], others: MachineState[] = [], now = Date.now()): string {
  // The same order as the report's queue: what holds the most agent work first, a bare blocked mark last.
  const weight = (i: HubItem) => (i.kind === "decision" ? 0 : i.kind === "human-plan" ? 1 : 2) * 100 - (i.detail.match(/,/g)?.length ?? 0);
  const lines = rows.flatMap((r) => (r.summary?.items ?? []).map((i) => ({ r, i }))).toSorted((a, b) => weight(a.i) - weight(b.i));
  const remote = others.flatMap((m) => m.projects.flatMap((p) => p.items.map((i) => ({ m, p, i }))));
  const stale = others.filter((m) => now - Date.parse(m.writtenAt) > STATE_STALE_MS);
  const staleNote = stale.length ? `<p class="hub-stale">${stale.map((m) => `${e(m.machine)} last reported ${ago(m.writtenAt, now)}`).join("; ")}, so its items may be out of date.</p>` : "";
  const remoteLi = remote.map(({ m, p, i }) => `<li class="rp-decide__row is-remote"><span class="rp-sev">${e(KIND_LABEL[i.kind] ?? i.kind)}</span><div class="rp-decide__body"><p><b>${e(i.title)}</b> <span class="hub-item__project">${e(p.name)}</span></p><p class="hub-meta">${e(i.detail)}</p></div><span class="hub-meta">on ${e(m.machine)}, ${ago(m.writtenAt, now)}</span></li>`).join("");
  if (!lines.length && !remote.length) return panel("waiting", "Waiting on you", null, `<p class="cc-empty">Nothing is waiting on you in any project.</p>${staleNote}`, "full");
  const li = lines.map(({ r, i }) => {
    const href = e(r.url.replace(/\/$/, "") + i.path);
    return `<li class="rp-decide__row"><span class="rp-sev">${e(KIND_LABEL[i.kind] ?? i.kind)}</span><div class="rp-decide__body"><p><b>${e(i.title)}</b> <span class="hub-item__project">${e(r.name)}</span></p><p class="hub-meta">${e(i.detail)}</p></div><a class="btn" data-size="sm" href="${href}">${e(i.label)}</a></li>`;
  }).join("");
  return panel("waiting", "Waiting on you", lines.length + remote.length, `<ol class="rp-decide">${li}${remoteLi}</ol>${staleNote}`, "full");
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
  const shell = hubShell("home", rows.map((r) => ({ name: r.name, url: r.url, up: r.up, shelved: shelfReason(r, now) !== null })));
  const active = rows.filter((r) => shelfReason(r, now) === null);
  const shelved = rows.filter((r) => shelfReason(r, now) !== null);
  const paused = rows.reduce((n, r) => n + (r.summary?.threads ?? []).filter((t) => t.state === "paused").length, 0);
  const learned = rows.reduce((n, r) => n + (r.summary?.learned ?? []).length, 0);
  const tile = (n: number, label: string, href: string, tone?: "warn") => `<a class="stat" href="${href}" data-surface="stat:${href.slice(1)}"${tone && n ? ` data-tone="${tone}"` : ""}><span class="stat__value">${n}</span><span class="stat__label">${e(label)}</span></a>`;
  const body = rows.length
    ? `<ul class="hub-list">${active.map((r) => row(r, now)).join("")}</ul>${shelved.length ? `<details class="hub-shelf" data-surface="shelf:projects"><summary>Inactive, held or sunset <span class="hub-meta">${shelved.length}</span></summary><ul class="hub-list">${shelved.map((r) => row(r, now).replace('<span class="hub-meta">', `<span class="hub-shelf__why">${e(shelfReason(r, now)!)}</span><span class="hub-meta">`)).join("")}</ul></details>` : ""}`
    : `<p class="cc-empty">No projects registered. Run <code>pantry register</code> in a project.</p>`;
  return `<!DOCTYPE html>
<html lang="en" data-themes="sourdough baguette brioche">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>All projects · PANTRY</title>
  ${styleBase ? `<script src="${e(styleBase)}/scripts/theme-boot.js"></script>` : ""}
  ${shell.head}
  ${links}
  ${themeSyncTag()}
</head>
<body class="pantry-body" data-grade="smooth">
${shell.side}
<main class="pantry-main">
<div class="dash" data-surface="dashboard:hub">
  <header class="dash__head">
    <h2 class="dash__title">All projects</h2>
    <p class="dash__period">${rows.length} registered, read from each project's command center at ${new Date().toISOString().slice(11, 16)} UTC and again every minute.</p>
  </header>
  <div class="dash__kpis">${tile(waiting, "waiting on you", "#work", "warn")}${tile(live, "live sessions", "#work")}${tile(paused, "paused on a limit", "#work", "warn")}${tile(learned, "done this week", "#learned")}${tile(rows.length, "projects", "#projects")}</div>
  <div class="dash__grid">
  ${rows.length || others.length ? panel("work", "Your work", null, workBoard(rows, others, now), "full") : ""}
  ${rows.length ? panel("projects", "Projects", rows.length, body, "full") : body}
  ${learnedBand(rows)}
  </div>
</div>
</main>
${styleBase ? `<script src="${e(styleBase)}/scripts/theme.js" defer></script><script src="${e(styleBase)}/scripts/drawer.js" defer></script>` : ""}
<script>/* Reload to stay current, but never under an open drawer: a reload would close it mid-read. */
setInterval(() => { if (!document.querySelector("[data-drawer]:not([hidden])")) location.reload(); }, ${rows.some((r) => r.pending) ? 8000 : 60000});</script>
<script>document.addEventListener("click", (ev) => { const b = ev.target.closest("[data-copy]"); if (!b) return; navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy Explain this prompt"; }, 1500); }).catch(() => {}); });</script>
</body>
</html>`;
}
