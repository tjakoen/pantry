---
title: P1b, the portfolio e2e, and the gate that had already lifted
date: 2026-08-10
status: complete
lane: high
branch: main
scope:
  - e2e/
  - content/tours/
  - plans/
touched:
  - e2e/crumb-prompt-and-prefill.e2e.ts
  - e2e/calendar.e2e.ts
  - content/tours/say-hello.md
  - plans/crumb-prefilled-demo.md
skills:
  - loop-standard
  - tour-standard
  - voice
plans:
  - crumb-prefilled-demo P1b | /plans/crumb-prefilled-demo
gates:
  - bun run check | clean
  - bun test | 328 pass, 0 fail
  - playwright test crumb-prompt-and-prefill | 12 pass, 0 fail
  - playwright test calendar | 16 pass, 0 fail
  - playwright test (whole suite) | 235 pass, 1 fail (catalog visual baseline, pre-existing)
  - bunx crumb check content/tours | 11 tours, all valid
  - bun tools/voice-lint.ts content/tours/say-hello.md | 1 tell, pre-existing line
diffstat: 4 files changed, 269 insertions(+), 10 deletions(-)
dirty:
unpushed: 16 | portfolio 8, pantry 8; the push is the owner's call and still open
verifiedBy: twelve e2e cases against the two real review tours, plus four instrumented browser dumps that corrected three assumptions the plan had made
doctor: 0 failing, 4 carried: graphify-freshness, e2e-presence, layer-pins, run-ledger (2 older reports, not this one)
---

P1b was written as "an e2e we cannot commit green yet". The npm token returned E401 on 2026-08-09, so
the phase parked. It is not parked any more, and nobody announced that: `@tjakoen/crumb` 0.1.9 is on
the registry, pinned here with a real integrity hash, and it carries all three things the earlier
phases were waiting on. So the phase reduced to the e2e alone, and the e2e grew to cover P2 as well
rather than P0 and P1 only.

**What is held now.** Twelve cases in `e2e/crumb-prompt-and-prefill.e2e.ts`, written against the two
real review tours rather than fixtures, because a fixture tour would prove the client works and say
nothing about whether the tours people actually walk still do.

The loop regression, the one this whole plan started from, is held by counting document navigations
rather than by looking at the address bar. A tour that navigates in a loop has a correct URL between
every hop, so an assertion on the URL passes against a page that is reloading forever. The count does
not.

**Three things the walk corrected, none of which a reading would have caught.** Each cost a real
instrumented run, and each had been assumed the other way when the file was first written.

1. `crumb.start` honours the tour's own `route:` and navigates home before the first card. So no test
   may start on a step's own page and jump to that step: the jump goes home first, the page reloads,
   and anything typed into the field beforehand is gone. The first draft of the refusal test looked
   like a product defect (a tour overwriting a human's text) and was a test defect.
2. The popover has no step list, so there is no `data-crumb-goto` to jump with. The only way to the
   prompt card is Next off the end of the last step, which is the way a reader gets there anyway.
3. The compose panel is not measurably visible inside the frame presentation. The panel is revealed,
   the island's own `hidden` is false, the field is filled and graded; it just has no usable box in
   that layout. P2's walk is therefore the popover, which is also the presentation a visitor uses.

**The refusal, in the sequence that actually tests it.** Stage the draft, type over it (which strips
the door's ink, because grain's grade rule un-grades a field on a trusted input event), re-render the
same step without navigating, and the card stops claiming the field: `data-staged="occupied"`, and the
human's words survive. That is the half that matters for trust, and it was the half no earlier pass
had run.

**One thing the tour had claimed wrongly.** `say-hello`'s last step asked the reviewer to type over
the draft and then walk Back and Forward to prove their own words survive. Back cannot prove that: the
step before it lives on the home page, so walking back leaves /mail entirely and the next arrival is a
fresh document. The verify line now says what is checkable and names the limit rather than hiding it.

## Gate output

```
$ bun run check
$ tsc --noEmit

$ bun test
 328 pass
 0 fail
 1298 expect() calls
Ran 328 tests across 20 files. [2.54s]

$ bunx playwright test e2e/crumb-prompt-and-prefill.e2e.ts
  ✓ the pinned crumb is new enough to have heard of any of this (4ms)
  ✓ P0 › the tour is served with the query state its step declares (1.0s)
  ✓ P0 › a step with query state arrives in one navigation, and the URL settles (3.0s)
  ✓ P0 › a step that declares no query state leaves the host's own params alone (1.4s)
  ✓ P1 › the card sits one past the last step, in place of the step counter (1.4s)
  ✓ P1 › an answer composes into the prompt live, and an unanswered token stays visible (1.1s)
  ✓ P1 › the card renders in the popover presentation too (2.1s)
  ✓ P1 › the handoff button appears only when the host loaded grain's handoff.js (1.1s)
  ✓ P2 › /mail#compose opens the panel on a cold load, with no click (645ms)
  ✓ P2 › the tour fills the field through the door, and says that it did (3.6s)
  ✓ P2 › typing over the draft settles it: the tour stops claiming the field (3.8s)
  ✓ P2 › nothing is sent: the walk ends on /mail with the draft still a draft (3.6s)
  12 passed (8.9s)

$ bunx playwright test e2e/calendar.e2e.ts
  16 passed (5.3s)

$ bunx playwright test
  1 failed
    e2e/visual.e2e.ts:53:3 › catalog (/catalog) matches its visual baseline
  235 passed (2.6m)

$ bunx crumb check content/tours
✓ say-hello — 3 step(s), demo
✓ review-prompt-card — 2 step(s), dev
(11 tours, all valid)

$ bun tools/voice-lint.ts content/tours/say-hello.md
content/tours/say-hello.md:26: TELL [backtick] backtick in prose
voice-lint: 1 flag(s) across 1 file(s) (1 tell, 0 warn).
```

Instrumented browser dumps, the evidence behind the three corrections above:

```
crumb.start honours route: (started on /mail#compose, typed text in the field)
  before start: url=/mail#compose  value="my own words, typed before any"  grade=null
  after  start: url=/               value=null                             grade=null
  after goto 2: url=/mail#compose  value="Hi Tjakoen,\n\nI came in through"  grade=grain  staged=staged

the frame presentation hides nothing and shows nothing
  composeHidden=false  composeDisplay=block  and no usable box for a visibility assertion
  same walk in the popover: box 223x519 at (656, 89), visible

the refusal, in place, no navigation
  staged:      value="Hi Tjakoen,\n\nI came in through"  grade=grain  staged=staged
  typed over:  value="my own words, over the top of "     grade=null   staged=staged (not re-rendered yet)
  re-rendered: value="my own words, over the top of "     grade=null   staged=occupied
```

## What was NOT done

- **The catalog visual baseline is red, and stays red.** `/catalog` renders 67922px tall against a
  67039px baseline, so the screenshot never settles inside its 5s budget and the failure reports as a
  timeout rather than as the drift it is. Confirmed pre-existing by re-running it with every file from
  this session removed: still red. It is in no plan, it is nothing this run touched, and picking a
  side (re-bless the baseline, or find the 883px) is a judgement about what the catalog is supposed to
  look like. Recorded, not widened.
- **Flow verbs.** Still deferred by the plan, and still nothing has needed one.
- **The pre-existing calendar red WAS fixed**, since it was named in the handoff as fix-or-record. The
  no-JS lightbox spec pinned the first feed photo to `.svg`, which only held while every fixture was a
  placeholder; a real event with real `.jpg` photos landed in `3a92d51` and sorts first. The claim the
  spec makes is that the link resolves to an image file at all, so the extension is now open. The two
  scoped assertions elsewhere in that file still name `.svg` and still pass, and were left alone.
- **The three sibling gates doctor carries** (graphify freshness, pantry's missing e2e suite, layer
  pins three behind). Untouched, different plans.
- **Nothing was pushed.** 16 commits now sit local across the two repos.

## What needs human eyes

- **The catalog baseline.** Re-bless it, or find the 883px? A run cannot decide which of those is the
  honest answer without knowing whether the page was meant to grow.
- **Whether P1b closing changes what the plan waits on.** The plan's remaining open box is the
  deferred flow verbs, and the phase text said the review link "shows the old parse on the live site".
  That sentence is now false for anyone whose site pulls 0.1.9, but the live site is only as new as
  the last push, which has not happened.
- **The say-hello verify line, as rewritten.** It now names a limit out loud (Back leaves the page).
  That is honest, and it is also longer. The judgement half of VOICE is a human's.
- **Still nobody has pressed Record answer.** `bun cli.ts answers` reports no answers recorded, ever.
  Every tour on disk carries this session's claim about its own status and no reviewer's.
