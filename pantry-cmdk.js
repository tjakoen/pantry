// pantry/pantry-cmdk.js — ⌘K over the cockpit (piece 9b). A client-side command palette that opens
// on ⌘K / Ctrl-K and jumps to any surface, doc page, or plan. It reads its index from THE SAME brain
// the AI reads (`/knowledge.json`) — one source for the machine retrieval and the human jump list, so
// the palette can never list a route the retrieval endpoints don't know about. Vanilla, no build, no
// framework; styling is tokens-only via the .pantry-cmdk-* classes in pantry.css. Progressive: if the
// fetch fails the palette just shows nothing — the rest of the page is untouched.
(() => {
  let entries = null;      // flattened [{ title, route, kind }] — loaded once, lazily
  let active = 0;

  // Flatten the knowledge brain into one addressable jump list. Order = the reading order an agent
  // (or human) wants: surfaces first (the board + reference), then doc pages, then individual plans.
  function flatten(k) {
    const out = [];
    for (const s of k.surfaces || []) out.push({ title: s.title, route: s.route, kind: "surface" });
    for (const c of k.docs || []) {
      out.push({ title: c.title, route: c.prefix, kind: "docs" });
      for (const p of c.pages || []) out.push({ title: `${c.title} / ${p.slug}`, route: p.route, kind: "doc" });
    }
    if (k.plans) for (const p of k.plans.plans || []) out.push({ title: p.title, route: `/plans/plan/${p.id}`, kind: `plan · ${p.status}` });
    return out;
  }

  async function ensureIndex() {
    if (entries) return entries;
    try {
      const res = await fetch("/knowledge.json");
      entries = flatten(await res.json());
    } catch { entries = []; }
    return entries;
  }

  const el = (tag, cls, attrs) => { const n = document.createElement(tag); if (cls) n.className = cls; Object.assign(n, attrs || {}); return n; };

  const overlay = el("div", "pantry-cmdk", { hidden: true });
  const box = el("div", "pantry-cmdk__box");
  const input = el("input", "pantry-cmdk__input", { type: "text", placeholder: "Jump to a surface, doc, or plan…", spellcheck: false });
  const list = el("ul", "pantry-cmdk__list");
  box.append(input, list);
  overlay.append(box);

  function matches(q) {
    const items = entries || [];
    if (!q) return items;
    const needle = q.toLowerCase();
    return items.filter((e) => e.title.toLowerCase().includes(needle) || e.route.toLowerCase().includes(needle));
  }

  function render() {
    const results = matches(input.value);
    if (active >= results.length) active = Math.max(0, results.length - 1);
    list.replaceChildren(...results.map((e, i) => {
      const li = el("li", "pantry-cmdk__item" + (i === active ? " is-active" : ""));
      li.dataset.route = e.route;
      li.append(el("span", "pantry-cmdk__title", { textContent: e.title }));
      li.append(el("span", "pantry-cmdk__kind", { textContent: e.kind }));
      li.append(el("span", "pantry-cmdk__route", { textContent: e.route }));
      li.addEventListener("mousemove", () => { active = i; paint(); });
      li.addEventListener("click", () => go(e.route));
      return li;
    }));
    return results;
  }
  // Repaint only the active marker (no rebuild) — keeps arrow-key nav snappy.
  function paint() {
    [...list.children].forEach((li, i) => li.classList.toggle("is-active", i === active));
  }
  function go(route) { if (route) window.location.href = route; }

  async function open() {
    await ensureIndex();
    active = 0; input.value = "";
    render();
    overlay.hidden = false;
    input.focus();
  }
  function close() { overlay.hidden = true; }

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); overlay.hidden ? open() : close(); return; }
    if (overlay.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); active++; const r = matches(input.value); if (active >= r.length) active = 0; paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active--; if (active < 0) active = matches(input.value).length - 1; paint(); }
    else if (e.key === "Enter") { e.preventDefault(); const r = matches(input.value); if (r[active]) go(r[active].route); }
  });
  input.addEventListener("input", () => { active = 0; render(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  document.addEventListener("DOMContentLoaded", () => document.body.append(overlay));
  // body may already be parsed if the script is at the end — append now too (idempotent-ish).
  if (document.body && !overlay.isConnected) document.body.append(overlay);
})();
