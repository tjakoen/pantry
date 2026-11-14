---
id: pantry-session-control
status: done
track: app
depends: []
touches: [mcp.ts, app.ts, chrome.ts, decisions-page.ts, session-door.ts, session-client.ts, INSTALL.md, app/]
owner: ai
---

# Let sessions see and drive the PANTRY window

The app now opens at session start, but a session cannot do anything with it. It can claim a plan
through MCP, yet it cannot show the owner that plan, open a decision for an answer, or tell what the
owner is looking at. This plan wires the window into the session the way GRAIN wires a page into a
model: the page declares what can be done, the session reads that, and every move goes through a
door that checks it.

## The GRAIN shape, applied here

- Every actionable thing on a PANTRY page declares itself with a surface address, the way GRAIN pages
  do: a plan card, a decision, a tile, a sidebar view, the preview pane.
- Each surface kind carries verbs with a description, a payload schema and hints (read only,
  destructive, idempotent). Verbs are shaped like the affordance a person uses, not like the function
  under it: open a plan, show a view, answer a decision, filter by a tile.
- The page harvests its own manifest from the live DOM and marks readable state, so a session can
  observe what is on screen before it acts.
- A move that is not legal on the live manifest is refused with the valid moves named, so the session
  corrects itself instead of guessing.

## How a session reaches the window

1. The window holds a live channel to the hub (server-sent events or a websocket).
2. New MCP tools on the hub: one to observe (the current manifest and readable state of the window for
   a project), one to act (a move, validated against that manifest, then dispatched to the window).
3. The owner sees every move happen in the window. A destructive verb, such as recording an answer on
   the owner's behalf, is not offered to sessions at all; an answer stays the owner's.

## Also fix

- pantry open from a session lands on the all-projects page rather than the session's project. Find
  whether the project name is not resolved from the session's directory, the deep link is not
  registered, or the app ignores the link, and fix the cause.
- When a link arrives, the app window comes to the front.

## Tasks

- [x] Fix pantry open landing on all projects, and bring the window forward on a link
- [x] Surface addresses and verbs on the command center, plans board and sidebar
- [x] Manifest harvest and readable state in the page, reusing GRAIN's ai modules where they fit
- [x] Window to hub channel
- [x] MCP observe and act tools, with the door's refusals naming valid moves
- [x] Tests for each verb and for a refused move
- [x] Prove it end to end: a session opens a plan in the running app, and a screenshot shows it

## Done when

From a Claude session, observe returns what the app shows, act opens a named plan and the app shows
it, an illegal move is refused with the valid ones listed, and the tests and typecheck pass.

## What was built (2026-11-14)

- `session-client.ts`, served bundled as `/pantry-session.js` on every page, declares the surfaces in
  one table: `plan:<id>`, `decision:<id>`, `view:<name>`, `tile:<name>`, each readable and carrying
  its link, plus the page as the `screen` surface that accepts only GRAIN's `navigate`. It harvests
  with GRAIN's `domManifest` and reports to the project server, which keeps it in `session-door.ts`.
  The declarations sit in PANTRY because the plans board is PROOF's markup, which PANTRY never edits.
- `pantry_observe` and `pantry_act` on the hub's MCP. A move goes out on the page's own SSE stream to
  the most recently loaded or focused window, and the act returns once that window reports arriving.
- `/stream` requests turn off Bun's ten-second idle timeout, which was closing every quiet stream,
  the board's live updates included.
- `pantry open` landing on all projects: the project name resolved correctly; the app lost the link.
  A link that launches the app arrives before `on_open_url` is registered, so `main.rs` now reads
  `get_current()` at setup, and a pending link is honoured even when the window is already on the hub.
  It comes to the front when it navigates.

## Notes

- GRAIN stays unchanged, by the owner's choice on 2026-11-14. The case for GRAIN: PANTRY's plans,
  decisions, views and tiles are push-only kinds there today, so the only move is `navigate` to a
  link they carry. Kinds like `plan` with affordance-shaped verbs (`plan.open`, `view.show`,
  `tile.filter`) would let the manifest say what each surface does. That is design work for GRAIN.
- Verified on a test hub on port 4490 and a debug app build with its own identifier: observe,
  a refused move listing the valid ones, and act moving the app from the command center to the
  board to this plan. A second launch carrying `pantry://project/pantry` landed on the project. The
  cold-launch `get_current()` path needs a bundled app registered for `pantry://`, so it was not
  exercised; check it after the next install.
- `bun run lint` reports five `no-unsafe-optional-chaining` errors in `mcp.test.ts`, unchanged from
  main and left for a separate fix.
