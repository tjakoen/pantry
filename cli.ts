#!/usr/bin/env bun
// pantry/cli.ts — `pantry [serve] [--plans dir] [--port N]`. Boots the cockpit against the HOST
// project's plans folder (default ./plans, relative to the caller's cwd). Assets + framework docs
// resolve relative to the pantry module, so `bunx pantry` works from any project.
import { isAbsolute, join } from "node:path";
import { servePantry } from "./app.ts";

function parseArgs(argv: string[]): { cmd: string; plans: string; port: number } {
  const [cmd = "serve", ...rest] = argv;
  let plans = "plans";
  let port = 4400;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--plans") { plans = rest[++i]; continue; }
    if (a.startsWith("--plans=")) { plans = a.slice("--plans=".length); continue; }
    if (a === "--port" || a === "-p") { port = Number(rest[++i]); continue; }
    if (a.startsWith("--port=")) { port = Number(a.slice("--port=".length)); continue; }
    if (!a.startsWith("-")) plans = a;
  }
  return { cmd, plans, port };
}

function main() {
  const { cmd, plans, port } = parseArgs(Bun.argv.slice(2));
  if (cmd !== "serve") {
    console.error(`pantry: unknown command "${cmd}"\nusage: pantry serve [plansDir] [--port N]`);
    process.exit(1);
  }
  const plansDir = isAbsolute(plans) ? plans : join(process.cwd(), plans);
  const server = servePantry({ plansDir, port });
  console.log(`PANTRY cockpit on ${server.url}`);
  console.log(`  /        the stack, composed`);
  console.log(`  /plans   this project's plan board (${plansDir})`);
  console.log(`  /docs    the framework docs`);
  console.log("Ctrl-C to stop.");
}

main();
