// pantry/design-page.ts — the markup for the Design surface; app.ts keeps the routing and design.ts
// the model. Every view is display-only: the files under design/ are the source of truth, and each
// view links to the others through the same `<file>#<id>` references the files use.
import { escapeHtml as e } from "@tjakoen/mill/core/engine.ts";
import {
  type DesignPayload, type DesignModel, type ArchLevel, type TestState, type DfdFlow,
  refHref, plansForTable, flowsForTable, crossesRegion, tableFor, plansFor,
} from "./design.ts";
import { erdSvg, dfdSvg, c4Svg, flowSvg, DIAGRAM_SCRIPT, DIAGRAM_MARKER } from "./design-diagrams.ts";

const TEST_LABEL: Record<TestState, string> = { pass: "passing", fail: "failing", unrun: "no result", missing: "test file missing" };

export const testBadge = (m: DesignModel, ref: string | undefined): string => {
  if (!ref) return `<span class="pantry-design__test" data-test="none">no test</span>`;
  const s = m.tests[ref] ?? "unrun";
  return `<span class="pantry-design__test" data-test="${s}" title="${e(ref)}">${TEST_LABEL[s]}</span>`;
};

// The palette is closed, so a matrix cell's state is its mark: pass, fail, or not judged.
const CELL_MARK: Record<TestState, string> = { pass: "●", fail: "✕", unrun: "○", missing: "?" };

const refLink = (ref: string) => `<a class="pantry-design__ref" href="${refHref(ref)}"><code>${e(ref)}</code></a>`;
const planLink = (id: string, title?: string) => `<a href="/plans/plan/${encodeURIComponent(id)}">${e(title ?? id)}</a>`;

const TABS: [string, string][] = [
  ["/design", "Overview"], ["/design/erd", "ERD"], ["/design/dfd", "DFD"], ["/design/architecture", "Architecture"],
  ["/design/flows", "User flows"], ["/design/wireframes", "Wireframes"], ["/design/decisions", "Decisions"], ["/design/requirements", "Traceability"],
];

function shell(m: DesignModel, active: string, title: string, lede: string, body: string): string {
  const tabs = TABS.map(([href, label]) => `<a class="pantry-design__tab"${href === active ? ` aria-current="page"` : ""} href="${href}">${label}</a>`).join("");
  const errors = m.errors.length
    ? `<div class="card pantry-design__errors" data-pad="sm"><p><b>${m.errors.length} file${m.errors.length === 1 ? "" : "s"} would not parse.</b> Their views are empty until they are fixed.</p><ul>${m.errors.map((x) => `<li><code>${e(x.file)}</code> ${e(x.message)}</li>`).join("")}</ul></div>`
    : "";
  return `<header>
  <h1 class="proof-masthead">${e(title)}</h1>
  <p class="proof-lede">${lede}</p>
</header>
<nav class="pantry-design__tabs" aria-label="Design views">${tabs}</nav>
${errors}
${body}
${body.includes(DIAGRAM_MARKER) ? DIAGRAM_SCRIPT : ""}`;
}

const missing = (what: string, file: string) =>
  `<div class="card" data-pad="md"><h2 class="card__title">No ${what} yet</h2><p class="pantry-member__role">PANTRY reads <code>design/${file}</code>; the design skill writes it.</p></div>`;

export function designUnavailable(m: DesignModel): string {
  return `<header><h1 class="proof-masthead">Design</h1><p class="proof-lede">The project's planning artifacts, rendered from its design/ folder.</p></header>
<div class="card" data-pad="md"><h2 class="card__title">No design folder</h2><p class="pantry-member__role">${e(m.reason ?? "")}</p></div>`;
}

// ── overview ───────────────────────────────────────────────────────────────────────────────────

export function designOverview(p: DesignPayload): string {
  const stat = (n: number, label: string, href: string) => `<a class="stat" href="${href}"><span class="stat__value">${n}</span><span class="stat__label">${label}</span></a>`;
  const failing = p.alignment.filter((r) => !r.ok);
  const rows = p.alignment.map((r) => `<li class="pantry-design__rule" data-ok="${r.ok}"><b>${r.ok ? "ok" : "fail"}</b> ${e(r.label)}<span class="pantry-member__role"> ${e(r.detail)}</span></li>`).join("");
  return shell(p, "/design", "Design", `The planning artifacts for ${e(p.project)}, read from <code>design/</code> and never edited here. The same model is at <a href="/design.json">/design.json</a>.`, `
<section class="dash__kpis pantry-stats">
  ${stat(p.erd?.entities.length ?? 0, "tables", "/design/erd")}
  ${stat(p.dfd?.flows.length ?? 0, "data flows", "/design/dfd")}
  ${stat(p.flows.length, "user flows", "/design/flows")}
  ${stat(p.wireframes.length, "screens", "/design/wireframes")}
  ${stat(p.decisions.length, "decisions", "/design/decisions")}
  ${stat(p.requirements?.length ?? 0, "requirements", "/design/requirements")}
</section>
<section>
  <h2 class="pantry-section-title">Alignment ${failing.length ? `<span class="badge" data-status="blocked">${failing.length} failing</span>` : `<span class="badge" data-status="done">aligned</span>`}</h2>
  <p class="pantry-member__role">The same rows <code>pantry doctor</code> reports.</p>
  <ul class="pantry-design__rules">${rows}</ul>
</section>`);
}

// ── ERD ────────────────────────────────────────────────────────────────────────────────────────

export function erdBody(m: DesignModel, selected?: string): string {
  if (!m.erd) return shell(m, "/design/erd", "ERD", "Entities and relations.", missing("ERD", "erd.yaml"));
  const table = selected ? tableFor(m, selected) : undefined;
  const cards = m.erd.entities.map((ent) => {
    const fks = m.erd!.relations.filter((r) => r.from === ent.id);
    const cols = ent.columns.map((c) => `<li${c.pk ? ` data-pk` : ""}><code>${e(c.name)}</code> <span class="pantry-member__role">${e(c.type ?? "")}${c.nullable ? "?" : ""}</span></li>`).join("");
    return `<a class="card pantry-design__entity" data-pad="sm" id="ent-${e(ent.id)}" href="/design/erd/${encodeURIComponent(ent.id)}"${ent.id === table ? ` aria-current="true"` : ""}>
  <h3 class="card__title">${e(ent.id)}${ent.rls ? ` <span class="pantry-design__chip">RLS</span>` : ""}</h3>
  <ul class="pantry-design__cols">${cols}</ul>
  ${fks.length ? `<p class="pantry-member__role">${fks.map((r) => `→ ${e(r.to)} <small>${e(r.cardinality ?? "")}</small>`).join("<br>")}</p>` : ""}
</a>`;
  }).join("");
  const detail = table ? tableDetail(m, table) : selected ? `<div class="card" data-pad="md"><p>No table, foreign key or rule named <code>${e(selected)}</code>.</p></div>` : `<p class="pantry-member__role">Click a table for its columns, meanings, RLS rules, plans and data flows.</p>`;
  const skipped = m.erd.skipped.length ? `<details class="card" data-pad="sm"><summary>${m.erd.skipped.length} schema statement${m.erd.skipped.length === 1 ? "" : "s"} the generator could not read</summary><ul>${m.erd.skipped.map((s) => `<li><code>${e(s)}</code></li>`).join("")}</ul></details>` : "";
  const enums = m.erd.enums.length ? `<p class="pantry-member__role">Enums: ${m.erd.enums.map((x) => `<code>${e(x.id)}</code> (${e(x.values.join(", "))})`).join("; ")}</p>` : "";
  return shell(m, "/design/erd", "ERD", `Entities and relations, generated from ${e(m.erd.generatedFrom.join(", ") || "supabase/schemas")}.`, `
<div class="pantry-design__split" data-wide>
  ${erdSvg(m, table)}
  <aside class="pantry-design__detail">${detail}</aside>
</div>
<details class="pantry-design__alt"><summary>Tables as a list</summary><div class="pantry-design__grid">${cards}</div></details>
${enums}
${skipped}`);
}

function tableDetail(m: DesignModel, table: string): string {
  const ent = m.erd?.entities.find((x) => x.id === table);
  const dict = m.dictionary?.find((x) => x.id === table);
  const cols = (ent?.columns ?? []).map((c) => `<tr><td><code>${e(c.name)}</code>${c.pk ? " <small>pk</small>" : ""}</td><td>${e(c.type ?? "")}${c.nullable ? " · null" : ""}</td><td>${e(dict?.columns[c.name] ?? "")}</td></tr>`).join("");
  const rls = (dict?.rls ?? []).map((r) => `<li id="rls-${e(r.id)}"><b>${e(r.op ?? "rule")}</b> ${e(r.rule)} ${testBadge(m, r.test)}${r.test ? `<br><small><code>${e(r.test)}</code></small>` : ""}</li>`).join("");
  const fks = (m.erd?.relations ?? []).filter((r) => r.from === table || r.to === table).map((r) =>
    `<li><code>${e(r.id)}</code>: ${e(r.from)}(${e(r.columns.join(", "))}) → <a href="/design/erd/${encodeURIComponent(r.to)}">${e(r.to)}</a>(${e(r.refColumns.join(", "))}) <small>${e(r.cardinality ?? "")}${r.onDelete ? `, on delete ${e(r.onDelete)}` : ""}</small></li>`).join("");
  const plans = plansForTable(m, table).map((p) => `<li>${planLink(p.id, p.title)} <span class="badge" data-status="${e(p.status)}">${e(p.status)}</span></li>`).join("");
  const flows = flowsForTable(m, table).map((f) => `<li><a href="/design/dfd/${encodeURIComponent(f.id)}">${e(f.label ?? f.id)}</a>${crossesRegion(m, f) ? ` <span class="pantry-design__chip" data-cross>crosses region</span>` : ""}</li>`).join("");
  return `<div class="card pantry-design__panel" data-pad="md" data-table="${e(table)}">
  <h2 class="card__title">${e(table)}</h2>
  ${dict?.meaning ? `<p>${e(dict.meaning)}</p>` : `<p class="pantry-member__role">No dictionary entry for this table.</p>`}
  <table class="pantry-design__table"><thead><tr><th>Column</th><th>Type</th><th>Meaning</th></tr></thead><tbody>${cols}</tbody></table>
  <h3>Relations</h3>${fks ? `<ul>${fks}</ul>` : `<p class="pantry-member__role">None.</p>`}
  <h3>RLS rules</h3>${rls ? `<ul class="pantry-design__rls">${rls}</ul>` : `<p class="pantry-member__role">None recorded.</p>`}
  <h3>Plans</h3>${plans ? `<ul>${plans}</ul>` : `<p class="pantry-member__role">No plan cites this table.</p>`}
  <h3>Data flows</h3>${flows ? `<ul>${flows}</ul>` : `<p class="pantry-member__role">No DFD flow carries this table.</p>`}
</div>`;
}

// ── DFD ────────────────────────────────────────────────────────────────────────────────────────

export function dfdBody(m: DesignModel, selected?: string): string {
  if (!m.dfd) return shell(m, "/design/dfd", "Data flow", "Processes, stores, externals and trust boundaries.", missing("DFD", "dfd.yaml"));
  const d = m.dfd;
  const node = (id: string) => { const n = d.nodes.find((x) => x.id === id); return n ? `<span class="pantry-design__node" data-kind="${n.kind}">${e(n.label)}</span>` : `<code>${e(id)}</code>`; };
  const loose = d.nodes.filter((n) => !n.boundary);
  const group = (label: string, region: string | undefined, ids: string[], id?: string) =>
    `<section class="card pantry-design__boundary" data-pad="sm"${id ? ` id="b-${e(id)}"` : ""}><h3 class="card__title">${e(label)}${region ? ` <span class="pantry-design__chip">${e(region)}</span>` : ""}</h3><div>${ids.map(node).join(" ")}</div></section>`;
  const boundaries = d.boundaries.map((b) => group(b.label, b.region, b.members, b.id)).join("") + (loose.length ? group("Outside any boundary", undefined, loose.map((n) => n.id)) : "");
  const flowRow = (f: DfdFlow) => `<tr${f.id === selected ? ` aria-current="true"` : ""}${crossesRegion(m, f) ? " data-cross" : ""}><td><a href="/design/dfd/${encodeURIComponent(f.id)}">${e(f.label ?? f.id)}</a></td><td>${node(f.from)} → ${node(f.to)}</td><td>${e(f.region ?? "")}${crossesRegion(m, f) ? ` <span class="pantry-design__chip" data-cross>crosses region</span>` : ""}</td></tr>`;
  const f = selected ? d.flows.find((x) => x.id === selected) : undefined;
  const detail = f ? `<div class="card pantry-design__panel" data-pad="md" data-flow="${e(f.id)}">
  <h2 class="card__title">${e(f.label ?? f.id)}</h2>
  <p>${node(f.from)} → ${node(f.to)}${crossesRegion(m, f) ? ` <span class="pantry-design__chip" data-cross>crosses a region boundary</span>` : ""}</p>
  <dl class="proof-facts">
    <div class="proof-facts__row"><dt>Data</dt><dd>${f.data.map((x) => x.includes("#") ? refLink(x) : e(x)).join(", ") || "—"}</dd></div>
    <div class="proof-facts__row"><dt>Region</dt><dd>${e(f.region ?? "—")}</dd></div>
    <div class="proof-facts__row"><dt>Retention</dt><dd>${e(f.retention ?? "—")}</dd></div>
    <div class="proof-facts__row"><dt>Purpose</dt><dd>${e(f.purpose ?? "—")}</dd></div>
  </dl>
  ${plansFor(m, `dfd#${f.id}`).map((p) => planLink(p.id, p.title)).join(", ")}
</div>` : selected ? `<div class="card" data-pad="md"><p>No flow named <code>${e(selected)}</code>.</p></div>` : `<p class="pantry-member__role">Click a flow for its data, region, retention and purpose. Rows marked as crossing a region carry data between regions.</p>`;
  return shell(m, "/design/dfd", "Data flow", "Processes, stores, externals and trust boundaries, with every flow between them.", `
${dfdSvg(m, selected)}
<details class="pantry-design__alt"><summary>Boundaries as a list</summary><div class="pantry-design__boundaries">${boundaries}</div></details>
<div class="pantry-design__split">
  <table class="pantry-design__table"><thead><tr><th>Flow</th><th>From → to</th><th>Region</th></tr></thead><tbody>${d.flows.map(flowRow).join("")}</tbody></table>
  <aside class="pantry-design__detail">${detail}</aside>
</div>`);
}

// ── architecture ───────────────────────────────────────────────────────────────────────────────

export function architectureBody(m: DesignModel): string {
  if (!m.architecture) return shell(m, "/design/architecture", "Architecture", "C4 levels 1 and 2.", missing("architecture", "architecture.yaml"));
  const sys = m.architecture.context.nodes.find((n) => n.kind === "system")?.label;
  const level = (title: string, l: ArchLevel) => `<section>
  <h2 class="pantry-section-title">${title}</h2>
  ${c4Svg(l, title === "Context" ? "context" : "containers", sys)}
  <details class="pantry-design__alt"><summary>${title} as a list</summary>
  <div class="pantry-design__grid">${l.nodes.map((n) => `<div class="card" data-pad="sm" id="${e(n.id)}"><h3 class="card__title">${e(n.label)} <span class="pantry-design__chip">${e(n.kind)}</span></h3>${n.tech ? `<p class="pantry-member__role">${e(n.tech)}</p>` : ""}${n.description ? `<p>${e(n.description)}</p>` : ""}</div>`).join("")}</div>
  <ul>${l.relations.map((r) => `<li><a href="#${e(r.from)}">${e(r.from)}</a> → <a href="#${e(r.to)}">${e(r.to)}</a> ${e(r.label ?? "")}</li>`).join("")}</ul>
  </details>
</section>`;
  return shell(m, "/design/architecture", "Architecture", "C4 levels 1 and 2: the system in its context, then its containers.", level("Context", m.architecture.context) + level("Containers", m.architecture.containers));
}

// ── user flows ─────────────────────────────────────────────────────────────────────────────────

export function flowsIndex(m: DesignModel): string {
  if (!m.flows.length) return shell(m, "/design/flows", "User flows", "Steps a person takes.", missing("user flows", "flows/<id>.yaml"));
  return shell(m, "/design/flows", "User flows", "Each flow's steps; a step opens its screen and shows its test.", `<ul class="pantry-design__list">${m.flows.map((f) => `<li><a href="/design/flows/${encodeURIComponent(f.id)}">${e(f.title)}</a> <span class="pantry-member__role">${f.steps.length} steps</span></li>`).join("")}</ul>`);
}

export function flowBody(m: DesignModel, id: string): string | null {
  const f = m.flows.find((x) => x.id === id);
  if (!f) return null;
  const steps = f.steps.map((s) => `<li class="card pantry-design__step" data-pad="sm" data-kind="${e(s.kind)}" id="step-${e(s.id)}" data-label="${e(s.label)}"${s.screen ? ` data-screen="${e(s.screen)}"` : ""}>
  <p><span class="pantry-design__chip">${e(s.kind)}</span> <b>${e(s.label)}</b></p>
  <p>${s.screen ? `<a href="/design/wireframes/${encodeURIComponent(s.screen)}" data-step-screen="${e(s.screen)}">Open screen ${e(s.screen)}</a>` : `<span class="pantry-member__role">no screen</span>`} ${testBadge(m, s.test)}</p>
  ${s.next.length ? `<p class="pantry-member__role">next: ${s.next.map((n) => `<a href="#step-${e(n)}">${e(n)}</a>`).join(", ")}</p>` : ""}
</li>`).join("");
  const plans = plansFor(m, `flows/${f.id}`);
  return shell(m, "/design/flows", f.title, `User flow <code>flows/${e(f.id)}</code>.${plans.length ? ` Plans: ${plans.map((p) => planLink(p.id, p.title)).join(", ")}.` : ""}`, `<div class="pantry-design__split">
  ${flowSvg(m, f)}
  <aside class="pantry-design__detail pantry-design__preview">
    <p class="pantry-member__role" data-step-caption>Click a step to preview its screen.</p>
    <iframe class="pantry-design__frame" title="Screen for the selected step" sandbox="allow-scripts" data-step-preview hidden></iframe>
    <p class="pantry-member__role" data-step-empty hidden>This step has no screen.</p>
  </aside>
</div>
<details class="pantry-design__alt" open><summary>Steps, screens and tests</summary><ol class="pantry-design__steps">${steps}</ol></details>`);
}

// ── wireframes ─────────────────────────────────────────────────────────────────────────────────

export function wireframesIndex(m: DesignModel): string {
  if (!m.wireframes.length) return shell(m, "/design/wireframes", "Wireframes", "Clickable low-fidelity screens.", missing("wireframes", "wireframes/<id>.html"));
  return shell(m, "/design/wireframes", "Wireframes", "Clickable low-fidelity screens.", `<ul class="pantry-design__list">${m.wireframes.map((w) => `<li><a href="/design/wireframes/${encodeURIComponent(w)}">${e(w)}</a></li>`).join("")}</ul>`);
}

export function wireframeBody(m: DesignModel, id: string): string | null {
  if (!m.wireframes.includes(id)) return null;
  const usedBy = m.flows.flatMap((f) => f.steps.filter((s) => s.screen === id).map((s) => `<a href="/design/flows/${encodeURIComponent(f.id)}#step-${encodeURIComponent(s.id)}">${e(f.title)}: ${e(s.label)}</a> ${testBadge(m, s.test)}`));
  const others = m.wireframes.map((w) => `<a href="/design/wireframes/${encodeURIComponent(w)}"${w === id ? ` aria-current="page"` : ""}>${e(w)}</a>`).join(" · ");
  return shell(m, "/design/wireframes", `Screen: ${id}`, `Screens: ${others}`, `
<iframe class="pantry-design__frame" title="Wireframe ${e(id)}" src="/design/wireframe-raw/${encodeURIComponent(id)}" sandbox="allow-scripts" data-screen-frame></iframe>
<p class="pantry-member__role">${usedBy.length ? `Used by ${usedBy.join("; ")}` : "No user flow step opens this screen."}</p>
<script>
  // The frame is sandboxed without same-origin, so it cannot touch this page; it posts the screen a
  // data-screen link names, and this page moves to it.
  addEventListener("message", (ev) => {
    const f = document.querySelector("[data-screen-frame]");
    if (!f || ev.source !== f.contentWindow || !ev.data || typeof ev.data.screen !== "string") return;
    location.href = "/design/wireframes/" + encodeURIComponent(ev.data.screen);
  });
</script>`);
}

/** The shim injected into a wireframe: a click on [data-screen] posts the screen to the parent. */
export const WIREFRAME_SHIM = `<script>document.addEventListener("click",function(e){var t=e.target&&e.target.closest&&e.target.closest("[data-screen]");if(!t)return;e.preventDefault();parent.postMessage({screen:t.getAttribute("data-screen")},"*");});</script>`;

export function wireframeRaw(html: string): string {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${WIREFRAME_SHIM}</body>`) : html + WIREFRAME_SHIM;
}

// ── decisions ──────────────────────────────────────────────────────────────────────────────────

export function decisionsBody(m: DesignModel): string {
  if (!m.decisions.length) return shell(m, "/design/decisions", "Decisions", "ADRs.", missing("decisions", "decisions/NNN-<slug>.md"));
  const rows = m.decisions.map((d) => {
    const plans = plansFor(m, `decisions/${d.file}`);
    return `<tr id="adr-${e(d.file)}" data-status="${e(d.status)}"><td><code>${e(d.id)}</code></td><td>${e(d.title)}</td><td><span class="badge" data-status="${d.status === "accepted" ? "done" : d.status === "superseded" ? "blocked" : "todo"}">${e(d.status)}</span>${d.supersededBy ? ` by <a href="#adr-${e(d.supersededBy)}">${e(d.supersededBy)}</a>` : ""}</td><td>${plans.map((p) => planLink(p.id)).join(", ")}</td></tr>`;
  }).join("");
  return shell(m, "/design/decisions", "Decisions", "Architecture decision records, with their status and the plans that cite them.",
    `<table class="pantry-design__table"><thead><tr><th>Id</th><th>Decision</th><th>Status</th><th>Cited by</th></tr></thead><tbody>${rows}</tbody></table>`);
}

// ── traceability ───────────────────────────────────────────────────────────────────────────────

export function requirementsBody(m: DesignModel): string {
  if (!m.requirements) return shell(m, "/design/requirements", "Traceability", "Requirements against tests.", missing("requirements", "requirements.yaml"));
  const tests = [...new Set(m.requirements.flatMap((r) => r.tests))];
  const head = tests.map((t, i) => `<th title="${e(t)}"><abbr title="${e(t)}">T${i + 1}</abbr></th>`).join("");
  const rows = m.requirements.map((r) => {
    const cells = tests.map((t) => r.tests.includes(t) ? `<td data-test="${m.tests[t] ?? "unrun"}" title="${e(t)}: ${TEST_LABEL[m.tests[t] ?? "unrun"]}">${CELL_MARK[m.tests[t] ?? "unrun"]}</td>` : `<td></td>`).join("");
    const gap = r.tests.length === 0;
    return `<tr id="req-${e(r.id)}"${gap ? " data-gap" : ""}><th scope="row"><a href="#req-${e(r.id)}">${e(r.id)}</a></th><td>${e(r.text)}${r.plan ? `<br><small>${planLink(r.plan)}</small>` : ""}${r.artifacts.length ? `<br><small>${r.artifacts.map(refLink).join(" ")}</small>` : ""}</td>${gap ? `<td colspan="${Math.max(tests.length, 1)}" data-gap><a href="${r.plan ? `/plans/plan/${encodeURIComponent(r.plan)}` : `#req-${e(r.id)}`}">no test: open ${r.plan ? `plan ${e(r.plan)}` : "this requirement"}</a></td>` : cells}</tr>`;
  }).join("");
  const key = tests.map((t, i) => `<li><b>T${i + 1}</b> <code>${e(t)}</code> ${testBadge(m, t)}</li>`).join("");
  return shell(m, "/design/requirements", "Traceability", `Each requirement against the tests that prove it. ● passes, ✕ fails, ○ has no result, ? names a test file that does not exist${m.resultsAvailable ? "" : " (no design/test-results.json, so nothing is judged yet)"}. A gap links to the plan that owes the test.`, `
<table class="pantry-design__table pantry-design__matrix"><thead><tr><th>Req</th><th>Text</th>${head || "<th>Tests</th>"}</tr></thead><tbody>${rows}</tbody></table>
<ol class="pantry-design__list">${key}</ol>`);
}

// ── plan cards ─────────────────────────────────────────────────────────────────────────────────

/** Add the artifacts each plan's `design` field names to the board's cards and the plan page. The
 *  card is itself a link, so its chips are plain text; the plan page gets real links. */
export function annotateDesign(html: string, m: DesignModel): string {
  let out = html;
  for (const p of m.plans) {
    if (!p.design.length) continue;
    const id = p.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const chips = `<ul class="proof-card__touches pantry-design__cardrefs">${p.design.map((d) => `<li class="proof-card__chip" data-design-ref="${e(d)}">${e(d)}</li>`).join("")}</ul>`;
    out = out.replace(new RegExp(`(<a class="card proof-card"[^>]*href="/plan/${id}">[\\s\\S]*?)(</a>)`), `$1${chips}$2`);
  }
  return out;
}

export function annotatePlanPage(html: string, m: DesignModel, planId: string): string {
  const p = m.plans.find((x) => x.id === planId);
  if (!p?.design.length) return html;
  const row = `<div class="proof-facts__row" data-design><dt>Design</dt><dd>${p.design.map(refLink).join(", ")}</dd></div>`;
  return html.replace(/(<dl class="proof-facts">[\s\S]*?)(<\/dl>)/, `$1${row}$2`);
}
