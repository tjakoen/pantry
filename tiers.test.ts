import { test, expect, describe } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTiers, hubCheck, mcpRegistrations, planSchemaProblems, tierOf, CHECK_TIERS } from "./tiers.ts";
import { runDoctor, formatDoctorReport } from "./doctor.ts";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const check = (id: string, severity: "error" | "warn" | "info", ok: boolean) => ({ id, severity, ok, label: id, detail: "d" });

describe("tier ceilings", () => {
  test("tier 1 keeps its error and fails", () => {
    const [c] = applyTiers([check("plans-dir", "error", false)], false);
    expect(c.tier).toBe(1);
    expect(c.severity).toBe("error");
    expect(c.silenced).toBeUndefined();
  });
  test("a broken tier 2 check warns with a doc link instead of failing", () => {
    const [c] = applyTiers([check("claude-md", "error", false)], false);
    expect(c.tier).toBe(2);
    expect(c.severity).toBe("warn");
    expect(c.detail).toContain("docs/WORKFLOW.md#tier-2-the-loop");
  });
  test("tier 3 is silent unless the host opts in", () => {
    expect(applyTiers([check("run-report-presence", "warn", false)], false)[0].silenced).toBe(true);
    const [c] = applyTiers([check("run-report-presence", "warn", false)], true);
    expect(c.silenced).toBeUndefined();
    expect(c.tier).toBe(3);
  });
  test("an opted-in host keeps every check at its written severity", () => {
    expect(applyTiers([check("claude-md", "error", false)], true)[0].severity).toBe("error");
  });
  test("an unknown check id defaults to tier 3, quiet for strangers", () => {
    expect(tierOf("something-new")).toBe(3);
    expect(Object.values(CHECK_TIERS).filter((t) => t === 1).length).toBe(3);
  });
});

describe("tier 1 checks", () => {
  test("plan schema problems name the file and the field", () => {
    const dir = tmp("pantry-tiers-plans-");
    writeFileSync(join(dir, "README.md"), "# not a plan\n");
    writeFileSync(join(dir, "good.md"), "---\nid: good\nstatus: todo\ndepends: []\nowner: ai\n---\n# Good\n");
    writeFileSync(join(dir, "bad.md"), "---\nid: other\nstatus: maybe\n---\n# Bad\n");
    writeFileSync(join(dir, "bare.md"), "# no frontmatter\n");
    const problems = planSchemaProblems(dir);
    expect(problems).toContain("bare.md: no frontmatter");
    expect(problems).toContain("bad.md: id other is not the filename");
    expect(problems).toContain("bad.md: status maybe");
    expect(problems).toContain("bad.md: owner missing");
    expect(problems.some((p) => p.startsWith("good.md"))).toBe(false);
  });
  test("MCP registration is found in .mcp.json, Claude Code and Codex", () => {
    const cwd = tmp("pantry-tiers-cwd-");
    const home = tmp("pantry-tiers-home-");
    expect(mcpRegistrations(cwd, home)).toEqual([]);
    writeFileSync(join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { pantry: { url: "x" } } }));
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ projects: { [cwd]: { mcpServers: { pantry: {} } } } }));
    mkdirSync(join(home, ".codex"));
    writeFileSync(join(home, ".codex", "config.toml"), "[mcp_servers.pantry]\nurl = \"x\"\n");
    expect(mcpRegistrations(cwd, home)).toEqual([".mcp.json", "Claude Code", "Codex"]);
  });
  test("the hub check warns, never fails, when the project is not registered", () => {
    const c = hubCheck(tmp("pantry-tiers-hub-"), join(tmp("pantry-tiers-reg-"), "projects.json"));
    expect(c.ok).toBe(false);
    expect(c.severity).toBe("warn");
    expect(c.detail).toContain("pantry register");
  });
});

describe("a stranger's repo end to end", () => {
  test("a bare repo with only plans/ fails on the missing MCP server alone, and prints no owner-layer rows", async () => {
    const cwd = tmp("pantry-tiers-stranger-");
    mkdirSync(join(cwd, "plans"));
    writeFileSync(join(cwd, "plans", "first.md"), "---\nid: first\nstatus: todo\ndepends: []\nowner: ai\n---\n# First\n");
    const home = tmp("pantry-tiers-stranger-home-");
    const r = await runDoctor({ cwd, home, registryFile: join(home, "projects.json"), runDrift: false, runDeps: false, runContext: false, runSkills: false, runSymbols: false });
    const failing = r.checks.filter((c) => !c.ok && !c.silenced && c.severity === "error").map((c) => c.id);
    expect(failing).toEqual(["mcp-registered"]);
    const out = formatDoctorReport(r);
    expect(out).not.toContain("run reports keeping up");
    expect(out).toContain("owner-layer check(s) silent");
    expect(r.ok).toBe(false);
  });
});
