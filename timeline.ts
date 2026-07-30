// pantry/timeline.ts — piece 11e sub-unit 3: the RETROSPECTIVE project timeline, DATA layer (the view
// is in app.ts, same split as map.ts/decisions.ts/artifacts.ts). /timeline draws the project's OWN
// history — plan bars from git-derived status-transition dates, `depends` arrows, commit density, and
// dated audit-report markers — reading nothing but git + the plan files + report mtimes. PANTRY runs no
// model: git is a history read (a fancy `fs stat`), never a forecast. Hard rule enforced end to end:
// NO estimate, NO projected/future bar, NO "target" date — every date rendered is a real git commit
// date, a real file mtime, or `generatedAt` ("now"). This module is pure reads; it never writes.
import { readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { loadPlans } from "@tjakoen/proof/loader.ts";
import { parseFrontmatter } from "@tjakoen/mill/core/frontmatter.ts";
import type { ResolvedPantryConfig } from "./config.ts";

export interface TimelineTransition {
  status: string;
  /** ISO — the first commit date this status was observed at, walking the file's history oldest first */
  date: string;
}

export interface TimelinePlan {
  id: string;
  status: string;
  track?: string;
  depends: string[];
  /** ISO — when the file was first added (git diff-filter=A), or the oldest commit touching it as a
   *  fallback; null when the file has no readable git history (e.g. untracked, or git is unavailable) */
  created: string | null;
  /** ISO — the first time this plan's frontmatter read status: done; only set when the plan's CURRENT
   *  status is done (a plan that moved on from done again reports no done date) */
  done: string | null;
  /** ISO — the newest commit touching this file */
  lastActivity: string | null;
  /** the status-transition points read from git history, oldest first (the first ISO date each status
   *  value was observed at); empty when history couldn't be read — the plan still renders as a single
   *  current-status span */
  transitions: TimelineTransition[];
  /** true when this file's commit history exceeded the per-file scan cap (MAX_REVISIONS_PER_FILE) —
   *  the OLDEST revisions are kept (created + early lifecycle matter most for a retrospective), so a
   *  capped file's most recent transitions may be missing. lastActivity is read separately and is
   *  never affected by this cap. */
  transitionsCapped: boolean;
}

export interface TimelineDensityBucket {
  /** ISO day (bucket "day"), or the Monday of the ISO week (bucket "week") */
  date: string;
  count: number;
}

export interface TimelineAuditMarker {
  label: string;
  /** ISO — the report file's mtime */
  date: string;
}

export interface TimelinePayload {
  /** a git repo with at least one plan was found — false degrades to guidance, never a crash */
  available: boolean;
  project: string;
  plans: TimelinePlan[];
  density: TimelineDensityBucket[];
  densityBucket: "day" | "week";
  auditMarkers: TimelineAuditMarker[];
  /** earliest plan `created` → generatedAt, in days (0 when there is no dated plan) */
  spanDays: number;
  /** distinct calendar days with at least one commit, over the same bounded commit log as `density` */
  activeDays: number;
  earliest: string | null;
  generatedAt: string;
  /** guidance for the empty state; set only when available is false */
  reason?: string;
}

/** Runs one git command (args excluding the leading "git") in `cwd` and returns raw stdout, or null on
 *  failure / non-zero exit / git absent. Injected so this module is testable without a real repo (feed
 *  a fake git log) and so the default implementation stays isolated to one place. */
export type GitRunner = (args: string[], cwd: string) => Promise<string | null>;

const defaultGitRunner: GitRunner = async (args, cwd) => {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return code === 0 ? out : null;
  } catch {
    return null; // git absent, cwd unreadable, or spawn failed — degrade, never throw
  }
};

// Bound the per-file history walk — plans are few, but a runaway history shouldn't hang the page. The
// walk is already oldest-first, so capping keeps the OLDEST revisions: `created` and the early
// lifecycle are what a retrospective cares about most. lastActivity is a separate, single-commit read
// (below), so it is never affected by this cap.
const MAX_REVISIONS_PER_FILE = 200;
// The commit-density strip is bounded to the most recent N commits repo-wide — a long-lived repo's
// full history isn't needed to show the recent work rhythm, and this keeps the page fast.
const MAX_DENSITY_COMMITS = 2000;
// Bucket daily up to this many days of span; beyond that, weekly — otherwise the strip is too dense
// to read as a shape.
const DAILY_BUCKET_MAX_SPAN_DAYS = 120;

const DAY_MS = 86_400_000;
const isoDay = (iso: string): string => iso.slice(0, 10);
const daysBetween = (a: Date, b: Date): number => Math.floor((b.getTime() - a.getTime()) / DAY_MS);

// Monday of the ISO week containing `day` (a "YYYY-MM-DD" string), computed in UTC so bucketing is
// stable regardless of the host's timezone.
function isoWeekStart(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function splitLines(out: string | null): string[] {
  if (!out) return [];
  return out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
}

// A single plan file's git-derived shape: when it was added, its full ordered status history, and its
// newest touch. Every git call degrades to "unknown" (null / empty) rather than throwing — one file's
// unreadable history must not take the whole timeline down.
async function deriveFileHistory(
  git: GitRunner,
  cwd: string,
  relPath: string,
): Promise<{ created: string | null; lastActivity: string | null; transitions: TimelineTransition[]; capped: boolean }> {
  // lastActivity: the single newest commit touching the file.
  const lastOut = await git(["log", "--follow", "-1", "--format=%cI", "--", relPath], cwd);
  const lastActivity = splitLines(lastOut)[0] ?? null;

  // created: the add commit (diff-filter=A); a file re-added under the same path yields multiple
  // lines, oldest last. Falls back below to the oldest commit touching the file when no add commit is
  // found (e.g. a shallow clone, or a rename history git doesn't attribute as an "A").
  const addOut = await git(["log", "--follow", "--diff-filter=A", "--format=%cI", "--", relPath], cwd);
  const addLines = splitLines(addOut);
  let created = addLines.length ? addLines[addLines.length - 1] : null;

  // The full ordered revision list (oldest first) — the source for both the created fallback and every
  // status transition. Capped to the oldest MAX_REVISIONS_PER_FILE (see the constant's doc above).
  const revOut = await git(["log", "--follow", "--reverse", "--format=%H|%cI", "--", relPath], cwd);
  const revLines = splitLines(revOut);
  const capped = revLines.length > MAX_REVISIONS_PER_FILE;
  const revisions = (capped ? revLines.slice(0, MAX_REVISIONS_PER_FILE) : revLines)
    .map((l) => {
      const i = l.indexOf("|");
      return i === -1 ? null : { sha: l.slice(0, i), date: l.slice(i + 1) };
    })
    .filter((r): r is { sha: string; date: string } => r !== null);

  if (!created && revisions.length) created = revisions[0].date;

  const transitions: TimelineTransition[] = [];
  let lastStatus: string | null = null;
  for (const rev of revisions) {
    const showOut = await git(["show", `${rev.sha}:${relPath}`], cwd);
    if (showOut === null) continue; // unreadable revision (e.g. didn't exist yet at this sha) — skip
    let status: string | null;
    try {
      const { data } = parseFrontmatter(showOut);
      status = typeof data.status === "string" && data.status.trim() !== "" ? data.status.trim() : null;
    } catch {
      status = null; // a malformed revision — skip it, never crash the walk
    }
    if (!status || status === lastStatus) continue;
    transitions.push({ status, date: rev.date });
    lastStatus = status;
  }

  return { created, lastActivity, transitions, capped };
}

// Every dated audit report across the usual drop points (mirrors doctor.ts's newestAuditReport dirs,
// but collects every match with its own mtime instead of only the newest). A shallow readdir per dir,
// no recursive walk — cheap by design, same posture as doctor. AUDIT.md (the runbook, not a report) is
// excluded; a match must contain "audit" and end .md.
async function collectAuditMarkers(cwd: string): Promise<TimelineAuditMarker[]> {
  const dirs = [cwd, join(cwd, "artifacts"), join(cwd, "reports"), join(cwd, "docs")];
  const markers: TimelineAuditMarker[] = [];
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
      markers.push({ label: basename(name, ".md"), date: st.mtime.toISOString() });
    }
  }
  markers.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  return markers;
}

// The repo-wide commit-density strip: bounded to the most recent MAX_DENSITY_COMMITS commits, bucketed
// by day (or by ISO week once the visible span is long enough that daily buckets would be too dense to
// read as a shape). Also returns the distinct-day count (activeDays' source) over the same bounded log,
// so the stat tile and the strip never disagree.
async function deriveDensity(
  git: GitRunner,
  cwd: string,
): Promise<{ density: TimelineDensityBucket[]; bucket: "day" | "week"; activeDays: number }> {
  const out = await git(["log", `--max-count=${MAX_DENSITY_COMMITS}`, "--format=%cI"], cwd);
  const dates = splitLines(out);
  if (!dates.length) return { density: [], bucket: "day", activeDays: 0 };

  const days = dates.map(isoDay);
  const activeDays = new Set(days).size;

  const sorted = [...days].sort();
  const spanDays = daysBetween(new Date(sorted[0]), new Date(sorted[sorted.length - 1]));
  const bucket: "day" | "week" = spanDays > DAILY_BUCKET_MAX_SPAN_DAYS ? "week" : "day";
  const keyOf = bucket === "day" ? (d: string) => d : (d: string) => isoWeekStart(d);

  const counts = new Map<string, number>();
  for (const day of days) {
    const key = keyOf(day);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const density = [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { density, bucket, activeDays };
}

// id (filename stem, lowercased — PROOF's own addressing scheme) → the exact filename loadPlans
// matched it from, so git commands run against the real on-disk path even when a filename's case
// doesn't literally equal `${id}.md`. loadPlans itself doesn't expose the source filename, so this
// mirrors its own listing rule (a .md file, README excluded) to rebuild the mapping.
async function planFileNames(plansDir: string): Promise<Map<string, string>> {
  let names: string[];
  try {
    names = await readdir(plansDir);
  } catch {
    return new Map();
  }
  const map = new Map<string, string>();
  for (const name of names) {
    if (!name.endsWith(".md") || name.toLowerCase() === "readme.md") continue;
    map.set(basename(name, ".md").toLowerCase(), name);
  }
  return map;
}

/**
 * Build the retrospective timeline. Pure reads (git via the injected runner, fs stats for report
 * mtimes); no writes, no model. `generatedAt` is injected so the "now" edge and the stat tiles are
 * deterministic in tests. Not a git repo, git absent, or no plans found → available:false with empty
 * arrays and a `reason` — the same "a surface never 500s" posture as every other surface.
 */
export async function buildTimelinePayload(
  config: Pick<ResolvedPantryConfig, "projectName" | "plansDir" | "cwd">,
  generatedAt: string,
  rawGitRunner: GitRunner = defaultGitRunner,
): Promise<TimelinePayload> {
  const base: TimelinePayload = {
    available: false,
    project: config.projectName,
    plans: [],
    density: [],
    densityBucket: "day",
    auditMarkers: [],
    spanDays: 0,
    activeDays: 0,
    earliest: null,
    generatedAt,
  };

  // Wrap the injected runner so a THROWING gitRunner degrades exactly like one that returns null (a
  // failed call) — an agent's test double, or a real git that segfaults, must never take the surface
  // down. Every internal call below goes through `git`, never the raw `rawGitRunner`.
  const git: GitRunner = async (args, cwd) => {
    try {
      return await rawGitRunner(args, cwd);
    } catch {
      return null;
    }
  };

  const repoCheck = await git(["rev-parse", "--is-inside-work-tree"], config.cwd);
  if (!repoCheck || repoCheck.trim() !== "true") {
    return { ...base, reason: "Not a git repository — the timeline is derived entirely from git history, so there is nothing to draw here." };
  }

  const loaded = await loadPlans(config.plansDir, async () => null); // never throws — see loader.ts
  if (loaded.plans.length === 0) {
    return { ...base, reason: "No plans yet — the timeline draws one bar per plan file, once there are plans to read." };
  }

  const fileNames = await planFileNames(config.plansDir);

  const plans: TimelinePlan[] = [];
  for (const lp of loaded.plans) {
    const fileName = fileNames.get(lp.plan.id);
    let created: string | null = null;
    let lastActivity: string | null = null;
    let transitions: TimelineTransition[] = [];
    let capped = false;
    if (fileName) {
      const relPath = relative(config.cwd, join(config.plansDir, fileName));
      const h = await deriveFileHistory(git, config.cwd, relPath);
      created = h.created;
      lastActivity = h.lastActivity;
      transitions = h.transitions;
      capped = h.capped;
    }
    const done =
      lp.plan.status === "done" ? transitions.find((t) => t.status === "done")?.date ?? lastActivity ?? null : null;
    plans.push({
      id: lp.plan.id,
      status: lp.plan.status,
      track: lp.plan.track ?? undefined,
      depends: lp.plan.depends,
      created,
      done,
      lastActivity,
      transitions,
      transitionsCapped: capped,
    });
  }

  const { density, bucket, activeDays } = await deriveDensity(git, config.cwd);
  const auditMarkers = await collectAuditMarkers(config.cwd);

  const createdDates = plans.map((p) => p.created).filter((d): d is string => !!d).sort();
  const earliest = createdDates[0] ?? null;
  const spanDays = earliest ? daysBetween(new Date(isoDay(earliest)), new Date(isoDay(generatedAt))) : 0;

  return {
    available: true,
    project: config.projectName,
    plans,
    density,
    densityBucket: bucket,
    auditMarkers,
    spanDays,
    activeDays,
    earliest,
    generatedAt,
  };
}
