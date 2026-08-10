// pantry/fixtures.ts — where the tests' real-corpus fixture lives. TEST-ONLY: deliberately absent
// from package.json's `files`, so it is never shipped and nothing in the server may import it.
//
// **Why this file exists at all.** Three test files each carried
// `join(import.meta.dir, "..", "proof", "example")` — a sibling-checkout path, correct only while
// PROOF was a repo next to this one. PROOF folded into grain/packages, the directory stopped
// existing, and the path did what a missing plans dir does rather than what a wrong path should:
// `loadPlans` returned an empty list, `buildIndex` built an empty index, and the assertions that
// counted plans failed while the assertions that only walked them PASSED over nothing. A fixture
// that resolves to nowhere is worse than one that throws, because a green test over an empty corpus
// is a test that has stopped asking its question.
//
// So the path is resolved through PACKAGE resolution — the rule app.ts states for its own bundled
// assets and the one these tests broke by not following — and it is asserted to exist at import
// time. `example/` is in PROOF's published `files` but not its `exports`, so the resolvable entry is
// `PLAN.md` and the example dir is reached from its directory.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PROOF's own example plans: four real plan files with real frontmatter, statuses and task lists.
 *
 * The tests want a REAL corpus rather than a hand-written one, because what they assert is that the
 * plan index, the llms.txt pack and the /plans routes are derived from what PROOF actually parses.
 * A fixture authored here would drift from PROOF's parser the first time either changed, and would
 * agree with itself while disagreeing with the thing under test.
 */
export const PROOF_EXAMPLE = join(dirname(fileURLToPath(import.meta.resolve("@tjakoen/proof/PLAN.md"))), "example");

// The check is for PLANS, not for a directory. A first version asserted only `existsSync`, which a
// reviewer pointed out closes the "resolves to nowhere" half of the bug this file names and leaves
// the "resolves to nothing inside" half wide open: a `proof` release that trims example/ to an empty
// dir, or ships it without its markdown, puts the corpus back at zero with the guard satisfied. That
// is the same failure with a different cause, and this file exists because of the failure.
const plans = existsSync(PROOF_EXAMPLE) ? readdirSync(PROOF_EXAMPLE).filter((f) => f.endsWith(".md")) : [];
if (plans.length === 0) {
  throw new Error(
    `pantry/fixtures.ts: no plan markdown at ${PROOF_EXAMPLE}. ` +
      `The tests that read it assert over a real plan corpus, and an empty or missing one makes them pass over nothing. ` +
      `Check that @tjakoen/proof is installed and still ships example/*.md in its package files.`,
  );
}
