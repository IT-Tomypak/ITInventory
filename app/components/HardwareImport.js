"use client";
// Import IT's hardware sheet (.xlsx or .csv). Nothing is written until the
// preview has been seen: new devices, every field that changes (old -> new),
// and every row with an error (never applied). Rules: lib/hardwareImport.js.
import { useState } from "react";
import Papa from "papaparse";
import { AlertTriangle, CheckCircle2, FileUp, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { readXlsx } from "../../lib/xlsxRead";
import { planImport } from "../../lib/hardwareImport";
import { saveHardware } from "../../lib/hardware";
import { cn } from "./ui";

const TABS = [
  ["apply", "To apply", (i) => i.kind === "new" || i.kind === "update"],
  ["error", "Errors", (i) => i.kind === "error"],
  ["same", "Unchanged", (i) => i.kind === "same"],
];
const show = (v) => (v === "" || v == null ? <span className="text-muted">(blank)</span> : String(v));

function Item({ it }) {
  return (
    <li className="rounded-xl border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{it.tag}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium",
          it.kind === "new" ? "bg-brand/10 text-brand" : it.kind === "error" ? "bg-danger/10 text-danger" : "bg-sunken text-muted")}>
          {{ new: "New device", update: `${it.changes.length} change${it.changes.length === 1 ? "" : "s"}`, error: "Not applied", same: "No change" }[it.kind]}
        </span>
        <span className="ml-auto text-xs text-muted">Excel row {it.line}</span>
      </div>
      {it.errors.map((e) => <p key={e} className="mt-1 flex gap-1.5 text-danger"><X className="mt-0.5 h-4 w-4 shrink-0" />{e}</p>)}
      {it.warnings.map((w) => <p key={w} className="mt-1 flex gap-1.5 text-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</p>)}
      {it.changes.length > 0 && (
        <table className="mt-2 w-full text-xs">
          <tbody>
            {it.changes.map((c) => (
              <tr key={c.label} className="border-t border-border">
                <td className="w-40 py-1 pr-2 text-muted">{c.label}</td>
                <td className="py-1 pr-2 line-through decoration-muted/60">{it.cur ? show(c.from) : ""}</td>
                <td className="py-1 font-medium">{show(c.to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}

export default function HardwareImport({ data, isAdmin, onDone, onClose }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("apply");
  const [progress, setProgress] = useState(null); // { done, total, failed: [] }

  async function pick(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setError(null); setPlan(null); setProgress(null);
    try {
      const table = /\.csv$/i.test(file.name)
        ? Papa.parse(await file.text(), { skipEmptyLines: false }).data
        : await readXlsx(file);
      const { items, skipped } = planImport(table, {
        assets: data.rows, categories: data.lookups.categories, staff: data.lookups.staff, vendors: data.lookups.vendors,
      });
      setPlan({ file: file.name, items, skipped });
      setTab(items.some(TABS[0][2]) ? "apply" : "error");
    } catch (err) {
      setError(err.message);
    }
  }

  async function apply() {
    const todo = plan.items.filter(TABS[0][2]);
    // A working copy: saveHardware appends people it creates, so later rows find them.
    const lookups = { ...data.lookups, staff: [...data.lookups.staff], vendors: [...data.lookups.vendors] };
    const failed = [];
    setProgress({ done: 0, total: todo.length, failed });
    for (const [n, it] of todo.entries()) {
      const f = { ...it.f };
      let err = null;
      if (it.newVendor) {
        const known = lookups.vendors.find((v) => v.name.toLowerCase() === it.newVendor.toLowerCase());
        if (known) f.vendor_id = known.vendor_id;
        else {
          const { data: v, error } = await supabase.from("vendors").insert({ name: it.newVendor }).select().single();
          if (error) err = error.message; else { lookups.vendors.push(v); f.vendor_id = v.vendor_id; }
        }
      }
      if (!err) {
        const r = await saveHardware(it.cur ?? null, f, { lookups, isAdmin });
        err = r.error || r.warning;
      }
      if (err) failed.push({ tag: it.tag, error: err });
      setProgress({ done: n + 1, total: todo.length, failed: [...failed] });
    }
    onDone();
  }

  const count = (k) => plan?.items.filter(TABS.find((t) => t[0] === k)[2]).length ?? 0;
  const news = plan?.items.filter((i) => i.kind === "new").length ?? 0;
  const shown = plan?.items.filter(TABS.find((t) => t[0] === tab)[2]) ?? [];
  const finished = progress && progress.done === progress.total;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 id="import-title" className="text-lg font-semibold">Import from Excel</h2>
        <button onClick={onClose} aria-label="Close" className="rounded-lg border border-border p-2"><X className="h-4 w-4" /></button>
      </div>

      {!progress && (
        <>
          <p className="text-sm text-muted">
            Use IT&apos;s hardware sheet (.xlsx or .csv) with its header row. Rows are matched by <b>Device name</b>; a new
            name adds a device. <b>Blank cells keep what is stored.</b> To free a device, set Status to Vacant and leave
            Employee name blank. Nothing is saved until you press Apply.
          </p>
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-brand">
            <FileUp className="h-4 w-4" /> {plan ? `Choose another file (${plan.file})` : "Choose file"}
            <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={pick} />
          </label>
        </>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}

      {plan && !progress && (
        <>
          <p className="mt-4 text-sm">
            <b>{count("apply")}</b> to apply ({news} new, {count("apply") - news} updated) · <b className={count("error") ? "text-danger" : ""}>{count("error")}</b> with
            errors · {count("same")} unchanged · {plan.skipped} blank rows skipped
          </p>
          <div className="mt-3 flex gap-1 rounded-xl border border-border bg-surface p-1" role="tablist">
            {TABS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={cn("rounded-lg px-3 py-1.5 text-sm", tab === k ? "bg-brand/10 font-medium text-brand" : "text-muted hover:text-fg")}>
                {label} ({count(k)})
              </button>
            ))}
          </div>
          <ul className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
            {shown.length ? shown.map((it) => <Item key={it.line} it={it} />) : <li className="text-sm text-muted">Nothing here.</li>}
          </ul>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            {count("error") > 0 && <span className="mr-auto text-xs text-muted">Rows with errors are skipped. Fix them in the sheet and import again.</span>}
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
            <button onClick={apply} disabled={!count("apply")}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg disabled:opacity-40">
              Apply {count("apply")} row{count("apply") === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}

      {progress && (
        <div className="mt-2 text-sm">
          <p>{finished ? "Done." : "Saving…"} {progress.done} of {progress.total}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-sunken">
            <div className="h-full bg-brand transition-[width]" style={{ width: `${(100 * progress.done) / (progress.total || 1)}%` }} />
          </div>
          {finished && (
            <>
              <p className="mt-3 flex items-center gap-1.5 text-ok">
                <CheckCircle2 className="h-4 w-4" /> {progress.total - progress.failed.length} saved.
              </p>
              {progress.failed.map((x) => <p key={x.tag} className="mt-1 text-danger">{x.tag}: {x.error}</p>)}
              <div className="mt-4 flex justify-end">
                <button onClick={onClose} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg">Close</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
