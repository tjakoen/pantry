// pantry/hub-sync.ts: let one machine's hub see what waits on the owner on his other machines.
//
// The owner works on three machines, and a hub only ever saw its own. The fix is a file per machine
// in a folder that something else keeps in sync: each hub writes <dir>/<machine>/pantry-state.json
// and reads every other machine's file beside it. PANTRY does not care what syncs the folder. On the
// owner's machines it is the agent-config repository, carried by its thirty-minute sync; someone else
// could point it at Dropbox, iCloud or a git repository of their own. With no folder configured,
// nothing here runs, so a one-project user never meets it.
//
// The file carries labels and counts, never file contents or paths on disk: project names, item
// titles and details, and when the machine last saw a session. It is rewritten only when that
// changes, plus once a day so a quiet machine can be told from a dead one, because every rewrite is
// a commit in the folder's history.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import type { HubRow } from "./hub-home.ts";

export const STATE_FILE = "pantry-state.json";
/** A file left unchanged this long is rewritten anyway, so its age says whether the machine is alive. */
export const STATE_HEARTBEAT_MS = 24 * 60 * 60 * 1000;
/** Older than a heartbeat plus slack: the machine's hub has not run, or its folder has not synced. */
export const STATE_STALE_MS = STATE_HEARTBEAT_MS + 2 * 60 * 60 * 1000;

export interface SyncConfig { dir: string; machine?: string }

export interface StateItem { kind: string; title: string; detail: string }
export interface StateProject { name: string; live: number; lastSeenAt: string | null; next: string | null; items: StateItem[] }
export interface MachineState { machine: string; writtenAt: string; projects: StateProject[] }

/** The machine's folder name: the same slug agent-config uses, lower case with dashes. */
export function machineSlug(name = hostname()): string {
  return name.replace(/\.local$/i, "").replace(/\s+/g, "-").toLowerCase().replace(/[^a-z0-9-]/g, "");
}

export function stateOf(machine: string, rows: HubRow[], now: Date): MachineState {
  const projects = rows.filter((r) => r.summary).map((r) => ({
    name: r.name,
    live: r.summary!.live,
    lastSeenAt: r.summary!.lastSeenAt,
    next: r.summary!.next,
    items: r.summary!.items.map(({ kind, title, detail }) => ({ kind, title, detail })),
  }));
  return { machine, writtenAt: now.toISOString(), projects };
}

const body = (s: MachineState) => JSON.stringify(s.projects);

/** Write this machine's state when it changed or the heartbeat is due. Returns whether it wrote. */
export function writeState(cfg: SyncConfig, rows: HubRow[], now = new Date()): boolean {
  const machine = cfg.machine ?? machineSlug();
  const file = join(cfg.dir, machine, STATE_FILE);
  const next = stateOf(machine, rows, now);
  // Rows still being read have no summary yet; writing then would drop their items for a cycle.
  if (rows.some((r) => r.pending)) return false;
  const prev = readState(file);
  if (prev && body(prev) === body(next) && now.getTime() - Date.parse(prev.writtenAt) < STATE_HEARTBEAT_MS) return false;
  mkdirSync(join(cfg.dir, machine), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  return true;
}

function readState(file: string): MachineState | null {
  try {
    const s = JSON.parse(readFileSync(file, "utf8")) as MachineState;
    return s && typeof s.machine === "string" && Array.isArray(s.projects) ? s : null;
  } catch { return null; }
}

/** Every other machine's state in the folder, newest first. A file that does not parse is skipped. */
export function readOthers(cfg: SyncConfig): MachineState[] {
  const self = cfg.machine ?? machineSlug();
  if (!existsSync(cfg.dir)) return [];
  return readdirSync(cfg.dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== self)
    .map((d) => readState(join(cfg.dir, d.name, STATE_FILE)))
    .filter((s): s is MachineState => s !== null)
    .toSorted((a, b) => b.writtenAt.localeCompare(a.writtenAt));
}

/** Machines whose file is older than STATE_STALE_MS, for the doctor. */
export function staleMachines(states: MachineState[], now = Date.now()): { machine: string; hours: number }[] {
  return states
    .filter((s) => now - Date.parse(s.writtenAt) > STATE_STALE_MS)
    .map((s) => ({ machine: s.machine, hours: Math.round((now - Date.parse(s.writtenAt)) / 3_600_000) }));
}
