// notify — every message the database asks for, sent through Resend (API key
// in Vault) from the company's verified domain, plus the receipt archive.
//
// Called ONLY by the database (public.notify_post, via pg_net), never by a
// browser. verify_jwt must be OFF for this function: the caller has no user
// session, and the anon key is itself a valid JWT, so verify_jwt would guard
// nothing. The x-webhook-secret header is the ENTIRE perimeter.
//
// POST { kind, ... }:
//   new_request { request_id }            -> notify_recipients purpose equipment_request
//   release     { request_id, mode }      -> release_pending (mode pending) | release_decided
//   handover    { assignment_id, issued_by_name } -> the holder's own email
//   receipt     { request_id }            -> PDF filed in the private receipts bucket
//
// Always HTTP 200 (with { ok, ... }) except 405 / 401. The caller is a trigger
// that swallows errors anyway; half-working mail is worse than unrecorded mail.
// There is no dedupe and no retry: one trigger fire is one Resend call.
//
// Config comes from Vault through get_notify_config() at call time. The only
// env vars are the two Supabase injects.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildReceiptPdf } from "./receipt-pdf.js"; // a COPY of lib/receipt-pdf.js; check-receipt.mjs fails if they differ

const COMPANY = "Tomypak Flexible Packaging Sdn Bhd"; // same as lib/site.js
// Sent on every message so an Exchange mail-flow rule can recognise ITrack
// mail. Do NOT change it without updating any such rule in the same breath.
const NOTIFY_HEADER = "8e48692da63ee9d16e6c32e0";
const KL = "Asia/Kuala_Lumpur";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Any = any;
type Cfg = Record<string, string>;
type Sent = { ok: boolean; status: number; text: string; providerId: string | null };

// --------------------------------------------------------------- Resend ----
// POST https://api.resend.com/emails with the API key from Vault. The sender
// (notify_from, e.g. "ITrack <helpdesk@tomypak.com.my>") must be on a domain
// verified in Resend, or every send is refused with 403.
async function resendSend(cfg: Cfg, to: string[], subject: string, html: string, refId: string): Promise<Sent> {
  if (!cfg.notify_resend_api_key) return { ok: false, status: 0, text: "notify_resend_api_key is not set in Vault", providerId: null };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.notify_resend_api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.notify_from, to, subject, html,
        headers: { "X-ITrack-Notify": NOTIFY_HEADER, "X-Entity-Ref-ID": refId }, // thread-collapse hint
      }),
    });
    const text = await res.text();
    let id: string | null = null;
    try { id = JSON.parse(text).id ?? null; } catch { /* error bodies are still JSON, but never trust it */ }
    return { ok: res.ok, status: res.status, text, providerId: id };
  } catch (e) {
    return { ok: false, status: 0, text: String(e), providerId: null };
  }
}

// Records what Resend ACCEPTED, not what was delivered: accepted-then-
// bounced happens, and delivery is visible in the Resend dashboard (Emails / Logs).
async function logSend(purpose: string, recipients: string[], subject: string, r: Sent) {
  try {
    await supabase.from("notify_log").insert({
      purpose, recipients, subject, ok: r.ok, provider_status: r.status, provider_id: r.providerId,
      error: r.ok ? null : r.text.slice(0, 500),
    });
  } catch { /* a logging failure must never change what this function returns */ }
}

// The subject is passed in ONCE and used for both the send and the log, so the
// log cannot drift from what was sent.
async function send(cfg: Cfg, purpose: string, to: string[], subject: string, html: string, refId: string) {
  const r = await resendSend(cfg, to, subject, html, refId);
  await logSend(purpose, to, subject, r);
  return json({ ok: r.ok, status: r.status, result: r.text.slice(0, 500) });
}

// Resolved by PURPOSE, never by role: being an admin grants no email. The
// purpose filter sits in the same statement as active so it cannot be forgotten.
async function recipients(purpose: string): Promise<string[]> {
  const { data } = await supabase.from("notify_recipients").select("email").eq("active", true).eq("purpose", purpose);
  return [...new Set((data ?? []).map((r: Any) => String(r.email).trim()).filter(Boolean))];
}

// ------------------------------------------------------------- template ----
// Tables and inline styles only: Outlook renders with Word's engine (no flex,
// no grid). EVERY interpolated value goes through esc().
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { timeZone: KL, day: "2-digit", month: "short", year: "numeric" }) : "";
const fmtDateTime = (d: string) =>
  new Date(d).toLocaleString("en-GB", { timeZone: KL, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const row = (label: string, value: unknown) => value == null || value === "" ? "" :
  `<tr><td style="padding:6px 0;width:140px;vertical-align:top;color:#898781;font-size:13px;">${esc(label)}</td>` +
  `<td style="padding:6px 0;color:#1d1d1f;font-size:14px;white-space:pre-line;">${esc(value)}</td></tr>`;

const button = (href: string, label: string, accent = "#16488c") =>
  `<a href="${esc(href)}" style="display:inline-block;padding:10px 18px;background:${accent};color:#ffffff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${esc(label)}</a>`;

// One choice per table ROW: the name may wrap freely; the button sits in its
// own fixed-width nowrap column so no name length or client width can squeeze it.
const choiceRows = (items: { name: string; href: string; label: string }[]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map((i) =>
    `<tr><td style="padding:8px 8px 8px 0;border-top:1px solid #eef1f5;font-size:14px;color:#1d1d1f;">${esc(i.name)}</td>` +
    `<td width="96" style="padding:8px 0;border-top:1px solid #eef1f5;white-space:nowrap;text-align:right;">` +
    `<a href="${esc(i.href)}" style="display:inline-block;width:84px;padding:7px 0;text-align:center;background:#16488c;color:#ffffff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">${esc(i.label)}</a></td></tr>`,
  ).join("")}</table>`;

const section = (title: string, inner: string) =>
  `<div style="margin-top:22px;"><div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#898781;margin-bottom:6px;">${esc(title)}</div>${inner}</div>`;

// No image logo: a remote image is blocked by Outlook until "Download
// pictures", a data: URI is stripped, and cid: needs multipart. A table cell is
// none of those.
function shell(headline: string, sub: string, rows: string, extra = "", accent = "#1d1d1f") {
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f1f5fa;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dde4ed;border-radius:14px;">
<tr><td style="background:#1d1d1f;border-radius:14px 14px 0 0;padding:14px 20px;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td width="38" height="38" align="center" style="background:#16488c;border-radius:9px;color:#ffffff;font-weight:700;font-size:15px;">IT</td>
    <td style="padding-left:12px;"><div style="color:#ffffff;font-size:16px;font-weight:700;">ITrack</div>
      <div style="color:#b9bcc4;font-size:12px;">IT Asset Management</div></td>
  </tr></table></td></tr>
<tr><td style="height:4px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:22px 24px;">
  <div style="font-size:20px;font-weight:700;color:#1d1d1f;">${esc(headline)}</div>
  <div style="margin-top:4px;font-size:14px;color:#55565b;">${esc(sub)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">${rows}</table>
  ${extra}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #eef1f5;font-size:12px;color:#898781;">Automated notification from ITrack — ${esc(COMPANY)}</td></tr>
</table></td></tr></table></body></html>`;
}

const requestRows = (r: Any) =>
  row("Request", `#${r.request_id}`) + row("Requested by", r.requested_by_name) + row("Department", r.department) +
  row("Asset type", r.asset_type) + row("Urgency", r.urgency) + row("Sent", fmtDateTime(r.created_at)) +
  row("Justification", r.justification);

// ---------------------------------------------------------------- kinds ----
async function newRequest(cfg: Cfg, appUrl: string, id: number) {
  const { data: r } = await supabase.from("equipment_request").select("*").eq("request_id", id).maybeSingle();
  if (!r) return json({ ok: false, reason: "request not found" });
  const to = await recipients("equipment_request");
  // Zero recipients is NOT an error: a misconfigured list must not log a scary failure.
  if (!to.length) return json({ ok: false, reason: "no active recipients" });

  // Photos by URL (the bucket is public-read), not attached: the mail stays small.
  const photos = String(r.attachment_path ?? "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
  let extra = photos.length ? section("Photos", photos.map((u) =>
    `<a href="${esc(u)}"><img src="${esc(u)}" width="150" alt="Request photo" style="width:150px;height:auto;border:1px solid #dde4ed;border-radius:8px;margin:0 6px 6px 0;"></a>`).join("")) : "";

  // The action block. A failure here degrades to a mail with no buttons, never no mail.
  try {
    if (!appUrl) throw new Error("notify_app_url is not set");
    const link = (token: string, choice: number) => `${appUrl}/assign/?t=${encodeURIComponent(token)}&c=${choice}`;
    if (["Requested", "Approved"].includes(r.status)) {
      const { data: holder } = await supabase.rpc("request_holder", { p_request_id: id });
      const { data: stock } = await supabase.from("assets").select("asset_id, asset_tag, make, model")
        .eq("status", "In stock").eq("active", true).eq("asset_type", r.asset_type)
        .order("purchase_date", { ascending: false, nullsFirst: false }).order("asset_id", { ascending: false }).limit(6);
      if (holder && stock?.length) {
        const { data: token, error } = await supabase.rpc("create_assignment_link", { p_request_id: id, p_action: "allocate" });
        if (error) throw error;
        extra += section("Allocate from stock", choiceRows(stock.map((a: Any) =>
          ({ name: [a.asset_tag, [a.make, a.model].filter(Boolean).join(" ")].filter(Boolean).join(" — "), href: link(token, a.asset_id), label: "Allocate" }))));
      } else if (stock?.length) {
        extra += section("Allocate from stock", `<div style="font-size:13px;color:#55565b;">"${esc(r.requested_by_name)}" does not match exactly one staff record, so allocate this one in ITrack.</div>`);
      }
    }
    if (!r.handled_by) {
      const { data: officers } = await supabase.rpc("eligible_handlers");
      if (officers?.length) {
        const { data: token, error } = await supabase.rpc("create_assignment_link", { p_request_id: id, p_action: "assign_officer" });
        if (error) throw error;
        extra += section("Assign to an officer", choiceRows(officers.map((s: Any) =>
          ({ name: s.full_name, href: link(token, s.staff_id), label: "Assign" }))));
      }
    }
    extra += `<div style="margin-top:22px;">${button(`${appUrl}/entry/`, "Open in ITrack")}</div>`;
  } catch (e) {
    console.error("action block skipped:", e);
  }

  const subject = `New equipment request #${id}: ${r.asset_type}${r.urgency === "Urgent" ? " (URGENT)" : ""} for ${r.requested_by_name}`;
  const html = shell(`New request #${id}`, `${r.requested_by_name} (${r.department}) needs a ${r.asset_type}.`, requestRows(r), extra,
    r.urgency === "Urgent" ? "#a3341f" : "#16488c");
  return send(cfg, "equipment_request", to, subject, html, String(id));
}

// The decision is made in the app, never in the mail: one place an approval
// can happen, and approved_by is a signed-in identity. Only the accent differs
// between the three modes, so they cannot drift apart.
const RELEASE = {
  pending:  { accent: "#1d1d1f", headline: "Asset release waiting for your decision", subj: "release awaiting your approval" },
  approved: { accent: "#0f7a3d", headline: "Asset release approved", subj: "release approved" },
  rejected: { accent: "#a3341f", headline: "Asset release rejected", subj: "release rejected" },
} as const;

async function release(cfg: Cfg, appUrl: string, id: number, mode: keyof typeof RELEASE) {
  const m = RELEASE[mode];
  if (!m) return json({ ok: false, reason: `unknown mode ${mode}` });
  const { data: r } = await supabase.from("equipment_request").select("*").eq("request_id", id).maybeSingle();
  if (!r) return json({ ok: false, reason: "request not found" });
  const purpose = mode === "pending" ? "release_pending" : "release_decided";
  const to = await recipients(purpose);
  if (!to.length) return json({ ok: false, reason: "no active recipients" });

  const rows = requestRows(r) + (mode === "pending" ? "" :
    row("Decided by", r.approved_by) + row("Decided", r.approved_at && fmtDateTime(r.approved_at)) + row("Note", r.approval_note));
  const extra = appUrl
    ? `<div style="margin-top:22px;">${button(`${appUrl}/entry/${mode === "pending" ? "?view=approvals" : ""}`, mode === "pending" ? "Review in ITrack" : "Open in ITrack", m.accent)}</div>`
    : "";
  const subject = `Request #${id}: ${m.subj}`;
  const sub = mode === "pending" ? `IT has asked to release a ${r.asset_type} for ${r.requested_by_name}.` : `For ${r.requested_by_name}'s ${r.asset_type} request.`;
  return send(cfg, purpose, to, subject, shell(m.headline, sub, rows, extra, m.accent), String(id));
}

async function handover(cfg: Cfg, appUrl: string, assignmentId: number, issuedBy: string) {
  const { data: g } = await supabase.from("asset_assignment")
    .select("*, assets(asset_tag, asset_type, make, model, serial_no), staff(full_name, email)")
    .eq("assignment_id", assignmentId).maybeSingle();
  if (!g?.staff?.email) return json({ ok: false, reason: "no holder email" });
  const a = g.assets;

  let extra = "";
  try {
    if (!appUrl) throw new Error("notify_app_url is not set");
    const { data: token, error } = await supabase.rpc("create_assignment_link",
      { p_request_id: g.request_id, p_action: "ack", p_assignment_id: assignmentId });
    if (error) throw error;
    extra = `<div style="margin-top:22px;font-size:14px;color:#1d1d1f;">Please check the item and confirm you received it. You will be asked for your ID number.</div>` +
      `<div style="margin-top:12px;">${button(`${appUrl}/assign/?t=${encodeURIComponent(token)}`, "Confirm receipt", "#0f7a3d")}</div>`;
  } catch (e) {
    console.error("confirm button skipped:", e);
  }

  const rows = row("Asset tag", a.asset_tag) + row("Type", a.asset_type) + row("Make / model", [a.make, a.model].filter(Boolean).join(" ")) +
    row("Serial no", a.serial_no) + row("Condition", g.condition_out) + row("Issued", fmtDate(g.issued_on)) +
    row("Due back", g.due_back_on && fmtDate(g.due_back_on)) + row("Issued by", issuedBy) + row("Request", g.request_id && `#${g.request_id}`);
  const subject = `${a.asset_tag} has been issued to you`;
  const html = shell(g.due_back_on ? "Equipment on loan to you" : "Equipment issued to you",
    `Hello ${g.staff.full_name}, IT has issued you the following.`, rows, extra, "#0f7a3d");
  return send(cfg, "handover", [g.staff.email], subject, html, `A${assignmentId}`);
}

// The one idempotent job: the name derives from the id and upsert replaces, so
// a retry overwrites instead of accumulating.
async function receipt(appUrl: string, id: number) {
  const { data: r } = await supabase.from("equipment_request").select("*").eq("request_id", id).maybeSingle();
  if (!r) return json({ ok: false, reason: "request not found" });
  const bytes = buildReceiptPdf({
    requestId: r.request_id, createdAt: r.created_at, name: r.requested_by_name, department: r.department,
    assetType: r.asset_type, urgency: r.urgency, justification: r.justification,
    photoCount: String(r.attachment_path ?? "").split(/[\n,]/).filter((s) => s.trim()).length,
    statusUrl: `${appUrl}/status/?id=${r.request_id}`, company: COMPANY,
  });
  const { error } = await supabase.storage.from("receipts")
    .upload(`ITrack-Request-${id}.pdf`, bytes, { contentType: "application/pdf", upsert: true });
  return json({ ok: !error, error: error?.message ?? null });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const { data: cfg, error } = await supabase.rpc("get_notify_config");
  if (error || !cfg?.notify_webhook_secret || req.headers.get("x-webhook-secret") !== cfg.notify_webhook_secret) {
    return json({ error: "Unauthorized" }, 401);
  }
  let body: Any;
  try { body = await req.json(); } catch { return json({ ok: false, reason: "bad json" }); }
  const appUrl = String(cfg.notify_app_url ?? "").replace(/\/+$/, "");
  try {
    switch (body.kind) {
      case "new_request": return await newRequest(cfg, appUrl, Number(body.request_id));
      case "release":     return await release(cfg, appUrl, Number(body.request_id), body.mode);
      case "handover":    return await handover(cfg, appUrl, Number(body.assignment_id), String(body.issued_by_name ?? ""));
      case "receipt":     return await receipt(appUrl, Number(body.request_id));
      default:            return json({ ok: false, reason: `unknown kind ${body.kind}` });
    }
  } catch (e) {
    console.error(e);
    return json({ ok: false, reason: String(e) });
  }
});
