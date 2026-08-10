// pantry/doctor.ts — piece 11a: the control center's mechanical tier. The cross-repo loop
// (portfolio standards/LOOP.md §2) runs a WORK-TRIGGERED heartbeat: every push and every session
// start SHOWS what's due, so skipping a chore becomes visible instead of silent. `pantry doctor` is
// PANTRY's end of that — one CI-able command that surfaces kit compliance + staleness. It runs NO
// model (the load-bearing PANTRY constraint): every check below is a file stat, a symlink read, or an
// age comparison. It SURFACES, it never fixes — fixing is the cognitive tier's job (a working session
// picks up what doctor flagged), per LOOP.md §2.
//
// Two severities carry weight, borrowing PROOF's error/warn split:
//   - error  the kit is BROKEN → the report is not ok → CI exits nonzero.
//   - warn   something is DUE (an overdue audit, a missing e2e suite) → surfaced, but exit 0. Acting
//            on a warn is the cognitive tier, not a gate. This is exactly LOOP.md's "show what's due,
//            don't run a robot at night."
//   - info   an optional piece is simply absent (no graphify-out, no AUDIT runbook) → never fails.
import { lstat, readlink, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, resolve, dirname, relative } from "node:path";
import { parseFrontmatter } from "@tjakoen/mill/core/frontmatter.ts";
import { loadPantryConfig, type ResolvedPantryConfig } from "./config.ts";
import { checkPantryDrift, checkPantrySymbolDrift, usesMergedGraph } from "./drift.ts";
import { checkPantryDeps } from "./deps.ts";
import { listSkills } from "./skills.ts";
import { buildRunsPayload, type RunsPayload } from "./runs.ts";
import { answers, readAnswerLog, unacked } from "./answers.ts";
import { affectedBy, loadGraph } from "./graph.ts";
import type { GitRunner } from "./timeline.ts";

export type DoctorSeverity = "error" | "warn" | "info";

export interface DoctorCheck {
  id: string;
  /** the level this check reports at when it is not ok; info checks never fail CI */
  severity: DoctorSeverity;
  ok: boolean;
  label: string;
  detail: string;
}

export interface DoctorReport {
  /** true when no error-severity check is failing (warns and infos never flip this) */
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  /** the host project root; default process.cwd() */
  cwd?: string;
  /** injected for deterministic age math (tests); default new Date() */
  now?: Date;
  /** an audit report older than this reads as overdue (warn); default 30 */
  auditMaxAgeDays?: number;
  /** graphify-out older than this reads as stale (warn); default 30 */
  graphMaxAgeDays?: number;
  /**
   * Activity-due thresholds for the audit-freshness check: how much churn since the last DATED audit
   * report reads as "look again" even when the calendar age is still inside `auditMaxAgeDays`. The
   * whole point is that ACTIVITY creates drift, not time — sixty commits landing in a week make the
   * picture stale faster than sixty commits landing over six months, and a pure age check cannot tell
   * the two apart. The two defaults below are NOT measured; they are the owner's own illustration of
   * "a lot has happened" ("sixty commits and four closed plans have landed since anyone last looked at
   * this repo as a whole") turned into a number doctor can act on consistently instead of asking a
   * session to eyeball "a lot". Treat them as a first guess to retune once a repo's real audit cadence
   * is observed, not as a measured law — the same posture `auditMaxAgeDays` already takes.
   */
  auditActivityCommits?: number;
  /** see `auditActivityCommits`; default 4, the owner's own "four closed plans" */
  auditActivityPlansClosed?: number;
  /** inject a resolved config (tests); default loadPantryConfig(cwd) */
  config?: ResolvedPantryConfig;
  /** fold the doc-drift lint in as a check; default true (set false when packages aren't resolvable) */
  runDrift?: boolean;
  /** fold the layer-pin drift surface in as a warn check; default true (set false in hermetic unit
   *  tests so doctor never reaches for sibling checkouts outside the temp host) */
  runDeps?: boolean;
  /** the dir holding the sibling layer checkouts; default the parent of cwd (the monorepo root) */
  layersRoot?: string;
  /** fold the mounted-skills freshness check in; default true (set false in hermetic unit tests so
   *  doctor never reaches for the portfolio package) */
  runSkills?: boolean;
  /** inject the canon standards dir the skills check compares against (tests); default resolved */
  canonDir?: string | null;
  /** fold the doc-symbol lint in as an info check; default true (set false when no graph is wanted) */
  runSymbols?: boolean;
  /** inject the git reader the graph-freshness check uses (tests); default spawns real git */
  gitRunner?: GitRunner;
}

// The canonical cross-repo standards. A REAL file of one of these names in a host's standards/ dir
// means the repo forked what it should reference by URL (LOOP.md §3). A symlink (e.g. AGENTS.md) is
// not a fork; only real files count.
const CANON_STANDARDS = new Set([
  "AI-DEVELOPMENT.md",
  "AI-REPO-STANDARD.md",
  "SESSION-LOOP.md",
  "LOOP.md",
  "VOICE.md",
  "NOTE-STANDARD.md",
  "FIGURES.md",
  "README-STANDARD.md",
]);

const DAY_MS = 86_400_000;
const daysBetween = (now: Date, then: Date): number => Math.floor((now.getTime() - then.getTime()) / DAY_MS);

// `graphify` writes a Graph Freshness block into GRAPH_REPORT.md carrying the commit the extraction
// ran against:  "- Built from commit: `18017a67`". Read that instead of stat-ing the file. Null when
// there is no report or the block is absent — the caller falls back to the age check.
const BUILT_FROM = /Built from commit:\s*`?([0-9a-f]{7,40})`?/i;
async function graphBuiltFromCommit(graphDir: string): Promise<string | null> {
  const report = join(graphDir, "GRAPH_REPORT.md");
  if (!existsSync(report)) return null;
  try {
    return BUILT_FROM.exec(await Bun.file(report).text())?.[1] ?? null;
  } catch {
    return null; // unreadable report — degrade to the age check, never throw
  }
}

// Same degrade-never-throw contract as timeline's runner: null when git is absent, cwd is not a repo,
// or the repo has no commits yet.
const defaultGitRunner: GitRunner = async (args, cwd) => {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? out : null;
  } catch {
    return null;
  }
};

async function gitHead(cwd: string, git: GitRunner): Promise<string | null> {
  const out = await git(["rev-parse", "HEAD"], cwd);
  const head = out?.trim();
  return head && /^[0-9a-f]{7,40}$/i.test(head) ? head : null;
}

// Prose, pictures and lockfiles do not move a symbol. GRAPH.md §4 is explicit that the per-edit
// refresh re-extracts CODE, so a run of doc commits legitimately leaves the graph current and warning
// about it would be crying wolf. Found the honest way: the first live run of the commit check flagged
// the portfolio, whose only churn since the graph was built was one markdown file.
const NON_INVALIDATING = /\.(md|mdx|txt|png|jpe?g|gif|svg|webp|ico|lock)$|(^|\/)(bun\.lock|package-lock\.json|yarn\.lock)$/i;

// `GRAPH_REPORT.md` describes `graph.json` — the extraction `graphify update` ran. It says nothing
// about `merged-graph.json`, which `pantry graph merge` produces from the SIBLINGS' graphs and which
// `resolveGraphPath` then PREFERS. So a repo can hold a report that is honestly current, a merged graph
// that is stale, and a freshness check reading the first while every consumer reads the second. That is
// the same lie the mtime check was telling, one artifact over, and it was live in the portfolio within
// minutes of the merge command existing: the edit hook re-extracted `graph.json` at 16:13 and the
// merged graph from 16:10 went on being served.
//
// Cheap, honest signal: a merge built BEFORE the extraction it should have included is stale. Only
// meaningful when the merged graph is the one being consumed; false otherwise.
async function mergedGraphIsStale(config: ResolvedPantryConfig): Promise<boolean> {
  if (!config.graphPath?.endsWith("merged-graph.json")) return false;
  try {
    const [merged, own] = await Promise.all([stat(config.graphPath), stat(join(config.graphDir, "graph.json"))]);
    return merged.mtime < own.mtime;
  } catch {
    return false; // no own graph to compare against, or an unreadable pair — nothing to claim
  }
}

/** Did anything the graph extracts from change between `from` and HEAD? Null when git cannot answer —
 *  the commit is unreachable after a history rewrite, say — which the caller reads as "don't guess". */
async function codeChangedSince(from: string, cwd: string, git: GitRunner): Promise<boolean | null> {
  const out = await git(["diff", "--name-only", `${from}..HEAD`], cwd);
  if (out === null) return null;
  const changed = out.split("\n").map((l) => l.trim()).filter(Boolean);
  return changed.some((f) => !NON_INVALIDATING.test(f));
}

// Newest audit REPORT (not the AUDIT.md runbook) across the few dirs a report is likely to land in.
// Cheap by design: one shallow readdir per candidate dir, no full-tree walk (doctor must stay fast
// enough to run at every session start). A file counts when its name contains "audit" and ends .md.
async function newestAuditReport(cwd: string): Promise<{ path: string; mtime: Date } | null> {
  const dirs = [cwd, join(cwd, "artifacts"), join(cwd, "reports"), join(cwd, "docs")];
  let best: { path: string; mtime: Date } | null = null;
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue; // dir absent → skip
    }
    for (const name of entries) {
      if (name === "AUDIT.md") continue; // the runbook, not a report
      if (!name.toLowerCase().includes("audit") || !name.endsWith(".md")) continue;
      const p = join(dir, name);
      let st;
      try {
        st = await stat(p);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (!best || st.mtime > best.mtime) best = { path: p, mtime: st.mtime };
    }
  }
  return best;
}

/** How much moved since a dated audit report — the activity half of `audit-freshness`. One bounded git
 *  call (`log --since <report mtime> --name-only`), the same "cheap enough for every session start"
 *  posture every other check in this file follows; never a full-history walk.
 *
 *  `plansClosed` is a PROXY, not an exact count: a plan file counts when it (a) was touched by a commit
 *  since the audit and (b) currently reads `status: done`. That slightly over-counts a plan that was
 *  ALREADY done and got a trivial edit afterwards (a typo fix, say) — timeline.ts's per-file history
 *  walk (`deriveFileHistory`) would get the transition date exactly right, but doing that here would add
 *  a git call per plan file to every doctor run, which is the full-tree-walk cost this module refuses to
 *  pay (see the module header). Cheap and approximate, on purpose, and said so in the check's detail.
 *
 *  Returns null when git can't answer (not a repo, git absent, spawn failure) — the caller reads an
 *  unmeasurable signal as "not due", never as a guess dressed up as a number. */
async function auditActivitySince(
  cwd: string,
  since: Date,
  git: GitRunner,
  plansDir: string,
): Promise<{ commits: number; filesTouched: number; plansClosed: number } | null> {
  const out = await git(["log", "--since", since.toISOString(), "--name-only", "--format=%H"], cwd);
  if (out === null) return null;

  // `--name-only --format=%H` interleaves bare commit-hash lines with the files each commit touched, no
  // other delimiter. A line that is exactly 40 hex chars is read as a commit boundary; everything else
  // in between is a touched path. (The same class of judgment call `gitHead`'s hash regex makes above.)
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let commits = 0;
  const files = new Set<string>();
  for (const line of lines) {
    if (/^[0-9a-f]{40}$/i.test(line)) commits++;
    else files.add(line);
  }

  // Only touched paths under the plans dir, normalised to forward slashes so this reads the same on
  // every platform git log can run on.
  const plansRel = relative(cwd, plansDir).replace(/\\/g, "/");
  const plansPrefix = plansRel === "" ? "" : `${plansRel}/`;
  let plansClosed = 0;
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    if (plansPrefix && !norm.startsWith(plansPrefix)) continue;
    if (!norm.endsWith(".md")) continue;
    try {
      const { data } = parseFrontmatter(await Bun.file(join(cwd, f)).text());
      if (typeof data.status === "string" && data.status.trim().toLowerCase() === "done") plansClosed++;
    } catch {
      continue; // deleted since, unreadable, or malformed — a plan we can't verify doesn't count
    }
  }
  return { commits, filesTouched: files.size, plansClosed };
}

// Run reports written since a dated audit report — read from the SAME payload the run-ledger evidence
// check below builds (hoisted to the top of runDoctor), so the two checks never disagree about what
// counts as a run report. Undated reports are skipped, not guessed into either bucket: LOOP.md §9 wants
// a date on every report, and a report missing one is already flagged by that other check.
function runsWrittenSince(runsPayload: RunsPayload, since: Date): number {
  if (!runsPayload.available) return 0;
  const sinceDay = since.toISOString().slice(0, 10);
  return runsPayload.runs.filter((r) => !!r.date && r.date > sinceDay).length;
}

// Any e2e suite present? A repo with none can't run the mechanical tier's full gate (LOOP.md §2).
// Checked cheaply: an `e2e/` dir, or a `*.e2e.*` file at the root or in test(s)/.
async function hasE2eSuite(cwd: string): Promise<boolean> {
  if (existsSync(join(cwd, "e2e"))) return true;
  for (const dir of [cwd, join(cwd, "test"), join(cwd, "tests")]) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    if (entries.some((n) => /\.e2e\.[tj]s$/.test(n))) return true;
  }
  return false;
}

/**
 * Run the mechanical-tier checks against the host at `cwd`. Pure reads + stats; no model, no writes.
 * Deterministic when `now` is injected. Returns a report whose `ok` is false only on an error-severity
 * failure, so the CLI can exit nonzero on a broken kit while still surfacing what's merely due.
 */
export async function runDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  const cwd = opts.cwd ?? process.cwd();
  const now = opts.now ?? new Date();
  const auditMaxAgeDays = opts.auditMaxAgeDays ?? 30;
  const graphMaxAgeDays = opts.graphMaxAgeDays ?? 30;
  const auditActivityCommits = opts.auditActivityCommits ?? 60;
  const auditActivityPlansClosed = opts.auditActivityPlansClosed ?? 4;
  const config = opts.config ?? (await loadPantryConfig(cwd));
  const runDrift = opts.runDrift ?? true;
  const runDeps = opts.runDeps ?? true;
  const runSkills = opts.runSkills ?? true;
  const runSymbols = opts.runSymbols ?? true;
  const git = opts.gitRunner ?? defaultGitRunner;

  const checks: DoctorCheck[] = [];

  // Built once, up front, and read by two checks below (audit-freshness's activity signal, and the
  // run-ledger evidence check further down) — a run report is either "written since the audit" or it
  // isn't, and both consumers should read the same list rather than each re-parsing the runs dir.
  const runsPayload = await buildRunsPayload(config, now.toISOString());

  // ── Kit compliance ────────────────────────────────────────────────────────
  const claudeMd = existsSync(join(cwd, "CLAUDE.md"));
  checks.push({
    id: "claude-md",
    severity: "error",
    ok: claudeMd,
    label: "CLAUDE.md present",
    detail: claudeMd ? "found" : "missing — the cold-start front door (LOOP.md §3)",
  });

  // AGENTS.md must be a SYMLINK to CLAUDE.md — a real copy drifts.
  const agentsPath = join(cwd, "AGENTS.md");
  let agentsOk = false;
  let agentsDetail: string;
  let agentsLstat;
  try {
    agentsLstat = await lstat(agentsPath);
  } catch {
    agentsLstat = null;
  }
  if (!agentsLstat) {
    agentsDetail = "missing — add AGENTS.md as a symlink to CLAUDE.md";
  } else if (!agentsLstat.isSymbolicLink()) {
    agentsDetail = "is a real file, not a symlink to CLAUDE.md (a copy drifts)";
  } else {
    let target: string | null;
    try {
      target = await readlink(agentsPath);
    } catch {
      target = null; // TOCTOU: the link vanished between lstat and readlink → degrade, don't crash
    }
    // Resolve the target against the link's own dir and require it to be THIS repo's CLAUDE.md — a
    // right-basename link that points at some other repo's CLAUDE.md is not the symlink we want.
    if (target !== null && resolve(dirname(agentsPath), target) === join(cwd, "CLAUDE.md")) {
      agentsOk = true;
      agentsDetail = "symlink to CLAUDE.md";
    } else {
      agentsDetail = target === null ? "unreadable symlink" : `symlink to ${target} (expected CLAUDE.md)`;
    }
  }
  checks.push({ id: "agents-symlink", severity: "error", ok: agentsOk, label: "AGENTS.md symlink", detail: agentsDetail });

  // No forked standards — the home repo opts out (it legitimately holds the canon).
  if (config.standardsSource === "canon") {
    checks.push({
      id: "no-forked-standards",
      severity: "info",
      ok: true,
      label: "forked standards",
      detail: "this repo is the canon home (standardsSource: canon) — fork check skipped",
    });
  } else {
    const stdDir = join(cwd, "standards");
    const forked: string[] = [];
    if (existsSync(stdDir)) {
      let entries: string[] = [];
      try {
        entries = await readdir(stdDir);
      } catch {
        entries = [];
      }
      for (const name of entries) {
        if (!CANON_STANDARDS.has(name)) continue;
        // a symlink pointing out to the canon is fine; only a real file is a fork
        try {
          const st = await lstat(join(stdDir, name));
          if (st.isFile() && !st.isSymbolicLink()) forked.push(name);
        } catch {
          /* unreadable → ignore */
        }
      }
    }
    checks.push({
      id: "no-forked-standards",
      severity: "error",
      ok: forked.length === 0,
      label: "forked standards",
      detail: forked.length === 0 ? "none — standards referenced by URL" : `forked: ${forked.join(", ")} — reference by URL (LOOP.md §3)`,
    });
  }

  // plans/ present (the board's source, the cockpit's whole point).
  const plansOk = existsSync(config.plansDir);
  checks.push({
    id: "plans-dir",
    severity: "error",
    ok: plansOk,
    label: "plans/ present",
    detail: plansOk ? config.plansDir : `missing at ${config.plansDir} — run pantry init`,
  });

  // pantry.config present (a kit repo should carry one; a bare repo can still serve, so warn not error).
  const configOk = ["pantry.config.json", "pantry.config.ts", "pantry.config.js"].some((f) => existsSync(join(cwd, f)));
  checks.push({
    id: "pantry-config",
    severity: "warn",
    ok: configOk,
    label: "pantry.config present",
    detail: configOk ? "found" : "none — run pantry init (defaults still apply)",
  });

  // ── Staleness (the heartbeat's whole point: what's due) ───────────────────
  //
  // audit-freshness asks two questions, not two checks: is the last dated audit report old on the
  // CALENDAR, and has enough happened SINCE it that the picture is stale regardless of the calendar.
  // The second question is the one that actually matters — a repo that hasn't moved in six weeks is not
  // more overdue than one that landed sixty commits and closed four plans in six days, and a pure age
  // check cannot tell those two apart (that gap is the whole reason this got extended rather than left
  // alone). See `auditActivitySince`'s doc comment above for exactly what "since" measures and why the
  // plans-closed count is a proxy, not an exact one.
  const auditRunbook = existsSync(join(cwd, "AUDIT.md"));
  if (!auditRunbook) {
    checks.push({ id: "audit-freshness", severity: "info", ok: true, label: "audit freshness", detail: "no AUDIT.md runbook in this repo" });
  } else {
    const report = await newestAuditReport(cwd);
    if (!report) {
      // Nothing dated to measure FROM. A repo that has never closed an audit has no baseline, and
      // computing a delta against zero would report a dramatic, meaningless number — every commit the
      // repo has ever had, dressed up as "activity since". Say the honest thing instead: no audit yet.
      // The remedy is the same either way (run AUDIT.md), so this stays exactly as it was.
      checks.push({
        id: "audit-freshness",
        severity: "warn",
        ok: false,
        label: "audit freshness",
        detail: "AUDIT.md runbook present but no dated audit report found — audit may be overdue",
      });
    } else {
      const age = daysBetween(now, report.mtime);
      const ageFresh = age <= auditMaxAgeDays;
      const activity = await auditActivitySince(cwd, report.mtime, git, config.plansDir);
      const runsSince = runsWrittenSince(runsPayload, report.mtime);
      // Due by EITHER signal: a calendar-stale audit is due regardless of how quiet the repo has been,
      // and a calendar-fresh one is now also due when activity alone crosses a threshold — that second
      // case is the one a pure age check used to miss entirely.
      const activityDue =
        activity !== null && (activity.commits >= auditActivityCommits || activity.plansClosed >= auditActivityPlansClosed);
      const ok = ageFresh && !activityDue;

      const ageText = ageFresh
        ? `last audit ${age} days old (${basename(report.path)})`
        : `last audit ${age} days old — over ${auditMaxAgeDays}d, run AUDIT.md`;
      const plural = (n: number) => (n === 1 ? "" : "s");
      const activityText =
        activity === null
          ? `activity since unmeasurable (no git history) — ${runsSince} run report${plural(runsSince)} since`
          : `${activity.commits} commit${plural(activity.commits)}, ${activity.filesTouched} file${plural(activity.filesTouched)} touched, ` +
            `${activity.plansClosed} plan${plural(activity.plansClosed)} closed, ${runsSince} run report${plural(runsSince)} since` +
            (activityDue && ageFresh
              ? ` — due by activity (>=${auditActivityCommits} commits or >=${auditActivityPlansClosed} plans closed is a guess, see doctor.ts) even though the calendar age is fine`
              : "");

      checks.push({
        id: "audit-freshness",
        severity: "warn",
        ok,
        label: "audit freshness",
        detail: `${ageText}; ${activityText}`,
      });
    }
  }

  // graphify-out freshness (the mindmap's brain; regenerable, host-local).
  //
  // Preferred signal is the COMMIT, not the mtime. `GRAPH_REPORT.md` records the commit the graph was
  // extracted from and tells the reader in prose to diff it against HEAD; doing that mechanically is
  // strictly better than an age comparison, because age answers the wrong question. Measured
  // 2026-08-07: the portfolio's graph was zero days old and built one commit behind HEAD, so the age
  // check called a stale graph fresh. Age stays as the fallback for a graphify-out with no report.
  if (!config.graphPath) {
    checks.push({ id: "graphify-freshness", severity: "info", ok: true, label: "graphify freshness", detail: "no graphify-out — run graphify update ." });
  } else {
    let st;
    try {
      st = await stat(config.graphPath);
    } catch {
      st = null;
    }
    if (!st) {
      checks.push({ id: "graphify-freshness", severity: "info", ok: true, label: "graphify freshness", detail: "no graphify-out — run graphify update ." });
    } else {
      const builtFrom = await graphBuiltFromCommit(config.graphDir);
      const head = await gitHead(cwd, git);
      // A stale merge overrides everything below: the report can be honestly current and still be
      // describing a file nobody reads. Say so plainly rather than passing on a technicality.
      const staleMerge = await mergedGraphIsStale(config);
      if (staleMerge) {
        checks.push({
          id: "graphify-freshness",
          severity: "warn",
          ok: false,
          label: "graphify freshness",
          detail: "merged-graph.json predates this repo's own extraction — run pantry graph merge",
        });
      } else if (builtFrom && head) {
        // Compare on the shorter of the two, so an abbreviated report hash matches a full HEAD.
        const n = Math.min(builtFrom.length, head.length);
        const atHead = builtFrom.slice(0, n) === head.slice(0, n);
        // Behind HEAD is only stale if CODE moved in between; doc commits leave the graph current.
        const codeMoved = atHead ? false : await codeChangedSince(builtFrom, cwd, git);
        const shortHead = head.slice(0, builtFrom.length);
        checks.push({
          id: "graphify-freshness",
          severity: "warn",
          // Explicitly `=== false`: an unreachable built-from commit (null) is a warn, not a pass. We
          // could not verify it, and silently calling an unverifiable graph fresh is the exact failure
          // the mtime check was making.
          ok: codeMoved === false,
          label: "graphify freshness",
          detail: atHead
            ? `graph built from HEAD (${builtFrom})`
            : codeMoved === null
              ? `graph built from ${builtFrom}, unreachable from HEAD (${shortHead}) — run graphify update .`
              : codeMoved
                ? `graph built from ${builtFrom}, code moved since — run graphify update .`
                : `graph built from ${builtFrom}, HEAD is ${shortHead} (docs only, graph still current)`,
        });
      } else {
        const age = daysBetween(now, st.mtime);
        const fresh = age <= graphMaxAgeDays;
        checks.push({
          id: "graphify-freshness",
          severity: "warn",
          ok: fresh,
          label: "graphify freshness",
          detail: fresh ? `graph ${age} days old` : `graph ${age} days old — over ${graphMaxAgeDays}d, run graphify update .`,
        });
      }
    }
  }

  // e2e suite present (needed for the mechanical gate).
  const e2e = await hasE2eSuite(cwd);
  checks.push({
    id: "e2e-presence",
    severity: "warn",
    ok: e2e,
    label: "e2e suite present",
    detail: e2e ? "found" : "no e2e suite — the mechanical gate can't run end-to-end",
  });

  // ── Drift (fold the existing lint in, so doctor is the single CI entry point) ──
  if (runDrift) {
    try {
      const d = await checkPantryDrift({ cwd });
      checks.push({
        id: "doc-drift",
        severity: "error",
        ok: d.ok,
        label: "doc links resolve",
        detail: `${d.planCount} pages, ${d.problems.length} problems`,
      });
    } catch (err) {
      checks.push({
        id: "doc-drift",
        severity: "warn",
        ok: false,
        label: "doc links resolve",
        detail: `could not run drift lint: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ── Symbol drift (S4) ────────────────────────────────────────────────────
  // Info, never warn: measured at 56% precision on the portfolio (drift.ts documents the run), which
  // is worth SHOWING a session and not worth making anyone dismiss. The detail names which graph
  // answered, because a per-repo graph flags roughly three times as much as the merged estate graph
  // on docs that describe sibling repos, and a count means nothing without knowing which one ran.
  if (runSymbols) {
    try {
      const s = await checkPantrySymbolDrift({ cwd });
      const graph = usesMergedGraph(config) ? "merged estate graph" : "this repo's graph only";
      checks.push({
        id: "doc-symbol-drift",
        severity: "info",
        ok: s.problems.length === 0,
        label: "doc symbols resolve",
        detail: config.graphPath
          ? `${s.planCount} pages, ${s.problems.length} unresolved identifiers (${graph})`
          : `${s.planCount} pages, skipped — no graph (run graphify update .)`,
      });
    } catch (err) {
      checks.push({
        id: "doc-symbol-drift",
        severity: "info",
        ok: true,
        label: "doc symbols resolve",
        detail: `skipped: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ── Layer-pin drift (the umbrella control-plane surface: is the stack pinned to what's on disk?) ──
  // A warn, never an error: a lagging pin is a chore that's due, not a broken kit (LOOP.md §2). Only
  // meaningful in the umbrella host (the one that pins the layers); an ordinary repo has no @tjakoen/*
  // pins and gets an info.
  if (runDeps) {
    try {
      const d = await checkPantryDeps({ cwd, layersRoot: opts.layersRoot });
      if (d.deps.length === 0) {
        checks.push({ id: "deps-drift", severity: "info", ok: true, label: "layer pins", detail: "no @tjakoen/* pins in this repo" });
      } else {
        const behind = d.deps.filter((x) => x.state === "behind");
        checks.push({
          id: "deps-drift",
          severity: "warn",
          ok: behind.length === 0,
          label: "layer pins current",
          detail:
            behind.length === 0
              ? `${d.deps.length} pins, none behind`
              : `${behind.length} behind: ${behind.map((b) => `${b.name.replace("@tjakoen/", "")} ${b.pinned}<${b.available}`).join(", ")} — run deps:refresh`,
        });
      }
    } catch (err) {
      checks.push({ id: "deps-drift", severity: "info", ok: true, label: "layer pins", detail: `deps check skipped: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  // ── Skills freshness (S2: a standard the harness never lists is a standard that never fires) ──
  // Warn, never error: an out-of-date mount is one `pantry skills sync` away, and a repo that has
  // simply never mounted them is not broken. Absence only reads as due in a KIT repo (one carrying a
  // CLAUDE.md) — a bare repo gets an info, so this can never become a false alarm in a host that
  // never opted in. No standards package at all is an info for the same reason graphify-out is.
  if (runSkills) {
    try {
      const s = await listSkills({ cwd, config, canonDir: opts.canonDir });
      const stale = s.skills.filter((x) => x.state === "stale");
      const missing = s.skills.filter((x) => x.state === "missing");
      const shadowed = s.skills.filter((x) => x.state === "shadowed");
      if (s.canonDir === null) {
        checks.push({ id: "skills-freshness", severity: "info", ok: true, label: "skills mounted", detail: "no standards package installed — nothing to mount here" });
      } else if (s.skills.length === 0) {
        // The package resolves but no standard in it carries a `when:` key: the pin predates S1.
        // Worth naming rather than folding into "no package", because the fix is a pin bump, not an
        // install, and the two read identically from the outside.
        checks.push({ id: "skills-freshness", severity: "info", ok: true, label: "skills mounted", detail: `standards package has no skill-shaped standards (pin predates when: keys) — ${s.canonDir}` });
      } else if (stale.length === 0 && missing.length === 0 && shadowed.length === 0) {
        checks.push({ id: "skills-freshness", severity: "info", ok: true, label: "skills mounted", detail: `${s.skills.length} standards mounted and current` });
      } else if (missing.length === s.skills.length && !claudeMd) {
        checks.push({ id: "skills-freshness", severity: "info", ok: true, label: "skills mounted", detail: "not a kit repo — run pantry init --kit to mount the standards" });
      } else {
        const parts: string[] = [];
        if (stale.length > 0) parts.push(`${stale.length} stale (${stale.map((x) => x.slug).join(", ")})`);
        if (missing.length > 0) parts.push(`${missing.length} unmounted (${missing.map((x) => x.slug).join(", ")})`);
        // Shadowed gets its own remedy: sync refuses to write through a file it did not generate, so
        // pointing at sync here would name a fix that cannot work.
        if (shadowed.length > 0) parts.push(`${shadowed.length} shadowed by a hand-authored SKILL.md (${shadowed.map((x) => x.slug).join(", ")}), remove it to let sync own the slot`);
        const fix = stale.length > 0 || missing.length > 0 ? " — run pantry skills sync" : "";
        checks.push({
          id: "skills-freshness",
          severity: "warn",
          ok: false,
          label: "skills mounted",
          detail: `${parts.join(", ")}${fix}`,
        });
      }
    } catch (err) {
      checks.push({ id: "skills-freshness", severity: "info", ok: true, label: "skills mounted", detail: `skills check skipped: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  // ── Run-ledger evidence (11c: LOOP.md §9 made checkable) ─────────────────
  // Warn, never error: a report missing its diffstat is a report to finish, not a broken kit, and the
  // cognitive tier is what fixes it (LOOP.md §2). A repo with no runs dir at all gets an info — the
  // convention is opt-in per host and an unstarted ledger is not a failure. This check reads only the
  // host's own files, so it needs no package to resolve and cannot reach outside cwd.
  try {
    const r = runsPayload;
    if (!r.available || r.count === 0) {
      checks.push({
        id: "run-report-evidence",
        severity: "info",
        ok: true,
        label: "run ledger",
        detail: `no run reports yet — a run closes with one at ${config.runsDir} (LOOP.md §4a)`,
      });
    } else if (r.incompleteCount === 0) {
      checks.push({ id: "run-report-evidence", severity: "info", ok: true, label: "run ledger", detail: `${r.count} run reports, all carry their evidence` });
    } else {
      // Name the two most recent offenders in full rather than every one: the detail is a terminal
      // line, and the oldest incomplete report is the least likely to be the one worth fixing now.
      const named = r.runs
        .filter((x) => x.gaps.length > 0)
        .slice(0, 2)
        .map((x) => `${x.id} (${x.gaps.map((g) => g.label).join("; ")})`);
      const rest = r.incompleteCount - named.length;
      checks.push({
        id: "run-report-evidence",
        severity: "warn",
        ok: false,
        label: "run ledger",
        detail: `${r.incompleteCount} of ${r.count} run reports missing evidence: ${named.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`,
      });
    }
  } catch (err) {
    checks.push({ id: "run-report-evidence", severity: "info", ok: true, label: "run ledger", detail: `run-ledger check skipped: ${err instanceof Error ? err.message : String(err)}` });
  }

  // ── Unacted answers (DECISIONS §4 made a loop step rather than a habit) ──
  //
  // The answer channel worked before this check existed and nothing obliged anyone to look at it,
  // which DECISIONS §4 said out loud: "a channel that works and is not yet one that is always
  // checked". A sentence in a standard does not make a session read a file. Doctor runs at session
  // start (LOOP.md §2, tier 1), so putting the count here is what turns the habit into a step.
  //
  // WARN, never error, and the distinction is the whole design. An unacted answer is work that is
  // due, not a broken kit, and CI has no session to act on it: failing the build would mean a
  // pending decision blocks every push by everyone, which is how a check gets muted inside a week
  // (LOOP.md §2's baseline rule, same lesson). An ack is itself an entry, so deferring is one
  // command and the count goes down honestly rather than by editing the log.
  try {
    if (!existsSync(config.answersLog)) {
      checks.push({ id: "unacted-answers", severity: "info", ok: true, label: "answer log", detail: `no answer log yet — one appears at ${config.answersLog} the first time a question is answered (DECISIONS §4)` });
    } else {
      const log = await readAnswerLog(config.answersLog);
      const pending = unacked(log);
      if (pending.length === 0) {
        checks.push({ id: "unacted-answers", severity: "info", ok: true, label: "answer log", detail: `${answers(log).length} answers, all acted on` });
      } else {
        // Named, not just counted. A number tells a session there is something to read and nothing
        // about whether it touches the work in front of it; the ref is what makes it actionable in
        // the one line a terminal gives this check.
        const named = pending.slice(0, 3).map((a) => a.request.ref);
        const rest = pending.length - named.length;
        checks.push({
          id: "unacted-answers",
          severity: "warn",
          ok: false,
          label: "answer log",
          detail: `${pending.length} answers no session has acted on: ${named.join(", ")}${rest > 0 ? `, and ${rest} more` : ""} — read them with pantry answers, then act or ack`,
        });
      }
    }
  } catch (err) {
    checks.push({ id: "unacted-answers", severity: "info", ok: true, label: "answer log", detail: `answer-log check skipped: ${err instanceof Error ? err.message : String(err)}` });
  }

  // ── Scope growth, diagnosed rather than just reported (S4) ───────────────
  //
  // The run ledger above already says a run grew past its declared scope. This says whether the graph
  // SAW IT COMING, which is the part a session can act on. For each report that grew, the growth is
  // split against the blast radius of what it declared: files the graph already connected to the
  // declared scope were predictable, and the session could have widened its scope up front by asking.
  // Files outside the radius are the interesting ones, because the run reached somewhere structurally
  // unconnected.
  //
  // Measured over all three run reports in pantry before this was written: 11 of 11 growth files were
  // inside the radius, 0 surprising. So on every piece of evidence we have, scope growth here has been
  // predictable and the answer was one query away. Info severity: the run ledger already carries the
  // warn, and saying the same thing twice at warn would just teach people to skim both.
  //
  // Deliberately NOT the check the plan first specified ("flag a plan whose declared touches are
  // narrower than the blast radius"). Measured, that rule demands the whole repo: the radius of a
  // single config file is 22 of pantry's files, of which 12 went untouched. Requiring scope to cover
  // the radius would make every declaration meaningless, so it was rejected on the numbers.
  if (runSymbols) {
    try {
      // This repo's OWN graph, deliberately not `config.graphPath`. A run report's scope names files in
      // THIS repo, and the merged estate graph relabels and cross-links them, so it silently reports
      // local files as "outside any blast radius" — which is exactly what it did on the first run here.
      const graph = await loadGraph(join(config.graphDir, "graph.json"));
      const r = runsPayload;
      const grew = r.available ? r.runs.filter((x) => x.outOfScope.length > 0) : [];
      if (!graph) {
        checks.push({ id: "scope-radius", severity: "info", ok: true, label: "scope growth vs the graph", detail: "no graph — run graphify update ." });
      } else if (grew.length === 0) {
        checks.push({ id: "scope-radius", severity: "info", ok: true, label: "scope growth vs the graph", detail: `${r.count ?? 0} run reports, none grew past its declared scope` });
      } else {
        let predictable = 0;
        const surprising = new Set<string>(); // deduped: the same file often grows two reports
        for (const run of grew) {
          const radius = new Set(affectedBy(graph, run.scope.map((s) => basename(s))));
          for (const f of run.outOfScope) {
            if (radius.has(f) || radius.has(basename(f))) predictable++;
            else surprising.add(f);
          }
        }
        checks.push({
          id: "scope-radius",
          severity: "info",
          ok: true,
          label: "scope growth vs the graph",
          detail: surprising.size === 0
            ? `${predictable} growth files across ${grew.length} report${grew.length === 1 ? "" : "s"}, all inside the declared scope's blast radius — ask the graph before declaring`
            : `${predictable} predictable, ${surprising.size} outside any blast radius: ${[...surprising].slice(0, 4).join(", ")}`,
        });
      }
    } catch (err) {
      checks.push({ id: "scope-radius", severity: "info", ok: true, label: "scope growth vs the graph", detail: `skipped: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  const ok = !checks.some((c) => !c.ok && c.severity === "error");
  return { ok, checks };
}

// Plain-text report for a terminal / CI log — same posture as formatDriftReport: no backticks, no ANSI
// (color is a UI signal, not stdout). Each line is one check; the tail is a count + pass/fail.
export function formatDoctorReport(report: DoctorReport): string {
  const mark = (c: DoctorCheck): string => {
    if (c.ok) return c.severity === "info" ? "info" : "ok  ";
    if (c.severity === "error") return "FAIL";
    if (c.severity === "warn") return "warn";
    return "info";
  };
  const lines = report.checks.map((c) => `[${mark(c)}] ${c.label}: ${c.detail}`);
  const failing = report.checks.filter((c) => !c.ok && c.severity === "error").length;
  const due = report.checks.filter((c) => !c.ok && c.severity === "warn").length;
  lines.push(`${report.checks.length} checks, ${failing} failing, ${due} due`);
  lines.push(report.ok ? "OK" : "FAIL");
  return lines.join("\n");
}
