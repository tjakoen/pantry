// pantry-control.js — the one moving part on a deliberately static page.
//
// /control renders from files and holds still. That is the design: a live view is only ever watched
// by somebody sitting in front of it, and the value that survives the person walking away is the
// record. C2 adds the tail; this is not it.
//
// So this does exactly one job. A page left open goes on saying "idle 30s ago" an hour later, and
// that single stale number is enough to make a reader trust a surface that has stopped being true.
// The ages are recomputed from the timestamps the server already put in the DOM.
//
// WHAT IT DELIBERATELY DOES NOT DO: it never promotes a row to alive, and it never demotes one to
// ended. Both are claims about the log, and this script cannot see the log. When a row ages past the
// window in which "alive" could still be true, it is marked stale and says the page needs reloading,
// which is the honest version of not knowing.
(() => {
  "use strict";
  // The same five minutes sessions.ts calls the alive window. Longer than a model turn, shorter than
  // a coffee, which is the distinction the word has to carry.
  const ALIVE_WINDOW_S = 300;

  const age = (seconds, iso) => {
    // Past thirty days the server prints the date instead of a count, and so does this. A reload
    // that changed a label from a date into a day count would look like the page disagreeing with
    // itself about when something happened.
    if (seconds >= 86400 * 30) return iso.slice(0, 10);
    if (seconds >= 86400) return Math.floor(seconds / 86400) + "d ago";
    if (seconds >= 3600) return Math.floor(seconds / 3600) + "h ago";
    if (seconds >= 60) return Math.floor(seconds / 60) + "m ago";
    return "just now";
  };

  const tick = () => {
    const now = Date.now();
    for (const el of document.querySelectorAll(".pantry-session[data-last-seen]")) {
      const seen = Date.parse(el.getAttribute("data-last-seen"));
      if (Number.isNaN(seen)) continue;
      const seconds = Math.max(0, Math.round((now - seen) / 1000));
      const label = el.querySelector("[data-age]");
      if (label) label.textContent = age(seconds, el.getAttribute("data-last-seen"));
      // Only ever this one transition, and only in the direction that removes a claim. A row the
      // server called alive can stop being trustworthy while the page sits open; a row it called
      // ended cannot become alive without a reload telling us so.
      if (el.getAttribute("data-state") === "alive" && seconds > ALIVE_WINDOW_S) {
        el.setAttribute("data-stale", "true");
        el.setAttribute("title", "This page was rendered a while ago. Reload to see whether the session is still going.");
      }
    }
  };

  tick();
  setInterval(tick, 15000);
})();
