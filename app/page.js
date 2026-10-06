"use client";
// Asset Register — every role reads; non-viewers edit, bulk-change and delete.
// Live from the database on every visit, no cached copy.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Archive, CheckCircle2, ChevronDown, ChevronRight, Download, Filter, Package,
  Pencil, Plus, Search, Timer, UserCheck, Wallet, Wrench, X,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { ASSET_TYPES, ASSET_STATUSES, MANUAL_STATUSES, WARRANTY_STATES, fmtDate, loadRegister } from "../lib/assets";
import { downloadCsv } from "../lib/csv";
import { useAuth } from "./components/AuthProvider";
import AssetDetail from "./components/AssetDetail";
import AssetForm, { inputCls } from "./components/AssetForm";
import {
  Card, EmptyState, HoldToConfirmButton, KpiCard, KpiSkeleton, ModalPortal, PageHeader, Pagination,
  SortableTh, StatusBadge, TableSkeleton, cn, toast,
} from "./components/ui";

const STATUS_KPIS = [
  { status: "In stock", icon: CheckCircle2, tone: "ok" },
  { status: "Assigned", icon: UserCheck, tone: "info" },
  { status: "In repair", icon: Wrench, tone: "warn" },
  { status: "Loaned", icon: Timer, tone: "brand" },
  { status: "Retired", icon: Archive, tone: "muted" },
  { status: "Lost/Stolen", icon: AlertTriangle, tone: "danger" },
];
const EMPTY_FILTERS = { q: "", type: "", status: "", department: "", location: "", warranty: "", from: "", to: "" };

export default function RegisterPage() {
  // isViewer/isAdmin only decide what is RENDERED. RLS refuses a viewer's
  // write and hides cost from non-admins whatever this page does.
  const { isViewer, isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState({ field: "asset_tag", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(null);
  const [modal, setModal] = useState(null); // { mode: "detail" | "edit" | "new", asset }
  const [bulkStatus, setBulkStatus] = useState("");

  const reload = useCallback(() => {
    loadRegister({ withCost: isAdmin })
      .then((d) => {
        setData(d);
        setError(null);
        const ids = new Set(d.rows.map((r) => r.asset_id));
        setSelected((s) => new Set([...s].filter((id) => ids.has(id))));
      })
      .catch((e) => setError(e.message));
  }, [isAdmin]);
  useEffect(reload, [reload]);

  // Deep link from the command palette: /?q=IT-0241
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setFilters((f) => ({ ...f, q }));
  }, []);

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const activeFilterCount = Object.entries(filters).filter(([k, v]) => k !== "q" && v).length;

  const departments = useMemo(
    () => [...new Set((data?.rows ?? []).map((r) => r.department).filter(Boolean))].sort(), [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = filters.q.trim().toLowerCase();
    return data.rows.filter((r) =>
      (!q || [r.asset_tag, r.serial_no, r.make, r.model, r.holder].some((v) => v?.toLowerCase().includes(q)))
      && (!filters.type || r.asset_type === filters.type)
      && (!filters.status || r.status === filters.status)
      && (!filters.department || r.department === filters.department)
      && (!filters.location || String(r.location_id) === filters.location)
      && (!filters.warranty || r.warranty === filters.warranty)
      && (!filters.from || (r.purchase_date && r.purchase_date >= filters.from))
      && (!filters.to || (r.purchase_date && r.purchase_date <= filters.to)));
  }, [data, filters]);

  const sorted = useMemo(() => {
    const { field, dir } = sort;
    const val = (r) => (field === "make" ? `${r.make ?? ""} ${r.model ?? ""}` : r[field]) ?? "";
    return [...filtered].sort((a, b) =>
      String(val(a)).localeCompare(String(val(b)), undefined, { numeric: true, sensitivity: "base" }) * (dir === "asc" ? 1 : -1));
  }, [filtered, sort]);

  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => selected.has(r.asset_id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePage = () => setSelected((s) => {
    const n = new Set(s);
    pageRows.forEach((r) => (allOnPage ? n.delete(r.asset_id) : n.add(r.asset_id)));
    return n;
  });

  // Exports exactly what is ticked when anything is ticked; otherwise every
  // filtered row (all pages). Exporting everything when four rows are ticked
  // is a bug users do not report — they just stop trusting the button.
  function exportCsv() {
    const rows = selected.size ? sorted.filter((r) => selected.has(r.asset_id)) : sorted;
    downloadCsv(`itrack-assets-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => ({
      "Asset tag": r.asset_tag, Type: r.asset_type, Make: r.make, Model: r.model, "Serial no": r.serial_no,
      Status: r.status, Holder: r.holder, "Holder since": r.holder_since, Location: r.location,
      Department: r.department, "Purchase date": r.purchase_date, "PO no": r.po_no, "Invoice no": r.invoice_no,
      Vendor: r.vendor, "Warranty end": r.warranty_end, Warranty: r.warranty, "Refresh due": r.refresh_due,
      "Spec notes": r.spec_notes, Active: r.active ? "Yes" : "No",
      ...(isAdmin ? { "Purchase cost (RM)": r.purchase_cost_rm, "Book value (RM)": r.book_value?.toFixed(2) } : {}),
    })));
    toast.success(`Exported ${rows.length} asset${rows.length === 1 ? "" : "s"}.`);
  }

  async function applyBulkStatus() {
    const ids = [...selected];
    const { error } = await supabase.from("assets").update({ status: bulkStatus }).in("asset_id", ids);
    // One statement: if any ticked asset is still held, the database refuses all of them.
    if (error) return toast.error(error.message);
    toast.success(`${ids.length} asset${ids.length === 1 ? "" : "s"} set to ${bulkStatus}.`);
    setBulkStatus("");
    reload();
  }

  async function bulkDelete() {
    const ids = [...selected];
    const { error } = await supabase.from("assets").delete().in("asset_id", ids);
    if (error) return toast.error(error.message);
    toast.success(`${ids.length} asset${ids.length === 1 ? "" : "s"} deleted. History is kept in the change log.`);
    setSelected(new Set());
    reload();
  }

  const closeModal = () => setModal(null);
  const afterSave = () => { closeModal(); reload(); };
  const totalBook = isAdmin && data ? data.rows.reduce((s, r) => s + (r.book_value || 0), 0) : null;

  return (
    <>
      <PageHeader title="Asset Register" help="asset-register"
        subtitle="Every IT hardware item the company owns, live from the database."
        actions={<>
          <button onClick={exportCsv} disabled={!data}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm disabled:opacity-50">
            <Download className="h-4 w-4" />{selected.size ? `Export ${selected.size} selected` : "Export CSV"}
          </button>
          {!isViewer && (
            <button onClick={() => setModal({ mode: "new" })} disabled={!data}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-fg">
              <Plus className="h-4 w-4" /> Register asset
            </button>
          )}
        </>} />

      {error && <Card className="mb-4 p-4 text-danger" role="alert">Error loading data: {error}</Card>}

      {!data && !error ? <KpiSkeleton count={6} /> : data && (
        <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", isAdmin ? "xl:grid-cols-7" : "xl:grid-cols-6")}>
          {STATUS_KPIS.map((s) => (
            <KpiCard key={s.status} label={s.status} icon={s.icon} tone={s.tone}
              value={data.rows.filter((r) => r.status === s.status).length}
              active={filters.status === s.status}
              onClick={() => setFilter("status", filters.status === s.status ? "" : s.status)} />
          ))}
          {isAdmin && <KpiCard label="Book value" icon={Wallet} tone="brand" value={"RM " + Math.round(totalBook).toLocaleString("en-MY")} />}
        </div>
      )}

      <Card className="mt-4 p-3 md:p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <input className={cn(inputCls, "pl-9")} placeholder="Search tag, serial, make, model or holder"
              value={filters.q} onChange={(e) => setFilter("q", e.target.value)} aria-label="Search assets" />
          </div>
          <button onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}
            className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 text-sm", activeFilterCount ? "border-brand text-brand" : "border-border")}>
            <Filter className="h-4 w-4" /><span className="hidden sm:inline">Filters</span>{activeFilterCount > 0 && ` (${activeFilterCount})`}
          </button>
        </div>
        {showFilters && (
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            <select aria-label="Type" className={inputCls} value={filters.type} onChange={(e) => setFilter("type", e.target.value)}>
              <option value="">All types</option>{ASSET_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select aria-label="Status" className={inputCls} value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="">All statuses</option>{ASSET_STATUSES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select aria-label="Department" className={inputCls} value={filters.department} onChange={(e) => setFilter("department", e.target.value)}>
              <option value="">All departments</option>{departments.map((d) => <option key={d}>{d}</option>)}
            </select>
            <select aria-label="Location" className={inputCls} value={filters.location} onChange={(e) => setFilter("location", e.target.value)}>
              <option value="">All locations</option>
              {(data?.lookups.locations ?? []).map((l) => <option key={l.location_id} value={l.location_id}>{l.name}</option>)}
            </select>
            <select aria-label="Warranty" className={inputCls} value={filters.warranty} onChange={(e) => setFilter("warranty", e.target.value)}>
              <option value="">Any warranty</option>{WARRANTY_STATES.map((w) => <option key={w}>{w}</option>)}
            </select>
            <label className="text-xs text-muted">Purchased from
              <input type="date" className={inputCls} value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
            </label>
            <label className="text-xs text-muted">Purchased to
              <input type="date" className={inputCls} value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
            </label>
            <button onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }} className="self-end rounded-lg border border-border px-3 py-2 text-sm">
              Clear all
            </button>
          </div>
        )}

        {selected.size > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand/5 p-2 text-sm">
            <span className="px-1 font-medium">{selected.size} selected</span>
            {!isViewer && (
              <>
                <select aria-label="New status" className={cn(inputCls, "w-auto")} value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                  <option value="">Change status…</option>{MANUAL_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
                <button disabled={!bulkStatus} onClick={applyBulkStatus}
                  className="rounded-lg bg-brand px-3 py-2 text-brand-fg disabled:opacity-40">Apply</button>
                <HoldToConfirmButton label={`Delete ${selected.size}`} onConfirm={bulkDelete} />
              </>
            )}
            <button onClick={() => setSelected(new Set())} className="ml-auto inline-flex items-center gap-1 px-2 text-muted">
              <X className="h-4 w-4" /> Clear
            </button>
          </div>
        )}

        <div className="mt-3">
          {!data && !error && <TableSkeleton rows={8} cols={6} />}
          {data && sorted.length === 0 && (
            <EmptyState icon={Package}
              title={data.rows.length ? "No assets match these filters" : "No assets yet"}
              message={data.rows.length ? "Clear a filter or change the search." : "Register the first asset to get started."} />
          )}

          {data && sorted.length > 0 && (
            <>
              {/* Phone: one large readable card per asset. */}
              <ul className="space-y-2 md:hidden" data-testid="register-cards">
                {pageRows.map((r) => (
                  <li key={r.asset_id} className="rounded-xl border border-border p-3">
                    <div className="flex items-start gap-3">
                      <input type="checkbox" aria-label={`Select ${r.asset_tag}`} className="mt-1 h-5 w-5"
                        checked={selected.has(r.asset_id)} onChange={() => toggle(r.asset_id)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-base font-semibold">{r.asset_tag}</span>
                          <StatusBadge status={r.status} />
                        </div>
                        <p className="text-sm">{r.asset_type} · {[r.make, r.model].filter(Boolean).join(" ") || "—"}</p>
                        <p className="text-sm text-muted">
                          {r.holder ? <>Held by {r.holder} since {fmtDate(r.holder_since)}</> : r.location || "No location"}
                        </p>
                        <p className="text-xs text-muted">Warranty: {r.warranty}{r.warranty_end && ` (${fmtDate(r.warranty_end)})`}</p>
                      </div>
                    </div>
                    <button onClick={() => setModal({ mode: "detail", asset: r })}
                      className="mt-3 w-full rounded-lg border border-border py-2.5 text-sm font-medium">
                      {isViewer ? "Open" : "Open / Update"}
                    </button>
                  </li>
                ))}
              </ul>

              {/* Tablet and desktop: the full sortable table. */}
              <div className="hidden overflow-x-auto md:block" data-testid="register-table">
                <table className="w-full text-sm">
                  <thead className="border-b border-border">
                    <tr>
                      <th className="w-8 px-2"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={togglePage} /></th>
                      <SortableTh label="Tag" field="asset_tag" sort={sort} setSort={setSort} />
                      <SortableTh label="Type" field="asset_type" sort={sort} setSort={setSort} />
                      <SortableTh label="Make / model" field="make" sort={sort} setSort={setSort} />
                      <SortableTh label="Serial" field="serial_no" sort={sort} setSort={setSort} className="hidden lg:table-cell" />
                      <SortableTh label="Status" field="status" sort={sort} setSort={setSort} />
                      <SortableTh label="Holder" field="holder" sort={sort} setSort={setSort} />
                      <SortableTh label="Location" field="location" sort={sort} setSort={setSort} className="hidden xl:table-cell" />
                      <SortableTh label="Warranty end" field="warranty_end" sort={sort} setSort={setSort} className="hidden lg:table-cell" />
                      <th className="sticky right-0 bg-surface px-2 text-right text-xs font-medium text-muted">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => {
                      const open = expanded === r.asset_id;
                      return (
                        <Fragment key={r.asset_id}>
                          <tr className={cn("border-b border-border hover:bg-sunken", open && "bg-sunken")}>
                            <td className="px-2"><input type="checkbox" aria-label={`Select ${r.asset_tag}`} checked={selected.has(r.asset_id)} onChange={() => toggle(r.asset_id)} /></td>
                            <td className="whitespace-nowrap px-3 py-2 font-medium">{r.asset_tag}{!r.active && <span className="ml-1 text-xs text-muted">(inactive)</span>}</td>
                            <td className="px-3 py-2">{r.asset_type}</td>
                            <td className="px-3 py-2">{[r.make, r.model].filter(Boolean).join(" ") || "—"}</td>
                            <td className="hidden px-3 py-2 text-muted lg:table-cell">{r.serial_no || "—"}</td>
                            <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                            <td className="px-3 py-2">{r.holder || <span className="text-muted">—</span>}</td>
                            <td className="hidden px-3 py-2 xl:table-cell">{r.location || "—"}</td>
                            <td className={cn("hidden whitespace-nowrap px-3 py-2 lg:table-cell",
                              r.warranty === "Expired" ? "text-danger" : r.warranty.startsWith("Expires") ? "text-warn" : "")}>
                              {r.warranty_end ? fmtDate(r.warranty_end) : "—"}
                            </td>
                            <td className={cn("sticky right-0 px-2 py-1 text-right", open ? "bg-sunken" : "bg-surface")}>
                              <div className="flex justify-end gap-1">
                                <button onClick={() => setExpanded(open ? null : r.asset_id)} aria-expanded={open}
                                  aria-label={`${open ? "Collapse" : "Expand"} ${r.asset_tag}`} className="rounded-lg p-1.5 text-muted hover:bg-border/50 hover:text-fg">
                                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </button>
                                {!isViewer && (
                                  <button onClick={() => setModal({ mode: "edit", asset: r })} aria-label={`Edit ${r.asset_tag}`}
                                    className="rounded-lg p-1.5 text-muted hover:bg-border/50 hover:text-fg">
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {open && (
                            <tr className="border-b border-border bg-sunken/50">
                              <td colSpan={10} className="px-4 py-4">
                                <AssetDetail asset={r} lookups={data.lookups} showCost={isAdmin} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Pagination page={page} pageSize={pageSize} total={sorted.length} onPage={setPage}
                onPageSize={(n) => { setPageSize(n); setPage(1); }} />
              <p className="sr-only" data-testid="asset-total">{data.rows.length}</p>
            </>
          )}
        </div>
      </Card>

      <ModalPortal wide open={!!modal} onClose={closeModal} labelledBy={modal?.mode === "detail" ? "asset-detail-title" : "asset-form-title"}>
        {modal?.mode === "detail" && (
          <>
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 id="asset-detail-title" className="text-lg font-semibold">{modal.asset.asset_tag}</h2>
              <div className="flex gap-2">
                {!isViewer && (
                  <button onClick={() => setModal({ mode: "edit", asset: modal.asset })}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-fg">
                    <Pencil className="h-4 w-4" /> Update
                  </button>
                )}
                <button onClick={closeModal} aria-label="Close" className="rounded-lg border border-border p-2"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <AssetDetail asset={modal.asset} lookups={data.lookups} showCost={isAdmin} />
          </>
        )}
        {(modal?.mode === "edit" || modal?.mode === "new") && !isViewer && (
          <AssetForm asset={modal.asset} lookups={data.lookups} departments={departments} isAdmin={isAdmin}
            onSaved={afterSave} onDeleted={afterSave} onCancel={closeModal} />
        )}
      </ModalPortal>
    </>
  );
}
