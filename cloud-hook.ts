// cloud-hook.ts: the committed hook that gives a cloud session the standards.
//
// A local session gets the standards three ways: the owner's machine-level hooks, the global
// instructions, and the skills `pantry skills sync` generates. A cloud session gets none of them.
// It clones the repository and runs only what is committed there, and the generated skills are
// gitignored. So the kit commits one small hook that runs at session start, stays silent wherever
// the standards are already on disk, and otherwise tells the agent where the published standards
// are and which ones to read before which work. The standards are public, so nothing private
// travels with it.
//
// Write-if-absent for the script, merge-if-missing for the two config files, the same non-invasive
// rule the rest of the kit follows: a host's own hook file is never overwritten.

import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const CLOUD_HOOK_PATH = ".claude/hooks/cloud-standards.sh";
const HOOK_COMMAND = `bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/${CLOUD_HOOK_PATH}"`;

export const CLOUD_HOOK_SCRIPT = `#!/usr/bin/env bash
# Committed by \`pantry init --kit\`. Gives a cloud session the standards that a local session gets
# from the owner's machine. Silent when the standards are already mounted as skills.
set -uo pipefail
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
# On the owner's machine the machine-level checklist already reports; stay silent there.
[ "\${CLAUDE_CODE_REMOTE:-}" != true ] && [ -f "$HOME/.claude/tools/session-checklist.sh" ] && exit 0
base="https://tjakoen.github.io/standards"
reach="reachable"; st="ok  "
curl -fs -m 5 -o /dev/null "$base/voice.md" 2>/dev/null || { reach="NOT reachable"; st="fail"; }
msg="Agentic loop check, $(basename "$root") (cloud or unsynced checkout)
 ok   Repository instructions: CLAUDE.md
 skip Machine hooks, memory and PANTRY: not available off the owner's machine
 $st Standards: published at $base ($reach)
$([ "$reach" = reachable ] && echo "Agentic Loop Loaded (cloud: standards only)" || echo "Agentic Loop NOT loaded (failed: standards)")

The owner's standards are not on this machine as skills. Fetch each one before the work it governs:
- $base/voice.md before writing any prose: docs, READMEs, commit messages, PR bodies, comments.
- $base/loop.md before calling work done, committing, or opening a pull request.
- $base/session-loop.md before writing a handoff or a plan.
- $base/ai-development.md before starting a feature, refactor or migration.
Show the block above verbatim at the top of your first reply."
if command -v jq >/dev/null 2>&1; then
  jq -n --arg c "$msg" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'
else
  printf '%s\\n' "$msg"
fi
`;

type HookConfig = { hooks?: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]> };

/** Add the SessionStart entry to a Claude or Codex hook config unless one already runs the script. */
export function mergeHook(config: HookConfig): { config: HookConfig; changed: boolean } {
  const hooks = { ...(config.hooks ?? {}) };
  const start = [...(hooks.SessionStart ?? [])];
  if (start.some((g) => g.hooks?.some((h) => h.command?.includes(CLOUD_HOOK_PATH)))) return { config, changed: false };
  start.push({ hooks: [{ type: "command", command: HOOK_COMMAND }] });
  return { config: { ...config, hooks: { ...hooks, SessionStart: start } }, changed: true };
}

async function mergeInto(file: string): Promise<boolean> {
  let config: HookConfig = {};
  if (existsSync(file)) {
    try { config = JSON.parse(await readFile(file, "utf8")); } catch { return false; }
  }
  const { config: next, changed } = mergeHook(config);
  if (!changed) return false;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  return true;
}

export async function ensureCloudHook(targetDir: string, created: string[], skipped: string[]): Promise<void> {
  const script = join(targetDir, CLOUD_HOOK_PATH);
  if (existsSync(script)) {
    skipped.push(`${CLOUD_HOOK_PATH} (exists, left as-is)`);
  } else {
    await mkdir(dirname(script), { recursive: true });
    await writeFile(script, CLOUD_HOOK_SCRIPT, "utf8");
    await chmod(script, 0o755);
    created.push(CLOUD_HOOK_PATH);
  }
  for (const rel of [".claude/settings.json", ".codex/hooks.json"]) {
    const file = join(targetDir, rel);
    if (await mergeInto(file)) created.push(`${rel} (cloud standards hook added)`);
    else skipped.push(`${rel} (cloud standards hook already present, or the file is not valid JSON)`);
  }
}
