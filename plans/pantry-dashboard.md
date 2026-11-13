---
id: pantry-dashboard
status: done
track: ui
depends: []
touches: [brief-routes.ts, pantry.css, brief.test.ts, app.test.ts]
owner: ai
---

# Make the command center a dashboard

The command center is one long page that scrolls. What made Obsidian feel right was a fixed
workspace: projects down the side, the work in the middle, and a reading pane on the right. This
plan gives PANTRY that shape while keeping the same pages and the same data.

The first step already landed in the working tree: Needs you is the first column, and its chips
lead the summary row.

## The layout

- A left sidebar lists the projects, each with a count of what needs you. Worktrees fold under
  their parent repo instead of sitting in the list as projects of their own.
- Under the projects sit four views: Now, Plans, Review and Project. The eleven pages behind the
  current menus fold into those four, and llms.txt and About move to the Project view.
- The middle opens with four tiles: Needs you, Working, Ready and Drift. Below them sits the Needs
  you list, and under that, Working now and Up next side by side.
- Finished sessions collapse into one line, such as "3 finished today". A card with nothing written
  in it does not render.
- Selecting an item opens it in a right pane as rendered Markdown. A decision is answered in that
  pane without leaving the page.

## Tasks

- [x] Sidebar with projects and the folded worktrees
- [x] Fold the navigation into Now, Plans, Review and Project
- [x] Stat tiles that link to their own filtered view, so no two chips share a target
- [x] Collapse finished sessions and drop empty cards
- [x] Right preview pane, with the decision answer form inside it
- [x] Check every page in Safari as well as Chromium, since the app in pantry-app renders through
      WebKit on macOS
- [x] Screenshot each view before calling it done

## Done when

The command center opens to the tiles and the Needs you list without scrolling, every item opens in
the pane, and the tests and a Safari check both pass.

## Left

- Need counts per project in the sidebar. The hub registry (`~/.pantry/projects.json`) holds names
  and ports only, so a count would mean building every project's brief on each page render. It
  needs the hub to cache a per-project count first; until then the sidebar shows names alone.
