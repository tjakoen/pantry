import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCoverage, readCertificate, runGate, verify } from "./certify.ts";

function repo(gates: { full: string; check: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "pantry-certify-"));
  const sh = (cmd: string) => Bun.spawnSync(["sh", "-c", cmd], { cwd: dir });
  sh("git init -q && git config user.email t@t && git config user.name t");
  writeFileSync(join(dir, "pantry.config.json"), JSON.stringify({ gates }));
  sh("git add -A && git commit -qm one");
  return dir;
}
const commit = (dir: string, msg: string) =>
  Bun.spawnSync(["sh", "-c", `echo ${msg} >> f && git add f && git commit -qm ${msg}`], { cwd: dir });

setDefaultTimeout(30_000);

describe("release certificate", () => {
  test("no full run keeps the gate closed", () => {
    const dir = repo({ full: "true", check: "true" });
    expect(verify(dir).ok).toBe(false);
  });

  test("a green full run on HEAD opens it", () => {
    const dir = repo({ full: "true", check: "true" });
    expect(runGate(dir, "full").run.ok).toBe(true);
    expect(verify(dir).ok).toBe(true);
  });

  test("a commit after the full run needs its own green check", () => {
    const dir = repo({ full: "true", check: "true" });
    runGate(dir, "full");
    commit(dir, "two");
    const closed = verify(dir);
    expect(closed.ok).toBe(false);
    expect(closed.problems.join()).toContain("no green check");
    runGate(dir, "check");
    expect(verify(dir).ok).toBe(true);
  });

  test("a full run older than seven days closes it", () => {
    const dir = repo({ full: "true", check: "true" });
    runGate(dir, "full", new Date("2026-01-01T00:00:00Z"));
    expect(verify(dir, new Date("2026-01-09T00:00:00Z")).ok).toBe(false);
  });

  test("a red gate is recorded red", () => {
    const dir = repo({ full: "false", check: "true" });
    expect(runGate(dir, "full").run.ok).toBe(false);
    expect(verify(dir).ok).toBe(false);
  });

  test("a dirty tree earns nothing", () => {
    const dir = repo({ full: "true", check: "true" });
    writeFileSync(join(dir, "pantry.config.json"), "{}");
    const r = runGate(dir, "full");
    expect(r.run.ok).toBe(false);
    expect(r.reason).toContain("uncommitted");
  });

  test("coverage only goes up", () => {
    const table = (pct: number) => `echo 'All files | 90.00 | ${pct}.00 |'`;
    const dir = repo({ full: table(80), check: "true" });
    expect(runGate(dir, "full").run.ok).toBe(true);
    expect(readCertificate(dir).coverageFloor).toBe(80);
    writeFileSync(join(dir, "pantry.config.json"), JSON.stringify({ gates: { full: table(75), check: "true" } }));
    Bun.spawnSync(["sh", "-c", "git commit -qam lower"], { cwd: dir });
    const r = runGate(dir, "full");
    expect(r.run.ok).toBe(false);
    expect(r.reason).toContain("below the floor");
  });

  test("parses bun's coverage table", () => {
    expect(parseCoverage("File | % Funcs | % Lines\nAll files |   91.20 |   88.45 |")).toBe(88.45);
    expect(parseCoverage("no table")).toBeUndefined();
  });
});
