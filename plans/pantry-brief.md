---
id: pantry-brief
status: todo
track: feature
depends: [pantry-orchestrator]
touches: [brief.ts, brief.test.ts, brief-routes.ts, config.ts, config.test.ts, mcp.ts, mcp.test.ts, app.ts, app.test.ts, pantry.css, PLAN.md, INSTALL.md]
owner: ai
---

# Put what the owner meant beside what the agent did, on one page

PANTRY records what agents do: sessions and the files they wrote, claims, runs, decisions, the
doctor's findings. Each of those already has a page. None of them answers the question the owner
opens PANTRY with, which is whether the work in flight is still the work he asked for. Today that
takes five pages and a comparison done in his head: `/control` for sessions, `/decisions` for what
waits on him, `/runs` for evidence, the doctor's text at session start for drift, and the plan file
for what was meant.

This plan builds the alignment brief: one model, assembled from files PANTRY already reads, served
as the project's front door for the owner and as the start of `pantry_orient` for the agent. The
owner and the agent then read the same account of where the project stands. It adds no new source
of truth and runs no model.

All paths are relative to the pantry repository root.

## What the brief answers, in order

1. **In flight.** One row per plan with an active claim or a `doing` status. Each row puts the
   plan's intent (title, the open task lines, the `touches` list) beside the evidence (claim holder
   and age, the sessions attached by the path join, the files those sessions wrote).
2. **Out of scope.** For each in-flight row, the written files that `planTouchesPath` does not
   match against the plan's `touches`. This is the alignment signal. A row with any is marked, and
   the files are listed, never summarised as a count alone.
3. **Waiting on the owner.** `ControlPayload.waiting` as it is (open decisions and blocked plans),
   plus plans with `owner: human` at `todo` that a ready `owner: ai` plan depends on, since those
   hold agent work back.
4. **Drift.** The doctor's due and failing rows, each with the command the doctor already names.
   Passing rows are omitted, as at session start.
5. **Next.** The first ready plan from `readyPlans`, or the reason nothing is ready (every plan
   skipped, with its skip reasons).

## Design

- **`brief.ts`** owns `buildBrief(config, now, home)` returning a `BriefPayload`. `home` is the
  PANTRY home that holds `claims/`, resolved as `mcp.ts:128` resolves it (`PANTRY_HOME`, else
  `~/.pantry`). When the claims file is missing or unreadable, In flight still renders from plan
  status and says "claims not readable here" in one line; it never errors. The brief reads; it never
  writes.
- **Sources, named.** Plans and decisions come from `loadProjectWork` (orchestrator.ts:213), not
  from `ControlPayload.plans`, because that list drops plans with no open tasks
  (sessions.ts:636-637), and a finished-but-not-closed `doing` plan is exactly the row the owner
  needs. Sessions and their written paths come from `buildControlPayload(...).sessions`. Claims come
  from `readClaims` folded by `foldClaims`. Next comes from `readyPlans`.
- **In flight.** One row per plan that has an `active` or `done`-but-not-closed claim, or
  `status: doing`. Its sessions are those whose written paths match the plan's `touches` under
  `planTouchesPath`, the same join `/control` uses.
- **Out of scope, defined.** For an in-flight plan, the out-of-scope files are the paths written by
  its attached sessions that match the `touches` of no in-flight plan. A file inside another
  in-flight plan's `touches` is shown on that plan, not flagged on this one. When a session's paths
  were capped, the row lists what it has and adds "and N more not recorded", from `pathsOmitted`.
- **Unattributed writes.** Sessions attached to no plan are listed under In flight as a "no plan"
  row with the files they wrote. Unlike `ControlPayload.unattached` (sessions.ts:667), which keeps
  only alive and idle sessions, this includes sessions that ended within the last 24 hours, so
  unplanned work does not drop off the page the moment its session closes.
- **Waiting on the owner, the human-owned part.** From `loadProjectWork`'s plans: every `owner:
  human` plan not at `done` that appears in the `depends` of an `owner: ai` plan at `todo`. The
  row names the AI plans it holds back.
- **Drift.** The brief runs the doctor with `runDrift: false` and `runDeps: false` (doctor.ts:76-79)
  and shows each failing or due check by `label` and `detail`. The page says the slow checks were
  skipped and links the full report. Extracting a fix command into its own field is deferred to the
  "act on a row" plan; until then the detail text carries it.
- **`/brief` and `/brief.json`.** One payload, two projections, the same pattern as `/map`. The
  page renders the five sections top to bottom; an empty section says so in one line rather than
  disappearing, so a calm page is never mistaken for an unread one.
- **Front door.** A new `brief` key in `PantrySurfaces`, defaulting to on in `SURFACE_DEFAULTS`
  (config.ts). With it on, `/` renders the brief; `/plans` serves the board as now. With it off, `/`
  is today's home.
- **Agents.** `brief.ts` also exports `briefText(payload)`: five Markdown sections with the same
  headings as the page, one bullet per row. `/brief.txt` serves it. `pantry_orient` fetches
  `/brief.txt` and then `/llms.txt` and returns them in that order, separated by a rule; if the
  brief does not answer, it returns `llms.txt` alone. `brief` joins `pantry_read`'s `SURFACES`.

## Out of scope

- Collapsing the navigation into three areas. That follows this plan and is its own plan.
- Acting on a row: copy-to-clipboard fixes, turning a drift row into a decision. Also later.
- Splitting `app.ts`. The new routes live in `brief-routes.ts`, wired from `app.ts` with the
  routing lines only.
- Changing doctor.ts or orchestrator.ts. The brief only calls them.

## Steps

- [ ] `brief.ts` with `buildBrief`, `BriefPayload` and `briefText`, tested in `brief.test.ts`.
- [ ] `brief-routes.ts` serving `/brief`, `/brief.json` and `/brief.txt`, each section with an
      empty-state line.
- [ ] The `brief` surface key in config.ts; `/` renders the brief when it is on.
- [ ] `pantry_orient` returns the brief text before `llms.txt`; `brief` added to `SURFACES`.
- [ ] Screenshot of `/brief` on this repository and on tjakoen.github.io, shown to the owner.
- [ ] PLAN.md and INSTALL.md describe the brief and the new front door.

## Done when

Each of these is a named test that passes under `bun test`:

- `brief.test.ts`: a `doing` plan with every task ticked appears under In flight; a session writing
  a file outside every in-flight plan's `touches` is flagged on its plan; a file inside a second
  in-flight plan's `touches` is not flagged; a session that ended an hour ago with no plan appears
  as a "no plan" row; an `owner: human` plan in an AI plan's `depends` appears under Waiting; a
  missing claims file yields In flight from status with the "claims not readable here" line.
- `app.test.ts`: `/` returns the brief with the surface on and today's home with it off; `/plans`
  returns the board either way; `/brief.json` parses and has the five section keys.
- `config.test.ts`: `surfaces.brief` defaults to true.
- `mcp.test.ts`: `pantry_orient`'s text begins with the brief's first heading and still contains
  `llms.txt`'s content; it falls back to `llms.txt` alone when `/brief.txt` does not answer.

Then the screenshot step, shown to the owner, closes it.
