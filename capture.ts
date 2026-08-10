// pantry/capture.ts — P4d of plans/pantry-review-layer.md: CAPTURE AT RUN TIME.
//
// The harness drives the reviewed app step by step through PANTRY's own proxy, resolves each step's
// `data-surface` address, fails loudly when an address is missing or ambiguous, and writes the states
// into <artifactsDir>/reviews/<id>/ so the review reads later, offline, from a phone, with the app
// switched off.
//
// WHY THIS ORDERING (the plan's "drive at capture time, not at review time"): a stale address during
// capture fails here, in a harness, where a failure is a signal. The same stale address during review
// silently lights the wrong element in front of the one person who trusted it. So this module's job
// is not to take pretty pictures. It is to FAIL.
//
// THREE BOUNDARIES, because this is the module that crosses the ones the rest of PANTRY keeps:
//
//  1. **PANTRY does not own a browser.** The driver is resolved from the HOST repo, never from
//     PANTRY's own node_modules — PANTRY carries @playwright/test as a devDependency for its own
//     tests, and letting that satisfy a host's capture would be a green that means nothing the day
//     PANTRY ships as a git dependency with no devDeps installed. See resolveDriver.
//  2. **PANTRY now starts a process.** Only here, only from `previewCommand`, only a string a human
//     wrote, only when the target is not already answering, and killed by process GROUP on every
//     exit path, SIGTERM then SIGKILL, with the exit waited for rather than assumed. The server
//     never spawns anything; no route reaches this file.
//  3. **PANTRY now WRITES outside the answer log.** artifacts.ts is pure reads and stays so: this is
//     a CLI command, and it writes only under <artifactsDir>/reviews/<id>/, only files whose
//     extension is on a three-item allowlist, and only after the real resolved directory has been
//     proved to sit inside the real resolved artifacts dir. Same shape as the P2 lesson: a denylist
//     of what must not be written cannot be finished, and a name check is a string check.
import { mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { loadTour } from "@tjakoen/crumb/loader.ts";
import { needsNavigation } from "@tjakoen/crumb/core";
import type { Step, Tour } from "@tjakoen/crumb/core";
import type { ResolvedPantryConfig } from "./config.ts";

// ---- What a step's address can be, and only one of these is a pass ---------------------------
// `not-visible` is a failure and not a warning on purpose. A screenshot of a zero-area element is a
// blank crop, and a review that carries a blank crop labelled with a surface name is worse than one
// that carries nothing: it looks like evidence.
export const CAPTURE_VERDICTS = ["ok", "missing", "ambiguous", "not-visible"] as const;
export type CaptureVerdict = (typeof CAPTURE_VERDICTS)[number];

export interface Box { x: number; y: number; width: number; height: number }

export interface CapturedStep {
  index: number;
  surface: string;
  /** the step's declared route, or null when it named none */
  at: string | null;
  status: Step["status"];
  verify: string | null;
  /** the URL the step was measured on, on PANTRY's origin. When the load itself failed this is the
   *  URL that was REQUESTED, and `navigated` is false, which is how the two are told apart. */
  url: string;
  /** whether this step reached a new page, or read the one the step before it left behind. False on
   *  a step whose navigation threw, because an attempt is not an arrival. */
  navigated: boolean;
  verdict: CaptureVerdict;
  /** how many elements carried the address; the number is the whole story for `ambiguous` */
  matches: number;
  box: Box | null;
  /** file name inside the capture dir, or null when the shot could not be taken */
  page: string | null;
  element: string | null;
  /** one sentence, present exactly when verdict !== "ok" */
  problem: string | null;
}

export interface CaptureManifest {
  tour: string;
  title: string;
  mode: Tour["mode"];
  capturedAt: string;
  /** the project being reviewed */
  previewTarget: string;
  /** PANTRY's ephemeral origin: what the browser actually loaded, proxy and injection included */
  via: string;
  /** whether capture started the project itself, and with what */
  startedProject: string | null;
  viewport: { width: number; height: number };
  /** stated because it changes the pixels. CSS transitions and animations only: script-driven
   *  motion, video and animated images are outside what a stylesheet can stop. */
  motion: "css-disabled";
  driver: { package: string; path: string; version: string | null };
  steps: CapturedStep[];
  failures: number;
}

// The only three extensions this module may write: the shots, the manifest, the index. An allowlist
// rather than a denylist, for the reason P2 learned the hard way: "everything except the corpus" is
// not a list anyone finishes writing.
export const CAPTURE_WRITE_EXTS = [".png", ".json", ".md"] as const;

const VIEWPORT = { width: 1280, height: 800 };

// ---- Pure helpers, which is most of the decisions -------------------------------------------

/** The capture dir's name. Date first so a reviews/ folder sorts chronologically, tour id after so
 *  two tours captured the same day do not overwrite each other. */
export function captureDirName(tourId: string, when: Date): string {
  return `${when.toISOString().slice(0, 10)}-${tourId}`;
}

/** A surface address as a file stem: `ticket:refund-state` at index 1 → `02-ticket-refund-state`.
 *  One-based and zero-padded so ten steps sort right in a file listing, which is the only place a
 *  reviewer with no tooling will ever see them. */
export function stepFileStem(index: number, surface: string): string {
  const slug = surface.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "surface";
  return `${String(index + 1).padStart(2, "0")}-${slug}`;
}

/** The attribute selector for an address. Escaped even though grain's surface vocabulary cannot
 *  contain a quote today, because the day it can, the failure is a selector that silently matches
 *  something else rather than an error. */
export function surfaceSelector(surface: string): string {
  return `[data-surface="${surface.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

/** The verdict, from what the page gave back. Kept pure so every branch is testable without a
 *  browser, which matters because three of these four are the branches nobody exercises by hand. */
export function classifyMatch(matches: number, box: Box | null): CaptureVerdict {
  if (matches === 0) return "missing";
  if (matches > 1) return "ambiguous";
  if (!box || box.width <= 0 || box.height <= 0) return "not-visible";
  return "ok";
}

/** The sentence that goes beside a failing verdict. Written for someone reading the capture dir
 *  three days later with no session open, so it names the address and what to do about it. */
export function problemFor(verdict: CaptureVerdict, surface: string, matches: number, url: string): string | null {
  if (verdict === "ok") return null;
  if (verdict === "missing") {
    return `No element carries data-surface="${surface}" on ${url}. Either the attribute was never added, or the markup that carried it moved.`;
  }
  if (verdict === "ambiguous") {
    return `${matches} elements carry data-surface="${surface}" on ${url}. An address that resolves to more than one element resolves to whichever copy the query reaches first, which is the drift this layer exists to avoid. Give the one under review its own address.`;
  }
  return `data-surface="${surface}" resolved to one element on ${url} and that element has no box: it is hidden, collapsed, or not yet rendered when the page settled.`;
}

/** Is `child` really inside `parent`? Both must already be real paths — the point of taking them
 *  resolved is that a symlink cannot be checked by looking at a string. */
export function isInside(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/** A file name this module is allowed to write: no separators, no traversal, allowlisted extension. */
export function isWritableCaptureFile(name: string): boolean {
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return false;
  if (name === "." || name === ".." || name.startsWith(".")) return false;
  return CAPTURE_WRITE_EXTS.some((ext) => name.toLowerCase().endsWith(ext));
}

// ---- The driver, borrowed and never owned ----------------------------------------------------

export interface DriverResolution {
  ok: boolean;
  /** the specifier that resolved, e.g. "playwright" */
  package?: string;
  /** the file the specifier resolved to */
  path?: string;
  /** what to print when it did not resolve: the exact commands, in order */
  message?: string;
}

const DRIVER_SPECIFIERS = ["playwright", "@playwright/test"] as const;

/**
 * Find a Playwright the HOST installed.
 *
 * The containment rule is the whole function. Bun resolves a bare specifier by walking up from the
 * directory it is given, so resolving from the host root finds the host's install and, in a
 * workspace, the hoisted one above it — both are legitimately the host's. What is NOT the host's is
 * PANTRY's own node_modules, which is on disk in this very repo and would answer every time. A host
 * with no Playwright would then get a working capture during development and a resolution failure
 * the first time PANTRY is installed as a git dependency, which strips devDependencies. That is a
 * false green with a long fuse, so it is refused by path.
 *
 * When the host IS pantry (running `bun cli.ts capture` in this repo) there is nothing to refuse:
 * pantry's devDependency is then the host's dependency, and the guard is off.
 */
export function resolveDriver(hostDir: string, pantryDir: string): DriverResolution {
  // REAL paths on both sides, for the reason isInside states two functions up: a symlink cannot be
  // checked by looking at a string. The first version compared `resolve()`d paths, which normalizes
  // dots and follows nothing, so a PANTRY consumed through a link — bun link, a workspace symlink, a
  // bind-mounted dev checkout — would have compared the link path against the resolver's real one,
  // failed to match, and let PANTRY's own devDependency satisfy a host that installed nothing. That
  // is the exact false green this guard exists to stop, reachable through the guard itself.
  const real = (p: string): string => { try { return realpathSync(p); } catch { return resolve(p); } };
  const realPantry = real(pantryDir);
  const ownNodeModules = join(realPantry, "node_modules") + sep;
  const hostIsPantry = real(hostDir) === realPantry;
  const refused: string[] = [];

  for (const spec of DRIVER_SPECIFIERS) {
    let path: string;
    try {
      path = Bun.resolveSync(spec, hostDir);
    } catch {
      continue;
    }
    if (!hostIsPantry && real(path).startsWith(ownNodeModules)) {
      refused.push(spec);
      continue;
    }
    return { ok: true, package: spec, path };
  }

  const note = refused.length
    ? `\n\n${refused.join(" and ")} resolved out of PANTRY's own node_modules, which is PANTRY's test dependency and not yours. It is refused on purpose: it disappears the moment PANTRY is installed as a git dependency, and a capture that only works while PANTRY is a sibling checkout is a green that means nothing.`
    : "";
  return {
    ok: false,
    message:
      `pantry capture needs a browser driver and does not ship one. Install Playwright in this repo:\n` +
      `  bun add -d @playwright/test\n` +
      `  bunx playwright install chromium\n` +
      `(npm install -D @playwright/test && npx playwright install chromium works the same.)` +
      note,
  };
}

// ---- Bringing the target up -------------------------------------------------------------------

/** Is something answering on `origin`? Any HTTP response counts, including a 404 or a 500: the
 *  question is whether a server is listening, not whether it likes the request. A connection
 *  refused, and only that, means it is not up. */
export async function targetIsUp(origin: string, perAttemptMs = 2000): Promise<boolean> {
  try {
    await fetch(origin, { signal: AbortSignal.timeout(perAttemptMs), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll until the target answers or the deadline passes. `timeoutMs` is validated rather than
 *  trusted: a NaN deadline is never past, and the wait that shipped in P3 with exactly that bug
 *  became a silent hot loop with no error and no exit. */
export async function waitForTarget(origin: string, timeoutMs: number, isCancelled: () => boolean = () => false): Promise<boolean> {
  const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 90_000;
  const deadline = Date.now() + budget;
  for (;;) {
    if (isCancelled()) return false;
    if (await targetIsUp(origin)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(300);
  }
}

interface StartedProject { child: ChildProcess; command: string; log: string[] }

/**
 * Start the project, in its own process GROUP.
 *
 * The group is not a detail. `bun run start` spawns the framework, the framework spawns a server,
 * and killing the pid we hold leaves the one holding the port. The symptom is a capture that
 * succeeds once and then fails forever with "address already in use" against a process nobody can
 * name. `detached: true` puts the whole tree in one group and `kill(-pid)` takes all of it.
 */
function startProject(command: string, cwd: string): StartedProject {
  const log: string[] = [];
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (chunk: Buffer) => {
    // Bounded, because the point of keeping this is the last few lines when a start FAILS, and an
    // app that logs a request per line would otherwise grow this without limit for a whole capture.
    for (const line of chunk.toString().split("\n")) if (line.trim()) log.push(line.trimEnd());
    if (log.length > 80) log.splice(0, log.length - 80);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  return { child, command, log };
}

/**
 * Stop it, and then CHECK.
 *
 * The first version of this sent one SIGTERM and returned, which is not the same as stopping
 * anything: a framework with its own shutdown handler can take the signal, decline to hurry, and
 * keep the port. The symptom is the exact one the group kill was written to prevent, so a polite
 * signal that is never followed up is the same bug wearing a better hat. SIGTERM the group, wait a
 * bounded moment for the exit, then SIGKILL the group.
 *
 * `killGroup` falls back to the single pid when the group is gone or never formed (a spawn that
 * failed). That fallback is NOT a group kill and is not claimed to be one: it is the case where
 * there is no group left to address.
 */
async function stopProject(started: StartedProject, graceMs = 5000): Promise<void> {
  const pid = started.child.pid;
  if (pid === undefined || started.child.exitCode !== null) return;

  const killGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      try { started.child.kill(signal); } catch { /* already dead */ }
    }
  };

  const exited = new Promise<void>((done) => {
    if (started.child.exitCode !== null) return done();
    started.child.once("exit", () => done());
  });

  killGroup("SIGTERM");
  const won = await Promise.race([
    exited.then(() => true),
    sleep(graceMs).then(() => false),
  ]);
  if (won) return;
  killGroup("SIGKILL");
  // A bounded wait after SIGKILL too, so the teardown that follows (closing PANTRY's server) does
  // not race a process that still holds the port for another few milliseconds.
  await Promise.race([exited, sleep(1000)]);
}

// ---- The report a human reads ------------------------------------------------------------------

/** The capture dir's index. Written so the folder means something opened cold, with no PANTRY
 *  running and no session to ask, which is the whole reason the screenshots are the durable record. */
export function formatCaptureIndex(m: CaptureManifest): string {
  const lines: string[] = [];
  lines.push(`# Capture: ${m.title}`);
  lines.push("");
  lines.push(`Tour ${m.tour}, ${m.mode} mode. Captured ${m.capturedAt}.`);
  lines.push("");
  lines.push(`The app under review was ${m.previewTarget}, loaded through PANTRY at ${m.via}, so these are`);
  lines.push(`the bytes the review serves, injection included, rather than the ones the app serves directly.`);
  lines.push(`The box is not the review's: this is a plain ${m.viewport.width} by ${m.viewport.height} window, while the live`);
  lines.push(`embed sits in a frame beside the rail and is narrower than that. A layout that turns on a`);
  lines.push(`breakpoint can differ between the two.`);
  lines.push(`CSS transitions and animations are off, so a shot is a settled state rather than a frame of one.`);
  lines.push(`Motion driven by script, video or an animated image is not something this can stop.`);
  lines.push("");
  if (m.failures > 0) {
    lines.push(`## ${m.failures} of ${m.steps.length} steps failed`);
    lines.push("");
    lines.push("A failure here is the harness doing its job. An address that cannot be resolved at capture");
    lines.push("time is one that would have lit the wrong element at review time, silently.");
    lines.push("");
    for (const s of m.steps.filter((x) => x.verdict !== "ok")) {
      lines.push(`- Step ${s.index + 1}, ${s.surface}: ${s.verdict}. ${s.problem}`);
    }
    lines.push("");
  } else {
    lines.push(`All ${m.steps.length} steps resolved.`);
    lines.push("");
  }
  lines.push("## Steps");
  lines.push("");
  for (const s of m.steps) {
    lines.push(`### ${s.index + 1}. ${s.surface}`);
    lines.push("");
    lines.push(`- verdict: ${s.verdict}${s.matches === 1 ? "" : ` (${s.matches} matches)`}`);
    lines.push(`- status: ${s.status ?? "unmarked"}`);
    lines.push(`- url: ${s.url}${s.navigated ? "" : " (no navigation; the page the step before it left)"}`);
    if (s.page) lines.push(`- page shot: ${s.page}`);
    if (s.element) lines.push(`- element shot: ${s.element}`);
    if (s.verify) lines.push(`- verify: ${s.verify}`);
    if (s.problem) lines.push(`- problem: ${s.problem}`);
    lines.push("");
  }
  lines.push("Machine-readable: capture.json.");
  lines.push("");
  return lines.join("\n");
}

// ---- The run ------------------------------------------------------------------------------------

export interface CaptureOptions {
  config: ResolvedPantryConfig;
  tourId: string;
  /** the capture dir name; default <date>-<tourId> */
  id?: string;
  /** overwrite an existing capture dir rather than refusing it */
  force?: boolean;
  /** how long to wait for previewCommand to bring the target up */
  startTimeoutMs?: number;
  /** where this module's own code lives, so the driver guard can name PANTRY's node_modules.
   *  Injected rather than read from import.meta so the guard is testable. */
  pantryDir?: string;
  log?: (line: string) => void;
}

export interface CaptureResult {
  ok: boolean;
  /** absolute capture dir, or null when nothing was written */
  dir: string | null;
  manifest: CaptureManifest | null;
  /** the one sentence to print and exit on, when the run could not start at all */
  fatal: string | null;
}

export async function runCapture(opts: CaptureOptions): Promise<CaptureResult> {
  const { config, tourId } = opts;
  const log = opts.log ?? ((l: string) => console.log(l));
  const pantryDir = opts.pantryDir ?? new URL(".", import.meta.url).pathname;
  const fail = (fatal: string): CaptureResult => ({ ok: false, dir: null, manifest: null, fatal });

  // --- everything that can be refused before anything is started, is ---------------------------
  if (!config.toursDir) {
    return fail("No toursDir. Capture reads the REVIEWING repo's tours; set toursDir in pantry.config.json or add content/tours.");
  }
  const loaded = await loadTour(config.toursDir, tourId);
  if (!loaded) return fail(`No tour "${tourId}" in ${config.toursDir}.`);
  if (loaded.errors.length) {
    // Refused rather than warned. A tour whose steps did not parse cleanly is a tour whose addresses
    // may not be the ones the author wrote, and capture's entire value is that its addresses are real.
    return fail(`Tour "${tourId}" has parse errors, so its addresses cannot be trusted:\n` +
      loaded.errors.map((e) => `  ${e.field}: ${e.message}`).join("\n"));
  }
  // No separate "has no steps" check: CRUMB's parser already reports that as a parse error, and the
  // second guard that looked prudent here was code that could never run.
  const tour = loaded.tour;

  if (!config.previewTarget) {
    return fail("No previewTarget. Capture drives the reviewed project through PANTRY's proxy, so it needs one: set previewTarget in pantry.config.json, or pass --preview http://localhost:PORT.");
  }

  const driver = resolveDriver(config.cwd, pantryDir);
  if (!driver.ok) return fail(driver.message!);

  let chromium: any;
  let driverVersion: string | null = null;
  try {
    const mod = await import(driver.path!);
    chromium = mod.chromium ?? mod.default?.chromium;
    if (!chromium) return fail(`${driver.package} resolved at ${driver.path} but exports no chromium.`);
  } catch (e) {
    return fail(`${driver.package} resolved at ${driver.path} but could not be imported: ${(e as Error).message}`);
  }
  try {
    // The LAST node_modules on the path, not the first: a nested or unhoisted install resolves to
    // .../node_modules/@x/y/node_modules/playwright/..., and cutting at the first one reads the
    // wrong package's manifest. Only the recorded version is at stake, so a miss degrades to null.
    const marker = `${sep}node_modules${sep}`;
    const cut = driver.path!.lastIndexOf(marker);
    const root = cut === -1 ? null : driver.path!.slice(0, cut + marker.length - 1);
    driverVersion = root
      ? (JSON.parse(await Bun.file(join(root, driver.package!, "package.json")).text()).version ?? null)
      : null;
  } catch { driverVersion = null; }

  // The output dir, proved to be inside artifacts BEFORE a browser is launched. Doing this last
  // would mean discovering a misconfigured artifactsDir after a five-minute walk.
  const dirName = opts.id ?? captureDirName(tour.id, new Date());
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(dirName) || dirName.includes("..")) {
    return fail(`Capture id "${dirName}" is not a plain folder name.`);
  }
  await mkdir(join(config.artifactsDir, "reviews"), { recursive: true });
  const outDir = join(config.artifactsDir, "reviews", dirName);
  await mkdir(outDir, { recursive: true });
  const realOut = await realpath(outDir);
  const realArtifacts = await realpath(config.artifactsDir);
  if (!isInside(realArtifacts, realOut)) {
    return fail(`Refusing to write: ${outDir} resolves to ${realOut}, which is outside ${realArtifacts}. A link in the path is exactly what makes a name check wrong.`);
  }
  const existing = (await readdir(realOut)).filter((n) => !n.startsWith("."));
  if (existing.length && !opts.force) {
    return fail(`${outDir} already has ${existing.length} files. Refusing to mix two runs' evidence in one folder: pass --force to replace it, or --id to name a new one.\n(A leftover screenshot from an earlier run is the failure P4 already met once: the reviewer is looking at an older build and nothing on screen says so.)`);
  }
  if (existing.length && opts.force) {
    // recursive + force, because isWritableCaptureFile checks a NAME and a directory may legally be
    // called `old.png`. A plain rm() on one throws EISDIR out of this function and past every clean
    // failure message the module otherwise produces.
    try {
      for (const name of existing) if (isWritableCaptureFile(name)) await rm(join(realOut, name), { recursive: true, force: true });
    } catch (e) {
      return fail(`Could not clear ${realOut} for --force: ${(e as Error).message}`);
    }
  }

  // The containment check above happens once, and the writes happen after a walk that can take
  // minutes. That gap is real: a concurrent clean, or a second capture with the same id, can replace
  // this directory with a link while the browser is still working. So every write re-asserts that
  // the path it is about to use is still the directory that was proved, rather than trusting a
  // string captured before the walk started.
  const write = async (name: string, data: string | Uint8Array) => {
    if (!isWritableCaptureFile(name)) throw new Error(`refusing to write ${name}: not an allowed capture file`);
    const stillReal = await realpath(realOut).catch(() => null);
    if (stillReal !== realOut || !isInside(realArtifacts, realOut)) {
      throw new Error(`refusing to write ${name}: ${outDir} is no longer the directory that was checked`);
    }
    await writeFile(join(realOut, name), data);
  };

  // --- teardown, registered as we go, run exactly once on every path ---------------------------
  const teardown: Array<() => void | Promise<void>> = [];
  let tornDown = false;
  // Set by the signal handler and read at the top of every step. Without it the handler tears the
  // browser down underneath a walk that is still calling goto and screenshot against it, and the
  // resulting throw races the handler's own exit for which code the process actually reports.
  let aborted = false;
  const runTeardown = async () => {
    if (tornDown) return;
    tornDown = true;
    // toReversed, not reverse: the guard above makes a second call a no-op today, and a teardown
    // list that quietly reorders itself is the kind of thing that stops being true later.
    for (const fn of teardown.toReversed()) { try { await fn(); } catch { /* nothing to do about it */ } }
  };
  const onSignal = () => { aborted = true; void runTeardown().then(() => process.exit(130)); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    // --- the project ---------------------------------------------------------------------------
    let startedProject: string | null = null;
    if (await targetIsUp(config.previewTarget)) {
      log(`[capture] ${config.previewTarget} is already answering; leaving it alone.`);
    } else if (config.previewCommand) {
      log(`[capture] ${config.previewTarget} is not answering. Starting: ${config.previewCommand}`);
      const proc = startProject(config.previewCommand, config.previewCommandCwd);
      teardown.push(() => stopProject(proc));   // awaited by runTeardown, which awaits every entry
      const up = await waitForTarget(config.previewTarget, opts.startTimeoutMs ?? 90_000, () => proc.child.exitCode !== null);
      if (!up) {
        const why = proc.child.exitCode !== null
          ? `the command exited with code ${proc.child.exitCode} before the target answered`
          : `the target did not answer within the timeout`;
        return fail(`Could not bring ${config.previewTarget} up: ${why}.\ncommand: ${config.previewCommand}\ncwd: ${config.previewCommandCwd}\nlast output:\n${proc.log.slice(-20).map((l) => "  " + l).join("\n") || "  (nothing)"}`);
      }
      startedProject = config.previewCommand;
      log(`[capture] target is up.`);
    } else {
      return fail(`Nothing is answering on ${config.previewTarget}, and no previewCommand is configured, so capture will not guess how to start your project.\nEither start it yourself and run this again, or add previewCommand to pantry.config.json:\n  "previewCommand": "bun run start",\n  "previewCommandCwd": "../the-project"`);
    }

    // --- PANTRY itself, on an ephemeral port ------------------------------------------------------
    // Port 0 rather than 4400: capture is meant to be runnable while a `pantry serve` is already up
    // for the live review, and taking its port would make the two mutually exclusive for no reason.
    const { servePantryFromCwd } = await import("./app.ts");
    const { server } = await servePantryFromCwd({ cwd: config.cwd, port: 0, previewTarget: config.previewTarget });
    // Awaited, like the browser close below it. stop() returns a promise, and a teardown entry that
    // drops it lets the run report itself finished while the port is still closing, and lets a
    // rejection surface later with nothing to attribute it to.
    teardown.push(async () => { await server.stop(true); });
    const via = server.url.origin;
    log(`[capture] PANTRY on ${via}, proxying ${config.previewTarget}`);

    // --- the browser -----------------------------------------------------------------------------
    let browser: any;
    try {
      browser = await chromium.launch({ headless: true });
    } catch (e) {
      return fail(`${driver.package} is installed but its browser is not: ${(e as Error).message}\n  bunx playwright install chromium`);
    }
    teardown.push(async () => { await browser.close(); });
    const page = await browser.newPage({ viewport: VIEWPORT, reducedMotion: "reduce" });

    // CSS motion off, on every document. Not cosmetic: a headless page whose transitions are
    // mid-flight photographs as the transition's START, which reads exactly like a broken layout.
    // The same property bit the last run's measurement of the lamp. This reaches CSS transitions and
    // animations and nothing else: the Web Animations API, a requestAnimationFrame loop, a video and
    // an animated GIF all keep moving, and the manifest says css-disabled rather than disabled so the
    // field does not promise more than a stylesheet can deliver.
    await page.addInitScript(() => {
      const css = "*,*::before,*::after{transition:none !important;animation:none !important;caret-color:transparent !important}";
      const apply = () => {
        const style = document.createElement("style");
        style.setAttribute("data-pantry-capture", "");
        style.textContent = css;
        document.head?.appendChild(style);
      };
      if (document.head) apply();
      else document.addEventListener("DOMContentLoaded", apply, { once: true });
    });

    // --- the walk ----------------------------------------------------------------------------------
    const steps: CapturedStep[] = [];
    let here = { pathname: "", search: "", hash: "" };
    let loadedAnything = false;

    for (const [index, step] of tour.steps.entries()) {
      if (aborted) break;
      const target = step.at ?? (loadedAnything ? null : (tour.route ?? "/"));
      let navigated = false;
      if (target !== null && (!loadedAnything || needsNavigation(target, here))) {
        const url = new URL(target, via).toString();
        try {
          await page.goto(url, { waitUntil: "load", timeout: 30_000 });
        } catch (e) {
          steps.push({
            index, surface: step.surface, at: step.at, status: step.status, verify: step.verify,
            // navigated is FALSE here and the url is the one that was asked for, not one that was
            // reached. The first version said true and called the requested string "the URL actually
            // loaded", which are two fields lying in agreement with each other about a page the
            // browser never got to.
            url, navigated: false, verdict: "missing", matches: 0, box: null, page: null, element: null,
            problem: `The route did not load: ${(e as Error).message}`,
          });
          continue;
        }
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        navigated = true;
        loadedAnything = true;
        const u = new URL(page.url());
        here = { pathname: u.pathname, search: u.search, hash: u.hash };
      }

      const selector = surfaceSelector(step.surface);
      const locator = page.locator(selector);
      // Read once, at measurement time, and reported as the step's URL. Taking it again after the
      // screenshots would let a delayed client-side redirect put a different address on a verdict
      // that was decided on the previous page.
      const measuredAt = page.url();
      const matches = await locator.count();
      const box: Box | null = matches === 1 ? await locator.first().boundingBox() : null;
      const verdict = classifyMatch(matches, box);
      const stem = stepFileStem(index, step.surface);

      // The page shot is taken whether or not the step passed, because on a failure it is the only
      // record of what the page looked like when the address was not there.
      let pageShot: string | null = `${stem}.png`;
      try {
        await write(pageShot, await page.screenshot({ fullPage: true }));
      } catch { pageShot = null; }

      let elementShot: string | null = null;
      if (verdict === "ok") {
        elementShot = `${stem}-element.png`;
        try {
          await write(elementShot, await locator.first().screenshot());
        } catch { elementShot = null; }
      }

      steps.push({
        index, surface: step.surface, at: step.at, status: step.status, verify: step.verify,
        url: measuredAt, navigated, verdict, matches, box,
        page: pageShot, element: elementShot,
        problem: problemFor(verdict, step.surface, matches, measuredAt),
      });
      log(`[capture] ${index + 1}/${tour.steps.length} ${step.surface}: ${verdict}${verdict === "ok" ? "" : ` (${matches} ${matches === 1 ? "match" : "matches"})`}`);
    }

    const failures = steps.filter((s) => s.verdict !== "ok").length;
    const manifest: CaptureManifest = {
      tour: tour.id, title: tour.title, mode: tour.mode,
      capturedAt: new Date().toISOString(),
      previewTarget: config.previewTarget,
      via,
      startedProject,
      viewport: VIEWPORT,
      motion: "css-disabled",
      driver: { package: driver.package!, path: driver.path!, version: driverVersion },
      steps,
      failures,
    };
    await write("capture.json", JSON.stringify(manifest, null, 2) + "\n");
    await write("README.md", formatCaptureIndex(manifest));

    return { ok: failures === 0, dir: realOut, manifest, fatal: null };
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await runTeardown();
  }
}

/** What the CLI prints when it is over. */
export function formatCaptureResult(r: CaptureResult): string {
  if (r.fatal) return r.fatal;
  const m = r.manifest!;
  const head = m.failures === 0
    ? `Captured ${m.steps.length} steps, all resolved.`
    : `Captured ${m.steps.length} steps, ${m.failures} FAILED.`;
  const body = m.steps
    .filter((s) => s.verdict !== "ok")
    .map((s) => `  step ${s.index + 1} ${s.surface}: ${s.verdict} — ${s.problem}`)
    .join("\n");
  return [head, body, `Evidence: ${r.dir}`].filter(Boolean).join("\n");
}
