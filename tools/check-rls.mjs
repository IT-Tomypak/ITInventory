// tools/check-rls.mjs — signs in as a VIEWER on the real project and sends
// hand-crafted PostgREST requests a viewer must not be able to make.
// Guards against: access control that only lives in the UI. The anon key is a
// valid JWT and PostgREST is a public URL; this is the only test that proves
// the access matrix (§3.3) is enforced by the database.
//
//   VIEWER_ID=... VIEWER_PASSWORD=... node tools/check-rls.mjs
//   (reads NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY from .env.local)
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
  .filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const { VIEWER_ID, VIEWER_PASSWORD } = process.env;
if (!VIEWER_ID || !VIEWER_PASSWORD) { console.error("Set VIEWER_ID and VIEWER_PASSWORD"); process.exit(2); }

const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const { data, error } = await sb.auth.signInWithPassword({ email: `${VIEWER_ID}@tomypak.internal`, password: VIEWER_PASSWORD });
if (error) { console.error("viewer sign-in failed:", error.message); process.exit(2); }
if (data.user.app_metadata?.role !== "viewer") { console.error("that account is not a viewer"); process.exit(2); }

const headers = { apikey: KEY, Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" };
const rest = (p, init) => fetch(`${URL}/rest/v1/${p}`, { headers, ...init });
let fails = 0;
const check = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

// Read is allowed — pick a target for the PATCH.
const list = await (await rest("assets?select=asset_id,spec_notes&limit=1")).json();
check(Array.isArray(list), "viewer can read assets");
if (list[0]) {
  const { asset_id, spec_notes } = list[0];
  const res = await rest(`assets?asset_id=eq.${asset_id}`, { method: "PATCH", body: JSON.stringify({ spec_notes: "RLS-PROBE" }) });
  const body = await res.json().catch(() => null);
  // RLS hides the row from UPDATE, so PostgREST answers 200 [] — refusal means "nothing changed".
  check(!res.ok || (Array.isArray(body) && body.length === 0), `PATCH assets refused (HTTP ${res.status})`);
  const after = await (await rest(`assets?select=spec_notes&asset_id=eq.${asset_id}`)).json();
  check(after[0]?.spec_notes === spec_notes, "asset unchanged after PATCH");
} else {
  console.log("SKIP PATCH assets — no asset rows yet");
}

const ins = await rest("locations", { method: "POST", body: JSON.stringify({ name: "RLS-PROBE " + Date.now() }) });
check(!ins.ok, `INSERT locations refused (HTTP ${ins.status})`);
const del = await rest("asset_audit?audit_id=gt.0", { method: "DELETE" });
const delBody = await del.json().catch(() => null);
check(!del.ok || (Array.isArray(delBody) && delBody.length === 0), "DELETE asset_audit removes nothing");
const ev = await (await rest("audit_event?select=event_id&limit=1")).json();
check(Array.isArray(ev) && ev.length === 0, "audit_event not readable by viewer");
const val = await (await rest("asset_value?select=asset_id&limit=1")).json();
check(Array.isArray(val) && val.length === 0, "asset_value (cost) not readable by viewer");

await sb.auth.signOut();
process.exit(fails ? 1 : 0);
