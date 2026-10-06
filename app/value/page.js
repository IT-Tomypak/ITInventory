"use client";
// Asset Value — admin only. The gate that matters is in SQL: asset_value has
// `admin read` USING (public.is_admin()), so a non-admin gets zero cost rows
// whatever this page renders. The isAdmin check below only spares them an
// empty screen. Read-only: every figure derives from purchase_cost_rm.
import { useEffect, useMemo, useState } from "react";
import { Download, Lock, Wallet } from "lucide-react";
import { bookValue, fmtRM, loadRegister, today } from "../../lib/assets";
import { downloadCsv } from "../../lib/csv";
import { useAuth } from "../components/AuthProvider";
import { Card, EmptyState, KpiCard, KpiSkeleton, PageHeader, TableSkeleton } from "../components/ui";

function group(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = key(r) || "(none)";
    const g = m.get(k) || { name: k, count: 0, cost: 0, book: 0 };
    g.count++; g.cost += Number(r.purchase_cost_rm || 0); g.book += r.book_value || 0;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.book - a.book);
}

function ValueTable({ title, rows, label }) {
  const total = rows.reduce((s, r) => ({ count: s.count + r.count, cost: s.cost + r.cost, book: s.book + r.book }), { count: 0, cost: 0, book: 0 });
  return (
    <Card className="p-3 md:p-4">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="border-b border-border text-left text-xs text-muted">
            <tr><th className="px-2 py-2 font-medium">{label}</th><th className="px-2 py-2 text-right font-medium">Items</th>
              <th className="px-2 py-2 text-right font-medium">Cost</th><th className="px-2 py-2 text-right font-medium">Book value</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-b border-border">
                <td className="px-2 py-1.5">{r.name}</td><td className="px-2 py-1.5 text-right">{r.count}</td>
                <td className="px-2 py-1.5 text-right">{fmtRM(r.cost)}</td><td className="px-2 py-1.5 text-right">{fmtRM(r.book)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="px-2 py-2">Total</td><td className="px-2 py-2 text-right">{total.count}</td>
              <td className="px-2 py-2 text-right">{fmtRM(total.cost)}</td><td className="px-2 py-2 text-right">{fmtRM(total.book)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function ValuePage() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isAdmin) loadRegister({ withCost: true }).then(setData).catch((e) => setError(e.message));
  }, [isAdmin]);

  const v = useMemo(() => {
    if (!data) return null;
    // Retired / lost items carry no book value; inactive rows are not in service.
    const rows = data.rows.filter((r) => r.active && !["Retired", "Lost/Stolen"].includes(r.status));
    const costed = rows.filter((r) => r.purchase_cost_rm != null);
    const year = Number(today().slice(0, 4));
    const months = new Map();
    for (const r of costed) {
      if (!r.purchase_date || r.purchase_date.slice(0, 4) < String(year - 1)) continue;
      const k = r.purchase_date.slice(0, 7);
      const g = months.get(k) || { name: k, count: 0, cost: 0, book: 0 };
      g.count++; g.cost += Number(r.purchase_cost_rm); g.book += r.book_value;
      months.set(k, g);
    }
    return {
      cost: costed.reduce((s, r) => s + Number(r.purchase_cost_rm), 0),
      book: costed.reduce((s, r) => s + r.book_value, 0),
      uncosted: rows.length - costed.length,
      byDept: group(costed, (r) => r.department),
      byType: group(costed, (r) => r.asset_type),
      byMonth: [...months.values()].sort((a, b) => b.name.localeCompare(a.name)),
      // Straight-line over refresh_years — the same bookValue() as the register KPI.
      projection: Array.from({ length: 6 }, (_, i) => ({
        year: year + i,
        book: costed.reduce((s, r) => s + bookValue(r.purchase_cost_rm, r.purchase_date, r.refresh_years, new Date(year + i, 11, 31)), 0),
      })),
    };
  }, [data]);

  if (!isAdmin) {
    return <><PageHeader title="Asset Value" /><Card><EmptyState icon={Lock} title="Administrators only" message="Purchase cost is visible to IT administrators." /></Card></>;
  }

  function exportCsv() {
    downloadCsv(`itrack-value-${today()}.csv`, data.rows.filter((r) => r.purchase_cost_rm != null).map((r) => ({
      "Asset tag": r.asset_tag, Type: r.asset_type, Department: r.department, Status: r.status, "Purchase date": r.purchase_date,
      "Refresh years": r.refresh_years, "Purchase cost (RM)": r.purchase_cost_rm, "Book value (RM)": r.book_value?.toFixed(2),
    })));
  }

  return (
    <>
      <PageHeader title="Asset Value" help="asset-value"
        subtitle="Purchase cost and straight-line book value over each item's refresh period. In-service items only."
        actions={<button onClick={exportCsv} disabled={!data}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm disabled:opacity-50">
          <Download className="h-4 w-4" /> Export CSV</button>} />
      {error && <Card className="mb-4 p-4 text-danger" role="alert">Error loading data: {error}</Card>}
      {!v && !error ? <><KpiSkeleton count={3} /><Card className="mt-4 p-4"><TableSkeleton /></Card></> : v && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard label="Purchase cost" value={fmtRM(v.cost)} icon={Wallet} tone="brand" />
            <KpiCard label="Book value today" value={fmtRM(v.book)} icon={Wallet} tone="ok" />
            <KpiCard label="Items with no cost recorded" value={v.uncosted} icon={Wallet} tone={v.uncosted ? "warn" : "muted"} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ValueTable title="By owning department" label="Department" rows={v.byDept} />
            <ValueTable title="By asset type" label="Type" rows={v.byType} />
            <ValueTable title="Acquisitions per month (this year and last)" label="Month" rows={v.byMonth} />
            <Card className="p-3 md:p-4">
              <h2 className="mb-2 text-sm font-semibold">Book value at year end (current items)</h2>
              <table className="w-full text-sm tabular-nums">
                <tbody>
                  {v.projection.map((p) => (
                    <tr key={p.year} className="border-b border-border last:border-0">
                      <td className="px-2 py-1.5">31 Dec {p.year}</td><td className="px-2 py-1.5 text-right">{fmtRM(p.book)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
