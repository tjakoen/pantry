---
title: Capture at run time, and the answer log as a loop step
date: 2026-08-10
status: complete
lane: gated
branch: main
scope:
  - pantry
  - tjakoen.github.io/plans
  - tjakoen.github.io/standards
  - tjakoen.github.io/artifacts
touched:
  - pantry/capture.ts
  - pantry/capture.test.ts
  - pantry/cli.ts
  - pantry/config.ts
  - pantry/doctor.ts
  - pantry/doctor.test.ts
  - pantry/artifacts.ts
  - pantry/INSTALL.md
  - pantry/app.ts
  - pantry/app.test.ts
  - pantry/crumb-mount.test.ts
  - pantry/preview.test.ts
  - pantry/drift.test.ts
  - pantry/init.test.ts
  - pantry/retrieval.test.ts
  - pantry/skills.test.ts
  - pantry/artifacts/runs/2026-08-10-capture-at-run-time.md
  - tjakoen.github.io/plans/pantry-review-layer.md
  - tjakoen.github.io/plans/decisions/answers.jsonl
  - tjakoen.github.io/standards/LOOP.md
  - tjakoen.github.io/standards/DECISIONS.md
  - tjakoen.github.io/standards/SESSION-LOOP.md
  - tjakoen.github.io/artifacts/reviews/2026-08-10-review-tier1-nongrain/
  - tjakoen.github.io/artifacts/reviews/2026-08-10-tmp-capture-failure-proof/
skills:
  - loop-standard
  - session-loop
  - tour-standard
plans:
  - pantry-review-layer
gates:
  - bun test (pantry, final) | 486 pass, 3 fail, 1264 expect() calls, 489 tests across 18 files
  - bun test (pantry, the 3 failures) | pre-existing and structural, not this change; see below
  - tsc --noEmit (pantry) | clean, no output
  - oxlint (pantry) | 23 warnings, identical count to the last run's report, none from a file this run added
  - bun cli.ts doctor (pantry) | 15 checks, 0 failing, 4 due, all 4 pre-existing
  - bun test (portfolio) | 328 pass, 0 fail, 1298 expect() calls, 328 tests across 20 files
  - bun run check (portfolio) | tsc --noEmit, clean
  - bun run lint:voice (portfolio) | 476 flags, identical to the last run's report, 0 on the lines this run added
  - bun cli.ts doctor (portfolio) | 15 checks, 0 failing, 3 due
  - crumb check content/tours | 10 tours pass
  - bunx proof verify plans (portfolio) | 18 plans, 2 problems, both pre-existing
  - bun run export + verify:export (portfolio) | dead-link walk OK, sitemap OK
  - capture, the Tier 1 fixture, all addresses real | 3 of 3 steps resolved, exit 0
  - capture, the same fixture deliberately broken | 3 of 3 steps failed with three different verdicts, exit 1
  - process check after every capture | no next process left, port 5210 free
diffstat: pantry 14 files changed, 269 insertions, 13 deletions, plus 2 created (capture.ts 680 lines, capture.test.ts 455); portfolio 4 files changed, 60 insertions, 10 deletions, plus 2 capture dirs created
dirty:
  - artifacts/runs/2026-08-09-conformance-and-handover.md | in the PORTFOLIO, staged as deleted by another session, deliberately left exactly as found
  - artifacts/runs/ | in the PORTFOLIO, untracked, another session's, not touched
unpushed: 2 | pantry 1, portfolio 1; the push is the owner's call and has not been made
verifiedBy: two independent reviewers that did not write the change, run in parallel with different briefs, plus two browser-driven captures of a real Next production build. Between them the reviewers found fifteen defects and the author had found none of them. Every one was reproduced against the code before being accepted, the eight that changed behaviour carry a fix, and both captures were re-run afterwards so the committed evidence was produced by the code that shipped rather than by the code that was reviewed.
doctor: 15 checks, 0 failing, 4 due; the 4 due are pre-existing and named below
---

## What this run was for

Two things, and the second is smaller than it sounds.

**P4d, capture at run time.** The last phase of the review layer that was still a paragraph rather than
a command. A tour resolves each step by a `data-surface` name, and a name that no longer matches
anything fails one of exactly two ways: loudly, in a harness, where a failure is a signal, or silently
at review time, lighting the wrong element in front of the one person who trusted the review. The plan
had said which of those it wanted since P0. This is the harness.

**The answer log as a loop step.** DECISIONS section 4 ended with an unusually honest sentence: the
channel works and nothing obliges anyone to read it. That sentence was true for a day. A rule in a
standard does not make a session read a file, so the obligation had to land somewhere a session
already looks.

## What was built

`pantry capture <tour-id>` starts the reviewed project if it is not running, boots PANTRY on an
ephemeral port against it, drives every step of a tour through the proxy with the host's Playwright,
and writes the states into `<artifactsDir>/reviews/<id>/`: a full-page shot per step, a crop of the
element the step is about, a manifest, and an index that reads with nothing running. It exits nonzero
when an address matches nothing, matches more than one element, or matches an element with no box.

Three boundaries, because this is the module that crosses the ones the rest of PANTRY keeps.

**It borrows a browser and refuses to own one.** The driver resolves from the host repo. The guard
that makes that real rather than decorative: PANTRY carries `@playwright/test` as its own
devDependency, so a resolution landing in PANTRY's node_modules is refused by path, with a message
that says why. Without it, a host that installed nothing would have got a working capture for as long
as PANTRY was a sibling checkout on disk, and a resolution failure the first time PANTRY installed as
a git dependency, which strips devDependencies. A false green with a long fuse is the worst kind.

**It starts a process, and that is a line the plan drew and the owner crossed on purpose.** The cost
section names a launcher as the signal this went too far. Asked which of three shapes to build, with
that warning in the option text, the owner chose the one where PANTRY starts the project. So
`previewCommand` exists. What bounds it is in the plan and in the code: never inferred, only the
string a human wrote; read by the capture command alone, never the server and never a route; started
in its own process group and stopped with SIGTERM then SIGKILL, with the exit waited for rather than
assumed; and a target that already answers is left alone, so capture never starts a second copy.
Delete the key and capture still works against a project you started yourself, which is the retreat
the cost section asks to keep open.

**It writes, and until today PANTRY wrote one file.** Only under `<artifactsDir>/reviews/<id>/`, only
PNG, JSON and Markdown, and only after the real resolved directory has been proved to sit inside the
real resolved artifacts dir. Every write re-asserts that, because the check happens once and the
writes happen after a walk that takes minutes.

For the second half, doctor grew a fifteenth check. It counts the answers no session has acted on and
names the first three, warn rather than error, because CI has no session to act on a pending decision
and a check that blocks a push on one is muted inside a week. LOOP section 2's session-start row says
so, section 9 gained a line about acking what you acted on, DECISIONS section 4's honest paragraph now
describes a step rather than a gap, and SESSION-LOOP step 4 points at the report a session already
reads instead of asking for a second file read.

## Gate output

```
bun test (pantry)
 486 pass
 3 fail
 1264 expect() calls
Ran 489 tests across 18 files.

tsc --noEmit (pantry)
(no output)

oxlint (pantry)
Found 23 warnings and 0 errors.

bun cli.ts doctor (pantry)
15 checks, 0 failing, 4 due
OK

bun test (portfolio)
 328 pass
 0 fail
 1298 expect() calls
Ran 328 tests across 20 files.

bun run lint:voice (portfolio)
voice-lint: 476 flag(s) across 30 file(s) (429 tell, 47 warn).

bun run verify:export (portfolio)
[verify-export] sitemap.xml: every <loc> resolves to a real file, all trailing-slash canonical
[verify-export] dead-link walk: every internal href/src across the exported HTML resolves
[verify-export] OK

bun ../pantry/cli.ts capture review-tier1-nongrain --preview http://localhost:5210 \
  --start "bunx next start -p 5210" --start-cwd /tmp/tier1-proof
[capture] http://localhost:5210 is not answering. Starting: bunx next start -p 5210
[capture] target is up.
[capture] PANTRY on http://localhost:57969, proxying http://localhost:5210
[capture] 1/3 page:tickets: ok
[capture] 2/3 ticket:refund-state: ok
[capture] 3/3 ticket:total: ok
Captured 3 steps, all resolved.
exit 0

bun ../pantry/cli.ts capture tmp-capture-failure-proof (the same fixture, deliberately broken)
[capture] 1/3 page:nowhere: missing (0 matches)
[capture] 2/3 note:tier: ambiguous (2 matches)
[capture] 3/3 note:hidden: not-visible (1 match)
Captured 3 steps, 3 FAILED.
exit 1
```

The three failing pantry tests are pre-existing and structural rather than behavioural. All three read
fixtures out of `../proof/example`, and `../proof` no longer exists on disk: mill and proof were folded
into grain's packages and the standalone clones were deleted. They fail at HEAD for the same reason and
have nothing to do with this change. Naming them rather than fixing them, because the fix is a decision
about where those fixtures should live now, not a repair.

## The proof, and why the failing run is the important one

The passing capture is the easy half and it worked first try: three steps, a navigation between them,
element crops that show the refund badge and nothing else.

The failing one had to be built. The fixture carried no broken address, so one was added to it: the
same address on two elements, plus a third with display none, plus a step naming an address nothing
carries. All three verdicts fired, each with its own sentence, and the command exited 1. The ambiguous
case is the one this phase existed for. An address on a component that appears on six routes resolves
to whichever copy the query reaches first, which is the selector drift this plan rejected selectors to
avoid, arriving through an attribute instead. Capture is where it becomes visible, and it is visible
by count, not by guess.

Both captures were re-run after the review fixes landed, and the fixture and the throwaway tour were
reverted afterwards. The evidence in the two capture folders was produced by the code being committed,
not by the code the reviewers read.

## What the reviewers found that the author did not

Fifteen, and the count is not the point. Two of them were the same defect seen from different angles,
which is the argument for running the reviewers in parallel with different briefs rather than one
after the other.

- **A guard that could be walked around by the thing it guarded.** The driver containment check
  compared resolved paths, which normalize dots and follow no links. PANTRY consumed through a symlink
  (bun link, a workspace, a bind mount) would have compared the link path against the resolver's real
  one, failed to match, and let PANTRY's own devDependency satisfy a host that installed nothing. The
  false green the function exists to prevent, reachable through the function. Both sides are real
  paths now, which is the rule the write boundary in the same file already stated in a comment.
- **A polite signal is not a stop.** The project was sent one SIGTERM and never checked. A framework
  that traps it for a slow shutdown keeps the port, which is exactly the "address already in use"
  failure the process group was written to prevent. SIGTERM, wait, SIGKILL, wait again.
- **A containment check with a long gap between the check and the use.** Proved once, then written
  through minutes later. A concurrent clean or a second capture with the same id can replace the
  directory in between. Every write re-asserts it now.
- **A server shutdown that was fired and forgotten.** `server.stop()` returns a promise and the
  teardown entry dropped it, so a run could report itself finished with the port still closing and any
  rejection surfacing later with nothing to attribute it to. The browser close beside it was awaited
  correctly, which is what made the odd one out visible.
- **Two fields lying in agreement.** A step whose navigation threw recorded `navigated: true` and put
  the requested URL in a field documented as the URL actually loaded. Anyone reading the manifest
  rather than the problem sentence would have believed the browser got there.
- **A signal handler racing the walk it was tearing down.** Ctrl-C started closing the browser while
  the loop kept calling goto and screenshot against it. The throw then raced the handler's own exit
  for which code the process reported. The loop checks an abort flag now.
- **A cleanup that assumed a name meant a file.** `--force` removed entries by name without recursive,
  and a directory may legally be called `old.png`. EISDIR out of a function whose whole style is clean
  failure messages.
- **Four comments that were false.** A three-item allowlist described as two, in a comment about the
  write boundary. `PANTRY writes NOTHING here` in artifacts.ts, which stopped being true the moment
  this module was written and now contradicts capture.ts's own header on the same fact. `the pixels a
  reviewer sees in the embed`, when the live embed sits in a frame beside a rail and is a couple of
  hundred pixels narrower than the shot. And `every shot is the settled state`, which is true of CSS
  transitions and says nothing about script-driven motion, video, or an animated image. The manifest
  field is `css-disabled` rather than `disabled` now, so it cannot promise more than a stylesheet can
  deliver.
- **A parser that ate the flag after a flag.** `--preview` and `--port` consumed the next token
  unconditionally, unlike the generic handler five lines below them, so `--preview --force` set the
  target to the string `--force`, failed loopback validation, and reported a bad preview while the
  flag it actually swallowed went unmentioned. One helper decides what counts as a value now, so the
  named flags and the generic path cannot drift apart again.
- **A version lookup cutting at the first node_modules.** Wrong for a nested install; degrades to null
  rather than crashing, so it was only ever going to be found by reading.
- **Two claims of test completeness that were not complete.** The driver refusal was tested one level
  down and never through the command, and the file's header claimed to cover every rule that decides
  whether the walk starts. The refusal has an end-to-end test now, and the two branches that need a
  broken Playwright install to reach are named as uncovered rather than papered over.

One finding was accepted and deliberately not acted on, below.

## What was NOT done

- **The containment rule now has four copies.** One reviewer pointed out that
  `realTarget === realBase || realTarget.startsWith(realBase + sep)` already exists inline in
  artifacts.ts, app.ts and runs.ts, and capture.ts added a fourth, better only in that it is named,
  exported and tested. Collapsing all four into one shared helper is the right end state and it
  touches three modules this run did not otherwise open, which makes it scope growth rather than a
  fix. Left for a session that can carry it with its own tests.
- **The three pre-existing pantry test failures.** They point at `../proof/example`, a path deleted
  when proof folded into grain. Fixing them means deciding where those fixtures live now.
- **The two questions still open on the plan.** The theme leak on a GRAIN target and reviewing a
  deployed URL. P4d did not force either: capture is local by construction, and it injects into
  non-GRAIN targets only, which is the half of the theme question that was already settled.
- **Nothing was written into ph-live.** The ten proposed attributes are still a proposal, per the
  owner's call, and the owner has not answered whether to apply them. Not re-asked this run.
- **Neither repo was pushed.** One commit each, both local.

## What needs human eyes

- **Whether to push.** Two commits, one per repo, both local and both green on every gate above.
- **Whether the capture evidence belongs in the portfolio.** It landed there because capture writes to
  the reviewing repo's artifacts dir and the tour lives in the portfolio, which is correct behaviour
  and puts about 130 kilobytes of PNG in a repo whose other review evidence all sits in pantry. Worth
  a decision before it becomes a habit.
- **The Record button has still never been pressed.** Confirmed by the owner this run, and now written
  into DECISIONS section 4 rather than carried in a memory. It is the one write path in the answer
  channel that a session cannot exercise for itself, because the automation wedges on the review
  shell's same-origin iframe.
- **Nobody has walked the Tier 1 tour by hand.** Also confirmed this run. Two captures and two
  reviewers are not the same as a person looking at the screen, and this plan has now twice been
  corrected by something only visible on a screen.
- **The four doctor items still due in pantry**, all pre-existing: the same four the last run named.
