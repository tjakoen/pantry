import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleBrief } from "./brief.ts";
import { buildReport, periodStart, reportMarkdown, reportPage, type ProjectInput } from "./report.ts";

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const brief = (over: Partial<Parameters<typeof assembleBrief>[0]> = {}) => assembleBrief({ now: new Date(NOW).toISOString(), project: "x", repoRoot: "/r", plans: [], decisions: [], claims: new Map(), checks: [], sessions: [], ...over });

describe("report", () => {
  test("the period comes from since, then days, then the last week", () => {
    expect(periodStart(new URLSearchParams("since=2026-11-01"), NOW)).toBe("2026-11-01");
    expect(periodStart(new URLSearchParams("days=30"), NOW)).toBe("2026-10-20");
    expect(periodStart(new URLSearchParams("since=nonsense"), NOW)).toBe("2026-11-12");
  });

  test("findings carry evidence and an action, waiting items become decisions, and down projects are named", () => {
    const b = brief({ plans: [{ id: "a", title: "A", status: "blocked", owner: "ai", depends: [], touches: [] }, { id: "s", title: "S", status: "doing", owner: "ai", depends: [], touches: [] }] });
    const inputs: ProjectInput[] = [
      { name: "pantry", path: "/nowhere", url: "http://localhost:4402/", brief: b, runs: { runs: [{ id: "r1", date: "2026-11-01", gates: [{ label: "bun test", detail: "3 fail" }] }] } as any, log: ["✨ Add a thing", "🐛 Fix a thing"] },
      { name: "gone", path: "/nowhere", url: "http://localhost:4409/", brief: null, runs: null, log: [] },
    ];
    const r = buildReport(inputs, "2026-11-12", NOW);
    expect(r.down).toEqual(["gone"]);
    expect(r.decide).toEqual([{ project: "pantry", kind: "blocked-plan", title: "A", detail: "Marked blocked.", href: "http://localhost:4402/plan/a" }]);
    expect(r.findings.map((f) => f.title)).toEqual(["1 gate(s) failed in the last recorded run", "1 plan(s) marked doing with no session holding them", "No run recorded for this period's commits"]);
    const quiet = buildReport([{ ...inputs[0], log: [] }], "2026-11-12", NOW);
    expect(quiet.findings.some((f) => f.title.includes("gate(s) failed"))).toBe(false);
    expect(r.findings.every((f) => f.evidence && f.action)).toBe(true);
    expect(r.projects[0]).toMatchObject({ name: "pantry", commits: 2, lastRun: { id: "r1", failed: 1 } });
    const html = reportPage(r, "http://localhost:4402");
    expect(html).toContain("Not read, because their PANTRY did not answer: gone.");
    expect(html).toContain("Copy as Markdown");
    expect(reportMarkdown(r)).toContain("## What to decide");
  });

  test("notes are graded: a draft without a figure is a finding, and five fresh drafts are a pile", () => {
    const root = mkdtempSync(join(tmpdir(), "rp-"));
    mkdirSync(join(root, "content", "notes"), { recursive: true });
    for (let i = 0; i < 5; i++) writeFileSync(join(root, "content", "notes", `d${i}.md`), `---\ntitle: "Draft ${i}"\nstatus: DRAFT\ndate: 2026-11-1${5 + (i % 3)}\n---\n\nWords here.\n`);
    writeFileSync(join(root, "content", "notes", "p.md"), `---\ntitle: Published\nstatus: PUBLISHED\ndate: 2026-08-01\n---\n\n<svg></svg>\n\n## Share\n`);
    const r = buildReport([{ name: "site", path: root, url: "http://localhost:4403/", brief: brief(), runs: null, log: [] }], "2026-11-12", NOW);
    expect(r.notes.length).toBe(6);
    expect(r.findings[0]).toMatchObject({ severity: "high", title: "5 drafts started in this period" });
    expect(r.findings.filter((f) => f.title.endsWith("has no figure")).length).toBe(5);
    expect(r.notes.find((n) => n.slug === "p")).toMatchObject({ figures: 1, social: true, issue: "" });
  });
});

import { isFix, isRevert, qualitySection } from "./report.ts";
test("fixes and reverts are read from the subject, and rates stay hidden under ten", () => {
  expect(["🐛 Fix the tray", "fix: x", "✨ Add a fix list", "🚑 Hotfix"].map(isFix)).toEqual([true, true, false, true]);
  expect(isRevert('Revert "x"')).toBe(true);
  const html = qualitySection({ projects: [{ name: "p", url: "", commits: 4, fixes: 1, reverts: 0, outOfScope: 2, subjects: [], closed: [], lastRun: null }] } as any);
  expect(html).toContain("<td>p</td><td>4</td><td>1</td>");
  expect(html).not.toContain("%)");
});
