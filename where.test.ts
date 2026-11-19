import { describe, expect, test } from "bun:test";
import { buildWhere, codexSession, handoversOf, projectOfCwd, segmentsOf } from "./where.ts";
import { whereSection } from "./report.ts";
import type { ClaimLine } from "./orchestrator.ts";

const L = (planId: string, sessionId: string, tool: string, at: string, event: ClaimLine["event"], extra: Partial<ClaimLine> = {}): ClaimLine => ({ project: "p", planId, sessionId, tool: tool as ClaimLine["tool"], at, event, ...extra });

describe("where the work ran", () => {
  const lines = [
    L("a", "s1", "claude", "2026-11-19T08:00:00Z", "claim", { where: { machine: "air", model: "opus" } }),
    L("a", "s1", "claude", "2026-11-19T09:00:00Z", "release", { reason: "limit" }),
    L("a", "s2", "codex", "2026-11-19T12:00:00Z", "claim", { where: { machine: "pro" } }),
    L("a", "s2", "codex", "2026-11-19T12:30:00Z", "done"),
  ];

  test("stretches fold from the log, and a move between machines or harnesses is a handover", () => {
    const segs = segmentsOf(lines);
    expect(segs.map((s) => [s.tool, s.machine, s.end, s.to - s.from])).toEqual([["claude", "air", "release", 3_600_000], ["codex", "pro", "done", 1_800_000]]);
    expect(handoversOf(segs)).toEqual([{ project: "p", planId: "a", from: "claude on air", to: "codex on pro", gapMs: 3 * 3_600_000, landed: true }]);
  });

  test("a gap after a usage limit counts as stalled, and an unreadable harness is unknown, not zero", () => {
    const w = buildWhere(segmentsOf([...lines, L("b", "s3", "dsh", "2026-11-19T10:00:00Z", "claim")]), Date.parse("2026-11-18T00:00:00Z"), [], null);
    expect([w.activeMs, w.waitingMs, w.stalledMs]).toEqual([5_400_000, 10_800_000, 10_800_000]);
    expect(w.tokens.find((t) => t.tool === "dsh")?.tokens).toBeNull();
    const html = whereSection(w);
    expect(html).toContain("n = 3");
    expect(html).toContain("Shares are hidden");
    expect(html).not.toContain("<th>Share</th>");
  });

  test("a Codex log gives its working directory, model, final total and a limit hit", () => {
    const log = [
      { timestamp: "2026-11-19T08:00:00Z", type: "session_meta", payload: { session_id: "x", cwd: "/p/hau/sub" } },
      { timestamp: "2026-11-19T08:05:00Z", type: "turn_context", payload: { model: "gpt-6.1-sol" } },
      { timestamp: "2026-11-19T08:10:00Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 500 } }, rate_limits: { primary: { used_percent: 100 } } } },
    ].map((j) => JSON.stringify(j)).join("\n");
    const c = codexSession(log)!;
    expect([c.model, c.tokens, c.limitHit, c.to - c.from]).toEqual(["gpt-6.1-sol", 500, true, 600_000]);
    expect(projectOfCwd(c.cwd, [{ name: "hau", path: "/p/hau" }, { name: "p", path: "/p" }])).toBe("hau");
  });
});

test("a stretch with no recorded machine is not a handover", () => {
  const segs = segmentsOf([L("c", "s1", "claude", "2026-11-19T08:00:00Z", "claim"), L("c", "s1", "claude", "2026-11-19T08:10:00Z", "release"), L("c", "s2", "claude", "2026-11-19T09:00:00Z", "claim", { where: { machine: "air.local" } })]);
  expect(segs[1].machine).toBe("air");
  expect(handoversOf(segs)).toEqual([]);
});

test("a claim after a done reopens the plan, counted against the harness that said done", () => {
  const segs = segmentsOf([
    L("r", "s1", "codex", "2026-11-19T08:00:00Z", "claim"), L("r", "s1", "codex", "2026-11-19T08:30:00Z", "done"),
    L("r", "s2", "claude", "2026-11-19T10:00:00Z", "claim"), L("r", "s2", "claude", "2026-11-19T10:30:00Z", "done"),
  ]);
  const w = buildWhere(segs, 0, [], null);
  expect(w.outcomes.find((o) => o.key === "codex")).toEqual({ key: "codex", done: 1, released: 0, reopened: 1 });
  expect(w.outcomes.find((o) => o.key === "claude")?.reopened).toBe(0);
});
