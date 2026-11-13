---
id: pantry-pane
status: doing
track: companion
depends: []
touches: [claude-plugin/]
owner: ai
---

# Run PANTRY beside the chat as a Claude Code plugin

The owner wants PANTRY open next to the work, not in a separate browser window. This plan adds a
Claude Code plugin under `claude-plugin/` that ships with the repository, so anyone who installs
PANTRY can also install the pane. The plugin holds no personal paths: it finds the hub through
`~/.pantry/hub.json` when that file exists, and otherwise through the default hub port, 4400.

The plugin API draws native elements and has no embedded browser, so the pane does not frame the
web page. It reads the project's `/brief.json` and draws a sidebar summary from it, and it links
to the command center in sidebar mode (`?mode=side`) for the full view.

- [x] Find the hub from `PANTRY_HUB_URL`, then `~/.pantry/hub.json`, then port 4400
- [x] Resolve the current project through the hub's `/health?path=<cwd>`
- [x] Draw a pane with the Needs you count, the waiting items and a link to `?mode=side`
- [x] Show an offline state that names `pantry hub ensure` when the hub does not answer
- [x] Put the Needs you count in the status line
- [x] Test the mod with `claude plugin test` and keep `bun test` and `bun run check` green

Not yet done: screenshots of the pane in the desktop app, online and offline, which need the
owner to have this session in view. The claim through PANTRY also failed, because the hub reads
plans from the main checkout and this plan exists only on the worktree branch so far.
