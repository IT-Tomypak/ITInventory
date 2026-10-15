// Save one IT Hardware device from form-shaped values (lib/hardwareImport.js
// hardwareValues). One routine for HardwareForm and the Excel import, so a
// row saved either way follows the same rules:
//   * Employee name is the HOLDER: a different person is checked in from the
//     old holder and out to the new one through the Allocate / Return RPCs,
//     so handover history stays complete, and the old name becomes Previous user;
//   * Employee ID and designation live on the staff row (admin-written, RLS);
//   * a change of holder moves Registered/Vacant to Active, and Active to Vacant.
import { supabase } from "./supabaseClient.js";

const nz = (v) => (typeof v === "string" ? v.trim() || null : v ?? null);
const TEXT_FIELDS = ["asset_tag", "make", "model", "serial_no", "department", "previous_user", "mac_address", "os",
  "m365_license", "office_product_key", "ram", "storage", "anydesk_id", "powerapps_id", "remark",
  "workgroup", "plant", "special_app", "app_licenses", "batch_number", "item_location"];

export const FIXED_SERIES = ["TPPC", "TPLL", "TPDL", "TPML"];

// Parse an asset tag into prefix, separator, and numeric parts.
// E.g. "TPPC246" -> { prefix: "TPPC", separator: "", num: 246, padLength: 3 }
// E.g. "TPLL001" -> { prefix: "TPLL", separator: "", num: 1, padLength: 3 }
// E.g. "HW-005"  -> { prefix: "HW",   separator: "-", num: 5, padLength: 3 }
export function parseTag(tag) {
  if (!tag) return null;
  const m = String(tag).trim().match(/^([A-Za-z_-]+?)([-_\s]*)(\d+)$/);
  if (!m) return null;
  return {
    prefix: m[1],
    separator: m[2],
    rawNum: m[3],
    num: parseInt(m[3], 10),
    padLength: m[3].length,
  };
}

// Compute statistics (max number, count, separator, padding) for all series from rows.
export function getSeriesStats(rows) {
  const stats = new Map();

  for (const s of FIXED_SERIES) {
    stats.set(s.toUpperCase(), {
      name: s,
      maxNum: 0,
      maxTag: "",
      separator: "",
      padLength: 3,
      count: 0,
    });
  }

  for (const r of rows || []) {
    if (!r.asset_tag) continue;
    const p = parseTag(r.asset_tag);
    if (!p) continue;
    const key = p.prefix.toUpperCase();
    const existing = stats.get(key) || {
      name: p.prefix,
      maxNum: 0,
      maxTag: "",
      separator: p.separator,
      padLength: p.padLength,
      count: 0,
    };
    existing.count++;
    if (p.num > existing.maxNum) {
      existing.maxNum = p.num;
      existing.maxTag = r.asset_tag;
      existing.separator = p.separator;
      existing.padLength = Math.max(existing.padLength, p.padLength);
    }
    stats.set(key, existing);
  }

  return stats;
}

// Given a series name, return the next tag which is greater than the current max number.
export function getNextTagForSeries(seriesName, statsOrRows) {
  const stats = statsOrRows instanceof Map ? statsOrRows : getSeriesStats(statsOrRows);
  const key = String(seriesName || "").trim().toUpperCase();
  const info = stats.get(key);
  const prefix = info?.name || seriesName || "TPPC";
  const nextNum = (info?.maxNum || 0) + 1;
  const sep = info?.separator ?? "";
  const pad = Math.max(info?.padLength || 3, 3);
  return `${prefix}${sep}${String(nextNum).padStart(pad, "0")}`;
}

export const findStaff = (staff, name) => staff.find((s) => s.full_name.toLowerCase() === name.trim().toLowerCase());

// asset: the stored row (loadRegister), or null for a new device.
// lookups.staff is appended to when a person is created, so the next row of
// an import finds them. Returns { data } or { error }, plus { warning } when
// the device saved but its holder could not be moved.
export async function saveHardware(asset, f, { lookups, isAdmin }) {
  const name = f.employee.trim();
  const oldName = asset?.holder || "";

  let person = name ? findStaff(lookups.staff, name) : null;
  if (name && !person) {
    if (!isAdmin) return { error: `${name} is not in the staff list. Ask an administrator to add them on Data Management.` };
    const { data, error } = await supabase.from("staff")
      .insert({ full_name: name, employee_no: nz(f.employee_no), role: nz(f.designation), department: nz(f.department) })
      .select().single();
    if (error) return { error: error.message };
    lookups.staff.push(data);
    person = data;
  } else if (person && isAdmin && (nz(f.employee_no) !== person.employee_no || nz(f.designation) !== person.role)) {
    const change = { employee_no: nz(f.employee_no), role: nz(f.designation) };
    const { error } = await supabase.from("staff").update(change).eq("staff_id", person.staff_id);
    if (error) return { error: error.message };
    Object.assign(person, change);
  }

  // Setting to Vacant automatically frees the device and makes the current user Previous user.
  const curUser = oldName || name;
  if (f.hw_status === "Vacant" && curUser) {
    person = null;
    if (!f.previous_user) f.previous_user = curUser;
  }

  // A location holder (accessories) has no staff_id; any person replaces it.
  const holderChanged = (person?.staff_id ?? null) !== (asset?.holder_staff_id ?? null) || (!person && !!oldName);
  let hw = f.hw_status;
  if (holderChanged && person && ["Registered", "Vacant"].includes(hw)) hw = "Active";
  if (holderChanged && !person && hw === "Active") hw = "Vacant";

  const prevUser = nz(f.previous_user) || (holderChanged && oldName ? oldName : null);
  const payload = {
    ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, nz(f[k])])),
    asset_type: f.asset_type, hw_status: hw, purchase_date: nz(f.purchase_date),
    vendor_id: f.vendor_id === "" || f.vendor_id == null ? null : Number(f.vendor_id),
    ...(prevUser ? { previous_user: prevUser } : {}),
    ...(f.photo_path !== undefined ? { photo_path: nz(f.photo_path) } : {}),
  };
  const { data, error } = asset
    ? await supabase.from("assets").update(payload).eq("asset_id", asset.asset_id).select().single()
    : await supabase.from("assets").insert(payload).select().single();
  if (error) return { error: error.code === "23505" ? `Device name ${payload.asset_tag} already exists.` : error.message };

  if (holderChanged) {
    const step = async (fn, args) => (await supabase.rpc(fn, args)).error;
    const err = (oldName && await step("return_asset", { p_asset_id: data.asset_id }))
      || (person && await step("allocate_asset", { p_request_id: null, p_asset_id: data.asset_id, p_staff_id: person.staff_id,
        p_issued_on: nz(f.handover_date) || undefined }));
    if (err) return { data, warning: `Saved, but the employee was not updated: ${err.message}` };
  }
  return { data };
}
