// pantry/skills.test.ts — piece S2: `pantry skills sync|list`. Hermetic: canonDir is INJECTED from a
// temp fixture rather than resolved out of node_modules, so these tests neither depend on the
// portfolio pin nor break when it moves. The load-bearing assertions are the three rules skills.ts
// exists to keep: the generated view matches canon (SSOT), the mount is self-gitignoring and never
// touches a file we did not generate (non-invasive), and an absent canon package degrades to a skip
// rather than a throw.
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncSkills, listSkills, slugFor, renderSkill, resolveCanonDir, formatSkillsSync, formatSkillsList } from "./skills.ts";
import { runDoctor } from "./doctor.ts";
import type { ResolvedPantryConfig } from "./config.ts";

let host: string;
let canon: string;

const SKILL = (slug: string) => join(host, ".claude", "skills", slug, "SKILL.md");

// A canon standard: `when:` as a folded block (the shape S1 landed), a title, and a body.
const standard = (title: string, when: string, body: string) =>
  `---\ntitle: ${title}\nwhen: >\n  ${when}\n---\n\n## ${title}\n\n${body}\n`;

beforeEach(async () => {
  host = await mkdtemp(join(tmpdir(), "pantry-skills-host-"));
  canon = await mkdtemp(join(tmpdir(), "pantry-skills-canon-"));
  await writeFile(join(canon, "VOICE.md"), standard("VOICE", "Read this BEFORE writing prose.", "No em-dashes."), "utf8");
  await writeFile(join(canon, "GRAPH.md"), standard("GRAPH", "Read this BEFORE grepping.", "Query by symbol."), "utf8");
  // No `when:` — an index, not a skill. Must be skipped, not mounted empty.
  await writeFile(join(canon, "README.md"), `---\ntitle: index\n---\n\nthe index\n`, "utf8");
});
afterEach(async () => {
  await rm(host, { recursive: true, force: true });
  await rm(canon, { recursive: true, force: true });
});

const sync = () => syncSkills({ cwd: host, canonDir: canon, config: cfg() });
const list = () => listSkills({ cwd: host, canonDir: canon, config: cfg() });

const cfg = (): ResolvedPantryConfig => ({
  cwd: host,
  projectName: "t",
  plansDir: join(host, "plans"),
  docsDirs: [],
  graphPath: null,
  graphDir: join(host, "graphify-out"),
  decisionsDir: join(host, "plans", "decisions"),
  artifactsDir: join(host, "artifacts"),
  runsDir: join(host, "artifacts", "runs"),
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true, decisions: true, artifacts: true, timeline: true, runs: true },
});

describe("pantry skills sync — the generated view", () => {
  test("a standard with when: is mounted; the when: becomes the description and the body is verbatim", async () => {
    const report = await sync();

    expect(report.mounted.map((m) => m.slug).sort()).toEqual(["graph", "voice"]);
    const text = await Bun.file(SKILL("voice")).text();
    expect(text.startsWith("---\nname: voice\n")).toBe(true);
    expect(text).toContain(`description: "Read this BEFORE writing prose."`);
    expect(text).toContain("No em-dashes."); // body carried through
    expect(text).toContain("Generated view of `standards/VOICE.md`"); // and points back at canon
  });

  test("a standard without a when: key is skipped by name, never mounted empty", async () => {
    const report = await sync();
    expect(existsSync(SKILL("readme"))).toBe(false);
    expect(report.skipped.find((s) => s.file === "README.md")?.reason).toContain("no when:");
  });

  test("a symlinked canon file (AGENTS.md -> CLAUDE.md) is not mounted twice", async () => {
    await writeFile(join(canon, "CLAUDE.md"), standard("CLAUDE", "Read this always.", "rules"), "utf8");
    await symlink("CLAUDE.md", join(canon, "AGENTS.md"));
    const report = await sync();
    expect(report.mounted.map((m) => m.slug)).not.toContain("agents");
    expect(report.skipped.find((s) => s.file === "AGENTS.md")?.reason).toContain("symlink");
  });

  test("the mount is self-gitignoring, so no host .gitignore is edited", async () => {
    await sync();
    const ignore = await Bun.file(join(host, ".claude", "skills", ".gitignore")).text();
    expect(ignore).toContain("*");
    expect(existsSync(join(host, ".gitignore"))).toBe(false); // the host's own file was never created
  });

  test("idempotent: a second sync writes nothing", async () => {
    await sync();
    const second = await sync();
    expect(second.mounted.every((m) => m.action === "unchanged")).toBe(true);
  });

  test("a canon edit is picked up on the next sync", async () => {
    await sync();
    await writeFile(join(canon, "VOICE.md"), standard("VOICE", "Read this BEFORE any prose at all.", "No em-dashes."), "utf8");
    const second = await sync();
    expect(second.mounted.find((m) => m.slug === "voice")!.action).toBe("written");
    expect(await Bun.file(SKILL("voice")).text()).toContain("BEFORE any prose at all");
  });
});

describe("pantry skills sync — what it refuses to touch", () => {
  test("a hand-authored SKILL.md at the same slug is left alone and reported", async () => {
    await mkdir(join(host, ".claude", "skills", "voice"), { recursive: true });
    await writeFile(SKILL("voice"), "---\nname: voice\ndescription: mine\n---\n\nhand written\n", "utf8");

    const report = await sync();
    expect(await Bun.file(SKILL("voice")).text()).toContain("hand written");
    expect(report.mounted.map((m) => m.slug)).not.toContain("voice");
    expect(report.skipped.some((s) => s.reason.includes("hand-authored"))).toBe(true);
  });

  test("a foreign skill dir survives pruning; one of ours that left canon does not", async () => {
    await sync();
    await mkdir(join(host, ".claude", "skills", "third-party"), { recursive: true });
    await writeFile(SKILL("third-party"), "---\nname: third-party\n---\n\nnot ours\n", "utf8");
    await rm(join(canon, "GRAPH.md"));

    const report = await sync();
    expect(report.pruned).toEqual(["graph"]);
    expect(existsSync(SKILL("graph"))).toBe(false);
    expect(existsSync(SKILL("third-party"))).toBe(true); // no sentinel → never ours to remove
  });

  // The dangerous twin of the prune case below: a symlink at a LIVE slug would make writeFile land
  // wherever it points, outside the repo entirely.
  test("a symlinked dir sitting at a live slug is never written through", async () => {
    const outside = await mkdtemp(join(tmpdir(), "pantry-skills-outside-"));
    await mkdir(join(host, ".claude", "skills"), { recursive: true });
    await symlink(outside, join(host, ".claude", "skills", "voice"));

    const report = await sync();
    expect(existsSync(join(outside, "SKILL.md"))).toBe(false); // nothing escaped the mount dir
    expect(report.mounted.map((m) => m.slug)).not.toContain("voice");
    expect(report.skipped.some((s) => s.reason.includes("not a plain directory"))).toBe(true);

    await rm(outside, { recursive: true, force: true });
  });

  test("two standards claiming one slug: the first keeps it, the second is named, neither is silently lost", async () => {
    await writeFile(join(canon, "AAA.md"), `---\ntitle: A\nskill: shared\nwhen: >\n  Read this BEFORE A.\n---\n\nbody A\n`, "utf8");
    await writeFile(join(canon, "BBB.md"), `---\ntitle: B\nskill: shared\nwhen: >\n  Read this BEFORE B.\n---\n\nbody B\n`, "utf8");

    const report = await sync();
    expect(report.mounted.filter((m) => m.slug === "shared")).toHaveLength(1);
    expect(await Bun.file(SKILL("shared")).text()).toContain("body A"); // first alphabetically wins
    expect(report.skipped.some((s) => s.file === "BBB.md" && s.reason.includes("already claimed"))).toBe(true);
  });

  test("a skill: key that normalizes to nothing falls back instead of writing to the mount root", async () => {
    await writeFile(join(canon, "ODD.md"), `---\ntitle: odd\nskill: "---"\nwhen: >\n  Read this BEFORE odd things.\n---\n\nodd body\n`, "utf8");

    const report = await sync();
    expect(report.mounted.some((m) => m.slug === "odd")).toBe(true);
    // the bug this guards: an empty slug collapses join(skillsDir, slug) to skillsDir itself
    expect(existsSync(join(host, ".claude", "skills", "SKILL.md"))).toBe(false);
  });

  test("a symlinked skill dir is never removed", async () => {
    await sync();
    const outside = join(host, "outside-skill");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "SKILL.md"), "---\nname: linked\n---\n\nlinked\n", "utf8");
    await symlink(outside, join(host, ".claude", "skills", "linked"));
    await rm(join(canon, "GRAPH.md"));

    await sync();
    expect(existsSync(SKILL("linked"))).toBe(true);
  });
});

describe("pantry skills — degrading, not crashing", () => {
  test("no standards package → an empty report and a message that says why", async () => {
    const report = await syncSkills({ cwd: host, canonDir: null, config: cfg() });
    expect(report.mounted).toEqual([]);
    expect(report.canonDir).toBeNull();
    expect(formatSkillsSync(report)).toContain("not installed");
    expect(existsSync(join(host, ".claude"))).toBe(false); // nothing written on the way out
  });

  // The two states read identically from the outside but have different fixes (install vs bump), and
  // this is the live one: pantry's own pin predates S1's when: keys.
  test("a standards package that predates the skill format says so, and writes nothing", async () => {
    const old = await mkdtemp(join(tmpdir(), "pantry-skills-oldpin-"));
    await writeFile(join(old, "VOICE.md"), `---\ntitle: VOICE\n---\n\nno when key here\n`, "utf8");

    const report = await syncSkills({ cwd: host, canonDir: old, config: cfg() });
    expect(report.canonDir).toBe(old);
    expect(report.mounted).toEqual([]);
    expect(formatSkillsSync(report)).toContain("predates the skill format");
    expect(existsSync(join(host, ".claude", "skills"))).toBe(false); // no empty mount dir left behind

    await rm(old, { recursive: true, force: true });
  });

  test("resolveCanonDir prefers the canon home's own standards/ over its installed pin", async () => {
    await mkdir(join(host, "standards"), { recursive: true });
    expect(resolveCanonDir(host, { ...cfg(), standardsSource: "canon" })).toBe(join(host, "standards"));
  });
});

describe("pantry skills list", () => {
  test("reports fresh, stale and unmounted against canon", async () => {
    await sync();
    // canon moves; the mount does not
    await writeFile(join(canon, "GRAPH.md"), standard("GRAPH", "Read this BEFORE any grep.", "Query by symbol."), "utf8");
    await writeFile(join(canon, "LOOP.md"), standard("LOOP", "Read this BEFORE closing a run.", "Gate first."), "utf8");

    const report = await list();
    const state = (slug: string) => report.skills.find((s) => s.slug === slug)!.state;
    expect(state("voice")).toBe("fresh");
    expect(state("graph")).toBe("stale");
    expect(state("loop")).toBe("missing");
  });

  // The reported state has to match what sync will actually do. Calling this "stale" would tell the
  // reader to run a command that refuses to touch the file.
  test("a hand-authored file at a live slug reads as shadowed, not stale, and sync is not offered as the fix", async () => {
    await mkdir(join(host, ".claude", "skills", "voice"), { recursive: true });
    await writeFile(SKILL("voice"), "---\nname: voice\ndescription: mine\n---\n\nhand written\n", "utf8");

    const report = await list();
    expect(report.skills.find((s) => s.slug === "voice")!.state).toBe("shadowed");
    const text = formatSkillsList(report);
    expect(text).toContain("shadow");
    expect(text).toContain("sync cannot overwrite it");
  });

  test("doctor reports a shadowed slot as due, with the remedy that actually works", async () => {
    await writeFile(join(host, "CLAUDE.md"), "kit", "utf8");
    await sync();
    await writeFile(SKILL("voice"), "---\nname: voice\n---\n\nhand written\n", "utf8");

    const report = await runDoctor({ cwd: host, config: cfg(), canonDir: canon, runDrift: false, runDeps: false });
    const check = report.checks.find((c) => c.id === "skills-freshness")!;
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("shadowed");
    expect(check.detail).not.toContain("run pantry skills sync");
    expect(check.severity).toBe("warn"); // due, never a broken kit (the CI assertion is its own test)
  });

  test("foreign skills are listed as an honest inventory, marked not ours", async () => {
    await sync();
    await mkdir(join(host, ".claude", "skills", "third-party"), { recursive: true });
    await writeFile(SKILL("third-party"), "---\nname: third-party\n---\n\nnot ours\n", "utf8");
    expect((await list()).foreign).toEqual(["third-party"]);
  });
});

describe("doctor skills-freshness", () => {
  const doctorHere = () => runDoctor({ cwd: host, config: cfg(), canonDir: canon, runDrift: false, runDeps: false });

  test("a kit repo with a stale mount warns and names it", async () => {
    await writeFile(join(host, "CLAUDE.md"), "kit", "utf8");
    await sync();
    await writeFile(join(canon, "VOICE.md"), standard("VOICE", "Read this BEFORE anything.", "No em-dashes."), "utf8");

    const check = (await doctorHere()).checks.find((c) => c.id === "skills-freshness")!;
    expect(check.severity).toBe("warn");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("voice");
  });

  test("a bare repo that never mounted them is info, not a false alarm", async () => {
    const check = (await doctorHere()).checks.find((c) => c.id === "skills-freshness")!;
    expect(check.severity).toBe("info");
    expect(check.ok).toBe(true);
  });

  test("a stale mount never fails CI — warns are due, not broken", async () => {
    await writeFile(join(host, "CLAUDE.md"), "kit", "utf8");
    await symlink("CLAUDE.md", join(host, "AGENTS.md"));
    await mkdir(join(host, "plans"), { recursive: true });
    await sync();
    await rm(SKILL("voice"));

    const report = await doctorHere();
    expect(report.checks.find((c) => c.id === "skills-freshness")!.ok).toBe(false);
    expect(report.ok).toBe(true);
  });
});

describe("slugFor", () => {
  test("canon filenames become the slugs the harness lists", () => {
    expect(slugFor("VOICE.md")).toBe("voice");
    expect(slugFor("AI-REPO-STANDARD.md")).toBe("ai-repo-standard");
    expect(slugFor("CLAUDE.starter.md")).toBe("claude-starter");
  });

  test("a `skill:` key overrides the filename, so canon can dodge a harness name collision", () => {
    expect(slugFor("LOOP.md", "loop-standard")).toBe("loop-standard");
    expect(slugFor("LOOP.md", "  ")).toBe("loop"); // blank is not an override
    expect(slugFor("LOOP.md", undefined)).toBe("loop");
  });
});

test("a standard's `skill:` key decides where it mounts", async () => {
  await writeFile(
    join(canon, "LOOP.md"),
    `---\ntitle: LOOP\nskill: loop-standard\nwhen: >\n  Read this BEFORE calling work done.\n---\n\ngates\n`,
    "utf8",
  );
  const report = await sync();
  expect(report.mounted.map((m) => m.slug)).toContain("loop-standard");
  expect(existsSync(SKILL("loop"))).toBe(false);
  expect(await Bun.file(SKILL("loop-standard")).text()).toContain("name: loop-standard");
});

describe("renderSkill", () => {
  test("a when: containing quotes and colons stays parseable as one YAML scalar", () => {
    const out = renderSkill({ file: "VOICE.md", slug: "voice", when: `Read: don't say "just".`, body: "b" });
    const description = out.split("\n").find((l) => l.startsWith("description:"))!;
    expect(JSON.parse(description.slice("description: ".length))).toBe(`Read: don't say "just".`);
  });
});

// The mount dir must never end up tracked. Cheap guard against someone "fixing" the .gitignore away.
test("nothing under .claude/skills is committed by construction", async () => {
  await sync();
  const entries = await readdir(join(host, ".claude", "skills"));
  expect(entries).toContain(".gitignore");
});
