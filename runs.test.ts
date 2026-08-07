// pantry/runs.test.ts — piece 11c data layer. Assert the parse (frontmatter → RunReport), the LOOP §9
// gap detection (which is the load-bearing half: a report claiming evidence it does not carry must be
// caught), scope-growth measurement, the newest-first ordering, and the graceful degradations (absent
// dir, malformed file, README skip). Pure reads against a real temp runs dir.
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRunsPayload } from "./runs.ts";

const AT = "2026-08-07T00:00:00.000Z";

let dir: string; // the runs dir
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pantry-runs-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const build = () => buildRunsPayload({ projectName: "t", runsDir: dir }, AT);
const write = (name: string, body: string) => writeFile(join(dir, name), body);

// A report that satisfies every LOOP §9 item — the baseline each gap test breaks one field of.
const COMPLETE = `---
title: Pin the run-ledger schema
date: 2026-08-07
status: complete
branch: main
scope:
  - runs.ts
  - doctor.ts
touched:
  - runs.ts
  - doctor.ts
skills:
  - loop-standard
plans:
  - skills-runtime | /plans/skills-runtime
gates:
  - bun test | 132 pass, 0 fail
  - tsc --noEmit | clean
diffstat: 4 files changed, 210 insertions(+), 3 deletions(-)
dirty:
  - PLAN.md | lands with the next commit
unpushed: 2 | push is owner-gated
verifiedBy: reviewer subagent that did not write the change
doctor: 0 failing, 1 carried: e2e-presence
---
## Gate output

\`\`\`
132 pass
0 fail
\`\`\`

## What was not done

The age-based checks: their thresholds are owner-gated.

## What needs human eyes

Whether the schema's field names read right.
`;

/** COMPLETE with one frontmatter line removed, to isolate a single gap. */
const without = (key: string) =>
  COMPLETE.split("\n")
    .filter((l) => !l.startsWith(`${key}:`))
    .join("\n");

describe("buildRunsPayload — parsing", () => {
  test("a full report parses into a RunReport with no gaps", async () => {
    await write("2026-08-07-s3b.md", COMPLETE);
    const p = await build();
    expect(p.available).toBe(true);
    expect(p.runs).toHaveLength(1);
    const r = p.runs[0];
    expect(r.id).toBe("2026-08-07-s3b");
    expect(r.title).toBe("Pin the run-ledger schema");
    expect(r.status).toBe("complete");
    expect(r.date).toBe("2026-08-07");
    expect(r.branch).toBe("main");
    expect(r.scope).toEqual(["runs.ts", "doctor.ts"]);
    expect(r.touched).toEqual(["runs.ts", "doctor.ts"]);
    expect(r.skills).toEqual(["loop-standard"]);
    expect(r.plans).toEqual([{ label: "skills-runtime", detail: "/plans/skills-runtime" }]);
    expect(r.gates).toEqual([
      { label: "bun test", detail: "132 pass, 0 fail" },
      { label: "tsc --noEmit", detail: "clean" },
    ]);
    expect(r.diffstat).toBe("4 files changed, 210 insertions(+), 3 deletions(-)");
    expect(r.dirty).toEqual([{ label: "PLAN.md", detail: "lands with the next commit" }]);
    expect(r.unpushed).toEqual({ label: "2", detail: "push is owner-gated" });
    expect(r.verifiedBy).toBe("reviewer subagent that did not write the change");
    expect(r.doctor).toBe("0 failing, 1 carried: e2e-presence");
    expect(r.outOfScope).toEqual([]);
    expect(r.gaps).toEqual([]);
    expect(p.incompleteCount).toBe(0);
  });

  test("title falls back to the first heading, then to the id", async () => {
    await write("from-heading.md", `---\nstatus: complete\n---\n# The run that closed S3b\nbody`);
    await write("from-id.md", `no frontmatter, no heading`);
    const p = await build();
    expect(p.runs.find((r) => r.id === "from-heading")!.title).toBe("The run that closed S3b");
    expect(p.runs.find((r) => r.id === "from-id")!.title).toBe("from-id");
  });

  test("status defaults to complete; only partial/blocked (any case) flip it", async () => {
    await write("a.md", `---\n---\nno status`);
    await write("b.md", `---\nstatus: Partial\n---\n`);
    await write("c.md", `---\nstatus: blocked\n---\n`);
    await write("d.md", `---\nstatus: nonsense\n---\n`);
    const p = await build();
    const st = (id: string) => p.runs.find((r) => r.id === id)!.status;
    expect(st("a")).toBe("complete");
    expect(st("b")).toBe("partial");
    expect(st("c")).toBe("blocked");
    expect(st("d")).toBe("complete");
  });
});

describe("buildRunsPayload — LOOP §9 gaps", () => {
  const gapIds = async (body: string): Promise<string[]> => {
    await write("r.md", body);
    return (await build()).runs[0].gaps.map((g) => g.id);
  };

  test("a missing diffstat is a gap", async () => {
    expect(await gapIds(without("diffstat"))).toEqual(["diffstat"]);
  });

  test("a missing verifiedBy is a gap (§2 wants a pass by someone who did not write it)", async () => {
    expect(await gapIds(without("verifiedBy"))).toEqual(["verified-by"]);
  });

  test("a missing doctor line is a gap", async () => {
    expect(await gapIds(without("doctor"))).toEqual(["doctor"]);
  });

  test("a missing touched list is a gap (files unaccounted for)", async () => {
    const body = COMPLETE.replace("touched:\n  - runs.ts\n  - doctor.ts\n", "");
    expect(await gapIds(body)).toEqual(["touched"]);
  });

  test("no scope: at all is a gap, and suppresses the growth check rather than doubling it", async () => {
    const body = COMPLETE.replace("scope:\n  - runs.ts\n  - doctor.ts\n", "");
    expect(await gapIds(body)).toEqual(["scope"]);
  });

  test("a touched file outside the declared scope is measured growth, not silence (§4b)", async () => {
    const body = COMPLETE.replace("touched:\n  - runs.ts\n  - doctor.ts\n", "touched:\n  - runs.ts\n  - app.ts\n");
    await write("r.md", body);
    const r = (await build()).runs[0];
    expect(r.outOfScope).toEqual(["app.ts"]);
    expect(r.gaps.map((g) => g.id)).toEqual(["scope-growth"]);
    expect(r.gaps[0].label).toContain("app.ts");
  });

  test("a path UNDER a declared scope dir is inside the envelope", async () => {
    const body = COMPLETE.replace("scope:\n  - runs.ts\n  - doctor.ts\n", "scope:\n  - ./src\n")
      .replace("touched:\n  - runs.ts\n  - doctor.ts\n", "touched:\n  - src/runs.ts\n  - src/\n");
    await write("r.md", body);
    expect((await build()).runs[0].outOfScope).toEqual([]);
  });

  test("unpushed: absent is a gap; a nonzero count with no reason is a gap; 0 alone is fine", async () => {
    expect(await gapIds(without("unpushed"))).toEqual(["unpushed"]);
    expect(await gapIds(COMPLETE.replace("unpushed: 2 | push is owner-gated", "unpushed: 2"))).toEqual(["unpushed"]);
    expect(await gapIds(COMPLETE.replace("unpushed: 2 | push is owner-gated", "unpushed: 0"))).toEqual([]);
  });

  test("gate output that is prose rather than a fenced block is a gap — verbatim or it did not happen", async () => {
    const body = COMPLETE.replace("```\n132 pass\n0 fail\n```", "All tests passed.");
    await write("r.md", body);
    const gaps = (await build()).runs[0].gaps;
    expect(gaps.map((g) => g.id)).toEqual(["gate-output"]);
    expect(gaps[0].label).toContain("verbatim");
  });

  test("an EMPTY fenced block does not count as gate output", async () => {
    const body = COMPLETE.replace("132 pass\n0 fail", "   ");
    expect(await gapIds(body)).toEqual(["gate-output"]);
  });

  test("a missing 'Gate output' section reads differently from an unverbatim one", async () => {
    const body = COMPLETE.replace("## Gate output", "## Notes");
    await write("r.md", body);
    expect((await build()).runs[0].gaps[0].label).toContain("no 'Gate output' section");
  });

  test("an empty 'What was not done' is as much a gap as an absent one", async () => {
    const present = COMPLETE.replace("The age-based checks: their thresholds are owner-gated.", "");
    expect(await gapIds(present)).toEqual(["not-done"]);
    const absent = COMPLETE.replace("## What was not done", "## Leftovers");
    expect(await gapIds(absent)).toEqual(["not-done"]);
  });

  test("'What needs human eyes' is required too", async () => {
    const body = COMPLETE.replace("Whether the schema's field names read right.", "  ");
    expect(await gapIds(body)).toEqual(["human-eyes"]);
  });

  test("heading matching is tolerant of case and trailing punctuation", async () => {
    const body = COMPLETE.replace("## What was not done", "### what was NOT done:").replace("## What needs human eyes", "### What needs human eyes?");
    expect(await gapIds(body)).toEqual([]);
  });

  test("a section ends at the next same-or-higher heading, so a later section is not counted as its body", async () => {
    // "What was not done" is empty; the prose belongs to the section AFTER it and must not be borrowed.
    const body = COMPLETE.replace(
      "## What was not done\n\nThe age-based checks: their thresholds are owner-gated.\n",
      "## What was not done\n",
    );
    expect(await gapIds(body)).toEqual(["not-done"]);
  });

  test("a '#' line INSIDE the gate fence is output, not a heading — the section survives it", async () => {
    // The false positive this guards: real gate output is full of shell comments and log prefixes that
    // start with #. A line-by-line heading scan would end the Gate output section at `# bun test`,
    // before its own closing fence, and report the most correct possible report as missing evidence.
    const body = COMPLETE.replace("132 pass\n0 fail", "# bun test\n132 pass\n0 fail");
    expect(await gapIds(body)).toEqual([]);
  });

  test("a ``` inside a longer ```` fence does not end the block early", async () => {
    const body = COMPLETE.replace("```\n132 pass\n0 fail\n```", "````\n```\n132 pass\n```\n````");
    expect(await gapIds(body)).toEqual([]);
  });

  test("an UNCLOSED gate fence gaps everything after it, which is what markdown itself does", async () => {
    // An unclosed fence swallows the rest of the file, so the two later sections genuinely are not
    // headings any more. Reporting all three is the honest answer: the report broke at the fence.
    const body = COMPLETE.replace("```\n132 pass\n0 fail\n```", "```\n132 pass\n0 fail");
    expect(await gapIds(body)).toEqual(["gate-output", "not-done", "human-eyes"]);
  });

  test("a heading inside a fence does not open a section either", async () => {
    // "## What was not done" appears only inside the gate block — it must not count as the section.
    const body = COMPLETE.replace("132 pass\n0 fail", "## What was not done\n132 pass").replace(
      "## What was not done\n\nThe age-based checks: their thresholds are owner-gated.\n",
      "",
    );
    expect(await gapIds(body)).toEqual(["not-done"]);
  });

  test("CRLF line endings parse the same as LF", async () => {
    expect(await gapIds(COMPLETE.replace(/\n/g, "\r\n"))).toEqual([]);
  });

  test("a scope entry that is a string prefix of a different path is not a match", async () => {
    const body = COMPLETE.replace("scope:\n  - runs.ts\n  - doctor.ts\n", "scope:\n  - run\n");
    await write("r.md", body);
    expect((await build()).runs[0].outOfScope).toEqual(["runs.ts", "doctor.ts"]);
  });

  test("a heading indented 0-3 spaces is still a heading (CommonMark, and the fence regex allows it)", async () => {
    const body = COMPLETE.replace("## Gate output", "  ## Gate output").replace("## What needs human eyes", "   ## What needs human eyes");
    expect(await gapIds(body)).toEqual([]);
  });

  test("a heading paraphrased past its alias still matches — prefix, not equality", async () => {
    const body = COMPLETE.replace("## Gate output", "## Gates run").replace("## What was not done", "## What was not done yet");
    expect(await gapIds(body)).toEqual([]);
  });

  test("unpushed must be a COUNT — a hedge scores as a gap, not as evidence", async () => {
    expect(await gapIds(COMPLETE.replace("unpushed: 2 | push is owner-gated", "unpushed: some | owner-gated"))).toEqual(["unpushed"]);
    await write("r.md", COMPLETE.replace("unpushed: 2 | push is owner-gated", "unpushed: a few | owner-gated"));
    expect((await build()).runs[0].gaps[0].label).toContain("is not a count");
  });

  test("scope: . means the whole repo is in scope, not that nothing is", async () => {
    const body = COMPLETE.replace("scope:\n  - runs.ts\n  - doctor.ts\n", "scope:\n  - .\n");
    await write("r.md", body);
    const r = (await build()).runs[0];
    expect(r.outOfScope).toEqual([]);
    expect(r.gaps).toEqual([]);
  });

  test("path spellings that mean the same file do not read as scope growth", async () => {
    const body = COMPLETE.replace("scope:\n  - runs.ts\n  - doctor.ts\n", "scope:\n  - /Src/\n  - ./runs.ts\n")
      .replace("touched:\n  - runs.ts\n  - doctor.ts\n", "touched:\n  - src/a.ts\n  - /runs.ts\n");
    await write("r.md", body);
    expect((await build()).runs[0].outOfScope).toEqual([]);
  });

  test("a bare report is missing everything §9 asks for", async () => {
    await write("bare.md", `---\ntitle: I did some work\n---\nIt went well.`);
    const gaps = (await build()).runs[0].gaps.map((g) => g.id);
    expect(gaps).toEqual(["gate-output", "diffstat", "not-done", "human-eyes", "touched", "unpushed", "verified-by", "scope", "doctor"]);
  });
});

describe("buildRunsPayload — ordering + counts", () => {
  test("newest declared date first; undated reports sort last, not first", async () => {
    await write("old.md", `---\ndate: 2026-07-01\n---\n`);
    await write("new.md", `---\ndate: 2026-08-07\n---\n`);
    await write("undated.md", `---\n---\n`);
    const p = await build();
    expect(p.runs.map((r) => r.id)).toEqual(["new", "old", "undated"]);
    expect(p.count).toBe(3);
    expect(p.incompleteCount).toBe(3);
  });

  test("same-date reports are id-sorted for a stable order", async () => {
    await write("z.md", `---\ndate: 2026-08-07\n---\n`);
    await write("a.md", `---\ndate: 2026-08-07\n---\n`);
    expect((await build()).runs.map((r) => r.id)).toEqual(["a", "z"]);
  });
});

describe("buildRunsPayload — degradations", () => {
  test("an absent dir → available:false, empty list, no throw", async () => {
    const p = await buildRunsPayload({ projectName: "t", runsDir: join(dir, "nope") }, AT);
    expect(p.available).toBe(false);
    expect(p.runs).toEqual([]);
    expect(p.count).toBe(0);
  });

  test("an empty dir is available with zero runs (a repo that has not closed one yet)", async () => {
    const p = await build();
    expect(p.available).toBe(true);
    expect(p.runs).toEqual([]);
  });

  test("README.md and non-.md files are skipped", async () => {
    await write("README.md", "# how to write a run report");
    await write("notes.txt", "ignored");
    await write("real.md", COMPLETE);
    expect((await build()).runs.map((r) => r.id)).toEqual(["real"]);
  });

  test("a subdirectory named like a report does not crash the read", async () => {
    await mkdir(join(dir, "sub.md"));
    await write("ok.md", COMPLETE);
    expect((await build()).runs.map((r) => r.id)).toEqual(["ok"]);
  });
});

describe("buildRunsPayload — containment (this module reads CONTENTS, not just metadata)", () => {
  test("SECURITY: a symlink escaping the runs dir is NOT read (no outside file contents in a body)", async () => {
    const outside = await mkdtemp(join(tmpdir(), "pantry-runs-outside-"));
    try {
      await writeFile(join(outside, "secret.txt"), "an outside file's contents");
      await symlink(join(outside, "secret.txt"), join(dir, "escape.md"));
      await write("ok.md", COMPLETE);
      const p = await build();
      expect(p.runs.map((r) => r.id)).toEqual(["ok"]);
      expect(JSON.stringify(p)).not.toContain("an outside file's contents");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("a symlink pointing INSIDE the runs dir is still followed", async () => {
    await write("real.md", COMPLETE);
    await symlink(join(dir, "real.md"), join(dir, "alias.md"));
    expect((await build()).runs.map((r) => r.id)).toEqual(["alias", "real"]);
  });

  test("a broken symlink is skipped rather than crashing the read", async () => {
    await symlink(join(dir, "gone.md"), join(dir, "dangling.md"));
    await write("ok.md", COMPLETE);
    expect((await build()).runs.map((r) => r.id)).toEqual(["ok"]);
  });

  test("an unsafe-scheme plans href drops to label-only (decisions.ts's rule, same threat)", async () => {
    const body = COMPLETE.replace("  - skills-runtime | /plans/skills-runtime", "  - click me | javascript:alert(1)\n  - safe | /plans/skills-runtime");
    await write("r.md", body);
    expect((await build()).runs[0].plans).toEqual([{ label: "click me" }, { label: "safe", detail: "/plans/skills-runtime" }]);
  });
});
