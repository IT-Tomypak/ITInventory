"use client";
// Warranty & Refresh — every role reads. The buckets come from
// lib/alerts.js warrantyBuckets(), the same function behind the header bell,
// so this page and the bell cannot disagree.
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Download, FileSpreadsheet } from "lucide-react";
import { fmtDate, loadRegister } from "../../lib/assets";
import { warrantyBuckets } from "../../lib/alerts";
import { downloadCsv } from "../../lib/csv";
import { downloadXlsx } from "../../lib/xlsx";
import { Card, EmptyState, KpiCard, KpiSkeleton, PageHeader, StatusBadge, TableSkeleton, cn, toast } from "../components/ui";

const SECTIONS = [
  { id: "expired", title: "Warranty expired", keys: ["expired"], tone: "danger" },
  { id: "expiring", title: "Warranty expiring in 30 / 60 / 90 days", keys: ["expiring30", "expiring60", "expiring90"], tone: "warn" },
  { id: "refresh-overdue", title: "Refresh overdue", keys: ["refreshOverdue"], tone: "danger" },
  { id: "refresh-this-year", title: "Refresh due this year", keys: ["refreshThisYear"], tone: "info" },
];
const WINDOW = { expiring30: "≤ 30 days", expiring60: "31–60 days", expiring90: "61–90 days" };

const exportRow = (r) => ({
  "Asset tag": r.asset_tag, Type: r.asset_type, Make: r.make, Model: r.model, "Serial no": r.serial_no,
  Status: r.status, Holder: r.holder, Department: r.department, "Purchase date": r.purchase_date,
  "Warranty end": r.warranty_end, "Refresh due": r.refresh_due, ...(r.window ? { Window: r.window } : {}),
});

export default function WarrantyPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadRegister({ withCost: false }).then(setData).catch((e) => setError(e.message));
  }, []);

  const sections = useMemo(() => {
    if (!data) return null;
    const b = warrantyBuckets(data.rows);
    return SECTIONS.map((s) => ({
      ...s,
      rows: s.keys.flatMap((k) => b[k].map((r) => ({ ...r, window: WINDOW[k] }))),
    }));
  }, [data]);

  // Hash links from the bell (/warranty/#expiring) land before the data does.
  useEffect(() => {
    if (sections && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [sections]);

  const stamp = () => new Date().toISOString().slice(0, 10);
  function exportCsv() {
    downloadCsv(`itrack-warranty-${stamp()}.csv`,
      sections.flatMap((s) => s.rows.map((r) => ({ Section: s.title, ...exportRow(r) }))));
    toast.success("Exported.");
  }
  function exportXlsx() {
    downloadXlsx(`itrack-warranty-${stamp()}.xlsx`, sections.map((s) => ({ name: s.title.replace(/ \/.*/, ""), rows: s.rows.map(exportRow) })));
    toast.success("Exported.");
  }

  return (
    <>
      <PageHeader title="Warranty & Refresh" help="warranty-and-refresh"
        subtitle="What is out of warranty, what is about to be, and what is due for replacement. Retired and lost items are left out."
        actions={<>
          <button onClick={exportCsv} disabled={!sections}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm disabled:opacity-50">
            <Download className="h-4 w-4" /> CSV
          </button>
          <button onClick={exportXlsx} disabled={!sections}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm disabled:opacity-50">
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </button>
        </>} />
      {error && <Card className="mb-4 p-4 text-danger" role="alert">Error loading data: {error}</Card>}

      {!sections && !error && <KpiSkeleton count={4} />}
      {sections && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {sections.map((s) => (
            <KpiCard key={s.id} label={s.title} value={s.rows.length} icon={CalendarClock} tone={s.rows.length ? s.tone : "muted"}
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" })} />
          ))}
        </div>
      )}

      {!sections && !error && <Card className="mt-4 p-4"><TableSkeleton rows={6} cols={5} /></Card>}
      {sections?.map((s) => (
        <Card key={s.id} id={s.id} className="mt-4 scroll-mt-20 p-3 md:p-4">
          <h2 className="mb-2 text-sm font-semibold">{s.title} <span className="text-muted">({s.rows.length})</span></h2>
          {s.rows.length === 0 ? <EmptyState icon={CalendarClock} title="Nothing here" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Tag</th>
                    <th className="px-3 py-2 font-medium">Type / model</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">Status</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">Holder</th>
                    <th className="px-3 py-2 font-medium">{s.id.startsWith("refresh") ? "Refresh due" : "Warranty end"}</th>
                    {s.id === "expiring" && <th className="px-3 py-2 font-medium">Window</th>}
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.asset_id} className="border-b border-border last:border-0 hover:bg-sunken">
                      <td className="whitespace-nowrap px-3 py-2 font-medium">
                        <a className="text-brand hover:underline" href={`/assets/?q=${encodeURIComponent(r.asset_tag)}`}>{r.asset_tag}</a>
                      </td>
                      <td className="px-3 py-2">{r.asset_type} · {[r.make, r.model].filter(Boolean).join(" ") || "—"}</td>
                      <td className="hidden px-3 py-2 md:table-cell"><StatusBadge status={r.status} /></td>
                      <td className="hidden px-3 py-2 md:table-cell">{r.holder || <span className="text-muted">—</span>}</td>
                      <td className={cn("whitespace-nowrap px-3 py-2", s.tone === "danger" && "text-danger")}>
                        {fmtDate(s.id.startsWith("refresh") ? r.refresh_due : r.warranty_end)}
                      </td>
                      {s.id === "expiring" && <td className="whitespace-nowrap px-3 py-2 text-warn">{r.window}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}
    </>
  );
}
