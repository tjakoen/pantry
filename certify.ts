// The release certificate: proof, kept next to the code, that the commit about to ship was checked.
//
// Adapted from the release gate and coverage gate in C.R.I.S.S.P. by Richard Edens
// (https://github.com/richardedens/crissp, Apache-2.0). The idea taken is theirs: a deploy passes
// only with a green full run at most seven days old plus a green check for every commit since, on
// the commit being shipped, with no bypass, and coverage may only go up. The code is PANTRY's own.
//
// No model decides anything here. A gate is a shell command, and its exit code is the verdict.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MAX_FULL_AGE_DAYS = 7;
const CERT_PATH = ".pantry/certificate.json";

export interface GateRun { sha: string; at: string; ok: boolean; coverage?: number }

export interface Certificate {
  full?: GateRun;
  checks: GateRun[];
  /** The coverage floor. A full run below it fails; a full run above it raises it. */
  coverageFloor?: number;
}

export interface Gates { full: string; check: string }

const DEFAULT_GATES: Gates = { full: "bun run check && bun test --coverage", check: "bun run check && bun test" };

/** Reads `gates` from pantry.config.json; anything absent falls back to the Bun defaults. */
export function readGates(cwd: string): Gates {
  const path = join(cwd, "pantry.config.json");
  if (!existsSync(path)) return DEFAULT_GATES;
  const raw = JSON.parse(readFileSync(path, "utf8")) as { gates?: Partial<Gates> };
  return { full: raw.gates?.full ?? DEFAULT_GATES.full, check: raw.gates?.check ?? DEFAULT_GATES.check };
}

export function readCertificate(cwd: string): Certificate {
  const path = join(cwd, CERT_PATH);
  if (!existsSync(path)) return { checks: [] };
  return JSON.parse(readFileSync(path, "utf8")) as Certificate;
}

export function writeCertificate(cwd: string, cert: Certificate): void {
  mkdirSync(join(cwd, ".pantry"), { recursive: true });
  writeFileSync(join(cwd, CERT_PATH), JSON.stringify(cert, null, 2) + "\n");
}

function git(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString().trim()}`);
  return proc.stdout.toString().trim();
}

/** A certificate is about a commit, so a dirty tree cannot earn one: what ran would not be what ships. */
export function treeIsClean(cwd: string): boolean {
  return git(cwd, ["status", "--porcelain", "--untracked-files=no", "--", ".", ":!.pantry"]) === "";
}

/** Reads the "All files" line coverage from bun's or istanbul's text table, if the output has one. */
export function parseCoverage(output: string): number | undefined {
  const m = output.match(/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
  return m ? Number(m[2]) : undefined;
}

export interface GateResult { run: GateRun; output: string; reason?: string }

/** Runs one gate on HEAD and records it. `full` also enforces and ratchets the coverage floor. */
export function runGate(cwd: string, kind: "full" | "check", now = new Date()): GateResult {
  if (!treeIsClean(cwd)) {
    return { run: { sha: "", at: now.toISOString(), ok: false }, output: "", reason: "the working tree has uncommitted changes; commit first" };
  }
  const sha = git(cwd, ["rev-parse", "HEAD"]);
  const cmd = readGates(cwd)[kind];
  const proc = Bun.spawnSync(["sh", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe" });
  const output = proc.stdout.toString() + proc.stderr.toString();
  const run: GateRun = { sha, at: now.toISOString(), ok: proc.exitCode === 0 };
  const cert = readCertificate(cwd);
  let reason: string | undefined = run.ok ? undefined : `\`${cmd}\` exited ${proc.exitCode}`;

  if (kind === "full") {
    run.coverage = parseCoverage(output);
    if (run.ok && run.coverage !== undefined && cert.coverageFloor !== undefined && run.coverage < cert.coverageFloor) {
      run.ok = false;
      reason = `line coverage ${run.coverage}% fell below the floor of ${cert.coverageFloor}%`;
    }
    if (run.ok && run.coverage !== undefined) cert.coverageFloor = Math.max(cert.coverageFloor ?? 0, run.coverage);
    cert.full = run;
    if (run.ok) cert.checks = cert.checks.filter((c) => c.sha !== sha);
  } else {
    cert.checks = [...cert.checks.filter((c) => c.sha !== sha), run];
  }
  writeCertificate(cwd, cert);
  return { run, output, reason };
}

export interface Verdict { ok: boolean; head: string; problems: string[] }

/**
 * Whether HEAD may ship. It needs a green full run at most seven days old on an ancestor of HEAD
 * (or on HEAD), and a green check on every commit after it, HEAD included. There is no bypass flag.
 */
export function verify(cwd: string, now = new Date()): Verdict {
  const head = git(cwd, ["rev-parse", "HEAD"]);
  const cert = readCertificate(cwd);
  const problems: string[] = [];
  if (!treeIsClean(cwd)) problems.push("the working tree has uncommitted changes");
  if (!cert.full) return { ok: false, head, problems: [...problems, "no full run on record: run `pantry certify full`"] };
  if (!cert.full.ok) problems.push(`the last full run (${cert.full.sha.slice(0, 7)}) was red`);
  const ageDays = (now.getTime() - new Date(cert.full.at).getTime()) / 86_400_000;
  if (ageDays > MAX_FULL_AGE_DAYS) problems.push(`the last full run is ${Math.floor(ageDays)} days old; the limit is ${MAX_FULL_AGE_DAYS}`);

  const isAncestor = Bun.spawnSync(["git", "merge-base", "--is-ancestor", cert.full.sha, head], { cwd }).exitCode === 0;
  if (!isAncestor) {
    problems.push(`the full run's commit ${cert.full.sha.slice(0, 7)} is not in this branch's history`);
  } else {
    const since = git(cwd, ["rev-list", `${cert.full.sha}..${head}`]).split("\n").filter(Boolean);
    const green = new Set(cert.checks.filter((c) => c.ok).map((c) => c.sha));
    for (const sha of since) if (!green.has(sha)) problems.push(`commit ${sha.slice(0, 7)} has no green check`);
  }
  return { ok: problems.length === 0, head, problems };
}

export function formatVerdict(v: Verdict): string {
  if (v.ok) return `release gate: OPEN for ${v.head.slice(0, 7)}`;
  return [`release gate: CLOSED for ${v.head.slice(0, 7)}`, ...v.problems.map((p) => `  - ${p}`)].join("\n");
}
