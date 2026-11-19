import { describe, expect, test } from "bun:test";
import { ownerFindings, type GitFacts } from "./owner.ts";
import { yourSideSection, type Report } from "./report.ts";

const NOW = Date.parse("2026-11-19T12:00:00Z"), DAY = 86_400_000;
const facts = (over: Partial<GitFacts> = {}): GitFacts => ({ worktrees: [], merged: [], fileAge: () => NOW - 10 * DAY, ...over });
const brief = (over: object = {}) => ({ generated: "", project: "p", inFlight: [], paused: [], learned: [], waiting: [], drift: [], next: null, answered: [], ...over }) as any;

describe("the owner's side", () => {
  test("a decision past its threshold is flagged with what it blocks; a fresh one is not", () => {
    const w = (id: string) => ({ kind: "decision", id, title: `Pick ${id}`, detail: "", actions: [], decision: { options: [], recommendation: null, unblocks: "plan-x", file: `decisions/${id}.md` } });
    const f = ownerFindings([{ name: "p", path: "/p", brief: brief({ waiting: [w("old"), w("new")] }) }], () => facts({ fileAge: (f) => (f.includes("old") ? NOW - 5 * DAY : NOW - DAY) }), {}, NOW);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: "high", title: "A decision has waited 5 days", evidence: "Pick old; it blocks plan-x" });
  });

  test("idle worktrees, merged branches and quiet doing plans each get one action", () => {
    const g = facts({ worktrees: [{ path: "/p/.wt/a", branch: "a", lastCommit: NOW - 9 * DAY, dirty: false }, { path: "/p/.wt/b", branch: "b", lastCommit: NOW - DAY, dirty: true }], merged: ["old-1", "old-2"] });
    const inFlight = [{ planId: "q", title: "Q", status: "doing", touches: [], claim: null, sessions: [], outOfScope: [], unrecorded: 0, actions: [] }];
    const f = ownerFindings([{ name: "p", path: "/p", brief: brief({ inFlight }) }], () => g, {}, NOW);
    expect(f.map((x) => x.title)).toEqual(["A worktree idle for 9 days", "2 branch(es) merged and not deleted", "1 plan(s) doing with no claim and no commit for a week"]);
    expect(f[0].action).toBe("Remove it: git worktree remove /p/.wt/a");
  });

  test("the pass can be turned off and tuned", () => {
    const g = facts({ worktrees: [{ path: "/w", branch: "a", lastCommit: NOW - 9 * DAY, dirty: false }] });
    const input = [{ name: "p", path: "/p", brief: brief() }];
    expect(ownerFindings(input, () => g, { off: true }, NOW)).toEqual([]);
    expect(ownerFindings(input, () => g, { idleDays: 14 }, NOW)).toEqual([]);
  });

  test("the section keeps the agent's review apart and offers the prompt", () => {
    const html = yourSideSection({ yourSide: [], review: { text: "<b>x</b>", at: "2026-11-19T10:00:00Z" }, reviewPrompt: "Review my side" } as unknown as Report, () => "");
    expect(html).toContain("An agent's reading, written 2026-11-19");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("Copy the review prompt");
  });
});

test("two registry entries over one repository give one finding naming both", () => {
  const g = facts({ merged: ["x"] });
  const f = ownerFindings([{ name: "a", path: "/r", brief: brief() }, { name: "b", path: "/r", brief: brief() }], () => g, {}, NOW);
  expect(f.map((x) => x.project)).toEqual(["a, b"]);
});
