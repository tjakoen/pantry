// hub.ts: one long-running PANTRY per machine, serving every registered project at once.
//
// `pantry serve` reads the project it was started in, so two projects used to mean two terminals
// and two ports nobody wrote down. The hub keeps a registry of projects, starts one `pantry serve`
// child per project on that project's own port, restarts a child that dies, and answers health
// questions on the hub port. The children are separate processes on purpose: the server module was
// written for one project per process, and a child crashing must not take the others with it.
//
// Ports, not path prefixes. Every PANTRY page links with absolute paths ("/plans", "/docs"), so a
// "/p/<name>/" prefix behind a proxy would break every link on every page. A port per project keeps
// each project's PANTRY exactly as it is when run by hand.
//
// The registry is a plain JSON file, `~/.pantry/projects.json` by default (PANTRY_HOME overrides).
// Paths in it are absolute host paths. The Docker setup mounts the code at the SAME absolute path
// inside the container, so one registry works on the host and in the container alike.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { PANTRY_PREFIX } from "./preview.ts";

export interface HubProject { name: string; path: string; port: number }
export interface Registry { hubPort: number; projects: HubProject[] }

export const DEFAULT_HUB_PORT = 4400;

export function registryPath(env: Record<string, string | undefined> = process.env): string {
  return join(env.PANTRY_HOME ?? join(homedir(), ".pantry"), "projects.json");
}

export function readRegistry(file = registryPath()): Registry {
  if (!existsSync(file)) return { hubPort: DEFAULT_HUB_PORT, projects: [] };
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Registry>;
  return { hubPort: raw.hubPort ?? DEFAULT_HUB_PORT, projects: raw.projects ?? [] };
}

export function writeRegistry(reg: Registry, file = registryPath()): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(reg, null, 2) + "\n");
}

/** Add a project, or return the existing entry when its path is already registered. The port is
 *  the lowest free one above the hub port, so the published Docker range stays contiguous. */
export function registerProject(reg: Registry, path: string, name?: string): { reg: Registry; project: HubProject; added: boolean } {
  const abs = resolve(path);
  const existing = reg.projects.find((p) => p.path === abs);
  if (existing) return { reg, project: existing, added: false };
  const taken = new Set([reg.hubPort, ...reg.projects.map((p) => p.port)]);
  let port = reg.hubPort + 1;
  while (taken.has(port)) port++;
  let base = name ?? basename(abs);
  const names = new Set(reg.projects.map((p) => p.name));
  let unique = base, n = 2;
  while (names.has(unique)) unique = `${base}-${n++}`;
  const project = { name: unique, path: abs, port };
  return { reg: { ...reg, projects: [...reg.projects, project] }, project, added: true };
}

export function unregisterProject(reg: Registry, nameOrPath: string): Registry {
  const abs = resolve(nameOrPath);
  return { ...reg, projects: reg.projects.filter((p) => p.name !== nameOrPath && p.path !== abs) };
}

/** Which registered project contains this directory. The longest matching path wins, so a project
 *  nested inside another (a class repo inside the course platform) resolves to itself. */
export function projectFor(reg: Registry, dir: string): HubProject | null {
  const abs = resolve(dir);
  let best: HubProject | null = null;
  for (const p of reg.projects) {
    if ((abs === p.path || abs.startsWith(p.path + "/")) && (!best || p.path.length > best.path.length)) best = p;
  }
  return best;
}

// Probe a static PANTRY asset. Not "/": a project with a preview target hands "/" to its own app,
// which answers 502 whenever that app is down. Not "/plans" either: rendering the board runs one
// `git log` per plan file, and seventeen projects probed at once pinned the container's CPU and
// stopped every project from answering. The stylesheet costs nothing and proves the server is up.
// Results are cached briefly so a page refresh or a burst of session starts cannot become a storm.
// The probe also learns WHERE PANTRY answers: at the root, or under the reserved prefix when the
// project proxies its own app at "/". That base is what an agent opens in its browser pane.
type Probe = { up: boolean; base: string };
const upCache = new Map<number, { at: number } & Probe>();
async function probeCached(port: number): Promise<Probe> {
  const hit = upCache.get(port);
  if (hit && Date.now() - hit.at < 15_000) return hit;
  const result = await probe(port);
  upCache.set(port, { at: Date.now(), ...result });
  return result;
}
async function probe(port: number): Promise<Probe> {
  for (const base of ["", PANTRY_PREFIX]) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${base}/components.css`, { signal: AbortSignal.timeout(6000) });
      if (res.status < 400) return { up: true, base };
    } catch { /* not listening yet */ }
  }
  return { up: false, base: "" };
}

/** Run the hub: one child per project, restarted with a backoff, plus the health endpoints. */
export async function runHub(opts: { file?: string; cli?: string } = {}) {
  const file = opts.file ?? registryPath();
  const cli = opts.cli ?? join(import.meta.dir, "cli.ts");
  const children = new Map<string, { proc: ReturnType<typeof Bun.spawn>; restarts: number; note: string }>();

  const start = (p: HubProject) => {
    if (!existsSync(join(p.path, "pantry.config.json"))) {
      children.set(p.name, { proc: null as never, restarts: 0, note: "no pantry.config.json at this path" });
      return;
    }
    const proc = Bun.spawn(["bun", cli, "serve", "--port", String(p.port)], {
      cwd: p.path, stdout: "inherit", stderr: "inherit",
    });
    const prev = children.get(p.name);
    children.set(p.name, { proc, restarts: prev?.restarts ?? 0, note: "" });
    proc.exited.then((code) => {
      const entry = children.get(p.name);
      if (!entry || entry.proc !== proc) return undefined;
      entry.restarts++;
      entry.note = `exited with ${code}; restart ${entry.restarts}`;
      setTimeout(() => start(p), Math.min(30_000, 1000 * 2 ** Math.min(entry.restarts, 5)));
      return undefined;
    });
  };

  // Re-read the registry every few seconds so `pantry register` takes effect without a restart.
  let reg = readRegistry(file);
  const sync = () => {
    reg = readRegistry(file);
    const wanted = new Set(reg.projects.map((p) => p.name));
    for (const [name, c] of children) if (!wanted.has(name)) { c.proc?.kill(); children.delete(name); }
    for (const p of reg.projects) if (!children.has(p.name)) start(p);
  };
  sync();
  setInterval(sync, 5000);

  const status = async (p: HubProject) => {
    const { up, base } = await probeCached(p.port);
    return { ...p, up, url: `http://localhost:${p.port}${base}/`, note: children.get(p.name)?.note || undefined };
  };

  const server = Bun.serve({
    port: reg.hubPort,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/mcp") {
        const { handleMcpRequest } = await import("./mcp.ts");
        return handleMcpRequest(req, reg, { status, cli });
      }
      if (url.pathname === "/health") {
        const dir = url.searchParams.get("path");
        if (dir) {
          const p = projectFor(reg, dir);
          if (!p) return Response.json({ registered: false, path: dir }, { status: 404 });
          return Response.json({ registered: true, ...(await status(p)) });
        }
        return Response.json({ ok: true, projects: await Promise.all(reg.projects.map(status)) });
      }
      if (url.pathname === "/" ) {
        const rows = await Promise.all(reg.projects.map(status));
        const list = rows.map((r) => `<li>${r.up ? "up" : "down"}: <a href="${r.url}">${r.name}</a> <code>${r.path}</code>${r.note ? ` (${r.note})` : ""}</li>`).join("");
        return new Response(`<!doctype html><title>PANTRY hub</title><h1>PANTRY hub</h1><ul>${list || "<li>No projects registered. Run <code>pantry register</code> in a project.</li>"}</ul>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  console.log(`PANTRY hub on ${server.url} serving ${reg.projects.length} project(s) from ${file}`);
  return server;
}
