// pantry/pantry-decisions.js — the decision inbox's two return paths (piece 11d, extended by P2 of
// plans/pantry-review-layer.md), client side.
//
// **Record** appends the answer to the append-only log (standards/DECISIONS.md §4) through PANTRY's
// one write route. **Generate prompt** composes the paste-back, which is still the right move when
// someone is already in the chat. The two are not alternatives to pick between once: recording makes
// the answer durable for a session that is not alive yet, pasting acts on it now, and doing both is
// the ordinary case rather than a mistake.
//
// PANTRY still runs no model, still parses no decision, and still writes nothing but that one log.
// Vanilla, no build, no framework; if anything is missing the page is simply inert.
(() => {
  const root = document.querySelector(".pantry-decision");
  if (!root) return;

  const id = root.dataset.decisionId || "";
  const title = root.dataset.decisionTitle || "";
  const file = root.dataset.decisionFile || "";
  const unblocks = root.dataset.decisionUnblocks || "";
  const recommendation = root.dataset.decisionRecommendation || "";
  let options = [];
  try { options = JSON.parse(root.dataset.decisionOptions || "[]"); } catch { options = []; }

  const genBtn = document.getElementById("decision-generate");
  const recBtn = document.getElementById("decision-record");
  const statusLine = document.getElementById("decision-status");
  const output = root.querySelector(".pantry-decision-output");
  const promptBox = document.getElementById("decision-prompt");
  const copyBtn = document.getElementById("decision-copy");
  const notesBox = document.getElementById("decision-notes");
  if (!genBtn || !recBtn || !output || !promptBox) return;

  // PANTRY's routes move under a reserved prefix while the preview proxy is on, and a fetch URL in a
  // script is the one kind of link the server-side rebase cannot reach. The base is stamped into the
  // head for exactly this (preview.ts's withPantryBase), so it is read rather than guessed.
  const meta = document.querySelector('meta[name="pantry-base"]');
  const base = (meta && meta.getAttribute("content")) || "";

  function chosenOption() {
    const picked = root.querySelector('input[name="decision-option"]:checked');
    return picked ? picked.value : null;
  }

  function say(message, kind) {
    if (!statusLine) return;
    statusLine.hidden = false;
    statusLine.textContent = message;
    statusLine.dataset.kind = kind;
  }

  // The entry carries the QUESTION, not a pointer to it. The session that reads this log is rarely
  // the one that asked, and a file it could re-read may have been rewritten or resolved since — so
  // the words that were actually on screen when the human answered are what gets written down.
  async function record() {
    const choice = chosenOption() || "";
    const notes = (notesBox && notesBox.value.trim()) || "";
    if (!choice && !notes) return say("Pick an option or write a note first.", "error");
    recBtn.disabled = true;
    try {
      const res = await fetch(`${base}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          via: "pantry-decisions",
          choice,
          notes,
          composed: buildPrompt(),
          request: {
            source: "decision",
            ref: id,
            file,
            question: title,
            options,
            recommendation,
            unblocks,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return say(body.error || `The answer was not recorded (${res.status}).`, "error");
      say(`Recorded as ${body.id}. The next session reads it on wake.`, "ok");
    } catch (err) {
      say(`Could not reach PANTRY to record this: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      recBtn.disabled = false;
    }
  }

  if (recBtn) recBtn.addEventListener("click", record);

  // Assemble the paste-back prompt. Naming the file explicitly is what lets the agent record the
  // resolution AND flip status: resolved in one step — no PANTRY write needed.
  function buildPrompt() {
    const option = chosenOption();
    const notes = (notesBox && notesBox.value.trim()) || "";
    const resolution = option ? option : "(no listed option chosen — see the notes below)";
    const lines = [
      `I've reviewed the decision "${title}" (${file}).`,
      "",
      `Resolution: ${resolution}`,
      "",
      "Additional notes:",
      notes || "(none)",
      "",
      `Please record this: set "status: resolved" in ${file}, write the chosen option and the reasoning`,
      "above into that file (it doubles as the decision ledger entry), then proceed accordingly.",
    ];
    return lines.join("\n");
  }

  genBtn.addEventListener("click", () => {
    promptBox.value = buildPrompt();
    output.hidden = false;
    promptBox.focus();
    promptBox.select();
  });

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const text = promptBox.value;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // clipboard API blocked (no https / permissions) — fall back to selecting for a manual copy
        promptBox.focus();
        promptBox.select();
        try { document.execCommand("copy"); } catch { /* nothing more we can do */ }
      }
      const was = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      setTimeout(() => { copyBtn.textContent = was; }, 1200);
    });
  }
})();
