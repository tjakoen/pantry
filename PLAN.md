# PANTRY — plan

> Status: **v2 built (2026-07-08): home + PROOF board + MILL-rendered framework docs + layer PLANs
> + `/reference` + `/catalog` + `/standards`, the host contract (`./docs` mounting + `pantry.config`),
> and the install kit (`pantry init` + `INSTALL.md`); `bunx pantry`. Surfaces gate on config toggles.
> Verified: all surfaces render, init scaffolds idempotently, a host `./docs` mounts in place.**
> Next: package-resolve the assets + layer PLANs at the split (docs already package-resolved);
> the mindmap + AI-retrieval endpoints (piece 8). PANTRY — where the stack's ingredients and
> docs are kept — is the BREAD stack's **installable developer-docs + AI cockpit**: one app that
> **composes** the layers (BATCH · GRAIN · MILL · PROOF) into a single server you drop into any
> project. It renders the framework docs, the project's PROOF plan board, the generated reference,
> and the component catalog, so the AI (and the human) building in that project have everything
> addressable and AI-answerable in one place. It is an **app**, not a layer — the neutral,
> project-agnostic sibling of the portfolio. Canonical plan: this file. Cross-layer sequencing is
> Track F in [`../ROADMAP.md`](../ROADMAP.md).

## Why PANTRY exists (the pivot, 2026-07-08)

The plan board alone didn't justify a standalone server. **The dev-docs cockpit does.** The insight:
when you import the BREAD stack into a project, the useful thing isn't just "a kanban board" — it's a
running surface where the AI can read the framework docs *and* the project's own plans *and* the
component reference as it builds. That surface is a server, and PANTRY is its home.

This also settles "does PROOF have to be a server?" — **no.** PROOF is a mountable layer;
**PANTRY is the server** that mounts it (alongside MILL, the reference, and the catalog).

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
  ├─ /docs        MILL renders the BATCH+GRAIN+MILL+PROOF docs (bundled from the installed
  │               packages via import.meta.resolve — never a relative path; see MILL's rule)
  ├─ /plans       the PROOF board (this project's ./plans/) — createProofRoutes, mounted
  ├─ /reference   the generated vocabulary (read from the real registries, never hand-copied)
  ├─ /catalog     the GRAIN component catalog
  └─ /standards   VOICE / NOTE-STANDARD / … rendered through MILL (closes the owed
                  standards web-render route from [[standards-ssot-consolidation]])
```

AI-answerable by construction: MILL's piece-4b outputs (`llms.txt`, `knowledge.json`, per-page meta,
`data-surface`) mean the AI in the host project can *retrieve* the docs + plans, not just view them.

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
(BATCH·GRAIN·MILL·PROOF, package-resolved), `/reference`, `/catalog`, `/standards`.

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

## The PROOF split this requires (a planned refactor)

Today piece-2's server lives in `proof/serve.ts`. Split it:

- **stays in `proof/`** (the mountable layer): `core/` (parser + index), `loader.ts`,
  `board.ts` (the pure renderer), and a new **`createProofRoutes(deps)`** — a transport-generic
  pathname handler `(pathname) => Promise<Response|null>`, mirroring MILL's `createMillRoutes`. Plus
  the `init`/`check` CLI (PROOF piece 4). PROOF stops being a server.
- **moves to `pantry/`** (the app): the `Bun.serve` boot, the grain-asset routes
  (`/styles`, `/components.css`), the page chrome, and the CLI (`bunx pantry`). PANTRY mounts
  `createProofRoutes` + `createMillRoutes` + the reference + the catalog.

Net: `proof/serve.ts` + `proof/cli.ts` + the asset wiring become PANTRY; `proof/board.ts` +
`proof/loader.ts` + `proof/core/` stay and gain `createProofRoutes`. The standalone `bunx proof
serve` retires in favor of `bunx pantry` (the board is one route among several).

## Build order (pieces)

1. **PROOF finishes as a layer first** (pieces 3–4 in `../proof/PLAN.md`): the live board (SSE via
   the injected `OpChannel` — mounted, this reuses PANTRY's stream), then `init`/`check`. Do NOT
   extract to PANTRY until PROOF's layer surface (`createProofRoutes`) is settled.
2. **Extract the app.** ✅ (2026-07-08) — `pantry/app.ts` (`createPantryHandler`: home + `/plans*`
   via `createProofRoutes` + `/docs*` via MILL + shared grain assets), `pantry/cli.ts`
   (`bunx pantry serve [plansDir]`, reads the host cwd's `./plans`, assets resolve relative to the
   module), `pantry/pantry.css` (nav + member grid, tokens-only). `createProofRoutes` added in
   `proof/routes.ts`. Screenshots verified (home light/dark, docs, a MILL doc page).
3. **Mount the docs.** ✅ v2 — MILL collections for `batch/docs` + `grain/docs` (package-resolved via
   `packageDocsSource`, body-only layout), the individual layer PLANs at `/docs/plans` (grain·mill·
   proof·pantry, distinct from the `/plans` board), `/reference` (`buildVocabReference`, read from the
   real registries) and `/catalog` (GRAIN's `createCatalog`). *Assets + the layer PLANs stay
   module-relative — not in the packages' `exports` maps yet (proof/pantry aren't linked); they
   package-resolve at the split. The doc dirs the plan named ARE package-resolved.*
4. **Mount standards** (`/standards`) — ✅ closes the owed web-render route
   ([[standards-ssot-consolidation]]): a MILL collection over the standards dir (module-relative until
   they become a neutral package at the split).
5. **Install story.** ✅ (2026-07-08) — verified against a scratch external project: `proof init`
   scaffolds its `plans/`, `proof check` lints them, `bunx pantry serve` renders THAT project's
   plans + PANTRY's own framework docs. Reads host plans, resolves own assets — runs from any cwd.
   *(Still to prove: a true `bunx` from a published package + a non-BATCH host repo.)*
6. **Host contract** — ✅ `pantry/config.ts` (`loadPantryConfig` → `ResolvedPantryConfig`: project
   name, plansDir, docsDirs, surface toggles; reads `pantry.config.(ts|js|json)` from the host cwd,
   `./docs` auto-mounts when present). The host's own docs render in place as a MILL collection
   (`/docs/<name>`), never copied. Surfaces gate every route + the nav. → §Host contract above.
7. **Install kit** — ✅ `pantry init` (`pantry/init.ts`: delegates `plans/` to `proof init`, adds
   `pantry.config.json`, idempotent) + `pantry/INSTALL.md` (AI-path prompt block + manual checklist,
   guardrails as hard rules). `pantry init` prints the next steps. → §Install kit above.
8. **Later:** the mindmap (PROOF phase 2) surfaces here; AI-retrieval endpoints.

## Non-goals

- **Not a new layer.** PANTRY imports the layers; nothing imports PANTRY. It's an app.
- **Not the portfolio.** No personal branding, notes, or résumé — those stay in `tjakoen.github.io/`.
  Shared surfaces (docs/reference/catalog) are the *neutral* versions; the portfolio keeps its own
  branded trailheads. Docs are the single source; both are projections.
- **Not a fork of the docs.** PANTRY renders the canonical `.md` from each package, never copies.

## The tidy-up (files are getting messy — the target structure)

Adding an app is the moment to organize the root. Target:

```
BREAD/  (the umbrella repo)
  batch/ grain/ mill/ proof/     the layers (thin, mountable)
  pantry/                        the neutral cockpit app (composes the layers)   ← NEW
  tjakoen.github.io/             the personal site (separate consumer)
  project/                       the paused product archive
  ROADMAP.md · SPLIT-PLAN.md · AUDIT.md · DOCS.md · CLAUDE.md   the umbrella's maps
```

Cleanup tasks (execute when extracting, step 2 above — not before):
- Move `proof/serve.ts` + `proof/cli.ts` + `proof/tools/shots.ts` → `pantry/`.
- Add `pantry/` to workspaces + tsconfig include + SPLIT-PLAN.
- Re-point `proof/example/` (fixtures) — keep in `proof/` (they test the layer), PANTRY gets its own
  demo pointed at the repo's real `plans/` once the ROADMAP migration (PROOF piece 5) lands.
- Update `DOCS.md` (the doc map) with PANTRY + PROOF as distinct entries.
