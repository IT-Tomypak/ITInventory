"use client";
// Change Log — admin only. Reads the audit_feed view (security_invoker, so the
// admin-read policies on audit_event / asset_audit apply to whoever asks).
// Read-only by construction: neither table has a write policy, so there is no
// edit affordance to build — and that is the point.
import { useEffect, useState } from "react";
import { Download, Lock, ScrollText } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { fetchAll, fmtDateTime } from "../../lib/assets";
import { downloadCsv } from "../../lib/csv";
import { useAuth } from "../components/AuthProvider";
import { inputCls } from "../components/AssetForm";
import { Card, EmptyState, PageHeader, Pagination, TableSkeleton, cn } from "../components/ui";

const ACTION_LABELS = {
  login: "Signed in", logout: "Signed out", user_created: "User created", user_updated: "User updated",
  user_role_changed: "Access level changed", user_password_reset: "Password set", user_disabled: "User disabled",
  user_enabled: "User re-enabled", created: "Asset created", updated: "Asset changed", deleted: "Asset deleted",
  assigned: "Issued", returned: "Returned",
};
const EMPTY = { category: "", actor: "", from: "", to: "" };

function describe(r) {
  if (r.category === "security") return [r.target_name, r.detail].filter(Boolean).join(" — ");
  if (r.action === "updated") return `${r.field}: ${r.old_value ?? "(empty)"} → ${r.new_value ?? "(empty)"}`;
  return r.new_value || r.old_value || "";
}

export default function AuditPage() {
  const { isAdmin } = useAuth();
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [res, setRes] = useState(null); // { rows, total }
  const [error, setError] = useState(null);
  const [tags, setTags] = useState(new Map()); // asset_id -> tag; deleted assets fall back to the id

  useEffect(() => {
    if (isAdmin) fetchAll(() => supabase.from("assets").select("asset_id, asset_tag").order("asset_id"))
      .then((rows) => setTags(new Map(rows.map((a) => [a.asset_id, a.asset_tag]))), () => {});
  }, [isAdmin]);

  // Built fresh per call: filters and paging are applied in the database, so
  // the feed stays fast however long the history grows.
  const query = (sel = "*", opts) => {
    let q = supabase.from("audit_feed").select(sel, opts).order("occurred_at", { ascending: false });
    if (filters.category) q = q.eq("category", filters.category);
    if (filters.actor.trim()) q = q.ilike("actor_name", `%${filters.actor.trim()}%`);
    if (filters.from) q = q.gte("occurred_at", filters.from);
    if (filters.to) q = q.lt("occurred_at", new Date(new Date(filters.to + "T00:00:00").getTime() + 864e5).toISOString());
    return q;
  };

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    const t = setTimeout(() => {
      query("*", { count: "exact" }).range((page - 1) * pageSize, page * pageSize - 1).then(({ data, count, error }) => {
        if (!live) return;
        if (error) setError(error.message); else { setError(null); setRes({ rows: data, total: count ?? 0 }); }
      });
    }, 250);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, filters, page, pageSize]);

  if (!isAdmin) {
    return <><PageHeader title="Change Log" /><Card><EmptyState icon={Lock} title="Administrators only" /></Card></>;
  }

  const set = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };
  async function exportCsv() {
    const { data, error } = await query().limit(10000);
    if (error) return setError(error.message);
    downloadCsv(`itrack-change-log-${new Date().toISOString().slice(0, 10)}.csv`, data.map((r) => ({
      When: r.occurred_at, Category: r.category, Action: ACTION_LABELS[r.action] || r.action, Who: r.actor_name, Detail: describe(r),
    })));
  }

  return (
    <>
      <PageHeader title="Change Log" help="change-log" subtitle="Sign-ins, account changes and every asset change, newest first. Nothing here can be edited or deleted."
        actions={<button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <Download className="h-4 w-4" /> Export CSV</button>} />
      <Card className="p-3 md:p-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <select aria-label="Category" className={inputCls} value={filters.category} onChange={set("category")}>
            <option value="">All categories</option><option value="security">Accounts &amp; sign-ins</option><option value="asset">Assets</option>
          </select>
          <input aria-label="Who" className={inputCls} placeholder="Who (name)" value={filters.actor} onChange={set("actor")} />
          <label className="text-xs text-muted">From<input type="date" className={inputCls} value={filters.from} onChange={set("from")} /></label>
          <label className="text-xs text-muted">To<input type="date" className={inputCls} value={filters.to} onChange={set("to")} /></label>
        </div>
        {error && <p className="mt-3 text-sm text-danger" role="alert">Error loading data: {error}</p>}
        <div className="mt-3">
          {!res && !error && <TableSkeleton rows={8} cols={4} />}
          {res?.rows.length === 0 && <EmptyState icon={ScrollText} title="Nothing recorded for these filters" />}
          {res?.rows.length > 0 && (
            <>
              <ul className="divide-y divide-border">
                {res.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap gap-x-3 gap-y-0.5 px-1 py-2 text-sm">
                    <span className="w-40 shrink-0 text-muted">{fmtDateTime(r.occurred_at)}</span>
                    <span className={cn("w-40 shrink-0 font-medium", r.category === "security" ? "text-info" : "")}>
                      {ACTION_LABELS[r.action] || r.action}
                    </span>
                    <span className="min-w-0 flex-1">
                      {r.asset_id != null && <span className="mr-1 font-medium">{tags.get(r.asset_id) ?? `#${r.asset_id}`}</span>}
                      {describe(r)}
                    </span>
                    <span className="text-muted">by {r.actor_name || "—"}</span>
                  </li>
                ))}
              </ul>
              <Pagination page={page} pageSize={pageSize} total={res.total} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
            </>
          )}
        </div>
      </Card>
    </>
  );
}
