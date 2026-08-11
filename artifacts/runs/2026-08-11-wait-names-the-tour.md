---
title: A wait names the tour, and ends when the card is finished
date: 2026-08-11
status: complete
lane: gated
branch: main
scope:
  - answers.ts
  - answers.test.ts
  - cli.ts
  - INSTALL.md
  - ../tjakoen.github.io/plans/pantry-review-layer.md
touched:
  - answers.ts
  - answers.test.ts
  - cli.ts
  - INSTALL.md
  - ../tjakoen.github.io/plans/pantry-review-layer.md
skills:
plans:
  - pantry-review-layer, the wait-grain item | /docs/plans/pantry-review-layer
gates:
  - bun test (pantry) | 623 pass, 0 fail
  - bunx tsc --noEmit (pantry) | clean
  - bun test (portfolio) | 357 pass, 0 fail
  - bunx proof verify plans (portfolio) | OK, 7 warnings, none this run's
  - bun cli.ts doctor (pantry) | 0 failing, 4 due
  - the command itself, walked | tour form, single-ask form, and the original timeout
  - a fresh-context review of the diff | 2 defects found, both fixed, both now tested
  - the three settle tests, mutation-checked | each one red with the code it guards removed
diffstat: 4 files changed, 243 insertions(+), 27 deletions(-) in pantry; 1 file changed, 15 insertions(+), 3 deletions(-) in the portfolio
dirty:
unpushed: 1 | this run's commit in each repo; the push is the owner's call
verifiedBy: the command was walked end to end against a real log; the rule it implements is the
  owner's, made 2026-08-11
doctor: 0 failing, 4 carried: graphify-freshness, e2e-presence, layer-pins, run-ledger
---

`pantry answers wait` took one ref, a ref is `<tour>#<ask>`, and a decision card has several. P5's
rehearsal put a real cost on that: the run waited on `review-answer-channel#reads-right` while the
owner answered `#keep-both`, and sat nine and a half minutes on an answer that was already on disk
two lines above the one it was watching for. The owner settled the rule the next morning. **A wait
names the TOUR and ends when the card is FINISHED, unblocking on whatever asks were actually
answered rather than on every ask the tour declares.** Both alternatives were rejected, for opposite
reasons: "any answer to the tour" moves a run on after half a card answered over two sittings, and
"every declared ask" would still be blocked right now, because `#reads-right` was never filled and a
reviewer who skips a question should not deadlock a run.

**What building it changed about the rule.** Two things, both about the word "batch", and neither
visible before the code was in front of somebody.

The first is that a batch is not atomic on the file. Finishing a card writes every answered ask in
one go from the reviewer's side, but the log's unit is a decision and not a card, so that is one POST
per ask and several appends. A poll landing between two of them reads a finished card as a
half-answered one and hands the run one answer out of two, which is a quieter version of the same
bug. So after the first match the wait re-reads until the count stops growing, and it does that past
the deadline on purpose: abandoning a batch halfway is the exact failure the tour form exists to
remove, and a quarter of a second is not the part of a fifteen-minute wait anyone was economising on.

The second is that a bare target cannot simply mean "prefix". A decision request's ref has no `#`
either, so `pantry answers wait 2026-08-11-loop-hygiene-thresholds` would have started matching by
prefix against any later ref beginning with the same letters. A target with no `#` therefore matches
its own exact ref AND everything under `<target>#`; a target with one is the single-ask form, which
is what callers use today and is untouched.

**What it costs elsewhere: nothing.** `waitForAnswer` survives as `waitForAnswers` with the settle
turned off, returning the first entry for a caller that wants exactly that, so the four existing
tests of it pass unchanged rather than being rewritten to agree with the new behaviour.

## What the second pass found

The diff went to a reviewer with none of this context, and it came back with two defects the author
had none of.

**The settle compared counts, and counts are the wrong thing to compare.** The log only grows, which
is what made a count look safe — but what the wait reads is the log MINUS what has been acked, and
that view can shrink. An ack and a new answer landing in the same window leave the count identical
and the set different, so the wait would have returned the acked entry and dropped the new one. That
is the "acted on half a card" failure again, reached from the other side. It compares ids now.

**The single-ask form was paying for a settle it can never use.** A `<tour>#<ask>` target matches one
ref, one ref is never a batch, and there is nothing to wait for; it sat through the window anyway.
The settle is the tour form's alone now.

Both are tested, and the tests were checked by breaking the code rather than by reading them: with
the identity comparison reverted to a count, with the settle applied to every target, and with the
settle rounds set to zero, the relevant test goes red each time. Nine tests, and the three that
matter are the rejected readings and the two above rather than the happy path: an ask the reviewer
skipped does not hold the run, a batch still landing is waited out, and an ack mid-settle does not
freeze a stale set in place. The regression itself is a test too: naming the ask nobody answered
still times out, which is correct, and is the reason naming the tour is the thing to reach for.

## Gate output

```
$ bun test                                    # pantry
 623 pass
 0 fail
 1622 expect() calls
Ran 623 tests across 22 files. [8.52s]

$ bunx tsc --noEmit                           # pantry
(no output)

$ bun test                                    # portfolio
 357 pass
 0 fail
 1339 expect() calls
Ran 357 tests across 22 files. [2.79s]

$ bunx --bun proof verify plans               # portfolio
[warning] (none) touches: .github/workflows/pages.yml is outside every plan's touches
[warning] (none) touches: artifacts/runs/2026-08-09-conformance-and-handover.md is outside every plan's touches
[warning] repo-structure-reorg touches: docs/HACKING.md belongs to "repo-structure-reorg" (done), which is not claimed as doing
[warning] repo-structure-reorg touches: src/server.ts belongs to "repo-structure-reorg" (done), which is not claimed as doing
[warning] repo-structure-reorg touches: view/components/organisms/portfolio-frame/portfolio-frame.css …
[warning] repo-structure-reorg touches: view/components/organisms/portfolio-frame/portfolio-frame.html …
[warning] runs-surface-polish touches: every touches entry points outside this repo (../pantry/app.ts, ../pantry/pantry.css, ../pantry/app.test.ts), so nothing about it can be verified here
17 plans, 7 changed file(s) vs HEAD, 7 problems
OK

$ bun cli.ts doctor                           # pantry
19 checks, 0 failing, 4 due
OK
```

All seven proof warnings are another session's dirty files under `src/`, `docs/`, `view/` and
`.github/` plus the known cross-repo `touches` case; none of them is this run's. This run's own
plan file is claimed by `pantry-review-layer` and raises nothing.

## The command, walked

Against a temp repo carrying the two refs from the real incident:

```
$ bun cli.ts answers wait review-answer-channel --timeout 5
[pantry] waiting for "review-answer-channel" to be finished (any ask under it) (up to 5s) — …/answers.jsonl
a-1  …  [tour] review-answer-channel#keep-both  ← unread
  Q: Keep both cards?
  unblocks: marking the walk verified
  A: Keep both

a-2  …  [tour] review-answer-channel#reads-right  ← unread
  Q: Does it read right?
  A: Yes, mostly

$ bun cli.ts answers wait review-answer-channel#reads-right --timeout 2   # with only #keep-both on disk
[pantry] no answer to "review-answer-channel#reads-right" within the timeout. …
exit 2

$ bun cli.ts answers wait review-answer-channel --timeout 5               # same log, tour form
a-1  …  [tour] review-answer-channel#keep-both  ← unread
exit 0
```

The last pair is the incident and its fix side by side on one log: the old target still times out,
which is right, and the new one returns what the reviewer actually answered.

Run against the portfolio's REAL log it times out, and that is also correct: both
`review-answer-channel#keep-both` entries there were acked by the session that acted on them, and an
acked answer is a consumed one. Worth saying because a timeout on the real log looks like a failure
of the prefix match and is not.

## What was not done

The review shell was not touched, and deliberately: nothing about the rule needs the reviewer to do
anything differently, and the client already writes the batch the wait now reads. No caller was
migrated either — every place that waits today names a ref and keeps working, so adopting the tour
form is a change to what a session TYPES rather than a change anything here forces. `waitForAnswer`
was left in place for the same reason; deleting it would have meant rewriting four passing tests to
agree with a behaviour nobody had asked for.

The `--after` option is still not reachable from the command line. It was not reachable before this
either, and no run has wanted it; naming it here so the next person does not go looking for a flag
that was never wired.

## What needs human eyes

Nothing in this change. It has no rendered surface — the review shell, the card and the receipt are
untouched — so there is no tour to walk, and the CLI walk above is the evidence LOOP section 4a asks
for in its place.

One thing carries over unchanged and is not a bug: `review-answer-channel#reads-right` has never been
answered. Both walks answered `#keep-both` only, so that tour's steps stay unverified. Whether it
ever gets an answer is the owner's to decide, and the whole point of the rule built here is that a
run no longer waits to find out.
