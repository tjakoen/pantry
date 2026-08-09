// pantry/pantry-review-client.js — the ONE thing PANTRY adds to a page it is proxying. It is
// injected as a single script tag before the closing body tag (preview.ts); nothing else about the
// reviewed app is rewritten, and the app ships nothing and installs nothing to be reviewed.
//
// P2 gives it its second job: reading a tour's decision card so PANTRY can record the answer.
//
// **Why the DOM knowledge lives HERE and not in the rail.** The rail is same-origin and could grope
// the frame's document itself, and an early draft did. Keeping it in one file is what makes CRUMB's
// class names a dependency with one owner rather than a pair of copies that drift apart, and it is
// what leaves a standalone proxied walk (no rail, no frame) able to record too.
//
// **What is read from the DOM and what is not.** Only the live VALUES: which option is picked, what
// was typed. The question, its options and the ask labels come from the tour FILE, which the rail
// already fetches, because a label scraped off a card is a guess and a label read from the tour is
// the same string the author wrote. That split is the same one the plan makes about addressability:
// where a contract exists, use it; read the screen only for what the screen alone knows.
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

  // CRUMB's own attributes, not its styling. `data-crumb-ask` and `data-crumb-pick` are what CRUMB's
  // wirePrompt binds its handlers to, so they are load-bearing there rather than incidental — which
  // is the difference between depending on a contract and depending on a class name that survived.
  const ASK_ATTR = "data-crumb-ask";
  const PICK_ATTR = "data-crumb-pick";

  /**
   * The card, only if it is actually on screen.
   *
   * Found by walking, not by reading, and the distinction it draws is the whole reason this function
   * exists rather than a bare querySelector. CRUMB's popover is a `<dialog>` and ending a tour CLOSES
   * it — the element stays in the document, so the selector still matches a card nobody can see, with
   * its last answers still in its fields. PANTRY would then offer to record an answer to a tour that
   * had already ended. The frame presentation has no such trap because ending removes the element,
   * which is why only the dialog case needs the extra question asked.
   */
  function liveCard() {
    const card = document.querySelector(".crumb-pop, .crumb-frame");
    if (!card) return null;
    if (card.tagName === "DIALOG" && !card.open) return null;
    return card;
  }

  /** Which tour is walking, straight out of CRUMB's own record. Null when nothing is. */
  function activeTour() {
    try {
      const raw = sessionStorage.getItem("crumb:active");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Read the decision card currently on screen, or null when there is none.
   *
   * The answers come back keyed by ask id because that is the token CRUMB's template fills, so a
   * caller can line them up against the tour file without matching on prose. A radio's value wins
   * over the escape's text field only when it is non-empty: CRUMB gives its "Something else" radio an
   * empty value on purpose, so an empty pick means "the answer is whatever is typed beside it".
   */
  function readPromptCard() {
    const card = liveCard();
    if (!card) return null;
    // THE ORDER OF THESE TWO LOOPS IS LOAD-BEARING. A decision ask renders both a radio group and a
    // hidden text input carrying the same ask id, for the "Something else" escape. Read the text
    // inputs first and the radios second, so that a reviewer who typed into the escape and then went
    // back and picked a real option gets the option, not the sentence they abandoned. Reversed, the
    // stale escape text wins and PANTRY records an answer the card is not showing.
    const asks = {};
    card.querySelectorAll(`[${ASK_ATTR}]`).forEach((el) => {
      const id = el.getAttribute(ASK_ATTR);
      if (id && el.value && el.value.trim()) asks[id] = el.value.trim();
    });
    card.querySelectorAll(`[${PICK_ATTR}]`).forEach((el) => {
      if (!el.checked) return;
      const id = el.getAttribute(PICK_ATTR);
      // The escape radio's value is empty by construction, so this leaves the typed text in place
      // rather than blanking it. That is why the check is on the value and not on `checked` alone.
      if (id && el.value && el.value.trim()) asks[id] = el.value.trim();
    });
    const composedEl = card.querySelector("textarea[readonly]");
    const composed = composedEl ? composedEl.value : "";
    // A card with no composed textarea is a STEP card, not the prompt card. Saying so lets a caller
    // keep its control hidden until the walk actually reaches a question, rather than offering to
    // record an answer to nothing.
    if (!composedEl) return null;
    const state = activeTour();
    return { tour: state && state.id ? state.id : null, mode: state ? state.mode : null, asks, composed };
  }

  // The handle PANTRY's chrome drives the page through. Frozen so the reviewed app cannot be blamed
  // for, or blamed by, anything that reassigns it.
  window.__pantryReview = Object.freeze({
    base,
    phase: "p2",
    /** the page is under PANTRY's origin, which is the property the whole review layer rests on */
    sameOrigin: true,
    /** the class PANTRY's rail toggles to fold a tour card down to its header */
    minimizeClass: "pantry-card-min",
    /** the decision card as data, or null when the walk is not on one */
    readPromptCard,
    /** the card element, only while it is genuinely on screen — a closed dialog is not one */
    liveCard,
    /** which tour is walking, from CRUMB's own record rather than from anything PANTRY tracked */
    activeTour,
  });

  console.info(`[pantry] review client attached · PANTRY at ${base || "/"}`);
})();
