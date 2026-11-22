---
id: chat-2026-11-22-opencode-usage
status: done
track: chat
depends: []
touches: [usage.ts, opencode-usage.ts, opencode-usage.test.ts, usage-page.ts, package.json, CLAUDE.md, PLAN.md, INSTALL.md]
owner: ai
---

# Attribute OpenCode usage to its actual provider and project

Read OpenCode's per-message usage through its authenticated local API, preserving provider, model, variant, session and subagent identity. Report free, paid and unknown separately, without interpreting a zero reported charge on a paid route as a free offer. Keep the existing Claude transcript reader and prove the adapter with fixtures and a live session.

## Run evidence

- `bun run check`: `tsc --noEmit`, exit 0.
- `bun test`: 975 pass, 0 fail, 2600 expect calls across 49 files.
- `bun test opencode-usage.test.ts usage.test.ts tools/package-smoke.test.ts`: 14 pass, 0 fail, 51 expect calls across 3 files.
- `bun run lint`: exit 1 on pre-existing errors in `mcp.test.ts` and `theme-sync.js`; targeted `oxlint` on the usage files reported warnings but no errors.
- Live `/usage.json` returned OpenCode turns, the claimed plan, provider/model/variant, reported cost, and area-model rows. The free-model probe returned `429 Free usage limit reached`; free routing cannot be live-verified until the allowance resets.
- What was not done: no automatic paid fallback was implemented, and no paid invoice reconciliation exists. Free routes are selected by agent configuration, not by a per-call availability check.
- Human eyes: review the free-first agent assignments before relying on them while the free allowance is exhausted.
