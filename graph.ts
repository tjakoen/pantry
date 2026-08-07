// pantry/graph.ts — `pantry graph merge`: produce the merged cross-repo graph the doc-symbol-drift
// lint needs (drift.ts's checkSymbolDrift / usesMergedGraph — read that file's long header first). The
// portfolio's docs describe SIBLING repos, so its own `graph.json` can never confirm a symbol they
// name: measured against the per-repo graph the lint flagged 73.5% of spans, against a fresh 5-repo
// merged graph 26.5%. `config.graphPath` (config.ts's resolveGraphPath) already prefers
// `merged-graph.json` over `graph.json` — the only piece missing was something that PRODUCES that
// file. This module is that piece, and nothing else: find sibling repos with an existing
// `graphify-out/graph.json`, hand their paths to `graphify merge-graphs`, report what happened.
//
// Three hard constraints, each a real prior incident — do not soften any of them:
//   - NEVER run `graphify update`. Extraction HANGS on large foreign trees (>2min, backed out
//     2026-07-30). A sibling with no `graph.json` is SKIPPED and reported, never built — this module
//     only ever shells out to `merge-graphs`, which reads existing JSON and is fast.
//   - Timeout the spawn. `merge-graphs` is normally fast, but graphify absent, hung, or pointed at a
//     huge file must never hang the CLI. This machine has no `timeout` binary, so the cap
//     (MERGE_TIMEOUT_MS) is implemented in TS around Bun.spawn — same degrade-never-throw posture as
//     `defaultGitRunner` in doctor.ts / timeline.ts, just for a different child process.
//   - Explicit only, never blocking. `doctor` must NOT call this (unlike deps/drift/skills, which it
//     folds in as checks) — the operator runs `pantry graph merge` by hand, the same posture the
//     app.ts guidance banner already gives `graphify update .` itself.
//
// Never writes into a sibling: the output path is always `<hostRoot>/graphify-out/merged-graph.json`,
// derived from hostRoot alone — siblingsRoot only ever supplies INPUT paths.
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname, sep, basename } from "node:path";

// ── Blast radius ─────────────────────────────────────────────────────────────────────────────────
//
// What `graphify affected "X"` computes: a reverse walk from X over the dependency relations, i.e.
// "who would feel it if X changed". We reimplement it over `graph.json` rather than shelling out,
// for one reason that matters and one that is convenience. The reason that matters: doctor runs this
// once per file per run report, and a subprocess each time is far too slow for something that fires at
// every session start. The convenience: no spawn means no timeout, no PATH check, no hang risk, so
// none of the `merge-graphs` safety machinery above has to be repeated here.
//
// `contains` is deliberately NOT traversed. It is the file-to-symbol containment edge, so following it
// in reverse walks from a symbol up to its own file, which is not impact, it is location.
const IMPACT_RELATIONS = new Set([
  "calls", "indirect_call", "references", "imports", "imports_from",
  "re_exports", "inherits", "extends", "implements", "uses", "mixes_in", "embeds",
]);

interface GraphLink { relation?: unknown; source?: unknown; target?: unknown }

/**
 * The labels of everything that would be affected by a change to `seeds`, walked `depth` levels back
 * along the impact relations. Seeds are matched by node label (a filename like `drift.ts`, or a symbol)
 * and are never included in the result. Unknown seeds contribute nothing rather than throwing — a run
 * report naming a file the graph does not carry is a normal state, not an error.
 */
export function affectedBy(graph: { nodes?: unknown[]; links?: unknown[] }, seeds: string[], depth = 2): string[] {
  const nodes = Array.isArray(graph.nodes) ? (graph.nodes as { id?: unknown; label?: unknown }[]) : [];
  const links = Array.isArray(graph.links) ? (graph.links as GraphLink[]) : [];

  const labelById = new Map<string, string>();
  const idsByLabel = new Map<string, string[]>();
  for (const n of nodes) {
    if (typeof n.id !== "string" || typeof n.label !== "string") continue;
    labelById.set(n.id, n.label);
    const list = idsByLabel.get(n.label);
    if (list) list.push(n.id);
    else idsByLabel.set(n.label, [n.id]);
  }

  // Reverse adjacency: target -> the sources that depend on it.
  const dependents = new Map<string, string[]>();
  for (const l of links) {
    if (typeof l.relation !== "string" || !IMPACT_RELATIONS.has(l.relation)) continue;
    if (typeof l.source !== "string" || typeof l.target !== "string") continue;
    const list = dependents.get(l.target);
    if (list) list.push(l.source);
    else dependents.set(l.target, [l.source]);
  }

  const seedIds = new Set(seeds.flatMap((s) => idsByLabel.get(s) ?? []));
  const seen = new Set(seedIds);
  let frontier = [...seedIds];
  const out = new Set<string>();

  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const dep of dependents.get(id) ?? []) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        next.push(dep);
        const label = labelById.get(dep);
        if (label && !seeds.includes(label)) out.add(label);
      }
    }
    frontier = next;
  }

  return [...out].sort();
}

export interface ScopeRadiusReport {
  ok: boolean;
  seeds: string[];
  /** the seeds the graph actually carries; a seed it does not know contributes no radius */
  known: string[];
  /** seeds whose label sits on more than one node, with where each one lives. The radius unions them,
   *  which is the only defensible thing to do when we cannot know which was meant — but it has to be
   *  SAID, or the answer looks precise when it is a merge of two unrelated things. */
  ambiguous: { seed: string; locations: string[] }[];
  radius: string[];
  reason?: string;
}

/**
 * The pre-flight half of the scope cap: what a change to `seeds` is likely to reach, asked BEFORE the
 * work rather than audited after it. The run ledger already reports growth past a declared scope; this
 * is the query that would have let the declaration be right in the first place.
 *
 * Takes an explicit graph path rather than reading `config.graphPath`, because the two graph-backed
 * checks in this codebase want OPPOSITE artifacts and getting it wrong is silent. The symbol lint wants
 * the WIDEST graph available (a portfolio doc may name any sibling repo's symbol, so the merged estate
 * graph is what makes it usable). A blast radius wants the NARROWEST: a run report's scope names files
 * in THIS repo, so feeding it the merged graph drags in sibling symbols that can never be touched here
 * and mismatches the local file labels. Callers pass `<graphDir>/graph.json`.
 */
export async function scopeRadius(graphPath: string | null, seeds: string[], depth = 2): Promise<ScopeRadiusReport> {
  const graph = await loadGraph(graphPath);
  if (!graph) return { ok: false, seeds, known: [], ambiguous: [], radius: [], reason: "no graph — run graphify update ." };
  if (seeds.length === 0) return { ok: false, seeds, known: [], ambiguous: [], radius: [], reason: "no files given — usage: pantry scope <file...>" };

  // Where each label lives, not just whether it exists: a label can sit on several nodes (19 of them do
  // in pantry alone — `isoDay()` is both app.ts:541 and timeline.ts:103), and a seed that matches two
  // unrelated symbols unions two unrelated radii.
  const locations = new Map<string, string[]>();
  for (const n of graph.nodes as { label?: unknown; source_file?: unknown; source_location?: unknown }[]) {
    if (typeof n.label !== "string") continue;
    const where = typeof n.source_file === "string"
      ? `${n.source_file}${typeof n.source_location === "string" ? `:${n.source_location}` : ""}`
      : "unknown";
    const list = locations.get(n.label);
    if (list) list.push(where);
    else locations.set(n.label, [where]);
  }

  // Accept a path and match on its basename: scope lists and command lines both carry `pantry/drift.ts`
  // or `./drift.ts`, while the graph labels the node `drift.ts`.
  const known = seeds.filter((s) => locations.has(s) || locations.has(basename(s)));
  const resolved = known.map((s) => (locations.has(s) ? s : basename(s)));
  const ambiguous = resolved
    .map((s) => ({ seed: s, locations: locations.get(s) ?? [] }))
    .filter((a) => a.locations.length > 1);
  return { ok: true, seeds, known, ambiguous, radius: affectedBy(graph, resolved, depth) };
}

export function formatScopeRadius(report: ScopeRadiusReport): string {
  if (!report.ok) return `${report.reason ?? "no radius"}\nFAIL`;
  const unknown = report.seeds.filter((s) => !report.known.includes(s));
  const lines = [`seeds (${report.known.length} known to the graph): ${report.known.join(", ") || "none"}`];
  // Naming what the graph does not carry matters more than it looks: an unknown seed silently
  // contributes nothing, so a radius that looks reassuringly small may just be a typo.
  if (unknown.length) lines.push(`not in the graph, contributing no radius: ${unknown.join(", ")}`);
  // Same reasoning as the line above: a radius that merges two same-named symbols looks precise and is
  // not. Naming both locations lets the reader see the merge instead of inheriting it.
  for (const a of report.ambiguous) {
    lines.push(`AMBIGUOUS ${a.seed} matches ${a.locations.length} nodes (${a.locations.join(", ")}) — the radius below unions them`);
  }
  lines.push(
    report.radius.length
      ? `blast radius (${report.radius.length}): ${report.radius.join(", ")}`
      : "blast radius: nothing depends on these",
  );
  lines.push("declare a scope that covers what you intend to touch, not the whole radius");
  return lines.join("\n");
}

/** Parse a graph.json (or merged-graph.json) off disk. Null on absent/unparseable, so every caller
 *  degrades to "no radius known" instead of throwing — same posture as drift.ts's graphSymbols. */
export async function loadGraph(graphPath: string | null): Promise<{ nodes?: unknown[]; links?: unknown[] } | null> {
  if (!graphPath) return null;
  try {
    const g = JSON.parse(await Bun.file(graphPath).text());
    return Array.isArray(g?.nodes) ? g : null;
  } catch {
    return null;
  }
}

/** One sibling repo whose graph is going into the merge. */
export interface SiblingGraph {
  /** the sibling directory's basename, e.g. "grain" */
  name: string;
  /** absolute path to that sibling's graph.json */
  graphPath: string;
}

export interface GraphDiscovery {
  found: SiblingGraph[];
  /** a subdirectory that HAS a graphify-out/ (so it looks like a graphify-managed repo) but no readable
   *  graph.json in it — worth naming, per the "skip and say so" constraint. A subdirectory with no
   *  graphify-out at all is not reported here: most siblings of a project root are not graphify repos,
   *  and listing every one of them as "skipped" would bury the signal. */
  skipped: { name: string; reason: string }[];
}

// Never read or touch the edge repo — excluded from every estate-wide sweep, employer work. Prefers
// $HOME over the native os.homedir() lookup (Bun's homedir() reads the OS user record directly and
// ignores a HOME override, which would make this both untestable and unable to honor a sandboxed HOME
// in CI). Computed per call, not hoisted to module scope, so a real run always reads the CURRENT env.
function edgeRepoPath(): string {
  return join(process.env.HOME ?? homedir(), "Documents", "Programming", "edge");
}

/**
 * Scan the immediate subdirectories of `siblingsRoot` for an existing `graphify-out/graph.json`. Pure
 * read, never throws: an unreadable siblingsRoot resolves to nothing found (the caller reports the
 * resulting "<2 graphs" as a clean failure, not a crash).
 */
export async function findSiblingGraphs(siblingsRoot: string): Promise<GraphDiscovery> {
  const found: SiblingGraph[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const edgeRepo = edgeRepoPath();

  let entries: string[];
  try {
    entries = await readdir(siblingsRoot);
  } catch {
    return { found, skipped };
  }

  for (const name of entries) {
    const dir = join(siblingsRoot, name);
    if (dir === edgeRepo || dir.startsWith(edgeRepo + sep)) continue; // never touch edge — hard constraint

    let st;
    try {
      st = await stat(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    const graphifyOutDir = join(dir, "graphify-out");
    if (!existsSync(graphifyOutDir)) continue; // not a graphify-managed repo — not worth reporting

    const graphPath = join(graphifyOutDir, "graph.json");
    if (!existsSync(graphPath)) {
      skipped.push({ name, reason: "graphify-out/ exists but no graph.json — never extracted here (this command never builds one; run `graphify update .` there first, by hand)" });
      continue;
    }

    found.push({ name, graphPath });
  }

  found.sort((a, b) => a.name.localeCompare(b.name));
  return { found, skipped };
}

// merge-graphs is a fast read of existing JSON, not an extraction — but "fast" is a claim worth
// enforcing, not assuming. 120s comfortably covers a slow disk / a large merge without letting a hang
// (graphify wedged, a huge or corrupt file) take the CLI down with it.
export const MERGE_TIMEOUT_MS = 120_000;

export type GraphifyRunResult =
  | { kind: "ok"; stdout: string; stderr: string; code: number }
  | { kind: "not-found" } // graphify is not on PATH
  | { kind: "timeout" }; // killed after MERGE_TIMEOUT_MS

/** Runs `<bin> <args>` in `cwd` and returns a discriminated result — never throws, never hangs past
 *  `timeoutMs`. Injected (see `mergeGraphs`'s `runner` option) so the command is testable without a
 *  real graphify binary, mirroring `GitRunner` in timeline.ts. */
export type GraphifyRunner = (args: string[], cwd: string) => Promise<GraphifyRunResult>;

/** Build a GraphifyRunner against an arbitrary binary + timeout — split out from the default export so
 *  tests can exercise the real Bun.spawn + timeout/kill path against a short-lived stand-in (e.g.
 *  `sleep`) without waiting out MERGE_TIMEOUT_MS. */
export function createGraphifyRunner(bin: string, timeoutMs: number): GraphifyRunner {
  return async (args, cwd) => {
    // Bun.spawn throws synchronously when the binary isn't on PATH; wrapping just the call (rather than
    // typing the Subprocess return outer-scope) lets TS narrow `proc` from the IIFE's return type.
    const proc = (() => {
      try {
        return Bun.spawn([bin, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
      } catch {
        return null;
      }
    })();
    if (!proc) return { kind: "not-found" };

    const collected: Promise<GraphifyRunResult> = (async () => {
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;
      return { kind: "ok", stdout, stderr, code };
    })();
    // The handle is kept and cleared on EVERY path, not just the timeout one. An uncleared timer keeps
    // Bun's event loop alive, so a merge that finished in half a second would still sit there for the
    // rest of the two minutes. The CLI happens to survive that because it calls process.exit, but a
    // programmatic caller would not, and relying on the caller's exit is not a design.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut: Promise<GraphifyRunResult> = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    });

    try {
      const result = await Promise.race([collected, timedOut]);
      if (result.kind === "timeout") {
        try { proc.kill(); } catch { /* already exited, or kill failed — nothing more to do */ }
      }
      return result;
    } finally {
      clearTimeout(timer);
    }
  };
}

const defaultGraphifyRunner: GraphifyRunner = createGraphifyRunner("graphify", MERGE_TIMEOUT_MS);

export interface GraphMergeOptions {
  /** the host project root; default process.cwd() */
  hostRoot?: string;
  /** the dir holding sibling checkouts; default the PARENT of hostRoot — same default and reasoning as
   *  doctor's `layersRoot` (deps.ts's checkPantryDeps: "the dir that holds cwd, i.e. the monorepo
   *  sibling root") */
  siblingsRoot?: string;
  /** inject the graphify runner (tests); default spawns the real `graphify` binary */
  runner?: GraphifyRunner;
}

export interface GraphMergeReport {
  ok: boolean;
  hostRoot: string;
  siblingsRoot: string;
  /** the repos whose graphs went into the merge (empty when the merge never ran) */
  found: SiblingGraph[];
  /** repos that looked graphify-managed but had no graph.json to contribute */
  skipped: { name: string; reason: string }[];
  /** always under hostRoot — never a sibling path, regardless of where siblingsRoot points */
  outPath: string;
  nodeCount: number | null;
  edgeCount: number | null;
  /** set whenever ok is false: why the merge didn't happen */
  reason?: string;
}

// graphify's own stdout on success: "Merged 2 graphs -> 3 nodes, 1 edges". Parsed rather than assumed,
// so a graphify version that changes its wording degrades to null counts instead of a wrong number.
const MERGE_COUNTS = /Merged\s+\d+\s+graphs?\s*->\s*(\d+)\s+nodes?,\s*(\d+)\s+edges?/i;

/**
 * The command's pure orchestration: discover sibling graphs, and if there are at least two, hand them
 * to `graphify merge-graphs`. Every failure path (graphify absent, timeout, non-zero exit, <2 graphs)
 * returns `ok: false` with a `reason` instead of throwing — this is a surface an operator reads, not a
 * gate anything else depends on (see the module header: never blocking, never automatic).
 */
export async function mergeGraphs(opts: GraphMergeOptions = {}): Promise<GraphMergeReport> {
  const hostRoot = opts.hostRoot ?? process.cwd();
  const siblingsRoot = opts.siblingsRoot ?? dirname(hostRoot);
  const runner = opts.runner ?? defaultGraphifyRunner;
  const outPath = join(hostRoot, "graphify-out", "merged-graph.json"); // hostRoot-derived, always — never a sibling path

  const { found, skipped } = await findSiblingGraphs(siblingsRoot);
  const base = { hostRoot, siblingsRoot, found, skipped, outPath, nodeCount: null, edgeCount: null };

  if (found.length < 2) {
    return { ...base, ok: false, reason: `found ${found.length} graph${found.length === 1 ? "" : "s"} under ${siblingsRoot} — need at least 2 to merge` };
  }

  const args = ["merge-graphs", ...found.map((f) => f.graphPath), "--out", outPath];
  const result = await runner(args, hostRoot);

  if (result.kind === "not-found") {
    return { ...base, ok: false, reason: "graphify is not on PATH — install it, then re-run `pantry graph merge`" };
  }
  if (result.kind === "timeout") {
    return { ...base, ok: false, reason: `graphify merge-graphs did not finish within ${MERGE_TIMEOUT_MS / 1000}s — killed` };
  }
  if (result.code !== 0) {
    return { ...base, ok: false, reason: `graphify merge-graphs exited ${result.code}${result.stderr.trim() ? `: ${result.stderr.trim()}` : ""}` };
  }

  const m = MERGE_COUNTS.exec(result.stdout);
  return {
    ...base,
    ok: true,
    nodeCount: m ? Number(m[1]) : null,
    edgeCount: m ? Number(m[2]) : null,
  };
}

// Plain-text report for a terminal log — same posture as formatDepsReport/formatDriftReport: no
// backticks, no ANSI.
export function formatGraphMergeReport(report: GraphMergeReport): string {
  const lines: string[] = [];
  lines.push(`siblings root: ${report.siblingsRoot}`);
  lines.push(
    report.found.length
      ? `repos found (${report.found.length}): ${report.found.map((f) => f.name).join(", ")}`
      : "repos found: none",
  );
  for (const s of report.skipped) lines.push(`  skipped ${s.name} — ${s.reason}`);
  if (report.ok) {
    lines.push(`merged -> ${report.nodeCount ?? "?"} nodes, ${report.edgeCount ?? "?"} edges`);
    lines.push(`written to ${report.outPath}`);
    lines.push("OK");
  } else {
    lines.push(report.reason ?? "merge failed");
    lines.push("FAIL");
  }
  return lines.join("\n");
}
