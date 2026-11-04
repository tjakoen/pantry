// pantry/runs-page.ts, split out of app.ts. The page markup for one surface; app.ts keeps the routing.
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import { type RunsPayload, type RunReport, type RunPair, type EvidenceGap } from "./runs.ts";
import { renderAgentBody } from "./decisions-page.ts";

// /runs (piece 11c, the human half) — the RUN LEDGER surface. The INDEX lists closed runs newest
// first; the DETAIL renders one report against LOOP §9. Static server-rendered like /artifacts (no
// client script), model-free and read-only like every surface: runs.ts already did every judgement
// (it is key lookups and prefix compares), so this file only ever renders what it was handed.
//
// The one thing this view must not do is soften the ledger. A report missing its diffstat says so on
// the card, and scope growth is named rather than folded into a count, because the whole reason a
// session hands the owner this link instead of a chat summary is that the page cannot flatter the run
// the way a summary can. Machine twin at /runs.json — same payload, so the two never drift.
export function runPairList(pairs: RunPair[]): string {
  return `<ul class="pantry-run-pairs">${pairs.map((p) => {
    const label = escapeHtml(p.label);
    return `<li><b>${label}</b>${p.detail ? ` <span class="pantry-member__role">${escapeHtml(p.detail)}</span>` : ""}</li>`;
  }).join("")}</ul>`;
}

// Plans carry an optional href that decisions.ts's safeHref already vetted in the data layer, so the
// view renders it without re-deciding — the guard sits below this file on purpose.
export function runPlanList(pairs: RunPair[]): string {
  return `<ul class="pantry-run-pairs">${pairs.map((p) =>
    p.detail
      ? `<li><a href="${escapeHtml(p.detail)}">${escapeHtml(p.label)}</a></li>`
      : `<li><b>${escapeHtml(p.label)}</b></li>`,
  ).join("")}</ul>`;
}

export function runCard(r: RunReport): string {
  // The card carries the COUNT and lets the detail carry the labels. Spelling every gap out here made
  // the scope-growth gap say the same thing twice, once as a label and once as the growth line below.
  const evidence = r.gaps.length
    ? `<p class="pantry-run-gaps">${r.gaps.length} of 9 evidence items missing</p>`
    : `<p class="pantry-member__role">Carries its evidence.</p>`;
  const growth = r.outOfScope.length
    ? `<p class="pantry-run-growth">Scope grew: ${r.outOfScope.length} path${r.outOfScope.length === 1 ? "" : "s"} outside the declared envelope</p>`
    : "";
  // The diffstat gets its OWN line rather than trailing the date · branch run. A real one is long
  // enough to wrap that line to three and squash the card's neighbour in the grid, and shortening it
  // was rejected on the same grounds as everywhere else on this surface: the page does not truncate
  // evidence, so the fix is layout.
  const diffstat = r.diffstat
    ? `<p class="pantry-run-diffstat">${escapeHtml(r.diffstat)}</p>`
    : "";
  return `<a class="card pantry-member pantry-run-card" data-pad="sm" href="/runs/${encodeURIComponent(r.id)}">
    <h3 class="card__title">${escapeHtml(r.title)} <span class="pantry-run-badge" data-status="${r.status}">${r.status}</span></h3>
    <p class="pantry-member__role">${escapeHtml(r.date ?? "no date")}${r.branch ? ` · ${escapeHtml(r.branch)}` : ""}</p>
    ${diffstat}
    ${evidence}
    ${growth}
  </a>`;
}

export function runsIndexBody(payload: RunsPayload): string {
  const header = `<header>
  <h1 class="proof-masthead">Runs</h1>
  <p class="proof-lede">The run ledger for ${escapeHtml(payload.project)} — what each closed run did, the gate output it pasted verbatim, and which of LOOP §9's nine evidence items it is missing. Written by the agent, only read here. Machine twin at <a href="/runs.json">/runs.json</a>.</p>
</header>`;
  if (!payload.available) {
    return `${header}
<div class="card pantry-map-empty" data-pad="md">
  <h2 class="card__title">No run ledger yet</h2>
  <p class="pantry-member__role">A run closes with one markdown report here and it shows up as a card:</p>
  <pre class="pantry-map-cmd"><code>${escapeHtml(payload.dir)}/&lt;date&gt;-&lt;slug&gt;.md</code></pre>
  <p class="pantry-member__role">Frontmatter carries the declared scope, what was touched, the gates and their results, the diffstat, and who did the second pass. The body carries three headings: Gate output, What was not done, What needs human eyes.</p>
</div>`;
  }
  if (!payload.runs.length) {
    return `${header}
<div class="card pantry-map-empty" data-pad="md">
  <h2 class="card__title">The ledger is empty</h2>
  <p class="pantry-member__role">The folder exists and no run has closed with a report yet. The next one writes here:</p>
  <pre class="pantry-map-cmd"><code>${escapeHtml(payload.dir)}/&lt;date&gt;-&lt;slug&gt;.md</code></pre>
</div>`;
  }
  const summary = payload.incompleteCount
    ? `<p class="pantry-run-summary" data-tone="due">${payload.count} run${payload.count === 1 ? "" : "s"}, ${payload.incompleteCount} missing evidence.</p>`
    : `<p class="pantry-run-summary" data-tone="ok">${payload.count} run${payload.count === 1 ? "" : "s"}, all carrying their evidence.</p>`;
  return `${header}
${summary}
<div class="card-grid pantry-members">${payload.runs.map(runCard).join("\n")}</div>`;
}

// The DETAIL view. Order is deliberate and is the reviewer's reading order, not the file's: a
// five-fact summary strip (is this worth reading), then what is MISSING (the reason to open the page
// at all), then scope growth, then the meta, then the report's own prose last — because the body is
// where a run is most able to sound finished.
export function runDetailBody(r: RunReport): string {
  // The scope-growth gap's label spells out every path that grew, and the section below lists them
  // again as bullets. Shorten the checklist line rather than dropping it: the count stays honest and
  // the six paths get named once.
  const gapLabel = (g: EvidenceGap) =>
    g.id === "scope-growth" ? "touched outside the declared scope (listed below)" : g.label;
  const gaps = r.gaps.length
    ? `<section class="pantry-run-section">
  <h2 class="pantry-section-title">Missing evidence — ${r.gaps.length} of 9</h2>
  <ul class="pantry-run-gap-list">${r.gaps.map((g) => `<li data-gap="${escapeHtml(g.id)}">${escapeHtml(gapLabel(g))}</li>`).join("")}</ul>
</section>`
    : `<section class="pantry-run-section">
  <h2 class="pantry-section-title">Evidence complete</h2>
  <p class="pantry-member__role">This report carries all nine of LOOP §9's items. That is the report being complete, which is not the same as the change being right.</p>
</section>`;

  const growth = r.outOfScope.length
    ? `<section class="pantry-run-section">
  <h2 class="pantry-section-title">Scope growth — ${r.outOfScope.length}</h2>
  <p class="pantry-member__role">Touched, and outside every path the run declared before it started. LOOP §4b makes growth an ask-trigger rather than a judgement the run makes alone.</p>
  <ul class="pantry-run-gap-list">${r.outOfScope.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
</section>`
    : "";

  const meta: string[] = [];
  if (r.date) meta.push(`<div><dt>Closed</dt><dd>${escapeHtml(r.date)}</dd></div>`);
  if (r.branch) meta.push(`<div><dt>Branch</dt><dd>${escapeHtml(r.branch)}</dd></div>`);
  if (r.diffstat) meta.push(`<div><dt>Diffstat</dt><dd>${escapeHtml(r.diffstat)}</dd></div>`);
  if (r.unpushed) meta.push(`<div><dt>Unpushed</dt><dd>${escapeHtml(r.unpushed.label)}${r.unpushed.detail ? ` — ${escapeHtml(r.unpushed.detail)}` : ""}</dd></div>`);
  if (r.verifiedBy) meta.push(`<div><dt>Verified by</dt><dd>${escapeHtml(r.verifiedBy)}</dd></div>`);
  if (r.doctor) meta.push(`<div><dt>Doctor</dt><dd>${escapeHtml(r.doctor)}</dd></div>`);
  const metaBlock = meta.length
    ? `<dl class="pantry-run-meta">${meta.join("")}</dl>`
    : "";

  const block = (title: string, inner: string) =>
    inner ? `<section class="pantry-run-section"><h2 class="pantry-section-title">${title}</h2>${inner}</section>` : "";

  // Accordions for the middle. <details> is the whole mechanism: every PANTRY surface but /decisions
  // and /map is static server-rendered, and wanting a section to fold is not a reason to make this
  // the first one that ships a client script. The count sits in the summary line so the sections
  // still skim shut.
  //
  // What may NOT fold, and this is the constraint the surface exists to serve: the missing-evidence
  // list, scope growth, the gates with their results, and the report body that carries gate output
  // verbatim. LOOP §4a's point is that the evidence is PRESENT rather than summarized, and a thing
  // behind a click is a thing nobody opens. Only the run's own inventory of itself folds.
  const fold = (title: string, count: number, inner: string) =>
    inner
      ? `<details class="pantry-run-section pantry-run-fold">
  <summary class="pantry-section-title">${title} <span class="pantry-run-fold-count">${count}</span></summary>
  ${inner}
</details>`
      : "";

  // The one-line answer to "do I need to read this", before anything else on the page: how it ended,
  // when, how big, which LOOP §4b lane it ran in, how much of §9 it carries, whether it stayed inside
  // its envelope. Every fact here is also below in full — this shortens the DECISION to read on,
  // never the evidence. The lane is the one that can be missing: it is optional in the schema, and a
  // report that never declared one says nothing rather than guessing on its behalf.
  // Label above value, the same way round as the meta list right below it — the two blocks are the
  // same kind of thing and reading them in opposite orders is what made the first cut hard to scan.
  const summaryItem = (value: string, label: string, tone?: string) =>
    `<div${tone ? ` data-tone="${tone}"` : ""}><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
  const summaryBlock = `<div class="pantry-run-summary-block">
  ${summaryItem(r.status, "outcome", r.status === "blocked" ? "due" : undefined)}
  ${summaryItem(r.date ?? "no date", "closed", r.date ? undefined : "due")}
  ${summaryItem(r.diffstat ?? "no diffstat", "diffstat", r.diffstat ? undefined : "due")}
  ${r.lane ? summaryItem(r.lane, "lane", r.lane === "human" ? "due" : undefined) : ""}
  ${summaryItem(`${9 - r.gaps.length} of 9`, "evidence carried", r.gaps.length ? "due" : undefined)}
  ${summaryItem(r.outOfScope.length ? `grew by ${r.outOfScope.length}` : "held", "scope", r.outOfScope.length ? "due" : undefined)}
</div>`;

  return `<header>
  <h1 class="proof-masthead">${escapeHtml(r.title)} <span class="pantry-run-badge" data-status="${r.status}">${r.status}</span></h1>
  <p class="proof-lede"><a href="/runs">← All runs</a></p>
</header>
${summaryBlock}
${gaps}
${growth}
${metaBlock}
${block("Gates", r.gates.length ? runPairList(r.gates) : "")}
${block("Left dirty", r.dirty.length ? runPairList(r.dirty) : "")}
${fold("Plans claimed", r.plans.length, r.plans.length ? runPlanList(r.plans) : "")}
${fold("Declared scope", r.scope.length, r.scope.length ? `<ul class="pantry-run-pairs">${r.scope.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : "")}
${fold("Touched", r.touched.length, r.touched.length ? `<ul class="pantry-run-pairs">${r.touched.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : "")}
${fold("Skills", r.skills.length, r.skills.length ? `<p class="pantry-member__role">${r.skills.map((s) => escapeHtml(s)).join(" · ")}</p>` : "")}
<article class="note pantry-run-body" data-grade="smooth">${renderAgentBody(r.body)}</article>`;
}
