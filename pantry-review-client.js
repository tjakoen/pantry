// pantry/pantry-review-client.js — the ONE thing PANTRY adds to a page it is proxying. It is
// injected as a single script tag before the closing body tag (preview.ts); nothing else about the
// reviewed app is rewritten, and the app ships nothing and installs nothing to be reviewed.
//
// P0 deliberately stops here. This file exists so the injection point is real, addressable and
// testable before anything is built on it — the tour client, the spotlight and the decision card are
// P1 and P2 of plans/pantry-review-layer.md, and each wants its own pass. Adding them here early
// would make the proxy hard to tell apart from the thing it carries.
(() => {
  // Where PANTRY's own routes live, read from this script's own URL rather than hardcoded, so the
  // reserved prefix stays a fact of one module (preview.ts) instead of a string in two places.
  const src = (document.currentScript && document.currentScript.src) || "";
  let base = "";
  try {
    base = new URL(src, window.location.href).pathname.replace(/\/[^/]*$/, "");
  } catch {
    base = "";
  }

  // Collapsing the card to its header is PANTRY's business, not the tour layer's: it is about the
  // review WORKSPACE (I want to see what is underneath) rather than about how a tour presents itself
  // standalone. So the rule ships here, scoped to a class only PANTRY sets, and the control that
  // sets it lives out in PANTRY's own bar. One rule, one owner, and nothing in the reviewed project
  // or in CRUMB has to know about it.
  const style = document.createElement("style");
  style.textContent = `
    .pantry-card-min .crumb-pop__body,
    .pantry-card-min .crumb-pop__foot { display: none; }
    .pantry-card-min .crumb-pop { opacity: 0.9; }
  `;
  document.head.appendChild(style);

  // The handle a later phase drives the page through. Frozen so the reviewed app cannot be blamed
  // for, or blamed by, anything that reassigns it.
  window.__pantryReview = Object.freeze({
    base,
    phase: "p1",
    /** the page is under PANTRY's origin, which is the property the whole review layer rests on */
    sameOrigin: true,
    /** the class PANTRY's rail toggles to fold a tour card down to its header */
    minimizeClass: "pantry-card-min",
  });

  console.info(`[pantry] review client attached · PANTRY at ${base || "/"}`);
})();
