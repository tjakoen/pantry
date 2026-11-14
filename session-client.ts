/// <reference lib="dom" />
// session-client.ts: the page half of session control, built for the browser and served as
// /pantry-session.js on every PANTRY page (chrome.ts adds the tag).
//
// It does three things, in GRAIN's order. It DECLARES the page's surfaces: a plan card, a decision,
// a tile and a sidebar view each get a `data-surface` address, `data-read` so their text is
// readable, and the link they carry; the page as a whole is the `screen` surface that accepts GRAIN's
// `navigate`. The declarations live in this one table because some of the markup is PROOF's (the
// plans board), which PANTRY renders but never edits. It HARVESTS the manifest with GRAIN's own
// `domManifest`, and reports it to the session door (session-door.ts). And it LISTENS for a move on
// the page's SSE stream, shows where it is going, and goes there. Every move arrives already checked.

import { domManifest, type DomDoc } from "@tjakoen/grain/ai/manifest-dom.ts";

/** One declaration: which elements are a surface, and the address each one gets (null skips it). */
export interface Declaration { selector: string; address: (href: string, el: Element) => string | null }

const tail = (path: string, prefix: string): string | null => {
  const i = path.indexOf(prefix);
  if (i < 0) return null;
  const rest = decodeURIComponent(path.slice(i + prefix.length).replace(/\/+$/, ""));
  return rest && !rest.includes("/") ? rest : null;
};
const slug = (path: string): string => decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "") || "home";

/** Turn a link's path into the address of what it opens. Pure, so the mapping is tested directly. */
export function addressFor(kind: "plan" | "decision" | "view" | "tile", path: string): string | null {
  if (kind === "plan") { const id = tail(path, "/plans/plan/"); return id ? `plan:${id}` : null; }
  if (kind === "decision") { const id = tail(path, "/decisions/"); return id ? `decision:${id}` : null; }
  return `${kind}:${slug(path)}`;
}

const pathOfEl = (el: Element) => new URL((el as HTMLAnchorElement).href, location.href).pathname;

export const DECLARATIONS: Declaration[] = [
  { selector: "a.proof-card[href]", address: (h) => addressFor("plan", h) },
  { selector: "a[href*='/plans/plan/']", address: (h) => addressFor("plan", h) },
  { selector: "a.pantry-decision-card[href]", address: (h) => addressFor("decision", h) },
  { selector: ".pantry-side a.pantry-side__item[href], .pantry-nav__brand[href]", address: (h) => addressFor("view", h) },
  { selector: "main a.card[href]", address: (h) => addressFor("tile", h) },
];

function declareSurfaces(doc: Document): void {
  for (const d of DECLARATIONS) {
    for (const el of doc.querySelectorAll(d.selector)) {
      if (el.hasAttribute("data-surface")) continue;
      const href = (el as HTMLAnchorElement).getAttribute("href") ?? "";
      if (!href.startsWith("/")) continue;
      const address = d.address(pathOfEl(el), el);
      if (!address) continue;
      el.setAttribute("data-surface", address);
      el.setAttribute("data-kind", address.split(":")[0]!);
      el.setAttribute("data-read", "");
      el.setAttribute("data-href", href);
    }
  }
  doc.body.setAttribute("data-screen", location.pathname);
  doc.body.setAttribute("data-surface", "screen");
  // Navigate only. Without this list the registry inversion would also offer GRAIN's demo verbs.
  doc.body.setAttribute("data-accepts", "navigate");
}

function links(doc: Document) {
  return [...doc.querySelectorAll("[data-href][data-surface]")].map((el) => ({
    surface: el.getAttribute("data-surface")!,
    href: el.getAttribute("data-href")!,
    label: (el.querySelector(".card__title, h3, strong")?.textContent ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
  }));
}

function boot(): void {
  const base = (document.currentScript as HTMLScriptElement | null)?.src.replace(/\/pantry-session\.js.*$/, "")
    .replace(location.origin, "") ?? "";
  const client = crypto.randomUUID();
  declareSurfaces(document);

  const report = (focused: boolean) => {
    const body = JSON.stringify({ client, url: location.pathname + location.search, focused,
      manifest: domManifest(document as unknown as DomDoc), links: links(document) });
    fetch(`${base}/_session/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  };

  const es = new EventSource(`${base}/stream?session=${client}`);
  es.addEventListener("pantry-move", (e) => {
    const { href, surface } = JSON.parse((e as MessageEvent).data) as { href: string; surface: string | null };
    const el = surface ? document.querySelector(`[data-surface="${CSS.escape(surface)}"]`) as HTMLElement | null : null;
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.style.outline = "3px solid var(--color-accent, #c58b2b)";
      el.style.outlineOffset = "3px";
    }
    setTimeout(() => location.assign(href), el ? 700 : 0);
  });
  // Report once the stream is open, so a move sent right after the report has somewhere to land.
  es.addEventListener("open", () => report(true), { once: true });
  addEventListener("focus", () => report(true));
  setInterval(() => report(false), 20_000);
}

if (typeof document !== "undefined" && typeof location !== "undefined") boot();
