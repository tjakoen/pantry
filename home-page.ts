// pantry/home-page.ts, split out of app.ts. The page markup for one surface; app.ts keeps the routing.
import { type MillCollection } from "@tjakoen/mill/serve.ts";
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { type ResolvedPantryConfig, type PantrySurfaces } from "./config.ts";
import { type DoctorReport, type DoctorCheck } from "./doctor.ts";
import { nav } from "./chrome.ts";

export const MEMBERS = [
  { name: "BATCH", role: "The no-build, server-rendered hypermedia substrate.", href: "/docs/batch", status: "built" },
  { name: "GRAIN", role: "The AI-interaction design system + default theme (grain = AI).", href: "/docs/grain", status: "built" },
  { name: "MILL", role: "Markdown in, GRAIN pages out. The content engine.", href: "/docs", status: "built" },
  { name: "PROOF", role: "The AI plan board — plans as files, this board is their projection.", href: "/plans", status: "core + board built" },
  { name: "PANTRY", role: "This app: the layers composed into one dev-docs + AI cockpit.", href: "/", status: "early" },
];

// The home page (reshaped, piece 8). NOT the stack pitch — that moved to /about. Home is the HOST
// PROJECT's own front door: its plan board, plus the "working with AI" surfaces (AI-retrieval +
// mindmap), then a demoted "Reference surfaces" row that keeps /docs·/reference·/catalog reachable
// without putting them back in the front nav. AI-retrieval (piece 9) is LIVE — a real link to
// /llms.txt; the mindmap (piece 10) is also LIVE at /map.
export const AI_SURFACES: { title: string; role: string; href?: string; status: string }[] = [
  { title: "AI-retrieval", role: "Machine-readable surfaces (llms.txt · knowledge.json) your own agent reads to work this project — model-free, pure reads.", href: "/llms.txt", status: "live" },
  { title: "Mindmap", role: "A picture of the AI's brain for this project: the whole-codebase knowledge graph, drawn for the human. Machine twin at /map.json.", href: "/map", status: "live" },
];
// Artifacts (piece 11e) is a real surface (config.surfaces.artifacts), unlike the two above which
// have no off-switch of their own — so its href is gated the same way the nav gates it (below), and
// the entry is dropped entirely when the surface is off rather than shown disabled.
export function aiSurfaceTeasers(surfaces: PantrySurfaces): { title: string; role: string; href?: string; status: string }[] {
  return [
    ...AI_SURFACES,
    ...(surfaces.runs
      ? [{ title: "Runs", role: "The run ledger — what each closed run did, its gate output verbatim, and which of LOOP §9's evidence items it is missing. Machine twin at /runs.json.", href: "/runs", status: "live" }]
      : []),
    ...(surfaces.artifacts
      ? [{ title: "Artifacts", role: "Run evidence — screenshots, audit reports, diffs — served read-only. Machine twin at /artifacts.json.", href: "/artifacts", status: "live" }]
      : []),
    ...(surfaces.timeline
      ? [{ title: "Timeline", role: "The project's retrospective history: plan bars, dependency arrows, commit and run activity. No forecast. Machine twin at /timeline.json.", href: "/timeline", status: "live" }]
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
export const HEARTBEAT_IDS = ["audit-freshness", "deps-drift", "doc-drift", "graphify-freshness"] as const;
export function heartbeatTone(c: DoctorCheck): "ok" | "danger" | "due" | "muted" {
  if (c.ok) return "ok";
  if (c.severity === "error") return "danger";
  if (c.severity === "warn") return "due";
  return "muted"; // info that isn't ok (rare) — quietest tone
}
export function freshnessStrip(freshness: DoctorReport | null): string {
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
export function aboutBody(): string {
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

export function docsBody(collections: MillCollection[]): string {
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
