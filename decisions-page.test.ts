import { test, expect } from "bun:test";
import { decisionCard, decisionsIndexBody } from "./decisions-page.ts";
import type { DecisionRequest, DecisionsPayload } from "./decisions.ts";
import type { AnswerLog } from "./answers.ts";
const decision: DecisionRequest = { id: "storage", file: "storage.md", title: "Storage <choice>", status: "open", options: ["Local <draft>", "Shared"], evidence: [], blocks: [], body: "Context" };
test("cards escape content and keep native choices and a detail link", () => {
  const html = decisionCard(decision);
  expect(html).toContain("Storage &lt;choice&gt;");
  expect(html).toContain('data-choice="Local &lt;draft&gt;"');
  expect(html).toContain('href="/decisions/storage"');
  expect(html).toContain('role="status"');
});
test("resolved and free-form decisions lead to the detail form", () => {
  expect(decisionCard({ ...decision, status: "resolved" })).not.toContain("<button");
  expect(decisionCard({ ...decision, options: [] })).not.toContain("<button");
});
const payload = { available: true, project: "test", decisions: [decision] } as DecisionsPayload;
const log: AnswerLog = { path: "answers.jsonl", malformed: 0, readError: null, entries: [{ kind: "answer", id: "a-1", at: "2026-11-21T00:00:00Z", via: "test", choice: "Shared", request: { source: "decision", ref: "storage", file: "storage.md", question: decision.title, options: decision.options } }] };
test("saved snapshots survive reload and edited questions reopen choices", () => {
  expect(decisionsIndexBody(payload, log)).toContain("Recorded: Shared");
  expect(decisionsIndexBody(payload, log)).toContain(" disabled");
  expect(decisionsIndexBody({ ...payload, decisions: [{ ...decision, title: "Changed" }] }, log)).not.toContain(" disabled");
});
test("unknown logs and oversized option lists suppress quick answers", () => {
  expect(decisionsIndexBody(payload, { ...log, readError: "unreadable" })).not.toContain("<button");
  expect(decisionCard({ ...decision, options: Array(21).fill("Choice") })).not.toContain("<button");
});
