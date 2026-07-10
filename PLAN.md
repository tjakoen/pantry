# PANTRY — plan

> Status: **v2 built (2026-07-08): the cockpit surfaces (PROOF board + MILL-rendered framework docs
> + layer PLANs + `/reference` + `/catalog` + `/standards`), the host contract (`./docs` mounting +
> `pantry.config`), and the install kit (`pantry init` + `INSTALL.md`); `bunx pantry`. Surfaces gate
> on config toggles. Verified: all surfaces render, init scaffolds idempotently, a host `./docs`
> mounts in place.**
> **Reshaping (2026-07-09 → in progress): PANTRY is being re-pointed from a *stack showcase* to a
> *dev side-tool* — the front door becomes the project's own board, the stack pitch moves to
> `/about`, and AI-retrieval + the whole-codebase mindmap become the headline "working with AI"
> features. See §The reshape.**
> Canonical plan: this file. Cross-layer sequencing is Track F in [`../ROADMAP.md`](../ROADMAP.md).

## What PANTRY is for (the purpose)

**PANTRY is a side tool for developers — for their docs and for working with AI.** You `bunx` it into
a project you're building and it gives you (and the AI you build *with*) one addressable surface over
that project: its plans, its docs, the framework reference, and — the headline — a **retrievable,
navigable map of the whole codebase** that the AI already reading your repo can consume.

It is **not** an advertisement for the BREAD stack. The stack is *how* PANTRY is built and what it can
also render, but the person running `bunx pantry` has usually already adopted it into their own
project — selling them the stack is the wrong front door. (The BREAD pitch still lives here, at
`/about`; see §The reshape.)

PANTRY is an **app**, not a layer — the neutral, project-agnostic sibling of the portfolio. It
composes the layers (BATCH · GRAIN · MILL · PROOF) into one server, and everything it renders is
**package-resolved** (`import.meta.resolve`) from the installed deps; surfaces auto-disable when a
package is absent, they never crash.

## AI-legible, not AI-powered (the load-bearing constraint)

**PANTRY runs no model.** No API key, no LLM, no hosted inference — it stays a local, zero-dependency
tool. "AI" in BREAD is always **the external agent the developer already has** (their own Claude
Code / Cursor), reading and operating surfaces through one shared vocabulary (`grain = AI`). There is
no privileged AI→DOM backchannel and there is no privileged AI *inside* PANTRY.

So PANTRY's job is to make the project **retrievable and legible to the AI the dev already has** —
never to host one. This is the line every feature is triaged against:

- **Model-free — the real PANTRY (default, ships):**
  - **AI-retrieval endpoints** — `llms.txt` / `knowledge.json` / a data-surface export the agent
    consumes (docs + plans + reference + the codebase map, as one machine-readable brain).
  - **Session context pack** — "what an agent should read first in this repo," pure deterministic
    assembly (no generation).
  - **The whole-codebase mindmap** — see §The mindmap.
  - **Doc-drift lint** — extends `proof check` (are the docs consistent with the code/plans?).
  - **⌘K** over docs + plans + the map.
- **Would need a model → BYO-key, optional, probably NO:** a chat that *answers*, inline "explain
  this doc." Gated behind the dev setting `ANTHROPIC_API_KEY` if ever built — a deliberate,
  opt-in scope expansion, never the default. Not planned.

## The reshape (2026-07-09, approved — front door + demotion)

The v2 home ("The BREAD stack, in one place" + five BATCH/GRAIN/MILL/PROOF member cards) reads as
*selling the stack*. Re-point it:

| Was | Becomes |
|---|---|
| **Home** = the stack pitch + member cards | **Home** = the project's own surface — the **PROOF board** (its plans/state), with **AI-retrieval** and the **mindmap** as co-headline "working with AI" features |
| stack showcase / member cards | **`/about`** — the "here's the BREAD stack" showcase absorbs the pitch + member cards |
| `/docs`, `/reference`, `/catalog` in the front nav | **demoted out of the human front-nav but still MOUNTED + AI-retrievable** — do NOT cut them |

**Why demote-not-cut is non-negotiable:** cutting `/docs`·`/reference`·`/catalog` would undo PANTRY's
founding pivot (below: "the plan board alone didn't justify a standalone server; the dev-docs cockpit
does"). The AI in the host project retrieves framework docs + the project's plans + reference *as it
builds* — that retrieval is the whole reason PANTRY is a server. Demotion is about the **human**
front-nav; the surfaces stay live and stay in the retrieval endpoints.

## The mindmap — a picture of the AI's brain for this project

The mindmap is **a visual representation of the knowledge graph an agent builds when it reads the
repo**, drawn for the human. It is the **same brain** the AI-retrieval endpoints export for the
machine — one graph, two projections (human viz ↔ machine `knowledge.json`). Likely a stronger front
door than the board itself.

**Scope (decided 2026-07-10): the whole-codebase brain** — not docs+plans only. Nodes and edges come
from, deterministically and with **no model**:

- **MILL** — the doc/notes link graph.
- **PROOF** — plan `depends`/`touches` relations.
- **grain** — the vocabulary registries (surfaces, actions, tokens).
- **A code knowledge graph** — files / symbols / cross-file edges, communities, and "god" nodes
  (graphify-style AST). This is the piece the docs+plans-only version lacked; it's what makes the map
  a real *brain* of the project rather than a doc index.

`graphify-out/` already produces exactly this AST graph (god nodes, community structure, cross-file
relationships) at zero API cost, so PANTRY can **consume it** rather than build a code analyzer — the
whole-codebase version is far more feasible than a from-scratch code pass would be. Optional *offline*
AI enrichment only; never a required model.

Rendering: an interactive, clustered node graph with central nodes surfaced (this is a **dataviz**
build — use the dataviz skill when building it). It reads the same source the retrieval endpoints
export, so the human picture and the machine payload can never drift.

> Prerequisite: PANTRY currently only *renders* — it has **no grain AI door wired** (no `/intent`).
> The retrieval endpoints and ⌘K are pure reads and need none; any future inline-AI (BYO-key) would.

## Why PANTRY exists (the pivot, 2026-07-08 — still the foundation)

The plan board alone didn't justify a standalone server. **The dev-docs cockpit does.** When you
import the BREAD stack into a project, the useful thing isn't just "a kanban board" — it's a running
surface where the AI can read the framework docs *and* the project's own plans *and* the component
reference (*and now the whole-codebase map*) as it builds. That surface is a server, and PANTRY is its
home. This is exactly why the reshape **demotes** the docs surfaces rather than cutting them.

This also settles "does PROOF have to be a server?" — **no.** PROOF is a mountable layer; **PANTRY is
the server** that mounts it (alongside MILL, the reference, the catalog, and the map).

## The relationship (two apps, same layers)

```
batch → grain → mill → proof        (the layers — thin, mountable)
                    ↘        ↘
        PANTRY (neutral cockpit)   ·   tjakoen.github.io (personal site)
```

Both PANTRY and the portfolio are **composition roots**: they wire the same layers into an app. The
portfolio is Tjakoen's branded personal site (hero, notes, résumé) that *also* renders the stack.
PANTRY is the **neutral, installable** version — no personal branding, project-agnostic, meant to be
`bunx`'d into someone else's repo. Two consumers on one stack is a *stronger* "reusable" proof than
one. **PANTRY reuses surfaces the portfolio already proved** (`/grain/docs`, `/batch/docs`,
`/reference`, `/catalog`), extracted and de-personalized.

## What PANTRY mounts

```
bunx pantry            (inside ANY project)
  HOME / FRONT NAV (the dev's own project + working-with-AI)
  ├─ /            the project's board + AI-retrieval + the mindmap  ← reshaped home
  ├─ /plans       the PROOF board (this project's ./plans/) — createProofRoutes, mounted
  ├─ /map         the whole-codebase mindmap (dataviz projection of the retrieval brain)
  └─ /about       the BREAD stack showcase + member cards (was the home)

  MOUNTED BUT DEMOTED (out of the human front-nav; still live + AI-retrievable)
  ├─ /docs        MILL renders the BATCH+GRAIN+MILL+PROOF docs (package-resolved via
  │               import.meta.resolve — never a relative path; see MILL's rule)
  ├─ /reference   the generated vocabulary (read from the real registries, never hand-copied)
  ├─ /catalog     the GRAIN component catalog
  └─ /standards   VOICE / NOTE-STANDARD / … rendered through MILL

  FOR THE MACHINE (the AI the dev already has)
  └─ /llms.txt · /knowledge.json · data-surface — docs + plans + reference + the codebase map,
                  as one retrievable brain (the mindmap's machine projection)
```

AI-answerable by construction: MILL's piece-4b outputs (`llms.txt`, `knowledge.json`, per-page meta,
`data-surface`) mean the AI in the host project can *retrieve* the docs + plans + map, not just view
them.

## Host contract — what a project provides (nothing moves)

The rule that makes adoption safe: **PANTRY is a lens, not a destination.** It renders the host's
content *in place* — it never copies, moves, or folds the host's docs into itself (see Non-goals:
"not a fork of the docs"). A copy is a fork; a fork goes stale. The host repo stays the single
source of truth for everything it owns.

What a host **provides** (by convention, overridable in `pantry.config`):

| Host provides | Convention | Required? | Contracted by |
|---|---|---|---|
| Plans (the board) | `./plans/*.md` | yes (it's the cockpit's point) | `proof init` scaffolds · `proof check` lints |
| The project's own docs | `./docs/**/*.md` | optional — mounted as a MILL collection when present | `pantry.config` for non-standard locations |
| Config | `pantry.config.(json\|ts)` | optional — surface toggles, extra doc dirs, project name | `pantry init` scaffolds |

What PANTRY **bundles** (the host provides nothing for these): the framework docs
(BATCH·GRAIN·MILL·PROOF, package-resolved), `/reference`, `/catalog`, `/standards`, `/about`.

Two consumption modes — the differentiator is "do you need your own server?":

- **Run it** (default, zero code): `bunx pantry` — you provide the content above, PANTRY serves it.
- **Compose the layers yourself** (you're building your own app, e.g. the portfolio): import
  `createProofRoutes` + `createMillRoutes` into your own server; PANTRY is then just the reference
  implementation. Importing PANTRY itself is not offered (Non-goals: it's an app, not a layer).

## Install kit — AI-first, with a manual path

The install story assumes the common case: **the adopter tells the AI in their project to
"implement PANTRY here."** So the instructions are written *for an AI agent first*, with a human
checklist as the manual fallback. Deliverable: **`pantry/INSTALL.md`**, shipped in the package
(resolvable offline via `import.meta.resolve`) and linked from the README + `/llms.txt`.

Contents (both paths perform the same steps):

1. **AI path** — a self-contained prompt block the adopter pastes to (or points) their agent at.
   Steps the agent performs: add the dependency → run `bunx pantry init` (scaffolds `plans/` +
   `pantry.config`) → point the config at the *existing* doc dirs → `bunx proof check` (lint the
   plans) → `bunx pantry serve` and verify the board + docs render. Plus the guardrails, stated as
   hard rules: **never copy or move host docs — configure, don't relocate**; never edit the
   bundled framework docs; plans stay the SSOT, the board is a projection the AI must not
   hand-maintain.
2. **Manual path** — the same steps as a numbered human checklist, one command per line, with
   what-you-should-see after each.

`pantry init` = the mechanical half: scaffolds `plans/` (delegating to `proof init`) +
`pantry.config`, then prints the next steps from INSTALL.md — so the manual path is discoverable
from the CLI alone.

## The PROOF split (done — a completed refactor)

Piece-2's server used to live in `proof/serve.ts`. It was split:

- **stays in `proof/`** (the mountable layer): `core/` (parser + index), `loader.ts`,
  `board.ts` (the pure renderer), and **`createProofRoutes(deps)`** — a transport-generic
  pathname handler `(pathname) => Promise<Response|null>`, mirroring MILL's `createMillRoutes`. Plus
  the `init`/`check` CLI (PROOF piece 4). PROOF is not a server.
- **moved to `pantry/`** (the app): the `Bun.serve` boot, the grain-asset routes, the page chrome,
  and the CLI (`bunx pantry`). PANTRY mounts `createProofRoutes` + `createMillRoutes` + the reference
  + the catalog. The standalone `bunx proof serve` retired in favor of `bunx pantry` (the board is one
  route among several).

## Build order (pieces)

1. **PROOF finishes as a layer first** — ✅ `createProofRoutes` settled.
2. **Extract the app.** ✅ (2026-07-08) — `pantry/app.ts` (`createPantryHandler`), `pantry/cli.ts`
   (`bunx pantry serve [plansDir]`), `pantry/pantry.css` (tokens-only).
3. **Mount the docs.** ✅ v2 — MILL collections for `batch/docs` + `grain/docs` (package-resolved),
   the layer PLANs, `/reference`, `/catalog`.
4. **Mount standards** (`/standards`). ✅
5. **Install story.** ✅ (2026-07-08) — verified against a scratch external project. *(Still to prove:
   a true `bunx` from a published package + a non-BATCH host repo.)*
6. **Host contract.** ✅ `pantry/config.ts` (`loadPantryConfig` → `ResolvedPantryConfig`); surfaces
   gate every route + the nav. → §Host contract.
7. **Install kit.** ✅ `pantry init` + `pantry/INSTALL.md`.
8. **The reshape** — ✅ (2026-07-10) `/` is now the project's front door: board-forward (`Plan board`
   card) + a "Working with AI" section (AI-retrieval + mindmap as teasers until pieces 9/10 land); the
   stack showcase + member cards moved to `/about`; `/docs`·`/reference`·`/catalog` demoted out of the
   front nav into a home "Reference surfaces" row — still mounted + retrievable, never cut. `app.ts`
   (`nav`/`homeBody`/`aboutBody` + `/about` route), `pantry.css`, tests, README synced; tsc + 11/11
   green. `/llms.txt` doc-sync deferred to piece 9 (that endpoint doesn't exist yet).
9. **AI-retrieval endpoints** — 🟢 done. **Done (2026-07-10): the machine brain.** `retrieval.ts`
   (`buildKnowledge` + `renderLlmsTxt`) + two routes: **`/knowledge.json`** (the machine payload —
   PROOF's derived plan index + every MILL doc collection's pages, each with its human route *and* its
   raw `.md` source twin, + grain's `RENDER_OP_KINDS`/`ENDPOINTS` vocab; `runsModel: false` states the
   invariant) and **`/llms.txt`** (the session context pack, llmstxt.org shape — "what an agent should
   read first"). Both derive from the *same* sources the human surfaces render → one brain, two
   projections, drift-free by construction. Surfaces gate the payload (board off = no plan index). The
   home AI-retrieval teaser is now a LIVE link to `/llms.txt`. Model-free, pure reads, deterministic
   (`generatedAt` injected; git-age skipped). The raw `.md` twins MILL already serves cover
   "data-surface"; the context pack covers the session-context-pack item. **Also done (2026-07-10):
   ⌘K** — `pantry-cmdk.js` (vanilla, no build) served at `/pantry-cmdk.js`, injected into every page
   shell; opens on ⌘K/Ctrl-K and jumps to any surface / doc page / plan. It reads its index from the
   SAME `/knowledge.json` brain (one source for machine retrieval + the human jump list — can't list a
   route the endpoints don't know). `.pantry-cmdk-*` styles in `pantry.css`, tokens-only.
   **Done (2026-07-10): 9c doc-drift lint** — `drift.ts` (`checkDrift` + `checkPantryDrift` +
   `formatDriftReport`), wired as **`pantry check`** (CI-able, exits nonzero on a break). It reads the
   SAME brain the server serves (`buildDocCollections`, now the single source both use) and flags every
   in-namespace doc link that no longer resolves — a dead route (`/docs/…`, `/plans…`) or a dead raw
   `.md` twin. Reuses PROOF's `CheckProblem`/`CheckReport` contract. **Home decision:** the lint lives
   in PANTRY, *not* in `proof check` as first sketched — proof can't import PANTRY's brain without a
   dependency cycle, so the lint lives where the brain does and borrows proof's report shape.
   **Deliberately narrow** (high-signal over broad): root-relative inline `[..](/..)` links only; out-of-
   namespace / external / anchor links are skipped (can't adjudicate → don't guess); bare render-op-kind
   words in prose are NOT scanned (ordinary English → false positives; that vocab is guarded at its
   source in `grain/ai/vocab-reference.test.ts`). tsc + 31/31 green; smoke: `pantry check` on the real
   docs = `19 pages, 0 problems / OK`, and on a host with a planted dead link = `FAIL`, exit 1.
10. **The whole-codebase mindmap** (§The mindmap) — consume `graphify-out/` + MILL + PROOF + grain
    registries into one graph; render `/map` as an interactive clustered node graph (dataviz skill);
    export the same graph as the machine `knowledge.json`. One brain, two projections.
    **Done (2026-07-11): the mindmap is live.** PANTRY consumes the host's `graphify-out/` (the AST +
    document graph the host generates with `graphify update .`, then `graphify merge-graphs` across
    repos for a whole-stack map) — it runs no analyzer of its own. `map.ts` (`buildMap` +
    `buildMapPayload` + `loadGraphifyGraph`) is the deterministic, model-free model: degree-ranked
    **central nodes** (a vendored/minified `htmx.min.js` is a node but never surfaced as a hub),
    per-repo + per-community counts, drift-free ordering. Two routes: **`/map`** (the human viz) and
    **`/map.json`** (the machine twin — same model, so picture and payload can't drift). The viz is
    `pantry-map.js` (vanilla canvas, no build): a deterministic cluster layout (repos on a ring →
    communities → phyllotaxis-packed nodes), coloured by repo from the dataviz reference palette's
    validated categorical slots (light + dark, both CVD-checked; the repo legend + labels + the
    server-rendered central-nodes list are the relief channel), sized by degree, with pan / zoom /
    hover-highlight. Absent `graphify-out` degrades `/map` to a "run graphify" panel and `/map.json`
    to `available:false` (never a 500); the mindmap is listed in `/knowledge.json` only when a graph
    exists. Home's mindmap teaser flipped to a **live** `/map` link. `graphify-out/` is gitignored
    (regenerable, host-local). tsc + 45/45 green; smoke: `/map`, `/map.json` served over the real
    whole-stack graph (1987 nodes / 2836 links / 6 repos / 206 communities) + a headless render
    reviewed. Deferred to a v2: overlaying PROOF `depends`/`touches` + grain vocab as extra edge kinds
    (graphify already folds in the code + document graph; the code graph alone is the headline brain).

## Non-goals

- **Not a new layer.** PANTRY imports the layers; nothing imports PANTRY. It's an app.
- **Not a stack advertisement.** PANTRY is a dev side-tool; the BREAD pitch is one page (`/about`),
  not the front door. (This is the reshape.)
- **Not AI-powered.** PANTRY runs no model — it is AI-*legible* (retrievable by the dev's own agent),
  never AI-*hosting*. Any answering feature is BYO-key, opt-in, and not planned.
- **Not the portfolio.** No personal branding, notes, or résumé — those stay in `tjakoen.github.io/`.
  Shared surfaces (docs/reference/catalog) are the *neutral* versions; the portfolio keeps its own
  branded trailheads. Docs are the single source; both are projections.
- **Not a fork of the docs.** PANTRY renders the canonical `.md` from each package, never copies.
</content>
</invoke>
