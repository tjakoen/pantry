// pantry/artifact-opens.ts: when each artifact was last opened in PANTRY, so the explorer can sort by
// "last used". A filesystem's access time cannot carry this: most mounts never update it, and a backup
// or an indexer reading the file would count as a use.
//
// It is the one thing the explorer writes, and it writes it beside the answer inbox in the PANTRY
// home, never in the project: a record of what the owner looked at is not something to commit. One
// small JSON object per project, relPath to ISO, capped so it cannot grow for the life of the machine.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_ENTRIES = 2000;

export function opensPath(project: string, home = process.env.PANTRY_HOME ?? join(homedir(), ".pantry")): string {
  return join(home, "artifact-opens", `${project.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`);
}

export function readOpens(file: string): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, string> : {};
  } catch {
    return {};
  }
}

/** Record an open. Never throws: a read-only home costs the sort its data, not the page its preview. */
export function recordOpen(file: string, relPath: string, at = new Date().toISOString()): void {
  try {
    const opens = readOpens(file);
    opens[relPath] = at;
    const kept = Object.entries(opens).sort((a, b) => b[1].localeCompare(a[1])).slice(0, MAX_ENTRIES);
    mkdirSync(join(file, ".."), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(kept)));
    renameSync(tmp, file);
  } catch { /* best effort */ }
}
