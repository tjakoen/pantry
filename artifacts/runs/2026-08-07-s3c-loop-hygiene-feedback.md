---
title: S3c — feed the adherence record back into orientation
date: 2026-08-07
status: partial
branch: main
scope:
  - retrieval.ts
  - retrieval.test.ts
  - app.ts
  - app.test.ts
  - config.ts
  - PLAN.md
  - artifacts/runs
  - doctor.test.ts
  - drift.test.ts
  - init.test.ts
  - skills.test.ts
touched:
  - retrieval.ts
  - retrieval.test.ts
  - app.ts
  - app.test.ts
  - config.ts
  - PLAN.md
  - artifacts/runs/2026-08-07-s3c-loop-hygiene-feedback.md
  - doctor.test.ts
  - drift.test.ts
  - init.test.ts
  - skills.test.ts
skills:
  - loop-standard
plans:
  - skills-runtime S3c | https://tjakoen.github.io/standards/loop
gates:
  - bun test | 232 pass, 3 fail (the same 3 pre-existing)
  - tsc --noEmit | clean
  - bun cli.ts doctor | 12 checks, 0 failing, 3 due
  - curl localhost:4477/llms.txt | Loop hygiene callout renders first
diffstat: 10 files changed, 132 insertions(+), 11 deletions(-), plus this report
dirty:
  - every file above | uncommitted at the time of writing; the commit follows this report
unpushed: 2 | the S2 and S3b commits; pushing is owner-gated and blocks the estate-wide skills rollout
verifiedBy: an independent reviewer subagent that did not write it; one finding applied, one traced to an existing estate-wide pattern and left alone
doctor: 0 failing, 3 carried by name — e2e-presence, deps-drift (batch + grain pins behind), and run-report-evidence (the S3b report's accepted scope growth)
---
## What this run did

Closed the loop the schema opened. A run report now feeds the NEXT session's orientation: `/llms.txt`
carries a `Loop hygiene` callout beside open decisions, `Knowledge.incompleteRuns` carries the count,
and `/runs.json` is the machine twin. Silent when the ledger is clean.

The scope line above was drawn from what the work needed, including the four test fixtures the new
`runs` surface toggle forces a change in. That is the S3b lesson applied rather than restated.

## Gate output

```
$ bun test
 232 pass
 3 fail
 616 expect() calls
Ran 235 tests across 12 files. [563.00ms]

$ bun run check
$ tsc --noEmit

$ bun cli.ts doctor
[warn] run ledger: 1 of 1 run reports missing evidence: 2026-08-07-s3b-run-ledger (touched outside the declared scope: app.ts, app.test.ts, drift.test.ts, init.test.ts, retrieval.test.ts, skills.test.ts)
12 checks, 0 failing, 3 due
OK

$ curl -s localhost:4477/llms.txt | head -12
# pantry

> The pantry project, served by PANTRY — its plan board, docs, and reference as one retrievable surface. PANTRY runs no model of its own; this file is what an agent should read first here.

## Loop hygiene — the last runs' own record
- [1 run report(s) missing evidence](/runs.json): which LOOP §9 items each one skipped; do not repeat them in this run's report

## Plans
- [Plan board](/plans): the board; machine index at /plans/plans.json

$ curl -s localhost:4477/runs.json
1 1 ['scope-growth']
```

The three failing tests are the same pre-existing three, verified by stash on the S3b run.

## What was not done

- **No human `/runs` page.** Whether adherence earns its own surface or a home-strip row is the owner's
  open question. The data layer is surface-shaped and waiting.
- **The S3a mechanical half.** uncommitted-age, unpushed-age, no-remote, run-report-presence all still
  wait on threshold numbers.
- **Nothing about which SKILLS fired is surfaced yet**, only which evidence is missing. The `skills:`
  field is parsed and carried, but nothing reads it. It earns a surface when there is more than one
  run's worth of data to show.
- **Absolute paths still appear in `/runs.json`** (`dir`, and `file` per report). The reviewer flagged
  it; `/decisions.json` has exposed exactly the same thing since 11d, so this is the cockpit's existing
  localhost posture rather than a new leak. Changing it here alone would make the surfaces inconsistent
  and fix nothing — if it is worth changing it is worth changing estate-wide, as its own pass.
- **Nothing pushed.** Both repos remain local, now 2 commits ahead each.

## What needs human eyes

- **`/loop` surface or home-strip row.** This is the last thing standing between S3 and done.
- **Whether the `Loop hygiene` callout is too loud.** It leads the context pack, before Plans. That is
  deliberate (a session should read what the last one skipped before repeating it), but it means one
  unfinished report changes what every session in this repo reads first until someone finishes it.
- **The push**, still gating the estate-wide skills rollout.
