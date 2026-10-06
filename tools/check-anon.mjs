// tools/check-anon.mjs — probes the REAL project as an anonymous visitor,
// holding only the public key from .env.local (which everyone has: it ships
// in the website).
// Guards against: a table that anyone on the internet can read, or an RPC
// that anonymous callers can run. Anonymous visitors may do exactly two
// things (brief §5.5): submit a request and check a request's status.
// Writes one refused row to request_submission_log (an invalid submission).
//   node tools/check-anon.mjs
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
for (const t of ["assets", "staff", "equipment_request", "asset_audit", "audit_event", "asset_value", "request_submission_log", "assign_token", "notify_log"]) {
  const { data, error } = await sb.from(t).select("*").limit(1);
  ok(error || (Array.isArray(data) && data.length === 0), `anon read ${t}: ${error ? error.code + " " + error.message : "returned " + JSON.stringify(data)}`);
}
let r = await sb.rpc("check_request_status", { p_request_id: 1 });
ok(!r.error && Array.isArray(r.data), "anon status lookup works: " + JSON.stringify(r.error ?? r.data));
r = await sb.rpc("submit_equipment_request", { p_name: "check-anon probe", p_department: "IT", p_asset_type: "Toaster", p_justification: "connectivity probe - invalid type on purpose", p_urgency: "Normal", p_attachment: "" });
ok(!r.error && r.data?.ok === false && r.data.reason === "invalid_asset_type", "anon submit reaches the function and is refused as expected: " + JSON.stringify(r.error ?? r.data));
r = await sb.rpc("allocate_asset", { p_request_id: null, p_asset_id: 1, p_staff_id: 1 });
ok(!!r.error, "anon allocate refused: " + r.error?.message);
r = await sb.auth.signInWithPassword({ email: "260004@tomypak.internal", password: "definitely-wrong-password" });
ok(r.error && /invalid/i.test(r.error.message), "auth endpoint reachable, bad password refused: " + r.error?.message);
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
