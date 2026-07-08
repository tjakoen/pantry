// pantry/app.ts — PANTRY, the installable developer-docs + AI cockpit APP. It COMPOSES the layers
// (the pivot, 2026-07-08): BATCH serves, GRAIN styles, MILL renders the framework docs, PROOF
// renders the project's plan board, and GRAIN's own reference + catalog round out the cockpit — all
// under one server you `bunx pantry` into any project. This is the composition root; nothing imports
// PANTRY. It reads the HOST project's content (plans + optional docs, via the host contract in
// config.ts) and resolves its OWN bundled assets/docs via package resolution (never a relative path),
// so it runs from anywhere and survives the repo split.
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { bunRuntime } from "../batch/platform/bun-runtime.ts";
import { makeStatic } from "../batch/http/static.ts";
import { createStyleBundle } from "../batch/assets/style-bundle.ts";
import { createMillRoutes, packageDocsSource, type ContentSource, type MillCollection } from "../mill/serve.ts";
import { escapeHtml } from "../mill/core/engine.ts";
import { createProofRoutes } from "../proof/routes.ts";
import { buildVocabReference } from "../grain/ai/vocab-reference.ts";
import { createCatalog } from "../grain/catalog/catalog.ts";
import { loadPantryConfig, type ResolvedPantryConfig, type PantrySurfaces } from "./config.ts";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// The framework DOC dirs (batch/docs, grain/docs) are resolved as PACKAGES (packageDocsSource →
// import.meta.resolve), so the same code works in the monorepo and after the split — the doc .md
// travels inside the package (mill/CLAUDE.md). Assets + the layer PLANs stay module-relative: they
// aren't in the packages' `exports` maps yet (proof/pantry aren't even linked), so package-resolving
// them fails today. Fine in the monorepo (siblings); they get package-resolved at the split.
const sibling = (...p: string[]) => join(MODULE_DIR, "..", ...p);
const GRAIN_ROOT = sibling("grain");
const PROOF_CSS = sibling("proof", "board.css");
const STANDARDS_DIR = sibling("tjakoen.github.io", "standards");

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

// The framework doc sets PANTRY BUNDLES + renders through MILL (the host provides nothing for these).
// Each is a layer's own canonical docs/PLAN, rendered (not copied) — the single source stays in the
// package; PANTRY is a projection.
const FRAMEWORK_DOCS: MillCollection[] = [
  { prefix: "/docs/batch", title: "BATCH", description: "The no-build, server-rendered hypermedia substrate.",
    source: packageDocsSource("@tjakoen/batch/docs/ARCHITECTURE.md"), adapter: { defaultLayout: bodyOnlyLayout } },
  { prefix: "/docs/grain", title: "GRAIN", description: "The AI-interaction design system and default theme.",
    source: packageDocsSource("@tjakoen/grain/docs/GRAIN.md"), adapter: { defaultLayout: bodyOnlyLayout } },
  { prefix: "/docs/plans", title: "Layer plans",
    description: "Each layer's own design plan (its canonical PLAN.md), rendered. Distinct from /plans — that's this project's task board.",
    source: filesSource({
      grain: sibling("grain", "PLAN.md"),
      mill: sibling("mill", "PLAN.md"),
      proof: sibling("proof", "PLAN.md"),
      pantry: join(MODULE_DIR, "PLAN.md"),
    }),
    adapter: { defaultLayout: bodyOnlyLayout } },
];

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

// The nav — surfaces gate the links (config.surfaces). Brand stays PANTRY (the app); the host
// project's name shows in the home lede.
function nav(surfaces: PantrySurfaces): string {
  const links = [
    surfaces.plans && `<a href="/plans">Plans</a>`,
    surfaces.docs && `<a href="/docs">Docs</a>`,
    surfaces.reference && `<a href="/reference">Reference</a>`,
    surfaces.catalog && `<a href="/catalog">Catalog</a>`,
    surfaces.standards && `<a href="/standards">Standards</a>`,
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
</body>
</html>`;
}

function homeBody(config: ResolvedPantryConfig): string {
  const cards = MEMBERS.map((m) => `<a class="card pantry-member" data-pad="sm" href="${escapeHtml(m.href)}">
    <h3 class="card__title">${escapeHtml(m.name)}</h3>
    <p class="pantry-member__role">${escapeHtml(m.role)}</p>
    <span class="pantry-member__status">${escapeHtml(m.status)}</span>
  </a>`).join("\n");
  return `<header>
  <h1 class="proof-masthead">The BREAD stack, in one place.</h1>
  <p class="proof-lede">PANTRY composes the stack into a developer cockpit for <strong>${escapeHtml(config.projectName)}</strong>: the framework docs, this project's plan board, the generated reference, and the component catalog, served together. Plans from ${escapeHtml(config.plansDir)}.</p>
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
  plansDir, docsDirs: [],
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true },
});

export function createPantryHandler(opts: PantryOptions) {
  const config = opts.config ?? defaultConfig(opts.plansDir);
  const { surfaces } = config;
  const grainRoot = opts.grainRoot ?? GRAIN_ROOT;
  const page = (title: string, body: string) => pantryPage(title, body, surfaces);

  const serveStyles = makeStatic(bunRuntime, join(grainRoot, "styles"));
  const componentCss = createStyleBundle(bunRuntime, join(grainRoot, "components"));

  // Every MILL collection this install serves: bundled framework docs (when /docs on) + the host's
  // own docs dirs (the host contract — rendered in place). /standards is its own collection.
  const docCollections: MillCollection[] = [
    ...(surfaces.docs ? FRAMEWORK_DOCS : []),
    ...(surfaces.docs ? config.docsDirs.map((d) => hostDocsCollection(d, config.projectName)) : []),
  ];
  const standardsCollection: MillCollection = {
    prefix: "/standards", title: "Standards",
    description: "The cross-repo writing + presentation standards (VOICE, NOTE, README, FIGURES), rendered.",
    source: filesSourceFromDir(STANDARDS_DIR), adapter: { defaultLayout: bodyOnlyLayout },
  };

  const proofRoutes = createProofRoutes({
    plansDir: config.plansDir, prefix: "/plans", chrome: (title, body) => page(title, body),
  });
  const millRoutes = createMillRoutes({
    collections: [...docCollections, ...(surfaces.standards ? [standardsCollection] : [])],
    chrome: (input) => page(input.title, input.body),
  });
  const catalog = surfaces.catalog
    ? createCatalog(join(grainRoot, "components"), undefined, { headEnd: styleLinks })
    : null;

  return async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;

    // --- assets ---
    if (path.startsWith("/styles/")) return serveStyles(path.slice("/styles".length));
    if (path === "/components.css")
      return new Response(await componentCss.css(), { headers: { "Content-Type": "text/css" } });
    if (path === "/proof.css")
      return new Response(await bunRuntime.readFile(PROOF_CSS), { headers: { "Content-Type": "text/css" } });
    if (path === "/pantry.css")
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry.css")), { headers: { "Content-Type": "text/css" } });

    const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

    // --- landings PANTRY owns ---
    if (path === "/") return html(page("Home", homeBody(config)));
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
// this reads any absolute dir — used for the host's docs and the bundled standards.)
function filesSourceFromDir(dir: string): ContentSource {
  return {
    list: async () => {
      const { readdir } = await import("node:fs/promises");
      return (await readdir(dir)).filter((f) => f.endsWith(".md")).map((f) => basename(f, ".md").toLowerCase());
    },
    read: async (slug) => {
      const { readdir } = await import("node:fs/promises");
      const file = (await readdir(dir)).find((f) => basename(f, ".md").toLowerCase() === slug.toLowerCase());
      return file ? Bun.file(join(dir, file)).text() : null;
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
