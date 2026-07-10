// pantry/retrieval.ts — piece 9: the AI-retrieval brain (model-free, pure reads). PANTRY runs no
// model (PLAN §AI-legible, not AI-powered); its job is to make the host project RETRIEVABLE by the
// dev's own agent. This module assembles one machine-readable projection of everything the cockpit
// mounts — the host's plans (PROOF's derived index), the docs collections MILL renders, and grain's
// AI vocabulary — into `knowledge.json` (the machine payload) and `llms.txt` (the session context
// pack: "what an agent should read first here", in the llmstxt.org convention). Both are DERIVED
// deterministically from the same sources the human surfaces render, so the two projections can
// never drift. Nothing is generated; nothing is copied — these are read-time views over the SSOT.
import { loadPlans } from "@tjakoen/proof/loader.ts";
import { buildIndex } from "@tjakoen/proof/core/index.ts";
import type { PlanIndex } from "@tjakoen/proof/core/types.ts";
import { RENDER_OP_KINDS, ENDPOINTS } from "@tjakoen/grain/ai/vocab-reference.ts";
import type { MillCollection } from "@tjakoen/mill/serve.ts";
import type { ResolvedPantryConfig } from "./config.ts";

// The plan-id / doc-slug shape MILL + PROOF route on (mill/serve.ts SLUG, proof/routes.ts SLUG).
// A source can list a file whose stem doesn't conform; such a slug would 404 from its own route, so
// it must not reach a machine list that promises a fetchable URL. Same guard both routers apply.
const SLUG = /^[a-z0-9][a-z0-9._-]*$/;

export interface KnowledgePage {
  slug: string;
  /** the root-relative route the page renders at (the human view) */
  route: string;
  /** the raw `.md` twin MILL also serves — the honest source (bytes, not HTML) */
  source: string;
}
export interface KnowledgeCollection {
  prefix: string;
  title: string;
  description: string;
  pages: KnowledgePage[];
}
/** A mounted surface that isn't a doc collection (the board, reference, catalog, standards). */
export interface KnowledgeSurface {
  route: string;
  title: string;
  description: string;
}
export interface Knowledge {
  project: string;
  generatedAt: string;   // ISO; injected by the caller so the payload is deterministic in tests
  /** the load-bearing invariant, stated for the machine: PANTRY is AI-legible, not AI-powered. */
  runsModel: false;
  surfaces: KnowledgeSurface[];
  docs: KnowledgeCollection[];
  /** the host project's plans as PROOF's derived index (null when the board surface is off) */
  plans: PlanIndex | null;
  /** the machine index of the plan index + the doc raw-source twins (where to fetch the brain) */
  vocabulary: {
    renderOps: typeof RENDER_OP_KINDS;
    endpoints: typeof ENDPOINTS;
  };
}

// One doc collection → its pages, only the SLUG-safe ones (mirrors mill's listMillRoutes so a
// nonconforming filename never lands a machine URL that would 404).
async function collectionPages(c: MillCollection): Promise<KnowledgePage[]> {
  const slugs = (await c.source.list()).filter((s) => SLUG.test(s)).sort();
  return slugs.map((slug) => ({ slug, route: `${c.prefix}/${slug}`, source: `${c.prefix}/${slug}.md` }));
}

// The non-doc surfaces this install mounts, gated by the resolved config (same gates app.ts applies
// to the routes + nav). The board is the front door; the rest are the demoted-but-mounted surfaces.
function surfacesOf(config: ResolvedPantryConfig): KnowledgeSurface[] {
  const { surfaces } = config;
  return [
    surfaces.plans && { route: "/plans", title: "Plan board", description: "The host project's plans and their state (PROOF). Machine index at /plans/plans.json." },
    surfaces.reference && { route: "/reference", title: "Reference", description: "The generated GRAIN/AI vocabulary + token slots, read from the real registries." },
    surfaces.catalog && { route: "/catalog", title: "Catalog", description: "The GRAIN component catalog." },
    surfaces.standards && { route: "/standards", title: "Standards", description: "The cross-repo writing + presentation standards, rendered through MILL." },
  ].filter(Boolean) as KnowledgeSurface[];
}

/**
 * Assemble the whole-project brain. Deterministic (git-age is skipped — the index needs none, and
 * spawning `git log` per plan on every request would be slow and non-reproducible), pure reads.
 * `docCollections` is exactly what app.ts mounts through MILL (framework + host docs).
 */
export async function buildKnowledge(
  config: ResolvedPantryConfig,
  docCollections: MillCollection[],
  generatedAt: string,
): Promise<Knowledge> {
  const docs: KnowledgeCollection[] = [];
  for (const c of docCollections)
    docs.push({ prefix: c.prefix, title: c.title, description: c.description ?? "", pages: await collectionPages(c) });

  let plans: PlanIndex | null = null;
  if (config.surfaces.plans) {
    const { plans: loaded } = await loadPlans(config.plansDir, async () => null);
    plans = buildIndex(loaded.map((lp) => lp.plan), generatedAt);
  }

  return {
    project: config.projectName,
    generatedAt,
    runsModel: false,
    surfaces: surfacesOf(config),
    docs,
    plans,
    vocabulary: { renderOps: RENDER_OP_KINDS, endpoints: ENDPOINTS },
  };
}

// A markdown link line for the llms.txt body. Text is plain (the convention is plain text with
// markdown links); no escaping games — titles here are project/collection/plan names.
const link = (text: string, url: string, note?: string) => `- [${text}](${url})${note ? `: ${note}` : ""}`;

/**
 * The session context pack, rendered in the llmstxt.org convention: an H1 project name, a blockquote
 * summary, then link sections an agent reads first. Built from the SAME Knowledge the JSON exports,
 * so the human-first index and the machine payload are one brain, two projections.
 */
export function renderLlmsTxt(k: Knowledge): string {
  const out: string[] = [];
  out.push(`# ${k.project}`);
  out.push("");
  out.push(`> The ${k.project} project, served by PANTRY — its plan board, docs, and reference as one retrievable surface. PANTRY runs no model of its own; this file is what an agent should read first here.`);

  const board = k.surfaces.find((s) => s.route === "/plans");
  if (board && k.plans) {
    out.push("", "## Plans");
    out.push(link("Plan board", "/plans", "the board; machine index at /plans/plans.json"));
    for (const p of k.plans.plans)
      out.push(link(`${p.id} — ${p.title}`, `/plans/plan/${p.id}`, `${p.status}, ${p.tasksDone}/${p.tasksTotal} tasks`));
  }

  if (k.docs.length) {
    out.push("", "## Docs");
    for (const c of k.docs) {
      out.push(link(c.title, c.prefix, c.description || undefined));
      for (const pg of c.pages) out.push(`  ${link(`${c.title} / ${pg.slug}`, pg.route)}`);
    }
  }

  const rest = k.surfaces.filter((s) => s.route !== "/plans");
  if (rest.length) {
    out.push("", "## Reference");
    for (const s of rest) out.push(link(s.title, s.route, s.description));
  }

  out.push("");
  return out.join("\n");
}
