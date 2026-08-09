// pantry/app.ts — PANTRY, the installable developer-docs + AI cockpit APP. It COMPOSES the layers
// (the pivot, 2026-07-08): BATCH serves, GRAIN styles, MILL renders the framework docs, PROOF
// renders the project's plan board, and GRAIN's own reference + catalog round out the cockpit — all
// under one server you `bunx pantry` into any project. This is the composition root; nothing imports
// PANTRY. It reads the HOST project's content (plans + optional docs, via the host contract in
// config.ts) and resolves its OWN bundled assets/docs via package resolution (never a relative path),
// so it runs from anywhere and survives the repo split.
import { join, dirname, basename, normalize, sep, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, realpathSync, statSync } from "node:fs";
import { bunRuntime } from "@tjakoen/batch/platform/bun-runtime.ts";
import { makeStatic } from "@tjakoen/batch/http/static.ts";
import { createStyleBundle } from "@tjakoen/batch/assets/style-bundle.ts";
import { createStream } from "@tjakoen/batch/http/stream.ts";
import { createMillRoutes, dirSource, type ContentSource, type MillCollection } from "@tjakoen/mill/serve.ts";
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { renderGrainDocument } from "@tjakoen/mill/adapters/grain/grain-adapter.ts";
import { madeWith } from "@tjakoen/grain/scripts/made-with.js";
import { createProofRoutes } from "@tjakoen/proof/routes.ts";
import { watchPlans } from "@tjakoen/proof/live.ts";
import { buildVocabReference } from "@tjakoen/grain/ai/vocab-reference.ts";
import { createCatalog } from "@tjakoen/grain/catalog/catalog.ts";
import { loadPantryConfig, type ResolvedPantryConfig, type PantrySurfaces } from "./config.ts";
import { PANTRY_PREFIX, proxyToPreview, rebasePantryCss, rebasePantryHtml, resolvePreviewTarget, withPantryBase } from "./preview.ts";
import { buildKnowledge, renderLlmsTxt } from "./retrieval.ts";
import { buildMapPayload, type MapPayload } from "./map.ts";
import { buildDecisionsPayload, type DecisionsPayload, type DecisionRequest } from "./decisions.ts";
import { buildArtifactsPayload, classifyArtifact, type ArtifactsPayload, type ArtifactEntry } from "./artifacts.ts";
import { buildRunsPayload, type RunsPayload, type RunReport, type RunPair, type EvidenceGap } from "./runs.ts";
import { runDoctor, type DoctorReport, type DoctorCheck } from "./doctor.ts";
import { buildTimelinePayload, type TimelinePayload, type TimelinePlan } from "./timeline.ts";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// The framework DOC dirs, the proof stylesheet, and the layer PLANs are resolved as PACKAGES
// (import.meta.resolve), so the same code works in the monorepo and after the split — the file
// travels inside the package. BATCH + GRAIN explanatory docs now live in the PORTFOLIO package
// (option b, 2026-07-09: tjakoen.github.io/docs/<layer>/), resolved from THAT package rather than
// each layer's; a host that doesn't install the portfolio auto-disables those surfaces (below).
// GRAIN_ROOT is the installed grain package's own directory (used as a root for styles/ +
// components/, which aren't fixed export paths). Resolve it as a PACKAGE (via PLAN.md, a root
// export) so it travels inside the package — works in any host, whether grain is a git dep, a
// published dep, or (since the 2026-07-19 grain-monorepo split) nested under packages/grain.
const GRAIN_ROOT = dirname(fileURLToPath(import.meta.resolve("@tjakoen/grain/PLAN.md")));
const PROOF_CSS = fileURLToPath(import.meta.resolve("@tjakoen/proof/board.css"));
const BOARD_LIVE_JS = fileURLToPath(import.meta.resolve("@tjakoen/proof/board-live.js"));
// The standards docs are canonically homed in the PORTFOLIO package (tjakoen.github.io/standards/,
// since the 2026-07-09 fold-in) — resolved like the framework docs, so pantry renders them from the
// installed portfolio package in any host, not a sibling of the monorepo. A host that doesn't install
// the portfolio resolves to null and the /standards surface auto-disables (below).
const STANDARDS_DIR = resolveDirOrNull("tjakoen.github.io/standards/README.md");
function resolveDirOrNull(specifier: string): string | null {
  try { return dirname(fileURLToPath(import.meta.resolve(specifier))); }
  catch { return null; }
}

const STYLESHEETS = [
  "/styles/variables.css", "/styles/global.css", "/styles/grain.css",
  "/components.css", "/proof.css", "/pantry.css",
];
const styleLinks = STYLESHEETS.map((h) => `<link rel="stylesheet" href="${h}">`).join("\n  ");

// A framework doc / plan leads with its own `# Title` heading, so MILL's default note masthead
// (which re-emits the derived title) would double it under PANTRY's own chrome. Render the body
// only; the grade guardrail still runs (data-grade="smooth"). Same fix PROOF uses for its detail.
const bodyOnlyLayout = ({ body }: { body: string }) => `<article class="note" data-grade="smooth">${body}</article>`;

// A ContentSource over a fixed slug→file map — for docs that don't share one folder (the layer
// PLANs live one-per-package at `<layer>/PLAN.md`, not in a docs/ dir).
function filesSource(files: Record<string, string>): ContentSource {
  return {
    list: async () => Object.keys(files),
    read: async (slug) => {
      const file = files[slug.toLowerCase()];
      return file ? Bun.file(file).text() : null;
    },
  };
}

// A package-resolved docs dir, or null when the package (or path) isn't installed — so a surface
// can auto-disable instead of crashing at module load (same posture as STANDARDS_DIR).
function packageDocsSourceOrNull(anchor: string): ContentSource | null {
  const dir = resolveDirOrNull(anchor);
  return dir ? dirSource(dir) : null;
}
// BATCH + GRAIN docs are canonically homed in the portfolio (option b); resolve them from that package.
const BATCH_DOCS = packageDocsSourceOrNull("tjakoen.github.io/docs/batch/ARCHITECTURE.md");
const GRAIN_DOCS = packageDocsSourceOrNull("tjakoen.github.io/docs/grain/GRAIN.md");
if (!BATCH_DOCS || !GRAIN_DOCS) {
  console.warn("[pantry] framework docs off: tjakoen.github.io (the docs-home package) not installed in this host");
}

// The framework doc sets PANTRY BUNDLES + renders through MILL (the host provides nothing for these).
// Each is a layer's own canonical docs/PLAN, rendered (not copied) — the single source stays in the
// origin package (batch/grain docs now home in the portfolio); PANTRY is a projection.
const FRAMEWORK_DOCS: MillCollection[] = ([
  BATCH_DOCS && { prefix: "/docs/batch", title: "BATCH", description: "The no-build, server-rendered hypermedia substrate.",
    source: BATCH_DOCS, adapter: { defaultLayout: bodyOnlyLayout } },
  GRAIN_DOCS && { prefix: "/docs/grain", title: "GRAIN", description: "The AI-interaction design system and default theme.",
    source: GRAIN_DOCS, adapter: { defaultLayout: bodyOnlyLayout } },
  { prefix: "/docs/plans", title: "Layer plans",
    description: "Each layer's own design plan (its canonical PLAN.md), rendered. Distinct from /plans — that's this project's task board.",
    source: filesSource({
      grain: fileURLToPath(import.meta.resolve("@tjakoen/grain/PLAN.md")),
      mill: fileURLToPath(import.meta.resolve("@tjakoen/mill/PLAN.md")),
      proof: fileURLToPath(import.meta.resolve("@tjakoen/proof/PLAN.md")),
      pantry: join(MODULE_DIR, "PLAN.md"),
    }),
    adapter: { defaultLayout: bodyOnlyLayout } },
] as (MillCollection | false | null)[]).filter(Boolean) as MillCollection[];

// The five stack members, for the home page. Status is honest (the honesty clause).
const MEMBERS = [
  { name: "BATCH", role: "The no-build, server-rendered hypermedia substrate.", href: "/docs/batch", status: "built" },
  { name: "GRAIN", role: "The AI-interaction design system + default theme (grain = AI).", href: "/docs/grain", status: "built" },
  { name: "MILL", role: "Markdown in, GRAIN pages out. The content engine.", href: "/docs", status: "built" },
  { name: "PROOF", role: "The AI plan board — plans as files, this board is their projection.", href: "/plans", status: "core + board built" },
  { name: "PANTRY", role: "This app: the layers composed into one dev-docs + AI cockpit.", href: "/", status: "early" },
];

// Slug + title for a host docs dir. Common case is `./docs` (basename "docs") → the project's own
// docs, mounted at /docs/project and titled with the project name.
function hostDocsCollection(dir: string, projectName: string): MillCollection {
  const raw = basename(dir).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const slug = raw === "docs" ? "project" : raw;
  const title = slug === "project" ? projectName : basename(dir);
  return {
    prefix: `/docs/${slug}`, title, description: `${projectName}'s own docs, rendered in place (never copied).`,
    source: filesSourceFromDir(dir), adapter: { defaultLayout: bodyOnlyLayout },
  };
}

// The exact MILL doc collections an install serves — bundled framework docs (when /docs on) + the
// host's own docs dirs (rendered in place). Exported so the doc-drift lint (drift.ts) reads the SAME
// brain the handler serves; /standards is a surface, not a brain doc collection (mirrors buildKnowledge).
export function buildDocCollections(config: ResolvedPantryConfig): MillCollection[] {
  return [
    ...(config.surfaces.docs ? FRAMEWORK_DOCS : []),
    ...(config.surfaces.docs ? config.docsDirs.map((d) => hostDocsCollection(d, config.projectName)) : []),
  ];
}

// The review shell (P1): PANTRY's chrome drawn AROUND the project it is proxying. The project sits
// in a same-origin frame at the root, so it is the real running app rather than a picture of one,
// and PANTRY keeps the rail beside it.
//
// The rail reads the reviewed project's OWN tour manifest, fetched through the proxy at
// /crumb/tours.json. That is the whole reason this needs no new config key: a host that mounts CRUMB
// answers it, a host that does not returns a 404 and the rail quietly carries only its navigation.
// PANTRY never parses a tour here; CRUMB keeps drawing the card and the lamp inside the frame, which
// is the call the plan left open and the owner settled on 2026-08-10 — the standalone path for a
// GRAIN host with no PANTRY alongside stays intact.
function reviewBody(previewTarget: string, surfaces: PantrySurfaces): string {
  const railLinks = [
    surfaces.plans && [`${PANTRY_PREFIX}/plans`, "Plans"],
    surfaces.runs && [`${PANTRY_PREFIX}/runs`, "Runs"],
    surfaces.decisions && [`${PANTRY_PREFIX}/decisions`, "Decisions"],
    surfaces.artifacts && [`${PANTRY_PREFIX}/artifacts`, "Artifacts"],
    surfaces.timeline && [`${PANTRY_PREFIX}/timeline`, "Timeline"],
  ].filter(Boolean) as [string, string][];

  return `<div class="pantry-review" data-rail="open">
  <aside class="pantry-review__rail" aria-label="Review rail">
    <div class="pantry-review__railhead">
      <b class="pantry-review__title">Review</b>
      <span class="pantry-review__target">${escapeHtml(previewTarget)}</span>
    </div>
    <section class="pantry-review__group" aria-labelledby="pantry-review-tours">
      <h2 class="pantry-review__grouptitle" id="pantry-review-tours">Reviews</h2>
      <ol class="pantry-review__tours" data-tours>
        <li class="pantry-review__empty">Looking for tours in the reviewed project…</li>
      </ol>
    </section>
    <!-- A demo tour is product work: it shows someone round the app. A review tour is dev work: it
         asks someone to check a change. They share a file format and nothing else, and mixing them
         in one list makes the rail read as a menu rather than a queue. Demos are kept, because a
         reviewer sometimes does want to walk the product, but they are second and folded away. -->
    <details class="pantry-review__group" data-demos-group hidden>
      <summary class="pantry-review__grouptitle">Demo tours</summary>
      <ol class="pantry-review__tours" data-demos></ol>
      <p class="pantry-review__note">Product walkthroughs, not review work. Here because they run in the same frame.</p>
    </details>
    <section class="pantry-review__group" aria-labelledby="pantry-review-steps" data-steps-group hidden>
      <h2 class="pantry-review__grouptitle" id="pantry-review-steps">Steps</h2>
      <ol class="pantry-review__steps" data-steps></ol>
      <p class="pantry-review__note">The card and the lamp are drawn by the project itself, inside the frame. This rail says where you are; it does not drive the walk.</p>
    </section>
    <section class="pantry-review__group" aria-labelledby="pantry-review-cockpit">
      <h2 class="pantry-review__grouptitle" id="pantry-review-cockpit">Cockpit</h2>
      <ul class="pantry-review__links">
        ${railLinks.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join("\n        ")}
      </ul>
    </section>
  </aside>
  <div class="pantry-review__pane">
    <div class="pantry-review__bar">
      <button class="pantry-review__toggle" type="button" data-rail-toggle aria-expanded="true">Hide rail</button>
      <span class="pantry-review__url" data-frame-url>/</span>
      <a class="pantry-review__open" target="_blank" rel="noopener" data-frame-open>Open full</a>
    </div>
    <!-- The frame's target is carried in data-src and set by the client, NOT in src. Every
         root-absolute URL on a PANTRY page is rebased onto the reserved prefix on the way out, which
         is right for every link here and exactly wrong for this one: rebasing it would frame PANTRY
         inside PANTRY instead of the project. Caught by walking the shell, not by reading it. -->
    <iframe class="pantry-review__frame" data-src="/" title="The project being reviewed, served under PANTRY's origin" data-frame></iframe>
  </div>
</div>`;
}

// The nav — surfaces gate the links (config.surfaces). Brand stays PANTRY (the app); the host
// project's name shows in the home lede. The reshape (piece 8): the front nav carries the project's
// own front door (Plans) + Standards + About; /docs·/reference·/catalog are DEMOTED out of the human
// nav (they stay mounted + AI-retrievable, reached from the home "Reference surfaces" row) — cutting
// them would undo PANTRY's founding pivot (see PLAN §The reshape).
function nav(surfaces: PantrySurfaces, review: boolean): string {
  const links = [
    // Only when the proxy is on, because it is the only time there is anything to review. A nav
    // entry that leads to an empty frame is worse than no entry.
    review && `<a href="/review">Review</a>`,
    surfaces.plans && `<a href="/plans">Plans</a>`,
    surfaces.decisions && `<a href="/decisions">Decisions</a>`,
    surfaces.runs && `<a href="/runs">Runs</a>`,
    surfaces.artifacts && `<a href="/artifacts">Artifacts</a>`,
    surfaces.timeline && `<a href="/timeline">Timeline</a>`,
    surfaces.standards && `<a href="/standards">Standards</a>`,
    `<a href="/about">About</a>`,
  ].filter(Boolean).join("\n  ");
  return `<nav class="pantry-nav">
  <a class="pantry-nav__brand" href="/">PANTRY</a>
  ${links}
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
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · PANTRY</title>
  ${styleLinks}
</head>
<body class="pantry-body${opts.fullBleed ? " pantry-body--full" : ""}" data-grade="smooth">
  ${nav(surfaces, opts.review ?? false)}
  <main class="pantry-main${opts.fullBleed ? " pantry-main--full" : ""}">${body}</main>
  ${opts.fullBleed ? "" : madeWith()}
  <script src="/pantry-cmdk.js" defer></script>${opts.fullBleed ? `\n  <script src="/pantry-review.js" defer></script>` : ""}
</body>
</html>`;
}

// The home page (reshaped, piece 8). NOT the stack pitch — that moved to /about. Home is the HOST
// PROJECT's own front door: its plan board, plus the "working with AI" surfaces (AI-retrieval +
// mindmap), then a demoted "Reference surfaces" row that keeps /docs·/reference·/catalog reachable
// without putting them back in the front nav. AI-retrieval (piece 9) is LIVE — a real link to
// /llms.txt; the mindmap (piece 10) is also LIVE at /map.
const AI_SURFACES: { title: string; role: string; href?: string; status: string }[] = [
  { title: "AI-retrieval", role: "Machine-readable surfaces (llms.txt · knowledge.json) your own agent reads to work this project — model-free, pure reads.", href: "/llms.txt", status: "live" },
  { title: "Mindmap", role: "A picture of the AI's brain for this project: the whole-codebase knowledge graph, drawn for the human. Machine twin at /map.json.", href: "/map", status: "live" },
];
// Artifacts (piece 11e) is a real surface (config.surfaces.artifacts), unlike the two above which
// have no off-switch of their own — so its href is gated the same way the nav gates it (below), and
// the entry is dropped entirely when the surface is off rather than shown disabled.
function aiSurfaceTeasers(surfaces: PantrySurfaces): { title: string; role: string; href?: string; status: string }[] {
  return [
    ...AI_SURFACES,
    ...(surfaces.runs
      ? [{ title: "Runs", role: "The run ledger — what each closed run did, its gate output verbatim, and which of LOOP §9's evidence items it is missing. Machine twin at /runs.json.", href: "/runs", status: "live" }]
      : []),
    ...(surfaces.artifacts
      ? [{ title: "Artifacts", role: "Run evidence — screenshots, audit reports, diffs — served read-only. Machine twin at /artifacts.json.", href: "/artifacts", status: "live" }]
      : []),
    ...(surfaces.timeline
      ? [{ title: "Timeline", role: "The project's retrospective history — git-derived plan bars, dependency arrows, commit density. No forecast. Machine twin at /timeline.json.", href: "/timeline", status: "live" }]
      : []),
  ];
}
// The heartbeat row (piece 11e sub-unit 2): a compact freshness strip next to the board card, one
// pill per staleness check doctor already computes — model-free (doctor runs no model; every check is
// a stat/age compare). The tone maps the check's outcome onto the existing status-badge palette:
// ok → ok, else the severity (error → danger, warn → due, info → muted). Reuses doctor's own detail
// strings ("last audit 3 days old (…)", "3 pins, none behind", "12 pages, 0 problems", "graph 5 days
// old"), so the home never forecasts or re-derives anything — it just surfaces what doctor found. The
// deps-drift pill is the umbrella control-plane surface (are the layer pins current vs the sibling
// checkouts?); it degrades to a quiet info in an ordinary repo with no @tjakoen/* pins. Absent report
// → no strip.
const HEARTBEAT_IDS = ["audit-freshness", "deps-drift", "doc-drift", "graphify-freshness"] as const;
function heartbeatTone(c: DoctorCheck): "ok" | "danger" | "due" | "muted" {
  if (c.ok) return "ok";
  if (c.severity === "error") return "danger";
  if (c.severity === "warn") return "due";
  return "muted"; // info that isn't ok (rare) — quietest tone
}
function freshnessStrip(freshness: DoctorReport | null): string {
  if (!freshness) return "";
  const byId = new Map(freshness.checks.map((c) => [c.id, c]));
  const pills = HEARTBEAT_IDS
    .map((id) => byId.get(id))
    .filter((c): c is DoctorCheck => Boolean(c))
    .map((c) => `<span class="pantry-pill" data-tone="${heartbeatTone(c)}"><b class="pantry-pill__label">${escapeHtml(c.label)}</b> <span class="pantry-pill__detail">${escapeHtml(c.detail)}</span></span>`);
  if (!pills.length) return "";
  return `<div class="pantry-heartbeat" role="status" aria-label="Project heartbeat">
  ${pills.join("\n  ")}
  <span class="pantry-heartbeat__hint">Run pantry doctor for the full heartbeat.</span>
</div>`;
}

export function homeBody(config: ResolvedPantryConfig, surfaces: PantrySurfaces, freshness: DoctorReport | null): string {
  const teasers = aiSurfaceTeasers(surfaces).map((t) => {
    const inner = `<h3 class="card__title">${escapeHtml(t.title)}</h3>
    <p class="pantry-member__role">${escapeHtml(t.role)}</p>
    <span class="pantry-member__status">${escapeHtml(t.status)}</span>`;
    return t.href
      ? `<a class="card pantry-member" data-pad="sm" href="${escapeHtml(t.href)}">${inner}</a>`
      : `<div class="card pantry-member pantry-teaser" data-pad="sm" aria-disabled="true">${inner}</div>`;
  }).join("\n");
  // Demoted surfaces — out of the front nav, still mounted + AI-retrievable, one click from home.
  const more = [
    surfaces.docs && `<a href="/docs">Docs</a>`,
    surfaces.reference && `<a href="/reference">Reference</a>`,
    surfaces.catalog && `<a href="/catalog">Catalog</a>`,
  ].filter(Boolean).join("\n    ");
  return `<header>
  <h1 class="proof-masthead">${escapeHtml(config.projectName)}</h1>
  <p class="proof-lede">This project's cockpit — its <strong>plan board</strong>, and the surfaces the dev's own AI reads while it builds. PANTRY renders ${escapeHtml(config.projectName)} in place and runs no model of its own. Plans from ${escapeHtml(config.plansDir)}.</p>
</header>
${surfaces.plans ? `<a class="card pantry-board-card" data-pad="md" href="/plans">
  <h2 class="card__title">Plan board</h2>
  <p class="pantry-member__role">The project's plans and their state — PROOF's board, the front door.</p>
</a>` : ""}
${freshnessStrip(freshness)}
<section class="pantry-ai">
  <h2 class="pantry-section-title">Working with AI</h2>
  <div class="card-grid pantry-members">${teasers}</div>
</section>${more ? `
<section class="pantry-more">
  <h2 class="pantry-section-title">Reference surfaces</h2>
  <p class="pantry-member__role">Framework docs, generated reference, and the component catalog — retrievable by your agent, and a click away here.</p>
  <nav class="pantry-more__links">
    ${more}
  </nav>
</section>` : ""}`;
}

// /about — the "here's the BREAD stack" showcase the reshape moved off the home page (piece 8).
function aboutBody(): string {
  const cards = MEMBERS.map((m) => `<a class="card pantry-member" data-pad="sm" href="${escapeHtml(m.href)}">
    <h3 class="card__title">${escapeHtml(m.name)}</h3>
    <p class="pantry-member__role">${escapeHtml(m.role)}</p>
    <span class="pantry-member__status">${escapeHtml(m.status)}</span>
  </a>`).join("\n");
  return `<header>
  <h1 class="proof-masthead">The BREAD stack, in one place.</h1>
  <p class="proof-lede">PANTRY is the stack composed into one developer cockpit: BATCH serves, GRAIN styles, MILL renders the docs, PROOF boards the plans. Five members, one server you <code>bunx</code> into any project.</p>
</header>
<div class="card-grid pantry-members">${cards}</div>`;
}

function docsBody(collections: MillCollection[]): string {
  const items = collections.map((d) => `<a class="card pantry-member" data-pad="sm" href="${escapeHtml(d.prefix)}">
    <h3 class="card__title">${escapeHtml(d.title)}</h3>
    <p class="pantry-member__role">${escapeHtml(d.description ?? "")}</p>
  </a>`).join("\n");
  return `<header>
  <h1 class="proof-masthead">Docs</h1>
  <p class="proof-lede">The framework's own docs and this project's, rendered through MILL. The source lives at each origin; these pages are projections, never copies.</p>
</header>
<div class="card-grid pantry-members">${items}</div>`;
}

// /map (piece 10) — the mindmap: a picture of the AI's brain for this project. The whole-codebase
// knowledge graph (graphify's AST + document graph, consumed — never re-analysed) drawn for the
// human; the same model is the machine projection at /map.json. When the host hasn't run graphify
// the surface degrades to guidance (never a crash), matching every other absent-source surface.
function mapBody(payload: MapPayload): string {
  if (!payload.available) {
    return `<header>
  <h1 class="proof-masthead">Mindmap</h1>
  <p class="proof-lede">A picture of the AI's brain for ${escapeHtml(payload.project)} — the whole-codebase knowledge graph, drawn for the human. It reads the graph your own tooling generates; PANTRY runs no model of its own.</p>
</header>
<div class="card pantry-map-empty" data-pad="md">
  <h2 class="card__title">No map yet</h2>
  <p class="pantry-member__role">${escapeHtml(payload.reason)}</p>
  <pre class="pantry-map-cmd"><code>graphify update .            # this repo's code + doc graph
graphify merge-graphs …      # optional: a whole-stack map</code></pre>
</div>`;
  }
  const s = payload.stats;
  const stat = (n: number | string, label: string) =>
    `<div class="pantry-stat"><span class="pantry-stat__n">${escapeHtml(String(n))}</span><span class="pantry-stat__label">${escapeHtml(label)}</span></div>`;
  const repoChips = s.repos.map((r) =>
    `<span class="pantry-repo-chip" data-repo="${escapeHtml(r.repo || "·")}">${escapeHtml(r.repo || "·")} <b>${r.nodes}</b></span>`).join("");
  const gods = payload.gods.map((g) =>
    `<li><code>${escapeHtml(g.label)}</code> <span class="pantry-member__role">${escapeHtml(g.repo)} · ${g.degree} links</span></li>`).join("\n");
  return `<header>
  <h1 class="proof-masthead">Mindmap</h1>
  <p class="proof-lede">A picture of the AI's brain for ${escapeHtml(payload.project)}: the whole-codebase knowledge graph, clustered by community and coloured by repo, with the central nodes surfaced. Model-free — the same graph the machine reads at <a href="/map.json">/map.json</a>.</p>
</header>
<section class="pantry-stats">
  ${stat(s.nodeCount, "nodes")}
  ${stat(s.linkCount, "links")}
  ${stat(s.repos.length, "repos")}
  ${stat(s.communityCount, "communities")}
  ${stat(s.godNodeCount, "hubs")}
</section>
<div class="pantry-repo-legend">${repoChips}</div>
<figure class="pantry-map" data-grade="smooth">
  <canvas id="pantry-map-canvas" role="img" aria-label="Interactive knowledge graph of ${escapeHtml(payload.project)}"></canvas>
  <noscript><p class="pantry-member__role">The interactive map needs JavaScript. The central nodes are listed below.</p></noscript>
</figure>
<section class="pantry-gods">
  <h2 class="pantry-section-title">Central nodes</h2>
  <p class="pantry-member__role">The graph's highest-degree hubs — the load-bearing files and symbols an agent hits first.</p>
  <ol class="pantry-god-list">${gods}</ol>
</section>
<script src="/pantry-map.js" defer></script>`;
}

// /decisions (piece 11d) — the decision inbox. The INDEX: open decisions first (what the human owes an
// answer), then the resolved ledger tail. Model-free, read-only; the payload is the machine twin at
// /decisions.json. An absent dir degrades to guidance (how to write a decision-request), never a crash.
function decisionCard(d: DecisionRequest): string {
  const badge = `<span class="pantry-decision-badge" data-status="${d.status}">${d.status}</span>`;
  const rec = d.recommendation
    ? `<p class="pantry-member__role">Recommends: ${escapeHtml(d.recommendation)}</p>`
    : "";
  return `<a class="card pantry-member pantry-decision-card" data-pad="sm" href="/decisions/${encodeURIComponent(d.id)}">
    <h3 class="card__title">${escapeHtml(d.title)} ${badge}</h3>
    <p class="pantry-member__role">${d.options.length} option${d.options.length === 1 ? "" : "s"}</p>
    ${rec}
  </a>`;
}

function decisionsIndexBody(payload: DecisionsPayload): string {
  const header = `<header>
  <h1 class="proof-masthead">Decisions</h1>
  <p class="proof-lede">Open decisions the AI has routed to you for ${escapeHtml(payload.project)} — the question, its options, and the evidence, side by side. You resolve one by generating a prompt to paste back into chat; PANTRY runs no model and writes nothing. Machine twin at <a href="/decisions.json">/decisions.json</a>.</p>
</header>`;
  if (!payload.available) {
    return `${header}
<div class="card pantry-map-empty" data-pad="md">
  <h2 class="card__title">No decision inbox yet</h2>
  <p class="pantry-member__role">Write decision-requests as markdown here and they show up as cards:</p>
  <pre class="pantry-map-cmd"><code>${escapeHtml(payload.dir)}/&lt;id&gt;.md</code></pre>
  <p class="pantry-member__role">Each file carries a title, status (open/resolved), an options list, an optional recommendation, and evidence links in its frontmatter, with the context in the body.</p>
</div>`;
  }
  const open = payload.decisions.filter((d) => d.status === "open");
  const resolved = payload.decisions.filter((d) => d.status === "resolved");
  const openSection = open.length
    ? `<section class="pantry-decisions-open">
  <h2 class="pantry-section-title">Open — ${open.length}</h2>
  <div class="card-grid pantry-members">${open.map(decisionCard).join("\n")}</div>
</section>`
    : `<section class="pantry-decisions-open">
  <div class="card pantry-map-empty" data-pad="md"><h2 class="card__title">Nothing open</h2>
  <p class="pantry-member__role">No decision is waiting on you. New ones the AI files will appear here.</p></div>
</section>`;
  const resolvedSection = resolved.length
    ? `<section class="pantry-decisions-resolved">
  <h2 class="pantry-section-title">Resolved — ${resolved.length}</h2>
  <p class="pantry-member__role">The ledger tail: decisions already made. Each file records the choice and the reasoning.</p>
  <div class="card-grid pantry-members">${resolved.map(decisionCard).join("\n")}</div>
</section>`
    : "";
  return `${header}\n${openSection}\n${resolvedSection}`;
}

// Render an agent-written markdown body (a decision request, a run report) to a clean HTML fragment
// (body only, no masthead) via the same GRAIN adapter every other doc uses. Falls back to escaped
// plain text if the render ever throws, so a single odd file can't 500 the surface. Shared by
// /decisions and /runs — both render prose the agent wrote and PANTRY only reads.
function renderAgentBody(md: string): string {
  if (!md.trim()) return "";
  try {
    return renderGrainDocument(md, { defaultLayout: ({ body }: { body: string }) => body }).html;
  } catch {
    return `<p class="pantry-member__role">${escapeHtml(md)}</p>`;
  }
}

// The DETAIL view: the question + options (radios) + evidence, an always-present notes box, and the
// "generate prompt" button. All resolution logic is client-side (pantry-decisions.js) assembling a
// prompt string — PANTRY never POSTs, never writes. The data-* attributes feed that script the file
// path + title it needs to build the paste-back instruction.
function decisionDetailBody(d: DecisionRequest): string {
  const opts = d.options.length
    ? d.options.map((opt, i) => {
        const id = `opt-${i}`;
        const isRec = d.recommendation === opt;
        return `<label class="pantry-decision-option${isRec ? " pantry-decision-option--rec" : ""}" for="${id}">
      <input type="radio" name="decision-option" id="${id}" value="${escapeHtml(opt)}"${isRec ? " checked" : ""}>
      <span>${escapeHtml(opt)}${isRec ? ' <em class="pantry-decision-rec-tag">recommended</em>' : ""}</span>
    </label>`;
      }).join("\n")
    : `<p class="pantry-member__role">This request lists no discrete options — decide in the notes below.</p>`;

  const evidence = d.evidence.length
    ? `<aside class="pantry-decision-evidence">
    <h2 class="pantry-section-title">Evidence</h2>
    <ul>${d.evidence.map((e) =>
      e.href
        ? `<li><a href="${escapeHtml(e.href)}">${escapeHtml(e.label)}</a></li>`
        : `<li>${escapeHtml(e.label)}</li>`,
    ).join("")}</ul>
  </aside>`
    : "";

  const resolvedBanner = d.status === "resolved"
    ? `<p class="pantry-decision-resolved-banner">This decision is already marked resolved. Generating a prompt again will re-record it.</p>`
    : "";

  return `<header>
  <h1 class="proof-masthead">${escapeHtml(d.title)} <span class="pantry-decision-badge" data-status="${d.status}">${d.status}</span></h1>
  <p class="proof-lede"><a href="/decisions">← All decisions</a></p>
</header>
${resolvedBanner}
<article class="note pantry-decision-body" data-grade="smooth">${renderAgentBody(d.body)}</article>
<div class="pantry-decision"
     data-decision-id="${escapeHtml(d.id)}"
     data-decision-title="${escapeHtml(d.title)}"
     data-decision-file="${escapeHtml(d.file)}">
  <div class="pantry-decision-grid">
    <section class="pantry-decision-options">
      <h2 class="pantry-section-title">Options</h2>
      ${opts}
    </section>
    ${evidence}
  </div>
  <label class="pantry-decision-notes-label" for="decision-notes">Additional notes (always sent)</label>
  <textarea id="decision-notes" class="pantry-decision-notes" rows="4" placeholder="Anything the AI should know beyond the chosen option — constraints, a different option entirely, follow-ups."></textarea>
  <button type="button" class="pantry-decision-generate" id="decision-generate">Generate prompt</button>
  <div class="pantry-decision-output" hidden>
    <label class="pantry-decision-notes-label" for="decision-prompt">Prompt — copy this into chat</label>
    <textarea id="decision-prompt" class="pantry-decision-prompt" rows="10" readonly></textarea>
    <button type="button" class="pantry-decision-copy" id="decision-copy">Copy</button>
  </div>
</div>
<script src="/pantry-decisions.js" defer></script>`;
}

// /runs (piece 11c, the human half) — the RUN LEDGER surface. The INDEX lists closed runs newest
// first; the DETAIL renders one report against LOOP §9. Static server-rendered like /artifacts (no
// client script), model-free and read-only like every surface: runs.ts already did every judgement
// (it is key lookups and prefix compares), so this file only ever renders what it was handed.
//
// The one thing this view must not do is soften the ledger. A report missing its diffstat says so on
// the card, and scope growth is named rather than folded into a count, because the whole reason a
// session hands the owner this link instead of a chat summary is that the page cannot flatter the run
// the way a summary can. Machine twin at /runs.json — same payload, so the two never drift.
function runPairList(pairs: RunPair[]): string {
  return `<ul class="pantry-run-pairs">${pairs.map((p) => {
    const label = escapeHtml(p.label);
    return `<li><b>${label}</b>${p.detail ? ` <span class="pantry-member__role">${escapeHtml(p.detail)}</span>` : ""}</li>`;
  }).join("")}</ul>`;
}

// Plans carry an optional href that decisions.ts's safeHref already vetted in the data layer, so the
// view renders it without re-deciding — the guard sits below this file on purpose.
function runPlanList(pairs: RunPair[]): string {
  return `<ul class="pantry-run-pairs">${pairs.map((p) =>
    p.detail
      ? `<li><a href="${escapeHtml(p.detail)}">${escapeHtml(p.label)}</a></li>`
      : `<li><b>${escapeHtml(p.label)}</b></li>`,
  ).join("")}</ul>`;
}

function runCard(r: RunReport): string {
  // The card carries the COUNT and lets the detail carry the labels. Spelling every gap out here made
  // the scope-growth gap say the same thing twice, once as a label and once as the growth line below.
  const evidence = r.gaps.length
    ? `<p class="pantry-run-gaps">${r.gaps.length} of 9 evidence items missing</p>`
    : `<p class="pantry-member__role">Carries its evidence.</p>`;
  const growth = r.outOfScope.length
    ? `<p class="pantry-run-growth">Scope grew: ${r.outOfScope.length} path${r.outOfScope.length === 1 ? "" : "s"} outside the declared envelope</p>`
    : "";
  // The diffstat gets its OWN line rather than trailing the date · branch run. A real one is long
  // enough to wrap that line to three and squash the card's neighbour in the grid, and shortening it
  // was rejected on the same grounds as everywhere else on this surface: the page does not truncate
  // evidence, so the fix is layout.
  const diffstat = r.diffstat
    ? `<p class="pantry-run-diffstat">${escapeHtml(r.diffstat)}</p>`
    : "";
  return `<a class="card pantry-member pantry-run-card" data-pad="sm" href="/runs/${encodeURIComponent(r.id)}">
    <h3 class="card__title">${escapeHtml(r.title)} <span class="pantry-run-badge" data-status="${r.status}">${r.status}</span></h3>
    <p class="pantry-member__role">${escapeHtml(r.date ?? "no date")}${r.branch ? ` · ${escapeHtml(r.branch)}` : ""}</p>
    ${diffstat}
    ${evidence}
    ${growth}
  </a>`;
}

function runsIndexBody(payload: RunsPayload): string {
  const header = `<header>
  <h1 class="proof-masthead">Runs</h1>
  <p class="proof-lede">The run ledger for ${escapeHtml(payload.project)} — what each closed run did, the gate output it pasted verbatim, and which of LOOP §9's nine evidence items it is missing. Written by the agent, only read here. Machine twin at <a href="/runs.json">/runs.json</a>.</p>
</header>`;
  if (!payload.available) {
    return `${header}
<div class="card pantry-map-empty" data-pad="md">
  <h2 class="card__title">No run ledger yet</h2>
  <p class="pantry-member__role">A run closes with one markdown report here and it shows up as a card:</p>
  <pre class="pantry-map-cmd"><code>${escapeHtml(payload.dir)}/&lt;date&gt;-&lt;slug&gt;.md</code></pre>
  <p class="pantry-member__role">Frontmatter carries the declared scope, what was touched, the gates and their results, the diffstat, and who did the second pass. The body carries three headings: Gate output, What was not done, What needs human eyes.</p>
</div>`;
  }
  if (!payload.runs.length) {
    return `${header}
<div class="card pantry-map-empty" data-pad="md">
  <h2 class="card__title">The ledger is empty</h2>
  <p class="pantry-member__role">The folder exists and no run has closed with a report yet. The next one writes here:</p>
  <pre class="pantry-map-cmd"><code>${escapeHtml(payload.dir)}/&lt;date&gt;-&lt;slug&gt;.md</code></pre>
</div>`;
  }
  const summary = payload.incompleteCount
    ? `<p class="pantry-run-summary" data-tone="due">${payload.count} run${payload.count === 1 ? "" : "s"}, ${payload.incompleteCount} missing evidence.</p>`
    : `<p class="pantry-run-summary" data-tone="ok">${payload.count} run${payload.count === 1 ? "" : "s"}, all carrying their evidence.</p>`;
  return `${header}
${summary}
<div class="card-grid pantry-members">${payload.runs.map(runCard).join("\n")}</div>`;
}

// The DETAIL view. Order is deliberate and is the reviewer's reading order, not the file's: a
// five-fact summary strip (is this worth reading), then what is MISSING (the reason to open the page
// at all), then scope growth, then the meta, then the report's own prose last — because the body is
// where a run is most able to sound finished.
function runDetailBody(r: RunReport): string {
  // The scope-growth gap's label spells out every path that grew, and the section below lists them
  // again as bullets. Shorten the checklist line rather than dropping it: the count stays honest and
  // the six paths get named once.
  const gapLabel = (g: EvidenceGap) =>
    g.id === "scope-growth" ? "touched outside the declared scope (listed below)" : g.label;
  const gaps = r.gaps.length
    ? `<section class="pantry-run-section">
  <h2 class="pantry-section-title">Missing evidence — ${r.gaps.length} of 9</h2>
  <ul class="pantry-run-gap-list">${r.gaps.map((g) => `<li data-gap="${escapeHtml(g.id)}">${escapeHtml(gapLabel(g))}</li>`).join("")}</ul>
</section>`
    : `<section class="pantry-run-section">
  <h2 class="pantry-section-title">Evidence complete</h2>
  <p class="pantry-member__role">This report carries all nine of LOOP §9's items. That is the report being complete, which is not the same as the change being right.</p>
</section>`;

  const growth = r.outOfScope.length
    ? `<section class="pantry-run-section">
  <h2 class="pantry-section-title">Scope growth — ${r.outOfScope.length}</h2>
  <p class="pantry-member__role">Touched, and outside every path the run declared before it started. LOOP §4b makes growth an ask-trigger rather than a judgement the run makes alone.</p>
  <ul class="pantry-run-gap-list">${r.outOfScope.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
</section>`
    : "";

  const meta: string[] = [];
  if (r.date) meta.push(`<div><dt>Closed</dt><dd>${escapeHtml(r.date)}</dd></div>`);
  if (r.branch) meta.push(`<div><dt>Branch</dt><dd>${escapeHtml(r.branch)}</dd></div>`);
  if (r.diffstat) meta.push(`<div><dt>Diffstat</dt><dd>${escapeHtml(r.diffstat)}</dd></div>`);
  if (r.unpushed) meta.push(`<div><dt>Unpushed</dt><dd>${escapeHtml(r.unpushed.label)}${r.unpushed.detail ? ` — ${escapeHtml(r.unpushed.detail)}` : ""}</dd></div>`);
  if (r.verifiedBy) meta.push(`<div><dt>Verified by</dt><dd>${escapeHtml(r.verifiedBy)}</dd></div>`);
  if (r.doctor) meta.push(`<div><dt>Doctor</dt><dd>${escapeHtml(r.doctor)}</dd></div>`);
  const metaBlock = meta.length
    ? `<dl class="pantry-run-meta">${meta.join("")}</dl>`
    : "";

  const block = (title: string, inner: string) =>
    inner ? `<section class="pantry-run-section"><h2 class="pantry-section-title">${title}</h2>${inner}</section>` : "";

  // Accordions for the middle. <details> is the whole mechanism: every PANTRY surface but /decisions
  // and /map is static server-rendered, and wanting a section to fold is not a reason to make this
  // the first one that ships a client script. The count sits in the summary line so the sections
  // still skim shut.
  //
  // What may NOT fold, and this is the constraint the surface exists to serve: the missing-evidence
  // list, scope growth, the gates with their results, and the report body that carries gate output
  // verbatim. LOOP §4a's point is that the evidence is PRESENT rather than summarized, and a thing
  // behind a click is a thing nobody opens. Only the run's own inventory of itself folds.
  const fold = (title: string, count: number, inner: string) =>
    inner
      ? `<details class="pantry-run-section pantry-run-fold">
  <summary class="pantry-section-title">${title} <span class="pantry-run-fold-count">${count}</span></summary>
  ${inner}
</details>`
      : "";

  // The one-line answer to "do I need to read this", before anything else on the page: how it ended,
  // when, how big, which LOOP §4b lane it ran in, how much of §9 it carries, whether it stayed inside
  // its envelope. Every fact here is also below in full — this shortens the DECISION to read on,
  // never the evidence. The lane is the one that can be missing: it is optional in the schema, and a
  // report that never declared one says nothing rather than guessing on its behalf.
  // Label above value, the same way round as the meta list right below it — the two blocks are the
  // same kind of thing and reading them in opposite orders is what made the first cut hard to scan.
  const summaryItem = (value: string, label: string, tone?: string) =>
    `<div${tone ? ` data-tone="${tone}"` : ""}><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
  const summaryBlock = `<div class="pantry-run-summary-block">
  ${summaryItem(r.status, "outcome", r.status === "blocked" ? "due" : undefined)}
  ${summaryItem(r.date ?? "no date", "closed", r.date ? undefined : "due")}
  ${summaryItem(r.diffstat ?? "no diffstat", "diffstat", r.diffstat ? undefined : "due")}
  ${r.lane ? summaryItem(r.lane, "lane", r.lane === "human" ? "due" : undefined) : ""}
  ${summaryItem(`${9 - r.gaps.length} of 9`, "evidence carried", r.gaps.length ? "due" : undefined)}
  ${summaryItem(r.outOfScope.length ? `grew by ${r.outOfScope.length}` : "held", "scope", r.outOfScope.length ? "due" : undefined)}
</div>`;

  return `<header>
  <h1 class="proof-masthead">${escapeHtml(r.title)} <span class="pantry-run-badge" data-status="${r.status}">${r.status}</span></h1>
  <p class="proof-lede"><a href="/runs">← All runs</a></p>
</header>
${summaryBlock}
${gaps}
${growth}
${metaBlock}
${block("Gates", r.gates.length ? runPairList(r.gates) : "")}
${block("Left dirty", r.dirty.length ? runPairList(r.dirty) : "")}
${fold("Plans claimed", r.plans.length, r.plans.length ? runPlanList(r.plans) : "")}
${fold("Declared scope", r.scope.length, r.scope.length ? `<ul class="pantry-run-pairs">${r.scope.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : "")}
${fold("Touched", r.touched.length, r.touched.length ? `<ul class="pantry-run-pairs">${r.touched.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : "")}
${fold("Skills", r.skills.length, r.skills.length ? `<p class="pantry-member__role">${r.skills.map((s) => escapeHtml(s)).join(" · ")}</p>` : "")}
<article class="note pantry-run-body" data-grade="smooth">${renderAgentBody(r.body)}</article>`;
}

// /artifacts (piece 11e sub-unit 1) — run evidence: screenshots, audit reports, diffs a run
// deposited. Static server-rendered (no client script, unlike /decisions and /map); the payload is
// the machine twin at /artifacts.json. An absent/empty dir degrades to guidance, never a crash —
// same posture as every other absent-source surface.
const KIND_LABEL: Record<ArtifactEntry["kind"], string> = {
  image: "image", report: "report", diff: "diff", html: "html", other: "file",
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

// A short "how long ago" for the newest-first list — humans scan for "what just happened", not a
// precise timestamp. Falls back to the ISO date once it's stale enough that "N days ago" stops helping.
function relativeAge(iso: string, now: Date): string {
  const then = new Date(iso);
  const ms = now.getTime() - then.getTime();
  if (!Number.isFinite(ms) || ms < 0) return then.toISOString().slice(0, 10);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return then.toISOString().slice(0, 10);
}

function artifactCard(a: ArtifactEntry, now: Date): string {
  const badge = `<span class="pantry-decision-badge pantry-artifact-badge" data-kind="${escapeHtml(a.kind)}">${escapeHtml(KIND_LABEL[a.kind])}</span>`;
  return `<a class="card pantry-member pantry-artifact-card" data-pad="sm" href="/artifacts/raw/${a.relPath.split("/").map(encodeURIComponent).join("/")}">
    <h3 class="card__title">${escapeHtml(a.name)} ${badge}</h3>
    <p class="pantry-member__role">${escapeHtml(a.relPath)}</p>
    <span class="pantry-member__status">${escapeHtml(humanSize(a.size))} · ${escapeHtml(relativeAge(a.mtime, now))}</span>
  </a>`;
}

function artifactsIndexBody(payload: ArtifactsPayload): string {
  const header = `<header>
  <h1 class="proof-masthead">Artifacts</h1>
  <p class="proof-lede">Run evidence for ${escapeHtml(payload.project)} — screenshots, audit reports, diffs a run deposited, served read-only. PANTRY runs no model and writes nothing here. Machine twin at <a href="/artifacts.json">/artifacts.json</a>.</p>
</header>`;
  if (!payload.available || payload.artifacts.length === 0) {
    return `${header}
<div class="card pantry-map-empty" data-pad="md">
  <h2 class="card__title">No artifacts yet</h2>
  <p class="pantry-member__role">Drop run evidence here and it shows up as cards:</p>
  <pre class="pantry-map-cmd"><code>${escapeHtml(payload.dir)}/&lt;file&gt;
${escapeHtml(payload.dir)}/&lt;run-id&gt;/&lt;file&gt;   # per-run subfolders are walked too</code></pre>
  <p class="pantry-member__role">Screenshots, audit reports, diffs — anything a run writes to prove what it did.</p>
</div>`;
  }
  const now = new Date();
  return `${header}
<section class="pantry-artifacts">
  <h2 class="pantry-section-title">${payload.count} artifact${payload.count === 1 ? "" : "s"}</h2>
  <div class="card-grid pantry-members">${payload.artifacts.map((a) => artifactCard(a, now)).join("\n")}</div>
</section>`;
}

// /timeline (piece 11e sub-unit 3) — the RETROSPECTIVE project timeline: one bar per plan spanning its
// git-derived created→end span, `depends` arrows between bars, a commit-density strip along the time
// axis, and dated audit-report markers. Same model (buildTimelinePayload) backs both the SVG and the
// machine twin at /timeline.json, so they never drift. Built to the FIGURES data-viz scaffold: a
// self-contained e-ink palette on the root, one coral accent (the "now" marker), no <style> block, no
// hardcoded hex below the root, status shown by a within-family fill tone AND a direct text label (not
// colour-alone). NO forecast, NO projected bar, NO "target" date anywhere — every date drawn is a real
// git commit, a real report mtime, or generatedAt ("now"). An absent git repo / no plans degrades to
// guidance, never a crash — same posture as every other absent-source surface.
const isoDay = (iso: string): string => iso.slice(0, 10);
const monthsRound = (days: number): number => Math.max(0, Math.round(days / 30));

// The within-family fill tones for the four PROOF statuses — never the sole signal (every bar also
// carries a direct text label of its status, per FIGURES' colour-not-alone rule).
const STATUS_TONE: Record<string, string> = {
  todo: "var(--bar)", doing: "var(--muted)", done: "var(--ink)", blocked: "var(--edge)",
};

// The ordered (date, status) waypoints a plan's bar is segmented at: `created` (with the first known
// status, or the plan's current status if history never captured one) followed by every later
// transition. Empty when the plan has no readable git history (created is null) — the row then renders
// a "no git history" note instead of a bar.
function timelineWaypoints(p: TimelinePlan): { date: string; status: string }[] {
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
function timelineEnd(p: TimelinePlan, generatedAt: string): string {
  if (p.status === "done") return p.done ?? p.lastActivity ?? generatedAt;
  return p.lastActivity ?? generatedAt;
}

function timelineSvg(payload: TimelinePayload): string {
  const plans = payload.plans;
  const minIso = payload.earliest ?? payload.generatedAt;
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
  const ariaLabel = `Retrospective timeline of ${plans.length} plan${plans.length === 1 ? "" : "s"} over ${months} month${months === 1 ? "" : "s"}; ${doneCount} done, ${activeCount} in progress.`;

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
  <text x="14" y="${payoffY}" style="fill:var(--ink);font-size:13px">No forecast — every date above is a real git commit or "now".</text>
</svg>`;
}

function timelineBody(payload: TimelinePayload): string {
  const header = `<header>
  <h1 class="proof-masthead">Timeline</h1>
  <p class="proof-lede">A retrospective picture of ${escapeHtml(payload.project)}'s own history — plan bars from git-derived status-transition dates, dependency arrows, commit density, and audit-report markers. PANTRY runs no model; every date here is a real git commit, a real report's mtime, or "now" — never a forecast or an estimate. Machine twin at <a href="/timeline.json">/timeline.json</a>.</p>
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
<section class="pantry-timeline-audits">
  <h2 class="pantry-section-title">Audit markers</h2>
  ${auditList}
</section>`;
}

// The Content-Type served for a raw artifact — the same extension table `classifyArtifact` sorts
// on, plus the handful of exact types worth being precise about (an `other` kind still deserves the
// right MIME when it's a knowable extension; only truly unknown extensions fall to octet-stream).
const RAW_CONTENT_TYPE: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif",
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".diff": "text/plain; charset=utf-8", ".patch": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".log": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8", ".pdf": "application/pdf",
};
function rawContentType(name: string): string {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return RAW_CONTENT_TYPE[ext] ?? "application/octet-stream";
}

// Resolve a requested artifact path safely against the absolute artifactsDir and serve its bytes.
// SECURITY: `reqPath` is attacker-controlled (it's the URL path segment after /artifacts/raw/, already
// URL-decoded by the caller) — it can legitimately contain `../../etc/passwd`, an absolute path, or a
// segment that resolves through a symlink to somewhere outside artifactsDir. `join` alone does NOT
// stop `..` (it normalises the string but happily walks above the base), so this resolves the joined
// path to its real, symlink-expanded form and then checks it is still (a) exactly artifactsDir's real
// path (only possible if reqPath is empty) or (b) a real descendant of it — i.e. starts with the real
// artifactsDir plus a path separator. Anything else — traversal, an absolute reqPath, or a symlink
// that escapes the dir — returns 404 without ever opening the file. The file must also actually exist
// (not just resolve validly) before we treat it as in-bounds, so a nonexistent path can't be probed.
async function serveArtifactRaw(artifactsDir: string, reqPath: string): Promise<Response> {
  const joined = resolve(artifactsDir, `.${sep}${reqPath}`);
  if (!existsSync(joined)) return new Response("Not found", { status: 404 });
  let realBase: string;
  let realTarget: string;
  try {
    realBase = realpathSync(artifactsDir);
    realTarget = realpathSync(joined);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const inBounds = realTarget === realBase || realTarget.startsWith(realBase + sep);
  if (!inBounds) return new Response("Not found", { status: 404 });
  let st;
  try {
    st = statSync(realTarget);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!st.isFile()) return new Response("Not found", { status: 404 }); // no directory listings
  const contentType = rawContentType(basename(realTarget));
  const headers: Record<string, string> = { "Content-Type": contentType };
  // A served HTML artifact must not be able to script the cockpit origin (it's arbitrary run output,
  // not PANTRY's own content) — sandbox it and stop MIME-sniffing from upgrading anything else to HTML.
  if (contentType.startsWith("text/html")) {
    headers["Content-Security-Policy"] = "sandbox";
    headers["X-Content-Type-Options"] = "nosniff";
  }
  return new Response(Bun.file(realTarget), { headers });
}

export interface PantryOptions {
  /** the HOST project's plans folder (absolute or cwd-relative) — back-compat shorthand */
  plansDir: string;
  /** the full resolved host config (from loadPantryConfig); when omitted a default is derived from plansDir */
  config?: ResolvedPantryConfig;
  /** the HOST project root — where doctor runs its heartbeat checks (CLAUDE.md/AUDIT.md/standards live
   *  here, not under plansDir). servePantryFromCwd passes it; when omitted it falls back to the plans
   *  dir's parent (plansDir is conventionally <cwd>/plans). */
  cwd?: string;
  /** override GRAIN's location (defaults to the resolved package) */
  grainRoot?: string;
}

const defaultConfig = (plansDir: string): ResolvedPantryConfig => ({
  cwd: dirname(plansDir),
  projectName: basename(dirname(plansDir)) || "project",
  plansDir, docsDirs: [], graphPath: null, graphDir: join(dirname(plansDir), "graphify-out"),
  decisionsDir: join(plansDir, "decisions"),
  artifactsDir: join(dirname(plansDir), "artifacts"),
  runsDir: join(dirname(plansDir), "artifacts", "runs"),
  previewTarget: null,
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true, decisions: true, artifacts: true, timeline: true, runs: true },
});

export function createPantryHandler(opts: PantryOptions) {
  const config = opts.config ?? defaultConfig(opts.plansDir);
  // /standards renders from the portfolio package's standards/ folder (STANDARDS_DIR above). A host
  // that doesn't install tjakoen.github.io resolves to null — auto-disable the surface (drops the
  // nav link + route) rather than serve an empty page. filesSourceFromDir is also null-safe, so this
  // is belt + braces.
  if (config.surfaces.standards && (!STANDARDS_DIR || !existsSync(STANDARDS_DIR))) {
    console.warn("[pantry] /standards off: tjakoen.github.io (standards/) not installed in this host");
    config.surfaces.standards = false;
  }
  const { surfaces } = config;
  // The host root doctor's heartbeat reads from — CLAUDE.md/AUDIT.md/standards sit here. The resolved
  // config already knows it (loadPantryConfig set config.cwd), so there is nothing to guess; an
  // explicit opts.cwd still wins for a caller that overrides.
  const cwd = opts.cwd ?? config.cwd;
  const grainRoot = opts.grainRoot ?? GRAIN_ROOT;
  const page = (title: string, body: string) => pantryPage(title, body, surfaces, { review: !!config.previewTarget });

  const serveStyles = makeStatic(bunRuntime, join(grainRoot, "styles"));
  // GRAIN's own variables.css has always asked for the Redaction grades at /fonts/…, and PANTRY has
  // never mounted them, so the cockpit's display face has silently fallen back since the first page
  // it rendered. Found while proving the preview proxy, where the same missing request stopped being
  // invisible and started being aimed at the reviewed project's root instead.
  const fontsRoot = resolve(join(grainRoot, "fonts"));
  const componentCss = createStyleBundle(bunRuntime, join(grainRoot, "components"));

  // Every MILL collection this install serves (framework docs + host docs); /standards is appended
  // below for the router but stays a surface, not a brain doc collection. buildDocCollections is the
  // single source so the doc-drift lint reads exactly what the server serves.
  const docCollections = buildDocCollections(config);
  const standardsCollection: MillCollection = {
    prefix: "/standards", title: "Standards",
    description: "The cross-repo writing + presentation standards (VOICE, NOTE, README, FIGURES), rendered.",
    source: filesSourceFromDir(STANDARDS_DIR), adapter: { defaultLayout: bodyOnlyLayout },
  };

  // One SSE hub, shared between the /stream subscribe route below and the piece-3 file watcher
  // started at the bottom of this function — a BATCH host reusing one host-wide stream, same
  // pattern as the standalone proof/serve.ts (which owns its own private stream instead).
  const stream = createStream();
  const proofRoutes = createProofRoutes({
    plansDir: config.plansDir, prefix: "/plans", chrome: (title, body) => page(title, body),
    liveScriptSrc: "/board-live.js",
  });
  const millRoutes = createMillRoutes({
    collections: [...docCollections, ...(surfaces.standards ? [standardsCollection] : [])],
    chrome: (input) => page(input.title, input.body),
  });
  const catalog = surfaces.catalog
    ? createCatalog(join(grainRoot, "components"), undefined, { headEnd: styleLinks })
    : null;

  // Piece 3: watch the host's plans/ and broadcast a live board replace on every change. PANTRY
  // has no app-wide teardown/close path today (it's `Bun.serve(createPantryHandler(...))`, no
  // handle returned) — so this watcher is left running for the process's lifetime, same as the
  // server itself. When a close path is added, wire `watcher.stop()` into it.
  // PROOF rebuilds the board on a file change and BROADCASTS the fresh HTML, which the client
  // assigns with innerHTML. That frame never passes through this server's response path, so the two
  // repairs the board's markup needs have to be made here, before it leaves, or the first live
  // update silently undoes both: the card-link fix below, and the prefix rebase while the preview
  // proxy is on. This was found by a reviewer who noticed the response path and the push path are
  // not the same path, which is exactly the kind of thing a second pair of eyes is for.
  const boardChannel = {
    broadcast(event: string, data: unknown) {
      const op = data as { html?: unknown };
      if (op && typeof op === "object" && typeof op.html === "string") {
        stream.broadcast(event, { ...op, html: rebasePantryHtml(fixProofCardLinks(op.html), base) });
        return;
      }
      stream.broadcast(event, data);
    },
  };
  if (surfaces.plans) watchPlans({ plansDir: config.plansDir, channel: boardChannel });

  // The dev preview proxy (plans/pantry-review-layer.md P0). OFF unless the host configured a target,
  // and when it is on PANTRY's own routes move wholesale under the reserved prefix so the reviewed
  // project owns the root. `base` is the empty string in the ordinary case, which makes every rebase
  // below a no-op and leaves the no-preview path byte-identical to what it always served.
  const previewTarget = config.previewTarget;
  const base = previewTarget ? PANTRY_PREFIX : "";
  if (previewTarget) {
    console.log(`[pantry] preview proxy ON: ${previewTarget} served at / · PANTRY's own surfaces at ${PANTRY_PREFIX}/`);
  }
  const reviewClientTag = `<script src="${PANTRY_PREFIX}/pantry-review-client.js" defer></script>`;

  // PANTRY's own routing, taking the path with any reserved prefix ALREADY stripped. Returns null for
  // "not one of mine" so the caller decides what that means: a 404 with the proxy off, and a pass to
  // the target with it on.
  const pantryRoutes = async (path: string, url: URL): Promise<Response | null> => {
    // --- assets ---
    if (path.startsWith("/styles/")) return rebaseCssResponse(await serveStyles(path.slice("/styles".length)), base);
    if (path.startsWith("/fonts/")) return serveFont(fontsRoot, path.slice("/fonts/".length));
    if (path === "/components.css")
      return new Response(rebasePantryCss(await componentCss.css(), base), { headers: { "Content-Type": "text/css" } });
    if (path === "/proof.css")
      return new Response(rebasePantryCss(await bunRuntime.readFile(PROOF_CSS), base), { headers: { "Content-Type": "text/css" } });
    if (path === "/pantry.css")
      return new Response(rebasePantryCss(await bunRuntime.readFile(join(MODULE_DIR, "pantry.css")), base), { headers: { "Content-Type": "text/css" } });
    if (path === "/board-live.js")
      return new Response(rebaseBoardLive(await bunRuntime.readFile(BOARD_LIVE_JS), base), { headers: { "Content-Type": "text/javascript" } });
    if (path === "/pantry-review-client.js")  // the one tag injected into a proxied page (preview.ts)
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry-review-client.js")), { headers: { "Content-Type": "text/javascript" } });
    if (path === "/pantry-cmdk.js")   // ⌘K palette (piece 9b) — reads its index from /knowledge.json
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry-cmdk.js")), { headers: { "Content-Type": "text/javascript" } });
    if (path === "/pantry-review.js")  // the review shell's rail (P1) — reads the project's own tours
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry-review.js")), { headers: { "Content-Type": "text/javascript" } });
    if (path === "/pantry-map.js")     // mindmap viz (piece 10) — reads its graph from /map.json
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry-map.js")), { headers: { "Content-Type": "text/javascript" } });
    if (path === "/pantry-decisions.js")   // decision inbox (piece 11d) — the client generate-prompt flow
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry-decisions.js")), { headers: { "Content-Type": "text/javascript" } });

    // --- the live channel (piece 3): the board's SSE subscribe endpoint ---
    if (path === "/stream") return stream.subscribe(url.searchParams.get("session") ?? "default");

    const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

    // --- the AI-retrieval brain (piece 9): model-free, pure reads. knowledge.json = the machine
    // payload; llms.txt = the session context pack ("what an agent should read first"). Both derive
    // from the SAME sources the human surfaces render (one brain, two projections), so no drift. ---
    if (path === "/knowledge.json")
      return Response.json(await buildKnowledge(config, docCollections, new Date().toISOString()));
    if (path === "/llms.txt")
      return new Response(renderLlmsTxt(await buildKnowledge(config, docCollections, new Date().toISOString())),
        { headers: { "Content-Type": "text/plain; charset=utf-8" } });

    // --- the mindmap (piece 10): human viz at /map, its machine twin at /map.json. Same model
    // (buildMapPayload over the host's graphify-out), so the picture and the payload never drift.
    // Absent graphify-out degrades to guidance, never a 500 — same posture as the other surfaces. ---
    if (path === "/map.json")
      return Response.json(await buildMapPayload(config, new Date().toISOString()));
    if (path === "/map")
      return html(page("Mindmap", mapBody(await buildMapPayload(config, new Date().toISOString()))));

    // --- the decision inbox (piece 11d): human /decisions + /decisions/<id>, machine twin /decisions.json.
    // Same model (buildDecisionsPayload over the host's plans/decisions), so the cards and the payload
    // never drift. Read-only + model-free; the generated prompt (client-side) is the only write path. ---
    if (surfaces.decisions && path === "/decisions.json")
      return Response.json(await buildDecisionsPayload(config, new Date().toISOString()));
    if (surfaces.decisions && path === "/decisions")
      return html(page("Decisions", decisionsIndexBody(await buildDecisionsPayload(config, new Date().toISOString()))));
    if (surfaces.decisions && path.startsWith("/decisions/")) {
      const id = decodeURIComponent(path.slice("/decisions/".length));
      const payload = await buildDecisionsPayload(config, new Date().toISOString());
      const d = payload.decisions.find((x) => x.id === id);
      if (d) return html(page(d.title, decisionDetailBody(d)));
      return new Response("Not found", { status: 404 });
    }

    // --- the run ledger (piece 11c): human /runs + /runs/<id>, machine twin /runs.json. Each closed
    // run report parsed against LOOP.md §9, with the items it is missing. The human page was the open
    // owner question this piece deliberately left unbuilt; it was answered 2026-08-09 in favour of a
    // dedicated surface, because a session that hands the owner a link instead of a chat summary needs
    // somewhere to point that cannot flatter the run. Same payload backs both views, so they never
    // drift. On the DEFAULT layout the report source is fetchable too — reports live under artifacts/,
    // so /artifacts/raw/runs/<file>.md serves the bytes with the containment that route enforces. That
    // only holds while runsDir sits under artifactsDir; a host that points runsDir elsewhere gets the
    // parsed views here and no raw route, which is a deliberate limit rather than a promise to keep. ---
    if (surfaces.runs && path === "/runs.json")
      return Response.json(await buildRunsPayload(config, new Date().toISOString()));
    if (surfaces.runs && path === "/runs")
      return html(page("Runs", runsIndexBody(await buildRunsPayload(config, new Date().toISOString()))));
    if (surfaces.runs && path.startsWith("/runs/")) {
      const id = decodeURIComponent(path.slice("/runs/".length));
      const payload = await buildRunsPayload(config, new Date().toISOString());
      const r = payload.runs.find((x) => x.id === id);
      if (r) return html(page(r.title, runDetailBody(r)));
      return new Response("Not found", { status: 404 });
    }

    // --- run artifacts (piece 11e sub-unit 1): human /artifacts, machine twin /artifacts.json, raw
    // bytes at /artifacts/raw/<relPath>. Same model (buildArtifactsPayload over the host's artifacts
    // dir) backs both views. Read-only + model-free, like every surface; /raw is the one route here
    // that touches the filesystem beyond a directory read, so its path handling is the load-bearing
    // security boundary (see serveArtifactRaw above) — never trust the URL path uncontained. ---
    if (surfaces.artifacts && path === "/artifacts.json")
      return Response.json(await buildArtifactsPayload(config, new Date().toISOString()));
    if (surfaces.artifacts && path === "/artifacts")
      return html(page("Artifacts", artifactsIndexBody(await buildArtifactsPayload(config, new Date().toISOString()))));
    if (surfaces.artifacts && path.startsWith("/artifacts/raw/")) {
      const reqPath = decodeURIComponent(path.slice("/artifacts/raw/".length));
      return serveArtifactRaw(config.artifactsDir, reqPath);
    }

    // --- the retrospective timeline (piece 11e sub-unit 3): human /timeline, machine twin
    // /timeline.json. Same model (buildTimelinePayload over git + the host's plans/ + report mtimes)
    // backs both, so the picture and the payload never drift. Read-only + model-free; git is a history
    // read here, never a forecast. Absent repo/plans degrades to guidance, never a crash. ---
    if (surfaces.timeline && path === "/timeline.json")
      return Response.json(await buildTimelinePayload(config, new Date().toISOString()));
    if (surfaces.timeline && path === "/timeline")
      return html(page("Timeline", timelineBody(await buildTimelinePayload(config, new Date().toISOString()))));

    // --- landings PANTRY owns ---
    if (path === "/") {
      // The heartbeat row: doctor's staleness checks, computed at request time with `now` injected for
      // determinism. Doctor runs NO model — every check is a stat/age compare. ANY throw (a bare repo,
      // an unresolvable drift lint) degrades to a home WITHOUT the row, never a 500. Reuse the already
      // resolved config so doctor doesn't re-read pantry.config off disk.
      let freshness: DoctorReport | null = null;
      try {
        freshness = await runDoctor({ cwd, config, now: new Date(), runDrift: true });
      } catch (err) {
        console.warn("[pantry] heartbeat off:", err);
        freshness = null;
      }
      return html(page("Home", homeBody(config, surfaces, freshness)));
    }
    // The review shell (P1). It exists only while the proxy does, because the frame it draws has
    // nothing to point at otherwise.
    if (previewTarget && path === "/review")
      return html(pantryPage("Review", reviewBody(previewTarget, surfaces), surfaces, { review: true, fullBleed: true }));

    if (path === "/about") return html(page("About", aboutBody()));
    if (surfaces.docs && path === "/docs") return html(page("Docs", docsBody(docCollections)));

    // --- generated reference (read from the real registries, never hand-copied) ---
    if (surfaces.reference && path === "/reference") {
      const body = await buildVocabReference(join(grainRoot, "styles", "variables.css"));
      return html(page("Reference", `<header>
  <h1 class="proof-masthead">Reference</h1>
  <p class="proof-lede">Generated, not hand-copied — the AI vocabulary and GRAIN's token slots, read from the real source at request time.</p>
</header>
${body}`));
    }

    // --- the GRAIN component catalog (builds its own shell) ---
    if (catalog && path === "/catalog")
      return html(await catalog.html());

    // --- mounted layers: PROOF board (/plans*), then MILL (docs + standards) ---
    if (surfaces.plans) { const r = await proofRoutes(path); if (r) return fixProofResponse(r); }
    const m = await millRoutes(path); if (m) return m;
    return null;   // not one of PANTRY's — the caller decides (404, or the preview target)
  };

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    // The ordinary case: no preview target, PANTRY owns the root, nothing is rewritten.
    if (!previewTarget) {
      return (await pantryRoutes(path, url)) ?? new Response("Not found", { status: 404 });
    }

    // The proxy is on. PANTRY answers only under its reserved prefix; the root belongs to the target,
    // whole, so the reviewed app's root-relative URLs resolve exactly as they always did.
    if (path === PANTRY_PREFIX || path.startsWith(`${PANTRY_PREFIX}/`)) {
      const inner = path.slice(PANTRY_PREFIX.length) || "/";
      const res = await pantryRoutes(inner, url);
      if (!res) return new Response("Not found", { status: 404 });
      return rebasePantryResponse(res, base, inner);
    }

    return proxyToPreview(req, url, previewTarget, { inject: reviewClientTag });
  };
}

// PANTRY's own HTML, moved onto the reserved prefix. This rewrites OUR output, never the target's —
// the reviewed app owns the root and is served byte-for-byte. An artifact's raw bytes are excluded
// because those are evidence a run deposited: rewriting a captured page would quietly falsify it.
async function rebasePantryResponse(res: Response, base: string, innerPath: string): Promise<Response> {
  if (!base) return res;
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  if (innerPath.startsWith("/artifacts/raw/")) return res;
  const html = withPantryBase(rebasePantryHtml(await res.text(), base), base);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(html, { status: res.status, statusText: res.statusText, headers });
}

// @tjakoen/proof's board.ts emits a plan card's link as the root-absolute `/plan/<id>` whatever
// prefix it was actually mounted under, so the link only resolves in a host that mounts PROOF at the
// root. PANTRY mounts it at /plans and has shipped the broken link since the board landed: a click on
// a card has never opened a plan here. The portfolio carries the identical workaround in its own
// server rather than editing the vendored package, and this is now the second copy of it, which is
// the honest signal that PROOF should be taking the prefix instead of two hosts patching the output.
// Found while moving the board under the preview prefix, which faithfully preserved the 404.
function fixProofCardLinks(html: string): string {
  return html.replaceAll('href="/plan/', 'href="/plans/plan/');
}

async function fixProofResponse(res: Response): Promise<Response> {
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;  // /plans.json carries no such href
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(fixProofCardLinks(await res.text()), { status: res.status, statusText: res.statusText, headers });
}

// A font is bytes, and BATCH's static handler reads text — it would mistype and corrupt a woff2. So
// this serves them by hand with Bun.file, the same idiom and for the same reason as the portfolio's
// own font route. The containment check is the load-bearing line: the path comes off the URL, so it
// is resolved and confirmed to be under the fonts root before anything is opened.
async function serveFont(root: string, rel: string): Promise<Response> {
  const file = resolve(normalize(join(root, decodeURIComponent(rel))));
  if (file !== root && !file.startsWith(root + sep)) return new Response("Forbidden", { status: 403 });
  const f = Bun.file(file);
  if (!(await f.exists())) return new Response("Not found", { status: 404 });
  return new Response(f, { headers: { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=31536000, immutable" } });
}

// GRAIN's stylesheets are served straight off disk by BATCH's static handler, so the rebase happens
// to the Response rather than to a string. Only CSS is read; anything else this route serves streams
// past untouched.
async function rebaseCssResponse(res: Response, base: string): Promise<Response> {
  if (!base) return res;
  if (!(res.headers.get("content-type") ?? "").includes("css")) return res;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(rebasePantryCss(await res.text(), base), { status: res.status, statusText: res.statusText, headers });
}

// PROOF's board-live.js opens its SSE channel at a hardcoded `/stream`, and it lives in the grain
// package rather than here — so under the reserved prefix it is rebased on the way out instead of
// edited upstream, which would cost a grain release to reach PANTRY at all. The miss is warned about
// rather than swallowed: a silently un-rebased literal would show up much later as a live board that
// simply never updates, which is the failure mode hardest to attribute back to here.
function rebaseBoardLive(js: string, base: string): string {
  if (!base) return js;
  // Matched by shape rather than by one exact literal: the quote style is whatever PROOF happens to
  // use, and pinning the backtick made this break on a reformat that changed nothing else.
  const rebased = js.replace(/(["'`])\/stream\?session=/g, (_m, quote) => `${quote}${base}/stream?session=`);
  if (rebased === js) {
    console.warn(`[pantry] board-live.js: no /stream literal found to rebase onto ${base} — the live board will not update while the preview proxy is on`);
  }
  return rebased;
}

// A dirSource-equivalent over a plain folder the host owns. (MILL's dirSource is for package docs;
// this reads any absolute dir — used for the host's docs and the bundled standards.) A missing/absent
// dir yields an EMPTY collection, never a readdir throw — so a vanished docsDir or an unresolved
// standards folder (the portfolio package not being installed) degrades the surface instead of
// 500-ing the server.
function filesSourceFromDir(dir: string | null): ContentSource {
  const ok = !!dir && existsSync(dir);
  return {
    list: async () => {
      if (!ok) return [];
      const { readdir } = await import("node:fs/promises");
      return (await readdir(dir!)).filter((f) => f.endsWith(".md")).map((f) => basename(f, ".md").toLowerCase());
    },
    read: async (slug) => {
      if (!ok) return null;
      const { readdir } = await import("node:fs/promises");
      const file = (await readdir(dir!)).find((f) => basename(f, ".md").toLowerCase() === slug.toLowerCase());
      return file ? Bun.file(join(dir!, file)).text() : null;
    },
  };
}

export function servePantry(opts: PantryOptions & { port?: number }) {
  return Bun.serve({ port: opts.port ?? 4400, fetch: createPantryHandler(opts) });
}

/** Boot from a host cwd: load the pantry.config there, then serve. The CLI's entry point. The
 *  resolved config comes back with the server because the CLI has to print the right doors, and with
 *  the preview proxy on those doors move — a boot banner naming routes the server no longer answers
 *  is the first thing that would make this feel broken. */
export async function servePantryFromCwd(opts: { cwd?: string; port?: number; previewTarget?: string | null } = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const config = await loadPantryConfig(cwd);
  // A target passed on the command line wins over the config, and goes through the SAME validation —
  // a flag is still a place a caller types a string, and the loopback rule does not get to be
  // optional because the string arrived by a different route.
  if (opts.previewTarget) {
    const flag = resolvePreviewTarget(opts.previewTarget);
    if (flag.problem) console.warn(`[pantry] --preview ignored: ${flag.problem}`);
    else config.previewTarget = flag.origin;
  }
  return { server: servePantry({ plansDir: config.plansDir, config, cwd, port: opts.port }), config };
}
