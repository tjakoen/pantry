import { describe, expect, test } from "bun:test";
import { assembleBrief, briefText, commandFromDetail, type BriefInputs } from "./brief.ts";
import { briefBody } from "./brief-routes.ts";
import type { SessionRow } from "./sessions.ts";
import type { ClaimView, PlanLike } from "./orchestrator.ts";

const ROOT = "/repo";
const NOW = "2026-11-04T12:00:00.000Z";

const plan = (id: string, extra: Partial<PlanLike> = {}): PlanLike => ({
  id, title: `Plan ${id}`, status: "todo", owner: "ai", depends: [], touches: [], ...extra,
});
const session = (id: string, paths: string[], extra: Partial<SessionRow> = {}): SessionRow => ({
  id, repo: "repo", cwd: ROOT, parent: null, state: "alive", firstSeenAt: NOW, lastSeenAt: NOW,
  idleSeconds: 0, stopped: false, skewedEvents: 0, toolEvents: paths.length, lastTool: "Edit",
  paths: paths.map((p) => `${ROOT}/${p}`), pathsOmitted: 0, ...extra,
});
const inputs = (over: Partial<BriefInputs> = {}): BriefInputs => ({
  now: NOW, project: "repo", repoRoot: ROOT, plans: [], decisions: [], claims: new Map(), sessions: [], checks: [], ...over,
});

describe("in flight", () => {
  test("a doing plan with every task ticked still appears", () => {
    const b = assembleBrief(inputs({ plans: [plan("a", { status: "doing", touches: ["src"] })] }));
    expect(b.inFlight.map((r) => r.planId)).toEqual(["a"]);
  });

  test("an active claim puts a todo plan in flight with its holder", () => {
    const claims = new Map<string, ClaimView>([["a", { planId: "a", sessionId: "abcdef1234", tool: "claude", claimedAt: NOW, lastAt: NOW, state: "active" }]]);
    const b = assembleBrief(inputs({ plans: [plan("a")], claims }));
    expect(b.inFlight[0].claim).toEqual({ tool: "claude", sessionId: "abcdef12", state: "active", lastAt: NOW });
  });

  test("a file outside every in-flight plan is flagged on its plan, with a realign prompt", () => {
    const b = assembleBrief(inputs({
      plans: [plan("a", { status: "doing", touches: ["src/a.ts"] })],
      sessions: [session("s1", ["src/a.ts", "README.md"])],
    }));
    expect(b.inFlight[0].outOfScope).toEqual(["README.md"]);
    expect(b.inFlight[0].actions.find((a) => a.label === "Copy realign prompt")?.value).toContain("README.md");
  });

  test("a file inside a second in-flight plan's touches is not flagged", () => {
    const b = assembleBrief(inputs({
      plans: [plan("a", { status: "doing", touches: ["src/a.ts"] }), plan("b", { status: "doing", touches: ["src/b.ts"] })],
      sessions: [session("s1", ["src/a.ts", "src/b.ts"])],
    }));
    expect(b.inFlight.every((r) => r.outOfScope.length === 0)).toBe(true);
  });

  test("a session that ended an hour ago with no plan is a no-plan row", () => {
    const hourAgo = new Date(Date.parse(NOW) - 3600_000).toISOString();
    const b = assembleBrief(inputs({ sessions: [session("s1", ["x.ts"], { state: "ended", lastSeenAt: hourAgo })] }));
    expect(b.inFlight).toHaveLength(1);
    expect(b.inFlight[0].planId).toBeNull();
    expect(b.inFlight[0].outOfScope).toEqual(["x.ts"]);
  });

  test("a session that ended two days ago drops off", () => {
    const old = new Date(Date.parse(NOW) - 48 * 3600_000).toISOString();
    const b = assembleBrief(inputs({ sessions: [session("s1", ["x.ts"], { state: "ended", lastSeenAt: old })] }));
    expect(b.inFlight).toHaveLength(0);
  });

  test("a missing claims file still reads in-flight work from status, and says so", () => {
    const b = assembleBrief(inputs({ claims: null, plans: [plan("a", { status: "doing" })] }));
    expect(b.inFlight).toHaveLength(1);
    expect(b.notes.join(" ")).toContain("Claims not readable here");
  });
});

describe("waiting on the owner", () => {
  test("a human plan that an AI plan depends on is listed with what it holds", () => {
    const b = assembleBrief(inputs({ plans: [plan("h", { owner: "human" }), plan("a", { depends: ["h"] })] }));
    const row = b.waiting.find((w) => w.kind === "human-plan");
    expect(row?.id).toBe("h");
    expect(row?.detail).toContain("a");
  });

  test("an open decision links to its answer page", () => {
    const b = assembleBrief(inputs({ decisions: [{ id: "d1", status: "open", blocks: ["a"], title: "Pick one" }] }));
    expect(b.waiting[0].actions[0]).toEqual({ label: "Open", kind: "link", value: "/decisions/d1" });
  });
});

describe("drift and next", () => {
  test("a failing warn check becomes a row with its fix command", () => {
    const b = assembleBrief(inputs({ checks: [
      { id: "graphify-freshness", severity: "warn", ok: false, label: "graphify freshness", detail: "merged-graph.json predates this repo's own extraction — run pantry graph merge" },
      { id: "ok-one", severity: "warn", ok: true, label: "fine", detail: "" },
      { id: "fyi", severity: "info", ok: false, label: "fyi", detail: "" },
    ] }));
    expect(b.drift.map((d) => d.id)).toEqual(["graphify-freshness"]);
    expect(b.drift[0].actions[0]).toEqual({ label: "Copy fix", kind: "copy", value: "pantry graph merge" });
  });

  test("commandFromDetail reads both phrasings and returns null when there is none", () => {
    expect(commandFromDetail("1 stale (ai-development) — run pantry skills sync")).toBe("pantry skills sync");
    expect(commandFromDetail("no index here (run: tokensave init)")).toBe("tokensave init");
    expect(commandFromDetail("all good")).toBeNull();
  });

  test("the first ready plan is next, with a start prompt", () => {
    const b = assembleBrief(inputs({ plans: [plan("b"), plan("a"), plan("h", { owner: "human" })] }));
    expect(b.next.ready?.id).toBe("a");
    expect(b.next.ready?.actions.some((a) => a.value.includes("pantry_claim plan a"))).toBe(true);
    expect(b.next.skipped.map((s) => s.id)).toEqual(["h"]);
  });
});

describe("projections", () => {
  test("the text and the page carry the same sections", () => {
    const b = assembleBrief(inputs({ plans: [plan("a", { status: "doing" })] }));
    const text = briefText(b);
    for (const h of ["## In flight", "## Waiting on the owner", "## Drift", "## Next"]) expect(text).toContain(h);
    const html = briefBody(b);
    for (const h of ["Agents", "Queue", "Inbox"]) expect(html).toContain(h);
  });

  test("copy values are escaped into the attribute", () => {
    const b = assembleBrief(inputs({
      plans: [plan("a", { status: "doing", touches: ["src"] })],
      sessions: [session("s1", ["src/x.ts", `o"<b>.ts`])],
    }));
    expect(briefBody(b)).not.toContain(`o"<b>`);
  });
});

test("prose after the word run is not a fix command", () => {
  expect(commandFromDetail("28 commits since the newest run report (2026-11-01) — over 15, close a run with a report")).toBeNull();
  expect(commandFromDetail("1 behind: batch 0.2.1<0.3.0 — run deps:refresh")).toBe("deps:refresh");
});

test("an unread answer is carried with the plans its decision holds, and an ack command", () => {
  const answer = { kind: "answer" as const, id: "a-1", at: NOW, via: "t", choice: "B", request: { source: "decision" as const, ref: "d1", question: "Pick?" } };
  const b = assembleBrief(inputs({ decisions: [{ id: "d1", status: "open", blocks: ["p1"] }], answers: [answer] }));
  expect(b.answered).toHaveLength(1);
  expect(b.answered[0].holds).toEqual(["p1"]);
  expect(briefText(b)).toContain("pantry answers ack a-1");
  expect(b.answered[0].actions[0].value).toContain("pantry answers ack a-1");
});
