// pantry/deps.test.ts — the control-plane pin-drift tier. The pure core (checkDeps) is asserted
// against injected maps for every state (current/behind/ahead/unknown); the fs edge (readPins +
// resolveLayerVersions) is asserted against a real temp monorepo layout so the sibling-path map and
// the graceful-null degradation are both covered end to end.
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parsePinned,
  compareVersions,
  checkDeps,
  readPins,
  resolveLayerVersions,
  checkPantryDeps,
  formatDepsReport,
} from "./deps.ts";

describe("parsePinned", () => {
  test("strips caret/tilde/equals/v and returns the plain version", () => {
    expect(parsePinned("^0.1.8")).toBe("0.1.8");
    expect(parsePinned("~1.2.3")).toBe("1.2.3");
    expect(parsePinned("=2.0.0")).toBe("2.0.0");
    expect(parsePinned("v0.1.2")).toBe("0.1.2");
    expect(parsePinned("0.2.0")).toBe("0.2.0");
  });

  test("a non-version range (git dep, star, compound) is null", () => {
    expect(parsePinned("github:tjakoen/pantry#f17eddf")).toBeNull();
    expect(parsePinned("*")).toBeNull();
    expect(parsePinned("workspace:*")).toBeNull();
    expect(parsePinned(">=1.0.0 <2.0.0")).toBeNull();
  });
});

describe("compareVersions", () => {
  test("orders by numeric major.minor.patch", () => {
    expect(compareVersions("0.1.8", "0.1.12")).toBe(-1); // 8 < 12 numerically, not lexically
    expect(compareVersions("0.2.0", "0.1.2")).toBe(1);
    expect(compareVersions("0.1.2", "0.1.2")).toBe(0);
  });

  test("ignores prerelease/build metadata", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(0);
  });
});

describe("checkDeps (pure core)", () => {
  test("a pin behind its source is BEHIND and flips ok", () => {
    const r = checkDeps({ "@tjakoen/mill": "^0.1.2" }, { "@tjakoen/mill": "0.2.0" });
    expect(r.deps[0].state).toBe("behind");
    expect(r.behind).toBe(1);
    expect(r.ok).toBe(false);
  });

  test("a matching pin is current and ok", () => {
    const r = checkDeps({ "@tjakoen/proof": "^0.1.2" }, { "@tjakoen/proof": "0.1.2" });
    expect(r.deps[0].state).toBe("current");
    expect(r.ok).toBe(true);
  });

  test("a pin ahead of source does not flip ok (source unpublished)", () => {
    const r = checkDeps({ "@tjakoen/grain": "^0.2.0" }, { "@tjakoen/grain": "0.1.12" });
    expect(r.deps[0].state).toBe("ahead");
    expect(r.ok).toBe(true);
  });

  test("a git-dep pin is unknown, never behind", () => {
    const r = checkDeps({ "@tjakoen/pantry": "github:tjakoen/pantry#f17eddf" }, {});
    expect(r.deps[0].state).toBe("unknown");
    expect(r.ok).toBe(true);
  });

  test("an unresolved source is unknown, not behind", () => {
    const r = checkDeps({ "@tjakoen/crumb": "^0.1.3" }, { "@tjakoen/crumb": null });
    expect(r.deps[0].state).toBe("unknown");
    expect(r.ok).toBe(true);
  });

  test("deps come back sorted by name and count behinds across the set", () => {
    const r = checkDeps(
      { "@tjakoen/mill": "^0.1.2", "@tjakoen/batch": "^0.1.0", "@tjakoen/grain": "^0.1.8" },
      { "@tjakoen/mill": "0.2.0", "@tjakoen/batch": "0.1.0", "@tjakoen/grain": "0.1.12" },
    );
    expect(r.deps.map((d) => d.name)).toEqual(["@tjakoen/batch", "@tjakoen/grain", "@tjakoen/mill"]);
    expect(r.behind).toBe(2); // grain + mill lag; batch is current
    expect(r.ok).toBe(false);
  });
});

describe("readPins + resolveLayerVersions (fs edge)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pantry-deps-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("readPins collects @tjakoen/* from both dependency fields, ignoring the rest", async () => {
    const host = join(root, "host");
    await mkdir(host);
    await writeFile(
      join(host, "package.json"),
      JSON.stringify({
        dependencies: { "@tjakoen/grain": "^0.1.8", react: "^19.0.0" },
        devDependencies: { "@tjakoen/proof": "^0.1.2" },
      }),
    );
    const pins = await readPins(host);
    expect(pins).toEqual({ "@tjakoen/grain": "^0.1.8", "@tjakoen/proof": "^0.1.2" });
  });

  test("readPins returns {} when there is no package.json", async () => {
    expect(await readPins(join(root, "nope"))).toEqual({});
  });

  test("resolveLayerVersions reads the monorepo sibling layout and nulls what is missing", async () => {
    await mkdir(join(root, "batch"));
    await writeFile(join(root, "batch", "package.json"), JSON.stringify({ version: "0.1.0" }));
    await mkdir(join(root, "grain", "packages", "mill"), { recursive: true });
    await writeFile(join(root, "grain", "packages", "mill", "package.json"), JSON.stringify({ version: "0.2.0" }));
    const avail = await resolveLayerVersions(root);
    expect(avail["@tjakoen/batch"]).toBe("0.1.0");
    expect(avail["@tjakoen/mill"]).toBe("0.2.0");
    expect(avail["@tjakoen/grain"]).toBeNull(); // no grain package.json → null, not a throw
  });

  test("end to end: checkPantryDeps flags a lagging pin against the sibling source", async () => {
    const host = join(root, "bread");
    await mkdir(host);
    await writeFile(
      join(host, "package.json"),
      JSON.stringify({ devDependencies: { "@tjakoen/mill": "^0.1.2" } }),
    );
    await mkdir(join(root, "grain", "packages", "mill"), { recursive: true });
    await writeFile(join(root, "grain", "packages", "mill", "package.json"), JSON.stringify({ version: "0.2.0" }));
    const report = await checkPantryDeps({ cwd: host, layersRoot: root });
    expect(report.behind).toBe(1);
    expect(report.deps[0].state).toBe("behind");
    expect(report.ok).toBe(false);
  });
});

describe("formatDepsReport", () => {
  test("a drifting set reads DRIFT with a behind count; no backticks", () => {
    const out = formatDepsReport(checkDeps({ "@tjakoen/mill": "^0.1.2" }, { "@tjakoen/mill": "0.2.0" }));
    expect(out).toContain("[BEHIND] @tjakoen/mill");
    expect(out).toContain("1 pins, 1 behind");
    expect(out.trim().endsWith("DRIFT")).toBe(true);
    expect(out).not.toContain("`");
  });

  test("a clean set reads OK", () => {
    const out = formatDepsReport(checkDeps({ "@tjakoen/proof": "^0.1.2" }, { "@tjakoen/proof": "0.1.2" }));
    expect(out.trim().endsWith("OK")).toBe(true);
  });
});
