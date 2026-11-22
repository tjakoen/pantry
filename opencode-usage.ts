// OpenCode V2's local HTTP API is the source of per-message provider, variant, tokens and cost.
// Keep this adapter optional: a missing service must not erase Claude's transcript usage.
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { areaOf, type UsageTurn } from "./usage.ts";

type ApiPage = { data: Record<string, any>[]; cursor?: { next?: string | null } };
type Get = (path: string) => Promise<ApiPage>;

export async function pages(get: Get, path: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await get(path + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""));
    out.push(...page.data);
    cursor = page.data.length ? page.cursor?.next ?? null : null;
    if (cursor && cursors.has(cursor)) throw new Error("OpenCode returned a repeated pagination cursor");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return out;
}

export function openCodeTurn(message: Record<string, any>, sessionId: string, root: string, parentId?: string): UsageTurn | null {
  if (message.type !== "assistant" || !message.tokens || !message.model?.providerID || !message.model?.id) return null;
  const model = message.model;
  const provider = model.providerID as string;
  const id = model.id as string;
  const ref = `${provider}/${id}${model.variant ? `#${model.variant}` : ""}`;
  const cost = typeof message.cost === "number" && Number.isFinite(message.cost) ? message.cost : null;
  // Zero reported cost is not evidence that a paid API route is free (subscriptions and delayed
  // provider billing both report zero). Free requires the actual OpenCode free route.
  const funding = ["opencode", "opencode-go"].includes(provider) && id.endsWith("-free") ? "free" : cost === null ? "unknown" : "paid";
  const tokens = message.tokens;
  const areas = new Set<string>();
  for (const block of message.content ?? []) {
    if (block.type !== "tool") continue;
    for (const key of ["path", "file_path", "notebook_path", "workdir"]) {
      const value = block.state?.input?.[key];
      if (typeof value === "string" && value) {
        const area = areaOf(root, value);
        if (area) areas.add(area);
      }
    }
    // OpenCode's patch tool carries file names inside its freeform input, not a path field.
    const patch = block.state?.input?.patchText;
    if (block.name === "patch" && typeof patch === "string") {
      for (const match of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
        const area = areaOf(root, match[1]);
        if (area) areas.add(area);
      }
    }
  }
  return {
    sessionId: parentId ?? sessionId, messageId: `${sessionId}:${message.id}`,
    at: new Date(message.time?.created ?? 0).toISOString(), model: ref,
    tokens: { input: tokens.input ?? 0, output: tokens.output ?? 0, cacheRead: tokens.cache?.read ?? 0, cacheWrite: tokens.cache?.write ?? 0 },
    areas: [...areas], subagent: !!parentId, provider, funding, reportedCost: cost, agentSessionId: sessionId,
  };
}

/** The server can change ports on restart. Discover only loopback listeners and prove /api/info
 *  before using one. PANTRY_OPENCODE_URL is the portable override for non-macOS hosts. */
export async function openCodeConnection(env: Record<string, string | undefined> = process.env): Promise<{ url: string; password: string } | null> {
  let password: string;
  try { password = JSON.parse(await readFile(join(homedir(), ".config/opencode/service.json"), "utf8")).password; }
  catch { return null; }
  const candidates = env.PANTRY_OPENCODE_URL
    ? [env.PANTRY_OPENCODE_URL]
    : process.platform === "darwin"
      ? [...new Set((spawnSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" }).stdout ?? "")
        .split("\n").filter((line) => /^opencode-/i.test(line)).map((line) => line.match(/127\.0\.0\.1:(\d+)/)?.[1]).filter(Boolean)
        .map((port) => `http://127.0.0.1:${port}`))]
      : [];
  for (const url of candidates) {
    try {
      const parsed = new URL(url);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) continue;
      const response = await fetch(new URL("/api/info", parsed), {
        headers: { Authorization: `Basic ${btoa(`opencode:${password}`)}` },
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok && (await response.json() as { version?: string }).version) return { url: parsed.origin, password };
    } catch { /* No local OpenCode service at this address. */ }
  }
  return null;
}

export async function readOpenCodeUsage(root: string, connection: { url: string; password: string }): Promise<UsageTurn[]> {
  const get: Get = async (path) => {
    const response = await fetch(`${connection.url}${path}`, {
      headers: { Authorization: `Basic ${btoa(`opencode:${connection.password}`)}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`OpenCode usage API returned ${response.status}`);
    return await response.json() as ApiPage;
  };
  const sessions = await pages(get, "/api/session?limit=100");
  const project = sessions.filter((s) => s.location?.directory && resolve(s.location.directory) === resolve(root));
  const ids = new Set(project.map((s) => s.id));
  const routes = await routedAttempts();
  const turns: UsageTurn[] = [];
  for (const session of project) {
    const messages = await pages(get, `/api/session/${encodeURIComponent(session.id)}/message?limit=100`);
    for (const message of messages) {
      const turn = openCodeTurn(message, session.id, root, session.parentID && ids.has(session.parentID) ? session.parentID : undefined);
      if (turn) {
        const route = routes.get(session.id);
        if (route && route.provider === turn.provider && route.id === message.model?.id) {
          turn.costClass = route.cost;
          turn.privateRoute = route.private;
        }
        turns.push(turn);
      }
    }
  }
  return turns;
}

type RoutedAttempt = { session: string; provider: string; id: string; cost: "free" | "plan" | "metered"; private: boolean };

/** Route-check's ledger is the authority for the selected cost class and privacy, not API billing. */
export async function routedAttempts(dir = join(homedir(), ".claude/state/usage")): Promise<Map<string, RoutedAttempt>> {
  const routes = new Map<string, RoutedAttempt>();
  let files: string[];
  try { files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort(); }
  catch { return routes; }
  for (const file of files) {
    let lines: string;
    try { lines = await readFile(join(dir, file), "utf8"); } catch { continue; }
    for (const line of lines.split("\n")) {
      try {
        const record = JSON.parse(line);
        if (record.harness === "opencode" && record.session && record.provider && record.id &&
          ["free", "plan", "metered"].includes(record.cost) && typeof record.private === "boolean") {
          routes.set(record.session, record as RoutedAttempt);
        }
      } catch { /* An incomplete or unrelated ledger line cannot affect OpenCode usage. */ }
    }
  }
  return routes;
}
