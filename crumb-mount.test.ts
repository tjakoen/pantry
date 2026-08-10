// pantry/crumb-mount.test.ts — Tier 1 (plans/pantry-review-layer.md P4): PANTRY carrying CRUMB into
// a project that has never heard of it.
//
// The claims under test are deliberately narrow, because the interesting failures here are all of the
// same kind — something that is true of a GRAIN host being assumed of every host:
//   - the tour DATA comes from crumb's own parser, mounted under PANTRY's prefix;
//   - the client's ONE absolute import is moved onto that prefix, so the spotlight is fetched from
//     PANTRY and not from the reviewed app, which has never heard of it either;
//   - and a page that already runs CRUMB gets nothing added, because two clients on one page drive
//     the same sessionStorage key from two places.
//
// The drift guard is the load-bearing one. `rebaseCrumbLive` moves a single specifier by name; the
// day crumb grows a second absolute import, that rebase silently stops being complete and the symptom
// is a 404 fired at the reviewed app. So the real package file is read here and asserted against.
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PANTRY_PREFIX, rebaseCrumbLive, crumbLiveAbsoluteImports, pageAlreadyRunsCrumb, stripMetaCsp, spotlightRulesOnly,
  proxyToPreview, isDocumentRequest, CRUMB_SPOTLIGHT_IMPORT,
} from "./preview.ts";
import { createPantryHandler, resolveToursSource } from "./app.ts";
import type { ResolvedPantryConfig } from "./config.ts";
import { DEFAULT_HYGIENE } from "./hygiene.ts";

const CRUMB_LIVE_JS = fileURLToPath(import.meta.resolve("@tjakoen/crumb/crumb-live.js"));

describe("the transforms Tier 1 adds", () => {
  test("CRUMB's one absolute import moves onto PANTRY's prefix", () => {
    const js = `import { createSpotlight } from "${CRUMB_SPOTLIGHT_IMPORT}";\nconst a = 1;`;
    const out = rebaseCrumbLive(js, PANTRY_PREFIX);
    expect(out).toContain(`from "${PANTRY_PREFIX}${CRUMB_SPOTLIGHT_IMPORT}"`);
    expect(out).toContain("const a = 1;");   // nothing else touched
  });

  test("an empty base is a no-op, so a GRAIN host serving CRUMB itself is byte-identical", () => {
    const js = `import { createSpotlight } from "${CRUMB_SPOTLIGHT_IMPORT}";`;
    expect(rebaseCrumbLive(js, "")).toBe(js);
  });

  // The guard, against the real file rather than a fixture. A fixture would keep passing forever
  // while the package it stands in for grew a second import.
  test("crumb-live.js still has EXACTLY the one absolute import the rebase knows how to move", async () => {
    const js = await Bun.file(CRUMB_LIVE_JS).text();
    expect(crumbLiveAbsoluteImports(js)).toEqual([CRUMB_SPOTLIGHT_IMPORT]);
  });

  test("the absolute-import scan sees the three shapes an import can take, and ignores bare specifiers", () => {
    const js = `import a from "/one.js";\nimport "/two.js";\nawait import("/three.js");\nimport b from "pkg";\nimport c from "./rel.js";`;
    expect(crumbLiveAbsoluteImports(js).toSorted()).toEqual(["/one.js", "/three.js", "/two.js"]);
  });

  test("a page already running CRUMB is recognised, whatever path it serves the client from", () => {
    expect(pageAlreadyRunsCrumb(`<script type="module" src="/crumb-live.js"></script>`)).toBe(true);
    expect(pageAlreadyRunsCrumb(`<script type='module' src='/assets/crumb-live.js?v=2'></script>`)).toBe(true);
    expect(pageAlreadyRunsCrumb(`<script src="/app.js"></script>`)).toBe(false);
    // The word in prose is not a script tag, and treating it as one would silently disable Tier 1
    // on any page that happens to document the thing it is being reviewed for.
    expect(pageAlreadyRunsCrumb(`<p>we load crumb-live.js on the docs site</p>`)).toBe(false);
  });

  // A production build hashes its asset names. Missing that gave a GRAIN host with a bundler TWO tour
  // clients on one page, driving the same sessionStorage key from two places.
  test("a bundled, hashed filename is still CRUMB", () => {
    expect(pageAlreadyRunsCrumb(`<script type="module" src="/_next/static/chunks/crumb-live.8f3a91c2.js"></script>`)).toBe(true);
    expect(pageAlreadyRunsCrumb(`<script type="module" src="/assets/crumb-live-DkP2x9.js"></script>`)).toBe(true);
    // and a name that merely ENDS the same way is not it
    expect(pageAlreadyRunsCrumb(`<script src="/vendor/not-crumb-liveness.js"></script>`)).toBe(false);
  });

  // The other direction, and the worse one: a false positive makes PANTRY withhold its client, so
  // Tier 1 vanishes with nothing on screen to say why.
  test("a commented-out or inert script tag is not a running CRUMB", () => {
    expect(pageAlreadyRunsCrumb(`<!-- <script type="module" src="/crumb-live.js"></script> -->`)).toBe(false);
    expect(pageAlreadyRunsCrumb(`<script type="text/plain" src="/crumb-live.js"></script>`)).toBe(false);
    expect(pageAlreadyRunsCrumb(`<script type="application/json" src="/crumb-live.js"></script>`)).toBe(false);
    // a real one after a commented-out one still counts
    expect(pageAlreadyRunsCrumb(`<!-- <script src="/crumb-live.js"></script> --><script src="/crumb-live.js"></script>`)).toBe(true);
  });

  test("a meta CSP is dropped, and other meta tags are not", () => {
    const html = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'self'"><meta name="viewport" content="width=device-width">`;
    const out = stripMetaCsp(html);
    expect(out).not.toContain("Content-Security-Policy");
    expect(out).toContain(`<meta charset="utf-8">`);
    expect(out).toContain(`name="viewport"`);
    expect(stripMetaCsp(`<meta http-equiv='content-security-policy-report-only' content="x">`)).toBe("");
  });

  // `[^>]*>` stops at the first bracket, and a CSP value may legally contain one. The naive version
  // cut the tag in half and left the rest as loose text in the head.
  test("a CSP value containing a raw bracket does not get the tag cut in half", () => {
    const html = `<head><meta http-equiv="Content-Security-Policy" content="script-src 3 > 2 self"><title>t</title></head>`;
    const out = stripMetaCsp(html);
    expect(out).toBe(`<head><title>t</title></head>`);
  });

  test("a meta tag whose CONTENT merely mentions the policy is left alone", () => {
    const html = `<meta name="note" content="we set http-equiv=Content-Security-Policy at the edge">`;
    expect(stripMetaCsp(html)).toBe(html);
  });
});

// The claim this replaces was that every rule in the composed sheet is scoped to names a foreign app
// does not use. A reviewer opened the file and found `html[data-xray] [data-surface]` — where
// `data-surface` is the one attribute PANTRY asks a project to add. The bound is enforced now.
describe("spotlightRulesOnly — the bound is removed, not asserted", () => {
  test("a rule that reaches for a data- attribute is dropped, and the lamp is kept", () => {
    const css = `.ai-lamp { position: fixed; }
html[data-xray] [data-surface] { outline: 1px dashed red; }
html[data-xray] [data-surface]::after { content: attr(data-xray-label); }
.ai-backdrop.is-on { opacity: 1; }
body[data-ai-online="false"] [data-ai-run] { pointer-events: none; }`;
    const out = spotlightRulesOnly(css);
    expect(out).toContain(".ai-lamp");
    expect(out).toContain(".ai-backdrop.is-on");
    expect(out).not.toContain("data-surface");
    expect(out).not.toContain("data-xray");
    expect(out).not.toContain("data-ai-run");
  });

  test("a nested at-rule is taken whole rather than cut at its first inner brace", () => {
    const css = `@media (prefers-reduced-motion: reduce) {\n  .ai-lamp { transition: none; }\n  .ai-backdrop { transition: none; }\n}\n.ai-spotlit { z-index: 3; }`;
    const out = spotlightRulesOnly(css);
    expect(out).toContain("@media (prefers-reduced-motion: reduce)");
    expect(out).toContain(".ai-backdrop { transition: none; }");
    expect(out).toContain(".ai-spotlit");
    // brace balance survived
    expect([...out].filter((c) => c === "{").length).toBe([...out].filter((c) => c === "}").length);
  });

  test("a data- attribute named in a COMMENT above a rule does not condemn the rule", () => {
    const css = `/* xray.js sets data-xray on <html> and stamps [data-surface] */\n.ai-lamp { position: fixed; }`;
    expect(spotlightRulesOnly(css)).toContain(".ai-lamp");
  });
});

// A tours folder in the REVIEWING repo — the arrangement Tier 1 exists for. The project below never
// hears about it.
const TOURS = mkdtempSync(join(tmpdir(), "pantry-tours-"));
writeFileSync(join(TOURS, "review-fixture.md"), `---
id: review-fixture
mode: dev
title: "Review: a project that never heard of CRUMB"
route: /
---
A walk written outside the project it reviews.

## ticket:refund-state
- at: /
- status: needs-verification
- review: The refund state is the one thing this change touches.
- verify: The badge reads "refunded" and nothing below it moved.
The ticket's refund badge.
`);

const PLANS = mkdtempSync(join(tmpdir(), "pantry-tours-plans-"));
writeFileSync(join(PLANS, "fixture.md"), `---\nid: fixture\nstatus: todo\n---\n\n# A plan\n\nBody.\n`);

const configWith = (previewTarget: string | null, toursDir: string | null): ResolvedPantryConfig => ({
  cwd: import.meta.dir, projectName: "test-project", plansDir: PLANS, docsDirs: [],
  graphPath: null, graphDir: join(import.meta.dir, "graphify-out"),
  decisionsDir: join(PLANS, "decisions"), answersLog: join(PLANS, "decisions", "answers.jsonl"),
  artifactsDir: join(import.meta.dir, "artifacts"), runsDir: join(import.meta.dir, "artifacts", "runs"),
  previewTarget, previewCommand: null, previewCommandCwd: import.meta.dir, toursDir,
  hygiene: DEFAULT_HYGIENE,
  surfaces: { plans: true, docs: false, reference: true, catalog: false, standards: false, decisions: true, artifacts: true, timeline: false, runs: true },
});

// The stand-in for a non-GRAIN project: a plain page, no CRUMB, and one route that DOES load a tour
// client so the "already running" branch is exercised against a real response rather than a string.
let target: ReturnType<typeof Bun.serve>;
let origin: string;
beforeAll(() => {
  target = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/already-crumb") {
        return new Response(`<!DOCTYPE html><html><body><script type="module" src="/crumb-live.js"></script></body></html>`,
          { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (url.pathname === "/cached-asset.js") {
        if (req.headers.get("if-none-match") === `"asset-1"`) return new Response(null, { status: 304, headers: { ETag: `"asset-1"` } });
        return new Response("export const a = 1;", {
          headers: { "Content-Type": "text/javascript", ETag: `"asset-1"`, "Cache-Control": "public, max-age=31536000, immutable" },
        });
      }
      if (url.pathname === "/meta-csp") {
        return new Response(`<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'self'"></head><body><p>t</p></body></html>`,
          { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      // A production build's headers, because those are what a review actually meets: a strong
      // validator plus a long lifetime, both describing bytes PANTRY is about to change.
      if (req.headers.get("if-none-match")) return new Response(null, { status: 304, headers: { ETag: `"page-1"` } });
      return new Response(`<!DOCTYPE html><html><head></head><body><p data-surface="ticket:refund-state">refunded</p></body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8", ETag: `"page-1"`, "Cache-Control": "s-maxage=31536000" } });
    },
  });
  origin = `http://localhost:${target.port}`;
});
afterAll(() => target.stop(true));

describe("the mount: PANTRY serves the tours the project does not", () => {
  test("the manifest comes from crumb's own parser, under PANTRY's prefix", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    const res = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/crumb/tours.json`));
    expect(res.status).toBe(200);
    const tours = await res.json();
    expect(tours).toEqual([{ id: "review-fixture", title: "Review: a project that never heard of CRUMB", mode: "dev", route: "/", steps: 1 }]);
  });

  test("one tour's full data carries the data-surface address the lamp lights", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    const res = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/crumb/tours/review-fixture.json`));
    expect(res.status).toBe(200);
    const tour = await res.json() as { steps: { surface: string; status: string }[] };
    expect(tour.steps[0]!.surface).toBe("ticket:refund-state");
    expect(tour.steps[0]!.status).toBe("needs-verification");
  });

  test("the client PANTRY serves fetches the spotlight from PANTRY, not from the reviewed app", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    const res = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/crumb-live.js`));
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain(`"${PANTRY_PREFIX}${CRUMB_SPOTLIGHT_IMPORT}"`);
    expect(crumbLiveAbsoluteImports(js)).toEqual([`${PANTRY_PREFIX}${CRUMB_SPOTLIGHT_IMPORT}`]);
  });

  test("the spotlight itself is there to be fetched — the rebase points at a real route", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    const res = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}${CRUMB_SPOTLIGHT_IMPORT}`));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("createSpotlight");
  });

  // The stylesheet is composed of three files in one order, and the reason each is there was found by
  // looking at a screen rather than at the code. Without GRAIN's tokens the card renders as
  // transparent text with no border; without ai.css the lamp is a static div in the body flow,
  // hundreds of pixels from the thing it claims to light, while the rest of the walk looks right.
  test("the tour stylesheet carries the tokens, the lamp and the card, in that cascade order", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    const res = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/tour.css`));
    expect(res.status).toBe(200);
    const css = await res.text();
    const tokens = css.indexOf("--ink:");
    const lamp = css.indexOf(".ai-lamp");
    const card = css.indexOf(".crumb-pop");
    expect(tokens).toBeGreaterThan(-1);
    expect(lamp).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(-1);
    expect(tokens).toBeLessThan(lamp);
    expect(lamp).toBeLessThan(card);
    // Rebased, or the font request in GRAIN's tokens is fired at the reviewed app's root.
    expect(css).toContain(`url("${PANTRY_PREFIX}/fonts/`);
  });

  // The claim the whole design rests on, checked against the real composed bytes rather than the
  // three files separately: nothing served here can match an element in an app that knows nothing
  // about GRAIN. `data-surface` is the sharp case, because Tier 1 asks the app to add exactly that.
  test("nothing in the served stylesheet can match an element in an app that never heard of GRAIN", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    const css = (await (await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/tour.css`))).text())
      .replace(/\/\*[\s\S]*?\*\//g, "");                       // comments are not rules
    expect(css).not.toContain("[data-surface]");
    expect(css).not.toContain("[data-ai-run]");
    expect(css).not.toContain("[data-xray]");
    // Every surviving selector must be scoped by something a foreign app cannot have: one of OUR
    // class prefixes, or a state attribute one of OUR layers sets on the document. The allowlist is
    // written out rather than inferred so that a new attribute has to be looked at by a person —
    // which is the step that was skipped when `[data-surface]` went through. The difference that
    // matters: `data-crumb-frame` is set by CRUMB, and `data-surface` is set by the reviewed app,
    // which is exactly why one is safe to gate on and the other is a leak.
    const OURS = ["data-crumb-frame", "data-crumb-prefix", "data-color-scheme", "data-theme", "data-mode"];
    const selectors = css.split("}").map((s) => s.slice(0, s.indexOf("{"))).filter((s) => s.trim());
    const reaching = selectors
      .flatMap((s) => s.split(","))
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("@") && !/^(from|to|\d+%)$/.test(s))
      .filter((s) => !s.startsWith(".") && !s.startsWith(":root") && !s.startsWith("html"))
      .filter((s) => !OURS.some((attr) => s.includes(`[${attr}`)));
    expect(reaching).toEqual([]);
    // And no attribute selector may STAND ALONE anywhere in a selector, which is the shape the leak
    // actually had: `html[data-xray] [data-surface]` passes a check on its first token and matches
    // any element the app labelled. An attribute hung off one of our classes
    // (`.crumb-pop__status[data-status="verified"]`) is a different thing and is fine.
    const loose = selectors
      .flatMap((s) => s.split(","))
      .flatMap((s) => s.trim().split(/[\s>+~]+/))
      .filter((part) => part.startsWith("["))
      .filter((part) => !OURS.some((attr) => part.startsWith(`[${attr}`)));
    expect(loose).toEqual([]);
  });

  test("with NO tours folder the mount does not exist at all, rather than 404ing per request", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, null) });
    const manifest = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/crumb/tours.json`));
    expect(manifest.status).toBe(404);
    const client = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/crumb-live.js`));
    expect(client.status).toBe(404);
    const css = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/tour.css`));
    expect(css.status).toBe(404);
  });
});

// Found by a change not appearing. A production build is what gets reviewed, on purpose, and a
// production build hands out long cache lifetimes and a strong ETag describing the UPSTREAM bytes.
// The moment PANTRY injects, that validator is a claim about something nobody served.
describe("caching: a page PANTRY changed must never be served from a cache", () => {
  test("an injected document is no-store, and its upstream validators are gone", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    const res = await handler(new Request("http://localhost:4400/", { headers: { accept: "text/html" } }));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("etag")).toBeNull();
    expect(res.headers.get("last-modified")).toBeNull();
  });

  test("a static asset keeps the caching the app shipped — only the injected page pays", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    const res = await handler(new Request("http://localhost:4400/cached-asset.js"));
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toBe(`"asset-1"`);
  });

  test("a conditional DOCUMENT request is stripped, so the target cannot answer 304 with no body to inject into", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    // The target below answers 304 to any If-None-Match. Getting 200 back with the tags in it is the
    // proof the condition never reached it — which is what unsticks a page cached by an earlier run.
    const res = await handler(new Request("http://localhost:4400/", {
      headers: { accept: "text/html", "if-none-match": `"stale"` },
    }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`${PANTRY_PREFIX}/crumb-live.js`);
  });

  test("a conditional request for an ASSET is passed through, because revalidation there is the app's business", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    const res = await handler(new Request("http://localhost:4400/cached-asset.js", {
      headers: { "if-none-match": `"asset-1"` },
    }));
    expect(res.status).toBe(304);
  });

  // A browser form submission carries `Accept: text/html` too. Stripping the precondition off a POST
  // turns `If-None-Match: *` — create only if absent — into an unconditional overwrite.
  test("a POST keeps its precondition, whatever it says it accepts back", () => {
    const post = new Request("http://localhost:4400/orders", {
      method: "POST", body: "x",
      headers: { accept: "text/html,application/xhtml+xml", "if-none-match": "*" },
    });
    expect(isDocumentRequest(post)).toBe(false);
  });

  test("Sec-Fetch-Dest decides where the browser sends it, because it says what the request IS", () => {
    const asset = new Request("http://localhost:4400/thing.json", {
      headers: { accept: "text/html,*/*", "sec-fetch-dest": "empty" },
    });
    expect(isDocumentRequest(asset)).toBe(false);
    const doc = new Request("http://localhost:4400/", { headers: { accept: "*/*", "sec-fetch-dest": "document" } });
    expect(isDocumentRequest(doc)).toBe(true);
    // the review shell's own frame is a document fetch as far as this is concerned
    const framed = new Request("http://localhost:4400/", { headers: { accept: "*/*", "sec-fetch-dest": "iframe" } });
    expect(isDocumentRequest(framed)).toBe(true);
  });
});

// This decision used to live in the browser, where no test in this repo could reach it, and it
// shipped wrong: the rail accepted any 2xx as proof the project served tours. An SPA catch-all
// answering `200 text/html` to every path satisfied that, so PANTRY's own tours were never tried and
// the rail reported that neither source had any.
describe("resolveToursSource — a status line is not a manifest", () => {
  const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

  test("the project wins when it really answers with a manifest", async () => {
    const fake = (async () => jsonRes([{ id: "a", title: "A", mode: "dev", route: "/", steps: 1 }])) as unknown as typeof fetch;
    expect(await resolveToursSource("http://localhost:1", true, fake)).toBe("project");
  });

  test("an SPA catch-all answering 200 text/html is NOT a manifest", async () => {
    const fake = (async () => new Response("<!DOCTYPE html><html><body>app</body></html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })) as unknown as typeof fetch;
    expect(await resolveToursSource("http://localhost:1", true, fake)).toBe("pantry");
  });

  test("a 200 with a JSON content type but a body that is not an array is NOT a manifest", async () => {
    const fake = (async () => jsonRes({ error: "nope" })) as unknown as typeof fetch;
    expect(await resolveToursSource("http://localhost:1", true, fake)).toBe("pantry");
  });

  test("a 200 claiming JSON with a body that does not parse is NOT a manifest", async () => {
    const fake = (async () => new Response("<html>", { headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    expect(await resolveToursSource("http://localhost:1", true, fake)).toBe("pantry");
  });

  test("an unreachable project falls back rather than throwing", async () => {
    const fake = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    expect(await resolveToursSource("http://localhost:1", true, fake)).toBe("pantry");
  });

  test("with no tours anywhere the answer is none, which the rail says out loud", async () => {
    const fake = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    expect(await resolveToursSource("http://localhost:1", false, fake)).toBe("none");
  });

  // Every cockpit link in the rail carried the prefix already, and PANTRY rebases its own
  // root-absolute hrefs on the way out, so every one of them 404'd at /__pantry/__pantry/…. It had
  // been that way since P1; the header nav beside it was always right, which is why it survived.
  test("the rail's cockpit links are rebased exactly once", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    const html = await (await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/review`))).text();
    expect(html).not.toContain(`${PANTRY_PREFIX}${PANTRY_PREFIX}`);
    for (const surface of ["plans", "runs", "decisions", "answers", "artifacts"]) {
      expect(html).toContain(`href="${PANTRY_PREFIX}/${surface}"`);
    }
  });

  test("the review shell stamps the resolved source, so the client discovers nothing", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    const html = await (await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/review`))).text();
    // the fixture target serves no /crumb, so PANTRY's own mount is the answer
    expect(html).toContain(`data-tours-base="${PANTRY_PREFIX}/crumb"`);
    expect(html).toContain(`data-tours-source="pantry"`);
  });
});

describe("the injection: what a proxied page gets, and what it does not", () => {
  test("a project with no CRUMB gets the stylesheet, the prefix and the client", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    const res = await handler(new Request("http://localhost:4400/"));
    const html = await res.text();
    expect(html).toContain(`<link rel="stylesheet" href="${PANTRY_PREFIX}/tour.css">`);
    expect(html).toContain(`document.documentElement.dataset.crumbPrefix="${PANTRY_PREFIX}/crumb"`);
    expect(html).toContain(`<script type="module" src="${PANTRY_PREFIX}/crumb-live.js"></script>`);
    expect(html).toContain(`${PANTRY_PREFIX}/pantry-review-client.js`);
    // The app's own markup is untouched, which is the promise the whole proxy rests on.
    expect(html).toContain(`<p data-surface="ticket:refund-state">refunded</p>`);
    // The prefix has to be set BEFORE the module that reads it, or CRUMB fetches tours from the
    // reviewed app's /crumb and gets the app's 404 page.
    expect(html.indexOf("crumbPrefix")).toBeLessThan(html.indexOf(`src="${PANTRY_PREFIX}/crumb-live.js"`));
  });

  test("a page that ALREADY runs CRUMB gets only PANTRY's own client — never a second tour engine", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    const res = await handler(new Request("http://localhost:4400/already-crumb"));
    const html = await res.text();
    expect(html).toContain(`${PANTRY_PREFIX}/pantry-review-client.js`);
    expect(html).not.toContain(`${PANTRY_PREFIX}/crumb-live.js`);
    expect(html).not.toContain("crumbPrefix");
  });

  test("with no tours folder the injection is exactly what P0 shipped: one tag, counted", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, null) });
    const html = await (await handler(new Request("http://localhost:4400/"))).text();
    // The name said "one tag" and the first version of this test checked two substrings, so a
    // regression that injected the review client twice would have passed it. Count.
    const injected = [...html.matchAll(new RegExp(`<(?:script|link)\\b[^>]*${PANTRY_PREFIX}`, "g"))];
    expect(injected).toHaveLength(1);
    expect(html).toContain(`<script src="${PANTRY_PREFIX}/pantry-review-client.js" defer></script>`);
    expect(html).not.toContain("crumb");
  });

  test("a meta CSP is dropped from a page being injected into, so it cannot block the tags just added", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin, TOURS) });
    const html = await (await handler(new Request("http://localhost:4400/meta-csp"))).text();
    expect(html).not.toContain("Content-Security-Policy");
    expect(html).toContain(`${PANTRY_PREFIX}/crumb-live.js`);
  });

  test("a page injected with NOTHING comes back whole — the empty decision is not a dropped body", async () => {
    const url = new URL("http://localhost:4400/");
    const res = await proxyToPreview(new Request(url), url, origin, { inject: () => "" });
    const html = await res.text();
    expect(html).toContain("ticket:refund-state");
    expect(html).toContain("</body></html>");
  });
});
