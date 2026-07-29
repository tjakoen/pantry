// pantry/doctor.test.ts — piece 11a: the loop's mechanical tier. We assert the EFFECT against a real
// temp host: a compliant kit passes; a broken kit FAILS at error severity (so CI exits nonzero); and a
// merely-due chore (overdue audit, missing e2e) surfaces as a warn WITHOUT failing the report. Age math
// is deterministic via an injected `now` + utimes; drift is turned off (unit scope — no package
// resolution), it has its own suite (drift.test.ts).
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, symlink, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedPantryConfig } from "./config.ts";
import { runDoctor, formatDoctorReport, type DoctorReport } from "./doctor.ts";

const NOW = new Date("2026-07-26T00:00:00.000Z");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pantry-doctor-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// A resolved config pointing at the temp host; overridable per test.
const cfg = (over: Partial<ResolvedPantryConfig> = {}): ResolvedPantryConfig => ({
  cwd: dir,
  projectName: "t",
  plansDir: join(dir, "plans"),
  docsDirs: [],
  graphPath: null,
  decisionsDir: join(dir, "plans", "decisions"),
  artifactsDir: join(dir, "artifacts"),
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true, decisions: true, artifacts: true },
  ...over,
});

// The always-passing baseline: CLAUDE.md + AGENTS symlink + plans/ + config + e2e/.
async function compliantKit() {
  await writeFile(join(dir, "CLAUDE.md"), "# CLAUDE");
  await symlink("CLAUDE.md", join(dir, "AGENTS.md"));
  await mkdir(join(dir, "plans"));
  await writeFile(join(dir, "pantry.config.json"), "{}\n");
  await mkdir(join(dir, "e2e"));
}

const run = (over: Partial<ResolvedPantryConfig> = {}, more = {}): Promise<DoctorReport> =>
  runDoctor({ cwd: dir, now: NOW, config: cfg(over), runDrift: false, ...more });

const byId = (r: DoctorReport, id: string) => r.checks.find((c) => c.id === id)!;

async function setAge(path: string, days: number) {
  const t = new Date(NOW.getTime() - days * 86_400_000);
  await utimes(path, t, t);
}

describe("pantry doctor — kit compliance (error tier)", () => {
  test("a compliant kit passes with no failures", async () => {
    await compliantKit();
    const r = await run();
    expect(r.ok).toBe(true);
    expect(byId(r, "claude-md").ok).toBe(true);
    expect(byId(r, "agents-symlink").ok).toBe(true);
    expect(byId(r, "plans-dir").ok).toBe(true);
    expect(byId(r, "no-forked-standards").ok).toBe(true);
  });

  test("missing CLAUDE.md fails at error severity → report not ok", async () => {
    await compliantKit();
    await rm(join(dir, "CLAUDE.md"));
    const r = await run();
    expect(byId(r, "claude-md").ok).toBe(false);
    expect(byId(r, "claude-md").severity).toBe("error");
    expect(r.ok).toBe(false);
  });

  test("AGENTS.md as a real file (not a symlink) fails — a copy drifts", async () => {
    await compliantKit();
    await rm(join(dir, "AGENTS.md"));
    await writeFile(join(dir, "AGENTS.md"), "# a copy");
    const r = await run();
    expect(byId(r, "agents-symlink").ok).toBe(false);
    expect(byId(r, "agents-symlink").detail).toContain("real file");
    expect(r.ok).toBe(false);
  });

  test("AGENTS.md missing entirely fails", async () => {
    await compliantKit();
    await rm(join(dir, "AGENTS.md"));
    const r = await run();
    expect(byId(r, "agents-symlink").ok).toBe(false);
    expect(byId(r, "agents-symlink").detail).toContain("missing");
    expect(r.ok).toBe(false);
  });

  test("AGENTS.md symlink with the right basename but pointing at another repo's CLAUDE.md fails", async () => {
    await compliantKit();
    await rm(join(dir, "AGENTS.md"));
    await symlink("../elsewhere/CLAUDE.md", join(dir, "AGENTS.md")); // right basename, wrong file
    const r = await run();
    expect(byId(r, "agents-symlink").ok).toBe(false);
    expect(r.ok).toBe(false);
  });

  test("a real canon-named file in standards/ is a fork → error", async () => {
    await compliantKit();
    await mkdir(join(dir, "standards"));
    await writeFile(join(dir, "standards", "VOICE.md"), "# forked");
    const r = await run();
    expect(byId(r, "no-forked-standards").ok).toBe(false);
    expect(byId(r, "no-forked-standards").detail).toContain("VOICE.md");
    expect(r.ok).toBe(false);
  });

  test("standardsSource: canon skips the fork check even with canon files present", async () => {
    await compliantKit();
    await mkdir(join(dir, "standards"));
    await writeFile(join(dir, "standards", "VOICE.md"), "# the real one");
    const r = await run({ standardsSource: "canon" });
    expect(byId(r, "no-forked-standards").severity).toBe("info");
    expect(byId(r, "no-forked-standards").ok).toBe(true);
    expect(r.ok).toBe(true);
  });

  test("a symlinked standard is not counted as a fork", async () => {
    await compliantKit();
    await mkdir(join(dir, "standards"));
    await symlink("../CLAUDE.md", join(dir, "standards", "AI-DEVELOPMENT.md")); // a pointer, not a copy
    const r = await run();
    expect(byId(r, "no-forked-standards").ok).toBe(true);
  });

  test("missing plans/ fails", async () => {
    await compliantKit();
    await rm(join(dir, "plans"), { recursive: true });
    const r = await run();
    expect(byId(r, "plans-dir").ok).toBe(false);
    expect(r.ok).toBe(false);
  });

  test("missing pantry.config is a warn, not a failure", async () => {
    await compliantKit();
    await rm(join(dir, "pantry.config.json"));
    const r = await run();
    expect(byId(r, "pantry-config").ok).toBe(false);
    expect(byId(r, "pantry-config").severity).toBe("warn");
    expect(r.ok).toBe(true); // a warn never flips the report
  });
});

describe("pantry doctor — staleness (warn tier, surfaces but never fails CI)", () => {
  test("no AUDIT.md runbook → info, ok", async () => {
    await compliantKit();
    const r = await run();
    expect(byId(r, "audit-freshness").severity).toBe("info");
    expect(byId(r, "audit-freshness").ok).toBe(true);
  });

  test("AUDIT.md present but no dated report → warn, due, still exit-ok", async () => {
    await compliantKit();
    await writeFile(join(dir, "AUDIT.md"), "# runbook");
    const r = await run();
    const c = byId(r, "audit-freshness");
    expect(c.severity).toBe("warn");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("no dated audit report");
    expect(r.ok).toBe(true);
  });

  test("an overdue audit report warns but does not fail the report", async () => {
    await compliantKit();
    await writeFile(join(dir, "AUDIT.md"), "# runbook");
    const report = join(dir, "audit-2026-05.md");
    await writeFile(report, "# old audit");
    await setAge(report, 60);
    const r = await run({}, { auditMaxAgeDays: 30 });
    const c = byId(r, "audit-freshness");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("60 days old");
    expect(r.ok).toBe(true);
  });

  test("an audit report exactly at the max age is still fresh (<= boundary)", async () => {
    await compliantKit();
    await writeFile(join(dir, "AUDIT.md"), "# runbook");
    const report = join(dir, "audit-edge.md");
    await writeFile(report, "# edge");
    await setAge(report, 30);
    const r = await run({}, { auditMaxAgeDays: 30 });
    expect(byId(r, "audit-freshness").ok).toBe(true);
  });

  test("a fresh audit report passes the freshness check", async () => {
    await compliantKit();
    await writeFile(join(dir, "AUDIT.md"), "# runbook");
    const report = join(dir, "artifacts", "audit-latest.md");
    await mkdir(join(dir, "artifacts"));
    await writeFile(report, "# recent");
    await setAge(report, 3);
    const r = await run({}, { auditMaxAgeDays: 30 });
    const c = byId(r, "audit-freshness");
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("3 days old");
  });

  test("no graphify-out → info; a stale graph → warn", async () => {
    await compliantKit();
    const info = await run();
    expect(byId(info, "graphify-freshness").severity).toBe("info");

    const graph = join(dir, "graphify-out", "merged-graph.json");
    await mkdir(join(dir, "graphify-out"));
    await writeFile(graph, "{}");
    await setAge(graph, 90);
    const stale = await run({ graphPath: graph }, { graphMaxAgeDays: 30 });
    const c = byId(stale, "graphify-freshness");
    expect(c.severity).toBe("warn");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("90 days old");
    expect(stale.ok).toBe(true);
  });

  test("a fresh graphify-out passes the freshness check", async () => {
    await compliantKit();
    const graph = join(dir, "graphify-out", "graph.json");
    await mkdir(join(dir, "graphify-out"));
    await writeFile(graph, "{}");
    await setAge(graph, 5);
    const r = await run({ graphPath: graph }, { graphMaxAgeDays: 30 });
    expect(byId(r, "graphify-freshness").ok).toBe(true);
    expect(byId(r, "graphify-freshness").detail).toContain("5 days old");
  });

  test("a missing e2e suite warns", async () => {
    await compliantKit();
    await rm(join(dir, "e2e"), { recursive: true });
    const r = await run();
    const c = byId(r, "e2e-presence");
    expect(c.ok).toBe(false);
    expect(c.severity).toBe("warn");
    expect(r.ok).toBe(true);
  });

  test("a *.e2e.ts file at the root counts as an e2e suite", async () => {
    await compliantKit();
    await rm(join(dir, "e2e"), { recursive: true });
    await writeFile(join(dir, "smoke.e2e.ts"), "// test");
    const r = await run();
    expect(byId(r, "e2e-presence").ok).toBe(true);
  });
});

// The drift fold-in makes doctor the single CI entry point (PLAN.md 11a). These run the REAL lint
// through doctor (runDrift default on, no injected config → loadPantryConfig reads the host), so the
// check's id/severity and its effect on report.ok are covered end to end.
describe("pantry doctor — drift fold-in (the single CI entry point)", () => {
  test("clean host docs → doc-drift check passes at error severity, report ok", async () => {
    await compliantKit(); // no docs/ dir → only the bundled framework docs, which resolve clean
    const r = await runDoctor({ cwd: dir, now: NOW });
    const c = byId(r, "doc-drift");
    expect(c.severity).toBe("error");
    expect(c.ok).toBe(true);
    expect(r.ok).toBe(true);
  });

  test("a dead in-namespace link in a host doc fails doc-drift and flips report.ok", async () => {
    await compliantKit();
    await mkdir(join(dir, "docs"));
    await writeFile(join(dir, "docs", "guide.md"), "See [a gone plan](/plans/plan/nope).");
    await writeFile(join(dir, "pantry.config.json"), JSON.stringify({ docsDirs: ["./docs"] }) + "\n");
    const r = await runDoctor({ cwd: dir, now: NOW });
    const c = byId(r, "doc-drift");
    expect(c.severity).toBe("error");
    expect(c.ok).toBe(false);
    expect(r.ok).toBe(false); // an error-severity drift break fails the whole report
  });
});

describe("formatDoctorReport", () => {
  test("a compliant kit reads OK with a zero-failing tail", async () => {
    await compliantKit();
    const out = formatDoctorReport(await run());
    expect(out).toContain("0 failing");
    expect(out.trim().endsWith("OK")).toBe(true);
  });

  test("a broken kit reads FAIL and counts the failure", async () => {
    await compliantKit();
    await rm(join(dir, "CLAUDE.md"));
    const out = formatDoctorReport(await run());
    expect(out).toContain("[FAIL] CLAUDE.md present");
    expect(out.trim().endsWith("FAIL")).toBe(true);
  });
});
