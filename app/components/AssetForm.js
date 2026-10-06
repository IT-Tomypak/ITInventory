"use client";
// Create or edit one asset. Rendered only for non-viewers; the database
// refuses a viewer's write regardless (RLS "write for non-viewers").
import { useState } from "react";
import { Camera, Save, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { ASSET_TYPES, MANUAL_STATUSES } from "../../lib/assets";
import { joinPhotos, splitPhotos, uploadPhoto } from "../../lib/photos";
import { HoldToConfirmButton, toast } from "./ui";

export const inputCls = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:opacity-60";
const nz = (v) => (typeof v === "string" ? v.trim() || null : v ?? null);
const num = (v) => (v === "" || v == null ? null : Number(v));

function L({ label, children, wide }) {
  return (
    <label className={wide ? "col-span-full block" : "block"}>
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

export default function AssetForm({ asset, lookups, departments, isAdmin, onSaved, onDeleted, onCancel }) {
  const editing = !!asset;
  const custody = editing && ["Assigned", "Loaned"].includes(asset.status);
  const [f, setF] = useState(() => ({
    asset_tag: asset?.asset_tag ?? "", asset_type: asset?.asset_type ?? "Laptop",
    make: asset?.make ?? "", model: asset?.model ?? "", serial_no: asset?.serial_no ?? "",
    status: asset?.status ?? "In stock", location_id: asset?.location_id ?? "", department: asset?.department ?? "",
    purchase_date: asset?.purchase_date ?? "", po_no: asset?.po_no ?? "", invoice_no: asset?.invoice_no ?? "",
    vendor_id: asset?.vendor_id ?? "", warranty_end: asset?.warranty_end ?? "",
    refresh_years: asset?.refresh_years ?? 4, refresh_due: asset?.refresh_due ?? "",
    spec_notes: asset?.spec_notes ?? "", active: asset?.active ?? true,
    purchase_cost_rm: asset?.purchase_cost_rm ?? "",
  }));
  const [photos, setPhotos] = useState(() => splitPhotos(asset?.photo_path));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function addPhotos(e) {
    const files = [...e.target.files];
    e.target.value = "";
    setBusy(true);
    try {
      const urls = [];
      for (const file of files) urls.push(await uploadPhoto(file, "assets"));
      setPhotos((p) => [...p, ...urls]);
    } catch (err) {
      toast.error("Photo upload failed: " + err.message);
    }
    setBusy(false);
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const payload = {
      asset_tag: nz(f.asset_tag), asset_type: f.asset_type, make: nz(f.make), model: nz(f.model),
      serial_no: nz(f.serial_no), location_id: num(f.location_id), department: nz(f.department),
      purchase_date: nz(f.purchase_date), po_no: nz(f.po_no), invoice_no: nz(f.invoice_no),
      vendor_id: num(f.vendor_id), warranty_end: nz(f.warranty_end), refresh_years: num(f.refresh_years),
      refresh_due: nz(f.refresh_due), spec_notes: nz(f.spec_notes), photo_path: joinPhotos(photos), active: f.active,
    };
    // Status is sent only when it changed, so an edit never re-asserts a custody status.
    if (!custody && f.status !== asset?.status) payload.status = f.status;
    const q = editing
      ? supabase.from("assets").update(payload).eq("asset_id", asset.asset_id).select().single()
      : supabase.from("assets").insert(payload).select().single();
    const { data, error } = await q;
    if (error) {
      setBusy(false);
      return toast.error(error.code === "23505" ? `Asset tag ${payload.asset_tag} already exists.` : error.message);
    }
    if (isAdmin && String(f.purchase_cost_rm) !== String(asset?.purchase_cost_rm ?? "")) {
      const { error: e2 } = await supabase.from("asset_value")
        .upsert({ asset_id: data.asset_id, purchase_cost_rm: num(f.purchase_cost_rm) });
      if (e2) toast.error("Saved, but the purchase cost was not: " + e2.message);
    }
    setBusy(false);
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

  const activeOnly = (rows, key, current) => rows.filter((r) => r.active !== false || r[key] === current);

  return (
    <form onSubmit={save}>
      <h2 id="asset-form-title" className="mb-4 text-lg font-semibold">{editing ? `Update ${asset.asset_tag}` : "Register an asset"}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <L label="Asset tag *"><input className={inputCls} value={f.asset_tag} onChange={set("asset_tag")} required autoFocus={!editing} /></L>
        <L label="Type *">
          <select className={inputCls} value={f.asset_type} onChange={set("asset_type")}>
            {ASSET_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </L>
        <L label="Make"><input className={inputCls} value={f.make} onChange={set("make")} /></L>
        <L label="Model"><input className={inputCls} value={f.model} onChange={set("model")} /></L>
        <L label="Serial no"><input className={inputCls} value={f.serial_no} onChange={set("serial_no")} /></L>
        <L label="Status">
          {custody ? (
            <>
              <input className={inputCls} value={f.status} disabled />
              <span className="mt-1 block text-xs text-muted">Set by Allocate / Return while the asset is held.</span>
            </>
          ) : (
            <select className={inputCls} value={f.status} onChange={set("status")}>
              {MANUAL_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          )}
        </L>
        <L label="Location">
          <select className={inputCls} value={f.location_id ?? ""} onChange={set("location_id")}>
            <option value="">—</option>
            {activeOnly(lookups.locations, "location_id", asset?.location_id).map((l) => <option key={l.location_id} value={l.location_id}>{l.name}</option>)}
          </select>
        </L>
        <L label="Owning department">
          <input className={inputCls} value={f.department} onChange={set("department")} list="dept-list" />
          <datalist id="dept-list">{departments.map((d) => <option key={d} value={d} />)}</datalist>
        </L>
        <L label="Purchase date"><input type="date" className={inputCls} value={f.purchase_date} onChange={set("purchase_date")} /></L>
        <L label="Vendor">
          <select className={inputCls} value={f.vendor_id ?? ""} onChange={set("vendor_id")}>
            <option value="">—</option>
            {activeOnly(lookups.vendors, "vendor_id", asset?.vendor_id).map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
          </select>
        </L>
        <L label="PO no"><input className={inputCls} value={f.po_no} onChange={set("po_no")} /></L>
        <L label="Invoice no"><input className={inputCls} value={f.invoice_no} onChange={set("invoice_no")} /></L>
        <L label="Warranty end"><input type="date" className={inputCls} value={f.warranty_end} onChange={set("warranty_end")} /></L>
        <L label="Refresh cycle (years)"><input type="number" min="1" max="20" className={inputCls} value={f.refresh_years ?? ""} onChange={set("refresh_years")} /></L>
        <L label="Refresh due (blank = purchase date + cycle)"><input type="date" className={inputCls} value={f.refresh_due} onChange={set("refresh_due")} /></L>
        {isAdmin && (
          <L label="Purchase cost (RM) — admins only">
            <input type="number" min="0" step="0.01" className={inputCls} value={f.purchase_cost_rm} onChange={set("purchase_cost_rm")} />
          </L>
        )}
        <L label="Spec notes (CPU / RAM / disk…)" wide>
          <textarea rows={3} className={inputCls} value={f.spec_notes} onChange={set("spec_notes")} />
        </L>
        <div className="col-span-full">
          <span className="mb-1 block text-xs text-muted">Photos</span>
          <div className="flex flex-wrap gap-2">
            {photos.map((u) => (
              <span key={u} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" className="h-20 w-20 rounded-lg border border-border object-cover" />
                <button type="button" aria-label="Remove photo" onClick={() => setPhotos((p) => p.filter((x) => x !== u))}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-danger p-0.5 text-white"><X className="h-3.5 w-3.5" /></button>
              </span>
            ))}
            <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted hover:border-brand">
              <Camera className="h-5 w-5" /> Add
              <input type="file" accept="image/*" multiple className="sr-only" onChange={addPhotos} />
            </label>
          </div>
        </div>
        {editing && (
          <label className="col-span-full flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.active} onChange={set("active")} /> Active (untick to hide from day-to-day lists)
          </label>
        )}
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
