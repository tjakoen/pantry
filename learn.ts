// pantry/learn.ts: the few lines a session leaves on a plan when it finishes it, written for the
// owner rather than for the next agent.
//
// The owner runs many threads at once and wants to learn from them later, not only know that they
// closed. A commit log says what changed; it rarely says why, what was tried and dropped, or the one
// thing worth remembering. So a session closing a plan writes those four lines and a topic, and the
// hub lists them under Done since you last looked, grouped by topic.
//
// Like the resume card, the explainer is a section of the plan file, so it travels with the plan to
// every machine and its history is the plan's git history.
import { readFileSync, writeFileSync } from "node:fs";

export const EXPLAINER_HEADING = "## What we learned";

export interface Explainer {
  topic: string;
  changed: string;
  why: string;
  dropped: string;
  remember: string;
  at: string;
  by: string;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 500);

export function renderExplainer(x: Explainer): string {
  return [
    EXPLAINER_HEADING,
    "",
    `- Topic: ${one(x.topic) || "general"}`,
    `- Changed: ${one(x.changed)}`,
    `- Why: ${one(x.why)}`,
    `- Dropped: ${one(x.dropped) || "nothing"}`,
    `- Remember: ${one(x.remember)}`,
    `- Closed: ${x.at} by ${one(x.by)}`,
  ].join("\n");
}

export function explainerOf(raw: string): Explainer | null {
  const at = raw.indexOf(`\n${EXPLAINER_HEADING}\n`);
  if (at < 0) return null;
  const section = raw.slice(at + EXPLAINER_HEADING.length + 2).split(/\n## /)[0];
  const f = (label: string) => new RegExp(`^- ${label}: (.*)$`, "m").exec(section)?.[1]?.trim();
  const changed = f("Changed"), why = f("Why"), remember = f("Remember"), closed = f("Closed");
  if (!changed || !why || !remember || !closed) return null;
  const c = /^(\S+) by (.*)$/.exec(closed);
  return { topic: f("Topic") ?? "general", changed, why, dropped: f("Dropped") ?? "nothing", remember, at: c?.[1] ?? "", by: c?.[2] ?? closed };
}

/** The plan text with its explainer replaced, or appended when it had none. */
export function withExplainer(raw: string, x: Explainer): string {
  const block = renderExplainer(x);
  const at = raw.indexOf(`\n${EXPLAINER_HEADING}\n`);
  if (at < 0) return `${raw.replace(/\s*$/, "")}\n\n${block}\n`;
  const after = raw.slice(at + 1);
  const end = after.slice(EXPLAINER_HEADING.length).search(/\n## /);
  const tail = end < 0 ? "" : after.slice(EXPLAINER_HEADING.length + end);
  return `${raw.slice(0, at + 1)}${block}\n${tail}`.replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}

export function writeExplainer(file: string, x: Explainer): void {
  writeFileSync(file, withExplainer(readFileSync(file, "utf8"), x));
}

/** The prompt an Explain this button hands to a session: everything it needs to teach the owner. */
export function explainPrompt(project: string, planId: string, title: string): string {
  return `Explain the PANTRY plan ${planId} ("${title}") in ${project} to me. Read the plan file, its What we learned and Resume card sections, and the commits that touched its files. Start with what it changed and why in a few sentences, then answer my questions at whatever depth I ask. Do not change anything.`;
}
