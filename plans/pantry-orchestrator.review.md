# Goldfish review of pantry-orchestrator.md

Fresh `goldfish` agents read the plan and the files it names, nothing from the conversation that
wrote it. Five passes on 2026-11-04.

1. **Comprehension** explained the plan and listed twelve assumptions: lock location, how a decision
   names a plan, a missing `owner`, cross-project dependencies, path resolution, heartbeat rules,
   board order, the `~/.pantry` mount, the claim window, and the timeout written as fact while still
   an open decision.
2. **Critic** found that a finished plan would be offered again while its `status: done` edit was
   uncommitted, that nothing made agents use the tools, that a lock file across the Docker mount
   might not hold, that a literal `~` would write inside the container, and argued that a committed
   `status: doing` edit might be enough on its own.
3. **Readiness, first pass: NO-GO**, eleven items, mostly the same gaps plus missing file locations
   and acceptance checks. One finding was wrong: it said the sources live in a nested `pantry/`
   directory, and they do not.
4. **Readiness, second pass: NO-GO**: which process serves the tools, the unnamed board sort, the
   claim state fold, how a claim reaches the live board (the stream only watches `plansDir`), and
   where adoption lands.
5. **Readiness, third pass: NO-GO**: a hub child cannot know its de-duplicated registry name, and
   the owner's release of a `done` claim had no way to recognise the owner.
6. **Readiness, fourth pass: GO**, with four small gaps, closed in "Rules the reviews asked to pin
   down".

Resolutions are in the plan itself. The design changes the reviews forced: the hub process is the
only writer, with an in-process queue instead of a lock file; a `done` claim blocks for up to 24
hours; children get `PANTRY_PROJECT`; claims publish to the board through their own watcher and
poll; decisions gain a `blocks` list; adoption lands in the agent config with a checklist count.
The critic's case for `status: doing` alone is answered in the plan's "Why claims" section.
