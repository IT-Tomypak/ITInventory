// tools/check-handover.mjs — the handover form with several items, no network.
// Guards against: an item or the employee ID missing from the form, and a full
// form running off its single page or into the footer.
//
//   node tools/check-handover.mjs
import { MAX_HANDOVER_ITEMS, buildHandoverPdf } from "../lib/handover-pdf.js";

let fails = 0;
const check = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

const devices = Array.from({ length: MAX_HANDOVER_ITEMS }, (_, i) => ({ type: "Keyboard", name: `TPKB-${i + 1}` }));
const pdf = String.fromCharCode(...buildHandoverPdf({
  fullName: "Ali Bin Abu", employeeNo: "500123", designation: "Clerk", department: "Slitting",
  purpose: "x ".repeat(40), dateReceived: "2026-11-02", devices, issuedBy: "IT", company: "Tomypak",
}));

check(pdf.includes("(500123) Tj"), "employee ID is on the form");
check(devices.every((d) => pdf.includes(`(${d.name}) Tj`)), "every item is on the form");
check(pdf.includes(`(Device: ${MAX_HANDOVER_ITEMS} items) Tj`), "header counts the items");

// Lowest box drawn: the signature boxes must stay above the footer text (y 36, size 8).
const lowest = Math.min(...[...pdf.matchAll(/([\d.]+) ([\d.-]+) ([\d.]+) ([\d.]+) re S/g)].map((m) => +m[2]));
check(lowest > 44, `a full form clears the footer (lowest box at y=${lowest})`);

process.exit(fails ? 1 : 0);
