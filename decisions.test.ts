// pantry/decisions.test.ts — piece 11d data layer. Assert the parse (frontmatter → DecisionRequest),
// the open-before-resolved ordering, the graceful degradations (absent dir, malformed file, README
// skip), and the "label | href" evidence split. Pure reads against a real temp decisions dir.
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDecisionsPayload } from "./decisions.ts";

const AT = "2026-07-26T00:00:00.000Z";

let dir: string;      // the decisions dir
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pantry-decisions-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const build = () => buildDecisionsPayload({ projectName: "t", decisionsDir: dir }, AT);
const write = (name: string, body: string) => writeFile(join(dir, name), body);

describe("buildDecisionsPayload — parsing", () => {
  test("full frontmatter parses into a DecisionRequest", async () => {
    await write("datastore.md", `---
title: Which datastore for the ledger?
status: open
options:
  - Postgres — durable, needs a service
  - SQLite — zero-ops, single-writer
recommendation: SQLite — zero-ops, single-writer
evidence:
  - PLAN.md piece 11c | /docs/plans/pantry
  - a label-only note
---
The context an owner needs to decide.
`);
    const p = await build();
    expect(p.available).toBe(true);
    expect(p.decisions).toHaveLength(1);
    const d = p.decisions[0];
    expect(d.id).toBe("datastore");
    expect(d.title).toBe("Which datastore for the ledger?");
    expect(d.status).toBe("open");
    expect(d.options).toEqual(["Postgres — durable, needs a service", "SQLite — zero-ops, single-writer"]);
    expect(d.recommendation).toBe("SQLite — zero-ops, single-writer");
    expect(d.evidence).toEqual([
      { label: "PLAN.md piece 11c", href: "/docs/plans/pantry" },
      { label: "a label-only note" },
    ]);
    expect(d.body.trim()).toBe("The context an owner needs to decide.");
  });

  test("an unsafe-scheme evidence href is dropped to label-only (no javascript:/data: links)", async () => {
    await write("evil.md", `---
status: open
evidence:
  - click me | javascript:alert(1)
  - data uri | data:text/html,<script>1</script>
  - safe path | /docs/plans/pantry
  - safe url | https://example.com
---
body`);
    const d = (await build()).decisions[0];
    expect(d.evidence).toEqual([
      { label: "click me" },                                  // javascript: dropped
      { label: "data uri" },                                  // data: dropped
      { label: "safe path", href: "/docs/plans/pantry" },
      { label: "safe url", href: "https://example.com" },
    ]);
  });

  test("title falls back to the first heading, then to the id", async () => {
    await write("from-heading.md", `---
status: open
---
# The heading question
body`);
    await write("from-id.md", `body with no heading and no title`);
    const p = await build();
    expect(p.decisions.find((d) => d.id === "from-heading")!.title).toBe("The heading question");
    expect(p.decisions.find((d) => d.id === "from-id")!.title).toBe("from-id");
  });

  test("status defaults to open; only 'resolved' (any case) flips it", async () => {
    await write("a.md", `---\n---\nno status`);
    await write("b.md", `---\nstatus: Resolved\n---\ndone`);
    const p = await build();
    expect(p.decisions.find((d) => d.id === "a")!.status).toBe("open");
    expect(p.decisions.find((d) => d.id === "b")!.status).toBe("resolved");
  });
});

describe("buildDecisionsPayload — ordering + counts", () => {
  test("open decisions sort before resolved; each group id-sorted", async () => {
    await write("z-open.md", `---\nstatus: open\n---\n`);
    await write("a-resolved.md", `---\nstatus: resolved\n---\n`);
    await write("m-open.md", `---\nstatus: open\n---\n`);
    const p = await build();
    expect(p.decisions.map((d) => d.id)).toEqual(["m-open", "z-open", "a-resolved"]);
    expect(p.openCount).toBe(2);
    expect(p.resolvedCount).toBe(1);
  });
});

describe("buildDecisionsPayload — degradations", () => {
  test("an absent dir → available:false, empty list, no throw", async () => {
    const p = await buildDecisionsPayload({ projectName: "t", decisionsDir: join(dir, "nope") }, AT);
    expect(p.available).toBe(false);
    expect(p.decisions).toEqual([]);
  });

  test("README.md and non-.md files are skipped", async () => {
    await write("README.md", "# how to write a decision");
    await write("notes.txt", "ignored");
    await write("real.md", `---\nstatus: open\n---\n`);
    const p = await build();
    expect(p.decisions.map((d) => d.id)).toEqual(["real"]);
  });

  test("an empty dir is available with zero decisions (the healthy state)", async () => {
    const p = await build();
    expect(p.available).toBe(true);
    expect(p.decisions).toEqual([]);
    expect(p.openCount).toBe(0);
  });

  test("a subdirectory named like a decision does not crash the read", async () => {
    await mkdir(join(dir, "sub.md")); // a dir with a .md name — Bun.file().text() will throw, must skip
    await write("ok.md", `---\nstatus: open\n---\n`);
    const p = await build();
    expect(p.decisions.map((d) => d.id)).toEqual(["ok"]);
  });
});
