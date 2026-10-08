// tools/check-hw-import.mjs — the hardware Excel import, end to end without
// a network: workbooks written by lib/xlsx.js (stored) AND deflated the way
// Excel writes them are read back by lib/xlsxRead.js, then planned against a
// small register by lib/hardwareImport.js.
// Guards against: a reader that only handles our own writer, a date or MAC
// normaliser that silently mangles, and a plan that lets a duplicate key,
// a bad status or an accessory overwrite through.
//
//   node tools/check-hw-import.mjs
import zlib from "node:zlib";
import { buildXlsx, zipStore } from "../lib/xlsx.js";
import { readXlsx } from "../lib/xlsxRead.js";
import { parseDate, parseQr, planImport } from "../lib/hardwareImport.js";

let fails = 0;
const check = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

// ---- QR labels
check(parseQr("  5CD1234XYZ ").serial_no === "5CD1234XYZ", "plain QR text is the serial");
check(JSON.stringify(parseQr("S/N: ABC123\nModel: Latitude 5440\nBrand: Dell")) === JSON.stringify({ serial_no: "ABC123", model: "Latitude 5440", make: "Dell" }), "Key: value lines map to fields");
check(parseQr("{\"Serial_number\":\"X9\",\"Mac_address\":\"aabbccddeeff\"}").mac_address === "AA-BB-CC-DD-EE-FF", "JSON uses sheet headers, MAC normalised");
check(parseQr("https://qrl.dell.com/ABC").serial_no === "https://qrl.dell.com/ABC", "a URL (colon, no key) is kept whole");

// ---- dates
check(parseDate("3/12/2025") === "2025-12-03", "d/m/yyyy is day first");
check(parseDate("01.08.2024") === "2024-08-01", "dd.mm.yyyy");
check(parseDate("10-May-23") === "2023-05-10", "d-Mon-yy");
check(parseDate(45994) === "2025-12-03" && parseDate("45994") === "2025-12-03", "Excel serial (number or text)");
check(parseDate("Nil") === "" && parseDate("") === "", "Nil and blank are blank");
check(parseDate("31/2/2025") === null && parseDate("soon") === null, "impossible and unreadable dates are null");

// ---- the reader, on a workbook from our own writer (stored entries)
const header = ["Names", "Device_name", "Status", "Device_type", "Employee_name", "Employee_id", "Purchased_year",
  "Mac_address", "Office_productkey", "Anydesk_id", "Serial_number", "Vendor_name", "Remarks"];
const sheetRows = [
  ["TPLL", "TPLL001", "Active", "laptop", "Ali", "1001", 45994, "70:d8:23:70:d7:a8", "abcde - fghij-klmno-pqrst-uvwxy", "1 346 002 150", "S1", "CHN", "a <&> b"],
  ["", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["TPLL", "TPLL002", "Vacant", "Laptop", "", "", "", "", "", "", "S2", "", ""],
  ["TPLL", "TPLL009", "Registered", "Laptop", "", "", "10/5/2023", "", "", "", "S9", "New Supplier", ""],
  ["TPDL", "TPDL001", "Retired", "Desktop", "", "", "", "", "", "12345", "S1", "", ""],
  ["ACC", "ACC-001", "Active", "Laptop", "", "", "", "", "", "", "", "", ""],
  ["TPLL", "TPLL003", "Vacant", "Laptop", "Bea", "", "", "", "", "", "", "", ""],
];
const objects = sheetRows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
const stored = await readXlsx(buildXlsx([{ name: "IT", rows: objects }]));
check(stored[0].join() === header.join(), "header row read back");
check(stored[1][1] === "TPLL001" && stored[1][6] === 45994 && stored[1][12] === "a <&> b", "text, numbers and escapes survive");

// ---- the reader, on a deflated workbook with shared strings (how Excel saves)
function zipDeflate(files) {
  const crcOf = (buf) => zlib.crc32(buf);
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameB = Buffer.from(name), data = Buffer.from(text), comp = zlib.deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crcOf(data), 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    parts.push(local, nameB, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crcOf(data), 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameB.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, nameB);
    offset += 30 + nameB.length + comp.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return new Blob([...parts, ...central, end]);
}
const excelLike = zipDeflate({
  "xl/workbook.xml": '<workbook><sheets><sheet name="Hardware" sheetId="1" r:id="rId7"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Target="worksheets/sheet3.xml" Id="rId7" Type="x"/></Relationships>',
  "xl/sharedStrings.xml": '<sst><si><t>Device_name</t></si><si><r><t>TP</t></r><r><t xml:space="preserve">LL001</t></r></si><si><t>Tom &amp; Jerry</t></si></sst>',
  "xl/worksheets/sheet3.xml": '<worksheet><cols><col min="1" max="2"/></cols><sheetData>'
    + '<row r="1"><c r="B1" t="s"><v>0</v></c></row>'
    + '<row r="3"><c r="B3" t="s"><v>1</v></c><c r="C3" t="s"><v>2</v></c><c r="D3"><v>45994</v></c><c r="E3" t="str"><v>x</v></c></row>'
    + "</sheetData></worksheet>",
});
const deflated = await readXlsx(excelLike);
check(deflated[0][1] === "Device_name" && deflated[0][0] === "", "deflated sheet found through the workbook's relationship");
check(deflated[1].length === 0, "a row Excel left out is an empty row");
check(deflated[2][1] === "TPLL001" && deflated[2][2] === "Tom & Jerry" && deflated[2][3] === 45994 && deflated[2][4] === "x",
  "rich text runs joined, entities decoded, numbers and formula strings kept");
let notXlsx = false;
try { await readXlsx(new Blob(["Device_name,Status"])); } catch { notXlsx = true; }
check(notXlsx, "a CSV handed to the xlsx reader is refused, not misread");

// ---- the plan
const ctx = {
  categories: [{ name: "Laptop", list: "inventory" }, { name: "Desktop", list: "inventory" }, { name: "Mouse", list: "accessory" }],
  staff: [{ staff_id: 1, full_name: "Ali Bin Abu", employee_no: "1001", role: "Clerk" }, { staff_id: 2, full_name: "Bea", employee_no: null, role: null }],
  vendors: [{ vendor_id: 1, name: "CHN" }],
  assets: [
    { asset_tag: "TPLL001", list: "inventory", asset_type: "Laptop", hw_status: "Active", serial_no: "S1", holder: "Ali Bin Abu", holder_staff_id: 1, holder_emp_no: "1001" },
    { asset_tag: "TPLL002", list: "inventory", asset_type: "Laptop", hw_status: "Active", serial_no: "S2", holder: "Bea", holder_staff_id: 2, mac_address: "AA-BB-CC-DD-EE-FF" },
    { asset_tag: "TPDL001", list: "inventory", asset_type: "Desktop", hw_status: "Active", serial_no: "SX" },
    { asset_tag: "ACC-001", list: "accessory", asset_type: "Mouse", status: "In stock" },
  ],
};
const { items, skipped } = planImport(stored, ctx);
const row = (tag) => items.find((i) => i.tag === tag);
check(skipped === 1 && items.length === 6, `blank row skipped, 6 rows planned (${skipped}, ${items.length})`);

const a = row("TPLL001");
check(a.f.asset_type === "Laptop" && a.f.purchase_date === "2025-12-03", "type matched case-insensitively, serial date converted");
check(a.f.mac_address === "70-D8-23-70-D7-A8" && a.f.office_product_key === "ABCDE-FGHIJ-KLMNO-PQRST-UVWXY" && a.f.anydesk_id === "1346002150",
  "MAC, Office key and AnyDesk normalised");
check(a.f.employee === "Ali Bin Abu" && a.warnings.some((w) => /Employee ID 1001 is "Ali Bin Abu"/.test(w)),
  "person found by Employee ID despite a short name, and the difference is shown");
check(a.kind === "error" && a.errors.some((e) => /Serial_number S1 is also on TPDL001/.test(e)), "duplicate serial (file row vs file row) blocks the row");

const b = row("TPLL002");
check(b.kind === "update" && b.f.employee === "" && b.f.mac_address === "AA-BB-CC-DD-EE-FF",
  "Vacant + blank employee frees the device; other blank cells keep stored values");
const n = row("TPLL009");
check(n.kind === "new" && n.newVendor === "New Supplier" && n.f.purchase_date === "2023-05-10", "new device with a new vendor");
const d = row("TPDL001");
check(d.kind === "error" && d.errors.some((e) => /Status "Retired"/.test(e)) && d.errors.some((e) => /Anydesk_id "12345"/.test(e)),
  "bad status and bad AnyDesk reported together");
check(row("ACC-001").errors.some((e) => /IT Accessories item/.test(e)), "an accessory cannot be overwritten from the hardware sheet");
check(row("TPLL003").errors.some((e) => /Status is Vacant but Bea is named/.test(e)), "Vacant with an employee is an error");

const swap = planImport([["Device_name", "Serial_number"], ["TPLL001", "S2"], ["TPLL002", "S1"]], ctx);
check(swap.items.every((i) => !i.errors.some((e) => /Serial/.test(e))), "two devices swapping serials is not a duplicate");
const same = planImport([["Device name", "Status"], ["TPDL001", "active"]], ctx);
check(same.items[0].kind === "same", "the register's own export headers work, and an unchanged row is 'same'");
const loc = planImport([["Device_name", "Location"], ["TPDL001", "IT Store - Cabinet 2"]], ctx);
check(loc.items[0].f.item_location === "IT Store - Cabinet 2" && loc.items[0].changes.some((c) => c.label === "Location"),
  "a Location column is imported and shown as a change");
let noHeader = false;
try { planImport([["foo", "bar"]], ctx); } catch { noHeader = true; }
check(noHeader, "a sheet without a Device_name header is refused");

console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
