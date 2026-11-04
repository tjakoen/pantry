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
