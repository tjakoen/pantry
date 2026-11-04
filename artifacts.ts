// pantry/artifacts.ts — piece 11e sub-unit 1: the ARTIFACTS surface, DATA layer (the view is in
// app.ts, same split as map.ts/decisions.ts). A run — `pantry doctor`, an audit, an agent's own
// session — deposits evidence (screenshots, audit reports, diffs) into the host's artifacts dir;
// PANTRY renders that dir read-only at /artifacts. doctor.ts's newestAuditReport already treats
// artifacts/ as a first-class scan target (alongside reports/ and docs/) — this module is the
// general-purpose surface over the same convention. This module is pure reads: it walks the dir and
// stats files, it never mutates them.
//
// **The sentence that used to be here said PANTRY writes NOTHING in this dir, and that stopped being
// true in P4d.** `pantry capture` writes screenshots and a manifest under `<artifactsDir>/reviews/<id>/`.
// It is a CLI command and no route reaches it, so the SERVER still writes nothing here and this
// surface still renders a folder it does not own. Stated rather than left as a comment that quietly
// became false, which is the failure this project has now shipped twice.
import { readdir, stat, realpath } from "node:fs/promises";
import { join, basename, extname, relative, sep } from "node:path";
import { existsSync } from "node:fs";
import { linkContained } from "./paths.ts";
import type { ResolvedPantryConfig } from "./config.ts";

export type ArtifactKind = "image" | "report" | "diff" | "html" | "other";

export interface ArtifactEntry {
  /** path relative to artifactsDir, POSIX-normalised — the /artifacts/raw/<relPath> route key */
  relPath: string;
  /** basename */
  name: string;
  kind: ArtifactKind;
  /** bytes */
  size: number;
  /** ISO string from fs stat — the real file's mtime, NOT the injected generatedAt */
  mtime: string;
  /** what the artifact IS, read from its folder and name, as a person would sort a drawer */
  type: ArtifactType;
  /** ISO, when the artifact was made: a date in its name wins, then the file's birth time, then mtime */
  created: string;
  /** where `created` came from, so the page never presents a guess as a fact */
  createdFrom: "name" | "file" | "modified";
}

/** The artifact types the explorer filters by. `kind` decides how a file previews; `type` says what
 *  it is for. A Markdown file is one kind and several types: a run report, a brief, an audit. */
export type ArtifactType = "run-report" | "brief" | "audit" | "screenshot" | "image" | "diff" | "page" | "data" | "log" | "note" | "file";

export const ARTIFACT_TYPES: Record<ArtifactType, { label: string; glyph: string; about: string }> = {
  "run-report": { label: "Run report", glyph: "▤", about: "What a session did, its gate output and what it left undone" },
  brief: { label: "Brief", glyph: "✎", about: "A handoff or plan brief written for the next session" },
  audit: { label: "Audit", glyph: "◎", about: "A review of the codebase against a rubric" },
  screenshot: { label: "Screenshot", glyph: "▣", about: "A picture of a rendered page, taken as evidence" },
  image: { label: "Image", glyph: "◫", about: "A figure or other picture" },
  diff: { label: "Diff", glyph: "±", about: "A patch or diff of a change" },
  page: { label: "HTML page", glyph: "⌘", about: "A standalone page, opened in a sandbox" },
  data: { label: "Data", glyph: "{}", about: "JSON or CSV a run produced" },
  log: { label: "Log", glyph: "≡", about: "Plain text output from a command or a run" },
  note: { label: "Note", glyph: "¶", about: "Any other Markdown" },
  file: { label: "Other", glyph: "·", about: "A file with no preview" },
};

/** Classify by folder first, then name, then extension. Folder names are matched as whole segments. */
export function artifactType(relPath: string): ArtifactType {
  const lower = relPath.toLowerCase();
  const segs = lower.split("/");
  const dirs = new Set(segs.slice(0, -1));
  const name = segs.at(-1) ?? "";
  const kind = classifyArtifact(name);
  if ((kind === "image" && ["screenshots", "shots", "reviews", "captures", "tours"].some((d) => dirs.has(d))) || (kind === "image" && /screen|shot|capture/.test(name))) return "screenshot";
  if (kind === "image") return "image";
  if (kind === "diff") return "diff";
  if (kind === "html") return "page";
  if (/\.(json|jsonl|csv|tsv|ya?ml)$/.test(name)) return "data";
  if (/\.(log|txt|out)$/.test(name)) return "log";
  if (dirs.has("audits") || dirs.has("audit") || /(^|[-_.])audit([-_.]|$)/.test(name)) return "audit";
  if (dirs.has("runs") || dirs.has("run-reports")) return "run-report";
  if (dirs.has("briefs") || dirs.has("handoffs") || /(^|[-_.])(brief|handoff)([-_.]|$)/.test(name)) return "brief";
  if (kind === "report") return "note";
  return "file";
}

/** A YYYY-MM-DD at the start of the name, or of any folder above it, is the date the author gave it. */
export function datedName(relPath: string): string | null {
  for (const seg of relPath.split("/").toReversed()) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(seg);
    if (m && !Number.isNaN(Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`))) return `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
  }
  return null;
}

export interface ArtifactsPayload {
  /** the artifactsDir exists (the list may still be empty — a healthy just-scaffolded state) */
  available: boolean;
  project: string;
  /** absolute artifactsDir, echoed so the empty-state view can tell the human where to drop files */
  dir: string;
  /** newest mtime first */
  artifacts: ArtifactEntry[];
  count: number;
  generatedAt: string;
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"]);
const HTML_EXT = new Set([".html", ".htm"]);
const DIFF_EXT = new Set([".diff", ".patch"]);
const REPORT_EXT = new Set([".md", ".txt", ".json", ".log", ".csv"]);

/** Classify by extension. Exported so the raw-file route can reuse the same table for Content-Type. */
export function classifyArtifact(name: string): ArtifactKind {
  const ext = extname(name).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (HTML_EXT.has(ext)) return "html";
  if (DIFF_EXT.has(ext)) return "diff";
  if (REPORT_EXT.has(ext)) return "report";
  return "other";
}

// How deep the walk descends below artifactsDir. Bounded so both a flat `artifacts/*.png` layout
// and a per-run `artifacts/<run-id>/...` layout are covered, without an unbounded walk over a
// misconfigured dir (e.g. artifactsDir accidentally pointed at the repo root).
const MAX_DEPTH = 4;

// POSIX-normalise a relative path for the route key, regardless of host OS separator.
const toPosix = (p: string) => p.split(sep).join("/");

// Recursively collect files under `dir` (relative to `root`), skipping dotfiles and dirs, up to
// MAX_DEPTH. A single unreadable file/dir is skipped rather than throwing — the walk must survive
// a broken symlink or a permission-denied entry without taking the whole surface down.
//
// SECURITY: a symlink is only followed — for both listing a file and recursing into a dir — when its
// resolved real path stays under `realBase` (the realpath of artifactsDir). That is `linkContained`
// in paths.ts, the same rule the raw-serve route enforces (app.ts serveArtifactRaw): a link that
// points inside is fine (it's still this project's evidence), a link that escapes (e.g.
// artifacts/escape -> /etc) is skipped so the LISTING can't enumerate an outside tree's metadata
// (names, sizes, mtimes). An entry that vanished, denied permission, or is a broken link comes back
// uncontained and is skipped the same way — the walk must survive one bad entry, not crash on it.
async function walk(realBase: string, root: string, dir: string, depth: number, out: ArtifactEntry[]): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(".")) continue; // dotfiles/dirs (.DS_Store, .git, …)
    const full = join(dir, name);
    // A symlink is only trusted when it resolves to somewhere still inside artifactsDir; otherwise it
    // (and anything under it) is skipped — no metadata from outside the dir ever reaches the payload.
    if (!(await linkContained(realBase, full))) continue;
    // With containment settled, `stat` (dereferencing) is now safe: a followed link is known-inside.
    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      await walk(realBase, root, full, depth + 1, out);
      continue;
    }
    if (!st.isFile()) continue; // sockets, fifos, etc. — not artifacts
    const relPath = toPosix(relative(root, full));
    // README.md at the artifacts root is documentation-about-the-dir, not evidence — skip it (same
    // rule decisions.ts applies to its own dir). Only the top-level one; a per-run README is evidence.
    if (relPath.toLowerCase() === "readme.md") continue;
    // Birth time is only trusted when the filesystem reports one that makes sense: a bind mount in
    // a container often answers with the epoch, and a copy can carry a birth time after its mtime.
    const named = datedName(relPath);
    const born = st.birthtime?.getTime?.() ?? 0;
    const bornOk = born > Date.UTC(2000, 0, 1) && born <= st.mtime.getTime() + 1000;
    out.push({
      relPath,
      name: basename(full),
      kind: classifyArtifact(name),
      size: st.size,
      mtime: st.mtime.toISOString(),
      type: artifactType(relPath),
      created: named ?? (bornOk ? new Date(born).toISOString() : st.mtime.toISOString()),
      createdFrom: named ? "name" : bornOk ? "file" : "modified",
    });
  }
}

/**
 * Read + list every artifact under the host's artifacts dir. Pure reads; no writes, no model.
 * Newest mtime first (what a human just produced is what they came to look at), tie-broken by
 * relPath for a stable order. An absent/unreadable dir yields available:false + an empty list, so
 * the surface degrades to guidance instead of crashing — the same posture as /map and /decisions.
 */
export async function buildArtifactsPayload(
  config: Pick<ResolvedPantryConfig, "projectName" | "artifactsDir">,
  generatedAt: string,
): Promise<ArtifactsPayload> {
  const dir = config.artifactsDir;
  const base = {
    project: config.projectName,
    dir,
    artifacts: [] as ArtifactEntry[],
    count: 0,
    generatedAt,
  };
  if (!existsSync(dir)) return { ...base, available: false };

  // Resolve the real (symlink-expanded) artifactsDir up front — the walk's containment check compares
  // each symlinked entry's real target against this, so it must itself be canonical.
  let realBase: string;
  try {
    realBase = await realpath(dir);
  } catch {
    return { ...base, available: false };
  }

  const artifacts: ArtifactEntry[] = [];
  try {
    await walk(realBase, dir, dir, 0, artifacts);
  } catch {
    return { ...base, available: false };
  }

  artifacts.sort((a, b) => b.mtime.localeCompare(a.mtime) || a.relPath.localeCompare(b.relPath));

  return {
    ...base,
    available: true,
    artifacts,
    count: artifacts.length,
  };
}
