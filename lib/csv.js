import Papa from "papaparse";

// Generated in the browser: there is no server to build the file. The BOM
// makes Excel read UTF-8 names correctly instead of as mojibake.
export function downloadCsv(filename, rows) {
  const blob = new Blob(["﻿" + Papa.unparse(rows)], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
