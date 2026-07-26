// pantry/pantry-decisions.js — the decision inbox's generate-prompt flow (piece 11d), client side.
// PANTRY is read-only and runs no model: resolving a decision is NOT a POST, it is a prompt the human
// pastes back into chat, where the AGENT records the resolution and marks the file resolved. This
// script does exactly that assembly — read the chosen option + the notes, build the prompt string, show
// it to copy. Vanilla, no build, no framework; if anything is missing the page is simply inert.
// The decision file path + title come from the server-rendered .pantry-decision data-* attributes, so
// the prompt always names the exact file to mark resolved (the file doubles as the ledger entry).
(() => {
  const root = document.querySelector(".pantry-decision");
  if (!root) return;

  const title = root.dataset.decisionTitle || "";
  const file = root.dataset.decisionFile || "";
  const genBtn = document.getElementById("decision-generate");
  const output = root.querySelector(".pantry-decision-output");
  const promptBox = document.getElementById("decision-prompt");
  const copyBtn = document.getElementById("decision-copy");
  const notesBox = document.getElementById("decision-notes");
  if (!genBtn || !output || !promptBox) return;

  function chosenOption() {
    const picked = root.querySelector('input[name="decision-option"]:checked');
    return picked ? picked.value : null;
  }

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
