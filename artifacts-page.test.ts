import { describe, expect, test } from "bun:test";
import { artifactsIndexBody, explorerView, listing } from "./artifacts-page.ts";
import { artifactType, datedName, type ArtifactEntry } from "./artifacts.ts";

const f = (relPath: string, size: number, mtime: string, created = mtime): ArtifactEntry => ({
  relPath, name: relPath.split("/").at(-1)!, kind: relPath.endsWith(".png") ? "image" : "report", size, mtime,
  type: artifactType(relPath), created, createdFrom: "file",
});
const ENTRIES = [
  f("a.md", 10, "2026-01-01"), f("runs/x.md", 50, "2026-03-01", "2026-01-15"),
  f("runs/deep/y-screenshot.png", 5, "2026-02-01"), f("briefs/b.md", 99, "2026-02-15"),
];
const v = (qs: string) => explorerView(new URLSearchParams(qs));

describe("artifact types", () => {
  test("folder and name decide the type, not just the extension", () => {
    expect(artifactType("runs/2026-11-01-x.md")).toBe("run-report");
    expect(artifactType("briefs/plan.md")).toBe("brief");
    expect(artifactType("2026-10-31-portfolio-audit.md")).toBe("audit");
    expect(artifactType("run-1/home-screenshot.png")).toBe("screenshot");
    expect(artifactType("figure.png")).toBe("image");
    expect(artifactType("reviews/tour-1/step.png")).toBe("screenshot");
    expect(artifactType("out/result.json")).toBe("data");
    expect(artifactType("notes.md")).toBe("note");
  });
  test("a date at the start of the name or a folder is the made date", () => {
    expect(datedName("runs/2026-11-01-x.md")).toBe("2026-11-01T00:00:00.000Z");
    expect(datedName("2026-10-14/shot.png")).toBe("2026-10-14T00:00:00.000Z");
    expect(datedName("plain.md")).toBeNull();
  });
});

describe("artifact explorer", () => {
  test("a folder lists its direct files and its subfolders with their totals", () => {
    const top = listing(ENTRIES, v(""));
    expect(top.folders.map((x) => [x.name, x.count])).toEqual([["briefs", 1], ["runs", 2]]);
    expect(top.files.map((x) => x.name)).toEqual(["a.md"]);
    expect(listing(ENTRIES, v("dir=runs")).folders.map((x) => x.name)).toEqual(["deep"]);
  });

  test("filtering by type goes flat across folders, and combines with search", () => {
    expect(listing(ENTRIES, v("type=run-report&type=brief")).files.map((x) => x.relPath)).toEqual(["briefs/b.md", "runs/x.md"]);
    expect(listing(ENTRIES, v("type=screenshot")).files.map((x) => x.relPath)).toEqual(["runs/deep/y-screenshot.png"]);
    expect(listing(ENTRIES, v("q=x&type=brief")).files).toHaveLength(0);
  });

  test("sort by made, by modified and by last opened each give their own order", () => {
    const flat = "type=run-report&type=brief&type=note";
    expect(listing(ENTRIES, v(`${flat}&sort=made`)).files.map((x) => x.name)).toEqual(["b.md", "x.md", "a.md"]);
    expect(listing(ENTRIES, v(`${flat}&sort=modified`)).files.map((x) => x.name)).toEqual(["x.md", "b.md", "a.md"]);
    expect(listing(ENTRIES, v(`${flat}&sort=opened`), { "a.md": "2026-04-01" }).files[0].name).toBe("a.md");
  });

  test("the made-within filter drops older artifacts", () => {
    const now = Date.parse("2026-03-02");
    expect(listing(ENTRIES, v("age=30d"), {}, now).files.map((x) => x.name)).toEqual(["b.md", "y-screenshot.png"]);
    expect(listing(ENTRIES, v("age=7d"), {}, Date.parse("2026-02-20")).files.map((x) => x.name)).toEqual(["b.md"]);
  });

  test("the page shows a type label on every row and a facet per type present", () => {
    const html = artifactsIndexBody({ available: true, project: "p", dir: "/d", artifacts: ENTRIES, count: 4, generatedAt: "2026-03-02" }, v("type=brief"));
    expect(html).toContain(`data-type="brief"`);
    expect(html).toContain("Run report");
    expect(html).toContain(`aria-pressed="true"`);
    expect(html).toContain("Clear filters");
  });

  test("a dir or file parameter cannot climb out of the artifacts folder", () => {
    const view = v("dir=../../etc&file=../secret&type=nonsense");
    expect(view.dir).toBe("etc");
    expect(view.file).toBe("secret");
    expect(view.types).toEqual([]);
  });
});
