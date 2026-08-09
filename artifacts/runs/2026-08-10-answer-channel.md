---
title: The answer gets back — one append-only channel, and the session side that reads it
date: 2026-08-10
status: complete
lane: gated
branch: main
scope:
  - pantry
  - tjakoen.github.io/plans
  - tjakoen.github.io/standards
  - tjakoen.github.io/content/tours
touched:
  - pantry/answers.ts
  - pantry/answers.test.ts
  - pantry/cli.test.ts
  - pantry/app.ts
  - pantry/app.test.ts
  - pantry/cli.ts
  - pantry/config.ts
  - pantry/decisions.ts
  - pantry/pantry-decisions.js
  - pantry/pantry-review-client.js
  - pantry/pantry-review.js
  - pantry/pantry.css
  - pantry/INSTALL.md
  - pantry/doctor.test.ts
  - pantry/drift.test.ts
  - pantry/init.test.ts
  - pantry/preview.test.ts
  - pantry/retrieval.test.ts
  - pantry/skills.test.ts
  - pantry/artifacts/runs/2026-08-10-answer-channel.md
  - tjakoen.github.io/plans/pantry-review-layer.md
  - tjakoen.github.io/plans/decisions/answers.jsonl
  - tjakoen.github.io/standards/DECISIONS.md
  - tjakoen.github.io/content/tours/review-answer-channel.md
skills:
  - loop-standard
  - session-loop
  - tour-standard
plans:
  - pantry-review-layer
gates:
  - bun test (pantry, final) | 396 pass, 3 fail, 1050 expect() calls, 399 tests across 16 files
  - bun test (pantry, at HEAD before this change) | the same 3 failures, confirmed by stashing the change and re-running
  - tsc --noEmit (pantry) | clean, no output
  - oxlint (pantry) | 23 warnings, identical count to HEAD, none from a file this run added
  - bun run check (portfolio) | tsc --noEmit, clean
  - bunx proof verify plans (portfolio) | 18 plans, 4 changed files vs HEAD, 2 problems, both pre-existing
  - bun run lint:voice (portfolio) | 476 flags, down from 480 at HEAD, 0 new in the two files this run edited
  - bun run export + verify:export (portfolio) | dead-link walk OK, sitemap OK
  - crumb check content/tours (local 0.1.9) | 8 tours pass, the new one included
  - crumb check content/tours (pinned 0.1.7) | flags the new tour's prompt section, which the pin predates
  - bun cli.ts doctor (pantry) | 14 checks, 0 failing, 4 due
  - browser walk, crumb 0.1.9 decision card through the proxy | card read, 2 answers POSTed, 201 each, both in the log
  - live write-back, after the review fixes | valid POST 201, 200KB POST 413
diffstat: pantry 16 files changed, 834 insertions, 3 created (answers.ts, answers.test.ts, cli.test.ts); portfolio 2 files changed, 100 insertions, 2 created (the tour, the answer log)
dirty:
  - artifacts/runs/2026-08-09-conformance-and-handover.md | in the PORTFOLIO, staged as deleted by another session, deliberately left exactly as found
  - artifacts/ | in the PORTFOLIO, untracked, another session's, not touched
unpushed: 4 | 3 pantry + 1 portfolio, all created by this run; the four repos were at zero when it started, pushed on the owner instruction
verifiedBy: two independent reviewers that did not write the change, plus a browser walk of a real decision card. Between them they found eleven defects the author had not, including an unbounded read behind a stated cap, a refusal that only covered one file type, and a wait loop that could spin forever without erroring or exiting. Every one was fixed and every fix carries a regression test. The walk found two more before the reviewers ran.
doctor: 14 checks, 0 failing, 4 due; the 4 due are pre-existing and named below
---

## Gate output

Verbatim tails. The declared envelope was `pantry` plus three directories in the portfolio, and
everything touched sits inside them.

```
$ bun test                                   # pantry, final
 396 pass
 3 fail
 1050 expect() calls
Ran 399 tests across 16 files. [1176.00ms]

$ bunx tsc --noEmit                          # pantry
(no output)

$ bun run lint                               # pantry, oxlint
23 warnings                                  # same count as HEAD

$ bun run check                              # portfolio
$ tsc --noEmit

$ bunx proof verify plans                    # portfolio
18 plans, 4 changed file(s) vs HEAD, 2 problems
OK

$ bun run lint:voice                         # portfolio
voice-lint: 476 flag(s) across 30 file(s) (429 tell, 47 warn).

$ bun run verify:export                      # portfolio
[verify-export] dead-link walk: every internal href/src across the exported HTML resolves
[verify-export] OK

$ bun cli.ts doctor                          # pantry
14 checks, 0 failing, 4 due
OK
```

The 3 test failures are pre-existing and were confirmed so by stashing this change and re-running:
they are `buildKnowledge` and `renderLlmsTxt` reading an empty plans fixture, plus the same assertion
reached again through the route test. Nothing here touches them.

The 4 doctor items due are also carried forward by name: graphify freshness, no e2e suite, three
layer pins behind, and two old run reports missing evidence.

## What this run did

P2 and P3 of `plans/pantry-review-layer.md`, built together because neither is testable without the
other, and closing the contract `standards/DECISIONS.md` section 4 had been describing since it was
written.

**The channel.** `pantry/answers.ts` owns an append-only JSONL log. One POST route writes to it and
nothing else in PANTRY writes anything. Three surfaces reach it: the decision inbox, a review tour's
decision card, and a command for an answer that arrived by paste, so a paste-back is still a first
class path rather than the thing that got replaced.

**The session side.** `pantry answers` lists what is unread, `wait` blocks on one question, `ack`
records that a session acted, and `record` writes down what came back in chat. The ordering that
matters is stated in the code rather than assumed: the wait is the optimization, the read on wake is
the contract, and a loop built on the wait alone loses every answer given after a session ended.

**What did NOT happen, and should not have.** The plan said half the decision card exists in crumb's
prompt card and should move. It did not move and it should not: P1 already settled that CRUMB draws
the card and PANTRY draws the chrome. PANTRY's injected client reads the card instead. The plan's
sentence was written before P1 answered the question it presumed.

## The owner's four calls, and what one of them cost

Asked at the top of the run rather than at the end of it, which is the whole point of the surface
this run built.

- **The answer log lives per repo, path from config.** Default beside the decision requests.
- **Tours have been walked and never marked.** So the six pending statuses mean the marking step is
  the broken part, not the walking.
- **Push everything, publish crumb 0.1.9.** Four repos pushed. The publish did not happen: see below.
- **P2 and P3 together, then P4.** Done and done. P4 is untouched.

## The publish that did not happen, and what it cost

`npm publish` was refused by the harness permission classifier, twice, and not retried past that. So
crumb is still 0.1.9 on disk and 0.1.8 on npm, and the portfolio still installs 0.1.7, which does not
parse a `## prompt` section at all.

That is not a cosmetic block. It meant the real decision card could not be reached: stepping past the
last step simply ended the tour. To walk it honestly, 0.1.9 was copied into `node_modules` for the
walk and the published 0.1.7 restored immediately after, which is recorded here because a run that
stages an unpublished dependency to make its own evidence has to say so.

Mill 0.2.1 is stranded by the same block, in the same bump commit.

## The walk, and the two defects it found

Driven against a real crumb 0.1.9 decision card served through the proxy. The card was read as data,
two answers were POSTed, both came back 201, and both are in the log with their questions attached.

Two defects surfaced that no reading would have:

- **A closed card is still a card.** CRUMB's popover is a `<dialog>` and ending a tour closes it
  rather than removing it, so the selector kept matching a dead card with its last answers still in
  the fields. PANTRY would have offered to record an answer to a tour nobody was on.
- **A childList observer never sees a dialog close**, because `open` is an attribute. The same
  watcher had been shipping this bug since P1 for the fold control, unnoticed only because a stale
  fold button does nothing when pressed.

## The second pass, which found eleven more

Two reviewers, neither of which wrote the code, each given a written brief naming the bounds the plan
claims and told to try to break them. Every finding was reproduced before being accepted.

The four that matter most:

1. **The refusal that guarded one file type.** The check enforcing "PANTRY never writes plan corpus"
   refused markdown and nothing else, so a mistyped `answersLog` would have appended JSONL into a
   source file, a package manifest or a dotfile. Now an allowlist of two log extensions, plus a
   refusal to write through a symlink, since a name check is a string check and a symlink is exactly
   what makes a string check wrong.
2. **The cap that measured instead of stopping.** The request body was read whole and then compared
   against the cap. That caps what gets written and nothing else. It is the same mistake the proxy
   made about Content-Length in P0, one layer up, made by the person who wrote the P0 note about it.
3. **A wait that could never end.** `--timeout` with a non-numeric value became NaN; a NaN deadline
   is never past and a NaN sleep returns instantly, so the command became a hot loop with no error
   and no exit. A reviewer found it by running it. For an unattended loop this is the worst failure
   shape there is, and it was three characters of validation away.
4. **A wait that could not see the answer.** It matched only answers newer than the moment it
   started, so an answer given in the seconds before the session got round to waiting was invisible:
   it blocked the full timeout and reported nothing while the list showed the answer unread two lines
   above. It now matches unacked answers, which is what an ack was already for.

Also fixed: an options field that escaped the character cap every sibling field obeyed; a retry after
a partial failure that re-appended answers already on disk; a message that said "nothing answered"
when it meant "could not read the tour file"; a `--json=false` that read as true; a latent null
dereference in the inbox client's guard list.

One of them deserves its own line. The argument parser guessed whether a flag took a value by looking
at the next token, and the comment directly above it said that getting this wrong would make
`pantry answers --json ack x` eat `ack`. It ate `ack`. The comment was written by someone who had
reasoned about the failure and not tried it.

## What the first write found

The default log name was `answers.log`, and git ignored it on contact: `*.log` is line 5 of this
repo's `.gitignore` and of most others ever written. A per-repo answer log that git never sees gives
up the entire reason the owner chose per repo over per machine. The default is `answers.jsonl`, the
live log is tracked, and the reasoning is recorded in the config comment so the next person does not
helpfully shorten it back.

## What was NOT done

- **P4 is untouched.** Tier 1 on a non-GRAIN project is the phase that proves this is not
  portfolio-shaped, and it is a whole phase, not a tail.
- **The rail's Record button was never clicked in a browser.** The automation wedges on the review
  shell, on both a dev server and a production build, and the cause is the same-origin iframe rather
  than anything this run added. Its exact join-and-post path was run verbatim against a live card
  instead, and two answers landed. That is one pass short of the bar for that one control, and the
  new tour's first verify line exists so the owner closes it with a click.
- **No loop step obliges a session to read the log at start.** The channel works; the habit does not
  exist yet. That is written into DECISIONS rather than left implied.
- **Nothing was pushed after the run's own commits.** The four repos were pushed at the top of the
  run on the owner's instruction; these commits are new and unpushed.

## What needs human eyes

- **Walk `review-answer-channel`** and press Record answer in PANTRY's bar. That is the one control
  this run could not click.
- **Publish crumb 0.1.9 and mill 0.2.1.** Until then the decision card renders as raw text under the
  pinned 0.1.7, and the new tour looks broken for a reason that has nothing to do with it.
- **Three answers are sitting unread** in the portfolio's log, including the two this run's own walk
  recorded. `pantry answers` will show them.
