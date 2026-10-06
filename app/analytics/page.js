"use client";
// Analytics — every role reads. Theme-aware: colours are read from the live
// CSS tokens (and the series palette has its own dark steps), so nothing
// vanishes in dark mode. No donuts: a bar per category carries the same
// information and never draws a label outside a ring.
import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ASSET_STATUSES, ASSET_TYPES, fetchAll, loadRegister, today } from "../../lib/assets";
import { supabase } from "../../lib/supabaseClient";
import { useTheme } from "../../lib/theme";
import { Card, KpiSkeleton, PageHeader } from "../components/ui";

// Categorical slots 1–2 (validated palette), light and dark steps.
const SERIES = { light: ["#2a78d6", "#eb6834"], dark: ["#3987e5", "#d95926"] };

function useChartColors(dark) {
  return useMemo(() => {
    if (dark === null) return null;
    const css = getComputedStyle(document.documentElement);
    const tok = (n) => `rgb(${css.getPropertyValue(`--c-${n}`).trim()})`;
    return { text: tok("muted"), fg: tok("fg"), grid: tok("border"), surface: tok("surface"), series: SERIES[dark ? "dark" : "light"] };
  }, [dark]);
}

const monthKey = (iso) => iso.slice(0, 7);
function lastMonths(n) {
  const d = new Date(today() + "T00:00:00");
  d.setDate(1);
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1);
    return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
  });
}
const monthLabel = (k) => new Date(k + "-01T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
const count = (rows, key, order) => {
  const m = new Map((order ?? []).map((k) => [k, 0]));
  rows.forEach((r) => { const k = key(r); if (k != null) m.set(k, (m.get(k) || 0) + 1); });
  return [...m].map(([name, value]) => ({ name, value }));
};

function ChartCard({ title, data, height = 260, children, columns }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {data.every((d) => columns.slice(1).every((c) => !d[c.key])) ? (
        <p className="py-16 text-center text-sm text-muted">No data yet.</p>
      ) : (
        <div style={{ height }}><ResponsiveContainer>{children}</ResponsiveContainer></div>
      )}
      {/* The table view: identity and values never depend on colour alone. */}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs text-muted">Show as table</summary>
        <table className="mt-2 w-full">
          <thead className="text-left text-xs text-muted">
            <tr>{columns.map((c) => <th key={c.key} className="py-1 font-medium">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i} className="border-t border-border">
                {columns.map((c) => <td key={c.key} className="py-1 tabular-nums">{d[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

export default function AnalyticsPage() {
  const { dark } = useTheme();
  const colors = useChartColors(dark);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      loadRegister({ withCost: false }),
      fetchAll(() => supabase.from("asset_assignment").select("assignment_id, issued_on, returned_on").order("assignment_id")),
    ]).then(([reg, assignments]) => setData({ rows: reg.rows, assignments })).catch((e) => setError(e.message));
  }, []);

  const charts = useMemo(() => {
    if (!data) return null;
    const rows = data.rows.filter((r) => r.active);
    const now = new Date(today() + "T00:00:00");
    const months = lastMonths(24), months12 = lastMonths(12);
    const ageBands = ["< 1 yr", "1–2 yrs", "2–3 yrs", "3–4 yrs", "4–5 yrs", "5+ yrs"];
    const thisQ = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3);
    const quarters = Array.from({ length: 8 }, (_, i) => { const q = thisQ + i; return `${Math.floor(q / 4)} Q${(q % 4) + 1}`; });
    const quarterOf = (iso) => { const d = new Date(iso + "T00:00:00"); return `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`; };
    const depts = count(rows, (r) => r.department || "(none)").sort((a, b) => b.value - a.value);
    return {
      byType: count(rows, (r) => r.asset_type, ASSET_TYPES).filter((d) => d.value),
      byStatus: count(rows, (r) => r.status, ASSET_STATUSES),
      byDept: depts.length > 12 ? [...depts.slice(0, 11), { name: "Other", value: depts.slice(11).reduce((s, d) => s + d.value, 0) }] : depts,
      age: count(rows.filter((r) => r.purchase_date), (r) => {
        const y = (now - new Date(r.purchase_date + "T00:00:00")) / (365.25 * 864e5);
        return ageBands[Math.min(5, Math.max(0, Math.floor(y)))];
      }, ageBands),
      acquisitions: count(rows.filter((r) => r.purchase_date && months.includes(monthKey(r.purchase_date))),
        (r) => monthKey(r.purchase_date), months).map((d) => ({ ...d, name: monthLabel(d.name) })),
      warranty: count(rows.filter((r) => r.warranty_end && quarters.includes(quarterOf(r.warranty_end))),
        (r) => quarterOf(r.warranty_end), quarters),
      turnover: months12.map((m) => ({
        name: monthLabel(m),
        issued: data.assignments.filter((a) => monthKey(a.issued_on) === m).length,
        returned: data.assignments.filter((a) => a.returned_on && monthKey(a.returned_on) === m).length,
      })),
    };
  }, [data]);

  if (error) return <><PageHeader title="Analytics" /><Card className="p-4 text-danger" role="alert">Error loading data: {error}</Card></>;
  if (!charts || !colors) return <><PageHeader title="Analytics" /><KpiSkeleton count={4} /></>;

  const c = colors;
  const axis = { stroke: c.grid, tick: { fill: c.text, fontSize: 12 }, tickLine: false };
  const tooltip = {
    cursor: { fill: c.grid, fillOpacity: 0.35 },
    contentStyle: { background: c.surface, border: `1px solid ${c.grid}`, borderRadius: 8, color: c.fg, fontSize: 12 },
    labelStyle: { color: c.fg }, itemStyle: { color: c.fg },
  };
  const grid = <CartesianGrid vertical={false} stroke={c.grid} strokeDasharray="3 3" />;
  const nameValue = (label) => [{ key: "name", label }, { key: "value", label: "Assets" }];
  // Single-series bar: one hue, thin, rounded data end, 2px surface gap between bars.
  const bars = (d, { horizontal } = {}) => (
    <BarChart data={d} layout={horizontal ? "vertical" : "horizontal"} barCategoryGap={2}
      margin={{ top: 4, right: 12, left: horizontal ? 8 : -16, bottom: 0 }}>
      {grid}
      {horizontal
        ? <><XAxis type="number" allowDecimals={false} {...axis} /><YAxis type="category" dataKey="name" width={110} {...axis} /></>
        : <><XAxis dataKey="name" {...axis} interval="preserveStartEnd" /><YAxis allowDecimals={false} {...axis} /></>}
      <Tooltip {...tooltip} />
      <Bar dataKey="value" name="Assets" fill={c.series[0]} maxBarSize={36}
        radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} stroke={c.surface} strokeWidth={1} isAnimationActive={false} />
    </BarChart>
  );

  return (
    <>
      <PageHeader title="Analytics" help="analytics" subtitle="Active assets only, live from the database." />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Assets by type" data={charts.byType} columns={nameValue("Type")}>{bars(charts.byType, { horizontal: true })}</ChartCard>
        <ChartCard title="Assets by status" data={charts.byStatus} columns={nameValue("Status")}>{bars(charts.byStatus, { horizontal: true })}</ChartCard>
        <ChartCard title="Assets by owning department" data={charts.byDept} columns={nameValue("Department")}
          height={Math.max(200, charts.byDept.length * 30)}>{bars(charts.byDept, { horizontal: true })}</ChartCard>
        <ChartCard title="Age (from purchase date)" data={charts.age} columns={nameValue("Age")}>{bars(charts.age)}</ChartCard>
        <ChartCard title="Acquisitions per month (last 24 months)" data={charts.acquisitions} columns={nameValue("Month")}>{bars(charts.acquisitions)}</ChartCard>
        <ChartCard title="Warranties ending per quarter (next 8 quarters)" data={charts.warranty} columns={nameValue("Quarter")}>{bars(charts.warranty)}</ChartCard>
        <div className="lg:col-span-2">
          <ChartCard title="Assignment turnover (last 12 months)" data={charts.turnover}
            columns={[{ key: "name", label: "Month" }, { key: "issued", label: "Issued" }, { key: "returned", label: "Returned" }]}>
            <LineChart data={charts.turnover} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              {grid}
              <XAxis dataKey="name" {...axis} />
              <YAxis allowDecimals={false} {...axis} />
              <Tooltip {...tooltip} cursor={{ stroke: c.text, strokeDasharray: "3 3" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: c.fg }}>{v}</span>} />
              <Line dataKey="issued" name="Issued" stroke={c.series[0]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: c.surface }} isAnimationActive={false} />
              <Line dataKey="returned" name="Returned" stroke={c.series[1]} strokeWidth={2} strokeDasharray="6 3"
                dot={{ r: 4, strokeWidth: 2, stroke: c.surface }} isAnimationActive={false} />
            </LineChart>
          </ChartCard>
        </div>
      </div>
    </>
  );
}
