// pantry/runs.ts — piece 11c: the RUN LEDGER, DATA layer (the view lives in app.ts, same split as
// map.ts / decisions.ts / artifacts.ts). LOOP.md §4a says a run closes with a report carrying gate
// output verbatim, the diffstat, what was not done and what needs human eyes; LOOP.md §9 turns that
// prose contract into a nine-item checklist. This module is the checklist made parseable: it reads the
// reports a run deposits under `artifacts/runs/`, and reports which §9 items each one is missing.
//
// PANTRY writes NOTHING here and runs NO model. Every judgement below is a key lookup, a heading
// match, or a string prefix compare — the report is written by the agent, and only rendered and
// checked here. That is the same read-only posture as the decision inbox.
//
// A run report (artifacts/runs/<id>.md) uses the frontmatter subset MILL already parses (scalars +
// dash-lists — no nested objects, so a list entry that needs two fields uses the "label | detail"
// pipe convention decisions.ts established for evidence):
//
//   ---
//   title: Pin the run-ledger schema
//   date: 2026-08-07
//   status: complete                    # complete | partial | blocked (default complete)
//   lane: gated                         # LOOP §4b: high | gated | human (optional, unknown = absent)
//   branch: main
//   scope:                              # the declared envelope (LOOP §4b scope cap)
//     - runs.ts
//     - doctor.ts
//   touched:                            # what the run actually touched
//     - runs.ts
//   skills:                             # which skills fired during the run
//     - loop-standard
//   plans:                              # plan items claimed | optional href
//     - skills-runtime | /plans/skills-runtime
//   gates:                              # "command | result"; the OUTPUT goes in the body, verbatim
//     - bun test | 132 pass, 0 fail
//   diffstat: 4 files changed, 210 insertions(+), 3 deletions(-)
//   dirty:                              # touched but deliberately left uncommitted | why
//     - PLAN.md | lands with the next commit
//   unpushed: 2 | push is owner-gated
//   verifiedBy: reviewer subagent that did not write the change
//   doctor: 0 failing, 1 carried: e2e-presence
//   ---
//   ## Gate output
//   ```
//   <pasted verbatim — never summarized, never compressed>
//   ```
//   ## What was not done
//   ## What needs human eyes
//
// **Gate output is never compressed.** LOOP.md §4a demands verbatim; a lossy pass over machine output
// mangled a date in testing (`2026-07-30` → `2026:7:30`), so summarizing or compressing gate output
// into a report is out, not discouraged.
import { readdir, realpath } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { parseFrontmatter } from "@tjakoen/mill/core/frontmatter.ts";
import { linkContained } from "./paths.ts";
import type { ResolvedPantryConfig } from "./config.ts";

export type RunStatus = "complete" | "partial" | "blocked";

/**
 * LOOP §4b's three lanes, recorded rather than computed. The lane is a property of the CHANGE (does
 * it touch an irreversible path, does a gate exist that would catch it going wrong), so it is decided
 * before the work and written into the report afterwards — which is what makes it evidence instead of
 * a claim made in chat and forgotten.
 *
 * PANTRY does not classify: it reads the word the run wrote, the same read-only posture as every other
 * field here. Computing a lane suggestion from the ledger is deliberately a later question, because a
 * number produced before the classification is settled is a number nobody trusts.
 */
export type RunLane = "high" | "gated" | "human";

const LANES: readonly string[] = ["high", "gated", "human"];

/** A "label | detail" frontmatter entry: a gate + its result, a dirty file + why, a plan + its href. */
export interface RunPair {
  label: string;
  detail?: string;
}

/** One LOOP §9 item a report does not satisfy. `id` is stable for machines, `label` is for humans. */
export interface EvidenceGap {
  id: string;
  label: string;
}

export interface RunReport {
  /** the filename without .md — the /runs/<id> route key */
  id: string;
  title: string;
  status: RunStatus;
  /**
   * the LOOP §4b lane this change was run in, absent when the report does not declare one. A value
   * that is not one of the three reads as absent: there is no safe default here, and picking "high"
   * for a typo is exactly the widening §4b forbids.
   */
  lane?: RunLane;
  /** the run's close date, verbatim from frontmatter (YYYY-MM-DD); absent when the file omits it */
  date?: string;
  branch?: string;
  /** the declared envelope (LOOP §4b) — paths or areas this run was allowed to touch */
  scope: string[];
  /** what the run actually touched */
  touched: string[];
  /** touched but deliberately left uncommitted, each with its reason */
  dirty: RunPair[];
  /** which skills fired */
  skills: string[];
  /** plan items claimed, "id | href" */
  plans: RunPair[];
  /** each gate run, "command | result"; the verbatim output lives in the body */
  gates: RunPair[];
  diffstat?: string;
  /** "N | reason" — the count of unpushed commits and why they are unpushed */
  unpushed?: RunPair;
  /** who did the second pass; §2 requires someone who did not write the change */
  verifiedBy?: string;
  /** the doctor line: what failed, what is carried forward by name */
  doctor?: string;
  /** touched entries falling outside every declared scope entry (LOOP §4b growth, measured) */
  outOfScope: string[];
  /** the LOOP §9 items this report does not carry — empty means the report is complete evidence */
  gaps: EvidenceGap[];
  /** raw markdown body (frontmatter stripped), rendered by the view */
  body: string;
  /** absolute path, so a check can name the exact file to fix */
  file: string;
}

export interface RunsPayload {
  /** the runs dir exists (the list may still be empty — a repo that has not closed a run yet) */
  available: boolean;
  project: string;
  /** absolute runs dir, echoed so the empty-state view can say where to write reports */
  dir: string;
  /** newest date first, then id — what a human just closed is what they came to look at */
  runs: RunReport[];
  count: number;
  /** reports carrying at least one §9 gap */
  incompleteCount: number;
  generatedAt: string;
}

// ── frontmatter helpers (shared shape with decisions.ts) ────────────────────

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.trim() !== "");
  if (typeof v === "string" && v.trim() !== "") return [v];
  return [];
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : undefined;
}

/** Split a frontmatter entry on the FIRST "|" into label + detail. No pipe → label only. */
function parsePair(raw: string): RunPair {
  const idx = raw.indexOf("|");
  if (idx === -1) return { label: raw.trim() };
  const label = raw.slice(0, idx).trim();
  const detail = raw.slice(idx + 1).trim();
  return detail ? { label, detail } : { label };
}

// A `plans:` detail is a HREF, not free text, and run reports are committed markdown on a surface the
// owner clicks — the same threat decisions.ts's safeHref closes for its evidence links. Only in-cockpit
// paths, anchors and http(s) URLs may keep their link; anything else (javascript:, data:) drops to a
// label. Enforced HERE at the data layer rather than at the view, so the guard cannot be forgotten by
// whichever surface renders these first (S3c has not landed one yet — this closes the hole before it
// can open, instead of after).
function safeHref(href: string): boolean {
  if (/^(\/|\.\/|\.\.\/|#)/.test(href)) return true; // in-cockpit path or anchor
  return /^https?:\/\//i.test(href); // absolute web URL
}

/** A "label | href" entry, with an unsafe-scheme href dropped to label-only. */
function parseLinkPair(raw: string): RunPair {
  const pair = parsePair(raw);
  if (pair.detail && !safeHref(pair.detail)) return { label: pair.label || pair.detail };
  return pair;
}

// ── heading scanning, fence-aware ───────────────────────────────────────────

// A run report's whole point is that it pastes gate output verbatim, and real gate output is full of
// lines that start with "#": shell comments, log prefixes, commented commands. Scanning for headings
// line-by-line would read `# bun test` INSIDE a fenced block as an H1 and cut the Gate output section
// off before its own closing fence — turning the most correct possible report into a reported gap. So
// the scan tracks fenced state the way a markdown parser does and only sees headings outside it.
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Heading positions outside any fenced block: [line index, level, text]. */
function* headings(lines: string[]): Generator<[number, number, string]> {
  let fence: string | null = null; // the open fence's marker, e.g. "```"
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(FENCE);
    if (fence) {
      // Closed only by a run of the SAME character at least as long as the opener (CommonMark), so a
      // ``` inside a ```` block does not end it early.
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && lines[i].slice(lines[i].indexOf(f[1]) + f[1].length).trim() === "") fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    // 0-3 leading spaces is still an ATX heading (CommonMark), and the FENCE pattern above already
    // tolerates the same indent — a heading matcher stricter than the fence matcher beside it would
    // silently lose a section over one stray space.
    const m = lines[i].match(/^ {0,3}(#{1,6})\s+(.*)$/);
    if (m) yield [i, m[1].length, m[2].trim()];
  }
}

function firstHeading(body: string): string | null {
  for (const [, , text] of headings(body.split(/\r\n?|\n/))) return text;
  return null;
}

// ── body sections (the three LOOP §4a prose obligations) ────────────────────

// Headings are matched loosely — lowercased, punctuation and decoration stripped, and matched by
// PREFIX rather than equality — because a report is hand-written prose and a check that fails on a
// trailing colon, or on "What was not done yet", teaches nobody anything. Prefix matching is the
// deliberate choice: "gates run" and "gate output verbatim" are both plainly the section they name,
// and a heading that merely starts the same way is not a different section in practice.
const normalizeHeading = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const matchesAlias = (heading: string, aliases: readonly string[]): boolean => {
  const h = normalizeHeading(heading);
  return aliases.some((a) => h === a || h.startsWith(a + " "));
};

const SECTION_ALIASES = {
  gateOutput: ["gate output", "gate results", "gates", "gate evidence"],
  notDone: ["what was not done", "not done", "what i did not do", "what was left"],
  humanEyes: ["what needs human eyes", "needs human eyes", "for human eyes", "what needs a human"],
} as const;

/**
 * The text under the first heading matching one of `aliases`, up to the next heading of the same or a
 * higher level. Returns null when no such heading exists — absent and empty are different failures,
 * and the check distinguishes them.
 */
function sectionBody(body: string, aliases: readonly string[]): string | null {
  const lines = body.split(/\r\n?|\n/);
  let start = -1;
  let level = 0;
  for (const [i, lvl, text] of headings(lines)) {
    if (start === -1) {
      if (!matchesAlias(text, aliases)) continue;
      start = i + 1;
      level = lvl;
      continue;
    }
    if (lvl <= level) return lines.slice(start, i).join("\n");
  }
  return start === -1 ? null : lines.slice(start).join("\n");
}

/**
 * A fenced block with at least one non-blank line inside it — the shape "verbatim" takes on the page.
 * Fence-aware for the same reason the heading scan is: gate output is pasted machine text, and a
 * report that wraps a block containing ``` in a longer ```` fence is correct markdown, not a gap.
 */
function hasVerbatimBlock(section: string): boolean {
  const lines = section.split(/\r\n?|\n/);
  let fence: string | null = null;
  let content = "";
  for (const line of lines) {
    const f = line.match(FENCE);
    if (!fence) {
      if (f) fence = f[1];
      continue;
    }
    if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.slice(line.indexOf(f[1]) + f[1].length).trim() === "") {
      if (content.trim() !== "") return true;
      fence = null;
      content = "";
      continue;
    }
    content += line + "\n";
  }
  // An UNCLOSED fence does not count: a report whose gate block was never closed is a report whose
  // evidence was cut off, and saying so is more useful than guessing where it ended.
  return false;
}

// ── scope growth (LOOP §4b, made measurable) ────────────────────────────────

// A touched path is inside the envelope when it equals a declared scope entry or sits under one. Both
// sides are normalised first, because a report is hand-written and the same file gets spelled several
// ways by the same person in one sitting: "./runs.ts", "/runs.ts" and "runs.ts" all mean one file, a
// trailing slash on a dir means nothing, and this runs on a case-insensitive filesystem where "Src"
// and "src" ARE the same directory. Each of those spellings would otherwise raise a false
// scope-growth warn, and a check that cries wolf is a check nobody reads.
const normalizePath = (p: string) => p.trim().toLowerCase().replace(/^(\.\/|\/)+/, "").replace(/\/+$/, "").replace(/^\.$/, "");

function outOfScopePaths(scope: string[], touched: string[]): string[] {
  if (scope.length === 0) return []; // no declared envelope → the scope gap fires instead, not this
  const declared = scope.map(normalizePath);
  // "." is the natural way to write "the whole repo is in scope", and it normalises to the empty
  // string here. Left unhandled it would match NOTHING and flag every touched file as growth, which
  // is the exact inversion of what the author wrote.
  if (declared.some((s) => s === "")) return [];
  return touched
    .map(normalizePath)
    .filter(Boolean)
    .filter((t) => !declared.some((s) => t === s || t.startsWith(s + "/")));
}

// ── the LOOP §9 checklist, as a function ────────────────────────────────────

/**
 * Which of LOOP.md §9's nine items this report does not carry. Pure and exported, so the doctor check
 * and any future surface read the SAME list rather than each re-deriving it. Mechanical throughout:
 * this reports what evidence is ABSENT. Whether present evidence is honest is a human's read, and §9
 * is deliberately shaped so that most of the lying would have to be explicit.
 */
export function evidenceGaps(report: Omit<RunReport, "gaps">): EvidenceGap[] {
  const gaps: EvidenceGap[] = [];
  const gateSection = sectionBody(report.body, SECTION_ALIASES.gateOutput);
  const notDone = sectionBody(report.body, SECTION_ALIASES.notDone);
  const humanEyes = sectionBody(report.body, SECTION_ALIASES.humanEyes);

  if (gateSection === null) gaps.push({ id: "gate-output", label: "no 'Gate output' section" });
  else if (!hasVerbatimBlock(gateSection)) gaps.push({ id: "gate-output", label: "gate output is not a verbatim fenced block" });

  if (!report.diffstat) gaps.push({ id: "diffstat", label: "no diffstat" });
  if (notDone === null || notDone.trim() === "") gaps.push({ id: "not-done", label: "'What was not done' missing or empty" });
  if (humanEyes === null || humanEyes.trim() === "") gaps.push({ id: "human-eyes", label: "'What needs human eyes' missing or empty" });
  if (report.touched.length === 0) gaps.push({ id: "touched", label: "no touched: list — files are unaccounted for" });
  if (!report.unpushed) gaps.push({ id: "unpushed", label: "no unpushed: count (write 0 when there are none)" });
  // §9 asks for a COUNT, so a count is what the check requires: "some" or "a few" is the hedge the
  // item exists to prevent, and it would otherwise score as complete evidence.
  else if (!/^\d+$/.test(report.unpushed.label)) gaps.push({ id: "unpushed", label: `unpushed: "${report.unpushed.label}" is not a count — write the number` });
  else if (report.unpushed.label !== "0" && !report.unpushed.detail) gaps.push({ id: "unpushed", label: "unpushed commits counted with no reason given" });
  if (!report.verifiedBy) gaps.push({ id: "verified-by", label: "no verifiedBy: — §2 wants a pass by someone who did not write it" });
  if (report.scope.length === 0) gaps.push({ id: "scope", label: "no scope: — the declared envelope (§4b) is missing" });
  else if (report.outOfScope.length > 0) gaps.push({ id: "scope-growth", label: `touched outside the declared scope: ${report.outOfScope.join(", ")}` });
  if (!report.doctor) gaps.push({ id: "doctor", label: "no doctor: line — flags fixed or carried by name" });

  return gaps;
}

function parseRun(id: string, file: string, raw: string): RunReport {
  const { data, body } = parseFrontmatter(raw);
  const rawStatus = String(data.status ?? "").toLowerCase();
  const status: RunStatus = rawStatus === "partial" || rawStatus === "blocked" ? rawStatus : "complete";
  const rawLane = (str(data.lane) ?? "").toLowerCase();
  const lane = LANES.includes(rawLane) ? (rawLane as RunLane) : undefined;
  const scope = asArray(data.scope);
  const touched = asArray(data.touched);
  const partial: Omit<RunReport, "gaps"> = {
    id,
    title: str(data.title) || firstHeading(body) || id,
    status,
    lane,
    date: str(data.date),
    branch: str(data.branch),
    scope,
    touched,
    dirty: asArray(data.dirty).map(parsePair),
    skills: asArray(data.skills),
    plans: asArray(data.plans).map(parseLinkPair),
    gates: asArray(data.gates).map(parsePair),
    diffstat: str(data.diffstat),
    unpushed: str(data.unpushed) !== undefined ? parsePair(str(data.unpushed)!) : undefined,
    verifiedBy: str(data.verifiedBy),
    doctor: str(data.doctor),
    outOfScope: outOfScopePaths(scope, touched),
    body,
    file,
  };
  return { ...partial, gaps: evidenceGaps(partial) };
}

/**
 * Read + parse every run report in the host's runs dir. Pure reads; no writes, no model. Newest first
 * (by the `date:` the run declared, then by id, so undated reports sort last but still appear). An
 * absent dir yields available:false + an empty list — a repo that has never closed a run under this
 * convention is not broken, it is unstarted, and the surface degrades to guidance rather than crashing.
 */
export async function buildRunsPayload(
  config: Pick<ResolvedPantryConfig, "projectName" | "runsDir">,
  generatedAt: string,
): Promise<RunsPayload> {
  const dir = config.runsDir;
  const base = {
    project: config.projectName,
    dir,
    runs: [] as RunReport[],
    count: 0,
    incompleteCount: 0,
    generatedAt,
  };
  if (!existsSync(dir)) return { ...base, available: false };

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { ...base, available: false };
  }

  // Resolve the real (symlink-expanded) runs dir up front — the containment check below compares each
  // symlinked entry's real target against this, so it must itself be canonical.
  let realBase: string;
  try {
    realBase = await realpath(dir);
  } catch {
    return { ...base, available: false };
  }

  const runs: RunReport[] = [];
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    // README.md here is documentation-about-the-dir (the schema), not a run — skip it, same rule the
    // decision inbox applies to its own folder.
    if (name.toLowerCase() === "readme.md") continue;
    const id = basename(name, ".md");
    const file = join(dir, name);
    // SECURITY: a report is only read when it is not a symlink, or is one whose real target stays
    // under the runs dir — `linkContained` in paths.ts, the same rule artifacts.ts enforces on its
    // walk. The stakes are higher here: this module reads file CONTENTS into `body`, which a surface
    // will render, so an escaping link (artifacts/runs/x.md -> ~/.ssh/id_rsa) would be an
    // exfiltration path through the cockpit, not just a metadata leak. Closed before any view exists
    // to exploit it.
    if (!(await linkContained(realBase, file))) continue;
    try {
      runs.push(parseRun(id, file, await Bun.file(file).text()));
    } catch {
      // an unreadable / malformed file must not take the whole surface down — skip it
      continue;
    }
  }

  // Newest declared date first; undated reports sort after every dated one rather than to the top,
  // where a missing field would otherwise read as "just now".
  runs.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));

  return {
    ...base,
    available: true,
    runs,
    count: runs.length,
    incompleteCount: runs.filter((r) => r.gaps.length > 0).length,
  };
}
