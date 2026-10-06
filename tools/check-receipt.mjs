// tools/check-receipt.mjs — the public form returns a request number, the
// receipt PDF builds, and the server-side archived copy is readable through a
// signed URL. Also fails if the Edge Function's copy of the PDF builder has
// drifted from lib/receipt-pdf.js (the archive must be the SAME document).
//
//   ADMIN_ID=... ADMIN_PASSWORD=... SOLO_EMAIL=you@... node tools/check-receipt.mjs
import fs from "node:fs";
import { buildReceiptPdf } from "../lib/receipt-pdf.js";
import { adminClient, anonClient, restoreNotify, soloNotify, waitForNotify } from "./notify-guard.mjs";

let fails = 0;
const check = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

check(fs.readFileSync("lib/receipt-pdf.js", "utf8") === fs.readFileSync("supabase/functions/notify/receipt-pdf.js", "utf8"),
  "supabase/functions/notify/receipt-pdf.js is identical to lib/receipt-pdf.js");

const admin = await adminClient();
const saved = await soloNotify();
let id;
try {
  const sub = await anonClient().rpc("submit_equipment_request", { p_name: "check-receipt probe", p_department: "IT",
    p_asset_type: "Other", p_justification: "check-receipt.mjs probe, cancelled automatically", p_urgency: "Normal", p_attachment: null });
  check(sub.data?.ok && sub.data.request_id > 0, `the public form returned a request number (#${sub.data?.request_id})`);
  id = sub.data?.request_id;
  if (!id) throw new Error(sub.error?.message ?? sub.data?.reason);

  const local = buildReceiptPdf({ requestId: id, createdAt: sub.data.created_at, name: "check-receipt probe", department: "IT",
    assetType: "Other", urgency: "Normal", photoCount: 0, justification: "x", statusUrl: "https://example/status/?id=" + id, company: "x" });
  check(new TextDecoder().decode(local.slice(0, 5)) === "%PDF-", "the downloadable receipt builds as a PDF");

  // store-receipt runs after commit, possibly from a cold start.
  let pdf = null;
  for (let i = 0; i < 40 && !pdf; i++) {
    const { data } = await admin.storage.from("receipts").createSignedUrl(`ITrack-Request-${id}.pdf`, 300);
    if (data?.signedUrl) {
      const res = await fetch(data.signedUrl);
      if (res.ok) pdf = new Uint8Array(await res.arrayBuffer());
    }
    if (!pdf) await new Promise((r) => setTimeout(r, 1000));
  }
  check(pdf && new TextDecoder().decode(pdf.slice(0, 5)) === "%PDF-", "the archived copy is readable through a signed URL");
  check(pdf && new TextDecoder("latin1").decode(pdf).includes(`(#${id})`), "the archived copy carries the request number");

  await waitForNotify(id);
} finally {
  if (id) await admin.from("equipment_request").update({ status: "Cancelled" }).eq("request_id", id);
  await restoreNotify(saved);
}
if (fails) { console.error(`${fails} check(s) failed`); process.exit(1); }
console.log("receipt: issued, archived, readable");
