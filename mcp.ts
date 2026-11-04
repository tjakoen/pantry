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
import { homedir } from "node:os";
import {
  claimPlan, claimsFile, foldClaims, listClaims, loadProjectWork, readClaims, readyPlans, ttlMs, updateClaim,
} from "./orchestrator.ts";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

const SURFACES = ["brief", "knowledge", "decisions", "answers", "runs", "timeline", "artifacts", "map"] as const;

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
    description: "Read the project's alignment brief (what is in flight, what was written outside its plan, what waits on the owner, what drifted, what is next), then its llms.txt: what an agent should read first to work this project (plans, docs, standards, recent runs). Call this at the start of work in a PANTRY project.",
    inputSchema: { type: "object", properties: pathArg, required: ["path"] },
  },
  {
    name: "pantry_read",
    description: `Read one of the project's machine-readable PANTRY surfaces as JSON: ${SURFACES.join(", ")}. brief is the alignment brief, knowledge the full retrieval payload, decisions the open questions for the owner, answers the owner's recorded answers, runs the run ledger, timeline the plan timeline, artifacts the review artifacts, map the codebase mindmap.`,
    inputSchema: {
      type: "object",
      properties: { ...pathArg, surface: { type: "string", enum: [...SURFACES] } },
      required: ["path", "surface"],
    },
  },
  {
    name: "pantry_next",
    description: "List the plans in this project an agent may take now (status todo, owner ai, dependencies done, no open decision blocking it, unclaimed), in board order, then every other todo plan with the reasons it is held. Call this before choosing work in a PANTRY project.",
    inputSchema: { type: "object", properties: pathArg, required: ["path"] },
  },
  {
    name: "pantry_claim",
    description: "Claim a ready plan before starting it, so no other session takes it. Then set the plan's status to doing in its file. Heartbeat every 10 minutes while working.",
    inputSchema: {
      type: "object",
      properties: { ...pathArg, planId: { type: "string" }, sessionId: { type: "string", description: "Your session id." }, tool: { type: "string", enum: ["claude", "codex"] } },
      required: ["path", "planId", "sessionId", "tool"],
    },
  },
  {
    name: "pantry_heartbeat",
    description: "Keep your claim alive. Claims expire after 30 minutes without one. The reply carries any answers the owner has recorded that no session has acted on, flagged forYourPlan when they concern this plan: read them every time.",
    inputSchema: { type: "object", properties: { ...pathArg, planId: { type: "string" }, sessionId: { type: "string" } }, required: ["path", "planId", "sessionId"] },
  },
  {
    name: "pantry_release",
    description: "End your claim: outcome done when the plan is finished (also set status: done in the plan file), released when you are handing it back unfinished.",
    inputSchema: {
      type: "object",
      properties: { ...pathArg, planId: { type: "string" }, sessionId: { type: "string" }, outcome: { type: "string", enum: ["done", "released"] } },
      required: ["path", "planId", "sessionId", "outcome"],
    },
  },
  {
    name: "pantry_claims",
    description: "List active claims in this project and claims that ended in the last 24 hours.",
    inputSchema: { type: "object", properties: pathArg, required: ["path"] },
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

/** The owner's unacked answers for a project, the ones touching `planId` first. */
export async function unreadAnswers(projectPath: string, decisions: { id: string; blocks: string[] }[], planId: string): Promise<{ answers?: unknown[]; answersNote?: string }> {
  try {
    const { loadPantryConfig } = await import("./config.ts");
    const { readAnswerLog, unacked, answerHandoff, ANSWER_ROUTING } = await import("./answers.ts");
    const pending = unacked(await readAnswerLog((await loadPantryConfig(projectPath)).answersLog));
    if (!pending.length) return {};
    const rows = pending.map((a) => ({
      id: a.id,
      decision: a.request.ref,
      question: a.request.question,
      answer: a.choice,
      ...(a.notes ? { notes: a.notes } : {}),
      forYourPlan: decisions.some((d) => d.id === a.request.ref && d.blocks.includes(planId)),
      handoff: answerHandoff(a),
    })).sort((x, y) => Number(y.forYourPlan) - Number(x.forYourPlan));
    return { answers: rows, answersNote: `The owner answered these. ${ANSWER_ROUTING}` };
  } catch {
    return {};
  }
}

export async function callTool(name: string, args: Json, reg: Registry, deps: {
  status: (p: HubProject) => Promise<Json>;
  cli?: string;
  home?: string;
}): Promise<Json> {
  if (name === "pantry_projects") {
    return text(JSON.stringify(await Promise.all(reg.projects.map(deps.status)), null, 2));
  }
  const dir = typeof args.path === "string" ? args.path : "";
  if (!dir) return text("Pass `path`: an absolute directory inside the project.", true);
  const p = projectFor(reg, dir);
  if (!p) return text(`No registered PANTRY project contains ${dir}. Run \`pantry register\` in the project, or check pantry_projects.`, true);

  if (name === "pantry_orient") {
    // The brief first: what is in flight, what strayed from its plan, what waits on the owner. The
    // agent reads the same account the owner sees on the home page, then the reading list.
    const [brief, body] = await Promise.all([fetchSurface(p, "/brief.txt"), fetchSurface(p, "/llms.txt")]);
    if (!brief && !body) return text(`${p.name}'s PANTRY on port ${p.port} did not answer.`, true);
    return text([brief, body].filter(Boolean).join("\n\n---\n\n"));
  }
  if (name === "pantry_read") {
    const surface = String(args.surface ?? "");
    if (!(SURFACES as readonly string[]).includes(surface)) return text(`surface must be one of: ${SURFACES.join(", ")}`, true);
    const body = await fetchSurface(p, `/${surface}.json`);
    return body ? text(body) : text(`${p.name} did not serve /${surface}.json (surface off, or PANTRY not answering).`, true);
  }
  if (name.startsWith("pantry_") && ["pantry_next", "pantry_claim", "pantry_heartbeat", "pantry_release", "pantry_claims"].includes(name)) {
    const home = deps.home ?? process.env.PANTRY_HOME ?? join(homedir(), ".pantry");
    const file = claimsFile(home, p.name);
    const { plans, decisions } = await loadProjectWork(p.path);
    const ctx = { file, project: p.name, plans, decisions };
    const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
    const reply = (r: { ok: true; value: unknown } | { ok: false; error: string }) =>
      r.ok ? text(JSON.stringify(r.value, null, 2)) : text(r.error, true);
    if (name === "pantry_next" || name === "pantry_claims") {
      const now = Date.now();
      const doneInFile = new Set(plans.filter((x) => x.status === "done").map((x) => x.id));
      const lines = await readClaims(file);
      if (name === "pantry_claims") return text(JSON.stringify(listClaims(lines, now, ttlMs(), doneInFile), null, 2));
      return text(JSON.stringify({ project: p.name, ...readyPlans(plans, decisions, foldClaims(lines, now, ttlMs(), doneInFile)) }, null, 2));
    }
    // Claim and heartbeat replies carry the owner's unread answers. This is how an answer recorded on
    // the command center reaches a session that is already running, without PANTRY ever pushing: the
    // agent asks every ten minutes anyway, and the reply is where it finds out.
    const withAnswers = async (r: { ok: true; value: unknown } | { ok: false; error: string }, planId: string) => {
      if (!r.ok) return reply(r);
      const answers = await unreadAnswers(p.path, decisions, planId);
      return text(JSON.stringify({ ...(r.value as object), ...answers }, null, 2));
    };
    if (name === "pantry_claim") return withAnswers(await claimPlan(ctx, str("planId"), str("sessionId"), str("tool")), str("planId"));
    if (name === "pantry_heartbeat") return withAnswers(await updateClaim(ctx, str("planId"), str("sessionId"), "heartbeat"), str("planId"));
    const outcome = str("outcome");
    if (outcome !== "done" && outcome !== "released") return text("outcome must be done or released", true);
    return reply(await updateClaim(ctx, str("planId"), str("sessionId"), outcome === "done" ? "done" : "release"));
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
