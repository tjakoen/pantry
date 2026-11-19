import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineSlug, readOthers, staleMachines, STATE_FILE, STATE_HEARTBEAT_MS, writeState, type MachineState } from "./hub-sync.ts";
import { waitingBand, type HubRow, type HubSummary } from "./hub-home.ts";

const sum = (over: Partial<HubSummary> = {}): HubSummary => ({ live: 0, agentsRunning: 0, waiting: 0, answered: 0, drift: 0, outOfScope: 0, next: null, lastSeenAt: null, items: [], threads: [], ...over });
const row = (name: string, over: Partial<HubRow> = {}): HubRow => ({ name, path: `/p/${name}`, url: "http://localhost:4401/", up: true, summary: sum(), ...over });
const item = { kind: "decision", title: "Pick a name", detail: "Blocks a.", label: "Answer", path: "/decisions/d1" };
const T = new Date("2026-11-19T08:00:00.000Z");

describe("hub sync", () => {
  test("the machine slug matches agent-config's folder names", () => {
    expect(machineSlug("Tjakoens-MacBook-Air.local")).toBe("tjakoens-macbook-air");
    expect(machineSlug("Tjakoen's Windows PC")).toBe("tjakoens-windows-pc");
  });

  test("the state file carries labels, never paths, and is written only on change or heartbeat", () => {
    const dir = mkdtempSync(join(tmpdir(), "sync-"));
    const cfg = { dir, machine: "air" };
    const rows = [row("alpha", { summary: sum({ waiting: 1, items: [item] }) })];
    expect(writeState(cfg, rows, T)).toBe(true);
    const text = readFileSync(join(dir, "air", STATE_FILE), "utf8");
    expect(text).toContain("Pick a name");
    expect(text).not.toContain("/p/alpha");
    expect(text).not.toContain("/decisions/d1");
    expect(writeState(cfg, rows, new Date(T.getTime() + 60_000))).toBe(false);
    expect(writeState(cfg, rows, new Date(T.getTime() + STATE_HEARTBEAT_MS + 1))).toBe(true);
    expect(writeState(cfg, [row("alpha")], new Date(T.getTime() + STATE_HEARTBEAT_MS + 2))).toBe(true);
  });

  test("a hub still reading a project does not write, so items are not dropped for a cycle", () => {
    const dir = mkdtempSync(join(tmpdir(), "sync-"));
    expect(writeState({ dir, machine: "air" }, [row("alpha", { pending: true, summary: null })], T)).toBe(false);
  });

  test("other machines are read, this one and broken files skipped, and old ones flagged", () => {
    const dir = mkdtempSync(join(tmpdir(), "sync-"));
    const put = (m: string, s: unknown) => { mkdirSync(join(dir, m), { recursive: true }); writeFileSync(join(dir, m, STATE_FILE), typeof s === "string" ? s : JSON.stringify(s)); };
    put("air", { machine: "air", writtenAt: T.toISOString(), projects: [] });
    put("pro", { machine: "pro", writtenAt: T.toISOString(), projects: [{ name: "grain", live: 0, lastSeenAt: null, next: null, items: [item] }] });
    put("pc", { machine: "pc", writtenAt: "2026-11-15T08:00:00.000Z", projects: [] });
    put("broken", "{ not json");
    const others = readOthers({ dir, machine: "air" });
    expect(others.map((o) => o.machine)).toEqual(["pro", "pc"]);
    expect(staleMachines(others, T.getTime())).toEqual([{ machine: "pc", hours: 96 }]);
  });

  test("the band shows another machine's items with where and when, and says when one is stale", () => {
    const pro: MachineState = { machine: "pro", writtenAt: "2026-11-19T06:00:00.000Z", projects: [{ name: "grain", live: 0, lastSeenAt: null, next: null, items: [item] }] };
    const pc: MachineState = { machine: "pc", writtenAt: "2026-11-15T08:00:00.000Z", projects: [] };
    const html = waitingBand([row("alpha")], [pro, pc], T.getTime());
    expect(html).toContain("Pick a name");
    expect(html).toContain("on pro, 2h ago");
    expect(html).toContain("pc last reported 4d ago");
    expect(html).toContain(`Waiting on you <span class="hub-meta">1</span>`);
  });
});
