import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessConfigDir, memoryIndexPath, readContext } from "./context.ts";
import { defaultSessionsLog } from "./sessions.ts";

test("context and sessions select the same Claude account and report that scope explicitly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pantry-context-"));
  const before = process.env.CLAUDE_CONFIG_DIR;
  try {
    const repo = join(dir, "host");
    const account = join(dir, "account");
    const override = join(dir, "override");
    await mkdir(repo);
    await mkdir(account);
    await mkdir(override);
    await writeFile(join(account, "CLAUDE.md"), "account");
    await writeFile(join(override, "CLAUDE.md"), "override");
    const memory = memoryIndexPath(repo, account);
    await mkdir(join(memory, ".."), { recursive: true });
    await writeFile(memory, "memory");
    process.env.CLAUDE_CONFIG_DIR = account;
    expect(harnessConfigDir()).toBe(account);
    expect(defaultSessionsLog(repo)).toContain(account);
    const measured = await readContext(repo);
    expect(measured.harness).toBe("claude");
    expect(measured.configDir).toBe(account);
    expect(measured.chars).toBe("accountmemory".length);
    const explicit = await readContext(repo, { configDir: override });
    expect(explicit.configDir).toBe(override);
    expect(explicit.chars).toBe("override".length);
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(harnessConfigDir(dir)).toBe(join(dir, ".claude"));
    expect((await readContext(repo, { home: dir })).configDir).toBe(join(dir, ".claude"));
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    await rm(dir, { recursive: true, force: true });
  }
});
