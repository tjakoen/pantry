import { describe, expect, test } from "bun:test";
import { handleRpc, TOOLS } from "./mcp.ts";

const reg = { hubPort: 4400, projects: [{ name: "site", path: "/w/site", port: 4401 }] };
const deps = { status: async (p: { name: string }) => ({ ...p, up: true }) };

describe("hub MCP endpoint", () => {
  test("initialize advertises tools", async () => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, reg, deps);
    expect((r?.result as { capabilities: object }).capabilities).toEqual({ tools: {} });
  });
  test("notifications get no response", async () => {
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, reg, deps)).toBeNull();
  });
  test("tools/list returns every tool", async () => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, reg, deps);
    expect((r?.result as { tools: unknown[] }).tools.length).toBe(TOOLS.length);
  });
  test("a path outside every project is an error result, not a crash", async () => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "pantry_orient", arguments: { path: "/elsewhere" } } }, reg, deps);
    expect((r?.result as { isError?: boolean }).isError).toBe(true);
  });
  test("pantry_projects reports status", async () => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "pantry_projects", arguments: {} } }, reg, deps);
    expect(JSON.stringify(r)).toContain('\\"up\\": true');
  });
  test("unknown method is a JSON-RPC error", async () => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 5, method: "resources/list" }, reg, deps);
    expect((r?.error as { code: number }).code).toBe(-32601);
  });
});

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("orchestration tools", () => {
  const root = mkdtempSync(join(tmpdir(), "pantry-mcp-orch-"));
  const proj = join(root, "proj");
  mkdirSync(join(proj, "plans/decisions"), { recursive: true });
  writeFileSync(join(proj, "pantry.config.json"), JSON.stringify({ projectName: "proj", plansDir: "./plans" }));
  const fm = (id: string, owner: string, extra = "") => `---\nid: ${id}\nstatus: todo\ntrack: t\ndepends: []\nowner: ${owner}\n${extra}---\n\n# ${id}\n`;
  writeFileSync(join(proj, "plans/alpha.md"), fm("alpha", "ai"));
  writeFileSync(join(proj, "plans/beta.md"), fm("beta", "human"));
  writeFileSync(join(proj, "plans/gamma.md"), fm("gamma", "ai"));
  writeFileSync(join(proj, "plans/decisions/hold.md"), "---\ntitle: Hold gamma?\nstatus: open\nblocks:\n  - gamma\n---\n");
  const reg2 = { hubPort: 4400, projects: [{ name: "proj", path: proj, port: 4401 }] };
  const deps2 = { status: async () => ({}), home: join(root, "home") };
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: { path: proj, ...args } } }, reg2, deps2);
    const res = r?.result as { content: { text: string }[]; isError?: boolean };
    return { text: res.content[0].text, isError: !!res.isError };
  };

  test("next offers only the ai plan with no blocking decision", async () => {
    const r = JSON.parse((await call("pantry_next", {})).text);
    expect(r.ready.map((p: { id: string }) => p.id)).toEqual(["alpha"]);
    expect(r.skipped.map((s: { id: string; reasons: string[] }) => `${s.id}:${s.reasons[0]}`)).toEqual(["beta:owner: human", "gamma:decision: hold"]);
  });

  test("claim, second claim, heartbeat, claims, release round-trip", async () => {
    expect((await call("pantry_claim", { planId: "alpha", sessionId: "s1", tool: "claude" })).isError).toBe(false);
    const second = await call("pantry_claim", { planId: "alpha", sessionId: "s2", tool: "codex" });
    expect(second.isError && second.text).toContain("claimed by claude s1");
    expect((await call("pantry_heartbeat", { planId: "alpha", sessionId: "s1" })).isError).toBe(false);
    expect(JSON.parse((await call("pantry_claims", {})).text)[0].state).toBe("active");
    expect((await call("pantry_release", { planId: "alpha", sessionId: "s1", outcome: "released" })).isError).toBe(false);
    expect(JSON.parse((await call("pantry_next", {})).text).ready.map((p: { id: string }) => p.id)).toEqual(["alpha"]);
  });

  test("a path in no project errors and writes nothing", async () => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "pantry_claim", arguments: { path: "/nowhere", planId: "alpha", sessionId: "s", tool: "claude" } } }, reg2, deps2);
    expect((r?.result as { isError?: boolean }).isError).toBe(true);
  });
});

describe("pantry_orient", () => {
  const call = async (port: number) => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "pantry_orient", arguments: { path: "/w/site" } } },
      { hubPort: 4400, projects: [{ name: "site", path: "/w/site", port }] }, deps);
    return r?.result as { content: { text: string }[]; isError?: boolean };
  };

  test("returns the brief before llms.txt", async () => {
    const server = Bun.serve({ port: 0, fetch: (req) => {
      const p = new URL(req.url).pathname;
      if (p === "/brief.txt") return new Response("# site: where the AI work stands\n");
      if (p === "/llms.txt") return new Response("# llms\n");
      return new Response("no", { status: 404 });
    } });
    try {
      const text = (await call(server.port!)).content[0].text;
      expect(text.startsWith("# site: where the AI work stands")).toBe(true);
      expect(text).toContain("# llms");
    } finally { server.stop(true); }
  });

  test("falls back to llms.txt alone when the brief does not answer", async () => {
    const server = Bun.serve({ port: 0, fetch: (req) => new URL(req.url).pathname === "/llms.txt" ? new Response("# llms\n") : new Response("no", { status: 404 }) });
    try {
      const r = await call(server.port!);
      expect(r.isError).toBeFalsy();
      expect(r.content[0].text).toBe("# llms\n");
    } finally { server.stop(true); }
  });
});

describe("unread answers reach a running agent", () => {
  test("they come back flagged for the plan the decision holds", async () => {
    const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { unreadAnswers } = await import("./mcp.ts");
    const root = await mkdtemp(join(tmpdir(), "pantry-ua-"));
    await mkdir(join(root, "plans", "decisions"), { recursive: true });
    const line = (o: object) => JSON.stringify(o) + "\n";
    await writeFile(join(root, "plans", "decisions", "answers.jsonl"),
      line({ kind: "answer", id: "a-1", at: "2026-11-04T10:00:00Z", via: "t", choice: "B", request: { source: "decision", ref: "d1", question: "Pick?" } })
      + line({ kind: "answer", id: "a-2", at: "2026-11-04T10:01:00Z", via: "t", choice: "C", request: { source: "decision", ref: "d2", question: "Other?" } }));
    const r = await unreadAnswers(root, [{ id: "d2", blocks: ["p1"] }], "p1") as { answers: { id: string; forYourPlan: boolean }[] };
    expect(r.answers.map((a) => [a.id, a.forYourPlan])).toEqual([["a-2", true], ["a-1", false]]);
    expect((r as unknown as { answersNote: string }).answersNote).toContain("separate session");
    expect((r.answers[0] as unknown as { handoff: string }).handoff).toContain("pantry answers ack a-2");
  });
});
