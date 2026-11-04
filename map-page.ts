// pantry/map-page.ts, split out of app.ts. The page markup for one surface; app.ts keeps the routing.
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { type MapPayload } from "./map.ts";

// /map (piece 10) — the mindmap: a picture of the AI's brain for this project. The whole-codebase
// knowledge graph (graphify's AST + document graph, consumed — never re-analysed) drawn for the
// human; the same model is the machine projection at /map.json. When the host hasn't run graphify
// the surface degrades to guidance (never a crash), matching every other absent-source surface.
export function mapBody(payload: MapPayload): string {
  if (!payload.available) {
    return `<header>
  <h1 class="proof-masthead">Mindmap</h1>
  <p class="proof-lede">A picture of the AI's brain for ${escapeHtml(payload.project)} — the whole-codebase knowledge graph, drawn for the human. It reads the graph your own tooling generates; PANTRY runs no model of its own.</p>
</header>
<div class="card pantry-map-empty" data-pad="md">
  <h2 class="card__title">No map yet</h2>
  <p class="pantry-member__role">${escapeHtml(payload.reason)}</p>
  <pre class="pantry-map-cmd"><code>graphify update .            # this repo's code + doc graph
graphify merge-graphs …      # optional: a whole-stack map</code></pre>
</div>`;
  }
  const s = payload.stats;
  const stat = (n: number | string, label: string) =>
    `<div class="pantry-stat"><span class="pantry-stat__n">${escapeHtml(String(n))}</span><span class="pantry-stat__label">${escapeHtml(label)}</span></div>`;
  const repoChips = s.repos.map((r) =>
    `<span class="pantry-repo-chip" data-repo="${escapeHtml(r.repo || "·")}">${escapeHtml(r.repo || "·")} <b>${r.nodes}</b></span>`).join("");
  const gods = payload.gods.map((g) =>
    `<li><code>${escapeHtml(g.label)}</code> <span class="pantry-member__role">${escapeHtml(g.repo)} · ${g.degree} links</span></li>`).join("\n");
  return `<header>
  <h1 class="proof-masthead">Mindmap</h1>
  <p class="proof-lede">A picture of the AI's brain for ${escapeHtml(payload.project)}: the whole-codebase knowledge graph, clustered by community and coloured by repo, with the central nodes surfaced. Model-free — the same graph the machine reads at <a href="/map.json">/map.json</a>.</p>
</header>
<section class="pantry-stats">
  ${stat(s.nodeCount, "nodes")}
  ${stat(s.linkCount, "links")}
  ${stat(s.repos.length, "repos")}
  ${stat(s.communityCount, "communities")}
  ${stat(s.godNodeCount, "hubs")}
</section>
<div class="pantry-repo-legend">${repoChips}</div>
<figure class="pantry-map" data-grade="smooth">
  <canvas id="pantry-map-canvas" role="img" aria-label="Interactive knowledge graph of ${escapeHtml(payload.project)}"></canvas>
  <noscript><p class="pantry-member__role">The interactive map needs JavaScript. The central nodes are listed below.</p></noscript>
</figure>
<section class="pantry-gods">
  <h2 class="pantry-section-title">Central nodes</h2>
  <p class="pantry-member__role">The graph's highest-degree hubs — the load-bearing files and symbols an agent hits first.</p>
  <ol class="pantry-god-list">${gods}</ol>
</section>
<script src="/pantry-map.js" defer></script>`;
}
