// pantry/paths.test.ts — the containment rule, once, against a real filesystem.
//
// These assertions used to live in capture.test.ts and covered a copy of the rule that four other
// call sites did not share. They are here now because the rule is here now, and because the two
// cases that actually bite — the prefix trick and the escaping symlink — are exactly the ones a
// hand-written copy gets right on Monday and a hand-written copy elsewhere does not.
//
// The symlink cases are built on disk rather than mocked: what is under test is whether `realpath`
// is consulted at all, and a mocked fs is a way to assert that the code calls the function you
// mocked instead of a way to assert that a link cannot escape.
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isInside, linkContained } from "./paths.ts";

describe("isInside — a containment check, not a prefix trick", () => {
  test("a real descendant, and the directory itself", () => {
    expect(isInside("/a/b", "/a/b/c")).toBe(true);
    expect(isInside("/a/b", "/a/b/c/d/e.png")).toBe(true);
    expect(isInside("/a/b", "/a/b")).toBe(true);
  });

  test("the classic: /a/bc starts with /a/b as a string and is nowhere near inside it", () => {
    expect(isInside("/a/b", "/a/bc")).toBe(false);
    expect(isInside("/a/b", "/a/b-sibling/x")).toBe(false);
  });

  test("a parent and an unrelated tree are outside", () => {
    expect(isInside("/a/b", "/a")).toBe(false);
    expect(isInside("/a/b", "/")).toBe(false);
    expect(isInside("/a/b", "/etc/passwd")).toBe(false);
  });

  test("traversal is normalised before the comparison, not after it", () => {
    expect(isInside("/a/b", "/a/b/../../etc/passwd")).toBe(false);
    expect(isInside("/a/b", "/a/b/c/../d")).toBe(true);       // still inside after the dots resolve
    expect(isInside("/a/b/", "/a/b/c")).toBe(true);           // a trailing separator on the base
  });

  // graph.ts's edge-repo exclusion is the reason this case matters rather than a completeness item.
  // Its old hand-written copy compared a bare `join(siblingsRoot, name)` against an ABSOLUTE edge
  // path, so a relative siblings root produced a relative `dir` that could never string-match, and
  // the "never touch edge" exclusion quietly did not fire. Both sides resolve against cwd now, which
  // is the same anchor `readdir` used to read the directory in the first place.
  test("a relative path is anchored to cwd, so it can be compared with an absolute one", () => {
    const cwd = process.cwd();
    expect(isInside(cwd, "some/nested/file.ts")).toBe(true);
    expect(isInside("some", join(cwd, "some", "nested", "file.ts"))).toBe(true);
    expect(isInside(cwd, "../a-sibling-of-cwd")).toBe(false);
    expect(isInside("./a", "./a/b")).toBe(true);
    expect(isInside("./a", "./ab")).toBe(false);              // the prefix trick, relative
  });

  test("the filesystem root contains everything and is not special-cased into a hole", () => {
    expect(isInside("/", "/anything/at/all")).toBe(true);
    expect(isInside("/", "/")).toBe(true);
  });

  // `resolve("")` is the current working directory, so an unset path threaded through as "" would
  // otherwise ask about cwd and get a confident answer. Pinned as a refusal, not left to be found.
  test("an empty argument is refused rather than resolved to the working directory", () => {
    expect(isInside("", process.cwd())).toBe(false);
    expect(isInside(process.cwd(), "")).toBe(false);
    expect(isInside("", "")).toBe(false);
    // The proof that this is a refusal and not an accident of the comparison: the same two paths,
    // spelled out, ARE contained.
    expect(isInside(process.cwd(), process.cwd())).toBe(true);
  });
});

describe("the contract isInside states about symlinks, proved rather than promised", () => {
  let base: string;
  let realBase: string;
  let outside: string;
  // Every path below is built off realBase, never off `base`. On macOS the two differ (/var is a
  // link to /private/var) and mixing them produces a "containment failure" that is really a
  // canonicalisation failure — the exact confusion the realBase contract exists to prevent.
  const at = (...p: string[]) => join(realBase, ...p);

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "pantry-paths-"));
    realBase = await realpath(base);                          // macOS /var -> /private/var
    outside = await realpath(await mkdtemp(join(tmpdir(), "pantry-outside-")));
    await writeFile(join(outside, "secret.md"), "not this project's evidence");
    await mkdir(at("sub"), { recursive: true });
    await writeFile(at("plain.md"), "# a real file");
    await writeFile(at("sub", "nested.md"), "# nested");
    await symlink(at("sub", "nested.md"), at("link-inside.md"));
    await symlink(join(outside, "secret.md"), at("link-escaping.md"));
    await symlink(at("no-such-file.md"), at("link-broken.md"));
    await symlink(outside, at("link-dir-escaping"));
    // A link TO the base, built here rather than borrowed from the platform's tmpdir layout. The
    // realBase half of the contract needs a non-canonical spelling of the base to test against, and
    // relying on macOS's /var -> /private/var means the test asserts nothing wherever that is not
    // true — a green that is a property of the CI image rather than of the code.
    await symlink(realBase, join(outside, "link-to-base"));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  // The reason linkContained exists at all: string containment says the escaping link is inside,
  // because the string IS inside. Everything the read side does depends on knowing that.
  test("isInside alone calls an escaping symlink contained — which is why callers realpath first", async () => {
    expect(isInside(realBase, at("link-escaping.md"))).toBe(true);
    expect(isInside(realBase, await realpath(at("link-escaping.md")))).toBe(false);
  });

  test("a symlink that stays inside is followed", async () => {
    expect(await linkContained(realBase, at("link-inside.md"))).toBe(true);
  });

  test("a symlink that escapes is refused — file and directory alike", async () => {
    expect(await linkContained(realBase, at("link-escaping.md"))).toBe(false);
    expect(await linkContained(realBase, at("link-dir-escaping"))).toBe(false);
  });

  test("a broken link and a path that is not there are uncontained, never a throw", async () => {
    expect(await linkContained(realBase, at("link-broken.md"))).toBe(false);
    expect(await linkContained(realBase, at("vanished.md"))).toBe(false);
  });

  // The `realBase` half of the contract, against a link this test built rather than one the platform
  // happened to provide: a dir reached through a symlink fails containment on entries that are
  // plainly inside it, which is what every caller here avoids by realpathing the dir once, up front.
  test("realBase must already be real, or the dir fails its own containment check", async () => {
    const linkedBase = join(outside, "link-to-base");
    expect(await realpath(linkedBase)).toBe(realBase);         // same directory, different spelling
    expect(await linkContained(linkedBase, at("link-inside.md"))).toBe(false);
    expect(await linkContained(realBase, at("link-inside.md"))).toBe(true);   // the only difference
  });

  // The passthrough branch, stated as the contract rather than as a happy path. A non-symlink comes
  // back contained WITHOUT a containment test — including one that is plainly outside the base. That
  // is only sound because both callers build the path from a readdir basename joined onto a dir
  // already known inside, and it is asserted here so that a future caller reading the docstring can
  // see what "the caller's half of the contract" costs if they skip it.
  test("a non-symlink is passed through uncontained — including one outside the base", async () => {
    expect(await linkContained(realBase, at("plain.md"))).toBe(true);
    expect(await linkContained(realBase, at("sub"))).toBe(true);
    expect(await linkContained(realBase, join(outside, "secret.md"))).toBe(true);
    // ...and isInside, which is what a caller with an untrusted path must use instead, says no.
    expect(isInside(realBase, join(outside, "secret.md"))).toBe(false);
  });
});
