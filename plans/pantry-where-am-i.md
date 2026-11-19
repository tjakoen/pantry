---
id: pantry-where-am-i
status: doing
track: ui
depends: []
touches: [hub-home.ts, hub-home.test.ts, hub.ts, hub.test.ts, brief.ts, brief.test.ts, sessions.ts, mcp.ts, pantry.css, app.ts, app.test.ts, PLAN.md, INSTALL.md]
owner: ai
---

# Tell the owner where he is, across every project and machine, in one page

## Why

Tjakoen runs about twenty projects across three machines and three harnesses (Claude Code, Codex
and DSH), and writes notes and does research alongside them. Some work takes days because a token
budget runs out and has to refresh. He is one person and does one thing at a time, so the
question he keeps asking a session is the same one: what is going on, where am I, and what needs
me. On 19 November a session answered it by hand, reading five repositories' git logs, running
the gates and grading every note, and published the result as an audit page. That took a full
session to produce a single snapshot, and it went stale the moment it was published.

PANTRY already holds most of the inputs. The hub knows every registered project, each command
center knows its plans, claims, sessions and decisions, and agent-config syncs every machine every
thirty minutes. What is missing is one page that turns those inputs into the few things that need
him, and a way for that page to see the other machines.

The constraint that shapes everything below: more information is not the fix. Every item on the
new page must name its next action or the person it waits on. If it cannot, it stays off the page
and lives one click down, in the project's own command center.

## UI/UX audit of the current hub page

Read from hub-home.ts and the page the hub served on 19 November 2026, with 20 projects
registered.

| # | Finding | Severity | Evidence |
|---|---------|----------|----------|
| 1 | The registry holds duplicates and leftovers. Five entries are the course platform under different names (course-platform, course-platform-2, course-platform-integration, course-platform-ui-review, course-platform-responsive-audit), one is a worktree (ui-ux-audit-layouts-d8b9aa) and one is called project. Four of them show the same Next line. | High | ~/.pantry/projects.json; the rendered page |
| 2 | Most rows say "no sessions logged" for projects worked on yesterday. GRAIN shipped two releases on 18 November and its row reads as idle, because the session log is per machine and per harness. The page cannot tell quiet from untracked. | High | hub row for grain, bread and batch |
| 3 | Every row renders four counters even when they are zero, so twenty rows carry eighty numbers and most of them are 0. The eye has nothing to land on. | High | stat() in hub-home.ts renders zeros |
| 4 | "12 items waiting on you" is a total with no items. To see one, he has to open each project in turn. The hub answers how many and never what. | High | header line in hubHomePage |
| 5 | Out-of-scope writes and drift are shown at the same weight as decisions. They are diagnostics for an agent, not decisions for the owner, and the portfolio row shows 10 of them in loud red. | Medium | stat(..., true) for outOfScope |
| 6 | Next is the first ready plan, which is often the seeded "Welcome to your plan board" or a plan two months old. It reads as advice and is mostly noise. | Medium | rows for HAU, lakbay-ph, github-native-course-platform |
| 7 | There is no sense of threads that are paused rather than abandoned, such as work waiting on a token reset. Paused and dead look the same. | Medium | no state for it in HubSummary |
| 8 | Only this machine is visible. Work started on the Windows PC or the MacBook Pro does not exist here. | Medium | hub.ts reads one registry |
| 9 | The page has a single sort and no way to hide the quiet projects, so the eleven rows with nothing to do sit in the same list as the two that matter. | Low | sortRows in hub-home.ts |
| 10 | Every counter links to the project root, not to the items it counts. | Low | u("/") for every stat |

What works and should stay: live sessions sort first, the page renders before slow projects
answer, and each row reads from the project's own command center rather than a copy.

## The design

One page, three bands, read top to bottom.

1. Waiting on you. Decisions only he can make, across every project and machine: a plan stopped at
   an owner gate, a session that asked a question, a draft that needs his read, a stranded
   repository, a skill signal from routine-signals. One line each, naming the project, the thing
   and the action, with one or two buttons. When the band is empty, it says so in one sentence.
2. In flight. One row per thread, where a thread is a claimed or doing plan, not a repository or a
   session. Each row names the machine, the harness, when it last moved and its next step. A
   thread whose session ended on a token limit shows as paused with the time it can resume, so it
   stops looking abandoned.
3. Done since you last looked. Closed plans and released versions since his last visit, folded by
   default, each with its explainer from step 5.

The project list moves below the bands, sorted by needs me, then moving, then quiet, with quiet
projects behind a toggle and zero counters not rendered at all.

## Steps

### Slice 1: the Waiting on you band, this machine only

- [ ] Clean the registry: pantry register now refuses a git worktree and names its main checkout
      (done); unregister already existed. Still to do: remove the five course-platform duplicates and the
      worktree entry, after Tjakoen confirms which one is canonical. Teach register to refuse a
      git worktree and point at its main checkout instead.
- [x] Extend HubSummary with a waiting list, not just a count: each item carries kind, title,
      project, action label and a deep link to the item itself.
- [x] Render the Waiting on you band on the hub home, above the project list, with an empty state.
- [x] Stop rendering zero counters. Move drift and out-of-scope writes off the hub row and into the
      project's command center, where an agent reads them.
- [ ] Drop Next when it is the seeded welcome plan or has not moved in thirty days. The seeded
      plan is dropped; the thirty-day rule waits for a plan's last-moved date to reach the brief.
- [x] Tests for the band, the empty state, the zero rule and the registry cleanup; a screenshot of
      the page before and after, shown in the session.

### Slice 2: every machine

- [ ] Each machine's PANTRY writes a small state file into agent-config at
      machines/<host>/pantry-state.json: claims, waiting items, sessions with their last-seen time
      and harness. No code, no paths outside the watched repositories, no secrets.
- [ ] The existing thirty-minute sync carries it. The hub reads every machine's file and merges
      them, labelling each item with its machine and how old the reading is.
- [ ] The session log records the harness, so Codex and DSH sessions stop reading as "no sessions
      logged".
- [ ] A doctor row warns when a machine's state file is older than two hours.
- [ ] Decision for Tjakoen before building: the file route above, or one live hub over the
      Cloudflare tunnel. The file route is recommended first; it needs no new service and the
      thirty-minute lag is acceptable for this question.

### Slice 3: threads that survive a token reset

- [ ] When a session ends, the finish gate writes a resume card on its plan: where it stopped, what
      is next, what it waits on. Three lines.
- [ ] A session ended by a usage limit marks its thread paused with the expected resume time.
- [ ] pantry_orient returns the resume card first, so the next session on any machine or harness
      starts from it.
- [ ] Render the In flight band from threads, with the paused state.

### Slice 4: what did we learn

- [ ] When a plan closes, the session writes a short explainer for the owner: what changed, why,
      what was tried and dropped, the one thing worth remembering. Five lines at most, kept in the
      plan file under its own heading.
- [ ] Render Done since you last looked from closed plans and their explainers, folded by default.
- [ ] Group explainers by topic into pages that grow as work lands, such as how the loop enforces
      itself. A topic page that keeps growing is offered to create-note as a note candidate.
- [ ] An Explain this button on any thread or topic opens a session with its explainers, plans and
      diffs loaded, to answer questions at whatever depth he asks for.
- [ ] Optional, off by default: a weekly recap that suggests one or two threads worth understanding
      properly.

### Slice 5: the report page

On 19 November a session published an audit page that Tjakoen liked: a summary line, a row of
stat tiles, a section per area with what landed and graded findings, a sortable and filterable
table of notes, and a closing list of decisions. PANTRY should produce that page itself, on
demand, from the data the other slices already gather, instead of a session rebuilding it by hand.

- [ ] Add a Report surface at /report on the hub, built on GRAIN's dashboard strip and stat tiles,
      with the same shape: summary, tiles, one section per project or area, findings graded high,
      medium and low, a table, and What to decide at the end.
- [ ] Each finding carries its evidence (a file and line, a gate result or a commit) and an action.
      A finding with neither is not rendered, the same rule as the Waiting on you band.
- [ ] A period picker: since last visit, this week, or a date. The default is since last visit.
- [ ] Gate results come from the latest recorded runs, never from a fresh run the page starts. The
      page says how old each one is and names any gate that was not run.
- [ ] A notes section for repositories with content/notes: status, date, words, figures, social
      copy and issue per note, with the drafts-piling-up check.
- [ ] Generate the What to decide list from the Waiting on you items, so the report and the band
      never disagree.
- [ ] A Copy as Markdown button, so a report can go into a note or a message without a session.
- [ ] Tests for the finding rule and the period picker; a screenshot beside the 19 November page
      to show it reads the same.

## Done when

Tjakoen can open PANTRY on any of his machines and, within ten seconds, name what is waiting on him
and what is moving, without opening a project. The page shows no item that lacks a next action.
Each slice ships with its tests green and a screenshot shown in the session that built it.

## Hard stops

- Do not unregister any project until Tjakoen confirms the list.
- Do not add a hosted service in slice 2 without his decision.
- The state file carries no file contents, no secrets and nothing from the HAU student data.
