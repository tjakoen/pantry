import { describe, expect, test } from "bun:test";
import { buildManifest } from "@tjakoen/grain/ai/manifest.ts";
import { createSessionDoor, observeText, operable, validateMove, type WindowReport } from "./session-door.ts";
import { addressFor } from "./session-client.ts";

const page = (url = "/plans", over: Partial<WindowReport> = {}): WindowReport => ({
  client: "w1",
  url,
  at: Date.now(),
  manifest: buildManifest(url, [
    { id: "screen", kind: "screen", accepts: ["navigate"] },
    { id: "plan:pantry-app", kind: "plan", accepts: [] },
  ], { readable: [{ id: "plan:pantry-app", kind: "plan", text: "Desktop app" }] }),
  links: [
    { surface: "plan:pantry-app", href: "/plans/plan/pantry-app", label: "Desktop app" },
    { surface: "view:decisions", href: "/decisions", label: "Decisions" },
  ],
  ...over,
});

describe("validateMove", () => {
  test("a surface on screen becomes GRAIN's navigate intent to its link", () => {
    const v = validateMove(page(), { to: "plan:pantry-app" });
    expect(v).toEqual({ ok: true, via: "plan:pantry-app", intent: { surface: "screen", action: "navigate", payload: { href: "/plans/plan/pantry-app" } } });
  });

  test("an href the page links to is legal, trailing slash or not", () => {
    expect(validateMove(page(), { href: "/decisions/" }).ok).toBe(true);
  });

  test("a surface not on screen is refused with the valid moves named", () => {
    const v = validateMove(page(), { to: "plan:nope" });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toContain("No surface plan:nope");
    expect(v.valid).toEqual([
      "to: plan:pantry-app (/plans/plan/pantry-app) — Desktop app",
      "to: view:decisions (/decisions) — Decisions",
    ]);
  });

  test("an href nothing links to, or one off this origin, is refused", () => {
    expect(validateMove(page(), { href: "/answers" }).ok).toBe(false);
    const v = validateMove(page(), { href: "https://evil.example/plans" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("not a root-relative path");
  });

  test("no window, or a page whose screen takes no navigate, refuses", () => {
    expect(validateMove(null, { to: "plan:pantry-app" }).ok).toBe(false);
    const still = page("/plans", { manifest: buildManifest("/plans", [{ id: "screen", kind: "screen", accepts: [] }]) });
    expect(validateMove(still, { to: "plan:pantry-app" }).ok).toBe(false);
  });

  test("an empty move asks for to or href", () => {
    const v = validateMove(page(), {});
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("Pass `to`");
  });
});

describe("observe", () => {
  test("lists only the verbs the page accepts, its readable state and its moves", () => {
    const t = observeText(page(), 1);
    expect(t).toContain("window: /plans");
    expect(t).toContain("- navigate [light]");
    expect(t).not.toContain("chat.send");
    expect(t).toMatch(/plan:pantry-app.*"Desktop app"/);
    expect(t).toContain("- to: view:decisions (/decisions)");
    expect(operable(page().manifest).actions.map((a) => a.name)).toEqual(["navigate"]);
  });

  test("says so when no window shows the project", () => {
    expect(observeText(null, 0)).toContain("No PANTRY window");
  });
});

describe("createSessionDoor", () => {
  test("act sends the move to the watched window and returns once it arrives", async () => {
    const sent: unknown[] = [];
    const door = createSessionDoor((client, move) => {
      sent.push({ client, move });
      queueMicrotask(() => door.report({ ...page("/plans/plan/pantry-app"), client: "w2" }));
    });
    door.report(page());
    const r = await door.act({ to: "plan:pantry-app" }, 500);
    expect(sent).toEqual([{ client: "w1", move: { href: "/plans/plan/pantry-app", surface: "plan:pantry-app" } }]);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Moved the window to /plans/plan/pantry-app");
  });

  test("a refused act sends nothing", async () => {
    const sent: unknown[] = [];
    const door = createSessionDoor((c, m) => sent.push([c, m]));
    door.report(page());
    const r = await door.act({ to: "decision:x" }, 50);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("Valid moves:");
    expect(sent).toEqual([]);
  });

  test("a window that never arrives times out and says so", async () => {
    const door = createSessionDoor(() => {});
    door.report(page());
    const r = await door.act({ to: "plan:pantry-app" }, 30);
    expect(r).toEqual({ ok: false, text: expect.stringContaining("did not report arriving") });
  });

  test("the most recently loaded or focused window is the watched one; a heartbeat does not steal it", () => {
    let t = 1000;
    const door = createSessionDoor(() => {}, () => t);
    door.report({ ...page("/plans"), client: "a" });
    t = 2000;
    door.report({ ...page("/decisions"), client: "b" });
    t = 3000;
    door.report({ ...page("/plans"), client: "a", focused: false });
    expect(door.current()?.client).toBe("b");
    expect(door.windows()).toBe(2);
    t = 200_000;
    expect(door.current()).toBeNull();
  });
});

describe("addressFor", () => {
  test("maps a link to the surface it opens", () => {
    expect(addressFor("plan", "/plans/plan/pantry-app")).toBe("plan:pantry-app");
    expect(addressFor("plan", "/__pantry/plans/plan/pantry-app/")).toBe("plan:pantry-app");
    expect(addressFor("plan", "/plans")).toBeNull();
    expect(addressFor("decision", "/decisions/use-sse")).toBe("decision:use-sse");
    expect(addressFor("view", "/")).toBe("view:home");
    expect(addressFor("view", "/decisions")).toBe("view:decisions");
    expect(addressFor("tile", "/docs/grain")).toBe("tile:grain");
  });
});
