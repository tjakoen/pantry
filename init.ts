// pantry/init.ts: `pantry init`, scaffold PANTRY into a HOST project in one step. It delegates
// the plans/ scaffold to PROOF's own `runInit` (PANTRY mounts PROOF, it does not reimplement it),
// then adds the one file PROOF doesn't know about, `pantry.config.json`, the host contract's
// config surface (see pantry/PLAN.md "Host contract"). Non-invasive by the same rule as
// proof/init.ts: this writes NEW files only, never a host's existing CLAUDE.md or settings.json.
//
// `--kit` (piece 11b) extends that scaffold with the thin-CLAUDE.md loop kit (portfolio LOOP.md §3):
// a CLAUDE.md seeded from the published CLAUDE.starter.md plus the AGENTS.md -> CLAUDE.md symlink that
// makes the same instructions tool-agnostic. Both are write-if-absent and NEVER overwritten (not even
// with --force — a host's CLAUDE.md is sacred), so `pantry init --kit` on an existing repo only fills
// the gaps. The acceptance test is a green `pantry doctor` right after (doctor.ts checks exactly these).
import { writeFile, access, symlink, lstat } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "@tjakoen/proof/init.ts";
import { syncSkills } from "./skills.ts";
import type { PantryConfig } from "./config.ts";

export interface PantryInitResult {
  created: string[];
  skipped: string[];
  instructions: string;
}

const CONFIG_FILE = "pantry.config.json";
const CLAUDE_FILE = "CLAUDE.md";
const AGENTS_FILE = "AGENTS.md";

// The published starter lives in the portfolio package (the standards home), resolved from THIS
// module so `bunx pantry init --kit` works from any host — the same import.meta.resolve trick app.ts
// uses for the framework docs. Returns null if the portfolio package isn't installed (degrade, don't
// crash): the kit skips CLAUDE.md and says why rather than writing a broken placeholder.
async function readStarter(): Promise<string | null> {
  try {
    const path = fileURLToPath(import.meta.resolve("tjakoen.github.io/standards/CLAUDE.starter.md"));
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

// A minimal starting config the adopter edits by hand. Keys are self-explanatory rather than
// commented (JSON has no comments): projectName for display, plansDir matching what proof init
// just scaffolded, docsDirs pointing at the host's OWN docs (never a copy; see the host contract,
// "configure, don't relocate"). surfaces is left out entirely so PantryConfig's defaults apply.
function buildConfig(targetDir: string): PantryConfig {
  return {
    projectName: basename(resolve(targetDir)),
    plansDir: "./plans",
    docsDirs: ["./docs"],
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// lstat-based existence: unlike access() it does NOT follow symlinks, so a dangling AGENTS.md link
// still counts as present (we must not silently clobber it). Used for the symlink slot only.
async function lexists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

// The next-steps message printed after scaffolding. Ties back to INSTALL.md (the full story,
// including the AI-path prompt) and restates the guardrails as short, unambiguous rules, since
// this is the one moment a fresh adopter is most likely to be reading anything at all.
function buildInstructions(kit: boolean): string {
  const kitLine = kit
    ? `PANTRY + loop kit scaffold written (plans/ + pantry.config.json + CLAUDE.md + AGENTS symlink).

Kit next steps (do these before anything else):

0. Fill CLAUDE.md: replace the <…> placeholders and delete the "Starter template" note at the top.
   It was seeded from the published starter; it is yours now. Run bunx pantry doctor to confirm the
   kit is green.
`
    : `PANTRY scaffold written (plans/ + pantry.config.json).`;
  return `${kitLine}

Next steps:

1. Read INSTALL.md (bundled with this package) for the full install story, including the
   AI-first prompt block if you are handing this off to an agent.
2. Edit pantry.config.json: point docsDirs at this project's EXISTING docs folders. Do not
   move or copy those docs into this project's plans/ or anywhere else PANTRY owns.
3. Run bunx proof check to lint the scaffolded plans.
4. Run bunx pantry serve and confirm both the plan board and the docs render.

Hard rules, worth repeating:

- Never copy or move the host's docs. Point docsDirs at where they already live.
- Never edit the bundled framework docs (BATCH, GRAIN, MILL, PROOF). They are rendered from
  the installed packages, not owned by this project.
- Plans are the source of truth. The board is a projection; the AI must never hand-maintain it.`;
}

// Scaffold PANTRY into targetDir: delegate to PROOF for plans/, then add pantry.config.json if
// absent. Idempotent like proof init; pass force:true to overwrite pantry.config.json too. Pass
// kit:true (the `--kit` flag) to also write the thin-CLAUDE.md loop kit (CLAUDE.md + AGENTS symlink);
// those two are write-if-absent regardless of force (a host's CLAUDE.md is never clobbered).
export async function runPantryInit(
  targetDir: string,
  opts?: { force?: boolean; kit?: boolean },
): Promise<PantryInitResult> {
  const force = opts?.force ?? false;
  const kit = opts?.kit ?? false;

  const proofResult = await runInit(targetDir, opts);
  const created = [...proofResult.created];
  const skipped = [...proofResult.skipped];

  const configPath = join(targetDir, CONFIG_FILE);
  const already = await exists(configPath);

  if (already && !force) {
    skipped.push(CONFIG_FILE);
  } else {
    const config = buildConfig(targetDir);
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    created.push(CONFIG_FILE);
  }

  if (kit) await scaffoldKit(targetDir, created, skipped);

  return { created, skipped, instructions: buildInstructions(kit) };
}

// The `--kit` extension: seed CLAUDE.md from the published starter, add the AGENTS -> CLAUDE.md
// symlink, and mount the standards as skills. The first two are write-if-absent and never overwritten
// (the non-invasive rule; --force does not reach here on purpose). A relative symlink target
// ("CLAUDE.md") is what doctor's agents-symlink check resolves against the link's own dir — keep it
// relative so the check passes and the link is portable. Mutates created/skipped in place so the CLI
// prints one unified list.
//
// Skills are part of the kit for the same reason CLAUDE.md is: a standard the harness never lists is a
// standard that never fires (S2). Unlike the two files above they ARE regenerated on every sync, since
// they are a generated view of canon rather than a host's own file — see skills.ts.
async function scaffoldKit(targetDir: string, created: string[], skipped: string[]): Promise<void> {
  // lexists, not exists: a host CLAUDE.md that is itself a (possibly dangling) symlink must be left
  // untouched — exists() follows the link, so a dangling one would read as absent and writeFile would
  // write THROUGH it, clobbering the host's target. The non-invasive rule covers any CLAUDE.md node.
  const claudePath = join(targetDir, CLAUDE_FILE);
  if (await lexists(claudePath)) {
    skipped.push(`${CLAUDE_FILE} (host file, never overwritten)`);
  } else {
    const starter = await readStarter();
    if (starter === null) {
      skipped.push(`${CLAUDE_FILE} (starter unavailable — install the tjakoen.github.io package)`);
    } else {
      await writeFile(claudePath, starter, "utf8");
      created.push(CLAUDE_FILE);
    }
  }

  // AGENTS.md must be a symlink to CLAUDE.md. Add it only when absent (lstat, so we detect a real file
  // too, not just a resolvable one) and only when a CLAUDE.md exists to point at — a dangling symlink
  // would fail doctor's check anyway.
  const agentsPath = join(targetDir, AGENTS_FILE);
  if (await lexists(agentsPath)) {
    skipped.push(`${AGENTS_FILE} (exists — left as-is)`);
  } else if (await exists(claudePath)) {
    await symlink(CLAUDE_FILE, agentsPath);
    created.push(`${AGENTS_FILE} -> ${CLAUDE_FILE}`);
  } else {
    skipped.push(`${AGENTS_FILE} (no CLAUDE.md to link to)`);
  }

  // Mount the standards as skills. Degrades to a named skip when the portfolio package is absent,
  // the same posture readStarter takes above — an optional package is never a scaffold failure.
  const skills = await syncSkills({ cwd: targetDir });
  if (skills.canonDir === null) {
    skipped.push(".claude/skills (standards unavailable — install the tjakoen.github.io package)");
  } else if (skills.mounted.length === 0) {
    skipped.push(".claude/skills (no standards carry a when: key)");
  } else {
    created.push(`.claude/skills (${skills.mounted.length} standards mounted, gitignored)`);
  }
}
