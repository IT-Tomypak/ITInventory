"use client";
// /assign — where an action button in an ITrack email lands. NO login: the
// token in the URL is the authorisation (see assign-action).
//
// Opening this page must WRITE NOTHING. Microsoft 365 Safe Links opens every
// link in an incoming message by itself, before any human sees it. So the page
// only previews; the write happens on the button press.
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { itContact } from "../../lib/site";
import { inputCls } from "../components/AssetForm";
import { PublicPage } from "../components/LoginScreens";
import { Card, cn } from "../components/ui";

async function call(body) {
  const { data, error } = await supabase.functions.invoke("assign-action", { body });
  return error ? { ok: false, reason: `ITrack could not be reached. Please try again, or contact ${itContact()}.` } : data;
}

export default function AssignPage() {
  const [link, setLink] = useState(null);   // { token, choice }
  const [state, setState] = useState(null); // assignment_link() result
  const [sig, setSig] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const l = { token: p.get("t") ?? "", choice: p.get("c") };
    setLink(l);
    call(l).then(setState);
  }, []);

  async function confirm(e) {
    e.preventDefault();
    setBusy(true);
    const r = await call({ ...link, signature: sig, confirm: true });
    setBusy(false);
    // A wrong ID number leaves the link usable: show the reason and keep the form.
    if (!r.ok && state?.action === "ack" && /ID number/.test(r.reason)) return setState({ ...state, error: r.reason });
    setState(r);
  }

  const ack = state?.action === "ack";
  return (
    <PublicPage title={ack ? "Confirm receipt" : "Confirm action"}>
      <Card className="p-4 sm:p-6" data-testid="assign-result">
        {!state && <p className="text-sm text-muted">Checking the link…</p>}

        {state && !state.ok && (
          <div className="flex gap-3">
            <XCircle className="h-6 w-6 shrink-0 text-danger" />
            <p className="text-sm">{state.reason}</p>
          </div>
        )}

        {state?.ok && state.done && (
          <div className="flex gap-3">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-ok" />
            <div>
              <p className="font-medium">Done.</p>
              <p className="mt-1 text-sm">{ack ? "Thank you, your receipt is recorded." : `${state.what}.`}</p>
              {state.note && <p className="mt-1 text-sm text-muted">{state.note}</p>}
            </div>
          </div>
        )}

        {state?.ok && !state.done && (
          <form onSubmit={confirm}>
            <p className="text-base font-medium">{state.what}?</p>
            {ack && (
              <label className="mt-4 block text-sm">
                Your ID number
                <input className={cn(inputCls, "mt-1 text-base")} inputMode="numeric" autoComplete="off" required
                  value={sig} onChange={(e) => setSig(e.target.value)} />
              </label>
            )}
            {state.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
            <button disabled={busy} className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-base font-medium text-brand-fg disabled:opacity-50 sm:w-auto">
              {busy ? "Working…" : ack ? "Confirm receipt" : "Confirm"}
            </button>
            <p className="mt-3 text-xs text-muted">This link works once and expires 7 days after the email was sent.</p>
          </form>
        )}
      </Card>
    </PublicPage>
  );
}
