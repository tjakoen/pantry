// pantry/resume.ts: the card a session leaves on a plan when it hands the plan back.
//
// Work on one plan often spans days, machines and harnesses, because a token budget runs out and
// refreshes later, or because the owner picks it up on another device. The next session used to
// start from the plan's checklist and a guess. The card is three lines the leaving session writes:
// where it stopped, what is next, and what it waits on, plus how it ended and when it can resume.
//
// It lives in the plan file, under its own heading, so it travels wherever the plan does: the plans
// folder is committed and pushed by the estate sync, and every machine's PANTRY reads the same file.
// A new card replaces the old one; the plan's git history keeps the trail.
import { readFileSync, writeFileSync } from "node:fs";

export const CARD_HEADING = "## Resume card";
export const END_REASONS = ["limit", "handoff", "blocked", "other"] as const;
export type EndReason = (typeof END_REASONS)[number];

export interface ResumeCard {
  stopped: string;
  next: string;
  waitingOn: string;
  reason: EndReason;
  /** ISO time the work can continue, for a session that ended on a usage limit */
  resumeAt?: string;
  at: string;
  by: string;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 400);

export function renderCard(c: ResumeCard): string {
  return [
    CARD_HEADING,
    "",
    `- Stopped: ${one(c.stopped)}`,
    `- Next: ${one(c.next)}`,
    `- Waiting on: ${one(c.waitingOn) || "nothing"}`,
    `- Ended: ${c.reason}${c.resumeAt ? `, resumes ${c.resumeAt}` : ""}`,
    `- Left: ${c.at} by ${one(c.by)}`,
  ].join("\n");
}

/** The plan's card, or null when it has none or the section does not parse. */
export function cardOf(raw: string): ResumeCard | null {
  const at = raw.indexOf(`\n${CARD_HEADING}\n`);
  if (at < 0) return null;
  const rest = raw.slice(at + CARD_HEADING.length + 2);
  const section = rest.split(/\n## /)[0];
  const field = (label: string) => new RegExp(`^- ${label}: (.*)$`, "m").exec(section)?.[1]?.trim();
  const stopped = field("Stopped"), next = field("Next"), ended = field("Ended"), left = field("Left");
  if (!stopped || !next || !ended || !left) return null;
  const m = /^(\w+)(?:, resumes (\S+))?$/.exec(ended);
  const reason = (END_REASONS as readonly string[]).includes(m?.[1] ?? "") ? (m![1] as EndReason) : "other";
  const l = /^(\S+) by (.*)$/.exec(left);
  return { stopped, next, waitingOn: field("Waiting on") ?? "nothing", reason, ...(m?.[2] ? { resumeAt: m[2] } : {}), at: l?.[1] ?? "", by: l?.[2] ?? left };
}

/** The plan text with its card replaced, or appended at the end when it had none. */
export function withCard(raw: string, c: ResumeCard): string {
  const block = renderCard(c);
  const at = raw.indexOf(`\n${CARD_HEADING}\n`);
  if (at < 0) return `${raw.replace(/\s*$/, "")}\n\n${block}\n`;
  const after = raw.slice(at + 1);
  const end = after.slice(CARD_HEADING.length).search(/\n## /);
  const tail = end < 0 ? "" : after.slice(CARD_HEADING.length + end);
  return `${raw.slice(0, at + 1)}${block}\n${tail}`.replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}

export function writeCard(file: string, c: ResumeCard): void {
  writeFileSync(file, withCard(readFileSync(file, "utf8"), c));
}

/** A thread is paused when its card says it ended on a limit and the resume time is still ahead. */
export function pausedUntil(c: ResumeCard | null, now = Date.now()): string | null {
  return c?.reason === "limit" && c.resumeAt && Date.parse(c.resumeAt) > now ? c.resumeAt : null;
}
