// pantry/app.ts — PANTRY, the installable developer-docs + AI cockpit APP. It COMPOSES the layers
// (the pivot, 2026-07-08): BATCH serves, GRAIN styles, MILL renders the framework docs, PROOF
// renders the project's plan board, and GRAIN's own reference + catalog round out the cockpit — all
// under one server you `bunx pantry` into any project. This is the composition root; nothing imports
// PANTRY. It reads the HOST project's content (plans + optional docs, via the host contract in
// config.ts) and resolves its OWN bundled assets/docs via package resolution (never a relative path),
// so it runs from anywhere and survives the repo split.
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { bunRuntime } from "@tjakoen/batch/platform/bun-runtime.ts";
import { makeStatic } from "@tjakoen/batch/http/static.ts";
import { createStyleBundle } from "@tjakoen/batch/assets/style-bundle.ts";
import { createStream } from "@tjakoen/batch/http/stream.ts";
import { createMillRoutes, dirSource, type ContentSource, type MillCollection } from "@tjakoen/mill/serve.ts";
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { madeWith } from "@tjakoen/grain/scripts/made-with.js";
import { createProofRoutes } from "@tjakoen/proof/routes.ts";
import { watchPlans } from "@tjakoen/proof/live.ts";
import { buildVocabReference } from "@tjakoen/grain/ai/vocab-reference.ts";
import { createCatalog } from "@tjakoen/grain/catalog/catalog.ts";
import { loadPantryConfig, type ResolvedPantryConfig, type PantrySurfaces } from "./config.ts";
import { buildKnowledge, renderLlmsTxt } from "./retrieval.ts";
import { buildMapPayload, type MapPayload } from "./map.ts";

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

// The nav — surfaces gate the links (config.surfaces). Brand stays PANTRY (the app); the host
// project's name shows in the home lede. The reshape (piece 8): the front nav carries the project's
// own front door (Plans) + Standards + About; /docs·/reference·/catalog are DEMOTED out of the human
// nav (they stay mounted + AI-retrievable, reached from the home "Reference surfaces" row) — cutting
// them would undo PANTRY's founding pivot (see PLAN §The reshape).
function nav(surfaces: PantrySurfaces): string {
  const links = [
    surfaces.plans && `<a href="/plans">Plans</a>`,
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
export function pantryPage(title: string, body: string, surfaces: PantrySurfaces): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · PANTRY</title>
  ${styleLinks}
</head>
<body class="pantry-body" data-grade="smooth">
  ${nav(surfaces)}
  <main class="pantry-main">${body}</main>
  ${madeWith()}
  <script src="/pantry-cmdk.js" defer></script>
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
function homeBody(config: ResolvedPantryConfig, surfaces: PantrySurfaces): string {
  const teasers = AI_SURFACES.map((t) => {
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

export interface PantryOptions {
  /** the HOST project's plans folder (absolute or cwd-relative) — back-compat shorthand */
  plansDir: string;
  /** the full resolved host config (from loadPantryConfig); when omitted a default is derived from plansDir */
  config?: ResolvedPantryConfig;
  /** override GRAIN's location (defaults to the resolved package) */
  grainRoot?: string;
}

const defaultConfig = (plansDir: string): ResolvedPantryConfig => ({
  projectName: basename(dirname(plansDir)) || "project",
  plansDir, docsDirs: [], graphPath: null,
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true },
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
  const grainRoot = opts.grainRoot ?? GRAIN_ROOT;
  const page = (title: string, body: string) => pantryPage(title, body, surfaces);

  const serveStyles = makeStatic(bunRuntime, join(grainRoot, "styles"));
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
  if (surfaces.plans) watchPlans({ plansDir: config.plansDir, channel: stream });

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    // --- assets ---
    if (path.startsWith("/styles/")) return serveStyles(path.slice("/styles".length));
    if (path === "/components.css")
      return new Response(await componentCss.css(), { headers: { "Content-Type": "text/css" } });
    if (path === "/proof.css")
      return new Response(await bunRuntime.readFile(PROOF_CSS), { headers: { "Content-Type": "text/css" } });
    if (path === "/pantry.css")
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry.css")), { headers: { "Content-Type": "text/css" } });
    if (path === "/board-live.js")
      return new Response(await bunRuntime.readFile(BOARD_LIVE_JS), { headers: { "Content-Type": "text/javascript" } });
    if (path === "/pantry-cmdk.js")   // ⌘K palette (piece 9b) — reads its index from /knowledge.json
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry-cmdk.js")), { headers: { "Content-Type": "text/javascript" } });
    if (path === "/pantry-map.js")     // mindmap viz (piece 10) — reads its graph from /map.json
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry-map.js")), { headers: { "Content-Type": "text/javascript" } });

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

    // --- landings PANTRY owns ---
    if (path === "/") return html(page("Home", homeBody(config, surfaces)));
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
    if (surfaces.plans) { const r = await proofRoutes(path); if (r) return r; }
    const m = await millRoutes(path); if (m) return m;
    return new Response("Not found", { status: 404 });
  };
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

/** Boot from a host cwd: load the pantry.config there, then serve. The CLI's entry point. */
export async function servePantryFromCwd(opts: { cwd?: string; port?: number } = {}) {
  const config = await loadPantryConfig(opts.cwd);
  return servePantry({ plansDir: config.plansDir, config, port: opts.port });
}
