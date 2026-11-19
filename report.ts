// pantry/report.ts: the report page, /report on the hub. What happened across every project in a
// period, what is wrong with evidence, and what the owner has to decide.
//
// On 19 November a session built this page by hand: it read five repositories' git logs, ran the
// gates, graded every note and published the result. The owner liked the page, and it was stale the
// moment it went up. This builds the same shape from what PANTRY already holds, on demand.
//
// Two rules keep it from becoming a flood. A finding is rendered only when it carries evidence (a
// file, a gate result, a commit) and an action; one without both is dropped. And gate results come
// from runs already recorded under artifacts/runs, never from a run this page starts, with the age
// of each said out loud: a report that ran the gates itself would take minutes and spend tokens.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml as e } from "@tjakoen/mill/core/engine.ts";
import type { BriefPayload } from "./brief.ts";
import type { RunsPayload } from "./runs.ts";
import { STYLESHEETS, themeSwitch, themeSyncTag } from "./chrome.ts";
import { WHERE_MIN_N, type WhereReport } from "./where.ts";

export type Severity = "high" | "medium" | "low";
export interface Finding { severity: Severity; project: string; title: string; evidence: string; action: string }
export interface NoteRow { project: string; slug: string; title: string; status: string; date: string; words: number; figures: number; social: boolean; issue: string }
export interface Decision {
  project: string;
  kind: string;
  title: string;
  detail: string;
  href: string;
  /** plan ids this item holds up */
  holds?: string[];
  recommendation?: string | null;
  /** days since the item's file last changed, filled by the hub where git can tell */
  days?: number | null;
  /** the item's file, repo-relative, for the hub to date */
  file?: string | null;
  /** the registry entries it appears under, when several point into one repository */
  projects?: string[];
}
export interface ProjectReport {
  name: string;
  url: string;
  commits: number;
  /** commits in the period whose subject marks a fix or a revert, read from the gitmoji or the word */
  fixes: number;
  reverts: number;
  /** files written outside every in-flight plan's touches */
  outOfScope: number;
  subjects: string[];
  closed: { title: string; changed: string; remember: string }[];
  lastRun: { id: string; date: string | null; gates: number; failed: number } | null;
}
export interface Report {
  since: string;
  until: string;
  projects: ProjectReport[];
  findings: Finding[];
  decide: Decision[];
  notes: NoteRow[];
  paused: number;
  down: string[];
  where?: WhereReport;
  /** the owner's side: mechanical findings, the latest agent review, and the prompt that asks for one */
  yourSide?: Finding[];
  review?: { text: string; at: string } | null;
  reviewPrompt?: string;
}

/** What the report reads from one project. Any piece may be missing; the report says so. */
export interface ProjectInput {
  name: string;
  path: string;
  url: string;
  brief: BriefPayload | null;
  runs: RunsPayload | null;
  log: string[];
}

const DAY = 86_400_000;
export const isFix = (subject: string) => /^(🐛|🚑|🩹)|^\W*(fix|hotfix)\b/i.test(subject);
export const isRevert = (subject: string) => /^(⏪)|^\W*revert\b/i.test(subject);
export const DRAFT_PILE = 5;
export const DRAFT_STALE_DAYS = 14;

/** Read one project's notes, if it keeps them in content/notes. Only the frontmatter and counts. */
export function readNotes(project: string, path: string): Omit<NoteRow, "issue">[] {
  const dir = join(path, "content", "notes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
    const raw = readFileSync(join(dir, f), "utf8");
    const fm = /^---\n([\s\S]*?)\n---/.exec(raw)?.[1] ?? "";
    const get = (k: string) => new RegExp(`^${k}:\\s*["']?(.*?)["']?\\s*$`, "m").exec(fm)?.[1] ?? "";
    const body = raw.slice(fm.length + 8);
    return {
      project,
      slug: f.slice(0, -3),
      title: get("title") || f.slice(0, -3),
      status: (get("status") || "DRAFT").toUpperCase(),
      date: get("date").slice(0, 10),
      words: body.split(/\s+/).filter(Boolean).length,
      figures: (body.match(/<svg|<figure|```mermaid|!\[/g) ?? []).length,
      social: /^#{2,3} .*(share|social)/im.test(body) || /^social:/m.test(fm),
    };
  });
}

/** Grade the notes and add the findings they earn. */
export function gradeNotes(notes: Omit<NoteRow, "issue">[], since: number, now: number, findings: Finding[]): NoteRow[] {
  const rows = notes.map((n) => {
    const issues: string[] = [];
    const draft = n.status === "DRAFT";
    if (draft && !n.figures) issues.push("no figure");
    if (draft && !n.social) issues.push("no social copy");
    if (draft && n.date && now - Date.parse(n.date) > DRAFT_STALE_DAYS * DAY) issues.push(`draft for ${Math.round((now - Date.parse(n.date)) / DAY)} days`);
    return { ...n, issue: issues.join("; ") };
  });
  for (const n of rows) {
    if (n.status === "DRAFT" && !n.figures) findings.push({ severity: "medium", project: n.project, title: `${n.title} has no figure`, evidence: `content/notes/${n.slug}.md`, action: "Add the figure NOTE-STANDARD requires before it can publish." });
  }
  const fresh = rows.filter((n) => n.status === "DRAFT" && n.date && Date.parse(n.date) >= since);
  const byProject = new Map<string, NoteRow[]>();
  for (const n of fresh) byProject.set(n.project, [...(byProject.get(n.project) ?? []), n]);
  for (const [project, xs] of byProject) {
    if (xs.length >= DRAFT_PILE) findings.push({ severity: "high", project, title: `${xs.length} drafts started in this period`, evidence: xs.map((x) => x.slug).join(", "), action: "Pick the two or three to finish and park or fold the rest." });
  }
  return rows;
}

export function buildReport(inputs: ProjectInput[], since: string, now = Date.now()): Report {
  const sinceMs = Date.parse(since);
  const findings: Finding[] = [];
  const decide: Decision[] = [];
  const projects: ProjectReport[] = [];
  const notes: NoteRow[] = [];
  const down: string[] = [];
  let paused = 0;
  for (const p of inputs) {
    const b = p.brief;
    if (!b) { down.push(p.name); continue; }
    const base = p.url.replace(/\/$/, "");
    for (const w of b.waiting) {
      const link = w.actions.find((a) => a.kind === "link" && a.value.startsWith("/"));
      const holds = /(?:holds|Holds) (.+?)\.?$/.exec(w.detail)?.[1].split(/,\s*/).filter(Boolean) ?? [];
      decide.push({ project: p.name, kind: w.kind, title: w.title, detail: w.detail, href: base + (link?.value ?? "/"), holds, recommendation: w.decision?.recommendation ?? null, file: w.decision?.file ?? (w.kind === "decision" ? null : `plans/${w.id}.md`), projects: [p.name] });
    }
    paused += (b.paused ?? []).length;
    // The doctor's checks are one finding per project, not one each: listed singly they were most of
    // a fifty-five-line report, and each one's fix is already a button in the command center.
    const errs = b.drift.filter((d) => d.severity === "error"), warns = b.drift.filter((d) => d.severity === "warn");
    // A project that did not move in the period keeps its warnings, but low: nothing is at stake there yet.
    for (const [xs, sev] of [[errs, "high"], [warns, "medium"]] as const) {
      const severity: Severity = p.log.length ? sev : "low";
      if (xs.length) findings.push({ severity, project: p.name, title: `${xs.length} health check(s) ${sev === "high" ? "failing" : "warning"}`, evidence: xs.map((d) => d.label).join(", "), action: `Open ${p.name}'s command center, where each check carries its fix.` });
    }
    for (const r of b.inFlight) {
      if (r.outOfScope.length) findings.push({ severity: "medium", project: p.name, title: r.planId ? `Writes outside ${r.title}` : "Writes that belong to no plan", evidence: r.outOfScope.slice(0, 3).join(", ") + (r.outOfScope.length > 3 ? ` and ${r.outOfScope.length - 3} more` : ""), action: "Widen the plan's touches, or move the work to a plan that covers it." });
    }
    const stale = b.inFlight.filter((r) => r.planId && r.status === "doing" && !r.claim);
    if (stale.length) findings.push({ severity: "low", project: p.name, title: `${stale.length} plan(s) marked doing with no session holding them`, evidence: stale.slice(0, 4).map((r) => r.planId).join(", ") + (stale.length > 4 ? `, and ${stale.length - 4} more` : ""), action: "Return each to todo, or claim it." });
    const runs = (p.runs?.runs ?? []).filter((r) => r.date).toSorted((a, c) => (c.date ?? "").localeCompare(a.date ?? ""));
    const last = runs[0];
    const failed = last ? last.gates.filter((g) => /\bfail|error|red\b/i.test(g.detail ?? "") && !/\b0 fail/i.test(g.detail ?? "")).length : 0;
    // A failed gate on a project nobody touched this period is history, not news.
    if (last && failed && p.log.length) findings.push({ severity: "high", project: p.name, title: `${failed} gate(s) failed in the last recorded run`, evidence: `artifacts/runs/${last.id}.md, ${last.date}`, action: "Read the run report and fix or carry the failure by name." });
    if (last && Date.parse(last.date!) < sinceMs && p.log.length) findings.push({ severity: "low", project: p.name, title: "No run recorded for this period's commits", evidence: `${p.log.length} commit(s) since ${since}; last run ${last.date}`, action: "Close the next session with a run report, so its gates are on record." });
    projects.push({
      name: p.name,
      url: p.url,
      commits: p.log.length,
      fixes: p.log.filter(isFix).length,
      reverts: p.log.filter(isRevert).length,
      outOfScope: b.inFlight.reduce((n, r) => n + r.outOfScope.length, 0),
      subjects: p.log.slice(0, 5),
      closed: (b.learned ?? []).filter((l) => Date.parse(l.explainer.at) >= sinceMs).map((l) => ({ title: l.title, changed: l.explainer.changed, remember: l.explainer.remember })),
      lastRun: last ? { id: last.id, date: last.date ?? null, gates: last.gates.length, failed } : null,
    });
    notes.push(...gradeNotes(readNotes(p.name, p.path), sinceMs, now, findings));
  }
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return {
    since,
    until: new Date(now).toISOString().slice(0, 10),
    projects: projects.filter((x) => x.commits || x.closed.length).toSorted((a, c) => c.commits - a.commits),
    findings: findings.filter((f) => f.evidence.trim() && f.action.trim()).toSorted((a, c) => order[a.severity] - order[c.severity]),
    decide: decideQueue(decide),
    notes,
    paused,
    down,
  };
}

/** One row per item, however many registry entries show it, ranked by what it holds up and then by
 *  how long it has waited. Ranking by what it holds is the point: answering the top row frees the most. */
export function decideQueue(ds: Decision[]): Decision[] {
  const m = new Map<string, Decision>();
  for (const d of ds) {
    const k = `${d.kind}\u0000${d.title}`;
    const had = m.get(k);
    if (!had) { m.set(k, { ...d, projects: [...(d.projects ?? [d.project])], holds: [...(d.holds ?? [])] }); continue; }
    had.projects = [...new Set([...(had.projects ?? []), ...(d.projects ?? [d.project])])];
    had.holds = [...new Set([...(had.holds ?? []), ...(d.holds ?? [])])];
    if (d.days != null && (had.days == null || d.days > had.days)) had.days = d.days;
  }
  const rank = (d: Decision) => (d.kind === "decision" ? 0 : d.kind === "human-plan" ? 1 : 2);
  return [...m.values()].toSorted((a, b) => (b.holds?.length ?? 0) - (a.holds?.length ?? 0) || (b.days ?? -1) - (a.days ?? -1) || rank(a) - rank(b));
}

export const DECIDE_VERB: Record<string, { verb: string; button: string; ask: string }> = {
  decision: { verb: "Answer", button: "Answer", ask: "A question only you can answer." },
  "human-plan": { verb: "Do", button: "Open plan", ask: "Your plan; agent work waits on it." },
  "blocked-plan": { verb: "Unblock", button: "Open plan", ask: "Marked blocked with no reason recorded. Say what it waits on, or unblock it." },
};

/** The same report as Markdown, for a note or a message. */
export function reportMarkdown(r: Report): string {
  const out = [`# Report, ${r.since} to ${r.until}`, ""];
  out.push(`${r.projects.reduce((n, p) => n + p.commits, 0)} commits across ${r.projects.length} projects. ${r.decide.length} item(s) wait on you; ${r.findings.length} finding(s).`, "");
  if (r.findings.length) {
    out.push("## Findings", "");
    for (const f of r.findings) out.push(`- **${f.severity}** · ${f.project} · ${f.title}. Evidence: ${f.evidence}. Action: ${f.action}`);
    out.push("");
  }
  for (const p of r.projects) {
    out.push(`## ${p.name}`, "", `${p.commits} commit(s).${p.lastRun ? ` Last recorded run: ${p.lastRun.id} (${p.lastRun.date}).` : " No recorded run."}`, "");
    for (const s of p.subjects) out.push(`- ${s}`);
    for (const c of p.closed) out.push(`- Closed: ${c.title}. ${c.changed} Remember: ${c.remember}`);
    out.push("");
  }
  if (r.decide.length) {
    out.push("## What to decide", "");
    r.decide.forEach((d, i) => out.push(`${i + 1}. ${d.project}: ${d.title}. ${d.detail}`));
  }
  return out.join("\n").trim() + "\n";
}

const hrs = (ms: number) => ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3_600_000).toFixed(1)}h`;

// The page is GRAIN's dashboards layer and nothing of its own: a dash with a strip of stat tiles and
// a grid of dash-panels, rank lists for shares, a bullet graph for gates. Every panel carries a
// data-surface address, so an agent reading the page can point at a panel by name.
const panel = (id: string, title: string, body: string, opts: { span?: "2" | "full"; meta?: string; note?: string } = {}) =>
  `<section class="dash-panel" id="${id}" data-surface="panel:${id}"${opts.span ? ` data-span="${opts.span}"` : ""}>
<header class="dash-panel__head"><h3 class="dash-panel__title">${e(title)}${opts.meta ? ` <span class="hub-meta">${e(opts.meta)}</span>` : ""}</h3></header>
${opts.note ? `<p class="dash-panel__note">${e(opts.note)}</p>` : ""}${body}</section>`;

/** A rank list. Below WHERE_MIN_N the bars are left off, so a share of a handful is never drawn. */
const rank = (rows: { name: string; value: string; share: number }[], n: number) =>
  `<ol class="rank-list">${rows.map((r) => `<li class="rank-list__row"${n >= WHERE_MIN_N ? ` style="--share: ${r.share.toFixed(3)}"` : ""}><span class="rank-list__name">${e(r.name)}</span><span class="rank-list__value">${e(r.value)}</span></li>`).join("")}</ol>`;

/** Where the work ran: harness, machine and model as rank lists, time as stat tiles, then tokens and handovers. */
export function whereSection(w: WhereReport | undefined): string {
  if (!w || !w.segments) return "";
  const few = w.segments < WHERE_MIN_N;
  const by = (rows: WhereReport["byTool"]) => rank(rows.map((r) => ({ name: r.key, value: few ? `${r.sessions} session(s)` : `${hrs(r.activeMs)}, ${r.sessions} session(s)`, share: w.activeMs ? r.activeMs / w.activeMs : 0 })), w.segments);
  const n = `n = ${w.segments}`;
  const note = few ? `Shares are hidden below ${WHERE_MIN_N} stretches.` : undefined;
  const time = `<div class="dash__kpis"><div class="stat"><span class="stat__value">${hrs(w.activeMs)}</span><span class="stat__label">held by a session</span></div><div class="stat"><span class="stat__value">${hrs(w.waitingMs)}</span><span class="stat__label">between stretches</span></div><div class="stat"${w.stalledMs ? ` data-tone="warn"` : ""}><span class="stat__value">${hrs(w.stalledMs)}</span><span class="stat__label">after a usage limit</span></div></div>`;
  const tok = rank(w.tokens.map((t) => ({ name: t.tool, value: t.tokens === null ? (t.tool === "claude" ? "on each Usage page" : "not readable") : `${t.tokens.toLocaleString("en")} over ${t.sessions} session(s)`, share: 0 })), 0);
  const landed = w.handovers.filter((h) => h.landed).length;
  const hand = w.handovers.length ? `<ul class="rp-list">${w.handovers.slice(0, 8).map((h) => `<li><span class="hub-item__project">${e(h.project)}</span> ${e(h.planId)}: ${e(h.from)} to ${e(h.to)} after ${hrs(h.gapMs)}${h.landed ? ", finished later" : ", not finished yet"}</li>`).join("")}</ul>` : `<p class="cc-empty">No plan moved between machines or harnesses in this period.</p>`;
  return [
    panel("where-time", "Time on plans", time, { meta: n, note: "Read from the claims logs on this machine. A stretch is one session holding one plan." }),
    panel("where-harness", "By harness", by(w.byTool), { meta: n, note }),
    panel("where-machine", "By machine", by(w.byMachine), { meta: n, note }),
    panel("where-model", "By model", by(w.byModel), { meta: n, note }),
    panel("where-tokens", "Tokens", tok, { note: "Codex totals come from its session logs; a harness that writes none shows as not readable." }),
    panel("where-handovers", "Handovers", hand, { meta: `${w.handovers.length}${w.handovers.length ? `, ${landed} finished later` : ""}` }),
  ].join("\n");
}

/** The owner's side. The agent's review is shown as text it wrote, apart from the mechanical findings. */
export function yourSideSection(r: Report, card: (f: Finding) => string): string {
  if (!r.yourSide && !r.reviewPrompt) return "";
  const fs = r.yourSide ?? [];
  const low = fs.filter((f) => f.severity === "low");
  const list = fs.length ? `<ul class="rp-findings">${fs.filter((f) => f.severity !== "low").toSorted((a, b) => (a.severity === "high" ? -1 : 0) - (b.severity === "high" ? -1 : 0)).map(card).join("")}${low.length ? `<details class="rp-low-group"><summary>${low.length} low finding(s)</summary>${low.map(card).join("")}</details>` : ""}</ul>` : `<p class="cc-empty">Nothing waits on you past its threshold.</p>`;
  const review = r.review ? `<details class="rp-review"><summary>An agent's reading, written ${e(r.review.at.slice(0, 10))}</summary><pre>${e(r.review.text)}</pre></details>` : `<p class="hub-meta">No agent has reviewed your side yet.</p>`;
  const prompt = r.reviewPrompt ? `<p><button type="button" data-copy-review>Copy the review prompt</button></p><textarea id="rp-review-prompt" hidden>${e(r.reviewPrompt)}</textarea>` : "";
  return panel("your-side", "Your side", list + review + prompt, { span: "full", meta: String(fs.length), note: "Where the owner is the bottleneck or left something behind. Each line recommends; none of them acts." });
}

/** Quality, measured and never guessed: per project fixes and gates, per harness outcomes. */
export function qualitySection(r: Report): string {
  const ps = r.projects.filter((p) => p.commits);
  const outs = r.where?.outcomes ?? [];
  if (!ps.length && !outs.length) return "";
  const rate = (k: number, n: number) => (n < WHERE_MIN_N ? `${k}` : `${k} (${Math.round((100 * k) / n)}%)`);
  const rows = ps.map((p) => {
    const g = p.lastRun?.gates ? `<div class="bullet" role="img" aria-label="${p.lastRun.gates - p.lastRun.failed} of ${p.lastRun.gates} gates passed" style="--value: ${((p.lastRun.gates - p.lastRun.failed) / p.lastRun.gates).toFixed(2)}; --target: 1; --poor: 0.5; --fair: 0.9"><span class="bullet__bar"></span><span class="bullet__target"></span></div>` : `<span class="hub-meta">${p.lastRun ? "no gates recorded" : "no run"}</span>`;
    return `<tr><td>${e(p.name)}</td><td>${p.commits}</td><td>${rate(p.fixes, p.commits)}</td><td>${rate(p.reverts, p.commits)}</td><td>${p.outOfScope}</td><td>${g}</td></tr>`;
  }).join("");
  const done = outs.reduce((n, x) => n + x.done, 0);
  const orow = outs.map((x) => `<tr><td>${e(x.key)}</td><td>${x.done}</td><td>${x.released}</td><td>${rate(x.reopened, x.done)}</td></tr>`).join("");
  return [
    ps.length ? panel("quality-projects", "Quality by project", `<table class="rp-table"><thead><tr><th>Project</th><th>Commits</th><th>Fixes</th><th>Reverts</th><th>Off-plan writes</th><th>Last run gates</th></tr></thead><tbody>${rows}</tbody></table>`, { span: "2", meta: `n = ${ps.reduce((n, p) => n + p.commits, 0)} commits`, note: `Fixes and reverts are read from the commit subject. Percentages show from ${WHERE_MIN_N} commits up.` }) : "",
    outs.length ? panel("quality-harness", "Outcomes by harness", `<table class="rp-table"><thead><tr><th>Harness</th><th>Done</th><th>Handed back</th><th>Reopened</th></tr></thead><tbody>${orow}</tbody></table>`, { meta: `n = ${done} plans done`, note: "Reopened means a later session claimed a plan another had called done." }) : "",
  ].join("\n");
}

const SEV_CLASS: Record<Severity, string> = { high: "rp-high", medium: "rp-med", low: "rp-low" };

export function reportPage(r: Report, styleBase: string): string {
  const links = styleBase ? STYLESHEETS.map((h) => `<link rel="stylesheet" href="${e(styleBase + h)}">`).join("\n  ") : "";
  const commits = r.projects.reduce((n, p) => n + p.commits, 0);
  const high = r.findings.filter((f) => f.severity === "high").length;
  const drafts = r.notes.filter((n) => n.status === "DRAFT").length;
  const tile = (n: number, label: string, href: string, tone?: "warn" | "bad") => `<a class="stat" href="${href}" data-surface="stat:${href.slice(1)}"${tone && n ? ` data-tone="${tone}"` : ""}><span class="stat__value">${n}</span><span class="stat__label">${e(label)}</span></a>`;
  const card = (f: Finding) => `<li class="rp-finding ${SEV_CLASS[f.severity]}"><p><span class="rp-sev">${f.severity}</span> <span class="hub-item__project">${e(f.project)}</span> <b>${e(f.title)}</b></p><p class="rp-ev">Evidence: ${e(f.evidence)}</p><p class="rp-act">${e(f.action)}</p></li>`;
  const top = r.findings.filter((f) => f.severity !== "low").map(card).join("");
  const low = r.findings.filter((f) => f.severity === "low");
  const findings = top + (low.length ? `<details class="rp-low-group"><summary>${low.length} low finding(s)</summary>${low.map(card).join("")}</details>` : "");
  const moved = rank(r.projects.map((p) => ({ name: p.name, value: `${p.commits} commit(s)${p.closed.length ? `, ${p.closed.length} closed` : ""}`, share: commits ? p.commits / commits : 0 })), commits);
  const sections = r.projects.map((p) => `<details class="rp-project"><summary><a href="${e(p.url)}">${e(p.name)}</a> <span class="hub-meta">${p.commits} commit(s)${p.lastRun ? `, last run ${e(p.lastRun.id)}` : ", no run recorded"}</span></summary>
${p.subjects.length ? `<ul>${p.subjects.map((s) => `<li>${e(s)}</li>`).join("")}</ul>` : ""}
${p.closed.length ? `<ul class="rp-closed">${p.closed.map((c) => `<li><b>Closed: ${e(c.title)}.</b> ${e(c.changed)} <span class="hub-meta">Remember: ${e(c.remember)}</span></li>`).join("")}</ul>` : ""}</details>`).join("");
  const noteRows = r.notes.toSorted((a, c) => c.date.localeCompare(a.date)).map((n) => `<tr><td>${e(n.title)}</td><td>${e(n.status.toLowerCase())}</td><td>${e(n.date)}</td><td>${n.words.toLocaleString("en")}</td><td>${n.figures}</td><td>${n.social ? "yes" : "no"}</td><td>${e(n.issue || "none")}</td></tr>`).join("");
  const row = (d: Decision) => {
    const v = DECIDE_VERB[d.kind] ?? { verb: "Look", button: "Open", ask: "" };
    const meta = [d.days != null ? `waiting ${d.days} day(s)` : "", d.holds?.length ? `holds ${d.holds.length} plan(s): ${d.holds.slice(0, 4).join(", ")}${d.holds.length > 4 ? ", and more" : ""}` : "nothing waits on it"].filter(Boolean).join(" · ");
    return `<li class="rp-decide__row" data-surface="decide:${e(d.kind)}"><span class="rp-sev">${e(v.verb)}</span><div class="rp-decide__body"><p><b>${e(d.title)}</b> <span class="hub-item__project">${e((d.projects ?? [d.project]).join(", "))}</span></p><p class="hub-meta">${e(meta)}</p><p class="rp-act">${d.recommendation ? `Recommended: ${e(d.recommendation)}` : e(v.ask)}</p></div><a class="btn" data-size="sm" href="${e(d.href)}">${e(v.button)}</a></li>`;
  };
  const first = r.decide.slice(0, 5), rest = r.decide.slice(5);
  const decide = first.length ? `<ol class="rp-decide">${first.map(row).join("")}</ol>${rest.length ? `<details class="rp-low-group"><summary>${rest.length} more, holding less</summary><ol class="rp-decide" start="6">${rest.map(row).join("")}</ol></details>` : ""}` : "";
  const md = reportMarkdown(r);
  return `<!DOCTYPE html>
<html lang="en" data-themes="sourdough baguette brioche">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Report · PANTRY</title>
  ${styleBase ? `<script src="${e(styleBase)}/scripts/theme-boot.js"></script>` : ""}
  ${links}
  ${themeSyncTag()}
</head>
<body class="pantry-body" data-grade="smooth">
<nav class="pantry-nav hub-nav"><a class="pantry-nav__brand" href="/">PANTRY</a><span class="hub-nav__links"><span class="hub-meta">Report</span>${themeSwitch()}</span></nav>
<main class="pantry-main">
<div class="dash" data-surface="dashboard:report">
  <header class="dash__head">
    <h2 class="dash__title">Report</h2>
    <p class="dash__period">${e(r.since)} to ${e(r.until)}. Built from each project's command center, its recorded runs, its git log and its notes. Nothing here was run to make it.</p>
    <form class="rp-period" method="get" action="/report">
      <a href="/report?days=7">Last 7 days</a> <a href="/report?days=30">Last 30 days</a>
      <label>Since <input type="date" name="since" value="${e(r.since)}"></label> <button type="submit">Show</button>
      <button type="button" data-copy-md>Copy as Markdown</button>
    </form>
  </header>
  <div class="dash__kpis">${tile(r.decide.length, "waiting on you", "#decide", "warn")}${tile(high, "high findings", "#findings", "bad")}${tile(r.yourSide?.length ?? 0, "on your side", "#your-side", "warn")}${tile(r.paused, "paused on a limit", "#where-time", "warn")}${tile(commits, "commits", "#projects")}${tile(drafts, "draft notes", "#notes")}</div>
  ${r.down.length ? `<p class="hub-stale">Not read, because their PANTRY did not answer: ${r.down.map(e).join(", ")}.</p>` : ""}
  <div class="dash__grid">
  ${panel("decide", "What to decide", decide || `<p class="cc-empty">Nothing is waiting on you.</p>`, { span: "full", meta: String(r.decide.length), note: "Ranked by how many plans each one holds, then by how long it has waited. The top row frees the most work." })}
  ${yourSideSection(r, card)}
  ${panel("findings", "Findings", findings ? `<ul class="rp-findings">${findings}</ul>` : `<p class="cc-empty">No finding with evidence and an action in this period.</p>`, { span: "full", meta: String(r.findings.length) })}
  ${whereSection(r.where)}
  ${qualitySection(r)}
  ${panel("projects", "By project", r.projects.length ? moved + sections : `<p class="cc-empty">No commits or closed plans in this period.</p>`, { span: "2", meta: `${r.projects.length} moved` })}
  ${r.notes.length ? panel("notes", "Notes", `<table class="rp-table"><thead><tr><th>Note</th><th>Status</th><th>Date</th><th>Words</th><th>Figures</th><th>Social</th><th>Issue</th></tr></thead><tbody>${noteRows}</tbody></table>`, { span: "full", meta: String(r.notes.length) }) : ""}
  </div>
</div>
<textarea id="rp-md" hidden>${e(md)}</textarea>
</main>
<script>document.querySelector("[data-copy-review]")?.addEventListener("click", (ev) => { const b = ev.currentTarget; navigator.clipboard?.writeText(document.getElementById("rp-review-prompt").value).then(() => { b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy the review prompt"; }, 1500); }).catch(() => {}); });
document.querySelector("[data-copy-md]")?.addEventListener("click", (ev) => { const b = ev.currentTarget; navigator.clipboard?.writeText(document.getElementById("rp-md").value).then(() => { b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy as Markdown"; }, 1500); }).catch(() => {}); });</script>
${styleBase ? `<script src="${e(styleBase)}/scripts/theme.js" defer></script>` : ""}
</body>
</html>`;
}

/** The start of the period from the query: ?since=YYYY-MM-DD, or ?days=N, or the last seven days. */
export function periodStart(params: URLSearchParams, now = Date.now()): string {
  const since = params.get("since");
  if (since && /^\d{4}-\d{2}-\d{2}$/.test(since) && !Number.isNaN(Date.parse(since))) return since;
  const days = Math.min(Math.max(Number(params.get("days")) || 7, 1), 365);
  return new Date(now - days * DAY).toISOString().slice(0, 10);
}
