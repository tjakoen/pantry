// pantry/design.ts — the model behind the Design surface: a project's design/ folder, read and
// cross-linked, never written. The format is DESIGN-STANDARD's (contract v0: erd, dictionary, dfd,
// architecture, flows/, wireframes/, decisions/, requirements). PANTRY is a lens on it, the same
// rule as plans: the files are the source of truth and every view here is a projection of them.
//
// One model feeds three readers: the human pages (design-page.ts), the machine twin at
// /design.json (what pantry_read serves agents), and the alignment rows in `pantry doctor`. They
// share this module so an agent, the owner and the doctor never disagree about what the design says.
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parseFrontmatter } from "@tjakoen/mill/core/frontmatter.ts";

// ── The artifact shapes (as read; every field optional, because the files are hand-edited) ───────

export interface ErdColumn { name: string; type?: string; pk?: boolean; nullable?: boolean; default?: string }
export interface ErdEntity { id: string; schema?: string; rls?: boolean; primaryKey: string[]; columns: ErdColumn[] }
/** A foreign key, flattened. `id` is the contract's `<entity>.<cols>`; cardinality reads from→to. */
export interface ErdRelation { id: string; from: string; to: string; columns: string[]; refColumns: string[]; cardinality?: string; onDelete?: string }

export interface RlsRule { id: string; op?: string; rule: string; test?: string }
export interface DictTable { id: string; meaning?: string; columns: Record<string, string>; rls: RlsRule[] }

export type DfdKind = "process" | "store" | "external";
export interface DfdNode { id: string; kind: DfdKind; label: string; region?: string; boundary?: string }
export interface DfdBoundary { id: string; label: string; region?: string; members: string[] }
export interface DfdFlow { id: string; from: string; to: string; label?: string; data: string[]; region?: string; retention?: string; purpose?: string }

export interface ArchNode { id: string; kind: string; label: string; description?: string; tech?: string }
export interface ArchRelation { id: string; from: string; to: string; label?: string }
export interface ArchLevel { nodes: ArchNode[]; relations: ArchRelation[] }

export type StepKind = "start" | "action" | "decision" | "system" | "end";
export interface FlowStep { id: string; kind: StepKind; label: string; screen?: string; test?: string; next: string[] }
export interface UserFlow { id: string; title: string; steps: FlowStep[] }

export type DecisionStatus = "proposed" | "accepted" | "superseded";
export interface Decision { id: string; file: string; title: string; status: DecisionStatus | string; supersededBy?: string; body: string }

export interface Requirement { id: string; text: string; plan?: string; artifacts: string[]; tests: string[] }

/** pass/fail come from a results file; unrun means the test file exists but no result is known;
 *  missing means the file the reference names does not exist in the project. */
export type TestState = "pass" | "fail" | "unrun" | "missing";

export interface DesignPlan { id: string; title: string; status: string; touches: string[]; design: string[] }

export interface DesignModel {
  available: boolean;
  reason?: string;
  project: string;
  dir: string;
  erd: { entities: ErdEntity[]; relations: ErdRelation[]; enums: { id: string; values: string[] }[]; skipped: string[]; generatedFrom: string[] } | null;
  dictionary: DictTable[] | null;
  dfd: { nodes: DfdNode[]; boundaries: DfdBoundary[]; flows: DfdFlow[] } | null;
  architecture: { context: ArchLevel; containers: ArchLevel } | null;
  flows: UserFlow[];
  wireframes: string[];
  decisions: Decision[];
  requirements: Requirement[] | null;
  plans: DesignPlan[];
  /** test ref → state, for every test any artifact names */
  tests: Record<string, TestState>;
  /** whether a results file was found (the done-with-failing-test rule only judges when it was) */
  resultsAvailable: boolean;
  /** files that would not parse, with why; a broken file degrades its view, never the page */
  errors: { file: string; message: string }[];
}

// ── small readers ───────────────────────────────────────────────────────────────────────────────

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x) : typeof v === "string" && v ? [v] : []);
const objs = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);

async function readYaml(file: string, errors: DesignModel["errors"], label: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(file)) return null;
  try {
    const parsed = Bun.YAML.parse(await readFile(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch (err) {
    errors.push({ file: label, message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function listFiles(dir: string, ext: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => f.endsWith(ext)).sort();
}

// ── the loader ──────────────────────────────────────────────────────────────────────────────────

export interface LoadDesignOptions { project?: string; designDir?: string; plansDir?: string; checks?: DesignChecks }

/** Per-project inputs to the screen rules, from pantry.config.json's `design` key. */
export interface DesignChecks {
  /** paths whose plans add or change screens, e.g. ["src/portal/", "src/site/pages/"]; none → the rule is skipped */
  uiPaths?: string[];
  /** visual mockups (repo-relative) and the ADR that describes each, e.g. { file: "avero/desk-notebook.html", decision: "008-desk-layout" } */
  mockups?: { file: string; decision: string }[];
}

/** Read a project's design/ folder. `cwd` is the project root; test references resolve from it. */
export async function loadDesign(cwd: string, opts: LoadDesignOptions = {}): Promise<DesignModel> {
  const dir = opts.designDir ?? join(cwd, "design");
  const project = opts.project ?? basename(cwd);
  const errors: DesignModel["errors"] = [];
  const empty: DesignModel = {
    available: false, project, dir, erd: null, dictionary: null, dfd: null, architecture: null,
    flows: [], wireframes: [], decisions: [], requirements: null, plans: [], tests: {}, resultsAvailable: false, errors,
  };
  if (!existsSync(dir)) return { ...empty, reason: `No design/ folder in ${project}. The design skill writes one (DESIGN-STANDARD).` };

  const erdRaw = await readYaml(join(dir, "erd.yaml"), errors, "erd.yaml");
  // erd.yaml is written by the design skill's scripts/erd.ts (contract: "erd.yaml shape").
  const erdEntities = erdRaw ? objs(erdRaw.entities) : [];
  const erd = erdRaw && {
    generatedFrom: list(erdRaw.generated_from),
    enums: objs(erdRaw.enums).map((e) => ({ id: str(e.id) ?? "", values: list(e.values) })).filter((e) => e.id),
    skipped: list(erdRaw.skipped),
    entities: erdEntities.map((e) => ({
      id: str(e.id) ?? "", schema: str(e.schema), rls: e.rls === true, primaryKey: list(e.primary_key),
      columns: objs(e.columns).map((c) => ({ name: str(c.id) ?? str(c.name) ?? "", type: str(c.type), pk: c.pk === true || list(e.primary_key).includes(str(c.id) ?? ""), nullable: c.nullable === true, default: str(c.default) })),
    })).filter((e) => e.id),
    relations: erdEntities.flatMap((e) => objs(e.foreign_keys).map((k) => {
      const cols = list(k.columns);
      return { id: str(k.id) ?? `${str(e.id)}.${cols.join("_")}`, from: str(e.id) ?? "", to: str(k.references) ?? "", columns: cols, refColumns: list(k.ref_columns), cardinality: str(k.cardinality), onDelete: str(k.on_delete) };
    })),
  };

  const dictRaw = await readYaml(join(dir, "dictionary.yaml"), errors, "dictionary.yaml");
  const dictionary = dictRaw && objs(dictRaw.tables).map((t) => {
    const cols: Record<string, string> = {};
    const rawCols = t.columns;
    if (Array.isArray(rawCols)) for (const c of objs(rawCols)) { const n = str(c.name); if (n) cols[n] = str(c.meaning) ?? ""; }
    else if (rawCols && typeof rawCols === "object") for (const [k, v] of Object.entries(rawCols)) cols[k] = str(v) ?? "";
    return {
      id: str(t.id) ?? "", meaning: str(t.meaning), columns: cols,
      rls: objs(t.rls).map((r, i) => ({ id: str(r.id) ?? `${str(t.id)}-rls-${i + 1}`, op: str(r.op), rule: str(r.rule) ?? "", test: str(r.test) })),
    };
  }).filter((t) => t.id);

  const dfdRaw = await readYaml(join(dir, "dfd.yaml"), errors, "dfd.yaml");
  let dfd: DesignModel["dfd"] = null;
  if (dfdRaw) {
    const nodes: DfdNode[] = [];
    for (const [key, kind] of [["processes", "process"], ["stores", "store"], ["externals", "external"]] as const) {
      for (const n of objs(dfdRaw[key])) {
        const id = str(n.id);
        if (id) nodes.push({ id, kind, label: str(n.label) ?? id, region: str(n.region), boundary: str(n.boundary) });
      }
    }
    const boundaries = objs(dfdRaw.boundaries).map((b) => ({ id: str(b.id) ?? "", label: str(b.label) ?? str(b.id) ?? "", region: str(b.region), members: list(b.members) })).filter((b) => b.id);
    // A node names its boundary, or a boundary lists its members; either way the node ends up knowing it.
    for (const b of boundaries) for (const m of b.members) { const n = nodes.find((x) => x.id === m); if (n && !n.boundary) n.boundary = b.id; }
    for (const n of nodes) if (n.boundary) { const b = boundaries.find((x) => x.id === n.boundary); if (b && !b.members.includes(n.id)) b.members.push(n.id); }
    const flows = objs(dfdRaw.flows).map((f) => ({
      id: str(f.id) ?? "", from: str(f.from) ?? "", to: str(f.to) ?? "", label: str(f.label), data: list(f.data),
      region: str(f.region), retention: str(f.retention), purpose: str(f.purpose),
    })).filter((f) => f.id);
    dfd = { nodes, boundaries, flows };
  }

  const archRaw = await readYaml(join(dir, "architecture.yaml"), errors, "architecture.yaml");
  const level = (v: unknown): ArchLevel => {
    const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
    return {
      nodes: objs(o.nodes).map((n) => ({ id: str(n.id) ?? "", kind: str(n.kind) ?? "system", label: str(n.label) ?? str(n.id) ?? "", description: str(n.description), tech: str(n.tech) })).filter((n) => n.id),
      relations: objs(o.relations).map((r, i) => ({ id: str(r.id) ?? `rel-${i + 1}`, from: str(r.from) ?? "", to: str(r.to) ?? "", label: str(r.label) })),
    };
  };
  const architecture = archRaw && { context: level(archRaw.context), containers: level(archRaw.containers) };

  const flows: UserFlow[] = [];
  for (const f of await listFiles(join(dir, "flows"), ".yaml")) {
    const raw = await readYaml(join(dir, "flows", f), errors, `flows/${f}`);
    if (!raw) continue;
    const id = basename(f, ".yaml");
    flows.push({
      id, title: str(raw.title) ?? id,
      steps: objs(raw.steps).map((s) => ({
        id: str(s.id) ?? "", kind: (str(s.kind) ?? "action") as StepKind, label: str(s.label) ?? str(s.id) ?? "",
        screen: str(s.screen), test: str(s.test), next: list(s.next),
      })).filter((s) => s.id),
    });
  }

  const wireframes = (await listFiles(join(dir, "wireframes"), ".html")).map((f) => basename(f, ".html"));

  const decisions: Decision[] = [];
  for (const f of await listFiles(join(dir, "decisions"), ".md")) {
    const { data, body } = parseFrontmatter(await readFile(join(dir, "decisions", f), "utf8"));
    const stem = basename(f, ".md");
    const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    decisions.push({ id: str(data.id) ?? stem, file: stem, title: h1 ?? stem, status: str(data.status) ?? "proposed", supersededBy: str(data.superseded_by), body });
  }

  const reqRaw = await readYaml(join(dir, "requirements.yaml"), errors, "requirements.yaml");
  const requirements = reqRaw && objs(reqRaw.requirements).map((r) => ({
    id: str(r.id) ?? "", text: str(r.text) ?? "", plan: str(r.plan), artifacts: list(r.artifacts), tests: list(r.tests),
  })).filter((r) => r.id);

  const plans = await loadDesignPlans(opts.plansDir ?? join(cwd, "plans"));

  // Test results are optional. DESIGN-STANDARD v0 says the done rule judges failing tests "when
  // results are available" without naming a file, so PANTRY reads design/test-results.json, a flat
  // map of test ref → "pass" | "fail", and says so on the page. Absent, every state is unrun/missing.
  const resultsFile = join(dir, "test-results.json");
  let results: Record<string, string> = {};
  let resultsAvailable = false;
  if (existsSync(resultsFile)) {
    try { results = JSON.parse(await readFile(resultsFile, "utf8")); resultsAvailable = true; }
    catch (err) { errors.push({ file: "test-results.json", message: err instanceof Error ? err.message : String(err) }); }
  }
  const testRefs = new Set<string>();
  for (const t of dictionary ?? []) for (const r of t.rls) if (r.test) testRefs.add(r.test);
  for (const f of flows) for (const s of f.steps) if (s.test) testRefs.add(s.test);
  for (const r of requirements ?? []) for (const t of r.tests) testRefs.add(t);
  const tests: Record<string, TestState> = {};
  for (const ref of testRefs) tests[ref] = testState(cwd, ref, results);

  return { available: true, project, dir, erd, dictionary, dfd, architecture, flows, wireframes, decisions, requirements, plans, tests, resultsAvailable, errors };
}

export function testState(cwd: string, ref: string, results: Record<string, string>): TestState {
  const r = results[ref];
  if (r === "pass" || r === "fail") return r;
  const path = ref.split("::")[0]!;
  return existsSync(join(cwd, path)) ? "unrun" : "missing";
}

/** The plans' frontmatter fields this surface needs, `design` among them. PROOF's parser drops
 *  fields it does not know, which is why the optional `design` field already passes its lint; it is
 *  also why PANTRY reads the field itself instead of asking PROOF for it. */
export async function loadDesignPlans(plansDir: string): Promise<DesignPlan[]> {
  const out: DesignPlan[] = [];
  for (const f of await listFiles(plansDir, ".md")) {
    if (f.toLowerCase() === "readme.md") continue;
    const { data, body } = parseFrontmatter(await readFile(join(plansDir, f), "utf8"));
    const id = basename(f, ".md");
    out.push({
      id, title: body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? id, status: str(data.status) ?? "todo",
      touches: list(data.touches), design: list(data.design),
    });
  }
  return out;
}

// ── references ──────────────────────────────────────────────────────────────────────────────────

export interface ParsedRef { file: string; id?: string }
export const parseRef = (ref: string): ParsedRef => {
  const [file, id] = ref.split("#", 2);
  return { file: file!.replace(/\.(ya?ml|html|md)$/, ""), id: id || undefined };
};

/** Every addressable id, per file, as the contract names files: erd, dictionary, dfd, architecture,
 *  flows/<id>, wireframes/<id>, decisions/<stem>, requirements. */
export function refIndex(m: DesignModel): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  const add = (file: string, ids: string[]) => idx.set(file, new Set(ids));
  if (m.erd) add("erd", [...m.erd.entities.map((e) => e.id), ...m.erd.relations.map((r) => r.id)]);
  if (m.dictionary) add("dictionary", m.dictionary.flatMap((t) => [t.id, ...t.rls.map((r) => r.id)]));
  if (m.dfd) add("dfd", [...m.dfd.nodes.map((n) => n.id), ...m.dfd.boundaries.map((b) => b.id), ...m.dfd.flows.map((f) => f.id)]);
  if (m.architecture) add("architecture", [m.architecture.context, m.architecture.containers].flatMap((l) => [...l.nodes.map((n) => n.id), ...l.relations.map((r) => r.id)]));
  for (const f of m.flows) add(`flows/${f.id}`, f.steps.map((s) => s.id));
  for (const w of m.wireframes) add(`wireframes/${w}`, []);
  for (const d of m.decisions) { add(`decisions/${d.file}`, [d.id]); if (d.id !== d.file) add(`decisions/${d.id}`, [d.id]); }
  if (m.requirements) add("requirements", m.requirements.map((r) => r.id));
  return idx;
}

export function resolves(idx: Map<string, Set<string>>, ref: string): boolean {
  const { file, id } = parseRef(ref);
  const ids = idx.get(file);
  return !!ids && (!id || ids.has(id));
}

/** Where a reference opens in the Design surface. */
export function refHref(ref: string): string {
  const { file, id } = parseRef(ref);
  const enc = encodeURIComponent;
  // The erd route resolves an entity, a foreign key or an RLS rule id to its table itself, because
  // entity ids can carry a dot of their own (auth.users) and a split here would guess wrong.
  if (file === "erd" || file === "dictionary") return id ? `/design/erd/${enc(id)}` : "/design/erd";
  if (file === "dfd") return id ? `/design/dfd/${enc(id)}` : "/design/dfd";
  if (file === "architecture") return `/design/architecture${id ? `#${enc(id)}` : ""}`;
  if (file === "requirements") return `/design/requirements${id ? `#req-${enc(id)}` : ""}`;
  if (file.startsWith("flows/")) return `/design/flows/${enc(file.slice(6))}${id ? `#step-${enc(id)}` : ""}`;
  if (file.startsWith("wireframes/")) return `/design/wireframes/${enc(file.slice(11))}`;
  if (file.startsWith("decisions/")) return `/design/decisions#adr-${enc(file.slice(10))}`;
  return "/design";
}

/** Every reference the artifacts and plans make, with where it was made. */
export function allRefs(m: DesignModel): { from: string; ref: string }[] {
  const out: { from: string; ref: string }[] = [];
  for (const f of m.dfd?.flows ?? []) for (const d of f.data) if (d.includes("#")) out.push({ from: `dfd#${f.id}`, ref: d });
  for (const r of m.requirements ?? []) for (const a of r.artifacts) out.push({ from: `requirements#${r.id}`, ref: a });
  for (const fl of m.flows) for (const s of fl.steps) {
    if (s.screen) out.push({ from: `flows/${fl.id}#${s.id}`, ref: `wireframes/${s.screen}` });
    for (const n of s.next) out.push({ from: `flows/${fl.id}#${s.id}`, ref: `flows/${fl.id}#${n}` });
  }
  for (const d of m.decisions) if (d.supersededBy) out.push({ from: `decisions/${d.file}`, ref: `decisions/${d.supersededBy}` });
  for (const t of m.dictionary ?? []) if (m.erd) out.push({ from: `dictionary#${t.id}`, ref: `erd#${t.id}` });
  for (const p of m.plans) for (const d of p.design) out.push({ from: `plan ${p.id}`, ref: d });
  return out;
}

/** The table a erd/dictionary id belongs to: an entity itself, the owner of a foreign key, or the
 *  table that holds an RLS rule. */
export function tableFor(m: DesignModel, id: string): string | undefined {
  if (m.erd?.entities.some((e) => e.id === id)) return id;
  const fk = m.erd?.relations.find((r) => r.id === id);
  if (fk) return fk.from;
  const t = m.dictionary?.find((x) => x.id === id || x.rls.some((r) => r.id === id));
  return t?.id;
}

// ── cross-references the views show ─────────────────────────────────────────────────────────────

const refersTo = (ref: string, file: string, id: string) => { const p = parseRef(ref); return p.file === file && p.id === id; };

/** The plans whose `design` field names this table (erd#id or dictionary#id, or one of its RLS rules). */
export function plansForTable(m: DesignModel, table: string): DesignPlan[] {
  const rls = new Set((m.dictionary?.find((t) => t.id === table)?.rls ?? []).map((r) => r.id));
  return m.plans.filter((p) => p.design.some((d) => refersTo(d, "erd", table) || refersTo(d, "dictionary", table) || (parseRef(d).file === "dictionary" && rls.has(parseRef(d).id ?? ""))));
}

/** The DFD flows that carry this table (a flow's data lists erd#table). */
export const flowsForTable = (m: DesignModel, table: string): DfdFlow[] =>
  (m.dfd?.flows ?? []).filter((f) => f.data.some((d) => refersTo(d, "erd", table)));

const regionOf = (m: DesignModel, nodeId: string): string | undefined => {
  const n = m.dfd?.nodes.find((x) => x.id === nodeId);
  if (!n) return undefined;
  return n.region ?? m.dfd?.boundaries.find((b) => b.id === n.boundary)?.region;
};

/** A flow crosses a region boundary when its two ends sit in different regions. */
export function crossesRegion(m: DesignModel, f: DfdFlow): boolean {
  const a = regionOf(m, f.from), b = regionOf(m, f.to);
  return !!a && !!b && a !== b;
}

export const plansFor = (m: DesignModel, ref: string): DesignPlan[] => {
  const t = parseRef(ref);
  return m.plans.filter((p) => p.design.some((d) => { const x = parseRef(d); return x.file === t.file && (!t.id || x.id === t.id || !x.id); }));
};

// ── the alignment check (contract v0, "The alignment check") ────────────────────────────────────

export interface AlignmentRule { id: string; label: string; ok: boolean; detail: string; problems: string[] }

async function newestMtime(dir: string): Promise<{ file: string; mtime: number } | null> {
  if (!existsSync(dir)) return null;
  let best: { file: string; mtime: number } | null = null;
  for (const f of await readdir(dir, { recursive: true })) {
    const s = await stat(join(dir, f)).catch(() => null);
    if (s?.isFile() && (!best || s.mtimeMs > best.mtime)) best = { file: String(f), mtime: s.mtimeMs };
  }
  return best;
}

// The same hash the design skill's erd.ts writes: sha256 over each .sql file in name order, as
// "<basename>\n<content>\n". The two must agree byte for byte.
export async function schemaHash(dir: string): Promise<string> {
  const h = createHash("sha256");
  const names = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort((a, b) => (a < b ? -1 : 1));
  for (const f of names) h.update(`${f}\n${await readFile(join(dir, f), "utf8")}\n`);
  return h.digest("hex");
}

const some = (xs: string[], n = 4) => xs.slice(0, n).join("; ") + (xs.length > n ? `; and ${xs.length - n} more` : "");

const trimPath = (p: string) => p.replace(/^\.\//, "").replace(/\/+$/, "");
/** A touch and a UI path overlap when either contains the other: `src/` covers `src/portal/`, and so does `src/portal/desk.tsx`. */
const overlaps = (touch: string, ui: string) => {
  const t = trimPath(touch), u = trimPath(ui);
  return t === u || t.startsWith(`${u}/`) || u.startsWith(`${t}/`) || t === "" || t === ".";
};

/** When a file last changed: its last commit when clean, its file time when dirty or untracked. */
async function lastChanged(cwd: string, rel: string): Promise<number | null> {
  const abs = join(cwd, rel);
  if (!existsSync(abs)) return null;
  const git = async (...args: string[]) => {
    const p = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore" });
    return p.exitCode === 0 ? p.stdout.toString().trim() : null;
  };
  const dirty = await git("status", "--porcelain", "--", rel);
  const committed = await git("log", "-1", "--format=%ct", "--", rel);
  if (dirty === "" && committed) return Number(committed) * 1000;
  return (await stat(abs)).mtimeMs;
}

export async function checkAlignment(cwd: string, m: DesignModel, checks: DesignChecks = {}): Promise<AlignmentRule[]> {
  const rules: AlignmentRule[] = [];
  const rule = (id: string, label: string, problems: string[], okDetail: string) =>
    rules.push({ id, label, ok: problems.length === 0, problems, detail: problems.length ? some(problems) : okDetail });

  // 1. erd.yaml is generated from supabase/schemas. The generator records a hash of the schema
  // files, so freshness is judged on content: a checkout or pull writes files in whatever order it
  // likes, and file times alone report drift that is not there. ERDs without the hash fall back to
  // comparing file times.
  const schemaDir = join(cwd, "supabase", "schemas");
  const erdFile = join(m.dir, "erd.yaml");
  const erdProblems: string[] = [];
  let erdOk = "no supabase/schemas to compare against";
  if (existsSync(schemaDir)) {
    if (!existsSync(erdFile)) erdProblems.push("supabase/schemas exists but design/erd.yaml does not; generate it");
    else {
      const recorded = (await readFile(erdFile, "utf8")).match(/^schemas_sha256:\s*([0-9a-f]{64})\s*$/m)?.[1];
      if (recorded) {
        const current = await schemaHash(schemaDir);
        if (current !== recorded) erdProblems.push("supabase/schemas changed since design/erd.yaml was generated; regenerate the ERD");
        erdOk = "erd.yaml was generated from the current schema files";
      } else {
        const schemas = await newestMtime(schemaDir);
        const erdStat = await stat(erdFile);
        if (schemas && schemas.mtime > erdStat.mtimeMs) erdProblems.push(`supabase/schemas/${schemas.file} is newer than design/erd.yaml; regenerate the ERD`);
        erdOk = "erd.yaml is newer than every schema file (regenerate it to record a schema hash)";
      }
    }
  }
  rule("design-erd-fresh", "design: ERD matches the schemas", erdProblems, erdOk);

  // 2. A plan that touches the schemas must say which part of the data model it changes.
  const schemaPlans = m.plans.filter((p) => p.touches.some((t) => t.replace(/^\.\//, "").startsWith("supabase/schemas")));
  rule("design-schema-plans", "design: schema plans cite the data model",
    schemaPlans.filter((p) => !p.design.some((d) => ["erd", "dictionary"].includes(parseRef(d).file))).map((p) => `${p.id} touches supabase/schemas with no erd or dictionary reference`),
    `${schemaPlans.length} plan${schemaPlans.length === 1 ? "" : "s"} touch the schemas, each cites the ERD or dictionary`);

  // 3. Every reference resolves.
  const idx = refIndex(m);
  const refs = allRefs(m);
  rule("design-refs", "design: references resolve",
    refs.filter((r) => !resolves(idx, r.ref)).map((r) => `${r.from} → ${r.ref} does not exist`),
    `${refs.length} references, all resolve`);

  // 4. A done plan has a test for each requirement, and none of them failing (when results exist).
  const doneProblems: string[] = [];
  for (const p of m.plans.filter((x) => x.status === "done")) {
    for (const r of (m.requirements ?? []).filter((x) => x.plan === p.id)) {
      if (r.tests.length === 0) doneProblems.push(`${p.id} is done but requirement ${r.id} has no test`);
      else if (m.resultsAvailable) for (const t of r.tests) if (m.tests[t] !== "pass") doneProblems.push(`${p.id} is done but ${r.id}'s test ${t} is ${m.tests[t] ?? "unrun"}`);
    }
  }
  rule("design-done-tests", "design: done plans have passing tests", doneProblems,
    m.resultsAvailable ? "every done plan's requirements have passing tests" : "every done plan's requirements have a test (no results file, so pass/fail is not judged)");

  // 5. No plan cites a superseded decision.
  const superseded = new Map(m.decisions.filter((d) => d.status === "superseded").flatMap((d) => [[d.file, d], [d.id, d]] as const));
  rule("design-superseded", "design: plans cite current decisions",
    m.plans.flatMap((p) => p.design.filter((d) => parseRef(d).file.startsWith("decisions/")).flatMap((d) => {
      const dec = superseded.get(parseRef(d).file.slice(10));
      return dec ? [`${p.id} cites ${d}, superseded${dec.supersededBy ? ` by ${dec.supersededBy}` : ""}`] : [];
    })),
    `${m.decisions.length} decision${m.decisions.length === 1 ? "" : "s"}, no plan cites a superseded one`);

  // 6. A plan that adds or changes a screen owes the wireframe and the flow that reaches it
  // (DESIGN-STANDARD section 4). Which paths hold screens is the project's to say.
  const uiPaths = checks.uiPaths ?? [];
  if (uiPaths.length) {
    const uiPlans = m.plans.filter((p) => p.touches.some((t) => uiPaths.some((u) => overlaps(t, u))));
    rule("design-ui-plans", "design: UI plans cite a wireframe or flow",
      uiPlans.filter((p) => !p.design.some((d) => /^(wireframes|flows)\//.test(parseRef(d).file))).map((p) => `${p.id} touches ${p.touches.filter((t) => uiPaths.some((u) => overlaps(t, u))).join(", ")} with no wireframes/ or flows/ reference`),
      `${uiPlans.length} plan${uiPlans.length === 1 ? "" : "s"} touch UI paths (${uiPaths.join(", ")}), each cites a wireframe or flow`);
  }

  // 7. Wireframes and flows agree: every wireframe is a screen some flow step reaches, and every
  // step's screen has a wireframe. A screen no flow reaches is one nobody can say how to get to.
  const named = new Set(m.flows.flatMap((f) => f.steps.map((s) => s.screen).filter((x): x is string => !!x)));
  const have = new Set(m.wireframes);
  rule("design-screens", "design: wireframes and flows agree", [
    ...m.wireframes.filter((w) => !named.has(w)).map((w) => `wireframes/${w}.html is not the screen of any flow step`),
    ...m.flows.flatMap((f) => f.steps.filter((s) => s.screen && !have.has(s.screen)).map((s) => `flows/${f.id}#${s.id} names screen ${s.screen}, which has no wireframe`)),
  ], `${m.wireframes.length} wireframe${m.wireframes.length === 1 ? "" : "s"}, each reached by a flow step, and every step's screen exists`);

  // 8. A visual mockup is described by an ADR. When the mockup moves on and the ADR does not, the
  // ADR is describing a layout that is no longer the one on screen.
  const mockups = checks.mockups ?? [];
  if (mockups.length) {
    const problems: string[] = [];
    for (const mk of mockups) {
      const want = mk.decision.replace(/^decisions\//, "").replace(/\.md$/, "");
      const dec = m.decisions.find((d) => d.file === want || d.id === want);
      if (!dec) { problems.push(`${mk.file} names decision ${mk.decision}, which does not exist`); continue; }
      const mockAt = await lastChanged(cwd, mk.file);
      if (mockAt === null) { problems.push(`${mk.file} does not exist`); continue; }
      const decAt = await lastChanged(cwd, relative(cwd, join(m.dir, "decisions", `${dec.file}.md`)));
      if (decAt !== null && mockAt > decAt) problems.push(`${mk.file} changed after decisions/${dec.file}.md last did; update the ADR or confirm it still holds`);
    }
    rule("design-mockups", "design: mockups match their decisions", problems,
      `${mockups.length} mockup${mockups.length === 1 ? "" : "s"}, none changed since its ADR`);
  }

  return rules;
}

export interface DesignPayload extends DesignModel { generatedAt: string; alignment: AlignmentRule[] }

export async function buildDesignPayload(cwd: string, opts: LoadDesignOptions, generatedAt: string): Promise<DesignPayload> {
  const m = await loadDesign(cwd, opts);
  return { ...m, generatedAt, alignment: m.available ? await checkAlignment(cwd, m, opts.checks) : [] };
}
