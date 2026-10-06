// The ONE source for "needs attention": the header bell, the admin briefing and
// /warranty all read from here, so they cannot disagree. Plain data, no React —
// the consumer picks the icon. There is deliberately no digest email (brief
// §6.11): a nightly list nobody asked for trains people to filter the sender.
import { supabase } from "./supabaseClient";
import { addDays, loadRegister, today } from "./assets";

export const ALERT_TONES = { danger: "text-danger", warn: "text-warn", info: "text-info" };

// Retired and lost items have no warranty or refresh worth chasing.
const live = (r) => r.active && !["Retired", "Lost/Stolen"].includes(r.status);

export function warrantyBuckets(rows, now = today()) {
  const items = rows.filter(live);
  const end = (r) => r.warranty_end;
  const within = (lo, hi) => (r) => end(r) && end(r) > addDays(now, lo) && end(r) <= addDays(now, hi);
  return {
    expired: items.filter((r) => end(r) && end(r) < now),
    expiring30: items.filter((r) => end(r) && end(r) >= now && end(r) <= addDays(now, 30)),
    expiring60: items.filter(within(30, 60)),
    expiring90: items.filter(within(60, 90)),
    refreshOverdue: items.filter((r) => r.refresh_due && r.refresh_due < now),
    refreshThisYear: items.filter((r) => r.refresh_due && r.refresh_due >= now && r.refresh_due <= now.slice(0, 4) + "-12-31"),
  };
}

// A request still at 'Requested' after this many days has been sitting unhandled.
const STALE_DAYS = 2;

export async function loadAlerts({ isApprover } = {}) {
  const now = today();
  const [{ rows }, stale, pending] = await Promise.all([
    loadRegister({ withCost: false }),
    supabase.from("equipment_request").select("request_id", { count: "exact", head: true })
      .eq("status", "Requested").lt("created_at", addDays(now, -STALE_DAYS)),
    isApprover
      ? supabase.from("equipment_request").select("request_id", { count: "exact", head: true }).eq("release_status", "Pending")
      : Promise.resolve({ count: 0 }),
  ]);
  const b = warrantyBuckets(rows, now);
  const overdueLoans = rows.filter((r) => r.due_back_on && r.due_back_on < now);
  const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
  return [
    { id: "release", tone: "warn", count: pending.count || 0, href: "/entry/?view=approvals",
      title: `${plural(pending.count || 0, "release")} waiting for your decision` },
    { id: "stale", tone: "warn", count: stale.count || 0, href: "/entry/",
      title: `${plural(stale.count || 0, "request")} unhandled for over ${STALE_DAYS} days` },
    { id: "loans", tone: "danger", count: overdueLoans.length, href: "/allocate/",
      title: `${plural(overdueLoans.length, "loan")} past the due-back date`,
      detail: overdueLoans.slice(0, 3).map((r) => `${r.asset_tag} (${r.holder})`).join(", ") },
    { id: "warranty30", tone: "warn", count: b.expiring30.length, href: "/warranty/#expiring",
      title: `${plural(b.expiring30.length, "warranty", "warranties")} expiring within 30 days`,
      detail: b.expiring30.slice(0, 3).map((r) => r.asset_tag).join(", ") },
    { id: "refresh", tone: "info", count: b.refreshOverdue.length, href: "/warranty/#refresh-overdue",
      title: `${plural(b.refreshOverdue.length, "asset")} past the refresh date` },
  ].filter((a) => a.count > 0);
  // ponytail: "assigned to someone who has left" needs a leaver flag on staff,
  // which the schema does not have yet; add the alert when it does.
}
