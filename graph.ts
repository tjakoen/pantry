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
import { join, dirname, sep } from "node:path";

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
