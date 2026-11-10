import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessProjectDir } from "./context.ts";
import { aggregateUsage, areaOf, buildUsagePayload, claimWindows, parseTranscript, planFor } from "./usage.ts";
import type { ClaimLine } from "./orchestrator.ts";

const root = "/repo";
const line = (o: Record<string, unknown>) => JSON.stringify(o);
const asst = (id: string, at: string, model: string, usage: Record<string, number>, content: unknown[] = [], sessionId = "s1") =>
  line({ type: "assistant", sessionId, timestamp: at, message: { id, model, usage, content } });

describe("areaOf", () => {
  test("names the top-level directory, root files, and refuses paths outside", () => {
    expect(areaOf(root, "/repo/src/a.ts")).toBe("src");
    expect(areaOf(root, "README.md")).toBe("(root)");
    expect(areaOf(root, "/elsewhere/x.ts")).toBeNull();
  });
});

describe("parseTranscript", () => {
  test("dedupes one message written as several lines and merges their areas", () => {
    const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 };
    const text = [
      asst("m1", "2026-11-10T10:00:00Z", "claude-opus-5-5", u, [{ type: "tool_use", input: { file_path: "/repo/src/a.ts" } }]),
      asst("m1", "2026-11-10T10:00:00Z", "claude-opus-5-5", u, [{ type: "tool_use", input: { path: "/repo/docs" } }]),
      line({ type: "user", sessionId: "s1" }),
      "not json",
    ].join("\n");
    const { turns, skipped } = parseTranscript(text, root);
    expect(turns).toHaveLength(1);
    expect(turns[0].tokens).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 20 });
    expect(turns[0].areas.sort()).toEqual(["docs", "src"]);
    expect(skipped).toBe(1);
  });

  test("counts an assistant line without usage as skipped, so a format change is visible", () => {
    const { turns, skipped } = parseTranscript(line({ type: "assistant", sessionId: "s1", message: { id: "x" } }), root);
    expect(turns).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

describe("claim windows", () => {
  const c = (event: ClaimLine["event"], at: string, sessionId = "s1"): ClaimLine => ({ project: "p", planId: "plan-a", sessionId, tool: "claude", at, event });
  const windows = claimWindows([c("claim", "2026-11-10T10:00:00Z"), c("heartbeat", "2026-11-10T10:05:00Z"), c("release", "2026-11-10T10:30:00Z")], Date.parse("2026-11-10T12:00:00Z"));
  const turn = (at: string, sessionId = "s1") => ({ sessionId, messageId: at, at, model: "m", tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, areas: [], subagent: false });

  test("a turn inside the claim of its own session goes to the plan", () => {
    expect(planFor(turn("2026-11-10T10:10:00Z"), windows)).toBe("plan-a");
  });
  test("after release, or in another session, it is unclaimed", () => {
    expect(planFor(turn("2026-11-10T11:00:00Z"), windows)).toBe("(unclaimed)");
    expect(planFor(turn("2026-11-10T10:10:00Z", "s2"), windows)).toBe("(unclaimed)");
  });
  test("an unreleased claim stays open until now", () => {
    const open = claimWindows([c("claim", "2026-11-10T10:00:00Z")], Date.parse("2026-11-10T12:00:00Z"));
    expect(planFor(turn("2026-11-10T11:59:00Z"), open)).toBe("plan-a");
  });
});

describe("aggregateUsage", () => {
  test("splits a turn across its areas and keeps model and plan rows", () => {
    const turns = [
      { sessionId: "s1", messageId: "a", at: "2026-11-10T10:00:00Z", model: "opus", tokens: { input: 10, output: 100, cacheRead: 0, cacheWrite: 0 }, areas: ["src", "docs"], subagent: false },
      { sessionId: "s1", messageId: "b", at: "2026-11-10T10:01:00Z", model: "sonnet", tokens: { input: 4, output: 40, cacheRead: 7, cacheWrite: 0 }, areas: [], subagent: true },
    ];
    const p = aggregateUsage("p", "/x", turns, [], 0, "2026-11-10T12:00:00Z");
    expect(p.totals).toEqual({ input: 14, output: 140, cacheRead: 7, cacheWrite: 0 });
    expect(p.byModel.map((r) => r.key)).toEqual(["opus", "sonnet"]);
    expect(p.byArea.find((r) => r.key === "src")?.output).toBe(50);
    expect(p.byArea.find((r) => r.key === "(no files)")?.output).toBe(40);
    expect(p.byPlan).toEqual([{ key: "(unclaimed)", turns: 2, input: 14, output: 140, cacheRead: 7, cacheWrite: 0 }]);
  });
});

describe("buildUsagePayload", () => {
  test("reads session and subagent transcripts, ignores sessions.jsonl, and an absent dir is an empty table", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "pantry-usage-"));
    const proj = "/work/proj";
    const dir = harnessProjectDir(proj, configDir);
    await mkdir(join(dir, "s1", "subagents"), { recursive: true });
    const u = { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    await writeFile(join(dir, "s1.jsonl"), asst("m1", "2026-11-10T10:00:00Z", "opus", u));
    await writeFile(join(dir, "s1", "subagents", "agent-1.jsonl"), asst("m2", "2026-11-10T10:01:00Z", "haiku", u));
    await writeFile(join(dir, "sessions.jsonl"), "{\"kind\":\"start\"}");
    const p = await buildUsagePayload({ project: "proj", root: proj, configDir, claims: [], nowIso: "2026-11-10T12:00:00Z" });
    expect(p.turns).toBe(2);
    expect(p.skipped).toBe(0);
    expect(p.byModel.map((r) => r.key).sort()).toEqual(["haiku", "opus"]);

    const empty = await buildUsagePayload({ project: "none", root: "/nowhere", configDir, claims: [], nowIso: "2026-11-10T12:00:00Z" });
    expect(empty.turns).toBe(0);
  });
});

describe("usage page", () => {
  test("renders a table per breakdown, and an empty state that names the folder it read", async () => {
    const { usageBody } = await import("./usage-page.ts");
    const turns = [{ sessionId: "s1", messageId: "a", at: "2026-11-10T10:00:00Z", model: "claude-opus-5-5", tokens: { input: 1, output: 9, cacheRead: 50, cacheWrite: 0 }, areas: ["src"], subagent: false }];
    const html = usageBody(aggregateUsage("proj", "/x", turns, [], 0, "2026-11-10T12:00:00Z"));
    expect(html).toContain("By model");
    expect(html).toContain("claude-opus-5-5");
    expect(html).toContain("(unclaimed)");
    expect(html).toContain("--share:100.0%");
    const empty = usageBody(aggregateUsage("proj", "/nowhere", [], [], 0, "2026-11-10T12:00:00Z"));
    expect(empty).toContain("No usage recorded yet");
    expect(empty).toContain("/nowhere");
  });
});
