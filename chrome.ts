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

// The project this PANTRY is serving, said in the header on every page, with a switcher to the
// others when the hub runs it. Eighteen projects look identical in a browser tab otherwise.
function projectSwitch(project: string | undefined, hub: ReturnType<typeof hubRegistry>): string {
  if (!project) return "";
  const name = `<span class="pantry-nav__project-name">${escapeHtml(project)}</span>`;
  if (!hub || hub.projects.length < 2) return `<span class="pantry-nav__project" title="The project this PANTRY is serving">${name}</span>`;
  const items = hub.projects.map((p) => p === project
    ? `<span class="pantry-nav__current" aria-current="true">${escapeHtml(p)}</span>`
    : `<a href="${hub.url}open/${encodeURIComponent(p)}">${escapeHtml(p)}</a>`).join("");
  return `<details class="pantry-nav__menu pantry-nav__project"><summary title="Switch project">${name}</summary><div class="pantry-nav__drop pantry-nav__drop--projects"><a class="pantry-nav__hub" href="${hub.url}">All projects</a>${items}</div></details>`;
}

export function nav(surfaces: PantrySurfaces, review: boolean, project?: string): string {
  // Three areas, so the bar stays short as surfaces grow. The command center is the front door; Work
  // is everything an agent produces or waits on; Project is how the codebase and its rules read. Each
  // menu is a native details element, so it opens without a script and closes on its own toggle.
  const menu = (label: string, items: (string | false | undefined)[]) => {
    const list = items.filter(Boolean);
    return list.length ? `<details class="pantry-nav__menu"><summary>${label}</summary><div class="pantry-nav__drop">${list.join("")}</div></details>` : "";
  };
  const work = menu("Work", [
    surfaces.plans && `<a href="/plans">Plans</a>`,
    surfaces.decisions && `<a href="/decisions">Decisions</a>`,
    surfaces.runs && `<a href="/runs">Runs</a>`,
    (surfaces.brief || surfaces.control) && `<a href="/activity">Activity</a>`,
    surfaces.control && `<a href="/control">Sessions by plan</a>`,
    surfaces.timeline && `<a href="/timeline">Plan timeline</a>`,
    surfaces.artifacts && `<a href="/artifacts">Artifacts</a>`,
  ]);
  const projectMenu = menu("Project", [
    `<a href="/map">Map</a>`,
    surfaces.standards && `<a href="/standards">Standards</a>`,
    `<a href="/llms.txt">llms.txt</a>`,
    `<a href="/about">About</a>`,
  ]);
  const hub = hubRegistry();
  const links = [
    surfaces.brief && `<a href="/">Command center</a>`,
    work,
    projectMenu,
    // Only when the proxy is on, because it is the only time there is anything to review. A nav
    // entry that leads to an empty frame is worse than no entry.
    review && `<a href="/review">Review</a>`,
  ].filter(Boolean).join("\n  ");
  // The theming controls are GRAIN's, driven by attributes rather than by any code here: theme.js
  // binds anything carrying data-toggle-scheme or data-cycle-theme, and writes the current flavor
  // name into data-theme-name. PANTRY declares the flavor list on <html> and provides the buttons;
  // it owns none of the logic, which is the point (the cockpit consumes the stack, never forks it).
  return `<nav class="pantry-nav">
  <a class="pantry-nav__brand" href="/">PANTRY</a>
  ${projectSwitch(project, hub)}
  ${links}
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
  ${styleLinks}
</head>
<body class="pantry-body${opts.fullBleed ? " pantry-body--full" : ""}" data-grade="smooth">
  ${nav(surfaces, opts.review ?? false, opts.project)}
  <main class="pantry-main${opts.fullBleed ? " pantry-main--full" : ""}">${body}</main>
  ${opts.fullBleed ? "" : madeWith()}
  <script src="/scripts/theme.js" defer></script>
  <script src="/pantry-cmdk.js" defer></script>
  <script>document.addEventListener("click",(ev)=>{for(const d of document.querySelectorAll(".pantry-nav__menu[open]"))if(!d.contains(ev.target))d.removeAttribute("open")});</script>${opts.fullBleed ? `\n  <script src="/pantry-review.js" defer></script>` : ""}
</body>
</html>`;
}
