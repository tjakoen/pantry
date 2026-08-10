---
title: The last two untested sources, and a fixture guard nobody had ever run
date: 2026-08-10
status: complete
lane: gated
branch: main
scope:
  - pantry
touched:
  - pantry/config.test.ts
  - pantry/fixtures.test.ts
  - pantry/artifacts/runs/2026-08-10-config-and-fixtures-tests.md
skills:
  - loop-standard
plans: []
gates:
  - bun test (pantry, at session start) | 501 pass, 0 fail, 1302 expect() calls, 501 tests across 19 files
  - bun test (pantry, final) | 553 pass, 0 fail, 1448 expect() calls, 553 tests across 21 files
  - tsc --noEmit (pantry) | clean, no output
  - oxlint (pantry) | 23 warnings, identical to the last run's report, none from either new file
  - bun cli.ts doctor (pantry) | 15 checks, 0 failing, 4 due, all 4 pre-existing and the same four
  - mutation check (config.ts) | 4 deliberate mutations, 7 of 40 tests red, source restored, git diff clean
  - mutation check (fixtures.ts) | 2 deliberate mutations, 2 of 12 tests red, source restored, git diff clean
diffstat: 2 files created (config.test.ts 439 lines, fixtures.test.ts 171), 610 insertions, 0 deletions, no source file changed
dirty:
  - none in pantry at the end of this run; the tree was clean at the start and is clean after the commit
unpushed: 13 | all in pantry — 11 already local at session start, plus this run's test commit and this report; the push is the owner's call and was not made
verifiedBy: mutation, not review. Every branch the two suites claim to cover was re-checked by breaking the source it covers and confirming the suite went red, then restoring the source from a backup taken before the edit and confirming `git diff` was empty. That is a second pass by a different means rather than a second reading by the same author.
doctor: 15 checks, 0 failing, 4 due; the 4 due are pre-existing and unchanged from the last run
---

## What this run was for

Two source files in pantry had no test file beside them and every other one did. Both have one now.
Nothing else was touched, and no source file changed.

## config.test.ts — the host contract, resolved against a real host root

Forty tests. Every one builds a throwaway project directory and points `loadPantryConfig` at it,
because half this module's decisions are `existsSync` calls: a docs dir that auto-mounts only when it
is there, a tours dir that does not follow that rule, a graph file preferred over another. Mocking the
filesystem would have replaced the thing under test with an assertion that the code calls the function
that was mocked.

The directories are fresh per test rather than shared, and that is load-bearing rather than tidy.
`pantry.config.ts` is read with a dynamic `import()`, which caches by absolute path for the life of the
process, so a reused host root would have served the first test's config to every later one and the
later ones would have agreed with it. That is the same class of failure as the fixture below, arrived
at from the other direction.

What the branches actually are, as opposed to what a happy path would have covered:

- **Which file wins and what it may export.** `.ts` over `.js` over `.json`; a default export, a named
  `config` export when there is no default, and a module exporting neither, which falls back to the
  same empty object as no config at all.
- **A malformed config rejects.** It does not degrade to defaults, and the asymmetry is the point: an
  absent config means this host has no opinions, a config that will not parse means it has opinions
  nobody can read.
- **The defaults that chain.** `decisionsDir` defaults under `plansDir` and `answersLog` under
  `decisionsDir`, so moving the board moves both. A host that moved its board and found its decisions
  still at the old path would have two boards.
- **Two existence gates that deliberately disagree.** A `docsDirs` entry that does not exist is
  dropped, including from an explicit list. An explicit `toursDir` that does not exist is mounted
  anyway and warned about. Both are asserted, including the warning.
- **The two decisions only observable as a warning.** A configured preview target that fails
  validation, and a named tours folder that is not there. Both are non-silent on purpose, so the
  warning is the behaviour; `console.warn` is captured and asserted rather than left to scroll past.
  The case that must NOT warn is pinned too: an empty or whitespace-only target is a key someone
  blanked out, not a value that failed.

## fixtures.test.ts — running the guard, rather than restating it

`fixtures.ts` exists because of a green suite that had stopped asking its question, and its answer is a
throw at import time when the plan corpus is empty or missing. Until this run, that throw had never
been executed: every test run in this repo has taken the branch where the corpus is fine.

A test that re-implemented the guard's condition inline would have been a copy of exactly the kind the
subject warns about, and would have kept passing after someone deleted the real one. So the real file
is read off disk at test time, copied into a throwaway project alongside a stand-in `@tjakoen/proof`
whose `package.json` exports only `PLAN.md` (as the real one does), and imported in a child process.
Four states: a real corpus, an empty `example/`, no `example/` at all, and one holding only
non-markdown. The first exits 0 and prints the resolved path; the other three exit non-zero with the
guard's own message.

Three other claims the file makes about itself are also checked rather than trusted: that the path
resolves inside `node_modules` and not to the sibling checkout the old tests carried, that
`@tjakoen/proof/example/*` genuinely is not resolvable as a subpath (which is why the path is built
from `PLAN.md`'s dirname, and which will fail usefully if a later PROOF release exports it), and that
the module stays out of `package.json`'s `files` with no non-test file importing it.

## Gate output

```
bun test (pantry, at session start, before any file was written)
 501 pass
 0 fail
 1302 expect() calls
Ran 501 tests across 19 files. [2.92s]

bun test (pantry, final)
 553 pass
 0 fail
 1448 expect() calls
Ran 553 tests across 21 files. [3.02s]

tsc --noEmit (pantry)
(no output)

oxlint (pantry)
23 warnings, 0 errors
oxlint config.test.ts fixtures.test.ts
(no output)

bun cli.ts doctor (pantry)
15 checks, 0 failing, 4 due
OK

mutation check, config.ts (4 mutations, source restored afterwards)
  previewCommand trim removed          -> 2 red
  answersLog derived from plansDir     -> 1 red
  docsDirs existence filter removed    -> 3 red
  graph.json preferred over merged     -> 1 red
 33 pass
 7 fail
git diff --stat config.ts -> (empty)

mutation check, fixtures.ts (2 mutations, source restored afterwards)
  the .md filter removed               -> 1 red
  the existsSync guard forced true     -> 1 red
 10 pass
 2 fail
git diff --stat fixtures.ts -> (empty)
```

## What was NOT done

- **No source file was changed.** This run wrote tests against the code as it stands. Nothing in
  `config.ts` or `fixtures.ts` was refactored to be easier to test, and nothing was fixed.
- **Nothing was pushed.** Thirteen commits are local in pantry now, eleven of which predate this run.
  The push is the owner's call and has been the first open item for several runs.
- **The four doctor items still due**, all pre-existing and unchanged: graphify freshness, no e2e
  suite, layer pins three behind, and two old run reports missing evidence.
- **No second reviewer was run.** Verification here is mutation rather than a second pair of eyes, and
  the two are not interchangeable: mutation proves each assertion is load-bearing, and proves nothing
  about a branch neither the code nor the test considered.
- **`resolvePreviewTarget` itself was not tested here.** It lives in `preview.ts` and has its own
  suite; `config.test.ts` asserts only what the config layer does with its answer.

## What needs human eyes

- **Whether to push.** Thirteen local commits in pantry, all green on every gate above.
- **A dead fallback in `config.ts`, found while writing the tests and deliberately left alone.**
  `projectName: raw.projectName ?? basename(cwd) ?? "project"` can never reach `"project"`.
  `basename` returns a string, never nullish, so the only way the middle term is falsy is
  `basename("/")`, which is `""` and which `??` passes straight through. A host rooted at `/` gets an
  empty project name rather than the fallback the code appears to promise. No test asserts this, in
  either direction, because asserting today's behaviour would pin a bug and asserting the intended
  behaviour would fail. It is one character (`||` instead of `??`) if the fallback is meant, and a
  deletion if it is not, and which of those it is belongs to the owner rather than to a test run.
- **Whether the child-process guard test is worth its runtime.** It spawns four `bun run` processes,
  which is the slowest thing in this suite by an order of magnitude (about 100ms of the file's 128ms).
  The alternative is not testing the throw at all, which is what was true before this run.
