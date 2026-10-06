// tools/make-zip.mjs — packs out/ into itrack-vX.Y.Z-deploy.zip for upload to
// public_html (npm run package).
//
// WHY this exists instead of Compress-Archive: the host extracts with Unix
// unzip, and an entry without Unix permission bits extracts unreadable, so the
// whole site answers HTTP 403. Every entry here is written with
// version-made-by = Unix (3) and externalAttributes = mode << 16: files 0644,
// directories 0755. tools/check-zip-perms.mjs verifies the result.
//
// Refuses to overwrite an existing zip: old zips ARE the rollback (extract the
// previous one over public_html), so a release must bump app/version.js.
//
//   npm run build && npm run package            # FORCE=1 to overwrite
//   node tools/make-zip.mjs some/other/name.zip
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const version = /APP_VERSION\s*=\s*"([^"]+)"/.exec(fs.readFileSync("app/version.js", "utf8"))[1];
const OUT = process.argv[2] || `itrack-v${version}-deploy.zip`;
const die = (msg) => { console.error(`make-zip: ${msg}`); process.exit(1); };

if (!fs.existsSync("out/index.html")) die("out/ has no index.html. Run npm run build first.");
if (!fs.existsSync("out/.htaccess")) die("out/.htaccess is missing (public/.htaccess was not copied).");
if (fs.existsSync(OUT) && !process.env.FORCE) {
  die(`${OUT} already exists. Old zips are the rollback: bump APP_VERSION in app/version.js (or FORCE=1).`);
}

// Directories before their contents, in a stable order.
const entries = [];
(function walk(dir, rel) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const r = rel + name;
    if (fs.statSync(full).isDirectory()) { entries.push({ name: r + "/", dir: true }); walk(full, r + "/"); }
    else entries.push({ name: r, data: fs.readFileSync(full) });
  }
})("out", "");

const now = new Date();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
const UNIX = 3, NEEDED = 20, UTF8 = 0x0800;

const chunks = [], central = [];
let offset = 0;
for (const e of entries) {
  const name = Buffer.from(e.name, "utf8");
  const raw = e.data ?? Buffer.alloc(0);
  const deflated = e.dir ? raw : zlib.deflateRawSync(raw, { level: 9 });
  const stored = e.dir || deflated.length >= raw.length; // store what deflate cannot shrink
  const body = stored ? raw : deflated;
  const crc = zlib.crc32(raw);
  const mode = e.dir ? 0o040755 : 0o100644; // type bits + permissions

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(NEEDED, 4);
  local.writeUInt16LE(UTF8, 6);
  local.writeUInt16LE(stored ? 0 : 8, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  chunks.push(local, name, body);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE((UNIX << 8) | NEEDED, 4); // version made by: Unix
  cd.writeUInt16LE(NEEDED, 6);
  cd.writeUInt16LE(UTF8, 8);
  cd.writeUInt16LE(stored ? 0 : 8, 10);
  cd.writeUInt16LE(dosTime, 12);
  cd.writeUInt16LE(dosDate, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(body.length, 20);
  cd.writeUInt32LE(raw.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt32LE((mode << 16) >>> 0, 38); // external attributes: mode << 16
  cd.writeUInt32LE(offset, 42);
  central.push(cd, name);

  offset += local.length + name.length + body.length;
}

const cdBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(cdBuf.length, 12);
end.writeUInt32LE(offset, 16);

fs.writeFileSync(OUT, Buffer.concat([...chunks, cdBuf, end]));
console.log(`make-zip: ${OUT} (${entries.length} entries, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
console.log(`next: node tools/check-zip-perms.mjs ${OUT}`);
