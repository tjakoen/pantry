# 🧺 PANTRY: the dev-docs cockpit

[![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97757?logo=anthropic&logoColor=white)](https://tjakoen.github.io/notes/ten-times-zero)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue)](LICENSE)
[![Status](https://img.shields.io/badge/status-in_progress-blue)](PLAN.md)

**PANTRY is the BREAD stack's installable developer-docs and AI cockpit.** You install it into your
own project (we call that project the "host" below, meaning whatever app you dropped PANTRY into),
run one command, and it serves your project's plan board, its docs, a whole-codebase map, and a set
of machine-readable endpoints an AI agent can read to get oriented fast, all in one small server.

It's an **app, not a layer**: nothing imports PANTRY, it imports BATCH, GRAIN, MILL, and PROOF and
composes them for you. Think of it as the neutral, project-agnostic sibling of
[the personal site](https://github.com/tjakoen/tjakoen.github.io): the same layers, wired into a second, unbranded app.

For the plain-language walkthrough (what each surface is for, why it exists), see the docs:
**[Getting started](https://tjakoen.github.io/pantry/docs/getting-started)** ·
**[What it composes](https://tjakoen.github.io/pantry/docs/what-it-composes)** · or the landing page
at **[tjakoen.github.io/pantry](https://tjakoen.github.io/pantry/)**.

## Quickstart

```sh
bun add -d @tjakoen/pantry@github:tjakoen/pantry#main   # install as a dev dependency, pinned to a commit
bunx pantry init --kit       # scaffolds plans/ + pantry.config.json + CLAUDE.md + AGENTS.md symlink
bunx proof check             # lints the scaffolded plans
bunx pantry skills sync      # mounts the standards as agent skills (generated, gitignored)
bunx pantry doctor           # kit compliance + staleness, the loop's mechanical tier (CI-able)
bunx pantry serve            # renders your plans + docs + reference + catalog
```

That's the whole install. The full story, written for an AI agent to follow step by step (with a
manual checklist as the fallback), is in [INSTALL.md](INSTALL.md).

## What it mounts

```
bunx pantry            (inside any project)
  ├─ /            your project's front door: the plan board + the "working with AI" surfaces
  ├─ /plans       your project's own PROOF board (./plans/*.md)
  ├─ /standards   the writing / README standards, rendered through MILL
  ├─ /about       the BREAD stack showcase (what the layers are)
  ├─ /llms.txt    the session context pack: what an agent should read first
  ├─ /knowledge.json  the machine brain: plans + docs + the AI vocabulary, one payload
  ├─ /map         the mindmap: the whole-codebase knowledge graph, drawn for the human
  ├─ /map.json    the mindmap's machine twin (same model, one brain two projections)
  └─ demoted, still mounted + AI-retrievable (one click from home):
       /docs      the BATCH + GRAIN + MILL + PROOF framework docs, rendered through MILL
       /reference the generated vocabulary, read straight from the real registries
       /catalog   the GRAIN component catalog
```

Press **⌘K** (Ctrl-K) anywhere to jump to any surface, doc page, or plan.

**PANTRY is a lens, never a destination.** It renders your project's own docs and plans in place; it
never copies them in. Your repo stays the source of truth for everything it owns, PANTRY just makes
it addressable, to you and to the AI working in it.

## Two ways to use it

- **Add it, then run it, no code.** `bun add -d @tjakoen/pantry@github:tjakoen/pantry#main`, then
  `bunx pantry` reads your `./plans/` (and your `./docs/`, if you have one) and serves the whole
  cockpit.
- **Compose the layers yourself.** Building your own app instead? Import `createProofRoutes` and
  `createMillRoutes` straight into your own server. PANTRY is the reference implementation of doing
  exactly that; importing PANTRY itself isn't offered, it's an app, not a layer.

## What's built

**v2, shipped**: home, the live PROOF board, the framework docs (resolved through MILL), the
individual layer plans, `/reference`, `/catalog`, `/standards`, the host contract (`pantry.config`,
`./docs` auto-mounting, per-surface toggles), and the install kit (`pantry init` + INSTALL.md). Also
live: the AI-retrieval endpoints (`/llms.txt`, `/knowledge.json`) and the whole-codebase mindmap
(`/map`, `/map.json`). The full build order and current status live in [PLAN.md](PLAN.md).

## Non-goals

Not a new layer, nothing imports PANTRY, it imports the layers. Not the personal site, no branding,
no notes, no résumé, those stay in [tjakoen.github.io](https://github.com/tjakoen/tjakoen.github.io). Not a fork of anyone's
docs, it renders the canonical markdown, never a copy.

---

🤖 **Built with Claude, and it still won't touch your docs.** I decided what a host project should
never have to hand over, Claude typed the config loader that enforces it. **I don't prompt and
pray, I prompt and prove.**
[How I actually work with AI, receipts and all →](https://tjakoen.github.io/notes/ten-times-zero)
