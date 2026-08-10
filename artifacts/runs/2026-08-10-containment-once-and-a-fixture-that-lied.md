---
title: The containment rule once, and a test fixture that had stopped asking its question
date: 2026-08-10
status: complete
lane: gated
branch: main
scope:
  - pantry
  - tjakoen.github.io/plans
  - tjakoen.github.io/artifacts
touched:
  - pantry/paths.ts
  - pantry/paths.test.ts
  - pantry/fixtures.ts
  - pantry/artifacts.ts
  - pantry/app.ts
  - pantry/runs.ts
  - pantry/capture.ts
  - pantry/capture.test.ts
  - pantry/graph.ts
  - pantry/app.test.ts
  - pantry/drift.test.ts
  - pantry/retrieval.test.ts
  - pantry/package.json
  - pantry/PLAN.md
  - pantry/artifacts/runs/2026-08-10-containment-once-and-a-fixture-that-lied.md
  - tjakoen.github.io/plans/pantry-review-layer.md
  - tjakoen.github.io/artifacts/reviews/2026-08-10-review-tier1-nongrain/
  - tjakoen.github.io/artifacts/reviews/2026-08-10-tmp-capture-failure-proof/
skills:
  - loop-standard
  - session-loop
plans:
  - pantry-review-layer
gates:
  - bun test (pantry, final) | 501 pass, 0 fail, 1302 expect() calls, 501 tests across 19 files
  - bun test (pantry, at session start) | 486 pass, 3 fail — the three this run was asked to fix
  - tsc --noEmit (pantry) | clean, no output
  - oxlint (pantry) | 23 warnings, identical count to the last run's report, none from a file this run added
  - bun cli.ts doctor (pantry) | 15 checks, 0 failing, 4 due, all 4 pre-existing and the same four
  - bun test (portfolio) | 328 pass, 0 fail, 1298 expect() calls, 328 tests across 20 files
  - bun run check (portfolio) | tsc --noEmit, clean
  - bun run lint:voice (portfolio) | 476 flags, identical to the last run's report
  - bunx crumb check content/tours | 10 tours pass
  - bunx proof verify plans (portfolio) | 18 plans, 2 problems, both pre-existing
  - bun run export + verify:export (portfolio) | dead-link walk OK, sitemap OK
  - capture, the Tier 1 fixture, all addresses real | 3 of 3 steps resolved, exit 0
  - capture, the same fixture deliberately broken | 3 of 3 steps failed with three different verdicts, exit 1
  - process check after every capture | no next process left, port 5210 free
diffstat: pantry 11 files changed, 60 insertions, 73 deletions, plus 3 created (paths.ts 95 lines, paths.test.ts 148, fixtures.ts 43); portfolio 1 plan edited, 2 capture dirs regenerated
dirty:
  - artifacts/runs/2026-08-09-conformance-and-handover.md | in the PORTFOLIO, staged as deleted by another session, deliberately left exactly as found
  - artifacts/runs/ | in the PORTFOLIO, untracked, another session's, not touched
unpushed: 4 | pantry 2, portfolio 2 — this run's commit in each repo plus the one already sitting local in each from the run before it; the push is the owner's call and still has not been made
verifiedBy: two independent reviewers that did not write the change, run in parallel with different briefs — one on behavioural equivalence and security, one on false greens and comments that lie. Between them they found eight things worth acting on and the author had found none of them. Both captures were re-run afterwards against the shipped code, and the throwaway tour and the fixture edit that produced the failing one were reverted after the run.
doctor: 15 checks, 0 failing, 4 due; the 4 due are pre-existing and unchanged from the last run
---

## What this run was for

Two items the last run named in its own "What was NOT done" and left for a session that could carry
them with tests. Both were closed. Neither was what it said on the label.

## The containment rule, once

`realTarget === realBase || realTarget.startsWith(realBase + sep)` is the sentence that decides
whether PANTRY serves a file, lists a file, reads a file, writes a file, or walks into a repo it has
promised never to touch. The last report counted four copies of it. There were seven, across five
modules:

1. artifacts.ts, on its walk
2. app.ts, on `/artifacts/raw/`
3. app.ts again, on the font route
4. runs.ts, before it reads a report's body
5. capture.ts, before it writes a screenshot
6. capture.ts again, in the driver guard, spelled with the separator pre-appended
7. graph.ts, on "never touch the edge repo"

The seventh is the one that matters most and the one nobody had connected to the other six, because
it is about a repo rather than a directory. It lives in `paths.ts` now as `isInside`, with a second
function `linkContained` for the lstat-then-realpath pattern that artifacts.ts and runs.ts had each
written out longhand.

**Two of the seven were not equivalent to the rule they were imitating.** graph.ts compared an
unresolved `join(siblingsRoot, name)` against an absolute edge path, so a relative siblings root
produced a relative path that could never string-match and the exclusion quietly did not fire.
capture.ts's driver guard pre-appended the separator, so a specifier resolving to `node_modules`
itself, rather than to something inside it, walked past. Both are stricter now, and neither was
reachable from a current call path in this repo — which is the whole argument. Seven copies of a
check is not seven checks. It is one check with six chances to be amended in only one place, and
this repo has already shipped that failure twice: the proxy's double-slash hole and the write-back's
extension denylist were both a rule right in the prose and wrong in one of its copies.

## The three failing tests were a false green, not a red

They read `../proof/example`, a sibling checkout that stopped existing when proof folded into grain's
packages. The obvious reading is three broken tests. What it actually was:

**A missing plans directory does not fail. It reads as empty.** `loadPlans` returned an empty list,
`buildIndex` built an empty index, and the three assertions that counted plans failed loudly while a
fourth file walked the same empty corpus and passed. `drift.test.ts`'s test named "a live plan route
resolves; a bogus plan id is flagged" was flagging the bogus id and never noticing there was no live
route to resolve, because with zero plans every plan route is dead. It has a link to a plan the
fixture actually contains now, which is what makes the first half of its own name true.

The fixture resolves through package resolution in `fixtures.ts` — the rule app.ts already states for
its own bundled assets, and the rule these tests broke by not following. It is test-only and
deliberately absent from the published `files` list. It throws at import when the corpus is not
there, because a fixture that resolves to nowhere is worse than one that is missing: missing is red,
nowhere is green over nothing.

Two other things fell out of looking at that list. `answers.ts` and `capture.ts` were never in
`package.json`'s `files` at all, so an npm publish would have shipped a `cli.ts` importing two
modules that were not in the tarball. Git-dependency installs ignore `files`, which is why nothing
had noticed. Both are in the list now, with `paths.ts`.

## Gate output

```
bun test (pantry)
 501 pass
 0 fail
 1302 expect() calls
Ran 501 tests across 19 files.

tsc --noEmit (pantry)
(no output)

oxlint (pantry)
Found 23 warnings and 0 errors.

bun cli.ts doctor (pantry)
15 checks, 0 failing, 4 due
OK

bun test (portfolio)
 328 pass
 0 fail
 1298 expect() calls
Ran 328 tests across 20 files.

bun run lint:voice (portfolio)
voice-lint: 476 flag(s) across 30 file(s) (429 tell, 47 warn).

bunx proof verify plans (portfolio)
18 plans, 9 changed file(s) vs HEAD, 2 problems
OK

bun run verify:export (portfolio)
[verify-export] sitemap.xml: every <loc> resolves to a real file, all trailing-slash canonical
[verify-export] dead-link walk: every internal href/src across the exported HTML resolves
[verify-export] OK

bun ../pantry/cli.ts capture review-tier1-nongrain --preview http://localhost:5210 \
  --start "bunx next start -p 5210" --start-cwd /tmp/tier1-proof --force
[capture] http://localhost:5210 is not answering. Starting: bunx next start -p 5210
[capture] target is up.
[capture] PANTRY on http://localhost:58283, proxying http://localhost:5210
[capture] 1/3 page:tickets: ok
[capture] 2/3 ticket:refund-state: ok
[capture] 3/3 ticket:total: ok
Captured 3 steps, all resolved.
exit 0

bun ../pantry/cli.ts capture tmp-capture-failure-proof (the same fixture, deliberately broken)
[capture] 1/3 page:nowhere: missing (0 matches)
[capture] 2/3 note:tier: ambiguous (2 matches)
[capture] 3/3 note:hidden: not-visible (1 match)
Captured 3 steps, 3 FAILED.
exit 1
```

Both capture folders were regenerated after the refactor, because capture.ts is one of the seven
sites and committed screenshots produced by code that has since changed are evidence of nothing. The
failing one had to be rebuilt from scratch: the throwaway tour had been deleted after the last run
and the fixture had been reverted, so both were recreated, captured, and reverted again.

## What the reviewers found that the author did not

Eight worth acting on, from two reviewers with different briefs run in parallel. The split is what
did the work again: the equivalence reviewer found nothing above low severity and proved the
extraction faithful site by site, while the false-greens reviewer found the two highs. One brief
would have produced one of those results.

- **The fixture guard closed half the bug it was written for.** `existsSync` proves a directory is
  present, not that anything is in it. A `proof` release that trimmed `example/` to an empty
  directory would have put the corpus back at zero with the guard satisfied, which is the same
  failure with a different cause, in the file that exists because of that failure. It counts plan
  markdown now, and that was proved against a temp dir in four states rather than argued.
- **The comment about undercounting copies undercounted the copies.** The first draft of `paths.ts`'s
  header said five and named four sites, in the same diff that converted seven. This repo's review
  history already records "an allowlist of three described as two" and "a comment that named the bug
  it did not prevent". It is a numbered list now, because a list can be checked and a number cannot.
- **A test that could pass by asserting nothing, depending on which machine ran it.** The
  `realBase must already be real` case returned early unless the platform's temp dir happened to sit
  behind a symlink. True on macOS, commonly false on Linux, and bun reports a test with zero
  assertions as passing. It builds its own symlink now, so the green is a property of the code rather
  than of the CI image.
- **An empty string is not a path, and `resolve("")` is the working directory.** An unset value
  threaded through as `""` would have asked whether cwd was inside the parent and got a confident
  answer. No caller can reach it today; it fails closed anyway, because the cost of a wrong answer
  here is a file served from outside the directory it was meant to come from.
- **The contract that makes `linkContained` safe belongs to its callers and was not written down.**
  A non-symlink comes back contained without any containment test. That is sound only because both
  callers join a readdir basename onto a directory already known inside; it is unsound for anything
  that came off a URL or out of config. Stated as a hard contract in the docstring, and asserted in a
  test that passes a path plainly outside the base and shows it coming back `true`.
- **No coverage for the relative-path case the graph.ts fix is about.** Every `isInside` assertion
  used absolute strings, so the one property the amended comment claims to have fixed was the one
  property untested. Covered now, including the prefix trick spelled relatively.
- **`drift.test.ts`'s trailing comment claimed credit the file had not earned.** Flagged by the
  reviewer as borrowing the fixture fix's credibility; the fix was to make the test link a real plan
  id, not to soften the comment.
- **The two sites that had drifted**, above. Both found by the equivalence reviewer working site by
  site rather than by reading the diff, and both confirmed as non-regressions before being accepted.

## What was NOT done

- **The two questions still open on the plan.** The theme leak on a GRAIN target and reviewing a
  deployed URL. Neither was forced by this work: nothing here touches the proxy, the injection or
  the review shell.
- **Nothing was written into ph-live.** The ten proposed attributes are still a proposal, per the
  owner's call. Not re-asked this run.
- **Neither repo was pushed.** Two commits each now, all four local.
- **The four doctor items still due in pantry**, all pre-existing and unchanged: graphify freshness,
  no e2e suite, layer pins three behind, and two old run reports missing evidence.
- **`isInside` was not made to reject Windows-style paths**, which the equivalence reviewer noted are
  untested. This codebase is macOS and Linux only and its comments already depend on that, so a
  Windows path is not a case that exists rather than one that is unhandled.

## What needs human eyes

- **Whether to push.** Four commits now, two per repo, all local and all green on every gate above.
  This has been the first item on this list for three runs.
- **Whether the capture evidence belongs in the portfolio.** Unchanged from the last run and now
  slightly larger, since both folders were regenerated. Capture writes to the reviewing repo's
  artifacts dir, which is correct behaviour and puts the PNGs somewhere none of the other review
  evidence lives.
- **The Record button has still never been pressed**, and **nobody has walked the Tier 1 tour by
  hand.** Both confirmed by the owner on the last run and both still true. Two reviewers and two
  captures are not the same as a person looking at the screen, and this plan has now twice been
  corrected by something only visible on a screen.
