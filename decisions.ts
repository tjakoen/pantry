// pantry/decisions.ts — piece 11d: the decision inbox, DATA layer (the view is in app.ts, same split
// as map.ts / mapBody). The cross-repo loop (portfolio LOOP.md §4) routes an agent's open decisions
// through PANTRY instead of chat: the agent writes a decision-request as a markdown file, PANTRY
// renders it read-only at /decisions, and the human resolves it by generating a prompt (click the
// options + notes → a prompt the human pastes back into chat → the AGENT records the resolution and
// marks the file resolved). PANTRY writes NOTHING here — it runs no model and it is not the write path;
// the generated prompt is. This module is pure reads: it parses the files, it never mutates them.
//
// A decision-request file (plans/decisions/<id>.md) uses the same tiny frontmatter MILL already parses
// (scalars + dash-lists — no nested objects, so options are plain strings and evidence is "label |
// href"):
//
//   ---
//   title: Which datastore for the run ledger?
//   status: open                       # open | resolved (default open)
//   options:
//     - Postgres — durable, needs a running service
//     - SQLite — zero-ops, single-writer
//   recommendation: SQLite — zero-ops, single-writer   # optional; should match an option
//   evidence:
//     - PLAN.md piece 11c | /docs/plans/pantry         # "label | href"; href optional
//     - drift.ts drift fold-in                          # label only is fine
//   ---
//   Free markdown body: the context an owner needs to decide. Rendered at the detail view.
//
// The file doubles as a ledger entry (LOOP.md §4): status: resolved + the recorded reasoning IS the
// record that the decision was made and why.
import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { parseFrontmatter } from "@tjakoen/mill/core/frontmatter.ts";
import type { ResolvedPantryConfig } from "./config.ts";

export type DecisionStatus = "open" | "resolved";

export interface DecisionEvidence {
  label: string;
  /** an in-cockpit path (/docs/…, /plans/…) or an external URL; omitted when the entry is label-only */
  href?: string;
}

export interface DecisionRequest {
  /** the filename without .md — the /decisions/<id> route key */
  id: string;
  title: string;
  status: DecisionStatus;
  options: string[];
  /** the agent's recommended option, verbatim; absent when the file offers none */
  recommendation?: string;
  evidence: DecisionEvidence[];
  /** the raw markdown body (frontmatter stripped) — rendered to HTML by the view, kept raw here so
   *  the data layer stays render-free and testable */
  body: string;
  /** absolute path, so a generated prompt can name the exact file to mark resolved */
  file: string;
}

export interface DecisionsPayload {
  /** the decisions dir exists (the list may still be empty — that is the healthy zero-open state) */
  available: boolean;
  project: string;
  /** absolute decisions dir, echoed so the empty-state view can tell the human where to write files */
  dir: string;
  /** open first (what needs the human), then resolved (the ledger tail); each group id-sorted */
  decisions: DecisionRequest[];
  /** counts for the index header + the machine twin */
  openCount: number;
  resolvedCount: number;
  generatedAt: string;
}

// A frontmatter value may be a string, a string[], or absent — normalise to string[]. Mirrors the
// grain adapter's own asArray (a single scalar counts as a one-item list).
function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.trim() !== "");
  if (typeof v === "string" && v.trim() !== "") return [v];
  return [];
}

// An evidence href is safe to render as a link only if it points in-cockpit (root/relative/anchor) or
// over http(s). Decision files are COMMITTED under plans/, so a contributor's file could carry a
// `javascript:`/`data:` href the owner then clicks on the localhost surface — reject those at the data
// layer (drop to label-only) rather than trust attribute-escaping alone to contain them.
function safeHref(href: string): boolean {
  if (/^(\/|\.\/|\.\.\/|#)/.test(href)) return true;         // in-cockpit path or anchor
  return /^https?:\/\//i.test(href);                          // absolute web URL
}

// Split an evidence entry on the FIRST "|" into label + href. No pipe → label only. An unsafe-scheme
// href is dropped (kept as a label) so a decision file can never inject a javascript:/data: link.
function parseEvidence(raw: string): DecisionEvidence {
  const idx = raw.indexOf("|");
  if (idx === -1) return { label: raw.trim() };
  const label = raw.slice(0, idx).trim();
  const href = raw.slice(idx + 1).trim();
  if (!href) return { label };
  if (!safeHref(href)) return { label: label || href };      // unsafe scheme → no link
  return { label: label || href, href };
}

// First ATX heading in the body, used as the title when frontmatter has none (same fallback MILL uses).
function firstHeading(body: string): string | null {
  for (const line of body.split(/\r\n?|\n/)) {
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) return m[1].trim();
  }
  return null;
}

function parseDecision(id: string, file: string, raw: string): DecisionRequest {
  const { data, body } = parseFrontmatter(raw);
  const status: DecisionStatus = String(data.status ?? "").toLowerCase() === "resolved" ? "resolved" : "open";
  const title = (typeof data.title === "string" && data.title.trim()) || firstHeading(body) || id;
  const recommendation = typeof data.recommendation === "string" && data.recommendation.trim()
    ? data.recommendation.trim()
    : undefined;
  return {
    id,
    title,
    status,
    options: asArray(data.options),
    recommendation,
    evidence: asArray(data.evidence).map(parseEvidence),
    body,
    file,
  };
}

/**
 * Read + parse every decision-request in the host's decisions dir. Pure reads; no writes, no model.
 * Open decisions sort first (what the human owes an answer), resolved after (the ledger tail); within
 * each group, id-sorted for a stable order. An absent dir yields available:false + an empty list, so
 * the surface degrades to guidance instead of crashing — the same posture as /map with no graphify-out.
 */
export async function buildDecisionsPayload(
  config: Pick<ResolvedPantryConfig, "projectName" | "decisionsDir">,
  generatedAt: string,
): Promise<DecisionsPayload> {
  const dir = config.decisionsDir;
  const base = {
    project: config.projectName,
    dir,
    decisions: [] as DecisionRequest[],
    openCount: 0,
    resolvedCount: 0,
    generatedAt,
  };
  if (!existsSync(dir)) return { ...base, available: false };

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { ...base, available: false };
  }

  const decisions: DecisionRequest[] = [];
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    // README.md in a decisions/ dir is documentation-about-the-dir, not a decision — skip it.
    if (name.toLowerCase() === "readme.md") continue;
    const id = basename(name, ".md");
    const file = join(dir, name);
    try {
      decisions.push(parseDecision(id, file, await Bun.file(file).text()));
    } catch {
      // an unreadable / malformed file must not take the whole surface down — skip it
      continue;
    }
  }

  const rank = (s: DecisionStatus) => (s === "open" ? 0 : 1);
  decisions.sort((a, b) => rank(a.status) - rank(b.status) || a.id.localeCompare(b.id));

  return {
    ...base,
    available: true,
    decisions,
    openCount: decisions.filter((d) => d.status === "open").length,
    resolvedCount: decisions.filter((d) => d.status === "resolved").length,
  };
}
