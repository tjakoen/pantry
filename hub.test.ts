import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectFor, readRegistry, registerProject, registryPath, unregisterProject, writeRegistry } from "./hub.ts";
import { isLoopbackRequest } from "./answers.ts";

describe("hub registry", () => {
  test("assigns the lowest free port above the hub and dedupes names", () => {
    let reg = { hubPort: 4400, projects: [] as { name: string; path: string; port: number }[] };
    reg = registerProject(reg, "/a/site").reg;
    reg = registerProject(reg, "/b/site").reg;
    expect(reg.projects.map((p) => [p.name, p.port])).toEqual([["site", 4401], ["site-2", 4402]]);
    reg = unregisterProject(reg, "site");
    expect(registerProject(reg, "/c/x").project.port).toBe(4401);
  });

  test("registering a known path is a no-op", () => {
    const first = registerProject({ hubPort: 4400, projects: [] }, "/a/site");
    const again = registerProject(first.reg, "/a/site");
    expect(again.added).toBe(false);
    expect(again.reg.projects.length).toBe(1);
  });

  test("projectFor picks the deepest containing project", () => {
    const reg = { hubPort: 4400, projects: [
      { name: "outer", path: "/w/hau", port: 4401 },
      { name: "inner", path: "/w/hau/platform", port: 4402 },
    ] };
    expect(projectFor(reg, "/w/hau/platform/src")?.name).toBe("inner");
    expect(projectFor(reg, "/w/hau/notes")?.name).toBe("outer");
    expect(projectFor(reg, "/w/hauling")).toBeNull();
  });

  test("round-trips through the file named by PANTRY_HOME", () => {
    const home = mkdtempSync(join(tmpdir(), "pantry-hub-"));
    const file = registryPath({ PANTRY_HOME: home });
    expect(readRegistry(file).projects).toEqual([]);
    writeRegistry(registerProject(readRegistry(file), "/a/site").reg, file);
    expect(readRegistry(file).projects[0].port).toBe(4401);
  });
});

describe("container trust switch", () => {
  test("off by default: a gateway address is not loopback", () => {
    expect(isLoopbackRequest("192.168.65.1", {})).toBe(false);
  });
  test("on: any real address passes, a missing one still fails", () => {
    expect(isLoopbackRequest("192.168.65.1", { PANTRY_TRUST_CONTAINER_NETWORK: "1" })).toBe(true);
    expect(isLoopbackRequest(null, { PANTRY_TRUST_CONTAINER_NETWORK: "1" })).toBe(false);
  });
});

describe("hub health", () => {
  test("a path in no project is 404 with registered false", async () => {
    const { runHub } = await import("./hub.ts");
    const home = mkdtempSync(join(tmpdir(), "pantry-hubh-"));
    const file = join(home, "projects.json");
    writeRegistry({ hubPort: 47100 + Math.floor(Math.random() * 500), projects: [] }, file);
    const server = await runHub({ file });
    const res = await fetch(`${server.url}health?path=/nowhere`);
    expect(res.status).toBe(404);
    expect((await res.json()).registered).toBe(false);
    server.stop(true);
  });

  test("workCounts reports ready and claimed", async () => {
    const { workCounts } = await import("./orchestrator.ts");
    const root = mkdtempSync(join(tmpdir(), "pantry-hubc-"));
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(root, "plans"));
    writeFileSync(join(root, "pantry.config.json"), JSON.stringify({ projectName: "x" }));
    writeFileSync(join(root, "plans/a.md"), "---\nid: a\nstatus: todo\ntrack: t\ndepends: []\nowner: ai\n---\n# a\n");
    expect(await workCounts(join(root, "home"), "x", root)).toEqual({ ready: 1, claimed: 0 });
  });
});
