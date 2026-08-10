---
title: The 883 pixels the catalog grew, attributed to the line
date: 2026-08-10
status: complete
branch: main
scope:
  - tjakoen.github.io (read-only diagnosis, no code change)
  - pantry/artifacts/runs
touched:
  - pantry/artifacts/runs/2026-08-10-catalog-baseline-drift.md
plans:
  - none. This is a bounded diagnosis of a red visual gate, not a phase of any plan. Nothing
    on plans/ was claimed or moved.
gates:
  - bunx playwright test e2e/visual.e2e.ts -g "catalog" (portfolio) | 1 failed, see Gate output
  - measured /catalog at HEAD, 1280 viewport, fonts settled | 67922px
  - measured /catalog at fe83420 (the tree the baseline was blessed from) | 67039px, exactly the
    committed PNG's height
  - per-section attribution, both trees, 88 vs 87 ids | 70 + 813 = 883, no residue
  - bun cli.ts doctor (pantry, before this report) | 15 checks, 0 failing, 4 due, exit 0, 19 reports
  - bun cli.ts doctor (pantry, this report present) | see Gate output
diffstat: no change to the portfolio. 1 file added in pantry (this report). Two throwaway
  measurement scripts were written into the portfolio root and deleted; `git status` is byte-identical
  before and after this run.
dirty:
  - tjakoen.github.io/artifacts/runs/2026-08-09-conformance-and-handover.md | staged as deleted,
    pre-existing at session start, another session's, left exactly as found on instruction
  - tjakoen.github.io/artifacts/runs/ | untracked, contains only the file above, pre-existing,
    not touched by this run
unpushed: 12 | tjakoen.github.io 1, pantry 11 (one is this report, committed here by pathspec).
  Nothing was pushed; the push is the owner's call and was named as blocked before this run started.
  It was not re-asked.
verifiedBy: reproduction rather than a second reader. The claim is not an argument about which commit
  looks suspicious, it is a measurement: the baseline tree was re-rendered and printed 67039, the
  exact height of the committed PNG, and the per-section diff against HEAD adds to 883 with nothing
  left over. No subagent was spawned to re-read it, because the run was told not to; the two commands
  in Gate output reproduce the whole finding from a clean tree.
doctor: pantry against itself, 15 checks, 0 failing, 4 due, exit 0. The run-ledger count moved 19 to
  20, so this report was seen, and it is not among the two named gaps.
---

## What this was

`bunx playwright test e2e/visual.e2e.ts -g "catalog"` was red and nobody knew why. It reports as a
screenshot timeout, which is misleading: Playwright retries a size mismatch until the 5s expect
timeout runs out, so the *last* line is a timeout and the *real* line is three above it. The page is
1280x67922 and the committed baseline is 1280x67039. 883px the page grew and the baseline did not.

The ask was to find the cause, name it with a file and line, and recommend re-bless or fix without
doing either. No portfolio file was changed.

## The method, since it is what makes the answer exact

Guessing from `git log` gets you a shortlist, not an attribution. Instead the baseline tree was
re-rendered and measured:

```
git archive fe83420 | tar -x -C /tmp/cat-base
ln -s <portfolio>/node_modules /tmp/cat-base/node_modules
PORT=3132 bun src/server.ts    # from /tmp/cat-base
```

`fe83420` is the commit that last wrote `catalog-darwin.png`. That tree printed **67039**, the
committed baseline's height to the pixel, which is the check that makes everything after it
trustworthy: the measurement rig reproduces the baseline before it is asked to explain the drift.

The symlinked `node_modules` is the load-bearing part of the setup. It means the old tree ran against
**today's** packages, so any height difference is the app's own changes with the package bump held
constant. That is what rules out the grain pin below.

Both trees were then measured section by section, at 1280 wide with `document.fonts.ready` awaited,
matching what the spec does.

## The finding

**Two changes, and together they are exactly 883px. There is no third contributor and no residue.**

| | baseline (fe83420) | HEAD | delta |
|---|---|---|---|
| `SECTION#feed-card-portfolio` | 975px | 1045px | **+70** |
| `SECTION#share-block-portfolio` | absent | 781px + 32px gap | **+813** |
| page total | 67039px | 67922px | **+883** |

**1. A new component.** `view/components/molecules/share-block/share-block.md` (38 lines, new file),
added by `3a92d51` "feat: the first real feed post, and the copy to share it" on 08-09 19:58. /catalog
is generated from every `.md` under the component roots, so a new documented molecule is a new entry
between `profile-card` and `shot`. 781px of entry plus the 32px inter-section gap.

**2. Six lines of prose in an existing doc.** `view/components/molecules/feed-card/feed-card.md:11`
(a new paragraph about the per-kind colour stripe) and `:17` (two sentences about the filter tabs
setting `hidden`), added by `c359d35` "feat: filter the feed, and colour what kind of thing it is" on
08-09 23:09. The catalog renders the doc body, so doc prose is page height. 70px.

Nothing else in the catalog moved. The 88 vs 87 ids differ by exactly one, `share-block-portfolio`.

**The grain pin is ruled out, not merely doubted.** `c9f5a30` took grain 0.1.18 to 0.1.19 on 08-10
00:09, after the baseline, so it was a fair suspect. It contributed **0px**, by two independent
readings. Measured: the baseline tree ran against grain 0.1.19 and still printed 67039. Read at the
source: everything between the two tags is `packages/grain/styles/lightbox.css` (`851d8c5`, a portrait
letterboxing fix) plus the version bump. No component gained, no `.md` touched, and the lightbox is a
hidden overlay that contributes no page height.

**The coincidence worth writing down, because it is a trap.** `SECTION#drawer` is **883px** tall, the
same number as the drift, and it sits mid-page with two zero-height `#new-client` nodes inside it that
look like the live-panel bug this catalog has had before. It is identical in both trees and it is not
involved. A drawer-shaped answer would have been wrong, confidently, with a matching number to wave
at. That is the whole reason the baseline tree was re-rendered rather than reasoned about.

## The recommendation

**Re-bless the baseline. The growth is legitimate. This run did not re-bless it — that call is the
owner's.**

Both contributors are deliberate content, not layout damage:

- `share-block` is a real molecule with a real doc, opt-in per event, and it belongs in a catalog whose
  job is to document every component. Excluding it would make the catalog lie about what the repo has.
- The `feed-card` paragraphs describe behaviour that shipped in the same commit. Removing prose to
  keep a screenshot the same size is the tail wagging the dog.

Neither entry renders broken: `share-block-portfolio` is a normal 781px entry in sequence, and the
`feed-card-portfolio` growth is text reflow with no shift to any neighbour. Every other section is
byte-for-byte the same height in both trees.

The command, for whoever makes the call:

```
bunx playwright test e2e/visual.e2e.ts -g "catalog" --update-snapshots
```

## Gate output

```
$ bunx playwright test e2e/visual.e2e.ts -g "catalog"

      - waiting for fonts to load...
      - fonts loaded
      - Expected an image 1280px by 67039px, received 1280px by 67922px.
      - waiting 100ms before taking screenshot
      - Timeout 5000ms exceeded.


      55 |     await page.goto(path, { waitUntil: "networkidle" });
      56 |     await page.evaluate(() => document.fonts.ready);   // no FOUC frame in the baseline
    > 57 |     await expect(page).toHaveScreenshot(`${name}.png`, SHOT);
         |                        ^
      58 |   });
      59 | }
      60 |
        at <portfolio>/e2e/visual.e2e.ts:57:24

    attachment #1: catalog (image/png) ──────────────────────────────────────────────────────────
    Expected: e2e/visual.e2e.ts-snapshots/catalog-darwin.png
    Received: test-results/visual.e2e.ts-catalog-catalog-matches-its-visual-baseline/catalog-actual.png
    Diff:     test-results/visual.e2e.ts-catalog-catalog-matches-its-visual-baseline/catalog-diff.png
    ──────────────────────────────────────────────────────────────────────────────────────────────

  1 failed
    e2e/visual.e2e.ts:53:3 › catalog (/catalog) matches its visual baseline ──────────────────────
```

The two measurements, same script against two servers (HEAD on 3131, `fe83420` on 3132), trimmed to
the lines that carry the finding:

```
$ bun measure.ts    # HEAD
PAGE HEIGHT 67922 BODY 67922
N ids 88
 24227  h= 1045  SECTION#feed-card-portfolio
 36452  h=  781  SECTION#share-block-portfolio
 37266  h=  702  SECTION#shot-portfolio
 54620  h=  883  SECTION#drawer

$ bun measure.ts    # fe83420, same node_modules
PAGE HEIGHT 67039 BODY 67039
N ids 87
 24227  h=  975  SECTION#feed-card-portfolio
 36383  h=  702  SECTION#shot-portfolio
 53737  h=  883  SECTION#drawer
```

`67039` is the committed PNG's height, so the rig reproduces the baseline exactly before it is
believed about anything else. `share-block-portfolio` is absent from the second listing; `shot` sits
directly after `profile-card` there.

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
[info] skills mounted: standards package has no skill-shaped standards (pin predates when: keys)
[warn] run ledger: 2 of 20 run reports missing evidence: 2026-08-07-s3b-run-ledger (touched outside the declared scope: app.ts, app.test.ts, drift.test.ts, init.test.ts, retrieval.test.ts, skills.test.ts), 2026-08-07-s4-graphify-symbol-drift (touched outside the declared scope: app.ts, app.test.ts, init.test.ts, retrieval.test.ts, skills.test.ts)
[info] answer log: no answer log yet — one appears at plans/decisions/answers.jsonl the first time a question is answered (DECISIONS §4)
[info] scope growth vs the graph: 11 growth files across 2 reports, all inside the declared scope's blast radius — ask the graph before declaring
15 checks, 0 failing, 4 due
OK
$ echo EXIT_CODE=$?
EXIT_CODE=0
```

Read from the right line: the run-ledger count moved **19 to 20**, so doctor found this report, and
the two named gaps are the same two pre-existing ones from before it existed. The exit code proves
little on its own, since a run-ledger gap is a `warn` and doctor exits 0 either way.

## What was NOT done

- **The baseline was not re-blessed.** That was the instruction and it is the right call anyway: a
  re-bless is a claim that 67922 is the correct height, and the owner owns that claim. The command is
  in the recommendation above.
- **Nothing was pushed, and nothing was committed in the portfolio.** There was nothing to commit —
  the diagnosis changed no portfolio file. The 1 unpushed portfolio commit and the 11 in pantry are
  the owner's to push.
- **The other eight visual baselines were not run.** The spec covers welcome, grain, batch, about,
  resume, notes, calendar and mail, and only `-g "catalog"` was run because that was the bounded task.
  Some of them may well be red for their own reasons; this run does not know and does not claim.
- **No fix was attempted, because the finding is that there is nothing to fix.** No CSS was touched,
  no component was excluded from the catalog, no doc prose was trimmed.
- **The `SECTION#drawer` zero-height `#new-client` nodes were not investigated.** They are identical
  in both trees, so they predate the drift and are outside this task. They may be nothing; the catalog
  has had a live-panel bug in this shape before, which is the only reason they are mentioned at all.
- **No dev tour was written.** Nothing renders differently as a result of this run. The change to the
  rendered page is the two commits that already shipped, and each of those is another session's to
  account for.
- **No cold second reader.** The run was told not to spawn one. The mitigation is that the finding is
  a reproduction rather than an argument: two commands and a subtraction.

## What needs human eyes

- **The re-bless call itself.** The recommendation is to bless, and the evidence for it is above, but
  a visual baseline exists precisely so a person looks at the pixels before agreeing they are correct.
  The diff PNG is at `test-results/visual.e2e.ts-catalog-catalog-matches-its-visual-baseline/`.
- **Whether a 67922px full-page baseline is still the right instrument.** A 2.3MB PNG that grows every
  time a component doc gains a paragraph will go red on prose edits forever, and each red costs a
  session like this one. Two options exist and neither is a session's to pick: pin per-section crops
  instead of the whole page, or accept that /catalog re-blesses routinely and stop treating its red as
  a signal. Related to the unresolved element-crop PNG size question in the 2026-08-10 loop simulation
  report.
- **Whether `share-block` belongs in the catalog at all** is worth one moment of the owner's thought,
  not because the answer is no, but because its own doc says it is rendered by `shellChrome`
  (`src/content.ts`, `renderShareBlock`) rather than bound as a component. It is documented like a
  molecule and rendered like page chrome. The catalog is right to show it; the divergence is the kind
  of thing that is cheap to notice now and confusing in six months.
- **The pre-existing dirty state in the portfolio** (`artifacts/runs/2026-08-09-conformance-and-handover.md`
  staged deleted, `artifacts/runs/` untracked) was left exactly as found, on instruction. It belongs to
  another session and is still sitting there.
