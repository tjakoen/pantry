---
title: The loop measures its own pile-up, and the thresholds came from the owner
date: 2026-08-11
status: complete
lane: gated
branch: main
scope:
  - hygiene.ts
  - hygiene.test.ts
  - doctor.ts
  - doctor.test.ts
  - config.ts
  - config.test.ts
  - PLAN.md
  - ../tjakoen.github.io/plans/
touched:
  - hygiene.ts
  - hygiene.test.ts
  - doctor.ts
  - doctor.test.ts
  - config.ts
  - config.test.ts
  - PLAN.md
  - app.ts
  - app.test.ts
  - capture.test.ts
  - crumb-mount.test.ts
  - drift.test.ts
  - init.test.ts
  - preview.test.ts
  - retrieval.test.ts
  - skills.test.ts
  - ../tjakoen.github.io/plans/skills-runtime.md
  - ../tjakoen.github.io/plans/decisions/2026-08-11-loop-hygiene-thresholds.md
  - ../tjakoen.github.io/plans/decisions/answers.jsonl
skills:
plans:
  - skills-runtime S3a | /docs/plans/skills-runtime
gates:
  - bun test (pantry) | 611 pass, 0 fail
  - bunx tsc --noEmit (pantry) | clean
  - bun test (portfolio) | 328 pass, 0 fail
  - bunx proof verify plans (portfolio) | OK, 3 warnings
  - bun cli.ts doctor (pantry) | 0 failing, 4 due
diffstat: 16 files changed, 1021 insertions(+), 3 deletions(-) in pantry; 3 files changed, 134 insertions(+), 14 deletions(-) in the portfolio
dirty:
unpushed: 2 | one commit per repo, this run's; the push is the owner's call and was deliberately not taken
verifiedBy: not yet, and that is the honest state (see What needs human eyes)
doctor: 0 failing, 4 carried: graphify-freshness, e2e-presence, layer-pins, run-ledger (2 older reports plus this one, by choice)
---

Four checks over what LOOP section 8 calls the estate's real failure: work that is finished, green,
and still sitting. `uncommitted-age` takes the oldest dirty path. `unpushed-age` takes commits ahead
of the upstream, by count or by the age of the oldest, either one alone. `run-report-presence` counts
commits landed since the newest dated run report. `no-remote` is info in both directions.

**The part of this run that was not about code.** S3a was blocked on one thing: what the numbers
should be. The estate's real pattern is weeks rather than days, so the obvious defaults were wrong,
and a run that reasons its way to a sensible-looking number ships an opinion wearing a default's
clothes. So the checks and their tests were written against injected thresholds, the question was
raised as a decision request with the measurement attached, and the run stopped there. The owner
answered option B, the answer was recorded on the one channel, and it was acked once the numbers were
in code. The measurement it was decided against, over the thirty days to today:

| Repo | Active days | Commits | Mean per active day | Busiest day |
|---|---|---|---|---|
| tjakoen.github.io | 25 | 247 | 9.9 | 42 |
| pantry | 12 | 81 | 6.8 | 49 |
| grain | 22 | 108 | 4.9 | 10 |

That is what rules out the tight option: a ten-commit unpushed line fires on an ordinary portfolio
day, every day.

**It found something on its first live run.** The portfolio is 42 commits past its newest run report,
against a line of 15. That is real rather than an artifact of the new check: yesterday's reports were
written into pantry's ledger, and the portfolio's own newest is 2026-08-09, whose file is currently
staged for deletion by another session. Nothing before this said so.

**Three things the build settled.** mtime is a floor on a change's age and not the age, so
uncommitted-age under-reports and cannot cry wolf, and what it really measures is written, untouched
since, and still uncommitted. Git status is read in the NUL form, because the newline form quotes any
path with a space in it and a plain split would hand back a path that is not on disk, silently
skipping the file most likely to have been sitting there for weeks. And a threshold nobody can turn
off is a threshold everybody mutes, so any hygiene key set to null mutes its check and says so, while
an absent key takes the default, since a host that never mentioned a check has not opted out of it.

## Gate output

```
$ bun test                                    # pantry
 611 pass
 0 fail
 1596 expect() calls
Ran 611 tests across 22 files. [4.32s]

$ bunx tsc --noEmit                           # pantry
(no output)

$ bun test                                    # portfolio
 328 pass
 0 fail
 1298 expect() calls
Ran 328 tests across 20 files. [2.54s]

$ bunx --bun proof verify plans               # portfolio
[warning] (none) touches: artifacts/runs/2026-08-09-conformance-and-handover.md is outside every plan's touches
[warning] (none) touches: decisions/2026-08-11-loop-hygiene-thresholds.md is outside every plan's touches
[warning] runs-surface-polish touches: every touches entry points outside this repo (../pantry/app.ts, ../pantry/pantry.css, ../pantry/app.test.ts), so nothing about it can be verified here
17 plans, 4 changed file(s) vs HEAD, 3 problems
OK

$ bun cli.ts doctor                           # pantry, the four new lines
[info] remote configured: origin, this branch tracks origin/main
[ok  ] uncommitted work: 15 dirty paths, oldest is config.ts, 0 days old
[ok  ] unpushed work: up to date with origin/main
[ok  ] run reports keeping up: 0 commits since the newest run report (2026-08-10)
19 checks, 0 failing, 4 due
OK

$ bun ../pantry/cli.ts doctor                 # portfolio, where the check found something
[warn] run reports keeping up: 42 commits since the newest run report (2026-08-09) — over 15, close a run with a report
```

The answer channel, read back after the owner answered:

```
$ bun ../pantry/cli.ts answers
UNREAD (1) — act on these, then `pantry answers ack <id>`

a-20260810T164407Z-4d0d8df7  2026-08-10T16:44:07.579Z  [chat] 2026-08-11-loop-hygiene-thresholds  ← unread
  Q: What should the four loop-hygiene thresholds be (uncommitted age, unpushed age, unpushed commits, commits per run report)?
  unblocks: DEFAULT_HYGIENE in pantry/hygiene.ts, the last thing S3a needs before it commits.
  A: B, a working week: uncommittedMaxAgeDays 5, unpushedMaxAgeDays 5, unpushedMaxCommits 25, runReportMaxCommits 15
```

## What was NOT done

- **The scope grew by ten files and the growth is declared rather than hidden.** Making the thresholds
  config-driven added a required field to `ResolvedPantryConfig`, which every construction site of it
  has to fill: ten literals across `app.ts` and nine test files. The declared scope was written before
  that was known and has been left as it was written, so this report carries a `scope-growth` gap on
  purpose. Back-writing the declaration would have produced a clean line and destroyed the only thing
  the measurement is for.
- **`pantry scope` was run after the work rather than before it**, which is the mistake it exists to
  prevent. Its answer: seeds `config.ts` and `doctor.ts` reach 21 files, including six of the ten that
  grew. Three of the ten (`capture.test.ts`, `crumb-mount.test.ts`, `preview.test.ts`) sit outside the
  graph's radius entirely, so even a pre-flight query would have missed them.
- **No push.** Two commits, one per repo. The last push was authorised yesterday and the next one is
  the owner's call again.
- **No skill fired unprompted this session**, and the `skills:` field above is empty because of it.
  The work was DECISIONS-shaped and LOOP-shaped throughout, the standards were read as files, and the
  harness listed both mounts. This is a data point for S7 rather than a defect, and it is the second
  such observation after the S0 control arm.
- **The other deferred 11c check is still unbuilt**: plan item claimed with no checkpoint in N days.
  Not a threshold problem, so it did not belong to this run: a plan item has no timestamp of its own,
  so claimed would have to be derived per item from git history, a git call per plan file at every
  session start.
- **The staged deletion of `artifacts/runs/2026-08-09-conformance-and-handover.md`** in the portfolio
  was left exactly as found, as instructed. Only the owner knows whether that report is meant to go.

## What needs human eyes

- **The second pass is owed and this run cannot give it.** Every one of these checks was written and
  verified by the same session, which LOOP section 2 says is one pass rather than two. The parser
  history here argues for a specific target: every defect ever found in the run-report parser was a
  false POSITIVE, a checker stricter than the markdown a human writes. The equivalent risk in this
  module is the porcelain parser and the rename case, which is the first place a reviewer should look.
- **Whether the thresholds survive contact.** They were chosen against a commit rate, which is the
  best evidence available and is not the same as having watched them for a week. The known cost was
  accepted going in: unpushed-age will sometimes warn about the gap between authorised pushes rather
  than about the work. If that reads as noise a fortnight from now, the fix is a config edit.
- **The portfolio's 42 commits with no run report behind them.** The check is right, and what to do
  about it is a call rather than a chore, since some of those commits are already reported in pantry's
  ledger instead. Whether a run that spans two repos owes a report in both is unsettled and this run
  is itself an instance of it.
