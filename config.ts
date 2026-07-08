// pantry/config.ts — the HOST contract, loaded. PANTRY is a lens, not a destination (see PLAN.md
// §"Host contract"): it renders the host's content IN PLACE and never copies or moves it. This
// module reads the host project's optional `pantry.config.(ts|json)` from its cwd and resolves it
// against sane conventions, so `bunx pantry` works with zero config yet stays overridable.
//   - plansDir  the PROOF board's source (default ./plans)
//   - docsDirs  the host's OWN docs, mounted as MILL collections (default ./docs when it exists) —
//               these point AT the existing dirs; nothing is relocated
//   - surfaces  per-surface on/off toggles (default: all on)
import { isAbsolute, join, basename } from "node:path";
import { existsSync } from "node:fs";

export interface PantrySurfaces {
  plans: boolean;
  docs: boolean;
  reference: boolean;
  catalog: boolean;
  standards: boolean;
}

/** What a host project may put in `pantry.config.(ts|json)`. Every field is optional. */
export interface PantryConfig {
  /** shown in the nav + home lede; defaults to the project folder name */
  projectName?: string;
  /** the PROOF board's plans folder (cwd-relative or absolute); default "./plans" */
  plansDir?: string;
  /** the host's OWN docs dirs, mounted as MILL collections; default ["./docs"] when it exists.
   *  These are pointers to existing folders — PANTRY renders them in place, never copies them. */
  docsDirs?: string[];
  /** turn individual surfaces off; default every surface on */
  surfaces?: Partial<PantrySurfaces>;
}

/** A PantryConfig with every field filled and every path made absolute. */
export interface ResolvedPantryConfig {
  projectName: string;
  plansDir: string;
  docsDirs: string[];
  surfaces: PantrySurfaces;
}

const ALL_ON: PantrySurfaces = { plans: true, docs: true, reference: true, catalog: true, standards: true };

const abs = (cwd: string, p: string) => (isAbsolute(p) ? p : join(cwd, p));

/** Read the host's pantry.config.(ts|json) from `cwd`, or return {} when there is none. */
async function readConfig(cwd: string): Promise<PantryConfig> {
  for (const name of ["pantry.config.ts", "pantry.config.js"]) {
    const file = join(cwd, name);
    if (existsSync(file)) {
      const mod = await import(file);
      return (mod.default ?? mod.config ?? {}) as PantryConfig;
    }
  }
  const jsonFile = join(cwd, "pantry.config.json");
  if (existsSync(jsonFile)) return JSON.parse(await Bun.file(jsonFile).text()) as PantryConfig;
  return {};
}

/** Load + resolve the host config. `cwd` is the host project root (default process.cwd()). */
export async function loadPantryConfig(cwd: string = process.cwd()): Promise<ResolvedPantryConfig> {
  const raw = await readConfig(cwd);

  const plansDir = abs(cwd, raw.plansDir ?? "plans");

  // docsDirs: explicit list wins; otherwise auto-mount ./docs only when it actually exists.
  const docsDirs = (raw.docsDirs ?? ["docs"])
    .map((d) => abs(cwd, d))
    .filter((d) => existsSync(d));

  return {
    projectName: raw.projectName ?? basename(cwd) ?? "project",
    plansDir,
    docsDirs,
    surfaces: { ...ALL_ON, ...raw.surfaces },
  };
}
