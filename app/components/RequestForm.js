"use client";
// The equipment request form and its printed-docket receipt. Shared by the
// public /request page (no login) and the internal /entry page.
import { useEffect, useState } from "react";
import { Camera, Download, ImagePlus, Search, Send, X } from "lucide-react";
import { ASSET_TYPES } from "../../lib/assets";
import { buildReceiptPdf, receiptTime } from "../../lib/receipt-pdf";
import { COMPANY } from "../../lib/site";
import { inputCls } from "./AssetForm";
import { cn } from "./ui";

export const MAX_PHOTOS = 4;

function L({ label, children, className }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

/**
 * onSubmit({ name, department, asset_type, urgency, justification }, files)
 * must resolve to a receipt object, or throw an Error whose message is shown
 * to the person as-is (so make it human).
 */
export function RequestForm({ defaultName = "", defaultDepartment = "", onSubmit, onDone }) {
  const [f, setF] = useState({ name: defaultName, department: defaultDepartment, asset_type: "Laptop", urgency: "Normal", justification: "" });
  const [files, setFiles] = useState([]); // { file, url }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => () => files.forEach((x) => URL.revokeObjectURL(x.url)), [files]);

  function addFiles(e) {
    const picked = [...e.target.files].filter((file) => file.type.startsWith("image/"));
    e.target.value = "";
    setFiles((cur) => [...cur, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, MAX_PHOTOS));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const receipt = await onSubmit({
        name: f.name.trim(), department: f.department.trim(), asset_type: f.asset_type,
        urgency: f.urgency, justification: f.justification.trim(),
      }, files.map((x) => x.file));
      onDone(receipt);
    } catch (err) {
      setError(err.message || String(err));
    }
    setBusy(false);
  }

  const room = MAX_PHOTOS - files.length;
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <L label="Your name *"><input className={inputCls} value={f.name} onChange={set("name")} required maxLength={100} autoComplete="name" /></L>
        <L label="Department *"><input className={inputCls} value={f.department} onChange={set("department")} required maxLength={100} /></L>
        <L label="What do you need? *">
          <select className={inputCls} value={f.asset_type} onChange={set("asset_type")}>
            {ASSET_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </L>
        <div>
          <span className="mb-1 block text-sm font-medium">Urgency</span>
          <div className="flex gap-2">
            {["Normal", "Urgent"].map((u) => (
              <button type="button" key={u} aria-pressed={f.urgency === u} onClick={() => setF((s) => ({ ...s, urgency: u }))}
                className={cn("flex-1 rounded-lg border px-3 py-2 text-sm",
                  f.urgency === u ? (u === "Urgent" ? "border-danger bg-danger/10 font-medium text-danger" : "border-brand bg-brand/10 font-medium text-brand") : "border-border")}>
                {u}
              </button>
            ))}
          </div>
        </div>
      </div>
      <L label="Why do you need it?">
        <textarea rows={4} className={inputCls} value={f.justification} onChange={set("justification")} maxLength={2000}
          placeholder="e.g. My laptop no longer charges; I need one for month-end closing." />
        <span className="mt-1 block text-right text-xs text-muted">{f.justification.length} / 2000</span>
      </L>
      <p className="-mt-2 text-xs text-muted">This is for hardware only. For software or account problems, contact IT directly.</p>

      <div>
        <span className="mb-1 block text-sm font-medium">Photos (optional, up to {MAX_PHOTOS})</span>
        <div className="flex flex-wrap gap-2">
          {files.map((x, i) => (
            <span key={x.url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={x.url} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded-lg border border-border object-cover" />
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setFiles((cur) => cur.filter((y) => y !== x))}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-danger p-0.5 text-white"><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
          {room > 0 && (
            <>
              {/* capture opens the camera directly on a phone; desktop browsers ignore it */}
              <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted hover:border-brand">
                <Camera className="h-5 w-5" /> Camera
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={addFiles} />
              </label>
              <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted hover:border-brand">
                <ImagePlus className="h-5 w-5" /> Choose
                <input type="file" accept="image/*" multiple className="sr-only" onChange={addFiles} />
              </label>
            </>
          )}
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 font-medium text-brand-fg disabled:opacity-50 sm:w-auto">
        <Send className="h-4 w-4" />{busy ? (files.length ? "Uploading photos…" : "Sending…") : "Send request"}
      </button>
    </form>
  );
}

// The PDF is generated in the browser, so nothing about the request leaves the
// site to produce it. The same bytes are archived server-side (store-receipt).
export function downloadReceipt(r) {
  const bytes = buildReceiptPdf({ ...r, statusUrl: `${window.location.origin}/status/?id=${r.requestId}`, company: COMPANY });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })),
    download: `ITrack-Request-${r.requestId}.pdf`,
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** receipt = { requestId, createdAt, name, department, assetType, urgency, photoCount, justification } */
export function RequestReceipt({ receipt: r, onAnother }) {
  const rows = [["Requested by", r.name], ["Department", r.department], ["Asset type", r.assetType],
    ["Urgency", r.urgency], ["Photos attached", r.photoCount]];
  return (
    <div className="mx-auto max-w-md">
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm" data-testid="receipt">
        <div className="flex items-center justify-between bg-[#1d1d1f] px-5 py-4 text-white">
          <div><p className="text-lg font-bold">ITrack</p><p className="text-xs text-white/70">IT Asset Management</p></div>
          <div className="text-right"><p className="text-xs font-bold tracking-wide">EQUIPMENT REQUEST</p><p className="text-xs text-white/70">Receipt</p></div>
        </div>
        <div className="p-5">
          <p className="text-xs text-muted">Request number</p>
          <div className="flex items-end justify-between gap-2">
            <p className="text-4xl font-bold tracking-tight" data-testid="request-number">#{r.requestId}</p>
            <p className="pb-1 text-sm text-muted">{receiptTime(r.createdAt)}</p>
          </div>
          <hr className="my-4 border-dashed border-border" />
          <dl className="space-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>
            ))}
          </dl>
          {r.justification && (
            <>
              <hr className="my-4 border-dashed border-border" />
              <p className="text-xs text-muted">Justification</p>
              <p className="mt-1 whitespace-pre-line break-words text-sm">{r.justification}</p>
            </>
          )}
          <hr className="my-4 border-dashed border-border" />
          <p className="text-xs text-muted">Keep this receipt and quote the number when you contact IT.</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button onClick={() => downloadReceipt(r)}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 font-medium text-brand-fg">
          <Download className="h-4 w-4" /> Download receipt
        </button>
        <a href={`/status/?id=${r.requestId}`} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 font-medium">
          <Search className="h-4 w-4" /> Track this request
        </a>
      </div>
      {onAnother && <button onClick={onAnother} className="mt-3 w-full text-sm text-muted hover:text-fg">Make another request</button>}
    </div>
  );
}
