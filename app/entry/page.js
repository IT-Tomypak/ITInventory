"use client";
// Equipment Request — the internal request form, the request queue, and the
// release approval box. Viewers may RAISE a request (RLS "insert for
// authenticated") but change nothing. Only approvers see the decision box,
// and trg_guard_asset_release refuses anyone else's decision regardless.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight, CheckCircle2, ClipboardList, Download, Hand, Plus, Search, ShieldCheck, X, XCircle,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { fetchAll, fmtDate, fmtDateTime } from "../../lib/assets";
import { splitPhotos, uploadPhoto } from "../../lib/photos";
import { useAuth } from "../components/AuthProvider";
import { inputCls } from "../components/AssetForm";
import { RequestForm, RequestReceipt, downloadReceipt } from "../components/RequestForm";
import { Card, EmptyState, ModalPortal, PENDING_EVENT, PageHeader, StatusBadge, TableSkeleton, cn, toast } from "../components/ui";

const OPEN = ["Requested", "Approved", "Allocated"];
const STATUS_CHOICES = { Requested: ["Approved", "Rejected", "Cancelled"], Approved: ["Requested", "Rejected", "Cancelled"],
  Allocated: ["Delivered"], Delivered: [], Rejected: ["Requested"], Cancelled: ["Requested"] };

const toReceipt = (r) => ({
  requestId: r.request_id, createdAt: r.created_at, name: r.requested_by_name, department: r.department,
  assetType: r.asset_type, urgency: r.urgency, photoCount: splitPhotos(r.attachment_path).length, justification: r.justification,
});

// The decision. Retyping one's own ID number is a signature, not a password:
// it makes approving a deliberate act. approved_by is stamped by the database
// from the session, never from anything typed here.
function ApprovalBox({ r, idNumber, onDone }) {
  const [note, setNote] = useState("");
  const [sig, setSig] = useState("");
  const [busy, setBusy] = useState(false);
  async function decide(decision) {
    if (sig.trim() !== idNumber) return toast.error("Type your own ID number to sign the decision.");
    if (decision === "Rejected" && !note.trim()) return toast.error("Say why the release is rejected.");
    setBusy(true);
    const { error } = await supabase.from("equipment_request")
      .update({ release_status: decision, approval_note: note.trim() || null }).eq("request_id", r.request_id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Release for #${r.request_id} ${decision.toLowerCase()}.`);
    window.dispatchEvent(new Event(PENDING_EVENT));
    onDone();
  }
  return (
    <div className="mt-3 rounded-xl border border-warn/40 bg-warn/5 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-warn" /> Release decision</p>
      <textarea rows={2} className={inputCls} placeholder="Remarks (required to reject)" value={note} onChange={(e) => setNote(e.target.value)}
        aria-label={`Remarks for request ${r.request_id}`} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input className={cn(inputCls, "w-44")} placeholder="Your ID number" value={sig} onChange={(e) => setSig(e.target.value)}
          aria-label={`Sign with your ID number for request ${r.request_id}`} autoComplete="off" />
        <button disabled={busy} onClick={() => decide("Approved")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ok px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          <CheckCircle2 className="h-4 w-4" /> Approve release
        </button>
        <button disabled={busy} onClick={() => decide("Rejected")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          <XCircle className="h-4 w-4" /> Reject
        </button>
      </div>
    </div>
  );
}

function RequestCard({ r, staff, assetTag, canEdit, canDecide, idNumber, onChanged }) {
  const photos = splitPhotos(r.attachment_path);
  const handler = staff.find((s) => s.staff_id === r.handled_by);
  const update = async (patch, msg) => {
    const { error } = await supabase.from("equipment_request").update(patch).eq("request_id", r.request_id);
    if (error) return toast.error(error.message);
    toast.success(msg);
    if ("release_status" in patch) window.dispatchEvent(new Event(PENDING_EVENT));
    onChanged();
  };
  return (
    <li className="rounded-xl border border-border bg-surface p-3 sm:p-4" data-testid={`request-${r.request_id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">#{r.request_id}</span>
        <StatusBadge status={r.status} />
        {r.urgency === "Urgent" && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">Urgent</span>}
        {r.release_status && <span className="text-xs text-muted">Release: <StatusBadge status={r.release_status} /></span>}
        <span className="ml-auto text-xs text-muted">{fmtDateTime(r.created_at)}</span>
      </div>
      <p className="mt-1 text-sm"><span className="font-medium">{r.requested_by_name}</span> · {r.department} · needs a <span className="font-medium">{r.asset_type}</span></p>
      {r.justification && <p className="mt-1 whitespace-pre-line break-words text-sm text-muted">{r.justification}</p>}
      {photos.length > 0 && (
        <div className="mt-2 flex gap-2">
          {photos.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="Request photo" loading="lazy" className="h-16 w-16 rounded-lg border border-border object-cover" />
            </a>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-muted">
        Handled by {handler?.full_name ?? "nobody yet"}
        {assetTag && <> · asset <span className="font-medium text-fg">{assetTag}</span></>}
        {r.delivered_at && <> · delivered {fmtDate(r.delivered_at)}</>}
        {r.ack_at && <> · receipt confirmed by {r.ack_by_name}</>}
        {r.approved_by && <> · release {r.release_status?.toLowerCase()} by {r.approved_by} {fmtDate(r.approved_at)}{r.approval_note && ` — “${r.approval_note}”`}</>}
        {" · "}from {r.created_by_name || "—"}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canEdit && (
          <>
            <select aria-label={`Handler for request ${r.request_id}`} className={cn(inputCls, "w-auto py-1.5")} value={r.handled_by ?? ""}
              onChange={(e) => update({ handled_by: e.target.value ? Number(e.target.value) : null }, `Handler updated for #${r.request_id}.`)}>
              <option value="">Assign handler…</option>
              {staff.map((s) => <option key={s.staff_id} value={s.staff_id}>{s.full_name}</option>)}
            </select>
            {STATUS_CHOICES[r.status]?.length > 0 && (
              <select aria-label={`Change status of request ${r.request_id}`} className={cn(inputCls, "w-auto py-1.5")} value=""
                onChange={(e) => e.target.value && update(
                  { status: e.target.value, ...(e.target.value === "Delivered" ? { delivered_at: new Date().toISOString() } : {}) },
                  `#${r.request_id} is now ${e.target.value}.`)}>
                <option value="">Set status…</option>
                {STATUS_CHOICES[r.status].map((s) => <option key={s}>{s}</option>)}
              </select>
            )}
            {["Requested", "Approved"].includes(r.status) && (
              <a href={`/allocate/?request=${r.request_id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm">
                <ArrowLeftRight className="h-4 w-4" /> Allocate
              </a>
            )}
            {OPEN.includes(r.status) && (r.release_status == null || r.release_status === "Rejected") && (
              <button onClick={() => update({ release_status: "Pending" }, `Release requested for #${r.request_id}.`)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm">
                <Hand className="h-4 w-4" /> Ask for release
              </button>
            )}
          </>
        )}
        <button onClick={() => downloadReceipt(toReceipt(r))} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:text-fg">
          <Download className="h-4 w-4" /> Receipt
        </button>
      </div>
      {canDecide && r.release_status === "Pending" && <ApprovalBox r={r} idNumber={idNumber} onDone={onChanged} />}
    </li>
  );
}

export default function EntryPage() {
  const { isViewer, isApprover, idNumber, fullName } = useAuth();
  const [rows, setRows] = useState(null);
  const [staff, setStaff] = useState([]);
  const [tags, setTags] = useState(new Map());
  const [error, setError] = useState(null);
  const [view, setView] = useState("queue");
  const [showClosed, setShowClosed] = useState(false);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null); // "form" | receipt object

  const reload = useCallback(async () => {
    try {
      const [reqs, st, assets] = await Promise.all([
        fetchAll(() => supabase.from("equipment_request").select("*").order("request_id")),
        fetchAll(() => supabase.from("staff").select("staff_id, full_name, department, login_id").order("full_name")),
        fetchAll(() => supabase.from("assets").select("asset_id, asset_tag").order("asset_id")),
      ]);
      setRows(reqs);
      setStaff(st);
      setTags(new Map(assets.map((a) => [a.asset_id, a.asset_tag])));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "approvals") setView("approvals");
  }, []);

  const me = staff.find((s) => s.login_id === idNumber);
  const pending = useMemo(() => (rows ?? []).filter((r) => r.release_status === "Pending"), [rows]);
  // Urgent first, then the one waiting longest.
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^#/, "");
    return (view === "approvals" ? pending : (rows ?? []).filter((r) => showClosed || OPEN.includes(r.status)))
      .filter((r) => !t || String(r.request_id) === t || [r.requested_by_name, r.department, r.asset_type].some((v) => v?.toLowerCase().includes(t)))
      .sort((a, b) => (b.urgency === "Urgent") - (a.urgency === "Urgent") || a.created_at.localeCompare(b.created_at));
  }, [rows, pending, view, showClosed, q]);

  async function submitInternal(fields, files) {
    const urls = await Promise.all(files.map((file) => uploadPhoto(file, "requests")));
    const { data, error } = await supabase.from("equipment_request").insert({
      requested_by_name: fields.name, department: fields.department, asset_type: fields.asset_type, urgency: fields.urgency,
      justification: fields.justification || null, attachment_path: urls.join("\n") || null,
    }).select("*").single();
    if (error) throw new Error(error.message);
    reload();
    return toReceipt(data);
  }

  return (
    <>
      <PageHeader title="Equipment Request" help="equipment-request"
        subtitle="Raise a request for someone, and work the queue from request to delivery."
        actions={
          <button onClick={() => setModal("form")} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-fg">
            <Plus className="h-4 w-4" /> New request
          </button>
        } />
      {error && <Card className="mb-4 p-4 text-danger" role="alert">Error loading data: {error}</Card>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" className="inline-flex rounded-xl border border-border bg-surface p-1">
          <button role="tab" aria-selected={view === "queue"} onClick={() => setView("queue")}
            className={cn("rounded-lg px-4 py-2 text-sm font-medium", view === "queue" ? "bg-brand text-brand-fg" : "text-muted")}>Queue</button>
          {isApprover && (
            <button role="tab" aria-selected={view === "approvals"} onClick={() => setView("approvals")}
              className={cn("inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium", view === "approvals" ? "bg-brand text-brand-fg" : "text-muted")}>
              Approvals
              {pending.length > 0 && <span className="rounded-full bg-warn px-1.5 text-xs text-white">{pending.length}</span>}
            </button>
          )}
        </div>
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input className={cn(inputCls, "pl-9")} placeholder="Search #number, name, department, type" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search requests" />
        </div>
        {view === "queue" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show delivered and closed
          </label>
        )}
      </div>

      {!rows && !error && <Card className="p-4"><TableSkeleton rows={4} cols={3} /></Card>}
      {rows && shown.length === 0 && (
        <Card><EmptyState icon={ClipboardList}
          title={view === "approvals" ? "Nothing waiting for a release decision" : "No open requests"}
          message={view === "approvals" ? "Requests appear here when an officer asks for a release." : "New requests from the public form and from here appear in this queue."} /></Card>
      )}
      {rows && shown.length > 0 && (
        <ul className="space-y-3">
          {shown.map((r) => (
            <RequestCard key={r.request_id} r={r} staff={staff} assetTag={tags.get(r.asset_id)} canEdit={!isViewer}
              canDecide={isApprover} idNumber={idNumber} onChanged={reload} />
          ))}
        </ul>
      )}

      <ModalPortal wide open={!!modal} onClose={() => setModal(null)} labelledBy="new-request-title">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="new-request-title" className="text-lg font-semibold">{modal === "form" ? "New equipment request" : "Request sent"}</h2>
          <button onClick={() => setModal(null)} aria-label="Close" className="rounded-lg border border-border p-2"><X className="h-4 w-4" /></button>
        </div>
        {modal === "form" && (
          <RequestForm defaultName={fullName || me?.full_name || ""} defaultDepartment={me?.department || ""}
            onSubmit={submitInternal} onDone={(receipt) => setModal(receipt)} />
        )}
        {modal && modal !== "form" && <RequestReceipt receipt={modal} />}
      </ModalPortal>
    </>
  );
}
