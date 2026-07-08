#!/usr/bin/env bun
// pantry/cli.ts — the command line for the cockpit:
//   pantry [serve] [--port N]   boot against the HOST project's pantry.config (plans + docs + toggles)
//   pantry init  [dir]          scaffold PANTRY into a project (plans/ via proof init + pantry.config.json)
// Config + plans are read from the caller's cwd (the host); bundled assets + framework docs resolve
// relative to the pantry module, so `bunx pantry` works from any project. See INSTALL.md.
import { isAbsolute, join } from "node:path";
import { servePantryFromCwd } from "./app.ts";
import { runPantryInit } from "./init.ts";

const abs = (dir: string) => (isAbsolute(dir) ? dir : join(process.cwd(), dir));

function parseArgs(argv: string[]): { cmd: string; dir: string | null; port: number; force: boolean } {
  const [cmd = "serve", ...rest] = argv;
  let dir: string | null = null;
  let port = 4400;
  let force = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--port" || a === "-p") { port = Number(rest[++i]); continue; }
    if (a.startsWith("--port=")) { port = Number(a.slice("--port=".length)); continue; }
    if (a === "--force" || a === "-f") { force = true; continue; }
    if (!a.startsWith("-")) dir = a;
  }
  return { cmd, dir, port, force };
}

async function main() {
  const { cmd, dir, port, force } = parseArgs(Bun.argv.slice(2));

  if (cmd === "serve") {
    const server = await servePantryFromCwd({ port });
    console.log(`PANTRY cockpit on ${server.url}`);
    console.log(`  /          the stack, composed`);
    console.log(`  /plans     this project's plan board`);
    console.log(`  /docs      the framework docs + this project's`);
    console.log(`  /reference the generated AI vocabulary + token slots`);
    console.log(`  /catalog   the GRAIN component catalog`);
    console.log("Ctrl-C to stop.");
    return;
  }

  if (cmd === "init") {
    const targetDir = abs(dir ?? ".");
    const result = await runPantryInit(targetDir, { force });
    for (const f of result.created) console.log(`  created  ${f}`);
    for (const f of result.skipped) console.log(`  skipped  ${f} (exists; --force to overwrite)`);
    console.log(`\n${result.instructions}`);
    return;
  }

  console.error(`pantry: unknown command "${cmd}"\nusage: pantry <serve|init> [dir] [--port N] [--force]`);
  process.exit(1);
}

void main();
