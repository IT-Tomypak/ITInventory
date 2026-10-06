// tools/check-pages-load.mjs — signs in as an ADMINISTRATOR, visits every
// built route, and fails on any visible "Error loading data" and on the
// register showing zero assets.
// Guards against: a build that succeeds while a page cannot load its data.
// Adding a second foreign-key path to the same table makes a PostgREST embed
// ambiguous and silently blanks whole pages — this is the script that sees it.
//
//   node tools/serve-out.mjs &
//   ADMIN_ID=... ADMIN_PASSWORD=... node tools/check-pages-load.mjs
//   ALLOW_EMPTY=1 skips the zero-assets assertion (phase 2, empty tables).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:4321";
const { ADMIN_ID, ADMIN_PASSWORD, ALLOW_EMPTY } = process.env;
if (!ADMIN_ID || !ADMIN_PASSWORD) { console.error("Set ADMIN_ID and ADMIN_PASSWORD"); process.exit(2); }

// Every directory in out/ holding an index.html is a route; public ones need no login but are visited too.
const routes = ["/"];
(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith("_")) continue;
    const r = `${rel}${e.name}/`;
    if (fs.existsSync(path.join(dir, e.name, "index.html"))) routes.push(r);
    walk(path.join(dir, e.name), r);
  }
})("out", "/");

fs.mkdirSync("tools/shots", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const failures = [];

await page.goto(BASE + "/");
await page.getByRole("button", { name: /IT Department/ }).click();
await page.getByLabel("ID number").fill(ADMIN_ID);
await page.getByLabel("Password").fill(ADMIN_PASSWORD);
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("navigation", { name: "Main" }).first().waitFor({ timeout: 15000 });

for (const r of routes) {
  await page.goto(BASE + r);
  await page.waitForLoadState("networkidle");
  const name = r === "/" ? "root" : r.replace(/\//g, "_");
  await page.screenshot({ path: `tools/shots/pages-load${name}.png`, fullPage: true });
  if (await page.getByText(/Error loading data/i).count()) failures.push(`${r}: shows "Error loading data"`);
  if (await page.getByText("Not found", { exact: true }).count()) failures.push(`${r}: breadcrumb says Not found`);
  if (r === "/" && !ALLOW_EMPTY) {
    const total = Number(await page.getByTestId("asset-total").textContent().catch(() => "0"));
    if (!total) failures.push("/: register shows zero assets");
  }
  console.log((failures.some((f) => f.startsWith(r + ":")) ? "FAIL " : "ok   ") + r);
}

await browser.close();
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`all ${routes.length} routes loaded`);
