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
