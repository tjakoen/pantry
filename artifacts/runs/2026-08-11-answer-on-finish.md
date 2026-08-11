---
title: The first human press, and the four things it broke
date: 2026-08-11
status: complete
lane: human
branch: main
scope:
  - pantry-review.js
  - pantry.css
  - app.ts
touched:
  - app.ts
  - app.test.ts
  - pantry-review.js
  - pantry.css
  - preview.test.ts
  - ../tjakoen.github.io/plans/pantry-review-layer.md
  - ../tjakoen.github.io/content/tours/review-answer-channel.md
  - ../tjakoen.github.io/pantry.config.json
  - ../tjakoen.github.io/plans/decisions/answers.jsonl
skills:
plans:
  - pantry-review-layer P5 | /docs/plans/pantry-review-layer
gates:
  - bun test (pantry) | 614 pass, 0 fail
  - bunx tsc --noEmit (pantry) | clean
  - bun test (portfolio) | 328 pass, 0 fail
  - bunx proof verify plans (portfolio) | OK, 3 warnings
  - bun cli.ts doctor (pantry) | 19 checks, 0 failing, 4 due
diffstat: 5 files changed, 372 insertions(+), 54 deletions(-) in pantry; 4 files changed, 53 insertions(+), 20 deletions(-) in the portfolio
dirty:
unpushed: 4 portfolio, 4 pantry | the push is the owner's call and was deliberately not taken
verifiedBy: the owner, by walking it — that walk is what this report is about
doctor: 0 failing, 4 carried: graphify-freshness, e2e-presence, layer-pins, run-ledger
---

P5 was the one phase whose whole content was a person doing something nobody had done. P0 through P4
each proved a link on its own; the link never exercised was the one at the end, where a human presses
the thing that writes. The owner pressed it at `06:33:52Z`. It worked, and then everything around it
turned out to be wrong in ways no amount of reading would have found.

**The run's own first failure was the setup, not the code.** PANTRY was started as a tracked
background task, which does not survive the process that started it. It died; the owner pressed
Record against a server that was not there; nothing was written. The fix is one word (`nohup`) and it
is worth writing down because the symptom — a press that does nothing — is identical to the symptom
of every real bug in this chain.

**The Record button is gone.** It existed for a structural reason: CRUMB owns the card, PANTRY owns
the chrome, neither reaches into the other, so the card's own Finish could not write and a second
button in PANTRY's bar had to. That is an implementation boundary handed to the reviewer, and the
first person to meet it did the obvious thing — answered the card, pressed Finish — and lost what
they typed. Finishing the card is the answer now. The boundary did not move: PANTRY still only
watches the dialog close.

Closing is not finishing, and that distinction had to be built rather than assumed. An × or an Escape
is an abandon, marked by CRUMB as `data-crumb="end"`, and it writes nothing and says so. Without it,
recording on close would append a draft somebody changed their mind about, to a log with no way to
take it back.

**The outcome is said where the reviewer is looking.** It was already being said: 14px, in
`--ink-muted`, in the bar at the top of the pane, roughly six hundred pixels from the card at the
bottom of the frame. The owner read that as silence and asked whether anything had been written,
which for the one control in the system that writes is the worst thing it could read as. There is a
receipt over the frame now, and it says what the write MEANT — a session waiting on this is unblocked
— rather than a row count.

`data-kind` had been set on that status line since P2 and styled nowhere, so a success and a failure
rendered as the same grey sentence. It is styled now, and hueless: GRAIN collapses `--color-success`
and `--color-danger` to `--ink` deliberately (states from weight, palette stays closed), so the
eyebrow carries the word and the border carries the treatment.

**Two defects found by walking that reading did not find, both in code written in this same run.**
The leave-without-recording detection was written, correct, and never fired once, because it counted
answers on DOM mutations and typing an answer is not a mutation — a textarea's value and a radio's
checked state are properties. And the full outcome sentence in a one-line flex bar pushed "Hide rail"
and "Open full" onto a second row, relaying out the chrome around the app under review every time an
outcome was reported.

**The rail was lying, and it had been all along.** Its step statuses come from the tour file, which
was written before the walk and which no arriving answer ever edits. So it said "2 of 3 awaiting you"
about a review answered an hour earlier, and would have said it tomorrow. It reads the answer log
too now: answered-and-unacked reads "answered, waiting on the AI"; answered-and-acked folds into a
Closed group. Folded rather than deleted, because "where did the one I answered go" is the next
question. The reviewer's queue went from nine to seven on the first load after the ack, which is the
first time that list has ever gone down.

**`?tour=<id>` opens the walk it names.** Before this a handoff was a URL plus a sentence about which
rail entry to click, and the sentence is the half that goes stale: rename a tour and the sentence
points at an entry that is not there, with nothing failing anywhere to say so.

**The waiting was real and it still went wrong, which is the finding worth keeping.** The session
said what it was waiting for and genuinely blocked in `pantry answers wait`, exactly as DECISIONS
section 4 asks. It waited on `review-answer-channel#reads-right`. The owner answered `#keep-both`.
One card, two asks, two refs, and the run sat there for nine and a half minutes while the answer it
had asked for was already on disk. A wait keyed to a single ask is the wrong grain — what a session
waits for is the card. Left open in the plan rather than fixed here, because "any answer to this
tour" and "all of them" are different promises and the difference only appears on a half-answered
card, which is the case that produced the bullet.

**What the owner decided, through the tour, about the tour.** The card's second ask was whether the
decision page should keep both return paths. "Keep the paste prompt, but collapse it." Both survive,
because DECISIONS section 2 puts the chat above every surface below it and pasting is right when
someone is already in it; but two equal buttons made the durable channel and the transient one read
as a matter of taste. The paste is a folded `<details>` now and Record answer is the only top-level
action. Acked as `k-20260811T065319Z-fb83f979`.

## What the demo cost that a test would not have

Three restarts on a scratch answer log, because every verification of a write path is itself a write
to an append-only file that cannot be retracted. `answersLog` pointed at `/tmp` for each check and
back afterwards. One of those checks was reported here as stronger than it was before being redone:
the abandon guard was first "verified" by observing the real log unchanged while PANTRY was pointed
at the scratch one, which proves nothing. Redone against the scratch log, where the file was never
created at all.

## Gate output

```
$ bun test                                    # pantry
 614 pass
 0 fail
 1616 expect() calls
Ran 614 tests across 22 files.

$ bunx tsc --noEmit                           # pantry
(clean)

$ bun test                                    # portfolio
 328 pass
 0 fail
 1298 expect() calls
Ran 328 tests across 20 files.

$ bunx proof verify plans                     # portfolio
17 plans, 4 changed file(s) vs HEAD, 3 problems
OK

$ bun cli.ts doctor                           # pantry
19 checks, 0 failing, 4 due
OK
```

## What needs human eyes

The success receipt has been seen by a person exactly once, in a screenshot, on a scratch log. The
next walk of `review-answer-channel` is the one that puts the new flow in front of the owner:
finishing the card should write both answers with nothing to press, and `#reads-right` is still
unanswered on the real log. `?tour=review-answer-channel` is the URL.
