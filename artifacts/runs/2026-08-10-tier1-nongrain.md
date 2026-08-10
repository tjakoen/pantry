---
title: A tour on a project that never heard of us — Tier 1 off the GRAIN host
date: 2026-08-10
status: complete
lane: gated
branch: main
scope:
  - pantry
  - tjakoen.github.io/plans
  - tjakoen.github.io/content/tours
touched:
  - pantry/app.ts
  - pantry/preview.ts
  - pantry/config.ts
  - pantry/pantry-review.js
  - pantry/crumb-mount.test.ts
  - pantry/preview.test.ts
  - pantry/app.test.ts
  - pantry/doctor.test.ts
  - pantry/drift.test.ts
  - pantry/init.test.ts
  - pantry/retrieval.test.ts
  - pantry/skills.test.ts
  - pantry/package.json
  - pantry/bun.lock
  - pantry/artifacts/runs/2026-08-10-tier1-nongrain.md
  - pantry/artifacts/reviews/2026-08-10-tier1-nongrain/ph-live-data-surface-proposal.md
  - tjakoen.github.io/plans/pantry-review-layer.md
  - tjakoen.github.io/plans/decisions/answers.jsonl
  - tjakoen.github.io/content/tours/review-tier1-nongrain.md
skills:
  - loop-standard
  - session-loop
  - tour-standard
plans:
  - pantry-review-layer
gates:
  - bun test (pantry, final) | 435 pass, 3 fail, 1149 expect() calls, 438 tests across 17 files
  - bun test (pantry, at HEAD before this change) | the same 3 failures, confirmed by stashing and re-running
  - tsc --noEmit (pantry) | clean, no output
  - oxlint (pantry) | 23 warnings, identical count to HEAD, none from a file this run added
  - bun cli.ts doctor (pantry) | 14 checks, 0 failing, 4 due, all 4 pre-existing
  - bun test (portfolio) | 328 pass, 0 fail, 1298 expect() calls, 328 tests across 20 files
  - bun run check (portfolio) | tsc --noEmit, clean
  - bun run lint:voice (portfolio) | 476 flags, unchanged from HEAD, 0 in the two files this run edited
  - bun run export + verify:export (portfolio) | dead-link walk OK, sitemap OK
  - bunx proof verify plans (portfolio) | 18 plans, 2 problems, both pre-existing
  - crumb check content/tours | 10 tours pass, the new one included
  - browser walk, Next 15.5 production build through the proxy | 3 steps resolved, lamp on target within 6px, decision card read by PANTRY's client
  - no-leak measurement, app served direct vs through the proxy | computed styles and element geometry identical on 6 selectors and 3 surfaces
diffstat: pantry 15 files changed, 956 insertions, 34 deletions, 1 created (crumb-mount.test.ts); portfolio 3 files changed, 1 created (the tour)
dirty:
  - artifacts/runs/2026-08-09-conformance-and-handover.md | in the PORTFOLIO, staged as deleted by another session, deliberately left exactly as found
  - artifacts/ | in the PORTFOLIO, untracked, another session's, not touched
unpushed: 0 | pushed in both repos after the gates above
verifiedBy: two independent reviewers that did not write the change, plus a browser walk of a real Next production build. The walk found two defects before the reviewers ran; between them the reviewers found thirteen more, including a comment that was false about the file it was describing and six rail links that had been 404ing since P1. Every finding was reproduced before being accepted, every fix carries a regression test, and the walk was repeated afterwards.
doctor: 14 checks, 0 failing, 4 due; the 4 due are pre-existing and named below
---

## What this run was for

P4 is the phase that had to prove the review layer is not portfolio-shaped. Everything before it walked
a GRAIN host that mounts CRUMB itself, so every claim about "any project" was untested. This points
PANTRY at a plain Next 15.5 production build that has never heard of CRUMB, GRAIN or PANTRY, and walks
a three-step review on it.

The owner settled the target before any of it was built: ph-live is the real project, and nothing is
to be written into it yet. So the proof is a fixture and the attribute diff for ph-live is handed over
rather than committed.

## What was built

PANTRY carries CRUMB rather than expecting it. `@tjakoen/crumb` is a dependency now; `createCrumbRoutes`
mounts the tour data at `/__pantry/crumb` over a new `toursDir` config key; the client and one composed
stylesheet are served as PANTRY's own assets and injected into a proxied page that runs no CRUMB of its
own. The tours live in the reviewing repo, which is the arrangement that lets a review be written for a
project without being written into it.

The one piece that needed a decision rather than plumbing: CRUMB's client reaches GRAIN's spotlight by
absolute path, because it is a host-served asset and cannot import a `.ts` sibling. On a non-GRAIN
target that path is a request fired at the reviewed app for a file it has never heard of, so it is
rebased onto PANTRY's prefix. A test reads the real package file and fails if a second absolute import
ever appears, because a rebase that moves one specifier by name stops being complete the day it does.

## Gate output

```
bun test (pantry)          435 pass, 3 fail, 1149 expect() calls, 438 tests across 17 files
tsc --noEmit (pantry)      clean
oxlint (pantry)            23 warnings (23 at HEAD)
bun cli.ts doctor          14 checks, 0 failing, 4 due
bun test (portfolio)       328 pass, 0 fail
crumb check content/tours  10 tours pass
```

The 3 failing pantry tests fail identically at HEAD, confirmed by stashing this change and re-running.
They read `../proof/example`, a path that stopped existing when proof folded into grain. The 4 due
doctor items are the same 4 as the previous run: graphify freshness, no e2e suite, layer pins 3 behind,
and 2 older run reports missing evidence.

## The walk

A Next 15.5 app in `/tmp/tier1-proof` carrying five `data-surface` attributes and nothing else. All
three steps of `content/tours/review-tier1-nongrain.md` resolved: the lamp landed on the list heading,
then navigated a real route change and landed on the refund badge with a six pixel halo around its box,
then moved to the total line without a reload. The decision card rendered both asks and the composed
prompt, and PANTRY's injected client read it back as data.

Evidence: `artifacts/reviews/2026-08-10-tier1-nongrain/` (three screenshots and the ph-live proposal).

**A measurement trap worth writing down, because it reads exactly like a broken lamp.** A headless
browser session that has lost its display surface stops ticking CSS transitions, and the lamp's size,
position and opacity are all transitioned properties. Every measurement comes back as the START of the
transition: a zero-by-zero box at the viewport centre with opacity 0, while the correct element is
marked and the card is correct. Setting `transition: none` and re-measuring is what tells the two
apart. The screenshot API failing with a display-surface error is the tell that the session, not the
code, is the problem.

## What the walk found that reading would not have

**A stylesheet served is not a stylesheet that applies.** `crumb.css` is written against GRAIN's token
vocabulary, so on a host that defines none of those names the card rendered with no background, no
border and no radius. Every server-side check said the sheet was served: 200, fourteen kilobytes. One
level down the same thing again and worse, because the lamp's geometry lives in GRAIN's `ai.css` and
nothing was serving it at all. The lamp was a static div in the body flow two hundred pixels below the
element it claimed to be lighting, while the card, the step counter, the status badge and the
navigation all looked correct. A tour that lights the wrong place while reporting the right element is
the exact failure the addressability argument exists to prevent.

**A production build's cache headers describe bytes nobody served.** A change to the injected block did
not appear in the browser. Reviewing a production build is a deliberate choice from P0, and a
production build hands out a long `Cache-Control` and a strong `ETag`, both computed upstream and both
now lying about what went out. The page kept being served from cache with a previous run's client in
it, and revalidation agreed, because the target's bytes really had not changed.

## What the reviewers found that the walk did not

Twelve findings across two reviewers, neither of whom wrote the change. Five changed the code:

**The rail's probe accepted a status line as a manifest.** It fetched the project's `/crumb/tours.json`
and took any 2xx as proof, which an SPA catch-all answering `200 text/html` satisfies without serving a
single tour, and an SPA catch-all is the shape of the projects Tier 1 exists to reach. PANTRY's own
tours were then never tried and the rail reported that neither source had any. Both reviewers found
this independently, which is worth noting: it was the most reachable bug in the change and the author
walked past it twice.

The fix is not the missing content-type check. It is that the decision moved to the server, because a
probe in the browser is reachable by no test in this repo, which is why it shipped wrong. It is a
function with arguments now, and it checks a 2xx, a JSON content type, and a body that really parses to
an array.

**A comment was false about the file it was describing.** The claim was that every rule in the composed
stylesheet is scoped to names a foreign app does not use. A reviewer opened `ai.css` and found
`html[data-xray] [data-surface]`, where `data-surface` is not a name the app does not use: it is the
entire Tier 1 contract, the one thing PANTRY asks a project to add. The rule was inert because nothing
PANTRY injects sets `data-xray`, so the leak needed the reviewed app to set that attribute itself. That
is a thin reason to be safe and it is not the reason the comment gave. The bound is enforced now
instead of asserted: every rule reaching for `html`, `body` or a `data-` attribute is dropped, and a
test asserts no attribute selector stands alone anywhere in what is served.

**The already-running check was wrong in both directions.** It missed a bundler's hashed filename, so a
GRAIN host with a bundler got two tour clients driving one `sessionStorage` key. And it matched a
commented-out or `type="text/plain"` tag, so PANTRY withheld its own client and Tier 1 vanished with
nothing on screen to say why. The two fail differently and the silent one is worse, which is why the
check walks script tags now rather than pattern-matching the document.

**Stripping a conditional request on `Accept` alone reached a POST.** A browser form submission carries
`Accept: text/html` too, so `If-None-Match: *` — create only if absent — had its precondition removed on
the way upstream, turning an atomic create into an unconditional overwrite. Read requests only now, and
`Sec-Fetch-Dest` where the browser sends it, because that header says what the request is rather than
what the caller would accept back.

**The meta-CSP strip cut a tag in half.** `[^>]*>` stops at the first bracket and a policy value may
legally contain one, which left the remainder as loose text in the head: removing too little and
corrupting the document in the same edit. Writing the quote-aware version then produced its own
opposite failure, caught by a test written in the same sitting: matching the pattern anywhere in the
tag deleted `<meta name="note" content="we set http-equiv=Content-Security-Policy at the edge">`, a tag
that sets no policy and describes one.

**And one the reviewer set aside as out of scope, which was worth picking up.** The review rail's six
cockpit links were written carrying `/__pantry` already, and PANTRY rebases its own root-absolute
hrefs on the way out, so every one of them resolved to `/__pantry/__pantry/…` and 404'd. It had been
that way since P1, through a build, a walk and two reviews. The header nav two inches above uses
root-relative hrefs and was always correct, which is exactly why nobody looked at the other half.
Fixed in `743f4cd` with a test that the prefix never appears twice in the shell.

Two more were accepted as stated tradeoffs rather than fixed: an explicit `toursDir` that does not
exist is still honoured, and now warns at boot; and the injection still reaches the app's own 404 and
500 pages, which is deliberate, because the reviewer is meant to see the app's error page inside the
review rather than a page with the chrome missing.

## What was NOT done

**P4d, capture at run time.** The harness that drives the app step by step, fails loudly on a surface
that is not there, and writes the states into `artifacts/reviews/<id>/` so a review reads when the app
is not running. The design is settled and the reason it is not built here is scope, not doubt: this run
had two walks and two reviews in it already, and a capture harness needs a browser driver, which is the
first thing in this plan that would make PANTRY need to know how to run a project rather than read one.
The plan's own cost section names that as the line to watch.

**Nothing was written into ph-live.** That was the owner's call and it is the right one; the attribute
diff is a proposal, below.

## What needs human eyes

**Walk `content/tours/review-tier1-nongrain.md` against the fixture, and answer its two questions.**
They are the ones this run cannot answer for itself: whether lighting an element by name reads as more
useful than a screenshot would have, and whether sprinkling `data-surface` into a real app's markup is
a price worth paying. Both steer whether the ph-live diff is worth applying at all. Start the fixture
with `PORT=5210 bun run start` in `/tmp/tier1-proof` (rebuild with `bun run build` if the machine has
been restarted), then `bun ../pantry/cli.ts serve --port 4400 --preview http://localhost:5210` from the
portfolio.

**The review rail's Record button is still unverified, and now for the second run in a row.** The owner
confirmed on 2026-08-10 that they have not walked `content/tours/review-answer-channel.md`. The browser
automation wedges on the review shell's same-origin iframe, so the control cannot be clicked from here;
its exact POST path has been run verbatim and lands answers correctly, but the button itself has never
been pressed by anything. One click closes it.

**The ph-live attribute proposal wants a yes or a no.** Ten attributes with file and line in
`artifacts/reviews/2026-08-10-tier1-nongrain/ph-live-data-surface-proposal.md`, plus the route to walk
first (the create-event wizard's media step, which runs against a local production build with no auth
and no backend) and two traps: the app already carries its own `data-tour` convention for a different
tour engine, and its most-reused component is exactly the wrong place for a shared address.
