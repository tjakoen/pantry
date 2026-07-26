# The decision inbox

This folder is PANTRY's decision inbox (piece 11d). An agent writes a decision it needs a human to
make as a markdown file here; PANTRY renders it read-only at `/decisions`, and the human resolves it by
generating a prompt to paste back into chat. PANTRY runs no model and writes nothing — the generated
prompt is the only write path, and the agent records the resolution (including flipping `status:` to
`resolved`) as part of acting on it. The file doubles as the ledger entry (LOOP.md §4).

This `README.md` is documentation, not a decision — the inbox skips it. Real decisions are the other
`*.md` files here.

## The file shape

The frontmatter uses only what MILL's parser understands (scalars + dash-lists — no nested objects), so
options are plain strings and each evidence entry is `label | href` (the href is optional):

```markdown
---
title: Where should the run ledger live?
status: open                 # open | resolved (default: open)
options:
  - PROOF board schema — one source, needs a schema pinned
  - A flat markdown log — simplest, no queries
recommendation: PROOF board schema — one source, needs a schema pinned
evidence:
  - LOOP.md piece 11c | /docs/plans/pantry
  - the drift fold-in precedent          # label-only is fine
---
The context an owner needs to decide, in prose. Rendered on the detail page above the options.
```

- **title** — the question. Falls back to the first heading in the body, then the filename.
- **status** — `open` (needs a human) or `resolved` (the ledger tail). Open sorts first everywhere.
- **options** — the discrete choices; rendered as radios on the detail page.
- **recommendation** — the agent's pick, verbatim (should match an option); flagged in the UI.
- **evidence** — links the human should see while deciding (in-cockpit paths like `/docs/…` or URLs).

## The loop

Autonomous runs always route decisions here (chat has nobody in it); interactive sessions use the inbox
for artifact-heavy calls and chat for quick ones. Open decisions also lead the AI-retrieval context pack
(`/llms.txt`), so the next agent resolves them before it proceeds.
