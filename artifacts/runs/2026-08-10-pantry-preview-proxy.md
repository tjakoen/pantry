---
title: The dev preview proxy, so PANTRY can serve a project under its own origin
date: 2026-08-10
status: complete
lane: gated
branch: main
scope:
  - pantry
  - tjakoen.github.io/plans
  - tjakoen.github.io/content/tours
touched:
  - pantry/preview.ts
  - pantry/preview.test.ts
  - pantry/pantry-review-client.js
  - pantry/app.ts
  - pantry/cli.ts
  - pantry/config.ts
  - pantry/pantry-cmdk.js
  - pantry/pantry-map.js
  - pantry/INSTALL.md
  - pantry/package.json
  - pantry/app.test.ts
  - pantry/doctor.test.ts
  - pantry/drift.test.ts
  - pantry/init.test.ts
  - pantry/retrieval.test.ts
  - pantry/skills.test.ts
  - pantry/artifacts/reviews/2026-08-10-preview-proxy/
  - pantry/artifacts/runs/2026-08-10-pantry-preview-proxy.md
  - tjakoen.github.io/plans/pantry-review-layer.md
  - tjakoen.github.io/content/tours/review-pantry-preview-proxy.md
skills:
  - loop-standard
  - session-loop
  - tour-standard
plans:
  - pantry-review-layer
gates:
  - bun test (pantry) | 343 pass, 3 fail, 1044 expect() calls, 346 tests across 14 files
  - bun test (pantry, at HEAD before this change) | 302 pass, 3 fail — the same 3, in a scratch worktree
  - tsc --noEmit (pantry) | clean, no output
  - oxlint (pantry) | 23 warnings, 0 from any file this run added or created
  - bunx proof verify plans (portfolio) | 18 plans, 1 changed file(s) vs HEAD, 2 problems, OK
  - bun cli.ts doctor (pantry) | 14 checks, 0 failing, 4 due
  - browser walk, portfolio through the proxy | 0 page errors, 0 failed requests
  - browser walk, Next 15 production build through the proxy | 0 page errors, 0 failed requests, React hydrated (counter 0 to 2 on two clicks)
  - crumb check content/tours (local 0.1.9) | 8 tours, all pass
  - crumb check content/tours (pinned 0.1.7) | flags this tour and review-prompt-card for the ## prompt section the pin predates
diffstat: pantry 5 commits, 16 files changed and 3 created (preview.ts, preview.test.ts, pantry-review-client.js) plus 4 evidence screenshots and this report; portfolio 2 commits, 1 plan file and 1 new tour
dirty:
  - artifacts/runs/2026-08-09-conformance-and-handover.md | in the PORTFOLIO, staged as deleted by another session, deliberately left exactly as found
unpushed: 45 | 20 portfolio + 15 pantry + 4 grain + 6 claude-config, measured after this run's own commits; pushing is owner-gated
verifiedBy: two independent reviewers that did not write the change, plus a browser walk of both targets. Between them they found six defects the author had not, one of them an open relay. Every finding was reproduced before being accepted and every fix carries a regression test.
doctor: re-run after committing, 14 checks 0 failing 4 due; it rejected this report twice (prose scope, no Gate output section) before accepting it, and the 4 due items are pre-existing and carried forward by name below
---

## Gate output

Verbatim, from the tails of each run. The declared envelope was `pantry` plus the one plan file in
the portfolio, and everything touched sits under those two.

```
$ bun test                                   # pantry, after the review fixes
 343 pass
 3 fail
 1044 expect() calls
Ran 346 tests across 14 files.

$ bun test                                   # pantry at HEAD, scratch worktree, before
 302 pass
 3 fail
(fail) buildKnowledge — the machine brain > plans come from PROOF's derived index over the host's real plans folder
(fail) renderLlmsTxt — the session context pack (same brain, human projection) > llmstxt.org shape: H1 project, summary blockquote, plan + doc sections with fetchable links
(fail) pantry cockpit surfaces > AI-retrieval (piece 9): /knowledge.json is the machine brain over this project

$ bun run check
$ tsc --noEmit
(no output)

$ bun run lint
23 warnings, none in preview.ts, preview.test.ts or pantry-review-client.js

$ bunx proof verify plans                    # portfolio, where the plan lives
[warning] (none) touches: artifacts/runs/2026-08-09-conformance-and-handover.md is outside every plan's touches
[warning] runs-surface-polish touches: every touches entry points outside this repo (../pantry/app.ts, ../pantry/pantry.css, ../pantry/app.test.ts), so nothing about it can be verified here
18 plans, 1 changed file(s) vs HEAD, 2 problems
OK

$ bun cli.ts doctor                          # pantry
[warn] graphify freshness: graph built from c4f86611, code moved since — run graphify update .
[warn] e2e suite present: no e2e suite — the mechanical gate can't run end-to-end
[warn] layer pins current: 2 behind: grain 0.1.12<0.1.19, proof 0.1.2<0.1.3 — run deps:refresh
[warn] run ledger: 2 of 8 run reports missing evidence: 2026-08-07-s3b-run-ledger, 2026-08-07-s4-graphify-symbol-drift
14 checks, 0 failing, 4 due
OK

$ browser walk (playwright, chromium)
01-portfolio-through-pantry: review-client={"base":"/__pantry","phase":"p0","sameOrigin":true} errors=none
   hydration: "clicked 0" -> "clicked 2"
02-next-through-pantry: review-client={"base":"/__pantry","phase":"p0","sameOrigin":true} errors=none
03-pantry-own-home-under-prefix: review-client=ABSENT errors=none
04-pantry-board-under-prefix: review-client=ABSENT errors=none
```

`review-client=ABSENT` on the last two is the correct result, not a miss: the client is injected into
a proxied page and never into PANTRY's own.

## What this run did

P0 of the review-layer plan, and only P0. PANTRY can now serve another local project **at its own
root**, under its own origin, with one script tag injected into HTML responses and nothing else about
that project touched.

The shape was settled before any code was written, so this is a report on whether it held rather than
on what to build.

**PANTRY's own routes move; the reviewed project owns the root.** With `previewTarget` set in the
host config, every PANTRY surface answers under `/__pantry` and everything else is passed straight
through. That is the whole reason no URL rewriting is needed: the app's root-relative URLs resolve
because the root really is the app. The cost lands on PANTRY instead, which now rebases its own
output, and that trade is the right way round because PANTRY is the thing that moved.

**The bounds are in the build.** The target is read from config and never from a request, so there
is no open-relay shape available here even by accident. It must be an origin, loopback, with no path
and no credentials; a target that fails any of those is refused with a reason and the proxy stays
off, which is also what an absent key does. Websocket upgrades are refused with a 501 that says to
review a production build, rather than half-handled. Request bodies are capped at 8 MB and HTML is
only buffered up to 4 MB, above which it streams uninjected.

**One byte changes on a proxied page.** `pantry-review-client.js`, injected before the closing body
tag. It exposes `window.__pantryReview` and does nothing else on purpose: the tour client, the
spotlight and the decision card are P1 and P2, and building them here would make the proxy hard to
tell apart from the thing it carries.

## The proof, in the order the handoff asked for it

**The portfolio first, as the easy target.** A direct fetch of `/` and a fetch through PANTRY differ
on exactly one line and by exactly 63 bytes, which is the injected tag:

```
direct bytes:    39866  proxied bytes:    39929
539c539
< …<script type="module" src="/crumb-live.js"></script></body>
> …<script type="module" src="/crumb-live.js"></script><script src="/__pantry/pantry-review-client.js" defer></script></body>
```

`/notes`, `/grain`, `/standards/voice` and the stylesheets all answered 200 through the proxy, and a
browser walk reported no page errors and no failed requests.

**Then a Next.js 15.5.4 production build, as the target that decides whether this generalises.**
There was no Next project on this machine, so one was scaffolded in `/tmp/next-proof` with an app
router page, a client component, a static asset, a cookie-setting API route and a dynamic page that
reads that cookie. It was built with `next build` and served with `next start`, a production build
and not a dev server, as the plan requires.

```
/_next/static/chunks/255-4efeec91c7871d79.js        200 application/javascript 171822b
/_next/static/chunks/4bd1b696-c023c6e3521b1417.js   200 application/javascript 173019b
/_next/static/chunks/app/page-4e83c50ed5d8b044.js   200 application/javascript 376b
/_next/static/chunks/main-app-95070c53b2d212e2.js   200 application/javascript 557b
/_next/static/chunks/polyfills-42372ed130431b0a.js  200 application/javascript 112594b
/_next/static/chunks/webpack-078f6dfb37dff419.js    200 application/javascript 3310b
/logo.svg                                           200 image/svg+xml
/whoami (RSC: 1)                                    200 text/x-component
direct 4901b -> proxied 4964b
```

Again 63 bytes, again one line. The RSC flight stream passes through as a stream, because only HTML
is ever read into memory. React hydrated: the browser walk clicked the client component twice and
the label went from `clicked 0` to `clicked 2`, which is the claim that actually matters, since a
page that renders but does not hydrate would look fine in a screenshot.

Evidence: `artifacts/reviews/2026-08-10-preview-proxy/` (four screenshots, both targets through the
proxy plus PANTRY's own home and board under the prefix).

## The cookie warning, and what actually happened

The plan and the handoff both flagged auth cookies as the thing most likely to make the first
attempt look broken for an unrelated reason. It was worth flagging and it did not bite, for a reason
worth writing down: **cookies ignore port.** A target on `localhost:5200` and PANTRY on
`localhost:4402` are the same cookie host, so a session set through one is sent to the other. The
login round trip works end to end:

```
status:     HTTP/1.1 303 See Other
location:   /whoami
set-cookie: np_session=abc123; Path=/; HttpOnly
then GET /whoami through PANTRY -> <p id="who">session=abc123</p>
(no cookie)                     -> <p id="who">anonymous</p>
```

Two caveats stay live. A target on `127.0.0.1` with PANTRY on `localhost` **are** different cookie
hosts and would break, so keep both on the same name. And a target serving https locally would set
`Secure` cookies that an http PANTRY cannot carry, so `Secure` is stripped when PANTRY itself is not
on https; that is deliberate, dev-only, and stated in the code rather than left as a surprise.

## Two defects the browser walk found that reading the code did not

Both are the same shape, PANTRY addressing the root it has just given away.

**An absolute redirect throws the browser out of the review.** Next builds its redirect Location from
the upstream request, so `POST /api/login` answered `http://localhost:5200/whoami`. Followed as-is,
that leaves PANTRY's origin entirely and lands on the raw target, where the review layer does not
exist and would not know it had lost the page. A Location on the target's own origin is now rewritten
to a path; a Location anywhere else is left alone, because PANTRY has no business in an external
auth hop.

**PANTRY's own stylesheet fired a request at the reviewed app.** GRAIN's `variables.css` loads its
display font from `url("/fonts/…")`. With only the HTML rebased, that request went to the root, which
is now the reviewed project. The class of bug is worse than the one font: a review layer that leaks
its own traffic into the thing it is observing will eventually report on traffic it caused. CSS is
now rebased alongside the HTML, and this is the reason the browser walk exists as a gate rather than
a screenshot.

## The second pass, and what it cost to skip it the first time

Two reviewers with no part in writing this read the diff. Six defects, every one
reproduced before it was accepted, every fix carrying a regression test that fails without it.

**An open relay, and the only genuinely serious finding.** A pathname is a string, and a URL
constructor reads a leading double slash as scheme-relative, so a request for `//example.com/x`
resolved against the target origin became `http://example.com/x`. The loopback check passed at boot
and a request walked around it. Backslashes arrive in the same shape, because URL parsing folds them
into leading slashes. Reproduced in one line before it was believed:

```
new URL("//example.com/x", "http://localhost:5200").href  ->  http://example.com/x
```

Two defences now, not one: the leading run of slashes is collapsed, and the resulting origin is
asserted against the configured target before anything is fetched. The second exists because the
first is a regex.

**The cap trusted a header the case that matters does not send.** HTML injection was gated on
Content-Length, so a streaming SSR response, which sends none, was buffered with no bound at all
while a large one skipped injection for an unrelated reason. The cap now counts bytes actually read;
past it, what was read is replayed ahead of the untouched remainder, so nothing is lost and nothing
is held. A 5 MB chunked page and a small chunked page are both under test.

**The response path and the push path are not the same path.** PROOF broadcasts a rebuilt board over
SSE and the client assigns it with innerHTML, which never passes through this server's response path,
so the first save after any edit would have silently undone the prefix rebase on the one surface a
live board exists to keep correct. This is the finding worth the whole exercise: it is invisible in
a diff and invisible in a page load.

**A bug PANTRY has always had, preserved faithfully by the move.** PROOF emits a plan card as
`href="/plan/<id>"` whatever prefix it is mounted under, so a card on PANTRY's board has never opened
a plan. The portfolio carries the identical workaround in its own server. Two copies of the same
patch is the honest signal that PROOF should be taking the prefix, and that is now a named item
rather than a third copy waiting to happen.

**Two smaller ones:** `srcset` was a quiet exception to the rebase rule and is no longer one, and the
board-live channel is matched by shape rather than by one exact literal that a reformat would break.

**One finding was rejected after checking.** A reviewer read the injected client as working "by
accident" because it is not rebased. It derives its base from its own script URL at runtime, which is
deliberate and more robust than rebasing, so nothing changed there.

## What was NOT done

- **P1 through P4.** Untouched, on instruction. No review chrome, no step rail, no decision card, no
  write-back, no Tier 1 attributes. `pantry-review-client.js` is a stub with a marker and a log line,
  and the plan's three open questions are still open and were not answered by building this.
- **Websocket passthrough.** Refused with a 501 rather than half-implemented. `next dev` will not
  work through this and is not meant to; the plan calls this a later upgrade.
- **No doctor check for the preview config.** The plan lists `doctor.ts` in its touches, but a
  freshness check over a dev-only key would fire in every repo that has never set it. Left for
  whichever phase gives it something to be stale about.
- **The 3 pre-existing test failures were not fixed.** All three come from `pantry/../proof/example`,
  a fixture path that stopped existing when PROOF folded into `grain/packages`. They fail identically
  at HEAD in a clean worktree (302 pass, 3 fail there; 343 pass, 3 fail here), so this run added 41
  tests and no failures. Fixing the fixture path is real work and is not P0.
- **PANTRY still cannot host a tour of its own.** No `crumb-live.js`, no tours folder, no
  `data-surface` addresses on its chrome. The tour written for this change gets round that by running
  on the site PANTRY is proxying, which does host CRUMB. Giving PANTRY its own tour host is P1.
- **PROOF still emits the wrong plan-card link.** Patched here, patched separately in the portfolio.
  The right fix is in PROOF, which should take the prefix it is mounted under, and that is a grain
  change and a release, so it is named rather than made.

## The tour

`content/tours/review-pantry-preview-proxy.md`, three steps, dev mode. It runs on the proxied
portfolio rather than on PANTRY, because PANTRY cannot host a tour yet and the site it proxies can.
That is not a workaround so much as the point: CRUMB's client, the tour data and every asset in the
walk reach the reviewer through the proxy, so the walk happening at all is part of what it proves.
PANTRY's own chrome is covered by a verify line rather than a step, which is the honest limit.

Start it with the tour id as a query parameter on the proxied site, on PANTRY's port:

```
http://localhost:4400/?crumb=review-pantry-preview-proxy&crumb-mode=dev
```

Note the pinned `@tjakoen/crumb` in the portfolio is 0.1.7, which predates `## prompt` sections, so
`bunx crumb check` flags this tour and the existing `review-prompt-card` identically. The local 0.1.9
passes both. That is a pin gap, not a tour defect.

## What needs human eyes

- **Scope grew past the plan's `touches`, and the plan was updated rather than the growth being
  asked about.** P0 needed `cli.ts`, `preview.ts`, the two client scripts and `INSTALL.md`, none of
  which the plan listed when it was written. Confirmed by the owner after the fact.
- **`servePantryFromCwd` changed its return type** from the server to `{ server, config }`. Only
  `cli.ts` calls it, but it is an exported function of an installable package. Left as is on the
  owner's call; the CLI has to know whether the doors moved, and no other caller exists.
- **Two long-standing bugs were fixed on the way past, and both are worth a look because neither was
  in the plan.** PANTRY now mounts `/fonts/*`, so the cockpit's display face renders for the first
  time; the cockpit will look different, and that is why. And a plan card on the board now links to a
  route that answers.
- **Doctor's four due items, all pre-existing and carried forward by name:** graphify freshness (graph
  built from `c4f86611`), no e2e suite, layer pins 2 behind (grain 0.1.12 < 0.1.19, proof 0.1.2 <
  0.1.3), and 2 of 8 older run reports missing evidence.
- **Nothing is pushed.** 45 commits across four repos, counted above. Owner-gated. The handoff into
  this run said 16 portfolio and 8 pantry; the measured numbers before this run started were 18 and
  9, so two of those came from elsewhere. Worth knowing before anyone treats a stated count as fact.
