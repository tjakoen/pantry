# PANTRY — plan

> Status: **approved 2026-07-08, unbuilt (docs-only).** PANTRY — where the stack's ingredients and
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
2. **Extract the app.** Create `pantry/`; move the server/asset/CLI wiring out of `proof/`; add
   `createProofRoutes`. `bunx pantry` boots the board pointed at `./plans`.
3. **Mount the docs.** MILL collections for the stack docs (package-resolved) + `/reference` +
   `/catalog`, de-personalized from the portfolio's versions.
4. **Mount standards** (`/standards`) — closes the owed web-render route.
5. **Install story.** `bunx pantry` in a foreign repo: bundles the stack docs from the installed
   packages, reads the host's `./plans`, serves the cockpit. Verify against a scratch non-BATCH repo.
6. **Later:** the mindmap (PROOF phase 2) surfaces here; AI-retrieval endpoints; a `pantry.config`
   for which surfaces a project turns on.

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
