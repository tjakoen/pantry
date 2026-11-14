---
id: pantry-public
status: done
track: release
depends: []
touches: [tiers.ts, tiers.test.ts, package.json, pantry.config.json, doctor.ts, doctor.test.ts, config.ts, init.ts, init.test.ts, docs/WORKFLOW.md, README.md, INSTALL.md]
owner: ai
---

# Prepare PANTRY for a public release

PANTRY is tuned to one person's machine and workflow. Before anyone else installs it, the repo has
to say which parts are the contract, which parts are the suggested loop, and which parts are the
owner's own layer, and doctor has to enforce only the first of those.

Overlap with the parallel sessions: the dashboard session owns chrome.ts, brief-routes.ts and
pantry.css, and the app session owns cli.ts and app/. This plan touches none of them. The init
change lives in init.ts, which cli.ts already calls, so no CLI edit is needed.

## Tasks

- [x] Coupling audit, every place PANTRY assumes the owner's setup, with file and line
- [x] Tier every doctor check, with tests
- [x] Write docs/WORKFLOW.md and link it from the README's first screen
- [x] Make pantry init scaffold tier 1
- [x] Try a clean-machine install from the README in a throwaway HOME
- [x] Report what a history scrub would need
- [x] Install docs: releases (desktop app, coming), command line, Docker, the Claude desktop app, skills

## Open items

- The note link in docs/WORKFLOW.md is a placeholder (/notes/pantry-beside-the-work). The owner wants the
  note written last, after the app, the public release and the Claude pane.
- The desktop app section of INSTALL.md is a marked placeholder with no asset names. Signing,
  shipping and updates are open owner calls in plans/pantry-app.md.

## How the tiers landed

tiers.ts holds a tier per doctor check id. Tier 1 (plans-dir, plans-schema, mcp-registered) keeps
its severity and can fail. Tier 2 errors become warnings carrying a link to docs/WORKFLOW.md. Tier 3
is silenced unless pantry.config.json says "ownerLayer": true, and an opted-in repo keeps every
check at its written strictness, so the owner's repos lose nothing. An unknown check id is tier 3.
This repo's own pantry.config.json now opts in. pantry init writes .mcp.json (merged into an
existing one), which completes tier 1.

The claim did not land: pantry_claim answered "not a todo plan in pantry", because the hub reads the
main checkout and this plan exists only in the worktree. The plan carries status doing by hand.

## Coupling audit

Out of scope by owner decision: the @tjakoen/* packages and the theme flavors.

The agent-config repo, its hooks and the session checklist:

- .claude/hooks/cloud-standards.sh:7 and cloud-hook.ts:27 test for $HOME/.claude/tools/session-checklist.sh, the owner's checklist.
- .claude/hooks/cloud-standards.sh:8 and cloud-hook.ts:28 fetch standards from https://tjakoen.github.io/standards.
- init.ts:179-191 (kit) commits that cloud hook into every kit repo.
- doctor.ts hook-drift check (around line 760) compares local hooks with the machine mount from agent-config. Now tier 3.
- INSTALL.md:119 names "the session-start checklist in the owner's agent config".
- doctor.ts:501 and context.ts:122 measure ~/.claude, the owner's 20k context budget estate default. Now tier 2, budget configurable.

Standards resolved from tjakoen.github.io:

- package.json:18 sha-pins tjakoen.github.io from GitHub; package.json:81 deps:refresh re-pins it.
- app.ts:72-123 resolve the framework docs and app.ts:85-89, 376-380 the /standards surface from that package (auto-disable when absent).
- init.ts:36, 159, 187 seed CLAUDE.md and skills from tjakoen.github.io/standards.
- skills.ts:120, 411, 431 mount the standards as skills.
- doctor.ts:115-135 forked-standards check names the owner's canon files (LOOP.md, VOICE.md, SESSION-LOOP.md). Now tier 3.
- Comments citing LOOP.md sections: doctor.ts:2-12, 329, 337, 419; deps.ts:18; decisions.ts:2, 27; config.ts:91, 148; cli.ts:261. Harmless, but they assume the reader has the portfolio.
- CLAUDE.md:8, 49 and README.md:3, 15-20, 93, 101 link the personal site; fine for a public repo, worth keeping.

Hardcoded paths and project names:

- No absolute owner paths in shipped source. sessions.test.ts:147 uses a synthetic /Users/x path.
- .oxlintrc.json:17 ignores nimbalyst-local/, a folder from the owner's other tool.
- PLAN.md:49 names the course-platform workflow.
- artifacts/runs/ holds 10 committed run reports with /Users/tjakoenstolk/Local/Development/... paths and Nimbalyst references (2026-08-07-s3b-run-ledger.md:65, 2026-08-10-handoff-nudge.md:179-231, 2026-08-10-harness-section-other-repos.md:10-117, and seven more). These are the biggest leak in the tree.
- Port 4400 and ~/.pantry are PANTRY's own defaults, overridable with PANTRY_HOME; not coupling.

Career Team, Edge, private repos:

- No file in the tree names Career Team, CareerEdge or Edge (the matches for "edge" are the English word).
- The VOICE skill mounted into .claude/skills names Career Team, but it is generated and gitignored.

## Clean-machine install

Two trials, each in a fresh HOME from mktemp -d and a fresh git repo.

1. The README quickstart, verbatim, against GitHub main. bun add from github:tjakoen/pantry#main
   resolved 2337f26, not the local main (a127baa is unpushed). init --kit, proof check, skills sync
   and doctor all ran; doctor reported 23 checks, 0 failing, 1 due. The GitHub fetch worked with
   the owner's git credentials still in the keychain, so a real stranger's fetch is not proven
   while the repo is private.
2. This branch, packed with bun pm pack and installed from the tarball. init wrote plans/,
   pantry.config.json and .mcp.json; doctor printed 15 checks, 0 failing, 3 due, and 11 owner-layer
   checks silent; serve answered 200 on /.

What broke or surprised:

- bun pm pack --destination /tmp spun for five minutes at full CPU and had to be killed; --filename
  finished in under two seconds.
- node-expat's postinstall took over a minute on a cold cache.
- The README says the install is "pinned to a commit" while the command tracks #main.
- @tjakoen/pantry is not on npm, so the README and INSTALL.md use the GitHub spec.
- The quickstart's skills sync step mounts the owner's sixteen standards into a stranger's repo.
  It now belongs to tier 3 in docs/WORKFLOW.md; the README still lists it in the quickstart.

## History

168 commits, one author email (the owner's). Commit messages never name Career Team or Edge. The
leaks are in content, not metadata: 12 commits add the run reports above, carrying absolute home
paths and Nimbalyst names, and 29 diff lines across history contain the home path.

A scrub would need git filter-repo over artifacts/runs/ (drop it, or replace /Users/tjakoenstolk
with ~), plus .oxlintrc.json and PLAN.md:49, then a force-push and every worktree and clone
re-made. The open branches (charming-noyce, happy-haibt, sleepy-wilbur) and PR #4 would all need
rebasing onto the rewritten history.

Recommendation: start a fresh public repository from a squashed snapshot of main after the
release prep lands, with artifacts/runs/ left out, and keep this repository private as the working
history. That costs the public the commit log, but the commit log is where the owner's machine
shows through, and nothing in it is needed to run PANTRY. The owner decides; nothing was rewritten.
