// IT Hardware import: map IT's sheet columns, normalise the values, and plan
// every row against what is stored. Pure (no network), so
// tools/check-hw-import.mjs runs it; lib/hardware.js applies a plan.
//
// Rules, agreed with IT (2026-10-07):
//   * rows match stored devices by Device name; a new name is a new device;
//   * a BLANK cell keeps what is stored, so a partial sheet never wipes data;
//     the one exception: Status Vacant/Registered with no employee frees the device;
//   * a person is found by Employee ID first (sheets use short names), then name;
//   * anything that would store a duplicate or malformed key, serial, AnyDesk
//     ID or MAC is an error, and the row is not applied.

export const HW_STATUSES = ["Registered", "Active", "Handover", "Repair", "Vacant"];

// Header (lower-case, letters and digits only) -> form field. Accepts IT's
// sheet ("Device_name") and the register's own export ("Device name").
const COLUMNS = {
  devicename: "asset_tag", status: "hw_status", workgroup: "workgroup", remarks: "remark", devicetype: "asset_type",
  employeename: "employee", employeeid: "employee_no", previoususers: "previous_user", plant: "plant",
  department: "department", designation: "designation", purchasedyear: "purchase_date", handoverdate: "handover_date",
  macaddress: "mac_address", brand: "make", model: "model", serialnumber: "serial_no", os: "os",
  m365license: "m365_license", officeproductkey: "office_product_key", ram: "ram", hddcapacity: "storage",
  anydeskid: "anydesk_id", specialapp: "special_app", applicenses: "app_licenses", batchnumber: "batch_number",
  vendorname: "vendor", powerappsid: "powerapps_id", location: "item_location",
};
// Preview labels: the sheet's own header names, in its order.
export const FIELD_LABELS = {
  hw_status: "Status", workgroup: "Workgroup", remark: "Remarks", asset_type: "Device_type", employee: "Employee_name",
  employee_no: "Employee_id", previous_user: "Previous_users", plant: "Plant", item_location: "Location", department: "Department",
  designation: "Designation", purchase_date: "Purchased_year", handover_date: "Handover_date", mac_address: "Mac_address",
  make: "Brand", model: "Model", serial_no: "Serial_number", os: "OS", m365_license: "M365_license",
  office_product_key: "Office_productkey", ram: "RAM", storage: "HDD_capacity", anydesk_id: "Anydesk_id",
  special_app: "Special_app", app_licenses: "App_licenses", batch_number: "Batch_number", vendor: "Vendor_name",
  powerapps_id: "__PowerAppsId__",
};
const TEXT = ["workgroup", "remark", "previous_user", "plant", "department", "mac_address", "make", "model", "serial_no", "os",
  "m365_license", "office_product_key", "ram", "storage", "anydesk_id", "special_app", "app_licenses", "batch_number", "powerapps_id",
  "item_location"];

const headerKey = (c) => String(c ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (v) => (v == null || v === false ? "" : String(v).replace(/\s+/g, " ").trim());
const mac = (m) => {
  const hex = m.replace(/[^0-9a-f]/gi, "").toUpperCase();
  return hex.length === 12 ? hex.match(/../g).join("-") : m.toUpperCase();
};
const NORMALISE = {
  anydesk_id: (v) => v.replace(/\s/g, ""),
  office_product_key: (v) => v.toUpperCase().replace(/\s*-\s*/g, "-"),
  mac_address: (v) => v.split(/\s*\/\s*/).map(mac).join(" / "),
};
const FORMATS = {
  office_product_key: [/^([A-Z0-9]{5}-){4}[A-Z0-9]{5}( \/ ([A-Z0-9]{5}-){4}[A-Z0-9]{5})*$/, "5 groups of 5 letters/digits"],
  anydesk_id: [/^\d{9,10}$/, "9 or 10 digits"],
  mac_address: [/^([0-9A-F]{2}-){5}[0-9A-F]{2}( \/ ([0-9A-F]{2}-){5}[0-9A-F]{2})*$/, "6 pairs of hex digits"],
};
// Values that must not repeat across devices; " / " separates two on one device.
const UNIQUE = ["serial_no", "office_product_key", "anydesk_id", "mac_address", "powerapps_id"];
const NONE = new Set(["nil", "na", "n/a", "-", "--", "none"]);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function iso(y, m, d) {
  const yy = +y < 100 ? 2000 + +y : +y, date = new Date(Date.UTC(yy, m - 1, +d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === +d ? date.toISOString().slice(0, 10) : null;
}
// Excel serial, 2025-12-03, 3/12/2025, 3.12.2025, 3-Dec-25. Day first (Malaysia).
// Returns "" for blank, null for unreadable.
export function parseDate(v) {
  const s = clean(v);
  if (!s || NONE.has(s.toLowerCase())) return "";
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Math.round((+s - 25569) * 864e5)).toISOString().slice(0, 10);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return iso(m[1], +m[2], m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) return iso(m[3], +m[2], m[1]);
  m = /^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s-](\d{2}|\d{4})$/i.exec(s);
  if (m && MONTHS.includes(m[2].toLowerCase())) return iso(m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, m[1]);
  return null;
}

// A scanned QR label -> form fields. JSON or "Key: value" lines use the sheet's
// headers (plus the short labels makers print); anything else is the serial.
const QR_ALIASES = { sn: "serial_no", serial: "serial_no", serialno: "serial_no", servicetag: "serial_no",
  mac: "mac_address", make: "make", manufacturer: "make", tag: "asset_tag", assettag: "asset_tag", pn: "model" };
export function parseQr(text) {
  const s = String(text ?? "").trim();
  if (!s) return {};
  let pairs;
  try { const j = JSON.parse(s); if (j && typeof j === "object") pairs = Object.entries(j); } catch { /* not JSON */ }
  pairs ??= s.split(/\r?\n|;/).map((l) => /^\s*([^:=]+?)\s*[:=]\s*(.+)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]);
  const out = {};
  for (const [k, v] of pairs) {
    const field = COLUMNS[headerKey(k)] ?? QR_ALIASES[headerKey(k)];
    const val = clean(v);
    if (field && val) out[field] = NORMALISE[field] ? NORMALISE[field](val) : val;
  }
  return Object.keys(out).length ? out : { serial_no: clean(s) };
}

// What a stored device looks like in form fields (see HardwareForm).
export function hardwareValues(a, vendors = []) {
  return {
    ...Object.fromEntries(TEXT.map((k) => [k, a?.[k] ?? ""])),
    asset_tag: a?.asset_tag ?? "", asset_type: a?.asset_type ?? "", hw_status: a?.hw_status ?? "Registered",
    purchase_date: a?.purchase_date ?? "", vendor_id: a?.vendor_id ?? "",
    vendor: vendors.find((v) => v.vendor_id === a?.vendor_id)?.name ?? "",
    handover_date: a?.holder_since ?? "",
    employee: a?.holder ?? "", employee_no: a?.holder_emp_no ?? "", designation: a?.holder_designation ?? "",
  };
}

// table: rows of cells (readXlsx, or Papa.parse(...).data for CSV).
// ctx: { assets: loadRegister rows, categories, staff, vendors }.
export function planImport(table, ctx) {
  const h = table.findIndex((r) => r?.some((c) => headerKey(c) === "devicename"));
  if (h < 0) throw new Error('No "Device_name" column found. The sheet\'s first row must be the column headers.');
  const cols = table[h].map((c) => COLUMNS[headerKey(c)] ?? null);
  const hwTypes = ctx.categories.filter((c) => c.list === "inventory").map((c) => c.name);
  const byTag = new Map(ctx.assets.map((a) => [a.asset_tag.toUpperCase(), a]));
  const lower = (s) => s.toLowerCase();
  const items = [];
  let skipped = 0;

  table.slice(h + 1).forEach((cells, i) => {
    const v = {};
    cols.forEach((field, j) => { if (field) v[field] = clean(cells?.[j]); });
    if (!v.asset_tag) { skipped++; return; } // blank rows, PowerApps-only rows
    const cur = byTag.get(v.asset_tag.toUpperCase());
    const was = hardwareValues(cur, ctx.vendors);
    const f = { ...was };
    const errors = [], warnings = [];
    if (cur && cur.list !== "inventory") errors.push(`${cur.asset_tag} is an IT Accessories item, not hardware.`);

    for (const [field, raw] of Object.entries(v)) {
      if (raw && !NONE.has(lower(raw))) f[field] = NORMALISE[field] ? NORMALISE[field](raw) : raw;
    }
    f.asset_tag = cur?.asset_tag ?? v.asset_tag;

    for (const k of ["purchase_date", "handover_date"]) {
      if (!v[k]) continue;
      const d = parseDate(v[k]);
      if (d === null) errors.push(`${FIELD_LABELS[k]} "${v[k]}" is not a date (use day/month/year).`);
      else if (d) f[k] = d;
    }
    const type = hwTypes.find((t) => lower(t) === lower(f.asset_type));
    if (type) f.asset_type = type;
    else errors.push(f.asset_type ? `Device type "${f.asset_type}" is not a hardware category (${hwTypes.join(", ")}).` : "Device type is missing.");
    const status = HW_STATUSES.find((s) => lower(s) === lower(f.hw_status));
    if (status) f.hw_status = status;
    else errors.push(`Status "${f.hw_status}" is not one of ${HW_STATUSES.join(", ")}.`);
    for (const [k, [re, what]] of Object.entries(FORMATS)) {
      if (f[k] && f[k] !== was[k] && !re.test(f[k])) errors.push(`${FIELD_LABELS[k]} "${f[k]}" should be ${what}.`);
    }

    // The person. A free device is the one way a blank cell clears something.
    if (["Vacant", "Registered"].includes(f.hw_status) && v.hw_status && !v.employee) {
      Object.assign(f, { employee: "", employee_no: "", designation: "" });
    }
    if (f.employee) {
      const byNo = v.employee_no && ctx.staff.find((s) => s.employee_no === v.employee_no);
      const person = byNo || ctx.staff.find((s) => lower(s.full_name) === lower(f.employee));
      if (byNo && v.employee && lower(byNo.full_name) !== lower(v.employee)) {
        warnings.push(`Employee ID ${v.employee_no} is "${byNo.full_name}" in the system; the file says "${v.employee}". Using ${byNo.full_name}.`);
      }
      if (person) {
        f.employee = person.full_name;
        if (!v.employee_no) f.employee_no = person.employee_no ?? "";
        if (!v.designation) f.designation = person.role ?? "";
      } else {
        warnings.push(`New staff record: ${f.employee}${f.employee_no ? ` (${f.employee_no})` : ""}.`);
      }
    }
    if (["Vacant", "Registered"].includes(f.hw_status) && f.employee) {
      errors.push(`Status is ${f.hw_status} but ${f.employee} is named. Clear the employee or change the status.`);
    }
    if (["Active", "Handover"].includes(f.hw_status) && !f.employee) warnings.push(`Status is ${f.hw_status} but no employee is named.`);

    const vendor = f.vendor && ctx.vendors.find((x) => lower(x.name) === lower(f.vendor));
    f.vendor_id = vendor ? vendor.vendor_id : "";
    if (f.vendor && !vendor) warnings.push(`New vendor: ${f.vendor}.`);

    const changes = Object.keys(FIELD_LABELS)
      .filter((k) => String(f[k] ?? "") !== String(was[k] ?? ""))
      .map((k) => ({ label: FIELD_LABELS[k], from: was[k] ?? "", to: f[k] ?? "" }));
    items.push({ line: h + i + 2, tag: f.asset_tag, cur, f, changes, errors, warnings, newVendor: f.vendor && !vendor ? f.vendor : null });
  });

  // Duplicates, judged on the state AFTER the import: stored hardware with the
  // file's rows laid over it, so swapping a key between two rows is fine.
  const seen = new Map();
  for (const it of items) seen.set(it.tag.toUpperCase(), (seen.get(it.tag.toUpperCase()) ?? 0) + 1);
  for (const it of items) {
    if (seen.get(it.tag.toUpperCase()) > 1) it.errors.push(`${it.tag} appears more than once in the file.`);
  }
  const final = new Map(ctx.assets.filter((a) => a.list === "inventory").map((a) => [a.asset_tag.toUpperCase(), a]));
  for (const it of items) final.set(it.tag.toUpperCase(), it.f);
  for (const k of UNIQUE) {
    const owners = new Map();
    for (const [tag, rec] of final) {
      for (const val of String(rec[k] ?? "").split(" / ").filter(Boolean)) owners.set(val, [...(owners.get(val) ?? []), tag]);
    }
    for (const it of items) {
      for (const val of String(it.f[k] ?? "").split(" / ").filter(Boolean)) {
        const others = owners.get(val).filter((t) => t !== it.tag.toUpperCase());
        if (others.length) it.errors.push(`${FIELD_LABELS[k]} ${val} is also on ${others.join(", ")}.`);
      }
    }
  }

  for (const it of items) it.kind = it.errors.length ? "error" : !it.cur ? "new" : it.changes.length ? "update" : "same";
  return { items, skipped };
}
