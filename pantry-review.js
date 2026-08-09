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
  const tourList = shell.querySelector("[data-tours]");
  const demoList = shell.querySelector("[data-demos]");
  const demosGroup = shell.querySelector("[data-demos-group]");
  const stepsGroup = shell.querySelector("[data-steps-group]");
  const stepList = shell.querySelector("[data-steps]");

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

  function renderTours(list, tours, withState) {
    list.replaceChildren(...tours.map((t) => {
      const { li, btn, meta } = tourButton(t, (id) => { showSteps(id); startTour(id); });
      if (!withState) return li;
      // The state costs one fetch per tour and is worth it: a rail that lists reviews without
      // saying which are outstanding is a list of files, not a queue.
      void (async () => {
        const tour = await loadTour(t.id);
        const state = tour && reviewState(tour.steps);
        if (!state) return;
        btn.dataset.state = state === "reviewed" ? "reviewed" : "pending";
        meta.textContent = `${t.steps} step${t.steps === 1 ? "" : "s"} · ${state}`;
        if (state !== "reviewed") li.dataset.pending = "true";
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

  const tourCache = new Map();
  async function loadTour(id) {
    if (tourCache.has(id)) return tourCache.get(id);
    const p = fetch(`/crumb/tours/${encodeURIComponent(id)}.json`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    tourCache.set(id, p);
    return p;
  }

  async function showSteps(id) {
    try {
      const tour = await loadTour(id);
      if (!tour) return;
      stepList.replaceChildren(...(tour.steps || []).map((s, i) => {
        const li = document.createElement("li");
        li.className = "pantry-review__step";
        if (s.status) li.dataset.status = s.status;
        const n = document.createElement("b");
        n.className = "pantry-review__stepno";
        n.textContent = String(i + 1);
        const label = document.createElement("span");
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
    } catch { /* the rail is a convenience; the walk itself lives in the frame */ }
  }

  (async () => {
    try {
      const res = await fetch("/crumb/tours.json");
      if (!res.ok) return empty("This project does not serve tours. The frame is still live, and a step's verify line is something you perform.");
      const tours = await res.json();
      if (!Array.isArray(tours) || tours.length === 0) return empty("No tours in this project yet.");
      const reviews = tours.filter((t) => t.mode === "dev");
      const demos = tours.filter((t) => t.mode !== "dev");
      if (reviews.length === 0) empty("No review tours in this project. The demo tours below are product walkthroughs.");
      else renderTours(tourList, reviews, true);
      if (demos.length > 0) {
        renderTours(demoList, demos, false);
        demosGroup.hidden = false;
      }
    } catch {
      empty("Could not reach the project's tour manifest. Is it still running?");
    }
  })();
})();
