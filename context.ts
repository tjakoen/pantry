// pantry/context.ts — what a session in this repo pays before it does any work.
//
// Every session opens by loading the same set of files whether or not the task needs them: the repo's
// CLAUDE.md and anything it imports, the agent's memory index, and the machine-wide front door under
// the harness config dir. That total is a real, recurring cost — it is charged once per session, it
// grows by accretion, and nothing in the estate measured it. The portfolio measured it by hand on
// 2026-08-05 (14,163 characters), trimmed the memory index, and then watched it climb back to 24,243
// by 2026-08-17 without anyone noticing, which is the whole argument for a check rather than a habit.
//
// Same posture as the rest of PANTRY: no model, no writes, no network. Reads files, counts bytes,
// reports facts. Which total is too large is doctor.ts's business, and what the line is belongs to
// the host (see DEFAULT_CONTEXT_BUDGET) — a budget is an opinion and a byte count is not.
//
// Characters, not tokens. A tokenizer would be a dependency, a version to track and a per-model
// answer, and the check does not need that precision to do its job: cold-start cost is compared
// against itself over time, and roughly four characters to the token is enough for a person reading
// the number to know what it means. Anything the count is wrong by, it is wrong by consistently.
// Strictly it is bytes, since it reads stat sizes rather than decoding: 177 of 19,693 in the
// portfolio on 2026-08-18, all of it non-ASCII punctuation, which is under a tenth of a percent.
//
// WHAT THIS DELIBERATELY DOES NOT COUNT, verified 2026-08-18. A session also loads whatever the
// harness injects at SessionStart, which in the portfolio came to 4,221 characters across three
// hooks, plus the skills listing and the tool schemas. Those are real cost and none of them is the
// repo's to fix, so folding them in would turn this row red on a machine-wide bill a session cannot
// pay down, which is how a check gets muted. This measures the front door a repo owns. It is a trend
// line for the part that can be acted on, not the whole of what a session pays, and the budget below
// is set against that narrower thing.
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, dirname } from "node:path";

/** One file a cold session loads, and what it costs. */
export interface ContextEntry {
  /** an absolute path, or the label the reader will recognise it by */
  label: string;
  /** the file's size in characters */
  chars: number;
  /** which of the three sources it came from, so a report can say where the weight sits */
  source: "repo" | "memory" | "machine";
}

/** The measured cold start: every file, biggest first, and the total. */
export interface ContextReading {
  entries: ContextEntry[];
  chars: number;
  /** true when nothing could be read at all — no CLAUDE.md, no memory, no machine front door */
  empty: boolean;
}

export interface ContextOptions {
  /** the harness config dir holding CLAUDE.md and projects/; default ~/.claude */
  configDir?: string;
  /** injected for tests; default os.homedir() */
  home?: string;
}

/**
 * The estate-wide budget, in characters.
 *
 * **An owner decision as of 2026-08-18, not a measurement.** It is derived from what the portfolio
 * has actually carried: 14,163 characters on 2026-08-05 read as comfortable, and 24,243 on
 * 2026-08-17 read as bloated to the person who found it. 20,000 sits between them, roughly 5,000
 * tokens, and it is deliberately set where the repo it was written in passes rather than fails — a
 * check that is red the day it ships gets muted inside a week (LOOP.md §7), and this one has no debt
 * to work off, only a ceiling to stay under. It shipped as a first guess and went to the owner as
 * plans/decisions/2026-08-17-context-budget.md, which came back as option A: keep it, and treat it
 * as agreed. That file also records what this budget is deliberately not about.
 *
 * Still a number to retune once a second repo has been measured, not a law. Set
 * `contextBudgetChars` in pantry.config to move it per host, or to null to mute the check where a
 * large front door is the deliberate choice.
 */
export const DEFAULT_CONTEXT_BUDGET = 20_000;

// Claude Code's import syntax is a bare @path. This matches one at a line start or after whitespace,
// which is conservative on purpose: an address like name@example.com never matches because of the
// leading word character, and anything that does match but does not resolve on disk contributes
// nothing. A false positive here costs a stat, never a wrong number.
const IMPORT = /(?:^|\s)@([./\w-]+\.md)\b/g;

async function sizeOf(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

/**
 * Follow a file's @-imports, depth first, counting each file once. Cycles terminate on the seen set
 * rather than on a depth limit: two files importing each other is a config mistake, not a reason for
 * the measurement to hang or to guess.
 */
async function walk(path: string, source: ContextEntry["source"], seen: Set<string>, out: ContextEntry[]): Promise<void> {
  const abs = resolve(path);
  if (seen.has(abs)) return;
  seen.add(abs);
  const chars = await sizeOf(abs);
  if (chars === null) return;
  out.push({ label: abs, chars, source });

  let body: string;
  try {
    body = await readFile(abs, "utf8");
  } catch {
    return;
  }
  for (const m of body.matchAll(IMPORT)) {
    const ref = m[1];
    await walk(isAbsolute(ref) ? ref : join(dirname(abs), ref), source, seen, out);
  }
}

/**
 * Where the agent's memory for a project lives. Claude Code names the directory after the project
 * path with every non-alphanumeric character replaced by a dash, so the mapping is reproducible from
 * cwd alone and needs no lookup. Documented rather than discovered: the same rule is what lets a
 * session find its own transcript.
 */
export function memoryIndexPath(cwd: string, configDir: string): string {
  return join(configDir, "projects", resolve(cwd).replace(/[^a-zA-Z0-9]/g, "-"), "memory", "MEMORY.md");
}

/**
 * Measure the cold start for a repo.
 *
 * Three sources, and the split is what makes the number actionable. **repo** is the front door this
 * repo owns and can fix. **memory** is the agent's index for this project, which is the one that
 * grows quietly because no commit in this repo touches it. **machine** is the harness front door
 * every repo on the box pays, so a session reading the report knows that share is not this repo's
 * fault and should not be fixed here.
 */
export async function readContext(cwd: string, opts: ContextOptions = {}): Promise<ContextReading> {
  const configDir = opts.configDir ?? join(opts.home ?? homedir(), ".claude");
  const entries: ContextEntry[] = [];
  const seen = new Set<string>();

  await walk(join(cwd, "CLAUDE.md"), "repo", seen, entries);
  await walk(memoryIndexPath(cwd, configDir), "memory", seen, entries);
  await walk(join(configDir, "CLAUDE.md"), "machine", seen, entries);

  entries.sort((a, b) => b.chars - a.chars);
  const chars = entries.reduce((sum, e) => sum + e.chars, 0);
  return { entries, chars, empty: entries.length === 0 };
}
