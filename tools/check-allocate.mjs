// tools/check-allocate.mjs — fires two allocations of the SAME asset at the
// same moment, from two separate sessions, against the real project.
// Guards against: double issue. Exactly one must succeed; the other must be
// refused by the database (row lock in allocate_asset, backed by the partial
// unique index uq_assignment_open). No amount of UI disabling covers this race.
//
//   OFFICER_ID=... OFFICER_PASSWORD=... node tools/check-allocate.mjs
//   (reads NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY from .env.local)
//
// It registers a throwaway asset CHK-ALLOC-<time>, issues it, returns it and
// deletes it. The asset_audit rows it leaves are kept on purpose: the audit
// trail cannot be deleted, which is the point of it.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
  .filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const { OFFICER_ID, OFFICER_PASSWORD } = process.env;
if (!OFFICER_ID || !OFFICER_PASSWORD) { console.error("Set OFFICER_ID and OFFICER_PASSWORD"); process.exit(2); }

async function session() {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: `${OFFICER_ID}@tomypak.internal`, password: OFFICER_PASSWORD });
  if (error) { console.error("sign-in failed:", error.message); process.exit(2); }
  return sb;
}
const [a, b] = await Promise.all([session(), session()]);

let fails = 0;
const check = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

const staff = await a.from("staff").select("staff_id").limit(2);
if (!staff.data?.length) { console.error("Need at least one staff record."); process.exit(2); }
const tag = `CHK-ALLOC-${Date.now()}`;
const created = await a.from("assets").insert({ asset_tag: tag, asset_type: "Other", spec_notes: "check-allocate.mjs probe" }).select().single();
if (created.error) { console.error("could not create probe asset:", created.error.message); process.exit(2); }
const assetId = created.data.asset_id;

try {
  const s1 = staff.data[0].staff_id, s2 = (staff.data[1] ?? staff.data[0]).staff_id;
  const results = await Promise.all([
    a.rpc("allocate_asset", { p_request_id: null, p_asset_id: assetId, p_staff_id: s1 }),
    b.rpc("allocate_asset", { p_request_id: null, p_asset_id: assetId, p_staff_id: s2 }),
  ]);
  const okCount = results.filter((r) => !r.error).length;
  check(okCount === 1, `exactly one of two concurrent allocations succeeded (${okCount})`);
  const refusal = results.find((r) => r.error)?.error?.message ?? "";
  check(/In stock|just been issued/.test(refusal), `the other was refused: "${refusal}"`);

  const open = await a.from("asset_assignment").select("assignment_id").eq("asset_id", assetId).is("returned_on", null);
  check(open.data?.length === 1, "one open assignment in the database");
  const st = await a.from("assets").select("status").eq("asset_id", assetId).single();
  check(st.data?.status === "Assigned", "asset status is Assigned");

  const ret = await a.rpc("return_asset", { p_asset_id: assetId, p_condition_in: "Good" });
  check(!ret.error, "return_asset succeeded" + (ret.error ? `: ${ret.error.message}` : ""));
  const after = await a.from("assets").select("status").eq("asset_id", assetId).single();
  check(after.data?.status === "In stock", "asset back In stock");
} finally {
  await a.from("assets").delete().eq("asset_id", assetId);
  await Promise.all([a.auth.signOut(), b.auth.signOut()]);
}
process.exit(fails ? 1 : 0);
