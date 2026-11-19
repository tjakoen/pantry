import { describe, expect, test } from "bun:test";
import { cardOf, pausedUntil, withCard, type ResumeCard } from "./resume.ts";
import { assembleBrief } from "./brief.ts";
import { inFlightBand, summarize, type HubRow } from "./hub-home.ts";

const NOW = "2026-11-19T08:00:00.000Z";
const card: ResumeCard = { stopped: "Band renders; tests green.", next: "Wire the finish gate.", waitingOn: "nothing", reason: "limit", resumeAt: "2026-11-19T13:00:00.000Z", at: NOW, by: "claude (claude-opus-5-5) on air" };
const plan = "---\nid: a\nstatus: todo\nowner: ai\n---\n\n# A\n\n- [ ] step\n";

describe("resume cards", () => {
  test("a card round-trips through the plan file", () => {
    const raw = withCard(plan, card);
    expect(raw).toContain("## Resume card");
    expect(raw).toContain("- Ended: limit, resumes 2026-11-19T13:00:00.000Z");
    expect(cardOf(raw)).toEqual(card);
  });

  test("a new card replaces the old one and keeps what follows it", () => {
    const first = withCard(plan, card) + "\n## Notes\n\nkept\n";
    const raw = withCard(first, { ...card, next: "Ship it.", reason: "handoff", resumeAt: undefined });
    expect(raw.match(/## Resume card/g)?.length).toBe(1);
    expect(raw).toContain("- Next: Ship it.");
    expect(raw).toContain("## Notes\n\nkept");
    expect(cardOf(raw)?.reason).toBe("handoff");
  });

  test("a plan without a card, or with a broken one, reads as none", () => {
    expect(cardOf(plan)).toBeNull();
    expect(cardOf(plan + "\n## Resume card\n\n- Stopped: half\n")).toBeNull();
  });

  test("only a limit card with a future resume time pauses a thread", () => {
    expect(pausedUntil(card, Date.parse(NOW))).toBe(card.resumeAt!);
    expect(pausedUntil(card, Date.parse("2026-11-19T14:00:00.000Z"))).toBeNull();
    expect(pausedUntil({ ...card, reason: "handoff" }, Date.parse(NOW))).toBeNull();
  });

  test("a paused plan reaches the hub's In flight band with its resume time and next step", () => {
    const b = assembleBrief({ now: NOW, project: "x", repoRoot: "/repo", plans: [{ id: "a", title: "A", status: "todo", owner: "ai", depends: [], touches: [], card }], decisions: [], claims: new Map(), checks: [], sessions: [] });
    expect(b.paused).toEqual([{ planId: "a", title: "A", until: card.resumeAt!, next: card.next }]);
    const row: HubRow = { name: "pantry", path: "/p", url: "http://localhost:4402/", up: true, summary: summarize(b) };
    const html = inFlightBand([row], Date.parse(NOW));
    expect(html).toContain("Paused, resumes in 5h");
    expect(html).toContain("Next: Wire the finish gate.");
    expect(html).toContain(`href="http://localhost:4402/plan/a"`);
  });
});
