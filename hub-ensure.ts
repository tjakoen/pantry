// hub-ensure.ts: find the hub, start it when nothing answers, and bring the app forward.
//
// The desktop app and the session-start hook both need the same two answers: is the hub up, and
// where. `~/.pantry/hub.json` (PANTRY_HOME overrides) records the port and process id of the hub
// this machine last started; the health endpoint is the proof, because a pid file outlives a crash.
// A hub started some other way still counts as up when its port answers, and
// ensure then leaves it alone: it never starts a second hub on a port somebody already serves.

import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { DEFAULT_HUB_PORT, readRegistry, registryPath } from "./hub.ts";

export interface HubFile { port: number; pid: number; startedAt: string }
export interface HubHealth { ok: boolean; service?: string; pid?: number; needsYou?: number }

type Env = Record<string, string | undefined>;

export function pantryHome(env: Env = process.env): string {
  return env.PANTRY_HOME ?? join(homedir(), ".pantry");
}

export function hubFilePath(env: Env = process.env): string {
  return join(pantryHome(env), "hub.json");
}

export function readHubFile(file = hubFilePath()): HubFile | null {
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<HubFile>;
    return typeof raw.port === "number" ? { port: raw.port, pid: raw.pid ?? 0, startedAt: raw.startedAt ?? "" } : null;
  } catch {
    return null;
  }
}

export function writeHubFile(hub: HubFile, file = hubFilePath()): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(hub, null, 2) + "\n");
}

/** The port to look for: the registry's hub port, which is what `pantry hub` binds. hub.json is a
 *  record of the last start, not a setting, so the registry wins when the two disagree. */
export function hubPort(env: Env = process.env): number {
  return readRegistry(registryPath(env)).hubPort ?? DEFAULT_HUB_PORT;
}

export async function probeHealth(port: number, timeoutMs = 1500): Promise<HubHealth | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = (await res.json()) as HubHealth;
    return body && body.ok ? body : null;
  } catch {
    return null;
  }
}

export interface EnsureDeps {
  probe?: (port: number) => Promise<HubHealth | null>;
  /** Start the hub detached and return its pid. */
  start?: (env: Env) => number;
  sleep?: (ms: number) => Promise<void>;
  waitMs?: number;
}

export type EnsureResult =
  | { state: "running"; port: number; pid: number | null }
  | { state: "started"; port: number; pid: number }
  | { state: "failed"; port: number; pid: number; reason: string };

/** Start the hub as a process that outlives this one: own session, output to hub.log, no stdin. */
export function startHubDetached(env: Env = process.env): number {
  const home = pantryHome(env);
  mkdirSync(home, { recursive: true });
  const log = openSync(join(home, "hub.log"), "a");
  const child = spawn(process.execPath, [join(import.meta.dir, "cli.ts"), "hub"], {
    detached: true, stdio: ["ignore", log, log], env: { ...process.env, ...env },
  });
  child.unref();
  return child.pid ?? 0;
}

export async function ensureHub(env: Env = process.env, deps: EnsureDeps = {}): Promise<EnsureResult> {
  const probe = deps.probe ?? probeHealth;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const port = hubPort(env);
  const up = await probe(port);
  if (up) return { state: "running", port, pid: up.pid ?? readHubFile(hubFilePath(env))?.pid ?? null };

  const pid = (deps.start ?? startHubDetached)(env);
  writeHubFile({ port, pid, startedAt: new Date().toISOString() }, hubFilePath(env));
  const deadline = Date.now() + (deps.waitMs ?? 10_000);
  while (Date.now() < deadline) {
    if (await probe(port)) return { state: "started", port, pid };
    await sleep(200);
  }
  return { state: "failed", port, pid, reason: `nothing answered on port ${port}; see ${join(pantryHome(env), "hub.log")}` };
}

// --- pantry open --------------------------------------------------------------------------------

/** `pantry://project/<name>` brings the app forward on that project; bare `pantry://` on the hub. */
export function appLink(project?: string): string {
  return project ? `pantry://project/${encodeURIComponent(project)}` : "pantry://";
}

/** The hub routes /open/<name> to wherever that project answers right now. */
export function hubUrl(port: number, project?: string): string {
  return `http://localhost:${port}/${project ? `open/${encodeURIComponent(project)}` : ""}`;
}

export interface OpenDeps {
  platform?: NodeJS.Platform;
  /** Whether a handler for pantry:// is registered with the OS. */
  hasApp?: () => boolean;
  run?: (cmd: string[]) => void;
}

/** macOS asks Launch Services for the app's bundle id; elsewhere the app writes a marker on first
 *  launch, because Windows and Linux have no cheap "who handles this scheme" query from a script. */
export function appRegistered(platform: NodeJS.Platform = process.platform, env: Env = process.env): boolean {
  if (platform === "darwin") {
    const r = Bun.spawnSync(["mdfind", "kMDItemCFBundleIdentifier == 'dev.pantry.app'"]);
    if (r.stdout.toString().trim()) return true;
  }
  return existsSync(join(pantryHome(env), "app-installed"));
}

function opener(platform: NodeJS.Platform, target: string): string[] {
  if (platform === "darwin") return ["open", target];
  if (platform === "win32") return ["cmd", "/c", "start", "", target];
  return ["xdg-open", target];
}

export function openPantry(port: number, project: string | undefined, deps: OpenDeps = {}): { via: "app" | "browser"; target: string } {
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? ((cmd: string[]) => { Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore"] }); });
  const viaApp = (deps.hasApp ?? (() => appRegistered(platform)))();
  const target = viaApp ? appLink(project) : hubUrl(port, project);
  run(opener(platform, target));
  return { via: viaApp ? "app" : "browser", target };
}
