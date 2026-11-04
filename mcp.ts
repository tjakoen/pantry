// mcp.ts: the hub's MCP endpoint, so Claude Code and Codex reach every project's PANTRY as tools.
//
// Both tools speak MCP over Streamable HTTP, so one endpoint on the hub (POST /mcp) serves every
// agent in every project at once. This is the stateless subset of that transport: each POST carries
// one JSON-RPC message and gets one JSON response, with no session id and no server-sent events.
// Nothing here needs a stream, and a stateless server cannot leak one session's state into another.
//
// The tools are reads. They resolve the caller's project from a directory (the agent passes its own
// working directory) and fetch that project's existing machine-readable surfaces from its own
// PANTRY child, so the MCP layer adds no second implementation of anything PANTRY already serves.
// The one exception is `pantry_doctor`, which runs the doctor command in the project's checkout as
// the container sees it; a worktree outside the mounted code root is invisible to it, and the tool
// says so rather than checking the wrong tree.

import { join } from "node:path";
import { projectFor, type HubProject, type Registry } from "./hub.ts";
import { PANTRY_PREFIX } from "./preview.ts";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

const SURFACES = ["knowledge", "decisions", "answers", "runs", "timeline", "artifacts", "map"] as const;

const pathArg = {
  path: { type: "string", description: "An absolute directory inside the project, normally your working directory." },
};

export const TOOLS = [
  {
    name: "pantry_projects",
    description: "List every project the PANTRY hub serves, with its path, port and whether it is answering.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "pantry_orient",
    description: "Read the project's llms.txt: what an agent should read first to work this project (plans, docs, standards, recent runs). Call this at the start of work in a PANTRY project.",
    inputSchema: { type: "object", properties: pathArg, required: ["path"] },
  },
  {
    name: "pantry_read",
    description: `Read one of the project's machine-readable PANTRY surfaces as JSON: ${SURFACES.join(", ")}. knowledge is the full retrieval payload, decisions the open questions for the owner, answers the owner's recorded answers, runs the run ledger, timeline the plan timeline, artifacts the review artifacts, map the codebase mindmap.`,
    inputSchema: {
      type: "object",
      properties: { ...pathArg, surface: { type: "string", enum: [...SURFACES] } },
      required: ["path", "surface"],
    },
  },
  {
    name: "pantry_doctor",
    description: "Run the PANTRY doctor (kit compliance and staleness) on the project's checkout as the hub sees it. Read-only.",
    inputSchema: { type: "object", properties: pathArg, required: ["path"] },
  },
];

type Json = Record<string, unknown>;
const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

async function fetchSurface(p: HubProject, route: string): Promise<string | null> {
  for (const prefix of ["", PANTRY_PREFIX]) {
    try {
      const res = await fetch(`http://127.0.0.1:${p.port}${prefix}${route}`, { signal: AbortSignal.timeout(20_000) });
      if (res.ok) return await res.text();
    } catch { /* try the prefixed route */ }
  }
  return null;
}

export async function callTool(name: string, args: Json, reg: Registry, deps: {
  status: (p: HubProject) => Promise<Json>;
  cli?: string;
}): Promise<Json> {
  if (name === "pantry_projects") {
    return text(JSON.stringify(await Promise.all(reg.projects.map(deps.status)), null, 2));
  }
  const dir = typeof args.path === "string" ? args.path : "";
  if (!dir) return text("Pass `path`: an absolute directory inside the project.", true);
  const p = projectFor(reg, dir);
  if (!p) return text(`No registered PANTRY project contains ${dir}. Run \`pantry register\` in the project, or check pantry_projects.`, true);

  if (name === "pantry_orient") {
    const body = await fetchSurface(p, "/llms.txt");
    return body ? text(body) : text(`${p.name}'s PANTRY on port ${p.port} did not answer.`, true);
  }
  if (name === "pantry_read") {
    const surface = String(args.surface ?? "");
    if (!(SURFACES as readonly string[]).includes(surface)) return text(`surface must be one of: ${SURFACES.join(", ")}`, true);
    const body = await fetchSurface(p, `/${surface}.json`);
    return body ? text(body) : text(`${p.name} did not serve /${surface}.json (surface off, or PANTRY not answering).`, true);
  }
  if (name === "pantry_doctor") {
    const proc = Bun.spawn(["bun", deps.cli ?? join(import.meta.dir, "cli.ts"), "doctor"], { cwd: p.path, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), 120_000);
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    return text(`${out}${err ? `\n${err}` : ""}\n(exit ${code}; checked ${p.path} as mounted in the hub)`, code !== 0 && !out);
  }
  return text(`Unknown tool: ${name}`, true);
}

/** Handle one JSON-RPC message. Returns null for a notification, which gets 202 and no body. */
export async function handleRpc(msg: Json, reg: Registry, deps: Parameters<typeof callTool>[3]): Promise<Json | null> {
  const id = msg.id ?? null;
  const method = String(msg.method ?? "");
  if (id === null || method.startsWith("notifications/")) return null;
  const ok = (result: Json) => ({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "pantry", version: "0.1.0" },
        instructions: "PANTRY serves the owner's projects. In a PANTRY project, call pantry_orient with your working directory before starting work.",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const params = (msg.params ?? {}) as Json;
      return ok(await callTool(String(params.name), (params.arguments ?? {}) as Json, reg, deps));
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

export async function handleMcpRequest(req: Request, reg: Registry, deps: Parameters<typeof callTool>[3]): Promise<Response> {
  if (req.method === "GET") return new Response("This endpoint does not offer a server-sent event stream.", { status: 405, headers: { Allow: "POST" } });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body: unknown;
  try { body = await req.json(); } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleRpc(m as Json, reg, deps)))).filter(Boolean);
    return out.length ? Response.json(out) : new Response(null, { status: 202 });
  }
  const res = await handleRpc(body as Json, reg, deps);
  return res ? Response.json(res) : new Response(null, { status: 202 });
}
