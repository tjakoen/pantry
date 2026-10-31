// Exercise the packed runtime outside the checkout so omitted modules and assets cannot hide.
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("the packed package runs its CLI and serves the control client", async () => {
  const root = resolve(import.meta.dir, "..");
  const temp = await mkdtemp(join(tmpdir(), "pantry-packed-"));
  try {
    const archive = join(temp, "pantry.tgz");
    const pack = Bun.spawn([process.execPath, "pm", "pack", "--filename", archive], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(await pack.exited).toBe(0);
    const extract = Bun.spawn(["tar", "-xzf", archive, "-C", temp], { stdout: "pipe", stderr: "pipe" });
    expect(await extract.exited).toBe(0);
    const packed = join(temp, "package");
    // Dependencies come from the frozen checkout installation; PANTRY's own files come only from tar.
    await symlink(join(root, "node_modules"), join(packed, "node_modules"), "dir");
    const host = join(temp, "host");
    await mkdir(host);
    const cli = Bun.spawn([process.execPath, join(packed, "cli.ts"), "answers", "--json"], { cwd: host, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(cli.stdout).text();
    const errors = await new Response(cli.stderr).text();
    expect(errors).toBe("");
    expect(await cli.exited).toBe(0);
    expect(JSON.parse(output).answers).toEqual([]);

    const { servePantryFromCwd } = await import(join(packed, "app.ts"));
    const { server } = await servePantryFromCwd({ cwd: host, port: 0 });
    try {
      const response = await fetch(new URL("/pantry-control.js", server.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("javascript");
      expect(await response.text()).toBe(await Bun.file(join(root, "pantry-control.js")).text());
    } finally {
      server.stop(true);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 30_000);
