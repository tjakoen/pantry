// pantry/capture.test.ts — P4d. Most of what capture decides is pure, and that is deliberate: the
// three failing verdicts are the branches nobody exercises by hand, and a harness whose failure paths
// are untested is a harness that reports success.
//
// The end-to-end walk is NOT here. It needs a browser, a built Next app and two processes, so it
// lives in the run report as a walked proof rather than in `bun test`. What IS here is the rules that
// decide whether the walk is allowed to start, where it is allowed to write, and what it calls a
// pass. Two gates are honestly NOT covered and saying so is cheaper than a claim of completeness
// that decays: the two branches where a resolved Playwright imports but exports no chromium, or
// throws on import, need a broken install to reach and are left to the message they print.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CAPTURE_WRITE_EXTS, captureDirName, classifyMatch, formatCaptureIndex, formatCaptureResult,
  isWritableCaptureFile, problemFor, resolveDriver, runCapture, stepFileStem,
  surfaceSelector, targetIsUp, waitForTarget, type CaptureManifest,
} from "./capture.ts";
import type { ResolvedPantryConfig } from "./config.ts";
import { DEFAULT_HYGIENE } from "./hygiene.ts";
import { DEFAULT_CONTEXT_BUDGET } from "./context.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pantry-capture-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const cfg = (over: Partial<ResolvedPantryConfig> = {}): ResolvedPantryConfig => ({
  // The HOST is this repo, so the driver resolves: pantry carries @playwright/test for its own
  // tests, and here pantry really IS the host. Every path the config points at is still the temp
  // dir, so nothing is written into the repo.
  cwd: import.meta.dir,
  projectName: "t",
  plansDir: join(dir, "plans"),
  docsDirs: [],
  graphPath: null,
  graphDir: join(dir, "graphify-out"),
  decisionsDir: join(dir, "plans", "decisions"),
  answersLog: join(dir, "plans", "decisions", "answers.jsonl"),
  artifactsDir: join(dir, "artifacts"),
  runsDir: join(dir, "artifacts", "runs"),
  previewTarget: null,
  previewCommand: null,
  previewCommandCwd: dir,
  toursDir: null,
  hygiene: DEFAULT_HYGIENE,
  contextBudgetChars: DEFAULT_CONTEXT_BUDGET,
  surfaces: { plans: true, docs: true, reference: true, catalog: true, standards: true, decisions: true, artifacts: true, timeline: true, runs: true },
  ...over,
});

const writeTour = (body: string, id = "t1") => {
  const tours = join(dir, "tours");
  mkdirSync(tours, { recursive: true });
  writeFileSync(join(tours, `${id}.md`), body);
  return tours;
};

const GOOD_TOUR = `---
id: t1
mode: dev
title: "A tour"
route: /
---
Intro.

## page:home
- at: /
- status: new
- review: what changed
- verify: the thing is there
Say something.
`;

describe("naming", () => {
  test("the capture dir is date first, tour id after", () => {
    expect(captureDirName("review-tier1-nongrain", new Date("2026-08-10T09:00:00Z")))
      .toBe("2026-08-10-review-tier1-nongrain");
  });

  test("two tours captured the same day do not collide", () => {
    const when = new Date("2026-08-10T09:00:00Z");
    expect(captureDirName("a", when)).not.toBe(captureDirName("b", when));
  });

  test("a step stem is one-based and zero-padded, so ten steps sort right", () => {
    expect(stepFileStem(0, "page:tickets")).toBe("01-page-tickets");
    expect(stepFileStem(9, "ticket:refund-state")).toBe("10-ticket-refund-state");
  });

  test("a surface of nothing but punctuation still yields a usable stem", () => {
    expect(stepFileStem(0, ":::")).toBe("01-surface");
  });
});

describe("the selector", () => {
  test("a plain address", () => {
    expect(surfaceSelector("ticket:refund-state")).toBe('[data-surface="ticket:refund-state"]');
  });

  // Grain's surface vocabulary cannot carry a quote today. The day it can, the failure mode of an
  // unescaped selector is not an error: it is a selector that matches something else.
  test("a quote in an address is escaped rather than closing the selector", () => {
    expect(surfaceSelector('a"b')).toBe('[data-surface="a\\"b"]');
    expect(surfaceSelector("a\\b")).toBe('[data-surface="a\\\\b"]');
  });
});

describe("the verdict", () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };

  test("one visible match is the only pass", () => {
    expect(classifyMatch(1, box)).toBe("ok");
  });

  test("no match is missing", () => {
    expect(classifyMatch(0, null)).toBe("missing");
  });

  // The failure the plan rejected selectors to avoid, arriving through an attribute instead: an
  // address on a component that appears on six routes resolves to whichever copy the query hits.
  test("more than one match is ambiguous, not a pass on the first one", () => {
    expect(classifyMatch(2, box)).toBe("ambiguous");
    expect(classifyMatch(7, box)).toBe("ambiguous");
  });

  test("a match with no box is not-visible", () => {
    expect(classifyMatch(1, null)).toBe("not-visible");
  });

  test("a zero-area box is not-visible, because a blank crop labelled with a surface looks like evidence", () => {
    expect(classifyMatch(1, { x: 0, y: 0, width: 0, height: 12 })).toBe("not-visible");
    expect(classifyMatch(1, { x: 0, y: 0, width: 12, height: 0 })).toBe("not-visible");
  });

  test("a pass carries no problem sentence and every failure carries one", () => {
    expect(problemFor("ok", "x", 1, "http://h/")).toBeNull();
    for (const v of ["missing", "ambiguous", "not-visible"] as const) {
      const s = problemFor(v, "ticket:total", 3, "http://h/x");
      expect(s).toBeTruthy();
      expect(s).toContain("ticket:total");
      expect(s).toContain("http://h/x");
    }
  });

  test("the ambiguous sentence says how many, because the number is the whole story", () => {
    expect(problemFor("ambiguous", "s", 6, "http://h/")).toContain("6 elements");
  });
});

describe("where it may write", () => {
  test("the allowlist is two log-ish extensions plus the images", () => {
    expect([...CAPTURE_WRITE_EXTS].toSorted()).toEqual([".json", ".md", ".png"]);
  });

  test("allowed names", () => {
    expect(isWritableCaptureFile("01-page-home.png")).toBe(true);
    expect(isWritableCaptureFile("capture.json")).toBe(true);
    expect(isWritableCaptureFile("README.md")).toBe(true);
  });

  // The P2 lesson, restated: a denylist of what must not be written cannot be finished.
  test("anything not on the allowlist is refused, extension by extension", () => {
    for (const bad of ["x.ts", "x.json.ts", "package.json.bak", "x", ".env", "x.sh", "x.mjs"]) {
      expect(isWritableCaptureFile(bad)).toBe(false);
    }
  });

  test("a separator or a traversal in the name is refused before the extension is even considered", () => {
    for (const bad of ["../x.png", "a/b.png", "a\\b.png", "..", "."]) {
      expect(isWritableCaptureFile(bad)).toBe(false);
    }
  });

  // The containment rule itself moved to paths.ts and is tested in paths.test.ts. What stays here is
  // that capture APPLIES it to the dir it is about to write into — asserted by runCapture's own
  // tests below, not by re-testing the predicate in two files.
});

describe("the driver, borrowed and never owned", () => {
  // The false green with a long fuse: PANTRY carries @playwright/test as a devDependency, so
  // resolving from PANTRY's own node_modules would satisfy every host during development and none
  // of them the day PANTRY installs as a git dependency, which strips devDependencies.
  // A host that sits INSIDE the pantry checkout is the only way to reach the guard: resolution walks
  // up from the host, so an unrelated temp dir simply finds nothing and never gets there.
  const insidePantry = join(import.meta.dir, "tools");

  test("PANTRY's own playwright does not count as the host's", () => {
    const r = resolveDriver(insidePantry, import.meta.dir);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("bun add -d @playwright/test");
    expect(r.message).toContain("playwright install chromium");
  });

  test("the refusal says WHY, so the message is not read as 'you have no playwright'", () => {
    const r = resolveDriver(insidePantry, import.meta.dir);
    expect(r.message).toContain("PANTRY's own node_modules");
  });

  test("a host with nothing installed anywhere above it gets the plain install message", () => {
    const r = resolveDriver(dir, import.meta.dir);   // dir is an empty temp host
    expect(r.ok).toBe(false);
    expect(r.message).toContain("bun add -d @playwright/test");
    expect(r.message).not.toContain("PANTRY's own node_modules");
  });

  test("when the host IS pantry there is nothing to refuse", () => {
    const r = resolveDriver(import.meta.dir, import.meta.dir);
    expect(r.ok).toBe(true);
    expect(resolve(r.path!).startsWith(resolve(import.meta.dir))).toBe(true);
  });
});

describe("waiting for the target", () => {
  test("nothing listening is not up", async () => {
    // Port 1 on loopback: reserved, and nothing a dev machine ever binds.
    expect(await targetIsUp("http://127.0.0.1:1", 300)).toBe(false);
  });

  test("a server that answers 404 is still up, because the question is whether one is listening", async () => {
    const s = Bun.serve({ port: 0, fetch: () => new Response("no", { status: 404 }) });
    try {
      expect(await targetIsUp(s.url.origin, 2000)).toBe(true);
    } finally { s.stop(true); }
  });

  // The P3 bug, in the module that would repeat it: a NaN deadline is never past and a NaN sleep
  // returns instantly, which is a silent hot loop with no error and no exit.
  test("a non-numeric timeout does not become an unbounded hot loop", async () => {
    const started = Date.now();
    const ok = await waitForTarget("http://127.0.0.1:1", Number.NaN, () => Date.now() - started > 800);
    expect(ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test("the cancel predicate ends the wait without waiting out the budget", async () => {
    const started = Date.now();
    const ok = await waitForTarget("http://127.0.0.1:1", 60_000, () => true);
    expect(ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("everything that is refused before a browser is launched", () => {
  test("no toursDir", async () => {
    const r = await runCapture({ config: cfg(), tourId: "t1", log: () => {} });
    expect(r.ok).toBe(false);
    expect(r.fatal).toContain("toursDir");
  });

  test("an unknown tour id", async () => {
    const toursDir = writeTour(GOOD_TOUR);
    const r = await runCapture({ config: cfg({ toursDir }), tourId: "nope", log: () => {} });
    expect(r.fatal).toContain('No tour "nope"');
  });

  // Refused rather than warned: a tour whose steps did not parse cleanly is a tour whose addresses
  // may not be the ones the author wrote, and capture's entire value is that its addresses are real.
  test("a tour with parse errors is refused, not walked best-effort", async () => {
    const toursDir = writeTour(`---\nid: t2\nmode: banana\ntitle: "x"\n---\n\n## page:home\n- at: /\nSay.\n`, "t2");
    const r = await runCapture({ config: cfg({ toursDir }), tourId: "t2", log: () => {} });
    expect(r.ok).toBe(false);
    expect(r.fatal).toContain("parse errors");
  });

  // A tour with no steps is caught by the PARSER, not by a second check here. Asserted rather than
  // assumed, because the obvious belt-and-braces version of this in capture.ts was unreachable code
  // that read like a real guard.
  test("a tour with no steps is refused, and it is the parser that says so", async () => {
    const toursDir = writeTour(`---\nid: t3\nmode: dev\ntitle: "x"\nroute: /\n---\n\nJust prose.\n`, "t3");
    const r = await runCapture({ config: cfg({ toursDir }), tourId: "t3", log: () => {} });
    expect(r.ok).toBe(false);
    expect(r.fatal).toContain("parse errors");
    expect(r.fatal).toContain("steps");
  });

  test("no previewTarget, and the message names both ways to set one", async () => {
    const toursDir = writeTour(GOOD_TOUR);
    const r = await runCapture({ config: cfg({ toursDir }), tourId: "t1", log: () => {} });
    expect(r.fatal).toContain("previewTarget");
    expect(r.fatal).toContain("--preview");
  });

  test("nothing answering and no previewCommand: capture will not guess how to start a project", async () => {
    const toursDir = writeTour(GOOD_TOUR);
    const r = await runCapture({
      config: cfg({ toursDir, previewTarget: "http://127.0.0.1:1" }),
      tourId: "t1", log: () => {}, pantryDir: dir,
    });
    expect(r.ok).toBe(false);
    expect(r.fatal).toContain("previewCommand");
    expect(r.fatal).toContain("will not guess");
  });

  test("a previewCommand that exits without ever answering fails with its own output attached", async () => {
    const toursDir = writeTour(GOOD_TOUR);
    const r = await runCapture({
      config: cfg({
        toursDir,
        previewTarget: "http://127.0.0.1:1",
        previewCommand: "echo 'boom: could not bind' >&2; exit 3",
      }),
      tourId: "t1", startTimeoutMs: 10_000, log: () => {}, pantryDir: dir,
    });
    expect(r.ok).toBe(false);
    expect(r.fatal).toContain("exited with code 3");
    expect(r.fatal).toContain("boom: could not bind");
  });

  // The driver refusal reaches runCapture and not only resolveDriver. Added because the block's own
  // name claims to cover everything refused before a browser launches, and this gate was tested one
  // level down instead of here.
  test("no driver: the walk never starts, and the message is the install one", async () => {
    const toursDir = writeTour(GOOD_TOUR);
    const r = await runCapture({
      // A host with nothing above it: dir is a temp dir with no node_modules anywhere on its way up.
      config: cfg({ cwd: dir, toursDir, previewTarget: "http://127.0.0.1:1" }),
      tourId: "t1", log: () => {}, pantryDir: import.meta.dir,
    });
    expect(r.ok).toBe(false);
    expect(r.dir).toBeNull();
    expect(r.fatal).toContain("does not ship one");
  });

  test("a capture id that is not a plain folder name", async () => {
    const toursDir = writeTour(GOOD_TOUR);
    const r = await runCapture({
      config: cfg({ toursDir, previewTarget: "http://127.0.0.1:1" }),
      tourId: "t1", id: "../escape", log: () => {}, pantryDir: dir,
    });
    expect(r.fatal).toContain("not a plain folder name");
  });
});

describe("the capture dir", () => {
  const upstream = () => Bun.serve({ port: 0, fetch: () => new Response("<html><body>hi</body></html>", { headers: { "content-type": "text/html" } }) });

  test("a reviews dir that is a symlink out of artifacts is refused", async () => {
    const toursDir = writeTour(GOOD_TOUR);
    const artifactsDir = join(dir, "artifacts");
    const elsewhere = join(dir, "elsewhere");
    mkdirSync(artifactsDir, { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    symlinkSync(elsewhere, join(artifactsDir, "reviews"));
    const s = upstream();
    try {
      const r = await runCapture({
        config: cfg({ toursDir, artifactsDir, previewTarget: s.url.origin }),
        tourId: "t1", log: () => {}, pantryDir: dir,
      });
      expect(r.ok).toBe(false);
      expect(r.fatal).toContain("outside");
    } finally { s.stop(true); }
  });

  test("an existing capture dir is refused rather than mixed with a second run's evidence", async () => {
    const toursDir = writeTour(GOOD_TOUR);
    const artifactsDir = join(dir, "artifacts");
    mkdirSync(join(artifactsDir, "reviews", "mine"), { recursive: true });
    writeFileSync(join(artifactsDir, "reviews", "mine", "01-old.png"), "stale");
    const s = upstream();
    try {
      const r = await runCapture({
        config: cfg({ toursDir, artifactsDir, previewTarget: s.url.origin }),
        tourId: "t1", id: "mine", log: () => {}, pantryDir: dir,
      });
      expect(r.ok).toBe(false);
      expect(r.fatal).toContain("--force");
    } finally { s.stop(true); }
  });
});

describe("the index a human reads cold", () => {
  const manifest = (over: Partial<CaptureManifest> = {}): CaptureManifest => ({
    tour: "t1", title: "A tour", mode: "dev",
    capturedAt: "2026-08-10T09:00:00.000Z",
    previewTarget: "http://localhost:5210",
    via: "http://localhost:54321",
    startedProject: "bun run start",
    viewport: { width: 1280, height: 800 },
    motion: "css-disabled",
    driver: { package: "playwright", path: "/x/playwright", version: "1.61.1" },
    steps: [{
      index: 0, surface: "page:home", at: "/", status: "new", verify: "look",
      url: "http://localhost:54321/", navigated: true, verdict: "ok", matches: 1,
      box: { x: 1, y: 2, width: 3, height: 4 }, page: "01-page-home.png",
      element: "01-page-home-element.png", problem: null,
    }],
    failures: 0,
    ...over,
  });

  test("a clean run says so and names every shot", () => {
    const md = formatCaptureIndex(manifest());
    expect(md).toContain("All 1 steps resolved.");
    expect(md).toContain("01-page-home.png");
    expect(md).toContain("01-page-home-element.png");
  });

  test("it says which origin the pixels came from, because a proxied shot is not a direct one", () => {
    const md = formatCaptureIndex(manifest());
    expect(md).toContain("http://localhost:5210");
    expect(md).toContain("http://localhost:54321");
  });

  test("motion being off is stated, because it changes the pixels", () => {
    expect(formatCaptureIndex(manifest())).toContain("CSS transitions and animations are off");
  });

  // Two claims that were overclaims first time round and are now bounded in the text a reviewer
  // reads, which is the only place the bound does any good.
  test("the index says what the shot's box is NOT, because the live embed is narrower", () => {
    const md = formatCaptureIndex(manifest());
    expect(md).toContain("The box is not the review's");
    expect(md).toContain("narrower");
  });

  test("the index says which motion it cannot stop, rather than claiming a settled page", () => {
    expect(formatCaptureIndex(manifest())).toContain("script, video or an animated image");
  });

  test("a failing run leads with the failures rather than burying them under the passes", () => {
    const m = manifest({
      failures: 1,
      steps: [{
        index: 0, surface: "ticket:total", at: "/x", status: null, verify: null,
        url: "http://localhost:54321/x", navigated: true, verdict: "ambiguous", matches: 4,
        box: null, page: "01-ticket-total.png", element: null,
        problem: "4 elements carry data-surface=\"ticket:total\"",
      }],
    });
    const md = formatCaptureIndex(m);
    expect(md.indexOf("1 of 1 steps failed")).toBeLessThan(md.indexOf("## Steps"));
    expect(md).toContain("ambiguous");
  });

  test("the printed result of a failing run names each failure on its own line", () => {
    const m = manifest({
      failures: 1,
      steps: [{
        index: 1, surface: "ticket:total", at: null, status: null, verify: null,
        url: "u", navigated: false, verdict: "missing", matches: 0, box: null,
        page: null, element: null, problem: "not there",
      }],
    });
    const out = formatCaptureResult({ ok: false, dir: "/d", manifest: m, fatal: null });
    expect(out).toContain("1 FAILED");
    expect(out).toContain("step 2 ticket:total: missing");
    expect(out).toContain("/d");
  });

  test("a fatal result prints the fatal and nothing else", () => {
    expect(formatCaptureResult({ ok: false, dir: null, manifest: null, fatal: "no tours" })).toBe("no tours");
  });
});
