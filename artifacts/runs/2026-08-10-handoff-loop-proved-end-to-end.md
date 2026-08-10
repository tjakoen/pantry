---
title: The handoff loop, proved end to end, after the first version turned out to be inert
date: 2026-08-10
status: complete
lane: gated
branch: main
scope:
  - standards/
  - ~/.claude/tools/
  - ~/.claude/settings.json
touched:
  - standards/SESSION-LOOP.md
  - ~/.claude/tools/context-trigger.sh
  - ~/.claude/tools/durable-state.sh
  - ~/.claude/tools/session-guard.sh
  - ~/.claude/settings.json
skills:
  - loop-standard
  - session-loop
plans:
  - nimbalyst-in-the-loop, closed earlier this session | /plans/done/nimbalyst-in-the-loop
gates:
  - bun test (portfolio) | 328 pass, 0 fail
  - bun test tools/context-usage.test.ts | 11 pass, 0 fail
  - channel probe, PostToolUse additionalContext | nonce read back in context
  - trigger watched firing unforced at 233.9k | instruction arrived in context
  - spawn test 1, task fits | did NOT spawn, finished, all constraints respected
  - spawn test 2, task does not fit | DID spawn, same task, durable state checked
diffstat: 5 files changed, 177 insertions(+), 27 deletions(-)
dirty:
unpushed: 23 | portfolio 11, pantry 10, claude-config 2; the push is the owner's call and still open
verifiedBy: two spawned sessions exercising opposite branches of the instruction, plus a nonce probe of the channel before anything was written into it
doctor: 0 failing, 4 carried: graphify-freshness, e2e-presence, layer-pins, run-ledger (2 older reports, not this one)
---

The owner asked for an end-to-end test before pushing. The test found, first thing, that the change
committed an hour earlier did nothing at all.

**The inert version.** The instruction telling a session to open its successor was wired on the
turn-end event. At exit 0 that event's output goes to the transcript, for a person, and never enters
the model's next-turn context. That was already measured twice on 2026-08-10 and written into memory;
the wiring was not checked against it before the instruction was written. So a session was being told
to hand off through a channel it could not hear.

**The probe, which is the part worth copying.** Rather than reasoning about which event might reach
the model, a throwaway hook was wired that emitted a nonce, and one tool call was made. The nonce came
back in context. That settled it in under a minute: `PostToolUse` returns
`hookSpecificOutput.additionalContext` and it arrives as a system reminder. A second probe dumped the
payload, which carries `session_id` and `transcript_path` directly, so nothing has to guess which
transcript belongs to which session. That guess is the bug the mtime fallback has whenever two
sessions share a repo, which is the normal case here.

**What was built.** `context-trigger.sh` on PostToolUse, model-facing. `durable-state.sh`, the three
facts extracted because they now have two callers and two copies drift. `session-guard.sh` keeps the
turn-end event, because the readout is genuinely useful to a person even though it cannot reach a
session. Both hooks stay and they are additive.

Two cost gates, since the new event fires after every tool call: re-read the transcript only once it
has grown 250k bytes since the last real reading, and announce a verdict once rather than on every
call. Both were verified silencing correctly before wiring.

## The four claims, and how each was tested

**1. The instruction reaches the model.** Watched firing unforced against this session's own real
233.9k reading, no test harness, no lowered threshold. The text arrived in context.

**2. A session does NOT spawn when the task fits.** Session `01a985ee`, warn lowered to 20k, given a
bounded task (attribute an 883px visual-baseline drift). It received the instruction twice at a real
46.0k reading, judged the task fit, finished it, and did not spawn. Transcript count unchanged. It
also respected every constraint unprompted: committed by pathspec, left another session's staged
deletion alone, cleaned its temp files, did not push. Its finding was exact and is now committed as
`602d83d`.

This branch matters more than it looks. Lowering `warn` alone does not shrink the window, so the
session correctly saw plenty of room and stayed. A naive implementation would have chained on the
first reading.

**3. A session DOES spawn when the task does not fit.** Session `4e015aea`, window temporarily 55k
and warn 20k, given an explicitly two-part task (tests for pantry's two untested sources). It was
shown `context: 45.8k of 55.0k (83%)` with all the work outstanding. It wrote nothing, checked that
pantry's tree was clean, and opened a successor. Its own account, unprompted:

> Context window is at 83% before any real work started. Pantry's tree is clean, so state is already
> durable and there is nothing of mine to commit. Handing the same task to a sibling session.

**4. The successor is scoped to the same task.** Its opening brief, written by the parent and by
nothing else:

> You are picking up a task from session ca2f0b21's child, which ran out of context window before
> starting. NOTHING has been done yet. Pantry's git tree was clean at handoff; no partial work to
> recover.

It carried the task verbatim, both files, plus every constraint: pathspec commits, no push, edge off
limits, the portfolio left alone, the 501/0 baseline, and the three literal run-report headings. It
did not help itself to anything else on the board.

It also improved the brief without being told to, naming `paths.test.ts` as the style model over
`app.test.ts` because the smaller file leaves the successor room to finish both pieces. Adapting a
handoff to the successor's constraint is not in any instruction.

**The chain bounded itself at one hop**, because the successor runs on the restored thresholds and is
nowhere near them. Transcript count went 85, 86, and stopped.

## Gate output

```
$ bun test                                    # portfolio
 328 pass, 0 fail

$ bun test tools/context-usage.test.ts        # claude-config
 11 pass, 0 fail

# the channel probe, before any instruction was written into it
PostToolUse:Bash hook additional context: PROBE-7F3A9C: if you can read this line,
PostToolUse additionalContext reaches the model.

# the payload probe
keys={"session_id": "...", "transcript_path": "...", "cwd": "...", "hook_event_name":
"PostToolUse", "tool_name": "Bash", "duration_ms": 17}

# the trigger firing unforced on a real session
context: 233.9k of 1000.0k (23%) · claude-opus-5
  Close to full. If the piece in flight fits in the room left, finish it and hand off.
  If it does NOT fit: make the state durable FIRST ... then OPEN the sibling session
  without asking and hand it the SAME task.

# test 2's session, at the condition the instruction is written for
context: 45.8k of 55.0k (83%)
instruction occurrences in its context: 2

# the chain
transcripts 84 -> 85 (test 2 spawned) -> 86 (successor) -> 86 (stopped)
```

## What was NOT done

- **Nothing was pushed.** 23 commits across three repos.
- **The two temporary threshold changes are reverted**, verified by `git status` on the config repo
  showing the file clean. The second revert was done by a script armed before the test rather than by
  hand, so the exposure window did not depend on anyone noticing in time.
- **The successor's own task is unfinished at the time of writing.** It is mid-work with
  `config.test.ts` and `fixtures.test.ts` on disk, uncommitted. That is its run to close, not this
  one's, and `notifyOnComplete` was set on its parent rather than on it, so nobody here will be told
  when it lands.
- **The stop line was not re-tested.** It already said to open a sibling before today and its wording
  was not touched. Only the warn line changed, and only the warn line was exercised.
- **No automation, wakeup or scheduler** was built. Argued against and left unbuilt.
- **The catalog baseline was not re-blessed.** Test 1 attributed the drift exactly and recommended
  re-blessing; the call is the owner's and the run stopped at the recommendation, as instructed.

## What needs human eyes

- **A bystander session got nudged.** While the threshold was low, another live session on this
  machine crossed it and received one warn. No harm followed, and the announce-once gate stopped it
  repeating, but it shows the blast radius of changing a machine-wide default. Any future tuning
  should go through `--warn` on a single invocation instead.
- **Whether 200k is still the right warn line** now that crossing it opens a session rather than
  printing a note. It was chosen when the consequence was advice.
- **The trigger reports the shell's cwd, not the repo the work is in.** After this session cd'd into
  the config repo, the durable-state half read that tree's 74 uncommitted paths instead of the
  portfolio's 2. Correct behaviour, and misleading if unnoticed.
- **Three paragraphs of SESSION-LOOP section 5 are new prose under the byline**, including a claim
  about what a scheduler is worse at. The judgement half of VOICE is a human's.
- **Still nobody has pressed Record answer.** `bun cli.ts answers` reports no answers recorded, ever.
