# CLAUDE.md — pantry

Onboarding + operating rules for any AI (or human) working in **`pantry/`**, the BREAD stack's
installable dev-docs + AI cockpit. Read this first, then the docs it points to. Keep it accurate:
if you change how PANTRY works, update this file in the same change.

> Personal standards (voice, badges, AI-use posture) live at the published index
> <https://tjakoen.github.io/standards> (homed in the portfolio at `tjakoen.github.io/standards/`) — referenced, never
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
bun cli.ts check   # lint the docs for dead references (CI-able; exits nonzero on a break)
bun cli.ts init    # scaffold plans/ + pantry.config.json (host-side)
bun cli.ts usage   # token usage by model, claimed plan and area, from the harness transcripts (--json for the payload)
```

## Non-negotiables (the host contract — INSTALL.md restates these to hosts)

- **PANTRY is a lens, not a destination.** It renders the host's `plans/` and `docs/` where they
  already live. It never copies, moves, or edits anything the host owns.
- **Never edit the bundled framework docs.** They render from the installed packages — the layer
  repos own them.
- **No committed `.npmrc`, ever.** The `@tjakoen` scope resolves from the public npm registry by
  default (moved off GitHub Packages 2026-07-30, which demanded a token even for public packages). A
  committed scope mapping would outrank `publishConfig` and `--registry` and drag that back.
- **Plans are the source of truth; the board is a read-only projection** (PROOF's rule, inherited).
- **Package-resolved, always.** Assets/docs/PLANs resolve via `import.meta.resolve('@tjakoen/…')`,
  never relative sibling paths. The four layers (`@tjakoen/batch`, `@tjakoen/grain`, `@tjakoen/mill`,
  `@tjakoen/proof`) are caret-range deps from the public npm registry, installable with no token
  (`bun update` picks up new releases); only `tjakoen.github.io` is a sha-pinned git dep
  (`deps:refresh` re-pins it).
- **A missing package disables its surface — visibly, never a crash.**
- **Tests are part of the work.** `tsc` + `bun test` green before "done".

## Doctor tiers

Every doctor check has a tier in tiers.ts (docs/WORKFLOW.md explains them). Tier 1, the contract,
can fail; tier 2, the loop, only warns for strangers; tier 3, the owner's layer, is silent unless
pantry.config.json sets ownerLayer. A new check goes into the CHECK_TIERS table, or it defaults to
tier 3.

## Definition of done

Code + colocated tests + `tsc` and `bun test` green + `PLAN.md`/`INSTALL.md` synced (the host
contract wording especially) + a memory if a decision was made.

## Running the gates

Run the repository gates from this checkout:

```sh
bun run check
bun test
bun run lint
```

The full test suite includes the package smoke test. To isolate that distribution boundary while
working on the package allowlist, run:

```sh
bun test tools/package-smoke.test.ts
```

The smoke test packs PANTRY and exercises the extracted CLI and control client outside the source
checkout, using the checkout's installed dependencies. It proves the runtime file closure; it does
not prove a fresh network installation.

Record the actual totals and command output for each run rather than comparing against a fixed
historical test count. On Windows, the fixtures require permission to create symlinks: enable
Developer Mode or use an account with the required privilege before running the host suite. A
container gate is an option only when the checkout actually provides a Compose configuration and
the named service. This bread checkout has no Compose file, so the host commands above are the
verified path.
