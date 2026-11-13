// Doctor tiers (docs/WORKFLOW.md). PANTRY is shared publicly, but most of what doctor checks is one
// person's workflow. Every check therefore carries a tier, and the tier decides how loud it may be:
//
//   tier 1, the contract: what PANTRY cannot work without (plans/ in the schema, the MCP server
//           registered). These are the only checks that may fail the run.
//   tier 2, the loop: the suggested way to work with it (claim, heartbeat, release, a hub that is
//           running, a front door for agents). A broken tier 2 check warns with a one-line fix and a
//           link to the doc; it never fails.
//   tier 3, the owner's layer: standards mounted as skills, run reports, the audit cadence, graphify.
//           Silent unless the host opts in with "ownerLayer": true in pantry.config.json.
//
// A check id missing from the table below is treated as tier 3, so a new check stays quiet for
// strangers until someone decides it belongs in the contract or the loop.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@tjakoen/mill/core/frontmatter.ts";
import { projectFor, readRegistry } from "./hub.ts";

export type DoctorTier = 1 | 2 | 3;

export const WORKFLOW_DOC = "docs/WORKFLOW.md";

export const CHECK_TIERS: Record<string, DoctorTier> = {
  "plans-dir": 1,
  "plans-schema": 1,
  "mcp-registered": 1,
  "pantry-config": 2,
  "hub-registered": 2,
  "claude-md": 2,
  "agents-symlink": 2,
  "worktree-isolation": 2,
  "uncommitted-age": 2,
  "unpushed-age": 2,
  "no-remote": 2,
  "unacted-answers": 2,
  "session-events": 2,
  "doc-drift": 2,
  "context-budget": 2,
  "no-forked-standards": 3,
  "skills-freshness": 3,
  "hook-drift": 3,
  "run-report-evidence": 3,
  "run-report-presence": 3,
  "loop-hygiene": 3,
  "audit-freshness": 3,
  "graphify-freshness": 3,
  "doc-symbol-drift": 3,
  "deps-drift": 3,
  "e2e-presence": 3,
  "scope-radius": 3,
};

export const tierOf = (id: string): DoctorTier => CHECK_TIERS[id] ?? 3;

interface TierableCheck {
  id: string;
  severity: "error" | "warn" | "info";
  ok: boolean;
  label: string;
  detail: string;
  tier?: DoctorTier;
  silenced?: boolean;
}

/**
 * Stamp each check with its tier and apply the tier's ceiling: tier 2 failures become warns that
 * point at the doc, and tier 3 checks are silenced unless the host opted in to the owner's layer.
 * A host that opted in keeps every check at its written severity: the ceilings are for strangers.
 * Silenced checks stay in the report (the JSON payload keeps them) but never print and never fail.
 */
export function applyTiers<T extends TierableCheck>(checks: T[], ownerLayer: boolean): Array<T & { tier: DoctorTier; silenced?: boolean }> {
  return checks.map((c): T & { tier: DoctorTier; silenced?: boolean } => {
    const tier = tierOf(c.id);
    // The owner opted in to the whole workflow, so every check keeps the strictness it was written with.
    if (ownerLayer) return { ...c, tier };
    if (tier === 2 && !c.ok && c.severity === "error") {
      return { ...c, tier, severity: "warn", detail: `${c.detail} (loop, not contract: ${WORKFLOW_DOC}#tier-2-the-loop)` };
    }
    if (tier === 2 && !c.ok && c.severity === "warn") {
      return { ...c, tier, detail: `${c.detail} (${WORKFLOW_DOC}#tier-2-the-loop)` };
    }
    if (tier === 3 && !ownerLayer) return { ...c, tier, silenced: true };
    return { ...c, tier };
  });
}

// ── Tier 1: plans in the schema ─────────────────────────────────────────────

const STATUSES = new Set(["todo", "doing", "done", "blocked"]);
const OWNERS = new Set(["ai", "human"]);

/** Every plan file's problems against plans/README.md's schema, one string per problem. */
export function planSchemaProblems(plansDir: string): string[] {
  if (!existsSync(plansDir)) return [];
  const problems: string[] = [];
  for (const name of readdirSync(plansDir).toSorted()) {
    if (!name.endsWith(".md") || name.toUpperCase() === "README.MD") continue;
    const stem = basename(name, ".md");
    const { data } = parseFrontmatter(readFileSync(join(plansDir, name), "utf8"));
    if (Object.keys(data).length === 0) {
      problems.push(`${name}: no frontmatter`);
      continue;
    }
    if (data.id !== undefined && data.id !== stem) problems.push(`${name}: id ${String(data.id)} is not the filename`);
    if (!STATUSES.has(String(data.status))) problems.push(`${name}: status ${String(data.status ?? "missing")}`);
    if (!OWNERS.has(String(data.owner))) problems.push(`${name}: owner ${String(data.owner ?? "missing")}`);
    if (data.depends !== undefined && !Array.isArray(data.depends)) problems.push(`${name}: depends is not a list`);
  }
  return problems;
}

// ── Tier 1: the MCP server registered for at least one agent ────────────────

/**
 * Where a "pantry" MCP server is registered: the project's .mcp.json, Claude Code's user config
 * (~/.claude.json), or Codex's ~/.codex/config.toml. Returns the places that name it.
 */
export function mcpRegistrations(cwd: string, home = homedir()): string[] {
  const found: string[] = [];
  const jsonHas = (file: string, pick: (j: Record<string, unknown>) => unknown): boolean => {
    try {
      const j = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const servers = pick(j) as Record<string, unknown> | undefined;
      return !!servers && typeof servers === "object" && "pantry" in servers;
    } catch {
      return false;
    }
  };
  if (jsonHas(join(cwd, ".mcp.json"), (j) => j.mcpServers)) found.push(".mcp.json");
  if (
    jsonHas(join(home, ".claude.json"), (j) => {
      const projects = j.projects as Record<string, { mcpServers?: unknown }> | undefined;
      return { ...(j.mcpServers as object), ...(projects?.[cwd]?.mcpServers as object) };
    })
  ) found.push("Claude Code");
  try {
    if (/^\[mcp_servers\.pantry\]/m.test(readFileSync(join(home, ".codex", "config.toml"), "utf8"))) found.push("Codex");
  } catch {
    // no Codex config; not an error
  }
  return found;
}

export function tierOneChecks(cwd: string, plansDir: string, home = homedir()): TierableCheck[] {
  const problems = planSchemaProblems(plansDir);
  const regs = mcpRegistrations(cwd, home);
  return [
    {
      id: "plans-schema",
      severity: "error",
      ok: problems.length === 0,
      label: "plans in the schema",
      detail: problems.length === 0
        ? "every plan carries id, status and owner (plans/README.md)"
        : `${problems.length} problem(s): ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? ", and more" : ""}`,
    },
    {
      id: "mcp-registered",
      severity: "error",
      ok: regs.length > 0,
      label: "MCP server registered",
      detail: regs.length > 0
        ? `pantry registered in ${regs.join(", ")}`
        : `no agent knows the pantry MCP server; run: claude mcp add --transport http -s user pantry http://127.0.0.1:4400/mcp (${WORKFLOW_DOC}#tier-1-the-contract)`,
    },
  ];
}

export function hubCheck(cwd: string, registryFile?: string): TierableCheck {
  let registered = false;
  try {
    registered = projectFor(readRegistry(registryFile), cwd) !== null;
  } catch {
    registered = false;
  }
  return {
    id: "hub-registered",
    severity: "warn",
    ok: registered,
    label: "registered with the hub",
    detail: registered ? "the hub serves this project" : "the hub does not know this project; run: pantry register",
  };
}
