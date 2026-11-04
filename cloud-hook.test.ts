import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CLOUD_HOOK_PATH, ensureCloudHook, mergeHook } from "./cloud-hook.ts";

describe("cloud standards hook", () => {
  test("merge adds one SessionStart entry and is idempotent", () => {
    const once = mergeHook({ hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] } });
    expect(once.changed).toBe(true);
    expect(once.config.hooks?.Stop?.length).toBe(1);
    expect(mergeHook(once.config).changed).toBe(false);
  });

  test("scaffolds the script and both configs, keeping existing settings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pantry-cloud-"));
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude/settings.json"), JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }));
    const created: string[] = [], skipped: string[] = [];
    await ensureCloudHook(dir, created, skipped);
    expect(created).toContain(CLOUD_HOOK_PATH);
    const claude = JSON.parse(readFileSync(join(dir, ".claude/settings.json"), "utf8"));
    expect(claude.permissions.allow).toEqual(["Bash(ls)"]);
    expect(JSON.stringify(claude.hooks.SessionStart)).toContain(CLOUD_HOOK_PATH);
    expect(JSON.stringify(JSON.parse(readFileSync(join(dir, ".codex/hooks.json"), "utf8")))).toContain(CLOUD_HOOK_PATH);
    const again: string[] = [];
    await ensureCloudHook(dir, again, []);
    expect(again).toEqual([]);
  });

  test("leaves an invalid JSON config untouched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pantry-cloud-"));
    mkdirSync(join(dir, ".codex"), { recursive: true });
    writeFileSync(join(dir, ".codex/hooks.json"), "{ not json");
    await ensureCloudHook(dir, [], []);
    expect(readFileSync(join(dir, ".codex/hooks.json"), "utf8")).toBe("{ not json");
  });
});
