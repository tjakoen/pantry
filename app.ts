// pantry/app.ts — PANTRY, the installable developer-docs + AI cockpit APP. It COMPOSES the layers
// (the pivot, 2026-07-08): BATCH serves, GRAIN styles, MILL renders the framework docs, PROOF
// renders the project's plan board — all under one server you `bunx pantry` into any project.
// This is the composition root; nothing imports PANTRY. It reads the HOST project's ./plans (from
// their cwd) and resolves its OWN assets/docs relative to this module (so it runs from anywhere).
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bunRuntime } from "../batch/platform/bun-runtime.ts";
import { makeStatic } from "../batch/http/static.ts";
import { createStyleBundle } from "../batch/assets/style-bundle.ts";
import { createMillRoutes, dirSource } from "../mill/serve.ts";
import { escapeHtml } from "../mill/core/engine.ts";
import { createProofRoutes } from "../proof/routes.ts";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// In the monorepo the layers are siblings; on the split each becomes an @tjakoen/* package dir
// (import.meta.resolve), never a literal relative path — the pattern MILL's layer docs already use.
const GRAIN_ROOT = join(MODULE_DIR, "..", "grain");
const BATCH_DOCS = join(MODULE_DIR, "..", "batch", "docs");
const GRAIN_DOCS = join(MODULE_DIR, "..", "grain", "docs");
const PROOF_CSS = join(MODULE_DIR, "..", "proof", "board.css");

const STYLESHEETS = [
  "/styles/variables.css", "/styles/global.css", "/styles/grain.css",
  "/components.css", "/proof.css", "/pantry.css",
];

// A framework doc leads with its own `# Title` heading, so MILL's default note masthead (which
// re-emits the derived title) would double it under PANTRY's own chrome. Render the body only;
// the grade guardrail still runs (data-grade="smooth"). Same fix PROOF uses for its plan detail.
const bodyOnlyLayout = ({ body }: { body: string }) => `<article class="note" data-grade="smooth">${body}</article>`;

// The doc sets PANTRY mounts through MILL. Each is a framework layer's own canonical docs, rendered
// (not copied) — the single source stays in the package; PANTRY is a projection.
const DOC_SETS = [
  { prefix: "/docs/batch", title: "BATCH", lede: "The no-build, server-rendered hypermedia substrate.", source: () => dirSource(BATCH_DOCS) },
  { prefix: "/docs/grain", title: "GRAIN", lede: "The AI-interaction design system and default theme.", source: () => dirSource(GRAIN_DOCS) },
];

// The five stack members, for the home page. Status is honest (the honesty clause): PROOF is
// partially built, PANTRY is the app you're looking at (early).
const MEMBERS = [
  { name: "BATCH", role: "The no-build, server-rendered hypermedia substrate.", href: "/docs/batch", status: "built" },
  { name: "GRAIN", role: "The AI-interaction design system + default theme (grain = AI).", href: "/docs/grain", status: "built" },
  { name: "MILL", role: "Markdown in, GRAIN pages out. The content engine.", href: "/docs", status: "built" },
  { name: "PROOF", role: "The AI plan board — plans as files, this board is their projection.", href: "/plans", status: "core + board built" },
  { name: "PANTRY", role: "This app: the layers composed into one dev-docs + AI cockpit.", href: "/", status: "early" },
];

const nav = (): string => `<nav class="pantry-nav">
  <a class="pantry-nav__brand" href="/">PANTRY</a>
  <a href="/plans">Plans</a>
  <a href="/docs">Docs</a>
</nav>`;

// The one page shell every surface shares (board, docs, home) — the host owns the head, so both
// createProofRoutes and createMillRoutes are handed this same wrapper.
export function pantryPage(title: string, body: string): string {
  const links = STYLESHEETS.map((h) => `<link rel="stylesheet" href="${h}">`).join("\n  ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · PANTRY</title>
  ${links}
</head>
<body class="pantry-body" data-grade="smooth">
  ${nav()}
  <main class="pantry-main">${body}</main>
</body>
</html>`;
}

function homeBody(plansDir: string): string {
  const cards = MEMBERS.map((m) => `<a class="card pantry-member" data-pad="sm" href="${escapeHtml(m.href)}">
    <h3 class="card__title">${escapeHtml(m.name)}</h3>
    <p class="pantry-member__role">${escapeHtml(m.role)}</p>
    <span class="pantry-member__status">${escapeHtml(m.status)}</span>
  </a>`).join("\n");
  return `<header>
  <h1 class="proof-masthead">The BREAD stack, in one place.</h1>
  <p class="proof-lede">PANTRY composes the stack into a developer cockpit: the framework docs, and this project's plan board, served together. Reading plans from ${escapeHtml(plansDir)}.</p>
</header>
<div class="card-grid pantry-members">${cards}</div>`;
}

function docsBody(): string {
  const items = DOC_SETS.map((d) => `<a class="card pantry-member" data-pad="sm" href="${escapeHtml(d.prefix)}">
    <h3 class="card__title">${escapeHtml(d.title)} docs</h3>
    <p class="pantry-member__role">${escapeHtml(d.lede)}</p>
  </a>`).join("\n");
  return `<header>
  <h1 class="proof-masthead">Docs</h1>
  <p class="proof-lede">The framework's own docs, rendered through MILL. The source lives in each layer; these pages are projections.</p>
</header>
<div class="card-grid pantry-members">${items}</div>`;
}

export interface PantryOptions {
  /** the HOST project's plans folder (absolute or cwd-relative) */
  plansDir: string;
  /** override GRAIN's location (defaults to the sibling package) */
  grainRoot?: string;
}

export function createPantryHandler(opts: PantryOptions) {
  const grainRoot = opts.grainRoot ?? GRAIN_ROOT;
  const serveStyles = makeStatic(bunRuntime, join(grainRoot, "styles"));
  const componentCss = createStyleBundle(bunRuntime, join(grainRoot, "components"));

  const proofRoutes = createProofRoutes({
    plansDir: opts.plansDir,
    prefix: "/plans",
    chrome: (title, body) => pantryPage(title, body),
  });
  const millRoutes = createMillRoutes({
    collections: DOC_SETS.map((d) => ({
      prefix: d.prefix, title: d.title, description: d.lede, source: d.source(),
      adapter: { defaultLayout: bodyOnlyLayout },   // the body carries its own title; don't double it
    })),
    chrome: (input) => pantryPage(input.title, input.body),
  });

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
    if (path === "/") return html(pantryPage("Home", homeBody(opts.plansDir)));
    if (path === "/docs") return html(pantryPage("Docs", docsBody()));

    // --- mounted layers: PROOF board (/plans*) then MILL docs (/docs/*) ---
    return (await proofRoutes(path)) ?? (await millRoutes(path)) ?? new Response("Not found", { status: 404 });
  };
}

export function servePantry(opts: PantryOptions & { port?: number }) {
  return Bun.serve({ port: opts.port ?? 4400, fetch: createPantryHandler(opts) });
}
