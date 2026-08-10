// pantry/preview.ts — the dev preview proxy (plans/pantry-review-layer.md P0). PANTRY serves a
// project under ITS OWN origin so a later phase can drive that project from PANTRY's chrome: same
// origin means one injected script can talk back, and an embedded frame can be reached.
//
// The shape, decided before any of this was written:
//   - PANTRY's own routes move under a RESERVED PREFIX and the target owns the ROOT. That is what
//     buys "no URL rewriting at all" — the app's root-relative URLs resolve exactly as they already
//     do, because the root really is the app. The only byte changed on the way out is one script tag
//     before the closing body tag of an HTML response.
//   - The target comes from CONFIG and never from the request, it must be LOOPBACK, and the whole
//     route is OFF unless a target is configured. There is no open-relay shape available here even
//     by mistake, because nothing reads a destination off the wire.
//   - A local PRODUCTION build is what gets reviewed, not a dev server. That is why there is no
//     websocket passthrough below and an upgrade request is refused loudly rather than half-handled:
//     no hot-reload channel, no dev overlay. Websockets are a later upgrade for anyone who wants
//     `next dev`, and pretending to support them now would fail at review time instead of here.
//
// This is DEV-ONLY tooling and the bounds are part of the build, not a later hardening pass.

/** Where PANTRY's own routes live while the preview proxy is on. Double-underscore because the whole
 *  point is not to collide with a real route in the reviewed app; nothing ships URLs shaped like it. */
export const PANTRY_PREFIX = "/__pantry";

/** Biggest request body forwarded upstream. Buffered (not streamed) so the cap is enforceable
 *  without a duplex body; a dev preview has no reason to carry more than this. */
export const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
/** Biggest HTML response buffered for script injection. Bigger passes through UNINJECTED rather than
 *  being held in memory — an HTML page that large is not a page anyone is reviewing. */
export const MAX_HTML_BYTES = 4 * 1024 * 1024;
/** How long an upstream fetch may take before the proxy gives up and says so. */
export const UPSTREAM_TIMEOUT_MS = 30_000;

// 127.0.0.0/8, ::1, and the name that resolves to them. Deliberately NOT 0.0.0.0: that is a bind
// wildcard rather than an address, and accepting it here would mean accepting a value whose meaning
// depends on the resolver rather than on this check.
const LOOPBACK_HOST = /^(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\])$/i;

export interface PreviewTargetResult {
  /** the normalized origin (scheme + host + port), or null when the proxy stays off */
  origin: string | null;
  /** why a CONFIGURED target was rejected; null when there was none to begin with, or it was fine */
  problem: string | null;
}

/**
 * Validate a configured preview target. Absent is not an error (the proxy is off by default);
 * present-and-wrong is, and it says why so the warning is actionable rather than a silent no-op.
 *
 * Origin only, on purpose. A target carrying a path would mean joining two paths on every request,
 * which is the URL-rewriting this whole design exists to avoid.
 */
export function resolvePreviewTarget(raw: string | undefined | null): PreviewTargetResult {
  if (!raw || !raw.trim()) return { origin: null, problem: null };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { origin: null, problem: `previewTarget ${JSON.stringify(raw)} is not a URL` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { origin: null, problem: `previewTarget must be http or https, got ${url.protocol}` };
  if (url.username || url.password)
    return { origin: null, problem: "previewTarget must not carry credentials" };
  if (!LOOPBACK_HOST.test(url.hostname) && url.hostname !== "::1")
    return { origin: null, problem: `previewTarget must be loopback (localhost or 127.x.x.x), got ${url.hostname}` };
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash)
    return { origin: null, problem: `previewTarget must be an origin with no path, got ${url.pathname}${url.search}${url.hash}` };
  return { origin: url.origin, problem: null };
}

// Hop-by-hop headers never survive a proxy hop. `host` goes because fetch sets it for the upstream,
// and `accept-encoding` goes so the target answers identity: that removes the whole class of bug
// where a body is transparently decompressed on the way in and then re-served under its original
// Content-Encoding.
const DROP_REQUEST_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "accept-encoding",
]);

// On the way back: the hop-by-hop set again, plus length/encoding (the body may be rewritten), plus
// the two headers that would stop PANTRY doing its job. Stripping CSP and X-Frame-Options has no
// threat model behind it here — this is loopback, we own both ends, and the header exists on the
// target for a deployment this is not.
const DROP_RESPONSE_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "transfer-encoding", "upgrade",
  "content-encoding", "content-length",
  "content-security-policy", "content-security-policy-report-only", "x-frame-options",
]);

/**
 * Drop a `<meta http-equiv="content-security-policy">` from a page PANTRY is injecting into.
 *
 * The response HEADER is already dropped a few lines up, for reasons stated there. This is the same
 * decision applied to the same policy expressed the other way, and leaving it would mean the two
 * disagreed: a page whose CSP arrives in markup would keep enforcing `script-src` against tags PANTRY
 * had just added, and the visible symptom would be a tour that does not start with no failed request
 * to point at. Only the meta form, only on a page being injected into, only on loopback.
 */
export function stripMetaCsp(html: string): string {
  // Quote-aware, because `[^>]*>` stops at the FIRST `>` and a CSP value may legally contain one.
  // A reviewer produced `content="script-src 3 > 2 self"`, where the naive pattern cut the tag in
  // half and left ` 2 self">` as loose text in the head — removing too little and corrupting the
  // document in the same edit. Matching a tag means honouring its quoting, not scanning for a
  // bracket.
  return html.replace(/<meta\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi, (tag, attrs: string) =>
    isCspMeta(attrs) ? "" : tag,
  );
}

/**
 * Does this attribute list declare a CSP, as an ATTRIBUTE rather than as text somewhere in the tag?
 *
 * Testing the whole tag for the pattern removed `<meta name="note" content="we set
 * http-equiv=Content-Security-Policy at the edge">`, which is a tag that sets no policy at all and
 * describes one. Removing too much and removing too little are the same mistake here, made from
 * opposite ends: one is a policy that keeps enforcing, the other is a sentence that disappears.
 */
function isCspMeta(attrs: string): boolean {
  for (const m of attrs.matchAll(/([\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/g)) {
    if (m[1]!.toLowerCase() !== "http-equiv") continue;
    const value = m[2]!.replace(/^["']|["']$/g, "").trim().toLowerCase();
    if (value === "content-security-policy" || value === "content-security-policy-report-only") return true;
  }
  return false;
}

/** Insert `tag` immediately before the LAST closing body tag; append when a response has none. */
export function injectBeforeBodyClose(html: string, tag: string): string {
  const at = html.toLowerCase().lastIndexOf("</body>");
  return at === -1 ? html + tag : html.slice(0, at) + tag + html.slice(at);
}

/**
 * Rewrite root-absolute `href`/`src`/`action` values onto `base`.
 *
 * This is PANTRY rewriting ITS OWN output, not the target's. The reviewed app is never touched:
 * it owns the root, so its URLs are already correct. PANTRY is the one that moved, so PANTRY is the
 * one that pays. Protocol-relative (`//host/...`) and absolute URLs are left alone.
 */
export function rebasePantryHtml(html: string, base: string): string {
  if (!base) return html;
  // The lookbehind is load-bearing, not defensive. `\b` sees a word boundary between the hyphen and
  // the `s` in `data-src`, so the plain rule rewrote data attributes too — which broke the review
  // shell in the least obvious way available, by framing PANTRY inside PANTRY. A data attribute is
  // the app's own state, never a URL the browser will fetch, so it must be left alone.
  const out = html.replace(/(?<![\w-])(href|src|action)=(["'])\/(?!\/)/gi, (_m, attr, quote) => `${attr}=${quote}${base}/`);
  // srcset is a comma-separated list, so it cannot ride the attribute rule above and needs its own
  // pass over the list's contents. Nothing PANTRY renders emits one today; it is here because the
  // rule "PANTRY's own root-absolute URLs move" should not quietly have an exception nobody knows
  // about, waiting for the first responsive image to land.
  return out.replace(/(?<![\w-])srcset=(["'])([^"']*)\1/gi, (_m, quote, value: string) => {
    const moved = value
      .split(",")
      .map((candidate) => candidate.replace(/^(\s*)\/(?!\/)/, (_c, space) => `${space}${base}/`))
      .join(",");
    return `srcset=${quote}${moved}${quote}`;
  });
}

/**
 * The same move for CSS PANTRY serves: a root-absolute `url()` target moves onto `base`.
 *
 * This one was found by looking rather than by reasoning. GRAIN's variables.css loads its display
 * font from `url("/fonts/…")`, so with the prefix on and only the HTML rebased, PANTRY's own
 * stylesheet quietly fires a request at the REVIEWED APP's root. That is the wrong server, and the
 * class of bug is worse than the one font: PANTRY leaking requests into the thing it is meant to be
 * observing is how a review ends up reporting on traffic it caused itself.
 */
export function rebasePantryCss(css: string, base: string): string {
  if (!base) return css;
  return css.replace(/url\((\s*["']?)\/(?!\/)/g, (_m, lead) => `url(${lead}${base}/`);
}

/** Stamp the active base into the head so PANTRY's own client scripts can find their routes. */
export function withPantryBase(html: string, base: string): string {
  if (!base) return html;
  const meta = `\n  <meta name="pantry-base" content="${base}">`;
  return html.replace(/<head\b[^>]*>/i, (m) => m + meta);
}

/** Rewrite a Location that points at the target's own origin back onto PANTRY's. Relative Locations
 *  already resolve correctly, because the reviewed app owns the root here. */
function rebaseLocation(location: string, targetOrigin: string): string {
  try {
    const url = new URL(location, targetOrigin);
    if (url.origin !== targetOrigin) return location; // off-target (an OAuth hop, say) — leave it
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return location;
  }
}

/**
 * Copy upstream response headers, dropping what must not survive the hop.
 *
 * Set-Cookie is handled separately and deliberately. Iterating a Headers joins repeated Set-Cookie
 * into one comma-joined string, which silently corrupts a multi-cookie login; getSetCookie keeps
 * them as the list they are. `Secure` is stripped when PANTRY itself is being served over http,
 * because the browser would otherwise drop the cookie on the floor and the reviewed app would look
 * logged out for a reason that has nothing to do with it.
 */
function buildResponseHeaders(upstream: Response, targetOrigin: string, pantryIsSecure: boolean): Headers {
  const out = new Headers();
  for (const [key, value] of upstream.headers) {
    const k = key.toLowerCase();
    if (DROP_RESPONSE_HEADERS.has(k) || k === "set-cookie") continue;
    if (k === "location") { out.set("location", rebaseLocation(value, targetOrigin)); continue; }
    out.append(key, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) {
    out.append("set-cookie", pantryIsSecure ? cookie : stripSecureAttribute(cookie));
  }
  return out;
}

function stripSecureAttribute(cookie: string): string {
  return cookie
    .split(";")
    .filter((part, i) => part.trim() !== "" || i === 0)   // no dangling separator left behind
    .filter((part) => part.trim().toLowerCase() !== "secure")
    .join(";");
}

/**
 * Keep only the rules of GRAIN's `ai.css` that cannot reach the app being reviewed.
 *
 * **This exists because the comment it replaces was false, and a reviewer read the file the comment
 * was about.** The claim was that every rule in the composed tour stylesheet is scoped to names a
 * foreign app does not use. `ai.css` contains `html[data-xray] [data-surface] { outline: … }` — and
 * `data-surface` is not a name the app does not use, it is the ENTIRE Tier 1 contract, the one thing
 * PANTRY asks a project to add. The rule is inert today because nothing PANTRY injects sets
 * `data-xray`, so the leak needed the reviewed app to set that attribute itself. That is a thin
 * reason to be safe, and it is not the reason the comment gave.
 *
 * So the bound is enforced instead of asserted: a rule whose selector reaches for `html`, `body` or
 * any `data-` attribute is dropped. What survives is the spotlight — `.ai-lamp`, `.ai-backdrop`,
 * `.ai-spotlit` and their keyframes — which is all the tour layer ever needed from this file. The
 * dropped rules are GRAIN's own dev overlay and its AI presence indicator, neither of which exists
 * on a page PANTRY is proxying.
 */
export function spotlightRulesOnly(css: string): string {
  const kept: string[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    // Brace-matched, so a nested block (`@media`, `@keyframes`) is taken whole rather than cut at
    // its first inner close.
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}" && --depth === 0) break;
    }
    const selector = css.slice(i, open);
    const block = css.slice(i, Math.min(end + 1, css.length));
    // The selector as the author wrote it, with comments taken out so a `[data-…]` mentioned in
    // prose above a rule does not condemn it.
    const bare = selector.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const reachesTheApp = /\[data-/.test(bare) || /(^|[,\s>+~])(html|body)\b/i.test(bare);
    if (!reachesTheApp) kept.push(block.replace(/^\s*/, ""));
    i = end + 1;
  }
  return kept.join("\n");
}

/**
 * The one absolute import CRUMB's browser client carries.
 *
 * `crumb-live.js` is a host-served asset, so it cannot import a `.ts` sibling and reaches grain's
 * spotlight by absolute path instead. On a GRAIN host that path is correct and nothing here runs. On
 * a non-GRAIN target it is a request fired at the REVIEWED APP's root for a file that app has never
 * heard of, which is the whole reason Tier 1 needed PANTRY to carry CRUMB rather than expect it.
 */
export const CRUMB_SPOTLIGHT_IMPORT = "/scripts/ai-spotlight.js";

/**
 * Move CRUMB's one absolute import onto `base`, so the client PANTRY serves loads the spotlight from
 * PANTRY rather than from the app being reviewed.
 *
 * The same move as `rebasePantryCss`, for the same reason and with the same limit: PANTRY is the one
 * that moved off the root, so PANTRY is the one that pays. It is a rebase and not a fork — the bytes
 * are the package's, one specifier long.
 *
 * Deliberately NOT a general "rewrite every absolute import" pass. A second absolute import would be
 * a new dependency of the tour client on its host, and rewriting it silently is how PANTRY would end
 * up serving something it had never looked at. `crumbLiveAbsoluteImports` exists so a test can fail
 * loudly on that day instead.
 */
export function rebaseCrumbLive(js: string, base: string): string {
  if (!base) return js;
  // All three literal forms, not just the one the package happens to use today. A rebase that only
  // knows double quotes and a guard that only looks for double quotes share a blind spot, and the
  // failure they would share is silent: the import survives the rebase unchanged and fires at the
  // reviewed app's root.
  return js
    .replaceAll(`"${CRUMB_SPOTLIGHT_IMPORT}"`, `"${base}${CRUMB_SPOTLIGHT_IMPORT}"`)
    .replaceAll(`'${CRUMB_SPOTLIGHT_IMPORT}'`, `'${base}${CRUMB_SPOTLIGHT_IMPORT}'`)
    .replaceAll(`\`${CRUMB_SPOTLIGHT_IMPORT}\``, `\`${base}${CRUMB_SPOTLIGHT_IMPORT}\``);
}

/**
 * Every root-absolute module specifier in a piece of browser JS, plus a marker for any import this
 * cannot read statically.
 *
 * The drift guard's eyes: the rebase above is only honest while this returns exactly the one path it
 * knows how to move. A COMPUTED dynamic import cannot be resolved by reading, so it comes back as
 * `"(computed)"` rather than being skipped — the guard then fails, which is the correct outcome,
 * because a specifier nobody can read is a specifier nobody can promise was rebased.
 */
export function crumbLiveAbsoluteImports(js: string): string[] {
  const found = new Set<string>();
  const QUOTED = "[\"'`](/[^\"'`]*)[\"'`]";
  for (const m of js.matchAll(new RegExp(String.raw`\bfrom\s*${QUOTED}`, "g"))) found.add(m[1]!);
  for (const m of js.matchAll(new RegExp(String.raw`\bimport\s*\(\s*${QUOTED}\s*\)`, "g"))) found.add(m[1]!);
  for (const m of js.matchAll(new RegExp(String.raw`\bimport\s*${QUOTED}`, "g"))) found.add(m[1]!);
  // `import(` whose argument does not start with a quote is built at runtime. Not `import.meta`,
  // which is not an import at all.
  for (const m of js.matchAll(/\bimport\s*\(\s*(.)/g)) {
    if (!`"'\``.includes(m[1]!)) found.add("(computed)");
  }
  return [...found];
}

/**
 * Does this page already run CRUMB itself?
 *
 * A GRAIN host serves `crumb-live.js` from its own root, and injecting a second copy would put two
 * tour clients on one page: two lamps, two dialogs, and both driving the SAME `crumb:active` key in
 * sessionStorage, so a step advanced in one would be re-read by the other. The failure would look
 * like a flickering tour rather than like a duplicate script, which is the kind of symptom nobody
 * traces back to the proxy.
 *
 * A string check on the target's HTML, and deliberately so: what matters is whether the browser will
 * load that module, and the script tag is the only place that is decided. But "a string check" is
 * where the first version of this was wrong in BOTH directions, and both were found by a reviewer:
 *
 *   - **A bundled filename is hashed.** `crumb-live.8f3a91c2.js` is the ordinary shape of a
 *     production asset and did not match a pattern anchored on the exact name, so a GRAIN host with
 *     a bundler got a second tour client — the precise failure the paragraph above describes.
 *   - **A commented-out or inert tag is not a script that runs.** `<!-- <script src=…> -->` and
 *     `type="text/plain"` both looked like CRUMB, so PANTRY withheld its own client and Tier 1
 *     vanished with nothing on screen to say why.
 *
 * Both directions matter and they fail differently: the false negative is visible (a flickering
 * tour), the false positive is silent (no tour at all). The silent one is why this walks script tags
 * rather than pattern-matching the document.
 */
export function pageAlreadyRunsCrumb(html: string): boolean {
  const live = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of live.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = tag[1] ?? "";
    const src = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(attrs);
    if (!src) continue;
    // The FILENAME must begin with `crumb-live`, and may then carry a bundler's hash in either of
    // the two shapes bundlers use. Anchored at the path segment on purpose: matching anywhere would
    // make `not-crumb-liveness.js` count, and a false positive here is the silent failure — PANTRY
    // withholds its client and Tier 1 disappears with nothing to say why. A bundler that renames the
    // file to something not starting with `crumb-live` defeats this, and would show as a doubled
    // tour rather than as a missing one, which is the direction worth being wrong in.
    const file = (src[1]!.split(/[?#]/)[0] ?? "").split("/").pop() ?? "";
    if (!/^crumb-live(?:[.-][\w]+)*\.js$/i.test(file)) continue;
    // An absent type is a classic script; `module` is how CRUMB is loaded. Anything else (a
    // template, `text/plain`, an import map) is markup the browser will not execute.
    const type = (/\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? "").toLowerCase();
    if (type === "" || type === "module" || type === "text/javascript" || type === "application/javascript") return true;
  }
  return false;
}

/**
 * Is this the request for a PAGE, as opposed to something the page then asks for?
 *
 * Only a read can be one, which is the part `Accept` cannot tell you: a form POST accepts HTML back
 * and is not a document fetch. `Sec-Fetch-Dest` is exact where a browser sends it; `Accept` is the
 * fallback for everything that does not, which includes curl and every test in this repo.
 */
export function isDocumentRequest(req: Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const dest = req.headers.get("sec-fetch-dest");
  if (dest) return dest === "document" || dest === "iframe" || dest === "frame";
  return (req.headers.get("accept") ?? "").includes("text/html");
}

export interface PreviewProxyOptions {
  /** the tags injected before `</body>` on HTML responses; omit to inject nothing. A function is
   *  handed the page and returns what to insert, so a caller can decide per response (whether the
   *  page already runs CRUMB, say) without this module having to know why. Return "" to inject
   *  nothing into that page. */
  inject?: string | ((html: string) => string);
}

/**
 * Serve one request from the configured preview target under PANTRY's origin.
 *
 * `targetOrigin` comes from the caller's resolved config. It is never read off the request — that is
 * the property that keeps this from being an open relay, and it is worth restating at the one
 * function that does the fetching.
 */
export async function proxyToPreview(
  req: Request,
  url: URL,
  targetOrigin: string,
  opts: PreviewProxyOptions = {},
): Promise<Response> {
  // Refuse an upgrade rather than half-serving it. A review runs against a local production build,
  // so there is no hot-reload channel to carry; a project that genuinely needs one should learn that
  // here, in a message, rather than from a dead socket during a review.
  if (req.headers.get("upgrade")) {
    return new Response(
      "PANTRY's preview proxy does not pass websockets through. Review a production build (bun run build && start), not a dev server.",
      { status: 501, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const headers = new Headers();
  for (const [key, value] of req.headers) {
    if (!DROP_REQUEST_HEADERS.has(key.toLowerCase())) headers.append(key, value);
  }
  // A conditional request for a DOCUMENT is dropped when PANTRY has something to inject, so the
  // target always sends a body there is somewhere to inject into. Without this, a browser holding a
  // page from an earlier run revalidates, the target answers 304 against its own unchanged bytes, and
  // the browser reuses a copy carrying whatever PANTRY injected last time. `no-store` on the way out
  // stops that happening again; this is what unsticks the copy already in the cache.
  //
  // "Document" is the whole load-bearing word, and the first version got it from `Accept` alone.
  // A browser form submission carries `Accept: text/html` too, so a POST with the standard
  // create-if-absent precondition `If-None-Match: *` had that precondition quietly removed on the
  // way upstream, turning an atomic create into an unconditional overwrite. Read requests only, and
  // `Sec-Fetch-Dest` where the browser sends it, because that header says what the request IS rather
  // than what the caller would accept back.
  if (opts.inject && isDocumentRequest(req)) {
    headers.delete("if-none-match");
    headers.delete("if-modified-since");
  }
  // Say where the request really came from, in the terms a framework already understands. Some
  // servers build absolute URLs from these, and a wrong one sends the browser off PANTRY's origin.
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));

  let body: ArrayBuffer | null = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
    if (body.byteLength > MAX_REQUEST_BYTES) {
      return new Response(`Body over the preview proxy's ${MAX_REQUEST_BYTES} byte cap.`, { status: 413 });
    }
  }

  // A pathname is not a safe thing to concatenate onto an origin, and this is the one place where
  // getting it wrong would turn a config-only target into an open relay. `//evil.com/x` is a valid
  // pathname and resolves SCHEME-RELATIVE against the base, so `new URL("//evil.com/x", target)`
  // is `http://evil.com/x` — the loopback check passed at boot and was then walked straight around
  // by a request. Backslashes collapse into leading slashes during URL parsing, so they arrive here
  // as the same shape. Two defences, because one of them is a regex:
  //   1. collapse the leading run of slashes, which removes the scheme-relative reading entirely;
  //   2. assert the result still points at the configured target, which holds whatever the parser
  //      does next year.
  const safePath = url.pathname.replace(/^\/+/, "/");
  const upstreamUrl = new URL(safePath + url.search, targetOrigin);
  if (upstreamUrl.origin !== targetOrigin) {
    return new Response("Refused: that path does not resolve inside the configured preview target.", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
      redirect: "manual", // the browser follows it, against PANTRY's origin — not us, against the target's
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    return targetUnreachable(targetOrigin, err);
  }

  const pantryIsSecure = url.protocol === "https:";
  const outHeaders = buildResponseHeaders(upstream, targetOrigin, pantryIsSecure);
  const contentType = upstream.headers.get("content-type") ?? "";

  // Only HTML is ever read into memory, and only to inject one tag. Everything else — scripts,
  // images, fonts, JSON — streams straight through untouched, which is both faster and the whole
  // reason this design can claim it does not rewrite the app.
  const wantsInject = !!opts.inject && contentType.includes("text/html") && upstream.body !== null;
  if (!wantsInject) {
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders });
  }

  // The cap is enforced on bytes actually read, never on a declared Content-Length. Streaming SSR
  // is exactly the case that matters here and exactly the case that sends no length, so trusting the
  // header would have meant either buffering without a bound or refusing to inject into the modern
  // frameworks this has to work with. Over the cap, what was read is replayed and the rest passes
  // through untouched: a page that big is not one anybody is reviewing.
  const read = await readBodyCapped(upstream.body!, MAX_HTML_BYTES);
  if (!read.complete) {
    return new Response(read.body, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders });
  }
  const source = new TextDecoder().decode(read.bytes);
  const tags = typeof opts.inject === "function" ? opts.inject(source) : opts.inject!;
  // A page PANTRY changed must not be cached, and this was found by the change not appearing.
  //
  // A production build is what gets reviewed, deliberately, and a production build sets long cache
  // headers and a strong ETag. Both describe the UPSTREAM bytes. The moment PANTRY injects, the
  // validator is a lie about what was served: the tags can change between one run and the next while
  // the ETag does not, so the browser keeps serving a page carrying a previous run's client and
  // revalidation agrees with it. The symptom is the worst kind available to a review — the reviewer
  // is looking at an older build of the review layer and nothing on screen says so.
  //
  // Only on the injected response. Scripts, images and fonts stream through with their caching
  // intact, which is most of what makes the proxy feel like the app rather than like a proxy.
  if (tags) {
    outHeaders.delete("etag");
    outHeaders.delete("last-modified");
    outHeaders.set("cache-control", "no-store");
  }
  // An empty decision is a real one — a page that already runs CRUMB gets nothing added — and it must
  // still return the bytes rather than falling through to a re-read of a stream already consumed.
  // Unmodified in that case, meta CSP included: nothing was added for it to block.
  if (!tags) return new Response(source, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders });
  const html = injectBeforeBodyClose(stripMetaCsp(source), tags);
  return new Response(html, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders });
}

type CappedRead =
  | { complete: true; bytes: Uint8Array }
  | { complete: false; body: ReadableStream<Uint8Array> };

/** Read a body up to `cap` bytes. Under the cap it comes back whole; over it, the chunks already
 *  held are replayed ahead of the untouched remainder, so nothing is lost and nothing is buffered
 *  past the bound. */
async function readBodyCapped(body: ReadableStream<Uint8Array>, cap: number): Promise<CappedRead> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size > cap) {
      return {
        complete: false,
        body: new ReadableStream<Uint8Array>({
          start(controller) { for (const chunk of chunks) controller.enqueue(chunk); },
          async pull(controller) {
            const next = await reader.read();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
          },
          cancel(reason) { return reader.cancel(reason); },
        }),
      };
    }
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return { complete: true, bytes };
}

/** The target being off is the normal failure here, so it gets a page a human can act on rather than
 *  a bare 502. Same-origin, so it renders inside whatever frame asked for it. */
function targetUnreachable(targetOrigin: string, err: unknown): Response {
  const reason = err instanceof Error ? err.message : String(err);
  const body = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Preview target unreachable · PANTRY</title></head>
<body style="font-family: system-ui, sans-serif; padding: 2rem; line-height: 1.5;">
  <h1>Preview target unreachable</h1>
  <p>PANTRY is proxying <code>${escapeAttr(targetOrigin)}</code> at the root, and nothing answered.</p>
  <p>Start the reviewed project's <strong>production</strong> build on that port, then reload.</p>
  <p style="color:#666"><code>${escapeAttr(reason)}</code></p>
  <p><a href="${PANTRY_PREFIX}/">PANTRY's own surfaces</a></p>
</body></html>`;
  return new Response(body, { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
