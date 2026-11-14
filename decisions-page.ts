// pantry/decisions-page.ts, split out of app.ts. The page markup for one surface; app.ts keeps the routing.
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { renderGrainDocument } from "@tjakoen/mill/adapters/grain/grain-adapter.ts";
import { type DecisionsPayload, type DecisionRequest } from "./decisions.ts";
import { answers, appendAnswer, AnswerRejected, isLoopbackRequest, normalizeAnswer, unacked, MAX_ANSWER_BODY_BYTES, type AnswerEntry, type AnswerLog } from "./answers.ts";

// /decisions (piece 11d) — the decision inbox. The INDEX: open decisions first (what the human owes an
// answer), then the resolved ledger tail. Model-free, read-only; the payload is the machine twin at
// /decisions.json. An absent dir degrades to guidance (how to write a decision-request), never a crash.
export function decisionCard(d: DecisionRequest): string {
  const badge = `<span class="pantry-decision-badge" data-status="${d.status}">${d.status}</span>`;
  const rec = d.recommendation
    ? `<p class="pantry-member__role">Recommends: ${escapeHtml(d.recommendation)}</p>`
    : "";
  return `<a class="card pantry-member pantry-decision-card" data-pad="sm" href="/decisions/${encodeURIComponent(d.id)}">
    <h3 class="card__title">${escapeHtml(d.title)} ${badge}</h3>
    <p class="pantry-member__role">${d.options.length} option${d.options.length === 1 ? "" : "s"}</p>
    ${rec}
  </a>`;
}

export function decisionsIndexBody(payload: DecisionsPayload): string {
  const header = `<header>
  <h1 class="proof-masthead">Decisions</h1>
  <p class="proof-lede">Open decisions the AI has routed to you for ${escapeHtml(payload.project)} — the question, its options, and the evidence, side by side. Answering one records it to the <a href="/answers">answer log</a>, which the next session reads on wake, or generates a prompt to paste straight back into chat. PANTRY still runs no model, and the log is the one thing it writes. Machine twin at <a href="/decisions.json">/decisions.json</a>.</p>
</header>`;
  if (!payload.available) {
    return `${header}
<div class="card pantry-map-empty" data-pad="md">
  <h2 class="card__title">No decision inbox yet</h2>
  <p class="pantry-member__role">Write decision-requests as markdown here and they show up as cards:</p>
  <pre class="pantry-map-cmd"><code>${escapeHtml(payload.dir)}/&lt;id&gt;.md</code></pre>
  <p class="pantry-member__role">Each file carries a title, status (open/resolved), an options list, an optional recommendation, and evidence links in its frontmatter, with the context in the body.</p>
</div>`;
  }
  const open = payload.decisions.filter((d) => d.status === "open");
  const resolved = payload.decisions.filter((d) => d.status === "resolved");
  const openSection = open.length
    ? `<section class="pantry-decisions-open">
  <h2 class="pantry-section-title">Open — ${open.length}</h2>
  <div class="card-grid pantry-members">${open.map(decisionCard).join("\n")}</div>
</section>`
    : `<section class="pantry-decisions-open">
  <div class="card pantry-map-empty" data-pad="md"><h2 class="card__title">Nothing open</h2>
  <p class="pantry-member__role">No decision is waiting on you. New ones the AI files will appear here.</p></div>
</section>`;
  const resolvedSection = resolved.length
    ? `<section class="pantry-decisions-resolved">
  <h2 class="pantry-section-title">Resolved — ${resolved.length}</h2>
  <p class="pantry-member__role">The ledger tail: decisions already made. Each file records the choice and the reasoning.</p>
  <div class="card-grid pantry-members">${resolved.map(decisionCard).join("\n")}</div>
</section>`
    : "";
  return `${header}\n${openSection}\n${resolvedSection}`;
}

// Render an agent-written markdown body (a decision request, a run report) to a clean HTML fragment
// (body only, no masthead) via the same GRAIN adapter every other doc uses. Falls back to escaped
// plain text if the render ever throws, so a single odd file can't 500 the surface. Shared by
// /decisions and /runs — both render prose the agent wrote and PANTRY only reads.
export function renderAgentBody(md: string): string {
  if (!md.trim()) return "";
  try {
    return renderGrainDocument(md, { defaultLayout: ({ body }: { body: string }) => body }).html;
  } catch {
    return `<p class="pantry-member__role">${escapeHtml(md)}</p>`;
  }
}

// The DETAIL view: the question + options (radios) + evidence, an always-present notes box, and the
// two ways an answer leaves this page. The data-* attributes feed pantry-decisions.js everything both
// paths need, which is more than the paste-back needed alone: the answer log entry has to carry the
// question, the options and what it unblocks, so they are handed to the client rather than re-derived
// from the DOM it is about to read.
//
// **Both paths, not one replacing the other.** "Record answer" appends to the log and is the durable
// channel; "Generate prompt" is the paste, which is still the right move when someone is watching and
// the run is in front of them (DECISIONS §2 puts the chat above every surface below it). What changed
// in P2 is that the paste is no longer the ONLY path, which is what made an answer usable only while
// the session that asked was still alive.
export function decisionDetailBody(d: DecisionRequest): string {
  const opts = d.options.length
    ? d.options.map((opt, i) => {
        const id = `opt-${i}`;
        const isRec = d.recommendation === opt;
        return `<label class="pantry-decision-option${isRec ? " pantry-decision-option--rec" : ""}" for="${id}">
      <input type="radio" name="decision-option" id="${id}" value="${escapeHtml(opt)}"${isRec ? " checked" : ""}>
      <span>${escapeHtml(opt)}${isRec ? ' <em class="pantry-decision-rec-tag">recommended</em>' : ""}</span>
    </label>`;
      }).join("\n")
    : `<p class="pantry-member__role">This request lists no discrete options — decide in the notes below.</p>`;

  const evidence = d.evidence.length
    ? `<aside class="pantry-decision-evidence">
    <h2 class="pantry-section-title">Evidence</h2>
    <ul>${d.evidence.map((e) =>
      e.href
        ? `<li><a href="${escapeHtml(e.href)}">${escapeHtml(e.label)}</a></li>`
        : `<li>${escapeHtml(e.label)}</li>`,
    ).join("")}</ul>
  </aside>`
    : "";

  const resolvedBanner = d.status === "resolved"
    ? `<p class="pantry-decision-resolved-banner">This decision is already marked resolved. Generating a prompt again will re-record it.</p>`
    : "";

  return `<header>
  <h1 class="proof-masthead">${escapeHtml(d.title)} <span class="pantry-decision-badge" data-status="${d.status}">${d.status}</span></h1>
  <p class="proof-lede"><a href="/decisions">← All decisions</a></p>
</header>
${resolvedBanner}
<article class="note pantry-decision-body" data-grade="smooth">${renderAgentBody(d.body)}</article>
<div class="pantry-decision"
     data-decision-id="${escapeHtml(d.id)}"
     data-decision-title="${escapeHtml(d.title)}"
     data-decision-file="${escapeHtml(d.file)}"
     data-decision-options="${escapeHtml(JSON.stringify(d.options))}"
     ${d.recommendation ? `data-decision-recommendation="${escapeHtml(d.recommendation)}"` : ""}
     ${d.unblocks ? `data-decision-unblocks="${escapeHtml(d.unblocks)}"` : ""}>
  <div class="pantry-decision-grid">
    <section class="pantry-decision-options">
      <h2 class="pantry-section-title">Options</h2>
      ${opts}
    </section>
    ${evidence}
  </div>
  <label class="pantry-decision-notes-label" for="decision-notes">Additional notes (always sent)</label>
  <textarea id="decision-notes" class="pantry-decision-notes" rows="4" placeholder="Anything the AI should know beyond the chosen option — constraints, a different option entirely, follow-ups."></textarea>
  <div class="pantry-decision-actions">
    <button type="button" class="pantry-decision-record" id="decision-record">Record answer</button>
  </div>
  <p class="pantry-decision-hint">Recording appends to the answer log the next session reads on wake.</p>
  <p class="pantry-decision-status" id="decision-status" role="status" hidden></p>
  <!-- The paste-back, kept and folded. Settled by the owner 2026-08-11, answering this page's own
       question through the review tour: "keep the paste prompt, but collapse it". Both paths still
       exist because they are for different moments — DECISIONS §2 puts the chat above every surface
       below it, and pasting is right when someone is already in it — but two equal buttons made the
       durable channel and the transient one look like a choice of taste rather than a default and an
       escape hatch. -->
  <details class="pantry-decision-paste">
    <summary>Or paste it back into chat</summary>
    <!-- Two reasons, and the SECOND one is why this is folded rather than deleted. The owner gave it
         on the second walk: "so that if the FINISH doesn't work, copy and pasting is still an
         option". A fallback that is only there when the primary path works is not a fallback, so
         this stays reachable with the recorder broken, which is also why it composes the prompt in
         the browser and needs nothing from the server to do it. -->
    <p class="pantry-decision-hint">For when the run is in front of you right now — and for when recording does not work, since this path needs nothing from the server. The log is not written this way, so the answer lives only as long as that chat does.</p>
    <button type="button" class="pantry-decision-generate" id="decision-generate">Generate prompt</button>
    <div class="pantry-decision-output" hidden>
      <label class="pantry-decision-notes-label" for="decision-prompt">Prompt — copy this into chat</label>
      <textarea id="decision-prompt" class="pantry-decision-prompt" rows="10" readonly></textarea>
      <button type="button" class="pantry-decision-copy" id="decision-copy">Copy</button>
    </div>
  </details>
</div>
<script src="/pantry-decisions.js" defer></script>`;
}

/** What Bun hands the fetch handler. Only the one method is used, and it is typed narrowly so a test
 *  can stand in a fake without pulling in the whole server surface. */
export interface PantryServer {
  requestIP?: (req: Request) => { address: string } | null;
  /** Bun's per-request idle timeout; 0 turns it off for a long-lived stream. */
  timeout?: (req: Request, seconds: number) => void;
}

/**
 * Read a request body, stopping at `cap` rather than measuring afterwards. Null means over the cap.
 *
 * The first version called `req.arrayBuffer()` and checked the length it got back, which is a cap on
 * what gets WRITTEN and not a cap on what gets read: the whole payload was already in memory by the
 * time the 413 was decided. Trusting Content-Length instead would be worse, for the reason the proxy
 * already learned — a declared length is a claim. So the only honest version reads the stream and
 * stops, which is what this does.
 */
export async function readBodyUpTo(req: Request, cap: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => { /* the client hung up first; the refusal stands either way */ });
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return out;
}

/**
 * The write-back (P2). PANTRY's ONLY write, and every bound on it lives in this one function so the
 * list can be read rather than reconstructed:
 *
 *   - **Loopback socket only.** Checked on the connection, never on a header, because Origin and
 *     Referer are claims and the point of the check is to believe no claims.
 *   - **A body cap read from the bytes**, not from Content-Length, for the same reason the proxy
 *     stopped trusting it: a declared length is another claim.
 *   - **A validated shape.** An entry with no question is refused, so "the answer carries its own
 *     question" is a property of the file rather than a habit of its writers.
 *   - **The path comes from config.** Nothing in the request names, hints at, or influences where
 *     this is written. That is what keeps a POST-from-a-page from being a write-anywhere primitive.
 *   - **Append only.** There is no route that edits or deletes an entry, here or anywhere.
 */
export async function recordAnswerRequest(req: Request, clientAddress: string | null, logPath: string): Promise<Response> {
  if (!isLoopbackRequest(clientAddress)) {
    return Response.json({ error: "The answer log accepts writes from this machine only." }, { status: 403 });
  }
  const raw = await readBodyUpTo(req, MAX_ANSWER_BODY_BYTES);
  if (raw === null) {
    return Response.json({ error: `Over the ${MAX_ANSWER_BODY_BYTES} byte cap.` }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return Response.json({ error: "Body is not JSON." }, { status: 400 });
  }
  try {
    const entry = await appendAnswer(logPath, normalizeAnswer(body), new Date());
    return Response.json({ ok: true, id: entry.id, at: entry.at, path: logPath }, { status: 201 });
  } catch (err) {
    if (err instanceof AnswerRejected) return Response.json({ error: err.message }, { status: 400 });
    return Response.json({ error: "Could not write the answer log." }, { status: 500 });
  }
}

// /answers — the read half of the channel. Deliberately plain: the questions are rendered richly over
// on /decisions, and repeating that here would be two surfaces for one thing. What this page owes is
// the tail nobody has acted on, in the order it has to be acted on.
export function answerCard(a: AnswerEntry, unread: boolean): string {
  const options = a.request.options?.length
    ? `<p class="pantry-answer__meta">Offered: ${a.request.options.map((o) => escapeHtml(o)).join(" · ")}</p>`
    : "";
  const unblocks = a.request.unblocks
    ? `<p class="pantry-answer__meta">Unblocks: ${escapeHtml(a.request.unblocks)}</p>`
    : "";
  const notes = a.notes ? `<p class="pantry-answer__notes">${escapeHtml(a.notes)}</p>` : "";
  return `<article class="card pantry-member pantry-answer" data-pad="sm" data-unread="${unread}">
  <p class="pantry-answer__head"><code>${escapeHtml(a.id)}</code> · ${escapeHtml(a.at)} · <b>${escapeHtml(a.request.source)}</b> · ${escapeHtml(a.request.ref)}</p>
  <p class="pantry-answer__q">${escapeHtml(a.request.question)}</p>
  ${options}${unblocks}
  ${a.choice ? `<p class="pantry-answer__a">${escapeHtml(a.choice)}</p>` : ""}
  ${notes}
</article>`;
}

export function answersBody(log: AnswerLog, project: string): string {
  const unread = unacked(log);
  const unreadIds = new Set(unread.map((a) => a.id));
  const rest = answers(log).filter((a) => !unreadIds.has(a.id));
  const header = `<header>
  <h1 class="proof-masthead">Answers</h1>
  <p class="proof-lede">Every answer ${escapeHtml(project)} has given a run, in one append-only log. A session reads the unread ones when it wakes and acks what it acted on; nothing here is ever edited. Machine twin at <a href="/answers.json">/answers.json</a>. <a href="/decisions">← The questions</a></p>
  <p class="pantry-answer__path"><code>${escapeHtml(log.path)}</code>${log.malformed ? ` · ${log.malformed} unparseable line(s) skipped` : ""}</p>
</header>`;
  if (log.readError) return `${header}<p role="alert">Cannot read the answer log: ${escapeHtml(log.readError)}. Unread answers are unknown.</p>`;
  if (log.entries.length === 0) {
    if (log.malformed) return `${header}<p role="alert">No valid entries were recovered. Unread answers are unknown; repair the log before continuing.</p>`;
    return `${header}
<p class="pantry-member__role">Nothing answered yet. A run raises a question on a decision request or a tour's decision card, you answer it there, and it lands here.</p>`;
  }
  const warning = log.malformed ? `<p role="alert">Unread answers are unknown because some entries could not be read. Repair the log before waiting or acknowledging.</p>` : "";
  const unreadSection = `<h2 class="pantry-section-title">Unread (${unread.length})</h2>
${unread.length ? unread.map((a) => answerCard(a, true)).join("\n") : `<p class="pantry-member__role">${log.malformed ? "No valid unread answers were recovered." : "Every answer has been acted on."}</p>`}`;
  const restSection = rest.length
    ? `<h2 class="pantry-section-title">Acted on (${rest.length})</h2>\n${rest.map((a) => answerCard(a, false)).join("\n")}`
    : "";
  return `${header}\n${warning}\n${unreadSection}\n${restSection}`;
}
