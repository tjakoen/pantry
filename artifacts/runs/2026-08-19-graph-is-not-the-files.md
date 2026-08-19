---
title: The graph is not the files, and the freshness check was asking about the wrong one
date: 2026-08-19
status: complete
lane: gated
branch: main
scope:
  - doctor.ts
  - graph.ts
  - cli.ts
  - doctor.test.ts
  - graph.test.ts
touched:
  - doctor.ts
  - graph.ts
  - doctor.test.ts
  - graph.test.ts
skills:
  - voice
  - loop-standard
plans:
gates:
  - bun run check (before) | clean
  - bun run check (after) | clean
  - bun test (before) | 643 pass, 0 fail
  - bun test (after) | 663 pass, 0 fail
  - bun run lint (before) | 28 findings, exit 1 (pre-existing)
  - bun run lint (after) | 28 findings, exit 1, zero new
  - bun cli.ts doctor . (before) | 0 failing, 4 due
  - bun cli.ts doctor . (after) | 0 failing, 4 due
diffstat: 4 files changed, 413 insertions(+), 20 deletions(-)
dirty:
unpushed: 1 | this run's commit; the push is the owner's call and was deliberately not taken
verifiedBy: nobody yet, and that is the honest state (see What needs human eyes)
doctor: 0 failing, 4 carried: graphify-freshness, e2e-presence, layer-pins, run-ledger
---

The session-start report told every session in the estate that the portfolio's code graph was stale
and named a command to fix it. The graph was current and the command did nothing.

## The reproduction

Doctor, against the portfolio at a clean HEAD:

```
[warn] graphify freshness: graph built from beaa3cbd, code moved since — run graphify update .
21 checks, 0 failing, 1 due
```

Everything the check saw:

```
$ git diff --name-only beaa3cb..HEAD
artifacts/runs/2026-08-19-consolidation-and-wiring.md
src/ai/preview-view.ts
```

One markdown file, filtered out as non-invalidating, and one TypeScript file whose entire diff was
three deleted comment lines. Graphify, asked the same question, disagreed:

```
[graphify watch] No code-graph topology changes detected; outputs left untouched.
```

## Why the two disagree

The check asked git whether a code file changed. Graphify asks whether the topology changed, and
those are different events. It re-extracts on every run, compares the result against the graph it
already has, and when nothing moved it leaves graph.json and GRAPH_REPORT.md alone. Leaving the
report alone leaves the recorded built-from commit behind HEAD, on a graph that is genuinely
current. The check read that gap as staleness.

Read directly from graphify's own source, at watch.py line 780 and following, since guessing at a
third-party tool's behavior is how the next version of this bug gets written:

```python
if same_topology:
    save_manifest(detected["files"], kind="ast", root=project_root)
    print("[graphify watch] No code-graph topology changes detected; outputs left untouched.")
    return True
```

That is the whole problem and, as it turns out, the whole fix.

## The shape chosen

Only graphify can answer the topology question, and the doctor may not run it: the doctor is
read-only and side-effect free, and a check that shells out to a build tool is neither. But graphify
leaves its answer on disk. Every successful run, including the no-change one above, rewrites
graphify-out/manifest.json with a hash of every file it folded into the current graph. Every abort
path in watch.py returns before that write, so a manifest that vouches for a file is a graph that
reflects it.

So the check now reads graphify's manifest instead of interrogating git alone. Git narrows the
question to the code files that changed; the manifest answers whether graphify has already
reconciled the graph against each one. Nothing new is written anywhere, nothing is spawned, and no
third-party stdout is parsed.

One thing worth naming for whoever maintains this next: the field is called ast_hash and it is not
an AST hash. It is an MD5 of the file bytes, which is why a comment-only edit does change it. That
was measured rather than assumed, against the portfolio's real manifest: 535 of 536 entries matched
the on-disk MD5, and the single mismatch was a markdown file edited after the last extraction.

Two properties hold the design up, and neither should be softened later for tidiness.

**It fails closed.** An absent manifest, a legacy entry carrying only an mtime, a file graphify has
never hashed, a file deleted since, or a hash algorithm that changes underneath us: every one of
those reads as "cannot confirm", which stays a warn. Pantry already treated an unverifiable graph as
a warn on purpose, and that posture is preserved rather than traded away. If graphify ever stops
writing MD5, this check goes loudly noisy instead of silently wrong, which is the correct direction
to break in.

**Every warn it raises is clearable by the remedy it names.** Graphify rewrites the manifest whether
or not it rewrites the graph, so a file reported as unreconciled becomes reconciled the moment
someone runs the named command. That is the property the git-diff version did not have, and the
reason the old warning was worse than noise: it taught people to skim past the one report every
session reads first.

## What was rejected

**The sidecar in the handoff sketch**, meaning a pantry command that runs graphify update, reads the
no-topology-change line out of its stdout and stamps a host-local file with the HEAD it verified.
Three counts against it. It needs a new artifact in a gitignored host-local directory, which is a new
convention to maintain. It pins pantry to the exact wording of a third-party tool's log line, which
will break quietly on a graphify upgrade. And it only stamps when a human remembers to run it, while
the portfolio's edit hook runs bare graphify update, so the warning that started all this would have
gone on firing until somebody typed the new command by hand. The manifest is written by the hook that
repo already runs, so it needs nobody to remember anything.

**Deleting the check** was considered and rejected. The question it asks is worth asking; it was
simply asking it of the wrong artifact.

**cli.ts was in the declared scope and was not touched.** No new command turned out to be needed,
and adding a surface nothing calls would have been scope spent on nothing.

## The pins

The regression is pinned by the same comment-only edit judged twice, with only the manifest state
differing between them: reconciled reads current, unreconciled still warns. If that pair ever stops
flipping, the check has become either a rubber stamp or the old false alarm.

Both directions were mutation-tested rather than trusted, because a test that asserts a helper agrees
with itself proves nothing. Forcing the helper to vouch for everything fails six tests; forcing it to
vouch for nothing fails the regression.

## Gate output

Before, at the parent commit:

```
$ bun run check
$ tsc --noEmit

$ bun test
 643 pass
 0 fail
 1659 expect() calls
Ran 643 tests across 23 files. [4.94s]

$ bun run lint
28 findings
error: script "lint" exited with code 1

$ bun cli.ts doctor .
21 checks, 0 failing, 4 due
```

After:

```
$ bun run check
$ tsc --noEmit

$ bun test
 663 pass
 0 fail
 1695 expect() calls
Ran 663 tests across 23 files. [4.89s]

$ bun run lint
28 findings
error: script "lint" exited with code 1

$ bun cli.ts doctor .
21 checks, 0 failing, 4 due
```

The lint gate is red before and after. It was red on arrival, the count is identical on both sides,
and the one finding whose line number moved is the same pre-existing shadowed variable in doctor.ts,
pushed down the file by the insert. Zero new findings, and no other check was weakened to get there.

Mutation results, run against the committed tests:

```
=== MUTATION 1: rubber stamp (always reconciled) ===
(fail) the same comment-only change, before graphify has seen it → warn, because nothing vouches for it
(fail) a real topology change graphify has not extracted → still warn
(fail) a code file graphify has never hashed (added since) → warn
(fail) a legacy manifest entry carrying no hash → warn, never a pass on a bare mtime
(fail) a code file deleted since the graph was built → warn (a deletion is topology)
(fail) many unreconciled files → the detail names a few and counts the rest
 93 pass
 6 fail

=== MUTATION 2: never reconciled (old always-stale behaviour) ===
(fail) a comment-only change graphify has already re-extracted → ok, graph reads current
 98 pass
 1 fail
```

The portfolio, end to end: the real repo as the working directory so git is real, its real graphify
manifest read through a symlink, and the built-from commit rewound to the one that tripped the bug.
Nothing was written to that repo and no graph was rebuilt.

```
=== with the fix ===
[ok  ] graphify freshness: graph built from beaa3cbd, HEAD is 54d80736 (1 code file(s) changed since, all already extracted, graph still current)

=== same state, old code ===
[WARN] graphify freshness: graph built from beaa3cbd, code moved since — run graphify update .
```

## What was not done

**cli.ts was in scope and was untouched**, for the reason given above: no new command was needed.

**No independent second pass.** LOOP section 2 asks for one, the envelope for this run did not
authorize subagents, and nobody else has read the diff. Called out again below rather than left to
be inferred from a frontmatter field.

**The portfolio's live doctor was not brought to a clean read**, and cannot be without a write to
that repo. Two things moved during the session, neither of them mine. Another session committed
54d80736 to the portfolio, and the portfolio's own PostToolUse hook rebuilt its graph in the
background on my tool calls, which destroyed the exact failing state before it could be shown
end to end in situ. That is why the proof above rewinds the commit against the real repo instead.
The live doctor now warns on a different row, mergedGraphIsStale, because that background rebuild
left merged-graph.json older than the graph.json it should include. That check was not touched, its
verdict is correct, and its remedy is one command. See below.

**Pantry's own graphify row still warns**, now reading 44 unreconciled files instead of a bare "code
moved since". That is honest: pantry's graph really is far behind and graphify has not run there.
The count of due rows is 4 before and after.

## What needs human eyes

**The second pass.** Nobody who did not write this change has read it. That is the one item on LOOP
section 9 this run cannot close for itself.

**One decision, and it is the reason the portfolio is not shown reading clean.** Clearing the
merged-graph warn means running pantry graph merge inside the portfolio, which writes
merged-graph.json into that repo's graphify-out. The directory is gitignored, host-local and
regenerable, and the portfolio's own hook writes into it on every edit, so the cost is close to
nothing. But the envelope for this run said not to touch the portfolio, and a write is a write. It
was not taken. Say the word and it is one command.

**The coupling, stated plainly so nobody is surprised by it later.** This check now depends on two
things about a third-party tool: that manifest.json holds a content hash per file, and that the hash
is MD5. Both were read out of graphify 0.9.5's source and measured against a real manifest. If
either changes, the check goes noisy rather than wrong, which is the failure direction it was
designed to break in, but it will need a look when graphify next moves.

**One judgment call worth confirming.** A comment-only edit does read as stale in the window between
the edit and graphify's next run, because in that window nothing on disk can confirm the graph. The
portfolio's edit hook closes that window in seconds. The alternative was running graphify from inside
the doctor, which the envelope ruled out and which would be wrong anyway.
