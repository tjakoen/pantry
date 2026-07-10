// pantry-map.js — the mindmap viz (piece 10). Draws the whole-codebase knowledge graph from
// /map.json onto a canvas: nodes clustered by repo → community, coloured by repo, sized by degree
// (central "god" nodes surfaced), edges recessive. No build, no deps, no framework — vanilla, same
// posture as pantry-cmdk.js. The layout is DETERMINISTIC (a phyllotaxis pack per community, repos on
// a ring) so the same graph always draws the same map; colours come from CSS custom properties, so
// light/dark swap in one place (pantry.css) and identity is never colour-alone (repo legend + labels
// + the server-rendered central-nodes list are the relief channel the palette's contrast band needs).
(() => {
  const canvas = document.getElementById("pantry-map-canvas");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const figure = canvas.closest(".pantry-map") || canvas.parentElement;

  // Theme-aware palette: read the validated categorical slots + ink/surface off the page, re-read on
  // theme change so a light/dark toggle repaints in the right colours.
  const REPO_SLOTS = 6;
  let ink, muted, edge, surface, repoColors = [];
  function readTheme() {
    const cs = getComputedStyle(document.body);
    const v = (n, f) => (cs.getPropertyValue(n).trim() || f);
    ink = v("--pantry-map-ink", "#0b0b0b");
    muted = v("--pantry-map-muted", "#898781");
    edge = v("--pantry-map-edge", "rgba(11,11,11,0.10)");
    surface = v("--pantry-map-surface", "#fcfcfb");
    repoColors = [];
    for (let i = 1; i <= REPO_SLOTS; i++) repoColors.push(v(`--pantry-map-repo-${i}`, "#2a78d6"));
  }
  readTheme();

  const tip = document.createElement("div");
  tip.className = "pantry-map-tip";
  tip.hidden = true;
  (figure || document.body).appendChild(tip);

  const state = { nodes: [], links: [], repoOrder: [], scale: 1, ox: 0, oy: 0, hover: null, ready: false };

  fetch("/map.json").then((r) => r.json()).then((data) => {
    if (!data || !data.available) return;
    layout(data);
    state.ready = true;
    resize();
  }).catch(() => {});

  // Deterministic layout: repos evenly on a ring; each repo's communities on a smaller ring around
  // its centre; nodes phyllotaxis-packed within their community (golden-angle spiral). No simulation
  // → stable, instant, reproducible. World coords; the view transform (scale/offset) fits it to the canvas.
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  function layout(data) {
    state.links = data.links;
    state.repoOrder = data.stats.repos.map((r) => r.repo);
    const repoIndex = new Map(state.repoOrder.map((r, i) => [r, i]));
    const byRepo = new Map();
    for (const n of data.nodes) {
      if (!byRepo.has(n.repo)) byRepo.set(n.repo, new Map());
      const comms = byRepo.get(n.repo);
      if (!comms.has(n.community)) comms.set(n.community, []);
      comms.get(n.community).push(n);
    }
    const R = 900;                                   // repo ring radius (world units)
    const nodes = [];
    for (const [repo, comms] of byRepo) {
      const ri = repoIndex.get(repo) ?? 0;
      const ra = (ri / state.repoOrder.length) * Math.PI * 2 - Math.PI / 2;
      const cx = Math.cos(ra) * R, cy = Math.sin(ra) * R;
      const commList = [...comms.entries()];
      const cr = 160 + Math.sqrt(commList.length) * 40; // community ring radius, grows sub-linearly so a big repo doesn't sprawl over its neighbours
      commList.forEach(([, members], ci) => {
        const ca = (ci / Math.max(1, commList.length)) * Math.PI * 2;
        const mx = cx + Math.cos(ca) * cr, my = cy + Math.sin(ca) * cr;
        members.forEach((m, mi) => {
          const rad = 10 * Math.sqrt(mi + 0.5);      // phyllotaxis spread
          const a = mi * GOLDEN;
          nodes.push({
            id: m.id, label: m.label, repo, degree: m.degree, kind: m.kind,
            colorIdx: (repoIndex.get(repo) ?? 0) % REPO_SLOTS,
            r: 2 + Math.sqrt(m.degree) * 1.3,
            x: mx + Math.cos(a) * rad, y: my + Math.sin(a) * rad,
            repoCx: cx, repoCy: cy,
          });
        });
      });
    }
    state.nodes = nodes;
    state.pos = new Map(nodes.map((n) => [n.id, n]));
    // Central nodes come from the MODEL (data.gods) — already ranked and vendor-filtered server-side,
    // so the canvas labels match the "Central nodes" list exactly (a minified vendor lib is never one).
    state.R = R;
    state.gods = data.gods;
  }

  function fit() {
    if (!state.nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of state.nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
    const w = canvas.clientWidth, h = canvas.clientHeight, pad = 60;
    const s = Math.min((w - pad) / (maxX - minX || 1), (h - pad) / (maxY - minY || 1));
    state.scale = s;
    state.ox = w / 2 - ((minX + maxX) / 2) * s;
    state.oy = h / 2 - ((minY + maxY) / 2) * s;
  }

  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    const w = canvas.clientWidth || 800, h = canvas.clientHeight || 520;
    canvas.width = w * dpr(); canvas.height = h * dpr();
    if (state.ready && (state.ox === 0 && state.oy === 0)) fit();
    draw();
  }

  const toWorld = (px, py) => ({ x: (px - state.ox) / state.scale, y: (py - state.oy) / state.scale });

  function draw() {
    if (!ctx) return;
    ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (!state.ready) return;
    ctx.save();
    ctx.translate(state.ox, state.oy); ctx.scale(state.scale, state.scale);

    // edges — recessive; highlight the hovered node's incident edges
    const hoverId = state.hover && state.hover.id;
    ctx.lineWidth = 1 / state.scale;
    ctx.strokeStyle = edge;
    ctx.beginPath();
    for (const l of state.links) {
      const a = state.pos.get(l.source), b = state.pos.get(l.target);
      if (!a || !b) continue;
      if (hoverId && (l.source === hoverId || l.target === hoverId)) continue; // drawn hot below
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    if (hoverId) {
      ctx.strokeStyle = repoColors[state.hover.colorIdx];
      ctx.lineWidth = 1.5 / state.scale;
      ctx.beginPath();
      for (const l of state.links) {
        if (l.source !== hoverId && l.target !== hoverId) continue;
        const a = state.pos.get(l.source), b = state.pos.get(l.target);
        if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      }
      ctx.stroke();
    }

    // nodes
    for (const n of state.nodes) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = repoColors[n.colorIdx];
      ctx.globalAlpha = hoverId && n.id !== hoverId && !isNeighbor(hoverId, n.id) ? 0.25 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // repo cluster labels (identity, not colour-alone)
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    const seen = new Set();
    const R = state.R || 900;
    ctx.font = `${13 / state.scale}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    for (const n of state.nodes) {
      if (seen.has(n.repo)) continue; seen.add(n.repo);
      // push the repo name outward from the origin so it clears its own cluster
      const d = Math.hypot(n.repoCx, n.repoCy) || 1;
      ctx.fillText(n.repo || "·", n.repoCx + (n.repoCx / d) * 0.16 * R, n.repoCy + (n.repoCy / d) * 0.16 * R);
    }
    // god-node labels — always shown; the central nodes surfaced by name (truncated so a long doc
    // title doesn't smear across its neighbours)
    ctx.fillStyle = muted;
    ctx.font = `${11 / state.scale}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    for (const g of state.gods) {
      const n = state.pos.get(g.id); if (!n) continue;
      const label = n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label;
      ctx.fillText(label, n.x, n.y - n.r - 3 / state.scale);
    }
    ctx.restore();
  }

  const neighborCache = new Map();
  function isNeighbor(id, other) {
    let set = neighborCache.get(id);
    if (!set) {
      set = new Set();
      for (const l of state.links) {
        if (l.source === id) set.add(l.target);
        else if (l.target === id) set.add(l.source);
      }
      neighborCache.set(id, set);
    }
    return set.has(other);
  }

  function nodeAt(px, py) {
    const w = toWorld(px, py);
    let best = null, bestD = Infinity;
    for (const n of state.nodes) {
      const d = (n.x - w.x) ** 2 + (n.y - w.y) ** 2;
      const rr = (n.r + 4 / state.scale) ** 2;
      if (d < rr && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  // interaction: pan (drag), zoom (wheel around cursor), hover (tooltip + neighbour highlight)
  let dragging = false, moved = false, lastX = 0, lastY = 0;
  canvas.addEventListener("mousedown", (e) => { dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener("mouseup", () => { dragging = false; });
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    if (dragging) {
      moved = true;
      state.ox += e.clientX - lastX; state.oy += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      tip.hidden = true; state.hover = null; draw(); return;
    }
    const hit = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (hit !== state.hover) { state.hover = hit; draw(); }
    if (hit) {
      tip.hidden = false;
      tip.innerHTML = `<b>${escape(hit.label)}</b><span>${escape(hit.repo)} · ${hit.kind} · ${hit.degree} links</span>`;
      tip.style.left = (e.clientX - rect.left + 12) + "px";
      tip.style.top = (e.clientY - rect.top + 12) + "px";
    } else tip.hidden = true;
  });
  canvas.addEventListener("mouseleave", () => { tip.hidden = true; state.hover = null; draw(); });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const w = toWorld(mx, my);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    state.scale = Math.max(0.05, Math.min(8, state.scale * factor));
    state.ox = mx - w.x * state.scale; state.oy = my - w.y * state.scale;
    draw();
  }, { passive: false });

  const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  window.addEventListener("resize", resize);
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { readTheme(); neighborCache.clear(); draw(); });
})();
