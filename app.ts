// pantry/app.ts — PANTRY, the installable developer-docs + AI cockpit APP. It COMPOSES the layers
// (the pivot, 2026-07-08): BATCH serves, GRAIN styles, MILL renders the framework docs, PROOF
// renders the project's plan board, and GRAIN's own reference + catalog round out the cockpit — all
// under one server you `bunx pantry` into any project. This is the composition root; nothing imports
// PANTRY. It reads the HOST project's content (plans + optional docs, via the host contract in
// config.ts) and resolves its OWN bundled assets/docs via package resolution (never a relative path),
// so it runs from anywhere and survives the repo split.
import { join, dirname, basename, normalize, sep, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, realpathSync, statSync } from "node:fs";
import { bunRuntime } from "@tjakoen/batch/platform/bun-runtime.ts";
import { makeStatic } from "@tjakoen/batch/http/static.ts";
import { createStyleBundle } from "@tjakoen/batch/assets/style-bundle.ts";
import { createStream } from "@tjakoen/batch/http/stream.ts";
import { createMillRoutes, dirSource, type ContentSource, type MillCollection } from "@tjakoen/mill/serve.ts";
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { renderGrainDocument } from "@tjakoen/mill/adapters/grain/grain-adapter.ts";
import { madeWith } from "@tjakoen/grain/scripts/made-with.js";
import { createProofRoutes } from "@tjakoen/proof/routes.ts";
import { watchPlans } from "@tjakoen/proof/live.ts";
import { briefRoute } from "./brief-routes.ts";
import { annotateBoard, boardAnnotations, claimsFile } from "./orchestrator.ts";
import { watchFile } from "node:fs";
// CRUMB, carried rather than expected (plans/pantry-review-layer.md P4). PANTRY mounts the tour DATA
// routes and serves the client + stylesheet as its own assets, so a review can be walked on a project
// that has never heard of CRUMB. This is the SAME parser the GRAIN host uses — the plan's "one parser,
// never a second" rule is kept by importing crumb's, not by writing one here.
import { createCrumbRoutes } from "@tjakoen/crumb/routes.ts";
import { buildVocabReference } from "@tjakoen/grain/ai/vocab-reference.ts";
import { createCatalog } from "@tjakoen/grain/catalog/catalog.ts";
import { loadPantryConfig, type ResolvedPantryConfig, type PantrySurfaces } from "./config.ts";
import { buildControlPayload, buildSessionsPayload, resolveSessionsLog } from "./sessions.ts";
import type { ControlPayload, SessionRow } from "./sessions.ts";
import { DEFAULT_HYGIENE } from "./hygiene.ts";
import { DEFAULT_CONTEXT_BUDGET } from "./context.ts";
import { isInside } from "./paths.ts";
import {
  PANTRY_PREFIX, pageAlreadyRunsCrumb, proxyToPreview, rebaseCrumbLive, rebasePantryCss, spotlightRulesOnly,
  rebasePantryHtml, resolvePreviewTarget, withPantryBase,
} from "./preview.ts";
import { buildKnowledge, renderLlmsTxt } from "./retrieval.ts";
import { buildMapPayload, type MapPayload } from "./map.ts";
import { buildDecisionsPayload, type DecisionsPayload, type DecisionRequest } from "./decisions.ts";
import {
  answers, appendAnswer, AnswerRejected, isLoopbackRequest, normalizeAnswer, readAnswerLog, unacked,
  MAX_ANSWER_BODY_BYTES, type AnswerEntry, type AnswerLog,
} from "./answers.ts";
import { buildArtifactsPayload, classifyArtifact, type ArtifactsPayload, type ArtifactEntry } from "./artifacts.ts";
import { buildRunsPayload, type RunsPayload, type RunReport, type RunPair, type EvidenceGap } from "./runs.ts";
import { runDoctor, type DoctorReport, type DoctorCheck } from "./doctor.ts";
import { buildTimelinePayload, cachedTimelinePayload, type TimelinePayload, type TimelinePlan } from "./timeline.ts";

import { opensPath, readOpens, recordOpen } from "./artifact-opens.ts";
import { artifactsIndexBody, explorerView, readPreview, serveArtifactRaw } from "./artifacts-page.ts";
import { nav, pantryPage, styleLinks } from "./chrome.ts";
import { controlBody } from "./control-page.ts";
import { type PantryServer, answersBody, decisionDetailBody, decisionsIndexBody, recordAnswerRequest } from "./decisions-page.ts";
import { aboutBody, docsBody, homeBody } from "./home-page.ts";
import { mapBody } from "./map-page.ts";
import { runDetailBody, runsIndexBody } from "./runs-page.ts";
import { usageBody } from "./usage-page.ts";
import { buildUsageForConfig } from "./usage.ts";
import { timelineBody } from "./timeline-page.ts";
import { ACTIVITY_WINDOWS, activityBody, buildActivity } from "./activity.ts";
export { homeBody } from "./home-page.ts";
export { pantryPage, type PantryPageOptions } from "./chrome.ts";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// The framework DOC dirs, the proof stylesheet, and the layer PLANs are resolved as PACKAGES
// (import.meta.resolve), so the same code works in the monorepo and after the split — the file
// travels inside the package. BATCH + GRAIN explanatory docs now live in the PORTFOLIO package
// (option b, 2026-07-09: tjakoen.github.io/docs/<layer>/), resolved from THAT package rather than
// each layer's; a host that doesn't install the portfolio auto-disables those surfaces (below).
// GRAIN_ROOT is the installed grain package's own directory (used as a root for styles/ +
// components/, which aren't fixed export paths). Resolve it as a PACKAGE (via PLAN.md, a root
// export) so it travels inside the package — works in any host, whether grain is a git dep, a
// published dep, or (since the 2026-07-19 grain-monorepo split) nested under packages/grain.
const GRAIN_ROOT = dirname(fileURLToPath(import.meta.resolve("@tjakoen/grain/PLAN.md")));
const PROOF_CSS = fileURLToPath(import.meta.resolve("@tjakoen/proof/board.css"));
const BOARD_LIVE_JS = fileURLToPath(import.meta.resolve("@tjakoen/proof/board-live.js"));
// CRUMB's browser half, resolved as a package for the same reason everything else here is: the files
// travel inside `@tjakoen/crumb` and PANTRY serves them as its own assets under the reserved prefix.
const CRUMB_LIVE_JS = fileURLToPath(import.meta.resolve("@tjakoen/crumb/crumb-live.js"));
const CRUMB_CSS = fileURLToPath(import.meta.resolve("@tjakoen/crumb/crumb.css"));
// The standards docs are canonically homed in the PORTFOLIO package (tjakoen.github.io/standards/,
// since the 2026-07-09 fold-in) — resolved like the framework docs, so pantry renders them from the
// installed portfolio package in any host, not a sibling of the monorepo. A host that doesn't install
// the portfolio resolves to null and the /standards surface auto-disables (below).
const STANDARDS_DIR = resolveDirOrNull("tjakoen.github.io/standards/README.md");
function resolveDirOrNull(specifier: string): string | null {
  try { return dirname(fileURLToPath(import.meta.resolve(specifier))); }
  catch { return null; }
}


// A framework doc / plan leads with its own `# Title` heading, so MILL's default note masthead
// (which re-emits the derived title) would double it under PANTRY's own chrome. Render the body
// only; the grade guardrail still runs (data-grade="smooth"). Same fix PROOF uses for its detail.
const bodyOnlyLayout = ({ body }: { body: string }) => `<article class="note" data-grade="smooth">${body}</article>`;

// A ContentSource over a fixed slug→file map — for docs that don't share one folder (the layer
// PLANs live one-per-package at `<layer>/PLAN.md`, not in a docs/ dir).
function filesSource(files: Record<string, string>): ContentSource {
  return {
    list: async () => Object.keys(files),
    read: async (slug) => {
      const file = files[slug.toLowerCase()];
      return file ? Bun.file(file).text() : null;
    },
  };
}

// A package-resolved docs dir, or null when the package (or path) isn't installed — so a surface
// can auto-disable instead of crashing at module load (same posture as STANDARDS_DIR).
function packageDocsSourceOrNull(anchor: string): ContentSource | null {
  const dir = resolveDirOrNull(anchor);
  return dir ? dirSource(dir) : null;
}
// BATCH + GRAIN docs are canonically homed in the portfolio (option b); resolve them from that package.
const BATCH_DOCS = packageDocsSourceOrNull("tjakoen.github.io/docs/batch/ARCHITECTURE.md");
const GRAIN_DOCS = packageDocsSourceOrNull("tjakoen.github.io/docs/grain/GRAIN.md");
if (!BATCH_DOCS || !GRAIN_DOCS) {
  console.warn("[pantry] framework docs off: tjakoen.github.io (the docs-home package) not installed in this host");
}

// The framework doc sets PANTRY BUNDLES + renders through MILL (the host provides nothing for these).
// Each is a layer's own canonical docs/PLAN, rendered (not copied) — the single source stays in the
// origin package (batch/grain docs now home in the portfolio); PANTRY is a projection.
const FRAMEWORK_DOCS: MillCollection[] = ([
  BATCH_DOCS && { prefix: "/docs/batch", title: "BATCH", description: "The no-build, server-rendered hypermedia substrate.",
    source: BATCH_DOCS, adapter: { defaultLayout: bodyOnlyLayout } },
  GRAIN_DOCS && { prefix: "/docs/grain", title: "GRAIN", description: "The AI-interaction design system and default theme.",
    source: GRAIN_DOCS, adapter: { defaultLayout: bodyOnlyLayout } },
  { prefix: "/docs/plans", title: "Layer plans",
    description: "Each layer's own design plan (its canonical PLAN.md), rendered. Distinct from /plans — that's this project's task board.",
    source: filesSource({
      grain: fileURLToPath(import.meta.resolve("@tjakoen/grain/PLAN.md")),
      mill: fileURLToPath(import.meta.resolve("@tjakoen/mill/PLAN.md")),
      proof: fileURLToPath(import.meta.resolve("@tjakoen/proof/PLAN.md")),
      pantry: join(MODULE_DIR, "PLAN.md"),
    }),
    adapter: { defaultLayout: bodyOnlyLayout } },
] as (MillCollection | false | null)[]).filter(Boolean) as MillCollection[];

// The five stack members, for the home page. Status is honest (the honesty clause).

// Slug + title for a host docs dir. Common case is `./docs` (basename "docs") → the project's own
// docs, mounted at /docs/project and titled with the project name.
function hostDocsCollection(dir: string, projectName: string): MillCollection {
  const raw = basename(dir).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const slug = raw === "docs" ? "project" : raw;
  const title = slug === "project" ? projectName : basename(dir);
  return {
    prefix: `/docs/${slug}`, title, description: `${projectName}'s own docs, rendered in place (never copied).`,
    source: filesSourceFromDir(dir), adapter: { defaultLayout: bodyOnlyLayout },
  };
}

// The exact MILL doc collections an install serves — bundled framework docs (when /docs on) + the
// host's own docs dirs (rendered in place). Exported so the doc-drift lint (drift.ts) reads the SAME
// brain the handler serves; /standards is a surface, not a brain doc collection (mirrors buildKnowledge).
export function buildDocCollections(config: ResolvedPantryConfig): MillCollection[] {
  return [
    ...(config.surfaces.docs ? FRAMEWORK_DOCS : []),
    ...(config.surfaces.docs ? config.docsDirs.map((d) => hostDocsCollection(d, config.projectName)) : []),
  ];
}

/** Where the review rail should read tours from: the project's own mount, PANTRY's, or nowhere. */
export type ToursSource = "project" | "pantry" | "none";

/**
 * Decide, on the SERVER, which mount answers for tours.
 *
 * **This was the rail's job until a reviewer broke it, twice, in the same way.** The client probed
 * the project's `/crumb/tours.json` and accepted any 2xx as proof. A project that answers unmatched
 * paths with `200 text/html` — the ordinary SPA catch-all, and precisely the kind of app Tier 1
 * exists to reach — made the wrong candidate win. PANTRY's own tours were then never tried, the
 * `res.json()` on an HTML body threw, and the rail reported that neither source had tours while one
 * of them was serving them correctly the whole time.
 *
 * Moving it here fixes more than the missing content-type check. A probe in the browser is reachable
 * by no test in this repo, which is why it shipped wrong; a probe here is a function with arguments.
 * The check is what it always should have been: a 2xx, a JSON content type, and a body that really
 * parses to an array. Anything short of all three is not a manifest, whatever its status line said.
 *
 * The project always wins where it genuinely answers, because a GRAIN host owns its own tours and a
 * copy carried by PANTRY would be a second source that disagrees the first time either is edited.
 */
export async function resolveToursSource(
  previewTarget: string | null,
  hasOwnTours: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<ToursSource> {
  if (previewTarget) {
    try {
      const res = await fetchImpl(`${previewTarget}/crumb/tours.json`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TOURS_PROBE_TIMEOUT_MS),
      });
      const type = res.headers.get("content-type") ?? "";
      if (res.ok && type.includes("json") && Array.isArray(await res.json())) return "project";
    } catch {
      // Unreachable, slow, or not JSON. All three mean the same thing here: not a manifest.
    }
  }
  return hasOwnTours ? "pantry" : "none";
}

/** How long the project gets to answer the manifest probe. It is loopback and the review page is
 *  waiting on it, so this is short on purpose: a project that cannot answer in a second has told us
 *  what we needed to know. */
export const TOURS_PROBE_TIMEOUT_MS = 1_000;

// The review shell (P1): PANTRY's chrome drawn AROUND the project it is proxying. The project sits
// in a same-origin frame at the root, so it is the real running app rather than a picture of one,
// and PANTRY keeps the rail beside it.
//
// Which mount the rail reads tours from is decided above and stamped into the markup, so the client
// carries no discovery logic at all. PANTRY never parses a tour either way; CRUMB keeps drawing the
// card and the lamp inside the frame, which is the call the plan left open and the owner settled on
// 2026-08-10 — the standalone path for a GRAIN host with no PANTRY alongside stays intact.
function reviewBody(previewTarget: string, surfaces: PantrySurfaces, tours: ToursSource): string {
  // Root-relative, and NOT carrying the prefix themselves. PANTRY rebases its own root-absolute
  // hrefs on the way out (`rebasePantryResponse`), so a link written with the prefix already on it
  // gets the prefix a second time and every cockpit link in this rail 404s at
  // `/__pantry/__pantry/plans`. Shipped that way since P1 and found by a reviewer reading the live
  // HTML: the header nav two inches above uses root-relative hrefs and was always right, which is
  // exactly why nobody noticed this half was not.
  const railLinks = [
    surfaces.plans && ["/plans", "Plans"],
    surfaces.runs && ["/runs", "Runs"],
    surfaces.runs && ["/usage", "Usage"],
    surfaces.decisions && ["/decisions", "Decisions"],
    surfaces.decisions && ["/answers", "Answers"],
    surfaces.artifacts && ["/artifacts", "Artifacts"],
    surfaces.timeline && ["/timeline", "Timeline"],
  ].filter(Boolean) as [string, string][];

  // The tours mount, resolved server-side and stamped. `none` is a real answer and gets an empty
  // base rather than a missing attribute, so the client reads one thing in every case.
  const toursBase = tours === "project" ? "/crumb" : tours === "pantry" ? `${PANTRY_PREFIX}/crumb` : "";
  return `<div class="pantry-review" data-rail="open" data-tours-base="${escapeHtml(toursBase)}" data-tours-source="${tours}">
  <aside class="pantry-review__rail" aria-label="Review rail">
    <div class="pantry-review__railhead">
      <b class="pantry-review__title">Review</b>
      <span class="pantry-review__target">${escapeHtml(previewTarget)}</span>
    </div>
    <section class="pantry-review__group" aria-labelledby="pantry-review-steps" data-steps-group hidden>
      <h2 class="pantry-review__grouptitle" id="pantry-review-steps">Steps</h2>
      <ol class="pantry-review__steps" data-steps></ol>
      <p class="pantry-review__note">Where you are in the walk. What each step says is in the card, not repeated here.</p>
    </section>
    <section class="pantry-review__group" aria-labelledby="pantry-review-tours">
      <h2 class="pantry-review__grouptitle" id="pantry-review-tours">Reviews</h2>
      <ol class="pantry-review__tours" data-tours>
        <li class="pantry-review__empty">Looking for tours…</li>
      </ol>
      <!-- Whose tours these are. Empty on a GRAIN host, where the project answers for its own and
           the question does not arise; filled on Tier 1, where the walk lives in the repo running
           PANTRY and a reviewer who goes looking for the file in the project will not find it. -->
      <p class="pantry-review__note" data-tour-source></p>
    </section>
    <!-- A review that has been answered AND acked is done, and leaving it in the list above with
         "2 of 3 awaiting you" beside it is the rail lying: the step statuses come from the tour FILE,
         which knows nothing about the answer that arrived after it was written. Folded rather than
         deleted, because "where did the one I answered go" is the next question, and a list that
         empties into nowhere is worse than one that never emptied. -->
    <details class="pantry-review__group" data-closed-group hidden>
      <summary class="pantry-review__grouptitle" data-closed-title>Closed</summary>
      <ol class="pantry-review__tours" data-closed></ol>
      <p class="pantry-review__note">Answered, and a session has acked the answer. Nothing here is waiting on you or on the AI.</p>
    </details>
    <!-- A demo tour is product work: it shows someone round the app. A review tour is dev work: it
         asks someone to check a change. They share a file format and nothing else, and mixing them
         in one list makes the rail read as a menu rather than a queue. Demos are kept, because a
         reviewer sometimes does want to walk the product, but they are second and folded away. -->
    <details class="pantry-review__group" data-demos-group hidden>
      <summary class="pantry-review__grouptitle">Demo tours</summary>
      <ol class="pantry-review__tours" data-demos></ol>
      <p class="pantry-review__note">Product walkthroughs, not review work. Here because they run in the same frame.</p>
    </details>
    <section class="pantry-review__group" aria-labelledby="pantry-review-cockpit">
      <h2 class="pantry-review__grouptitle" id="pantry-review-cockpit">Cockpit</h2>
      <ul class="pantry-review__links">
        ${railLinks.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join("\n        ")}
      </ul>
    </section>
  </aside>
  <div class="pantry-review__pane">
    <div class="pantry-review__bar">
      <button class="pantry-review__toggle" type="button" data-rail-toggle aria-expanded="true">Hide rail</button>
      <button class="pantry-review__toggle" type="button" data-card-toggle aria-pressed="false" hidden>Fold card</button>
      <span class="pantry-review__url" data-frame-url>/</span>
      <!-- Same origin means PANTRY and the reviewed app share localStorage, and both read GRAIN's
           theme keys, so forcing a scheme here reaches the app on its next load. That is useful and
           it is also the sort of thing that makes a reviewer file a bug against a screen they
           themselves restyled, so it is stated rather than left to be discovered. -->
      <span class="pantry-review__themed" data-themed hidden></span>
      <!-- There is no Record button any more, and its absence is the point. It existed because CRUMB
           owns the card and PANTRY owns the chrome, so the card's own Finish could not write and a
           second button out here had to. That is an implementation boundary showing up in the
           reviewer's hands: the first person to walk this answered the card, pressed Finish, and lost
           what they typed. Finishing the card IS the answer now, and this span is where the outcome
           is echoed. The boundary is unchanged — PANTRY still only watches the card close. -->
      <span class="pantry-review__recordstatus" data-record-status role="status" hidden></span>
      <a class="pantry-review__open" target="_blank" rel="noopener" data-frame-open>Open full</a>
    </div>
    <!-- The frame's target is carried in data-src and set by the client, NOT in src. Every
         root-absolute URL on a PANTRY page is rebased onto the reserved prefix on the way out, which
         is right for every link here and exactly wrong for this one: rebasing it would frame PANTRY
         inside PANTRY instead of the project. Caught by walking the shell, not by reading it. -->
    <iframe class="pantry-review__frame" data-src="/" title="The project being reviewed, served under PANTRY's origin" data-frame></iframe>
    <!-- The receipt for the one control that writes. It is NOT the bar's status line moved: the bar
         keeps its compact echo, and this is the thing a reviewer actually sees, because the bar is at
         the top of the pane and the card they just answered is at the bottom of the frame, six
         hundred pixels away. Measured, not guessed: the first human to press Record read the bar as
         silence and asked whether anything had been written.
         Hueless on purpose. GRAIN collapses --color-success and --color-danger to --ink, so an
         outcome cannot be signalled by colour here; it is signalled by an eyebrow that says the
         outcome in words, and success and failure differ in what they say rather than in hue.
         It overlays the frame rather than sitting in the pane's flow so that appearing does not
         reflow the app being reviewed, which would be a layout change PANTRY caused and the reviewer
         would then report. -->
    <div class="pantry-review__receipt" data-receipt hidden role="status" aria-live="polite">
      <p class="pantry-review__receipteyebrow" data-receipt-eyebrow></p>
      <p class="pantry-review__receiptmsg" data-receipt-message></p>
      <div class="pantry-review__receiptacts">
        <!-- Root-absolute, so PANTRY's own rebase puts it under the reserved prefix like every other
             link on this page. New tab because the reviewer is mid-walk: sending them to the log in
             this tab would end the review to prove the review was recorded. -->
        <a class="pantry-review__receiptlink" href="/answers" target="_blank" rel="noopener" data-receipt-log hidden>Read it in the answer log</a>
        <button class="pantry-review__receiptclose" type="button" data-receipt-close>Dismiss</button>
      </div>
    </div>
  </div>
</div>`;
}

export interface PantryOptions {
  /** the HOST project's plans folder (absolute or cwd-relative) — back-compat shorthand */
  plansDir: string;
  /** the full resolved host config (from loadPantryConfig); when omitted a default is derived from plansDir */
  config?: ResolvedPantryConfig;
  /** the HOST project root — where doctor runs its heartbeat checks (CLAUDE.md/AUDIT.md/standards live
   *  here, not under plansDir). servePantryFromCwd passes it; when omitted it falls back to the plans
   *  dir's parent (plansDir is conventionally <cwd>/plans). */
  cwd?: string;
  /** override GRAIN's location (defaults to the resolved package) */
  grainRoot?: string;
  /** where artifact opens are recorded (defaults to the PANTRY home); tests point it at a temp dir */
  opensFile?: string;
}

const defaultConfig = (plansDir: string): ResolvedPantryConfig => ({
  cwd: dirname(plansDir),
  projectName: basename(dirname(plansDir)) || "project",
  plansDir, docsDirs: [], graphPath: null, graphDir: join(dirname(plansDir), "graphify-out"),
  decisionsDir: join(plansDir, "decisions"),
  answersLog: join(plansDir, "decisions", "answers.jsonl"),
  sessionsLog: resolveSessionsLog(dirname(plansDir)),
  artifactsDir: join(dirname(plansDir), "artifacts"),
  runsDir: join(dirname(plansDir), "artifacts", "runs"),
  previewTarget: null,
  previewCommand: null,
  previewCommandCwd: dirname(plansDir),
  toursDir: null,
  hygiene: DEFAULT_HYGIENE,
  contextBudgetChars: DEFAULT_CONTEXT_BUDGET,
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true, decisions: true, artifacts: true, timeline: true, runs: true, brief: true, control: false },
});

export function createPantryHandler(opts: PantryOptions) {
  const config = opts.config ?? defaultConfig(opts.plansDir);
  // /standards renders from the portfolio package's standards/ folder (STANDARDS_DIR above). A host
  // that doesn't install tjakoen.github.io resolves to null — auto-disable the surface (drops the
  // nav link + route) rather than serve an empty page. filesSourceFromDir is also null-safe, so this
  // is belt + braces.
  if (config.surfaces.standards && (!STANDARDS_DIR || !existsSync(STANDARDS_DIR))) {
    console.warn("[pantry] /standards off: tjakoen.github.io (standards/) not installed in this host");
    config.surfaces.standards = false;
  }
  const { surfaces } = config;
  // The host root doctor's heartbeat reads from — CLAUDE.md/AUDIT.md/standards sit here. The resolved
  // config already knows it (loadPantryConfig set config.cwd), so there is nothing to guess; an
  // explicit opts.cwd still wins for a caller that overrides.
  const cwd = opts.cwd ?? config.cwd;
  const grainRoot = opts.grainRoot ?? GRAIN_ROOT;
  const page = (title: string, body: string) => pantryPage(title, body, surfaces, { review: !!config.previewTarget, project: config.projectName });

  const serveStyles = makeStatic(bunRuntime, join(grainRoot, "styles"));
  // GRAIN's own client scripts, served from the package rather than copied. The cockpit only needs
  // the theming pair today (theme-boot.js + theme.js), but mounting the folder rather than two files
  // keeps PANTRY from growing a hand-maintained allowlist of grain's assets, which is the same
  // reason /styles/ is mounted whole.
  const serveScripts = makeStatic(bunRuntime, join(grainRoot, "scripts"));
  // GRAIN's own variables.css has always asked for the Redaction grades at /fonts/…, and PANTRY has
  // never mounted them, so the cockpit's display face has silently fallen back since the first page
  // it rendered. Found while proving the preview proxy, where the same missing request stopped being
  // invisible and started being aimed at the reviewed project's root instead.
  const fontsRoot = resolve(join(grainRoot, "fonts"));
  const componentCss = createStyleBundle(bunRuntime, join(grainRoot, "components"));
  // The two GRAIN sheets the tour layer needs on a foreign host: the token vocabulary CRUMB's card is
  // written against, and the spotlight's own geometry. Read from `grainRoot` rather than resolved at
  // module scope so a host that overrides grain's location gets its own copy of both.
  const GRAIN_VARIABLES_CSS = join(grainRoot, "styles", "variables.css");
  const GRAIN_AI_CSS = join(grainRoot, "ai", "ai.css");

  // Every MILL collection this install serves (framework docs + host docs); /standards is appended
  // below for the router but stays a surface, not a brain doc collection. buildDocCollections is the
  // single source so the doc-drift lint reads exactly what the server serves.
  const docCollections = buildDocCollections(config);
  const standardsCollection: MillCollection = {
    prefix: "/standards", title: "Standards",
    description: "The cross-repo writing + presentation standards (VOICE, NOTE, README, FIGURES), rendered.",
    source: filesSourceFromDir(STANDARDS_DIR), adapter: { defaultLayout: bodyOnlyLayout },
  };

  // One SSE hub, shared between the /stream subscribe route below and the piece-3 file watcher
  // started at the bottom of this function — a BATCH host reusing one host-wide stream, same
  // pattern as the standalone proof/serve.ts (which owns its own private stream instead).
  const stream = createStream();
  const proofRoutes = createProofRoutes({
    plansDir: config.plansDir, prefix: "/plans", chrome: (title, body) => page(title, body),
    liveScriptSrc: "/board-live.js",
  });
  const millRoutes = createMillRoutes({
    collections: [...docCollections, ...(surfaces.standards ? [standardsCollection] : [])],
    chrome: (input) => page(input.title, input.body),
  });
  const catalog = surfaces.catalog
    ? createCatalog(join(grainRoot, "components"), undefined, { headEnd: styleLinks })
    : null;

  // Piece 3: watch the host's plans/ and broadcast a live board replace on every change. PANTRY
  // has no app-wide teardown/close path today (it's `Bun.serve(createPantryHandler(...))`, no
  // handle returned) — so this watcher is left running for the process's lifetime, same as the
  // server itself. When a close path is added, wire `watcher.stop()` into it.
  // PROOF rebuilds the board on a file change and BROADCASTS the fresh HTML, which the client
  // assigns with innerHTML. That frame never passes through this server's response path, so the two
  // repairs the board's markup needs have to be made here, before it leaves, or the first live
  // update silently undoes both: the card-link fix below, and the prefix rebase while the preview
  // proxy is on. This was found by a reviewer who noticed the response path and the push path are
  // not the same path, which is exactly the kind of thing a second pair of eyes is for.
  const boardChannel = {
    broadcast(event: string, data: unknown) {
      const op = data as { html?: unknown };
      if (op && typeof op === "object" && typeof op.html === "string") {
        stream.broadcast(event, { ...op, html: rebasePantryHtml(fixProofCardLinks(op.html), base) });
        return;
      }
      stream.broadcast(event, data);
    },
  };
  if (surfaces.plans) watchPlans({ plansDir: config.plansDir, channel: boardChannel });
  // Orchestration (plans/pantry-orchestrator.md): under the hub a child knows its registry name and
  // the hub's home, and the board shows who holds each plan. Unset under a plain `pantry serve`.
  const claimProject = process.env.PANTRY_PROJECT;
  const claimHome = process.env.PANTRY_HOME;
  const annotate = async (html: string): Promise<string> => {
    if (!claimProject || !claimHome) return html;
    try { return annotateBoard(html, await boardAnnotations(config.cwd ?? dirname(config.plansDir), claimHome, claimProject)); }
    catch { return html; }
  };
  // The live stream only follows plansDir, and a claim is written to the hub's home, so the claims
  // file gets its own watch. Polling, because file events across the Docker mount are unreliable.
  // PROOF does not export its board renderer, so it is resolved beside the loader it ships with.
  if (surfaces.plans && claimProject && claimHome) {
    watchFile(claimsFile(claimHome, claimProject), { interval: 5000 }, async () => {
      try {
        const { loadPlans } = await import("@tjakoen/proof/loader.ts");
        const { renderBoardBody } = await import(new URL("./board.ts", import.meta.resolve("@tjakoen/proof/loader.ts")).href);
        const { OP_EVENT } = await import("@tjakoen/grain/ai/contract.ts");
        const { plans, duplicates } = await loadPlans(config.plansDir);
        const html = await annotate(renderBoardBody(plans, duplicates));
        stream.broadcast(OP_EVENT, { target: "proof-board", op: "replace", html: rebasePantryHtml(fixProofCardLinks(html), base), provenance: "system", commit: "committed" });
      } catch { /* the next poll tries again */ }
    });
  }

  // The dev preview proxy (plans/pantry-review-layer.md P0). OFF unless the host configured a target,
  // and when it is on PANTRY's own routes move wholesale under the reserved prefix so the reviewed
  // project owns the root. `base` is the empty string in the ordinary case, which makes every rebase
  // below a no-op and leaves the no-preview path byte-identical to what it always served.
  const previewTarget = config.previewTarget;
  const base = previewTarget ? PANTRY_PREFIX : "";
  if (previewTarget) {
    console.log(`[pantry] preview proxy ON: ${previewTarget} served at / · PANTRY's own surfaces at ${PANTRY_PREFIX}/`);
  }
  const reviewClientTag = `<script src="${PANTRY_PREFIX}/pantry-review-client.js" defer></script>`;

  // --- Tier 1: PANTRY carries CRUMB into a project that has never heard of it (P4) ---------------
  // Tier 0 needs nothing here: the app runs in the frame and a `verify:` line is something a human
  // performs. Tier 1 is the step up to ADDRESSABILITY — a step names a `data-surface` and the lamp
  // lights it — and that needs a tour client in the page. On a GRAIN host the host already puts one
  // there. On anything else, PANTRY does, from its own prefix, and the reviewed project still ships
  // nothing and installs nothing.
  //
  // Three tags rather than the one P0 promised, and worth saying plainly instead of letting the
  // count drift: the stylesheet, the prefix, and the client. The prefix is set from an inline script
  // rather than by rewriting the `<html>` tag, which keeps the injection to ONE insertion point —
  // still just before `</body>` — instead of teaching the proxy to edit the document element too.
  //
  // **The token sheet goes first, and finding out why took a walk.** `crumb.css` is written against
  // GRAIN's token vocabulary, so on a host that defines none of those names the card renders with no
  // background, no border and no radius: transparent text lying over the app, which a reviewer reads
  // as broken rather than as unstyled. GRAIN's `variables.css` is the fix and it is a safe one for a
  // reason worth stating rather than assuming — it declares custom properties and `@font-face` and
  // NOTHING else, no element rules at all, so every name it defines is a name the reviewed app never
  // reads. That is also the honest answer to the theme-leak question for a non-GRAIN target: there is
  // nothing to leak into. A GRAIN target is the case where the question stays open, and a GRAIN
  // target gets none of these tags anyway.
  const crumbPrefix = `${PANTRY_PREFIX}/crumb`;
  const crumbTags = config.toursDir
    ? `<link rel="stylesheet" href="${PANTRY_PREFIX}/tour.css">`
      + `<script>document.documentElement.dataset.crumbPrefix="${crumbPrefix}"</script>`
      + `<script type="module" src="${PANTRY_PREFIX}/crumb-live.js"></script>`
    : "";
  const crumbRoutes = config.toursDir ? createCrumbRoutes({ toursDir: config.toursDir, prefix: "/crumb" }) : null;
  if (previewTarget && crumbTags) {
    console.log(`[pantry] tours served at ${crumbPrefix} from ${config.toursDir} · injected into pages that do not run CRUMB themselves`);
  }
  // Decided per PAGE, not per boot, because "does this project run CRUMB" is a fact about the
  // document rather than about the config: one route of a host can mount it and another not. Two
  // clients on one page would drive the same `crumb:active` key from two places, and the symptom is a
  // flickering tour rather than a duplicated script.
  const injectInto = (html: string): string =>
    crumbTags && !pageAlreadyRunsCrumb(html) ? crumbTags + reviewClientTag : reviewClientTag;

  // PANTRY's own routing, taking the path with any reserved prefix ALREADY stripped. Returns null for
  // "not one of mine" so the caller decides what that means: a 404 with the proxy off, and a pass to
  // the target with it on.
  const pantryRoutes = async (path: string, url: URL, req: Request, clientAddress: string | null): Promise<Response | null> => {
    // --- the answer write-back (P2): the ONE channel an answer comes back on, and the only route in
    // PANTRY that writes anything. Every bound on it is here, in one place, rather than spread across
    // the handler: loopback socket, POST only, a body cap, a validated shape that must carry its own
    // question, and a path that comes from config and can never be named by the request. ---
    if (surfaces.decisions && path === "/answers" && req.method === "POST") {
      return recordAnswerRequest(req, clientAddress, config.answersLog);
    }

    // --- assets ---
    if (path.startsWith("/styles/")) return rebaseCssResponse(await serveStyles(path.slice("/styles".length)), base);
    if (path.startsWith("/scripts/")) return serveScripts(path.slice("/scripts".length));
    if (path.startsWith("/fonts/")) return serveFont(fontsRoot, path.slice("/fonts/".length));
    if (path === "/components.css")
      return new Response(rebasePantryCss(await componentCss.css(), base), { headers: { "Content-Type": "text/css" } });
    if (path === "/proof.css")
      return new Response(rebasePantryCss(await bunRuntime.readFile(PROOF_CSS), base), { headers: { "Content-Type": "text/css" } });
    if (path === "/pantry.css")
      return new Response(rebasePantryCss(await bunRuntime.readFile(join(MODULE_DIR, "pantry.css")), base), { headers: { "Content-Type": "text/css" } });
    if (path === "/board-live.js")
      return new Response(rebaseBoardLive(await bunRuntime.readFile(BOARD_LIVE_JS), base), { headers: { "Content-Type": "text/javascript" } });
    if (path === "/pantry-review-client.js")  // the one tag injected into a proxied page (preview.ts)
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry-review-client.js")), { headers: { "Content-Type": "text/javascript" } });
    // CRUMB's browser half, served by PANTRY so a non-GRAIN project needs neither (P4). The client's
    // one absolute import is the spotlight, which PANTRY already serves at /scripts/ — rebased here
    // because under the prefix that path would otherwise be fired at the reviewed app's root.
    if (crumbRoutes && path === "/crumb-live.js")
      return new Response(rebaseCrumbLive(await bunRuntime.readFile(CRUMB_LIVE_JS), base), { headers: { "Content-Type": "text/javascript" } });
    // ONE stylesheet for the whole tour layer, composed here and in this order, because that order is
    // the cascade and splitting it across three links would put the cascade in the injection string.
    //
    // The composition is the finding rather than the plumbing. `crumb.css` alone renders a card with
    // no background, no border and no radius on a host that defines none of GRAIN's tokens, and
    // `ai.css` alone is what the lamp's geometry lives in — without it the lamp is a static div in
    // the body flow, sitting hundreds of pixels from the element it claims to be lighting while every
    // other part of the walk looks correct. Both were found by looking at the screen; neither is
    // visible from the code, which says only that a stylesheet was served.
    //
    // Safe on a foreign app because the unsafe part is REMOVED rather than asserted to be absent.
    // The first version of this comment claimed all three files were scoped to names the reviewed app
    // does not use, and a reviewer found `html[data-xray] [data-surface]` sitting in `ai.css` — where
    // `data-surface` is the one attribute PANTRY asks a project to add. `spotlightRulesOnly` drops
    // every rule that reaches for `html`, `body` or a `data-` attribute, so what is served is the
    // lamp and nothing else. `variables.css` and `crumb.css` go through whole: the first is custom
    // properties and `@font-face`, the second is `.crumb-*` classes, and both are checked by test.
    if (crumbRoutes && path === "/tour.css") {
      const [tokens, ai, card] = await Promise.all([GRAIN_VARIABLES_CSS, GRAIN_AI_CSS, CRUMB_CSS].map((f) => bunRuntime.readFile(f)));
      const composed = [tokens, spotlightRulesOnly(ai!), card].join("\n");
      return new Response(rebasePantryCss(composed, base), { headers: { "Content-Type": "text/css" } });
    }
    if (path === "/pantry-cmdk.js")   // ⌘K palette (piece 9b) — reads its index from /knowledge.json
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry-cmdk.js")), { headers: { "Content-Type": "text/javascript" } });
    if (path === "/pantry-review.js")  // the review shell's rail (P1) — reads the project's own tours
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry-review.js")), { headers: { "Content-Type": "text/javascript" } });
    if (path === "/pantry-map.js")     // mindmap viz (piece 10) — reads its graph from /map.json
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry-map.js")), { headers: { "Content-Type": "text/javascript" } });
    if (path === "/pantry-control.js")   // control center (C1) — ages the idle labels in place
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry-control.js")), { headers: { "Content-Type": "text/javascript" } });
    if (path === "/pantry-decisions.js")   // decision inbox (piece 11d) — the client generate-prompt flow
      return new Response(await bunRuntime.readFile(join(MODULE_DIR, "pantry-decisions.js")), { headers: { "Content-Type": "text/javascript" } });

    // --- the live channel (piece 3): the board's SSE subscribe endpoint ---
    if (path === "/stream") return stream.subscribe(url.searchParams.get("session") ?? "default");

    const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

    // --- the AI-retrieval brain (piece 9): model-free, pure reads. knowledge.json = the machine
    // payload; llms.txt = the session context pack ("what an agent should read first"). Both derive
    // from the SAME sources the human surfaces render (one brain, two projections), so no drift. ---
    if (path === "/knowledge.json")
      return Response.json(await buildKnowledge(config, docCollections, new Date().toISOString()));
    if (path === "/llms.txt")
      return new Response(renderLlmsTxt(await buildKnowledge(config, docCollections, new Date().toISOString())),
        { headers: { "Content-Type": "text/plain; charset=utf-8" } });

    // --- the mindmap (piece 10): human viz at /map, its machine twin at /map.json. Same model
    // (buildMapPayload over the host's graphify-out), so the picture and the payload never drift.
    // Absent graphify-out degrades to guidance, never a 500 — same posture as the other surfaces. ---
    if (path === "/map.json")
      return Response.json(await buildMapPayload(config, new Date().toISOString()));
    if (path === "/map")
      return html(page("Mindmap", mapBody(await buildMapPayload(config, new Date().toISOString()))));

    // --- the control center (C0): the machine twin only. One row per session the harness emitter
    // saw in this project, folded from an append-only log PANTRY reads and never writes. The page
    // that joins these rows to the plan board is C1; until then this is the record and nothing else.
    if (surfaces.control && path === "/sessions.json") {
      // Loopback only, the same rule the answer WRITE takes, and for a read this time: a row names
      // the operator's home directory, every session id and every file a session wrote. Bun.serve is
      // started without a hostname, which binds every interface, so without this the surface is on
      // the LAN. The plan said this must be loopback only; a sentence in a plan binds nothing.
      if (!isLoopbackRequest(clientAddress)) {
        return Response.json({ error: "The session log is readable from this machine only." }, { status: 403 });
      }
      return Response.json(await buildSessionsPayload(config, new Date().toISOString()));
    }
    // C1: the page over the same record, joined to the plan board. The loopback rule is the twin's
    // rule and for the same reason, because the page shows strictly more than the JSON does: a
    // session id, the files it wrote, and now which plan those files belong to.
    if (surfaces.control && path === "/control") {
      if (!isLoopbackRequest(clientAddress)) {
        return new Response("The control center is readable from this machine only.", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      // The session parameter is what makes this replayable. A run that ended last week is read the
      // same way as the one in front of you, because both are only ever files.
      const asked = url.searchParams.get("session") ?? undefined;
      return html(page("Control", controlBody(await buildControlPayload(config, new Date().toISOString(), { session: asked }))));
    }

    // The session timeline: lanes per session with their subagents nested, over a chosen window.
    // On with the command center, which already shows the same sessions; loopback-only like /control.
    if ((surfaces.brief || surfaces.control) && path === "/activity") {
      if (!isLoopbackRequest(clientAddress)) {
        return new Response("Activity is readable from this machine only.", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      const asked = Number(url.searchParams.get("hours"));
      const hours = (ACTIVITY_WINDOWS as readonly number[]).includes(asked) ? asked : 24;
      const payload = await buildActivity(config, new Date().toISOString(), hours);
      return html(page("Activity", activityBody(payload)));
    }
    if ((surfaces.brief || surfaces.control) && path === "/activity.json") {
      if (!isLoopbackRequest(clientAddress)) return new Response("Forbidden", { status: 403 });
      const asked = Number(url.searchParams.get("hours"));
      const hours = (ACTIVITY_WINDOWS as readonly number[]).includes(asked) ? asked : 24;
      return Response.json(await buildActivity(config, new Date().toISOString(), hours));
    }

    // --- the decision inbox (piece 11d): human /decisions + /decisions/<id>, machine twin /decisions.json.
    // Same model (buildDecisionsPayload over the host's plans/decisions), so the cards and the payload
    // never drift. Read-only + model-free; the generated prompt (client-side) is the only write path. ---
    if (surfaces.decisions && path === "/decisions.json")
      return Response.json(await buildDecisionsPayload(config, new Date().toISOString()));
    if (surfaces.decisions && path === "/decisions")
      return html(page("Decisions", decisionsIndexBody(await buildDecisionsPayload(config, new Date().toISOString()))));
    if (surfaces.decisions && path.startsWith("/decisions/")) {
      const id = decodeURIComponent(path.slice("/decisions/".length));
      const payload = await buildDecisionsPayload(config, new Date().toISOString());
      const d = payload.decisions.find((x) => x.id === id);
      if (d) return html(page(d.title, decisionDetailBody(d)));
      return new Response("Not found", { status: 404 });
    }

    // --- the answer log (P2, the read half): human /answers, machine twin /answers.json. It rides on
    // the decisions toggle rather than earning one of its own, because a question and its answer are
    // one surface split across two pages, and a host that turned the inbox off has no use for either. ---
    if (surfaces.decisions && path === "/answers.json") {
      const log = await readAnswerLog(config.answersLog);
      return Response.json({
        path: log.path,
        malformed: log.malformed,
        readError: log.readError,
        unread: unacked(log),
        answers: answers(log),
        generatedAt: new Date().toISOString(),
      }, { status: log.readError || log.malformed ? 503 : 200 });
    }
    if (surfaces.decisions && path === "/answers")
      return html(page("Answers", answersBody(await readAnswerLog(config.answersLog), config.projectName)));

    // --- the run ledger (piece 11c): human /runs + /runs/<id>, machine twin /runs.json. Each closed
    // run report parsed against LOOP.md §9, with the items it is missing. The human page was the open
    // owner question this piece deliberately left unbuilt; it was answered 2026-08-09 in favour of a
    // dedicated surface, because a session that hands the owner a link instead of a chat summary needs
    // somewhere to point that cannot flatter the run. Same payload backs both views, so they never
    // drift. On the DEFAULT layout the report source is fetchable too — reports live under artifacts/,
    // so /artifacts/raw/runs/<file>.md serves the bytes with the containment that route enforces. That
    // only holds while runsDir sits under artifactsDir; a host that points runsDir elsewhere gets the
    // parsed views here and no raw route, which is a deliberate limit rather than a promise to keep. ---
    // --- token usage: per model, per claimed plan, per area, read from the harness transcripts. Behind
    // the runs flag because it is the same kind of after-the-fact ledger. ---
    if (surfaces.runs && path === "/usage.json")
      return Response.json(await buildUsageForConfig(config, new Date().toISOString()));
    if (surfaces.runs && path === "/usage")
      return html(page("Usage", usageBody(await buildUsageForConfig(config, new Date().toISOString()))));
    if (surfaces.runs && path === "/runs.json")
      return Response.json(await buildRunsPayload(config, new Date().toISOString()));
    if (surfaces.runs && path === "/runs")
      return html(page("Runs", runsIndexBody(await buildRunsPayload(config, new Date().toISOString()))));
    if (surfaces.runs && path.startsWith("/runs/")) {
      const id = decodeURIComponent(path.slice("/runs/".length));
      const payload = await buildRunsPayload(config, new Date().toISOString());
      const r = payload.runs.find((x) => x.id === id);
      if (r) return html(page(r.title, runDetailBody(r)));
      return new Response("Not found", { status: 404 });
    }

    // --- run artifacts (piece 11e sub-unit 1): human /artifacts, machine twin /artifacts.json, raw
    // bytes at /artifacts/raw/<relPath>. Same model (buildArtifactsPayload over the host's artifacts
    // dir) backs both views. Read-only + model-free, like every surface; /raw is the one route here
    // that touches the filesystem beyond a directory read, so its path handling is the load-bearing
    // security boundary (see serveArtifactRaw above) — never trust the URL path uncontained. ---
    if (surfaces.artifacts && path === "/artifacts.json")
      return Response.json(await buildArtifactsPayload(config, new Date().toISOString()));
    if (surfaces.artifacts && path === "/artifacts")
    {
      const payload = await buildArtifactsPayload(config, new Date().toISOString());
      const view = explorerView(url.searchParams);
      const entry = view.file ? payload.artifacts.find((a) => a.relPath === view.file) : undefined;
      const preview = view.file ? await readPreview(config.artifactsDir, entry) : null;
      // Read the opens before recording this one, so the pane can say when it was last opened before now.
      const opensFile = opts.opensFile ?? opensPath(config.projectName);
      const opens = readOpens(opensFile);
      const body = artifactsIndexBody(payload, view, preview, opens);
      if (entry) recordOpen(opensFile, entry.relPath);
      return html(page("Artifacts", body));
    }
    if (surfaces.artifacts && path.startsWith("/artifacts/raw/")) {
      const reqPath = decodeURIComponent(path.slice("/artifacts/raw/".length));
      return serveArtifactRaw(config.artifactsDir, reqPath);
    }

    // --- the retrospective timeline (piece 11e sub-unit 3): human /timeline, machine twin
    // /timeline.json. Same model (buildTimelinePayload over git + the host's plans/ + report mtimes)
    // backs both, so the picture and the payload never drift. Read-only + model-free; git is a history
    // read here, never a forecast. Absent repo/plans degrades to guidance, never a crash. ---
    if (surfaces.timeline && path === "/timeline.json")
    {
      const payload = await cachedTimelinePayload(config, 8_000);
      return payload ? Response.json(payload) : Response.json({ available: false, reason: "still reading git history; retry shortly" }, { status: 503, headers: { "Retry-After": "5" } });
    }
    if (surfaces.timeline && path === "/timeline")
    {
      // Titles straight from each plan's first heading: the plan loader runs git per file, and the
      // timeline has already paid for its own git reads.
      const titles = new Map<string, string>();
      for (const f of await Array.fromAsync(new Bun.Glob("*.md").scan({ cwd: config.plansDir }))) {
        const head = (await Bun.file(join(config.plansDir, f)).text()).slice(0, 4000);
        const m = /^#\s+(.+)$/m.exec(head.replace(/^---[\s\S]*?\n---\n/, ""));
        const id = /^id:\s*(.+)$/m.exec(head)?.[1]?.trim() ?? f.replace(/\.md$/, "");
        if (m) titles.set(id, m[1].trim());
      }
      const view = { sort: url.searchParams.get("sort") === "recent" ? "recent" as const : "start" as const, titles };
      const payload = await cachedTimelinePayload(config, 8_000);
      if (!payload) {
        return html(page("Plan timeline", `<section class="tl"><h1>Plan timeline</h1><p class="cc-empty">Reading every plan's git history. This page refreshes on its own in a few seconds.</p><meta http-equiv="refresh" content="4"></section>`));
      }
      return html(page("Plan timeline", timelineBody(payload, view)));
    }

    // --- landings PANTRY owns ---
    // The alignment brief (plans/pantry-brief.md) is the home page while its surface is on.
    const brief = await briefRoute(path, config, page);
    if (brief) return brief;
    if (path === "/") {
      // The heartbeat row: doctor's staleness checks, computed at request time with `now` injected for
      // determinism. Doctor runs NO model — every check is a stat/age compare. ANY throw (a bare repo,
      // an unresolvable drift lint) degrades to a home WITHOUT the row, never a 500. Reuse the already
      // resolved config so doctor doesn't re-read pantry.config off disk.
      let freshness: DoctorReport | null = null;
      try {
        freshness = await runDoctor({ cwd, config, now: new Date(), runDrift: true });
      } catch (err) {
        console.warn("[pantry] heartbeat off:", err);
        freshness = null;
      }
      return html(page("Home", homeBody(config, surfaces, freshness)));
    }
    // The review shell (P1). It exists only while the proxy does, because the frame it draws has
    // nothing to point at otherwise.
    if (previewTarget && path === "/review") {
      const tours = await resolveToursSource(previewTarget, !!crumbRoutes);
      return html(pantryPage("Review", reviewBody(previewTarget, surfaces, tours), surfaces, { review: true, fullBleed: true, project: config.projectName }));
    }

    if (path === "/about") return html(page("About", aboutBody()));
    if (surfaces.docs && path === "/docs") return html(page("Docs", docsBody(docCollections)));

    // --- generated reference (read from the real registries, never hand-copied) ---
    if (surfaces.reference && path === "/reference") {
      const body = await buildVocabReference(join(grainRoot, "styles", "variables.css"));
      return html(page("Reference", `<header>
  <h1 class="proof-masthead">Reference</h1>
  <p class="proof-lede">Generated, not hand-copied — the AI vocabulary and GRAIN's token slots, read from the real source at request time.</p>
</header>
${body}`));
    }

    // --- the GRAIN component catalog (builds its own shell) ---
    if (catalog && path === "/catalog")
      return html(await catalog.html());

    // --- mounted layers: CRUMB tour data, PROOF board (/plans*), then MILL (docs + standards) ---
    // CRUMB serves the tour DATA that the injected client fetches (/crumb/tours.json and
    // /crumb/tours/<id>.json). It is crumb's own `createCrumbRoutes` over crumb's own loader — the
    // plan's "one parser, never a second" rule kept by importing the parser rather than by having
    // none, which is what P1 could get away with when the project always had its own.
    if (crumbRoutes) { const c = await crumbRoutes(path); if (c) return c; }
    if (surfaces.plans) { const r = await proofRoutes(path); if (r) return fixProofResponse(r, annotate); }
    const m = await millRoutes(path); if (m) return m;
    return null;   // not one of PANTRY's — the caller decides (404, or the preview target)
  };

  return async (req: Request, server?: PantryServer): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    // Bun hands the server to the fetch handler, and it is the only thing here that knows which
    // socket a request arrived on. Read once and passed down, so the write-back's loopback check has
    // a real address rather than a header anyone can set.
    const clientAddress = server?.requestIP?.(req)?.address ?? null;

    // The ordinary case: no preview target, PANTRY owns the root, nothing is rewritten.
    if (!previewTarget) {
      return (await pantryRoutes(path, url, req, clientAddress)) ?? new Response("Not found", { status: 404 });
    }

    // The proxy is on. PANTRY answers only under its reserved prefix; the root belongs to the target,
    // whole, so the reviewed app's root-relative URLs resolve exactly as they always did.
    if (path === PANTRY_PREFIX || path.startsWith(`${PANTRY_PREFIX}/`)) {
      const inner = path.slice(PANTRY_PREFIX.length) || "/";
      const res = await pantryRoutes(inner, url, req, clientAddress);
      if (!res) return new Response("Not found", { status: 404 });
      return rebasePantryResponse(res, base, inner);
    }

    return proxyToPreview(req, url, previewTarget, { inject: injectInto });
  };
}

// PANTRY's own HTML, moved onto the reserved prefix. This rewrites OUR output, never the target's —
// the reviewed app owns the root and is served byte-for-byte. An artifact's raw bytes are excluded
// because those are evidence a run deposited: rewriting a captured page would quietly falsify it.
async function rebasePantryResponse(res: Response, base: string, innerPath: string): Promise<Response> {
  if (!base) return res;
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  if (innerPath.startsWith("/artifacts/raw/")) return res;
  const html = withPantryBase(rebasePantryHtml(await res.text(), base), base);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(html, { status: res.status, statusText: res.statusText, headers });
}

// @tjakoen/proof's board.ts emits a plan card's link as the root-absolute `/plan/<id>` whatever
// prefix it was actually mounted under, so the link only resolves in a host that mounts PROOF at the
// root. PANTRY mounts it at /plans and has shipped the broken link since the board landed: a click on
// a card has never opened a plan here. The portfolio carries the identical workaround in its own
// server rather than editing the vendored package, and this is now the second copy of it, which is
// the honest signal that PROOF should be taking the prefix instead of two hosts patching the output.
// Found while moving the board under the preview prefix, which faithfully preserved the 404.
function fixProofCardLinks(html: string): string {
  return html.replaceAll('href="/plan/', 'href="/plans/plan/');
}

async function fixProofResponse(res: Response, annotate: (html: string) => Promise<string> = async (h) => h): Promise<Response> {
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;  // /plans.json carries no such href
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(fixProofCardLinks(await annotate(await res.text())), { status: res.status, statusText: res.statusText, headers });
}

// A font is bytes, and BATCH's static handler reads text — it would mistype and corrupt a woff2. So
// this serves them by hand with Bun.file, the same idiom and for the same reason as the portfolio's
// own font route. The containment check is the load-bearing line: the path comes off the URL, so it
// is resolved and confirmed to be under the fonts root before anything is opened.
async function serveFont(root: string, rel: string): Promise<Response> {
  const file = resolve(normalize(join(root, decodeURIComponent(rel))));
  if (!isInside(root, file)) return new Response("Forbidden", { status: 403 });
  const f = Bun.file(file);
  if (!(await f.exists())) return new Response("Not found", { status: 404 });
  return new Response(f, { headers: { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=31536000, immutable" } });
}

// GRAIN's stylesheets are served straight off disk by BATCH's static handler, so the rebase happens
// to the Response rather than to a string. Only CSS is read; anything else this route serves streams
// past untouched.
async function rebaseCssResponse(res: Response, base: string): Promise<Response> {
  if (!base) return res;
  if (!(res.headers.get("content-type") ?? "").includes("css")) return res;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(rebasePantryCss(await res.text(), base), { status: res.status, statusText: res.statusText, headers });
}

// PROOF's board-live.js opens its SSE channel at a hardcoded `/stream`, and it lives in the grain
// package rather than here — so under the reserved prefix it is rebased on the way out instead of
// edited upstream, which would cost a grain release to reach PANTRY at all. The miss is warned about
// rather than swallowed: a silently un-rebased literal would show up much later as a live board that
// simply never updates, which is the failure mode hardest to attribute back to here.
function rebaseBoardLive(js: string, base: string): string {
  if (!base) return js;
  // Matched by shape rather than by one exact literal: the quote style is whatever PROOF happens to
  // use, and pinning the backtick made this break on a reformat that changed nothing else.
  const rebased = js.replace(/(["'`])\/stream\?session=/g, (_m, quote) => `${quote}${base}/stream?session=`);
  if (rebased === js) {
    console.warn(`[pantry] board-live.js: no /stream literal found to rebase onto ${base} — the live board will not update while the preview proxy is on`);
  }
  return rebased;
}

// A dirSource-equivalent over a plain folder the host owns. (MILL's dirSource is for package docs;
// this reads any absolute dir — used for the host's docs and the bundled standards.) A missing/absent
// dir yields an EMPTY collection, never a readdir throw — so a vanished docsDir or an unresolved
// standards folder (the portfolio package not being installed) degrades the surface instead of
// 500-ing the server.
function filesSourceFromDir(dir: string | null): ContentSource {
  const ok = !!dir && existsSync(dir);
  return {
    list: async () => {
      if (!ok) return [];
      const { readdir } = await import("node:fs/promises");
      return (await readdir(dir!)).filter((f) => f.endsWith(".md")).map((f) => basename(f, ".md").toLowerCase());
    },
    read: async (slug) => {
      if (!ok) return null;
      const { readdir } = await import("node:fs/promises");
      const file = (await readdir(dir!)).find((f) => basename(f, ".md").toLowerCase() === slug.toLowerCase());
      return file ? Bun.file(join(dir!, file)).text() : null;
    },
  };
}

export function servePantry(opts: PantryOptions & { port?: number }) {
  return Bun.serve({ port: opts.port ?? 4400, fetch: createPantryHandler(opts) });
}

/** Boot from a host cwd: load the pantry.config there, then serve. The CLI's entry point. The
 *  resolved config comes back with the server because the CLI has to print the right doors, and with
 *  the preview proxy on those doors move — a boot banner naming routes the server no longer answers
 *  is the first thing that would make this feel broken. */
export async function servePantryFromCwd(opts: { cwd?: string; port?: number; previewTarget?: string | null } = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const config = await loadPantryConfig(cwd);
  // A target passed on the command line wins over the config, and goes through the SAME validation —
  // a flag is still a place a caller types a string, and the loopback rule does not get to be
  // optional because the string arrived by a different route.
  if (opts.previewTarget) {
    const flag = resolvePreviewTarget(opts.previewTarget);
    if (flag.problem) console.warn(`[pantry] --preview ignored: ${flag.problem}`);
    else config.previewTarget = flag.origin;
  }
  return { server: servePantry({ plansDir: config.plansDir, config, cwd, port: opts.port }), config };
}
