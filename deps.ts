// pantry/deps.ts — the cross-repo CONTROL-PLANE tier: layer-pin drift. The umbrella host (BREAD)
// pins every framework layer (`@tjakoen/batch`, `@tjakoen/grain`, `@tjakoen/mill`, `@tjakoen/proof`,
// `@tjakoen/crumb`) in its package.json. A layer publishes a newer version and the umbrella's pin
// silently lags — the one whole-stack question no single layer repo can answer, and nothing surfaced
// it before. `pantry deps` reads the host's pins and reports each one as current / behind / ahead /
// unknown against the layer SOURCE on disk (the sibling checkouts), so "is my stack pinned to what I
// actually have?" becomes one command.
//
// Same PANTRY posture as doctor/drift: NO model, pure file reads, deterministic. The pure core
// (`checkDeps`) takes the pins + a resolved available-version map and is fully injectable for tests;
// the fs edge (`resolveLayerVersions`, `readPins`) is isolated so the logic never needs a real tree.
//
// "Available" here is the layer source ON DISK — the working copy in the sibling monorepo, not the
// npm registry. In this dev layout that IS the practical drift ("my pin lags the grain I
// have checked out but haven't re-pinned"). A registry/tag-based resolver could swap in behind the
// same `checkDeps` core without touching the logic; disk is the network-free default.
//
// A lagging pin is a chore that's DUE, not a broken build (LOOP.md §2: "show what's due, don't gate").
// So `report.ok` is false only to mark drift for the caller; the CLI surfaces and exits 0, and the
// doctor fold-in registers as a WARN — it never fails CI on its own.
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

export type PinState = "current" | "behind" | "ahead" | "unknown";

export interface PinStatus {
  /** the dependency name, e.g. "@tjakoen/mill" */
  name: string;
  /** the raw range as written in package.json, e.g. "^0.1.2" or "github:tjakoen/pantry#f17eddf" */
  pinRaw: string;
  /** the pinned version parsed out of the range, or null when it is not a plain version (git/tag dep) */
  pinned: string | null;
  /** the layer source version found on disk, or null when the source could not be resolved */
  available: string | null;
  state: PinState;
  /** one-line human summary of the comparison */
  detail: string;
}

export interface DepsReport {
  /** true when nothing is "behind" (ahead / current / unknown do not flip it) */
  ok: boolean;
  deps: PinStatus[];
  behind: number;
}

// @tjakoen/<pkg> → the layer's package.json, RELATIVE to the layers root (the dir holding the sibling
// checkouts). grain/mill/proof/crumb live together in the grain monorepo under packages/*; batch is
// its own repo. @tjakoen/pantry is intentionally absent: it is a git-sha dep, not a semver pin, so
// there is no version to compare (it surfaces as "unknown", which is the honest answer).
const LAYER_SOURCES: Record<string, string> = {
  "@tjakoen/batch": "batch/package.json",
  "@tjakoen/grain": "grain/packages/grain/package.json",
  "@tjakoen/mill": "grain/packages/mill/package.json",
  "@tjakoen/proof": "grain/packages/proof/package.json",
  "@tjakoen/crumb": "grain/packages/crumb/package.json",
};

/** Pull the plain semver out of a range ("^0.1.8" → "0.1.8", "0.1.2" → "0.1.2"). Anything that is not
 *  a single caret/tilde/pin version — a github dep, "*", "workspace:*", a compound range — returns
 *  null, which reads downstream as "unknown" rather than a false comparison. */
export function parsePinned(range: string): string | null {
  const m = range.match(/^\s*[\^~]?\s*=?\s*v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\s*$/);
  return m ? m[1] : null;
}

/** Numeric x.y.z compare; prerelease/build metadata is dropped (the layers ship plain semver). Returns
 *  -1 when a < b, 0 when equal, 1 when a > b. */
export function compareVersions(a: string, b: string): number {
  const core = (v: string) => v.split(/[-+]/)[0].split(".").map((n) => Number(n) || 0);
  const pa = core(a);
  const pb = core(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The pure core: given the host's pins and a resolved available-version map, classify each pin.
 * Deterministic, no IO — the fs resolvers feed it. `ok` is false only when at least one pin is behind.
 */
export function checkDeps(pins: Record<string, string>, available: Record<string, string | null>): DepsReport {
  const deps: PinStatus[] = [];
  for (const name of Object.keys(pins).sort()) {
    const pinRaw = pins[name];
    const pinned = parsePinned(pinRaw);
    const avail = available[name] ?? null;
    let state: PinState;
    let detail: string;
    if (pinned === null) {
      state = "unknown";
      detail = `${pinRaw} — not a version pin`;
    } else if (avail === null) {
      state = "unknown";
      detail = `pinned ${pinned}, no layer source on disk`;
    } else {
      const c = compareVersions(pinned, avail);
      state = c < 0 ? "behind" : c > 0 ? "ahead" : "current";
      detail =
        c < 0
          ? `pin ${pinned} < source ${avail} — bump the pin (deps:refresh)`
          : c > 0
            ? `pin ${pinned} > source ${avail} — source unpublished?`
            : `pin ${pinned} matches source`;
    }
    deps.push({ name, pinRaw, pinned, available: avail, state, detail });
  }
  const behind = deps.filter((d) => d.state === "behind").length;
  return { ok: behind === 0, deps, behind };
}

/** Read the host package.json and collect every `@tjakoen/*` range from dependencies + devDependencies.
 *  Returns {} when there is no package.json or it will not parse (a surface never crashes). */
export async function readPins(cwd: string): Promise<Record<string, string>> {
  const file = join(cwd, "package.json");
  if (!existsSync(file)) return {};
  let json: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    json = JSON.parse(await Bun.file(file).text());
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = json[field];
    if (!deps) continue;
    for (const [k, v] of Object.entries(deps)) {
      if (k.startsWith("@tjakoen/") && typeof v === "string") out[k] = v;
    }
  }
  return out;
}

/** Resolve each known layer's version from its sibling checkout under `layersRoot`. A missing checkout
 *  or unreadable package.json resolves to null (→ "unknown"), never a throw. */
export async function resolveLayerVersions(layersRoot: string): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const [name, rel] of Object.entries(LAYER_SOURCES)) {
    const file = join(layersRoot, rel);
    if (!existsSync(file)) {
      out[name] = null;
      continue;
    }
    try {
      const version = (JSON.parse(await Bun.file(file).text()) as { version?: string }).version;
      out[name] = version ?? null;
    } catch {
      out[name] = null;
    }
  }
  return out;
}

/** Convenience for the CLI + doctor: read the host's pins from `cwd`, resolve the sibling layer
 *  versions under `layersRoot` (default: the dir that holds `cwd`, i.e. the monorepo sibling root),
 *  and classify. */
export async function checkPantryDeps(opts: { cwd?: string; layersRoot?: string } = {}): Promise<DepsReport> {
  const cwd = opts.cwd ?? process.cwd();
  const layersRoot = opts.layersRoot ?? dirname(cwd);
  const pins = await readPins(cwd);
  const available = await resolveLayerVersions(layersRoot);
  return checkDeps(pins, available);
}

// Plain-text report for a terminal / CI log — same posture as formatDriftReport: no backticks, no ANSI
// (color is a UI signal, not stdout). One line per pin; the tail is a count + OK/DRIFT.
export function formatDepsReport(report: DepsReport): string {
  const mark = (s: PinState): string =>
    s === "behind" ? "BEHIND" : s === "ahead" ? "ahead " : s === "current" ? "ok    " : "?     ";
  const lines = report.deps.map((d) => `[${mark(d.state)}] ${d.name}: ${d.detail}`);
  lines.push(`${report.deps.length} pins, ${report.behind} behind`);
  lines.push(report.ok ? "OK" : "DRIFT");
  return lines.join("\n");
}
