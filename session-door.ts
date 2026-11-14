// session-door.ts: the door a session uses to see and move the PANTRY window the owner is watching.
//
// This is GRAIN's shape applied to PANTRY, built from GRAIN's own pieces rather than a copy of them.
// Every page declares its surfaces (session-client.ts marks them), harvests its manifest from the
// live DOM with GRAIN's `domManifest`, and reports it here. A session observes that report, and asks
// for a move. The move is GRAIN's `navigate` verb on the `screen` surface, the one verb GRAIN already
// has for changing what a person sees. The door checks it against what the window actually shows: a
// destination that no surface on screen links to is refused, and the refusal names the legal moves,
// so the session corrects itself instead of guessing a URL.
//
// Nothing here writes project state. There is no verb that answers a decision, claims a plan or
// edits a file, so a session cannot do any of those through the window: an answer stays the owner's.
// Plans, decisions, tiles and views are readable surfaces that carry a link, not verb targets of
// their own; adding `plan.open` and kin is GRAIN's call (see plans/pantry-session-control.md).

import { isSafeNavigateHref } from "@tjakoen/grain/ai/contract.ts";
import { manifestToText } from "@tjakoen/grain/ai/manifest-dom.ts";
import type { Manifest } from "@tjakoen/grain/ai/manifest.ts";

/** One link a page offers: the surface that carries it, where it goes, and its visible label. */
export interface WindowLink { surface: string; href: string; label: string }

/** What a page reports about itself: its GRAIN manifest plus the links its surfaces carry. */
export interface WindowReport {
  client: string;
  url: string;
  manifest: Manifest;
  links: WindowLink[];
  /** When the page last loaded or took focus. The most recent one is the window being watched. */
  at: number;
}

/** A move a session asks for: a surface on screen to go to, or a root-relative href. */
export interface MoveRequest { to?: string; href?: string }

export type MoveVerdict =
  | { ok: true; intent: { surface: "screen"; action: "navigate"; payload: { href: string } }; via: string | null }
  | { ok: false; reason: string; valid: string[] };

/** A report older than this is a closed window, not one being watched. Pages heartbeat well inside it. */
export const REPORT_TTL_MS = 60_000;
/** The most moves a refusal lists, so the reply stays readable on a page with every plan on it. */
export const VALID_CAP = 40;

const pathOf = (href: string): string => {
  const u = new URL(href, "http://pantry.local");
  const p = u.pathname.replace(/\/+$/, "") || "/";
  return p + u.search;
};

/** The legal moves on a reported page, one line each, as a refusal lists them. */
export function validMoves(r: WindowReport): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of r.links) {
    if (seen.has(l.surface)) continue;
    seen.add(l.surface);
    out.push(`to: ${l.surface} (${l.href})${l.label ? ` — ${l.label}` : ""}`);
  }
  return out.slice(0, VALID_CAP).concat(out.length > VALID_CAP ? [`… and ${out.length - VALID_CAP} more; call pantry_observe for the full list`] : []);
}

/** Check a move against the page the window shows. Pure: the same report and move give the same verdict. */
export function validateMove(r: WindowReport | null, move: MoveRequest): MoveVerdict {
  if (!r) return { ok: false, reason: "No PANTRY window is showing this project. Ask the owner to open it, or run `pantry open` in the project.", valid: [] };
  const navigable = r.manifest.targets.some((t) => t.id === "screen" && t.accepts.includes("navigate"));
  if (!navigable) return { ok: false, reason: `The page at ${r.url} does not accept navigate on its screen surface.`, valid: [] };
  const valid = validMoves(r);
  if (move.to) {
    const link = r.links.find((l) => l.surface === move.to);
    if (!link) return { ok: false, reason: `No surface ${move.to} on ${r.url}.`, valid };
    return { ok: true, intent: { surface: "screen", action: "navigate", payload: { href: link.href } }, via: link.surface };
  }
  if (move.href) {
    if (!isSafeNavigateHref(move.href)) return { ok: false, reason: `${move.href} is not a root-relative path on this PANTRY.`, valid };
    const want = pathOf(move.href);
    const link = r.links.find((l) => pathOf(l.href) === want);
    if (!link) return { ok: false, reason: `Nothing on ${r.url} links to ${move.href}.`, valid };
    return { ok: true, intent: { surface: "screen", action: "navigate", payload: { href: link.href } }, via: link.surface };
  }
  return { ok: false, reason: "Pass `to` (a surface address from pantry_observe) or `href`.", valid };
}

/** GRAIN's manifest lists its whole vocabulary; a session needs only the verbs this page accepts. */
export function operable(m: Manifest): Manifest {
  const used = new Set(m.targets.flatMap((t) => t.accepts));
  return { ...m, actions: m.actions.filter((a) => used.has(a.name)) };
}

/** The window as a session reads it: GRAIN's prompt-ready manifest, then the moves it allows. */
export function observeText(r: WindowReport | null, windows: number): string {
  if (!r) return "No PANTRY window is showing this project right now. Ask the owner to open it, or run `pantry open` in the project.";
  const lines = [`window: ${r.url} (reported ${Math.round((Date.now() - r.at) / 1000)}s ago; ${windows} window(s) open on this project)`,
    manifestToText(operable(r.manifest)), `moves: (${r.links.length}) call pantry_act with one of these`, ...validMoves(r).map((m) => `- ${m}`)];
  return lines.join("\n");
}

/** Where a move goes out to the window. The app server wires this to its SSE stream. */
export type MoveSink = (client: string, move: { href: string; surface: string | null }) => void;

/** The live state of one project's windows, and the act that waits for the window to arrive. */
export function createSessionDoor(send: MoveSink, now: () => number = Date.now) {
  const reports = new Map<string, WindowReport>();
  const waiters = new Set<(r: WindowReport) => void>();

  const live = () => [...reports.values()].filter((r) => now() - r.at < REPORT_TTL_MS);
  const current = (): WindowReport | null => live().sort((a, b) => b.at - a.at)[0] ?? null;

  return {
    report(r: Omit<WindowReport, "at"> & { focused?: boolean }): void {
      const prev = reports.get(r.client);
      // A heartbeat keeps a window alive without making it the watched one; a load or focus does.
      const at = r.focused === false && prev ? prev.at : now();
      const next: WindowReport = { client: r.client, url: r.url, manifest: r.manifest, links: r.links, at };
      reports.set(r.client, next);
      for (const w of new Set(waiters)) w(next);
    },
    current,
    windows: () => live().length,
    observe: () => observeText(current(), live().length),
    /** Validate, send, then wait for a window to report the destination (or time out saying so). */
    async act(move: MoveRequest, timeoutMs = 10_000): Promise<{ ok: boolean; text: string }> {
      const r = current();
      const verdict = validateMove(r, move);
      if (!verdict.ok) return { ok: false, text: [`Refused: ${verdict.reason}`, ...(verdict.valid.length ? ["Valid moves:", ...verdict.valid.map((v) => `- ${v}`)] : [])].join("\n") };
      const href = verdict.intent.payload.href;
      const want = pathOf(href);
      const arrived = new Promise<WindowReport | null>((resolve) => {
        const timer = setTimeout(() => { waiters.delete(w); resolve(null); }, timeoutMs);
        const w = (n: WindowReport) => { if (pathOf(n.url) === want) { clearTimeout(timer); waiters.delete(w); resolve(n); } };
        waiters.add(w);
      });
      send(r!.client, { href, surface: verdict.via });
      const landed = await arrived;
      if (!landed) return { ok: false, text: `Sent navigate to ${href}, but the window did not report arriving within ${timeoutMs / 1000}s.` };
      return { ok: true, text: `Moved the window to ${href}.\n\n${observeText(landed, live().length)}` };
    },
  };
}
export type SessionDoor = ReturnType<typeof createSessionDoor>;
