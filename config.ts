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
import { resolvePreviewTarget } from "./preview.ts";

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
  /** the run ledger (/runs, /runs/<id>, /runs.json) — run reports parsed against LOOP §9, and which items each is
   *  missing. Human index + detail alongside the machine twin, all three off together when this is
   *  false. Model-free, read-only. Default on. */
  runs: boolean;
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
  /** the ONE channel an answer comes back on (standards/DECISIONS.md §4); default
   *  "<decisionsDir>/answers.jsonl", so it rides along with the questions it answers and adds no new
   *  tracked dir. This is the single path PANTRY writes to, and it is append-only.
   *
   *  **The extension is `.jsonl` and not `.log` on purpose.** `*.log` is in almost every .gitignore
   *  ever written, including this estate's, so the obvious name would have been silently untracked —
   *  and a per-repo answer log that git never sees gives up the entire reason for choosing per repo
   *  over per machine. It was ignored on the first write, which is the only way this was going to be
   *  found.
   *
   *  Per repo is the default because an answer belongs beside the evidence and inside the same git
   *  history as the change it unblocks. Pointing it at an absolute path outside the repo makes it per
   *  MACHINE instead, which is the trade for a session that works across repos and wants exactly one
   *  path to watch. Both are supported on purpose, and neither is a mode with its own code. */
  answersLog?: string;
  /** where runs deposit evidence — screenshots, audit reports, diffs — that PANTRY serves read-only;
   *  default ./artifacts. Absent → the /artifacts surface degrades to guidance. */
  artifactsDir?: string;
  /** where a run closes its ledger entry (LOOP.md §4a's run report); default "<artifactsDir>/runs",
   *  kept UNDER artifacts/ so it rides along with the evidence it cites and adds no new tracked dir.
   *  PANTRY parses these read-only and reports which §9 items each report is missing; it never
   *  writes one. */
  runsDir?: string;
  /** the dev preview target PANTRY proxies AT THE ROOT, so a project is served under PANTRY's own
   *  origin and can be reviewed from inside it (plans/pantry-review-layer.md P0). Origin only, and
   *  LOOPBACK only: "http://localhost:3000". Point it at a local PRODUCTION build, not a dev server
   *  — there is no websocket passthrough, by design.
   *  Absent (the default) → the proxy is OFF and PANTRY serves its own routes at the root exactly as
   *  it always has. Present → PANTRY's own routes move under /__pantry and the target owns the root,
   *  which is what lets the app's root-relative URLs keep resolving untouched. */
  previewTarget?: string;
  /** the command `pantry capture` runs to bring `previewTarget` up when nothing is answering there
   *  (plans/pantry-review-layer.md P4d): "bun run start", "npm run preview", whatever the project
   *  already uses. Absent (the default) → capture starts nothing and tells the owner what to run.
   *
   *  **This is the key the plan's cost section named as the line to watch, crossed on purpose.**
   *  The owner was asked on 2026-08-10 with that warning stated and chose it, so the honest thing is
   *  to bound it rather than pretend it is small. What bounds it: it is NEVER guessed, only ever the
   *  string a human wrote here; only `pantry capture` reads it, never `pantry serve` and never a
   *  route; the process is killed when capture ends, on every path including a failure; and a target
   *  that already answers is left alone, so capture never starts a second copy of a running project.
   *  Delete the key and capture still works against a project you started yourself, which is the
   *  retreat the cost section asks to keep open. */
  previewCommand?: string;
  /** where `previewCommand` runs; default the host repo root. A project reviewed from a sibling repo
   *  is the normal case for Tier 1 (the reviewing repo holds the tours, the reviewed one holds the
   *  app), so the command's cwd is almost never the host's. */
  previewCommandCwd?: string;
  /** the CRUMB tour folder PANTRY serves ITSELF, so a review can be walked on a project that has
   *  never heard of CRUMB (plans/pantry-review-layer.md P4, Tier 1); default "./content/tours" when
   *  that folder exists, and nothing when it does not.
   *
   *  **These are the REVIEWING repo's tours, not the reviewed project's.** That is the point rather
   *  than a limitation: the plan's argument for hosting a review outside the project is that the
   *  evidence keeps working when the project is not running, and it is also what lets a review be
   *  written for a repo nobody wants to add a dependency to. A GRAIN host that mounts CRUMB itself
   *  still wins — the review rail asks the project first and only falls back here — so turning this
   *  on never takes a project's own tours away from it. */
  toursDir?: string;
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
  /** the graphify output folder itself (absolute), whether or not it exists. Kept alongside
   *  `graphPath` because two consumers need the DIR, not the graph: doctor reads `GRAPH_REPORT.md`
   *  out of it for the built-from commit, and the symbol lint prefers this repo's own `graph.json`
   *  over the merged estate graph when it has to say which repo a symbol should live in. */
  graphDir: string;
  /** the decision-request folder (absolute); default <plansDir>/decisions */
  decisionsDir: string;
  /** the append-only answer log (absolute); default <decisionsDir>/answers.jsonl. The one path PANTRY
   *  writes to — resolved here so no request ever names it. */
  answersLog: string;
  /** the artifacts folder (absolute); default <cwd>/artifacts */
  artifactsDir: string;
  /** the run-report folder (absolute); default <artifactsDir>/runs */
  runsDir: string;
  /** the validated preview-proxy origin, or null when the proxy is off (the default, and the result
   *  of a target that failed validation — a bad value degrades the surface, it never boots a relay) */
  previewTarget: string | null;
  /** the command `pantry capture` may run to bring the target up, or null when the host named none.
   *  Read by capture.ts alone — nothing in the server ever spawns it. */
  previewCommand: string | null;
  /** where that command runs (absolute); defaults to cwd. Meaningless when previewCommand is null,
   *  and still resolved, because a host that sets only the cwd has made a typo worth seeing. */
  previewCommandCwd: string;
  /** the tour folder PANTRY serves under its own prefix (absolute), or null when there is none.
   *  Resolved by existence like docsDirs, so a repo with no tours simply has no mount rather than a
   *  route that 404s on every request. */
  toursDir: string | null;
  surfaces: PantrySurfaces;
  /** "canon" only for the standards home; undefined everywhere else. Doctor reads this. */
  standardsSource?: "canon";
}

const ALL_ON: PantrySurfaces = { plans: true, docs: true, reference: true, catalog: true, standards: true, decisions: true, artifacts: true, timeline: true, runs: true };

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
  const graphDir = abs(cwd, raw.graphDir ?? "graphify-out");

  // docsDirs: explicit list wins; otherwise auto-mount ./docs only when it actually exists.
  const docsDirs = (raw.docsDirs ?? ["docs"])
    .map((d) => abs(cwd, d))
    .filter((d) => existsSync(d));

  // A configured-but-rejected target says why and stays off. Silence here would look identical to
  // "no target configured", which is the one thing an owner debugging a blank root must be able to
  // tell apart.
  const preview = resolvePreviewTarget(raw.previewTarget);
  if (preview.problem) console.warn(`[pantry] preview proxy off: ${preview.problem}`);

  const decisionsDir = raw.decisionsDir ? abs(cwd, raw.decisionsDir) : join(plansDir, "decisions");

  // An explicit toursDir is honoured whether or not it exists, but a missing one is said out loud.
  // The mount costs the reviewed project a stylesheet, a client and a no-store on every page, and a
  // folder that will only ever answer an empty list is not worth any of that silently.
  const toursDir = raw.toursDir
    ? abs(cwd, raw.toursDir)
    : (existsSync(join(cwd, "content", "tours")) ? join(cwd, "content", "tours") : null);
  if (raw.toursDir && !existsSync(toursDir!)) {
    console.warn(`[pantry] toursDir ${toursDir} does not exist — the tour mount will serve an empty manifest, and pages will still carry the tour client`);
  }

  return {
    cwd,
    projectName: raw.projectName ?? basename(cwd) ?? "project",
    plansDir,
    docsDirs,
    graphPath: resolveGraphPath(graphDir),
    graphDir,
    // default under plansDir (not cwd) so it rides along with the board's own folder
    decisionsDir,
    // default beside the decision requests, for the same reason: the answer belongs with the question
    answersLog: raw.answersLog ? abs(cwd, raw.answersLog) : join(decisionsDir, "answers.jsonl"),
    artifactsDir,
    // default under artifactsDir (not cwd) so the ledger rides along with the evidence it cites
    runsDir: raw.runsDir ? abs(cwd, raw.runsDir) : join(artifactsDir, "runs"),
    previewTarget: preview.origin,
    // An empty or whitespace-only string is the same as not naming a command, and it has to be
    // folded to null HERE rather than checked at the call site: `if (config.previewCommand)` is the
    // natural test and "  " passes it, which would hand a shell a command that is nothing at all.
    previewCommand: raw.previewCommand?.trim() ? raw.previewCommand.trim() : null,
    previewCommandCwd: raw.previewCommandCwd ? abs(cwd, raw.previewCommandCwd) : cwd,
    // An EXPLICIT toursDir is honoured whether or not it exists yet, because a host that named one
    // has said what it means; the DEFAULT is existence-gated, because auto-mounting a folder nobody
    // asked for is only defensible while the folder is really there. A missing explicit one warns
    // above rather than being silently equivalent to having none.
    toursDir,
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
