// pantry/skills.ts — piece S2: mount the cross-repo standards as agent skills, estate-wide.
//
// The problem S0 measured: a standard only fires if the agent reads it, and an agent reads what its
// harness lists. Skills are that list. So each standard's `when:` key (S1) becomes a skill
// `description:` and the standard's body becomes the skill body, materialized at
// `.claude/skills/<slug>/SKILL.md` in whatever repo the command is run from.
//
// Three rules this module exists to keep:
//   - SSOT. The standards stay canonical in the portfolio's `standards/`. What lands here is a
//     GENERATED VIEW, never a second copy to edit — same posture as graphify-out. Every emitted file
//     carries a sentinel comment and a "canon lives there" banner, and sync rewrites it in place.
//   - Reference, don't fork. No repo commits its skills. Sync writes `.claude/skills/.gitignore`
//     containing `*`, so the mount is self-ignoring and no host's own .gitignore is touched (the
//     non-invasive rule from init.ts).
//   - Degrade, never crash. If the portfolio package isn't installed, canonDir is null and every
//     surface says so quietly — a missing optional package is not a failure (init.ts's readStarter,
//     doctor's graphify check).
//
// Freshness is content-compared, not mtime-compared: `list` and doctor regenerate the expected
// SKILL.md in memory and diff it against what's on disk. An npm install rewrites mtimes for reasons
// that have nothing to do with the canon changing, so mtime would lie in both directions.
import { mkdir, writeFile, readdir, lstat, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "@tjakoen/mill/core/frontmatter.ts";
import { loadPantryConfig, type ResolvedPantryConfig } from "./config.ts";

/** Marks a SKILL.md as ours. Only files carrying it are ever rewritten or pruned — a hand-written or
 *  symlinked skill in the same dir is left completely alone. */
const SENTINEL = "<!-- pantry:skills-sync -->";

/** Claude Code truncates a skill description past this; a `when:` that long is a canon bug, not a
 *  sync bug, so we surface it as a warning and still mount. */
const MAX_DESCRIPTION = 1024;

const SKILLS_SUBDIR = join(".claude", "skills");

/** One standard, read from canon and ready to emit. */
export interface SkillSource {
  /** the canon filename, e.g. "VOICE.md" */
  file: string;
  /** the mount slug, e.g. "voice" */
  slug: string;
  /** the `when:` line — becomes the skill description, the only text the harness reads at rest */
  when: string;
  /** the standard's body, verbatim */
  body: string;
}

export type SkillAction = "written" | "unchanged";

export interface SkillMount {
  slug: string;
  file: string;
  /** absolute path to the emitted SKILL.md */
  path: string;
  action: SkillAction;
  /** set when the description exceeds what the harness will read */
  warning?: string;
}

export interface SkillsSyncReport {
  /** where canon was read from, or null when the portfolio package isn't resolvable */
  canonDir: string | null;
  /** absolute `.claude/skills` for this host */
  skillsDir: string;
  mounted: SkillMount[];
  /** canon files deliberately not mounted (no `when:` key) */
  skipped: { file: string; reason: string }[];
  /** previously-synced slugs pruned because canon no longer carries them */
  pruned: string[];
}

/** `shadowed`: canon carries this standard, but something we did not generate occupies its slot.
 *  It is deliberately NOT `stale`, because sync refuses to write through it — reporting it as stale
 *  would tell the reader to run a command that cannot change anything. */
export type SkillFreshness = "fresh" | "stale" | "missing" | "shadowed";

export interface SkillStatus {
  slug: string;
  file: string;
  state: SkillFreshness;
}

export interface SkillsListReport {
  canonDir: string | null;
  skillsDir: string;
  skills: SkillStatus[];
  /** skill dirs present but not ours — hand-installed or symlinked; reported, never touched */
  foreign: string[];
}

export interface SkillsOptions {
  /** the host project root; default process.cwd() */
  cwd?: string;
  /** inject a resolved config (tests / callers that already loaded one) */
  config?: ResolvedPantryConfig;
  /** inject the canon standards dir (tests); default resolveCanonDir() */
  canonDir?: string | null;
}

/**
 * Where the canon standards live for this host.
 *
 * The canon home reads its OWN `standards/` dir: the portfolio both publishes the standards and
 * consumes them, and its installed copy of itself is pinned to a past commit. Syncing the home from
 * that pin would mount yesterday's canon on top of today's, which is the exact drift this module
 * exists to prevent. Every other repo resolves the published package, the same `import.meta.resolve`
 * trick init.ts uses for CLAUDE.starter.md, and gets whatever commit its pin names.
 *
 * Returns null when the package isn't installed — callers degrade, they do not throw.
 */
export function resolveCanonDir(cwd: string, config?: ResolvedPantryConfig): string | null {
  if (config?.standardsSource === "canon") {
    const local = join(cwd, "standards");
    if (existsSync(local)) return local;
  }
  try {
    return dirname(fileURLToPath(import.meta.resolve("tjakoen.github.io/standards/CLAUDE.starter.md")));
  } catch {
    return null;
  }
}

/**
 * "AI-REPO-STANDARD.md" → "ai-repo-standard"; "CLAUDE.starter.md" → "claude-starter".
 *
 * A standard may override this with a `skill:` frontmatter key, and one has to: the harness ships
 * built-in skills of its own, and a mount whose slug collides is silently shadowed — it lands on disk,
 * never appears in the listing, and so never fires. LOOP.md hit exactly that against the built-in
 * `loop`. The override lives in canon rather than in a table here, because which name a standard
 * answers to is a canon decision (SSOT), not a sync-tool detail.
 */
export function slugFor(file: string, override?: unknown): string {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  // An override that normalizes to nothing (say `skill: "---"`) must not win: an empty slug makes
  // join(skillsDir, slug) collapse to skillsDir itself, so the mount would land as a stray
  // .claude/skills/SKILL.md that neither prune nor list can account for. Fall back to the filename,
  // and to the raw basename if even that normalizes away.
  if (typeof override === "string" && override.trim()) {
    const fromOverride = normalize(override.trim());
    if (fromOverride) return fromOverride;
  }
  return normalize(basename(file, ".md")) || normalize(file) || "standard";
}

/**
 * Read every standard in `canonDir` that carries a `when:` key. A file without one is not a mistake:
 * README.md is an index, CLAUDE.md is the dir's own rules and already auto-loads, AGENTS.md is a
 * symlink to it (standards/CLAUDE.md records this). The `when:` key IS the opt-in, so this module
 * hardcodes no inventory — canon decides what is a skill.
 */
export async function readCanonSkills(canonDir: string): Promise<{ sources: SkillSource[]; skipped: { file: string; reason: string }[] }> {
  const sources: SkillSource[] = [];
  const skipped: { file: string; reason: string }[] = [];

  let entries: string[] = [];
  try {
    entries = await readdir(canonDir);
  } catch {
    return { sources, skipped };
  }

  for (const file of entries.sort()) {
    if (!file.endsWith(".md")) continue;
    // AGENTS.md is a symlink to CLAUDE.md; mounting both would emit the same body twice.
    try {
      if ((await lstat(join(canonDir, file))).isSymbolicLink()) {
        skipped.push({ file, reason: "symlink to another standard" });
        continue;
      }
    } catch {
      continue;
    }

    let raw: string;
    try {
      raw = await Bun.file(join(canonDir, file)).text();
    } catch {
      skipped.push({ file, reason: "unreadable" });
      continue;
    }

    const { data, body } = parseFrontmatter(raw);
    const when = data.when;
    if (typeof when !== "string" || !when.trim()) {
      skipped.push({ file, reason: "no when: key — not a skill" });
      continue;
    }

    sources.push({ file, slug: slugFor(file, data.skill), when: when.trim(), body });
  }

  // Two standards claiming one slug would last-writer-win in silence: both would report as mounted
  // while only one body survived on disk. First file alphabetically keeps the slug, the rest are
  // skipped by name so the clash is visible and fixable with a `skill:` key.
  const claimed = new Map<string, string>();
  const unique: SkillSource[] = [];
  for (const source of sources) {
    const owner = claimed.get(source.slug);
    if (owner !== undefined) {
      skipped.push({ file: source.file, reason: `slug "${source.slug}" already claimed by ${owner} — set a skill: key on one of them` });
      continue;
    }
    claimed.set(source.slug, source.file);
    unique.push(source);
  }

  return { sources: unique, skipped };
}

/**
 * The exact bytes of a mounted SKILL.md. Pure, so freshness is a content diff rather than a stat:
 * regenerate this and compare. The description is JSON-encoded because a `when:` is multi-sentence
 * prose that will contain colons and quotes, and SKILL.md frontmatter is read as YAML.
 */
export function renderSkill(source: SkillSource): string {
  return [
    "---",
    `name: ${source.slug}`,
    `description: ${JSON.stringify(source.when)}`,
    "---",
    "",
    SENTINEL,
    `> Generated view of \`standards/${source.file}\` in the portfolio canon. Edit it there, not here:`,
    "> `pantry skills sync` rewrites this file and any local edit is lost. Relative links below",
    "> resolve from `standards/`.",
    "",
    source.body.replace(/\s+$/, ""),
    "",
  ].join("\n");
}

/** True when this SKILL.md is one we emitted, so it is safe to rewrite or prune. */
async function isOurs(path: string): Promise<boolean> {
  try {
    return (await Bun.file(path).text()).includes(SENTINEL);
  } catch {
    return false;
  }
}

/**
 * Materialize `.claude/skills/<slug>/SKILL.md` for every standard carrying a `when:` key.
 *
 * Idempotent: a mount whose bytes already match is reported "unchanged" and not rewritten. Pruning
 * only ever removes dirs holding a SKILL.md with our sentinel, so a hand-installed or symlinked
 * skill sharing the dir survives untouched.
 */
export async function syncSkills(opts: SkillsOptions = {}): Promise<SkillsSyncReport> {
  const cwd = opts.cwd ?? process.cwd();
  const config = opts.config ?? (await loadPantryConfig(cwd));
  const canonDir = opts.canonDir !== undefined ? opts.canonDir : resolveCanonDir(cwd, config);
  const skillsDir = join(cwd, SKILLS_SUBDIR);

  if (canonDir === null) {
    return { canonDir: null, skillsDir, mounted: [], skipped: [], pruned: [] };
  }

  const { sources, skipped } = await readCanonSkills(canonDir);
  // Canon resolved but nothing in it is skill-shaped. Return before creating any dirs: an empty
  // .claude/skills is worse than none, it reads as "mounted, and there is nothing".
  if (sources.length === 0) {
    return { canonDir, skillsDir, mounted: [], skipped, pruned: [] };
  }

  await mkdir(skillsDir, { recursive: true });
  // Self-ignoring mount: the generated tree carries its own .gitignore rather than editing the
  // host's, so `pantry skills sync` stays as non-invasive as `pantry init`.
  await writeFile(
    join(skillsDir, ".gitignore"),
    "# Generated by `pantry skills sync` — canon lives in the portfolio's standards/.\n# Regenerable, host-local, never committed (same posture as graphify-out).\n*\n",
    "utf8",
  );

  const mounted: SkillMount[] = [];
  for (const source of sources) {
    const dir = join(skillsDir, source.slug);
    const path = join(dir, "SKILL.md");
    const next = renderSkill(source);

    // The slot itself must be a real directory we own. A symlink sitting at a live slug would make
    // writeFile land wherever it points, outside this repo entirely — pruneStale already refuses to
    // delete through one, and the write path needs the same refusal.
    try {
      const slot = await lstat(dir);
      if (!slot.isDirectory() || slot.isSymbolicLink()) {
        skipped.push({ file: source.file, reason: `${source.slug} is not a plain directory — left as-is` });
        continue;
      }
    } catch {
      /* absent → we create it below */
    }

    let current: string | null = null;
    try {
      current = await Bun.file(path).text();
    } catch {
      current = null;
    }

    // Never write through a skill we did not generate — a hand-authored skill at the same slug wins.
    if (current !== null && !current.includes(SENTINEL)) {
      skipped.push({ file: source.file, reason: `${source.slug}/SKILL.md is hand-authored — left as-is` });
      continue;
    }

    let action: SkillAction = "unchanged";
    if (current !== next) {
      await mkdir(dir, { recursive: true });
      await writeFile(path, next, "utf8");
      action = "written";
    }

    const warning =
      source.when.length > MAX_DESCRIPTION
        ? `description is ${source.when.length} chars, over the ${MAX_DESCRIPTION} the harness reads — shorten when: in canon`
        : undefined;
    mounted.push({ slug: source.slug, file: source.file, path, action, warning });
  }

  const pruned = await pruneStale(skillsDir, new Set(sources.map((s) => s.slug)));
  return { canonDir, skillsDir, mounted, skipped, pruned };
}

/** Remove mounts we generated for standards canon no longer carries. Ours-only, by sentinel. */
async function pruneStale(skillsDir: string, live: Set<string>): Promise<string[]> {
  const pruned: string[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(skillsDir);
  } catch {
    return pruned;
  }
  for (const name of entries) {
    if (live.has(name)) continue;
    const dir = join(skillsDir, name);
    try {
      if (!(await lstat(dir)).isDirectory()) continue; // symlinked skill → not ours, not a dir we own
    } catch {
      continue;
    }
    if (!(await isOurs(join(dir, "SKILL.md")))) continue;
    await rm(dir, { recursive: true, force: true });
    pruned.push(name);
  }
  return pruned;
}

/**
 * What is mounted here and whether it still matches canon. `stale` means the canon standard changed
 * since the last sync (or the package pin moved); `missing` means canon carries a skill this repo
 * has never mounted. Both are fixed by one `pantry skills sync`.
 */
export async function listSkills(opts: SkillsOptions = {}): Promise<SkillsListReport> {
  const cwd = opts.cwd ?? process.cwd();
  const config = opts.config ?? (await loadPantryConfig(cwd));
  const canonDir = opts.canonDir !== undefined ? opts.canonDir : resolveCanonDir(cwd, config);
  const skillsDir = join(cwd, SKILLS_SUBDIR);

  if (canonDir === null) return { canonDir: null, skillsDir, skills: [], foreign: [] };

  const { sources } = await readCanonSkills(canonDir);
  const skills: SkillStatus[] = [];
  for (const source of sources) {
    const path = join(skillsDir, source.slug, "SKILL.md");
    let current: string | null = null;
    try {
      current = await Bun.file(path).text();
    } catch {
      current = null;
    }
    const state: SkillFreshness =
      current === null
        ? "missing"
        : !current.includes(SENTINEL)
          ? "shadowed"
          : current === renderSkill(source)
            ? "fresh"
            : "stale";
    skills.push({ slug: source.slug, file: source.file, state });
  }

  // Anything in the mount dir that isn't ours: reported so `list` is an honest inventory of what the
  // harness will actually load, not just of what we put there.
  const foreign: string[] = [];
  const ours = new Set(sources.map((s) => s.slug));
  let entries: string[] = [];
  try {
    entries = await readdir(skillsDir);
  } catch {
    entries = [];
  }
  for (const name of entries) {
    if (name.startsWith(".") || ours.has(name)) continue;
    if (!(await isOurs(join(skillsDir, name, "SKILL.md")))) foreign.push(name);
  }

  return { canonDir, skillsDir, skills, foreign: foreign.sort() };
}

// Plain text for a terminal / CI log — no backticks, no ANSI, same posture as formatDoctorReport.
export function formatSkillsSync(report: SkillsSyncReport): string {
  if (report.canonDir === null) {
    return "skills: the tjakoen.github.io package is not installed — nothing to sync.\nAdd it (bun add tjakoen.github.io@github:tjakoen/tjakoen.github.io) and run this again.";
  }
  if (report.mounted.length === 0 && report.skipped.every((s) => s.reason.includes("no when:") || s.reason.includes("symlink"))) {
    return `canon: ${report.canonDir}\nNo standard there carries a when: key, so there is nothing to mount.\nThis pin predates the skill format — bump the tjakoen.github.io dependency.`;
  }
  const lines = [`canon: ${report.canonDir}`, `mount: ${report.skillsDir}`];
  for (const m of report.mounted) {
    lines.push(`  ${m.action === "written" ? "sync " : "ok   "} ${m.slug} (${m.file})`);
    if (m.warning) lines.push(`  warn  ${m.slug}: ${m.warning}`);
  }
  for (const p of report.pruned) lines.push(`  prune ${p} (no longer in canon)`);
  for (const s of report.skipped) lines.push(`  skip  ${s.file}: ${s.reason}`);
  const written = report.mounted.filter((m) => m.action === "written").length;
  lines.push(`${report.mounted.length} skills mounted, ${written} written, ${report.pruned.length} pruned`);
  if (report.mounted.length > 0) lines.push("Generated and gitignored — never commit .claude/skills; re-run after a canon change.");
  return lines.join("\n");
}

export function formatSkillsList(report: SkillsListReport): string {
  if (report.canonDir === null) {
    return "skills: the tjakoen.github.io package is not installed — no canon to list against.";
  }
  if (report.skills.length === 0) {
    return `canon: ${report.canonDir}\nNo standard there carries a when: key — this pin predates the skill format.`;
  }
  const lines = [`canon: ${report.canonDir}`, `mount: ${report.skillsDir}`];
  const MARK: Record<SkillFreshness, string> = { fresh: "ok   ", stale: "stale", missing: "none ", shadowed: "shadow" };
  for (const s of report.skills) {
    const note = s.state === "shadowed" ? " (a file we did not generate holds this slot; sync will not touch it)" : "";
    lines.push(`  ${MARK[s.state]} ${s.slug} (${s.file})${note}`);
  }
  for (const f of report.foreign) lines.push(`  other ${f} (not generated by pantry — left alone)`);
  // Shadowed is excluded from the sync-fixable count on purpose: sync cannot resolve it, so telling
  // the reader to run sync would be a lie. Removing the hand-authored file is the only fix.
  const behind = report.skills.filter((s) => s.state === "stale" || s.state === "missing").length;
  const shadowed = report.skills.filter((s) => s.state === "shadowed").length;
  lines.push(`${report.skills.length} skills in canon, ${behind} stale or unmounted, ${shadowed} shadowed`);
  if (behind > 0) lines.push("Run pantry skills sync.");
  if (shadowed > 0) lines.push("Shadowed slots need the hand-authored SKILL.md removed; sync cannot overwrite it.");
  return lines.join("\n");
}
