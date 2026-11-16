# Prompt: set up PANTRY on a new machine

Paste the block below into a Claude Code session on the new machine. It installs the hub, the
desktop app and the Claude pane, and wires the session hooks, then proves each one works. It stops
and asks before anything that needs a password or that it cannot undo.

```text
Set up PANTRY on this machine so it runs the way it does on my main Mac: a hub on port 4400, the
PANTRY desktop app, and the PANTRY pane beside the chat in Claude Code. No Docker; the old container
setup is retired.

Work through these in order, and stop to ask me if a step needs a password or fails twice.

1. Check the prerequisites: git, Bun, and the GitHub CLI signed in. Install Bun if it is missing.
   For the desktop app also check Rust (rustup) and the Tauri CLI (cargo install tauri-cli); on
   macOS the Xcode command line tools; on Windows, WebView2 and Developer Mode. Report what was
   already there and what you installed.
2. Clone tjakoen/pantry to ~/Local/Development/bread-repos/pantry (the session hooks look there by
   default; set PANTRY_CLI in the shell profile if it has to live elsewhere). Run bun install.
3. Clone tjakoen/agent-config to ~/Local/agent-config and run shared/tools/link-machine.sh --check
   first, then the plain run only after showing me what --check reports. That wires the global
   instructions and the session-start hooks, which run pantry hub ensure and pantry open.
4. Build the desktop app: in app/src-tauri run cargo tauri build --bundles app (on Windows, the
   msi or nsis bundle). Install it (macOS: copy PANTRY.app into ~/Applications) and open it once,
   which registers its pantry:// links.
5. Register each project I work in on this machine: in each repo run bun ../pantry/cli.ts register
   (or bunx pantry register where it is a dependency). Ask me which repos, and add each to
   machines/<host>/watched-repos.txt in agent-config.
6. Install the Claude pane:
   claude plugin marketplace add tjakoen/pantry
   claude plugin install pantry-pane@pantry
7. Prove it, and show me the evidence rather than describing it:
   - curl http://localhost:4400/ answers, and ~/.pantry/hub.json names the port.
   - pantry open brings the desktop app onto the current project.
   - The agentic loop checklist at session start shows the PANTRY and PANTRY pane rows as ok.
   - A screenshot of the pane beside the chat, showing this session's plan.

Things that are not built yet, so do not try to make them work: signed app downloads, a login item
that starts the hub at boot, and a tested Windows build. Note any of these that bite and carry on.

When done, list what was installed, what was skipped and why, and anything left for me.
```
