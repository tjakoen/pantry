// pantry/paths.ts — the containment rule, once.
//
// PANTRY hands out bytes and file metadata from directories a host configured, over paths that come
// off a URL, out of a readdir, or off a symlink. Every one of those surfaces has to answer the same
// question — *is this path still inside the directory I was pointed at?* — and by P4d it was being
// answered at SEVEN sites across five modules, each with its own hand-written copy of the same
// two-clause expression:
//
//   1. artifacts.ts, on its walk
//   2. app.ts, on `/artifacts/raw/`
//   3. app.ts again, on the font route
//   4. runs.ts, before it reads a report's body
//   5. capture.ts, before it writes a screenshot
//   6. capture.ts again, in the driver guard, spelled with the separator pre-appended
//   7. graph.ts, on "never touch the edge repo" — the copy nobody had connected to the other six
//
// P4d's run report called it four, counting modules and missing three of the sites. The first draft
// of THIS comment called it five and named four, which is the mistake this repo's review history
// keeps recording — an allowlist of three described as two, a comment naming a bug it did not
// prevent. So it is a list rather than a number, because a list can be checked.
//
// Seven copies of a security check is not seven checks. It is one check with six chances to be
// amended in only one place, and the amendment history of this repo says that happens: the proxy's
// double-slash hole and the write-back's extension denylist were both a rule that was right in the
// prose and wrong in one of its copies. Two of the seven had in fact already drifted — graph.ts
// compared an unresolved path against an absolute one, and the driver guard's pre-appended separator
// let a resolution landing on `node_modules` itself through. So the rule lives here, and the call
// sites say what they are protecting rather than restating how.
//
// **What this module does NOT do is resolve symlinks for you.** `isInside` compares strings. A string
// comparison cannot see through a link, so a caller that could be handed one owes a `realpath` first
// — which is exactly what `linkContained` is for.
import { lstat, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

/**
 * Is `child` really inside `parent` (or `parent` itself)?
 *
 * Both are `resolve`d so a relative path or a `..` segment is normalised away, and the separator is
 * appended before the prefix test so `/a/bc` is not read as being under `/a/b` — the prefix trick
 * that makes a naive `startsWith` a hole rather than a check.
 *
 * **Both arguments must already be REAL paths when a symlink is possible.** `resolve` normalises
 * dots and follows nothing, so a link that points out of `parent` compares as inside. Callers reading
 * the filesystem pass realpaths (see `linkContained`); callers building a path from a URL segment
 * against a root they own do not need to, because there is nothing on the way in to link through.
 *
 * **An empty string is refused rather than resolved.** `resolve("")` returns the CURRENT WORKING
 * DIRECTORY, so an unset path threaded through as `""` would silently ask a question about cwd and
 * get a confident answer to it. No caller here can reach that today; it is closed anyway, because
 * the cost of being wrong in this function is a file served from outside the directory it was meant
 * to come from, and a containment check that cannot answer should answer no.
 */
export function isInside(parent: string, child: string): boolean {
  if (!parent || !child) return false;
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * Read-side containment for one directory entry: `false` unless `path` is either not a symlink at
 * all, or a symlink whose real target is still inside `realBase`.
 *
 * `lstat`, never `stat`, so a link is seen AS a link instead of being silently dereferenced into the
 * thing it points at. A path that cannot be `lstat`ed (vanished, permission denied) and a link that
 * cannot be `realpath`ed (broken) both come back `false`: the caller skips the entry rather than
 * crashing a listing, and an entry that could not be proved contained is never treated as contained.
 *
 * `realBase` must be the realpath of the directory, not the configured path — a runs dir that is
 * itself reached through a link would otherwise fail its own containment check on every entry.
 *
 * **THE CALLER'S HALF OF THE CONTRACT, stated because it is not enforceable here.** A path that is
 * not a symlink comes back `true` without any containment test at all. That is sound for the two
 * callers this has, and only because of HOW they build the path: a basename straight out of
 * `readdir` joined onto a directory already known to be inside the base, which cannot contain a
 * separator or a `..` and so cannot leave. It is NOT sound for a path that came off a URL, out of
 * config, or from anywhere a `..` could survive — such a caller would get `true` for anything that
 * happens not to be a link. Those callers want `isInside` against a realpath instead, which is what
 * the route handlers in app.ts do.
 */
export async function linkContained(realBase: string, path: string): Promise<boolean> {
  let ls;
  try {
    ls = await lstat(path);
  } catch {
    return false;
  }
  if (!ls.isSymbolicLink()) return true;
  try {
    return isInside(realBase, await realpath(path));
  } catch {
    return false; // broken link
  }
}
