// pantry/drift.ts — piece 9c: the doc-drift lint. PANTRY's brain (retrieval.ts) is drift-free BY
// CONSTRUCTION for what it DERIVES — the machine payload and the human surfaces are two projections
// of one source. But doc PROSE is hand-written: a page can link a route or a raw `.md` twin that no
// longer exists (a collection renamed, a page deleted, a plan id changed). Those dead references are
// exactly the drift construction can't prevent. This lint reads the SAME brain the server serves and
// flags every in-namespace link in a doc body that no longer resolves — a CI-able check that fails
// nonzero, reusing `proof check`'s CheckProblem/CheckReport contract (piece 9c lives HERE, not in
// proof: proof can't import PANTRY's brain without a dependency cycle, so the lint lives where the
// brain does and borrows proof's report shape).
//
// Scope (deliberately narrow, to stay high-signal — a noisy lint would undercut the "drift-free"
// claim it guards): we check ROOT-RELATIVE inline markdown links `[..](/..)` whose target is in the
// brain's OWN namespace — a doc collection prefix (`/docs/…`, `/standards/…`), a plan route
// (`/plans…`), or a raw `.md` twin. Such a link MUST resolve to a real page / plan / source the brain
// knows, else it's a dead reference. Links outside that namespace (`/`, `/about`, external URLs,
// anchor-only or page-relative links) are out of scope — we can't adjudicate them from the brain, so
// we skip rather than guess (the discipline proof check applies to unknowable plan ages). Bare
// render-op-kind words in prose are NOT scanned: they're ordinary English ("replace", "append") and
// would false-positive; that vocabulary is guarded at its source (grain/ai/vocab-reference.test.ts).
import type { CheckProblem, CheckReport } from "@tjakoen/proof/check.ts";
import type { MillCollection } from "@tjakoen/mill/serve.ts";
import { loadPantryConfig, type ResolvedPantryConfig } from "./config.ts";
import { buildDocCollections } from "./app.ts";
import { buildKnowledge, type Knowledge } from "./retrieval.ts";

// The static routes PANTRY always serves in addition to the brain's surfaces/pages — so an in-scope
// link to one of these resolves rather than false-flagging. The handler in app.ts is the source of
// truth; only the /plans-and-docs-namespace ones actually matter for the in-scope check below.
const STATIC_ROUTES = ["/", "/about", "/docs", "/knowledge.json", "/llms.txt", "/plans", "/plans/plans.json"];

interface DriftSets {
  routes: Set<string>;    // every resolvable route the brain + app expose
  sources: Set<string>;   // every raw `.md` twin
  prefixes: string[];     // the doc-collection prefixes + /plans → the "brain namespace" for in-scope
}

// Derive the resolvable-target sets from the assembled brain. One brain in, the lint's universe out —
// so the lint can never disagree with what the server actually serves.
function setsOf(k: Knowledge): DriftSets {
  const routes = new Set<string>(STATIC_ROUTES);
  const sources = new Set<string>();
  const prefixes: string[] = ["/plans"];
  for (const s of k.surfaces) routes.add(s.route);
  for (const c of k.docs) {
    routes.add(c.prefix);
    prefixes.push(c.prefix);
    for (const pg of c.pages) { routes.add(pg.route); sources.add(pg.source); }
  }
  if (k.plans) for (const p of k.plans.plans) routes.add(`/plans/plan/${p.id}`);
  return { routes, sources, prefixes };
}

// Root-relative link targets in one markdown body. Inline links `[text](target)` only (the common
// case in these docs); the caller strips fragment/query and decides what's in scope.
const LINK = /\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
function linksIn(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(LINK)) out.push(m[1]);
  return out;
}

// Normalize a link target: drop fragment + query, and any trailing slash (except root).
function normalize(target: string): string {
  let t = target.split("#")[0].split("?")[0];
  if (t.length > 1 && t.endsWith("/")) t = t.slice(0, -1);
  return t;
}

/**
 * Lint every doc body for dead in-namespace references against the brain built from the same
 * sources. `generatedAt` is injected so the run is deterministic (tests included). Pure reads.
 */
export async function checkDrift(
  config: ResolvedPantryConfig,
  docCollections: MillCollection[],
  opts: { generatedAt?: string } = {},
): Promise<CheckReport> {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const k = await buildKnowledge(config, docCollections, generatedAt);
  const { routes, sources, prefixes } = setsOf(k);

  const problems: CheckProblem[] = [];
  let pageCount = 0;

  for (const c of docCollections) {
    for (const slug of await c.source.list()) {
      const md = await c.source.read(slug);
      if (md === null) continue;
      pageCount++;
      const route = `${c.prefix}/${slug}`;
      for (const raw of linksIn(md)) {
        if (!raw.startsWith("/")) continue;              // external / anchor / page-relative → out of scope
        const target = normalize(raw);
        if (target.endsWith(".md")) {                    // a raw `.md` twin reference
          if (!sources.has(target))
            problems.push({ planId: route, severity: "error", field: "link", message: `dead .md twin "${raw}" — no such source in the brain` });
          continue;
        }
        const inNamespace = prefixes.some((p) => target === p || target.startsWith(`${p}/`));
        if (!inNamespace) continue;                      // some other app/static route → can't adjudicate → skip
        if (!routes.has(target))
          problems.push({ planId: route, severity: "error", field: "link", message: `dead reference "${raw}" — no such route in the brain` });
      }
    }
  }

  return { ok: !problems.some((p) => p.severity === "error"), problems, planCount: pageCount };
}

// ── Symbol drift (S4): the same lint, one level down from links ──────────────────────────────────
//
// The link lint above catches a doc pointing at a page that moved. This catches a doc NAMING code that
// no longer exists — the failure the ten-pass doc sweep kept turning up by hand. The oracle is
// graphify's `graph.json`: an AST extraction, no model and no API cost, which is the whole reason this
// can live in PANTRY at all.
//
// SCOPE, and why it is this narrow. Measured on the portfolio's 33 docs, 2026-08-07, before any of
// this was written:
//
//   - Backticked BARE call form (`doSomething()`) is the only shape checked. 34 spans in scope, 25
//     resolved, 9 flagged; grepping all 9 against every repo on disk, 5 were genuinely dead and 4 were
//     real symbols the extraction simply does not node. 56% precision — good enough to SHOW, which is
//     why this reports at info and never fails CI.
//   - Method form (`thing.method()`) is OUT: it resolves against a local's type, which the graph does
//     not carry, and it was pure noise in the measurement.
//   - Path refs (`some/file.ts`) are OUT. They were measured too, against the best oracle available (a
//     whole-estate file index, not the graph — graphify nodes no .css and no .md, so it can only ever
//     say "missing"). Even then 14% flagged, and the flags were dominated by references that are
//     CORRECT: generated artifacts, planned-but-unwritten notes, route payloads named without a slash.
//     A lint that shouts at a backlog for naming a file it intends to write is not worth having.
//   - Fenced blocks are stripped first. A code sample is an illustration, not a claim about this repo.
//
// WHICH GRAPH. `config.graphPath` prefers `merged-graph.json` over this repo's `graph.json`, and for
// this lint that preference is load-bearing rather than incidental. The portfolio's docs are layer-doc
// mirrors of sibling repos, so its own graph cannot confirm a grain symbol: measured against the
// per-repo graph the flag rate was 73.5%, against a fresh 5-repo merged graph 26.5%. Without the
// merged graph this check is noise, so it says so in its detail line rather than pretending.
const BUILTIN_CALLS = new Set([
  // Language and platform surface a doc may name without claiming it lives in this codebase. Kept
  // deliberately short: an over-broad deny-list hides real drift, and info severity already absorbs
  // the occasional miss.
  "toisostring", "tolocaledatestring", "tolocalestring", "tostring", "json", "text", "map", "filter",
  "reduce", "push", "pop", "slice", "split", "join", "keys", "values", "entries", "has", "get", "set",
  "add", "delete", "then", "catch", "finally", "fetch", "stat", "read", "write", "list", "next",
  "url", "format", "render", "refresh", "close", "open", "start", "stop", "run", "clamp", "rgb",
  "steps", "now", "sort", "find", "some", "every", "flat", "concat", "trim", "replace", "match",
]);

const FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`([^`\n]+)`/g;
const BARE_CALL = /^([A-Za-z_$][\w$]*)\(\)$/;

interface GraphNode { label?: unknown; norm_label?: unknown }

/** Every identifier the graph knows, lowercased, with any trailing `()` dropped. Null when the graph
 *  is absent, unparseable, or has no nodes at all — the caller reports "skipped" rather than flagging
 *  every symbol in sight, because an empty graph means we know nothing, not that everything is dead.
 *  (An empty `nodes: []` is deliberately folded into the null case for exactly that reason.) */
async function graphSymbols(graphPath: string | null): Promise<Set<string> | null> {
  if (!graphPath) return null;
  try {
    const graph = JSON.parse(await Bun.file(graphPath).text()) as { nodes?: GraphNode[] };
    if (!Array.isArray(graph.nodes)) return null;
    const out = new Set<string>();
    for (const n of graph.nodes) {
      for (const raw of [n.label, n.norm_label]) {
        if (typeof raw !== "string" || !raw) continue;
        out.add(raw.replace(/\(\)$/, "").toLowerCase());
      }
    }
    return out.size > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Lint every doc body for backticked bare calls the graph does not know. Info severity throughout, so
 * the returned report is always `ok` — this SHOWS, it never gates (doctor.ts's error/warn/info split).
 */
export async function checkSymbolDrift(
  config: ResolvedPantryConfig,
  docCollections: MillCollection[],
): Promise<CheckReport> {
  const symbols = await graphSymbols(config.graphPath);
  const problems: CheckProblem[] = [];
  let pageCount = 0;

  for (const c of docCollections) {
    for (const slug of await c.source.list()) {
      const md = await c.source.read(slug);
      if (md === null) continue;
      pageCount++;
      if (!symbols) continue; // counted, but nothing to check it against
      const route = `${c.prefix}/${slug}`;
      const seen = new Set<string>(); // one problem per identifier per page, not per mention
      for (const m of md.replace(FENCE, "").matchAll(INLINE_CODE)) {
        const call = BARE_CALL.exec(m[1].trim());
        if (!call) continue;
        const id = call[1].toLowerCase();
        if (BUILTIN_CALLS.has(id) || symbols.has(id) || seen.has(id)) continue;
        seen.add(id);
        // "warning" is the softest level proof's CheckProblem carries; doctor re-reports the whole
        // check at info, which is the severity the measurement actually supports. The report stays ok
        // either way, because ok only ever turns on an error.
        problems.push({ planId: route, severity: "warning", field: "symbol", message: `${call[1]}() names no symbol the graph knows — moved, renamed, or gone` });
      }
    }
  }

  return { ok: true, problems, planCount: pageCount };
}

/** Convenience for the CLI and doctor: load the host config, build the collections the server serves,
 *  and run the symbol lint over them. */
export async function checkPantrySymbolDrift(opts: { cwd?: string } = {}): Promise<CheckReport> {
  const config = await loadPantryConfig(opts.cwd);
  return checkSymbolDrift(config, buildDocCollections(config));
}

/** True when the graph backing the symbol lint is the merged estate graph rather than one repo's own.
 *  Doctor says which, because the difference decides whether the count is worth reading. */
export function usesMergedGraph(config: ResolvedPantryConfig): boolean {
  return config.graphPath?.endsWith("merged-graph.json") ?? false;
}

/** Convenience for the CLI: load the host config from `cwd`, build the same collections the server
 *  serves, and lint them. */
export async function checkPantryDrift(opts: { cwd?: string; generatedAt?: string } = {}): Promise<CheckReport> {
  const config = await loadPantryConfig(opts.cwd);
  return checkDrift(config, buildDocCollections(config), { generatedAt: opts.generatedAt });
}

// Plain-text report for a terminal / CI log — same shape as proof's formatReport, but the count reads
// "pages" (docs, not plans). No backticks, no ANSI (color is a UI signal, not stdout).
export function formatDriftReport(report: CheckReport): string {
  const lines = report.problems.map(
    (p) => `[${p.severity}] ${p.planId ?? "(none)"} ${p.field}: ${p.message}`,
  );
  lines.push(`${report.planCount} pages, ${report.problems.length} problems`);
  lines.push(report.ok ? "OK" : "FAIL");
  return lines.join("\n");
}
