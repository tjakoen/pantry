---
title: Stage a tour's first prefill, and close the handoff trigger on recommend
date: 2026-08-10
status: partial
lane: gated
branch: main
scope:
  - grain/packages/crumb/
  - content/tours/
  - view/pages/mail.html
  - docs/crumb/WRITE-A-TOUR.md
  - standards/TOUR-STANDARD.md
  - plans/
  - ~/.claude/tools/
touched:
  - grain/packages/crumb/core/types.ts
  - grain/packages/crumb/core/schema.ts
  - grain/packages/crumb/core/schema.test.ts
  - grain/packages/crumb/check.ts
  - grain/packages/crumb/check.test.ts
  - grain/packages/crumb/crumb-live.js
  - grain/packages/crumb/crumb-live.test.ts
  - grain/packages/crumb/crumb.css
  - grain/packages/crumb/from-timeline.ts
  - grain/packages/crumb/PLAN.md
  - content/tours/say-hello.md
  - view/pages/mail.html
  - docs/crumb/WRITE-A-TOUR.md
  - standards/TOUR-STANDARD.md
  - plans/crumb-prefilled-demo.md
  - plans/runs-surface-polish.md
  - plans/nimbalyst-in-the-loop.md
  - plans/done/session-handoff-automation.md
  - ~/.claude/tools/context-usage.ts
skills:
  - loop-standard
  - session-loop
  - tour-standard
  - voice
plans:
  - crumb-prefilled-demo
  - session-handoff-automation
  - runs-surface-polish
gates:
  - bun test (grain) | 572 pass, 0 fail
  - bun test (crumb package) | 57 pass, 0 fail
  - bun test (portfolio) | 328 pass, 0 fail
  - bun test (~/.claude context-usage) | 10 pass, 0 fail
  - tsc --noEmit (crumb, portfolio) | clean
  - bunx crumb check content/tours | 7 tours, see the note below on which package answered
  - proof verify plans | OK, 2 pre-existing warnings
  - browser walk of say-hello against the unpublished package | all three prefill outcomes observed
diffstat: grain 11 files changed across 2 commits; portfolio 5 files in one commit plus 3 plan commits; claude-config 1 file
dirty:
  - artifacts/runs/2026-08-09-conformance-and-handover.md | in the PORTFOLIO, staged as deleted by another session, deliberately left staged
unpushed: 20 | 12 portfolio + 3 grain + 5 claude-config; pushing is owner-gated
verifiedBy: a browser walk of the finished tour against the unpublished package, plus a read of both agents' diffs that found and fixed a defect neither reported
doctor: not re-run this pass; the layer pins and skills-mounted findings from the morning run stand unchanged
---

## What this run did

Three things, in the order the handoff asked for them.

**P2 of the prefilled-demo plan: a tour may now stage a field, and only through the door.** A step
carries a fifth meta key, `- prefill:`, legal only where its own surface is a `field:` address. The
client raises the same `field.set` Intent a human's typing raises, on `window.grain.door`, and the
design law is now held by a test rather than a comment: `prefillStep`'s body must call `door.submit`
and must never assign `.value`. It refuses a field the human has already touched, using grain's own
grade rule (a trusted input event strips `data-grade="grain"`, so the same test the rest of the
estate uses answers "whose words are these"). `check.ts` imports `isSafeFieldValue` and
`FIELD_VALUE_CAP` from grain's contract rather than mirroring them, so the lint cannot drift from
what the door will actually refuse.

**The handoff trigger's last task closed on recommend, not spawn.** The two options were a CLI entry
point so a bash hook could spawn a sibling session, or an honest rewrite. It is the rewrite, and the
reasons are in the plan. One line was owed to make the recommendation real: the stop message now
names the offer instead of implying it.

**The runs layer on `/timeline` stayed deferred, and now has a number.** Six reports, one more than
the five this plan already called not a series. The bar is twelve reports or a two-month span.

## Gate output

```
grain: bun test
 572 pass
 0 fail
Ran 572 tests across 63 files. [1.56s]

grain/packages/crumb: bun test
 57 pass
 0 fail
Ran 57 tests across 6 files. [41.00ms]

portfolio: bun test
 328 pass
 0 fail
Ran 328 tests across 20 files. [2.75s]

portfolio: tsc --noEmit
clean

portfolio: bunx --bun proof verify plans
17 plans, 1 changed file(s) vs HEAD, 2 problems
OK
```

The browser walk, on a local server with the unpublished package copied into `node_modules` and
restored afterwards. All three outcomes were produced rather than reasoned about:

```
step 3 arrives at /mail#compose      one navigation, panel open on arrival
field value                          the staged draft, verbatim
data-grade                           grain
card line                            "Staged by the tour ... nothing was sent."

after typing over it (real keystrokes)
data-grade                           null       (grain's own trusted-input settle)
re-entering the step                 "Left as it was. You have already written here."
the human's words                    survived

with the door marked offline
card line                            "The door is offline ... shows the real state."
field                                empty
```

## What was not done

**Nothing here reaches the live site.** CRUMB is a published package and the portfolio consumes a
published copy, so P2 waits on the same E401 npm token as P1b, crumb 0.1.8 and the MILL list fix. The
e2e that would hold P0, P1 and P2 still cannot be committed green for the same reason.

**No launcher was wired for the new tour.** The dock has one tour slot, bound to `portfolio`, and the
five review tours are URL-only. A second dock item is a shell-design call, so the tour is reachable
at `/?crumb=say-hello&crumb-mode=demo` and nowhere else.

**P3 was not started.** The `#compose` deep-link fix is a single page's URL state and was the minimum
needed to reach the field at all, not the phase.

## What needs human eyes

**The new tour renders badly on the live site until the package publishes, and the lint says it is
fine.** The pinned 0.1.7 parser does not know `prefill`, and an unrecognised `- key:` line is treated
as narration, so the step's prose currently reads out its own prefill line as text. `crumb check`
reports the tour clean, because the parser answering is the old one. That is a false green, not a
passing tour, and it is worth knowing that the check cannot see the thing it is checking until the
pin moves. The exposure is small (URL-only) and the alternative was holding a finished tour out of
the repo, which the P1 tour's own precedent argues against.

**A defect the building agent's own comment claimed was closed.** The client's `render` is also what a
demo/dev flip calls, and `door.submit` is async, so a flip inside the flight window found an empty
field and asked the door a second time. The op is idempotent so the field was never wrong, but the
reasoner narrates per fill, and a tour that staged one draft would have said so twice. Found by
reading the diff rather than by a test, fixed with a set of surfaces already handed over, and the
comment that overstated the guarantee was rewritten to say where the safety actually lives.

**One reported constraint was wrong and no work depends on it.** The portfolio agent reported that a
step at `/mail#compose` reached from a step already on `/mail` would never navigate. That is true of
the pinned client and false of the fixed one, which is the whole point of the P0 fix: the tour could
have kept its orienting steps on `/mail`. It starts at the desk instead, which reads better anyway,
so nothing was rebuilt. It is recorded here because the finding is in that agent's report and the
next reader should not inherit it.

**A concurrent session committed this session's in-flight edit.** `plans/nimbalyst-in-the-loop.md`
was edited here and swept into that session's `a99e2e1` before it could be committed by pathspec. The
content landed intact and the attribution is theirs. Nothing was lost, and it is the second time in
two days this tree has crossed two sessions mid-edit.

**The lane on this report is self-assigned.** `gated`, on the same reading as the morning's: a real
blast radius, since the grammar and client ship in a published package that other repos consume, but
no irreversible path touched and a gate that would catch it going wrong.
