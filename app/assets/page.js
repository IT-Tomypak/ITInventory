"use client";
// Asset History — open to EVERY role, viewer included: looking up what
// happened to a laptop is operational work, not an administrative privilege.
// (Contrast /audit, the admin-only change log of accounts and sign-ins.)
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, History, Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { fmtDateTime, loadRegister } from "../../lib/assets";
import { useAuth } from "../components/AuthProvider";
import AssetDetail from "../components/AssetDetail";
import { inputCls } from "../components/AssetForm";
import { Card, EmptyState, PageHeader, StatusBadge, TableSkeleton, cn } from "../components/ui";

// "*" is a wildcard ("IT-02*", "*5420"); a bare "*" lists everything; text
// without "*" matches anywhere.
function matcher(term) {
  const t = term.trim();
  if (!t) return null;
  if (!t.includes("*")) return (v) => v?.toLowerCase().includes(t.toLowerCase());
  const re = new RegExp("^" + t.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
  return (v) => v != null && re.test(v);
}

export default function AssetHistoryPage() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [recent, setRecent] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null); // asset_id

  useEffect(() => {
    Promise.all([
      loadRegister({ withCost: isAdmin }),
      supabase.from("asset_audit").select("*").order("changed_at", { ascending: false }).limit(25),
    ]).then(([reg, audit]) => {
      if (audit.error) throw audit.error;
      setData(reg);
      setRecent(audit.data);
      const param = new URLSearchParams(window.location.search).get("q");
      if (param) {
        setQ(param);
        const exact = reg.rows.find((r) => r.asset_tag.toLowerCase() === param.toLowerCase());
        if (exact) setPicked(exact.asset_id);
      }
    }).catch((e) => setError(e.message));
  }, [isAdmin]);

  const results = useMemo(() => {
    const m = matcher(q);
    if (!m || !data) return [];
    return data.rows.filter((r) => [r.asset_tag, r.serial_no, r.make, r.model, r.holder].some(m))
      .sort((a, b) => a.asset_tag.localeCompare(b.asset_tag, undefined, { numeric: true }));
  }, [q, data]);

  const byId = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.asset_id, r])), [data]);
  const tagOf = (h) => byId.get(h.asset_id)?.asset_tag ?? (h.action === "deleted" ? h.old_value : `#${h.asset_id}`) + " (deleted)";
  const pickedAsset = picked != null ? byId.get(picked) ?? null : null;

  return (
    <>
      <PageHeader title="Asset History" help="asset-history"
        subtitle="Every holder, every condition note, every change — for any asset, including deleted ones." />
      {error && <Card className="mb-4 p-4 text-danger" role="alert">Error loading data: {error}</Card>}

      {picked != null ? (
        <Card className="p-4">
          <button onClick={() => setPicked(null)} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> Back to search
          </button>
          <h2 className="mb-3 text-lg font-semibold">
            {pickedAsset?.asset_tag ?? tagOf(recent.find((h) => h.asset_id === picked) ?? { asset_id: picked })}
          </h2>
          <AssetDetail asset={pickedAsset} assetId={picked} lookups={data.lookups} showCost={isAdmin} />
        </Card>
      ) : (
        <>
          <Card className="p-3 md:p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <input className={cn(inputCls, "pl-9")} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search assets"
                placeholder="Tag, serial, make, model or holder — use * as a wildcard, * alone lists all" />
            </div>
            {!data && !error && <div className="mt-3"><TableSkeleton rows={4} cols={3} /></div>}
            {data && q.trim() && (
              results.length === 0
                ? <EmptyState icon={Search} title="No matching assets" message="Try a wildcard, e.g. IT-02*" />
                : (
                  <ul className="mt-3 divide-y divide-border">
                    {results.slice(0, 200).map((r) => (
                      <li key={r.asset_id}>
                        <button onClick={() => setPicked(r.asset_id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2.5 text-left text-sm hover:bg-sunken">
                          <span className="font-medium">{r.asset_tag}</span>
                          <span className="text-muted">{r.asset_type} · {[r.make, r.model].filter(Boolean).join(" ") || "—"}</span>
                          <StatusBadge status={r.status} />
                          {r.holder && <span className="text-muted">Held by {r.holder}</span>}
                        </button>
                      </li>
                    ))}
                    {results.length > 200 && <li className="py-2 text-sm text-muted">Showing 200 of {results.length}. Narrow the search.</li>}
                  </ul>
                )
            )}
          </Card>

          <Card className="mt-4 p-3 md:p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" /> Latest activity</h2>
            {!recent && !error && <TableSkeleton rows={5} cols={3} />}
            {recent?.length === 0 && <p className="text-sm text-muted">Nothing recorded yet.</p>}
            <ul className="divide-y divide-border">
              {recent?.map((h) => (
                <li key={h.audit_id}>
                  <button onClick={() => setPicked(h.asset_id)} className="flex w-full flex-wrap gap-x-3 px-1 py-2 text-left text-sm hover:bg-sunken">
                    <span className="text-muted">{fmtDateTime(h.changed_at)}</span>
                    <span className="font-medium">{tagOf(h)}</span>
                    <span>{h.action === "updated" ? `${h.field}: ${h.old_value ?? "(empty)"} → ${h.new_value ?? "(empty)"}` : `${h.action}${h.new_value || h.old_value ? ` — ${h.new_value || h.old_value}` : ""}`}</span>
                    <span className="text-muted">by {h.changed_by_name || "—"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}
