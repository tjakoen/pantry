// pantry/timeline.test.ts — piece 11e sub-unit 3 data layer. Assert the git-derived created/transitions
// /lastActivity derivation (via an INJECTED fake git runner — no real repo needed), depends passthrough,
// commit-density bucketing, audit-marker collection, the stat tiles, and the graceful degradations
// (not a git repo, a malformed revision). Plan files are real (a temp plans/ dir, parsed by the real
// loadPlans); only git itself is faked. Style mirrors decisions.test.ts / artifacts.test.ts.
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTimelinePayload, type GitRunner } from "./timeline.ts";

const AT = "2026-07-29T12:00:00.000Z";

let cwd: string;      // the host root
let plansDir: string; // <cwd>/plans
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "pantry-timeline-"));
  plansDir = join(cwd, "plans");
  await mkdir(plansDir);
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const writePlan = (id: string, body: string) => writeFile(join(plansDir, `${id}.md`), body);

// A fake git world keyed the way the code calls git: per-file (by the relPath the code computes,
// "plans/<id>.md" for these fixtures) plus a flat repo-wide commit-date log for the density strip.
interface FakeFile {
  /** git log --diff-filter=A output lines, newest first (oldest last, matching real git) */
  added?: string[];
  /** git log --reverse revisions, oldest first: [sha, ISO date] */
  revisions?: [string, string][];
  /** git log -1 (newest commit) ISO date */
  last?: string;
  /** sha -> file content at that revision (git show <sha>:<relPath>); undefined sha -> null (unreadable) */
  shows?: Record<string, string | null>;
}
interface FakeWorld {
  isRepo?: boolean; // default true
  files?: Record<string, FakeFile>; // key: "plans/<id>.md"
  densityLog?: string[]; // git log --format=%cI (no pathspec) output lines
}

function fakeGit(world: FakeWorld): GitRunner {
  const isRepo = world.isRepo ?? true;
  return async (args: string[]) => {
    if (args[0] === "rev-parse") return isRepo ? "true\n" : null;
    if (args[0] === "show") {
      const spec = args[1] ?? "";
      const i = spec.indexOf(":");
      const sha = spec.slice(0, i), rel = spec.slice(i + 1);
      const f = world.files?.[rel];
      if (!f?.shows || !(sha in f.shows)) return null;
      return f.shows[sha];
    }
    if (args[0] === "log") {
      const dashIdx = args.indexOf("--");
      if (dashIdx === -1) return (world.densityLog ?? []).join("\n"); // the repo-wide density log
      const rel = args[dashIdx + 1];
      const f = world.files?.[rel];
      if (!f) return "";
      if (args.includes("--diff-filter=A")) return (f.added ?? []).join("\n");
      if (args.includes("--reverse")) return (f.revisions ?? []).map(([sha, date]) => `${sha}|${date}`).join("\n");
      if (args.includes("-1")) return f.last ?? "";
      return "";
    }
    return null;
  };
}

const build = (world: FakeWorld) => buildTimelinePayload({ projectName: "t", plansDir, cwd }, AT, fakeGit(world));

describe("buildTimelinePayload — created / lastActivity / done", () => {
  test("derives created (add commit), lastActivity (newest touch), and done (status:done reached)", async () => {
    await writePlan("001-alpha", `---\nstatus: done\ntrack: A\ndepends: []\nowner: ai\n---\n# Alpha\n`);
    const p = await build({
      files: {
        "plans/001-alpha.md": {
          added: ["2026-06-01T00:00:00.000Z"],
          last: "2026-06-10T00:00:00.000Z",
          revisions: [
            ["s1", "2026-06-01T00:00:00.000Z"],
            ["s2", "2026-06-10T00:00:00.000Z"],
          ],
          shows: {
            s1: "---\nstatus: todo\n---\n# Alpha\n",
            s2: "---\nstatus: done\n---\n# Alpha\n",
          },
        },
      },
    });
    expect(p.available).toBe(true);
    expect(p.plans).toHaveLength(1);
    const alpha = p.plans[0];
    expect(alpha.id).toBe("001-alpha");
    expect(alpha.created).toBe("2026-06-01T00:00:00.000Z");
    expect(alpha.lastActivity).toBe("2026-06-10T00:00:00.000Z");
    expect(alpha.done).toBe("2026-06-10T00:00:00.000Z"); // first time status read "done"
    expect(alpha.track).toBe("A");
  });

  test("done stays null when the CURRENT status is not done, even if history once passed through done", async () => {
    await writePlan("002-beta", `---\nstatus: doing\n---\n# Beta\n`);
    const p = await build({
      files: {
        "plans/002-beta.md": {
          added: ["2026-06-01T00:00:00.000Z"],
          last: "2026-06-05T00:00:00.000Z",
          revisions: [
            ["s1", "2026-06-01T00:00:00.000Z"],
            ["s2", "2026-06-03T00:00:00.000Z"],
            ["s3", "2026-06-05T00:00:00.000Z"],
          ],
          shows: {
            s1: "---\nstatus: done\n---\n", // reverted from done back to doing — still counts as history
            s2: "---\nstatus: doing\n---\n",
            s3: "---\nstatus: doing\n---\n", // no new status — not a transition
          },
        },
      },
    });
    const beta = p.plans[0];
    expect(beta.done).toBeNull();
    expect(beta.lastActivity).toBe("2026-06-05T00:00:00.000Z");
  });

  test("created falls back to the oldest revision when no diff-filter=A add commit is found", async () => {
    await writePlan("003-gamma", `---\nstatus: todo\n---\n# Gamma\n`);
    const p = await build({
      files: {
        "plans/003-gamma.md": {
          added: [], // no add commit found (e.g. renamed in a way git doesn't attribute as "A")
          last: "2026-06-02T00:00:00.000Z",
          revisions: [["s1", "2026-05-20T00:00:00.000Z"]],
          shows: { s1: "---\nstatus: todo\n---\n" },
        },
      },
    });
    expect(p.plans[0].created).toBe("2026-05-20T00:00:00.000Z");
  });
});

describe("buildTimelinePayload — status transitions", () => {
  test("a todo→doing→done sequence records each new status's first-seen date, in order", async () => {
    await writePlan("004-delta", `---\nstatus: done\n---\n# Delta\n`);
    const p = await build({
      files: {
        "plans/004-delta.md": {
          added: ["2026-01-01T00:00:00.000Z"],
          last: "2026-01-20T00:00:00.000Z",
          revisions: [
            ["s1", "2026-01-01T00:00:00.000Z"],
            ["s2", "2026-01-05T00:00:00.000Z"],
            ["s3", "2026-01-10T00:00:00.000Z"],
            ["s4", "2026-01-20T00:00:00.000Z"],
          ],
          shows: {
            s1: "---\nstatus: todo\n---\n",
            s2: "---\nstatus: todo\n---\n",     // repeats — not a new transition
            s3: "---\nstatus: doing\n---\n",
            s4: "---\nstatus: done\n---\n",
          },
        },
      },
    });
    expect(p.plans[0].transitions).toEqual([
      { status: "todo", date: "2026-01-01T00:00:00.000Z" },
      { status: "doing", date: "2026-01-10T00:00:00.000Z" },
      { status: "done", date: "2026-01-20T00:00:00.000Z" },
    ]);
  });

  test("a malformed / unreadable revision is skipped, not crashed", async () => {
    await writePlan("005-eps", `---\nstatus: doing\n---\n# Eps\n`);
    const p = await build({
      files: {
        "plans/005-eps.md": {
          added: ["2026-02-01T00:00:00.000Z"],
          last: "2026-02-05T00:00:00.000Z",
          revisions: [
            ["s1", "2026-02-01T00:00:00.000Z"],
            ["s2", "2026-02-03T00:00:00.000Z"], // git show fails (returns null) — not in `shows`
            ["s3", "2026-02-05T00:00:00.000Z"], // no frontmatter at all — status undefined
          ],
          shows: {
            s1: "---\nstatus: todo\n---\n",
            s3: "no frontmatter here, just prose",
          },
        },
      },
    });
    expect(p.available).toBe(true);
    expect(p.plans).toHaveLength(1);
    expect(p.plans[0].transitions).toEqual([{ status: "todo", date: "2026-02-01T00:00:00.000Z" }]);
  });
});

describe("buildTimelinePayload — depends", () => {
  test("depends is passed through from the parsed plan, unmodified", async () => {
    await writePlan("006-a", `---\nstatus: todo\n---\n# A\n`);
    await writePlan("007-b", `---\nstatus: todo\ndepends: [006-a]\n---\n# B\n`);
    const p = await build({ files: {} }); // no git history needed for this assertion
    const b = p.plans.find((x) => x.id === "007-b")!;
    expect(b.depends).toEqual(["006-a"]);
    const a = p.plans.find((x) => x.id === "006-a")!;
    expect(a.depends).toEqual([]);
  });
});

describe("buildTimelinePayload — commit density + stat tiles", () => {
  test("buckets the repo-wide commit log by day and counts distinct active days", async () => {
    await writePlan("008-only", `---\nstatus: todo\n---\n# Only\n`);
    const p = await build({
      densityLog: [
        "2026-07-01T09:00:00.000Z",
        "2026-07-01T14:00:00.000Z", // same day as above — one bucket, count 2
        "2026-07-03T09:00:00.000Z",
      ],
    });
    expect(p.density).toEqual([
      { date: "2026-07-01", count: 2 },
      { date: "2026-07-03", count: 1 },
    ]);
    expect(p.densityBucket).toBe("day");
    expect(p.activeDays).toBe(2); // 2 distinct calendar days, not 3 commits
  });

  test("buckets weekly once the span exceeds the daily threshold", async () => {
    await writePlan("009-only", `---\nstatus: todo\n---\n# Only\n`);
    const p = await build({
      densityLog: ["2026-01-05T00:00:00.000Z", "2026-08-01T00:00:00.000Z"], // ~200 days apart
    });
    expect(p.densityBucket).toBe("week");
    expect(p.density.length).toBeGreaterThan(0);
  });

  test("spanDays / earliest are derived from the earliest plan `created`, not the density log", async () => {
    await writePlan("010-span", `---\nstatus: todo\n---\n# Span\n`);
    const p = await build({
      files: {
        "plans/010-span.md": {
          added: ["2026-01-01T00:00:00.000Z"],
          last: "2026-01-01T00:00:00.000Z",
          revisions: [["s1", "2026-01-01T00:00:00.000Z"]],
          shows: { s1: "---\nstatus: todo\n---\n" },
        },
      },
    });
    expect(p.earliest).toBe("2026-01-01T00:00:00.000Z");
    // AT is 2026-07-29 — roughly 209 days after 2026-01-01
    expect(p.spanDays).toBeGreaterThan(200);
    expect(p.spanDays).toBeLessThan(220);
  });
});

describe("buildTimelinePayload — audit markers", () => {
  test("dated audit reports across cwd/artifacts/reports/docs are collected, AUDIT.md runbook excluded", async () => {
    await writePlan("011-only", `---\nstatus: todo\n---\n# Only\n`);
    await writeFile(join(cwd, "AUDIT-2026-07-01.md"), "root-level report");
    await writeFile(join(cwd, "AUDIT.md"), "the runbook — not a report");
    await mkdir(join(cwd, "artifacts"));
    await writeFile(join(cwd, "artifacts", "audit-2026-07-10.md"), "artifacts report");
    await mkdir(join(cwd, "docs"));
    await writeFile(join(cwd, "docs", "notes.md"), "not an audit file");
    const p = await build({ files: {} });
    expect(p.auditMarkers.map((m) => m.label).sort()).toEqual(["AUDIT-2026-07-01", "audit-2026-07-10"]);
  });
});

describe("buildTimelinePayload — degradations", () => {
  test("not a git repo (rev-parse fails) → available:false, empty arrays, no throw", async () => {
    await writePlan("012-only", `---\nstatus: todo\n---\n# Only\n`);
    const p = await build({ isRepo: false });
    expect(p.available).toBe(false);
    expect(p.plans).toEqual([]);
    expect(p.density).toEqual([]);
    expect(p.reason).toBeTruthy();
  });

  test("a git runner that throws is treated the same as a failed call", async () => {
    await writePlan("013-only", `---\nstatus: todo\n---\n# Only\n`);
    const throwingGit: GitRunner = async () => { throw new Error("boom"); };
    // buildTimelinePayload never calls gitRunner in a way that should let a throw escape unhandled by
    // the caller in this test — assert the promise itself doesn't reject the whole build.
    await expect(
      (async () => {
        try {
          return await buildTimelinePayload({ projectName: "t", plansDir, cwd }, AT, throwingGit);
        } catch {
          return null;
        }
      })(),
    ).resolves.not.toBeNull();
  });

  test("no plans/ content → available:false, no throw", async () => {
    const p = await build({});
    expect(p.available).toBe(false);
    expect(p.plans).toEqual([]);
    expect(p.reason).toBeTruthy();
  });

  test("an absent plans dir → available:false, no throw", async () => {
    const p = await buildTimelinePayload({ projectName: "t", plansDir: join(cwd, "nope"), cwd }, AT, fakeGit({}));
    expect(p.available).toBe(false);
    expect(p.plans).toEqual([]);
  });
});
