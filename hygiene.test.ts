// pantry/hygiene.test.ts — S3a, the reading half. These assert what the module CLAIMS about git's
// output, against real git output shapes, through a fake runner: the temp dir is never a git repo, so
// nothing here depends on the machine it runs on or on what the estate's own tree happens to look like
// today. The judgement half (which fact crosses which line) is doctor.test.ts's.
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitRunner } from "./timeline.ts";
import { DEFAULT_HYGIENE, commitsSince, daysBetween, isSet, oldestDirty, parsePorcelain, plural, readHygieneState } from "./hygiene.ts";

const NOW = new Date("2026-08-11T00:00:00.000Z");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pantry-hygiene-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A git double keyed on the first two arguments — enough to tell the five calls apart, and it fails
 *  loudly (returns null, which every reader treats as "cannot say") on a call nobody taught it. */
const fakeGit = (answers: Record<string, string | null>): GitRunner => async (args) => {
  const key = args.slice(0, 2).join(" ");
  return key in answers ? answers[key] : null;
};

const REPO = { "rev-parse --is-inside-work-tree": "true\n" };

async function touch(path: string, daysOld: number) {
  const full = join(dir, path);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, "x");
  const t = new Date(NOW.getTime() - daysOld * 86_400_000);
  await utimes(full, t, t);
}

describe("parsePorcelain — the NUL form, because the newline form quotes paths", () => {
  test("plain modified and untracked entries", () => {
    expect(parsePorcelain(" M doctor.ts\0?? notes.md\0")).toEqual(["doctor.ts", "notes.md"]);
  });

  test("a path with a space survives verbatim (the whole reason for -z)", () => {
    expect(parsePorcelain(" M content/notes/a note.md\0")).toEqual(["content/notes/a note.md"]);
  });

  test("a rename is two records; the SOURCE is dropped so one change counts once", () => {
    // git writes the destination in the status record and the source in the record after it.
    expect(parsePorcelain("R  new.ts\0old.ts\0 M other.ts\0")).toEqual(["new.ts", "other.ts"]);
  });

  test("a copy behaves the same as a rename", () => {
    expect(parsePorcelain("C  copy.ts\0source.ts\0")).toEqual(["copy.ts"]);
  });

  test("a rename staged in the index only (RM) still consumes its source record", () => {
    expect(parsePorcelain("RM new.ts\0old.ts\0?? scratch.md\0")).toEqual(["new.ts", "scratch.md"]);
  });

  test("empty output and an unanswerable call are both no paths, not a throw", () => {
    expect(parsePorcelain("")).toEqual([]);
    expect(parsePorcelain(null)).toEqual([]);
  });
});

describe("oldestDirty — mtime, and what it is allowed to claim", () => {
  test("picks the oldest of several", async () => {
    await touch("a.ts", 2);
    await touch("b.ts", 40);
    await touch("c.ts", 9);
    const got = await oldestDirty(dir, ["a.ts", "b.ts", "c.ts"]);
    expect(got?.path).toBe("b.ts");
    expect(daysBetween(NOW, got!.at)).toBe(40);
  });

  test("a path that cannot be stat-ed is SKIPPED, not counted as brand new", async () => {
    // A deletion has no mtime. Treating it as age zero would make deleting a file look like tidying.
    await touch("kept.ts", 30);
    const got = await oldestDirty(dir, ["deleted.ts", "kept.ts"]);
    expect(got?.path).toBe("kept.ts");
  });

  test("nothing stat-able at all is null, never a zero-age entry", async () => {
    expect(await oldestDirty(dir, ["gone.ts"])).toBeNull();
  });

  test("no dirty paths is null", async () => {
    expect(await oldestDirty(dir, [])).toBeNull();
  });
});

describe("readHygieneState — every fact, or an honest nothing", () => {
  test("not a work tree → isRepo false and every field empty", async () => {
    const s = await readHygieneState(dir, fakeGit({}));
    expect(s.isRepo).toBe(false);
    expect(s.dirty).toEqual([]);
    expect(s.unpushedCount).toBe(0);
    expect(s.oldestUnpushed).toBeNull();
    expect(s.remotes).toEqual([]);
  });

  test("a clean repo with a remote and an upstream, nothing ahead", async () => {
    const s = await readHygieneState(dir, fakeGit({
      ...REPO,
      "status --porcelain": "",
      remote: "origin\n",
      "rev-parse --abbrev-ref": "origin/main\n",
      "log --format=%cI": "",
    }));
    expect(s.isRepo).toBe(true);
    expect(s.remotes).toEqual(["origin"]);
    expect(s.upstream).toBe("origin/main");
    expect(s.dirty).toEqual([]);
    expect(s.oldestDirty).toBeNull();
    expect(s.unpushedCount).toBe(0);
  });

  test("no remote configured is a state, not an error", async () => {
    const s = await readHygieneState(dir, fakeGit({ ...REPO, "status --porcelain": "", remote: "" }));
    expect(s.isRepo).toBe(true);
    expect(s.remotes).toEqual([]);
    expect(s.upstream).toBeNull();
  });

  test("a branch with no upstream reports none, and counts nothing against nothing", async () => {
    const s = await readHygieneState(dir, fakeGit({
      ...REPO,
      "status --porcelain": "",
      remote: "origin\n",
      // git exits nonzero here when there is no upstream; the runner turns that into null.
      "rev-parse --abbrev-ref": null,
      "log --format=%cI": "2026-08-01T10:00:00+02:00\n",
    }));
    expect(s.upstream).toBeNull();
    expect(s.unpushedCount).toBe(0); // NOT the log's line count — there was no baseline to count from
  });

  test("ahead by three: the count is the lines, the oldest is the LAST one", async () => {
    const s = await readHygieneState(dir, fakeGit({
      ...REPO,
      "status --porcelain": "",
      remote: "origin\n",
      "rev-parse --abbrev-ref": "origin/main\n",
      // git log walks newest first, so the oldest unpushed commit is the final line.
      "log --format=%cI": "2026-08-10T09:00:00Z\n2026-08-06T09:00:00Z\n2026-07-28T09:00:00Z\n",
    }));
    expect(s.unpushedCount).toBe(3);
    // 2026-07-28T09:00Z to 2026-08-11T00:00Z is 13.6 days, and the floor is the point: 13, not 14.
    expect(daysBetween(NOW, s.oldestUnpushed!)).toBe(13);
  });

  test("an unparseable commit date leaves the count intact and the age null", async () => {
    const s = await readHygieneState(dir, fakeGit({
      ...REPO,
      "status --porcelain": "",
      remote: "origin\n",
      "rev-parse --abbrev-ref": "origin/main\n",
      "log --format=%cI": "not a date\n",
    }));
    expect(s.unpushedCount).toBe(1);
    expect(s.oldestUnpushed).toBeNull();
  });

  test("dirty paths are stat-ed against the real tree", async () => {
    await touch("plans/thing.md", 12);
    await touch("doctor.ts", 1);
    const s = await readHygieneState(dir, fakeGit({
      ...REPO,
      "status --porcelain": " M doctor.ts\0?? plans/thing.md\0",
      remote: "origin\n",
      "rev-parse --abbrev-ref": "origin/main\n",
      "log --format=%cI": "",
    }));
    expect(s.dirty).toEqual(["doctor.ts", "plans/thing.md"]);
    expect(s.oldestDirty?.path).toBe("plans/thing.md");
    expect(daysBetween(NOW, s.oldestDirty!.at)).toBe(12);
  });
});

describe("commitsSince — commits with no report behind them", () => {
  test("counts from the end of the report's day, so the report's own commits are covered", async () => {
    let seen: string[] = [];
    const git: GitRunner = async (args) => { seen = args; return "7\n"; };
    expect(await commitsSince(dir, git, "2026-08-09")).toBe(7);
    expect(seen).toContain("--since=2026-08-09T23:59:59");
  });

  test("no report at all counts the whole history", async () => {
    let seen: string[] = [];
    const git: GitRunner = async (args) => { seen = args; return "212\n"; };
    expect(await commitsSince(dir, git, null)).toBe(212);
    expect(seen.some((a) => a.startsWith("--since="))).toBe(false);
  });

  test("git that cannot answer is null, never zero", async () => {
    expect(await commitsSince(dir, async () => null, "2026-08-09")).toBeNull();
  });

  test("output that is not a number is null, never NaN leaking into a comparison", async () => {
    expect(await commitsSince(dir, async () => "fatal: bad revision\n", null)).toBeNull();
  });
});

// Pinned deliberately. These four are the only numbers in the module that are an agreement rather
// than a measurement (owner, 2026-08-11), and the failure mode they guard against is silent: a
// later session tuning one because a warn annoyed it would move an estate-wide line with nothing on
// screen saying so. Changing them means changing this test, which means saying why in a diff.
describe("DEFAULT_HYGIENE — the owner's numbers, pinned", () => {
  test("option B, a working week", () => {
    expect(DEFAULT_HYGIENE).toEqual({
      uncommittedMaxAgeDays: 5,
      unpushedMaxAgeDays: 5,
      unpushedMaxCommits: 25,
      runReportMaxCommits: 15,
    });
  });

  test("every default is a real line, so nothing ships muted by accident", () => {
    expect(Object.values(DEFAULT_HYGIENE).every(isSet)).toBe(true);
  });
});

describe("the small shared pieces", () => {
  test("isSet: a positive finite number is a line; anything else is muted", () => {
    expect(isSet(5)).toBe(true);
    expect(isSet(0.5)).toBe(true);
    expect(isSet(Infinity)).toBe(false);
    expect(isSet(0)).toBe(false);
    expect(isSet(-1)).toBe(false);
    expect(isSet(NaN)).toBe(false);
  });

  test("daysBetween floors, so a 29.9-day-old change has not crossed 30", () => {
    const then = new Date(NOW.getTime() - 29.9 * 86_400_000);
    expect(daysBetween(NOW, then)).toBe(29);
  });

  test("plural says it once so four detail lines cannot disagree", () => {
    expect(plural(1, "commit")).toBe("1 commit");
    expect(plural(0, "commit")).toBe("0 commits");
    expect(plural(2, "day")).toBe("2 days");
  });
});
