// pantry/usage-page.ts — the human view of usage.ts, beside its machine twin /usage.json.
import { escapeHtml } from "@tjakoen/mill/core/engine.ts";
import type { UsagePayload, UsageRow } from "./usage.ts";

// The usage page. Tables rather than cards, because the reader compares rows. The bar shows each row's
// share of fresh tokens (input + output + cache write); cache reads get their own column and stay out
// of the bar, since they would otherwise make every long session look like the biggest spender.
export function usageBody(p: UsagePayload): string {
  const n = (v: number) => v.toLocaleString("en-US");
  const fresh = (r: { input: number; output: number; cacheWrite: number }) => r.input + r.output + r.cacheWrite;
  const header = `<header>
  <h1 class="proof-masthead">Usage</h1>
  <p class="proof-lede">Where the tokens went in ${escapeHtml(p.project)}: per model, per claimed plan, and per area of the project. Read from the harness transcripts, so it covers Claude Code sessions and their subagents. Machine twin at <a href="/usage.json">/usage.json</a>.</p>
</header>`;
  if (!p.turns) {
    return `${header}
<div class="card pantry-map-empty" data-pad="md">
  <h2 class="card__title">No usage recorded yet</h2>
  <p class="pantry-member__role">No transcript with token counts was found here${p.skipped ? `, and ${p.skipped} line${p.skipped === 1 ? " was" : "s were"} unreadable, which usually means the transcript format changed` : ""}:</p>
  <pre class="pantry-map-cmd"><code>${escapeHtml(p.source)}</code></pre>
</div>`;
  }
  const total = fresh(p.totals) || 1;
  const table = (title: string, note: string, rows: UsageRow[]) => `<section class="pantry-usage">
  <h2>${escapeHtml(title)}</h2>
  ${note ? `<p class="pantry-member__role">${note}</p>` : ""}
  <div class="pantry-usage__scroll"><table class="pantry-usage__table">
    <thead><tr><th scope="col">${escapeHtml(title.replace(/^By (.)/, (_m, c: string) => c.toUpperCase()))}</th><th scope="col">Share</th><th scope="col">Turns</th><th scope="col">Input</th><th scope="col">Output</th><th scope="col">Cache write</th><th scope="col">Cache read</th></tr></thead>
    <tbody>${rows.map((r) => {
      const pct = (fresh(r) / total) * 100;
      return `<tr><th scope="row">${escapeHtml(r.key)}</th><td><span class="pantry-usage__bar" style="--share:${pct.toFixed(1)}%"></span><span class="pantry-usage__pct">${pct < 1 && pct > 0 ? "&lt;1" : Math.round(pct)}%</span></td><td>${n(r.turns)}</td><td>${n(r.input)}</td><td>${n(r.output)}</td><td>${n(r.cacheWrite)}</td><td>${n(r.cacheRead)}</td></tr>`;
    }).join("")}</tbody>
  </table></div>
</section>`;
  const stats = [
    ["Sessions", n(p.sessions)],
    ["Turns", n(p.turns)],
    ["Output", n(p.totals.output)],
    ["Cache write", n(p.totals.cacheWrite)],
    ["Cache read", n(p.totals.cacheRead)],
  ].map(([k, v]) => `<div class="pantry-usage__stat"><span>${k}</span><strong>${v}</strong></div>`).join("");
  return `${header}
<div class="pantry-usage__stats">${stats}</div>
${p.skipped ? `<p class="pantry-run-summary" data-tone="due">${p.skipped} transcript line${p.skipped === 1 ? " was" : "s were"} unreadable and left out.</p>` : ""}
${table("By model", "", p.byModel)}
${table("By plan", "A turn counts toward a plan while its session holds the claim. Work asked for directly in chat is unclaimed.", p.byPlan)}
${table("By area", "A heuristic: the top-level folder of the files each turn named. A turn that read through the shell names none.", p.byArea)}`;
}
