// tools/check-nopng.mjs — the app must not depend on a .png request.
// Guards against: shared hosts' hotlink protection, which commonly answers
// image requests with 403. A logo, favicon or guide screenshot shipped as a
// .png then vanishes in production while looking fine locally. So the logo
// and favicon are inline SVG, the app icon is icon.svg, and this script
// SIMULATES the block: every .png request gets 403, and any request made at
// all is a failure.
//
// Visits every built route signed out (the landing and public pages), and
// signed in as well when ADMIN_ID / ADMIN_PASSWORD are set.
//
//   node tools/serve-out.mjs &
//   [ADMIN_ID=... ADMIN_PASSWORD=...] node tools/check-nopng.mjs
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:4321";
const { ADMIN_ID, ADMIN_PASSWORD } = process.env;

const routes = ["/"];
(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith("_")) continue;
    const r = `${rel}${e.name}/`;
    if (fs.existsSync(path.join(dir, e.name, "index.html"))) routes.push(r);
    walk(path.join(dir, e.name), r);
  }
})("out", "/");

const pngs = new Set();
const browser = await chromium.launch();
const page = await browser.newPage();
// Same origin only: hotlink protection is the WEB HOST's rule. Request photos
// come from Supabase Storage, which the host's rule never sees.
const origin = new URL(BASE).origin;
await page.route((u) => u.origin === origin && /\.png$/i.test(u.pathname),
  (r) => { pngs.add(r.request().url()); r.fulfill({ status: 403, body: "hotlink blocked" }); });

async function visitAll(label) {
  for (const r of routes) {
    await page.goto(BASE + r);
    await page.waitForLoadState("networkidle");
  }
  console.log(`visited ${routes.length} routes ${label}`);
}

await visitAll("signed out");
// The manifest is read by the browser on install, not on page load: check its icons directly.
const manifest = await (await page.request.get(BASE + "/manifest.json")).json();
for (const i of manifest.icons) if (/\.png/i.test(i.src)) pngs.add(`manifest icon ${i.src}`);

if (ADMIN_ID && ADMIN_PASSWORD) {
  await page.goto(BASE + "/");
  await page.getByRole("button", { name: /IT Department/ }).click();
  await page.getByLabel("ID number").fill(ADMIN_ID);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("navigation", { name: "Main" }).first().waitFor({ timeout: 15000 });
  await visitAll("signed in");
} else {
  console.log("ADMIN_ID / ADMIN_PASSWORD not set: signed-in pages not visited");
}
await browser.close();

if (pngs.size) {
  console.error(`FAIL ${pngs.size} .png request(s), each would be blocked by hotlink protection:\n  ${[...pngs].join("\n  ")}`);
  process.exit(1);
}
console.log("PASS no .png requests");
