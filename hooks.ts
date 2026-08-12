// pantry/hooks.ts — is this repo still carrying a hook that moved up to the machine level?
//
// The check the 2026-08-13 loop audit made a precondition. LOOP §2 says one workflow runs in every
// repo, and the way that gets delivered is by mounting the shared hooks once in ~/.claude rather than
// copying them into seven settings files. The mount is the easy half. The half that rots is what it
// leaves behind: a repo wired before the move keeps its own copy, both fire, and two copies of a
// check is the drift the move existed to prevent. So the rule the owner set is that nothing moves up
// until something can find the stragglers, and this is that something.
//
// THE CHECK IS MANIFEST-BASED, NOT DIFF-BASED, and that is the whole design. Comparing a repo's hook
// block against the machine-level one by equality would flag every local hook, and a legitimate one
// exists: bread prints its own plan board at session start, which is bread's business and nobody
// else's. So the question is never "does this repo have hooks". It is "does this repo have a hook
// that something else now owns", which only a declared list of what moved can answer. A local hook
// matching nothing in the manifest is silent, deliberately and permanently.
//
// The manifest is written by ~/.claude/tools/loop-manifest.ts, which generates it from the live
// settings file so the two cannot drift apart silently. This module never writes it and never guesses
// at its contents: where it is absent, every row comes back "not run" by name. A checker that returns
// clean because it was looking at an empty list is the failure AUDIT-STANDARD §6 names, and it is the
// same silent-degrade shape the audit files against gitignored skills.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One machine-mounted mechanism, as the manifest describes it. */
export interface ManifestMechanism {
  id: string;
  event: string;
  matcher: string | null;
  command: string;
  /** the date this moved up, or null when it was never per-repo */
  movedOn: string | null;
  /** regex sources; a repo-level command matching any of them is a leftover */
  supersedes: string[];
  why: string;
}

export interface LoopManifest {
  version: number;
  generated: string;
  mechanisms: ManifestMechanism[];
}

export interface HookLeftover {
  /** the repo-level hook command that matched */
  command: string;
  /** the event it is wired on, in the repo */
  event: string;
  /** which machine-level mechanism owns it now */
  mechanismId: string;
  movedOn: string | null;
  /** the settings file the local copy lives in */
  file: string;
}

export interface HookDriftResult {
  /** false when no manifest was found; every finding below is then meaningless, not clean */
  manifestFound: boolean;
  manifestPath: string;
  /** how many hook commands this repo wires of its own, superseded or not */
  localHookCount: number;
  leftovers: HookLeftover[];
}

export interface HookDriftOptions {
  cwd?: string;
  /** the manifest; default $HOME/.claude/tools/loop-manifest.json */
  manifestPath?: string;
  /** injected so tests do not depend on the machine they run on */
  home?: string;
}

/**
 * Flatten a settings file's hooks block into one row per command.
 *
 * Deliberately forgiving about shape. A settings file is hand-edited and one malformed entry taking
 * the check down would mean the drift report goes dark for an unrelated typo, which is a worse
 * failure than skipping the entry.
 */
export function readHookCommands(settings: unknown): Array<{ event: string; command: string }> {
  const out: Array<{ event: string; command: string }> = [];
  const hooks = (settings as { hooks?: Record<string, unknown> } | null)?.hooks;
  if (!hooks || typeof hooks !== "object") return out;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const inner = Array.isArray((group as { hooks?: unknown })?.hooks) ? (group as { hooks: unknown[] }).hooks : [];
      for (const hook of inner) {
        const command = (hook as { command?: unknown })?.command;
        if (typeof command === "string") out.push({ event, command });
      }
    }
  }
  return out;
}

/**
 * Match repo-level hook commands against the manifest's supersede patterns.
 *
 * Pure, so the matching rule is testable without a filesystem. An unparseable pattern is skipped
 * rather than thrown on: the manifest is generated from a hand-authored declarations file, and one
 * bad regex there should cost that one mechanism's row, not the entire check.
 */
export function findLeftovers(
  manifest: LoopManifest,
  local: Array<{ event: string; command: string; file: string }>,
): HookLeftover[] {
  const out: HookLeftover[] = [];
  for (const hook of local) {
    for (const mech of manifest.mechanisms ?? []) {
      let matched = false;
      for (const pattern of mech.supersedes ?? []) {
        try {
          if (new RegExp(pattern).test(hook.command)) {
            matched = true;
            break;
          }
        } catch {
          /* a pattern that will not compile cannot judge anything; skip it */
        }
      }
      if (matched) {
        out.push({
          command: hook.command,
          event: hook.event,
          mechanismId: mech.id,
          movedOn: mech.movedOn,
          file: hook.file,
        });
        // One finding per hook. A command matching two mechanisms is a manifest problem to fix at the
        // source, and reporting it twice would read as two leftovers to delete.
        break;
      }
    }
  }
  return out;
}

const SETTINGS_FILES = [".claude/settings.json", ".claude/settings.local.json"];

/** Read the manifest and this repo's settings, and report which local hooks are now redundant. */
export function checkHookDrift(opts: HookDriftOptions = {}): HookDriftResult {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? process.env.HOME ?? "";
  const manifestPath = opts.manifestPath ?? join(home, ".claude", "tools", "loop-manifest.json");

  let manifest: LoopManifest | null = null;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as LoopManifest;
  } catch {
    manifest = null;
  }

  const local: Array<{ event: string; command: string; file: string }> = [];
  for (const rel of SETTINGS_FILES) {
    try {
      const parsed = JSON.parse(readFileSync(join(cwd, rel), "utf8"));
      for (const row of readHookCommands(parsed)) local.push({ ...row, file: rel });
    } catch {
      /* absent or unreadable settings file; a repo is allowed to have neither */
    }
  }

  if (!manifest || !Array.isArray(manifest.mechanisms)) {
    return { manifestFound: false, manifestPath, localHookCount: local.length, leftovers: [] };
  }
  return {
    manifestFound: true,
    manifestPath,
    localHookCount: local.length,
    leftovers: findLeftovers(manifest, local),
  };
}
