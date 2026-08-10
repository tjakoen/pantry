---
title: The harness section, checked against the six repos that did not earn it
date: 2026-08-10
status: complete
branch: main
scope:
  - tjakoen.github.io/plans
  - pantry/artifacts/runs
touched:
  - tjakoen.github.io/plans/nimbalyst-in-the-loop.md
  - pantry/artifacts/runs/2026-08-10-harness-section-other-repos.md
plans:
  - tjakoen.github.io/plans/nimbalyst-in-the-loop.md — second-to-last task closed. The other open
    task (whether the automations surface belongs in the loop) is the owner's and was left alone.
gates:
  - bun ../pantry/cli.ts answers (portfolio) | 0 unread, 9 acted-on, nothing to act on
  - read six CLAUDE.md files in full (batch, bread, grain, greenroom, pantry, project) | done
  - nimbalyst gitignore + working-dir presence across all 7 repos | 1 of 7
  - session roots since harness adoption, from ~/.claude/projects | 3 roots, 1 live
  - mcp__nimbalyst tool use in non-portfolio transcripts | 1 session, greenroom, 2026-08-01
  - bun cli.ts doctor (pantry, this report present) | see Gate output
diffstat: 1 file changed, 23 insertions(+), 2 deletions(-) in the portfolio
  (plans/nimbalyst-in-the-loop.md). 1 file added in pantry (this report). No source code was
  read for defects or changed in any repo, and no other repo's CLAUDE.md was edited, which is
  this run's result rather than an omission.
dirty:
  - tjakoen.github.io/artifacts/runs/2026-08-09-conformance-and-handover.md | staged as deleted,
    pre-existing at session start, belongs to another session, left alone on instruction
  - tjakoen.github.io/artifacts/runs/ | untracked, contains only the file above, pre-existing,
    not touched by this run
unpushed: 9 | tjakoen.github.io 4 (one is this run's commit), pantry 5 (one is this report).
  Nothing was pushed; the push is the owner's call and is still open. It was not re-asked.
verifiedBy: the second pass is the transcript evidence, not a reread of the six files. The first
  pass read the CLAUDE.md files and formed a judgement per repo. The second asked a question the
  files cannot answer, which is where sessions actually root, and it changed the conclusion's
  reason: not "the harness is not worth naming there" but "the same work does not happen there".
doctor: pantry against itself, 15 checks, 0 failing, 4 due, exit 0. The run count moved 15 to 16
  and this report is not among the named gaps.
---

## What this was

`plans/nimbalyst-in-the-loop.md` settled on 2026-08-10 that the harness capability goes in canon and
the tool is named once as the example. The portfolio then got a short "What this is worked in"
section naming three consequences: per-session attribution of dirty work, a rendered change shown
rather than described, and `.nimbalyst/` plus `nimbalyst-local/` as gitignored private working
material.

The plan left itself a check with a sharp edge on it: if the harness is worth naming here it is
worth naming where the same work happens, and if it is not worth naming there, this section is
decoration. This run walked the estate to answer it.

## What was found

**No other repo earns the section, and the plan's conditional does not fire, because its antecedent
is false.** The same work does not happen in the other repos.

Six siblings carry a `CLAUDE.md`: batch, bread, grain, greenroom, pantry, project. The other two
directories under `bread-repos/` are `graphify-out/` and `test-results/`, which are outputs and not
repos. All six were read in full.

Reading them was not what settled it. Every one of the six describes a loop, a definition of done
and a set of non-negotiables that a harness has to run, so on the text alone a case can be argued
for any of them. The question the text cannot answer is where a session is actually rooted when that
work happens, and that has a record.

- `.nimbalyst/` and `nimbalyst-local/` exist in exactly one of the seven trees, the portfolio's, and
  exactly one `.gitignore` names them (added 2026-07-25 in 6d5c206, with the directories themselves
  dating from 2026-07-23). A reader of grain's front door will never meet those paths, so the third
  of the three consequences has nothing to attach to in the other six.
- Three roots have ever held sessions: the portfolio (81 transcripts, most recent today), the parent
  `bread-repos/` directory (56, cold since 2026-07-24, which is the week the harness arrived), and
  greenroom (6, last on 2026-08-01). No session has ever rooted in grain, batch, bread, pantry or
  project. Work in those repos happens from a portfolio-rooted session reaching across by relative
  path, which is how this run wrote into pantry.
- Of every transcript outside the portfolio, exactly one shows `mcp__nimbalyst` tool use: a single
  greenroom session on 2026-08-01. The parent root shows none at all.

So per-session attribution of dirty work is a fact about the repo a session roots in, and that is
one repo. The portfolio's section is correctly placed and stays. What the plan's task actually
uncovered is that "where the same work happens" is a smaller set than it assumed.

## The second reason, which would hold even if the roots moved

Four of the six publish. grain and batch ship to npm, pantry installs into somebody else's project
with `bunx`, and greenroom's whole promise is a non-coder opening VS Code and pressing a task button
without typing a command. Naming this estate's editor in those front doors would tell a contributor
about a harness they are not running, which is the caveman and rtk precedent the plan already cites,
applied one level down.

PANTRY makes the point hardest, and it makes it in code rather than in prose. Its capture work in
P4d starts the project itself rather than borrowing a screenshot from the harness, precisely so a
host that runs no Nimbalyst still gets the capability. A section in `pantry/CLAUDE.md` naming the
harness would sit above a codebase built on the assumption that the harness is absent.

greenroom is the near miss and worth naming as one, since it is the only other repo with a
harness-run session. It is also the repo where the section would do the most damage: its stated
operating surface is a VS Code task, chosen for a person who does not type commands, and a second
named editor in the front door is a fork in the road for exactly the reader it was written for.

## Gate output

```
$ bun ../pantry/cli.ts answers
log: /Users/tjakoenstolk/Local/Development/bread-repos/tjakoen.github.io/plans/decisions/answers.jsonl

Nothing unread.

Acted on (9): [p4d-capture-server, p4d-record-pressed, p4d-tier1-walked, p4-target,
p4-tour-verified, review-pantry-preview-proxy#next-piece,
review-pantry-preview-proxy#prefix-name, tours-walked, answer-log-home]

$ for d in batch bread grain greenroom pantry project tjakoen.github.io; do
    grep -i nimbalyst $d/.gitignore; ls -d $d/.nimbalyst $d/nimbalyst-local; done
tjakoen.github.io/.gitignore:16:# Nimbalyst editor state + local plans/session notes — private working material, not site content
tjakoen.github.io/.gitignore:17:.nimbalyst/
tjakoen.github.io/.gitignore:18:nimbalyst-local/
tjakoen.github.io/.nimbalyst
tjakoen.github.io/nimbalyst-local
   (the other six: no gitignore entry, no directory)

$ ls ~/.claude/projects/ | grep bread-repos
-Users-tjakoenstolk-Local-Development-bread-repos                  56 sessions, newest Jul 24
-Users-tjakoenstolk-Local-Development-bread-repos-greenroom         6 sessions, newest Aug  1
-Users-tjakoenstolk-Local-Development-bread-repos-tjakoen-github-io 81 sessions, newest Aug 10

$ grep -l "mcp__nimbalyst" <non-portfolio transcripts>
greenroom/13285631-0cc1-42e0-8937-b1eab76c7b91.jsonl   2026-08-01
   (bread-repos parent root: none)

$ git log --format="%ad %h %s" --date=short -S nimbalyst-local -- .gitignore
2026-07-25 6d5c206 chore: ignore .nimbalyst/ and nimbalyst-local/ editor state
```

```
$ cd pantry && bun cli.ts doctor
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
[warn] layer pins current: 3 behind — run deps:refresh
[info] skills mounted: standards package has no skill-shaped standards (pin predates when: keys)
[warn] run ledger: 2 of 16 run reports missing evidence: 2026-08-07-s3b-run-ledger,
       2026-08-07-s4-graphify-symbol-drift
[info] answer log: no answer log yet
[info] scope growth vs the graph: all inside the declared scope's blast radius
15 checks, 0 failing, 4 due
OK
$ echo EXIT_CODE=$?
EXIT_CODE=0
```

**Read from the right line.** The run count moved 15 to 16, so doctor found this report, and the two
named gaps are the same two pre-existing ones from 2026-08-07. The process exit code proves little
on its own, since a run-ledger gap is a `warn` and doctor exits 0 either way.

## What was NOT done

- **No CLAUDE.md was edited in any of the six repos.** That is this run's result and not a shortfall.
  Both outcomes were live when it started, and the evidence went the other way. Padding the section
  into six front doors would have produced a visible deliverable and made every one of them slightly
  wrong.
- **The portfolio's own section was not touched either.** The plan's conditional pointed at removing
  it if nowhere else earned it, and the reason nowhere else earns it turned out to be that the work
  does not happen there, which leaves the section where it belongs. Deleting it would have been
  acting on the letter of the task against its own finding.
- **The other open task in the plan was left alone.** Whether the automations surface belongs in the
  loop is the owner's call and was not answered, not hinted at, and not reframed.
- **Nothing was pushed.** 4 unpushed in the portfolio and 5 in pantry. The push is the owner's call,
  still open, and was not re-asked.
- **`~/Documents/Programming/edge` was not read, walked or listed.** It is employer work and off
  limits, and it is not part of this estate.
- **`tools/` was not touched.**
- **No source code in any repo was read for defects or changed.**
- **No canon was changed.** LOOP §4b and SESSION-LOOP §5 and §7 already name the harness once each,
  and this run only confirmed that per-repo restatements would be duplicates of those.

## What needs human eyes

- **The finding decays if the roots move.** It rests on where sessions actually open, which is a
  habit rather than a rule. If greenroom or grain starts getting its own rooted sessions regularly,
  the answer for that repo changes and this task is worth re-running. Nothing checks that today, and
  nothing was added to check it, because a doctor rule that reads `~/.claude/projects` would be a
  machine-level guard reaching into transcript storage for a judgement call.
- **A real hazard was surfaced and deliberately not fixed.** Sibling repos are edited by sessions
  that are not rooted in them, so pantry's tree can be dirtied by a session whose harness attributes
  that work somewhere else. That is the inverse of the capability the portfolio's section names, and
  it argues for a note in the sibling repos, but a hazard note is a different thing from the harness
  section this task asked about. Inventing it here would have been scope this run was told not to
  invent. It is worth a decision.
- **greenroom is one session away from being a genuine second case.** It has had exactly one
  harness-run session, on 2026-08-01, and it has been quiet since 2026-08-05. If it wakes up, the
  call above should be made again rather than inherited, and the argument against it there is about
  its non-coder audience rather than about session roots.
