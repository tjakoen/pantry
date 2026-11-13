# PANTRY pane for Claude Code

This plugin keeps the current project's PANTRY beside the chat. A pane shows what needs you, what
is being worked on, and a link to the full command center in sidebar mode (`?mode=side`). The
status line carries the Needs you count, so it stays in view when the pane is closed.

## Install

```
/plugin marketplace add tjakoen/pantry
/plugin install pantry-pane@pantry
```

Run `/pantry` to open the pane again after you close it.

## How it finds PANTRY

The plugin asks the PANTRY hub which project contains the session's working folder. It looks for
the hub in this order:

1. `PANTRY_HUB_URL`, when it is set.
2. `~/.pantry/hub.json` (or `$PANTRY_HOME/hub.json`), using its `url` or `port` field.
3. `http://localhost:4400`, the hub's default port.

When no hub answers, the pane says so and shows the command that starts one, `pantry hub ensure`.
When the hub answers but serves no project containing this folder, the pane shows
`pantry register .`.

The pane draws its own summary from the project's `/brief.json` rather than embedding the web
page, because Claude Code panes draw native elements and cannot host a browser frame.

## Develop

```
claude plugin validate claude-plugin
claude plugin test claude-plugin
```

The repository's `bun test` skips this folder, because these tests need the harness that
`claude plugin test` provides.
