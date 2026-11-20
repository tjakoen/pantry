// pantry/design-diagrams.ts — the Design surface's diagrams, drawn as inline SVG on the server.
// Each diagram follows its method's notation: crow's-foot for the ERD, Gane and Sarson for the DFD,
// C4 for the architecture, and a flowchart for user flows. Every node and edge is a link to its
// detail, and carries data-node / data-edge attributes that DIAGRAM_SCRIPT uses for hover
// highlighting. Pan and zoom work on the viewBox, so nothing here needs a library.
// Colours are the theme's ink, paper and rule: the palette is closed, so state is shown by line
// weight, dashes and words, never by a new hue.
import { escapeHtml as e } from "@tjakoen/mill/core/engine.ts";
import type { DesignModel, ArchLevel, UserFlow, DfdNode } from "./design.ts";
import { crossesRegion } from "./design.ts";

interface Box { id: string; x: number; y: number; w: number; h: number }

const CHAR = 6.8; // approximate width of one 12px character
const textW = (s: string, min = 0) => Math.max(min, Math.ceil(s.length * CHAR) + 24);
const href = (path: string) => `href="${e(path)}"`;
const enc = encodeURIComponent;

/** The point where a line from the box's centre toward (tx, ty) leaves the box. */
function edgePoint(b: Box, tx: number, ty: number, shape: "rect" | "diamond" = "rect"): [number, number] {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const hw = b.w / 2, hh = b.h / 2;
  const t = shape === "diamond"
    ? 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
    : Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}

const centre = (b: Box): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];

// Labels already placed in the diagram being drawn; a new label steps away until it overlaps none.
let placed: Box[] = [];
// Labels are drawn last, above every node, so a node never hides one.
let labels: string[] = [];
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function edgeLabel(x: number, y: number, text: string): string {
  if (!text) return "";
  const w = textW(text) - 12;
  let box: Box = { id: "", x: x - w / 2, y: y - 9, w, h: 18 };
  for (let i = 1; i < 12 && placed.some((p) => overlaps(p, box)); i++) {
    const step = Math.ceil(i / 2) * 22 * (i % 2 ? 1 : -1);
    box = { ...box, y: y - 9 + step };
  }
  placed.push(box);
  const cy = box.y + 9;
  labels.push(`<g class="pd-elabel"><rect x="${box.x}" y="${box.y}" width="${w}" height="18" rx="3"/><text x="${x}" y="${cy + 4}" text-anchor="middle">${e(text)}</text></g>`);
  return "";
}

const DEFS = `<defs>
  <marker id="pd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="pd-arrowhead"/></marker>
</defs>`;

/** Wraps an SVG with the toolbar and viewport DIAGRAM_SCRIPT drives. */
function frame(kind: string, w: number, h: number, inner: string, label: string): string {
  const W = Math.ceil(w), H = Math.ceil(h);
  return `<figure class="pantry-diagram" data-diagram="${kind}">
  <div class="pantry-diagram__bar" role="toolbar" aria-label="Diagram controls">
    <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
    <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
    <button type="button" data-zoom="reset">Fit</button>
    <span class="pantry-member__role">Scroll or pinch to zoom, drag to pan, hover to trace, click to open.</span>
  </div>
  <svg class="pantry-diagram__svg" viewBox="0 0 ${W} ${H}" data-w="${W}" data-h="${H}" role="img" aria-label="${e(label)}" xmlns="http://www.w3.org/2000/svg">${DEFS}${inner}<g class="pd-labels">${labels.join("")}</g></svg>
</figure>`;
}

// ── layered layout, shared by the C4 and flow diagrams ─────────────────────────────────────────

/** Longest-path layering over a directed graph; cycles are broken by visiting each node once. */
function layers(ids: string[], edges: [string, string][]): string[][] {
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const [a, b] of edges) {
      if (a === b || !rank.has(a) || !rank.has(b)) continue;
      const want = rank.get(a)! + 1;
      if (want > rank.get(b)! && want < ids.length) { rank.set(b, want); moved = true; }
    }
    if (!moved) break;
  }
  const out: string[][] = [];
  for (const id of ids) (out[rank.get(id)!] ??= []).push(id);
  return out.filter(Boolean);
}

// ── ERD: crow's-foot ───────────────────────────────────────────────────────────────────────────

const ROW = 20, HEAD = 30, ERD_W = 230;

export function erdSvg(m: DesignModel, selected?: string): string {
  placed = []; labels = [];
  const erd = m.erd!;
  const ents = new Map(erd.entities.map((x) => [x.id, x]));
  // A foreign key into a table outside the schema files (auth.users) still gets a stub box.
  for (const r of erd.relations) if (!ents.has(r.to)) ents.set(r.to, { id: r.to, primaryKey: r.refColumns, columns: r.refColumns.map((c) => ({ name: c, pk: true })) as never, rls: undefined });
  // Referenced tables sit to the left of the tables that point at them.
  const rank = new Map<string, number>();
  const rankOf = (id: string, seen = new Set<string>()): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = erd.relations.filter((r) => r.from === id && r.to !== id).map((r) => rankOf(r.to, seen) + 1);
    const v = parents.length ? Math.max(...parents) : 0;
    rank.set(id, v);
    return v;
  };
  for (const id of ents.keys()) rankOf(id);
  const cols: string[][] = [];
  for (const id of ents.keys()) (cols[rank.get(id)!] ??= []).push(id);
  const GAPX = 120, GAPY = 36, PAD = 24;
  const boxes = new Map<string, Box>();
  let H = 0;
  cols.forEach((col, ci) => {
    let y = PAD;
    for (const id of col ?? []) {
      const h = HEAD + ents.get(id)!.columns.length * ROW + 8;
      boxes.set(id, { id, x: PAD + ci * (ERD_W + GAPX), y, w: ERD_W, h });
      y += h + GAPY;
    }
    H = Math.max(H, y);
  });
  const W = PAD * 2 + cols.length * ERD_W + (cols.length - 1) * GAPX;
  const rowY = (id: string, col: string) => {
    const b = boxes.get(id)!, i = ents.get(id)!.columns.findIndex((c) => c.name === col);
    return b.y + HEAD + (i < 0 ? 0 : i) * ROW + ROW / 2 + 2;
  };

  const edges = erd.relations.map((r) => {
    const a = boxes.get(r.from)!, b = boxes.get(r.to)!;
    const y1 = rowY(r.from, r.columns[0] ?? ""), y2 = rowY(r.to, r.refColumns[0] ?? "");
    const leftward = b.x + b.w <= a.x;
    const x1 = leftward ? a.x : a.x + a.w, x2 = leftward ? b.x + b.w : b.x;
    const dir = leftward ? -1 : 1;
    const bend = Math.max(40, Math.abs(x2 - x1) / 2);
    const card = r.cardinality ?? "many-to-one";
    const [fromEnd, toEnd] = card.split("-to-");
    const nullable = r.columns.some((c) => ents.get(r.from)!.columns.find((x) => x.name === c)?.nullable);
    // The child's end: a crow's foot for many, a bar for one.
    const s = dir; // the direction the line leaves the child
    const foot = fromEnd === "many"
      ? `<path class="pd-card" d="M${x1},${y1 - 7} L${x1 + s * 14},${y1} L${x1},${y1 + 7}"/><line class="pd-card" x1="${x1 + s * 18}" y1="${y1 - 7}" x2="${x1 + s * 18}" y2="${y1 + 7}"/>`
      : `<line class="pd-card" x1="${x1 + s * 10}" y1="${y1 - 7}" x2="${x1 + s * 10}" y2="${y1 + 7}"/>`;
    // The parent's end: two bars for exactly one, a ring and a bar for zero or one.
    const t = -dir;
    const head = toEnd?.startsWith("zero")
      ? `<circle class="pd-card pd-ring" cx="${x2 + t * 20}" cy="${y2}" r="5"/><line class="pd-card" x1="${x2 + t * 9}" y1="${y2 - 7}" x2="${x2 + t * 9}" y2="${y2 + 7}"/>`
      : `<line class="pd-card" x1="${x2 + t * 9}" y1="${y2 - 7}" x2="${x2 + t * 9}" y2="${y2 + 7}"/><line class="pd-card" x1="${x2 + t * 15}" y1="${y2 - 7}" x2="${x2 + t * 15}" y2="${y2 + 7}"/>`;
    return `<a class="pd-edge" data-edge="${e(r.id)}" data-ends="${e(r.from)} ${e(r.to)}" ${href(`/design/erd/${enc(r.from)}`)}>
  <title>${e(r.id)}: ${e(r.from)}(${e(r.columns.join(", "))}) → ${e(r.to)}(${e(r.refColumns.join(", "))}), ${e(card)}${nullable ? ", optional" : ""}${r.onDelete ? `, on delete ${e(r.onDelete)}` : ""}</title>
  <path class="pd-line${nullable ? " pd-optional" : ""}" d="M${x1},${y1} C${x1 + dir * bend},${y1} ${x2 - dir * bend},${y2} ${x2},${y2}"/>
  <path class="pd-hit" d="M${x1},${y1} C${x1 + dir * bend},${y1} ${x2 - dir * bend},${y2} ${x2},${y2}"/>
  ${foot}${head}
</a>`;
  }).join("");

  const nodes = [...boxes.values()].map((b) => {
    const ent = ents.get(b.id)!;
    const stub = !erd.entities.some((x) => x.id === b.id);
    const fkCols = new Set(erd.relations.filter((r) => r.from === b.id).flatMap((r) => r.columns));
    const rows = ent.columns.map((c, i) => {
      const y = b.y + HEAD + i * ROW + ROW / 2 + 6;
      const key = c.pk ? "PK" : fkCols.has(c.name) ? "FK" : "";
      return `<text class="pd-key" x="${b.x + 10}" y="${y}">${key}</text><text class="pd-col${c.pk ? " pd-pk" : ""}" x="${b.x + 38}" y="${y}">${e(c.name)}</text><text class="pd-type" x="${b.x + b.w - 10}" y="${y}" text-anchor="end">${e((c.type ?? "") + (c.nullable ? "?" : ""))}</text>`;
    }).join("");
    const sel = b.id === selected ? " is-selected" : "";
    return `<a class="pd-node${stub ? " pd-stub" : ""}${sel}" data-node="${e(b.id)}" ${stub ? "" : href(`/design/erd/${enc(b.id)}`)}>
  <title>${e(b.id)}${ent.rls ? " (row-level security on)" : ""}${stub ? " (outside the schema files)" : ""}</title>
  <rect class="pd-box" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6"/>
  <path class="pd-head" d="M${b.x},${b.y + HEAD} h${b.w}"/>
  <text class="pd-title" x="${b.x + 10}" y="${b.y + 20}">${e(b.id)}</text>
  ${ent.rls ? `<text class="pd-tag" x="${b.x + b.w - 10}" y="${b.y + 20}" text-anchor="end">RLS</text>` : ""}
  ${rows}
</a>`;
  }).join("");
  return frame("erd", W, H, `<g class="pd-edges">${edges}</g><g class="pd-nodes">${nodes}</g>`, `Entity relationship diagram with ${erd.entities.length} tables`);
}

// ── DFD: Gane and Sarson ───────────────────────────────────────────────────────────────────────

function dfdShape(n: DfdNode, b: Box, index: number): string {
  const label = `<text class="pd-title" x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + (n.kind === "process" ? 10 : 5)}" text-anchor="middle">${e(n.label)}</text>`;
  if (n.kind === "process") // rounded rectangle with an id strip across the top
    return `<rect class="pd-box" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12"/><path class="pd-head" d="M${b.x},${b.y + 20} h${b.w}"/><text class="pd-tag" x="${b.x + b.w / 2}" y="${b.y + 14}" text-anchor="middle">P${index}</text>${label}`;
  if (n.kind === "store") // open-ended rectangle with an id compartment
    return `<rect class="pd-fill" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/><path class="pd-outline" d="M${b.x + b.w},${b.y} H${b.x} V${b.y + b.h} H${b.x + b.w}"/><path class="pd-outline" d="M${b.x + 32},${b.y} V${b.y + b.h}"/><text class="pd-tag" x="${b.x + 16}" y="${b.y + b.h / 2 + 4}" text-anchor="middle">D${index}</text><text class="pd-title" x="${b.x + 32 + (b.w - 32) / 2}" y="${b.y + b.h / 2 + 5}" text-anchor="middle">${e(n.label)}</text>`;
  // external entity: a square with a heavier shadow edge
  return `<rect class="pd-shadow" x="${b.x + 4}" y="${b.y + 4}" width="${b.w}" height="${b.h}"/><rect class="pd-box" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>${label}`;
}

export function dfdSvg(m: DesignModel, selected?: string): string {
  placed = []; labels = [];
  const d = m.dfd!;
  const PAD = 28, GAPX = 150, GAPY = 30, NH = 54, BPAD = 22, BHEAD = 30;
  const widthOf = (n: DfdNode) => textW(n.label, 150) + (n.kind === "store" ? 36 : 0);
  const columns: { boundary?: (typeof d.boundaries)[number]; cols: DfdNode[][] }[] = [];
  const loose = d.nodes.filter((n) => !n.boundary || !d.boundaries.some((b) => b.id === n.boundary));
  if (loose.length) columns.push({ cols: [loose] });
  for (const b of d.boundaries) {
    const members = d.nodes.filter((n) => n.boundary === b.id);
    const procs = members.filter((n) => n.kind === "process"), rest = members.filter((n) => n.kind !== "process");
    columns.push({ boundary: b, cols: [procs, rest].filter((c) => c.length) });
  }
  const boxes = new Map<string, Box>();
  const regions: string[] = [];
  let x = PAD, H = 0;
  for (const group of columns) {
    const top = PAD + (group.boundary ? BHEAD : 0);
    const startX = x + (group.boundary ? BPAD : 0);
    let cx = startX, bottom = top;
    for (const col of group.cols) {
      const w = Math.max(...col.map(widthOf));
      let y = top + (group.boundary ? 6 : 0);
      for (const n of col) { boxes.set(n.id, { id: n.id, x: cx + (w - widthOf(n)) / 2, y, w: widthOf(n), h: NH }); y += NH + GAPY; }
      bottom = Math.max(bottom, y - GAPY);
      cx += w + 90;
    }
    const innerW = cx - 90 - startX;
    if (group.boundary) {
      const b = group.boundary, bw = innerW + BPAD * 2, bh = bottom - PAD + BPAD;
      regions.push(`<g class="pd-boundary" data-node="${e(b.id)}"><title>Trust boundary: ${e(b.label)}${b.region ? `, ${e(b.region)}` : ""}</title><rect x="${x}" y="${PAD}" width="${bw}" height="${bh}" rx="14"/><text class="pd-tag" x="${x + 14}" y="${PAD + 20}">${e(b.label)}${b.region ? ` · ${e(b.region)}` : ""}</text></g>`);
      x += bw + GAPX;
      H = Math.max(H, PAD + bh);
    } else { x += innerW + GAPX; H = Math.max(H, bottom); }
  }
  const W = x - GAPX + PAD;
  placed.push(...boxes.values());
  const counter = { process: 0, store: 0, external: 0 };
  const nodes = d.nodes.filter((n) => boxes.has(n.id)).map((n) => {
    const b = boxes.get(n.id)!;
    const i = ++counter[n.kind];
    return `<g class="pd-node pd-dfd-${n.kind}" data-node="${e(n.id)}"><title>${e(n.label)} (${n.kind}${n.region ? `, ${e(n.region)}` : ""})</title>${dfdShape(n, b, i)}</g>`;
  }).join("");
  // Two flows between the same pair are spread apart so their labels do not sit on each other.
  const pairCount = new Map<string, number>();
  const flows = d.flows.filter((f) => boxes.has(f.from) && boxes.has(f.to)).map((f) => {
    const a = boxes.get(f.from)!, b = boxes.get(f.to)!;
    const key = [f.from, f.to].sort().join("|");
    const k = pairCount.get(key) ?? 0; pairCount.set(key, k + 1);
    const off = k * 16;
    const [ax, ay] = centre(a), [bx, by] = centre(b);
    const [x1, y1] = edgePoint(a, bx, by + off), [x2, y2] = edgePoint(b, ax, ay + off);
    const cross = crossesRegion(m, f);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 + off;
    return `<a class="pd-edge${cross ? " pd-cross" : ""}${f.id === selected ? " is-selected" : ""}" data-edge="${e(f.id)}" data-ends="${e(f.from)} ${e(f.to)}" ${href(`/design/dfd/${enc(f.id)}`)}>
  <title>${e(f.label ?? f.id)}${f.region ? `, ${e(f.region)}` : ""}${cross ? " (crosses a region boundary)" : ""}</title>
  <path class="pd-line" d="M${x1},${y1 + off} L${x2},${y2 + off}" marker-end="url(#pd-arrow)"/>
  <path class="pd-hit" d="M${x1},${y1 + off} L${x2},${y2 + off}"/>
  ${edgeLabel(mx, my, f.label ?? f.id)}
</a>`;
  }).join("");
  return frame("dfd", W, H + PAD, `<g class="pd-regions">${regions.join("")}</g><g class="pd-edges">${flows}</g><g class="pd-nodes">${nodes}</g>`, `Data flow diagram with ${d.flows.length} flows`);
}

// ── layered box diagrams: C4 and user flows ────────────────────────────────────────────────────

interface LNode { id: string; label: string; sub?: string; kind: string; href?: string; selected?: boolean; title?: string }

function layered(kind: string, nodes: LNode[], edges: { from: string; to: string; label?: string; id?: string }[], aria: string, group?: { label: string; members: Set<string> }): string {
  placed = []; labels = [];
  const PAD = 30, GAPX = 60, GAPY = 96;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sizeOf = (n: LNode) => {
    const w = Math.max(textW(n.label, kind === "flow" ? 160 : 180), n.sub ? textW(n.sub) - 10 : 0);
    if (n.kind === "decision") return { w: w + 40, h: 76 };
    if (n.kind === "person") return { w, h: 84 };
    return { w, h: n.sub ? 62 : 48 };
  };
  const rows = layers(nodes.map((n) => n.id), edges.map((x) => [x.from, x.to]));
  const rowW = rows.map((r) => r.reduce((s, id) => s + sizeOf(byId.get(id)!).w, 0) + (r.length - 1) * GAPX);
  const W = Math.max(...rowW) + PAD * 2 + (group ? 40 : 0);
  const boxes = new Map<string, Box>();
  let y = PAD + (group ? 30 : 0);
  rows.forEach((r, i) => {
    let x = (W - rowW[i]!) / 2;
    const h = Math.max(...r.map((id) => sizeOf(byId.get(id)!).h));
    for (const id of r) { const s = sizeOf(byId.get(id)!); boxes.set(id, { id, x, y: y + (h - s.h) / 2, w: s.w, h: s.h }); x += s.w + GAPX; }
    y += h + GAPY;
  });
  const H = y - GAPY + PAD;
  let frameEl = "";
  if (group) {
    const mem = [...group.members].map((id) => boxes.get(id)).filter(Boolean) as Box[];
    if (mem.length) {
      const x0 = Math.min(...mem.map((b) => b.x)) - 24, y0 = Math.min(...mem.map((b) => b.y)) - 34;
      const x1 = Math.max(...mem.map((b) => b.x + b.w)) + 24, y1 = Math.max(...mem.map((b) => b.y + b.h)) + 20;
      frameEl = `<g class="pd-boundary"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="14"/><text class="pd-tag" x="${x0 + 14}" y="${y0 + 20}">${e(group.label)}</text></g>`;
    }
  }
  placed.push(...boxes.values());
  const edgeEls = edges.filter((x) => boxes.has(x.from) && boxes.has(x.to)).map((x) => {
    const a = boxes.get(x.from)!, b = boxes.get(x.to)!;
    const [ax, ay] = centre(a), [bx, by] = centre(b);
    const sa = byId.get(x.from)!.kind === "decision" ? "diamond" : "rect", sb = byId.get(x.to)!.kind === "decision" ? "diamond" : "rect";
    const [x1, y1] = edgePoint(a, bx, by, sa), [x2, y2] = edgePoint(b, ax, ay, sb);
    return `<g class="pd-edge" data-edge="${e(x.id ?? `${x.from}-${x.to}`)}" data-ends="${e(x.from)} ${e(x.to)}"><path class="pd-line" d="M${x1},${y1} L${x2},${y2}" marker-end="url(#pd-arrow)"/>${edgeLabel((x1 + x2) / 2, (y1 + y2) / 2, x.label ?? "")}</g>`;
  }).join("");
  const nodeEls = nodes.map((n) => {
    const b = boxes.get(n.id)!;
    const cx = b.x + b.w / 2;
    let shape = "";
    let ty = b.y + b.h / 2 + (n.sub ? -2 : 5);
    switch (n.kind) {
      case "start": case "end": shape = `<rect class="pd-box${n.kind === "end" ? " pd-heavy" : ""}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.h / 2}"/>`; break;
      case "decision": shape = `<path class="pd-box" d="M${cx},${b.y} L${b.x + b.w},${b.y + b.h / 2} L${cx},${b.y + b.h} L${b.x},${b.y + b.h / 2} z"/>`; break;
      case "system": shape = `<rect class="pd-box" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/><path class="pd-head" d="M${b.x + 10},${b.y} V${b.y + b.h} M${b.x + b.w - 10},${b.y} V${b.y + b.h}"/>`; break;
      case "person": shape = `<circle class="pd-box" cx="${cx}" cy="${b.y + 14}" r="14"/><rect class="pd-box" x="${b.x}" y="${b.y + 30}" width="${b.w}" height="${b.h - 30}" rx="16"/>`; ty = b.y + 30 + (b.h - 30) / 2 + 5; break;
      case "external": shape = `<rect class="pd-box pd-dashed" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6"/>`; break;
      case "system-c4": shape = `<rect class="pd-box pd-heavy" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6"/>`; break;
      default: shape = `<rect class="pd-box" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6"/>`;
    }
    const text = `<text class="pd-title" x="${cx}" y="${ty}" text-anchor="middle">${e(n.label)}</text>${n.sub ? `<text class="pd-type" x="${cx}" y="${ty + 16}" text-anchor="middle">${e(n.sub)}</text>` : ""}`;
    const tag = n.href ? "a" : "g";
    return `<${tag} class="pd-node pd-k-${e(n.kind)}${n.selected ? " is-selected" : ""}" data-node="${e(n.id)}"${n.href ? ` ${href(n.href)}` : ""}><title>${e(n.title ?? n.label)}</title>${shape}${text}</${tag}>`;
  }).join("");
  return frame(kind, W, H, `${frameEl}<g class="pd-edges">${edgeEls}</g><g class="pd-nodes">${nodeEls}</g>`, aria);
}

export function c4Svg(level: ArchLevel, which: "context" | "containers", systemLabel?: string): string {
  const nodes: LNode[] = level.nodes.map((n) => ({
    id: n.id, label: n.label, sub: n.tech ? `[${n.tech}]` : n.kind === "external" ? "[External system]" : n.kind === "system" ? "[Software system]" : n.kind === "person" ? "[Person]" : undefined,
    kind: n.kind === "system" ? "system-c4" : n.kind, title: [n.label, n.tech, n.description].filter(Boolean).join(" · "),
  }));
  const group = which === "containers" ? { label: systemLabel ?? "System", members: new Set(level.nodes.filter((n) => n.kind === "container").map((n) => n.id)) } : undefined;
  return layered(`c4-${which}`, nodes, level.relations.map((r) => ({ from: r.from, to: r.to, label: r.label, id: r.id })), `C4 ${which} diagram`, group);
}

export function flowSvg(m: DesignModel, f: UserFlow): string {
  const nodes: LNode[] = f.steps.map((s) => ({
    id: s.id, label: s.label, kind: s.kind, sub: s.screen ? `screen: ${s.screen}` : undefined,
    href: `#step-${s.id}`, title: `${s.kind}: ${s.label}${s.test ? ` · test: ${s.test}` : ""}`,
  }));
  const edges = f.steps.flatMap((s) => s.next.map((n, i) => ({ from: s.id, to: n, label: s.kind === "decision" ? (s.next.length === 2 ? (i === 0 ? "yes" : "no") : n) : undefined })));
  return layered("flow", nodes, edges, `User flow: ${f.title}`);
}

// ── behaviour: pan, zoom, hover tracing, step previews ─────────────────────────────────────────

export const DIAGRAM_SCRIPT = `<script>
(() => {
  for (const fig of document.querySelectorAll(".pantry-diagram")) {
    const svg = fig.querySelector("svg"); if (!svg) continue;
    const W = +svg.dataset.w, H = +svg.dataset.h;
    let vb = [0, 0, W, H];
    const set = () => svg.setAttribute("viewBox", vb.map((n) => n.toFixed(1)).join(" "));
    const zoom = (k, cx = vb[0] + vb[2] / 2, cy = vb[1] + vb[3] / 2) => {
      const w = Math.min(W * 4, Math.max(W / 8, vb[2] * k)), h = w * (vb[3] / vb[2]);
      vb = [cx - (cx - vb[0]) * (w / vb[2]), cy - (cy - vb[1]) * (h / vb[3]), w, h]; set();
    };
    const pt = (ev) => { const r = svg.getBoundingClientRect(); return [vb[0] + (ev.clientX - r.left) / r.width * vb[2], vb[1] + (ev.clientY - r.top) / r.height * vb[3]]; };
    fig.querySelectorAll("[data-zoom]").forEach((b) => b.addEventListener("click", () => {
      const z = b.dataset.zoom; if (z === "reset") { vb = [0, 0, W, H]; set(); } else zoom(z === "in" ? 0.8 : 1.25);
    }));
    svg.addEventListener("wheel", (ev) => { ev.preventDefault(); const [x, y] = pt(ev); zoom(ev.deltaY < 0 ? 0.88 : 1.14, x, y); }, { passive: false });
    let drag = null, moved = false;
    svg.addEventListener("pointerdown", (ev) => { drag = [ev.clientX, ev.clientY, vb[0], vb[1]]; moved = false; });
    addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const r = svg.getBoundingClientRect(), dx = ev.clientX - drag[0], dy = ev.clientY - drag[1];
      if (Math.abs(dx) + Math.abs(dy) > 4) { moved = true; svg.classList.add("is-panning"); }
      if (moved) { vb[0] = drag[2] - dx / r.width * vb[2]; vb[1] = drag[3] - dy / r.height * vb[3]; set(); }
    });
    addEventListener("pointerup", () => { drag = null; svg.classList.remove("is-panning"); });
    svg.addEventListener("click", (ev) => { if (moved) { ev.preventDefault(); ev.stopPropagation(); moved = false; } }, true);
    // Hover a node to trace everything it touches; hover an edge to trace its two ends.
    const edges = [...svg.querySelectorAll("[data-edge]")];
    const ends = (x) => x.dataset.ends.split(" ");
    const trace = (nodeIds, litEdges) => {
      svg.classList.add("is-tracing");
      svg.querySelectorAll("[data-node]").forEach((n) => n.classList.toggle("is-lit", nodeIds.has(n.dataset.node)));
      edges.forEach((x) => x.classList.toggle("is-lit", litEdges.includes(x)));
    };
    const clear = () => { svg.classList.remove("is-tracing"); svg.querySelectorAll(".is-lit").forEach((n) => n.classList.remove("is-lit")); };
    svg.querySelectorAll(".pd-nodes [data-node]").forEach((n) => {
      n.addEventListener("mouseenter", () => {
        const id = n.dataset.node, touching = edges.filter((x) => ends(x).includes(id));
        trace(new Set([id, ...touching.flatMap(ends)]), touching);
      });
      n.addEventListener("mouseleave", clear);
    });
    edges.forEach((x) => {
      x.addEventListener("mouseenter", () => trace(new Set(ends(x)), [x]));
      x.addEventListener("mouseleave", clear);
    });
  }
  // On a user flow, a step with a screen previews its wireframe beside the diagram.
  const frame = document.querySelector("[data-step-preview]");
  if (frame) {
    const show = (id) => {
      const step = document.getElementById("step-" + id); if (!step) return;
      document.querySelectorAll(".pantry-design__step.is-current, .pd-node.is-selected").forEach((s) => s.classList.remove("is-current", "is-selected"));
      step.classList.add("is-current");
      document.querySelector('.pd-node[data-node="' + CSS.escape(id) + '"]')?.classList.add("is-selected");
      const screen = step.dataset.screen;
      frame.hidden = !screen; document.querySelector("[data-step-empty]").hidden = !!screen;
      if (screen) { frame.src = "/design/wireframe-raw/" + encodeURIComponent(screen); document.querySelector("[data-step-caption]").textContent = step.dataset.label + " · " + screen; }
    };
    document.querySelectorAll('.pd-node[href^="#step-"]').forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); const id = a.dataset.node; history.replaceState(null, "", "#step-" + id); show(id); }));
    addEventListener("message", (ev) => {
      if (ev.source !== frame.contentWindow || !ev.data || typeof ev.data.screen !== "string") return;
      const next = document.querySelector('.pantry-design__step[data-screen="' + CSS.escape(ev.data.screen) + '"]');
      if (next) show(next.id.slice(5)); else frame.src = "/design/wireframe-raw/" + encodeURIComponent(ev.data.screen);
    });
    const first = location.hash.startsWith("#step-") ? location.hash.slice(6) : document.querySelector(".pantry-design__step[data-screen]")?.id.slice(5);
    if (first) show(first);
  }
})();
</script>`;
