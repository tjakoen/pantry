// pantry/cli.test.ts — the argument parser, and only the argument parser.
//
// It exists because of one bug: `pantry answers --json ack x` parsed `ack` as the VALUE of `--json`,
// so the subcommand vanished and the command reported an unknown one. The comment sitting above that
// code claimed to prevent exactly that case. A comment cannot be run; these can.
//
// Every existing command shape is asserted here too, because the generic flag handling was added
// after all of them and the risk it carries is a flag quietly eating a positional somebody else's
// command needs.
import { test, expect, describe } from "bun:test";
import { isOn, numberFlag, parseArgs } from "./cli.ts";

describe("a boolean flag never swallows the token after it", () => {
  test("the case that was broken: --json before a subcommand", () => {
    const { cmd, rest, flags } = parseArgs(["answers", "--json", "ack", "x"]);
    expect(cmd).toBe("answers");
    expect(flags.json).toBe("true");
    expect(rest).toEqual(["ack", "x"]);      // the subcommand survived
  });

  test("a value flag still takes its value", () => {
    const { rest, flags } = parseArgs(["answers", "wait", "my-ref", "--timeout", "30"]);
    expect(rest).toEqual(["wait", "my-ref"]);
    expect(flags.timeout).toBe("30");
  });

  test("--flag=value form, including one whose value contains an equals sign", () => {
    const { flags } = parseArgs(["answers", "record", "--question=Which=one?", "--choice=A"]);
    expect(flags.question).toBe("Which=one?");
    expect(flags.choice).toBe("A");
  });

  test("a trailing value flag with nothing after it is a boolean, not a crash", () => {
    expect(parseArgs(["answers", "wait", "r", "--timeout"]).flags.timeout).toBe("true");
  });
});

describe("the commands that existed before flags did", () => {
  test("pantry init mydir --force", () => {
    const { cmd, rest, force } = parseArgs(["init", "mydir", "--force"]);
    expect([cmd, rest[0], force]).toEqual(["init", "mydir", true]);
  });

  test("pantry skills sync ../grain", () => {
    const { cmd, rest } = parseArgs(["skills", "sync", "../grain"]);
    expect([cmd, ...rest]).toEqual(["skills", "sync", "../grain"]);
  });

  test("pantry serve --port 4400 --preview http://localhost:5199", () => {
    const { cmd, port, preview } = parseArgs(["serve", "--port", "4400", "--preview", "http://localhost:5199"]);
    expect([cmd, port, preview]).toEqual(["serve", 4400, "http://localhost:5199"]);
  });

  test("pantry scope a.ts b.ts — every positional is a file and none is eaten", () => {
    expect(parseArgs(["scope", "a.ts", "b.ts"]).rest).toEqual(["a.ts", "b.ts"]);
  });

  test("pantry graph merge ../bread", () => {
    const { cmd, rest } = parseArgs(["graph", "merge", "../bread"]);
    expect([cmd, ...rest]).toEqual(["graph", "merge", "../bread"]);
  });

  test("pantry init --kit with no dir", () => {
    const { cmd, rest, kit } = parseArgs(["init", "--kit"]);
    expect([cmd, rest.length, kit]).toEqual(["init", 0, true]);
  });
});

describe("a flag value is a string, so reading it needs care", () => {
  test("--json=false is off, which the plain truthiness check got backwards", () => {
    expect(isOn(parseArgs(["answers", "--json=false"]).flags.json)).toBe(false);
    expect(isOn(parseArgs(["answers", "--json"]).flags.json)).toBe(true);
    expect(isOn(undefined)).toBe(false);
  });

  test("a non-numeric timeout falls back rather than becoming NaN", () => {
    // NaN here made the wait loop spin forever without ever timing out, which is the failure shape
    // that costs the most: no error, no exit, and a session that looks busy.
    expect(numberFlag("true", 900)).toBe(900);
    expect(numberFlag("abc", 900)).toBe(900);
    expect(numberFlag(undefined, 900)).toBe(900);
    expect(numberFlag("-5", 900)).toBe(900);
    expect(numberFlag("0", 900)).toBe(900);
    expect(numberFlag("30", 900)).toBe(30);
  });
});

// These cross the process boundary: a warning in JSON alone must not look like CLI success.
describe("answer log diagnostics reach CLI callers", () => {
  test("unreadable and malformed logs fail list, wait and ack without appending", async () => {
    const { mkdtemp, mkdir, readFile, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "pantry-cli-log-"));
    try {
      const log = join(dir, "answers.jsonl");
      await writeFile(join(dir, "pantry.config.json"), JSON.stringify({ answersLog: log }));
      const invoke = async (args: string[]) => {
        const proc = Bun.spawn([process.execPath, join(import.meta.dir, "cli.ts"), "answers", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
        const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        return { out, err, code };
      };
      await mkdir(log);
      const unreadable = await invoke(["--json"]);
      expect(unreadable.code).toBe(1);
      expect(JSON.parse(unreadable.out).readError).toBeTruthy();
      expect((await invoke(["wait", "ref", "--timeout", "0"])).code).toBe(1);
      expect((await invoke(["ack", "id"])).code).toBe(1);
      await rm(log, { recursive: true });
      const broken = '{"kind":"answer","id":"id"}\n';
      await writeFile(log, broken);
      const malformed = await invoke(["--json"]);
      expect(malformed.code).toBe(1);
      expect(JSON.parse(malformed.out).malformed).toBe(1);
      expect((await invoke(["wait", "ref", "--timeout", "0"])).code).toBe(1);
      expect((await invoke(["ack", "id"])).code).toBe(1);
      expect(await readFile(log, "utf8")).toBe(broken);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
