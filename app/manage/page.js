"use client";
// Data Management — admin only. Master data is "read for authenticated,
// write for admins" in RLS; isAdmin here only decides what is rendered.
// Assets are edited on the Asset Register, which already owns that form
// (photos, cost, custody rules) — one asset editor, not two.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Database, Download, Lock, Pencil, Plus, Save, Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { addDays, fetchAll, today } from "../../lib/assets";
import { downloadCsv } from "../../lib/csv";
import { useAuth } from "../components/AuthProvider";
import { inputCls } from "../components/AssetForm";
import {
  Card, EmptyState, HoldToConfirmButton, KpiCard, ModalPortal, PageHeader, Pagination, SortableTh, TableSkeleton, cn, toast,
} from "../components/ui";

// Plain-language labels for notify_recipients.purpose (CHECK list in the initial migration).
const PURPOSE_LABELS = {
  equipment_request: "New equipment request",
  release_pending: "Release waiting for decision",
  release_decided: "Release decided",
};

const TABLES = [
  { id: "locations", label: "Locations", pk: "location_id", order: "name", columns: [
    { key: "name", label: "Name", required: true }, { key: "site", label: "Site" }, { key: "floor", label: "Floor" },
    { key: "notes", label: "Notes", hideInList: true }, { key: "active", label: "Active", type: "bool" },
  ] },
  { id: "vendors", label: "Vendors", pk: "vendor_id", order: "name", columns: [
    { key: "name", label: "Name", required: true }, { key: "contact_name", label: "Contact" },
    { key: "contact_email", label: "Email", type: "email" }, { key: "phone", label: "Phone" },
    { key: "notes", label: "Notes", hideInList: true }, { key: "active", label: "Active", type: "bool" },
  ] },
  { id: "staff", label: "Staff", pk: "staff_id", order: "full_name",
    note: "Logins are created on User Management, which also links them to a staff record here.", columns: [
    { key: "full_name", label: "Full name", required: true }, { key: "email", label: "Email", type: "email" },
    { key: "department", label: "Department" }, { key: "role", label: "Job title" },
    { key: "login_id", label: "Login ID" },
    { key: "eligible", label: "Eligible", type: "tristate" },
  ] },
  { id: "notify_recipients", label: "Notify Emails", pk: "id", order: "purpose",
    note: "Who is emailed, by purpose. One address may appear once per purpose.", columns: [
    { key: "purpose", label: "Sent for", type: "select", options: PURPOSE_LABELS, required: true },
    { key: "email", label: "Email", type: "email", required: true }, { key: "name", label: "Name" },
    { key: "active", label: "Active", type: "bool" },
  ] },
];

const show = (col, v) => col.type === "bool" ? (v ? "Yes" : "No")
  : col.type === "tristate" ? (v == null ? "Department rule" : v ? "Yes" : "No")
  : col.type === "select" ? col.options[v] ?? v : v;

// Blank text is NULL, never '': an empty string collides on unique columns
// (staff.email, staff.login_id) at the second row.
const clean = (cols, f) => Object.fromEntries(cols.map((c) => [c.key,
  c.type === "bool" ? !!f[c.key] : c.type === "tristate" ? (f[c.key] === "" ? null : f[c.key] === "true")
  : (String(f[c.key] ?? "").trim() || null)]));

function RowForm({ table, row, onDone, onCancel }) {
  const [f, setF] = useState(() => Object.fromEntries(table.columns.map((c) => [c.key,
    c.type === "bool" ? row?.[c.key] ?? true : c.type === "tristate" ? (row?.[c.key] == null ? "" : String(row[c.key])) : row?.[c.key] ?? ""])));
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const payload = clean(table.columns, f);
    const q = row ? supabase.from(table.id).update(payload).eq(table.pk, row[table.pk]) : supabase.from(table.id).insert(payload);
    const { error } = await q;
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Saved.");
    onDone();
  }
  async function remove() {
    const { error } = await supabase.from(table.id).delete().eq(table.pk, row[table.pk]);
    if (error) return toast.error(error.message);
    toast.success("Deleted.");
    onDone();
  }

  return (
    <form onSubmit={save}>
      <h2 id="row-form-title" className="mb-4 text-lg font-semibold">{row ? "Edit" : "Add"} — {table.label}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {table.columns.map((c) => (
          <label key={c.key} className={cn("block", c.key === "notes" && "sm:col-span-2")}>
            <span className="mb-1 block text-xs text-muted">{c.label}{c.required && " *"}</span>
            {c.type === "bool" ? (
              <input type="checkbox" className="h-5 w-5" checked={!!f[c.key]} onChange={(e) => setF((s) => ({ ...s, [c.key]: e.target.checked }))} />
            ) : c.type === "tristate" ? (
              <select className={inputCls} value={f[c.key]} onChange={(e) => setF((s) => ({ ...s, [c.key]: e.target.value }))}>
                <option value="">Use the department rule</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            ) : c.type === "select" ? (
              <select className={inputCls} value={f[c.key]} required={c.required} onChange={(e) => setF((s) => ({ ...s, [c.key]: e.target.value }))}>
                <option value="">Choose…</option>
                {Object.entries(c.options).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : (
              <input type={c.type === "email" ? "email" : "text"} className={inputCls} value={f[c.key]} required={c.required}
                onChange={(e) => setF((s) => ({ ...s, [c.key]: e.target.value }))} />
            )}
          </label>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        {row ? <HoldToConfirmButton label="Delete" onConfirm={remove} /> : <span />}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
          <button disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg disabled:opacity-50">
            <Save className="h-4 w-4" /> Save
          </button>
        </div>
      </div>
    </form>
  );
}

function TableEditor({ table }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ field: table.order, dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState(null); // row, or {} for new

  const reload = useCallback(() => {
    fetchAll(() => supabase.from(table.id).select("*").order(table.pk)).then((r) => { setRows(r); setError(null); }, (e) => setError(e.message));
  }, [table]);
  useEffect(reload, [reload]); // one editor per tab (keyed), so no state to reset

  const listCols = table.columns.filter((c) => !c.hideInList);
  const shown = useMemo(() => {
    if (!rows) return [];
    const t = q.trim().toLowerCase();
    const hit = t ? rows.filter((r) => table.columns.some((c) => String(show(c, r[c.key]) ?? "").toLowerCase().includes(t))) : rows;
    const col = table.columns.find((c) => c.key === sort.field);
    return [...hit].sort((a, b) => String(show(col, a[sort.field]) ?? "").localeCompare(String(show(col, b[sort.field]) ?? ""), undefined, { numeric: true })
      * (sort.dir === "asc" ? 1 : -1));
  }, [rows, q, sort, table]);
  const pageRows = shown.slice((page - 1) * pageSize, page * pageSize);

  function exportCsv() {
    downloadCsv(`itrack-${table.id}-${today()}.csv`, shown.map((r) => Object.fromEntries(table.columns.map((c) => [c.label, show(c, r[c.key])]))));
  }

  return (
    <Card className="p-3 md:p-4">
      {table.note && <p className="mb-3 text-sm text-muted">{table.note}</p>}
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input className={cn(inputCls, "pl-9")} placeholder={`Search ${table.label.toLowerCase()}`} aria-label="Search"
            value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <button onClick={exportCsv} disabled={!rows} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">
          <Download className="h-4 w-4" /> CSV
        </button>
        <button onClick={() => setEditing({})} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-fg">
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-danger" role="alert">Error loading data: {error}</p>}
      <div className="mt-3">
        {!rows && !error && <TableSkeleton rows={6} cols={listCols.length} />}
        {rows && shown.length === 0 && <EmptyState icon={Database} title={rows.length ? "No matches" : "Nothing here yet"} />}
        {shown.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    {listCols.map((c) => <SortableTh key={c.key} label={c.label} field={c.key} sort={sort} setSort={setSort} />)}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r[table.pk]} className="border-b border-border hover:bg-sunken">
                      {listCols.map((c) => (
                        <td key={c.key} className={cn("px-3 py-2", c.type === "bool" && !r[c.key] && "text-muted")}>{show(c, r[c.key]) ?? <span className="text-muted">—</span>}</td>
                      ))}
                      <td className="px-2 text-right">
                        <button onClick={() => setEditing(r)} aria-label="Edit" className="rounded-lg p-1.5 text-muted hover:bg-border/50 hover:text-fg">
                          <Pencil className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={pageSize} total={shown.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
          </>
        )}
      </div>
      <ModalPortal open={!!editing} onClose={() => setEditing(null)} labelledBy="row-form-title">
        {editing && <RowForm table={table} row={editing[table.pk] != null ? editing : null}
          onDone={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />}
      </ModalPortal>
    </Card>
  );
}

// Last 7 days of notify_log. "Zero sent" is NEUTRAL, not a green tick — no
// mail may simply mean nothing happened, or that the trigger never fired.
// Renders null on its own error so the recipient table below stays editable.
function NotifyHealth() {
  const [h, setH] = useState(undefined);
  useEffect(() => {
    const since = addDays(today(), -7);
    Promise.all([
      supabase.from("notify_log").select("id", { count: "exact", head: true }).gte("created_at", since).eq("ok", true),
      supabase.from("notify_log").select("created_at, purpose, error", { count: "exact" }).gte("created_at", since).eq("ok", false)
        .order("created_at", { ascending: false }).limit(5),
    ]).then(([ok, bad]) => setH(ok.error || bad.error ? null : { ok: ok.count || 0, failed: bad.count || 0, recent: bad.data }), () => setH(null));
  }, []);
  if (!h) return null;
  return (
    <Card className="mb-4 p-3 md:p-4">
      <h2 className="mb-2 text-sm font-semibold">Notify Health — last 7 days</h2>
      <div className="grid grid-cols-2 gap-3 md:max-w-md">
        <KpiCard label="Accepted by mail provider" value={h.ok} tone={h.ok ? "ok" : "muted"} />
        <KpiCard label="Failed" value={h.failed} tone={h.failed ? "danger" : "muted"} />
      </div>
      {h.recent.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted">
          {h.recent.map((f, i) => <li key={i}>{f.created_at.slice(0, 16).replace("T", " ")} · {PURPOSE_LABELS[f.purpose] || f.purpose} · {f.error}</li>)}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">This counts what the provider accepted, not what was delivered. Delivery status is in Exchange message trace (Microsoft 365 admin centre).</p>
    </Card>
  );
}

export default function ManagePage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState(TABLES[0].id);
  const table = TABLES.find((t) => t.id === tab);

  if (!isAdmin) {
    return <><PageHeader title="Data Management" /><Card><EmptyState icon={Lock} title="Administrators only" /></Card></>;
  }
  return (
    <>
      <PageHeader title="Data Management" help="data-management" subtitle="Locations, vendors, staff records and notification recipients." />
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1" role="tablist">
        {TABLES.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={cn("rounded-lg px-3 py-1.5 text-sm", tab === t.id ? "bg-brand/10 font-medium text-brand" : "text-muted hover:text-fg")}>
            {t.label}
          </button>
        ))}
        <a href="/" className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-muted hover:text-fg">
          <Boxes className="h-4 w-4" /> Assets → Register
        </a>
      </div>
      {tab === "notify_recipients" && <NotifyHealth />}
      <TableEditor key={tab} table={table} />
    </>
  );
}
