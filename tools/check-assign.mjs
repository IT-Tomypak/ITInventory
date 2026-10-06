// tools/check-assign.mjs — the email action link, end to end in a browser.
// Guards against: a link that acts on GET. Microsoft 365 Safe Links opens
// every link in a message before a human does, so OPENING /assign/ must write
// nothing; the confirmation press must write exactly once; a second press
// must be refused.
//
//   node tools/serve-out.mjs &      # BASE=http://localhost:4321
//   ADMIN_ID=... ADMIN_PASSWORD=... SOLO_EMAIL=you@... node tools/check-assign.mjs
//
// Runs under notify-guard solo mode: the probe request fires the real
// new-request mail, which goes to SOLO_EMAIL only. The probe request is
// cancelled afterwards.
import { chromium } from "playwright";
import { adminClient, anonClient, restoreNotify, soloNotify, waitForNotify } from "./notify-guard.mjs";

const BASE = process.env.BASE || "http://localhost:4321";
let fails = 0;
const check = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

const admin = await adminClient();
const anon = anonClient();
const officers = (await admin.rpc("eligible_handlers")).data ?? [];
if (!officers.length) { console.error("Need at least one eligible handler (a staff record with a login in IT, or eligible = true)."); process.exit(2); }
const officer = officers[0];

const saved = await soloNotify();
let id;
try {
  const sub = await anon.rpc("submit_equipment_request", { p_name: "check-assign probe", p_department: "IT",
    p_asset_type: "Other", p_justification: "check-assign.mjs probe, cancelled automatically", p_urgency: "Normal", p_attachment: null });
  if (!sub.data?.ok) throw new Error(`submit failed: ${sub.error?.message ?? sub.data?.reason}`);
  id = sub.data.request_id;
  const token = (await admin.rpc("create_assignment_link", { p_request_id: id, p_action: "assign_officer" })).data;
  if (!token) throw new Error("could not mint a token");
  const handler = async () => (await admin.from("equipment_request").select("handled_by").eq("request_id", id).single()).data.handled_by;
  const preview = async () => (await anon.functions.invoke("assign-action", { body: { token, choice: officer.staff_id } })).data;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/assign/?t=${encodeURIComponent(token)}&c=${officer.staff_id}`);
  await page.getByText(`Make ${officer.full_name} the handler of request #${id}?`).waitFor({ timeout: 20000 });
  await page.reload(); // a second "scanner" visit
  await page.getByRole("button", { name: "Confirm" }).waitFor({ timeout: 20000 });
  check((await handler()) === null, "opening the link (twice) did not assign the request");
  check((await preview())?.ok === true, "opening the link did not use up the token");

  await page.getByRole("button", { name: "Confirm" }).click();
  await page.getByText("Done.").waitFor({ timeout: 20000 });
  await browser.close();
  check((await handler()) === officer.staff_id, "the confirmation press assigned the request");

  const again = (await anon.functions.invoke("assign-action", { body: { token, choice: officer.staff_id, confirm: true } })).data;
  check(again?.ok === false && /already used/.test(again.reason), `a second press is refused (${again?.reason})`);
  const forged = (await anon.functions.invoke("assign-action", { body: { token: token + "x", confirm: true } })).data;
  check(forged?.ok === false, "an altered token is refused");

  await waitForNotify(id);
} finally {
  if (id) await admin.from("equipment_request").update({ status: "Cancelled" }).eq("request_id", id);
  await restoreNotify(saved);
}
if (fails) { console.error(`${fails} check(s) failed`); process.exit(1); }
console.log("assign link: no write on open, exactly one write on confirm");
