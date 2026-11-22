import { describe, expect, test } from "bun:test";
import { openCodeTurn, pages, routedAttempts } from "./opencode-usage.ts";
import { aggregateUsage, claimWindows } from "./usage.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("OpenCode usage", () => {
  const message = (providerID: string, id: string, cost: number | undefined = 0) => ({
    id: `msg_${id}`, type: "assistant", time: { created: Date.parse("2026-11-22T12:00:00Z") },
    model: { providerID, id, variant: "low" },
    tokens: { input: 12, output: 3, cache: { read: 9, write: 2 } }, cost,
    content: [{ type: "tool", state: { input: { path: "/repo/src/a.ts" } } }],
  });
  test("distinguishes free OpenCode from paid API routes, even when cost is zero", () => {
    expect(openCodeTurn(message("opencode", "deepseek-v4.1-flash-free"), "child", "/repo", "parent")?.funding).toBe("free");
    const paid = openCodeTurn(message("deepseek", "deepseek-v4.1-flash"), "child", "/repo", "parent")!;
    expect(paid.funding).toBe("paid");
    expect(paid.reportedCost).toBe(0);
    expect(paid.model).toBe("deepseek/deepseek-v4.1-flash#low");
    expect(paid.agentSessionId).toBe("child");
    expect(paid.sessionId).toBe("parent");
    expect(paid.areas).toEqual(["src"]);
    expect(openCodeTurn({ ...message("other", "model"), cost: undefined }, "s", "/repo")?.funding).toBe("unknown");
  });
  test("rolls subagents into the parent's claim but retains their own model", () => {
    const turn = openCodeTurn(message("opencode", "deepseek-v4.1-flash-free"), "child", "/repo", "parent")!;
    const claims = [{ project: "repo", planId: "plan-a", sessionId: "parent", tool: "codex" as const, at: "2026-11-22T11:00:00Z", event: "claim" as const }];
    const payload = aggregateUsage("repo", "api", [turn], claimWindows(claims, Date.parse("2026-11-22T13:00:00Z")), 0, "2026-11-22T13:00:00Z");
    expect(payload.byPlan[0].key).toBe("plan-a");
    expect(payload.bySession[0].key).toContain("child (subagent)");
    expect(payload.byFunding[0].key).toBe("free");
    expect(payload.byAreaModel[0].key).toBe("src · opencode/deepseek-v4.1-flash-free#low");
  });
  test("finds project areas in OpenCode's freeform patch tool", () => {
    const msg = { ...message("opencode", "deepseek-v4.1-flash-free"), content: [
      { type: "tool", name: "patch", state: { input: { patchText: "*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: docs/guide.md\n*** End Patch" } } },
    ] };
    expect(openCodeTurn(msg, "s", "/repo")?.areas).toEqual(["src", "docs"]);
  });
  test("follows the next cursor without dropping earlier messages", async () => {
    const requested: string[] = [];
    const records = await pages(async (path) => {
      requested.push(path);
      return path.includes("cursor=")
        ? { data: [{ id: "older" }], cursor: { next: null } }
        : { data: [{ id: "newer" }], cursor: { next: "cursor-value" } };
    }, "/api/session?limit=100");
    expect(records.map((r) => r.id)).toEqual(["newer", "older"]);
    expect(requested[1]).toContain("cursor=cursor-value");
  });
  test("reads recorded cost class and privacy without inferring them from a zero API charge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pantry-route-ledger-"));
    writeFileSync(join(dir, "2026-11-22.jsonl"), [
      JSON.stringify({ harness: "opencode", session: "child", provider: "openai", id: "gpt-6-luna", cost: "plan", private: true }),
      JSON.stringify({ harness: "opencode", session: "free-child", provider: "opencode", id: "deepseek-v4.1-flash-free", cost: "free", private: false }),
      "incomplete {",
    ].join("\n"));
    const routes = await routedAttempts(dir);
    const turn = openCodeTurn(message("openai", "gpt-6-luna"), "child", "/repo", "parent")!;
    turn.costClass = routes.get("child")?.cost;
    turn.privateRoute = routes.get("child")?.private;
    const payload = aggregateUsage("repo", "api", [turn], [], 0, "2026-11-22T13:00:00Z");
    expect(payload.bySession[0].key).toContain("openai/gpt-6-luna#low · plan · private");
    expect(routes.get("free-child")).toMatchObject({ cost: "free", private: false });
  });
});
