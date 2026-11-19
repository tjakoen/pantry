// pantry/theme-sync.js: one theme choice for the whole app.
//
// GRAIN's theme.js saves the flavor and the light or dark scheme in localStorage, which a browser
// keeps per origin. PANTRY is many origins, the hub on one port and every project on its own, so a
// choice made on one page used to stay on that page. This script keeps the hub as the one place
// the choice lives: it applies the hub's saved choice on load, and posts any change back.
(() => {
  "use strict";
  const HUB = document.currentScript?.dataset.hub || "http://127.0.0.1:4400";
  const html = document.documentElement;
  const KEYS = [["theme", "data-theme", "grain-theme"], ["scheme", "data-color-scheme", "grain-color-scheme"]];
  let applying = false;
  const apply = (pref) => {
    applying = true;
    for (const [k, attr, key] of KEYS) {
      const v = pref?.[k] || null;
      if (v === html.getAttribute(attr)) continue;
      try { v ? localStorage.setItem(key, v) : localStorage.removeItem(key); } catch {}
      v ? html.setAttribute(attr, v) : html.removeAttribute(attr);
    }
    const name = html.getAttribute("data-theme") || "sourdough";
    document.querySelectorAll("[data-theme-name]").forEach((el) => { el.textContent = name; });
    applying = false;
  };
  fetch(`${HUB}/theme.json`).then((r) => (r.ok ? r.json() : null)).then((p) => p && apply(p)).catch(() => {});
  new MutationObserver(() => {
    if (applying) return;
    // text/plain keeps this a simple request, so the hub needs no preflight for it.
    fetch(`${HUB}/theme.json`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ theme: html.getAttribute("data-theme"), scheme: html.getAttribute("data-color-scheme") }) }).catch(() => {});
  }).observe(html, { attributes: true, attributeFilter: ["data-theme", "data-color-scheme"] });
})();
