---
title: The handoff nudge, and the throwaway evidence swept up after it
date: 2026-08-10
status: complete
branch: main
scope:
  - tjakoen.github.io/tools
  - tjakoen.github.io/artifacts/reviews
  - pantry/artifacts/runs
touched:
  - tjakoen.github.io/tools/review-gate.sh
  - tjakoen.github.io/artifacts/reviews/sim-loop-2026-08-10/ (deleted, was untracked)
  - pantry/artifacts/runs/2026-08-10-handoff-nudge.md
plans:
  - none. This closes the one gap the 2026-08-10 loop simulation named, and no phase of
    plans/pantry-review-layer.md moved. P4e stays open on the owner.
gates:
  - bun ../pantry/cli.ts answers (portfolio) | 0 unread, 9 acted-on, nothing to act on
  - bash -n tools/review-gate.sh | syntax ok
  - gate self-test, 7 cases (portfolio) | all pass, exit 0 every time
  - bash tools/review-gate.sh against the committed tree (portfolio) | silent on nudge 4, lint gate level at 494, exit 0
  - bun cli.ts doctor (pantry, first pass, this report present) | see Gate output
  - bun cli.ts doctor (pantry, second pass) | see Gate output
  - live watch, spawned session 9f587e3b ticking a real phase box | NUDGE DID NOT FIRE, marker absent
  - gate self-test after the fix, 13 cases including the replayed failure | all pass, exit 0 every time
  - time bash tools/review-gate.sh (portfolio, whole gate) | 0.71s total, lint gate dominates
diffstat: 1 file changed, 84 insertions(+), 1 deletion(-) in the portfolio (tools/review-gate.sh),
  committed as 52a848d, then 70 insertions(+), 14 deletions(-) to the same file as ce083eb after the
  gate was watched and did not fire. 8 untracked files deleted (6 PNG, 1 JSON, 1 README). 1 file
  added in pantry (this report).
dirty:
  - tjakoen.github.io/artifacts/runs/2026-08-09-conformance-and-handover.md | staged as deleted,
    pre-existing at session start, not touched by this run, left alone on instruction
  - tjakoen.github.io/artifacts/runs/ | untracked, contains only the file above, pre-existing, not
    touched by this run
unpushed: 9 | tjakoen.github.io 5 (two are this run's commits, one is a sibling session's), pantry 4
  (one is this report). Nothing was pushed; the push is the owner's call and is still open.
verifiedBy: three passes, and only the third one found what mattered. A `caveman:cavecrew-reviewer`
  subagent read the first working diff cold and returned 1 red plus 3 yellow; a second one read the
  fix and returned 0 red plus 5 yellow, 4 taken. Neither of them, and none of my own thirteen test
  cases, found the defect that a single unrelated session found by simply existing: see What
  watching it found.
doctor: pantry against itself, 15 checks, 0 failing, 4 due, exit 0, both passes. The run-ledger line
  reads the same before and after this report existed apart from the report count, which moved 14 to
  15, and this report is not among the named gaps.
---

## What this was

The loop simulation on 2026-08-10 walked all seven steps of the BREAD session loop and passed all
seven. It found exactly one gap, and it is a gap in the loop rather than in any code: every other
step has something that asks for it, and the handoff has nothing. That is the step whose absence
costs the most, because the price is not paid by the session that skipped it.

This adds a fifth nudge to the portfolio's Stop hook, deletes the simulation's throwaway capture
evidence, and stops there. Everything else queued is blocked on the owner.

## What was built

A fifth section in `tools/review-gate.sh`, advisory like the other four, exit still always 0.

**The trigger is narrow, and narrowness is the whole design.** The file's own comment on nudge 2
says how this kind of gate dies: not by rejection but by noise, muted within a week. "Have you
handed over yet" asked at every turn end is the purest available form of that. So it fires only when
the turn did something a SESSION closes rather than something a turn closes, which is two things: a
run report written under `artifacts/runs/`, or a phase box ticked on the plans board. The plan
trigger is the one that makes this reach past this repo, since the plans board for the whole estate
lives here while the code it tracks often does not.

**It fires once per closed thing, not once per turn.** A handoff is a prompt and not a file, so
"already done" cannot be read off the tree the way nudge 2 reads a tour written this turn. The
marker is a list in `.git/`, which is per worktree, never staged and never in `git status`.

## What the second reader found that six of my own tests did not

The reviewer returned one red. The plan trigger recorded the fixed sentence "a phase closed on the
plans board" as its dedupe item, so the first phase ever ticked would write that line and every
phase after it would match a line already there. One nudge, ever, from a gate whose comment two
lines above claimed one per phase.

The shape is worth keeping more than the fix is. My self-test had six cases and they were thorough
about the wrong axis: report versus plan, fire versus silent, set membership, exit code, tree
cleanliness. Every one of them tested the FIRST phase closing. The seventh case, the one that fails,
is a second and different phase closing later, and it did not occur to the person who wrote the
dedupe because he already believed what it was for. A muted gate is also the failure mode with no
symptom, which is why this one was worth a cold reader rather than another pass by me.

Two of the three yellows were taken as well. The plan match is anchored to a list item at the start
of an added line rather than `- [x]` anywhere in one, because this repo's plans and standards discuss
checkbox syntax in prose and one stray match used to burn the marker permanently. And the git-dir
lookup has a fallback, so an empty result cannot collapse the marker path to the filesystem root.

The third yellow was declined on purpose and is recorded in the code: a run report is keyed by path
and not by content, because keying on content would re-nudge on every save while a report is still
being drafted. That is a session's worth of noise, traded against the case of a date-stamped filename
being reused for unrelated work.

One more thing that draft got wrong, found by running it rather than reading it. The trigger
tested that a run report exists on disk, and the portfolio carries a staged deletion whose file is
still sitting there unmodified. Git reports that path as both deleted and untracked, so the gate
fired on somebody else's tidy-up on the very first run. A report counts only when its bytes differ
from HEAD's now.

## What watching it found, which neither reviewer nor thirteen tests did

The gate was then put in front of a real session rather than described. A sibling session
(`9f587e3b`) was spawned on an unrelated task from `plans/nimbalyst-in-the-loop.md`, told nothing
about the gate, and it did the thing the gate exists to catch: it ticked a phase box and closed out.

**It was never nudged.** `.git/handoff-nudged` did not exist afterwards, so nothing had fired.

The cause is one line of reasoning nobody in this run questioned, two cold reviewers included, each
looking straight at it. The trigger read the WORKING DIFF. The session edited
`plans/nimbalyst-in-the-loop.md` and committed it as `98d5b96` inside the same turn, so by the time
the Stop hook ran there was no working diff left to read. **The gate nudged the session that leaves a
mess at a turn boundary and stayed silent for the one that commits promptly**, which is exactly
backwards, and every test written for it passed because every test left the change uncommitted. The
suite and the author shared one assumption, so thirteen cases tested it thirteen times.

Fixed in `ce083eb`: a close is looked for in unpushed commits as well, keyed by sha. The failure was
then replayed against the real commit rather than a fixture, by removing `98d5b96` from the marker
and running the gate, which prints it.

A second cold reviewer read the fix and returned no red and five yellows. Four were taken: the log
call is path-filtered so a turn end no longer pays two subprocess calls against thirty commits;
merges are read with `-m --first-parent`, since `git show --name-only` prints nothing at all for a
merge and a close arriving through one is exactly as closed as any other; the no-upstream window is
5 rather than 30, which is also what a pruned upstream ref degrades into; and the baseline comment
now says what baselining actually swallows, which is the whole current backlog rather than the
softer "first close after install" it claimed. The fifth, that a close scrolling past the 30-commit
bound is never nudged at all, is real and is left standing, because the honest mitigation is pushing
and the push is owner-gated.

**The generalisable part.** Two independent cold reviewers and thirteen tests all missed a defect
that one unrelated session found by existing. The reviewers were reading code that was internally
consistent; the tests were written by the person holding the wrong assumption. Only the watch had no
stake in it. Which is LOOP section 4a's evidence requirement in its strongest form so far: a gate
nobody has watched fire has not been tested, it has been described.

## Gate output

```
$ bun ../pantry/cli.ts answers
log: /Users/tjakoenstolk/Local/Development/bread-repos/tjakoen.github.io/plans/decisions/answers.jsonl

Nothing unread.

Acted on (9): [p4d-capture-server, p4d-record-pressed, p4d-tier1-walked, p4-target,
p4-tour-verified, review-pantry-preview-proxy#next-piece,
review-pantry-preview-proxy#prefix-name, tours-walked, answer-log-home]

$ bash -n tools/review-gate.sh && echo "syntax ok"
syntax ok

$ # the seven-case self-test, run against the portfolio tree, marker cleared between groups
=== T1 baseline silent ===
0
=== T2 first phase ticked ===
a phase closed: plans/pantry-review-layer.md — **PX. first selftest phase.**
=== T3 repeat silent ===
0
=== T4 SECOND, different phase ticked (the regression the reviewer found) ===
a phase closed: plans/pantry-review-layer.md — **PY. second selftest phase.**
=== T5 prose quoting - [x] mid-sentence must NOT fire ===
0
=== T6 run report still works ===
a run report: artifacts/runs/2026-08-10-gate-selftest.md
=== T7 restored silent ===
0
EXIT=0

$ CLAUDE_PROJECT_DIR=$PWD bash tools/review-gate.sh   # against the committed tree

lint gate: level. 494 flag(s) total (oxlint + voice-lint), matching or under the 494 in tools/lint-baseline.json (generated 2026-08-10).
EXIT_CODE=0
```

An earlier state of the tree, before the staged-deletion fix, printed the nudge here instead of
staying silent. That is the T1 case above and it is the reason T1 exists.

```
$ cd pantry && bun cli.ts doctor    # this report on disk
[ok  ] CLAUDE.md present: found
[ok  ] AGENTS.md symlink: symlink to CLAUDE.md
[ok  ] forked standards: none — standards referenced by URL
[ok  ] plans/ present: /Users/tjakoenstolk/Local/Development/bread-repos/pantry/plans
[ok  ] pantry.config present: found
[info] audit freshness: no AUDIT.md runbook in this repo
[warn] graphify freshness: graph built from c4f86611, code moved since — run graphify update .
[warn] e2e suite present: no e2e suite — the mechanical gate can't run end-to-end
[ok  ] doc links resolve: 19 pages, 0 problems
[info] doc symbols resolve: 19 pages, 7 unresolved identifiers (merged estate graph)
[warn] layer pins current: 3 behind: grain 0.1.12<0.1.19, mill 0.2.0<0.2.1, proof 0.1.2<0.1.3 — run deps:refresh
[info] skills mounted: standards package has no skill-shaped standards (pin predates when: keys) — /Users/tjakoenstolk/Local/Development/bread-repos/pantry/node_modules/tjakoen.github.io/standards
[warn] run ledger: 2 of 15 run reports missing evidence: 2026-08-07-s3b-run-ledger (touched outside the declared scope: app.ts, app.test.ts, drift.test.ts, init.test.ts, retrieval.test.ts, skills.test.ts), 2026-08-07-s4-graphify-symbol-drift (touched outside the declared scope: app.ts, app.test.ts, init.test.ts, retrieval.test.ts, skills.test.ts)
[info] answer log: no answer log yet — one appears at /Users/tjakoenstolk/Local/Development/bread-repos/pantry/plans/decisions/answers.jsonl the first time a question is answered (DECISIONS §4)
[info] scope growth vs the graph: 11 growth files across 2 reports, all inside the declared scope's blast radius — ask the graph before declaring
15 checks, 0 failing, 4 due
OK
$ echo EXIT_CODE=$?
EXIT_CODE=0

$ bun cli.ts doctor    # second pass, diffed against the first
IDENTICAL
$ echo EXIT_CODE=$?
EXIT_CODE=0
```

**Accepted, and read from the right line.** The run count moved 14 to 15, so doctor found this
report, and the two named gaps are the same two pre-existing ones from before it existed. The
process exit code proves nothing here, since a run-ledger gap is a `warn` and doctor exits 0 either
way. Unlike the simulation, this report was accepted on its first pass, because the simulation is
what turned `## Gate output` from a convention somebody could guess wrong into a thing written down
in the handoff.

## What was NOT done

- **Nothing was pushed.** 3 unpushed in the portfolio and 4 in pantry, and the push is the owner's
  call, named as blocked in the handoff this run started from. It was not re-asked.
- **P4e did not move, and no phase of `plans/pantry-review-layer.md` moved.** The attribute diff for
  ph-live is handed over rather than applied, on the owner's own instruction, and the answer log
  still records that the Tier 1 tour has never been walked by a human and PANTRY's Record button has
  never been pressed. Both are the owner's to change. No new phase was invented for this work either,
  because a Stop-hook nudge is not a phase of the review layer.
- **The plan's two remaining open questions were not answered.** Whether a forced theme should reach
  a GRAIN target, and whether a review can be walked against a deployed URL. Both are still genuinely
  undecided and neither is a session's to decide.
- **The nudge was not added to the machine-level guard.** `~/.claude/tools/session-guard.sh` already
  says whether a tree is durable enough to hand off, and it fires for every repo, but only once the
  context reading crosses its warn line. This nudge fires on a closed session regardless of how much
  window is left, which is the complementary half. Whether the two should merge is a real question
  and it was not answered, because the instruction named this file.
- **No source code in pantry was read for defects or changed.** The only pantry file this run wrote
  is this report.
- **The thing the watch was actually for was NOT measured.** The question was whether a session,
  told nothing, would run `/handoff` on being nudged. The nudge never fired, so the answer is still
  unknown. What got measured instead is that the trigger was wrong, which is more useful and is not
  the same result. The next session that closes a phase with the fixed gate in place is the real
  test, and it has not happened yet.
- **The 30-commit bound was not removed.** A close that scrolls past it is never nudged, which the
  second reviewer raised and which stands as a known hole. Raising the number trades one arbitrary
  bound for another; the actual fix is the owner's push.
- **The sibling session's own work was not reviewed.** It concluded no other repo earns the harness
  section, ticked its box and wrote its own report. That verdict was read as a subject of this
  watch, not audited as a result.

## What needs human eyes

- **This gate only sees the portfolio.** A session whose run report lands in
  `pantry/artifacts/runs/`, as this one's does, gets no nudge from it, because the hook runs against
  `CLAUDE_PROJECT_DIR` and that is the portfolio. The plan trigger covers most cross-repo work by
  accident of the plans board living here, and that is a real coverage gap rather than a designed
  boundary. The honest fix is the machine-level guard, which is the item above.
- **Whether the nudge should ever mention the durability blockers itself.** Today it points at
  session-guard for that, which means a session that is nowhere near its context limit is told a
  handoff is owed without being told the tree is dirty. Two prints from two files at one turn end is
  either separation of concerns or a thing nobody reads, and only watching it for a week will say
  which.
- **The unresolved element-crop PNG size question from the simulation report** is untouched here and
  still open.
- **The pre-existing dirty state in the portfolio** (`artifacts/runs/2026-08-09-conformance-and-handover.md`
  staged deleted, `artifacts/runs/` untracked) was left exactly as found, on instruction. It belongs
  to another session and is still sitting there.
