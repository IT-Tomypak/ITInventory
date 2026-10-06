"use client";
// Asset Register. Phase 2 shows the live status counts only; the full register
// (filters, phone cards, desktop table, row expansion, CSV) is phase 3.
import { useEffect, useState } from "react";
import { AlertTriangle, Boxes, CheckCircle2, Package, Archive, Wrench, Timer, UserCheck } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { Card, EmptyState, KpiCard, KpiSkeleton, PageHeader } from "./components/ui";

const STATUSES = [
  { status: "In stock", icon: CheckCircle2, tone: "ok" },
  { status: "Assigned", icon: UserCheck, tone: "info" },
  { status: "In repair", icon: Wrench, tone: "warn" },
  { status: "Loaned", icon: Timer, tone: "brand" },
  { status: "Retired", icon: Archive, tone: "muted" },
  { status: "Lost/Stolen", icon: AlertTriangle, tone: "danger" },
];

export default function RegisterPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.from("assets").select("status").then(({ data, error }) => {
      if (error) setError(error.message);
      else setRows(data);
    });
  }, []);

  const count = (s) => rows?.filter((r) => r.status === s).length ?? 0;

  return (
    <>
      <PageHeader title="Asset Register" subtitle="Every IT hardware item the company owns, live from the database." />
      {error ? (
        <Card className="p-4 text-danger" role="alert">Error loading data: {error}</Card>
      ) : !rows ? (
        <KpiSkeleton count={6} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {STATUSES.map((s) => <KpiCard key={s.status} label={s.status} value={count(s.status)} icon={s.icon} tone={s.tone} />)}
          </div>
          <Card className="mt-4 p-4">
            {rows.length === 0
              ? <EmptyState icon={Package} title="No assets yet" message="Assets appear here once they are added in Data Management." />
              : <p className="flex items-center gap-2 text-sm text-muted"><Boxes className="h-4 w-4" /><span data-testid="asset-total">{rows.length}</span> assets registered.</p>}
          </Card>
        </>
      )}
    </>
  );
}
