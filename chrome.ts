// pantry/chrome.ts, split out of app.ts. The page markup for one surface; app.ts keeps the routing.
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { madeWith } from "@tjakoen/grain/scripts/made-with.js";
import { type PantrySurfaces } from "./config.ts";
import { readFileSync } from "node:fs";

export const STYLESHEETS = [
  "/styles/variables.css", "/styles/global.css", "/styles/grain.css",
  "/components.css", "/proof.css", "/pantry.css",
];
export const styleLinks = STYLESHEETS.map((h) => `<link rel="stylesheet" href="${h}">`).join("\n  ");
// The nav — surfaces gate the links (config.surfaces). Brand stays PANTRY (the app); the host
// project's name shows in the home lede. The reshape (piece 8): the front nav carries the project's
// own front door (Plans) + Standards + About; /docs·/reference·/catalog are DEMOTED out of the human
// nav (they stay mounted + AI-retrievable, reached from the home "Reference surfaces" row) — cutting
// them would undo PANTRY's founding pivot (see PLAN §The reshape).
/** The hub registry, when this server is a hub child (the hub sets PANTRY_PROJECT). Read per page
 *  render: it is a small file and a project registered a minute ago should show up in the switcher. */
function hubRegistry(): { url: string; projects: string[] } | null {
  if (!process.env.PANTRY_PROJECT) return null;
  try {
    const home = process.env.PANTRY_HOME ?? `${process.env.HOME ?? ""}/.pantry`;
    const reg = JSON.parse(readFileSync(`${home}/projects.json`, "utf8")) as { hubPort?: number; projects?: { name: string }[] };
    return { url: `http://localhost:${reg.hubPort ?? 4400}/`, projects: (reg.projects ?? []).map((p) => p.name).sort((x, y) => x.localeCompare(y)) };
  } catch {
    return { url: "http://localhost:4400/", projects: [] };
  }
}

// The project this PANTRY is serving, and the others the hub runs, as a list down the sidebar. A
// worktree or variant (a name that starts with another project's name and a hyphen) folds under
// that project, so twenty entries read as the handful of repos they really are.
function projectList(project: string | undefined, hub: ReturnType<typeof hubRegistry>): string {
  if (!project) return "";
  if (!hub || hub.projects.length < 2) return `<div class="pantry-side__group"><p class="pantry-side__label">Project</p><span class="pantry-side__item is-current" aria-current="true">${escapeHtml(project)}</span></div>`;
  const parentOf = (p: string) => hub.projects.filter((q) => q !== p && p.startsWith(`${q}-`)).sort((a, b) => b.length - a.length)[0];
  const roots = hub.projects.filter((p) => !parentOf(p));
  const item = (p: string) => p === project
    ? `<span class="pantry-side__item is-current" aria-current="true">${escapeHtml(p)}</span>`
    : `<a class="pantry-side__item" href="${hub.url}open/${encodeURIComponent(p)}">${escapeHtml(p)}</a>`;
  const rows = roots.map((r) => {
    const kids = hub.projects.filter((p) => parentOf(p) === r);
    if (!kids.length) return item(r);
    const open = kids.includes(project) ? " open" : "";
    return `${item(r)}<details class="pantry-side__fold"${open}><summary>${kids.length} more</summary>${kids.map(item).join("")}</details>`;
  }).join("");
  return `<div class="pantry-side__group"><p class="pantry-side__label">Projects <a class="pantry-side__hub" href="${hub.url}">all</a></p>${rows}</div>`;
}

export function nav(surfaces: PantrySurfaces, review: boolean, project?: string): string {
  // A sidebar, the way a workspace app lays itself out: projects at the top, then four views, then
  // everything else folded under More. Four views is the point. The eleven pages behind them stay
  // mounted and reachable; they stop competing for the first glance.
  const link = (href: string, label: string, icon: string) => `<a class="pantry-side__item" href="${href}"><span class="pantry-side__icon" aria-hidden="true">${icon}</span>${label}</a>`;
  const views = [
    surfaces.brief && link("/", "Now", "◉"),
    surfaces.plans && link("/plans", "Plans", "☰"),
    review && link("/review", "Review", "◐"),
    link("/map", "Project", "▦"),
  ].filter(Boolean).join("");
  const more = [
    surfaces.decisions && `<a class="pantry-side__item" href="/decisions">Decisions</a>`,
    surfaces.runs && `<a class="pantry-side__item" href="/runs">Runs</a>`,
    surfaces.runs && `<a class="pantry-side__item" href="/usage">Usage</a>`,
    (surfaces.brief || surfaces.control) && `<a class="pantry-side__item" href="/activity">Activity</a>`,
    surfaces.control && `<a class="pantry-side__item" href="/control">Sessions by plan</a>`,
    surfaces.timeline && `<a class="pantry-side__item" href="/timeline">Plan timeline</a>`,
    surfaces.artifacts && `<a class="pantry-side__item" href="/artifacts">Artifacts</a>`,
    surfaces.standards && `<a class="pantry-side__item" href="/standards">Standards</a>`,
    `<a class="pantry-side__item" href="/llms.txt">llms.txt</a>`,
    `<a class="pantry-side__item" href="/about">About</a>`,
  ].filter(Boolean).join("");
  const hub = hubRegistry();
  // The theming controls are GRAIN's, driven by attributes rather than by any code here: theme.js
  // binds anything carrying data-toggle-scheme or data-cycle-theme, and writes the current flavor
  // name into data-theme-name. PANTRY provides the buttons and owns none of the logic.
  return `<nav class="pantry-nav pantry-side" id="pantry-side" aria-label="PANTRY">
  <a class="pantry-nav__brand" href="/">PANTRY</a>
  ${projectList(project, hub)}
  <div class="pantry-side__group"><p class="pantry-side__label">Views</p>${views}</div>
  <details class="pantry-side__group pantry-side__more"><summary class="pantry-side__label">More</summary>${more}</details>
  <span class="pantry-nav__theme">
    <button type="button" class="pantry-nav__themebtn" data-cycle-theme title="Change flavor"><span data-theme-name>sourdough</span></button>
    <button type="button" class="pantry-nav__themebtn" data-toggle-scheme title="Light or dark" aria-label="Toggle light and dark">◐</button>
  </span>
</nav>`;
}

// The one page shell every PANTRY-owned surface shares. The mounted layers (PROOF, MILL) get this
// same wrapper injected as their `chrome`, so the host owns the head + asset links everywhere.
export interface PantryPageOptions {
  /** show the Review entry in the nav (only meaningful while the preview proxy is on) */
  review?: boolean;
  /** the review shell fills the viewport and draws its own footer-free layout, so it opts out of
   *  the centred column and the made-with footer that every reading surface wants */
  fullBleed?: boolean;
  /** the project's name, shown in the header and the tab title */
  project?: string;
}

// Sidebar mode: one column for a narrow pane beside the work (a Claude desktop pane, a slim app
// window). It turns on below 28rem wide, or with ?mode=side, and the same URL serves both. This runs
// in the head, before the stylesheets paint, so the wide layout never flashes first; it also follows
// the window as it is resized. ?mode=side sticks for the tab through sessionStorage.
const SIDE_MODE_BOOT = `(()=>{const q=new URLSearchParams(location.search).get("mode");if(q)sessionStorage.setItem("pantry-mode",q);const forced=sessionStorage.getItem("pantry-mode")==="side";const m=matchMedia("(max-width: 28rem)");const set=()=>document.documentElement.classList.toggle("is-side",forced||m.matches);set();m.addEventListener("change",set)})();`;

export function pantryPage(title: string, body: string, surfaces: PantrySurfaces, opts: PantryPageOptions = {}): string {
  // data-themes declares the flavor list theme.js cycles through; the flavors themselves are token
  // blocks in GRAIN's variables.css, so this names them rather than defining them.
  // theme-boot.js is render-BLOCKING and first on purpose: it puts the saved attributes on <html>
  // before the stylesheets paint, and deferring it would flash the default theme on every
  // navigation, which is the one bug a theme toggle is guaranteed to be blamed for.
  return `<!DOCTYPE html>
<html lang="en" data-themes="sourdough baguette brioche">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}${opts.project ? ` · ${escapeHtml(opts.project)}` : ""} · PANTRY</title>
  <script src="/scripts/theme-boot.js"></script>
  <script>${SIDE_MODE_BOOT}</script>
  ${styleLinks}
</head>
<body class="pantry-body${opts.fullBleed ? " pantry-body--full" : ""}" data-grade="smooth">
  <button type="button" class="pantry-side-toggle" aria-controls="pantry-side" aria-expanded="false" onclick="const o=document.body.classList.toggle('side-open');this.setAttribute('aria-expanded',String(o))">☰ Menu</button>
  ${nav(surfaces, opts.review ?? false, opts.project)}
  <main class="pantry-main${opts.fullBleed ? " pantry-main--full" : ""}">${body}</main>
  ${opts.fullBleed ? "" : madeWith()}
  <script src="/scripts/theme.js" defer></script>
  <script src="/pantry-cmdk.js" defer></script>
  <script>for(const a of document.querySelectorAll(".pantry-side a.pantry-side__item")){const u=new URL(a.href,location.href);if(u.origin===location.origin&&u.pathname===location.pathname){a.classList.add("is-current");a.setAttribute("aria-current","page");a.closest("details")?.setAttribute("open","")}}</script>${opts.fullBleed ? `\n  <script src="/pantry-review.js" defer></script>` : ""}
</body>
</html>`;
}
