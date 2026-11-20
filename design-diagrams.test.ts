// pantry/design-diagrams.test.ts: the design model reaches GRAIN's diagram organism intact.
import { test, expect } from "bun:test";
import { erdSvg, dfdSvg, flowSvg, DIAGRAM_SCRIPT, DIAGRAM_MARKER } from "./design-diagrams.ts";
import type { DesignModel } from "./design.ts";

const model = {
  erd: {
    entities: [{ id: "bookings", rls: true, primaryKey: ["id"], columns: [{ name: "id", pk: true }, { name: "user_id", nullable: true }] }],
    relations: [{ id: "bookings_user", from: "bookings", to: "auth.users", columns: ["user_id"], refColumns: ["id"], cardinality: "many-to-zero-or-one" }],
  },
  dfd: {
    nodes: [
      { id: "visitor", kind: "external", label: "Website visitor", region: "Canada" },
      { id: "book", kind: "process", label: "Book function", boundary: "supabase" },
      { id: "portal", kind: "process", label: "Client page", boundary: "browser" },
    ],
    boundaries: [{ id: "browser", label: "Browser", region: "Canada", members: ["portal"] }, { id: "supabase", label: "Supabase", region: "Singapore", members: ["book"] }],
    flows: [{ id: "flow-booking", from: "visitor", to: "book", label: "Visitor sends a request", data: [], region: "Singapore" }],
  },
} as unknown as DesignModel;

test("the ERD links tables, stubs a table outside the schema and marks RLS", () => {
  const svg = erdSvg(model, "bookings");
  expect(svg).toContain(DIAGRAM_MARKER);
  expect(svg).toContain('href="/design/erd/bookings"');
  expect(svg).toContain("dg-stub");
  expect(svg).toContain("(row-level security on)");
  expect(svg).toContain("dg-optional");
});

test("the DFD links flows and keeps the visitor's flow off the browser boundary", () => {
  const svg = dfdSvg(model);
  expect(svg).toContain('href="/design/dfd/flow-booking"');
  const x = (id: string) => Number(svg.match(new RegExp(`data-node="${id}"[^>]*><title>[^<]*</title><rect[^>]* x="([\\d.]+)"`))?.[1]);
  expect(x("visitor")).toBeGreaterThan(x("book"));
  expect(x("book")).toBeGreaterThan(x("portal"));
});

test("a user flow's steps link to their step and the script carries the step preview", () => {
  const svg = flowSvg(model, { id: "f", title: "F", steps: [{ id: "a", kind: "start", label: "Go", next: ["b"] }, { id: "b", kind: "end", label: "Done", next: [] }] });
  expect(svg).toContain('href="#step-a"');
  expect(svg).toContain("dg-k-start");
  expect(DIAGRAM_SCRIPT).toContain("data-step-preview");
  expect(DIAGRAM_SCRIPT).toContain(".diagram");
});
