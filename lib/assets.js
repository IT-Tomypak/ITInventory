// Shared asset vocabulary and helpers. The value lists mirror the CHECKs and
// domains in the initial migration — change both together.
import { supabase } from "./supabaseClient";

export const ASSET_TYPES = ["Laptop", "Desktop", "Monitor", "Printer", "Network", "Server", "Phone", "Tablet", "Peripheral", "Other"];
export const ASSET_STATUSES = ["In stock", "Assigned", "In repair", "Loaned", "Retired", "Lost/Stolen"];
// Assigned/Loaned come only from custody (trg_sync_asset_status); the database
// refuses them as a manual edit, so the UI never offers them.
export const MANUAL_STATUSES = ["In stock", "In repair", "Retired", "Lost/Stolen"];
export const CONDITIONS = ["New", "Good", "Fair", "Damaged"];

// PostgREST caps a response (1000 rows by default); page through it. `build`
// must return a fresh, ORDERED query each call so pages do not overlap.
export async function fetchAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < pageSize) return out;
  }
}

// Dates as 'YYYY-MM-DD' strings compare correctly as strings; keep them that way.
export const today = () => new Date().toLocaleDateString("en-CA");
export const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
};
export const fmtDate = (iso) => iso
  ? new Date(iso.length > 10 ? iso : iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  : "—";
export const fmtDateTime = (iso) => iso
  ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "—";
export const fmtRM = (n) => n == null ? "—"
  : "RM " + Number(n).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const WARRANTY_STATES = ["Expired", "Expires ≤ 30 days", "Expires ≤ 90 days", "In warranty", "Unknown"];
export function warrantyState(end, now = today()) {
  if (!end) return "Unknown";
  if (end < now) return "Expired";
  if (end <= addDays(now, 30)) return "Expires ≤ 30 days";
  if (end <= addDays(now, 90)) return "Expires ≤ 90 days";
  return "In warranty";
}

// Straight-line depreciation to zero over refresh_years from purchase_date.
// Used by the register's book-value KPI and by /value, so they cannot disagree.
export function bookValue(cost, purchaseDate, refreshYears, now = new Date()) {
  if (cost == null) return 0;
  if (!purchaseDate || !refreshYears) return Number(cost);
  const ageYears = (now - new Date(purchaseDate + "T00:00:00")) / (365.25 * 864e5);
  return Math.max(0, Number(cost) * (1 - ageYears / refreshYears));
}

// Everything the register and the history page need, joined in the browser
// rather than through PostgREST embeds: assets and asset_assignment both
// reach `locations`, and an ambiguous embed silently blanks the page.
export async function loadRegister({ withCost }) {
  const [assets, locations, vendors, staff, open, values] = await Promise.all([
    fetchAll(() => supabase.from("assets").select("*").order("asset_id")),
    fetchAll(() => supabase.from("locations").select("location_id, name, active").order("location_id")),
    fetchAll(() => supabase.from("vendors").select("vendor_id, name, active").order("vendor_id")),
    fetchAll(() => supabase.from("staff").select("staff_id, full_name, department").order("staff_id")),
    fetchAll(() => supabase.from("asset_assignment")
      .select("assignment_id, asset_id, staff_id, location_id, issued_on, due_back_on")
      .is("returned_on", null).order("assignment_id")),
    withCost
      ? fetchAll(() => supabase.from("asset_value").select("asset_id, purchase_cost_rm").order("asset_id"))
      : Promise.resolve([]),
  ]);
  const byId = (rows, key) => new Map(rows.map((r) => [r[key], r]));
  const lookups = {
    locations, vendors, staff,
    locationName: byId(locations, "location_id"),
    vendorName: byId(vendors, "vendor_id"),
    staffById: byId(staff, "staff_id"),
  };
  const openByAsset = byId(open, "asset_id");
  const costByAsset = byId(values, "asset_id");
  const now = today();
  const rows = assets.map((a) => {
    const o = openByAsset.get(a.asset_id);
    const cost = costByAsset.get(a.asset_id)?.purchase_cost_rm ?? null;
    return {
      ...a,
      holder: o ? (lookups.staffById.get(o.staff_id)?.full_name || lookups.locationName.get(o.location_id)?.name || "—") : "",
      holder_since: o?.issued_on ?? null,
      due_back_on: o?.due_back_on ?? null,
      location: lookups.locationName.get(a.location_id)?.name ?? "",
      vendor: lookups.vendorName.get(a.vendor_id)?.name ?? "",
      warranty: warrantyState(a.warranty_end, now),
      purchase_cost_rm: cost,
      book_value: withCost ? bookValue(cost, a.purchase_date, a.refresh_years) : null,
    };
  });
  return { rows, lookups };
}
