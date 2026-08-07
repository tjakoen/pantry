---
title: S3b — pin the run-ledger schema and check it
date: 2026-08-07
status: complete
branch: main
scope:
  - runs.ts
  - runs.test.ts
  - doctor.ts
  - doctor.test.ts
  - config.ts
  - PLAN.md
  - artifacts/runs
touched:
  - runs.ts
  - runs.test.ts
  - doctor.ts
  - doctor.test.ts
  - config.ts
  - PLAN.md
  - artifacts/runs/README.md
  - app.ts
  - app.test.ts
  - drift.test.ts
  - init.test.ts
  - retrieval.test.ts
  - skills.test.ts
skills:
  - loop-standard
plans:
  - skills-runtime S3b | https://tjakoen.github.io/standards/loop
gates:
  - bun test | 227 pass, 3 fail (the 3 pre-existing, confirmed by stashing)
  - tsc --noEmit | clean
  - bun cli.ts doctor | 12 checks, 0 failing, 2 due
diffstat: 10 files changed, 177 insertions(+), 8 deletions(-), plus runs.ts + runs.test.ts + artifacts/runs/ untracked
dirty:
  - every file above | uncommitted at the time of writing; the commit follows this report
unpushed: 1 | the S2 commit; pushing is owner-gated and blocks the estate-wide skills rollout
verifiedBy: three independent reviewer subagents, none of which wrote the code; six findings, all applied
doctor: 0 failing, 2 carried by name — e2e-presence (no e2e suite in pantry) and deps-drift (batch + grain pins behind)
---
## What this run did

Made LOOP §9 machine-checkable. `runs.ts` parses a run report out of `artifacts/runs/<date>-<slug>.md`
and reports which of the nine §9 items it does not carry; `pantry doctor` surfaces that as a warn. This
file is the first report written under the schema, so the check has something real to read.

## Gate output

```
$ bun test
 227 pass
 3 fail
 597 expect() calls
Ran 230 tests across 12 files. [533.00ms]

$ bun run check
$ tsc --noEmit

$ bun cli.ts doctor
[ok  ] CLAUDE.md present: found
[ok  ] AGENTS.md symlink: symlink to CLAUDE.md
[ok  ] forked standards: none — standards referenced by URL
[ok  ] plans/ present: /Users/tjakoenstolk/Local/Development/bread-repos/pantry/plans
[ok  ] pantry.config present: found
[info] audit freshness: no AUDIT.md runbook in this repo
[ok  ] graphify freshness: graph 27 days old
[warn] e2e suite present: no e2e suite — the mechanical gate can't run end-to-end
[ok  ] doc links resolve: 19 pages, 0 problems
[warn] layer pins current: 2 behind: batch 0.1.0<0.2.0, grain 0.1.12<0.1.13 — run deps:refresh
[info] skills mounted: standards package has no skill-shaped standards (pin predates when: keys)
[info] run ledger: no run reports yet — a run closes with one at .../artifacts/runs (LOOP.md §4a)
12 checks, 0 failing, 2 due
OK
```

The three failing tests are pre-existing. Verified rather than assumed: stashing the whole change and
re-running gave `183 pass, 3 fail` with the same three names (`buildKnowledge` plans index,
`renderLlmsTxt` shape, `/knowledge.json` plans length — all three assert against plan fixtures this
change does not touch).

The `run ledger` line above reads "no run reports yet" because the doctor run predates this file. It
flips to `1 run reports, all carry their evidence` on the next run, which is the point.

## Scope growth, declared rather than absorbed

The check's first real read flagged this report: six files touched outside the declared envelope
(`app.ts`, `app.test.ts`, `drift.test.ts`, `init.test.ts`, `retrieval.test.ts`, `skills.test.ts`). All
six are the same mechanical edit — the new required `runsDir` key added to a `ResolvedPantryConfig`
literal, which `tsc` demanded the moment the field went in. Nothing else in them changed.

The `scope:` line above is left as it was declared. Widening it after the fact would make the warn go
away and make the ledger a worse record, and §4b calls growth an ask-trigger rather than something a
run settles alone. The warn stands until a human either accepts the growth or says the envelope should
have been drawn wider.

## What was not done

- **The two age-based 11c checks** — plan item claimed with no checkpoint in N days, branch with no
  ledger entry. Both need a threshold, and every threshold in this area is one owner call. They move
  to S3a to land with uncommitted-age and unpushed-age rather than each inventing a number.
- **The union of the fired skills' own Verification checkboxes.** The report carries `skills:`, and §9
  is the universal spine, but matching VOICE's or GRAPH's per-skill checkbox prose against a report is
  a fuzzy match on English — the false-positive risk 9c warns about.
- **No `/runs` view.** Whether adherence earns its own surface or a home-strip row is an open owner
  question (S3c). The data layer is surface-ready and the href guard is already in place for it.
- **Nothing pushed.** Both repos remain local.

## What needs human eyes

- **The threshold numbers** for S3a, still the standing block on the mechanical half.
- **Whether `scope:`/`touched:` is worth the writing cost.** It is the one field that asks a run to
  declare something before it starts, and it is the one that makes §4b's scope cap measurable. If it
  turns out to be theatre in practice, `scope-growth` should be dropped rather than tolerated.
- **The push.** It gates the estate-wide skills rollout, not just hygiene.
