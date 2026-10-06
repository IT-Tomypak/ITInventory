// tools/check-zip-perms.mjs — the deploy zip, checked before it is uploaded.
// Guards against: an archive whose entries carry no Unix permissions. The
// host's unzip then extracts files unreadable and the site answers HTTP 403
// (Compress-Archive produces exactly that). Also fails on a corrupt entry
// (every file is inflated and its CRC compared) and on a missing must-ship file.
//
//   node tools/check-zip-perms.mjs itrack-v1.0.0-deploy.zip
import fs from "node:fs";
import zlib from "node:zlib";

const file = process.argv[2];
if (!file) { console.error("usage: node tools/check-zip-perms.mjs <file>.zip"); process.exit(2); }
const buf = fs.readFileSync(file);
let fails = 0;
const fail = (msg) => { console.log("FAIL " + msg); fails++; };

const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
if (eocd < 0) { console.error("not a zip file"); process.exit(1); }
const count = buf.readUInt16LE(eocd + 10);
let p = buf.readUInt32LE(eocd + 16);

const names = new Set();
for (let i = 0; i < count; i++) {
  if (buf.readUInt32LE(p) !== 0x02014b50) { fail(`central directory broken at entry ${i}`); break; }
  const host = buf.readUInt16LE(p + 4) >> 8;
  const method = buf.readUInt16LE(p + 10);
  const crc = buf.readUInt32LE(p + 16);
  const csize = buf.readUInt32LE(p + 20);
  const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
  const mode = buf.readUInt32LE(p + 38) >>> 16;
  const localAt = buf.readUInt32LE(p + 42);
  const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
  p += 46 + nameLen + extraLen + commentLen;
  names.add(name);

  const dir = name.endsWith("/");
  const want = dir ? 0o040755 : 0o100644;
  if (host !== 3) fail(`${name}: made by host ${host}, not Unix (3), so permissions are ignored`);
  else if (mode !== want) fail(`${name}: mode ${mode.toString(8)}, want ${want.toString(8)}`);
  if (dir) continue;

  const at = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
  const body = buf.subarray(at, at + csize);
  try {
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    if (zlib.crc32(data) !== crc) fail(`${name}: CRC mismatch`);
  } catch (e) {
    fail(`${name}: cannot inflate (${e.message})`);
  }
}

for (const must of ["index.html", "404.html", ".htaccess", "sw.js", "manifest.json", "icon.svg", "help/index.html"]) {
  if (!names.has(must)) fail(`missing ${must}`);
}
if ([...names].some((n) => /\.(env|map)$|\.env\.|(^|\/)\.git\//.test(n))) fail("contains a .env, source map or .git file");

if (fails) { console.error(`${fails} problem(s) in ${file}`); process.exit(1); }
console.log(`PASS ${file}: ${count} entries, all Unix 0644/0755, all CRCs good, must-ship files present`);
