---
id: pantry-orchestrator
status: todo
track: feature
depends: []
touches: [orchestrator.ts, orchestrator.test.ts, decisions.ts, decisions.test.ts, mcp.ts, mcp.test.ts, hub.ts, hub.test.ts, app.ts, app.test.ts, INSTALL.md, PLAN.md]
owner: human
---

# Let agents take work from PANTRY, and let the owner see who has what

PANTRY already knows every project's plans, their status and dependencies, the open decisions, the
owner's answers and the run ledger. It does not know which agent is working on which plan, and an
agent has no way to ask it what to do next. Two sessions can pick the same plan, and a plan waiting
on the owner's decision looks like any other `todo`. This plan makes PANTRY the place agents take
work from and report back to. It does not make PANTRY run agents.

All paths below are relative to the pantry repository root, where the other sources (`app.ts`,
`mcp.ts`, `hub.ts`, `decisions.ts`) already live.

## What it is and is not

- **Pull, never push.** An agent session asks PANTRY for work. PANTRY never starts a session, sends a
  prompt, or runs a command in a project, so every agent still runs its own session-start checklist
  and guards.
- **Plans stay the source of truth for status.** PANTRY never edits a plan file, and cannot: the hub
  mounts the code read-only. Claims are machine state outside the repositories, like the session
  log. The agent still edits the plan's `status` itself (`doing` when it starts, `done` at the end).
- **Human-lane work is never handed out.** Only plans whose frontmatter says exactly `owner: ai` are
  offered. A missing or different `owner` is never offered.

## Why claims, rather than only editing `status: doing`

Editing the plan file is still required, but it is not enough on its own: two sessions can both
read `todo` before either writes `doing`, a status edit in an uncommitted worktree is invisible to
other checkouts, and the file records no holder or age. A claim made through the single hub process
is atomic, names its holder, and expires when its session dies.

## Definitions

- **Project.** A registry entry, resolved from the caller's `path` by the existing `projectFor`
  (deepest registered path containing it). A path in no project is an error naming the path; no
  claim is written.
- **Open decision blocking a plan.** A decision file in `plans/decisions/` with `status: open` whose
  new optional frontmatter list `blocks` contains the plan id. `decisions.ts` parses `blocks` as a
  dash-list of plan ids, the same shape as `options`. A plan mentioned only in a decision's body does
  not count. `parseDecision` treats a missing or unknown `status` as `open`; that stays, because a
  decision that cannot be read should hold its plans rather than release them.
- **Ready plan.** A plan in the project's `plansDir` with `status: todo`, `owner: ai`, every
  `depends` id present in the same project at `status: done` (a missing id is unmet), no open
  decision blocking it, and no blocking claim. Order: ascending plan id by `localeCompare`, the
  order `renderBoard` uses within a status column (`@tjakoen/proof/board.ts`, line 67).
- **Claim.** One JSON line: `project` (registry name), `planId`, `sessionId`, `tool` (`claude` or
  `codex`; any other value is rejected), `at`, and `event` (`claim`, `heartbeat`, `release`,
  `done`). Appended to `$PANTRY_HOME/claims/<project>.jsonl`. `PANTRY_HOME` is `/pantry-home` in the
  container, which `docker-compose.yml` already mounts read-write from the host's `~/.pantry`, so no
  compose change is needed. Folded to one current state per plan on read.
- **Fold.** Events per plan are read in file order and reduce to one state:

  | Last event | State | Blocks the plan? |
  | --- | --- | --- |
  | `claim` or `heartbeat`, younger than the timeout | `active` | yes |
  | `claim` or `heartbeat`, older than the timeout | `expired` | no |
  | `release` | `released` | no |
  | `done`, younger than 24 hours, and the plan file is not `status: done` | `done` | yes |
  | `done`, older than 24 hours, and the plan file is not `status: done` | `stale-done` | no |
  | `done`, and the plan file is `status: done` | `done` | no (the plan is not `todo`) |

  A new `claim` is accepted only when the current state does not block. It starts a new active
  claim; earlier events stay in the file. A `done` claim blocks for at most 24 hours: long enough for
  the status edit to be committed and reach the main checkout, and short enough that a plan the
  owner deliberately set back to `todo` is offered again the next day without anyone releasing it.
  No call ever releases another session's claim.
- **Blocking claim.** Either an `active` claim whose last claim or heartbeat is younger than the
  timeout, or a `done` claim on a plan whose file does not yet say `status: done`. The second rule
  stops a finished plan being handed out again while its status edit is uncommitted or on another
  branch; the claim stops blocking once the hub's checkout shows `done`.
- **Timeout.** `PANTRY_CLAIM_TTL_MINUTES`, default 30. Agents heartbeat every 10 minutes.

## Build

1. **`decisions.ts`**: parse the optional `blocks` list. Existing decisions without it are
   unchanged.
2. **Process.** The `/mcp` endpoint already runs inside the hub process (`hub.ts` routes it to
   `mcp.ts`), and every agent reaches PANTRY through it. That one process is the only writer.
   **`orchestrator.ts`**: pure functions with no I/O: `foldClaims(lines, now, ttl)`,
   `readyPlans(plans, decisions, claims, now, ttl)` returning ready plans and, for every `todo` plan
   not offered, the reason (`owner`, `depends: <id>`, `decision: <id>`, `claimed by <tool>
   <session>`). A file layer appends lines. **Only the hub process writes claims,** and it
   serializes every read-check-append per project through an in-process queue, so there is no lock
   file and no cross-process locking to get wrong. No CLI command writes claims.
3. **MCP tools in `mcp.ts`**, each taking the caller's `path`:
   - `pantry_next(path)`: ready plans (id, title, file, `touches`), then the skipped `todo` plans with
     reasons. `owner: human` plans appear only in the skipped list, so an agent can tell the owner
     what is waiting on them.
   - `pantry_claim(path, planId, sessionId, tool)`: the claim, or an error naming the holder, or an
     error saying why the plan is not ready.
   - `pantry_heartbeat(path, planId, sessionId)` and `pantry_release(path, planId, sessionId,
     outcome)` with `outcome` `done` (writes event `done`) or `released` (writes event `release`). Both error when `sessionId` is not the holder or
     the claim has expired; an expired claim is not revived.
   - `pantry_claims(path)`: active claims, and claims that ended in the last 24 hours.
4. **Board in `app.ts`**: `start()` in `hub.ts` passes each child its registry name as
   `PANTRY_PROJECT` alongside the inherited `PANTRY_HOME` (the folder name is not enough, because
   `registerProject` de-duplicates names to `foo-2`). The child reads
   `$PANTRY_HOME/claims/$PANTRY_PROJECT.jsonl`, and shows nothing when either variable is unset, as
   under a plain `pantry serve`. It shows tool,
   short session id and claim age on claimed plans and a ready mark on ready plans. Read-only. The
   live stream is triggered today only by the watcher on `plansDir` (`@tjakoen/proof/live.ts`), so
   the child also watches its claims file, with a 5-second size-and-mtime poll as the fallback
   because file events across the Docker mount are unreliable, and publishes a refresh on the same
   stream when it changes.
5. **Health in `hub.ts`**: `/health?path=` adds `ready` and `claimed` counts.
6. **Adoption, in the owner's agent-config repository, not here:** one paragraph in
   `shared/CLAUDE.md` telling agents in a PANTRY project to call `pantry_next` before choosing work,
   claim before starting, heartbeat every 10 minutes, and release at the end; and the PANTRY row of
   `shared/tools/session-checklist.sh` appends `N ready, M claimed` from `/health?path=`. Checked by
   running the checklist in a PANTRY project and reading the counts in its PANTRY row.
7. **Docs**: an "Orchestration" section in `INSTALL.md` after "The always-on hub", covering the
   tools, the claim file and the timeout; and one row in `PLAN.md`'s piece list marking the
   orchestrator done with its date.

## Rules the reviews asked to pin down

- **A late finish still counts.** `pantry_release` with `outcome: done` succeeds after the holder's
  claim has expired, as long as no other session has claimed the plan since; a heartbeat after
  expiry still fails. Otherwise a slow session could not record its work and the plan would be
  handed out again.
- **Ended claims in `pantry_claims`** are released, done and expired claims whose last event (for an
  expired claim, its last claim or heartbeat) is within 24 hours.
- **Skip reasons are all listed,** in the fixed order `owner`, `depends`, `decision`, `claimed`, so
  a plan blocked twice reports both and tests can assert the list.
- **Done means both repositories.** This plan is `done` only when step 6 has landed in the owner's
  agent-config repository too; the `PLAN.md` row is written last.

## Acceptance checks

- Unit tests: a plan is not ready with `owner` missing or `human`, an unmet or missing dependency,
  an open decision whose `blocks` names it, or an active claim; it is ready after the claim expires
  or is released; a `done` claim blocks until the plan file says `done` or 24 hours pass; an invalid `tool` is
  rejected; a heartbeat or release from another session errors; a `done` release after expiry with
  no newer claim succeeds; an expired claim cannot be
  heartbeated back.
- Concurrency: twenty concurrent `pantry_claim` calls for one plan against one hub produce exactly
  one claim.
- MCP over HTTP against a temporary registry and `PANTRY_HOME`: next, claim, claims, heartbeat,
  release round-trip, and a second claim returns the holder.
- `hub.test.ts`: `/health?path=` returns `ready` and `claimed`, and a path in no project returns 404
  with `registered: false`.
- MCP: a `path` in no project returns an error result and writes nothing; `pantry_claims` includes a
  release from 23 hours ago and omits one from 25 hours ago.
- In the running container: a claim made through MCP appears on the project's board in the browser
  pane without a reload, and the line is in `~/.pantry/claims/<project>.jsonl` on the host.
- `bun run check`, `bun test` and `bunx oxlint` pass; no file under any project directory changes.

## Out of scope

Starting or messaging agent sessions; editing plan files; scheduling across projects; Edge or any
repository the owner's agent rules exclude. Plans edited only in a worktree outside the mounted code
root are not seen until they reach the main checkout; the `done` claim rule covers the gap.
