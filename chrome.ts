// pantry/chrome.ts, split out of app.ts. The page markup for one surface; app.ts keeps the routing.
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { madeWith } from "@tjakoen/grain/scripts/made-with.js";
import { type PantrySurfaces } from "./config.ts";

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
export function nav(surfaces: PantrySurfaces, review: boolean): string {
  const links = [
    // Only when the proxy is on, because it is the only time there is anything to review. A nav
    // entry that leads to an empty frame is worse than no entry.
    review && `<a href="/review">Review</a>`,
    surfaces.plans && `<a href="/plans">Plans</a>`,
    surfaces.decisions && `<a href="/decisions">Decisions</a>`,
    surfaces.control && `<a href="/control">Control</a>`,
    surfaces.runs && `<a href="/runs">Runs</a>`,
    surfaces.artifacts && `<a href="/artifacts">Artifacts</a>`,
    surfaces.timeline && `<a href="/timeline">Timeline</a>`,
    surfaces.standards && `<a href="/standards">Standards</a>`,
    `<a href="/about">About</a>`,
  ].filter(Boolean).join("\n  ");
  // The theming controls are GRAIN's, driven by attributes rather than by any code here: theme.js
  // binds anything carrying data-toggle-scheme or data-cycle-theme, and writes the current flavor
  // name into data-theme-name. PANTRY declares the flavor list on <html> and provides the buttons;
  // it owns none of the logic, which is the point (the cockpit consumes the stack, never forks it).
  return `<nav class="pantry-nav">
  <a class="pantry-nav__brand" href="/">PANTRY</a>
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
  <title>${escapeHtml(title)} · PANTRY</title>
  <script src="/scripts/theme-boot.js"></script>
  ${styleLinks}
</head>
<body class="pantry-body${opts.fullBleed ? " pantry-body--full" : ""}" data-grade="smooth">
  ${nav(surfaces, opts.review ?? false)}
  <main class="pantry-main${opts.fullBleed ? " pantry-main--full" : ""}">${body}</main>
  ${opts.fullBleed ? "" : madeWith()}
  <script src="/scripts/theme.js" defer></script>
  <script src="/pantry-cmdk.js" defer></script>${opts.fullBleed ? `\n  <script src="/pantry-review.js" defer></script>` : ""}
</body>
</html>`;
}
