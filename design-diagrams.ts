// pantry/design-diagrams.ts: the Design surface's diagrams. GRAIN's diagram organism owns the
// layout, the notation shapes and the pan, zoom and hover behaviour; this file only maps a
// project's design files onto it: which table is a stub, where each node links, what a title says,
// and which flows cross a region and so are drawn heavier.
import {
  erdDiagram, dfdDiagram, layeredDiagram, DIAGRAM_SCRIPT as GRAIN_DIAGRAM_SCRIPT,
  type ErdEnd, type ErdEntityIn, type LayeredKind, type LayeredNodeIn,
} from "@tjakoen/grain/components/organisms/diagram/diagram.ts";
import type { DesignModel, ArchLevel, UserFlow } from "./design.ts";
import { crossesRegion } from "./design.ts";

const enc = encodeURIComponent;

/** A cardinality such as many-to-one, read as the two crow's-foot ends. */
function ends(card: string): [ErdEnd, ErdEnd] {
  const [from, to] = card.split("-to-");
  const end = (s: string | undefined, fallback: ErdEnd): ErdEnd =>
    s === "many" ? "many" : s?.startsWith("zero") ? "zero-or-one" : s === "one" ? fallback : fallback;
  return [end(from, "one"), end(to, "exactly-one")];
}

export function erdSvg(m: DesignModel, selected?: string): string {
  const erd = m.erd!;
  const entities: ErdEntityIn[] = erd.entities.map((t) => {
    const fk = new Set(erd.relations.filter((r) => r.from === t.id).flatMap((r) => r.columns));
    return {
      id: t.id, href: `/design/erd/${enc(t.id)}`, tag: t.rls ? "RLS" : undefined,
      title: `${t.id}${t.rls ? " (row-level security on)" : ""}`,
      columns: t.columns.map((c) => ({ name: c.name, type: c.type, pk: c.pk, nullable: c.nullable, fk: fk.has(c.name) })),
    };
  });
  // A foreign key into a table outside the schema files (auth.users) still gets a stub box.
  for (const r of erd.relations) if (!entities.some((x) => x.id === r.to))
    entities.push({ id: r.to, stub: true, title: `${r.to} (outside the schema files)`, columns: r.refColumns.map((c) => ({ name: c, pk: true })) });
  const byId = new Map(erd.entities.map((t) => [t.id, t]));
  return erdDiagram({
    entities, selected, label: `Entity relationship diagram with ${erd.entities.length} tables`,
    relations: erd.relations.map((r) => {
      const card = r.cardinality ?? "many-to-one";
      const [fromEnd, toEnd] = ends(card);
      const optional = r.columns.some((c) => byId.get(r.from)?.columns.find((x) => x.name === c)?.nullable);
      return {
        id: r.id, from: r.from, to: r.to, fromColumn: r.columns[0], toColumn: r.refColumns[0], fromEnd, toEnd, optional,
        href: `/design/erd/${enc(r.from)}`,
        title: `${r.id}: ${r.from}(${r.columns.join(", ")}) → ${r.to}(${r.refColumns.join(", ")}), ${card}${optional ? ", optional" : ""}${r.onDelete ? `, on delete ${r.onDelete}` : ""}`,
      };
    }),
  });
}

export function dfdSvg(m: DesignModel, selected?: string): string {
  const d = m.dfd!;
  return dfdDiagram({
    selected, label: `Data flow diagram with ${d.flows.length} flows`,
    nodes: d.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, boundary: n.boundary, title: `${n.label} (${n.kind}${n.region ? `, ${n.region}` : ""})` })),
    boundaries: d.boundaries.map((b) => ({ id: b.id, label: `${b.label}${b.region ? ` · ${b.region}` : ""}`, title: `Trust boundary: ${b.label}${b.region ? `, ${b.region}` : ""}` })),
    flows: d.flows.map((f) => {
      const cross = crossesRegion(m, f);
      return {
        id: f.id, from: f.from, to: f.to, label: f.label ?? f.id, emphasis: cross, href: `/design/dfd/${enc(f.id)}`,
        title: `${f.label ?? f.id}${f.region ? `, ${f.region}` : ""}${cross ? " (crosses a region boundary)" : ""}`,
      };
    }),
  });
}

const C4_KINDS: Record<string, LayeredKind> = { person: "person", system: "system", container: "container", external: "external" };
const C4_SUB: Record<string, string> = { external: "[External system]", system: "[Software system]", person: "[Person]" };

export function c4Svg(level: ArchLevel, which: "context" | "containers", systemLabel?: string): string {
  const nodes: LayeredNodeIn[] = level.nodes.map((n) => ({
    id: n.id, label: n.label, kind: C4_KINDS[n.kind] ?? "container",
    sub: n.tech ? `[${n.tech}]` : C4_SUB[n.kind],
    title: [n.label, n.tech, n.description].filter(Boolean).join(" · "),
  }));
  const group = which === "containers" ? { label: systemLabel ?? "System", members: level.nodes.filter((n) => n.kind === "container").map((n) => n.id) } : undefined;
  return layeredDiagram({ kind: `c4-${which}`, nodes, group, label: `C4 ${which} diagram`, edges: level.relations.map((r) => ({ from: r.from, to: r.to, label: r.label, id: r.id })) });
}

const STEP_KINDS: Record<string, LayeredKind> = { start: "start", action: "action", decision: "decision", system: "flow-system", end: "end" };

export function flowSvg(_m: DesignModel, f: UserFlow): string {
  const nodes: LayeredNodeIn[] = f.steps.map((s) => ({
    id: s.id, label: s.label, kind: STEP_KINDS[s.kind] ?? "action", sub: s.screen ? `screen: ${s.screen}` : undefined,
    href: `#step-${s.id}`, title: `${s.kind}: ${s.label}${s.test ? ` · test: ${s.test}` : ""}`,
  }));
  const edges = f.steps.flatMap((s) => s.next.map((n, i) => ({ from: s.id, to: n, label: s.kind === "decision" ? (s.next.length === 2 ? (i === 0 ? "yes" : "no") : n) : undefined })));
  return layeredDiagram({ kind: "flow", nodes, edges, minWidth: 160, label: `User flow: ${f.title}` });
}

// On a user flow, a step with a screen previews its wireframe beside the diagram. This half is
// PANTRY's own; pan, zoom and tracing come from GRAIN.
const STEP_PREVIEW_SCRIPT = `<script>
(() => {
  const frame = document.querySelector("[data-step-preview]");
  if (!frame) return;
  const show = (id) => {
    const step = document.getElementById("step-" + id); if (!step) return;
    document.querySelectorAll(".pantry-design__step.is-current, .dg-node.is-selected").forEach((s) => s.classList.remove("is-current", "is-selected"));
    step.classList.add("is-current");
    document.querySelector('.dg-node[data-node="' + CSS.escape(id) + '"]')?.classList.add("is-selected");
    const screen = step.dataset.screen;
    frame.hidden = !screen; document.querySelector("[data-step-empty]").hidden = !!screen;
    if (screen) { frame.src = "/design/wireframe-raw/" + encodeURIComponent(screen); document.querySelector("[data-step-caption]").textContent = step.dataset.label + " · " + screen; }
  };
  document.querySelectorAll('.dg-node[href^="#step-"]').forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); const id = a.dataset.node; history.replaceState(null, "", "#step-" + id); show(id); }));
  addEventListener("message", (ev) => {
    if (ev.source !== frame.contentWindow || !ev.data || typeof ev.data.screen !== "string") return;
    const next = document.querySelector('.pantry-design__step[data-screen="' + CSS.escape(ev.data.screen) + '"]');
    if (next) show(next.id.slice(5)); else frame.src = "/design/wireframe-raw/" + encodeURIComponent(ev.data.screen);
  });
  const first = location.hash.startsWith("#step-") ? location.hash.slice(6) : document.querySelector(".pantry-design__step[data-screen]")?.id.slice(5);
  if (first) show(first);
})();
</script>`;

export const DIAGRAM_SCRIPT = GRAIN_DIAGRAM_SCRIPT + STEP_PREVIEW_SCRIPT;
/** The marker design-page.ts looks for to decide whether a page needs DIAGRAM_SCRIPT. */
export const DIAGRAM_MARKER = "diagram__svg";
