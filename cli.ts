#!/usr/bin/env bun
// pantry/cli.ts — the command line for the cockpit:
//   pantry [serve] [--port N]   boot against the HOST project's pantry.config (plans + docs + toggles)
//   pantry check                lint the docs for dead references (CI-able; exits nonzero on a break)
//   pantry doctor               kit compliance + staleness, the loop's mechanical tier (CI-able)
//   pantry deps                 layer-pin drift: are the host's @tjakoen/* pins current with the
//                               sibling layer sources on disk? (the umbrella control-plane surface)
//   pantry init  [dir] [--kit]  scaffold PANTRY into a project (plans/ + pantry.config.json; --kit also
//                               seeds CLAUDE.md from the starter + the AGENTS->CLAUDE symlink, and
//                               mounts the standards as skills)
//   pantry skills sync [dir]    materialize the standards as .claude/skills/<slug>/SKILL.md (generated,
//                               gitignored, never committed)
//   pantry skills list [dir]    what is mounted here and whether it still matches canon
//   pantry graph merge [dir]    merge sibling repos' graphify-out/graph.json into <dir>/graphify-out/
//                               merged-graph.json (never runs `graphify update` — explicit only, never
//                               called by doctor; see graph.ts's header)
//   pantry scope <file...>      what a change to these files is likely to reach, asked BEFORE the work
//                               so the declared scope in a run report can be right the first time
// Config + plans are read from the caller's cwd (the host); bundled assets + framework docs resolve
// relative to the pantry module, so `bunx pantry` works from any project. See INSTALL.md.
import { isAbsolute, join } from "node:path";
import { servePantryFromCwd } from "./app.ts";
import { checkPantryDrift, formatDriftReport } from "./drift.ts";
import { runDoctor, formatDoctorReport } from "./doctor.ts";
import { checkPantryDeps, formatDepsReport } from "./deps.ts";
import { runPantryInit } from "./init.ts";
import { loadPantryConfig } from "./config.ts";
import { syncSkills, listSkills, formatSkillsSync, formatSkillsList } from "./skills.ts";
import { mergeGraphs, formatGraphMergeReport, scopeRadius, formatScopeRadius } from "./graph.ts";

const abs = (dir: string) => (isAbsolute(dir) ? dir : join(process.cwd(), dir));

// Positionals are collected in order rather than folded into a single `dir`, because `skills` (and now
// `graph`) take a subcommand before their optional dir (`pantry skills sync ../grain`, `pantry graph
// merge ../bread`). For every other command the first positional IS the dir, exactly as before.
function parseArgs(argv: string[]): { cmd: string; rest: string[]; port: number; force: boolean; kit: boolean } {
  const [cmd = "serve", ...args] = argv;
  const rest: string[] = [];
  let port = 4400;
  let force = false;
  let kit = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--port" || a === "-p") { port = Number(args[++i]); continue; }
    if (a.startsWith("--port=")) { port = Number(a.slice("--port=".length)); continue; }
    if (a === "--force" || a === "-f") { force = true; continue; }
    if (a === "--kit") { kit = true; continue; }
    if (!a.startsWith("-")) rest.push(a);
  }
  return { cmd, rest, port, force, kit };
}

async function main() {
  const { cmd, rest, port, force, kit } = parseArgs(Bun.argv.slice(2));
  const dir = rest[0] ?? null;

  if (cmd === "serve") {
    const server = await servePantryFromCwd({ port });
    console.log(`PANTRY cockpit on ${server.url}`);
    console.log(`  /          the stack, composed`);
    console.log(`  /plans     this project's plan board`);
    console.log(`  /decisions the AI's decision inbox (resolve via a generated prompt)`);
    console.log(`  /docs      the framework docs + this project's`);
    console.log(`  /reference the generated AI vocabulary + token slots`);
    console.log(`  /catalog   the GRAIN component catalog`);
    console.log("Ctrl-C to stop.");
    return;
  }

  if (cmd === "check") {
    const report = await checkPantryDrift({ cwd: process.cwd() });
    console.log(formatDriftReport(report));
    process.exit(report.ok ? 0 : 1);   // nonzero on a dead reference → fails CI
  }

  if (cmd === "doctor") {
    const report = await runDoctor({ cwd: process.cwd() });
    console.log(formatDoctorReport(report));
    process.exit(report.ok ? 0 : 1);   // nonzero on a broken kit → fails CI (warns/infos don't)
  }

  if (cmd === "deps") {
    const report = await checkPantryDeps({ cwd: process.cwd() });
    console.log(formatDepsReport(report));
    return; // a surface, not a gate — a lagging pin is a chore that's due, not a broken build (LOOP.md §2)
  }

  if (cmd === "skills") {
    const [sub = "list", subDir] = rest;
    const cwd = abs(subDir ?? ".");
    if (sub === "sync") {
      console.log(formatSkillsSync(await syncSkills({ cwd })));
      return; // a materializer, not a gate — a missing canon package is a skip, not a failure
    }
    if (sub === "list") {
      console.log(formatSkillsList(await listSkills({ cwd })));
      return;
    }
    console.error(`pantry skills: unknown subcommand "${sub}"\nusage: pantry skills <sync|list> [dir]`);
    process.exit(1);
  }

  if (cmd === "graph") {
    const [sub, subDir] = rest;
    if (sub === "merge") {
      const hostRoot = abs(subDir ?? ".");
      const report = await mergeGraphs({ hostRoot });
      console.log(formatGraphMergeReport(report));
      process.exit(report.ok ? 0 : 1); // nonzero only when a merge was asked for and not delivered
    }
    console.error(`pantry graph: unknown subcommand "${sub ?? ""}"\nusage: pantry graph merge [dir]`);
    process.exit(1);
  }

  if (cmd === "scope") {
    // Every positional is a file, so this does NOT follow the `<cmd> [dir]` shape the others use.
    const config = await loadPantryConfig(process.cwd());
    // This repo's OWN graph, never the merged one — see scopeRadius's note on why the two graph-backed
    // checks want opposite artifacts.
    const report = await scopeRadius(join(config.graphDir, "graph.json"), rest);
    console.log(formatScopeRadius(report));
    process.exit(report.ok ? 0 : 1);
  }

  if (cmd === "init") {
    const targetDir = abs(dir ?? ".");
    const result = await runPantryInit(targetDir, { force, kit });
    for (const f of result.created) console.log(`  created  ${f}`);
    for (const f of result.skipped) console.log(`  skipped  ${f} (exists; --force to overwrite)`);
    console.log(`\n${result.instructions}`);
    return;
  }

  console.error(`pantry: unknown command "${cmd}"\nusage: pantry <serve|check|doctor|deps|skills|graph|scope|init> [dir] [--port N] [--force] [--kit]`);
  process.exit(1);
}

main().catch((e) => { console.error(`pantry: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
