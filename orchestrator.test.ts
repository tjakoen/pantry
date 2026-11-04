import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { claimPlan, foldClaims, listClaims, readClaims, readyPlans, updateClaim, type ClaimContext, type ClaimLine, type PlanLike } from "./orchestrator.ts";

const H = 60 * 60 * 1000;
const T0 = Date.parse("2026-11-04T00:00:00Z");
const plan = (id: string, over: Partial<PlanLike> = {}): PlanLike => ({ id, title: id, status: "todo", owner: "ai", depends: [], touches: [], ...over });
const line = (planId: string, event: ClaimLine["event"], atMs: number, sessionId = "s1"): ClaimLine =>
  ({ project: "p", planId, sessionId, tool: "claude", at: new Date(atMs).toISOString(), event });

function ctx(plans: PlanLike[], now = T0, decisions: ClaimContext["decisions"] = []): ClaimContext {
  const dir = mkdtempSync(join(tmpdir(), "pantry-orch-"));
  return { file: join(dir, "claims", "p.jsonl"), project: "p", plans, decisions, now: () => now, ttl: 30 * 60 * 1000 };
}

describe("readyPlans", () => {
  test("owner must be exactly ai, and a missing owner is never offered", () => {
    const r = readyPlans([plan("a"), plan("b", { owner: "human" }), plan("c", { ownerError: true })], [], new Map());
    expect(r.ready.map((p) => p.id)).toEqual(["a"]);
    expect(r.skipped.map((s) => s.reasons[0])).toEqual(["owner: human", "owner: missing"]);
  });

  test("unmet and missing dependencies block; done ones do not", () => {
    const r = readyPlans([plan("a", { depends: ["x", "y", "z"] }), plan("x", { status: "done" }), plan("y")], [], new Map());
    expect(r.skipped.find((s) => s.id === "a")?.reasons).toEqual(["depends: y", "depends: z (no such plan)"]);
  });

  test("an open decision blocks only through its blocks list", () => {
    const decisions = [{ id: "d1", status: "open", blocks: ["a"] }, { id: "d2", status: "resolved", blocks: ["b"] }];
    const r = readyPlans([plan("a"), plan("b")], decisions, new Map());
    expect(r.ready.map((p) => p.id)).toEqual(["b"]);
  });

  test("lists every reason in the fixed order", () => {
    const claims = foldClaims([line("a", "claim", T0)], T0, H);
    const r = readyPlans([plan("a", { owner: "human", depends: ["q"] })], [{ id: "d", status: "open", blocks: ["a"] }], claims);
    expect(r.skipped[0].reasons.map((x) => x.split(":")[0].split(" ")[0])).toEqual(["owner", "depends", "decision", "claimed"]);
  });

  test("offers in ascending id order", () => {
    expect(readyPlans([plan("b"), plan("a")], [], new Map()).ready.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("fold", () => {
  test("active, expired, released", () => {
    const ttl = 30 * 60 * 1000;
    expect(foldClaims([line("a", "claim", T0)], T0 + 10 * 60 * 1000, ttl).get("a")?.state).toBe("active");
    expect(foldClaims([line("a", "claim", T0)], T0 + ttl, ttl).get("a")?.state).toBe("expired");
    expect(foldClaims([line("a", "claim", T0), line("a", "release", T0 + 1)], T0 + 2, ttl).get("a")?.state).toBe("released");
  });

  test("a done claim blocks until the file says done or 24 hours pass", () => {
    const lines = [line("a", "claim", T0), line("a", "done", T0 + 1)];
    const notYet = foldClaims(lines, T0 + H, H);
    expect(readyPlans([plan("a")], [], notYet).ready).toEqual([]);
    const later = foldClaims(lines, T0 + 25 * H, H);
    expect(later.get("a")?.state).toBe("stale-done");
    expect(readyPlans([plan("a")], [], later).ready.map((p) => p.id)).toEqual(["a"]);
  });

  test("events from another session do not change the claim", () => {
    const v = foldClaims([line("a", "claim", T0, "s1"), line("a", "release", T0 + 1, "s2")], T0 + 2, H).get("a");
    expect(v?.state).toBe("active");
  });
});

describe("claims on disk", () => {
  test("twenty concurrent claims for one plan produce exactly one", async () => {
    const c = ctx([plan("a")]);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => claimPlan(c, "a", `s${i}`, "codex")));
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect((await readClaims(c.file)).length).toBe(1);
  });

  test("a second claim names the holder; an invalid tool is rejected", async () => {
    const c = ctx([plan("a")]);
    expect((await claimPlan(c, "a", "s1", "cursor")).ok).toBe(false);
    await claimPlan(c, "a", "s1", "claude");
    const again = await claimPlan(c, "a", "s2", "codex");
    expect(again.ok ? "" : again.error).toContain("claimed by claude s1");
  });

  test("only the holder may heartbeat or release; expired claims are not revived", async () => {
    const c = ctx([plan("a")]);
    await claimPlan(c, "a", "s1", "claude");
    expect((await updateClaim(c, "a", "s2", "release")).ok).toBe(false);
    const late = { ...c, now: () => T0 + H };
    expect((await updateClaim(late, "a", "s1", "heartbeat")).ok).toBe(false);
  });

  test("a done release after expiry is accepted when nobody claimed since", async () => {
    const c = ctx([plan("a")]);
    await claimPlan(c, "a", "s1", "claude");
    const late = { ...c, now: () => T0 + H };
    const r = await updateClaim(late, "a", "s1", "done");
    expect(r.ok && r.value.state).toBe("done");
  });

  test("listClaims keeps 23-hour-old releases and drops 25-hour-old ones", () => {
    const lines = [line("a", "claim", T0), line("a", "release", T0), line("b", "claim", T0 + 2 * H), line("b", "release", T0 + 2 * H)];
    const ids = listClaims(lines, T0 + 25 * H, H, new Set()).map((v) => v.planId);
    expect(ids).toEqual(["b"]);
  });
});

describe("board annotation", () => {
  test("adds a claim badge to the matching card only", async () => {
    const { annotateBoard } = await import("./orchestrator.ts");
    const html = `<a class="card proof-card" href="/plans/plan/a">\n  <div class="proof-card__top">x</div></a><a href="/plan/b">\n  <div class="proof-card__top">y</div></a>`;
    const out = annotateBoard(html, new Map([["a", { kind: "claimed", label: "claude s1 · 3m" }]]));
    expect(out).toContain('data-claim="claimed">claude s1 · 3m</span>');
    expect(out.match(/data-claim/g)?.length).toBe(1);
  });
});
