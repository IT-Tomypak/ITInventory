"use client";
// Public loan accessories request — NO login. It reads one thing, the
// accessory types that have stock and how many (loanable_accessories()), and
// writes one thing, submit_loan_request(), which rate-limits and logs every
// attempt. IT then issues the unit on Allocate / Return.
import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { fmtDate, today } from "../../lib/assets";
import { itContact } from "../../lib/site";
import { inputCls } from "../components/AssetForm";
import { PublicPage } from "../components/LoginScreens";
import { Card } from "../components/ui";

// A refused person needs to know what to do next, not see an error code.
const REFUSALS = {
  rate_limited_name: () => `You have already sent 5 requests in the last hour. Please wait an hour before sending another, or call ${itContact()} if it cannot wait.`,
  rate_limited_overall: () => `The request form is very busy right now. Please try again in an hour, or call ${itContact()} if it is urgent.`,
  missing_fields: () => "Please fill in every field.",
  invalid_dates: () => "The end date must be on or after the start date.",
  reason_too_long: () => "Please shorten the reason to 2000 characters or fewer.",
  item_unavailable: () => `That item has just run out. Choose another, or call ${itContact()}.`,
};

function L({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

const EMPTY = { name: "", employee_no: "", department: "", phone: "", item_type: "", reason: "", start_on: "", end_on: "" };

export default function PublicLoanPage() {
  const [items, setItems] = useState(null); // [{ item_type, available }]
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(null);   // the accepted request, for the confirmation
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    supabase.rpc("loanable_accessories").then(({ data }) => setItems(data || []));
  }, [sent]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error: err } = await supabase.rpc("submit_loan_request", {
      p_name: f.name.trim(), p_employee_no: f.employee_no.trim(), p_department: f.department.trim(), p_phone: f.phone.trim(),
      p_item_type: f.item_type, p_reason: f.reason.trim(), p_start_on: f.start_on, p_end_on: f.end_on,
    });
    setBusy(false);
    if (err) return setError(`The request could not be sent. Please try again, or call ${itContact()}.`);
    if (!data.ok) return setError((REFUSALS[data.reason] ?? (() => `The request was not accepted. Please call ${itContact()}.`))());
    setSent({ ...f, loan_id: data.loan_id });
    setF(EMPTY);
  }

  if (sent) {
    return (
      <PublicPage title="Loan request sent" subtitle="IT has received your request.">
        <Card className="mx-auto max-w-md p-5" data-testid="loan-receipt">
          <p className="text-xs text-muted">Loan request number</p>
          <p className="text-4xl font-bold tracking-tight">L-{sent.loan_id}</p>
          <dl className="mt-4 space-y-2 text-sm">
            {[["Loaner", sent.name], ["Employee no", sent.employee_no], ["Department", sent.department], ["Phone", sent.phone],
              ["Item", sent.item_type], ["From", fmtDate(sent.start_on)], ["To", fmtDate(sent.end_on)]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted">Quote the number when you contact IT. IT will tell you when the item is ready to collect.</p>
        </Card>
        <button onClick={() => setSent(null)} className="mt-3 w-full text-sm text-muted hover:text-fg">Make another loan request</button>
      </PublicPage>
    );
  }

  return (
    <PublicPage title="Borrow an accessory" subtitle="Ask the IT Department to lend you an accessory. No login needed.">
      <Card className="p-4 sm:p-6">
        {items === null ? <p className="text-sm text-muted">Loading…</p>
          : items.length === 0 ? <p className="text-sm">No accessories are available to borrow right now. Please contact {itContact()}.</p>
          : (
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <L label="Loaner name *"><input className={inputCls} value={f.name} onChange={set("name")} required maxLength={100} autoComplete="name" /></L>
                <L label="Employee no *"><input className={inputCls} value={f.employee_no} onChange={set("employee_no")} required maxLength={30} /></L>
                <L label="Loaner department *"><input className={inputCls} value={f.department} onChange={set("department")} required maxLength={100} /></L>
                <L label="Phone no *"><input type="tel" className={inputCls} value={f.phone} onChange={set("phone")} required maxLength={30} autoComplete="tel" /></L>
                <L label="Loaned item *">
                  <select className={inputCls} value={f.item_type} onChange={set("item_type")} required>
                    <option value="">Choose an item…</option>
                    {items.map((i) => <option key={i.item_type} value={i.item_type}>{i.item_type} ({i.available} available)</option>)}
                  </select>
                </L>
                <span className="hidden sm:block" />
                <L label="Start date (estimate) *">
                  <input type="date" className={inputCls} value={f.start_on} onChange={set("start_on")} required min={today()} />
                </L>
                <L label="End date (estimate) *">
                  <input type="date" className={inputCls} value={f.end_on} onChange={set("end_on")} required min={f.start_on || today()} />
                </L>
              </div>
              <L label="Reason *">
                <textarea rows={3} className={inputCls} value={f.reason} onChange={set("reason")} required maxLength={2000}
                  placeholder="e.g. My mouse stopped working; I need one until the replacement arrives." />
              </L>
              {error && <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}
              <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 font-medium text-brand-fg disabled:opacity-50 sm:w-auto">
                <Send className="h-4 w-4" />{busy ? "Sending…" : "Send loan request"}
              </button>
            </form>
          )}
      </Card>
      <p className="mt-4 text-center text-sm text-muted">
        Need new hardware instead? <a href="/request/" className="font-medium text-brand">Request equipment</a>
      </p>
    </PublicPage>
  );
}
