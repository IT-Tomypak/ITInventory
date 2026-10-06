// lib/receipt-pdf.js — the equipment request receipt as an A5 PDF, written by
// hand. Zero dependencies and base-14 fonts only (Helvetica, Courier), so no
// font is embedded: jsPDF is ~300 KB for one docket.
//
// Pure JS with no DOM or Node APIs, so the notify Edge Function (Deno)
// can produce the SAME bytes server-side for the archive. If you change the
// layout here, redeploy that function with the same code.

const W = 420, H = 595; // A5 portrait, in points
const M = 32;           // side margin

// Helvetica advance widths (1/1000 em) for ASCII 32..126, from the Adobe AFM.
// Needed to wrap and right-align text, because PDF has no text layout.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
  667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
  278,278,278,469,556,333,
  556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,
  334,260,334,584];

// Base-14 fonts speak WinAnsi, not Unicode. Map the common typographic
// characters people paste, keep Latin-1, and replace anything else with "?".
function sanitize(s) {
  return String(s ?? "")
    .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-").replace(/…/g, "...").replace(/[•·]/g, "-")
    .replace(/\u00A0/g, " ").replace(/\r\n?/g, "\n").replace(/\t/g, "  ")
    .replace(/[^\n\x20-\x7E\xA1-\xFF]/g, "?");
}
const esc = (s) => s.replace(/[\\()]/g, (c) => "\\" + c);
const charW = (c) => { const n = c.charCodeAt(0); return n >= 32 && n <= 126 ? HELV[n - 32] : 556; };
const width = (s, size, bold) => [...s].reduce((w, c) => w + charW(c), 0) * size / 1000 * (bold ? 1.06 : 1);

function wrap(text, size, max) {
  const lines = [];
  for (const para of sanitize(text).split("\n")) {
    let line = "";
    for (let word of para.split(/ +/)) {
      while (width(word, size) > max) {            // a word longer than the line: hard-break it
        let i = word.length;
        while (i > 1 && width(word.slice(0, i), size) > max) i--;
        if (line) { lines.push(line); line = ""; }
        lines.push(word.slice(0, i));
        word = word.slice(i);
      }
      const next = line ? line + " " + word : word;
      if (width(next, size) <= max) line = next;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

// Same rendering of the timestamp in the browser and in the Edge Function.
export const receiptTime = (iso) => new Date(iso).toLocaleString("en-GB", {
  timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

/**
 * d = { requestId, createdAt (ISO), name, department, assetType, urgency,
 *       photoCount, justification, statusUrl, company }
 * Returns the PDF as a Uint8Array.
 */
export function buildReceiptPdf(d) {
  const ops = [];
  const text = (x, y, s, { size = 10, bold = false, mono = false, gray = 0.11, align = "left" } = {}) => {
    const str = sanitize(s);
    const tx = align === "right" ? x - width(str, size, bold) : x;
    ops.push(`${gray} g BT /${mono ? "F3" : bold ? "F2" : "F1"} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${esc(str)}) Tj ET`);
  };
  const dashed = (y) => ops.push(`0.75 G 0.6 w [3 3] 0 d ${M} ${y} m ${W - M} ${y} l S [] 0 d`);

  // Header bar
  ops.push(`0.114 0.114 0.122 rg 0 ${H - 64} ${W} 64 re f`);
  text(M, H - 34, "ITrack", { size: 18, bold: true, gray: 1 });
  text(M, H - 50, "IT Asset Management", { size: 9, gray: 0.75 });
  text(W - M, H - 34, "EQUIPMENT REQUEST", { size: 9, bold: true, gray: 1, align: "right" });
  text(W - M, H - 50, "Receipt", { size: 9, gray: 0.75, align: "right" });

  let y = H - 100;
  text(M, y, "Request number", { size: 9, gray: 0.45 });
  y -= 34;
  text(M, y, `#${d.requestId}`, { size: 32, bold: true });
  text(W - M, y + 4, receiptTime(d.createdAt), { size: 10, gray: 0.3, align: "right" });
  y -= 20;
  dashed(y);

  y -= 22;
  for (const [label, value] of [
    ["Requested by", d.name], ["Department", d.department], ["Asset type", d.assetType],
    ["Urgency", d.urgency], ["Photos attached", String(d.photoCount ?? 0)],
  ]) {
    text(M, y, label, { size: 10, gray: 0.45 });
    const v = wrap(value || "-", 11, W - 2 * M - 120)[0];
    text(W - M, y, v, { size: 11, bold: true, align: "right" });
    y -= 20;
  }
  y += 4;
  dashed(y);

  y -= 22;
  text(M, y, "Justification", { size: 10, gray: 0.45 });
  y -= 16;
  const maxLines = Math.floor((y - 130) / 14);
  let lines = wrap(d.justification || "-", 10, W - 2 * M);
  if (lines.length > maxLines) lines = [...lines.slice(0, maxLines - 1), lines[maxLines - 1].replace(/.{0,3}$/, "...")];
  for (const l of lines) { text(M, y, l, { size: 10, gray: 0.15 }); y -= 14; }

  // Footer, fixed to the bottom of the page
  dashed(112);
  text(M, 92, "Keep this receipt. Quote the request number when you contact IT.", { size: 9, gray: 0.3 });
  text(M, 76, "Track progress at:", { size: 9, gray: 0.3 });
  text(M, 62, d.statusUrl || "", { size: 9, mono: true, gray: 0.11 });
  text(M, 32, `Automated receipt from ITrack - ${d.company || ""}`, { size: 8, gray: 0.5 });

  const content = ops.join("\n");
  const font = (name) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    font("Helvetica"), font("Helvetica-Bold"), font("Courier"),
    `<< /Title (${esc(sanitize(`ITrack Request #${d.requestId}`))}) /Producer (ITrack) >>`,
  ];
  // Every character is <= 0xFF after sanitize(), so string length == byte length
  // and the xref offsets below are exact.
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")
    + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}
