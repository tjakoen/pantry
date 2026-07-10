// pantry/map.ts — piece 10: the mindmap's model. A picture of the AI's brain for THIS project — the
// whole-codebase knowledge graph an agent builds when it reads the repo, drawn for the human and
// exported for the machine (one graph, two projections: /map ↔ /map.json). Model-free (PLAN
// §AI-legible, not AI-powered): PANTRY consumes the host's `graphify-out/` (a deterministic AST +
// document graph the host generates with `graphify update .` — zero API cost) rather than building a
// code analyzer. This module is pure over the parsed graph; the file IO is isolated in
// loadGraphifyGraph so the model is hermetically testable. Central ("god") nodes are surfaced by
// degree; nodes cluster by graphify's communities and colour by repo in the viz.

// The node-link JSON graphify writes (`graph.json` / `merged-graph.json`) — a networkx node-link
// shape. We read only the fields the mindmap needs and tolerate the rest.
export interface GraphifyNode {
  id: string;
  label?: string;
  repo?: string;
  community?: number;
  file_type?: string;   // "code" | "document"
  [k: string]: unknown;
}
export interface GraphifyLink {
  source: string;
  target: string;
  relation?: string;
  [k: string]: unknown;
}
export interface GraphifyGraph {
  nodes: GraphifyNode[];
  links: GraphifyLink[];
  [k: string]: unknown;
}

// The trimmed model both projections share.
export interface MapNode {
  id: string;
  label: string;
  repo: string;
  community: number;
  kind: "code" | "document";
  degree: number;
}
export interface MapLink { source: string; target: string; relation: string }
export interface MapGod { id: string; label: string; repo: string; degree: number }
export interface MapRepo { repo: string; nodes: number }
export interface MapStats {
  nodeCount: number;
  linkCount: number;
  communityCount: number;
  godNodeCount: number;
  repos: MapRepo[];
}
export interface MapGraph {
  available: true;
  project: string;
  generatedAt: string;
  /** the load-bearing invariant, restated for the machine: PANTRY is AI-legible, not AI-powered. */
  runsModel: false;
  stats: MapStats;
  /** the central nodes surfaced (highest-degree hubs) — the "god" nodes of the brain */
  gods: MapGod[];
  nodes: MapNode[];
  links: MapLink[];
}
/** The absent case — no graphify-out in the host, so the surface reports itself off, never crashes. */
export interface MapUnavailable {
  available: false;
  project: string;
  runsModel: false;
  reason: string;
}
export type MapPayload = MapGraph | MapUnavailable;

const repoOf = (n: GraphifyNode): string => n.repo ?? (n.id.includes("::") ? n.id.split("::")[0] : "");

// A vendored or minified artifact — a real node, but never an architectural "central node".
const isVendor = (n: { id: string; label: string }): boolean =>
  /\.min\.(m?js|css)$/i.test(n.label) || /(^|[:_/-])vendor([:_/-]|$)/i.test(n.id);

/**
 * Build the mindmap model from an already-parsed graphify graph. Pure + deterministic: degree is
 * derived from the links, nodes/links/gods are sorted by stable keys, so the same graph always
 * yields the same payload (drift-free, reproducible in tests). `godCount` central nodes are surfaced.
 */
export function buildMap(
  graph: GraphifyGraph,
  project: string,
  generatedAt: string,
  godCount = 12,
): MapGraph {
  const present = new Set(graph.nodes.map((n) => n.id));

  // Degree over the real links only (endpoints that exist in the node set) — a link to a pruned
  // node would otherwise inflate a hub that the viz can't draw.
  const degree = new Map<string, number>();
  const links: MapLink[] = [];
  for (const l of graph.links) {
    const source = String(l.source), target = String(l.target);
    if (!present.has(source) || !present.has(target)) continue;
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
    links.push({ source, target, relation: l.relation ?? "related" });
  }
  links.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.relation.localeCompare(b.relation));

  const nodes: MapNode[] = graph.nodes.map((n) => ({
    id: n.id,
    label: n.label ?? n.id,
    repo: repoOf(n),
    community: typeof n.community === "number" ? n.community : -1,
    kind: n.file_type === "document" ? "document" : "code",
    degree: degree.get(n.id) ?? 0,
  }));
  nodes.sort((a, b) => a.id.localeCompare(b.id));

  // Central nodes: highest degree wins, id breaks ties (deterministic). Only real hubs (degree > 0),
  // and never a vendored/minified artifact — a bundled `htmx.min.js` is the most-referenced file in
  // the graph but it's noise, not the architecture. It stays a node (it's a real dependency); it just
  // doesn't get surfaced as a "central node." Host-agnostic: minified stems + a `vendor` path segment.
  const gods: MapGod[] = [...nodes]
    .filter((n) => n.degree > 0 && !isVendor(n))
    .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))
    .slice(0, godCount)
    .map((n) => ({ id: n.id, label: n.label, repo: n.repo, degree: n.degree }));

  const repoCounts = new Map<string, number>();
  const communities = new Set<string>();
  for (const n of nodes) {
    repoCounts.set(n.repo, (repoCounts.get(n.repo) ?? 0) + 1);
    communities.add(`${n.repo}:${n.community}`);
  }
  const repos: MapRepo[] = [...repoCounts.entries()]
    .map(([repo, count]) => ({ repo, nodes: count }))
    .sort((a, b) => b.nodes - a.nodes || a.repo.localeCompare(b.repo));

  return {
    available: true,
    project,
    generatedAt,
    runsModel: false,
    stats: {
      nodeCount: nodes.length,
      linkCount: links.length,
      communityCount: communities.size,
      godNodeCount: gods.length,
      repos,
    },
    gods,
    nodes,
    links,
  };
}

// The graphify output as PANTRY reads it: parse the host's node-link JSON, or null when it's absent
// or unreadable. Isolated from buildMap so the model stays a pure, hermetically tested function.
export async function loadGraphifyGraph(path: string | null): Promise<GraphifyGraph | null> {
  if (!path) return null;
  try {
    const raw = JSON.parse(await Bun.file(path).text());
    if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.links)) return null;
    return raw as GraphifyGraph;
  } catch {
    return null;
  }
}

/**
 * The app-facing entry: resolve the host's graphify-out (config.graphPath) into a MapPayload. Absent
 * or unreadable graph → an `available:false` payload the route renders as "run graphify" guidance
 * (never a 500). `generatedAt` is injected so the payload is deterministic in tests.
 */
export async function buildMapPayload(
  config: { projectName: string; graphPath: string | null },
  generatedAt: string,
): Promise<MapPayload> {
  const graph = await loadGraphifyGraph(config.graphPath);
  if (!graph)
    return {
      available: false,
      project: config.projectName,
      runsModel: false,
      reason: "No graphify-out found. Generate the code graph in this project with `graphify update .` (then `graphify merge-graphs` across repos for a whole-stack map).",
    };
  return buildMap(graph, config.projectName, generatedAt);
}
