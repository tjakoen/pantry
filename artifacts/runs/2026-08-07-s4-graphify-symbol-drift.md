---
title: S4 — ask the graph a question instead of checking its age
date: 2026-08-07
status: partial
branch: main
scope:
  - drift.ts
  - doctor.ts
  - config.ts
  - graph.ts
  - cli.ts
  - drift.test.ts
  - doctor.test.ts
  - graph.test.ts
  - plans/skills-runtime.md
  - artifacts/runs
touched:
  - drift.ts
  - doctor.ts
  - config.ts
  - graph.ts
  - cli.ts
  - drift.test.ts
  - doctor.test.ts
  - graph.test.ts
  - plans/skills-runtime.md
  - artifacts/runs/2026-08-07-s4-graphify-symbol-drift.md
  - app.ts
  - app.test.ts
  - init.test.ts
  - retrieval.test.ts
  - skills.test.ts
skills:
  - graph
  - loop-standard
plans:
  - skills-runtime S4 | https://tjakoen.github.io/plans/plan/skills-runtime
gates:
  - bun test | 274 pass, 3 fail (the 3 pre-existing, confirmed by stashing the whole diff and re-running)
  - tsc --noEmit | clean
  - bun cli.ts doctor (pantry) | 13 checks, 0 failing, 3 due
  - bun ../pantry/cli.ts doctor (portfolio) | graphify freshness ok, doc-symbol-drift 7 on 24 pages
  - mutation check | disabling the stale-merge short-circuit fails 2 of its 5 tests; restoring it passes them
diffstat: 11 files changed, 630 insertions(+), 19 deletions(-), plus graph.ts (251) + graph.test.ts (229) untracked; portfolio plans/skills-runtime.md 91 insertions(+), 13 deletions(-)
dirty:
  - every file above | uncommitted at the time of writing; the commit follows this report
unpushed: 12 | 9 portfolio + 3 pantry; pushing is owner-gated and still blocks the estate-wide skills rollout
verifiedBy: two independent reviewer subagents, neither handed the claim — one on correctness (1 finding, reproduced, fixed), one on whether the prose matches the code (no findings, every number re-derived)
doctor: 0 failing, 3 due by name — e2e-presence (no e2e suite in pantry), deps-drift (layer pins behind), run ledger (the S3b report's scope growth, carried)
---
## What this run did

Three of S4's six items. `doctor` now asks the graph a question instead of checking its age, `drift.ts`
lints symbols as well as links, and `pantry graph merge` produces the estate-wide graph the symbol lint
needs to be worth reading.

**The measurement came before the code, and it changed the design three times.** The severity call was
left open pending a false-positive rate, so the rate was produced first, by a throwaway probe over the
portfolio's docs. It killed the path-ref half of the item outright (14% flagged, and the flags were
dominated by references that are *correct*: backlogged notes, generated artifacts, route payloads). It
promoted `merge-graphs` from "lower priority" to a prerequisite, because the portfolio's own graph
flagged 73.5% of spans where the merged one flagged 26.5%. And it showed the 2026-07-30 extraction hang
is specific to large foreign trees: our own five repos re-extracted in 2 to 4 seconds each.

**Three defects, and the way each was caught is the point.**

The first was mine. The new commit-comparison check flagged the portfolio on its first live run, and it
was wrong to: the only churn since the graph was built was one markdown file, and GRAPH.md §4 says the
refresh re-extracts *code*. The check now diffs `builtFrom..HEAD` and warns only when something outside
prose, images and lockfiles moved. An unreachable built-from commit warns rather than passes, because
failing to verify is not the same as verifying.

The second was in `graph.ts`: the 120s timeout guard never cleared its timer, so a merge that finished
in half a second still held Bun's event loop for the remaining two minutes. The CLI happened to survive
it by calling `process.exit`; nothing else would have. Cleared on every path now.

The third came from review, and it is the one worth keeping. `GRAPH_REPORT.md` describes `graph.json`
— the extraction — while `resolveGraphPath` *prefers* `merged-graph.json`, a separate artifact no
report describes. So the new commit check could pass honestly about a file nothing reads, while the
symbol lint and `/map` read the stale merged graph beside it. The same lie the mtime check was telling,
moved one artifact over, and **live in the portfolio within minutes of the merge command existing**:
the edit hook re-extracted `graph.json` at 16:13 and the 16:10 merged graph went on being served under
a clean "built from HEAD". A merge older than the extraction it should have included now warns.

**A test was passing for the wrong reason.** Two of the freshness tests used a git mock that ignored its
arguments and returned one fixed string for every call, and asserted only on a substring that two
different branches share. They would have passed identically whichever branch ran. The mock now
dispatches on `args[0]` and each test names the branch it exercises.

**The review round itself is worth recording,** because the last one on this codebase produced six
findings and every one was a false positive. This time two reviewers ran, neither handed the claim,
each asked for a concrete failure scenario and an attempt to refute its own finding before reporting.
One returned "no findings" and said so plainly after re-deriving every number in the plan doc; the
other returned exactly one, and had already reproduced it against a temp fixture. Asking for a
reproduction rather than an opinion is what changed.

**The new tests were verified against the defect, not just against green.** Disabling the stale-merge
short-circuit makes two of the five fail; restoring it makes them pass. They test the fix rather than
the code around it.

## Gate output

```
$ bunx tsc --noEmit
(clean, no output)

$ bun test
 274 pass
 3 fail
 704 expect() calls
Ran 277 tests across 13 files. [921.00ms]
```

The 3 failures are pre-existing (`buildKnowledge`, `renderLlmsTxt`, `pantry cockpit surfaces`),
confirmed by stashing the entire diff and re-running: 232 pass / the same 3 fail on a clean tree.

```
$ bun cli.ts graph merge
siblings root: /Users/tjakoenstolk/Local/Development/bread-repos
repos found (7): batch, bread, grain, greenroom, pantry, project, tjakoen.github.io
merged -> 4735 nodes, 7571 edges
written to .../pantry/graphify-out/merged-graph.json
OK

$ bun ../pantry/cli.ts doctor        # from the portfolio
[ok  ] graphify freshness: graph built from HEAD (c547efa2)
[info] doc symbols resolve: 24 pages, 7 unresolved identifiers (merged estate graph)
```

The end-to-end payoff, in one line: 18 unresolved identifiers against the portfolio's own graph, 7
against the estate graph.

## What was not done

Three of S4's six items are still open, deliberately, and none was started: `touches:` verification via
`graphify affected`, `undocumented-export` (info), HACKING.md route-map verification, and wiring
`save-result`. The owner scoped this session to the three that landed.

The first real drift the lint found is also **left unfixed**: `docs/batch/ARCHITECTURE.md` names
`formFields()`, `jsonBody()` and `escHtml()`, none of which exists anywhere in the estate. Fixing that
prose needs someone who knows what those three became; it is logged in the plan as a content chore
rather than guessed at here.

Scope grew by five files beyond what was declared: `app.ts` and four `*.test.ts` files needed the new
`graphDir` config field added to their config literals. Mechanical, but real, and named here rather
than absorbed silently.

## What needs human eyes

- **Nothing is pushed.** 9 portfolio commits and 3 pantry commits ahead, and this session adds to both.
  Pushing is owner-gated and it is still what blocks the estate-wide skills rollout.
- **`doc-symbol-drift` severity.** Shipped at `info` on the owner's call against a measured 56%
  precision; the shipped check's own footing puts it at 43% (7 flags, 3 real). Info was already the
  floor so the call stands, but the number that justified it is now a worse number and the owner should
  know that.
- **The three dead symbols in `docs/batch/ARCHITECTURE.md`** need someone who knows batch's current
  shape.
- **Where the estate graph should live.** `pantry graph merge` writes it under whichever host root you
  run it from, which means it can be produced twice with no single owner. The plan's original question
  (bread renders it, or pantry owns it) is still open; this run answered "how", not "whose".
