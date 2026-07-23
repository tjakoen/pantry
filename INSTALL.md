# Installing PANTRY

PANTRY is the BREAD stack's installable developer-docs and AI cockpit: one server, dropped into
your project, that renders the framework docs (BATCH, GRAIN, MILL, PROOF), your project's own
plan board, and (once you point it at them) your project's own docs. It never copies or moves
anything your project owns; it renders your files in place. The canonical plan for this app is
`pantry/PLAN.md` in the BREAD stack repo.

There are two paths below. Both do exactly the same steps. Pick the AI path if you are handing
this off to an agent; pick the manual path if you want to run each command yourself.

## The host contract, in short

Before either path: PANTRY is a lens, not a destination. It reads your project's `plans/` and
`docs/` where they already live and renders them. It never copies your docs into itself, never
moves them, and never edits the framework docs it bundles. Your plan files stay the single
source of truth for your project's plan board; PANTRY's board is only a projection of them.

The **mindmap** (`/map`) works the same way: PANTRY reads a code+document graph *you* generate,
it never runs a code analyzer of its own (and no model — it's AI-legible, not AI-powered). Run
`graphify update .` in your project (optionally `graphify merge-graphs` across repos for a
whole-stack map); PANTRY reads the resulting `graphify-out/` and draws it. No `graphify-out/`
yet? `/map` shows you the command instead of an error — the surface auto-disables, like any other.

## AI path

Paste the block below to your coding agent, in the root of the project you want PANTRY in.

```
Implement PANTRY in this project. Do the following, in order, and stop to report after each
numbered step:

1. Add the @tjakoen/pantry dependency to this project.
2. Run `bunx pantry init`. This scaffolds a plans/ folder (with a starter plan and a
   plans/README.md contract) and a pantry.config.json file, both at the project root.
3. Edit pantry.config.json. Set docsDirs to the folders where this project's OWN docs already
   live (for example ["./docs"] or ["./documentation"]). Do not move or copy those docs
   anywhere else, and do not create a new docs folder just to satisfy this step. Point the
   config at what already exists.
4. Run `bunx proof check` to lint the scaffolded plans/ folder. Fix anything it flags.
5. Run `bunx pantry serve`. Confirm the plan board renders at /plans and the docs render at
   /docs (both the bundled framework docs and, if configured, this project's own docs).

Hard rules, non-negotiable:

- Never copy or move this project's existing docs into plans/, into PANTRY, or anywhere else.
  Configure pantry.config.json to point at them instead.
- Never edit the bundled framework docs (BATCH, GRAIN, MILL, PROOF). They are rendered from the
  installed source, not owned by this project. BATCH's and GRAIN's explanatory docs are canonically
  homed in the portfolio package (`tjakoen.github.io/docs/<layer>/`) and resolve from there; a host
  that doesn't install that package simply sees those two doc surfaces auto-disable.
- Plans in plans/ are the source of truth. The board at /plans is a read-only projection of
  those files. Never hand-maintain the board, an index, or a second copy of plan state
  anywhere else. Update a plan's status field in its own file instead.
```

## Manual path

Run these from the root of the project you want PANTRY in, one command at a time.

1. Add the dependency.

   ```
   bun add -d @tjakoen/pantry
   ```

   PANTRY is tooling, not something your app imports at runtime, so it installs as a dev
   dependency. You should see it added to package.json's `devDependencies` and to node_modules
   (or the workspace equivalent).

2. Scaffold plans and config.

   ```
   bunx pantry init
   ```

   You should see a new `plans/` folder (a starter plan `000-welcome.md` and `plans/README.md`)
   and a new `pantry.config.json` at the project root, plus a printed list of next steps.

3. Point PANTRY at your project's existing docs. Open `pantry.config.json` and set `docsDirs`
   to the folder(s) where your docs already live, for example:

   ```
   { "docsDirs": ["./docs"] }
   ```

   You should see no new folders created by this step. You are only editing a config value,
   never moving or copying files.

4. Lint the plans.

   ```
   bunx proof check
   ```

   You should see a clean report, or a short list of schema problems to fix in the plan files
   themselves.

5. Serve the cockpit.

   ```
   bunx pantry serve
   ```

   You should see a local URL printed. Open it: the home page lists the stack, `/plans` shows
   your plan board, and `/docs` shows the framework docs alongside your own (if configured).

## Guardrails, restated

- Never copy or move your project's existing docs. Configure `docsDirs`, do not relocate files.
- Never edit the bundled framework docs. They are rendered from the installed packages (BATCH's and
  GRAIN's live in the portfolio package, `tjakoen.github.io/docs/`, per the option-b docs home).
- Plans are the source of truth. The board is a read-only projection; never hand-maintain it.

See `pantry/PLAN.md` for the full design, including the host contract and what PANTRY bundles
versus what your project provides.
