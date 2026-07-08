// pantry/init.ts: `pantry init`, scaffold PANTRY into a HOST project in one step. It delegates
// the plans/ scaffold to PROOF's own `runInit` (PANTRY mounts PROOF, it does not reimplement it),
// then adds the one file PROOF doesn't know about, `pantry.config.json`, the host contract's
// config surface (see pantry/PLAN.md "Host contract"). Non-invasive by the same rule as
// proof/init.ts: this writes NEW files only, never a host's existing CLAUDE.md or settings.json.
import { writeFile, access } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { runInit } from "../proof/init.ts";
import type { PantryConfig } from "./config.ts";

export interface PantryInitResult {
  created: string[];
  skipped: string[];
  instructions: string;
}

const CONFIG_FILE = "pantry.config.json";

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

// The next-steps message printed after scaffolding. Ties back to INSTALL.md (the full story,
// including the AI-path prompt) and restates the guardrails as short, unambiguous rules, since
// this is the one moment a fresh adopter is most likely to be reading anything at all.
function buildInstructions(): string {
  return `PANTRY scaffold written (plans/ + pantry.config.json).

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
// absent. Idempotent like proof init; pass force:true to overwrite pantry.config.json too.
export async function runPantryInit(
  targetDir: string,
  opts?: { force?: boolean },
): Promise<PantryInitResult> {
  const force = opts?.force ?? false;

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

  return { created, skipped, instructions: buildInstructions() };
}
