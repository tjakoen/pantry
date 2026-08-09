---
title: Give the run ledger a human surface
date: 2026-08-09
status: complete
branch: main
scope:
  - app.ts
  - app.test.ts
  - pantry.css
  - config.ts
  - PLAN.md
touched:
  - app.ts
  - app.test.ts
  - pantry.css
  - config.ts
  - PLAN.md
skills:
  - loop-standard
  - session-loop
plans:
  - piece 11c, the human half | /plans
gates:
  - bun test | 293 pass, 3 fail (the same 3 pre-existing fixtures)
  - tsc --noEmit | clean
  - bunx oxlint | warnings only, all pre-existing
diffstat: 5 files changed, 337 insertions(+), 22 deletions(-)
unpushed: 1 | push is owner-gated
verifiedBy: nobody yet — the change and its tests were written by the same run
doctor: not re-run after the change; last run 0 failing, 2 due (e2e-presence, deps-drift)
---

## Gate output

```
$ bunx tsc --noEmit

$ bun test
 293 pass
 3 fail
 768 expect() calls
Ran 296 tests across 13 files. [891.00ms]
```

The three failures are the pre-existing fixtures the audit already recorded: they resolve
`../proof/example`, which stopped existing when PROOF folded into grain's packages. Confirmed
pre-existing by running the suite before this change (293 pass, 3 fail, 767 expects).

Live check against this repo's own four reports, which is the only evidence that matters here:

```
$ bun cli.ts serve --port 4411
$ curl -s http://localhost:4411/runs | grep -oE "[0-9]+ runs?, [^<]*|Scope grew: [^<]*"
4 runs, 2 missing evidence.
Scope grew: 6 paths outside the declared envelope
Scope grew: 5 paths outside the declared envelope

$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4411/runs/nope
404
```

## What was not done

- **No dev tour.** This repo does not mount CRUMB, so a rendered change here has no tour mechanism.
  Two screenshots of the index and the detail were captured in-session instead, which is weaker
  evidence and is named as such rather than passed off as a tour.
- **The three red fixtures were left red.** They are owner-gated: the fix implies a decision about
  whether tests may read the repo's own mutable content at all.
- **The doctor was not re-run after the change.** Nothing in it reads the new routes, but the report
  should not claim a check it did not run.
- **The home freshness strip was left alone.** The ledger got a surface, not a pill, and whether an
  adherence pill also belongs on home was not revisited.

## What needs human eyes

- **The card is deliberately unflattering** and the index is where that will be felt: two of this
  repo's own four reports say "missing evidence" and name scope growth. That is the point of the
  surface, and it is also the thing most likely to feel wrong in daily use.
- **Long diffstats dominate a card.** One real report's diffstat runs three lines and squashes the
  card next to it. Truncating it was rejected on the grounds that this page must not shorten
  evidence, but a better layout probably exists.
- **Localhost is the whole delivery mechanism.** It works while you are at the machine the work
  happened on and not otherwise, which was the accepted call this session rather than a limit that
  was solved.
