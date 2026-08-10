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
it never runs a code analyzer of its own (and no model, it's AI-legible, not AI-powered). Run
`graphify update .` in your project (optionally `graphify merge-graphs` across repos for a
whole-stack map); PANTRY reads the resulting `graphify-out/` and draws it. No `graphify-out/`
yet? `/map` shows you the command instead of an error: the surface auto-disables, like any other.

## The dev preview proxy (off unless you ask for it)

One optional key changes the shape of the server, so it is worth reading before you set it.
`previewTarget` points PANTRY at a project you are already running locally, and PANTRY then serves
that project **at its own root** so it can be reviewed from inside PANTRY's origin:

```json
{ "previewTarget": "http://localhost:3000" }
```

Three things follow from it, and the first surprises people:

- **PANTRY's own routes move under `/__pantry`.** The root belongs to the reviewed project, whole.
  That is deliberate: it is what lets the project's own root-relative URLs keep resolving with
  nothing rewritten. The boot banner prints the moved doors.
- **The target must be loopback and an origin.** No path, no credentials, nothing read off the
  request. A target that fails those checks is refused with a reason and the proxy stays off, which
  is also what happens when the key is absent.
- **Point it at a production build, not a dev server.** There is no websocket passthrough, so
  hot-reload has nothing to travel on. `bun run build` then start, and review what actually ships.

A target is also a per-session choice, so it can come from the command line instead of the config,
which is usually what you want in a repo whose own config is already good:

```
bunx pantry serve --preview http://localhost:3000
```

The single change PANTRY makes to a proxied page is one script tag before the closing body tag.
Nothing else about the reviewed project is rewritten, and the project installs nothing.

With a target set, `/__pantry/review` draws PANTRY's chrome around the project: the project itself in
a same-origin frame, and a rail beside it that lists the project's own tours, shows where the frame
is, and hides when you want the width. The rail reads the reviewed project's tour manifest through
the proxy, so a project that mounts CRUMB gets its tours listed with no extra configuration, and one
that does not gets a rail with just its navigation.

## Capture: driving the review instead of watching it

`pantry capture <tour-id>` walks a tour against the reviewed project and writes what it saw into
`artifacts/reviews/<date>-<tour-id>/`: one screenshot per step, a crop of the element each step is
about, a manifest, and an index that reads with nothing running.

```
bunx pantry capture review-refunds --preview http://localhost:3000
```

It exists because of when a broken address is cheapest to find. A tour resolves each step by its
`data-surface` name, and a name that no longer matches anything fails one of two ways: loudly here,
in a harness, or silently at review time, lighting the wrong element in front of the one person who
trusted it. So capture **exits nonzero** when a step's address matches nothing, matches more than one
element, or matches an element with no box. The ambiguous case is the one worth setting up for: an
address on a component that appears on six routes resolves to whichever copy the query reaches first,
and that is the drift the whole layer exists to avoid.

Three things it deliberately does not do:

- **It does not ship a browser.** Playwright is resolved from your repo, and PANTRY's own copy is
  refused on purpose, because a capture that works only while PANTRY is a sibling checkout is a green
  that disappears the day PANTRY installs as a dependency. With none installed you get the two
  commands to run and nothing else happens.
- **It does not guess how to start your project.** If the target is already answering it is left
  alone. If it is not, capture runs `previewCommand` and only that, in its own process group, killed
  when capture ends:

  ```json
  { "previewCommand": "bun run start", "previewCommandCwd": "../the-project" }
  ```

  Both are also flags (`--start`, `--start-cwd`) for the usual reason: which project you are
  reviewing today is a session's choice, not the repo's. With no command configured and nothing
  answering, capture stops and tells you what to run. This key is the one place PANTRY knows how to
  run a project rather than read one, and it is bounded to that.
- **It does not review what you did not see.** The pages are loaded through PANTRY's own proxy, so
  the pixels in the folder are the pixels of the embed, and motion is disabled so every shot is a
  settled state rather than a frame of a transition.

## The two things PANTRY writes

Every other surface is a pure read. There are exactly two exceptions, and both are small enough to
state completely. The first is the answer log below. The second is capture, above, which writes only
under `artifacts/reviews/<id>/`, only PNG, JSON and Markdown, and only after the resolved directory
has been proved to sit inside the configured artifacts dir. Capture is a command; no route reaches
it, and the running server writes nothing but the log.

### The answer log

An agent that cannot decide something alone raises a question: a decision request under
`plans/decisions/`, or a decision card at the end of a review tour. The answer comes back on **one
append-only log**, whichever surface it was given on, and the next session reads it. The path is
config, never a request:

```json
{ "answersLog": "plans/decisions/answers.jsonl" }
```

That is also the default, so most projects set nothing. Point it at an absolute path outside the repo
to keep one log per machine instead of one per repo. Do not give it a `.log` extension: `*.log` sits
in nearly every .gitignore, and a per-repo log the repo never commits is not one.

From a session:

```
bunx pantry answers                  what has been answered, unread first — read this on WAKE
bunx pantry answers wait <ref>       block until that question is answered (only while you are alive)
bunx pantry answers ack <id>         record that you acted on one
bunx pantry answers record --ref <id> --question "…" --choice "…"
                                     write down an answer that arrived by paste, so one channel stays one
```

The bounds on the write, in full: it accepts a POST from this machine only (checked on the socket,
not on a header), stops reading at the body cap rather than measuring afterwards, refuses an entry
that does not carry its own question, appends a single line, and writes to the configured path and
nowhere else. The configured path itself must end in `.jsonl` or `.ndjson` and must not be a symlink,
so a mistyped key cannot turn this into a writer of plans, source or dotfiles. It never edits or
deletes an entry. PANTRY still runs no model and still never touches `plans/*.md`, content, or code.

## AI path

Paste the block below to your coding agent, in the root of the project you want PANTRY in.

```
Implement PANTRY in this project. Do the following, in order, and stop to report after each
numbered step:

1. Add the @tjakoen/pantry dependency to this project. PANTRY is not published to a registry: add
   it as a Bun git dependency pinned to a commit, with
   `bun add -d @tjakoen/pantry@github:tjakoen/pantry#main`.
2. Run `bunx pantry init --kit`. This scaffolds a plans/ folder (with a starter plan and a
   plans/README.md contract), a pantry.config.json file, a CLAUDE.md seeded from the published
   starter, and an AGENTS.md symlink to it, all at the project root. The `--kit` flag matters:
   `bunx pantry doctor` (step 7) checks for the CLAUDE.md and the AGENTS.md symlink, and a plain
   `init` without `--kit` leaves both missing, so doctor fails two of its checks.
3. Edit pantry.config.json. Set docsDirs to the folders where this project's OWN docs already
   live (for example ["./docs"] or ["./documentation"]). Do not move or copy those docs
   anywhere else, and do not create a new docs folder just to satisfy this step. Point the
   config at what already exists.
4. Run `bunx proof check` to lint the scaffolded plans/ folder. Fix anything it flags.
5. Run `bunx pantry serve`. Confirm the plan board renders at /plans and the docs render at
   /docs (both the bundled framework docs and, if configured, this project's own docs).
6. Run `bunx pantry skills sync`. This mounts the cross-repo standards as agent skills under
   .claude/skills/, so they load themselves in this repo instead of waiting to be cited. They are
   generated and gitignored; never commit them and never edit them in place, and re-run this after
   the standards change. Then run `bunx pantry skills list` and confirm every skill reads ok. A
   skill that is written to disk but missing from your agent's skill listing has hit a name
   collision with a built-in; the fix is a `skill:` key in the standard, not a rename here.
7. Run `bunx pantry doctor`. Confirm it reports 0 failing. This is the mechanical, CI-able check
   that the kit scaffolded in step 2 is intact (CLAUDE.md present, AGENTS.md a real symlink to it,
   plus staleness checks). If anything fails, fix what it names rather than re-running init.

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
   bun add -d @tjakoen/pantry@github:tjakoen/pantry#main
   ```

   PANTRY is not published to a registry: it is an app, installed as a Bun git dependency pinned
   to a commit. It is tooling, not something your app imports at runtime, so it installs as a dev
   dependency. You should see it added to package.json's `devDependencies` and to node_modules
   (or the workspace equivalent).

2. Scaffold plans, config, and the loop kit.

   ```
   bunx pantry init --kit
   ```

   You should see a new `plans/` folder (a starter plan `000-welcome.md` and `plans/README.md`),
   a new `pantry.config.json`, a CLAUDE.md seeded from the published starter, and an AGENTS.md
   symlink to it, all at the project root, plus a printed list of next steps. `--kit` matters:
   `bunx pantry doctor` (step 4b) checks for the CLAUDE.md and the AGENTS.md symlink, and a plain
   `init` without `--kit` leaves both missing, so doctor fails two of its checks.

2b. Mount the standards as agent skills.

   ```
   bunx pantry skills sync
   bunx pantry skills list
   ```

   This writes `.claude/skills/<name>/SKILL.md` for each standard, generated from the canon in the
   `tjakoen.github.io` package. The folder gitignores itself, so nothing here is ever committed and
   no repo carries a copy of a standard. Edit the standard in its home repo and re-run the sync.

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

4b. Verify kit compliance.

   ```
   bunx pantry doctor
   ```

   You should see 0 failing. This is the mechanical, CI-able check that the kit scaffolded in
   step 2 is intact (CLAUDE.md present, AGENTS.md a real symlink to it, plus staleness checks).
   If anything fails, fix what it names rather than re-running init.

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
