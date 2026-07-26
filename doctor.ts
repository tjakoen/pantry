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
import { join, basename, resolve, dirname } from "node:path";
import { loadPantryConfig, type ResolvedPantryConfig } from "./config.ts";
import { checkPantryDrift } from "./drift.ts";

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
  /** inject a resolved config (tests); default loadPantryConfig(cwd) */
  config?: ResolvedPantryConfig;
  /** fold the doc-drift lint in as a check; default true (set false when packages aren't resolvable) */
  runDrift?: boolean;
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
  const config = opts.config ?? (await loadPantryConfig(cwd));
  const runDrift = opts.runDrift ?? true;

  const checks: DoctorCheck[] = [];

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
  const auditRunbook = existsSync(join(cwd, "AUDIT.md"));
  if (!auditRunbook) {
    checks.push({ id: "audit-freshness", severity: "info", ok: true, label: "audit freshness", detail: "no AUDIT.md runbook in this repo" });
  } else {
    const report = await newestAuditReport(cwd);
    if (!report) {
      checks.push({
        id: "audit-freshness",
        severity: "warn",
        ok: false,
        label: "audit freshness",
        detail: "AUDIT.md runbook present but no dated audit report found — audit may be overdue",
      });
    } else {
      const age = daysBetween(now, report.mtime);
      const fresh = age <= auditMaxAgeDays;
      checks.push({
        id: "audit-freshness",
        severity: "warn",
        ok: fresh,
        label: "audit freshness",
        detail: fresh ? `last audit ${age} days old (${basename(report.path)})` : `last audit ${age} days old — over ${auditMaxAgeDays}d, run AUDIT.md`,
      });
    }
  }

  // graphify-out freshness (the mindmap's brain; regenerable, host-local).
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
