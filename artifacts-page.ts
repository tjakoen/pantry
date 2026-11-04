// pantry/artifacts-page.ts, split out of app.ts. The page markup for one surface; app.ts keeps the routing.
import { join, basename, sep, resolve } from "node:path";
import { existsSync, realpathSync, statSync } from "node:fs";
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { isInside } from "./paths.ts";
import { renderAgentBody } from "./decisions-page.ts";
import { renderGrainDocument } from "@tjakoen/mill/adapters/grain/grain-adapter.ts";
import { ARTIFACT_TYPES, classifyArtifact, type ArtifactType, type ArtifactsPayload, type ArtifactEntry } from "./artifacts.ts";

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

// The explorer. /artifacts is a file browser over the artifacts dir. A sidebar holds the folder tree
// and the filters (type and age); the main pane holds the listing and, when a file is chosen, a
// preview beside it. Browsing a folder lists its subfolders and files; searching or filtering lists
// every match under the current folder at once, with its path. Every view is a plain address, so
// the back button, a bookmark and a link in a run report all land on the same view.
export type ArtifactSort = "made" | "modified" | "opened" | "name" | "size" | "type";
export type ArtifactAge = "" | "1d" | "7d" | "30d";
export interface ExplorerView {
  /** the folder being listed, relative to the artifacts dir, "" for the top */
  dir: string;
  q: string;
  /** the types to show; empty means all */
  types: ArtifactType[];
  /** only artifacts made within this window */
  age: ArtifactAge;
  sort: ArtifactSort;
  order: "asc" | "desc";
  /** the file open in the preview pane */
  file: string | null;
}
export interface ExplorerPreview { kind: "markdown" | "text" | "image" | "html" | "binary" | "missing"; body?: string }

const SORTS: Record<ArtifactSort, { label: string; order: "asc" | "desc" }> = {
  made: { label: "Newest made", order: "desc" }, modified: { label: "Recently modified", order: "desc" },
  opened: { label: "Recently opened", order: "desc" }, name: { label: "Name", order: "asc" },
  size: { label: "Largest", order: "desc" }, type: { label: "Type", order: "asc" },
};
const AGES: Record<Exclude<ArtifactAge, "">, { label: string; ms: number }> = {
  "1d": { label: "Today", ms: 86_400_000 }, "7d": { label: "This week", ms: 7 * 86_400_000 }, "30d": { label: "This month", ms: 30 * 86_400_000 },
};

export function explorerView(params: URLSearchParams): ExplorerView {
  const clean = (v: string | null) => (v ?? "").split("/").filter((x) => x && x !== "." && x !== "..").join("/");
  const s = params.get("sort");
  const sort: ArtifactSort = s && s in SORTS ? s as ArtifactSort : "made";
  const o = params.get("order");
  const age = params.get("age");
  return {
    dir: clean(params.get("dir")),
    q: (params.get("q") ?? "").trim().slice(0, 120),
    types: params.getAll("type").flatMap((t) => t.split(",")).filter((t): t is ArtifactType => t in ARTIFACT_TYPES),
    age: age === "1d" || age === "7d" || age === "30d" ? age : "",
    sort,
    order: o === "asc" || o === "desc" ? o : SORTS[sort].order,
    file: clean(params.get("file")) || null,
  };
}

const filtering = (v: ExplorerView) => !!(v.q || v.types.length || v.age);

interface FolderRow { name: string; path: string; count: number; size: number; mtime: string; made: string }

/** The rows for the view: a folder's direct contents, or every match below it when filtering. */
export function listing(entries: ArtifactEntry[], view: ExplorerView, opens: Record<string, string> = {}, now = Date.now()): { folders: FolderRow[]; files: ArtifactEntry[] } {
  const prefix = view.dir ? view.dir + "/" : "";
  const under = entries.filter((e) => e.relPath.startsWith(prefix));
  if (filtering(view)) {
    const q = view.q.toLowerCase();
    const cutoff = view.age ? now - AGES[view.age].ms : -Infinity;
    const hits = under.filter((e) =>
      (!q || e.relPath.toLowerCase().includes(q) || ARTIFACT_TYPES[e.type].label.toLowerCase().includes(q))
      && (!view.types.length || view.types.includes(e.type))
      && Date.parse(e.created) >= cutoff);
    return { folders: [], files: sortFiles(hits, view, opens) };
  }
  const folders = new Map<string, FolderRow>();
  const files: ArtifactEntry[] = [];
  for (const e of under) {
    const rest = e.relPath.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) { files.push(e); continue; }
    const name = rest.slice(0, slash);
    const f = folders.get(name) ?? { name, path: prefix + name, count: 0, size: 0, mtime: e.mtime, made: e.created };
    f.count++; f.size += e.size;
    if (e.mtime > f.mtime) f.mtime = e.mtime;
    if (e.created > f.made) f.made = e.created;
    folders.set(name, f);
  }
  const dirSorted = [...folders.values()].sort((a, b) => {
    const k = view.sort === "size" ? a.size - b.size
      : view.sort === "modified" ? a.mtime.localeCompare(b.mtime)
      : view.sort === "made" || view.sort === "opened" ? a.made.localeCompare(b.made)
      : a.name.localeCompare(b.name);
    return view.order === "asc" ? k : -k;
  });
  return { folders: dirSorted, files: sortFiles(files, view, opens) };
}

function sortFiles(files: ArtifactEntry[], view: ExplorerView, opens: Record<string, string>): ArtifactEntry[] {
  return files.toSorted((a, b) => {
    let k: number;
    switch (view.sort) {
      case "size": k = a.size - b.size; break;
      case "modified": k = a.mtime.localeCompare(b.mtime); break;
      // Never-opened files sort as the oldest, so "recently opened" leads with what you actually used.
      case "opened": k = (opens[a.relPath] ?? "").localeCompare(opens[b.relPath] ?? "") || a.created.localeCompare(b.created); break;
      case "name": k = a.name.localeCompare(b.name); break;
      case "type": k = ARTIFACT_TYPES[a.type].label.localeCompare(ARTIFACT_TYPES[b.type].label) || b.created.localeCompare(a.created); break;
      default: k = a.created.localeCompare(b.created) || a.mtime.localeCompare(b.mtime);
    }
    return (view.order === "asc" ? k : -k) || a.relPath.localeCompare(b.relPath);
  });
}

function href(view: ExplorerView, over: Partial<ExplorerView>): string {
  const v = { ...view, ...over };
  const p = new URLSearchParams();
  if (v.dir) p.set("dir", v.dir);
  if (v.q) p.set("q", v.q);
  for (const t of v.types) p.append("type", t);
  if (v.age) p.set("age", v.age);
  if (v.sort !== "made") p.set("sort", v.sort);
  if (v.order !== SORTS[v.sort].order) p.set("order", v.order);
  if (v.file) p.set("file", v.file);
  const qs = p.toString();
  return `/artifacts${qs ? `?${qs}` : ""}`;
}

const rawHref = (rel: string) => `/artifacts/raw/${rel.split("/").map(encodeURIComponent).join("/")}`;

function sortHeader(view: ExplorerView, col: ArtifactSort, label: string, cls = ""): string {
  const active = view.sort === col;
  const nextOrder = active ? (view.order === "asc" ? "desc" : "asc") : SORTS[col].order;
  const arrow = active ? (view.order === "asc" ? " ↑" : " ↓") : "";
  return `<th scope="col"${active ? ` aria-sort="${view.order === "asc" ? "ascending" : "descending"}"` : ""}${cls ? ` class="${cls}"` : ""}><a href="${escapeHtml(href(view, { sort: col, order: nextOrder }))}">${label}${arrow}</a></th>`;
}

function breadcrumb(view: ExplorerView, project: string): string {
  const parts = view.dir ? view.dir.split("/") : [];
  const crumbs = [`<a href="${escapeHtml(href(view, { dir: "", file: null }))}">All artifacts</a>`];
  parts.forEach((p, i) => {
    const path = parts.slice(0, i + 1).join("/");
    crumbs.push(i === parts.length - 1 ? `<span aria-current="page">${escapeHtml(p)}</span>` : `<a href="${escapeHtml(href(view, { dir: path, file: null }))}">${escapeHtml(p)}</a>`);
  });
  return `<nav class="ax-crumbs" aria-label="Folder of ${escapeHtml(project)}">${crumbs.join(`<span class="ax-sep" aria-hidden="true">/</span>`)}</nav>`;
}

/** Every folder as a nested list, with its file count, the open path expanded. */
function folderTree(entries: ArtifactEntry[], view: ExplorerView): string {
  type Node = { name: string; path: string; count: number; kids: Map<string, Node> };
  const root: Node = { name: "", path: "", count: entries.length, kids: new Map() };
  for (const e of entries) {
    const segs = e.relPath.split("/").slice(0, -1);
    let n = root;
    segs.forEach((s, i) => {
      let k = n.kids.get(s);
      if (!k) { k = { name: s, path: segs.slice(0, i + 1).join("/"), count: 0, kids: new Map() }; n.kids.set(s, k); }
      k.count++;
      n = k;
    });
  }
  const draw = (n: Node): string => {
    const kids = [...n.kids.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!kids.length) return "";
    return `<ul>${kids.map((k) => {
      const here = view.dir === k.path;
      const open = view.dir === k.path || view.dir.startsWith(k.path + "/");
      return `<li><a href="${escapeHtml(href(view, { dir: k.path, file: null }))}"${here ? ` aria-current="page"` : ""}><span class="ax-icon" aria-hidden="true">${k.kids.size ? (open ? "▾" : "▸") : "·"}</span>${escapeHtml(k.name)}<span class="ax-n">${k.count}</span></a>${open ? draw(k) : ""}</li>`;
    }).join("")}</ul>`;
  };
  return `<nav class="ax-tree" aria-label="Folders"><a href="${escapeHtml(href(view, { dir: "", file: null }))}"${view.dir ? "" : ` aria-current="page"`}><span class="ax-icon" aria-hidden="true">▾</span>All artifacts<span class="ax-n">${root.count}</span></a>${draw(root)}</nav>`;
}

function typeBadge(t: ArtifactType): string {
  const d = ARTIFACT_TYPES[t];
  return `<span class="ax-type" data-type="${t}" title="${escapeHtml(d.about)}"><span class="ax-glyph" aria-hidden="true">${escapeHtml(d.glyph)}</span>${escapeHtml(d.label)}</span>`;
}

function filters(entries: ArtifactEntry[], view: ExplorerView): string {
  const prefix = view.dir ? view.dir + "/" : "";
  const under = entries.filter((e) => e.relPath.startsWith(prefix));
  const counts = new Map<ArtifactType, number>();
  for (const e of under) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const types = (Object.keys(ARTIFACT_TYPES) as ArtifactType[]).filter((t) => counts.get(t) || view.types.includes(t)).map((t) => {
    const on = view.types.includes(t);
    const next = on ? view.types.filter((x) => x !== t) : [...view.types, t];
    return `<a class="ax-facet${on ? " is-on" : ""}" href="${escapeHtml(href(view, { types: next, file: null }))}" aria-pressed="${on}"><span class="ax-check" aria-hidden="true">${on ? "■" : "□"}</span>${typeBadge(t)}<span class="ax-n">${counts.get(t) ?? 0}</span></a>`;
  }).join("");
  const ages = (["", "1d", "7d", "30d"] as ArtifactAge[]).map((a) => {
    const on = view.age === a;
    return `<a class="ax-facet${on ? " is-on" : ""}" href="${escapeHtml(href(view, { age: a, file: null }))}" aria-pressed="${on}"><span class="ax-check" aria-hidden="true">${on ? "●" : "○"}</span>${a ? AGES[a].label : "Any time"}</a>`;
  }).join("");
  const clear = filtering(view) ? `<a class="ax-clear" href="${escapeHtml(href(view, { q: "", types: [], age: "", file: null }))}">Clear filters</a>` : "";
  return `<section class="ax-filters" aria-label="Filters"><h2>Type</h2>${types}<h2>Made</h2>${ages}${clear}</section>`;
}

function dateCell(iso: string | undefined, now: Date, note = ""): string {
  if (!iso) return `<td class="ax-date is-none">never</td>`;
  return `<td class="ax-date" title="${escapeHtml(iso.slice(0, 16).replace("T", " ") + " UTC" + note)}">${escapeHtml(relativeAge(iso, now))}</td>`;
}

function previewPane(view: ExplorerView, entry: ArtifactEntry | undefined, preview: ExplorerPreview | null, opened: string | undefined, now: Date): string {
  if (!entry || !preview || preview.kind === "missing") return `<aside class="ax-preview"><p class="cc-empty">That file is not in the artifacts folder.</p></aside>`;
  const raw = rawHref(entry.relPath);
  const close = escapeHtml(href(view, { file: null }));
  const made = entry.createdFrom === "name" ? "dated in its name" : entry.createdFrom === "file" ? "file created" : "first seen modified";
  const head = `<header class="ax-preview-head">
  <div>${typeBadge(entry.type)}<h2>${escapeHtml(entry.name)}</h2>
  <dl class="ax-facts"><dt>Path</dt><dd><code>${escapeHtml(entry.relPath)}</code></dd><dt>Made</dt><dd>${escapeHtml(entry.created.slice(0, 10))} <span class="cc-meta">(${made})</span></dd><dt>Modified</dt><dd>${escapeHtml(relativeAge(entry.mtime, now))}</dd><dt>Last opened</dt><dd>${opened ? escapeHtml(relativeAge(opened, now)) : "now, for the first time"}</dd><dt>Size</dt><dd>${escapeHtml(humanSize(entry.size))}</dd></dl></div>
  <div class="ax-preview-acts"><a class="cc-btn" href="${raw}" target="_blank" rel="noopener">Open raw</a><a class="cc-btn" href="${close}" aria-label="Close preview">Close</a></div>
</header>`;
  const body = preview.kind === "markdown" ? `<article class="note ax-md" data-grade="smooth">${preview.body ?? ""}</article>`
    : preview.kind === "text" ? `<pre class="ax-text"><code>${escapeHtml(preview.body ?? "")}</code></pre>`
    : preview.kind === "image" ? `<a href="${raw}" target="_blank" rel="noopener"><img class="ax-img" src="${raw}" alt="${escapeHtml(entry.name)}"></a>`
    : preview.kind === "html" ? `<iframe class="ax-frame" src="${raw}" sandbox="" title="${escapeHtml(entry.name)}"></iframe>`
    : `<p class="cc-empty">No preview for this kind of file. Open it raw instead.</p>`;
  return `<aside class="ax-preview">${head}${body}</aside>`;
}

export function artifactsIndexBody(
  payload: ArtifactsPayload, view: ExplorerView = explorerView(new URLSearchParams()),
  preview: ExplorerPreview | null = null, opens: Record<string, string> = {},
): string {
  const header = `<header class="ax-top">
  <h1>Artifacts</h1>
  <p class="cc-meta">Run evidence ${escapeHtml(payload.project)} keeps: run reports, briefs, audits, screenshots and diffs, served read-only. Machine twin at <a href="/artifacts.json">/artifacts.json</a>.</p>
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
  const { folders, files } = listing(payload.artifacts, view, opens, now.getTime());
  const flat = filtering(view);
  const up = view.dir && !flat
    ? `<tr class="ax-row ax-up"><td colspan="6"><a href="${escapeHtml(href(view, { dir: view.dir.split("/").slice(0, -1).join("/"), file: null }))}">↰ Up a folder</a></td></tr>` : "";
  const folderRows = folders.map((f) => `<tr class="ax-row ax-dir">
  <td><span class="ax-type is-folder"><span class="ax-glyph" aria-hidden="true">▸</span>Folder</span></td>
  <td><a href="${escapeHtml(href(view, { dir: f.path, file: null }))}">${escapeHtml(f.name)}/</a> <span class="ax-n">${f.count}</span></td>
  ${dateCell(f.made, now)}${dateCell(f.mtime, now)}<td class="ax-date is-none"></td><td class="ax-num">${escapeHtml(humanSize(f.size))}</td>
</tr>`).join("");
  const fileRows = files.map((a) => {
    const open = view.file === a.relPath;
    const shown = flat ? a.relPath.slice(view.dir ? view.dir.length + 1 : 0) : a.name;
    return `<tr class="ax-row${open ? " is-open" : ""}" data-type="${a.type}">
  <td>${typeBadge(a.type)}</td>
  <td><a href="${escapeHtml(href(view, { file: a.relPath }))}"${open ? ` aria-current="true"` : ""}>${escapeHtml(shown)}</a></td>
  ${dateCell(a.created, now, a.createdFrom === "name" ? ", from its name" : a.createdFrom === "modified" ? ", from its modified time" : "")}${dateCell(a.mtime, now)}${dateCell(opens[a.relPath], now)}<td class="ax-num">${escapeHtml(humanSize(a.size))}</td>
</tr>`;
  }).join("");
  const empty = !folders.length && !files.length ? `<tr><td colspan="6" class="cc-empty">${flat ? "Nothing matches these filters." : "This folder is empty."}</td></tr>` : "";
  const hidden = (name: string, value: string) => value ? `<input type="hidden" name="${name}" value="${escapeHtml(value)}">` : "";
  const toolbar = `<form class="ax-toolbar" method="get" action="/artifacts" role="search">
  ${hidden("dir", view.dir)}${view.types.map((t) => hidden("type", t)).join("")}${hidden("age", view.age)}
  <input type="search" name="q" value="${escapeHtml(view.q)}" placeholder="Search names and types${view.dir ? ` in ${escapeHtml(view.dir)}` : ""}" aria-label="Search artifacts">
  <label class="ax-sort">Sort <select name="sort" onchange="this.form.submit()">${(Object.keys(SORTS) as ArtifactSort[]).map((s) => `<option value="${s}"${s === view.sort ? " selected" : ""}>${SORTS[s].label}</option>`).join("")}</select></label>
  <button class="cc-btn" type="submit">Apply</button>
</form>`;
  const summary = flat
    ? `${files.length} match${files.length === 1 ? "" : "es"}${view.dir ? ` under ${escapeHtml(view.dir)}` : ""}`
    : `${folders.length ? `${folders.length} folder${folders.length === 1 ? "" : "s"}, ` : ""}${files.length} file${files.length === 1 ? "" : "s"} here`;
  const entry = view.file ? payload.artifacts.find((a) => a.relPath === view.file) : undefined;
  return `${header}
<section class="ax${view.file ? " has-preview" : ""}">
  <aside class="ax-side">${folderTree(payload.artifacts, view)}${filters(payload.artifacts, view)}</aside>
  <div class="ax-main">
    <div class="ax-bar">${breadcrumb(view, payload.project)}${toolbar}</div>
    <p class="cc-meta ax-count">${summary} · ${payload.count} in all · sorted by ${SORTS[view.sort].label.toLowerCase()}</p>
    <div class="ax-split">
      <div class="ax-list">
        <table class="ax-table">
          <thead><tr>${sortHeader(view, "type", "Type")}${sortHeader(view, "name", "Name")}${sortHeader(view, "made", "Made")}${sortHeader(view, "modified", "Modified")}${sortHeader(view, "opened", "Opened")}${sortHeader(view, "size", "Size", "ax-num")}</tr></thead>
          <tbody>${up}${folderRows}${fileRows}${empty}</tbody>
        </table>
      </div>
      ${view.file ? previewPane(view, entry, preview, opens[view.file], now) : ""}
    </div>
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
