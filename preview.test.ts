// pantry/preview.test.ts — the dev preview proxy (plans/pantry-review-layer.md P0). Two things are
// under test and they are different claims: that a request really reaches a real target and comes
// back intact (so a live server is spun up rather than fetch being mocked — a mock would pass while
// the header handling that actually breaks proxies stayed wrong), and that the BOUNDS hold, since
// those are what make a URL-fetching route safe to ship at all.
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync } from "node:fs";
import {
  PANTRY_PREFIX, MAX_REQUEST_BYTES, MAX_HTML_BYTES,
  resolvePreviewTarget, proxyToPreview, injectBeforeBodyClose, rebasePantryHtml, rebasePantryCss, withPantryBase,
} from "./preview.ts";
import { createPantryHandler } from "./app.ts";
import type { ResolvedPantryConfig } from "./config.ts";
import { DEFAULT_HYGIENE } from "./hygiene.ts";
import { DEFAULT_CONTEXT_BUDGET } from "./context.ts";

const TAG = `<script src="${PANTRY_PREFIX}/pantry-review-client.js" defer></script>`;

describe("resolvePreviewTarget — the target comes from config, and only a loopback origin qualifies", () => {
  test("a loopback origin resolves, normalized", () => {
    expect(resolvePreviewTarget("http://localhost:3000").origin).toBe("http://localhost:3000");
    expect(resolvePreviewTarget("  http://127.0.0.1:8080  ").origin).toBe("http://127.0.0.1:8080");
    expect(resolvePreviewTarget("https://localhost:3000").origin).toBe("https://localhost:3000");
  });

  test("absent is OFF, not an error — the route does not exist unless a target was configured", () => {
    for (const raw of [undefined, null, "", "   "]) {
      const r = resolvePreviewTarget(raw);
      expect(r.origin).toBeNull();
      expect(r.problem).toBeNull();   // nothing to warn about; nothing was asked for
    }
  });

  test("a NON-loopback target is refused and says so — this is the check that keeps it off the network", () => {
    for (const raw of ["http://example.com", "http://192.168.1.10:3000", "http://0.0.0.0:3000", "http://[::1]:3000".replace("[::1]", "10.0.0.1")]) {
      const r = resolvePreviewTarget(raw);
      expect(r.origin).toBeNull();
      expect(r.problem).toContain("loopback");
    }
  });

  test("a target carrying a path, credentials, or a non-http scheme is refused", () => {
    expect(resolvePreviewTarget("http://localhost:3000/app").problem).toContain("no path");
    expect(resolvePreviewTarget("http://user:pw@localhost:3000").problem).toContain("credentials");
    expect(resolvePreviewTarget("file:///etc/passwd").problem).toContain("http");
    expect(resolvePreviewTarget("not a url").problem).toContain("not a URL");
  });
});

describe("the HTML transforms", () => {
  test("the injected tag goes before the LAST closing body tag", () => {
    const out = injectBeforeBodyClose("<body><p>a</p></body>", "<x>");
    expect(out).toBe("<body><p>a</p><x></body>");
  });

  test("a response with no closing body tag still gets the tag rather than losing it", () => {
    expect(injectBeforeBodyClose("<p>fragment</p>", "<x>")).toBe("<p>fragment</p><x>");
  });

  test("rebasing moves PANTRY's own root-absolute URLs and leaves external + protocol-relative alone", () => {
    const html = `<a href="/plans">p</a><script src="/pantry-cmdk.js"></script><a href="https://x.dev/a">x</a><img src="//cdn/x.png"><form action="/go">`;
    const out = rebasePantryHtml(html, PANTRY_PREFIX);
    expect(out).toContain(`href="${PANTRY_PREFIX}/plans"`);
    expect(out).toContain(`src="${PANTRY_PREFIX}/pantry-cmdk.js"`);
    expect(out).toContain(`action="${PANTRY_PREFIX}/go"`);
    expect(out).toContain(`href="https://x.dev/a"`);   // untouched
    expect(out).toContain(`src="//cdn/x.png"`);         // protocol-relative, untouched
  });

  test("a data attribute is NOT a URL the browser fetches, so it is left alone", () => {
    // \b sees a boundary between the hyphen and the s in data-src, so the obvious rule rewrote these
    // too. That framed PANTRY inside PANTRY in the review shell, which is the kind of break that
    // looks like a layout bug rather than a rewriting one.
    const out = rebasePantryHtml(`<iframe data-src="/"></iframe><b data-srcset="/a.png 1x">x</b><img src="/real.png">`, PANTRY_PREFIX);
    expect(out).toContain(`data-src="/"`);
    expect(out).toContain(`data-srcset="/a.png 1x"`);
    expect(out).toContain(`src="${PANTRY_PREFIX}/real.png"`);   // the real one still moves
  });

  test("srcset moves too, candidate by candidate, so the rule has no quiet exception", () => {
    const out = rebasePantryHtml(`<img srcset="/a.png 400w, /b.png 800w, https://cdn/c.png 2x">`, PANTRY_PREFIX);
    expect(out).toContain(`${PANTRY_PREFIX}/a.png 400w`);
    expect(out).toContain(`${PANTRY_PREFIX}/b.png 800w`);
    expect(out).toContain(`https://cdn/c.png 2x`);   // absolute, untouched
  });

  test("a root-absolute url() in PANTRY's own CSS is rebased too, so a stylesheet never asks the reviewed app for anything", () => {
    const css = `@font-face { src: url("/fonts/x.woff2") format("woff2"); }\n.a { background: url(/img/y.png); }\n.b { background: url('//cdn/z.png'); }`;
    const out = rebasePantryCss(css, PANTRY_PREFIX);
    expect(out).toContain(`url("${PANTRY_PREFIX}/fonts/x.woff2")`);
    expect(out).toContain(`url(${PANTRY_PREFIX}/img/y.png)`);
    expect(out).toContain(`url('//cdn/z.png')`);   // protocol-relative, untouched
  });

  test("an empty base is a no-op, so the no-preview path is byte-identical", () => {
    const html = `<head></head><a href="/plans">p</a>`;
    const css = `@font-face { src: url("/fonts/x.woff2"); }`;
    expect(rebasePantryHtml(html, "")).toBe(html);
    expect(withPantryBase(html, "")).toBe(html);
    expect(rebasePantryCss(css, "")).toBe(css);
  });

  test("the base is stamped into the head so PANTRY's own client scripts can find their routes", () => {
    expect(withPantryBase(`<html><head lang="en"><title>t</title></head>`, PANTRY_PREFIX))
      .toContain(`<meta name="pantry-base" content="${PANTRY_PREFIX}">`);
  });
});

// A stand-in for "the reviewed project": a plain server that answers the handful of shapes a proxy
// actually has to get right. Real sockets, because the header bugs live in the transport.
let target: ReturnType<typeof Bun.serve>;
let origin: string;
beforeAll(() => {
  target = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        return new Response(`<!DOCTYPE html><html><head></head><body><h1>reviewed app</h1></body></html>`, {
          headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'self'", "X-Frame-Options": "DENY" },
        });
      }
      if (url.pathname === "/app.js") return new Response("export const a = 1;", { headers: { "Content-Type": "text/javascript" } });
      if (url.pathname === "/login") {
        const h = new Headers({ Location: `${url.origin}/dashboard` });
        h.append("Set-Cookie", "session=abc; Path=/; HttpOnly; Secure");
        h.append("Set-Cookie", "csrf=xyz; Path=/");
        return new Response(null, { status: 302, headers: h });
      }
      if (url.pathname === "/echo") return new Response(req.headers.get("cookie") ?? "no-cookie");
      if (url.pathname === "/post") return new Response(`got ${req.method} ${req.headers.get("content-type")}`, { status: 201 });
      if (url.pathname === "/away") return new Response(null, { status: 302, headers: { Location: "https://auth.example.com/x" } });
      if (url.pathname === "/away-scheme-relative") return new Response(null, { status: 302, headers: { Location: "//auth.example.com/x" } });
      // Streaming SSR: HTML with NO Content-Length. The framework case that made a header-based cap
      // the wrong design, so it gets a route rather than a comment.
      if (url.pathname === "/chunked" || url.pathname === "/huge") {
        const huge = url.pathname === "/huge";
        const filler = "x".repeat(64 * 1024);
        const rounds = huge ? Math.ceil(MAX_HTML_BYTES / filler.length) + 2 : 1;
        return new Response(
          new ReadableStream({
            start(c) {
              const enc = new TextEncoder();
              c.enqueue(enc.encode("<!DOCTYPE html><html><body>"));
              for (let i = 0; i < rounds; i++) c.enqueue(enc.encode(filler));
              c.enqueue(enc.encode("</body></html>"));
              c.close();
            },
          }),
          { headers: { "Content-Type": "text/html; charset=utf-8" } },   // deliberately no content-length
        );
      }
      return new Response("target 404", { status: 404 });
    },
  });
  origin = `http://localhost:${target.port}`;
});
afterAll(() => target.stop(true));

const via = (path: string, init?: RequestInit) => {
  const url = new URL(`http://localhost:4400${path}`);
  return proxyToPreview(new Request(url, init), url, origin, { inject: TAG });
};

describe("proxyToPreview — the target is served under PANTRY's origin", () => {
  test("an HTML page comes through whole, with exactly ONE tag added before the closing body", async () => {
    const res = await via("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>reviewed app</h1>");                      // the app, untouched
    expect(html).toContain(`${TAG}</body>`);                              // the one injected byte
    expect(html.split("pantry-review-client.js").length - 1).toBe(1);     // once, not twice
  });

  test("nothing but HTML is read or rewritten — other assets stream through as-is", async () => {
    const res = await via("/app.js");
    expect(await res.text()).toBe("export const a = 1;");
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  test("CSP and X-Frame-Options are stripped, because PANTRY has to inject into and frame this page", async () => {
    const res = await via("/");
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("x-frame-options")).toBeNull();
  });

  test("EVERY Set-Cookie survives the hop as its own header — the auth case this design most likely trips on", async () => {
    const res = await via("/login");
    const cookies = res.headers.getSetCookie();
    expect(cookies.length).toBe(2);                                  // not one comma-joined string
    expect(cookies.some((c) => c.startsWith("session=abc"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("csrf=xyz"))).toBe(true);
    // PANTRY is http here, so a Secure cookie would be dropped by the browser and the reviewed app
    // would look logged out for a reason that has nothing to do with it.
    expect(cookies.find((c) => c.startsWith("session="))!.toLowerCase()).not.toContain("secure");
    // and neither entry swallowed the other: a comma-joined pair would carry both names
    for (const c of cookies) expect(c.split(",").length).toBe(1);
    expect(cookies.find((c) => c.startsWith("session="))).not.toContain("csrf=");
    expect(cookies.find((c) => c.startsWith("session="))!.endsWith(";")).toBe(false);   // no dangling separator
  });

  test("a cookie the browser sends is forwarded upstream", async () => {
    const res = await via("/echo", { headers: { cookie: "session=abc" } });
    expect(await res.text()).toBe("session=abc");
  });

  test("a redirect to the target's OWN origin is rewritten to a path, so the browser stays on PANTRY's", async () => {
    const res = await via("/login");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard");
  });

  test("a redirect somewhere else is left alone — PANTRY is not in the middle of an external hop", async () => {
    expect((await via("/away")).headers.get("location")).toBe("https://auth.example.com/x");
  });

  test("a protocol-relative Location is off-target and stays untouched, rather than being turned into a path", async () => {
    const res = await via("/away-scheme-relative");
    expect(res.headers.get("location")).toBe("//auth.example.com/x");
  });

  test("methods and bodies pass through, and the target's status comes back", async () => {
    const res = await via("/post", { method: "POST", body: JSON.stringify({ a: 1 }), headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("got POST application/json");
  });

  test("the target's own 404 is the target's, not PANTRY's", async () => {
    const res = await via("/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("target 404");
  });
});

// Found by an independent reviewer, not by the person who wrote the proxy. A pathname is a string
// that a URL constructor will happily read as scheme-relative, so `//evil.com/x` resolved against
// the target origin becomes `http://evil.com/x`: the loopback check passed at boot and was walked
// around by a request. These are the regression tests for that, and they are the most important
// tests in this file.
describe("proxyToPreview — a request cannot move the target", () => {
  test("a scheme-relative pathname does NOT escape the configured origin", async () => {
    for (const path of ["//example.com/x", "///example.com/x", "////example.com/"]) {
      const url = new URL(`http://localhost:4400${path}`);
      const res = await proxyToPreview(new Request(url), url, origin, { inject: TAG });
      // it either reaches the real target (which 404s an unknown path) or is refused, and in NO case
      // does it come back with something example.com served
      expect([404, 400]).toContain(res.status);
      expect(await res.text()).not.toContain("Example Domain");
    }
  });

  test("a backslash path, which URL parsing turns into leading slashes, is the same story", async () => {
    const url = new URL("http://localhost:4400/\\/example.com/x");
    const res = await proxyToPreview(new Request(url), url, origin, { inject: TAG });
    expect([404, 400]).toContain(res.status);
  });

  test("the escape really did work before the fix, so the test above is not testing nothing", () => {
    // the exact construction that was live: pathname concatenated onto the origin, unnormalized
    expect(new URL("//example.com/x", "http://localhost:5200").origin).toBe("http://example.com");
    // and the fix, in one line
    expect(new URL("//example.com/x".replace(/^\/+/, "/"), "http://localhost:5200").origin).toBe("http://localhost:5200");
  });
});

describe("proxyToPreview — the bounds", () => {
  test("a websocket upgrade is refused loudly, and says what to review instead", async () => {
    const res = await via("/", { headers: { upgrade: "websocket", connection: "Upgrade" } });
    expect(res.status).toBe(501);
    expect(await res.text()).toContain("production build");
  });

  test("an oversize body is refused rather than forwarded", async () => {
    const res = await via("/post", { method: "POST", body: new Uint8Array(MAX_REQUEST_BYTES + 1) });
    expect(res.status).toBe(413);
  });

  test("streaming HTML with NO content-length is still injected, because that is what SSR sends", async () => {
    const res = await via("/chunked");
    const html = await res.text();
    expect(res.headers.get("content-length")).toBeNull();   // the header the old cap trusted
    expect(html).toContain(`${TAG}</body>`);
  });

  test("HTML past the buffer cap passes through WHOLE and uninjected, rather than being held in memory", async () => {
    const res = await via("/huge");
    const html = await res.text();
    expect(html.length).toBeGreaterThan(MAX_HTML_BYTES);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.endsWith("</body></html>")).toBe(true);   // the replayed chunks joined the remainder
    expect(html).not.toContain("pantry-review-client.js");
  });

  test("an unreachable target is a readable 502 that points back at PANTRY, not a stack trace", async () => {
    const url = new URL("http://localhost:4400/");
    // Port 1 is reserved and never listening; this is the everyday failure (the project isn't running).
    const res = await proxyToPreview(new Request(url), url, "http://127.0.0.1:1", { inject: TAG });
    expect(res.status).toBe(502);
    const html = await res.text();
    expect(html).toContain("Preview target unreachable");
    expect(html).toContain(`href="${PANTRY_PREFIX}/"`);
  });
});

// The handler-level claim: with a target configured, PANTRY gives up the root entirely and answers
// only under its prefix. That is the whole reason no URL rewriting is needed on the reviewed app.
describe("createPantryHandler — the reserved prefix", () => {
  // A real plans folder, because the board's markup is one of the things that had to move.
  const PLANS = mkdtempSync(join(tmpdir(), "pantry-preview-plans-"));
  writeFileSync(join(PLANS, "preview-fixture.md"), `---\nid: preview-fixture\nstatus: todo\n---\n\n# A plan for the board to render\n\nBody.\n`);
  const EXAMPLE = PLANS;
  const configWith = (previewTarget: string | null, toursDir: string | null = null): ResolvedPantryConfig => ({
    cwd: import.meta.dir, projectName: "test-project", plansDir: EXAMPLE, docsDirs: [],
    graphPath: null, graphDir: join(import.meta.dir, "graphify-out"),
    decisionsDir: join(EXAMPLE, "decisions"), answersLog: join(EXAMPLE, "decisions", "answers.jsonl"), artifactsDir: join(import.meta.dir, "artifacts"),
    runsDir: join(import.meta.dir, "artifacts", "runs"), previewTarget, previewCommand: null, previewCommandCwd: import.meta.dir, toursDir,
    hygiene: DEFAULT_HYGIENE,
    contextBudgetChars: DEFAULT_CONTEXT_BUDGET,
    surfaces: { plans: true, docs: false, reference: true, catalog: false, standards: false, decisions: true, artifacts: true, timeline: false, runs: true },
  });

  test("with NO target the root is PANTRY's own home, exactly as it always was", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith(null) });
    const res = await handler(new Request("http://localhost:4400/"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("PANTRY");
    expect(html).toContain(`href="/plans"`);                         // unprefixed
    expect(html).not.toContain("pantry-base");                       // no base stamped when off
  });

  test("with a target the ROOT is the reviewed app — PANTRY does not shadow a single app route", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith(origin) });
    const html = await (await handler(new Request("http://localhost:4400/"))).text();
    expect(html).toContain("<h1>reviewed app</h1>");
    expect(html).not.toContain("pantry-nav");
    expect(html).toContain("pantry-review-client.js");
  });

  test("…including the paths PANTRY owns at the root when the proxy is off", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith(origin) });
    // /about is a real PANTRY route. With the proxy on it belongs to the app, which 404s it here.
    const res = await handler(new Request("http://localhost:4400/about"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("target 404");
  });

  test("PANTRY's own surfaces answer under the prefix, with their links and their base rebased", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith(origin) });
    const res = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/`));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("pantry-nav");
    expect(html).toContain(`href="${PANTRY_PREFIX}/plans"`);
    expect(html).toContain(`src="${PANTRY_PREFIX}/pantry-cmdk.js"`);
    expect(html).toContain(`<meta name="pantry-base" content="${PANTRY_PREFIX}">`);
    expect(html).not.toContain(`href="/plans"`);                     // nothing left at the root
  });

  test("the prefix with no trailing slash is the same door", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith(origin) });
    expect((await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}`))).status).toBe(200);
  });

  test("the injected client is served under the prefix, so the tag it is injected as resolves", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith(origin) });
    const res = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/pantry-review-client.js`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("__pantryReview");
  });

  test("PROOF's live board channel is rebased too, so the board still updates under the prefix", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith(origin) });
    const js = await (await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/board-live.js`))).text();
    expect(js).toContain(`${PANTRY_PREFIX}/stream?session=`);
    expect(js).not.toContain("`/stream?session=");
  });

  test("GRAIN's stylesheet stops pointing its font at the root, which now belongs to the reviewed app", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith(origin) });
    const css = await (await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/styles/variables.css`))).text();
    expect(css).toContain(`url("${PANTRY_PREFIX}/fonts/`);
    expect(css).not.toContain(`url("/fonts/`);
  });

  test("a plan card on the board links somewhere that answers, which it never did before", async () => {
    // PROOF emits href="/plan/<id>" whatever prefix it is mounted under. With the proxy off that is
    // a 404 in PANTRY; with it on the prefix rebase would faithfully preserve the 404.
    const off = createPantryHandler({ plansDir: PLANS, config: configWith(null) });
    const boardOff = await (await off(new Request("http://localhost:4400/plans"))).text();
    expect(boardOff).not.toContain(`href="/plan/`);
    expect(boardOff).toContain(`href="/plans/plan/`);
    expect((await off(new Request("http://localhost:4400/plans/plan/preview-fixture"))).status).toBe(200);

    const on = createPantryHandler({ plansDir: PLANS, config: configWith(origin) });
    const boardOn = await (await on(new Request(`http://localhost:4400${PANTRY_PREFIX}/plans`))).text();
    expect(boardOn).toContain(`href="${PANTRY_PREFIX}/plans/plan/`);
    expect((await on(new Request(`http://localhost:4400${PANTRY_PREFIX}/plans/plan/preview-fixture`))).status).toBe(200);
  });

  // The response path and the PUSH path are not the same path, and only one of them was fixed at
  // first. PROOF rebuilds the board on a file change and broadcasts the HTML over SSE, where the
  // client assigns it with innerHTML — so a frame that skipped the repairs would silently undo them
  // on the first save, on the surface a live board exists to keep correct.
  test("a live board update carries the SAME repairs the served page does", async () => {
    const handler = createPantryHandler({ plansDir: PLANS, config: configWith(origin) });
    const res = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/stream?session=push-test`));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();

    // a settled change on disk is what PROOF watches for
    writeFileSync(join(PLANS, "preview-fixture.md"), `---\nid: preview-fixture\nstatus: doing\n---\n\n# A plan for the board to render\n\nEdited.\n`);

    const decoder = new TextDecoder();
    let seen = "";
    const deadline = Bun.nanoseconds() + 5_000_000_000;
    while (!seen.includes("proof-board") && Bun.nanoseconds() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
    }
    await reader.cancel();

    expect(seen).toContain("proof-board");
    expect(seen).toContain(`${PANTRY_PREFIX}/plans/plan/`);   // prefixed AND card-link repaired
    expect(seen).not.toContain(`href=\\"/plan/`);              // the raw PROOF link never reaches a client
  }, 10_000);

  test("the font GRAIN's stylesheet asks for is actually served, and only from under the fonts root", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith(origin) });
    const ok = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/fonts/redaction-400.woff2`));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("font/woff2");
    expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(1000);   // real bytes, not a text-mangled read
    // the path comes off the URL, so traversal out of the fonts root is the check that matters
    const out = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/fonts/..%2F..%2Fpackage.json`));
    expect(out.status).toBe(403);
    expect((await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/fonts/nope.woff2`))).status).toBe(404);
  });

  test("the review shell frames the project at the root, and only exists while there is one to frame", async () => {
    const on = createPantryHandler({ plansDir: PLANS, config: configWith(origin) });
    const res = await on(new Request(`http://localhost:4400${PANTRY_PREFIX}/review`));
    expect(res.status).toBe(200);
    const html = await res.text();
    // The frame's target must NOT be a rebased src: every root-absolute URL on a PANTRY page moves
    // onto the prefix, and a rebased frame src would frame PANTRY inside PANTRY instead of the app.
    expect(html).toContain(`data-src="/" title="The project being reviewed`);
    expect(html).not.toContain(`<iframe class="pantry-review__frame" src=`);
    expect(html).toContain("pantry-review__rail");
    expect(html).toContain("data-rail-toggle");
    expect(html).toContain(`src="${PANTRY_PREFIX}/pantry-review.js"`);
    expect(html).toContain(origin);                       // the rail names what it is pointed at
    expect(html).toContain(`href="${PANTRY_PREFIX}/plans"`);
    // full bleed: no centred reading column, no made-with footer competing with the frame
    expect(html).toContain("pantry-main--full");

    const off = createPantryHandler({ plansDir: PLANS, config: configWith(null) });
    expect((await off(new Request("http://localhost:4400/review"))).status).toBe(404);
  });

  // The bug this pins is not "the outcome is unsaid" — it WAS said, in a 14px muted line at the top
  // of the pane, six hundred pixels from the card at the bottom of the frame. The first human to
  // press Record read that as silence. Both halves are asserted because either alone regresses
  // quietly: the receipt element, and the fact that data-kind is styled at all.
  test("the record outcome is said where the reviewer is looking, and success and failure do not look identical", async () => {
    const on = createPantryHandler({ plansDir: PLANS, config: configWith(origin) });
    const html = await (await on(new Request(`http://localhost:4400${PANTRY_PREFIX}/review`))).text();
    for (const hook of ["data-receipt", "data-receipt-eyebrow", "data-receipt-message", "data-receipt-log", "data-receipt-close"]) {
      expect(html).toContain(hook);
    }
    // Inside the pane, so it overlays the frame rather than reflowing the app under review.
    expect(html.indexOf("data-receipt")).toBeGreaterThan(html.indexOf("pantry-review__frame"));
    // Root-absolute, so PANTRY's own rebase moves it under the prefix like every other link here —
    // an un-rebased /answers would be fired at the reviewed app, which has never heard of it.
    expect(html).toContain(`href="${PANTRY_PREFIX}/answers" target="_blank"`);

    // `data-kind` was set on the bar's status from the first version and styled NOWHERE, so an error
    // and a success rendered as the same grey sentence. A rule keyed on it is the regression guard;
    // the palette is closed (GRAIN collapses success and danger to --ink), so the rule is a
    // treatment rather than a hue and the eyebrow carries the word.
    const css = await Bun.file(join(import.meta.dir, "pantry.css")).text();
    expect(css).toContain('.pantry-review__receipt[data-kind="error"]');
    expect(css).toContain(".pantry-review__receipteyebrow");
    expect(css).not.toContain("--color-success");
  });

  // Finishing the card IS the answer. The Record button existed only because CRUMB owns the card and
  // PANTRY owns the chrome, and the first person to walk this finished the card and lost what they
  // typed — the boundary reached the reviewer's hands, which is the one place it was never meant to.
  test("there is no Record button, and its styles went with it", async () => {
    const on = createPantryHandler({ plansDir: PLANS, config: configWith(origin) });
    const html = await (await on(new Request(`http://localhost:4400${PANTRY_PREFIX}/review`))).text();
    expect(html).not.toContain("data-record>");
    expect(html).not.toContain("Record answer</button>");
    expect(html).toContain("data-record-status");            // the echo stays; only the button went
    // A dead class in a stylesheet is what the next person restores a button to match.
    const css = await Bun.file(join(import.meta.dir, "pantry.css")).text();
    expect(css).not.toContain(".pantry-review__record {");
    const client = await Bun.file(join(import.meta.dir, "pantry-review.js")).text();
    expect(client).not.toContain("recordBtn");
    // The write is now driven by the card closing, and the handoff link opens the walk it names.
    expect(client).toContain("recordAnswer(finished)");
    expect(client).toContain('.get("tour")');
  });

  // The rail's step statuses come from the tour FILE, which was written before the walk and knows
  // nothing about an answer that arrived afterwards. Reading the log too is what stops it saying
  // "2 of 3 awaiting you" about a review that was answered and acked an hour ago.
  test("the rail has somewhere for a closed review to go", async () => {
    const on = createPantryHandler({ plansDir: PLANS, config: configWith(origin) });
    const html = await (await on(new Request(`http://localhost:4400${PANTRY_PREFIX}/review`))).text();
    expect(html).toContain("data-closed-group");
    expect(html).toContain("data-closed-title");
    expect(html).toContain("data-closed>");
    // Folded, not deleted: "where did the one I answered go" is the next question.
    expect(html).toContain("<details class=\"pantry-review__group\" data-closed-group hidden>");
    const client = await Bun.file(join(import.meta.dir, "pantry-review.js")).text();
    expect(client).toContain("loadAnswerIndex");
    expect(client).toContain(`${"`"}\${pantryBase}/answers.json${"`"}`);
  });

  test("the Review entry is in the nav only when the proxy is on", async () => {
    const on = createPantryHandler({ plansDir: PLANS, config: configWith(origin) });
    expect(await (await on(new Request(`http://localhost:4400${PANTRY_PREFIX}/`))).text())
      .toContain(`href="${PANTRY_PREFIX}/review"`);
    const off = createPantryHandler({ plansDir: PLANS, config: configWith(null) });
    expect(await (await off(new Request("http://localhost:4400/"))).text()).not.toContain(`href="/review"`);
  });

  test("an unknown path under the prefix is PANTRY's 404, never a pass to the app", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith(origin) });
    const res = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/no-such-surface`));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});
