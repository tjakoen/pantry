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
import type { GitRunner } from "./timeline.ts";

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
  graphDir: join(dir, "graphify-out"),
  decisionsDir: join(dir, "plans", "decisions"),
  artifactsDir: join(dir, "artifacts"),
  runsDir: join(dir, "artifacts", "runs"),
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true, decisions: true, artifacts: true, timeline: true, runs: true },
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
  runDoctor({ cwd: dir, now: NOW, config: cfg(over), runDrift: false, runDeps: false, ...more });

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

  // GRAPH_REPORT.md's "Built from commit" line, compared against an injected gitRunner's HEAD — never
  // real git, so these stay hermetic. The commit compare wins over the age check whenever both a report
  // and a git HEAD resolve; two of the tests below cover the fallback for when either does not.
  //
  // The double dispatches on args[0] exactly the way the check calls git (`rev-parse HEAD`, then, only
  // when behind HEAD, `diff --name-only <from>..HEAD`) — so each test states which git answer it is
  // exercising instead of one blanket response standing in for both calls.
  const fakeGraphifyGit = (head: string | null, diffOut: string | null): GitRunner => async (args) => {
    if (args[0] === "rev-parse") return head === null ? null : `${head}\n`;
    if (args[0] === "diff") return diffOut;
    return null;
  };

  test("graph built from HEAD's commit → ok, detail names HEAD (diff never needed)", async () => {
    await compliantKit();
    const graphDir = join(dir, "graphify-out");
    await mkdir(graphDir);
    const graph = join(graphDir, "graph.json");
    await writeFile(graph, "{}");
    await writeFile(join(graphDir, "GRAPH_REPORT.md"), "- Built from commit: `18017a67`\n");
    // at HEAD short-circuits before codeChangedSince ever runs, so a `diff` call here would be a bug —
    // give it something that would read as "code moved" if it were ever (wrongly) reached.
    const gitRunner = fakeGraphifyGit("18017a67", "doctor.ts\n");
    const r = await run({ graphPath: graph }, { gitRunner });
    const c = byId(r, "graphify-freshness");
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("HEAD");
    expect(c.detail).toContain("18017a67");
  });

  test("behind HEAD, a non-doc file moved → warn, not ok, \"code moved since\"", async () => {
    await compliantKit();
    const graphDir = join(dir, "graphify-out");
    await mkdir(graphDir);
    const graph = join(graphDir, "graph.json");
    await writeFile(graph, "{}");
    await writeFile(join(graphDir, "GRAPH_REPORT.md"), "- Built from commit: `18017a67`\n");
    const gitRunner = fakeGraphifyGit("deadbeef", "doctor.ts\n");
    const r = await run({ graphPath: graph }, { gitRunner });
    const c = byId(r, "graphify-freshness");
    expect(c.ok).toBe(false);
    expect(c.severity).toBe("warn");
    expect(c.detail).toContain("code moved since");
  });

  test("behind HEAD, only a doc file changed → ok, \"docs only, graph still current\"", async () => {
    await compliantKit();
    const graphDir = join(dir, "graphify-out");
    await mkdir(graphDir);
    const graph = join(graphDir, "graph.json");
    await writeFile(graph, "{}");
    await writeFile(join(graphDir, "GRAPH_REPORT.md"), "- Built from commit: `18017a67`\n");
    // the live false positive this branch exists to fix: the graph was current, the only churn since
    // was a plan doc, and the old mismatch-is-stale check would have warned anyway.
    const gitRunner = fakeGraphifyGit("deadbeef", "plans/skills-runtime.md\n");
    const r = await run({ graphPath: graph }, { gitRunner });
    const c = byId(r, "graphify-freshness");
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("docs only");
  });

  test("behind HEAD, a mix of doc and code files changed → not ok (one code file is enough)", async () => {
    await compliantKit();
    const graphDir = join(dir, "graphify-out");
    await mkdir(graphDir);
    const graph = join(graphDir, "graph.json");
    await writeFile(graph, "{}");
    await writeFile(join(graphDir, "GRAPH_REPORT.md"), "- Built from commit: `18017a67`\n");
    const gitRunner = fakeGraphifyGit("deadbeef", "README.md\ndrift.ts\n");
    const r = await run({ graphPath: graph }, { gitRunner });
    const c = byId(r, "graphify-freshness");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("code moved since");
  });

  test("behind HEAD, diff returns no files at all → ok, docs-only wording", async () => {
    await compliantKit();
    const graphDir = join(dir, "graphify-out");
    await mkdir(graphDir);
    const graph = join(graphDir, "graph.json");
    await writeFile(graph, "{}");
    await writeFile(join(graphDir, "GRAPH_REPORT.md"), "- Built from commit: `18017a67`\n");
    const gitRunner = fakeGraphifyGit("deadbeef", "");
    const r = await run({ graphPath: graph }, { gitRunner });
    const c = byId(r, "graphify-freshness");
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("docs only");
  });

  test("behind HEAD, diff resolves null (commit unreachable, e.g. after a history rewrite) → not ok, \"unreachable\"", async () => {
    await compliantKit();
    const graphDir = join(dir, "graphify-out");
    await mkdir(graphDir);
    const graph = join(graphDir, "graph.json");
    await writeFile(graph, "{}");
    await writeFile(join(graphDir, "GRAPH_REPORT.md"), "- Built from commit: `18017a67`\n");
    const gitRunner = fakeGraphifyGit("deadbeef", null);
    const r = await run({ graphPath: graph }, { gitRunner });
    const c = byId(r, "graphify-freshness");
    expect(c.ok).toBe(false);
    expect(c.severity).toBe("warn");
    expect(c.detail).toContain("unreachable");
  });

  test("an abbreviated report sha matches a full HEAD sha it's a prefix of → ok", async () => {
    await compliantKit();
    const graphDir = join(dir, "graphify-out");
    await mkdir(graphDir);
    const graph = join(graphDir, "graph.json");
    await writeFile(graph, "{}");
    await writeFile(join(graphDir, "GRAPH_REPORT.md"), "- Built from commit: `18017a67`\n"); // 8-char abbrev
    // full 40-char HEAD that starts with the abbreviated report sha; diff should never be reached.
    const gitRunner = fakeGraphifyGit("18017a67abcdef0123456789abcdef0123456789", "doctor.ts\n");
    const r = await run({ graphPath: graph }, { gitRunner });
    const c = byId(r, "graphify-freshness");
    expect(c.ok).toBe(true);
  });

  test("no GRAPH_REPORT.md → falls back to the age check, even with a resolvable HEAD", async () => {
    await compliantKit();
    const graphDir = join(dir, "graphify-out");
    await mkdir(graphDir);
    const graph = join(graphDir, "graph.json");
    await writeFile(graph, "{}");
    await setAge(graph, 5);
    const gitRunner = fakeGraphifyGit("18017a67", "doctor.ts\n");
    const r = await run({ graphPath: graph }, { graphMaxAgeDays: 30, gitRunner });
    const c = byId(r, "graphify-freshness");
    expect(c.detail).toContain("5 days old");
    expect(c.detail).not.toContain("graph built from");
  });

  test("gitRunner resolves null (git absent / not a repo) → falls back to the age check", async () => {
    await compliantKit();
    const graphDir = join(dir, "graphify-out");
    await mkdir(graphDir);
    const graph = join(graphDir, "graph.json");
    await writeFile(graph, "{}");
    await writeFile(join(graphDir, "GRAPH_REPORT.md"), "- Built from commit: `18017a67`\n");
    await setAge(graph, 5);
    const gitRunner = fakeGraphifyGit(null, null);
    const r = await run({ graphPath: graph }, { graphMaxAgeDays: 30, gitRunner });
    const c = byId(r, "graphify-freshness");
    expect(c.detail).toContain("5 days old");
    expect(c.detail).not.toContain("graph built from");
  });

  // The merged graph is a SEPARATE artifact with no report of its own: `GRAPH_REPORT.md` describes the
  // extraction that wrote `graph.json`, while `resolveGraphPath` prefers `merged-graph.json`. So the
  // commit compare can pass honestly about a file nothing reads. Found by review and reproduced live:
  // the portfolio's edit hook re-extracted `graph.json` three minutes after a merge, and doctor went on
  // reporting "built from HEAD" while the stale merged graph was what the symbol lint consumed.
  //
  // `setAge` moves mtimes relative to the injected NOW, so "the merge is older than the extraction" is
  // expressed as a larger age in days rather than by touching real clocks.
  const bothGraphs = async (mergedAgeDays: number, ownAgeDays: number, reportSha: string | null) => {
    await compliantKit();
    const graphDir = join(dir, "graphify-out");
    await mkdir(graphDir);
    const merged = join(graphDir, "merged-graph.json");
    const own = join(graphDir, "graph.json");
    await writeFile(merged, "{}");
    await writeFile(own, "{}");
    await setAge(merged, mergedAgeDays);
    await setAge(own, ownAgeDays);
    if (reportSha) await writeFile(join(graphDir, "GRAPH_REPORT.md"), `- Built from commit: \`${reportSha}\`\n`);
    return { merged, own };
  };

  test("merged graph older than the extraction → warn, even when the report's commit IS HEAD", async () => {
    // The exact reproduction. Before the fix this returned ok with "graph built from HEAD (18017a67)",
    // so the detail is asserted too — `ok` alone would not have caught it.
    const { merged } = await bothGraphs(5, 1, "18017a67");
    const gitRunner = fakeGraphifyGit("18017a67", "doctor.ts\n");
    const r = await run({ graphPath: merged }, { gitRunner });
    const c = byId(r, "graphify-freshness");
    expect(c.ok).toBe(false);
    expect(c.severity).toBe("warn");
    expect(c.detail).toContain("predates");
    expect(c.detail).not.toContain("built from HEAD");
  });

  test("merged graph newer than the extraction → falls through to the commit compare", async () => {
    const { merged } = await bothGraphs(1, 5, "18017a67");
    const gitRunner = fakeGraphifyGit("18017a67", "doctor.ts\n");
    const r = await run({ graphPath: merged }, { gitRunner });
    const c = byId(r, "graphify-freshness");
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("built from HEAD");
    expect(c.detail).not.toContain("predates");
  });

  test("merged graph with no graph.json beside it → nothing to compare, no stale-merge warn", async () => {
    await compliantKit();
    const graphDir = join(dir, "graphify-out");
    await mkdir(graphDir);
    const merged = join(graphDir, "merged-graph.json");
    await writeFile(merged, "{}");
    await writeFile(join(graphDir, "GRAPH_REPORT.md"), "- Built from commit: `18017a67`\n");
    const gitRunner = fakeGraphifyGit("18017a67", "doctor.ts\n");
    const r = await run({ graphPath: merged }, { gitRunner });
    const c = byId(r, "graphify-freshness");
    expect(c.ok).toBe(true);
    expect(c.detail).not.toContain("predates");
  });

  test("graphPath is graph.json → the stale-merge rule never applies, however old the merge is", async () => {
    const { own } = await bothGraphs(90, 1, "18017a67");
    const gitRunner = fakeGraphifyGit("18017a67", "doctor.ts\n");
    const r = await run({ graphPath: own }, { gitRunner });
    const c = byId(r, "graphify-freshness");
    expect(c.ok).toBe(true);
    expect(c.detail).not.toContain("predates");
  });

  test("a stale merge is reported even when git cannot answer at all", async () => {
    // The short-circuit runs ahead of the commit compare, so it must not depend on git resolving. This
    // pins that: without it, a stale merge on a machine with no git would silently take the age branch.
    const { merged } = await bothGraphs(5, 1, null);
    const gitRunner = fakeGraphifyGit(null, null);
    const r = await run({ graphPath: merged }, { graphMaxAgeDays: 30, gitRunner });
    const c = byId(r, "graphify-freshness");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("predates");
  });

  // The run ledger says a run grew past its scope; this says whether the graph saw it coming, which is
  // the actionable half. It reads the repo's OWN graph.json deliberately — the merged estate graph
  // relabels local files and reported every one of them as "outside any blast radius" on the first
  // live run, so the graph choice is pinned here rather than left to a comment.
  const runWithGrowth = async (graph: { nodes: unknown[]; links: unknown[] }) => {
    await compliantKit();
    const graphDir = join(dir, "graphify-out");
    await mkdir(graphDir, { recursive: true });
    await writeFile(join(graphDir, "graph.json"), JSON.stringify(graph));
    const runsDir = join(dir, "artifacts", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, "2026-01-01-grew.md"),
      ["---", "title: t", "date: 2026-01-01", "scope:", "  - a.ts", "touched:", "  - a.ts", "  - b.ts", "---", "## Gate output", "```", "ok", "```", "## What was not done", "## What needs human eyes"].join("\n"),
    );
    return run();
  };

  test("growth the graph already connected reads as predictable", async () => {
    const r = await runWithGrowth({
      nodes: [{ id: "a", label: "a.ts" }, { id: "b", label: "b.ts" }],
      links: [{ relation: "imports_from", source: "b", target: "a" }], // b.ts depends on a.ts
    });
    const c = byId(r, "scope-radius");
    expect(c.severity).toBe("info");
    expect(c.detail).toContain("all inside the declared scope's blast radius");
  });

  test("growth the graph does NOT connect is called out as surprising", async () => {
    const r = await runWithGrowth({
      nodes: [{ id: "a", label: "a.ts" }, { id: "b", label: "b.ts" }],
      links: [], // nothing links b.ts to a.ts
    });
    const c = byId(r, "scope-radius");
    expect(c.detail).toContain("outside any blast radius");
    expect(c.detail).toContain("b.ts");
  });

  test("no graph → the check says so instead of calling every file surprising", async () => {
    await compliantKit();
    const r = await run();
    const c = byId(r, "scope-radius");
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("no graph");
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

// The deps fold-in makes doctor the whole-stack control-plane surface too (a warn, never a gate). We
// build a temp monorepo — an umbrella host that pins a layer + a sibling layer source ahead of it —
// and assert the lagging pin surfaces as a warn WITHOUT flipping the report.
describe("pantry doctor — layer-pin drift fold-in (warn tier)", () => {
  test("a pin behind its sibling layer source surfaces as a warn, report stays ok", async () => {
    const monorepo = await mkdtemp(join(tmpdir(), "pantry-doctor-mono-"));
    const host = join(monorepo, "bread");
    try {
      await mkdir(host);
      await writeFile(join(host, "CLAUDE.md"), "# CLAUDE");
      await symlink("CLAUDE.md", join(host, "AGENTS.md"));
      await mkdir(join(host, "plans"));
      await writeFile(join(host, "pantry.config.json"), "{}\n");
      await mkdir(join(host, "e2e"));
      await writeFile(join(host, "package.json"), JSON.stringify({ devDependencies: { "@tjakoen/mill": "^0.1.2" } }));
      await mkdir(join(monorepo, "grain", "packages", "mill"), { recursive: true });
      await writeFile(join(monorepo, "grain", "packages", "mill", "package.json"), JSON.stringify({ version: "0.2.0" }));
      const r = await runDoctor({ cwd: host, now: NOW, runDrift: false, layersRoot: monorepo });
      const c = byId(r, "deps-drift");
      expect(c.severity).toBe("warn");
      expect(c.ok).toBe(false);
      expect(c.detail).toContain("mill 0.1.2<0.2.0");
      expect(r.ok).toBe(true); // a warn never flips the report
    } finally {
      await rm(monorepo, { recursive: true, force: true });
    }
  });

  test("a repo with no @tjakoen/* pins gets an info, not a warn", async () => {
    await compliantKit();
    const r = await runDoctor({ cwd: dir, now: NOW, config: cfg(), runDrift: false });
    const c = byId(r, "deps-drift");
    expect(c.severity).toBe("info");
    expect(c.ok).toBe(true);
  });
});

describe("pantry doctor — run-ledger evidence (11c, warn tier)", () => {
  const runsDir = () => join(dir, "artifacts", "runs");
  const writeRun = async (name: string, body: string) => {
    await mkdir(runsDir(), { recursive: true });
    await writeFile(join(runsDir(), name), body);
  };
  // The minimum that satisfies every LOOP §9 item; runs.test.ts owns the per-item cases.
  const COMPLETE_RUN = `---
date: 2026-07-26
scope:
  - doctor.ts
touched:
  - doctor.ts
diffstat: 1 file changed, 2 insertions(+)
unpushed: 0
verifiedBy: a reviewer that did not write it
doctor: 0 failing
---
## Gate output
\`\`\`
132 pass, 0 fail
\`\`\`
## What was not done
Nothing.
## What needs human eyes
Nothing.
`;

  test("a repo with no runs dir gets an info naming where a report goes, not a warn", async () => {
    await compliantKit();
    const c = byId(await run(), "run-report-evidence");
    expect(c.severity).toBe("info");
    expect(c.ok).toBe(true);
    expect(c.detail).toContain(runsDir());
  });

  test("reports that carry their evidence read as info", async () => {
    await compliantKit();
    await writeRun("2026-07-26-a.md", COMPLETE_RUN);
    const c = byId(await run(), "run-report-evidence");
    expect(c.severity).toBe("info");
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("1 run reports, all carry their evidence");
  });

  test("a report missing §9 evidence warns, names the gaps, and never fails CI", async () => {
    await compliantKit();
    await writeRun("2026-07-26-a.md", COMPLETE_RUN);
    await writeRun("2026-07-25-b.md", `---\ndate: 2026-07-25\ntitle: a thin report\n---\nIt went well.`);
    const r = await run();
    const c = byId(r, "run-report-evidence");
    expect(c.severity).toBe("warn");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("1 of 2 run reports missing evidence");
    expect(c.detail).toContain("2026-07-25-b");
    expect(c.detail).toContain("no diffstat");
    expect(r.ok).toBe(true); // a warn never flips the report
  });

  test("only the two most recent offenders are named in full, the rest are counted", async () => {
    await compliantKit();
    for (const d of ["2026-07-26", "2026-07-25", "2026-07-24"]) await writeRun(`${d}-x.md`, `---\ndate: ${d}\n---\nthin`);
    const c = byId(await run(), "run-report-evidence");
    expect(c.detail).toContain("2026-07-26-x");
    expect(c.detail).toContain("2026-07-25-x");
    expect(c.detail).not.toContain("2026-07-24-x");
    expect(c.detail).toContain("and 1 more");
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
