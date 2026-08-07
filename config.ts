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
  /** the decision inbox (/decisions) — agents write decision-requests, the human resolves via a
   *  generated prompt. Model-free, read-only, like every surface. Default on. */
  decisions: boolean;
  /** run evidence (/artifacts) — screenshots, audit reports, diffs a run deposits, served read-only.
   *  Model-free, like every surface. Default on. */
  artifacts: boolean;
  /** the retrospective project timeline (/timeline) — plan bars from git-derived status-transition
   *  dates, depends arrows, commit density, dated audit markers. Reads git + plans/ + report mtimes;
   *  no new tracking, no model. Default on. */
  timeline: boolean;
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
  /** where the host's graphify pass wrote its output (the mindmap's code-graph source); default
   *  "./graphify-out". PANTRY reads `merged-graph.json` (whole-stack) or `graph.json` (single repo)
   *  from here — it never runs graphify; the host generates it (`graphify update .`). Absent → /map
   *  auto-disables, like any other missing surface. */
  graphDir?: string;
  /** where the agent writes decision-request markdown files; default "./plans/decisions" (kept UNDER
   *  plans/ so the existing PROOF tooling + `pantry doctor`'s plans-present check already cover it —
   *  no new tracked dir). PANTRY renders these read-only at /decisions; it never writes them. */
  decisionsDir?: string;
  /** where runs deposit evidence — screenshots, audit reports, diffs — that PANTRY serves read-only;
   *  default ./artifacts. Absent → the /artifacts surface degrades to guidance. */
  artifactsDir?: string;
  /** where a run closes its ledger entry (LOOP.md §4a's run report); default "<artifactsDir>/runs",
   *  kept UNDER artifacts/ so it rides along with the evidence it cites and adds no new tracked dir.
   *  PANTRY parses these read-only and reports which §9 items each report is missing; it never
   *  writes one. */
  runsDir?: string;
  /** turn individual surfaces off; default every surface on */
  surfaces?: Partial<PantrySurfaces>;
  /** set to "canon" in the ONE repo that is the home of the cross-repo standards (the portfolio):
   *  it legitimately carries real canon-named files in `standards/`, so `pantry doctor`'s
   *  forked-standards check skips it. Every other repo references the standards by URL (LOOP.md §3),
   *  so a local canon file there IS a fork and should flag. Default: undefined (not the home). */
  standardsSource?: "canon";
}

/** A PantryConfig with every field filled and every path made absolute. */
export interface ResolvedPantryConfig {
  /** the host project root this config was loaded from (absolute). The single source of truth for
   *  "where is the repo" — doctor's kit/audit checks read from here, so no caller has to guess it
   *  from plansDir (which may be pointed off-root). */
  cwd: string;
  projectName: string;
  plansDir: string;
  docsDirs: string[];
  /** the graphify node-link JSON the mindmap consumes, or null when no graphify-out is present */
  graphPath: string | null;
  /** the decision-request folder (absolute); default <plansDir>/decisions */
  decisionsDir: string;
  /** the artifacts folder (absolute); default <cwd>/artifacts */
  artifactsDir: string;
  /** the run-report folder (absolute); default <artifactsDir>/runs */
  runsDir: string;
  surfaces: PantrySurfaces;
  /** "canon" only for the standards home; undefined everywhere else. Doctor reads this. */
  standardsSource?: "canon";
}

const ALL_ON: PantrySurfaces = { plans: true, docs: true, reference: true, catalog: true, standards: true, decisions: true, artifacts: true, timeline: true };

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
  const artifactsDir = abs(cwd, raw.artifactsDir ?? "artifacts");

  // docsDirs: explicit list wins; otherwise auto-mount ./docs only when it actually exists.
  const docsDirs = (raw.docsDirs ?? ["docs"])
    .map((d) => abs(cwd, d))
    .filter((d) => existsSync(d));

  return {
    cwd,
    projectName: raw.projectName ?? basename(cwd) ?? "project",
    plansDir,
    docsDirs,
    graphPath: resolveGraphPath(abs(cwd, raw.graphDir ?? "graphify-out")),
    // default under plansDir (not cwd) so it rides along with the board's own folder
    decisionsDir: raw.decisionsDir ? abs(cwd, raw.decisionsDir) : join(plansDir, "decisions"),
    artifactsDir,
    // default under artifactsDir (not cwd) so the ledger rides along with the evidence it cites
    runsDir: raw.runsDir ? abs(cwd, raw.runsDir) : join(artifactsDir, "runs"),
    surfaces: { ...ALL_ON, ...raw.surfaces },
    standardsSource: raw.standardsSource,
  };
}

// The mindmap reads the host's graphify pass. Prefer the whole-stack `merged-graph.json` (produced by
// `graphify merge-graphs`) over a single repo's `graph.json`; null when neither exists so /map
// auto-disables (same posture as an unresolved doc/standards package — a surface never crashes).
function resolveGraphPath(graphDir: string): string | null {
  for (const name of ["merged-graph.json", "graph.json"]) {
    const file = join(graphDir, name);
    if (existsSync(file)) return file;
  }
  return null;
}
