---
title: Give the human-in-the-loop question a home, and put two more checks in the loop
date: 2026-08-10
status: partial
lane: gated
branch: main
scope:
  - standards/
  - plans/
  - tools/
  - doctor.ts
  - doctor.test.ts
touched:
  - standards/DECISIONS.md
  - standards/README.md
  - standards/SESSION-LOOP.md
  - plans/pantry-review-layer.md
  - tools/lint-gate.ts
  - tools/lint-baseline.json
  - tools/review-gate.sh
  - tools/voice-lint.ts
  - package.json
  - doctor.ts
  - doctor.test.ts
  - ~/.claude/tools/context-usage.ts
skills:
  - loop-standard
  - session-loop
  - voice
  - claude-api
plans:
  - pantry-review-layer
  - session-handoff-automation
gates:
  - bun test (portfolio) | 328 pass, 0 fail
  - bun test (pantry) | 302 pass, 3 fail — the same three that were red before this run, named below
  - bun test (~/.claude) | 10 pass, 0 fail
  - tsc --noEmit (portfolio, pantry) | clean
  - voice-lint (DECISIONS.md) | 0 flags
  - lint gate | level at 494, and the regression path watched firing
  - proof verify plans | OK
  - render check | /standards/decisions returns 200 with a distinct title
diffstat: portfolio 9 files across 5 commits; pantry 2 files; claude-config 1 file
dirty:
  - artifacts/runs/2026-08-09-conformance-and-handover.md | in the PORTFOLIO, staged as deleted by another session, still owner-gated and untouched
unpushed: 30 | 17 portfolio + 6 pantry + 3 grain + 6 claude-config; pushing is owner-gated
verifiedBy: a second pass over both subagents' diffs, plus running each gate's fire path rather than its happy path
doctor: not re-run at the end; the audit-freshness change is covered by its own tests and a scratch-fixture run
---

## What this run was

Mostly a design conversation, and the artifacts are the settlement of it. The owner's framing: this
is building the racetrack, and once it exists they should only need to jump in when needed. Four
things came out of it that outlive the conversation.

**A new standard, `/standards/decisions`.** Nothing owned the question of where a question goes. LOOP
section 4b owns how much scrutiny a change earns, TOUR-STANDARD owns what a tour is, SESSION-LOOP
section 5 owns what a handoff contains, and none of them said which of those a given ask belongs on.
DECISIONS does, and the ordering that makes it useful is distance from the work: someone watching
corrects you in chat with no machinery at all, and that beats every surface below it.

**The plan for the review layer PANTRY hosts.** The owner rejected the version where PANTRY reports
on a change, in favour of PANTRY hosting the project and conducting the review on it. Same-origin
proxying is the unlock, because it lets PANTRY inject its own tour client into a page that ships
nothing.

**Lint in the loop, baseline and regress.** Pass or fail would have been red on day one against the
existing debt and muted within a week.

**Audit due by activity rather than calendar**, in doctor, because activity is what creates drift.

## Gate output

```
portfolio: bun test
 328 pass / 0 fail — Ran 328 tests across 20 files.

pantry: bun test
 302 pass / 3 fail — Ran 305 tests across 13 files.
 The three, unchanged from before this run:
   buildKnowledge > plans come from PROOF's derived index over the host's real plans folder
   renderLlmsTxt > llmstxt.org shape: H1 project, summary blockquote, plan + doc sections
   pantry cockpit surfaces > /knowledge.json is the machine brain over this project

claude-config: bun test tools/context-usage.test.ts
 10 pass / 0 fail

tsc --noEmit (portfolio, pantry): clean

lint gate, level:
lint gate: level. 494 flag(s) total (oxlint + voice-lint), matching or under the 494 in
tools/lint-baseline.json (generated 2026-08-10).

lint gate, regression path forced:
lint gate: 1 lint(s) regressed against tools/lint-baseline.json:
  oxlint:unicorn(no-array-sort): baseline 3 -> now 11 (+8)

render: curl /standards/decisions
200, <title>DECISIONS — how a run reaches the human, and how the answer comes back</title>
```

## What was not done

**None of the review layer is built.** The proxy, the injected client, the decision card and the
write-back are a plan, not a mechanism. The owner asked for the calls to be canon and the mechanism
to be verified before it spreads, and writing an unbuilt path into a standard would have inverted
that, so DECISIONS says plainly that nothing writes to the answer log yet and an answer currently
comes back by paste.

**The two bumps are still unpublished.** The npm token works again, which was the blocker for days,
but neither mill nor crumb has been bumped and published, so the list fix and the prefill are still
invisible on the live site. Publishing is outward-facing and was not authorised this run.

**The standards cleanup and the subagent-effectiveness audit are parked**, at the owner's word.

## What needs human eyes

**Canon fails its own rule, and now there is a number.** Widening voice-lint's default scope to cover
`standards/` surfaced 476 flags: 152 em-dashes and 292 backticks. `standards/CLAUDE.md` says the
standards are written in the voice they define and must pass themselves. The backticks are arguable,
since the lint cannot tell a literal identifier from prose, and that ambiguity is why standards were
excluded from the default scope originally. The em-dashes are not arguable. None of it was fixed or
suppressed; it is the baseline, so it is a visible number rather than a wall, and it is the first
concrete target for the parked standards audit.

**My estimate of that number was off by a factor of ten** and the subagent caught it. I told it to
expect about 45. Worth knowing because the instruction to widen the scope was mine, made on a wrong
figure, and the owner may want the scope narrowed back once the audit decides what a backtick in a
standard actually means.

**The lint gate speaks on every turn, including when nothing is wrong.** That is deliberate, on the
grounds that a check nobody sees passing is a check nobody trusts when it fails, but it is the only
thing in the gate that is never silent and it is the kind of choice that becomes wallpaper if it is
wrong.

**Two subagents, two different failure modes, and this is the evidence for auditing delegation.** One
earlier in the day lost its work entirely and had to be redone by hand. Another shipped a comment
claiming a guarantee the code did not have, which a second pass caught. Both of today's later two
were clean and one of them corrected me. That spread is the argument for treating subagent
effectiveness as an audit dimension rather than an anecdote.

**The lane on this report is self-assigned.** Gated: it touches canon that every repo reads and a
hook that runs at every turn end, but nothing irreversible, and each change carries a test or a
watched fire path.
