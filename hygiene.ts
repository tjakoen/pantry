// pantry/hygiene.ts — S3a of the portfolio's plans/skills-runtime.md: the loop's hygiene half, made
// mechanical. LOOP.md §8 names the one thing this estate actually breaks — work that is finished,
// green, and still sitting: uncommitted across sessions, or committed and never delivered. Nothing
// measured it, so it was only ever visible to whoever happened to run git status and think about it.
//
// This module is the measurement. Same posture as every other check in PANTRY: no model, no writes,
// no network. Two git plumbing calls and a stat, all of it deterministic when `now` is injected, all
// of it degrading to "cannot say" rather than guessing when git has no answer.
//
// It reports FACTS. Which fact crosses which line is doctor.ts's business, and what the lines are is
// the host's (see HygieneThresholds) — the split exists because a threshold is an opinion and a
// working tree is not.
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { GitRunner } from "./timeline.ts";

export const DAY_MS = 86_400_000;

/** Whole days between two instants, floored — the age math every doctor check shares. Floored rather
 *  than rounded so "older than N days" means what a person means by it: a change 29.9 days old is 29
 *  days old, and a threshold of 30 has not been crossed yet. */
export const daysBetween = (now: Date, then: Date): number => Math.floor((now.getTime() - then.getTime()) / DAY_MS);

/**
 * The four numbers the hygiene checks compare against, all owner-set (portfolio
 * plans/decisions/2026-08-11-loop-hygiene-thresholds.md) and all overridable per host in
 * pantry.config under `hygiene`.
 *
 * **A non-finite threshold mutes its check**, and that is a supported state rather than an accident:
 * a repo where a pile-up is normal (a long-lived branch, a fork nobody pushes) can set one to null
 * and get an info saying so, instead of a warn it learns to skim. LOOP.md §2's baseline rule is the
 * same lesson from the other end — a check nobody can turn off is a check everybody mutes.
 */
export interface HygieneThresholds {
  /** the oldest dirty file older than this many days warns; see `oldestDirty` on what age means */
  uncommittedMaxAgeDays: number;
  /** the oldest commit not on the upstream older than this many days warns */
  unpushedMaxAgeDays: number;
  /** this many commits ahead of the upstream warns, regardless of age */
  unpushedMaxCommits: number;
  /** this many commits since the newest run report warns (LOOP.md §4a: a run closes with one) */
  runReportMaxCommits: number;
}

/**
 * The estate-wide defaults, and the one thing in this module that is not a measurement.
 *
 * **Owner-set, 2026-08-11**, answering plans/decisions/2026-08-11-loop-hygiene-thresholds.md in the
 * portfolio (option B, "a working week"; the answer is in the log at
 * plans/decisions/answers.jsonl, ref 2026-08-11-loop-hygiene-thresholds). These four numbers were
 * deliberately NOT chosen by the run that built the checks: a threshold is an agreement about what
 * "too long" means in this estate, and a plausible number nobody agreed to is an opinion wearing a
 * default's clothes.
 *
 * What the answer was weighed against, so a later retune starts from evidence rather than from
 * scratch: over the thirty days to 2026-08-11 the portfolio averaged 9.9 commits per active day and
 * peaked at 42, pantry 6.8 and 49, grain 4.9 and 10. So a ten-commit unpushed line would have fired
 * on an ordinary day, every day, and any commit count under roughly twenty is an alarm rather than a
 * signal. Five days is the other half of the same reasoning: it cannot fire inside a single day's
 * work in any repo measured, and it still catches a pile-up while it is one commit and one push to
 * clear rather than after it is already bad.
 *
 * The known cost, stated when it was chosen: pushes here are owner-authorised in bursts days apart,
 * so `unpushedMaxAgeDays` will sometimes warn about the gap between authorisations rather than about
 * the work. Retune, or mute per repo, if that reads as noise.
 */
export const DEFAULT_HYGIENE: HygieneThresholds = {
  uncommittedMaxAgeDays: 5,
  unpushedMaxAgeDays: 5,
  unpushedMaxCommits: 25,
  runReportMaxCommits: 15,
};

/** One dirty path and how old its content is. */
export interface DirtyEntry {
  /** repo-relative, exactly as git reported it */
  path: string;
  /** the file's mtime — a FLOOR on the change's age, never the true age (see `oldestDirty`) */
  at: Date;
}

/** Everything the four checks read, gathered in one pass so doctor makes no git call of its own. */
export interface HygieneState {
  /** false when git is absent, cwd is not a work tree, or the repo has no commits — every field
   *  below is then empty, and a caller reads that as "cannot say", never as "clean" */
  isRepo: boolean;
  /** configured remotes; empty is the no-remote case, which is INFO and never a failure */
  remotes: string[];
  /** the tracking branch (e.g. "origin/main"), or null when this branch has never been pushed */
  upstream: string | null;
  /** dirty paths from git status: modified, staged, and untracked alike */
  dirty: string[];
  /** the oldest dirty path by mtime, or null when the tree is clean (or nothing could be stat-ed) */
  oldestDirty: DirtyEntry | null;
  /** commits on HEAD and not on the upstream; 0 when there is no upstream to compare against */
  unpushedCount: number;
  /** the commit date of the OLDEST unpushed commit — the one that has been waiting longest */
  oldestUnpushed: Date | null;
}

const EMPTY: HygieneState = {
  isRepo: false,
  remotes: [],
  upstream: null,
  dirty: [],
  oldestDirty: null,
  unpushedCount: 0,
  oldestUnpushed: null,
};

const lines = (out: string | null): string[] =>
  (out ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/**
 * Parse `git status --porcelain -z`.
 *
 * The NUL form is not a stylistic preference. In the newline form git QUOTES any path with a space,
 * a quote or a non-ASCII byte in it (core.quotepath), so a plain split would hand back a path that
 * does not exist on disk and the stat below would silently skip the very file most likely to have
 * been sitting there for weeks. With -z the bytes are verbatim.
 *
 * A rename or copy entry is TWO records: the new path, then the source path with no status prefix.
 * The source is consumed and dropped — the file that exists in the working tree is the new one, and
 * counting both would double-count one change.
 */
export function parsePorcelain(out: string | null): string[] {
  if (out === null) return [];
  const records = out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec) continue;
    const status = rec.slice(0, 2);
    const path = rec.slice(3);
    if (!path) continue;
    paths.push(path);
    // R and C carry their source in the following record; skip it rather than read it as a status.
    if (status[0] === "R" || status[0] === "C" || status[1] === "R" || status[1] === "C") i++;
  }
  return paths;
}

/**
 * The oldest dirty path by mtime.
 *
 * **mtime is a floor on the age of a change, not the age of the change, and the direction matters.**
 * A file first edited three weeks ago and touched again this morning reads as fresh here, so this
 * check UNDER-reports and can never over-report. That is the right direction for a warn: what it
 * actually measures is "written, untouched since, and still not committed", which is a stronger
 * signal than "dirty for N days" and a strictly smaller set. The honest alternative (walking the
 * reflog or diffing against every commit that touched the path) costs a git call per dirty file at
 * every session start, which is the price this module refuses to pay — same call doctor.ts's audit
 * activity makes.
 *
 * A path that cannot be stat-ed is skipped, not counted as age zero: a deletion has no mtime, and
 * treating it as brand new would make deleting a file look like tidying up.
 */
export async function oldestDirty(cwd: string, paths: string[]): Promise<DirtyEntry | null> {
  let best: DirtyEntry | null = null;
  for (const p of paths) {
    try {
      const st = await stat(join(cwd, p));
      if (!best || st.mtime < best.at) best = { path: p, at: st.mtime };
    } catch {
      continue; // deleted, unreadable, or a path git can see and we cannot — skip, never guess
    }
  }
  return best;
}

/**
 * Read every fact the hygiene checks need, in one pass.
 *
 * Never throws and never reports a state it did not measure. Not a repo, no git on the machine, a
 * repo with no commits yet: all of them come back `isRepo: false`, which every caller renders as an
 * info rather than a pass — "we could not look" and "we looked and it was clean" are different
 * claims, and the whole point of this module is to stop conflating them.
 */
export async function readHygieneState(cwd: string, git: GitRunner): Promise<HygieneState> {
  // --is-inside-work-tree, not --git-dir: a bare repo has no working tree to be dirty, and HEAD in a
  // fresh repo with no commits makes every log call below fail anyway.
  const inside = await git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (inside?.trim() !== "true") return { ...EMPTY };

  const [statusOut, remotesOut, upstreamOut] = await Promise.all([
    git(["status", "--porcelain", "-z"], cwd),
    git(["remote"], cwd),
    // Fails (null) when the branch has no upstream, which is exactly the "never been pushed" case.
    git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd),
  ]);

  const dirty = parsePorcelain(statusOut);
  const upstream = upstreamOut?.trim() || null;

  let unpushedCount = 0;
  let oldest: Date | null = null;
  if (upstream) {
    // One call for both facts: the count is the line count and the oldest commit is the last line,
    // since git log walks newest first. Asking rev-list --count separately would be a second spawn
    // for a number already on screen.
    const log = lines(await git(["log", "--format=%cI", `${upstream}..HEAD`], cwd));
    unpushedCount = log.length;
    const last = log.at(-1);
    if (last) {
      const parsed = new Date(last);
      if (!Number.isNaN(parsed.getTime())) oldest = parsed;
    }
  }

  return {
    isRepo: true,
    remotes: lines(remotesOut),
    upstream,
    dirty,
    oldestDirty: await oldestDirty(cwd, dirty),
    unpushedCount,
    oldestUnpushed: oldest,
  };
}

/**
 * How many commits have landed since `sinceDay` (a YYYY-MM-DD run-report date), or the whole history
 * when there is no report to measure from.
 *
 * The window opens at the END of the report's day, so commits made on the day a report closed count
 * as covered by it. That is a few hours of slack in either direction depending on the machine's
 * timezone, and it is the right slack: a report written at 18:00 covers the commit at 16:00, and
 * calling that commit unreported would flag every run the moment it finished.
 *
 * Null when git cannot answer, which callers read as "cannot say" rather than zero.
 */
export async function commitsSince(cwd: string, git: GitRunner, sinceDay: string | null): Promise<number | null> {
  const args = sinceDay
    ? ["rev-list", "--count", `--since=${sinceDay}T23:59:59`, "HEAD"]
    : ["rev-list", "--count", "HEAD"];
  const out = await git(args, cwd);
  if (out === null) return null;
  const n = Number(out.trim());
  return Number.isFinite(n) ? n : null;
}

/** Is this threshold a real line, or has the host muted the check? */
export const isSet = (threshold: number): boolean => Number.isFinite(threshold) && threshold > 0;

/** "1 commit" / "2 commits" — said once here so four detail lines cannot disagree about it. */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
