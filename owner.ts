// pantry/owner.ts: the owner's side of the loop, read back as findings.
//
// The report tells the owner what agents did. This file reads the reverse: where the owner is the
// bottleneck or has left things behind. A decision waiting for days, a human gate holding several
// plans, a worktree nobody has touched in a week, a branch merged and never deleted. Each finding
// names its evidence and one action, and it only ever recommends: nothing here answers a decision,
// removes a worktree or deletes a branch. The owner's gate stays the owner's.
//
// The judgement calls, such as a decision that contradicts a plan's goal, need a model. Those come
// from a review an agent writes on request into the reviews folder, and the report shows the latest
// one under its own heading, never mixed into the mechanical findings below.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BriefPayload } from "./brief.ts";
import type { Finding } from "./report.ts";

/** Thresholds, from the registry's review block. A one-project user can set off: true. */
export interface ReviewConfig { off?: boolean; gateDays?: number; idleDays?: number }
export const DEFAULT_REVIEW = { gateDays: 3, idleDays: 7 } as const;

const DAY = 86_400_000;

export interface OwnerInput { name: string; path: string; brief: BriefPayload | null }

/** What git can tell about one checkout: its worktrees with their last commit, and merged branches. */
export interface GitFacts {
  worktrees: { path: string; branch: string; lastCommit: number; dirty: boolean }[];
  merged: string[];
  /** last commit time of a file, in ms, or null when it has none */
  fileAge: (file: string) => number | null;
}

const run = (args: string[], cwd: string) => {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore", timeout: 5_000 });
  return r.exitCode === 0 ? r.stdout.toString() : "";
};

export function gitFacts(dir: string): GitFacts {
  const worktrees: GitFacts["worktrees"] = [];
  const blocks = run(["worktree", "list", "--porcelain"], dir).split("\n\n").filter(Boolean);
  // The first block is the main checkout, which is never idle in the sense meant here.
  for (const b of blocks.slice(1)) {
    const path = /^worktree (.+)$/m.exec(b)?.[1];
    if (!path || !existsSync(path)) continue;
    const branch = /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] ?? "detached";
    const ct = Number(run(["log", "-1", "--format=%ct"], path).trim()) * 1000;
    worktrees.push({ path, branch, lastCommit: Number.isFinite(ct) && ct > 0 ? ct : statSync(path).mtimeMs, dirty: run(["status", "--porcelain"], path).trim() !== "" });
  }
  const head = run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir).trim().replace(/^origin\//, "") || "main";
  const inWorktree = new Set(worktrees.map((w) => w.branch));
  const merged = run(["branch", "--merged", head, "--format=%(refname:short)"], dir).split("\n").map((s) => s.trim()).filter((s) => s && s !== head && !inWorktree.has(s));
  return { worktrees, merged, fileAge: (file) => { const t = Number(run(["log", "-1", "--format=%ct", "--", file], dir).trim()) * 1000; return t > 0 ? t : null; } };
}

export function ownerFindings(inputs: OwnerInput[], facts: (path: string) => GitFacts, cfg: ReviewConfig = {}, now = Date.now()): Finding[] {
  if (cfg.off) return [];
  const gateDays = cfg.gateDays ?? DEFAULT_REVIEW.gateDays, idleDays = cfg.idleDays ?? DEFAULT_REVIEW.idleDays;
  const out: Finding[] = [];
  for (const p of inputs) {
    const g = facts(p.path);
    const days = (t: number) => Math.floor((now - t) / DAY);
    // Waiting decisions and gates are the report's What to decide queue, ranked there; listing them
    // here as well said everything twice.
    for (const w of g.worktrees) {
      if (days(w.lastCommit) < idleDays) continue;
      out.push({ severity: w.dirty ? "medium" : "low", project: p.name, title: `A worktree idle for ${days(w.lastCommit)} days`, evidence: `${w.path} on ${w.branch}${w.dirty ? ", with uncommitted changes" : ""}`, action: w.dirty ? "Commit or park the changes, then remove the worktree." : `Remove it: git worktree remove ${w.path}` });
    }
    if (g.merged.length) out.push({ severity: "low", project: p.name, title: `${g.merged.length} branch(es) merged and not deleted`, evidence: g.merged.slice(0, 5).join(", ") + (g.merged.length > 5 ? `, and ${g.merged.length - 5} more` : ""), action: `Delete them: git branch -d ${g.merged.slice(0, 5).join(" ")}` });
    const quiet = (p.brief?.inFlight ?? []).filter((r) => r.planId && r.status === "doing" && !r.claim).filter((r) => { const t = g.fileAge(`plans/${r.planId}.md`); return t !== null && days(t) >= 7; });
    if (quiet.length) out.push({ severity: "medium", project: p.name, title: `${quiet.length} plan(s) doing with no claim and no commit for a week`, evidence: quiet.slice(0, 4).map((r) => r.planId).join(", "), action: "Park each one back to todo, or claim it and finish." });
  }
  // Several registry entries can point into one repository; the same worktree or gate is then one
  // finding naming every entry, not one per entry.
  const merged = new Map<string, Finding>();
  for (const f of out) {
    const k = `${f.title}\u0000${f.evidence}`;
    const m = merged.get(k);
    if (m) m.project = `${m.project}, ${f.project}`;
    else merged.set(k, { ...f });
  }
  return [...merged.values()];
}

/** The latest review an agent wrote, if any: the reviews folder's newest Markdown file. */
export const REVIEW_FILE = "latest.md";
export function latestReview(home: string): { text: string; at: string } | null {
  const f = join(home, "reviews", REVIEW_FILE);
  if (!existsSync(f)) return null;
  return { text: readFileSync(f, "utf8"), at: new Date(statSync(f).mtimeMs).toISOString() };
}

/** The prompt the owner copies into a session to ask for the judgement half of the review. */
export function reviewPrompt(home: string): string {
  return [
    "Review my side of the PANTRY loop. Call pantry_read with surface report for the findings, then pantry_read with surface decisions in each project it names.",
    "Look for three things a script cannot judge: a decision I recorded that contradicts a plan's stated goal or a standard (quote both side by side), a gate of mine that blocks more plans than it unblocks, and work I asked for that no plan covers.",
    "Each finding names its evidence and one action I can take. Recommend only: do not answer decisions, edit plans or remove anything.",
    `Write the result as Markdown to ${join(home, "reviews", REVIEW_FILE)}, replacing the old one, under a heading with today's date.`,
  ].join("\n\n");
}
