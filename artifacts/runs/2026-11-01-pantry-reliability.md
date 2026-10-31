---
title: Keep the installed cockpit and its answer channel usable
date: 2026-11-01
status: complete
lane: gated
branch: codex/pantry-reliability
scope:
  - CLAUDE.md
  - INSTALL.md
  - PLAN.md
  - answers.test.ts
  - answers.ts
  - app.test.ts
  - app.ts
  - cli.test.ts
  - cli.ts
  - context.ts
  - doctor.test.ts
  - doctor.ts
  - package.json
  - pantry-review.js
  - pantry.css
  - sessions.ts
  - context.test.ts
  - tools/package-smoke.test.ts
  - plans/pantry-reliability.md
  - artifacts/runs/2026-11-01-pantry-reliability.md
touched:
  - CLAUDE.md
  - INSTALL.md
  - PLAN.md
  - answers.test.ts
  - answers.ts
  - app.test.ts
  - app.ts
  - cli.test.ts
  - cli.ts
  - context.ts
  - doctor.test.ts
  - doctor.ts
  - package.json
  - pantry-review.js
  - pantry.css
  - sessions.ts
  - context.test.ts
  - tools/package-smoke.test.ts
  - plans/pantry-reliability.md
  - artifacts/runs/2026-11-01-pantry-reliability.md
plans:
  - pantry-reliability
skills:
  - graph
  - voice
  - loop-standard
gates:
  - bun run check | clean
  - bun test | 740 pass, 0 fail
  - bun run lint | exit 0, existing warnings
  - docker compose --profile gates run --rm gates-pantry | not run; configuration file absent
dirty: all touched files | deliberately left uncommitted for the root session; no commit authorized
unpushed: 0 | no new commits, push is outside the authorized scope
verifiedBy: root session | independently reviewed the implementation and the two responsive CSS rules
doctor: 0 failing, 4 due | graph freshness, e2e presence, layer pins, old run evidence
---

An installed PANTRY package must work outside its checkout, and an unreadable answer log must never
look like an empty inbox. The package now includes the runtime files its CLI and routes import.
A smoke test packs the package, extracts it into a temporary directory, runs its CLI from a separate
host directory and serves the control client from the extracted files. Dependencies remain the
checkout's frozen installation, so this proves the package file closure rather than a fresh network install.

Persisted answer and acknowledgement rows are validated before consumers dereference them. Valid
neighbors survive a malformed row. The CLI returns failure for corrupt or unreadable logs, waiting
and acknowledgement stop, doctor reports the degraded state, and the browser displays an alert with
HTTP 503 from its machine endpoint. A missing log retains the healthy first-use behavior.

Context and session readers share Claude account resolution. The context reading names Claude and
the selected directory; doctor states that Codex context is not measured. The review client no
longer uses the spread fallback that caused the lint error.

## Gate output

The first focused run found one stale assertion for the context label. That assertion was updated
to require the explicit Claude and Codex scope. The final full suite output was:

```
 740 pass
 0 fail
 1921 expect() calls
Ran 740 tests across 26 files. [6.40s]
```

Typecheck:

```
$ tsc --noEmit
```

Lint (exit 0):

```
$ oxlint
timeline.test.ts:300:47: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
config.test.ts:454:27: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
runs.ts:70:7: warning unicorn(prefer-set-has): should be a `Set`, and use `.has()` to check existence or non-existence. help: Switch to `Set`
runs.ts:413:61: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
graph.ts:97:19: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
map.ts:120:6: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
map.ts:132:6: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
retrieval.ts:76:69: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
decisions.ts:166:61: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
sessions.ts:339:29: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
deps.ts:86:40: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
app.test.ts:611:41: warning oxc(no-map-spread): Spreading to modify object properties in `map` calls is inefficient help: If in-place mutation is acceptable, use `Object.assign` or direct property assignment instead of spreading
app.test.ts:700:63: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
timeline.ts:233:28: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
timeline.ts:245:6: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
timeline.ts:365:84: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
map.test.ts:84:34: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
skills.ts:170:30: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
skills.ts:405:58: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
answers.ts:466:27: warning eslint(no-unmodified-loop-condition): 'settleMs' is not modified in this loop.
skills.test.ts:66:46: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
artifacts.test.ts:65:46: warning unicorn(no-array-sort): Use `Array#toSorted()` instead of `Array#sort()`. help: `Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.
pantry-review.js:405:11: warning eslint(no-shadow): 'empty' is already declared in the upper scope. help: Consider renaming 'empty' to avoid shadowing the variable from the outer scope.
doctor.ts:622:13: warning eslint(no-shadow): 'plural' is already declared in the upper scope. help: Consider renaming 'plural' to avoid shadowing the variable from the outer scope.
pantry-map.js:17:25: warning eslint(no-unused-vars): Variable 'surface' is assigned a value but never used. Unused variables should start with a '_'. help: Did you mean to use this variable?
pantry-map.js:208:25: warning eslint(no-unused-vars): Variable 'moved' is assigned a value but never used. Unused variables should start with a '_'. help: Did you mean to use this variable?
pantry-map.js:41:56: warning promise(always-return): Each then() should return a value or throw
app.ts:45:33: warning eslint(no-unused-vars): Identifier 'classifyArtifact' is imported but never used. help: Consider removing this import.
```

The documented container invocation was attempted from bread and returned:

```
no configuration file provided: not found
```

## Browser evidence

A temporary sanitized host outside all consumer repositories served the answer page. CUA screenshots
are retained locally under artifacts/reviews/2026-11-01-answer-boundaries. Both malformed and unreadable
states were captured at 1280px and 390px. At 390px, the navigation and long log path initially
produced 671px of horizontal content. The navigation now wraps and the path breaks between characters
when necessary. Live DOM measurements after the correction were 390px of content at a 390px viewport
for both states, and 1280px at a 1280px desktop viewport. The temporary browser viewport was reset.
The screenshot files are excluded locally from Git and are evidence rather than package assets.

## Diffstat

```
 INSTALL.md       | 14 ++++++++++++++
 PLAN.md          |  9 +++++++++
 answers.test.ts  | 44 ++++++++++++++++++++++++++++++++++++++++++++
 answers.ts       | 47 +++++++++++++++++++++++++++++++++++++++--------
 app.test.ts      | 26 ++++++++++++++++++++++++++
 app.ts           | 10 +++++++---
 cli.test.ts      | 36 ++++++++++++++++++++++++++++++++++++
 cli.ts           |  6 ++++--
 context.ts       | 12 +++++++++---
 doctor.test.ts   | 25 ++++++++++++++++++++++++-
 doctor.ts        | 18 +++++++++++-------
 package.json     |  5 +++++
 pantry-review.js |  2 +-
 pantry.css       |  3 ++-
 sessions.ts      |  5 ++---
 15 files changed, 233 insertions(+), 29 deletions(-)
```

The untracked context regression, package smoke test, scoped plan and this report are additional files.

## What was not done

No publication, push, deployment, commit, course-platform edit or badge edit was performed. The
package smoke uses already installed dependencies and does not prove a new network dependency
resolution. The absent Compose configuration prevents claiming a container gate pass. The four
existing doctor items remain due: graph freshness, e2e presence, layer pins and older run evidence.
The structural graph query for readContext returned no matching nodes, so the named context and
session modules were inspected directly.

## What needs human eyes

The owner still decides PANTRY's product role after the separate course-platform workflow evaluation.
These reliability fixes do not establish adoption value. The root session owns the final combined
review and the decision about committing the local changes.

The root session acknowledged the final responsive CSS review. The local gate instructions in
CLAUDE.md now name the verified host commands, the package smoke test and the Windows symlink
prerequisite. They no longer prescribe an absent Compose configuration or a fixed historical
test count. This documentation follow-up changed no code, so the code gates were not rerun.
The temporary fixture server was stopped after its screenshots were preserved.

## Local landing, November 1

The owner subsequently requested clean main branches. The verified changes and their evidence are
being recorded in a local commit and brought onto main by fast-forward. Earlier statements about
uncommitted work describe the implementation phase. No push, package release, or deployment is part
of this landing.
