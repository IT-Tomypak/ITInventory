// Zero-dependency XLSX reader, the counterpart of lib/xlsx.js: returns the
// FIRST worksheet as rows of cells, where table[n - 1] is Excel row n.
// The zip is walked by hand; deflated entries go through the platform's own
// DecompressionStream (every current browser, and Node 18+ for the checks).
// Dates come back as Excel serial numbers: the caller knows which columns are
// dates (lib/hardwareImport.js parseDate), so styles.xml is never read.

const text = new TextDecoder();

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22;
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("This file is not an Excel workbook (.xlsx).");
  const files = {};
  for (let i = 0, p = v.getUint32(eocd + 16, true), n = v.getUint16(eocd + 10, true); i < n; i++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), skip = v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = buf.subarray(start, start + size);
    files[text.decode(buf.subarray(p + 46, p + 46 + nameLen))] = method === 0 ? raw : method === 8 ? inflate(raw) : null;
    p += 46 + nameLen + skip;
  }
  return files;
}

const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1))
    : { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[e.toLowerCase()]);
// Every <t> run inside a shared string or inline string, joined (rich text has several).
const runs = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1])).join("");
const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const colIndex = (ref) => [...ref.replace(/\d+$/, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

export async function readXlsx(file) {
  const files = await unzip(new Uint8Array(await file.arrayBuffer()));
  const read = async (name) => (files[name] ? text.decode(await files[name]) : "");

  // The first <sheet> in the workbook, resolved through its relationship.
  const rid = attr(/<sheet\b[^>]*>/.exec(await read("xl/workbook.xml"))?.[0] ?? "", "r:id");
  const rel = [...(await read("xl/_rels/workbook.xml.rels")).matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => m[0]).find((t) => attr(t, "Id") === rid);
  const target = (attr(rel ?? "", "Target") ?? "worksheets/sheet1.xml").replace(/^\//, "");
  const sheet = await read(target.startsWith("xl/") ? target : "xl/" + target);
  if (!sheet) throw new Error("The workbook has no readable worksheet.");

  const shared = [...(await read("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1]));
  const table = [];
  for (const row of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells = [];
    for (const c of (row[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const type = attr(c[1], "t"), body = c[2] ?? "", v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const ref = attr(c[1], "r"); // optional in the spec: then it is the next cell
      cells[ref ? colIndex(ref) : cells.length] = type === "s" ? shared[+v] ?? ""
        : type === "inlineStr" ? runs(body)
        : type === "str" || type === "e" ? unescape(v ?? "")
        : type === "b" ? v === "1"
        : v == null ? "" : Number(v);
    }
    const n = attr(row[1], "r");
    table[n ? +n - 1 : table.length] = Array.from(cells, (x) => x ?? "");
  }
  return Array.from(table, (r) => r ?? []);
}
