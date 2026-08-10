// pantry/fixtures.test.ts — the fixture's own guard, which is the only part of a fixture worth
// testing.
//
// `fixtures.ts` exists because of a green test suite that had stopped asking its question: three test
// files carried a sibling-checkout path to PROOF's example plans, PROOF folded into grain/packages,
// and the path resolved to nowhere. `loadPlans` returned an empty list, `buildIndex` built an empty
// index, and every assertion that only WALKED the corpus passed over nothing. The module's answer is
// a package-resolved path plus a throw at import time, and both halves are asserted here.
//
// The throw is exercised by running the real file — byte for byte, read off disk at test time — in a
// child process against a stand-in `@tjakoen/proof` whose example dir is missing or empty. A test
// that re-implemented the guard's condition inline would be a copy of exactly the kind this file's
// subject exists to warn about, and it would keep passing after someone deleted the real one.
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROOF_EXAMPLE } from "./fixtures.ts";

const plans = () => readdirSync(PROOF_EXAMPLE).filter((f) => f.endsWith(".md"));

describe("PROOF_EXAMPLE — resolved through the package, not through a checkout next door", () => {
  test("it points into the installed package", () => {
    expect(PROOF_EXAMPLE).toContain(join("node_modules", "@tjakoen", "proof"));
    expect(basename(PROOF_EXAMPLE)).toBe("example");
    expect(existsSync(PROOF_EXAMPLE)).toBe(true);
  });

  // The bug, named as a case rather than left in a comment: this is the path the three test files
  // used to carry, and it is the thing the module must not resolve to whether or not a `proof`
  // directory happens to be sitting there.
  test("it is not the sibling-checkout path the tests used to carry", () => {
    expect(PROOF_EXAMPLE).not.toBe(join(import.meta.dir, "..", "proof", "example"));
  });

  // Why the path is built from a file's dirname instead of asked for directly: `example/` is in
  // PROOF's published `files` but not in its `exports`, so it cannot be resolved as a subpath at all.
  // If a later PROOF release exports it, this test fails and the indirection can be deleted — which
  // is the useful thing for it to do.
  test("the example dir is unresolvable on its own, which is why PLAN.md is the entry", () => {
    expect(() => import.meta.resolve("@tjakoen/proof/example/004-mindmap.md")).toThrow();
    const entry = fileURLToPath(import.meta.resolve("@tjakoen/proof/PLAN.md"));
    expect(dirname(PROOF_EXAMPLE)).toBe(dirname(entry));
    expect(basename(entry)).toBe("PLAN.md");
  });
});

describe("the corpus — real plans, which is the entire reason it is not hand-written", () => {
  test("the guard's own condition holds: there is plan markdown in there", () => {
    expect(plans().length).toBeGreaterThan(0);
  });

  // The consuming suites (app, drift, retrieval, timeline) assert over PARSED plans — ids, statuses,
  // dependency edges, task counts. A dir of empty .md files would satisfy the guard's file count and
  // put those suites straight back to agreeing with nothing, so the shape they depend on is checked
  // here once rather than rediscovered as four confusing failures.
  test("every plan carries the frontmatter the consuming suites parse", async () => {
    for (const name of plans()) {
      const body = await readFile(join(PROOF_EXAMPLE, name), "utf8");
      expect(body.startsWith("---\n")).toBe(true);
      const frontmatter = body.slice(4, body.indexOf("\n---", 4));
      expect(frontmatter).toContain("id:");
      expect(frontmatter).toContain("status:");
      expect(frontmatter).toContain("depends:");
    }
  });

  test("the corpus spans more than one status and records at least one dependency edge", async () => {
    const bodies = await Promise.all(plans().map((n) => readFile(join(PROOF_EXAMPLE, n), "utf8")));
    const statuses = new Set(bodies.map((b) => b.match(/^status:\s*(\S+)/m)?.[1]));
    expect(statuses.size).toBeGreaterThan(1);
    expect(bodies.some((b) => /^depends:\s*\[[^\]]+\]/m.test(b))).toBe(true);
  });
});

describe("TEST-ONLY — never shipped, never imported by the server", () => {
  test("fixtures.ts is absent from package.json's files, so it cannot be published", async () => {
    const pkg = JSON.parse(await readFile(join(import.meta.dir, "package.json"), "utf8"));
    expect(pkg.files).toContain("config.ts");            // the control: shipped modules ARE listed
    expect(pkg.files).not.toContain("fixtures.ts");
  });

  // The other half of the same rule, and the half a `files` list cannot enforce: a shipped module
  // importing this one would resolve fine here and fail in every installed copy, because the file it
  // wants was never published.
  test("only test files import it", async () => {
    const importers: string[] = [];
    for (const name of readdirSync(import.meta.dir).filter((f) => f.endsWith(".ts"))) {
      if (name === "fixtures.ts") continue;
      const body = await readFile(join(import.meta.dir, name), "utf8");
      if (/from\s+"\.\/fixtures\.ts"/.test(body)) importers.push(name);
    }
    expect(importers.length).toBeGreaterThan(0);          // otherwise this test asserts nothing
    expect(importers.filter((f) => !f.endsWith(".test.ts"))).toEqual([]);
  });
});

// The guard, run for real. Each case installs a stand-in @tjakoen/proof next to a copy of the real
// fixtures.ts and imports it in a child process, so what is exercised is the module's actual
// resolution and its actual throw — not a restatement of either.
describe("the guard — an empty or missing corpus is a failure, not a quiet pass", () => {
  let source: string;
  const made: string[] = [];

  beforeAll(async () => {
    source = await readFile(join(import.meta.dir, "fixtures.ts"), "utf8");
  });
  afterAll(async () => {
    for (const dir of made) await rm(dir, { recursive: true, force: true });
  });

  /** A throwaway project holding the real fixtures.ts and a stand-in proof with `examplePlans`. */
  async function probe(examplePlans: string[] | null) {
    // Canonicalised, because the module resolves through `import.meta.resolve` and gets back a real
    // path: on macOS the raw tmpdir spelling is /var and the resolved one is /private/var, and
    // comparing the two is a canonicalisation failure wearing a containment failure's clothes.
    const root = await realpath(await mkdtemp(join(tmpdir(), "pantry-fixtures-")));
    made.push(root);
    const pkgDir = join(root, "node_modules", "@tjakoen", "proof");
    await mkdir(pkgDir, { recursive: true });
    // Only PLAN.md is exported, exactly as the real package does it — the resolution the module
    // depends on has to be the one under test, or the child proves something else.
    await writeFile(join(pkgDir, "package.json"), JSON.stringify({
      name: "@tjakoen/proof", version: "0.0.0-test", type: "module",
      exports: { "./PLAN.md": "./PLAN.md" },
    }));
    await writeFile(join(pkgDir, "PLAN.md"), "# stand-in\n");
    if (examplePlans) {
      await mkdir(join(pkgDir, "example"), { recursive: true });
      for (const name of examplePlans) await writeFile(join(pkgDir, "example", name), "---\nid: x\n---\n");
    }
    await writeFile(join(root, "fixtures.ts"), source);
    await writeFile(join(root, "probe.ts"), `import { PROOF_EXAMPLE } from "./fixtures.ts";\nconsole.log(PROOF_EXAMPLE);\n`);

    const run = Bun.spawn(["bun", "run", "probe.ts"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()]);
    return { code: await run.exited, stdout, stderr, pkgDir };
  }

  test("a real corpus imports cleanly and points at the package's example dir", async () => {
    const { code, stdout, pkgDir } = await probe(["001.md", "002.md"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(join(pkgDir, "example"));
  });

  // The half a first version of the guard covered: the directory is not there at all.
  test("a missing example dir throws, naming the path and the package", async () => {
    const { code, stderr } = await probe(null);
    expect(code).not.toBe(0);
    expect(stderr).toContain("no plan markdown at");
    expect(stderr).toContain("@tjakoen/proof is installed");
  });

  // The half it did NOT cover, which is the same failure with a different cause: a release that
  // trims example/ to an empty dir puts the corpus back at zero with `existsSync` satisfied.
  test("an example dir with no plans in it throws the same way", async () => {
    const { code, stderr } = await probe([]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("no plan markdown at");
  });

  // And the reason the check filters on `.md` rather than counting entries: a dir that holds
  // something, but nothing anyone can parse as a plan, is still an empty corpus.
  test("an example dir holding non-markdown is still an empty corpus", async () => {
    const { code, stderr } = await probe(["README.txt", ".keep"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("no plan markdown at");
  });
});
