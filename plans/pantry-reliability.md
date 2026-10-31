---
id: pantry-reliability
status: done
track: maintenance
depends: []
touches: [CLAUDE.md, PLAN.md, pantry.css, context.ts, context.test.ts, sessions.ts, artifacts/runs/2026-11-01-pantry-reliability.md, package.json, tools/package-smoke.test.ts, pantry-review.js, answers.ts, answers.test.ts, app.ts, app.test.ts, cli.ts, cli.test.ts, doctor.ts, doctor.test.ts, INSTALL.md]
owner: ai
---

# Keep the installed cockpit and its answer channel usable

The October 31 audit found missing runtime files in the package and answer-log failures that looked like an empty inbox. This slice repairs those boundaries without changing the cockpit architecture or the host project.

- [x] Include every runtime module and asset, and exercise the packed CLI and control asset.
- [x] Remove the lint error in the review client.
- [x] Validate persisted answers and acknowledgements before readers consume them.
- [x] Distinguish unreadable logs from absent logs in the CLI, doctor and browser surfaces.
- [x] Run focused regressions and the repository gates, then obtain an independent second pass.

No publication, push, commit, host-project change or architecture decomposition is included.

The root session independently reviewed the code changes. The full suite passed 740 tests; typecheck
and lint passed. Browser evidence covers malformed and unreadable logs at desktop and 390px widths.
The documented container command could not start because the bread checkout has no Compose file;
the host gates are the evidence for this slice. No package was published and no commit was created.
