---
title: The warn line opens the successor, and the automations box closes
date: 2026-08-10
status: complete
lane: gated
branch: main
scope:
  - standards/
  - plans/
  - ~/.claude/tools/
touched:
  - standards/SESSION-LOOP.md
  - plans/done/nimbalyst-in-the-loop.md
  - plans/ai-workflow-loop.md
  - ~/.claude/tools/context-usage.ts
  - ~/.claude/tools/context-usage.test.ts
skills:
  - loop-standard
  - session-loop
  - voice
plans:
  - nimbalyst-in-the-loop, last box | /plans/nimbalyst-in-the-loop
gates:
  - bun test (portfolio) | 328 pass, 0 fail
  - bun test tools/context-usage.test.ts (claude-config) | 11 pass, 0 fail
  - bunx proof verify plans | OK, 3 warnings, all pre-existing
  - CONTEXT_WARN=1 session-guard.sh | watched firing, output verbatim below
  - bun tools/voice-lint.ts standards/SESSION-LOOP.md | 1 flag inside the edited range, file convention
diffstat: 5 files changed, 93 insertions(+), 23 deletions(-)
dirty:
unpushed: 20 | portfolio 10, pantry 9, claude-config 1; the push is the owner's call and still open
verifiedBy: the guard's warn path forced and read as the model would receive it, plus a test that holds the instruction against a reword
doctor: 0 failing, 4 carried: graphify-freshness, e2e-presence, layer-pins, run-ledger (2 older reports, not this one)
---

The owner asked why the loop does not move on its own, and pushed back on the answer. The pushback was
right, and the honest correction has two halves.

**What was true.** A Stop hook that exits 0 cannot put text in the model's context. Exit 2 is the only
other code and it blocks the stop, which can trap an unattended run. That is a property of the hook
contract and no harness changes it.

**What was wrong.** That this leaves the loop nowhere to go. The hook is not the only actor. The hook
prints, and the thing reading the print holds `spawn_session`. Naming the limit correctly matters,
because an earlier session reached the same wall and concluded "nothing to decide until there is a CLI
entry point", which parked the whole question on a CLI that was never needed.

**What was already built, and where it stopped.** The trigger exists and is machine-wide:
`~/.claude/tools/context-usage.ts` reads the real carried context off the transcript, warn at 200k,
stop at 900k, run from a user-level Stop hook by `session-guard.sh` alongside a durable-state check.
At the **stop** line it already told the model to open the sibling **without asking**, on the owner's
2026-08-10 override of "offer, do not open". At the **warn** line it only advised. So the loop's one
autonomous hop was set at 900k, the moment a session has least room left to write the brief the hop
depends on.

**The change.** Warn now carries the same rule, with the bound the owner set: hand the successor the
same task, and end the chain when that piece of work is done rather than when the plans run dry.
Picking up something new stays a decision with a human in it, which is the line between a handoff and
an agent that runs the backlog.

**The reason it belongs at the warn line, which is the owner's and is not in the standard anywhere.**
It is not about running out of room. A new session runs SESSION-LOOP from the top: it orients, reads
the plans, runs the doctor, meets the gates cold. A thread that keeps going skips all of that, because
it remembers doing it once. So the choice at the warn line is not "continue, or lose context" but
"continue with the checks behind me, or continue with them re-run", and only the second catches the
thing that moved underneath.

**The canon had drifted.** `SESSION-LOOP.md` section 5 still read "open the next session when asked,
or when the human is present to see it happen" — the exact wording the override replaced. The tool
moved on 2026-08-10 and the standard did not, so for a day the canon and the mechanism disagreed about
the only thing this section decides.

**The automations box, answered rather than skipped.** A standard is not worse without automations. An
automation is a clock: it fires whether or not there is work, where a handoff fires because a piece of
work outgrew the session carrying it. Two smaller facts settle it past the argument. An automation
lives in `nimbalyst-local/`, which is gitignored, so it can never be committed machinery another repo
or another device inherits. And the caveman precedent applies unchanged. The surface question was
aimed at the wrong tool: `spawn_session` needed no new decision, because the model already holds it
and nothing committed learns about Nimbalyst by its being used.

## Gate output

```
$ bun test                                    # portfolio
 328 pass
 0 fail
Ran 328 tests across 20 files. [2.55s]

$ bun test tools/context-usage.test.ts        # ~/.claude, the config repo
 11 pass
 0 fail
 21 expect() calls

$ bunx --bun proof verify plans
[warning] (none) touches: artifacts/runs/2026-08-09-conformance-and-handover.md is outside every plan's touches
[warning] repo-structure-reorg touches: content/events/gdgoc-hau-general-assembly.md belongs to "repo-structure-reorg" (done), which is not claimed as doing
[warning] runs-surface-polish touches: every touches entry points outside this repo
17 plans, 5 changed file(s) vs HEAD, 3 problems
OK

$ bun tools/voice-lint.ts standards/SESSION-LOOP.md   # filtered to the edited range
standards/SESSION-LOOP.md:225: TELL [backtick] backtick in prose
(43 flags file-wide, 42 of them pre-existing; the one in range names spawn_session, matching the
 convention the rest of the file already uses)
```

Watched firing, rather than trusted as a string. This is what a session actually receives:

```
$ echo '{}' | CONTEXT_WARN=1 bash ~/.claude/tools/session-guard.sh
context: 189.1k of 1000.0k (19%) · claude-opus-5
  Close to full. If the piece in flight fits in the room left, finish it and hand off.
  If it does NOT fit: make the state durable FIRST (gate green, work committed, decisions
  written), then OPEN the sibling session without asking and hand it the SAME task.
  Scope the brief to that one piece of work. The chain ends when it is done, not when the
  plans run dry. Do not start something new here. SESSION-LOOP section 5.

  Not safe to hand off yet:
  - 2 uncommitted path(s). Commit by pathspec if another session shares this tree.
  - 8 commit(s) unpushed to origin/main.
```

The two uncommitted paths in that reading belong to another session, which is the known blindness of
the durable-state half: it reads the tree, not the authorship.

## What was NOT done

- **No automation, no scheduled wakeup, no cron.** Argued against above and left unbuilt on purpose.
  `nimbalyst-local/automations/` still does not exist.
- **The instruction is not proved end to end.** It is held by a test and watched firing, which is two
  passes on the text. Nobody has yet watched a session cross 200k mid-task and open its successor, so
  the claim in this report is that the trigger says the right thing, not that the hop has happened.
  The next session to cross the line is the proof, and it costs nothing extra to watch.
- **Nothing outward-facing.** No push. The count is now 20 across three repos.
- **The rest of `ai-workflow-loop.md` P3.** Wiring real loops in pilots, the CI-on-push heartbeat and
  the blocking hooks are untouched. This change is one hop of one loop, not that phase.
- **`~/.claude` was committed by path only.** That repo carries a large standing pile of uncommitted
  memory edits across several projects, including this session's own. Two tool files went in; the pile
  was left exactly as found, because committing into somebody else's standing mess unasked is a sweep.

## What needs human eyes

- **Watch one hop.** The cheapest possible confirmation, and the only one this run could not give
  itself: next session that crosses 200k with work in flight should open its successor unprompted.
  If it asks instead, the instruction is being read as advice and the wording needs to get blunter.
- **Whether 200k is still the right warn line** now that crossing it does something rather than
  advising something. It was set as a productivity judgement when the consequence was a printed note.
  The consequence is now a new session, and a line that fires too early costs a spawn each time.
- **The canon prose, as rewritten.** Three paragraphs of section 5 under the byline, including a
  claim about what a scheduler is worse at. VOICE's judgement half is a human's by definition.
- **Still nobody has pressed Record answer.** `bun cli.ts answers` reports no answers recorded, ever.
