---
id: claude-pane-actions
status: doing
track: app
depends: []
touches: [claude-plugin/]
owner: ai
---

# Make the Claude pane something you act from

The PANTRY pane beside the chat showed four counts and a list of titles. It now leads with the plan
this session holds, gives each waiting item an Open button and an Ask Claude button, lets a ready plan
be started with Work on this, lists only live claims from other sessions, and hands drift to Claude
with its fix prompt.

## Steps

- [x] Lead with this session's plan, found in any project
- [x] Real buttons, spacing, weight for state
- [x] Start a ready plan here, in a new session, or in a child agent
- [x] Drift listed with context and a fix button
- [x] Show when it last refreshed
- [x] Show plan progress and running child agents
- [x] Owner signs off on the look
- [x] Tests updated and committed

Done when the pane renders this session's plan, the buttons do what they say, and the owner has seen it.
