// tools/check-help.mjs — the guide's slugs are a contract. Fails when:
//   * a <HelpLink section="x"> or <PageHeader help="x"> points at no heading
//     (someone renamed a heading in USER_GUIDE.md);
//   * a /help/#x link inside the guide points at no heading;
//   * app/help/guideContent.js is stale (USER_GUIDE.md edited, build-help not run);
//   * the converter mangles a known sample.
//
//   node tools/check-help.mjs
import fs from "node:fs";
import path from "node:path";
import { convert } from "./build-help.mjs";

let fails = 0;
const check = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

const sections = convert(fs.readFileSync("USER_GUIDE.md", "utf8"));
const slugs = new Set(sections.map((s) => s.slug));

const { GUIDE_SECTIONS } = await import("../app/help/guideContent.js");
check(JSON.stringify(GUIDE_SECTIONS) === JSON.stringify(sections),
  "app/help/guideContent.js matches USER_GUIDE.md (run node tools/build-help.mjs)");

const files = fs.readdirSync("app", { recursive: true }).filter((f) => /\.jsx?$/.test(f) && !f.includes("guideContent"));
const used = new Map(); // slug -> first file using it
for (const f of files) {
  for (const m of fs.readFileSync(path.join("app", f), "utf8").matchAll(/\b(?:help|section)="([a-z0-9-]+)"/g)) {
    if (!used.has(m[1])) used.set(m[1], f);
  }
}
check(used.size > 0, `found ${used.size} help links in app/`);
for (const [slug, f] of used) check(slugs.has(slug), `app/${f}: help link "${slug}" resolves`);

for (const s of sections) {
  for (const m of s.html.matchAll(/href="\/help\/#([^"]+)"/g)) check(slugs.has(m[1]), `guide "${s.title}": link #${m[1]} resolves`);
  // Markup the converter does not understand shows up literally (e.g. *italic*).
  const leftover = s.html.replace(/<code>.*?<\/code>/g, "").match(/\*|(^|\s)_\S/);
  if (leftover) check(false, `guide "${s.title}": unconverted markup near "${leftover[0]}"`);
}

// Converter self-check on the constructs the guide uses.
const [t] = convert("## Warranty & Refresh\n\nUse **bold**, _it_, `a<b>` and [x](/help/#y).\n\n- one\n  wrapped\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> note");
check(t.slug === "warranty-and-refresh", "slug: & becomes and");
check(t.html === '<p>Use <strong>bold</strong>, <em>it</em>, <code>a&lt;b&gt;</code> and <a href="/help/#y">x</a>.</p>' +
  "<ul><li>one wrapped</li><li>two</li></ul><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>" +
  "<blockquote>note</blockquote>", "converter output for a sample");

if (fails) { console.error(`${fails} check(s) failed`); process.exit(1); }
console.log("help: every link resolves, generated content is current");
