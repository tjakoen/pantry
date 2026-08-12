// pantry/hooks.test.ts — the drift check finds leftovers and stays silent about legitimate local
// hooks. The second half is the one worth guarding: a check that told a repo to delete a working
// hook would be uninstalled the same day, and that is the design constraint the module was written
// under rather than an edge case it happens to handle.
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHookCommands, findLeftovers, checkHookDrift, type LoopManifest } from "./hooks.ts";

const manifest = (over: Partial<LoopManifest> = {}): LoopManifest => ({
  version: 1,
  generated: "2026-08-13",
  mechanisms: [
    {
      id: "session-guard",
      event: "Stop",
      matcher: null,
      command: 'bash "$HOME"/.claude/tools/session-guard.sh',
      movedOn: "2026-08-10",
      supersedes: ["tools/session-guard\\.sh", "tools/durable-state\\.sh"],
      why: "",
    },
  ],
  ...over,
});

const local = (command: string, event = "Stop") => [{ event, command, file: ".claude/settings.json" }];

describe("readHookCommands", () => {
  test("one row per command, carrying the event", () => {
    expect(
      readHookCommands({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "a.sh" }, { type: "command", command: "b.sh" }] }],
          PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "c.sh" }] }],
        },
      }),
    ).toEqual([
      { event: "Stop", command: "a.sh" },
      { event: "Stop", command: "b.sh" },
      { event: "PostToolUse", command: "c.sh" },
    ]);
  });

  test("a settings file that only carries permissions has no hooks, and that is not an error", () => {
    expect(readHookCommands({ permissions: { allow: ["Bash(git:*)"] } })).toEqual([]);
  });

  test("a malformed entry is skipped rather than fatal", () => {
    expect(readHookCommands({ hooks: { Stop: [{ hooks: [{ type: "command" }, { command: "real.sh" }] }] } })).toEqual([
      { event: "Stop", command: "real.sh" },
    ]);
  });
});

describe("findLeftovers", () => {
  test("a repo calling a script that moved up is a leftover, named with the date it moved", () => {
    const found = findLeftovers(manifest(), local('bash "$CLAUDE_PROJECT_DIR"/tools/session-guard.sh'));
    expect(found).toHaveLength(1);
    expect(found[0].mechanismId).toBe("session-guard");
    expect(found[0].movedOn).toBe("2026-08-10");
  });

  test("an extracted helper called directly is the same leftover wearing a different name", () => {
    expect(findLeftovers(manifest(), local("bash tools/durable-state.sh"))).toHaveLength(1);
  });

  // THE LOAD-BEARING CASE, and the reason this is manifest-based rather than diff-based. Bread's
  // SessionStart plan board is a real hook in a real repo that the machine level does not own.
  test("a local hook the manifest does not name is silent", () => {
    expect(findLeftovers(manifest(), local("sh plans/.proof/session-start.sh", "SessionStart"))).toEqual([]);
  });

  test("a neighbouring tool in the same directory is not swept up", () => {
    expect(findLeftovers(manifest(), local('"$CLAUDE_PROJECT_DIR"/tools/review-gate.sh'))).toEqual([]);
  });

  test("a hook matching two mechanisms is reported once, not twice", () => {
    const two = manifest({
      mechanisms: [
        { ...manifest().mechanisms[0] },
        { ...manifest().mechanisms[0], id: "duplicate-entry" },
      ],
    });
    expect(findLeftovers(two, local("tools/session-guard.sh"))).toHaveLength(1);
  });

  test("a pattern that will not compile costs its own row, not the whole check", () => {
    const broken = manifest({
      mechanisms: [
        { ...manifest().mechanisms[0], id: "broken", supersedes: ["([unclosed"] },
        { ...manifest().mechanisms[0] },
      ],
    });
    expect(findLeftovers(broken, local("tools/session-guard.sh"))[0].mechanismId).toBe("session-guard");
  });
});

describe("checkHookDrift", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pantry-hooks-"));
    mkdirSync(join(dir, ".claude"), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const writeManifest = () => {
    const p = join(dir, "loop-manifest.json");
    writeFileSync(p, JSON.stringify(manifest()));
    return p;
  };
  const writeSettings = (rel: string, body: unknown) =>
    writeFileSync(join(dir, rel), JSON.stringify(body));

  test("reads both settings files and says which one the leftover lives in", () => {
    writeSettings(".claude/settings.local.json", {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "tools/session-guard.sh" }] }] },
    });
    const r = checkHookDrift({ cwd: dir, manifestPath: writeManifest() });
    expect(r.manifestFound).toBe(true);
    expect(r.leftovers).toHaveLength(1);
    expect(r.leftovers[0].file).toBe(".claude/settings.local.json");
  });

  // A repo with no settings file at all is the common case across the estate and must not read as
  // broken. It has nothing to clean up, which is a different sentence from having been checked.
  test("a repo with no settings files is clean, not an error", () => {
    const r = checkHookDrift({ cwd: dir, manifestPath: writeManifest() });
    expect(r.localHookCount).toBe(0);
    expect(r.leftovers).toEqual([]);
  });

  // The silent-degrade guard. On CI, or on any machine that never mounted the loop, there is no
  // manifest, and "no leftovers found" would be true for the wrong reason.
  test("a missing manifest reports not-found rather than clean", () => {
    writeSettings(".claude/settings.json", {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "tools/session-guard.sh" }] }] },
    });
    const r = checkHookDrift({ cwd: dir, manifestPath: join(dir, "nope.json") });
    expect(r.manifestFound).toBe(false);
    expect(r.leftovers).toEqual([]);
    expect(r.localHookCount).toBe(1);
  });

  test("a manifest that parses but carries no mechanisms array also reports not-found", () => {
    const p = join(dir, "empty.json");
    writeFileSync(p, JSON.stringify({ version: 1, generated: "x" }));
    expect(checkHookDrift({ cwd: dir, manifestPath: p }).manifestFound).toBe(false);
  });
});
