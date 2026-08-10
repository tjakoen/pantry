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
> Canonical plan: this file. Cross-layer sequencing is Track F in [ROADMAP.md](https://github.com/tjakoen/bread/blob/main/ROADMAP.md).

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

## Piece 11 — the control center (P2 of the cross-repo loop)

> Source of the mandate: the portfolio's `plans/ai-workflow-loop.md` (P2) + `standards/LOOP.md`. The
> loop standard makes PANTRY the per-repo control center of a work-triggered heartbeat: it **shows and
> checks**, the agent **does**, the standard **governs**. This piece is PANTRY's end of that — and it
> holds the load-bearing constraint harder than ever: **doctor runs no model.** Every check is a file
> stat, a symlink read, or an age comparison. LOOP.md §2 forward-references `pantry doctor` by name.

**11a — `pantry doctor` (DONE 2026-07-26, this branch).** One command, CI-able, nonzero exit on a
compliance break. It is the mechanical tier of the heartbeat: it SURFACES what's due, it never fixes.
Borrows PROOF's error/warn split (same move as `pantry check`; doctor keeps its own `DoctorCheck`
shape, and folds the real `CheckReport` in only for the drift check). Two
severities that matter: **error** (kit is broken → fails CI) and **warn** (something's due → surfaced,
still exit 0 — acting on it is the cognitive tier's job, per LOOP.md §2, not a robot's). Checks:
- **Kit compliance (error):** `CLAUDE.md` present; `AGENTS.md` is a symlink to `CLAUDE.md` (not a
  copy — a copy drifts); no forked standards (a real `standards/` dir carrying canon-named files means
  the repo forked what it should reference by URL — LOOP.md §3; opt out with `standardsSource: "canon"`
  in pantry.config for the one repo that IS the home); `plans/` present.
- **Kit compliance (warn):** `pantry.config.(json|ts)` present (a kit repo should carry one).
- **Staleness (warn — the heartbeat's whole point, "what's due"):** newest audit report age (an
  `AUDIT.md` runbook with no recent dated report = overdue); graphify freshness (`graphify-out` present
  and its age); e2e suite presence (`e2e/` or `*.e2e.ts` — a repo with none can't run the mechanical
  tier's full gate). Absent-runbook / absent-graph degrade to **info**, never a false alarm.
- **Drift (error):** folds in the existing `pantry check` (piece 9c) as one check, so `doctor` is the
  single CI entry point.

Deterministic (inject `now` for the age math, same discipline as the brain's `generatedAt`). Absent
optional pieces degrade to info, never a crash — the same "a surface never 500s" posture as `/map`.

**11b — `pantry init --kit` (DONE 2026-07-26, this branch).** Extends `pantry init` with the
thin-`CLAUDE.md` kit (LOOP.md §3): write-if-absent `CLAUDE.md` from `CLAUDE.starter.md` (resolved from
the portfolio package via `import.meta.resolve`, same trick as app.ts's framework docs; degrades to a
skip if the package isn't installed), the `AGENTS.md → CLAUDE.md` symlink (relative target, what
doctor's check resolves against), `plans/`, `pantry.config.json`. Explicit `--kit` flag; the
non-invasive rule holds — `CLAUDE.md` + `AGENTS.md` are write-if-absent and NEVER overwritten, not even
with `--force` (checked with `lstat`, so a host's dangling `CLAUDE.md` symlink is preserved too, not
written through). Acceptance test MET: `pantry doctor` green right after (live smoke: exit 0, only the
expected e2e warn). 74/74 suite green, tsc clean, init.test.ts added (6 cases). Independent reviewer
(didn't write it) → one must-fix (the `exists`→`lstat` write-through gap), FIXED + re-verified with a
new dangling-symlink test.

**11c — the run ledger + its evidence check (schema DONE 2026-08-07, this branch).** The blocker was
never the code, it was the missing schema: a ledger entry isn't a doc-link or a file stat. **LOOP.md §9
is the schema** — nine items, each one absent-or-present, written as a checklist precisely so a machine
can read it. `runs.ts` is that checklist made parseable.

A run closes with one markdown file at `artifacts/runs/<date>-<slug>.md` (config key `runsDir`, default
`<artifactsDir>/runs` — kept UNDER artifacts/ so a report sits with the screenshots and diffs it cites
and no new tracked dir appears, the same move decisions made under `plans/`). Frontmatter is the
MILL-parseable subset (scalars + dash-lists), so a two-field entry uses the `label | detail` pipe
convention 11d established for evidence: `gates: - bun test | 212 pass`. Three body headings are
required — `Gate output`, `What was not done`, `What needs human eyes` — matched loosely on case,
punctuation and heading level, because a report is hand-written prose and a check that fails on a
trailing colon teaches nobody anything. The format doc is `artifacts/runs/README.md`, which dogfoods
the inbox's own README-is-not-an-entry rule.

Doctor gains **run-report-evidence** (warn): reports that are missing §9 items, the two most recent
named in full with their gaps and the rest counted. Warn, never error — a report missing its diffstat
is a report to finish, not a broken kit, and a repo with no runs dir at all gets an info naming where a
report goes, so a host that never opted in cannot be nagged. This check reads only the host's own files,
so it needs no package to resolve.

**One check computes rather than looks up.** `scope:` (the envelope declared before the run) versus
`touched:` (what it actually hit) yields `scope-growth` — a touched path outside every declared scope
entry. LOOP.md §4b calls scope growth an ask-trigger and until now nothing measured it; this does, by
prefix compare, with no model and no graph. Two rules ride in the schema: gate output is **verbatim**
(the check rejects prose where a fenced block belongs), and it is **never compressed** — a lossy pass
mangled `2026-07-30` into `2026:7:30` in testing, which is why that is a rule and not a preference.

**Every defect in this piece was a false POSITIVE**, which is the failure mode that matters here: a
check that flags a correct report teaches the next run to ignore the check. Three independent reviewers
(none of which wrote it) found six, and each one had the same shape — the parser was stricter than the
markdown a human actually writes. A `#`-prefixed line inside the gate fence (a shell comment, in almost
every real paste) read as a heading and truncated the section; a ` ``` ` inside a longer ` ```` ` fence
closed it early; a heading indented one space vanished; `## Gates run` did not match the alias `gates`;
`scope: .` (the whole repo) matched nothing instead of everything; `/Src/` and `src/a.ts` read as scope
growth. Heading and fence scanning are now CommonMark-shaped (fence-aware, 0-3 space indents, prefix
alias matching) and paths normalise case, leading `/` and `./`, and trailing `/`. Two hardening
findings landed with them: `plans:` hrefs get decisions.ts's `safeHref` treatment (same committed-file
threat, and the guard sits in the data layer so a future view cannot forget it), and the reader gets
artifacts.ts's `lstat`+`realpath` containment — this module reads file CONTENTS, so an escaping symlink
would be an exfiltration path through the cockpit rather than a metadata leak. (That containment moved
to `paths.ts` on 2026-08-10, where it is one `linkContained` shared with artifacts.ts rather than a
second hand-written copy of it; seven such sites existed by then and two of them had drifted.)

Files: `runs.ts` (pure data, like decisions.ts) + `runs.test.ts` (40) + the doctor check (4) + the
`runsDir` config key + `artifacts/runs/README.md`. 227/230 suite green (the same 3 retrieval/app plan
fixtures were red before this branch, confirmed by stashing and re-running), tsc clean, live
`pantry doctor` 0 failing.

**The loop actually closes (S3c's unblocked half, same branch).** `Knowledge.incompleteRuns` counts
reports missing evidence, `/llms.txt` grows a `## Loop hygiene` callout carrying it, and `/runs.json`
is the machine twin. The callout sits with open decisions at the top of the pack and follows the same
rule the inbox does: **silent when there is nothing to inherit**. A clean ledger contributes nothing.
So a session reads the previous runs' adherence record at orientation, before it writes its own report
rather than after — which is the whole point of feeding it back. Proven live rather than asserted: the
first report written under the schema flagged its own author's scope growth, and that warn is now the
first thing `/llms.txt` says.

**The human surface (DONE 2026-08-09).** The open owner question this piece left — whether adherence
earns its own surface or a row on the home freshness strip — was answered in favour of a dedicated
one, because the ask it serves is that a session hands the owner a LINK instead of a chat summary and
a link needs somewhere to point that cannot flatter the run. `/runs` is the index (newest first, a
badge, the date and diffstat, the gap COUNT and a scope-growth line) and `/runs/<id>` is the report:
what is MISSING first, then the growth with its paths, then the meta, then the report's own prose
last, because the body is where a run is most able to sound finished. Static server-rendered like
`/artifacts`, no client script; `buildRunsPayload` backs all three routes so the views and the twin
cannot drift. `renderDecisionBody` became `renderAgentBody`, shared by both surfaces that render prose
an agent wrote.

Two duplications were designed out after seeing it live rather than in review: the index card carried
every gap label, which made the scope-growth gap say the same thing twice, so the card carries the
count and the detail carries the labels; and the detail's checklist repeated all six grown paths that
its own growth section lists, so that one line shortens to "listed below" while still being counted.

On the default layout the report source stays fetchable through the existing `/artifacts/raw/` route;
point `runsDir` outside `artifactsDir` and you get the parsed views and no raw route, which is a limit
worth stating rather than a promise to keep. The `runs` surface toggle disables all of it — both
routes, the twin, the count, the callout, the nav link and the home teaser.

Files: `app.ts` (the two views + routes + nav + teaser) + `pantry.css` + `app.test.ts` (2) +
the `config.ts` comment. 293/296 green (the same 3 pre-existing fixtures), tsc clean, verified live
against this repo's own four reports at `/runs`.

**Still open from 11c's original list, and deliberately:** stale claims (plan item claimed, no
checkpoint in N days) and branches with no ledger entry both need an age threshold, and every threshold
in this area is one owner call with 11a's — they land together in the portfolio plan's S3a alongside
uncommitted-age and unpushed-age rather than each inventing its own number.

**11d — the decision inbox (DONE 2026-07-26, this branch).** Agents write decision-requests as markdown
(status open/resolved, options, a recommendation, evidence links); PANTRY renders `/decisions` (question
+ options + evidence side by side); the agent shares the localhost link. Resolution = the generate-prompt
pattern (click options + an always-present notes box → "generate prompt" assembles resolution + notes +
the instruction to mark the file resolved → human pastes it → the AGENT records). PANTRY stays 100%
read-only — the prompt is the only write path (a client-side assembler, no POST). The decision file
doubles as a ledger entry.

Decision files live UNDER `plans/` (owner call 2026-07-26: `plans/decisions/`, so the existing PROOF
tooling + `pantry doctor`'s plans-present check already cover them — no new tracked dir; config key
`decisionsDir` defaults to `<plansDir>/decisions`). Frontmatter is the MILL-parseable subset (scalars +
dash-lists — options are plain strings, evidence is `label | href`); the body renders through the same
GRAIN adapter every doc uses. Surface: `decisions` (default on) gates `/decisions`, `/decisions/<id>`,
`/decisions.json` + the nav link; an absent dir degrades to empty-state guidance, never a crash (same
posture as `/map`). Open decisions LEAD the AI-retrieval context pack (`/llms.txt` + `/knowledge.json`
`openDecisions`), so an autonomous run resolves them before proceeding (LOOP.md §4). Files:
`decisions.ts` (pure data, like map.ts) + `pantry-decisions.js` (the client generate-prompt flow) +
`decisions.test.ts` (8) + app.ts view/routes/asset + retrieval.ts brain wiring + config.ts
(`decisionsDir` + `decisions` surface) + pantry.css + `plans/decisions/README.md` (the format doc,
skipped by the parser; dogfoods the inbox). 86/86 suite green, tsc clean, live HTTP smoke passed
(index/detail/asset/json/llms callout-first). Independent verify PENDING at commit time (verify rule).

**11e — artifacts + home surface + `/timeline` (TODO).** An `artifacts/` dir per run (screenshots, audit
reports, diffs) that PANTRY serves and decision files / run reports link into; the home surface grows a
latest-audit + drift-freshness row next to the board; `/timeline` is the retrospective project timeline
(plan bars from git-derived status-transition dates, `depends` arrows, commit-density, audit markers —
all derived from git + plans + dated reports, no new tracking, no model; a **dataviz** build). Detail
stays here as these are built. **Built:** `artifacts/` + `/timeline`; the home freshness strip (sub-unit
2) now carries the `deps-drift` pill too, so the control-plane layer-pin drift surfaces on the front door
next to audit / doc / graph freshness.

**11f — `pantry skills` (DONE 2026-08-07, this branch).** The estate-wide half of the portfolio's
skills-runtime plan (S2). A standard only fires if the agent's harness lists it, so
`pantry skills sync [dir]` materializes each standard carrying a `when:` key as
`.claude/skills/<slug>/SKILL.md`: the `when:` becomes the skill `description` (the only text read at
rest), the body is carried verbatim. `pantry skills list` reports fresh / stale / unmounted, doctor
gained a `skills-freshness` warn, and `pantry init --kit` mounts them on day one. Canon resolves out
of the portfolio package via `import.meta.resolve` (11b's trick), except in the canon home itself
(`standardsSource: "canon"`), which reads its own `standards/` — syncing the home from its own
pinned copy would mount yesterday's canon over today's. Mounts are generated, self-gitignoring
(`.claude/skills/.gitignore` holds `*`, so no host file is edited) and never committed, the
graphify-out posture. Every write is sentinel-guarded: a hand-authored or symlinked skill at the same
slug is reported and left alone, and pruning only ever removes what this command generated.
Freshness is a content diff, not an mtime compare, because an install rewrites mtimes for reasons
that have nothing to do with canon moving.

Two findings worth keeping. **Name collisions are silent**: the harness ships its own `loop` skill,
and our LOOP.md mount landed on disk, never appeared in the listing, and so could never fire. Canon
now carries an optional `skill:` key that overrides the slug (`skill: loop-standard`), and the rule
is to check the listing after mounting, not to assume a written file is a live skill. **A stale pin
and a missing package read identically** from the outside and have different fixes, so they are now
separate messages; pantry's own pin currently predates the `when:` keys, which is why syncing here
mounts nothing until the portfolio is pushed and `deps:refresh` runs.

An independent second pass (LOOP.md §2, a reviewer that did not write the code) found three real
defects, all fixed before commit and all now covered by tests. Worth recording because two of them
are the same class, a guard that existed on one path and not its twin: `pruneStale` refused to delete
through a symlinked slot while `syncSkills` would happily *write* through one, landing a file outside
the repo entirely. A `skill:` override that normalized to an empty string collapsed
`join(skillsDir, slug)` back to the mount root, and two standards claiming one slug last-writer-won in
silence while both reported as mounted. The third was an honesty bug rather than a safety one:
`list` labelled a hand-authored file at a live slug "stale" and told the reader to run sync, which
refuses to touch it. That state is now `shadowed`, with the remedy that actually works.

Open, deferred out of S2 on purpose: whether third-party skills are mounted by the same command from
a config allowlist. The allowlist is the estate-consistent answer, but nothing third-party is adopted
yet, and a config key with no consumer is speculative surface. Revisit when the first one lands.

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
