import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appLink, ensureHub, hubFilePath, hubUrl, openPantry, probeHealth, readHubFile } from "./hub-ensure.ts";
import { runHub, writeRegistry } from "./hub.ts";

const home = () => mkdtempSync(join(tmpdir(), "pantry-ensure-"));
const noSleep = async () => {};

describe("pantry hub ensure", () => {
  test("exits fast when the hub already answers, starting nothing", async () => {
    const env = { PANTRY_HOME: home() };
    let started = 0;
    const r = await ensureHub(env, { probe: async () => ({ ok: true, pid: 42 }), start: () => ++started });
    expect(r).toEqual({ state: "running", port: 4400, pid: 42 });
    expect(started).toBe(0);
    expect(readHubFile(hubFilePath(env))).toBeNull();
  });

  test("starts the hub when nothing answers and writes hub.json under PANTRY_HOME", async () => {
    const env = { PANTRY_HOME: home() };
    writeRegistry({ hubPort: 4977, projects: [] }, join(env.PANTRY_HOME, "projects.json"));
    let calls = 0;
    const r = await ensureHub(env, { probe: async () => (++calls > 2 ? { ok: true } : null), start: () => 1234, sleep: noSleep });
    expect(r).toEqual({ state: "started", port: 4977, pid: 1234 });
    expect(readHubFile(join(env.PANTRY_HOME, "hub.json"))).toMatchObject({ port: 4977, pid: 1234 });
  });

  test("reports failure when the started hub never answers", async () => {
    const env = { PANTRY_HOME: home() };
    const r = await ensureHub(env, { probe: async () => null, start: () => 9, sleep: noSleep, waitMs: 5 });
    expect(r.state).toBe("failed");
  });
});

describe("hub health", () => {
  test("a real hub on a spare port names itself, its pid and the needs-you total", async () => {
    const dir = home();
    const file = join(dir, "projects.json");
    writeRegistry({ hubPort: 0, projects: [] }, file);
    const server = await runHub({ file });
    try {
      const h = await probeHealth(server.port!);
      expect(h).toMatchObject({ ok: true, service: "pantry-hub", pid: process.pid, needsYou: 0 });
    } finally {
      server.stop(true);
    }
  });

  test("nothing listening reads as down, not as an error", async () => {
    expect(await probeHealth(1, 300)).toBeNull();
  });
});

describe("pantry open", () => {
  test("uses the pantry:// link when the app is registered", () => {
    const ran: string[][] = [];
    const r = openPantry(4400, "site", { platform: "darwin", hasApp: () => true, run: (c) => ran.push(c) });
    expect(r).toEqual({ via: "app", target: "pantry://project/site" });
    expect(ran).toEqual([["open", "pantry://project/site"]]);
  });

  test("falls back to the hub URL in the browser without the app", () => {
    const ran: string[][] = [];
    const r = openPantry(4400, "my site", { platform: "linux", hasApp: () => false, run: (c) => ran.push(c) });
    expect(r.via).toBe("browser");
    expect(ran).toEqual([["xdg-open", "http://localhost:4400/open/my%20site"]]);
  });

  test("links without a project land on the hub", () => {
    expect(appLink()).toBe("pantry://");
    expect(hubUrl(4400)).toBe("http://localhost:4400/");
  });
});
