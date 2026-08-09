// pantry/preview.test.ts — the dev preview proxy (plans/pantry-review-layer.md P0). Two things are
// under test and they are different claims: that a request really reaches a real target and comes
// back intact (so a live server is spun up rather than fetch being mocked — a mock would pass while
// the header handling that actually breaks proxies stayed wrong), and that the BOUNDS hold, since
// those are what make a URL-fetching route safe to ship at all.
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import {
  PANTRY_PREFIX, MAX_REQUEST_BYTES,
  resolvePreviewTarget, proxyToPreview, injectBeforeBodyClose, rebasePantryHtml, rebasePantryCss, withPantryBase,
} from "./preview.ts";
import { createPantryHandler } from "./app.ts";
import type { ResolvedPantryConfig } from "./config.ts";

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
  const EXAMPLE = join(import.meta.dir, "plans");
  const configWith = (previewTarget: string | null): ResolvedPantryConfig => ({
    cwd: import.meta.dir, projectName: "test-project", plansDir: EXAMPLE, docsDirs: [],
    graphPath: null, graphDir: join(import.meta.dir, "graphify-out"),
    decisionsDir: join(EXAMPLE, "decisions"), artifactsDir: join(import.meta.dir, "artifacts"),
    runsDir: join(import.meta.dir, "artifacts", "runs"), previewTarget,
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

  test("an unknown path under the prefix is PANTRY's 404, never a pass to the app", async () => {
    const handler = createPantryHandler({ plansDir: EXAMPLE, config: configWith(origin) });
    const res = await handler(new Request(`http://localhost:4400${PANTRY_PREFIX}/no-such-surface`));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});
