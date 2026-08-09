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

export interface PreviewProxyOptions {
  /** the exact tag injected before `</body>` on HTML responses; omit to inject nothing */
  inject?: string;
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
  const html = injectBeforeBodyClose(new TextDecoder().decode(read.bytes), opts.inject!);
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
