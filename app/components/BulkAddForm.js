"use client";
// Register several accessories of ONE category in one save: the shared details
// are typed once and each item gets the next free tag. One INSERT statement,
// so either every item is registered or none is.
import { useState } from "react";
import { Save } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { inputCls } from "./AssetForm";
import { toast } from "./ui";
import QrScan from "./QrScan";

const MAX = 200;
const nz = (v) => v.trim() || null;

// "ACC-012", 3 -> ["ACC-012", "ACC-013", "ACC-014"]
export function tagRun(first, count) {
  const [, prefix, digits] = first.match(/^(.*?)(\d+)$/);
  return Array.from({ length: count }, (_, i) => prefix + String(Number(digits) + i).padStart(digits.length, "0"));
}

export default function BulkAddForm({ lookups, list, nextTag, departments, onSaved, onCancel }) {
  const categories = lookups.categories.filter((c) => c.list === list && c.active);
  const [f, setF] = useState({ asset_type: categories[0]?.name ?? "", quantity: 2, make: "", model: "", item_location: "", department: "", serials: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  // Serial numbers are optional. When given, there is one item per line.
  const serials = f.serials.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const count = serials.length || Number(f.quantity) || 0;
  const tags = count > 0 && count <= MAX ? tagRun(nextTag, count) : [];

  async function save(e) {
    e.preventDefault();
    if (!tags.length) return toast.error(`Enter a quantity from 1 to ${MAX}.`);
    if (new Set(serials.map((s) => s.toUpperCase())).size !== serials.length) return toast.error("The same serial number is listed twice.");
    setBusy(true);
    const { error } = await supabase.from("assets").insert(tags.map((asset_tag, i) => ({
      asset_tag, asset_type: f.asset_type, make: nz(f.make), model: nz(f.model),
      item_location: nz(f.item_location), department: nz(f.department), serial_no: serials[i] ?? null,
    })));
    setBusy(false);
    if (error) {
      return toast.error(error.code === "23505" ? "One of these tags was registered by someone else just now. Nothing was added; close this and try again." : error.message);
    }
    toast.success(`${tags.length} ${f.asset_type} item${tags.length === 1 ? "" : "s"} registered: ${tags[0]} to ${tags[tags.length - 1]}.`);
    onSaved();
  }

  const L = "mb-1 block text-xs text-muted";
  return (
    <form onSubmit={save}>
      <h2 id="asset-form-title" className="mb-4 text-lg font-semibold">Bulk add items</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className={L}>Category *</span>
          <select className={inputCls} value={f.asset_type} onChange={set("asset_type")} required autoFocus>
            {categories.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
        </label>
        <label className="block"><span className={L}>Quantity *</span>
          <input type="number" min="1" max={MAX} className={inputCls} required disabled={serials.length > 0}
            value={serials.length || f.quantity} onChange={set("quantity")} />
        </label>
        <label className="block"><span className={L}>Make</span><input className={inputCls} value={f.make} onChange={set("make")} /></label>
        <label className="block"><span className={L}>Model</span><input className={inputCls} value={f.model} onChange={set("model")} /></label>
        <label className="block"><span className={L}>Location (store / cabinet / shelf)</span>
          <input className={inputCls} value={f.item_location} onChange={set("item_location")} list="bulk-item-locations" />
          <datalist id="bulk-item-locations">{lookups.itemLocations.map((l) => <option key={l} value={l} />)}</datalist>
        </label>
        <label className="block"><span className={L}>Owning department</span>
          <input className={inputCls} value={f.department} onChange={set("department")} list="bulk-dept-list" />
          <datalist id="bulk-dept-list">{departments.map((d) => <option key={d} value={d} />)}</datalist>
        </label>
        <div className="col-span-full">
          <label className="block"><span className={L}>Serial numbers (optional, one per line; sets the quantity)</span>
            <textarea rows={4} className={inputCls} value={f.serials} onChange={set("serials")} />
          </label>
          <div className="mt-1.5">
            <QrScan label="Scan serial" parse={(t) => ({ serial_no: String(t).trim() })}
              onScan={(v) => setF((s) => ({ ...s, serials: (s.serials.trimEnd() ? s.serials.trimEnd() + "\n" : "") + v.serial_no }))} />
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted" data-testid="bulk-preview">
        {tags.length ? `Registers ${tags.length} item${tags.length === 1 ? "" : "s"} as In stock, tagged ${tags[0]}${tags.length > 1 ? ` to ${tags[tags.length - 1]}` : ""}.`
          : `Enter a quantity from 1 to ${MAX}.`}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
        <button disabled={busy || !tags.length} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg disabled:opacity-50">
          <Save className="h-4 w-4" />{busy ? "Saving…" : `Add ${tags.length || ""} items`}
        </button>
      </div>
    </form>
  );
}
