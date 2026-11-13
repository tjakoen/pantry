# The workflow PANTRY was built around, in three tiers

PANTRY grew up on one machine, mine, serving one person's habits with AI coding agents. Most of
what it checks is a habit of mine rather than a law of software. So the workflow is split into three
tiers, and you can stop after any of them. *pantry doctor* enforces only the first, nudges about the
second, and stays quiet about the third unless you ask.

> Take the contract. Try the loop. Ignore my layer until you are curious.

## The honest part first

The evidence behind this workflow is mostly one person's measured use: my own sessions, my own token
counts, my own run reports, across a handful of repositories over a few months. That is n=1. It is
*measured* n=1 (the usage numbers come from the harness transcripts, not from memory), but it is
still one person, one set of projects, and one set of bad habits the tooling was built to catch.
Nothing here has been tested on a team, and nothing here has a control group.

The longer argument for why it is built this way, and what the numbers do and do not show, lives in
a note on the portfolio: [why PANTRY works the way it does](https://portfolio.tjakoen.com/notes/pantry-workflow)
(placeholder, not yet published).

## Tier 1: the contract

This is what PANTRY cannot work without, and the only tier that can fail *pantry doctor*.

- A *plans* folder where every plan is a markdown file whose frontmatter carries id, status, depends
  and owner, as described in the README that *pantry init* writes into that folder.
- The PANTRY MCP server registered with at least one agent, so the agent can read the plans and
  claim one.

*pantry init* scaffolds both: the plans folder with its schema README and a first plan, a
*pantry.config.json*, and a project *.mcp.json* that registers the server for Claude Code.

## Tier 2: the loop

This is the way of working the tools assume, and the part I would suggest to anyone. A broken tier 2
check warns with a one-line fix and a link back here. It never fails the run.

1. At session start, make sure the hub is running (*pantry hub*) and the project is registered
   (*pantry register*).
2. Before choosing work, the agent calls *pantry_orient*, then *pantry_next*.
3. It claims a plan with *pantry_claim* and sets that plan's status to doing in the file.
4. It calls *pantry_heartbeat* about every ten minutes. A claim expires after thirty minutes
   without one, so a crashed session hands its plan back on its own.
5. At the end it sets the status to done and calls *pantry_release*.

Doctor also counts a few hygiene signals as part of the loop: a front door file for agents
(CLAUDE.md, with AGENTS.md as a link to it), uncommitted or unpushed work that has sat for days, and
answers you gave that no session has acted on yet.

## Tier 3: the owner's layer

This is mine. It includes the writing standards mounted as agent skills, the session-start
checklist, run reports for every session, the audit cadence, the graphify code graph, and the hook
that writes a plan for chat work automatically. It is opinionated, it assumes my other repositories,
and it is silent unless you opt in:

```json
{ "ownerLayer": true }
```

The skills are the part people ask about most. *pantry init --kit* and *pantry skills sync* mount
my standards as agent skills in *.claude/skills*, generated from the portfolio package and
gitignored. Today that is sixteen of them: voice, loop-standard, session-loop, ai-development,
ai-repo-standard, audit-standard, claude-starter, conformance, decisions, figures, graph,
kickstart, note-standard, readme-standard, tour-standard and tree. They are how *I* want agents to
write and work. Read them as examples of the shape a standard can take, not as rules your project
inherits. If you want your own, write a SKILL.md per standard in *.claude/skills* and leave mine
out.

With that key in *pantry.config.json*, every check runs at the strictness it was written with,
which is how my own repositories run it.

## Setup for Claude Code

```sh
bun add -d @tjakoen/pantry@github:tjakoen/pantry#main
bunx pantry init
bunx pantry register
bunx pantry hub
```

*init* writes the project *.mcp.json*. To register the server for every project instead:

```sh
claude mcp add --transport http -s user pantry http://127.0.0.1:4400/mcp
```

Add a line like this to the project's CLAUDE.md so the agent runs the loop:

```md
This is a PANTRY project. Call pantry_orient with your working directory first, then pantry_next.
Claim a plan with pantry_claim before starting it and set its status to doing. Heartbeat every ten
minutes. Finish with status: done and pantry_release.
```

## Setup for Codex

Codex reads its MCP servers from its own config rather than *.mcp.json*. Add this to
*~/.codex/config.toml*:

```toml
[mcp_servers.pantry]
url = "http://127.0.0.1:4400/mcp"
```

Then put the same loop paragraph in the project's AGENTS.md. If the repository already has a
CLAUDE.md, make AGENTS.md a symlink to it, so both agents read one file:

```sh
ln -s CLAUDE.md AGENTS.md
```

## The Claude desktop app

The Code tab of the Claude desktop app runs Claude Code, so the setup above covers it. Ask the
session to open the project's PANTRY page in the built-in browser pane and it sits next to the chat.
The full install, including the desktop app releases, is in [INSTALL.md](../INSTALL.md).

## Checking where you stand

```sh
bunx pantry doctor
```

Failures are tier 1 and mean PANTRY cannot see your work. Warnings are tier 2 and come with the fix.
The last lines say how many owner-layer checks stayed silent.
