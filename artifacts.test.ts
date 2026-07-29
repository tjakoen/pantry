// pantry/artifacts.test.ts — piece 11e sub-unit 1 data layer. Assert the walk (flat + nested runs),
// kind classification, the README/dotfile skip, the graceful degradations (absent dir, unreadable
// entry), and the newest-first sort. Pure reads against a real temp artifacts dir.
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArtifactsPayload, classifyArtifact, type ArtifactKind } from "./artifacts.ts";

const AT = "2026-07-29T00:00:00.000Z";

let dir: string; // the artifacts dir
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pantry-artifacts-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const build = () => buildArtifactsPayload({ projectName: "t", artifactsDir: dir }, AT);
const write = (relPath: string, body = "x") => writeFile(join(dir, relPath), body);
// Set an explicit mtime so newest-first ordering is deterministic instead of racing the filesystem's
// timestamp resolution when two files are written in the same test.
const touch = (relPath: string, when: string) => utimes(join(dir, relPath), new Date(when), new Date(when));

describe("buildArtifactsPayload — flat layout", () => {
  test("lists files, newest mtime first", async () => {
    await write("old.png");
    await touch("old.png", "2026-07-01T00:00:00.000Z");
    await write("new.png");
    await touch("new.png", "2026-07-20T00:00:00.000Z");
    const p = await build();
    expect(p.available).toBe(true);
    expect(p.count).toBe(2);
    expect(p.artifacts.map((a) => a.name)).toEqual(["new.png", "old.png"]);
    expect(p.artifacts[0].relPath).toBe("new.png");
  });

  test("ties on mtime break by relPath", async () => {
    await write("b.txt");
    await touch("b.txt", "2026-07-10T00:00:00.000Z");
    await write("a.txt");
    await touch("a.txt", "2026-07-10T00:00:00.000Z");
    const p = await build();
    expect(p.artifacts.map((a) => a.name)).toEqual(["a.txt", "b.txt"]);
  });

  test("size + mtime are read from real fs stat, not the injected generatedAt", async () => {
    await write("report.md", "hello world");
    const p = await build();
    const a = p.artifacts[0];
    expect(a.size).toBe("hello world".length);
    expect(a.mtime).not.toBe(AT);
    expect(new Date(a.mtime).toString()).not.toBe("Invalid Date");
  });
});

describe("buildArtifactsPayload — nested per-run layout", () => {
  test("a per-run subdir is walked", async () => {
    await mkdir(join(dir, "run-1"));
    await write("run-1/screenshot.png");
    await mkdir(join(dir, "run-1", "nested"));
    await write("run-1/nested/deep.log");
    const p = await build();
    expect(p.artifacts.map((a) => a.relPath).sort()).toEqual(["run-1/nested/deep.log", "run-1/screenshot.png"]);
  });

  test("depth beyond the bound is not descended", async () => {
    // 6 levels deep — past the documented MAX_DEPTH of 4
    const deep = join("d1", "d2", "d3", "d4", "d5", "d6");
    await mkdir(join(dir, deep), { recursive: true });
    await write(join(deep, "too-deep.txt"));
    await write("shallow.txt");
    const p = await build();
    expect(p.artifacts.map((a) => a.name)).toEqual(["shallow.txt"]);
  });
});

describe("classifyArtifact — kind by extension", () => {
  const cases: [string, ArtifactKind][] = [
    ["shot.png", "image"], ["shot.jpg", "image"], ["shot.jpeg", "image"], ["shot.gif", "image"],
    ["shot.webp", "image"], ["shot.svg", "image"], ["shot.avif", "image"],
    ["page.html", "html"], ["page.htm", "html"],
    ["change.diff", "diff"], ["change.patch", "diff"],
    ["notes.md", "report"], ["notes.txt", "report"], ["data.json", "report"], ["run.log", "report"], ["table.csv", "report"],
    ["archive.zip", "other"], ["noext", "other"],
  ];
  test.each(cases)("%s → %s", (name, kind) => {
    expect(classifyArtifact(name)).toBe(kind);
  });
});

describe("buildArtifactsPayload — skips", () => {
  test("top-level README.md and dotfiles are skipped", async () => {
    await write("README.md", "# how to drop artifacts here");
    await write(".DS_Store", "junk");
    await mkdir(join(dir, ".git"));
    await write(".git/config", "junk");
    await write("real.png");
    const p = await build();
    expect(p.artifacts.map((a) => a.name)).toEqual(["real.png"]);
  });

  test("a nested README.md (per-run evidence, not the dir's own doc) is kept", async () => {
    await mkdir(join(dir, "run-1"));
    await write("run-1/README.md", "run notes");
    const p = await build();
    expect(p.artifacts.map((a) => a.relPath)).toEqual(["run-1/README.md"]);
  });
});

describe("buildArtifactsPayload — degradations", () => {
  test("an absent dir → available:false, empty list, no throw", async () => {
    const p = await buildArtifactsPayload({ projectName: "t", artifactsDir: join(dir, "nope") }, AT);
    expect(p.available).toBe(false);
    expect(p.artifacts).toEqual([]);
    expect(p.count).toBe(0);
  });

  test("an empty dir is available with zero artifacts (the healthy just-scaffolded state)", async () => {
    const p = await build();
    expect(p.available).toBe(true);
    expect(p.artifacts).toEqual([]);
    expect(p.count).toBe(0);
  });

  test("a broken symlink is skipped without crashing the walk", async () => {
    await write("ok.png");
    try {
      await symlink(join(dir, "does-not-exist"), join(dir, "broken-link.png"));
    } catch {
      // symlink creation can fail under sandboxing on some CI hosts — the assertion below still
      // holds either way (ok.png is present); skip silently if we can't set up the fixture.
    }
    const p = await build();
    expect(p.artifacts.map((a) => a.name)).toContain("ok.png");
    expect(p.artifacts.every((a) => a.name !== "broken-link.png")).toBe(true);
  });

  test("SECURITY: a symlink escaping artifactsDir is NOT listed (no outside metadata leak)", async () => {
    // a secret tree OUTSIDE the artifacts dir; a symlink under artifacts points at it
    const secretDir = await mkdtemp(join(tmpdir(), "pantry-artifacts-secret-"));
    await writeFile(join(secretDir, "passwd-like.txt"), "root:x:0:0");
    await write("inside.txt");
    let linked = true;
    try {
      await symlink(secretDir, join(dir, "escape")); // artifacts/escape -> /outside/secret
    } catch {
      linked = false; // sandboxed host can't make the link — the assertion below is vacuously safe
    }
    try {
      const p = await build();
      // the real file inside is listed…
      expect(p.artifacts.map((a) => a.relPath)).toContain("inside.txt");
      // …but NOTHING from the escaped tree is (no name, size, or mtime crosses the boundary)
      expect(p.artifacts.every((a) => !a.relPath.startsWith("escape"))).toBe(true);
      expect(p.artifacts.every((a) => a.name !== "passwd-like.txt")).toBe(true);
      if (linked) expect(p.artifacts.map((a) => a.relPath)).toEqual(["inside.txt"]);
    } finally {
      await rm(secretDir, { recursive: true, force: true });
    }
  });

  test("a symlink pointing INSIDE artifactsDir is still followed (matches raw-serve semantics)", async () => {
    await mkdir(join(dir, "real"));
    await write("real/evidence.png");
    let linked = true;
    try {
      await symlink(join(dir, "real"), join(dir, "alias")); // artifacts/alias -> artifacts/real (inside)
    } catch {
      linked = false;
    }
    const p = await build();
    expect(p.artifacts.map((a) => a.relPath)).toContain("real/evidence.png");
    // when the in-bounds link was created, its dereferenced file is listed too
    if (linked) expect(p.artifacts.some((a) => a.relPath === "alias/evidence.png")).toBe(true);
  });
});

describe("buildArtifactsPayload — echoed dir", () => {
  test("dir is echoed verbatim for empty-state guidance", async () => {
    const p = await build();
    expect(p.dir).toBe(dir);
  });
});
