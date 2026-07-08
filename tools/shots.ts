// pantry/tools/shots.ts — capture the cockpit surfaces to pantry/screenshots/. Dev-only.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { servePantry } from "../app.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "screenshots");
const PORT = 4466;
const server = servePantry({ plansDir: join(HERE, "..", "..", "proof", "example"), port: PORT });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const shots: Array<[string, string, "light" | "dark"]> = [
  ["/", "home-light", "light"],
  ["/", "home-dark", "dark"],
  ["/docs", "docs-light", "light"],
  ["/docs/grain/grain", "doc-page-light", "light"],
];
for (const [path, name, scheme] of shots) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, colorScheme: scheme });
  await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  await page.close();
  console.log(`shot: ${name}.png`);
}
await browser.close();
server.stop();
