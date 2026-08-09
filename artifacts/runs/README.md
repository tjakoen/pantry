# The run ledger

This folder is PANTRY's run ledger (piece 11c). A run closes by writing one markdown file here, and
that file is the evidence the run happened the way it says it did. LOOP.md §4a states the contract in
prose; [LOOP.md §9](https://tjakoen.github.io/standards/loop) turns it into a nine-item checklist, and
this folder is that checklist made parseable.

PANTRY runs no model and writes nothing here. It parses these files and reports which §9 items each one
is missing, as a `run ledger` warn in `pantry doctor`. The agent writes the report; the check only says
what is absent.

This `README.md` is documentation, not a run: the ledger skips it. Real reports are the other `*.md`
files here, named `<date>-<slug>.md`.

## The file shape

The frontmatter uses only what MILL's parser understands (scalars + dash-lists, no nested objects), so
an entry needing two fields uses the `label | detail` pipe convention the decision inbox established:

````markdown
---
title: Pin the run-ledger schema
date: 2026-08-07
status: complete                # complete | partial | blocked (default: complete)
lane: gated                     # LOOP §4b lane: high | gated | human (optional)
branch: main
scope:                          # the envelope this run declared before it started (§4b)
  - runs.ts
  - doctor.ts
touched:                        # what it actually touched
  - runs.ts
  - doctor.ts
skills:                         # which skills fired during the run
  - loop-standard
plans:                          # plan items claimed | optional href
  - skills-runtime | /plans/skills-runtime
gates:                          # "command | result"; the OUTPUT goes in the body, verbatim
  - bun test | 212 pass, 3 fail (pre-existing)
  - tsc --noEmit | clean
diffstat: 4 files changed, 210 insertions(+), 3 deletions(-)
dirty:                          # touched but deliberately left uncommitted | why
  - PLAN.md | lands with the next commit
unpushed: 2 | push is owner-gated
verifiedBy: a reviewer that did not write the change
doctor: 0 failing, 1 carried: e2e-presence
---
## Gate output

```
132 pass
0 fail
```

## What was not done

## What needs human eyes
````

The three body headings are required, and the checker matches them loosely (case, punctuation and
heading level are all free). `Gate output` must contain a fenced block with something in it.

## What the check looks for

One gap per §9 item, each one absent-or-present, never a judgement call:

| §9 item | Where it lives | Gap id |
|---|---|---|
| Gate output pasted verbatim | a fenced block under `## Gate output` | `gate-output` |
| Diffstat | `diffstat:` | `diffstat` |
| What was not done | `## What was not done`, non-empty | `not-done` |
| What needs human eyes | `## What needs human eyes`, non-empty | `human-eyes` |
| Every touched file accounted for | `touched:` | `touched` |
| Unpushed commits counted, with a reason | `unpushed: N \| why` | `unpushed` |
| Second pass by someone who did not write it | `verifiedBy:` | `verified-by` |
| Declared scope vs what was touched | `scope:` | `scope`, `scope-growth` |
| Doctor run, flags fixed or carried by name | `doctor:` | `doctor` |

`scope-growth` is the one that computes rather than looks up: a `touched:` path outside every `scope:`
entry is growth past the declared envelope, which LOOP.md §4b calls an ask-trigger. Until now that cap
was a promise with nothing measuring it.

`lane:` is not one of the nine and is not checked. It records which of LOOP §4b's three lanes the
change was run in — `high` when a gate would catch it going wrong, `gated` when the blast radius is
real but walkable-back, `human` when it touches an irreversible path. The lane is decided before the
work and written down after it, so it is evidence rather than a claim made in chat. A value that is
not one of the three reads as absent: there is no safe default, and reading a typo as `high` is the
widening §4b exists to prevent.

## Two rules the schema carries

- **Gate output is verbatim.** Not "tests pass" — the output. A report that summarizes its gates has
  no gate evidence, and the check says so.
- **Never compress it.** A lossy pass over machine output mangled a date in testing (`2026-07-30` came
  back as `2026:7:30`), so summarizing or compressing gate output into a report is out, not
  discouraged.

## Where reports go

Under `artifacts/`, alongside the screenshots and diffs a run already deposits, so a report links its
evidence with a relative path and no new tracked dir appears. Override with `runsDir` in
`pantry.config.json` if a host wants them elsewhere.
