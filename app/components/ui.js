"use client";
// Every reusable piece of UI. Pages compose from this file; nothing bespoke per page.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, ChevronLeft, ChevronRight,
  HelpCircle, Info, Inbox, Moon, Sun, Trash2, X, XCircle,
} from "lucide-react";
import { toggleTheme } from "../../lib/theme";

export const cn = (...a) => twMerge(clsx(a));

// Static export: pathnames arrive WITH a trailing slash in production
// (trailingSlash: true) and without one in `next dev`. Normalise every read, or
// every breadcrumb says "Not found" in production while dev looks perfect.
export function useCleanPath() {
  return (usePathname() || "/").replace(/\/+$/, "") || "/";
}

// Fired after a release decision so AppShell refreshes the approver's nav badge
// without waiting for a page change.
export const PENDING_EVENT = "itrack:pending-changed";

// ---------------------------------------------------------------- toasts
// A custom-event bus: no library, callable from anywhere, including non-React code.
const TOAST_EVENT = "itrack:toast";
let toastSeq = 0;
export function toast(message, type = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { id: ++toastSeq, message, type } }));
}
toast.success = (m) => toast(m, "success");
toast.error = (m) => toast(m, "error");

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const on = (e) => {
      const t = e.detail;
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), t.type === "error" ? 7000 : 4000);
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => window.removeEventListener(TOAST_EVENT, on);
  }, []);
  const icon = { success: CheckCircle2, error: XCircle, info: Info };
  return (
    <div aria-live="polite" className="no-print fixed bottom-4 right-4 left-4 sm:left-auto z-[100] flex flex-col gap-2 sm:w-96">
      {items.map((t) => {
        const Icon = icon[t.type] || Info;
        return (
          <div key={t.id} role={t.type === "error" ? "alert" : "status"}
            className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3 shadow-lg text-sm">
            <Icon className={cn("h-5 w-5 shrink-0", t.type === "error" ? "text-danger" : t.type === "success" ? "text-ok" : "text-info")} />
            <span className="flex-1">{t.message}</span>
            <button aria-label="Dismiss" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}>
              <X className="h-4 w-4 text-muted" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- brand
// Inline SVG, never a .png: shared hosts' hotlink protection blocks image
// requests outright (brief §9), so the logo must not be a separate file.
export function BrandLogo({ size = 32, withText = false, className }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-brand" />
        <path d="M9 11.5 16 8l7 3.5v9L16 24l-7-3.5z" fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round" />
        <path d="M9 11.5 16 15l7-3.5M16 15v9" fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      {withText && <span className="font-semibold tracking-tight text-lg">ITrack</span>}
    </span>
  );
}

// Sun/moon swap is pure CSS (dark:hidden / hidden dark:block) so the icon is
// correct on the very first paint, before React has mounted.
export function ThemeToggle({ className }) {
  return (
    <button type="button" onClick={toggleTheme} aria-label="Toggle dark mode"
      className={cn("rounded-lg p-2 text-muted hover:bg-sunken hover:text-fg", className)}>
      <Moon className="h-5 w-5 dark:hidden" />
      <Sun className="hidden h-5 w-5 dark:block" />
    </button>
  );
}

// ---------------------------------------------------------------- layout bits
export function Card({ className, children, ...rest }) {
  return <div className={cn("rounded-2xl border border-border bg-surface", className)} {...rest}>{children}</div>;
}

// "?" beside a feature, linking into the user guide. Note the trailing slash
// BEFORE the hash: Apache 301s /help#slug and some browsers drop the fragment.
// Slugs are a contract checked by tools/check-help.mjs.
export function HelpLink({ section, className }) {
  return (
    <a href={`/help/#${section}`} title="Help" aria-label="Help for this feature"
      className={cn("inline-flex text-muted hover:text-brand", className)}>
      <HelpCircle className="h-4 w-4" />
    </a>
  );
}

export function PageHeader({ title, subtitle, actions, help }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          {title}{help && <HelpLink section={help} />}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  ok: "bg-ok/10 text-ok", warn: "bg-warn/10 text-warn", danger: "bg-danger/10 text-danger",
  info: "bg-info/10 text-info", muted: "bg-muted/10 text-muted", brand: "bg-brand/10 text-brand",
};

export function KpiCard({ label, value, icon: Icon, tone = "brand", onClick, active }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} aria-pressed={onClick ? !!active : undefined}
      className={cn("flex items-center gap-3 rounded-2xl border bg-surface p-4 text-left",
        active ? "border-brand ring-1 ring-brand" : "border-border", onClick && "hover:border-brand/60")}>
      {Icon && <span className={cn("rounded-xl p-2", TONES[tone])}><Icon className="h-5 w-5" /></span>}
      <span>
        <span className="block text-xs text-muted">{label}</span>
        <span className="block text-xl font-semibold tabular-nums">{value}</span>
      </span>
    </Tag>
  );
}

const STATUS_TONE = {
  "In stock": "ok", Assigned: "info", "In repair": "warn", Loaned: "brand", Retired: "muted", "Lost/Stolen": "danger",
  Requested: "info", Approved: "ok", Allocated: "brand", Delivered: "ok", Rejected: "danger", Cancelled: "muted",
  Pending: "warn",
  // IT Hardware (assets.hw_status)
  Registered: "brand", Active: "info", Handover: "warn", Repair: "warn", Vacant: "ok",
};
export function StatusBadge({ status }) {
  if (!status) return null;
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONES[STATUS_TONE[status] || "muted"])}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------- loading / empty
export function Skeleton({ className }) {
  return <div className={cn("animate-pulse rounded-md bg-sunken", className)} />;
}
export function KpiSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} className="h-[74px] rounded-2xl" />)}
    </div>
  );
}
export function TableSkeleton({ rows = 6, cols = 5 }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }, (_, c) => <Skeleton key={c} className="h-8 flex-1" />)}
        </div>
      ))}
    </div>
  );
}
export function EmptyState({ icon: Icon = Inbox, title, message, action }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Icon className="h-10 w-10 text-muted" />
      <p className="font-medium">{title}</p>
      {message && <p className="max-w-sm text-sm text-muted">{message}</p>}
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- tables
// sort = { field, dir: "asc" | "desc" }
export function SortableTh({ label, field, sort, setSort, className }) {
  const active = sort?.field === field;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-2 text-left text-xs font-medium text-muted", className)}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-fg"
        onClick={() => setSort({ field, dir: active && sort.dir === "asc" ? "desc" : "asc" })}>
        {label}<Icon className="h-3 w-3" />
      </button>
    </th>
  );
}

export function Pagination({ page, pageSize, total, onPage, onPageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm text-muted">
      <span>{from}–{to} of {total}</span>
      <div className="flex items-center gap-2">
        <select aria-label="Rows per page" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}
          className="rounded-lg border border-border bg-surface px-2 py-1">
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <button aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}
          className="rounded-lg border border-border p-1 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
        <span className="tabular-nums">{page} / {pages}</span>
        <button aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}
          className="rounded-lg border border-border p-1 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- modals
export function ModalPortal({ open, onClose, children, labelledBy, wide }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!mounted || !open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        className={cn("max-h-[90vh] w-full overflow-auto rounded-t-2xl border border-border bg-surface p-5 shadow-xl sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", danger, busy, onConfirm, onCancel }) {
  return (
    <ModalPortal open={open} onClose={onCancel} labelledBy="confirm-title">
      <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>
      {message && <div className="mt-2 text-sm text-muted">{message}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
        <button onClick={onConfirm} disabled={busy}
          className={cn("rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50", danger ? "bg-danger" : "bg-brand")}>
          {confirmLabel}
        </button>
      </div>
    </ModalPortal>
  );
}

// Press-and-hold for destructive actions: a sweeping fill, confirmed when it
// completes. Works with pointer AND keyboard (hold Space/Enter). Pass
// confirmIcon so a non-delete action does not show a bin.
export function HoldToConfirmButton({ onConfirm, label, holdMs = 1200, confirmIcon: Icon = Trash2, disabled, className }) {
  const [progress, setProgress] = useState(0);
  const raf = useRef(null);
  const begin = () => {
    if (disabled || raf.current) return;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / holdMs);
      setProgress(p);
      if (p >= 1) { raf.current = null; setProgress(0); onConfirm(); }
      else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const cancel = () => { cancelAnimationFrame(raf.current); raf.current = null; setProgress(0); };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return (
    <button type="button" disabled={disabled} aria-label={`Hold to ${label}`} title={`Press and hold to ${label.toLowerCase()}`}
      onPointerDown={begin} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
      onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); begin(); } }}
      onKeyUp={cancel} onBlur={cancel} onContextMenu={(e) => e.preventDefault()}
      className={cn("relative select-none overflow-hidden rounded-lg border border-danger/40 px-3 py-2 text-sm font-medium text-danger disabled:opacity-40", className)}>
      <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-danger/20" style={{ width: `${progress * 100}%` }} />
      <span className="relative inline-flex items-center gap-1.5"><Icon className="h-4 w-4" />{label}</span>
    </button>
  );
}

export function Spinner({ className }) {
  return <span role="status" aria-label="Loading" className={cn("inline-block h-6 w-6 rounded-full border-2 border-border border-t-brand", className)} style={{ animation: "itrack-spin .8s linear infinite" }} />;
}
