---
id: pantry-app
status: doing
track: app
depends: []
touches: [cli.ts, app/]
owner: ai
---

> depends cleared 2026-11-14: the hub plumbing does not need the dashboard; only the app's final look follows pantry-dashboard.

# Give PANTRY a desktop app that finds its own server

Today PANTRY feels like a test deploy: a server has to be running, in Docker, before a browser tab
can show anything. This plan gives it a small desktop app that is always there and finds the server
on its own, while the pages stay the web pages they are now.

## Why Tauri

Tauri uses the webview the system already ships: WebKit on macOS, WebView2 on Windows and WebKitGTK
on Linux. It bundles no browser, so the app stays a download of a few megabytes and tens of
megabytes of memory, where an Electron app carries a whole copy of Chromium. It runs on all three
platforms, and the interface stays the existing pages.

## How the app and the server find each other

1. The app starts at login and lives in the menu bar. It reads ~/.pantry/hub.json for the hub's port
   and process id, then asks the hub's health endpoint whether it is up.
2. When nothing answers, the app stays open, says the server is offline, offers a Start button and
   keeps checking.
3. Sessions start the hub themselves. The session-start hook runs pantry hub ensure, which starts
   the hub when nothing answers and writes hub.json.
4. The hook then runs pantry open, which brings the app forward on the session's project through a
   pantry://project/name link. With no app installed, it opens the URL in a browser.
5. The menu-bar icon shows the count of what needs you across every project.

Sessions and the app talk to the same hub, so nothing changes for the agents. The hub no longer
depends on Docker Desktop being up.

## Tasks

- [x] pantry hub ensure: start the hub if nothing answers, write hub.json, exit fast when it is up
- [x] A health endpoint the app and the command can both ask
- [x] pantry open, with the pantry:// link and the browser fallback
- [x] Tauri shell: window, menu-bar icon with the needs-you count, offline state with Start
- [ ] Wire ensure and open into the session-start hook on every machine. Owner call: the hook lives in agent-config, and running `pantry open` on every session start may be more forward than wanted; `pantry hub ensure` alone is safe to add first.
- [x] Retire the Docker hub. Decided by the owner on 2026-11-14: the Dockerfile, compose file and the container-network trust switch are removed, and the native hub started by pantry hub ensure is the only way to run it.
- [ ] Signing and updates for macOS and Windows. Owner call: needs an Apple Developer ID and a Windows certificate. Unsigned, macOS Gatekeeper blocks the first launch, and pantry:// links only register once the app is bundled and opened.

## Done when

A fresh login with no hub running shows the app as offline, starting a Claude session brings the
hub up and the app onto that project without a click, and the same flow works on Windows.

## Notes from the first build (2026-11-14)

- `cd app/src-tauri && cargo build` builds the shell; `cargo tauri build` bundles it. The icon is a placeholder circle; `cargo tauri icon` regenerates the set from `icons/source.png`.
- Verified on macOS against a hub on spare port 4977: the window shows the offline page, switches to the hub without a click once `pantry hub ensure` starts it, and returns to the offline page when the hub stops. Screenshots are in `artifacts/pantry-app/`.
- Not verified: the Start button by click (the synthetic click needed accessibility permission; it runs the same `pantry hub ensure` checked from the CLI), the tray count with work waiting, deep links (they need a bundled app), and Windows.
- The app runs `pantry hub ensure` through a login shell so it finds bun and pantry; `PANTRY_ENSURE` overrides the command.
