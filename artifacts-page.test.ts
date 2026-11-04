import { describe, expect, test } from "bun:test";
import { explorerView, listing } from "./artifacts-page.ts";
import type { ArtifactEntry } from "./artifacts.ts";

const f = (relPath: string, size: number, mtime: string): ArtifactEntry =>
  ({ relPath, name: relPath.split("/").at(-1)!, kind: relPath.endsWith(".png") ? "image" : "report", size, mtime });
const ENTRIES = [f("a.md", 10, "2026-01-01"), f("runs/x.md", 50, "2026-03-01"), f("runs/deep/y.png", 5, "2026-02-01"), f("b.md", 99, "2026-02-15")];

describe("artifact explorer", () => {
  test("a folder lists its direct files and its subfolders with their totals", () => {
    const top = listing(ENTRIES, explorerView(new URLSearchParams()));
    expect(top.folders).toEqual([{ name: "runs", path: "runs", count: 2, size: 55, mtime: "2026-03-01" }]);
    expect(top.files.map((x) => x.name)).toEqual(["b.md", "a.md"]);
    const runs = listing(ENTRIES, explorerView(new URLSearchParams("dir=runs")));
    expect(runs.folders.map((x) => x.name)).toEqual(["deep"]);
    expect(runs.files.map((x) => x.name)).toEqual(["x.md"]);
  });

  test("sort by size ascending, and search is flat across folders", () => {
    expect(listing(ENTRIES, explorerView(new URLSearchParams("sort=size&order=asc"))).files.map((x) => x.name)).toEqual(["a.md", "b.md"]);
    expect(listing(ENTRIES, explorerView(new URLSearchParams("q=.png"))).files.map((x) => x.relPath)).toEqual(["runs/deep/y.png"]);
  });

  test("a dir or file parameter cannot climb out of the artifacts folder", () => {
    const v = explorerView(new URLSearchParams("dir=../../etc&file=../secret"));
    expect(v.dir).toBe("etc");
    expect(v.file).toBe("secret");
  });
});
