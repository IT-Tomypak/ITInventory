"use client";
// Public request tracking — NO login. Request number in, status out, through
// check_request_status() only: no holder, no cost, no note, no names.
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Search, XCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { fmtDateTime } from "../../lib/assets";
import { itContact } from "../../lib/site";
import { inputCls } from "../components/AssetForm";
import { PublicPage } from "../components/LoginScreens";
import { Card, StatusBadge, cn } from "../components/ui";

function steps(s) {
  const closed = s.status === "Rejected" || s.status === "Cancelled";
  const allocated = s.allocated || ["Allocated", "Delivered"].includes(s.status);
  return [
    { label: "Request received", done: true, at: s.created_at },
    ...(s.release_status ? [{ label: s.release_status === "Rejected" ? "Release not approved" : "Release approved",
      done: s.release_status !== "Pending", bad: s.release_status === "Rejected", at: s.approved_at,
      note: s.release_status === "Pending" ? "Waiting for the asset custodian" : null }] : []),
    { label: "Equipment assigned to you", done: allocated, at: null },
    { label: "Delivered", done: !!s.delivered_at || s.status === "Delivered", at: s.delivered_at },
    { label: "Receipt confirmed", done: !!s.ack_at, at: s.ack_at },
  ].map((x) => (closed && !x.done ? { ...x, skipped: true } : x));
}

export default function StatusPage() {
  const [id, setId] = useState("");
  const [result, setResult] = useState(null); // row | "missing"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function lookup(value) {
    const n = Number(String(value).replace(/^#/, "").trim());
    if (!Number.isInteger(n) || n <= 0) return setError("Enter the number on your receipt, e.g. 118.");
    setBusy(true);
    setError("");
    const { data, error } = await supabase.rpc("check_request_status", { p_request_id: n });
    setBusy(false);
    if (error) return setError(`The status could not be checked. Please try again, or call ${itContact()}.`);
    setResult(data?.[0] ?? "missing");
  }

  // /status/?id=118 — linked from the receipt.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("id");
    if (q) { setId(q); lookup(q); }
  }, []);

  return (
    <PublicPage title="Track a request" subtitle="Enter the request number from your receipt.">
      <Card className="p-4 sm:p-6">
        <form onSubmit={(e) => { e.preventDefault(); lookup(id); }} className="flex gap-2">
          <input className={cn(inputCls, "text-base")} inputMode="numeric" placeholder="Request number, e.g. 118"
            aria-label="Request number" value={id} onChange={(e) => setId(e.target.value)} />
          <button disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-brand-fg disabled:opacity-50">
            <Search className="h-4 w-4" />{busy ? "Checking…" : "Check"}
          </button>
        </form>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      </Card>

      {result === "missing" && (
        <Card className="mt-4 p-4 text-sm">No request with that number. Check the number on your receipt, or call {itContact()}.</Card>
      )}
      {result && result !== "missing" && (
        <Card className="mt-4 p-4 sm:p-6" data-testid="status-result">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xl font-bold">#{result.request_id}</p>
            <StatusBadge status={result.status} />
          </div>
          <p className="mt-1 text-sm text-muted">{result.asset_type} · {result.urgency} · sent {fmtDateTime(result.created_at)}</p>
          <ol className="mt-5 space-y-3">
            {steps(result).map((s) => {
              const Icon = s.bad ? XCircle : s.done ? CheckCircle2 : Circle;
              return (
                <li key={s.label} className={cn("flex gap-3", s.skipped && "opacity-40")}>
                  <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", s.bad ? "text-danger" : s.done ? "text-ok" : "text-muted")} />
                  <div>
                    <p className={cn("text-sm", s.done && "font-medium")}>{s.label}</p>
                    {(s.at || s.note) && <p className="text-xs text-muted">{s.at ? fmtDateTime(s.at) : s.note}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          {(result.status === "Rejected" || result.status === "Cancelled") && (
            <p className="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">
              This request was {result.status.toLowerCase()}. Please contact {itContact()} for details.
            </p>
          )}
        </Card>
      )}
    </PublicPage>
  );
}
