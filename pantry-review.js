// pantry/pantry-review.js — the review shell's rail (P1 of plans/pantry-review-layer.md). The
// project being reviewed runs in a same-origin frame at the root; this keeps the rail beside it in
// step with what the frame is showing.
//
// It reads the REVIEWED PROJECT's own tour manifest, fetched through the proxy at /crumb/tours.json.
// That is why the shell needs no new config key: a host that mounts CRUMB answers it, and a host
// that does not returns a 404, so the rail carries only its navigation and says so. PANTRY never
// parses a tour here — the card and the lamp stay CRUMB's, drawn inside the frame, which keeps a
// GRAIN host with no PANTRY alongside working exactly as it does today.
(() => {
  const shell = document.querySelector(".pantry-review");
  if (!shell) return;

  const frame = shell.querySelector("[data-frame]");
  const urlLabel = shell.querySelector("[data-frame-url]");
  const openLink = shell.querySelector("[data-frame-open]");
  const toggle = shell.querySelector("[data-rail-toggle]");
  const cardToggle = shell.querySelector("[data-card-toggle]");
  const tourList = shell.querySelector("[data-tours]");
  const demoList = shell.querySelector("[data-demos]");
  const demosGroup = shell.querySelector("[data-demos-group]");
  const stepsGroup = shell.querySelector("[data-steps-group]");
  const stepList = shell.querySelector("[data-steps]");
  const sourceNote = shell.querySelector("[data-tour-source]");
  const recordStatus = shell.querySelector("[data-record-status]");
  const closedList = shell.querySelector("[data-closed]");
  const closedGroup = shell.querySelector("[data-closed-group]");
  const closedTitle = shell.querySelector("[data-closed-title]");

  // The frame's target is set here rather than in the markup. PANTRY rebases every root-absolute URL
  // in its own HTML onto the reserved prefix, which is correct for every link on this page and
  // exactly wrong for this one: a rebased src frames PANTRY inside PANTRY instead of the project.
  frame.src = frame.dataset.src || "/";

  // ── the rail's open/closed state ───────────────────────────────────────────
  // Persisted, because a reviewer who collapsed the rail to look at a layout does not want it back
  // on every navigation. sessionStorage rather than localStorage: it is a posture for this sitting,
  // not a setting.
  const RAIL_KEY = "pantry-review-rail";
  const setRail = (state) => {
    shell.dataset.rail = state;
    toggle.setAttribute("aria-expanded", String(state === "open"));
    toggle.textContent = state === "open" ? "Hide rail" : "Show rail";
    try { sessionStorage.setItem(RAIL_KEY, state); } catch { /* private mode, not worth failing over */ }
  };
  try { setRail(sessionStorage.getItem(RAIL_KEY) || "open"); } catch { setRail("open"); }
  toggle.addEventListener("click", () => setRail(shell.dataset.rail === "open" ? "closed" : "open"));

  // ── what the frame is currently showing ───────────────────────────────────
  // Same origin, so the frame's location is readable. That readability is the whole payoff of the
  // proxy: without it this bar could only ever show the URL it set, never the one the app navigated
  // itself to, and the tour's own navigation would be invisible from out here.
  function syncUrl() {
    let here = "/";
    try { here = frame.contentWindow.location.pathname + frame.contentWindow.location.search; } catch { here = "(cross-origin)"; }
    urlLabel.textContent = here;
    openLink.href = here;
  }
  frame.addEventListener("load", syncUrl);
  syncUrl();

  // ── say when PANTRY is theming the app too ────────────────────────────────
  // Same origin means one localStorage, and PANTRY and a GRAIN host both read the same theme keys,
  // so a scheme forced in the cockpit reaches the reviewed app on its next load. Worth having, and
  // worth saying: a reviewer looking at a screen they themselves restyled will otherwise file a bug
  // against it. Read from the frame rather than from PANTRY, because what the app ended up with is
  // the only claim that is actually true.
  const themedLabel = shell.querySelector("[data-themed]");
  function syncThemed() {
    const doc = frameDoc();
    const scheme = doc && doc.documentElement.getAttribute("data-color-scheme");
    const flavor = doc && doc.documentElement.getAttribute("data-theme");
    const forced = [scheme, flavor].filter(Boolean).join(" · ");
    themedLabel.hidden = !forced;
    themedLabel.textContent = forced ? `app themed by PANTRY: ${forced}` : "";
  }
  frame.addEventListener("load", syncThemed);
  new MutationObserver(syncThemed).observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-scheme", "data-theme"] });

  // ── folding the card down to its header ───────────────────────────────────
  // The control lives out here rather than in the card, because it is a property of the review
  // workspace and not of how a tour presents itself standalone. The rule it triggers ships in the
  // injected client (pantry-review-client.js); this only sets the class. The button stays hidden
  // until there is actually a card to fold, since a control for something absent is noise.
  let folded = false;
  const frameDoc = () => { try { return frame.contentDocument; } catch { return null; } };
  const applyFold = () => {
    const doc = frameDoc();
    if (!doc) return;
    doc.documentElement.classList.toggle("pantry-card-min", folded);
    cardToggle.setAttribute("aria-pressed", String(folded));
    cardToggle.textContent = folded ? "Unfold card" : "Fold card";
  };
  cardToggle.addEventListener("click", () => { folded = !folded; applyFold(); });

  // A card appears and disappears as a tour starts, steps and ends, so the control's visibility is
  // watched rather than set once. Re-applying the fold on every mutation is what keeps a folded card
  // folded across a step change, since CRUMB rebuilds the dialog each time.
  const watchCard = () => {
    const doc = frameDoc();
    if (!doc || !doc.body) return;
    const seen = () => {
      // Whether a card is LIVE, not whether one exists. CRUMB's popover is a <dialog> and ending a
      // tour closes it rather than removing it, so a plain selector keeps matching a card nobody can
      // see and both these controls would linger past the end of the walk.
      const has = !!(client() && client().liveCard && client().liveCard());
      cardToggle.hidden = !has;
      if (has) applyFold();
      syncActiveTour();
      syncCard();
      // THE WRITE. Closing the card is the answer — there is no Record button to press, because the
      // one that existed was a boundary (CRUMB owns the card, PANTRY owns the chrome) turned into a
      // step the reviewer had to know about, and the first person to walk this finished the card and
      // lost what they typed.
      //
      // Delayed and then re-checked rather than fired on the transition, because CRUMB rebuilds the
      // dialog on every step and a rebuild is momentarily indistinguishable from a close. Writing on
      // a rebuild would append a half-filled answer mid-walk, which the append-only log has no way to
      // take back.
      if (cardWasLive && !has && unrecordedAtCard > 0) {
        const finished = liveCard;
        clearTimeout(leaveTimer);
        const lost = unrecordedAtCard;
        leaveTimer = setTimeout(() => {
          if (readCard()) return; // it was a rebuild, not a close
          if (performance.now() < abandonedUntil) {
            // Said rather than silent: the reviewer typed something and it is gone, and the one thing
            // worse than losing it is not being told.
            return report(
              "Not recorded",
              `You closed the card with ${lost} question${lost === 1 ? "" : "s"} answered. Closing is not finishing, so nothing was written. Finish the card to record; start the tour again from the rail.`,
              "error",
              false,
            );
          }
          void recordAnswer(finished);
        }, 900);
      }
      if (has) clearTimeout(leaveTimer);
      cardWasLive = has;
      if (!has) { unrecordedAtCard = 0; liveCard = null; }
    };
    // `open` is an ATTRIBUTE, so a childList-only observer never sees a dialog close. That is exactly
    // the mutation that has to be noticed here, and watching for it costs one filtered attribute.
    new MutationObserver(seen).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    // Typing an answer is NOT a mutation. A textarea's value and a radio's checked state are
    // properties, not attributes, so an observer watching the DOM sees a reviewer fill in the whole
    // card and reports nothing changed. Found by walking it: the leave-without-recording warning
    // above was written, was correct, and never fired once, because the count it reads was only ever
    // refreshed by mutations. Capture phase, because the card may stop these from bubbling.
    doc.addEventListener("input", syncCard, true);
    doc.addEventListener("change", syncCard, true);
    // Closing is not finishing, and the difference has to be caught HERE because from the outside
    // both look like the same dialog going away. CRUMB marks its exits: `data-crumb="end"` is the ×
    // and Exit tour, `data-crumb="next"` is Finish. Writing on an × would append a draft somebody
    // changed their mind about, to a log with no way to retract it.
    doc.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('[data-crumb="end"]')) abandonedUntil = performance.now() + 3000;
    }, true);
    // Escape closes a <dialog> without any button being pressed at all, which is the same intent.
    doc.addEventListener("keydown", (e) => { if (e.key === "Escape") abandonedUntil = performance.now() + 3000; }, true);
    seen();
  };
  frame.addEventListener("load", watchCard);

  // ── recording the answer (P2) ─────────────────────────────────────────────
  // The rail asks the injected client for the card as data rather than reading the frame's DOM here.
  // That keeps CRUMB's attribute names a dependency of exactly one file, and it means the same
  // reading works for a walk with no rail around it.
  const client = () => {
    try { return frame.contentWindow.__pantryReview || null; } catch { return null; }
  };
  const readCard = () => {
    const api = client();
    try { return api && api.readPromptCard ? api.readPromptCard() : null; } catch { return null; }
  };
  // Kept WHILE the card is live, because the moment it closes readCard() returns null and the answers
  // are gone with it — nothing else in the chain remembers what was typed. A COPY, not the object
  // CRUMB handed over, since that one belongs to a dialog which is about to be torn down.
  function syncCard() {
    const card = readCard();
    if (!card) return;
    liveCard = { tour: card.tour, composed: card.composed, asks: { ...(card.asks || {}) } };
    unrecordedAtCard = Object.keys(liveCard.asks)
      .filter((id) => liveCard.asks[id])
      .filter((id) => !recorded.has(`${liveCard.tour}#${id}`)).length;
  }
  function sayRecord(message, kind) {
    if (!recordStatus) return;
    recordStatus.hidden = !message;
    recordStatus.textContent = message;
    recordStatus.dataset.kind = kind || "";
  }

  // ── the receipt ───────────────────────────────────────────────────────────
  // The bar's status line was the only place an outcome was said, and it is at the top of the pane
  // while the card being answered is at the bottom of the frame. The first human to press Record read
  // that as silence and had to ask whether anything had been written, which for the one control that
  // writes is the worst thing it could have read as. So the outcome is said twice: quietly in the
  // bar, and here, over the frame, next to the card.
  //
  // `data-kind` was already being SET on the bar's status and styled nowhere, so success and failure
  // rendered identically. That is fixed by saying the outcome in words rather than by reaching for a
  // colour: GRAIN collapses --color-success and --color-danger to --ink deliberately, so a green
  // receipt would be a token this palette closed on purpose.
  const receipt = shell.querySelector("[data-receipt]");
  const receiptEyebrow = shell.querySelector("[data-receipt-eyebrow]");
  const receiptMessage = shell.querySelector("[data-receipt-message]");
  const receiptLog = shell.querySelector("[data-receipt-log]");
  const receiptClose = shell.querySelector("[data-receipt-close]");
  if (receiptClose) receiptClose.addEventListener("click", () => { if (receipt) receipt.hidden = true; });

  // One call says it in both places, because the two drifting apart is how the bar came to disagree
  // with what actually happened.
  function report(eyebrow, message, kind, showLog) {
    // The bar gets the SHORT form. It got the full sentence first, and a bar is one line of flex: the
    // sentence pushed "Hide rail" and "Open full" onto a second row and relaid out the chrome every
    // time an outcome was reported. The detail belongs where there is room to wrap.
    sayRecord(eyebrow, kind);
    if (!receipt) return;
    receipt.hidden = false;
    receipt.dataset.kind = kind || "";
    if (receiptEyebrow) receiptEyebrow.textContent = eyebrow;
    if (receiptMessage) receiptMessage.textContent = message;
    if (receiptLog) receiptLog.hidden = !showLog;
  }

  // The question and its options come from the TOUR FILE, the answers from the card on screen. A
  // label scraped off the card would be the same words most of the time and a stale guess the once it
  // matters, and this log is read by a session that cannot check either.
  // Which asks have already landed, so pressing Record twice does not write them twice. The log is
  // append-only and has no way to retract a duplicate, so a retry after a PARTIAL failure — one ask
  // through, one refused — would otherwise leave the next session reading the same decision answered
  // twice with no way to tell which was the retry.
  const recorded = new Set();

  // The last state of the live card, how many of its asks are still unwritten, and whether a card was
  // live at the previous mutation. Together they are what lets finishing the card BE the answer: the
  // write happens when the card closes, from a copy taken while it was still open.
  let liveCard = null;
  let unrecordedAtCard = 0;
  let cardWasLive = false;
  let leaveTimer = 0;
  // A deadline rather than a boolean, so a stale flag cannot silently swallow the NEXT card's answer.
  let abandonedUntil = 0;

  // Takes the card as DATA rather than reading it, because by the time this runs the card is closing
  // or already closed. Everything it needs was copied in syncCard while the dialog was still open.
  async function recordAnswer(card) {
    if (!card) return;                                    // nothing was open; nothing to say
    if (!card.tour) {
      // Distinct from "you answered nothing", because they need opposite responses from the reviewer.
      return report("Not recorded", "PANTRY cannot tell which tour that card belonged to, so it will not guess. Reload the frame and start the tour from the rail.", "error", false);
    }
    const tour = await loadTour(card.tour);
    if (!tour || !tour.prompt) {
      return report("Not recorded", `Could not read the tour file for "${card.tour}", so the questions are unknown. Nothing was recorded.`, "error", false);
    }
    // One POST per ask, because each ask IS a decision and the log's unit is a decision, not a card.
    // Bundling them would give the next session one entry it has to take apart, and an ack that
    // cannot say which half was acted on.
    const answered = (tour.prompt.asks || [])
      .filter((a) => card.asks[a.id])
      .filter((a) => !recorded.has(`${card.tour}#${a.id}`));
    // Silence on purpose. Finishing a card you chose not to answer is a normal way to end a walk, and
    // a box telling you so every time is how a reviewer learns to ignore the box that matters.
    if (answered.length === 0) return;
    // Settled, not all-or-nothing. `Promise.all` rejects on the first throw and discards what the
    // others did, which for an append-only log means answers that ARE on disk get reported as a
    // failure and then written again on the retry.
    const outcomes = await Promise.all(answered.map(async (a) => {
      const ref = `${card.tour}#${a.id}`;
      try {
        const res = await post({
          via: "pantry-review",
          choice: card.asks[a.id],
          composed: card.composed,
          request: {
            source: "tour",
            ref,
            question: a.label,
            options: a.options || [],
            // What an answer to a review question actually unblocks is the tour itself: until it is
            // answered nobody can honestly mark the walk verified. Saying "the review of <title>" read
            // as "the review of Review: served by PANTRY", which is the kind of doubled word that only
            // shows up once a real title goes through it.
            unblocks: tour.title ? `marking "${tour.title}" verified` : "",
          },
        });
        if (res.ok) recorded.add(ref);
        return res;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }));
    const ok = outcomes.filter((r) => r.ok).length;
    const failed = outcomes.filter((r) => !r.ok);
    // What the reviewer wants to know is not the row count, it is whether they are done. So the
    // receipt says what the write MEANT: a session is waiting on this and can now move.
    if (failed.length === 0) {
      return report(
        "Recorded",
        `Recorded ${ok} answer${ok === 1 ? "" : "s"} to the append-only log. A session waiting on this walk is unblocked; one that is asleep reads it on wake. You are done here.`,
        "ok",
        true,
      );
    }
    // Say what DID land, and say what to do about the rest. There is no button to press again now, so
    // the instruction has to be the one that actually works: walk it again. Only the failures will be
    // written the second time, because `recorded` remembers what already landed.
    report(
      failed.length === outcomes.length ? "Not recorded" : "Partly recorded",
      `${ok} recorded, ${failed.length} failed: ${failed[0].error}. Start the tour again from the rail and finish it; only the ones that failed will be written.`,
      "error",
      ok > 0,
    );
  }

  // The rail is served under the reserved prefix, so its own pathname carries the base. Derived from
  // location rather than from the meta tag because this page always lives under the prefix, and one
  // fewer thing to be stamped is one fewer thing to be missing.
  const pantryBase = window.location.pathname.replace(/\/review\/?$/, "");
  async function post(payload) {
    const res = await fetch(`${pantryBase}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, id: body.id } : { ok: false, error: body.error || `HTTP ${res.status}` };
  }

  // ── which tour is actually running ────────────────────────────────────────
  // Read from CRUMB's own record rather than inferred from the rail's last click. The rail is not
  // the only way a walk starts: a tour can be launched from a link, from the site's own navigation,
  // or resumed from a previous page, and in every one of those cases a rail that only fills itself
  // on its own click shows nothing. Same origin, so the frame's sessionStorage is simply readable,
  // which is one more thing the proxy buys that a cross-origin embed would not.
  const CRUMB_KEY = "crumb:active";
  let shownTour = null;
  function activeTour() {
    try {
      const raw = frame.contentWindow.sessionStorage.getItem(CRUMB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function syncActiveTour() {
    const state = activeTour();
    if (!state || !state.id) { stepsGroup.hidden = true; shownTour = null; return; }
    if (state.id !== shownTour) { shownTour = state.id; void showSteps(state.id); }
    markCurrentStep(state.step);
  }
  // Where the reviewer is in the walk. The only thing the rail says about the current step, on
  // purpose: what that step SAYS is in the card, three inches to the right.
  function markCurrentStep(index) {
    [...stepList.children].forEach((li, i) => { li.dataset.current = String(i === index); });
  }

  // ── the reviewed project's tours ──────────────────────────────────────────
  const startTour = (id) => {
    // CRUMB takes the tour id as a query parameter on any page of the host, and consumes it before
    // the walk starts. Sending the frame there is the same click a person would make.
    frame.src = `/?crumb=${encodeURIComponent(id)}&crumb-mode=dev`;
  };

  // Whether a review has actually been done, derived from the steps rather than tracked separately.
  // TOUR-STANDARD already has the vocabulary: `verified` means someone who did not write it walked
  // it, and the standard says marking your own work verified is almost always wrong. So a tour whose
  // every step is verified has been reviewed, and anything else is still waiting on a person. A
  // second place to record "is this reviewed" would immediately disagree with the first; this cannot,
  // because there is only one source and it is the file the reviewer edits anyway.
  function reviewState(steps) {
    const statuses = (steps || []).map((s) => s.status).filter(Boolean);
    if (statuses.length === 0) return null;                                   // not a review tour
    if (statuses.some((s) => s === "known-issue")) return "known issue";
    if (statuses.every((s) => s === "verified")) return "reviewed";
    const waiting = statuses.filter((s) => s !== "verified").length;
    return `${waiting} of ${statuses.length} awaiting you`;
  }

  function tourButton(t, onPick) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pantry-review__tour";
    btn.append(document.createTextNode(t.title || t.id));
    const meta = document.createElement("span");
    meta.className = "pantry-review__tourmeta";
    meta.textContent = `${t.steps} step${t.steps === 1 ? "" : "s"}`;
    btn.append(meta);
    btn.addEventListener("click", () => onPick(t.id));
    li.append(btn);
    return { li, btn, meta };
  }

  // What the ANSWER LOG knows about a tour, which is the half the tour file cannot know: the statuses
  // in the file were written before the walk, and no answer arriving afterwards ever edits them. A
  // rail reading only the file says "2 of 3 awaiting you" about a review that was answered an hour
  // ago and acked since, which is the rail lying rather than being out of date.
  //
  // Matched on the ref's tour prefix rather than by loading every tour's asks, because the ref format
  // is `<tour>#<ask>` and it is written here, in this file, three functions up.
  async function loadAnswerIndex() {
    const empty = { answered: new Set(), unread: new Set() };
    try {
      const res = await fetch(`${pantryBase}/answers.json`, { headers: { accept: "application/json" } });
      if (!res.ok) return empty;                         // decisions surface off: no index, no marks
      const payload = await res.json();
      const tourOf = (e) => String((e && e.request && e.request.ref) || "").split("#")[0];
      const index = { answered: new Set(), unread: new Set() };
      for (const e of payload.answers || []) { const id = tourOf(e); if (id) index.answered.add(id); }
      for (const e of payload.unread || []) { const id = tourOf(e); if (id) index.unread.add(id); }
      return index;
    } catch { return empty; }
  }

  function renderTours(list, tours, withState, answers) {
    list.replaceChildren(...tours.map((t) => {
      const { li, btn, meta } = tourButton(t, (id) => { showSteps(id); startTour(id); });
      if (!withState) return li;
      // The answer state is known up front and does not wait on the per-tour fetch below, so a rail
      // that fails to load a tour file still says which reviews have been answered.
      const answered = answers && answers.answered.has(t.id);
      const waitingOnAI = answered && answers.unread.has(t.id);
      // The state costs one fetch per tour and is worth it: a rail that lists reviews without
      // saying which are outstanding is a list of files, not a queue.
      void (async () => {
        const tour = await loadTour(t.id);
        const fileState = tour && reviewState(tour.steps);
        // The answer wins over the file. Both are true statements about different moments, and the
        // one the reviewer needs is the later one.
        const state = waitingOnAI ? "answered, waiting on the AI" : answered ? "answered" : fileState;
        if (!state) return;
        btn.dataset.state = waitingOnAI ? "answered" : answered ? "reviewed" : state === "reviewed" ? "reviewed" : "pending";
        meta.textContent = `${t.steps} step${t.steps === 1 ? "" : "s"} · ${state}`;
        if (!answered && state !== "reviewed") li.dataset.pending = "true";
      })();
      return li;
    }));
  }

  function empty(message) {
    const li = document.createElement("li");
    li.className = "pantry-review__empty";
    li.textContent = message;
    tourList.replaceChildren(li);
  }

  // ── which server answers for tours ────────────────────────────────────────
  // Read, not discovered. The rail used to probe the project's /crumb/tours.json and accept any 2xx,
  // which an SPA catch-all answering 200 text/html satisfies without serving a single tour — and
  // that is the shape of the projects Tier 1 exists to reach. The decision is PANTRY's now
  // (`resolveToursSource` in app.ts), where it can check a content type and a parsed body, and where
  // a test can reach it. The client reads one attribute.
  const toursBase = shell.dataset.toursBase || null;
  const toursAreOurs = shell.dataset.toursSource === "pantry";

  const tourCache = new Map();
  async function loadTour(id) {
    if (!toursBase) return null;
    if (tourCache.has(id)) return tourCache.get(id);
    const p = fetch(`${toursBase}/tours/${encodeURIComponent(id)}.json`, { headers: { accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    tourCache.set(id, p);
    return p;
  }

  async function showSteps(id) {
    try {
      const tour = await loadTour(id);
      if (!tour) return;
      // The rail shows the WALK, never the words. The card already carries a step's prose, and a rail
      // that repeats it is two copies of the same paragraph on one screen, which is the failure this
      // rail was built to fix rather than a fix for it. What the card cannot show is the shape of the
      // whole walk: how many steps, which one you are on, what each one is pointed at, and which are
      // still waiting on a person. That is the rail's job and it needs no field the format lacks.
      //
      // It also means long prose has nowhere to hide. The fix for a step that will not fit its card
      // is a shorter step (TOUR-STANDARD's length rule), not a second copy of it over here.
      stepList.replaceChildren(...(tour.steps || []).map((s, i) => {
        const li = document.createElement("li");
        li.className = "pantry-review__step";
        if (s.status) li.dataset.status = s.status;

        const n = document.createElement("b");
        n.className = "pantry-review__stepno";
        n.textContent = String(i + 1);
        const label = document.createElement("span");
        label.className = "pantry-review__steplabel";
        label.textContent = s.surface || s.at || "step";
        li.append(n, label);
        if (s.status) {
          const badge = document.createElement("span");
          badge.className = "pantry-review__status";
          badge.textContent = s.status;
          li.append(badge);
        }
        return li;
      }));
      stepsGroup.hidden = false;
      const state = activeTour();
      if (state && state.id === id) markCurrentStep(state.step);
    } catch { /* the rail is a convenience; the walk itself lives in the frame */ }
  }

  // ── the walk a handoff asked for ──────────────────────────────────────────
  // `?tour=<id>` opens the rail already walking it. Without this, a session that says "review this
  // change" can only hand over a URL to the review page plus a sentence about which entry to click,
  // and the sentence is the part that goes stale — a tour renamed in the file is a rail entry the
  // reviewer cannot find, with nothing failing anywhere to say so.
  //
  // Deliberately NOT validated against the manifest first. An unknown id lands the frame on the app
  // with no tour running, which is what a bad link should look like; waiting for the manifest just to
  // refuse would make the good case slower to serve the bad one.
  const wantedTour = new URLSearchParams(window.location.search).get("tour");
  if (wantedTour) { void showSteps(wantedTour); startTour(wantedTour); }

  (async () => {
    try {
      const ours = toursAreOurs;
      if (!toursBase) return empty("Neither this project nor PANTRY serves tours. The frame is still live, and a step's verify line is something you perform — that is Tier 0, and it is a real review.");
      const res = await fetch(`${toursBase}/tours.json`, { headers: { accept: "application/json" } });
      if (!res.ok) return empty("The tour manifest stopped answering between one fetch and the next.");
      const tours = await res.json();
      if (!Array.isArray(tours) || tours.length === 0) return empty(ours ? "No tours in PANTRY's own tours folder yet." : "No tours in this project yet.");
      // Say WHOSE tours these are. A reviewer who edits a step will otherwise look for the file in
      // the project, and on Tier 1 it is not there — it lives in the repo running PANTRY, which is
      // the arrangement that let the project stay untouched in the first place.
      // Guarded, because a stale cached copy of this script against newer markup would otherwise
      // throw here and be reported by the catch below as a manifest that could not be read, which is
      // a message about the wrong thing entirely.
      if (ours && sourceNote) sourceNote.textContent = "Tours served by PANTRY, from the reviewing repo. The project itself carries none.";
      const answers = await loadAnswerIndex();
      const allReviews = tours.filter((t) => t.mode === "dev");
      const demos = tours.filter((t) => t.mode !== "dev");
      // Closed = answered AND acked. Answered-but-unacked stays in the list, because it is still
      // waiting on someone; it is simply waiting on the AI rather than on the reviewer, and the rail
      // says which.
      const closed = allReviews.filter((t) => answers.answered.has(t.id) && !answers.unread.has(t.id));
      const reviews = allReviews.filter((t) => !closed.includes(t));
      if (reviews.length === 0) empty(ours ? "No review tours in PANTRY's tours folder. The demo tours below are product walkthroughs." : "No review tours in this project. The demo tours below are product walkthroughs.");
      else renderTours(tourList, reviews, true, answers);
      if (closed.length > 0 && closedList && closedGroup) {
        renderTours(closedList, closed, true, answers);
        if (closedTitle) closedTitle.textContent = `Closed (${closed.length})`;
        closedGroup.hidden = false;
      }
      if (demos.length > 0) {
        renderTours(demoList, demos, false);
        demosGroup.hidden = false;
      }
    } catch {
      empty("Could not read a tour manifest from either the project or PANTRY. Is the project still running?");
    }
  })();
})();
