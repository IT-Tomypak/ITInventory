"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight, BarChart3, Bell, BookOpen, Boxes, CalendarClock, ChevronsLeft, ChevronsRight,
  ClipboardList, Database, History, LogOut, Menu, ScrollText, Search, User, UserCog, Wallet, X,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { ALERT_TONES, loadAlerts } from "../../lib/alerts";
import { PUBLIC_ROUTES, useAuth } from "./AuthProvider";
import { BrandLogo, ModalPortal, PENDING_EVENT, ThemeToggle, cn, useCleanPath } from "./ui";
import { APP_VERSION } from "../version";

// ONE flat array: the role filter, the breadcrumb labels and the command
// palette all read it. `section` is a flat property, not nesting.
export const NAV_ITEMS = [
  { href: "/",          label: "Asset Register",     icon: Boxes },
  { href: "/analytics", label: "Analytics",          icon: BarChart3 },
  { href: "/value",     label: "Asset Value",        icon: Wallet,     adminOnly: true },
  { href: "/warranty",  label: "Warranty & Refresh", icon: CalendarClock },
  { href: "/allocate",  label: "Allocate / Return",  icon: ArrowLeftRight },
  { href: "/entry",     label: "Equipment Request",  icon: ClipboardList },
  { href: "/manage",    label: "Data Management",    icon: Database,   adminOnly: true },
  { href: "/staff",     label: "User Management",    icon: UserCog,    adminOnly: true },
  { href: "/audit",     label: "Change Log",         icon: ScrollText, adminOnly: true, section: "Audit Trail" },
  { href: "/assets",    label: "Asset History",      icon: History,    section: "Audit Trail" },
  { href: "/help",      label: "Help & User Guide",  icon: BookOpen },
];
const ROUTE_LABELS = Object.fromEntries(NAV_ITEMS.map((i) => [i.href, i.label]));

const ROLE_LABELS = {
  super_admin: "IT HOD (super admin)", admin: "Administrator", approver: "Approver (asset custodian)",
  viewer: "Viewer (read only)",
};
const COLLAPSE_KEY = "itrack-rail-collapsed";
// Set once an approver has been landed on their approvals this sign-in;
// cleared by AuthProvider.signOut so the next sign-in lands them again.
export const APPROVER_LANDED_KEY = "itrack-approver-landed";
// Set once an admin has seen the briefing this sign-in; cleared by
// AuthProvider.signOut, so it shows again only at the next sign-in.
export const BRIEFED_KEY = "itrack-briefed";

function SidebarContent({ items, path, collapsed, onToggleCollapse, badges = {} }) {
  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-14 items-center border-b border-border px-4", collapsed && "justify-center px-0")}>
        <BrandLogo size={30} withText={!collapsed} />
      </div>
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Main">
        {items.map((item, i) => {
          // Heading computed against the previous VISIBLE item, so hiding an
          // admin-only entry can never leave an orphaned heading.
          const heading = item.section && item.section !== items[i - 1]?.section ? item.section : null;
          const active = item.href === "/" ? path === "/" : path === item.href || path.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <div key={item.href}>
              {heading && !collapsed && (
                <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">{heading}</p>
              )}
              {heading && collapsed && <hr className="mx-3 my-2 border-border" />}
              <Link href={item.href} title={collapsed ? item.label : undefined} aria-current={active ? "page" : undefined}
                className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm",
                  collapsed && "justify-center px-0",
                  active ? "bg-brand/10 font-medium text-brand" : "text-muted hover:bg-sunken hover:text-fg")}>
                <span className="relative">
                  <Icon className="h-5 w-5 shrink-0" />
                  {collapsed && badges[item.href] > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-warn" />}
                </span>
                {!collapsed && <span className="truncate">{item.label}</span>}
                {!collapsed && badges[item.href] > 0 && (
                  <span className="ml-auto rounded-full bg-warn px-1.5 text-xs font-semibold text-white" aria-label={`${badges[item.href]} waiting`}>
                    {badges[item.href]}
                  </span>
                )}
              </Link>
            </div>
          );
        })}
      </nav>
      <div className={cn("flex items-center border-t border-border p-2 text-xs text-muted", collapsed ? "flex-col gap-1" : "justify-between")}>
        <span className="px-2">v{APP_VERSION}</span>
        {onToggleCollapse && (
          <button onClick={onToggleCollapse} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-lg p-2 hover:bg-sunken hover:text-fg">
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

// PostgREST .or() filter syntax treats , ( ) as structure; strip them from user input.
const cleanTerm = (s) => s.replace(/[,()*%\\]/g, " ").trim();

function CommandPalette({ open, onClose, items, isAdmin }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { if (open) { setQ(""); setRemote([]); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  useEffect(() => {
    const term = cleanTerm(q);
    if (!open || term.length < 2) { setRemote([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      const like = `%${term}%`;
      const [assets, staff] = await Promise.all([
        supabase.from("assets").select("asset_id, asset_tag, make, model, serial_no")
          .or(`asset_tag.ilike.${like},serial_no.ilike.${like},make.ilike.${like},model.ilike.${like}`).limit(6),
        isAdmin
          ? supabase.from("staff").select("staff_id, full_name, department").ilike("full_name", like).limit(4)
          : Promise.resolve({ data: [] }),
      ]);
      if (!live) return;
      setRemote([
        ...(assets.data || []).map((a) => ({
          key: "a" + a.asset_id, group: "Assets", label: a.asset_tag,
          hint: [a.make, a.model, a.serial_no].filter(Boolean).join(" · "),
          href: `/assets/?q=${encodeURIComponent(a.asset_tag)}`,
        })),
        ...(staff.data || []).map((s) => ({
          key: "s" + s.staff_id, group: "Staff", label: s.full_name, hint: s.department,
          href: `/staff/?q=${encodeURIComponent(s.full_name)}`,
        })),
      ]);
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, open, isAdmin]);

  // ponytail: user-guide headings join these results once /help exists (phase 8).
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const pages = items.filter((i) => !term || i.label.toLowerCase().includes(term))
      .map((i) => ({ key: i.href, group: "Pages", label: i.label, href: i.href }));
    return [...pages, ...remote];
  }, [q, items, remote]);

  useEffect(() => setSel(0), [results.length]);
  if (!open) return null;

  const go = (r) => { onClose(); router.push(r.href); };
  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 text-muted" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages, assets, staff…"
            className="h-12 flex-1 bg-transparent outline-none" aria-label="Search"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === "Enter" && results[sel]) go(results[sel]);
            }} />
        </div>
        <ul className="max-h-80 overflow-y-auto p-2" role="listbox">
          {results.length === 0 && <li className="p-3 text-sm text-muted">No matches.</li>}
          {results.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === sel}>
              {(i === 0 || results[i - 1].group !== r.group) && (
                <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{r.group}</p>
              )}
              <button onMouseEnter={() => setSel(i)} onClick={() => go(r)}
                className={cn("flex w-full items-baseline gap-2 rounded-lg px-2 py-2 text-left text-sm", i === sel && "bg-brand/10 text-brand")}>
                <span className="font-medium">{r.label}</span>
                {r.hint && <span className="truncate text-xs text-muted">{r.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AlertList({ alerts, onPick }) {
  return (
    <ul className="divide-y divide-border">
      {alerts.map((a) => (
        <li key={a.id}>
          <Link href={a.href} onClick={onPick} className="flex gap-2 rounded-lg px-2 py-2.5 text-sm hover:bg-sunken">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full bg-current", ALERT_TONES[a.tone])} />
            <span>
              <span className="block">{a.title}</span>
              {a.detail && <span className="block text-xs text-muted">{a.detail}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// The bell and the admin briefing read the SAME loadAlerts() result, so they
// cannot disagree. Refreshed on every page change, which is "live" enough for
// warranties measured in days.
function AlertBell({ path }) {
  const { isAdmin, isApprover } = useAuth();
  const [alerts, setAlerts] = useState(null);
  const [open, setOpen] = useState(false);
  const [briefing, setBriefing] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    let live = true;
    loadAlerts({ isApprover }).then((a) => {
      if (!live) return;
      setAlerts(a);
      if (!isAdmin || !a.length) return; // never shown when there is nothing to report
      let seen = true;
      try { seen = !!sessionStorage.getItem(BRIEFED_KEY); sessionStorage.setItem(BRIEFED_KEY, "1"); } catch { /* private mode */ }
      if (!seen) setBriefing(true);
    }, () => live && setAlerts([]));
    return () => { live = false; };
  }, [path, isAdmin, isApprover]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const n = alerts?.length || 0;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-label={n ? `Notifications: ${n}` : "Notifications"} aria-expanded={open}
        className="relative rounded-lg p-2 text-muted hover:bg-sunken hover:text-fg">
        <Bell className="h-5 w-5" />
        {n > 0 && <span className="absolute right-1 top-1 rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">{n}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-border bg-surface p-2 shadow-lg">
          <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted">Needs attention</p>
          {alerts === null ? <p className="px-2 py-3 text-sm text-muted">Loading…</p>
            : n === 0 ? <p className="px-2 py-3 text-sm text-muted">Nothing needs attention.</p>
            : <AlertList alerts={alerts} onPick={() => setOpen(false)} />}
        </div>
      )}
      <ModalPortal open={briefing} onClose={() => setBriefing(false)} labelledBy="briefing-title">
        <h2 id="briefing-title" className="text-lg font-semibold">Since you were last here</h2>
        <p className="mb-3 mt-1 text-sm text-muted">Shown once per sign-in. The bell keeps the same list.</p>
        <AlertList alerts={alerts || []} onPick={() => setBriefing(false)} />
        <div className="mt-4 flex justify-end">
          <button onClick={() => setBriefing(false)} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg">OK</button>
        </div>
      </ModalPortal>
    </div>
  );
}

function UserMenu() {
  const { idNumber, fullName, role, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-expanded={open}
        className="flex items-center gap-2 rounded-lg p-2 text-muted hover:bg-sunken hover:text-fg">
        <User className="h-5 w-5" />
        <span className="hidden max-w-[10rem] truncate text-sm lg:inline">{fullName || idNumber}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-border bg-surface p-2 shadow-lg">
          <div className="px-2 py-1.5">
            <p className="truncate font-medium">{fullName || "—"}</p>
            <p className="text-xs text-muted">ID {idNumber} · {ROLE_LABELS[role] || "IT Officer"}</p>
          </div>
          <hr className="my-1 border-border" />
          <button onClick={signOut} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-sunken">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children }) {
  const path = useCleanPath();
  const router = useRouter();
  const { isAdmin, isApprover } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [pending, setPending] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);

  // Client flags only filter the nav. Access is enforced by RLS, not here.
  const items = useMemo(() => NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin), [isAdmin]);

  // Restored in a mount effect, not in useState's initialiser, to avoid a
  // hydration mismatch between the static HTML and the client.
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* private mode */ }
  }, []);
  const toggleCollapse = () => setCollapsed((c) => {
    try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* private mode */ }
    return !c;
  });

  useEffect(() => setDrawer(false), [path]);

  // Approvers: count releases waiting for a decision (nav badge), and on the
  // first page of a sign-in, land them on the approvals view if any wait.
  useEffect(() => {
    if (!isApprover || PUBLIC_ROUTES.includes(path)) return;
    let live = true;
    const refresh = () => supabase.from("equipment_request").select("request_id", { count: "exact", head: true })
      .eq("release_status", "Pending").then(({ count }) => {
        if (!live) return;
        setPending(count || 0);
        let landed = true;
        try { landed = !!sessionStorage.getItem(APPROVER_LANDED_KEY); sessionStorage.setItem(APPROVER_LANDED_KEY, "1"); } catch { /* private mode */ }
        if (!landed && count > 0 && path === "/") router.replace("/entry/?view=approvals");
      });
    refresh();
    window.addEventListener(PENDING_EVENT, refresh);
    return () => { live = false; window.removeEventListener(PENDING_EVENT, refresh); };
  }, [isApprover, path, router]);
  const badges = { "/entry": pending };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // AFTER every hook, so hook order is stable between renders.
  if (PUBLIC_ROUTES.includes(path)) return <>{children}</>;

  return (
    <div className="min-h-screen">
      <aside className={cn("no-print fixed inset-y-0 left-0 z-30 hidden border-r border-border bg-surface transition-[width] md:flex md:flex-col",
        collapsed ? "w-[4.5rem]" : "w-60")}>
        <SidebarContent items={items} path={path} collapsed={collapsed} onToggleCollapse={toggleCollapse} badges={badges} />
      </aside>

      {drawer && (
        <div className="no-print fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-surface shadow-xl" style={{ paddingTop: "env(safe-area-inset-top)" }}>
            <button onClick={() => setDrawer(false)} aria-label="Close menu" className="absolute right-2 top-3 rounded-lg p-2 text-muted">
              <X className="h-5 w-5" />
            </button>
            <SidebarContent items={items} path={path} collapsed={false} badges={badges} />
          </aside>
        </div>
      )}

      <div className={cn("transition-[padding] print:!pl-0", collapsed ? "md:pl-[4.5rem]" : "md:pl-60")}>
        <header className="no-print sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur"
          style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <div className="flex h-14 items-center gap-2 px-3 md:px-6">
            <button onClick={() => setDrawer(true)} aria-label="Open menu" className="rounded-lg p-2 text-muted md:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <nav aria-label="Breadcrumb" className="min-w-0 flex-1 truncate text-sm">
              <span className="text-muted">ITrack</span>
              <span className="mx-1.5 text-muted">/</span>
              <span className="font-medium">{ROUTE_LABELS[path] || "Not found"}</span>
            </nav>
            <button onClick={() => setPalette(true)} aria-label="Search (Ctrl K)"
              className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm text-muted hover:text-fg">
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden rounded border border-border px-1 text-[10px] sm:inline">Ctrl K</kbd>
            </button>
            <ThemeToggle />
            <AlertBell path={path} />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto max-w-7xl p-4 md:p-6">{children}</main>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} items={items} isAdmin={isAdmin} />
    </div>
  );
}
