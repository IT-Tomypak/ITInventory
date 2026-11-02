"use client";
// Allocate / Return — check-out and check-in. Both go through ONE atomic RPC
// (allocate_asset / return_asset); the page never writes tables directly.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Building2, Check, History, Search, User, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { CONDITIONS, fmtDate, fmtDateTime, loadRegister, today } from "../../lib/assets";
import { MAX_HANDOVER_ITEMS, buildHandoverPdf, downloadPdf } from "../../lib/handover-pdf";
import { COMPANY } from "../../lib/site";
import { useAuth } from "../components/AuthProvider";
import { inputCls } from "../components/AssetForm";
import { Card, EmptyState, PageHeader, StatusBadge, TableSkeleton, cn, toast } from "../components/ui";

// A searchable toggle list. Not <select multiple>, which is unusable on a phone.
// With `multi`, selected is an array and onSelect gets the item that was toggled.
function PickList({ items, selected, onSelect, label, placeholder, empty, render, match, multi = false }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? items.filter((i) => match(i).some((v) => v?.toLowerCase().includes(t))) : items).slice(0, 50);
  }, [items, q, match]);
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
        <input className={cn(inputCls, "pl-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={`Search ${label.toLowerCase()}`} />
      </div>
      <ul role="listbox" aria-label={label} aria-multiselectable={multi} className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {shown.length === 0 && <li className="p-3 text-sm text-muted">{empty}</li>}
        {shown.map((item) => {
          const on = multi ? selected.some((s) => s.key === item.key) : selected?.key === item.key;
          return (
            <li key={item.key} role="option" aria-selected={on}>
              <button type="button" onClick={() => onSelect(multi || !on ? item : null)}
                className={cn("flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm", on ? "bg-brand/10" : "hover:bg-sunken")}>
                <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border", multi ? "rounded" : "rounded-full", on ? "border-brand bg-brand text-brand-fg" : "border-border")}>
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">{render(item)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {items.length > 50 && shown.length === 50 && <p className="mt-1 text-xs text-muted">Showing the first 50 — search to narrow.</p>}
    </div>
  );
}

const toggled = (list, item) => (list.some((x) => x.key === item.key) ? list.filter((x) => x.key !== item.key) : [...list, item]);

// What is picked so far. The list above is filtered by category, so a picked PC
// drops out of view once the filter moves to Mouse; it must still show here.
function Picked({ items, onRemove }) {
  if (!items.length) return null;
  return (
    <div className="mt-2">
      <p className="mb-1 text-xs text-muted">Selected ({items.length})</p>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((a) => (
          <li key={a.key} className="inline-flex items-center gap-1 rounded-lg border border-brand bg-brand/10 py-1 pl-2 pr-1 text-sm">
            <span className="font-medium">{a.asset_tag}</span><span className="text-muted">{a.asset_type}</span>
            <button type="button" onClick={() => onRemove(a)} aria-label={`Remove ${a.asset_tag}`} className="rounded p-0.5 hover:bg-sunken"><X className="h-3.5 w-3.5" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const L = ({ label, children }) => (
  <label className="block"><span className="mb-1 block text-xs text-muted">{label}</span>{children}</label>
);
const assetMatch = (a) => [a.asset_tag, a.serial_no, a.make, a.model, a.holder, a.asset_type, a.department, a.item_location, a.fa_code];
const assetLine = (a) => (
  <>
    <span className="flex items-center gap-2"><span className="font-medium">{a.asset_tag}</span><StatusBadge status={a.status} /></span>
    <span className="block text-muted">{a.asset_type} · {[a.make, a.model].filter(Boolean).join(" ") || "—"}{a.serial_no && ` · ${a.serial_no}`}</span>
    {a.holder && <span className="block text-muted">Held by {a.holder} since {fmtDate(a.holder_since)}</span>}
  </>
);

const EMPTY_OUT = { assets: [], holderKind: "staff", staff: null, location: null, issued_on: "", loan: false, due_back_on: "", condition_out: "Good", notes_out: "", purpose: "", request_id: "" };
const EMPTY_IN = { assets: [], returned_on: "", condition_in: "Good", notes_in: "", return_status: "In stock", reason: "" };
const RETURN_REASONS = ["Resigned", "Retired", "Terminated", "Transferred", "Replacement / upgrade", "Faulty / repair", "Loan ended", "No longer needed", "Other"];

export default function AllocatePage() {
  // isViewer only decides what is rendered; the RPCs refuse viewers themselves.
  const { isViewer, fullName } = useAuth();
  const [mode, setMode] = useState("out");
  const [data, setData] = useState(null);
  const [requests, setRequests] = useState([]);
  const [moves, setMoves] = useState(null);
  const [error, setError] = useState(null);
  const [out, setOut] = useState(EMPTY_OUT);
  const [inn, setInn] = useState(EMPTY_IN);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [reg, req, mv] = await Promise.all([
        loadRegister({ withCost: false }),
        supabase.from("equipment_request").select("request_id, requested_by_name, department, asset_type, urgency, created_at")
          .in("status", ["Requested", "Approved"]).order("created_at"),
        supabase.from("asset_audit").select("*").in("action", ["assigned", "returned"]).order("changed_at", { ascending: false }).limit(20),
      ]);
      if (req.error) throw req.error;
      if (mv.error) throw mv.error;
      setData(reg);
      setRequests(req.data);
      setMoves(mv.data);
      setError(null);
      return reg;
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // Deep links: /allocate/?asset=12 picks the right mode; ?request=34 pre-links a request; ?due= starts a loan.
  useEffect(() => {
    reload().then((reg) => {
      if (!reg) return;
      const p = new URLSearchParams(window.location.search);
      const a = reg.rows.find((r) => String(r.asset_id) === p.get("asset"));
      const req = p.get("request");
      if (a?.holder) { setMode("in"); setInn((s) => ({ ...s, assets: [{ ...a, key: a.asset_id }] })); }
      else if (a) setOut((s) => ({ ...s, assets: [{ ...a, key: a.asset_id }] }));
      if (req) setOut((s) => ({ ...s, request_id: req }));
      // ?due=2026-10-20 from a loan request: start the form as a loan due back then.
      if (p.get("due")) setOut((s) => ({ ...s, loan: true, due_back_on: p.get("due") }));
    });
  }, [reload]);

  // Handover lists only unheld items: a held one is returned first, then handed over
  // again. allocate_asset refuses the rest (In repair, Damaged…) with its reason.
  const [cat, setCat] = useState("");
  const categories = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.asset_type))].sort(), [data]);
  const pick = (keep) => (data?.rows ?? []).filter((r) => keep(r) && (!cat || r.asset_type === cat)).map((r) => ({ ...r, key: r.asset_id }));
  const free = pick((r) => !r.holder);
  const held = pick((r) => r.holder);
  const catFilter = (
    <select aria-label="Filter by category" className={cn(inputCls, "mb-2")} value={cat} onChange={(e) => setCat(e.target.value)}>
      <option value="">All categories</option>
      {categories.map((c) => <option key={c}>{c}</option>)}
    </select>
  );
  const staffItems = useMemo(() => (data?.lookups.staff ?? []).map((s) => ({ ...s, key: s.staff_id })), [data]);
  const locItems = useMemo(() => (data?.lookups.locations ?? []).filter((l) => l.active !== false).map((l) => ({ ...l, key: l.location_id })), [data]);
  // Requests for the chosen assets' types first: that is almost always the match.
  const requestOptions = useMemo(() => {
    const has = (r) => out.assets.some((a) => a.asset_type === r.asset_type);
    return [...requests].sort((a, b) => has(b) - has(a));
  }, [requests, out.assets]);

  async function checkOut(e) {
    e.preventDefault();
    const holder = out.holderKind === "staff" ? out.staff : out.location;
    if (!out.assets.length || !holder) return toast.error(!out.assets.length ? "Pick an asset." : "Pick who or where will hold it.");
    if (out.holderKind === "staff" && out.assets.length > MAX_HANDOVER_ITEMS) return toast.error(`One handover form holds ${MAX_HANDOVER_ITEMS} items. Issue the rest on a second form.`);
    setBusy(true);
    // A request closes on its first allocation, so only one item can carry it:
    // the one of the requested type, else the first.
    const req = requests.find((r) => String(r.request_id) === out.request_id);
    const linked = out.assets.find((a) => a.asset_type === req?.asset_type) ?? out.assets[0];
    // One atomic RPC per item. A refused item does not undo the others; it stays selected to retry.
    const issued = [], failed = [];
    for (const a of out.assets) {
      const { error } = await supabase.rpc("allocate_asset", {
        p_request_id: out.request_id && a === linked ? Number(out.request_id) : null,
        p_asset_id: a.asset_id,
        p_staff_id: out.holderKind === "staff" ? out.staff.staff_id : null,
        p_location_id: out.holderKind === "location" ? out.location.location_id : out.location?.location_id ?? null,
        p_issued_on: out.issued_on || today(),
        p_due_back_on: out.loan ? out.due_back_on || null : null,
        p_condition_out: out.condition_out,
        p_notes_out: out.notes_out,
      });
      if (error) { failed.push(a); toast.error(error.message); } else issued.push(a);
    }
    setBusy(false);
    // The handover form the recipient signs. Only a person signs; a location does not.
    if (issued.length && out.holderKind === "staff") {
      const label = issued.length === 1 ? issued[0].asset_tag : `${issued.length}-items`;
      downloadPdf(buildHandoverPdf({
        fullName: out.staff.full_name, employeeNo: out.staff.employee_no, designation: out.staff.role,
        department: out.staff.department, purpose: out.purpose, dateReceived: out.issued_on || today(),
        devices: issued.map((a) => ({ type: a.asset_type, name: a.asset_tag })), issuedBy: fullName, company: COMPANY,
      }), `Handover-${label}-${out.staff.full_name}.pdf`);
    }
    if (issued.length) toast.success(`${issued.map((a) => a.asset_tag).join(", ")} ${out.loan ? "loaned" : "issued"} to ${holder.full_name || holder.name}.`);
    setOut(failed.length ? (s) => ({ ...s, assets: failed, request_id: failed.includes(linked) ? s.request_id : "" }) : EMPTY_OUT);
    reload();
  }

  async function checkIn(e) {
    e.preventDefault();
    if (!inn.assets.length) return toast.error("Pick the asset being returned.");
    if (!inn.reason) return toast.error("Pick a reason for the return.");
    setBusy(true);
    const returned = [], failed = [];
    for (const a of inn.assets) {
      // The reason rides in notes_in, so custody history shows it with no extra column.
      const { error } = await supabase.rpc("return_asset", {
        p_asset_id: a.asset_id,
        p_returned_on: inn.returned_on || today(),
        p_condition_in: inn.condition_in,
        p_notes_in: [inn.reason, inn.notes_in.trim()].filter(Boolean).join(" — "),
        p_return_status: inn.return_status,
      });
      if (error) { failed.push(a); toast.error(`${a.asset_tag}: ${error.message}`); continue; }
      returned.push(a);
      if (a.list === "inventory") {
        await supabase.from("assets").update({
          hw_status: "Vacant",
          previous_user: a.holder || undefined,
        }).eq("asset_id", a.asset_id);
      }
    }
    setBusy(false);
    if (returned.length) toast.success(`${returned.map((a) => `${a.asset_tag} (${a.holder})`).join(", ")} returned — now ${inn.return_status}.`);
    setInn(failed.length ? (s) => ({ ...s, assets: failed }) : EMPTY_IN);
    reload();
  }

  const so = (k) => (e) => setOut((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const si = (k) => (e) => setInn((s) => ({ ...s, [k]: e.target.value }));
  const holderName = out.holderKind === "staff" ? out.staff?.full_name : out.location?.name;
  const toggleOut = (a) => setOut((s) => ({ ...s, assets: toggled(s.assets, a) }));
  const toggleIn = (a) => setInn((s) => ({ ...s, assets: toggled(s.assets, a) }));
  // Returned on cannot precede any selected item's issue date (return_asset refuses it).
  const minReturn = inn.assets.map((a) => a.holder_since).filter(Boolean).sort().at(-1);
  const countOf = (n) => (n > 1 ? ` ${n} assets` : " asset");

  return (
    <>
      <PageHeader title="Allocate / Return" help="allocate-return"
        subtitle="Issue an asset to a person or a location, and take it back, with a condition note at each end." />
      {error && <Card className="mb-4 p-4 text-danger" role="alert">Error loading data: {error}</Card>}

      {isViewer ? (
        <Card className="mb-4 p-4 text-sm text-muted">Your access level is read-only. Recent movements are shown below.</Card>
      ) : (
        <>
          <div role="tablist" className="mb-4 inline-flex rounded-xl border border-border bg-surface p-1">
            {[["out", "Handover", ArrowUpFromLine], ["in", "Return", ArrowDownToLine]].map(([k, label, Icon]) => (
              <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                className={cn("inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium", mode === k ? "bg-brand text-brand-fg" : "text-muted")}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </div>

          {!data && !error && <Card className="p-4"><TableSkeleton rows={6} cols={3} /></Card>}

          {data && mode === "out" && (
            <form onSubmit={checkOut} className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <h2 className="mb-3 font-semibold">1. Assets <span className="font-normal text-muted">({free.length} available)</span></h2>
                {catFilter}
                <PickList multi items={free} selected={out.assets} onSelect={toggleOut}
                  label="Assets to issue" placeholder="Search tag, serial, make, model, FA code" empty="No available assets match."
                  render={assetLine} match={assetMatch} />
                <Picked items={out.assets} onRemove={toggleOut} />
                <p className="mt-1 text-xs text-muted">Pick as many as this person is receiving; they share one handover form. Items in use are not listed. Return them first, then hand them over again.</p>
              </Card>

              <Card className="p-4">
                <h2 className="mb-3 font-semibold">2. Holder</h2>
                <div className="mb-3 inline-flex rounded-lg border border-border p-0.5 text-sm">
                  {[["staff", "Person", User], ["location", "Location", Building2]].map(([k, label, Icon]) => (
                    <button type="button" key={k} onClick={() => setOut((s) => ({ ...s, holderKind: k }))} aria-pressed={out.holderKind === k}
                      className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5", out.holderKind === k ? "bg-brand/10 font-medium text-brand" : "text-muted")}>
                      <Icon className="h-4 w-4" />{label}
                    </button>
                  ))}
                </div>
                {out.holderKind === "staff" ? (
                  <>
                    <PickList items={staffItems} selected={out.staff} onSelect={(s) => setOut((o) => ({ ...o, staff: s }))}
                      label="Person" placeholder="Search staff" empty={staffItems.length ? "No staff match." : "No staff records yet — add them in User Management."}
                      render={(s) => <><span className="font-medium">{s.full_name}</span>{s.employee_no && <span className="text-muted"> · {s.employee_no}</span>}{s.department && <span className="text-muted"> · {s.department}</span>}</>}
                      match={(s) => [s.full_name, s.department, s.employee_no]} />
                    <p className="mt-2 text-sm">
                      Primary holder: <span className="font-medium">{out.staff?.full_name ?? "none chosen"}</span>
                      <span className="text-muted"> — one person holds each asset; they receive the handover email.</span>
                    </p>
                    {out.staff && (
                      <p className="mt-1 text-sm">
                        Employee ID: {out.staff.employee_no
                          ? <span className="font-medium">{out.staff.employee_no}</span>
                          : <span className="text-danger">not on their staff record, so the form will show "-". Add it in User Management.</span>}
                      </p>
                    )}
                    <div className="mt-3"><L label="Where it will be (optional)">
                      <select className={inputCls} value={out.location?.location_id ?? ""}
                        onChange={(e) => setOut((o) => ({ ...o, location: locItems.find((l) => String(l.location_id) === e.target.value) ?? null }))}>
                        <option value="">—</option>
                        {locItems.map((l) => <option key={l.location_id} value={l.location_id}>{l.name}</option>)}
                      </select>
                    </L></div>
                  </>
                ) : (
                  <PickList items={locItems} selected={out.location} onSelect={(l) => setOut((o) => ({ ...o, location: l }))}
                    label="Location" placeholder="Search locations" empty="No locations — add them in Data Management."
                    render={(l) => <span className="font-medium">{l.name}</span>} match={(l) => [l.name]} />
                )}
              </Card>

              <Card className="p-4 lg:col-span-2">
                <h2 className="mb-3 font-semibold">3. Details</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <L label="Issued on"><input type="date" className={inputCls} value={out.issued_on || today()} onChange={so("issued_on")} /></L>
                  <L label="Condition out">
                    <select className={inputCls} value={out.condition_out} onChange={so("condition_out")}>{CONDITIONS.map((c) => <option key={c}>{c}</option>)}</select>
                  </L>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <input type="checkbox" checked={out.loan} onChange={so("loan")} className="h-4 w-4" /> Loan — due back on a date
                  </label>
                  {out.loan && <L label="Due back"><input type="date" required className={inputCls} value={out.due_back_on} min={out.issued_on || today()} onChange={so("due_back_on")} /></L>}
                  <div className="sm:col-span-2">
                    <L label="Against request (optional)">
                      <select className={inputCls} value={out.request_id} onChange={so("request_id")}>
                        <option value="">No request</option>
                        {requestOptions.map((r) => (
                          <option key={r.request_id} value={r.request_id}>
                            #{r.request_id} · {r.requested_by_name} ({r.department}) · {r.asset_type}{r.urgency === "Urgent" ? " · URGENT" : ""}
                          </option>
                        ))}
                      </select>
                    </L>
                  </div>
                  {out.holderKind === "staff" && <div className="sm:col-span-2"><L label="Purpose (on the handover form)"><input className={inputCls} value={out.purpose} onChange={so("purpose")} placeholder="e.g. For Slitting usage" /></L></div>}
                  <div className="sm:col-span-2"><L label="Notes"><input className={inputCls} value={out.notes_out} onChange={so("notes_out")} placeholder="e.g. with charger and bag" /></L></div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <p className="text-sm">
                    {out.assets.length ? <span className="font-medium">{out.assets.map((a) => a.asset_tag).join(", ")}</span> : <span className="text-muted">No asset</span>}
                    <span className="text-muted"> → </span>
                    {holderName ? <span className="font-medium">{holderName}</span> : <span className="text-muted">no holder</span>}
                    {out.loan && <span className="text-muted"> · loan</span>}
                  </p>
                  <button disabled={busy || !out.assets.length || !holderName}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-brand-fg disabled:opacity-50">
                    <ArrowUpFromLine className="h-4 w-4" />{busy ? "Issuing…" : (out.loan ? "Loan" : "Issue") + countOf(out.assets.length)}
                  </button>
                </div>
              </Card>
            </form>
          )}

          {data && mode === "in" && (
            <form onSubmit={checkIn} className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <h2 className="mb-3 font-semibold">1. Assets being returned <span className="font-normal text-muted">({held.length} held)</span></h2>
                {catFilter}
                <PickList multi items={held} selected={inn.assets} onSelect={toggleIn}
                  label="Assets to return" placeholder="Search tag, serial, holder" empty="Nothing is currently held."
                  render={assetLine} match={assetMatch} />
                <Picked items={inn.assets} onRemove={toggleIn} />
              </Card>
              <Card className="p-4">
                <h2 className="mb-3 font-semibold">2. Condition</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <L label="Returned on"><input type="date" className={inputCls} value={inn.returned_on || today()} min={minReturn} onChange={si("returned_on")} /></L>
                  <L label="Condition in">
                    <select className={inputCls} value={inn.condition_in} onChange={si("condition_in")}>{CONDITIONS.map((c) => <option key={c}>{c}</option>)}</select>
                  </L>
                  <div className="sm:col-span-2"><L label="Reason">
                    <select required className={inputCls} value={inn.reason} onChange={si("reason")}>
                      <option value="">— choose —</option>
                      {RETURN_REASONS.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </L></div>
                  <div className="sm:col-span-2">
                    <span className="mb-1 block text-xs text-muted">Goes back to</span>
                    <div className="flex gap-2">
                      {["In stock", "In repair"].map((s) => (
                        <button type="button" key={s} aria-pressed={inn.return_status === s} onClick={() => setInn((x) => ({ ...x, return_status: s }))}
                          className={cn("flex-1 rounded-lg border px-3 py-2 text-sm", inn.return_status === s ? "border-brand bg-brand/10 font-medium text-brand" : "border-border")}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="sm:col-span-2"><L label="Notes"><textarea rows={3} className={inputCls} value={inn.notes_in} onChange={si("notes_in")} placeholder="e.g. cracked hinge, missing charger" /></L></div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <p className="text-sm">
                    {inn.assets.length
                      ? <><span className="font-medium">{inn.assets.map((a) => a.asset_tag).join(", ")}</span><span className="text-muted"> from {[...new Set(inn.assets.map((a) => a.holder))].join(", ")}</span></>
                      : <span className="text-muted">No asset</span>}
                  </p>
                  <button disabled={busy || !inn.assets.length || !inn.reason}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-brand-fg disabled:opacity-50">
                    <ArrowDownToLine className="h-4 w-4" />{busy ? "Saving…" : "Return" + countOf(inn.assets.length)}
                  </button>
                </div>
              </Card>
            </form>
          )}
        </>
      )}

      <Card className="mt-4 p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" /> Recent movements</h2>
        {!moves && !error && <TableSkeleton rows={4} cols={3} />}
        {moves?.length === 0 && <EmptyState icon={History} title="No movements yet" />}
        <ul className="divide-y divide-border text-sm">
          {moves?.map((m) => {
            const a = data?.rows.find((r) => r.asset_id === m.asset_id);
            return (
              <li key={m.audit_id} className="flex flex-wrap gap-x-3 py-2">
                <span className="text-muted">{fmtDateTime(m.changed_at)}</span>
                <span className="font-medium">{a?.asset_tag ?? `#${m.asset_id}`}</span>
                <span>{m.action === "assigned" ? `issued to ${m.new_value}` : `returned by ${m.old_value}`}</span>
                <span className="text-muted">by {m.changed_by_name || "—"}</span>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
