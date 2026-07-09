# CLAUDE.md — pantry

Onboarding + operating rules for any AI (or human) working in **`pantry/`**, the BREAD stack's
installable dev-docs + AI cockpit. Read this first, then the docs it points to. Keep it accurate:
if you change how PANTRY works, update this file in the same change.

> Personal standards (voice, badges, AI-use posture) live at the published index
> <https://tjakoen.github.io/standards> (the `@tjakoen/standards` package) — referenced, never
> forked. This file is seeded from its `CLAUDE.starter.md`.

## What this is

PANTRY is an **app** (not a layer): one server that composes BATCH + GRAIN + MILL + PROOF into a
cockpit you `bunx` into any host project — the framework docs, the host's own PROOF plan board,
`/reference`, `/catalog`, and `/standards`, all addressable in one place. Everything it renders is
**package-resolved** (`import.meta.resolve`) from the installed deps; surfaces auto-disable when a
package is absent, they never crash.

## Start here (reading order)

1. [`PLAN.md`](PLAN.md) — the canonical plan (v2 built; the host contract; what's next). Source of truth.
2. [`INSTALL.md`](INSTALL.md) — the install kit (AI path + manual path + the guardrails).
3. [`app.ts`](app.ts) — the composition: how every surface resolves its source.

## Commands

```bash
bun run check      # tsc --noEmit (must stay green)
bun test           # unit + integration
bun cli.ts serve   # run the cockpit locally (what hosts run as `bunx pantry serve`)
bun cli.ts init    # scaffold plans/ + pantry.config.json (host-side)
```

## Non-negotiables (the host contract — INSTALL.md restates these to hosts)

- **PANTRY is a lens, not a destination.** It renders the host's `plans/` and `docs/` where they
  already live. It never copies, moves, or edits anything the host owns.
- **Never edit the bundled framework docs.** They render from the installed packages — the layer
  repos own them.
- **Plans are the source of truth; the board is a read-only projection** (PROOF's rule, inherited).
- **Package-resolved, always.** Assets/docs/PLANs resolve via `import.meta.resolve('@tjakoen/…')`,
  never relative sibling paths. Deps are sha-pinned git deps (`deps:refresh` re-pins).
- **A missing package disables its surface — visibly, never a crash.**
- **Tests are part of the work.** `tsc` + `bun test` green before "done".

## Definition of done

Code + colocated tests + `tsc` and `bun test` green + `PLAN.md`/`INSTALL.md` synced (the host
contract wording especially) + a memory if a decision was made.
