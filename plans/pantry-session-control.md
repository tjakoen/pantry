---
id: pantry-session-control
status: todo
track: app
depends: []
touches: [mcp.ts, hub.ts, hub-ensure.ts, chrome.ts, brief-routes.ts, app/]
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

- [ ] Fix pantry open landing on all projects, and bring the window forward on a link
- [ ] Surface addresses and verbs on the command center, plans board and sidebar
- [ ] Manifest harvest and readable state in the page, reusing GRAIN's ai modules where they fit
- [ ] Window to hub channel
- [ ] MCP observe and act tools, with the door's refusals naming valid moves
- [ ] Tests for each verb and for a refused move
- [ ] Prove it end to end: a session opens a plan in the running app, and a screenshot shows it

## Done when

From a Claude session, observe returns what the app shows, act opens a named plan and the app shows
it, an illegal move is refused with the valid ones listed, and the tests and typecheck pass.
