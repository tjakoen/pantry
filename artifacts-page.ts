// pantry/artifacts-page.ts, split out of app.ts. The page markup for one surface; app.ts keeps the routing.
import { join, basename, sep, resolve } from "node:path";
import { existsSync, realpathSync, statSync } from "node:fs";
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { isInside } from "./paths.ts";
import { renderAgentBody } from "./decisions-page.ts";
import { renderGrainDocument } from "@tjakoen/mill/adapters/grain/grain-adapter.ts";
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

// The explorer. /artifacts is a file browser over the artifacts dir: folders first, then files, in a
// table sortable by any column, with a breadcrumb for where you are and a search that looks through
// every folder at once. Choosing a file opens it in a preview pane beside the list: a report renders,
// an image shows, a diff or text file shows as text, and an HTML artifact runs in a sandboxed frame.
// All of it is links and query parameters, so it works without a script and every view has an address.
export type ArtifactSort = "name" | "kind" | "size" | "mtime";
export interface ExplorerView {
  /** the folder being listed, relative to the artifacts dir, "" for the top */
  dir: string;
  /** a search across every folder; when set the listing is flat */
  q: string;
  sort: ArtifactSort;
  order: "asc" | "desc";
  /** the file open in the preview pane */
  file: string | null;
}
export interface ExplorerPreview { kind: "markdown" | "text" | "image" | "html" | "binary" | "missing"; body?: string }

export function explorerView(params: URLSearchParams): ExplorerView {
  const clean = (v: string | null) => (v ?? "").split("/").filter((x) => x && x !== "." && x !== "..").join("/");
  const sort = params.get("sort");
  return {
    dir: clean(params.get("dir")),
    q: (params.get("q") ?? "").trim().slice(0, 120),
    sort: sort === "name" || sort === "kind" || sort === "size" ? sort : "mtime",
    order: params.get("order") === "asc" ? "asc" : params.get("order") === "desc" ? "desc" : sort === "name" || sort === "kind" ? "asc" : "desc",
    file: clean(params.get("file")) || null,
  };
}

interface FolderRow { name: string; path: string; count: number; size: number; mtime: string }

/** The folders and files directly inside view.dir, or every match when searching. */
export function listing(entries: ArtifactEntry[], view: ExplorerView): { folders: FolderRow[]; files: ArtifactEntry[] } {
  const prefix = view.dir ? view.dir + "/" : "";
  if (view.q) {
    const q = view.q.toLowerCase();
    return { folders: [], files: sortFiles(entries.filter((e) => e.relPath.toLowerCase().includes(q)), view) };
  }
  const folders = new Map<string, FolderRow>();
  const files: ArtifactEntry[] = [];
  for (const e of entries) {
    if (!e.relPath.startsWith(prefix)) continue;
    const rest = e.relPath.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) { files.push(e); continue; }
    const name = rest.slice(0, slash);
    const f = folders.get(name) ?? { name, path: prefix + name, count: 0, size: 0, mtime: e.mtime };
    f.count++; f.size += e.size; if (e.mtime > f.mtime) f.mtime = e.mtime;
    folders.set(name, f);
  }
  const dirSorted = [...folders.values()].sort((a, b) => {
    const k = view.sort === "size" ? a.size - b.size : view.sort === "mtime" ? a.mtime.localeCompare(b.mtime) : a.name.localeCompare(b.name);
    return view.order === "asc" ? k : -k;
  });
  return { folders: dirSorted, files: sortFiles(files, view) };
}

function sortFiles(files: ArtifactEntry[], view: ExplorerView): ArtifactEntry[] {
  return files.toSorted((a, b) => {
    const k = view.sort === "size" ? a.size - b.size
      : view.sort === "mtime" ? a.mtime.localeCompare(b.mtime)
      : view.sort === "kind" ? a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name);
    return view.order === "asc" ? k : -k;
  });
}

function href(view: ExplorerView, over: Partial<ExplorerView>): string {
  const v = { ...view, ...over };
  const p = new URLSearchParams();
  if (v.dir) p.set("dir", v.dir);
  if (v.q) p.set("q", v.q);
  if (v.sort !== "mtime") p.set("sort", v.sort);
  if (v.order !== (v.sort === "name" || v.sort === "kind" ? "asc" : "desc")) p.set("order", v.order);
  if (v.file) p.set("file", v.file);
  const qs = p.toString();
  return `/artifacts${qs ? `?${qs}` : ""}`;
}

const rawHref = (rel: string) => `/artifacts/raw/${rel.split("/").map(encodeURIComponent).join("/")}`;

function sortHeader(view: ExplorerView, col: ArtifactSort, label: string, numeric = false): string {
  const active = view.sort === col;
  const nextOrder = active ? (view.order === "asc" ? "desc" : "asc") : numeric || col === "mtime" ? "desc" : "asc";
  const arrow = active ? (view.order === "asc" ? " ↑" : " ↓") : "";
  return `<th scope="col"${active ? ` aria-sort="${view.order === "asc" ? "ascending" : "descending"}"` : ""}${numeric ? ` class="ax-num"` : ""}><a href="${escapeHtml(href(view, { sort: col, order: nextOrder }))}">${label}${arrow}</a></th>`;
}

function breadcrumb(view: ExplorerView, project: string): string {
  const parts = view.dir ? view.dir.split("/") : [];
  const crumbs = [`<a href="${escapeHtml(href(view, { dir: "", q: "", file: null }))}">${escapeHtml(project)}</a>`];
  parts.forEach((p, i) => {
    const path = parts.slice(0, i + 1).join("/");
    crumbs.push(i === parts.length - 1 && !view.q ? `<span aria-current="page">${escapeHtml(p)}</span>` : `<a href="${escapeHtml(href(view, { dir: path, q: "", file: null }))}">${escapeHtml(p)}</a>`);
  });
  if (view.q) crumbs.push(`<span aria-current="page">search “${escapeHtml(view.q)}”</span>`);
  return `<nav class="ax-crumbs" aria-label="Folder">${crumbs.join(`<span class="ax-sep" aria-hidden="true">/</span>`)}</nav>`;
}

function previewPane(view: ExplorerView, entry: ArtifactEntry | undefined, preview: ExplorerPreview | null, now: Date): string {
  if (!view.file) return `<aside class="ax-preview is-empty"><p class="cc-empty">Choose a file to preview it here.</p></aside>`;
  if (!entry || !preview || preview.kind === "missing") return `<aside class="ax-preview"><p class="cc-empty">That file is not in the artifacts folder.</p></aside>`;
  const raw = rawHref(entry.relPath);
  const close = escapeHtml(href(view, { file: null }));
  const head = `<header class="ax-preview-head">
  <div><h2>${escapeHtml(entry.name)}</h2><p class="cc-meta"><code>${escapeHtml(entry.relPath)}</code> · ${escapeHtml(humanSize(entry.size))} · ${escapeHtml(relativeAge(entry.mtime, now))}</p></div>
  <div class="ax-preview-acts"><a class="cc-btn" href="${raw}" target="_blank" rel="noopener">Open raw</a><a class="cc-btn" href="${close}" aria-label="Close preview">Close</a></div>
</header>`;
  const body = preview.kind === "markdown" ? `<article class="note ax-md" data-grade="smooth">${preview.body ?? ""}</article>`
    : preview.kind === "text" ? `<pre class="ax-text"><code>${escapeHtml(preview.body ?? "")}</code></pre>`
    : preview.kind === "image" ? `<a href="${raw}" target="_blank" rel="noopener"><img class="ax-img" src="${raw}" alt="${escapeHtml(entry.name)}"></a>`
    : preview.kind === "html" ? `<iframe class="ax-frame" src="${raw}" sandbox="" title="${escapeHtml(entry.name)}"></iframe>`
    : `<p class="cc-empty">No preview for this kind of file. Open it raw instead.</p>`;
  return `<aside class="ax-preview">${head}${body}</aside>`;
}

export function artifactsIndexBody(payload: ArtifactsPayload, view: ExplorerView = explorerView(new URLSearchParams()), preview: ExplorerPreview | null = null): string {
  const header = `<header class="ax-top">
  <h1>Artifacts</h1>
  <p class="cc-meta">Run evidence for ${escapeHtml(payload.project)}: screenshots, audit reports and diffs a run left behind, served read-only. Machine twin at <a href="/artifacts.json">/artifacts.json</a>.</p>
</header>`;
  if (!payload.available || payload.artifacts.length === 0) {
    return `${header}
<div class="card pantry-map-empty" data-pad="md">
  <h2 class="card__title">No artifacts yet</h2>
  <p class="pantry-member__role">Drop run evidence here and it shows up in the explorer:</p>
  <pre class="pantry-map-cmd"><code>${escapeHtml(payload.dir)}/&lt;file&gt;
${escapeHtml(payload.dir)}/&lt;run-id&gt;/&lt;file&gt;   # per-run subfolders are walked too</code></pre>
</div>`;
  }
  const now = new Date();
  const { folders, files } = listing(payload.artifacts, view);
  const up = view.dir && !view.q
    ? `<tr class="ax-row ax-up"><td colspan="4"><a href="${escapeHtml(href(view, { dir: view.dir.split("/").slice(0, -1).join("/"), file: null }))}">↰ Up a folder</a></td></tr>` : "";
  const folderRows = folders.map((f) => `<tr class="ax-row ax-dir">
  <td><a href="${escapeHtml(href(view, { dir: f.path, file: null }))}"><span class="ax-icon" aria-hidden="true">▸</span>${escapeHtml(f.name)}/</a></td>
  <td>folder · ${f.count}</td><td class="ax-num">${escapeHtml(humanSize(f.size))}</td><td>${escapeHtml(relativeAge(f.mtime, now))}</td>
</tr>`).join("");
  const fileRows = files.map((a) => {
    const open = view.file === a.relPath;
    return `<tr class="ax-row${open ? " is-open" : ""}">
  <td><a href="${escapeHtml(href(view, { file: a.relPath }))}"${open ? ` aria-current="true"` : ""}>${escapeHtml(view.q ? a.relPath : a.name)}</a></td>
  <td><span class="ax-kind" data-kind="${escapeHtml(a.kind)}">${escapeHtml(KIND_LABEL[a.kind])}</span></td>
  <td class="ax-num">${escapeHtml(humanSize(a.size))}</td><td title="${escapeHtml(a.mtime)}">${escapeHtml(relativeAge(a.mtime, now))}</td>
</tr>`;
  }).join("");
  const empty = !folders.length && !files.length ? `<tr><td colspan="4" class="cc-empty">${view.q ? "Nothing matches that search." : "This folder is empty."}</td></tr>` : "";
  const search = `<form class="ax-search" method="get" action="/artifacts" role="search">
  ${view.dir ? `<input type="hidden" name="dir" value="${escapeHtml(view.dir)}">` : ""}
  <input type="search" name="q" value="${escapeHtml(view.q)}" placeholder="Search all ${payload.count} files" aria-label="Search artifacts">
  ${view.q ? `<a href="${escapeHtml(href(view, { q: "", file: null }))}">Clear</a>` : ""}
</form>`;
  const entry = view.file ? payload.artifacts.find((a) => a.relPath === view.file) : undefined;
  return `${header}
<section class="ax${view.file ? " has-preview" : ""}">
  <div class="ax-bar">${breadcrumb(view, payload.project)}${search}</div>
  <div class="ax-split">
    <div class="ax-list">
      <table class="ax-table">
        <thead><tr>${sortHeader(view, "name", "Name")}${sortHeader(view, "kind", "Kind")}${sortHeader(view, "size", "Size", true)}${sortHeader(view, "mtime", "Modified")}</tr></thead>
        <tbody>${up}${folderRows}${fileRows}${empty}</tbody>
      </table>
      <p class="cc-meta ax-count">${folders.length ? `${folders.length} folder(s), ` : ""}${files.length} file(s)${view.q ? " found" : " here"} · ${payload.count} in all</p>
    </div>
    ${view.file ? previewPane(view, entry, preview, now) : ""}
  </div>
</section>`;
}

// A report keeps its own heading: MILL lifts the first heading out as the title, which suits a page
// that prints the title elsewhere, but here the heading is part of what the report says.
function renderReport(md: string): string {
  try {
    return renderGrainDocument(md, { defaultLayout: ({ title, body }) => `${title && !/^\s*<h1[\s>]/.test(body) ? `<h1>${escapeHtml(title)}</h1>` : ""}${body}` }).html;
  } catch {
    return renderAgentBody(md);
  }
}

/** Read what the preview pane shows, through the same containment check the raw route uses. */
export async function readPreview(artifactsDir: string, entry: ArtifactEntry | undefined): Promise<ExplorerPreview> {
  if (!entry) return { kind: "missing" };
  if (entry.kind === "image") return { kind: "image" };
  if (entry.kind === "html") return { kind: "html" };
  const res = await serveArtifactRaw(artifactsDir, entry.relPath);
  if (!res.ok) return { kind: "missing" };
  const textual = entry.kind === "report" || entry.kind === "diff" || /\.(txt|json|jsonl|log|csv|ya?ml|ts|js|css|sh)$/i.test(entry.name);
  if (!textual || entry.size > 512 * 1024) return { kind: "binary" };
  const text = await res.text();
  if (/\.md$/i.test(entry.name)) return { kind: "markdown", body: renderReport(text) };
  return { kind: "text", body: text };
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
