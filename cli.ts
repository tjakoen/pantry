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
//   pantry answers              the append-only answer log (DECISIONS §4): what has been answered and
//                               what no session has acted on yet. READ THIS ON WAKE.
//   pantry answers wait <ref>   block until that question is answered (only useful while awake)
//   pantry answers ack <id>     record that a session acted on an answer
//   pantry answers record …     write down an answer that arrived by paste, so one channel stays one
// Config + plans are read from the caller's cwd (the host); bundled assets + framework docs resolve
// relative to the pantry module, so `bunx pantry` works from any project. See INSTALL.md.
import { isAbsolute, join } from "node:path";
import { servePantryFromCwd } from "./app.ts";
import { PANTRY_PREFIX } from "./preview.ts";
import { checkPantryDrift, formatDriftReport } from "./drift.ts";
import { runDoctor, formatDoctorReport } from "./doctor.ts";
import { checkPantryDeps, formatDepsReport } from "./deps.ts";
import { runPantryInit } from "./init.ts";
import { loadPantryConfig } from "./config.ts";
import { syncSkills, listSkills, formatSkillsSync, formatSkillsList } from "./skills.ts";
import { mergeGraphs, formatGraphMergeReport, scopeRadius, formatScopeRadius } from "./graph.ts";
import {
  answers, appendAck, appendAnswer, formatAnswer, formatAnswerLog, normalizeAnswer, readAnswerLog,
  unacked, waitForAnswer,
} from "./answers.ts";

const abs = (dir: string) => (isAbsolute(dir) ? dir : join(process.cwd(), dir));

/** Flags that take no value. Anything not listed here consumes the next non-flag token. */
const BOOLEAN_FLAGS = new Set(["json"]);

/** A declared-boolean flag, read the way a person means it. `--json=false` is off, and the naive
 *  truthiness check that shipped first read it as on, because every flag value is a string. */
export const isOn = (v: string | undefined): boolean =>
  v !== undefined && v !== "false" && v !== "0" && v !== "no" && v !== "";

/** A numeric flag with a floor and a fallback. `Number("true")` and `Number("abc")` are both NaN, and
 *  NaN propagated into a deadline made `pantry answers wait --timeout` spin forever without ever
 *  timing out — a hang with no error, which is the worst shape a failure can take in a loop meant to
 *  run unattended. Nullish coalescing does not catch NaN; this does. */
export function numberFlag(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Positionals are collected in order rather than folded into a single `dir`, because `skills` (and now
// `graph`) take a subcommand before their optional dir (`pantry skills sync ../grain`, `pantry graph
// merge ../bread`). For every other command the first positional IS the dir, exactly as before.
export function parseArgs(argv: string[]): { cmd: string; rest: string[]; port: number; force: boolean; kit: boolean; preview: string | null; flags: Record<string, string> } {
  const [cmd = "serve", ...args] = argv;
  const rest: string[] = [];
  // Every other flag, collected generically. `answers` needs half a dozen (--question, --choice,
  // --unblocks…) and naming each one here would make this function grow with every subcommand;
  // the commands that care read what they know and ignore the rest.
  const flags: Record<string, string> = {};
  let port = 4400;
  let force = false;
  let kit = false;
  // The preview target is a DEV-SESSION choice, not a property of the repo, so it belongs on the
  // command line as much as in the config. Committing `previewTarget` into a repo's pantry.config
  // turns the proxy on for everyone and every boot, including the boots where the reviewed project
  // is not running; a flag lets a repo that already has a good config just add a target for one run.
  let preview: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--port" || a === "-p") { port = Number(args[++i]); continue; }
    if (a.startsWith("--port=")) { port = Number(a.slice("--port=".length)); continue; }
    if (a === "--force" || a === "-f") { force = true; continue; }
    if (a === "--kit") { kit = true; continue; }
    if (a === "--preview") { preview = args[++i] ?? null; continue; }
    if (a.startsWith("--preview=")) { preview = a.slice("--preview=".length); continue; }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const name = a.slice(2);
      // Which flags take a value is DECLARED, not guessed from what follows them. The guessing
      // version looked reasonable and was wrong in the case its own comment named: `--json` before a
      // subcommand ate the subcommand, because "the next token does not start with a dash" is true of
      // a value and equally true of `ack`. A parser cannot infer arity from the argument list, so it
      // is told.
      if (BOOLEAN_FLAGS.has(name)) { flags[name] = "true"; continue; }
      flags[name] = args[i + 1] && !args[i + 1].startsWith("-") ? args[++i] : "true";
      continue;
    }
    if (!a.startsWith("-")) rest.push(a);
  }
  return { cmd, rest, port, force, kit, preview, flags };
}

async function main() {
  const { cmd, rest, port, force, kit, preview, flags } = parseArgs(Bun.argv.slice(2));
  const dir = rest[0] ?? null;

  if (cmd === "serve") {
    const { server, config } = await servePantryFromCwd({ port, previewTarget: preview });
    // With a preview target configured the reviewed project owns the root and PANTRY answers only
    // under its reserved prefix, so every door below moves. Printing the old list would send the
    // owner to the app's 404 and make a working proxy look broken.
    const at = config.previewTarget ? PANTRY_PREFIX : "";
    console.log(`PANTRY cockpit on ${server.url}`);
    if (config.previewTarget) {
      console.log(`  /          the PREVIEW target, proxied: ${config.previewTarget}`);
      console.log(`  ${at}/  PANTRY itself (its own routes all moved under this prefix)`);
    } else {
      console.log(`  /          the stack, composed`);
    }
    console.log(`  ${at}/plans     this project's plan board`);
    console.log(`  ${at}/decisions the AI's decision inbox (record the answer, or generate a prompt)`);
    console.log(`  ${at}/answers   the append-only answer log the next session reads on wake`);
    console.log(`  ${at}/docs      the framework docs + this project's`);
    console.log(`  ${at}/reference the generated AI vocabulary + token slots`);
    console.log(`  ${at}/catalog   the GRAIN component catalog`);
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

  // The session side of the answer channel (P3 of plans/pantry-review-layer.md).
  //
  // The two halves are NOT the same mechanism and it matters which is the contract. `wait` is the
  // optimization: it helps only in the case where the session that asked is still alive, which is the
  // case least likely to hold. `answers` (the bare list) is the contract: a session reads it on wake,
  // whether or not it is the one that asked, whether or not anything waited. Build a loop on `wait`
  // alone and every answer given after a session ended is lost.
  if (cmd === "answers") {
    const config = await loadPantryConfig(process.cwd());
    const [sub, arg] = rest;
    const logPath = config.answersLog;

    if (!sub || sub === "list") {
      const log = await readAnswerLog(logPath);
      if (isOn(flags.json)) { console.log(JSON.stringify({ path: log.path, unread: unacked(log), answers: answers(log) }, null, 2)); return; }
      console.log(formatAnswerLog(log));
      // Exit 0 even with unread answers. This is a surface a session reads, not a gate: making
      // pending work fail a command turns "there is something for you" into "the build is broken",
      // which is how a check gets muted (LOOP §2's baseline-and-regress rule, same reasoning).
      return;
    }

    if (sub === "wait") {
      if (!arg) { console.error("usage: pantry answers wait <ref> [--timeout <seconds>]"); process.exit(1); }
      // Falling back is right; falling back silently is not. A wait that runs fifteen minutes on a
      // typo looks identical to a wait that was asked for.
      if (flags.timeout !== undefined && numberFlag(flags.timeout, -1) === -1) {
        console.error(`[pantry] --timeout ${JSON.stringify(flags.timeout)} is not a positive number of seconds; using 900.`);
      }
      const timeoutMs = numberFlag(flags.timeout, 900) * 1000;
      console.error(`[pantry] waiting for an answer to "${arg}" (up to ${Math.round(timeoutMs / 1000)}s) — ${logPath}`);
      const hit = await waitForAnswer(logPath, arg, { timeoutMs });
      if (!hit) {
        // A timeout is not a crash, and it is not silence either. The run should say in its report
        // that it asked and was not answered, so the exit code makes that visible to a wrapper too.
        console.error(`[pantry] no answer to "${arg}" within the timeout. Say so in the run report; the answer will still be here on the next wake.`);
        process.exit(2);
      }
      console.log(formatAnswer(hit));
      return;
    }

    if (sub === "ack") {
      if (!arg) { console.error("usage: pantry answers ack <answer-id> [--by <who>] [--note <why>]"); process.exit(1); }
      const log = await readAnswerLog(logPath);
      if (!log.entries.some((e) => e.kind === "answer" && e.id === arg)) {
        console.error(`pantry answers ack: no answer with id "${arg}" in ${logPath}`);
        process.exit(1);
      }
      const entry = await appendAck(logPath, { for: arg, by: flags.by, note: flags.note }, new Date());
      console.log(`acked ${arg} as ${entry.id}`);
      return;
    }

    // The paste path, made to land in the same place as the other two. An answer given in chat is
    // still an answer, and DECISIONS §4 says one channel or the guarantee is worthless — so a session
    // that was told something in conversation writes it down here rather than only acting on it.
    if (sub === "record") {
      try {
        const input = normalizeAnswer({
          via: "cli",
          choice: flags.choice ?? "",
          notes: flags.notes,
          request: {
            source: flags.source ?? "chat",
            ref: flags.ref ?? arg ?? "",
            question: flags.question ?? "",
            unblocks: flags.unblocks,
            recommendation: flags.recommendation,
            options: flags.options ? flags.options.split("|").map((o) => o.trim()) : [],
          },
        });
        const entry = await appendAnswer(logPath, input, new Date());
        console.log(`recorded ${entry.id} in ${logPath}`);
        return;
      } catch (err) {
        console.error(`pantry answers record: ${err instanceof Error ? err.message : String(err)}`);
        console.error(`usage: pantry answers record --ref <id> --question "<what was asked>" --choice "<the answer>" [--notes …] [--unblocks …]`);
        process.exit(1);
      }
    }

    console.error(`pantry answers: unknown subcommand "${sub}"\nusage: pantry answers [list|wait <ref>|ack <id>|record --ref … --question … --choice …]`);
    process.exit(1);
  }

  if (cmd === "init") {
    const targetDir = abs(dir ?? ".");
    const result = await runPantryInit(targetDir, { force, kit });
    for (const f of result.created) console.log(`  created  ${f}`);
    for (const f of result.skipped) console.log(`  skipped  ${f} (exists; --force to overwrite)`);
    console.log(`\n${result.instructions}`);
    return;
  }

  console.error(`pantry: unknown command "${cmd}"\nusage: pantry <serve|check|doctor|deps|answers|skills|graph|scope|init> [dir] [--port N] [--force] [--kit]`);
  process.exit(1);
}

// Guarded so the argument parser can be imported and tested without the CLI running itself. The flag
// bug that made `--json ack x` swallow its subcommand was found by reading; it should have been
// findable by a test, and it was not, because importing this file used to BE running it.
if (import.meta.main) {
  main().catch((e) => { console.error(`pantry: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
}
