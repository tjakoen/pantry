---
id: chat-2026-11-21-pantry-ui-audit
status: done
track: chat
depends: []
touches: [chrome.ts, brief-routes.ts, orchestrator.ts, pantry.css, app.test.ts]
owner: ai
---

# Fix what the UI audit found, and make the navigation one shape

The owner installed the Dashboard Design and Design review skills and asked for every finding from
their audit of the hub, Now and Plans pages to be fixed, and for the navigation to be more intuitive.

- [x] Raise muted text in PANTRY's chrome to at least 4.5:1
- [x] Make every control at least 24px tall
- [x] Drop empty columns from the Plans board, and the todo chip a ready card already implies
- [x] Draw "+N more" as a count, not a button
- [x] Stack the hub and Plans boards into one column on a phone
- [x] Fold the keyboard shortcuts behind a toggle
- [x] Take controls and icons off the browser's default type size
- [x] Give project pages the hub's shape: PANTRY leads to All projects, which stays in view; rename the Project view to Map; count the views under More
- [x] Re-measure, restart the hub and show the result

## What we learned

- Topic: hub
- Changed: Muted text in PANTRY's chrome meets 4.5:1, controls are at least 24px, the Plans board drops empty columns and a duplicate chip, boards stack on a phone, shortcuts fold behind a toggle, and project pages share the hub's navigation with All projects always in view and the Project view renamed Map.
- Why: An audit against the Dashboard Design and Design review skills measured each finding in the browser at three widths, and the owner asked for all of them plus clearer navigation.
- Dropped: A dark-mode fix: PANTRY applies the owner's saved theme on purpose, so not following the system setting is by design.
- Remember: GRAIN's --ink-muted is 3.47:1 on PANTRY's sidebar; PANTRY mixes it toward ink locally, but the real fix belongs in GRAIN's token.
- Closed: 2026-11-20T21:39:20.035Z by claude (claude-opus-5-5) on Tjakoens-MacBook-Air.local
