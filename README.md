# 🧺 PANTRY — the dev-docs cockpit

[![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97757?logo=anthropic&logoColor=white)](https://tjakoen.github.io/notes/ten-times-zero)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue)](LICENSE)
[![Status](https://img.shields.io/badge/status-in_progress-blue)](PLAN.md)

**Where the stack's ingredients, and its docs, are kept.** PANTRY is the BREAD stack's installable
developer-docs and AI cockpit: one small server that composes BATCH, GRAIN, MILL, and PROOF into a
single app you drop into any project. Run it, and the AI (and you) building in that project gets
the framework docs, that project's own PROOF plan board, the generated component reference, and
the live catalog, all addressable in one place.

It's an **app, not a layer**. Nothing imports PANTRY, it imports everything below it. Think of it
as the neutral, project-agnostic sibling of [the personal site](../tjakoen.github.io/), the same
layers composing into a second, unbranded app.

## What it mounts

```
bunx pantry            (inside any project)
  ├─ /            your project's front door — the plan board + the "working with AI" surfaces
  ├─ /plans       your project's own PROOF board (./plans/*.md), via createProofRoutes
  ├─ /standards   the writing / README standards, rendered through MILL
  ├─ /about       the BREAD stack showcase (what the layers are) — moved off the front door
  ├─ /llms.txt    the session context pack — what an agent should read first (llmstxt.org shape)
  ├─ /knowledge.json  the machine brain — plans + docs + grain's AI vocabulary, one payload
  ├─ /map         the mindmap — the whole-codebase knowledge graph drawn for the human
  ├─ /map.json    the mindmap's machine twin (same model, one brain two projections)
  └─ demoted, still mounted + AI-retrievable (out of the human front nav, one click from home):
       /docs      the BATCH + GRAIN + MILL + PROOF framework docs, rendered through MILL
       /reference the generated vocabulary, read straight from the real registries
       /catalog   the GRAIN component catalog
```

Press **⌘K** (Ctrl-K) anywhere to jump to any surface, doc page, or plan — the palette reads its
index from the same `/knowledge.json` brain the AI does.

The home page is the **project's** front door, not a pitch for the stack: the plan board leads, with
AI-retrieval (live — `/llms.txt` + `/knowledge.json`, model-free pure reads) and the mindmap (live —
`/map`, the whole-codebase graph your own `graphify` pass produces, drawn for the human and exported
at `/map.json`) as the "working with AI" headline. The "here's the
BREAD stack" showcase moved to `/about`; `/docs`·`/reference`·`/catalog` are demoted out of the front
nav but stay mounted and retrievable — cutting them would undo the reason PANTRY is a server at all.

**PANTRY is a lens, never a destination.** It renders your project's own docs and plans in place;
it never copies them in. A copy is a fork, and a fork goes stale. Your repo stays the one source of
truth for everything it owns, PANTRY just makes it addressable, to you and to the AI working in it.

## Two ways to use it

- **Add it, then run it — no code.** `bun add -d @tjakoen/pantry`, then `bunx pantry` reads your
  `./plans/` (and your `./docs/`, if you have one) and serves the whole cockpit. PANTRY installs as
  a dev dependency (so the version is pinned with your project); it still renders your files in
  place and never copies them.
- **Compose the layers yourself.** Building your own app instead? Import `createProofRoutes` and
  `createMillRoutes` straight into your own server. PANTRY is the reference implementation of doing
  exactly that; importing PANTRY itself isn't offered, it's an app, not a layer.

## Getting it running

The install story is written for an AI agent first, with a human checklist as the fallback. See
`INSTALL.md`. The short version:

```sh
bun add -d @tjakoen/pantry   # install the cockpit as a dev dependency (pins the version)
bunx pantry init             # scaffolds plans/ + pantry.config, delegates to proof init
bunx proof check             # lints the scaffolded plans
bunx pantry serve            # renders your plans + docs + reference + catalog
```

Guardrails that hold regardless of path: never copy or move a host's docs, only configure where
PANTRY should look. Never edit the bundled framework docs. Plans stay the source of truth, the
board stays a projection PANTRY must never hand-maintain.

## What's built

**v2**: home, the live PROOF board, the framework docs (package-resolved through MILL), the
individual layer plans, `/reference`, `/catalog`, and `/standards`. A host contract
(`pantry.config`, `./docs` auto-mounts when present, per-surface toggles) and the install kit
(`pantry init` + `INSTALL.md`). Verified against a scratch external project: init scaffolds, check
lints, serve renders that project's own plans alongside PANTRY's bundled docs.

Not yet built: package-resolving the bundled assets and the layer plans at the eventual repo split
(the doc collections themselves already are), the mindmap view, and the AI-retrieval endpoints. The
full build order and honest status live in `PLAN.md`.

## Non-goals

Not a new layer, nothing imports PANTRY, it imports the layers. Not the personal site, no
branding, no notes, no résumé, those stay in [tjakoen.github.io](../tjakoen.github.io/). Not a
fork of anyone's docs, it renders the canonical markdown, never a copy.

---

🤖 **Built with Claude, and it still won't touch your docs.** I decided what a host project should
never have to hand over, Claude typed the config loader that enforces it. **I don't prompt and
pray, I prompt and prove.**
[How I actually work with AI, receipts and all →](https://tjakoen.github.io/notes/ten-times-zero)
