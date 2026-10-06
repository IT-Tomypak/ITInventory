// tools/check-xlsx.mjs — builds a workbook with lib/xlsx.js and reads the zip
// back: every entry's CRC must match (Excel calls a bad CRC "corrupt" and
// offers to repair), escaping and numbers must survive.
// Guards against: a hand-rolled OOXML/zip writer that only looks right.
//
//   node tools/check-xlsx.mjs
import zlib from "node:zlib";
import { buildXlsx } from "../lib/xlsx.js";

let fails = 0;
const check = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

const buf = Buffer.from(await buildXlsx([
  { name: "Warranty expired / long name that overflows thirty-one", rows: [{ Tag: "IT-1 <&>\u0001", Cost: 12.5 }, { Tag: "ünï" }] },
  { name: "Empty", rows: [] },
]).arrayBuffer());

const files = {};
const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
let p = buf.readUInt32LE(eocd + 16);
for (let n = buf.readUInt16LE(eocd + 10); n--;) {
  const crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
  const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
  const start = off + 30 + buf.readUInt16LE(off + 26);
  const data = buf.subarray(start, start + size);
  check(zlib.crc32(data) === crc, `CRC ${name}`);
  files[name] = data.toString("utf8");
  p += 46 + nameLen;
}
check(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"].every((f) => f in files), "all parts present");
const s1 = files["xl/worksheets/sheet1.xml"];
check(s1.includes("IT-1 &lt;&amp;&gt;<") && !s1.includes("\u0001"), "escaped, control chars stripped");
check(s1.includes("<v>12.5</v>"), "number stays a number");
check(s1.includes("ünï"), "UTF-8 text intact");
check(/<sheet name="Warranty expired   long name th"/.test(files["xl/workbook.xml"]), "sheet name cleaned and cut to 31");
process.exit(fails ? 1 : 0);
