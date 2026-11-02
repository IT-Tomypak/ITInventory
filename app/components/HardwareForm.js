"use client";
// Create or edit one IT Hardware item with the columns on IT's hardware sheet.
// The save rules (holder, staff row, status) are lib/hardware.js saveHardware,
// shared with the Excel import.
import { useState, useMemo } from "react";
import { Save } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { HW_STATUSES, hardwareValues } from "../../lib/hardwareImport";
import { FIXED_SERIES, findStaff as findIn, getNextTagForSeries, getSeriesStats, parseTag, saveHardware } from "../../lib/hardware";
import { joinPhotos, splitPhotos } from "../../lib/photos";
import { PhotoPicker, SerialInput, inputCls } from "./AssetForm";
import { HoldToConfirmButton, toast, cn } from "./ui";
import QrScan from "./QrScan";

function L({ label, children, wide }) {
  return (
    <label className={wide ? "col-span-full block" : "block"}>
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

// activate: opened from the table's Status dropdown to make an unheld device
// Active, so the status is preset and the employee is required.
export default function HardwareForm({ asset, activate, lookups, departments, isAdmin, nextTag, existingRows = [], onSaved, onDeleted, onCancel, onExisting }) {
  const editing = !!asset;
  const categories = lookups.categories.filter((c) => c.list === "inventory" && (c.active || c.name === asset?.asset_type));
  const findStaff = (name) => findIn(lookups.staff, name);
  const seriesStats = useMemo(() => getSeriesStats(existingRows), [existingRows]);

  const [f, setF] = useState(() => ({
    ...hardwareValues(asset, lookups.vendors),
    asset_tag: asset?.asset_tag ?? nextTag ?? getNextTagForSeries("TPPC", seriesStats),
    asset_type: asset?.asset_type ?? categories[0]?.name ?? "",
    ...(activate ? { hw_status: "Active" } : {}),
  }));
  const [photos, setPhotos] = useState(() => splitPhotos(asset?.photo_path));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  // A scan fills only fields this form has; whatever is typed elsewhere stays.
  const scanned = (v) => setF((s) => ({ ...s, ...Object.fromEntries(Object.entries(v).filter(([k]) => k in s)) }));

  const parsedTag = useMemo(() => parseTag(f.asset_tag), [f.asset_tag]);
  const currentSeries = (parsedTag?.prefix || f.asset_tag.replace(/[-\s]*\d+$/, "") || "TPPC").toUpperCase();
  const currentInfo = seriesStats.get(currentSeries);
  const currentMaxNum = currentInfo?.maxNum ?? 0;

  // Rule: each name has their own current number, so the next new item must be greater than current number.
  const isLowerOrEqual = !editing && parsedTag && currentMaxNum > 0 && parsedTag.num <= currentMaxNum;
  const isDuplicate = !editing && existingRows.some((r) => r.asset_tag?.trim().toLowerCase() === f.asset_tag.trim().toLowerCase());

  function selectSeries(seriesName) {
    const next = getNextTagForSeries(seriesName, seriesStats);
    setF((s) => ({ ...s, asset_tag: next }));
  }

  // Picking a known person fills in their ID, designation and (if blank)
  // department; a name not (yet) on the list starts them blank.
  function setEmployee(e) {
    const name = e.target.value;
    const s = findStaff(name);
    setF((p) => ({ ...p, employee: name, employee_no: s?.employee_no ?? "", designation: s?.role ?? "",
      department: p.department || s?.department || "" }));
  }

  // Setting status from Active to Vacant automatically moves the current user to Previous user.
  function setStatus(e) {
    const nextStatus = e.target.value;
    setF((prev) => {
      if (nextStatus === "Vacant" && (prev.hw_status === "Active" || prev.employee.trim() || asset?.holder)) {
        const currentUser = prev.employee.trim() || asset?.holder || "";
        return {
          ...prev,
          hw_status: nextStatus,
          previous_user: currentUser || prev.previous_user,
          employee: "",
          employee_no: "",
          designation: "",
        };
      }
      return { ...prev, hw_status: nextStatus };
    });
  }

  // Editing "Names" (series prefix): updates the prefix of the device name (asset_tag).
  function setSeries(e) {
    const val = e.target.value.trimStart();
    if (/\d+$/.test(val)) {
      setF((s) => ({ ...s, asset_tag: val }));
      return;
    }
    const clean = val.replace(/[-\s]*\d+$/, "");
    if (!clean) {
      setF((s) => ({ ...s, asset_tag: "" }));
      return;
    }
    const next = getNextTagForSeries(clean, seriesStats);
    setF((s) => ({ ...s, asset_tag: next }));
  }
  const known = f.employee.trim() ? findStaff(f.employee) : null;
  // Staff rows are admin-written (RLS); others may pick a person but not edit one.
  const personEditable = isAdmin;

  async function save(e) {
    e.preventDefault();
    if (!editing && isLowerOrEqual) {
      return toast.error(`For ${parsedTag.prefix}, device number (${parsedTag.num}) must be greater than current number (${currentMaxNum}). Next valid item is ${getNextTagForSeries(parsedTag.prefix, seriesStats)}.`);
    }
    if (!editing && isDuplicate) {
      return toast.error(`Device name ${f.asset_tag} already exists in the system.`);
    }
    setBusy(true);
    const { data, error, warning } = await saveHardware(asset, { ...f, photo_path: joinPhotos(photos) }, { lookups, isAdmin });
    setBusy(false);
    if (error) return toast.error(error);
    if (warning) toast.error(warning);
    toast.success(editing ? `${data.asset_tag} updated.` : `${data.asset_tag} registered.`);
    onSaved(data);
  }

  async function remove() {
    setBusy(true);
    const { error } = await supabase.from("assets").delete().eq("asset_id", asset.asset_id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${asset.asset_tag} deleted. Its history is kept in the change log.`);
    onDeleted(asset);
  }

  const text = (k, label) => <L label={label}><input className={inputCls} value={f[k]} onChange={set(k)} /></L>;

  return (
    <form onSubmit={save}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="asset-form-title" className="text-lg font-semibold">{editing ? `Update ${asset.asset_tag}` : "Register IT hardware"}</h2>
        <QrScan onScan={scanned} onExisting={onExisting} />
      </div>
      {activate && (
        <p className="mb-4 rounded-lg border border-border bg-sunken px-3 py-2 text-sm">
          An Active device needs its current user. Fill in the <strong>Employee name</strong> and their details, then save.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <L label="Names">
          <input className={inputCls} value={currentSeries} onChange={setSeries} list="hw-series-list" placeholder="Series (e.g. TPPC, TPLL, TPDL, TPML)" />
          <datalist id="hw-series-list">
            {FIXED_SERIES.map((s) => {
              const info = seriesStats.get(s);
              return <option key={s} value={s}>{`Current #${info?.maxNum || 0} → Next: ${getNextTagForSeries(s, seriesStats)}`}</option>;
            })}
          </datalist>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted">Fixed:</span>
            {FIXED_SERIES.map((s) => {
              const info = seriesStats.get(s);
              const active = currentSeries === s;
              return (
                <button key={s} type="button" onClick={() => selectSeries(s)}
                  className={cn("rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
                    active ? "border-brand bg-brand/10 text-brand font-semibold" : "border-border bg-surface text-muted hover:border-brand/40 hover:text-foreground")}>
                  {s} <span className="opacity-75">#{info?.maxNum || 0}</span>
                </button>
              );
            })}
          </div>
        </L>
        <L label="Device name *">
          <input className={cn(inputCls, (isLowerOrEqual || isDuplicate) && "border-danger focus:border-danger focus:ring-danger")}
            value={f.asset_tag} onChange={set("asset_tag")} required autoFocus={!editing} />
          {isLowerOrEqual && (
            <span className="mt-1 block text-xs font-medium text-danger">
              ⚠️ Must be greater than current number ({currentMaxNum}). Next is {getNextTagForSeries(currentSeries, seriesStats)}.
            </span>
          )}
          {isDuplicate && (
            <span className="mt-1 block text-xs font-medium text-danger">
              ⚠️ Device name already exists in the system.
            </span>
          )}
          {!isLowerOrEqual && !isDuplicate && (
            <span className="mt-1 block text-xs text-muted">
              {currentMaxNum > 0 ? `Current number for ${currentSeries} is ${currentMaxNum} (next: ${getNextTagForSeries(currentSeries, seriesStats)})` : "Unique hardware tag."}
            </span>
          )}
        </L>
        <L label="Status">
          <select className={inputCls} value={f.hw_status} onChange={setStatus}>
            {HW_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </L>
        {text("workgroup", "Workgroup")}
        <L label="Remarks" wide><textarea rows={2} className={inputCls} value={f.remark} onChange={set("remark")} /></L>
        <L label="Device type *">
          <select className={inputCls} value={f.asset_type} onChange={set("asset_type")} required>
            {categories.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
        </L>
        <L label={activate ? "Employee name *" : "Employee name"}>
          <input className={inputCls} value={f.employee} onChange={setEmployee} list="hw-staff" placeholder={activate ? "Who is using it now" : "Blank = nobody"}
            required={activate && f.hw_status === "Active"} autoFocus={activate} />
          <datalist id="hw-staff">{lookups.staff.map((s) => <option key={s.staff_id} value={s.full_name} />)}</datalist>
          {f.employee.trim() && !known && (
            <span className="mt-1 block text-xs text-muted">{isAdmin ? "New person: saving adds them to the staff list." : "Not in the staff list."}</span>
          )}
        </L>
        <L label="Employee ID">
          <input className={inputCls} value={f.employee_no} onChange={set("employee_no")} disabled={!personEditable || !f.employee.trim()} />
        </L>
        {text("previous_user", "Previous users")}
        {text("plant", "Plant")}
        <L label="Location (store / cabinet / shelf)">
          <input className={inputCls} value={f.item_location} onChange={set("item_location")} list="item-locations"
            placeholder="Pick from the list, or type a new location" />
          <datalist id="item-locations">{lookups.itemLocations.map((l) => <option key={l} value={l} />)}</datalist>
        </L>
        <L label="Department">
          <input className={inputCls} value={f.department} onChange={set("department")} list="hw-dept" />
          <datalist id="hw-dept">{departments.map((d) => <option key={d} value={d} />)}</datalist>
        </L>
        <L label="Designation">
          <input className={inputCls} value={f.designation} onChange={set("designation")} disabled={!personEditable || !f.employee.trim()} />
        </L>
        <L label="Purchased year"><input type="date" className={inputCls} value={f.purchase_date} onChange={set("purchase_date")} /></L>
        <L label="Handover date">
          <input type="date" className={inputCls} value={f.handover_date} onChange={set("handover_date")}
            disabled={f.employee.trim().toLowerCase() === (asset?.holder || "").toLowerCase()} />
          <span className="mt-1 block text-xs text-muted">Set when the employee changes; blank = today.</span>
        </L>
        {text("mac_address", "MAC address")}
        {text("make", "Brand")}
        {text("model", "Model")}
        <div className="block">
          <span className="mb-1 block text-xs text-muted">Serial number</span>
          <SerialInput value={f.serial_no} onChange={set("serial_no")} setValue={(v) => setF((s) => ({ ...s, serial_no: v }))} onExisting={onExisting} />
        </div>
        {text("os", "OS")}
        {text("m365_license", "M365 license")}
        {text("office_product_key", "Office product key")}
        {text("ram", "RAM")}
        {text("storage", "HDD capacity")}
        {text("anydesk_id", "AnyDesk ID")}
        {text("special_app", "Special app")}
        {text("app_licenses", "App licenses")}
        {text("batch_number", "Batch number")}
        <L label="Vendor name">
          <select className={inputCls} value={f.vendor_id ?? ""} onChange={set("vendor_id")}>
            <option value="">—</option>
            {lookups.vendors.filter((v) => v.active !== false || v.vendor_id === asset?.vendor_id)
              .map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
          </select>
        </L>
        {text("powerapps_id", "PowerApps ID")}
        <PhotoPicker photos={photos} setPhotos={setPhotos} setBusy={setBusy} />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        {editing ? <HoldToConfirmButton label="Delete asset" onConfirm={remove} disabled={busy} /> : <span />}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
          <button disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg disabled:opacity-50">
            <Save className="h-4 w-4" />{busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
}
