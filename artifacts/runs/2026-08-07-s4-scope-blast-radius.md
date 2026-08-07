---
title: S4 — make the scope cap answerable before the work, not after
date: 2026-08-07
status: complete
branch: main
scope:
  - graph.ts
  - doctor.ts
  - cli.ts
  - graph.test.ts
  - doctor.test.ts
  - plans/skills-runtime.md
  - artifacts/runs
touched:
  - graph.ts
  - doctor.ts
  - cli.ts
  - graph.test.ts
  - doctor.test.ts
  - plans/skills-runtime.md
  - artifacts/runs/2026-08-07-s4-scope-blast-radius.md
skills:
  - graph
  - loop-standard
plans:
  - skills-runtime S4 | https://tjakoen.github.io/plans/plan/skills-runtime
gates:
  - bun test | 290 pass, 3 fail (the 3 pre-existing)
  - tsc --noEmit | clean
  - bun cli.ts doctor | 14 checks, 0 failing, 3 due
  - traversal agreement | affectedBy matches `graphify affected` exactly on 8 seeds, including the 22-file config.ts case
  - mutation check | reverting the graph choice to config.graphPath fails 2 of the new doctor tests
diffstat: 5 files changed, 425 insertions(+), 3 deletions(-); graph.ts now 408 lines
dirty:
  - every file above | uncommitted at the time of writing; the commit follows this report
unpushed: 14 | 10 portfolio + 4 pantry, plus this session's two; owner-gated, still blocks the skills rollout
verifiedBy: an independent reviewer not handed the claim (1 finding, reproduced, fixed), the traversal against the real graphify binary, and a mutation check
doctor: 0 failing, 3 due by name — e2e-presence, deps-drift, run ledger (carried scope growth from earlier reports)
---
## What this run did

Closed S4's `touches:` item, but **not with the check the item specified**. The specified rule was
measured first and rejected on its own numbers, which is the whole substance of this run.

**The rejected rule.** "Flag a plan whose declared touches are narrower than the blast radius." The
radius of a single `config.ts` is 22 of pantry's files, and 12 of them went untouched in the very run
that declared it. A rule demanding scope cover radius would require declaring the whole repo every
time, which makes a declaration worth nothing. It also aimed at the wrong artifact: plan `touches:` is
directory-level (`standards/`, `../pantry/`), while the thing carrying a real file list is the run
report's `scope:` from S3b.

**What the numbers did support.** Across all three run reports on disk: **11 of 11 files that grew past
a declared scope were already connected to that scope in the graph. Zero surprises.** So the useful
question is not "did you declare the whole radius" but "when you grew, could the graph have told you up
front". On every piece of evidence available, yes, and the answer was one query away both times.

That became two pieces: `pantry scope <file...>`, the pre-flight query, which is where the leverage
actually is; and a `scope-radius` info check that splits each report's growth into predictable and
surprising. The check reports 11 predictable and 0 surprising, which is the honest state rather than a
bug — it is a guarantee being verified, not an alarm waiting to go off.

**The traversal is in-process, and was verified before it was trusted.** `graphify affected` is a
reverse walk over the dependency relations; doctor runs it once per scope file per report, so a
subprocess each time is far too slow for something that fires at session start. Reimplemented over
`graph.json` and checked against the real binary on 8 seeds first: exact match on every one, including
the 22-file `config.ts` case. `contains` is deliberately not traversed, since walking it in reverse
reports a file as affected by its own symbol.

**The defect this run found in itself.** The two graph-backed checks want OPPOSITE artifacts. The
symbol lint wants the WIDEST graph, because a portfolio doc may name any sibling repo's symbol. A blast
radius wants the NARROWEST, because a run report's scope names files in this repo. Both read
`config.graphPath`, which prefers the merged graph — so on its first live run the radius check reported
every local file as "outside any blast radius", and `pantry scope` printed sibling-repo symbols like
`formatReport()` beside pantry's own files. Both call sites now name their graph explicitly, and
reverting either one fails a test.

**A second defect, found by review and reproduced against the live graph.** `affectedBy` matches seeds
by node label, and a label can sit on more than one node: `isoDay()` is both `app.ts:L541` and
`timeline.ts:L103`, and 19 labels collide in pantry alone. Seeding one of them unioned two unrelated
radii while the output read "1 known to the graph", so the answer looked precise when it was a merge.
The union itself is the only defensible behaviour when we cannot know which was meant; the silence was
the bug. Collisions are now named with their locations, and the line stays quiet when there is no
ambiguity.

## Gate output

```
$ bunx tsc --noEmit
(clean, no output)

$ bun test
 290 pass
 3 fail
 736 expect() calls
Ran 293 tests across 13 files. [910.00ms]

$ bun cli.ts scope drift.ts config.ts
seeds (2 known to the graph): drift.ts, config.ts
blast radius (21): app.test.ts, app.ts, artifacts.test.ts, artifacts.ts, cli.ts, decisions.test.ts,
decisions.ts, doctor.test.ts, doctor.ts, drift.test.ts, init.test.ts, init.ts, retrieval.test.ts,
retrieval.ts, runs.test.ts, runs.ts, shots.ts, skills.test.ts, skills.ts, timeline.test.ts, timeline.ts
declare a scope that covers what you intend to touch, not the whole radius

$ bun cli.ts doctor
[info] scope growth vs the graph: 11 growth files across 2 reports, all inside the declared
       scope's blast radius — ask the graph before declaring
14 checks, 0 failing, 3 due
```

The 3 test failures are the pre-existing `buildKnowledge`, `renderLlmsTxt` and `pantry cockpit
surfaces`, unchanged.

**This report's scope held.** Declared seven entries, touched seven. The previous two reports both grew,
which is what supplied the data above; this one used `pantry scope` before declaring.

## What was not done

Three S4 items remain open and none was started: `undocumented-export` (info), HACKING.md route-map
verification, and wiring `save-result`. `graphify reflect` was noticed while reading `--help` and is
not in the plan at all; it aggregates `graphify-out/memory/` into a lessons doc, so it only becomes
meaningful once `save-result` is wired, and it should be considered alongside it rather than separately.

The three dead symbols in `docs/batch/ARCHITECTURE.md` are still unfixed, for the same reason as before.

## What needs human eyes

- **Nothing is pushed.** 10 portfolio and 4 pantry commits ahead before this session's two.
- **`pantry scope` has no home in the loop yet.** It is the pre-flight query that would have prevented
  the last two scope overruns, but nothing tells a session to run it. That is a LOOP.md or
  SESSION-LOOP.md edit, i.e. canon prose, which is the owner's call and not something to slip in here.
- **`scope-radius` reports 0 surprising and may always.** If it still reads 0 after another ten run
  reports, the honest move is to delete the check and keep only `pantry scope`. Worth revisiting rather
  than letting a permanently-silent check accumulate.
- **Where the estate graph should live** is still open from the previous run.
