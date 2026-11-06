import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCoverage, readCertificate, runGate, summarizeGate, verify } from "./certify.ts";

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

describe("the release gate on /control", () => {
  test("names a missing certificate instead of rendering empty tiles", async () => {
    const { gateSection } = await import("./control-page.ts");
    const html = gateSection({ recorded: false, open: false, head: "abc", problems: [], full: null, since: 0, checked: 0, anchored: false, coverageFloor: null }, new Date());
    expect(html).toContain("No full run is on record");
  });

  test("a closed gate shows its first reason in the verdict tile and the rest below", async () => {
    const { gateSection } = await import("./control-page.ts");
    const html = gateSection({
      recorded: true, open: false, head: "1234567890", problems: ["first reason", "second reason"],
      full: { sha: "abcdef1234", at: new Date().toISOString(), ok: false, coverage: 60 }, since: 2, checked: 1, anchored: true, coverageFloor: null,
    }, new Date());
    expect(html).toContain('data-open="false"');
    expect(html).toContain("first reason");
    expect(html).toContain("<li>second reason</li>");
    expect(html).toContain("1 of 2");
    expect(html).toContain("60% on a red run");
  });

  test("summarizeGate reads a real repo", () => {
    const dir = repo({ full: "true", check: "true" });
    runGate(dir, "full");
    commit(dir, "two");
    const s = summarizeGate(dir)!;
    expect(s.open).toBe(false);
    expect(s.since).toBe(1);
    expect(s.checked).toBe(0);
  });
});

describe("a squash merge keeps the certificate", () => {
  const sh = (dir: string, cmd: string) => Bun.spawnSync(["sh", "-c", cmd], { cwd: dir });

  test("a full run on a branch tip vouches for its squash on main", () => {
    const dir = repo({ full: "true", check: "true" });
    sh(dir, "git branch -M main && git switch -q -c feature && echo a > a && git add a && git commit -qm a && echo b >> a && git commit -qam b");
    expect(runGate(dir, "full").run.ok).toBe(true);
    sh(dir, "git switch -q main && git merge -q --squash feature && git commit -qm squashed");
    expect(verify(dir).ok).toBe(true);
    expect(summarizeGate(dir)!.anchored).toBe(true);
  });

  test("different code on main does not ride on the branch's certificate", () => {
    const dir = repo({ full: "true", check: "true" });
    sh(dir, "git branch -M main && git switch -q -c feature && echo a > a && git add a && git commit -qm a");
    runGate(dir, "full");
    sh(dir, "git switch -q main && echo other > o && git add o && git commit -qm other");
    const v = verify(dir);
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toContain("nor its code");
    expect(summarizeGate(dir)!.anchored).toBe(false);
  });

  test("an unanchored gate shows no ring", async () => {
    const { gateSection } = await import("./control-page.ts");
    const html = gateSection({ recorded: true, open: false, head: "1234567", problems: ["x"], full: { sha: "abcdef1", at: new Date().toISOString(), ok: true }, since: 0, checked: 0, anchored: false, coverageFloor: null }, new Date());
    expect(html).not.toContain("pantry-gate__ring");
    expect(html).toContain("not in this branch's history");
  });
});
