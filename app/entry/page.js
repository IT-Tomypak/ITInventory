"use client";
// Equipment Request — the internal request form, the request queue, the
// release approval box, and the queue of loan accessories requests (raised on
// the public /loan page). Viewers may RAISE a request (RLS "insert for
// authenticated") but change nothing. Only approvers see the decision box,
// and trg_guard_asset_release refuses anyone else's decision regardless.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight, CheckCircle2, ClipboardList, Download, Hand, Plus, Search, ShieldCheck, Timer, X, XCircle,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { fetchAll, fmtDate, fmtDateTime } from "../../lib/assets";
import { splitPhotos, uploadPhoto } from "../../lib/photos";
import { useAuth } from "../components/AuthProvider";
import { inputCls } from "../components/AssetForm";
import { RequestForm, RequestReceipt, downloadReceipt } from "../components/RequestForm";
import { Card, EmptyState, ModalPortal, PENDING_EVENT, PageHeader, StatusBadge, TableSkeleton, cn, toast } from "../components/ui";

const OPEN = ["Requested", "Approved", "Allocated"];
const STATUS_CHOICES = {
  Requested: ["Approved", "Rejected", "Cancelled"], Approved: ["Requested", "Rejected", "Cancelled"],
  Allocated: ["Delivered"], Delivered: [], Rejected: ["Requested"], Cancelled: ["Requested"]
};

// Loan accessories requests move by hand: IT issues the unit on Allocate / Return.
const LOAN_CHOICES = {
  Requested: ["Approved", "Rejected", "Cancelled"], Approved: ["Issued", "Rejected", "Cancelled"],
  Issued: ["Returned"], Returned: [], Rejected: ["Requested"], Cancelled: ["Requested"]
};
const LOAN_OPEN = ["Requested", "Approved", "Issued"];

const toReceipt = (r) => ({
  requestId: r.request_id, createdAt: r.created_at, name: r.requested_by_name, employeeNo: r.employee_no,
  department: r.department, hod: r.hod,
  assetType: r.services || r.asset_type, urgency: r.urgency, photoCount: splitPhotos(r.attachment_path).length, justification: r.justification,
});

// Stage 2 — IT Approval Box. Shown to IT when Stage 1 (HOD) has been approved.
function ITApprovalBox({ r, onDone }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(decision) {
    if (decision === "Rejected" && !note.trim()) {
      return toast.error("Please provide a reason for rejecting this request.");
    }
    setBusy(true);
    // status, approved_by and approved_at are set by trg_guard_asset_release.
    const { error } = await supabase.from("equipment_request").update({
      release_status: decision, approval_note: note.trim() || null,
    }).eq("request_id", r.request_id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Request #${r.request_id} ${decision.toLowerCase()} by IT.`);
    window.dispatchEvent(new Event(PENDING_EVENT));
    onDone();
  }

  return (
    <div className="mt-3 rounded-xl border border-brand/30 bg-brand/5 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-brand">
        <ShieldCheck className="h-4 w-4" /> Stage 2 — IT Review & Stock Check
      </p>
      <textarea
        rows={2}
        className={inputCls}
        placeholder="Remarks / Stock check notes (required if rejecting)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label={`Remarks for request ${r.request_id}`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          disabled={busy}
          onClick={() => decide("Approved")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ok px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" /> Approve
        </button>
        <button
          disabled={busy}
          onClick={() => decide("Rejected")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          <XCircle className="h-4 w-4" /> Reject
        </button>
      </div>
    </div>
  );
}

function RequestCard({ r, canDecide, onChanged }) {
  const photos = splitPhotos(r.attachment_path);
  const isHodPending = r.hod_approval_status === "Pending" || !r.hod_approval_status;
  const isHodApproved = r.hod_approval_status === "Approved";
  const isHodRejected = r.hod_approval_status === "Rejected";
  const isItDecided = ["Approved", "Rejected"].includes(r.release_status) || ["Approved", "Rejected", "Cancelled"].includes(r.status);

  return (
    <li className="rounded-xl border border-border bg-surface p-3 sm:p-4" data-testid={`request-${r.request_id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">#{r.request_id}</span>
        <StatusBadge status={r.status} />
        {r.urgency === "Urgent" && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">Urgent</span>}
        <span className={cn(
          "rounded-full px-2 py-0.5 text-xs font-semibold",
          isHodApproved ? "bg-ok/15 text-ok" : isHodRejected ? "bg-danger/15 text-danger" : "bg-warn/15 text-warn"
        )}>
          HOD: {r.hod_approval_status || "Pending"}
        </span>
        {r.release_status && (
          <span className="text-xs text-muted">IT: <StatusBadge status={r.release_status} /></span>
        )}
        <span className="ml-auto text-xs text-muted">{fmtDateTime(r.created_at)}</span>
      </div>

      <p className="mt-1 text-sm">
        <span className="font-medium">{r.requested_by_name}</span>{r.employee_no && ` (${r.employee_no})`} · {r.department}
        {r.hod && <> · HOD <span className="font-medium">{r.hod}</span></>} · requests <span className="font-medium">{r.services || r.asset_type}</span>
      </p>

      {(r.requester_email || r.hod_email) && (
        <p className="mt-1 text-xs text-muted">
          {r.requester_email && <>Requester: {r.requester_email}</>}
          {r.requester_email && r.hod_email && " · "}
          {r.hod_email && <>HOD: {r.hod_email}</>}
        </p>
      )}

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

      {/* Decision trail */}
      <div className="mt-2 text-xs space-y-0.5">
        {r.hod_approved_by_name && (
          <p className={isHodApproved ? "text-ok" : "text-danger"}>
            Stage 1: HOD {r.hod_approval_status?.toLowerCase()} by {r.hod_approved_by_name} {fmtDate(r.hod_approved_at)}
            {r.hod_approval_note && ` — “${r.hod_approval_note}”`}
          </p>
        )}
        {r.approved_by && (
          <p className={r.release_status === "Approved" ? "text-ok" : "text-danger"}>
            Stage 2: IT {r.release_status?.toLowerCase()} by {r.approved_by} {fmtDate(r.approved_at)}
            {r.approval_note && ` — “${r.approval_note}”`}
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/50 pt-2">
        <button onClick={() => downloadReceipt(toReceipt(r))} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:text-fg">
          <Download className="h-4 w-4" /> Download receipt
        </button>
      </div>

      {/* Stage 1: Waiting for HOD */}
      {isHodPending && (
        <div className="mt-2 rounded-lg border border-warn/30 bg-warn/5 p-2.5 text-xs text-warn">
          ⏳ <strong>Stage 1 Pending:</strong> Awaiting HOD ({r.hod}) approval via email before IT can review.
        </div>
      )}

      {/* Stage 2: IT Review & Stock check (active when HOD approved and IT has not decided) */}
      {isHodApproved && !isItDecided && (canDecide
        ? <ITApprovalBox r={r} onDone={onChanged} />
        : <div className="mt-2 rounded-lg border border-border bg-surface p-2.5 text-xs text-muted">HOD approved. Waiting for the IT decision.</div>
      )}
    </li>
  );
}

function LoanCard({ l, canEdit, onChanged }) {
  const setStatus = async (status) => {
    const { error } = await supabase.from("loan_request").update({ status }).eq("loan_id", l.loan_id);
    if (error) return toast.error(error.message);
    toast.success(`Loan request L-${l.loan_id} is now ${status}.`);
    onChanged();
  };
  return (
    <li className="rounded-xl border border-border bg-surface p-3 sm:p-4" data-testid={`loan-${l.loan_id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">L-{l.loan_id}</span>
        <StatusBadge status={l.status} />
        <span className="ml-auto text-xs text-muted">{fmtDateTime(l.created_at)}</span>
      </div>
      <p className="mt-1 text-sm">
        <span className="font-medium">{l.loaner_name}</span> ({l.employee_no}) · {l.department} · {l.phone} · wants to borrow a <span className="font-medium">{l.item_type}</span>
      </p>
      <p className="mt-1 text-sm">{fmtDate(l.start_on)} to {fmtDate(l.end_on)}</p>
      <p className="mt-1 whitespace-pre-line break-words text-sm text-muted">{l.reason}</p>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {LOAN_CHOICES[l.status].length > 0 && (
            <select aria-label={`Change status of loan request ${l.loan_id}`} className={cn(inputCls, "w-auto py-1.5")} value=""
              onChange={(e) => e.target.value && setStatus(e.target.value)}>
              <option value="">Set status…</option>
              {LOAN_CHOICES[l.status].map((s) => <option key={s}>{s}</option>)}
            </select>
          )}
          {["Requested", "Approved"].includes(l.status) && (
            <a href={`/allocate/?due=${l.end_on}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm">
              <ArrowLeftRight className="h-4 w-4" /> Issue the loan
            </a>
          )}
        </div>
      )}
    </li>
  );
}

export default function EntryPage() {
  const { isViewer, isApprover, idNumber, fullName } = useAuth();
  const [rows, setRows] = useState(null);
  const [loans, setLoans] = useState([]);
  const [staff, setStaff] = useState([]);
  const [hods, setHods] = useState([]); // { name, email }: IT's HOD list
  const [tags, setTags] = useState(new Map());
  const [error, setError] = useState(null);
  const [view, setView] = useState("queue");
  const [showClosed, setShowClosed] = useState(false);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null); // "form" | receipt object

  const reload = useCallback(async () => {
    try {
      const [reqs, lns, st, assets, hd] = await Promise.all([
        fetchAll(() => supabase.from("equipment_request").select("*").order("request_id")),
        fetchAll(() => supabase.from("loan_request").select("*").order("loan_id")),
        fetchAll(() => supabase.from("staff").select("staff_id, full_name, department, login_id").order("full_name")),
        fetchAll(() => supabase.from("assets").select("asset_id, asset_tag").order("asset_id")),
        fetchAll(() => supabase.from("hod").select("name, email").eq("active", true).order("name")),
      ]);
      setRows(reqs);
      setLoans(lns);
      setStaff(st);
      setHods(hd);
      setTags(new Map(assets.map((a) => [a.asset_id, a.asset_tag])));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    if (["approvals", "loans"].includes(v)) setView(v);
  }, []);

  const me = staff.find((s) => s.login_id === idNumber);
  const pending = useMemo(() => (rows ?? []).filter((r) => r.release_status === "Pending"), [rows]);
  // Urgent first, then the one waiting longest.
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^#/, "");
    return (view === "approvals" ? pending : (rows ?? []).filter((r) => showClosed || OPEN.includes(r.status)))
      .filter((r) => !t || String(r.request_id) === t || [r.requested_by_name, r.employee_no, r.department, r.services, r.asset_type].some((v) => v?.toLowerCase().includes(t)))
      .sort((a, b) => (b.urgency === "Urgent") - (a.urgency === "Urgent") || a.created_at.localeCompare(b.created_at));
  }, [rows, pending, view, showClosed, q]);
  const shownLoans = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^l-/, "");
    return loans.filter((l) => showClosed || LOAN_OPEN.includes(l.status))
      .filter((l) => !t || String(l.loan_id) === t || [l.loaner_name, l.employee_no, l.department, l.item_type].some((v) => v?.toLowerCase().includes(t)));
  }, [loans, showClosed, q]);
  const loansWaiting = loans.filter((l) => l.status === "Requested").length;

  async function submitInternal(fields, files) {
    const urls = await Promise.all(files.map((file) => uploadPhoto(file, "requests")));
    const { data, error } = await supabase.from("equipment_request").insert({
      requested_by_name: fields.name, department: fields.department, asset_type: fields.services[0], urgency: fields.urgency,
      employee_no: fields.employee_no, hod: fields.hod, services: fields.services.join(", "),
      requester_email: fields.email.toLowerCase(), hod_email: hods.find((h) => h.name === fields.hod)?.email ?? null,
      justification: fields.justification || null, attachment_path: urls.join("\n") || null,
    }).select("*").single();
    if (error) throw new Error(error.message);
    reload();
    return toReceipt(data);
  }

  return (
    <>
      <PageHeader title="Equipment Request" help="equipment-request"
        subtitle="Raise a request for someone. The HOD approves by email, then IT decides here."
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
          <button role="tab" aria-selected={view === "loans"} onClick={() => setView("loans")}
            className={cn("inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium", view === "loans" ? "bg-brand text-brand-fg" : "text-muted")}>
            Loan requests
            {loansWaiting > 0 && <span className="rounded-full bg-warn px-1.5 text-xs text-white">{loansWaiting}</span>}
          </button>
        </div>
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input className={cn(inputCls, "pl-9")} placeholder="Search #number, name, department, type" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search requests" />
        </div>
        {view !== "approvals" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show delivered and closed
          </label>
        )}
      </div>

      {!rows && !error && <Card className="p-4"><TableSkeleton rows={4} cols={3} /></Card>}
      {rows && view === "loans" && (shownLoans.length === 0 ? (
        <Card><EmptyState icon={Timer} title="No open loan requests"
          message="Requests to borrow an accessory, sent from the public loan form, appear here." /></Card>
      ) : (
        <ul className="space-y-3">
          {shownLoans.map((l) => <LoanCard key={l.loan_id} l={l} canEdit={!isViewer} onChanged={reload} />)}
        </ul>
      ))}
      {rows && view !== "loans" && shown.length === 0 && (
        <Card><EmptyState icon={ClipboardList}
          title={view === "approvals" ? "Nothing waiting for an IT decision" : "No open requests"}
          message={view === "approvals" ? "Requests appear here once the requester's HOD has approved them by email." : "New requests from the public form and from here appear in this queue."} /></Card>
      )}
      {rows && view !== "loans" && shown.length > 0 && (
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
          <RequestForm defaultName={fullName || me?.full_name || ""} defaultDepartment={me?.department || ""} hods={hods.map((h) => h.name)}
            onSubmit={submitInternal} onDone={(receipt) => setModal(receipt)} />
        )}
        {modal && modal !== "form" && <RequestReceipt receipt={modal} />}
      </ModalPortal>
    </>
  );
}
