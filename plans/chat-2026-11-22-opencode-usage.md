---
id: chat-2026-11-22-opencode-usage
status: doing
track: chat
depends: []
touches: [usage.ts, opencode-usage.ts, opencode-usage.test.ts, usage-page.ts, package.json, CLAUDE.md, PLAN.md, INSTALL.md]
owner: ai
---

# Attribute OpenCode usage to its actual provider and project

Read OpenCode's per-message usage through its authenticated local API, preserving provider, model, variant, session and subagent identity. Report free, paid and unknown separately, without interpreting a zero reported charge on a paid route as a free offer. Keep the existing Claude transcript reader and prove the adapter with fixtures and a live session.
