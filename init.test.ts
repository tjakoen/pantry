// pantry/init.test.ts — piece 11b: `pantry init --kit`. The load-bearing assertion is the plan's own
// acceptance test: after `--kit` on a bare repo, `pantry doctor` is GREEN (kit compliance passes). We
// also pin the non-invasive rule (a host's CLAUDE.md is never overwritten, even with --force) and the
// relative symlink target doctor's check resolves against. Drift is off in the doctor run (unit scope —
// no package resolution); it has its own suite.
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, symlink, readlink, lstat, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPantryInit } from "./init.ts";
import { runDoctor } from "./doctor.ts";
import type { ResolvedPantryConfig } from "./config.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pantry-init-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// A resolved config pointing doctor at the freshly-scaffolded host; drift off (no package resolution).
const doctorCfg = (): ResolvedPantryConfig => ({
  cwd: dir,
  projectName: "t",
  plansDir: join(dir, "plans"),
  docsDirs: [],
  graphPath: null,
  graphDir: join(dir, "graphify-out"),
  decisionsDir: join(dir, "plans", "decisions"), answersLog: join(dir, "plans", "decisions", "answers.jsonl"),
  artifactsDir: join(dir, "artifacts"),
  runsDir: join(dir, "artifacts", "runs"),
  previewTarget: null,
  previewCommand: null,
  previewCommandCwd: dir,
  toursDir: null,
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true, decisions: true, artifacts: true, timeline: true, runs: true },
});

const runDoctorHere = () => runDoctor({ cwd: dir, config: doctorCfg(), runDrift: false });

describe("pantry init --kit — the loop kit scaffold", () => {
  test("bare repo → kit written and `pantry doctor` is green (the acceptance test)", async () => {
    const result = await runPantryInit(dir, { kit: true });

    // the two kit files exist, CLAUDE.md seeded from the starter (non-empty), AGENTS is a symlink
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
    expect((await Bun.file(join(dir, "CLAUDE.md")).text()).length).toBeGreaterThan(0);
    expect((await lstat(join(dir, "AGENTS.md"))).isSymbolicLink()).toBe(true);
    expect(result.created).toContain("CLAUDE.md");

    // the plan's acceptance criterion: kit-compliance checks pass, report ok
    const r = await runDoctorHere();
    expect(r.checks.find((c) => c.id === "claude-md")!.ok).toBe(true);
    expect(r.checks.find((c) => c.id === "agents-symlink")!.ok).toBe(true);
    expect(r.checks.find((c) => c.id === "plans-dir")!.ok).toBe(true);
    expect(r.ok).toBe(true);
  });

  test("AGENTS symlink target is relative CLAUDE.md (what doctor resolves against)", async () => {
    await runPantryInit(dir, { kit: true });
    expect(await readlink(join(dir, "AGENTS.md"))).toBe("CLAUDE.md");
  });

  test("non-invasive: an existing host CLAUDE.md is never overwritten, even with --force", async () => {
    await writeFile(join(dir, "CLAUDE.md"), "# HOST OWN\n");
    const result = await runPantryInit(dir, { kit: true, force: true });

    expect(await Bun.file(join(dir, "CLAUDE.md")).text()).toBe("# HOST OWN\n");
    expect(result.skipped.some((s) => s.startsWith("CLAUDE.md"))).toBe(true);
    // ...but the AGENTS symlink is still added, pointing at the host's own file
    expect(await readlink(join(dir, "AGENTS.md"))).toBe("CLAUDE.md");
  });

  test("a dangling CLAUDE.md symlink is left as-is, never written through", async () => {
    await symlink("elsewhere/real-claude.md", join(dir, "CLAUDE.md")); // dangling: target absent
    const result = await runPantryInit(dir, { kit: true, force: true });

    // still a symlink to the same (missing) target — writeFile did NOT follow and create it
    expect((await lstat(join(dir, "CLAUDE.md"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(dir, "CLAUDE.md"))).toBe("elsewhere/real-claude.md");
    expect(existsSync(join(dir, "elsewhere/real-claude.md"))).toBe(false);
    expect(result.skipped.some((s) => s.startsWith("CLAUDE.md"))).toBe(true);
  });

  test("an existing AGENTS.md is left as-is, not clobbered", async () => {
    await symlink("somewhere-else.md", join(dir, "AGENTS.md")); // even a wrong/dangling one
    const result = await runPantryInit(dir, { kit: true });

    expect(await readlink(join(dir, "AGENTS.md"))).toBe("somewhere-else.md");
    expect(result.skipped.some((s) => s.startsWith("AGENTS.md"))).toBe(true);
  });

  test("without --kit, no CLAUDE.md or AGENTS is written (plain init unchanged)", async () => {
    const result = await runPantryInit(dir, {});
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    expect(result.created).toContain("pantry.config.json");
  });
});
