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

- [x] Each machine's hub writes a small state file to <sync dir>/<machine>/pantry-state.json:
      project names, live counts, last-seen times and the waiting items' kind, title and detail. No
      paths, no file contents, no secrets. It rewrites only on change plus a daily heartbeat, since
      every rewrite is a commit in the synced folder. Built in hub-sync.ts.
- [x] The folder is configuration (sync.dir in ~/.pantry/projects.json), not code. On Tjakoen's
      machines it is agent-config/machines, and estate-sync.sh commits and pushes the state file
      on its thirty-minute run when nothing else is unpushed.
- [x] The hub reads every other machine's file and lists its items in the Waiting on you band,
      labelled with the machine and how old the reading is.
- [x] A machine whose file is older than a day plus two hours is named under the band as possibly
      out of date. This sits on the hub, not the per-project doctor, because it is a machine fact.
- [ ] Set sync.dir on the MacBook Pro and the Windows PC (a pantry hub sync command would make this
      one line; until then, edit ~/.pantry/projects.json).
- [ ] The session log records the harness, so Codex and DSH sessions stop reading as "no sessions
      logged".
- [x] Decision: the file route, not a live hub over the tunnel. Taken 2026-11-19 when Tjakoen said
      to start slice 2 with the file route recommended.

### Slice 3: threads that survive a token reset

- [x] A session handing a plan back leaves a resume card through pantry_release: where it stopped,
      what is next, what it waits on, why it ended and, for a usage limit, when it can resume. The
      card is a section in the plan file, so it travels with the plan to every machine. Built in
      resume.ts.
- [x] The finish gate in agent-config names every PANTRY plan the session still holds at its finish
      signal and asks for a release with a card.
- [x] pantry_claim returns the plan's card, and pantry_next offers carry it, so the next session on
      any machine or harness starts from it.
- [x] A card that ended on a limit with a future resume time marks the plan paused; the hub's In
      flight band lists active and paused plans, with the resume time and the card's next step.
- [ ] A session cut off by a usage limit cannot write its own card. Detect the limit in a Stop or
      SessionEnd hook and write a minimal limit card from the hook, with the reset time if the
      harness reports one.
- [ ] Have pantry_orient lead with the cards of plans the session is likely to resume.

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

### Slice 6: where the work ran, and how well

Tjakoen wants a record he can learn from later: which machine, harness and model ran each plan,
what it cost in tokens, how long it took, how long it sat stalled on a usage limit, how a plan
fared when it moved between machines or harnesses, and some signal of quality. The harnesses are
Claude Code on a personal account, Claude Code on a work account, Codex and DSH (DeepSeek).

The unit is the plan, not the session. Each plan gets a timeline of segments, and each segment
carries the machine, harness, account, model, start and end, tokens, and how it ended.

- [x] Record on every claim: machine name, harness, account (the config directory tells personal
      from work) and model. Do this first; data not recorded now cannot be analysed later. The
      machine is filled by the hub; model and account are optional pantry_claim arguments, and dsh
      is now a claim tool beside claude and codex.
- [ ] Have agent-config's auto-plan hook pass model and account when it claims, so chat plans carry
      them too.
- [ ] Token readers per harness that emit one shape: Claude Code transcripts (usage.ts already
      reads them), Codex session logs, DSH's API usage. A harness that reports nothing shows as
      unknown, never as an estimate.
- [ ] Split each plan's time into active, waiting on the owner, and stalled on limits. Stalled time
      needs slice 3's record of why a session ended.
- [ ] Record every handover between machines or harnesses: what the new session received (a resume
      card, the plan, nothing) and what it did next (continued, redid work, or circled back).
- [ ] Quality signals, measured and never guessed: gates passing at session end, follow-up fixes a
      change needed, rework the owner asked for, out-of-scope writes, and work a later session
      reverted.
- [ ] A Usage and handovers page and a section in the slice 5 report. Every comparison shows its n
      and stays silent below about ten. The front page gets an item only when a decision follows,
      such as a plan that stalled on limits three times.
- [ ] Work stays on the work machine: detail from the work account and from Edge-adjacent projects is
      kept local, and only totals travel through agent-config.

### Slice 7: an AI reading of the owner's side

The reports so far tell the owner what agents did. The loop also needs the reverse: an agent reading
the same data and flagging where the owner's side is the bottleneck or has drifted. The report data
is served to agents in the same shape the page renders, through PANTRY's MCP server and GRAIN's AI
interface contract, so the page and the agent read one source.

- [ ] Serve the report as structured data: a pantry_read surface named report, with the same
      findings, evidence and actions the /report page shows.
- [ ] A review pass an agent runs on request or weekly, writing findings into the report under its
      own heading, never into plans or decisions:
      - a recorded decision that contradicts a plan's stated goal or a standard, quoted side by side;
      - a human gate that has blocked work for more than a set number of days, or that blocks more
        plans than it unblocks;
      - worktrees idle for more than a set number of days, branches merged but not deleted, and
        claims released without their plan returned to todo;
      - plans marked doing with no claim and no commit for a week.
- [ ] Each finding names its evidence and offers one action the owner can take, such as answer,
      unblock, archive the worktree or park the plan. The agent recommends; it never acts on the
      owner's gate.
- [ ] Thresholds live in configuration, so a one-project user can turn the pass off or tune it.

### Slice 8: give the menu bar and the Claude pane a purpose

The menu bar icon carries a count and a dropdown, and the Claude pane sits beside the chat, but
neither yet answers the question this plan exists for. Tjakoen wants both to be worth opening.

- [ ] Audit the menu bar icon and its dropdown against the three bands: what the count means, what
      the dropdown lists, and what a click on each line does. Record findings in this plan.
- [ ] The dropdown becomes the shortest form of the front page: the top Waiting on you items with
      their action, paused threads with their resume time, and one line for other machines. Each
      line opens the item, never just the hub.
- [ ] The count means one thing, items waiting on the owner across every machine, and the icon
      shows when a thread is paused on a limit, so a glance says whether anything needs him.
- [ ] Audit the Claude pane the same way: it shows the session's own claim, its resume card, and
      the owner's items for this project, and offers the actions a session in that project can take.
- [ ] Screenshots of the icon, the dropdown and the pane before and after, shown in the session.

## Keeping PANTRY modular for other people

PANTRY is public, and it is now an app, a menu bar item and a hub, not a script. Tjakoen builds it
for himself first, but the slices above should not weld his estate into the core. The split:

- Core, per project. The plan board, claims, the brief, decisions and the doctor. One project, no
  hub, no registry, no agent-config. Someone who wants PANTRY on one repository installs this and
  gets a complete tool.
- Hub, per machine. The registry, the Waiting on you band, the project list, the report page. It
  reads each project's brief over HTTP and holds no state of its own, which it already does today.
- Sync, optional. Cross-machine state through a pluggable transport. The first transport writes
  files into a folder that something else syncs; agent-config is Tjakoen's folder, and a stranger
  could point it at Dropbox, iCloud or a git repository of their own. PANTRY never assumes a
  particular one.
- Harness adapters, optional. One small reader per harness for sessions and tokens: Claude Code,
  Codex, DSH. A user with only one harness enables only that one, and adding a harness never touches
  the core.
- Shell, optional. The desktop app, the menu bar and the Claude pane sit on top of the hub and add
  nothing the hub cannot already serve in a browser.

The rules that keep the split honest:

- [ ] Nothing in core imports from hub, sync, adapters or shell. A test fails the build if it does.
- [ ] Every path and name specific to Tjakoen's machines lives in configuration, never in code: the
      agent-config path, the machine names, the account folders.
- [ ] Each optional part is switched on in pantry.config.json or the hub's own config, and the doctor
      reports which are on.
- [ ] INSTALL.md gains a one-project quick start that never mentions the hub, sync or adapters.
- [ ] Slices 2 and 6 are built as a sync transport and harness adapters from the start, not
      refactored into them afterwards.

## Done when

Tjakoen can open PANTRY on any of his machines and, within ten seconds, name what is waiting on him
and what is moving, without opening a project. The page shows no item that lacks a next action.
Each slice ships with its tests green and a screenshot shown in the session that built it.

## Hard stops

- Do not unregister any project until Tjakoen confirms the list.
- Do not add a hosted service in slice 2 without his decision.
- The state file carries no file contents, no secrets and nothing from the HAU student data.
