// pantry/config.test.ts — the HOST contract, resolved against a real host root.
//
// Every test builds a throwaway project directory and points `loadPantryConfig` at it. That is not
// ceremony: the module's whole job is to turn what a host wrote (or did not write) into absolute
// paths, and half its decisions are `existsSync` calls — a docs dir that auto-mounts only when it is
// there, a tours dir that does the same, a graph file that is preferred over another. Mocking the
// filesystem would replace exactly the thing under test with an assertion that the code calls the
// function that was mocked.
//
// The directories are fresh PER TEST rather than shared, and that matters more than tidiness:
// `pantry.config.ts` is read with a dynamic `import()`, which caches by absolute path for the life of
// the process. A reused host root would serve the first test's config to every later one, and the
// later ones would agree with it.
import { test, expect, describe, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { loadPantryConfig } from "./config.ts";
import { DEFAULT_HYGIENE } from "./hygiene.ts";

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

/** A fresh host project root: `files` are written (nested paths are created), `dirs` are mkdir'd. */
async function host(files: Record<string, string> = {}, dirs: string[] = []): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pantry-config-"));
  made.push(root);
  for (const d of dirs) await mkdir(join(root, d), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const file = join(root, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  return root;
}

/** A host whose `pantry.config.json` is exactly `raw`. The overwhelmingly common shape. */
const withJson = (raw: unknown, dirs: string[] = []) =>
  host({ "pantry.config.json": JSON.stringify(raw) }, dirs);

/**
 * Run `fn` with `console.warn` captured rather than printed.
 *
 * Two of this module's decisions are only observable as a warning — a preview target that was
 * configured and rejected, and a toursDir that was named and is not there. Both are deliberately not
 * silent (silence would be indistinguishable from "nothing configured"), so the warning IS the
 * behaviour and asserting on it is the only way to test it. Capturing also keeps the suite's output
 * clean, which is a side benefit and not the reason.
 */
async function warnings<T>(fn: () => Promise<T>): Promise<[T, string[]]> {
  const lines: string[] = [];
  const real = console.warn;
  console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    return [await fn(), lines];
  } finally {
    console.warn = real;
  }
}

describe("zero config — `bunx pantry` in a bare project", () => {
  test("every path is resolved from conventions, and nothing is said about it", async () => {
    const root = await host();
    const [config, said] = await warnings(() => loadPantryConfig(root));

    expect(config.cwd).toBe(root);
    expect(config.projectName).toBe(basename(root));
    expect(config.plansDir).toBe(join(root, "plans"));
    expect(config.artifactsDir).toBe(join(root, "artifacts"));
    expect(config.runsDir).toBe(join(root, "artifacts", "runs"));
    expect(config.graphDir).toBe(join(root, "graphify-out"));
    expect(config.decisionsDir).toBe(join(root, "plans", "decisions"));
    expect(config.answersLog).toBe(join(root, "plans", "decisions", "answers.jsonl"));
    expect(config.previewCommandCwd).toBe(root);
    expect(said).toEqual([]);
  });

  test("the surfaces that need a file to exist are off, not broken", async () => {
    const config = await loadPantryConfig(await host());
    expect(config.docsDirs).toEqual([]);          // no ./docs to mount
    expect(config.graphPath).toBeNull();          // no graphify pass has run
    expect(config.toursDir).toBeNull();           // no ./content/tours
    expect(config.previewTarget).toBeNull();      // the proxy is off by default
    expect(config.previewCommand).toBeNull();     // capture starts nothing
    expect(config.standardsSource).toBeUndefined();
  });

  test("every surface is on", async () => {
    const config = await loadPantryConfig(await host());
    expect(config.surfaces).toEqual({
      plans: true, docs: true, reference: true, catalog: true, standards: true,
      decisions: true, artifacts: true, timeline: true, runs: true,
    });
  });
});

describe("which config file is read, and what it may export", () => {
  test("pantry.config.json is parsed", async () => {
    const root = await withJson({ projectName: "from-json" });
    expect((await loadPantryConfig(root)).projectName).toBe("from-json");
  });

  test("pantry.config.ts is imported — default export", async () => {
    const root = await host({ "pantry.config.ts": `export default { projectName: "from-default" };` });
    expect((await loadPantryConfig(root)).projectName).toBe("from-default");
  });

  // The `mod.config` fallback exists because `export const config = {...}` is the shape a host writes
  // when it also wants to import its own config from somewhere else. Only reached when there is no
  // default, so both halves are pinned rather than just the one that happens to be written first.
  test("pantry.config.ts is imported — a named `config` export when there is no default", async () => {
    const root = await host({ "pantry.config.ts": `export const config = { projectName: "from-named" };` });
    expect((await loadPantryConfig(root)).projectName).toBe("from-named");
  });

  test("a default export wins over a named `config` in the same file", async () => {
    const root = await host({
      "pantry.config.ts": `export const config = { projectName: "named" };\nexport default { projectName: "default" };`,
    });
    expect((await loadPantryConfig(root)).projectName).toBe("default");
  });

  // A config module that exports neither is a host that has said nothing, not a host that is broken:
  // the file falls back to `{}` and every default applies. Worth pinning because the alternative
  // reading — treat the module namespace itself as the config — would hand `loadPantryConfig` an
  // object full of unrelated exports.
  test("a config module exporting neither is the same as no config", async () => {
    const root = await host({ "pantry.config.ts": `export const somethingElse = 1;` });
    const config = await loadPantryConfig(root);
    expect(config.projectName).toBe(basename(root));
    expect(config.plansDir).toBe(join(root, "plans"));
  });

  test("pantry.config.ts wins over both .js and .json", async () => {
    const root = await host({
      "pantry.config.ts": `export default { projectName: "ts" };`,
      "pantry.config.js": `export default { projectName: "js" };`,
      "pantry.config.json": `{ "projectName": "json" }`,
    });
    expect((await loadPantryConfig(root)).projectName).toBe("ts");
  });

  test("pantry.config.js is read when there is no .ts, and wins over .json", async () => {
    const root = await host({
      "pantry.config.js": `export default { projectName: "js" };`,
      "pantry.config.json": `{ "projectName": "json" }`,
    });
    expect((await loadPantryConfig(root)).projectName).toBe("js");
  });

  // A malformed config THROWS rather than degrading to `{}`, and that asymmetry is the point: an
  // absent config means "this host has no opinions", while a config that does not parse means the
  // host has opinions nobody can read. Falling back to defaults there would silently serve a
  // different project than the one that was configured.
  test("malformed JSON rejects rather than falling back to defaults", async () => {
    const root = await host({ "pantry.config.json": `{ "projectName": "oops",, }` });
    await expect(loadPantryConfig(root)).rejects.toThrow();
  });
});

describe("relative is anchored to the host root; absolute is taken as written", () => {
  test("a relative override resolves against cwd, not against process.cwd()", async () => {
    const root = await withJson({
      plansDir: "docs/plans",
      artifactsDir: "./evidence",
      graphDir: "build/graph",
      previewCommandCwd: "../sibling-app",
    });
    const config = await loadPantryConfig(root);
    expect(config.plansDir).toBe(join(root, "docs/plans"));
    expect(config.artifactsDir).toBe(join(root, "evidence"));
    expect(config.graphDir).toBe(join(root, "build/graph"));
    expect(config.previewCommandCwd).toBe(join(root, "../sibling-app"));
  });

  // Pointing plansDir off-root is supported, which is exactly why `cwd` is its own field on the
  // resolved config: a caller that needed "where is the repo" and derived it from plansDir would be
  // wrong here, and this is the case that makes it wrong.
  test("an absolute override is used as given, and cwd still names the repo", async () => {
    const elsewhere = await host({}, ["board"]);
    const root = await withJson({ plansDir: join(elsewhere, "board"), artifactsDir: "/tmp/pantry-abs-artifacts" });
    const config = await loadPantryConfig(root);
    expect(config.plansDir).toBe(join(elsewhere, "board"));
    expect(config.artifactsDir).toBe("/tmp/pantry-abs-artifacts");
    expect(config.cwd).toBe(root);
  });

  test("an explicit projectName beats the folder name", async () => {
    const root = await withJson({ projectName: "PANTRY" });
    expect((await loadPantryConfig(root)).projectName).toBe("PANTRY");
  });
});

describe("docsDirs — pointers to folders that are really there", () => {
  test("the default ./docs is mounted only when it exists", async () => {
    const bare = await host();
    expect((await loadPantryConfig(bare)).docsDirs).toEqual([]);

    const withDocs = await host({}, ["docs"]);
    expect((await loadPantryConfig(withDocs)).docsDirs).toEqual([join(withDocs, "docs")]);
  });

  // The existence filter applies to an EXPLICIT list too, and it has to: these are pointers at the
  // host's own folders rather than a request to create them, so a name that resolves to nothing is a
  // collection that would 404 on every page in it.
  test("an explicit list is honoured in order, and entries that do not exist are dropped", async () => {
    const root = await withJson(
      { docsDirs: ["docs/architecture", "docs/guides", "docs/not-written-yet"] },
      ["docs/architecture", "docs/guides"],
    );
    expect((await loadPantryConfig(root)).docsDirs).toEqual([
      join(root, "docs/architecture"),
      join(root, "docs/guides"),
    ]);
  });

  test("an explicit list replaces the default rather than adding to it", async () => {
    const root = await withJson({ docsDirs: ["handbook"] }, ["docs", "handbook"]);
    expect((await loadPantryConfig(root)).docsDirs).toEqual([join(root, "handbook")]);
  });

  test("an explicit empty list turns the mount off even where ./docs exists", async () => {
    const root = await withJson({ docsDirs: [] }, ["docs"]);
    expect((await loadPantryConfig(root)).docsDirs).toEqual([]);
  });
});

describe("the derived defaults — a path follows the one it was derived from", () => {
  // decisionsDir defaults under plansDir and answersLog under decisionsDir, both so that a question
  // and its answer ride along with the board they belong to. A host that moves the board and finds
  // its decisions still at ./plans/decisions has been given two boards, not one.
  test("moving plansDir moves the decisions and the answer log with it", async () => {
    const root = await withJson({ plansDir: "roadmap" });
    const config = await loadPantryConfig(root);
    expect(config.decisionsDir).toBe(join(root, "roadmap", "decisions"));
    expect(config.answersLog).toBe(join(root, "roadmap", "decisions", "answers.jsonl"));
  });

  test("moving decisionsDir moves the answer log, and leaves plansDir where it was", async () => {
    const root = await withJson({ decisionsDir: "questions" });
    const config = await loadPantryConfig(root);
    expect(config.plansDir).toBe(join(root, "plans"));
    expect(config.decisionsDir).toBe(join(root, "questions"));
    expect(config.answersLog).toBe(join(root, "questions", "answers.jsonl"));
  });

  test("moving artifactsDir moves the run ledger with it", async () => {
    const root = await withJson({ artifactsDir: "evidence" });
    const config = await loadPantryConfig(root);
    expect(config.runsDir).toBe(join(root, "evidence", "runs"));
  });

  // An explicit answersLog outside the repo is the documented way to make the channel per MACHINE
  // instead of per repo, so it must beat the derivation rather than be re-anchored under it.
  test("an explicit answersLog or runsDir wins over the derivation", async () => {
    const root = await withJson({
      decisionsDir: "questions",
      answersLog: "/tmp/pantry-machine-answers.jsonl",
      artifactsDir: "evidence",
      runsDir: "reports",
    });
    const config = await loadPantryConfig(root);
    expect(config.answersLog).toBe("/tmp/pantry-machine-answers.jsonl");
    expect(config.runsDir).toBe(join(root, "reports"));
  });
});

describe("graphPath — the whole stack first, then this repo, then nothing", () => {
  test("graph.json alone is found", async () => {
    const root = await host({ "graphify-out/graph.json": "{}" });
    expect((await loadPantryConfig(root)).graphPath).toBe(join(root, "graphify-out", "graph.json"));
  });

  test("merged-graph.json wins when both are present", async () => {
    const root = await host({ "graphify-out/graph.json": "{}", "graphify-out/merged-graph.json": "{}" });
    expect((await loadPantryConfig(root)).graphPath).toBe(join(root, "graphify-out", "merged-graph.json"));
  });

  test("a custom graphDir is where the lookup happens", async () => {
    const root = await host({
      "pantry.config.json": JSON.stringify({ graphDir: "build/graph" }),
      "build/graph/graph.json": "{}",
      "graphify-out/graph.json": "{}",           // the default location, deliberately not consulted
    });
    const config = await loadPantryConfig(root);
    expect(config.graphDir).toBe(join(root, "build/graph"));
    expect(config.graphPath).toBe(join(root, "build/graph", "graph.json"));
  });

  // The dir is resolved whether or not it holds anything, because two consumers want the FOLDER (the
  // built-from commit in GRAPH_REPORT.md, and this repo's own graph.json for the symbol lint) rather
  // than the graph. A null graphPath with an unset graphDir would take that away from them.
  test("no graph file leaves graphPath null and graphDir still absolute", async () => {
    const root = await host({}, ["graphify-out"]);
    const config = await loadPantryConfig(root);
    expect(config.graphPath).toBeNull();
    expect(config.graphDir).toBe(join(root, "graphify-out"));
  });

  test("a graph file that is not one of the two known names is not picked up", async () => {
    const root = await host({ "graphify-out/some-other-graph.json": "{}" });
    expect((await loadPantryConfig(root)).graphPath).toBeNull();
  });
});

describe("previewTarget — a rejected target degrades to off and says why", () => {
  test("a loopback origin is accepted, silently", async () => {
    const root = await withJson({ previewTarget: "http://localhost:3000" });
    const [config, said] = await warnings(() => loadPantryConfig(root));
    expect(config.previewTarget).toBe("http://localhost:3000");
    expect(said).toEqual([]);
  });

  test("a trailing slash is still an origin, and comes back normalised", async () => {
    const root = await withJson({ previewTarget: "http://127.0.0.1:8080/" });
    const config = await loadPantryConfig(root);
    expect(config.previewTarget).toBe("http://127.0.0.1:8080");
  });

  // Every rejection lands on the same branch here — origin null, one warning — so the cases are
  // asserted together on the WARNING TEXT. A blank root is the symptom an owner debugging this has,
  // and the reason it is blank is only ever in this line.
  test("a target that fails validation is off AND explained", async () => {
    for (const [target, expected] of [
      ["http://example.com:3000", "loopback"],
      ["not-a-url", "is not a URL"],
      ["ftp://localhost:21", "http or https"],
      ["http://user:pw@localhost:3000", "credentials"],
      ["http://localhost:3000/app", "no path"],
    ] as const) {
      const root = await withJson({ previewTarget: target });
      const [config, said] = await warnings(() => loadPantryConfig(root));
      expect(config.previewTarget).toBeNull();
      expect(said).toHaveLength(1);
      expect(said[0]).toContain("preview proxy off");
      expect(said[0]).toContain(expected);
    }
  });

  // The one case that must NOT warn: an empty or whitespace value is a key someone blanked out, not
  // a value that failed. Warning there would train an owner to ignore the line that matters.
  test("an empty or whitespace target is off without a complaint", async () => {
    for (const target of ["", "   "]) {
      const root = await withJson({ previewTarget: target });
      const [config, said] = await warnings(() => loadPantryConfig(root));
      expect(config.previewTarget).toBeNull();
      expect(said).toEqual([]);
    }
  });
});

describe("previewCommand — whitespace is not a command", () => {
  test("a real command is trimmed and kept", async () => {
    const root = await withJson({ previewCommand: "  bun run start  " });
    expect((await loadPantryConfig(root)).previewCommand).toBe("bun run start");
  });

  // Folded to null HERE rather than checked at the call site, because `if (config.previewCommand)`
  // is the natural test and "   " passes it — which would hand a shell a command that is nothing.
  test("an absent, empty or whitespace-only command is null, not a blank string", async () => {
    for (const raw of [undefined, "", "   ", "\n\t"]) {
      const root = await withJson(raw === undefined ? {} : { previewCommand: raw });
      expect((await loadPantryConfig(root)).previewCommand).toBeNull();
    }
  });

  test("previewCommandCwd is resolved even with no command to run there", async () => {
    const root = await withJson({ previewCommandCwd: "apps/site" });
    const config = await loadPantryConfig(root);
    expect(config.previewCommand).toBeNull();
    expect(config.previewCommandCwd).toBe(join(root, "apps/site"));
  });
});

describe("toursDir — explicit is honoured, the default is existence-gated", () => {
  test("the default mounts ./content/tours only when it is there", async () => {
    const bare = await host();
    const [bareConfig, bareSaid] = await warnings(() => loadPantryConfig(bare));
    expect(bareConfig.toursDir).toBeNull();
    expect(bareSaid).toEqual([]);

    const withTours = await host({}, ["content/tours"]);
    const [config, said] = await warnings(() => loadPantryConfig(withTours));
    expect(config.toursDir).toBe(join(withTours, "content", "tours"));
    expect(said).toEqual([]);
  });

  test("an explicit tours folder that exists is mounted, silently", async () => {
    const root = await withJson({ toursDir: "review/tours" }, ["review/tours"]);
    const [config, said] = await warnings(() => loadPantryConfig(root));
    expect(config.toursDir).toBe(join(root, "review/tours"));
    expect(said).toEqual([]);
  });

  // The asymmetry with docsDirs is deliberate: a named toursDir is honoured whether or not it exists
  // yet, because a host that named one has said what it means. The warning is what stops that from
  // being silently identical to having none — the mount costs every proxied page a stylesheet, a
  // client and a no-store, and a folder that can only answer an empty list is not worth them.
  test("an explicit tours folder that is missing is still mounted, and is said out loud", async () => {
    const root = await withJson({ toursDir: "review/tours" });
    const [config, said] = await warnings(() => loadPantryConfig(root));
    expect(config.toursDir).toBe(join(root, "review/tours"));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("does not exist");
    expect(said[0]).toContain(join(root, "review/tours"));
  });
});

describe("surfaces and standardsSource — what the host may turn off", () => {
  test("a partial override turns off exactly what it names", async () => {
    const root = await withJson({ surfaces: { docs: false, timeline: false } });
    const { surfaces } = await loadPantryConfig(root);
    expect(surfaces.docs).toBe(false);
    expect(surfaces.timeline).toBe(false);
    expect(surfaces.plans).toBe(true);
    expect(surfaces.runs).toBe(true);
    expect(surfaces.decisions).toBe(true);
    expect(Object.keys(surfaces).toSorted()).toEqual(
      ["artifacts", "catalog", "decisions", "docs", "plans", "reference", "runs", "standards", "timeline"],
    );
  });

  test("an empty surfaces object leaves every surface on", async () => {
    const root = await withJson({ surfaces: {} });
    expect(Object.values((await loadPantryConfig(root)).surfaces).every(Boolean)).toBe(true);
  });

  // Only the standards home may carry canon-named files in standards/ without doctor's forked-
  // standards check flagging them. Everywhere else the key is absent, and absent is not "false" —
  // doctor reads the field itself.
  test("standardsSource is passed through, and is undefined when unset", async () => {
    const home = await withJson({ standardsSource: "canon" });
    expect((await loadPantryConfig(home)).standardsSource).toBe("canon");

    const other = await withJson({ projectName: "some-other-repo" });
    expect((await loadPantryConfig(other)).standardsSource).toBeUndefined();
  });
});

// The hygiene lines (S3a). The asymmetry is the whole point and it is the only part worth testing
// hard: an ABSENT key takes the estate default, and a key that is PRESENT and unusable mutes its
// check rather than quietly falling back — a host that said something must never be warned on a line
// its config appears to have turned off.
describe("loadPantryConfig — the hygiene lines", () => {
  test("a host that says nothing gets the estate defaults, every key filled", async () => {
    const root = await withJson({});
    const h = (await loadPantryConfig(root)).hygiene;
    expect(Object.keys(h).sort()).toEqual(
      ["runReportMaxCommits", "uncommittedMaxAgeDays", "unpushedMaxAgeDays", "unpushedMaxCommits"],
    );
    expect(h).toEqual(DEFAULT_HYGIENE);
  });

  test("a host's numbers win, key by key, and the rest stay default", async () => {
    const root = await withJson({ hygiene: { uncommittedMaxAgeDays: 3 } });
    const h = (await loadPantryConfig(root)).hygiene;
    expect(h.uncommittedMaxAgeDays).toBe(3);
    expect(h.unpushedMaxCommits).toBe(DEFAULT_HYGIENE.unpushedMaxCommits);
  });

  test("an explicit null mutes that check instead of taking the default", async () => {
    const root = await withJson({ hygiene: { unpushedMaxAgeDays: null } });
    const h = (await loadPantryConfig(root)).hygiene;
    expect(Number.isFinite(h.unpushedMaxAgeDays)).toBe(false);
    expect(h.uncommittedMaxAgeDays).toBe(DEFAULT_HYGIENE.uncommittedMaxAgeDays);
  });

  test("a value that is not a positive number mutes rather than warning on a default nobody set", async () => {
    // JSON lets a host write anything here; zero, a negative and a string all mean "not a line".
    const root = await withJson({ hygiene: { uncommittedMaxAgeDays: 0, unpushedMaxCommits: -4, runReportMaxCommits: "soon" } });
    const h = (await loadPantryConfig(root)).hygiene;
    expect(Number.isFinite(h.uncommittedMaxAgeDays)).toBe(false);
    expect(Number.isFinite(h.unpushedMaxCommits)).toBe(false);
    expect(Number.isFinite(h.runReportMaxCommits)).toBe(false);
  });

  test("an empty hygiene object is the same as saying nothing", async () => {
    const root = await withJson({ hygiene: {} });
    expect((await loadPantryConfig(root)).hygiene).toEqual(DEFAULT_HYGIENE);
  });
});
