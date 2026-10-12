"use client";
// Dashboard — the home page. A summary only: counts across the three record
// lists, IT Inventory by hardware status, custody, what needs attention and the
// newest records. Every figure links to the page that owns it.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Laptop, Mouse } from "lucide-react";
import { LISTS, loadRegister } from "../lib/assets";
import { ALERT_TONES, loadAlerts } from "../lib/alerts";
import { useAuth } from "./components/AuthProvider";
import { HW_KPIS, LISTING_KPIS, LIST_ROUTES } from "./components/RegisterPage";
import { Card, KpiCard, KpiSkeleton, PageHeader, StatusBadge, cn } from "./components/ui";

const LIST_ICONS = { inventory: Laptop, accessory: Mouse, fixed: Building2 };
const H2 = "mb-2 mt-6 text-sm font-semibold";

export default function DashboardPage() {
  const router = useRouter();
  const { isApprover } = useAuth();
  const [rows, setRows] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadRegister({ withCost: false }).then((d) => setRows(d.rows), (e) => setError(e.message));
    // ponytail: loadAlerts reads the register again (and so does the bell);
    // pass rows in if this page ever feels slow.
    loadAlerts({ isApprover }).then(setAlerts, () => setAlerts([]));
  }, [isApprover]);

  const count = (test) => rows.filter(test).length;
  const newest = rows && [...rows].sort((a, b) => b.asset_id - a.asset_id).slice(0, 6);

  return (
    <>
      <PageHeader title="Dashboard" help="dashboard" subtitle="A summary of everything in ITrack, live from the database." />
      {error && <Card className="mb-4 p-4 text-danger" role="alert">Error loading data: {error}</Card>}

      {!rows ? !error && <KpiSkeleton count={3} /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {Object.keys(LISTS).map((list) => (
              <KpiCard key={list} label={LISTS[list]} value={count((r) => r.list === list)} icon={LIST_ICONS[list]}
                onClick={() => router.push(`/${LIST_ROUTES[list]}/`)} />
            ))}
          </div>

          <h2 className={H2}>IT Inventory by status</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {HW_KPIS.map((k) => (
              <KpiCard key={k.status} label={k.status} icon={k.icon} tone={k.tone}
                value={count((r) => r.list === "inventory" && r.hw_status === k.status)}
                onClick={() => router.push(`/inventory/?status=${encodeURIComponent(k.status)}`)} />
            ))}
          </div>

          <h2 className={H2}>All items by custody</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {LISTING_KPIS.map((k) => (
              <KpiCard key={k.status} label={k.status} icon={k.icon} tone={k.tone} value={count((r) => r.status === k.status)} />
            ))}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Needs attention</h2>
              {alerts === null ? <p className="text-sm text-muted">Loading…</p>
                : alerts.length === 0 ? <p className="text-sm text-muted">Nothing needs attention.</p>
                : (
                  <ul className="divide-y divide-border">
                    {alerts.map((a) => (
                      <li key={a.id}>
                        <Link href={a.href} className="flex gap-2 rounded-lg px-2 py-2.5 text-sm hover:bg-sunken">
                          <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full bg-current", ALERT_TONES[a.tone])} />
                          <span>
                            <span className="block">{a.title}</span>
                            {a.detail && <span className="block text-xs text-muted">{a.detail}</span>}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
            </Card>
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Recently added</h2>
              {newest.length === 0 ? <p className="text-sm text-muted">No records yet.</p> : (
                <ul className="divide-y divide-border">
                  {newest.map((r) => (
                    <li key={r.asset_id}>
                      <Link href={`/${LIST_ROUTES[r.list] ?? "inventory"}/?q=${encodeURIComponent(r.asset_tag)}&open=1`}
                        className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-sunken">
                        <span className="min-w-0">
                          <span className="block font-medium">{r.asset_tag}</span>
                          <span className="block truncate text-xs text-muted">
                            {[LISTS[r.list], [r.make, r.model].filter(Boolean).join(" "), r.holder].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <StatusBadge status={r.list === "inventory" ? r.hw_status : r.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
