// pantry/artifacts-page.ts, split out of app.ts. The page markup for one surface; app.ts keeps the routing.
import { join, basename, sep, resolve } from "node:path";
import { existsSync, realpathSync, statSync } from "node:fs";
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { isInside } from "./paths.ts";
import { classifyArtifact, type ArtifactsPayload, type ArtifactEntry } from "./artifacts.ts";

// /artifacts (piece 11e sub-unit 1) — run evidence: screenshots, audit reports, diffs a run
// deposited. Static server-rendered (no client script, unlike /decisions and /map); the payload is
// the machine twin at /artifacts.json. An absent/empty dir degrades to guidance, never a crash —
// same posture as every other absent-source surface.
export const KIND_LABEL: Record<ArtifactEntry["kind"], string> = {
  image: "image", report: "report", diff: "diff", html: "html", other: "file",
};

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

// A short "how long ago" for the newest-first list — humans scan for "what just happened", not a
// precise timestamp. Falls back to the ISO date once it's stale enough that "N days ago" stops helping.
export function relativeAge(iso: string, now: Date): string {
  const then = new Date(iso);
  const ms = now.getTime() - then.getTime();
  if (!Number.isFinite(ms) || ms < 0) return then.toISOString().slice(0, 10);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return then.toISOString().slice(0, 10);
}

export function artifactCard(a: ArtifactEntry, now: Date): string {
  const badge = `<span class="pantry-decision-badge pantry-artifact-badge" data-kind="${escapeHtml(a.kind)}">${escapeHtml(KIND_LABEL[a.kind])}</span>`;
  return `<a class="card pantry-member pantry-artifact-card" data-pad="sm" href="/artifacts/raw/${a.relPath.split("/").map(encodeURIComponent).join("/")}">
    <h3 class="card__title">${escapeHtml(a.name)} ${badge}</h3>
    <p class="pantry-member__role">${escapeHtml(a.relPath)}</p>
    <span class="pantry-member__status">${escapeHtml(humanSize(a.size))} · ${escapeHtml(relativeAge(a.mtime, now))}</span>
  </a>`;
}

export function artifactsIndexBody(payload: ArtifactsPayload): string {
  const header = `<header>
  <h1 class="proof-masthead">Artifacts</h1>
  <p class="proof-lede">Run evidence for ${escapeHtml(payload.project)} — screenshots, audit reports, diffs a run deposited, served read-only. PANTRY runs no model and writes nothing here. Machine twin at <a href="/artifacts.json">/artifacts.json</a>.</p>
</header>`;
  if (!payload.available || payload.artifacts.length === 0) {
    return `${header}
<div class="card pantry-map-empty" data-pad="md">
  <h2 class="card__title">No artifacts yet</h2>
  <p class="pantry-member__role">Drop run evidence here and it shows up as cards:</p>
  <pre class="pantry-map-cmd"><code>${escapeHtml(payload.dir)}/&lt;file&gt;
${escapeHtml(payload.dir)}/&lt;run-id&gt;/&lt;file&gt;   # per-run subfolders are walked too</code></pre>
  <p class="pantry-member__role">Screenshots, audit reports, diffs — anything a run writes to prove what it did.</p>
</div>`;
  }
  const now = new Date();
  return `${header}
<section class="pantry-artifacts">
  <h2 class="pantry-section-title">${payload.count} artifact${payload.count === 1 ? "" : "s"}</h2>
  <div class="card-grid pantry-members">${payload.artifacts.map((a) => artifactCard(a, now)).join("\n")}</div>
</section>`;
}

// The Content-Type served for a raw artifact — the same extension table `classifyArtifact` sorts
// on, plus the handful of exact types worth being precise about (an `other` kind still deserves the
// right MIME when it's a knowable extension; only truly unknown extensions fall to octet-stream).
export const RAW_CONTENT_TYPE: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif",
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".diff": "text/plain; charset=utf-8", ".patch": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".log": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8", ".pdf": "application/pdf",
};
export function rawContentType(name: string): string {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return RAW_CONTENT_TYPE[ext] ?? "application/octet-stream";
}

// Resolve a requested artifact path safely against the absolute artifactsDir and serve its bytes.
// SECURITY: `reqPath` is attacker-controlled (it's the URL path segment after /artifacts/raw/, already
// URL-decoded by the caller) — it can legitimately contain `../../etc/passwd`, an absolute path, or a
// segment that resolves through a symlink to somewhere outside artifactsDir. `join` alone does NOT
// stop `..` (it normalises the string but happily walks above the base), so this resolves the joined
// path to its real, symlink-expanded form and then hands both real paths to `isInside` (paths.ts),
// which is the one containment rule this repo has: exactly artifactsDir's real path (only possible if
// reqPath is empty) or a real descendant of it. Anything else — traversal, an absolute reqPath, or a symlink
// that escapes the dir — returns 404 without ever opening the file. The file must also actually exist
// (not just resolve validly) before we treat it as in-bounds, so a nonexistent path can't be probed.
export async function serveArtifactRaw(artifactsDir: string, reqPath: string): Promise<Response> {
  const joined = resolve(artifactsDir, `.${sep}${reqPath}`);
  if (!existsSync(joined)) return new Response("Not found", { status: 404 });
  let realBase: string;
  let realTarget: string;
  try {
    realBase = realpathSync(artifactsDir);
    realTarget = realpathSync(joined);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!isInside(realBase, realTarget)) return new Response("Not found", { status: 404 });
  let st;
  try {
    st = statSync(realTarget);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!st.isFile()) return new Response("Not found", { status: 404 }); // no directory listings
  const contentType = rawContentType(basename(realTarget));
  const headers: Record<string, string> = { "Content-Type": contentType };
  // A served HTML artifact must not be able to script the cockpit origin (it's arbitrary run output,
  // not PANTRY's own content) — sandbox it and stop MIME-sniffing from upgrading anything else to HTML.
  if (contentType.startsWith("text/html")) {
    headers["Content-Security-Policy"] = "sandbox";
    headers["X-Content-Type-Options"] = "nosniff";
  }
  return new Response(Bun.file(realTarget), { headers });
}
