---
title: P3, preset a page's own state via URL state
date: 2026-08-10
status: complete
lane: high
branch: main
scope:
  - view/pages/
  - e2e/
  - content/tours/
  - docs/
  - plans/
touched:
  - view/pages/calendar.html
  - e2e/calendar.e2e.ts
  - content/tours/review-calendar-feed-state.md
  - docs/HACKING.md
  - docs/crumb/WRITE-A-TOUR.md
  - plans/crumb-prefilled-demo.md
skills:
  - loop-standard
  - tour-standard
  - voice
plans:
  - crumb-prefilled-demo P3 | /plans/crumb-prefilled-demo
gates:
  - bun run check | clean
  - bun test | 328 pass, 0 fail
  - playwright test calendar | 15 pass, 1 fail (pre-existing, media drift)
  - bunx crumb check content/tours | 11 tours, all valid
  - bun tools/voice-lint.ts content/tours/review-calendar-feed-state.md | 0 flags
diffstat: 6 files changed, 137 insertions(+), 5 deletions(-)
dirty:
unpushed: 12 | portfolio 6, pantry 6; the push is the owner's call and still open
verifiedBy: a browser walk of the tour plus four new e2e cases, neither of which is the code's own reading of itself
doctor: 0 failing, 4 carried: graphify-freshness, e2e-presence, layer-pins, run-ledger (2 older reports, not this one)
---

The phase asked for one page that reads state out of the URL and presets itself from it, so a tour
can land someone on a page already in the right condition. P0 had already built the other end: a
step's `at` may carry query state and reaches it in one navigation.

**Why the calendar feed, and not the first candidate.** Three pages hold state a link might carry.
`/about` already routes its tabs from `location.hash`, and `/notes` already reads `?tag=`, so neither
was a gap. That left the calendar's feed tabs and the mail folders. The mail folders lost on honesty:
archiving moves a letter to the Archive folder for the visit only, so a `?folder=archive` link would
show the sender one set of letters and the recipient another. The calendar's tabs are a pure filter
over a server-rendered list, so the same address gives everyone the same view, which is the property
a preset needs. It is also the shape P2 flagged as the one worth looking for: a filter a person can
click but cannot link, reload into, or come back to, is a real defect for people before it is a
missing capability for tours.

**What was built.** The tab lives in the URL as `?feed=notes|all`, read on boot and written back on
every click with the same `history.replaceState` the notes feed already uses for `?tag=`. The default
tab drops the parameter, so a plain calendar link stays plain. An unknown value lands on the default
rather than an empty page. Every parameter the island does not own is carried through rather than
rebuilt away, because a tour arrives with its own `?crumb=` and it is not this island's to discard.

The preset is honest in the sense the phase asked for: clicking a tab is what produces the address, so
`at: /calendar?feed=notes` asks for nothing a visitor could not have asked for by hand. A parameter
only a tour could ever set would have been a back channel wearing a query string.

**One thing the walk found that no test would have.** The tour's popover can sit directly over the
feed tabs, so the verify line as first written told the reviewer to click a control the card was
covering. `elementFromPoint` at the Notes tab returned the popover's own paragraph. The verify line
now says to exit the tour before that half of the check. This is a CRUMB placement matter rather than
a P3 one, and it is left as a note rather than chased.

## Gate output

```
$ bun run check
$ tsc --noEmit

$ bun test
 328 pass
 0 fail
 1298 expect() calls
Ran 328 tests across 20 files. [2.61s]

$ bun run test:e2e calendar
  ✓   7 e2e/calendar.e2e.ts:87:3 › clicking a tab writes it into the URL; the default tab drops the parameter (798ms)
  ✓   8 e2e/calendar.e2e.ts:100:3 › ?feed=notes presets the feed on arrival: tab selected, only notes shown, no click (593ms)
  ✓   9 e2e/calendar.e2e.ts:113:3 › an unknown ?feed= value lands on the default rather than on an empty feed (495ms)
  ✓  10 e2e/calendar.e2e.ts:122:3 › a parameter the feed does not own survives a tab change (a tour arrives with its own) (548ms)
  ✓   3 e2e/calendar.e2e.ts:55:3 › a note-publish-date card is in the feed too, with no photo strip (1.1s)
  ✘  14 e2e/calendar.e2e.ts:185:3 › the calendar photo lightbox (no JS) › a photo is still a real link to the full image (no-JS-safe fallback) (5.3s)
    Expected pattern: /\.svg$/
    Received string:  "/media/feed/gdgoc-hau-speaker-card.jpg"
  1 failed
  15 passed (9.8s)

$ bunx crumb check content/tours
✓ review-calendar-feed-state — 2 step(s), dev
(11 tours, all valid)

$ bun tools/voice-lint.ts content/tours/review-calendar-feed-state.md
voice-lint: 0 flag(s) across 1 file(s) (0 tell, 0 warn).
```

Browser walk of `content/tours/review-calendar-feed-state.md`, dev mode, against a local server:

```
step 2 of 2, after one Next:
  url:          http://localhost:3141/calendar?feed=notes
  selectedTab:  notes
  visibleCount: 12
  kinds:        ["note"]
  hiddenCount:  9
  navEntries:   2          (one navigation, no reload loop)

tab round trip, tour exited:
  click All    -> http://localhost:3141/calendar?feed=all
  click Events -> http://localhost:3141/calendar
```

## What was NOT done

- **P1b, the portfolio e2e for P0 and P1.** Owner-gated, and out of this run's scope by instruction.
  Worth flagging that its stated blocker has moved: the pin is now `@tjakoen/crumb` 0.1.9 from the
  registry (`bun.lock` carries a real integrity hash, taken in `aaafe7c`), and 0.1.9 ships both the
  `prefill` key in `core/schema.ts` and the P0 route fix in `core/nav.ts`. P2's closing note, that the
  pinned parser predates the key and reads the line as prose, is stale. Nothing was done about it.
- **Flow verbs.** Deferred by the plan and not needed here. Nothing in this change wanted one.
- **The one pre-existing e2e failure**, the no-JS lightbox expecting a `.svg` and getting the
  `.jpg` that landed in `3a92d51`. JavaScript is disabled in that spec, so no code from this run can
  reach it. Media drift, someone else's thread, left alone.
- **A `data-surface` for the Calendar dock row.** Notes, Plans and About carry one; Calendar does not,
  so the tour lights the app shell rather than the row that leads to the feed. Registering it is a
  one-attribute edit to a shared organism and was not this phase's ask.
- **A history entry per filter.** The tab replaces the URL rather than pushing it, so Back leaves the
  page instead of undoing the filter. That matches the notes feed exactly; changing it would change
  both. The tour's prompt card asks the owner which way to go.

## What needs human eyes

- **Was the calendar the right page to prove this on?** The reasoning is in the run above and in the
  tour's own prompt card, but the judgement is the owner's. If preset state would earn more somewhere
  else, this is the cheap moment to say so.
- **Back button behaviour.** `replaceState` was chosen for consistency with the notes feed, not
  because it is obviously right. A filter that is worth linking may be worth undoing.
- **Two backtick flags** in the lines added to `docs/crumb/WRITE-A-TOUR.md`. They name a grammar key
  and a file path, matching the convention the rest of that file already uses, and the file carries
  seventy such flags today. Kept for consistency rather than fixed; the judgement half of VOICE is a
  human's.
- **The tour is walked but unmarked.** The statuses in it are this session's claim. Nobody has pressed
  Record answer on its prompt card, which stays true of every tour on disk.
