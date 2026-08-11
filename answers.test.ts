// pantry/answers.test.ts — the one channel an answer comes back on, and the one thing PANTRY writes.
//
// The tests that matter here are not the round-trip ones. They are the refusals: an entry with no
// question, a write to plan corpus, a POST that did not come from this machine. Each of those is a
// rule stated in standards/DECISIONS.md or in the review-layer plan's security section, and a rule
// with no test is a sentence.
import { test, expect, describe } from "bun:test";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  answers, answersFor, appendAck, appendAnswer, AnswerRejected, assertWritableLogPath, formatAnswerLog,
  isLoopbackRequest, makeEntryId, matchesWaitTarget, normalizeAnswer, readAnswerLog, unacked,
  waitForAnswer, waitForAnswers, MAX_FIELD_CHARS, type AnswerInput,
} from "./answers.ts";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const tmp = () => mkdtemp(join(tmpdir(), "pantry-answers-"));

const goodInput = (over: Partial<AnswerInput> = {}): AnswerInput => ({
  request: { source: "decision", ref: "run-ledger-store", question: "Which datastore for the run ledger?" },
  choice: "SQLite",
  ...over,
});

describe("the entry carries its own question", () => {
  test("an answer with no question is refused, whatever else it has", () => {
    expect(() => normalizeAnswer({ choice: "SQLite", request: { source: "decision", ref: "x" } }))
      .toThrow(AnswerRejected);
  });

  test("an answer with no ref is refused — nothing could `wait` on it", () => {
    expect(() => normalizeAnswer({ choice: "y", request: { source: "decision", question: "Which?" } }))
      .toThrow(AnswerRejected);
  });

  test("a source outside the vocabulary is refused rather than coerced", () => {
    expect(() => normalizeAnswer({ choice: "y", request: { source: "slack", ref: "a", question: "Which?" } }))
      .toThrow(AnswerRejected);
  });

  test("notes alone are a complete answer — 'none of these, here is why' is the case the card exists for", () => {
    const out = normalizeAnswer({
      notes: "Neither. The ledger should not be a datastore at all.",
      request: { source: "decision", ref: "a", question: "Which datastore?" },
    });
    expect(out.choice).toBe("");
    expect(out.notes).toContain("Neither");
  });

  test("neither a choice nor notes is not an answer", () => {
    expect(() => normalizeAnswer({ request: { source: "decision", ref: "a", question: "Which?" } }))
      .toThrow(AnswerRejected);
  });

  test("a field over the cap is refused, not silently truncated", () => {
    expect(() => normalizeAnswer({
      choice: "x".repeat(MAX_FIELD_CHARS + 1),
      request: { source: "decision", ref: "a", question: "Which?" },
    })).toThrow(AnswerRejected);
  });

  test("what it unblocks survives the round trip, because that is what makes it actionable later", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    await appendAnswer(log, normalizeAnswer({
      choice: "SQLite",
      request: { source: "decision", ref: "a", question: "Which datastore?", unblocks: "piece 12" },
    }), NOW);
    const read = await readAnswerLog(log);
    expect(answers(read)[0].request.unblocks).toBe("piece 12");
  });
});

describe("append only, and never plan corpus", () => {
  // An ALLOWLIST, found by a reviewer who noticed the first version only refused markdown. Every
  // case below is a path the denylist version happily appended JSONL into.
  test("only a log-shaped name is writable — everything else is refused, not just markdown", () => {
    expect(() => assertWritableLogPath("/repo/plans/decisions/answers.jsonl")).not.toThrow();
    expect(() => assertWritableLogPath("/repo/plans/decisions/answers.ndjson")).not.toThrow();
    for (const bad of [
      "/repo/plans/decisions/answers.md",       // the corpus the promise names
      "/repo/src/server.ts",                     // code
      "/repo/package.json",                      // config
      "/repo/.env",                              // secrets
      "/repo/plans/decisions/answers",           // no extension at all
      "/repo/plans/PLAN.md.",                    // trailing dot: resolves back to the plan on some filesystems
    ]) {
      expect(() => assertWritableLogPath(bad)).toThrow(AnswerRejected);
    }
  });

  test("appendAnswer refuses a markdown target even when the config says so", async () => {
    const dir = await tmp();
    await expect(appendAnswer(join(dir, "answers.md"), goodInput(), NOW)).rejects.toThrow(AnswerRejected);
  });

  // The name check is a string check, and a symlink is exactly what makes a string check wrong: the
  // path ends in .jsonl and the bytes land in the plan it points at. Found by a reviewer.
  test("a symlinked log is refused, so the name cannot be a door to the corpus", async () => {
    const dir = await tmp();
    const plan = join(dir, "PLAN.md");
    const link = join(dir, "answers.jsonl");
    await writeFile(plan, "# a real plan\n");
    await symlink(plan, link);
    await expect(appendAnswer(link, goodInput(), NOW)).rejects.toThrow(AnswerRejected);
    expect(await readFile(plan, "utf8")).toBe("# a real plan\n");   // untouched
  });

  test("an option is capped per element, not only in count", () => {
    expect(() => normalizeAnswer({
      choice: "A",
      request: { source: "decision", ref: "x", question: "q", options: ["A".repeat(MAX_FIELD_CHARS + 1)] },
    })).toThrow(AnswerRejected);
  });

  test("two writes are two lines, and the first is untouched", async () => {
    const dir = await tmp();
    const log = join(dir, "sub", "answers.jsonl");   // the dir does not exist yet: the healthy first-write case
    await appendAnswer(log, goodInput(), NOW);
    await appendAnswer(log, goodInput({ choice: "Postgres" }), new Date("2026-08-10T12:00:01.000Z"));
    const raw = await readFile(log, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(2);
    expect(JSON.parse(raw.split("\n")[0]).choice).toBe("SQLite");
  });

  test("a malformed line is skipped and counted, never fatal", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    await appendAnswer(log, goodInput(), NOW);
    await writeFile(log, `${await readFile(log, "utf8")}not json at all\n`);
    const read = await readAnswerLog(log);
    expect(read.entries).toHaveLength(1);
    expect(read.malformed).toBe(1);
  });

  test("an absent log is the empty state, not an error", async () => {
    const read = await readAnswerLog(join(await tmp(), "never-written.jsonl"));
    expect(read.entries).toEqual([]);
    expect(read.malformed).toBe(0);
  });

  test("ids are unique across writes in the same second", () => {
    const a = makeEntryId("a", NOW);
    const b = makeEntryId("a", NOW);
    expect(a).not.toBe(b);
    expect(a.startsWith("a-20260810T120000Z-")).toBe(true);
  });
});

describe("read on wake", () => {
  test("unacked is what a waking session reads, and an ack removes exactly one", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    const first = await appendAnswer(log, goodInput({ choice: "SQLite" }), NOW);
    await appendAnswer(log, goodInput({ choice: "Postgres" }), new Date("2026-08-10T12:00:01.000Z"));
    expect(unacked(await readAnswerLog(log))).toHaveLength(2);
    await appendAck(log, { for: first.id, by: "run-2026-08-10" }, NOW);
    const left = unacked(await readAnswerLog(log));
    expect(left).toHaveLength(1);
    expect(left[0].choice).toBe("Postgres");
  });

  test("an ack is an entry, so the log is still append-only after one", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    const a = await appendAnswer(log, goodInput(), NOW);
    await appendAck(log, { for: a.id }, NOW);
    const raw = await readFile(log, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(2);
    expect(JSON.parse(raw.trim().split("\n")[0]).kind).toBe("answer");
  });

  test("answersFor matches the ref a wait would have used", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    await appendAnswer(log, goodInput({ request: { source: "tour", ref: "review-x#lane", question: "Which lane?" } }), NOW);
    await appendAnswer(log, goodInput(), NOW);
    expect(answersFor(await readAnswerLog(log), "review-x#lane")).toHaveLength(1);
  });

  test("the printed report leads with what is unread", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    await appendAnswer(log, goodInput({ request: { source: "decision", ref: "a", question: "Which datastore?", unblocks: "piece 12" } }), NOW);
    const text = formatAnswerLog(await readAnswerLog(log));
    expect(text).toContain("UNREAD (1)");
    expect(text).toContain("Which datastore?");
    expect(text).toContain("unblocks: piece 12");
  });
});

describe("waiting is the optimization, not the contract", () => {
  test("an answer written after the wait started is picked up", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    const started = new Date();
    const pending = waitForAnswer(log, "late-one", { timeoutMs: 3_000, pollMs: 20, after: started });
    setTimeout(() => {
      void appendAnswer(log, goodInput({ request: { source: "chat", ref: "late-one", question: "Which?" } }), new Date());
    }, 50);
    expect((await pending)?.request.ref).toBe("late-one");
  });

  test("a timeout returns null rather than throwing, so a run can say so and continue", async () => {
    const dir = await tmp();
    expect(await waitForAnswer(join(dir, "answers.jsonl"), "never", { timeoutMs: 30, pollMs: 10 })).toBeNull();
  });

  // The first version matched on "newer than the moment the wait started", which meant an answer
  // given in the seconds between raising the question and getting round to waiting was invisible:
  // the wait blocked its whole timeout and reported nothing while the list showed it unread. Unacked
  // is the right test, because an ack is already the record of what has been consumed.
  test("an answer that arrived BEFORE the wait is still the answer, as long as nobody acked it", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    await appendAnswer(log, goodInput({ request: { source: "chat", ref: "early", question: "Which?" } }), new Date("2020-01-01T00:00:00.000Z"));
    const hit = await waitForAnswer(log, "early", { timeoutMs: 200, pollMs: 10 });
    expect(hit?.request.ref).toBe("early");
  });

  test("an ACKED answer does not satisfy a later wait — that is what stale means here", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    const a = await appendAnswer(log, goodInput({ request: { source: "chat", ref: "done", question: "Which?" } }), NOW);
    await appendAck(log, { for: a.id }, NOW);
    expect(await waitForAnswer(log, "done", { timeoutMs: 30, pollMs: 10 })).toBeNull();
  });

  test("`after` still narrows to a fresh answer for a caller that wants one", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    await appendAnswer(log, goodInput({ request: { source: "chat", ref: "old", question: "Which?" } }), new Date("2020-01-01T00:00:00.000Z"));
    expect(await waitForAnswer(log, "old", { timeoutMs: 30, pollMs: 10, after: new Date() })).toBeNull();
  });

  // A NaN timeout made the deadline comparison false forever and Bun.sleep(NaN) return instantly:
  // a hot loop with no error and no exit. Caught by a reviewer running it, not by reading it.
  test("a NaN timeout falls back to the default instead of spinning forever", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    const started = Date.now();
    // A NaN POLL with a real timeout: if either bound were NaN this would never return.
    expect(await waitForAnswer(log, "nothing", { timeoutMs: 40, pollMs: Number.NaN })).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

// The bug these were written from is a real run, not a hypothetical: a session waited on
// `review-answer-channel#reads-right` for nine and a half minutes while the owner's answer to
// `#keep-both` — the other ask on the same card — sat on disk the whole time.
describe("a wait names the tour, and ends when the card is finished", () => {
  const ask = (ref: string, choice: string): AnswerInput =>
    goodInput({ request: { source: "tour", ref, question: `Which, for ${ref}?` }, choice });

  test("the target discriminates on the `#`, and a bare decision ref still means itself", () => {
    expect(matchesWaitTarget("review-x#a", "review-x")).toBe(true);
    expect(matchesWaitTarget("review-x#a", "review-x#a")).toBe(true);
    expect(matchesWaitTarget("review-x#a", "review-x#b")).toBe(false);
    // A decision request's ref has no `#` and no children; naming it must not start matching by prefix
    // against the next ref that happens to begin with the same letters.
    expect(matchesWaitTarget("run-ledger-store", "run-ledger-store")).toBe(true);
    expect(matchesWaitTarget("run-ledger-store-v2", "run-ledger-store")).toBe(false);
  });

  test("the tour form returns every ask the card actually answered", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    await appendAnswer(log, ask("review-answer-channel#keep-both", "Keep both"), NOW);
    await appendAnswer(log, ask("review-answer-channel#reads-right", "Yes"), NOW);
    const hits = await waitForAnswers(log, "review-answer-channel", { timeoutMs: 200, pollMs: 10, settleMs: 5 });
    expect(hits.map((h) => h.request.ref)).toEqual([
      "review-answer-channel#keep-both",
      "review-answer-channel#reads-right",
    ]);
  });

  // The rejected reading "every ask the tour declares", stated as a test because it is the one that
  // would still be blocking right now.
  test("an ask the reviewer skipped does not hold the run — the batch is what was answered", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    await appendAnswer(log, ask("review-answer-channel#keep-both", "Keep both"), NOW);
    const hits = await waitForAnswers(log, "review-answer-channel", { timeoutMs: 200, pollMs: 10, settleMs: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0].request.ref).toBe("review-answer-channel#keep-both");
  });

  // The regression itself. Waiting on the ask nobody answered is still a timeout, which is correct and
  // is exactly why naming the tour is the thing to reach for.
  test("the single-ask form is unchanged: naming the unanswered ask still times out", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    await appendAnswer(log, ask("review-answer-channel#keep-both", "Keep both"), NOW);
    expect(await waitForAnswers(log, "review-answer-channel#reads-right", { timeoutMs: 30, pollMs: 10, settleMs: 5 }))
      .toEqual([]);
    const one = await waitForAnswers(log, "review-answer-channel#keep-both", { timeoutMs: 200, pollMs: 10, settleMs: 5 });
    expect(one).toHaveLength(1);
  });

  // One POST per ask means a poll can land between two of them. Without the settle this returns one
  // answer out of two and the run acts on half a decision.
  test("a batch still landing is waited out, not read halfway", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    const pending = waitForAnswers(log, "review-x", { timeoutMs: 3_000, pollMs: 10, settleMs: 60 });
    setTimeout(() => { void appendAnswer(log, ask("review-x#one", "A"), new Date()); }, 20);
    setTimeout(() => { void appendAnswer(log, ask("review-x#two", "B"), new Date()); }, 60);
    expect((await pending).map((h) => h.request.ref)).toEqual(["review-x#one", "review-x#two"]);
  });

  test("an acked ask is not re-served to a later wait, tour form included", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    const first = await appendAnswer(log, ask("review-x#one", "A"), NOW);
    await appendAck(log, { for: first.id }, NOW);
    await appendAnswer(log, ask("review-x#two", "B"), NOW);
    const hits = await waitForAnswers(log, "review-x", { timeoutMs: 200, pollMs: 10, settleMs: 5 });
    expect(hits.map((h) => h.request.ref)).toEqual(["review-x#two"]);
  });

  // The settle compares the entries, not how many there are. What it watches is the log MINUS the
  // acked, and that view can shrink: an ack and a new answer landing in the same window leave the
  // count alone and change the set. A count comparison returns the acked one and drops the new one.
  test("an ack landing mid-settle does not freeze the stale set in place", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    const first = await appendAnswer(log, ask("review-x#one", "A"), NOW);
    const pending = waitForAnswers(log, "review-x", { timeoutMs: 3_000, pollMs: 10, settleMs: 60 });
    setTimeout(() => {
      void (async () => {
        await appendAck(log, { for: first.id }, new Date());
        await appendAnswer(log, ask("review-x#two", "B"), new Date());
      })();
    }, 20);
    expect((await pending).map((h) => h.request.ref)).toEqual(["review-x#two"]);
  });

  // A single ask matches one ref, and one ref is never a batch. Settling it would buy nothing and
  // cost the wait its whole settle window; with a five-second one this returns in milliseconds.
  test("the single-ask form does not settle, because it has no batch to wait for", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    await appendAnswer(log, ask("review-x#one", "A"), NOW);
    const started = Date.now();
    const hits = await waitForAnswers(log, "review-x#one", { timeoutMs: 2_000, pollMs: 10, settleMs: 5_000 });
    expect(hits).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("waitForAnswer keeps returning the first one, for a caller that wants exactly that", async () => {
    const dir = await tmp();
    const log = join(dir, "answers.jsonl");
    await appendAnswer(log, ask("review-x#one", "A"), NOW);
    await appendAnswer(log, ask("review-x#two", "B"), NOW);
    const hit = await waitForAnswer(log, "review-x", { timeoutMs: 200, pollMs: 10 });
    expect(hit?.request.ref).toBe("review-x#one");
  });
});

describe("the write-back's loopback bound", () => {
  test("loopback addresses pass, in every shape a listener reports them", () => {
    for (const a of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1"]) {
      expect(isLoopbackRequest(a)).toBe(true);
    }
  });

  test("anything else fails, including the ones that merely look local", () => {
    for (const a of ["192.168.1.5", "10.0.0.1", "0.0.0.0", "::", "1.2.3.4", "localhost"]) {
      expect(isLoopbackRequest(a)).toBe(false);
    }
  });

  test("an unknown address is NOT local — an unanswerable security question defaults to no", () => {
    expect(isLoopbackRequest(null)).toBe(false);
    expect(isLoopbackRequest(undefined)).toBe(false);
    expect(isLoopbackRequest("")).toBe(false);
  });
});
