// tools/notify-guard.mjs — keeps tests from mailing the whole department.
// Submitting a request in a test fires the REAL trigger and emails real
// colleagues; remembering to switch recipients off by hand does not work.
//
//   ADMIN_ID=... ADMIN_PASSWORD=... node tools/notify-guard.mjs status
//   ADMIN_ID=... ADMIN_PASSWORD=... node tools/notify-guard.mjs solo you@tomypak.com.my
//   ADMIN_ID=... ADMIN_PASSWORD=... node tools/notify-guard.mjs restore
//
// solo: every recipient except the test address goes inactive (the address is
// added for any purpose it is missing from). The previous state is written to
// tools/.notify-backup.json FIRST, so a crashed run can still be restored.
//
// From a check script:
//   const saved = await soloNotify();
//   try { ...submit a request...; await waitForNotify(id); } finally { await restoreNotify(saved); }
// waitForNotify matters: pg_net sends after commit and the function may cold-
// start, so restoring straight away would let the mail go to the real list.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const BACKUP = "tools/.notify-backup.json";
const PURPOSES = ["equipment_request", "release_pending", "release_decided"];
export const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
  .filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));

export const anonClient = () =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

let admin;
export async function adminClient() {
  if (admin) return admin;
  const { ADMIN_ID, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_ID || !ADMIN_PASSWORD) throw new Error("Set ADMIN_ID and ADMIN_PASSWORD");
  const sb = anonClient();
  const { error } = await sb.auth.signInWithPassword({ email: `${ADMIN_ID}@tomypak.internal`, password: ADMIN_PASSWORD });
  if (error) throw new Error(`admin sign-in failed: ${error.message}`);
  return (admin = sb);
}

const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

export async function soloNotify(email = process.env.SOLO_EMAIL) {
  if (!email) throw new Error("Set SOLO_EMAIL (or pass an address) — the one inbox tests may mail");
  const sb = await adminClient();
  const rows = must(await sb.from("notify_recipients").select("id, email, purpose, active"));
  const saved = { rows: rows.map(({ id, active }) => ({ id, active })), added: [] };
  fs.writeFileSync(BACKUP, JSON.stringify(saved, null, 2)); // before touching anything
  const mine = (r) => r.email.trim().toLowerCase() === email.trim().toLowerCase();
  const off = rows.filter((r) => r.active && !mine(r)).map((r) => r.id);
  const on = rows.filter((r) => !r.active && mine(r)).map((r) => r.id);
  if (off.length) must(await sb.from("notify_recipients").update({ active: false }).in("id", off));
  if (on.length) must(await sb.from("notify_recipients").update({ active: true }).in("id", on));
  const missing = PURPOSES.filter((p) => !rows.some((r) => mine(r) && r.purpose === p));
  if (missing.length) {
    const added = must(await sb.from("notify_recipients")
      .insert(missing.map((purpose) => ({ email, name: "notify-guard test", purpose, active: true }))).select("id"));
    saved.added = added.map((r) => r.id);
    fs.writeFileSync(BACKUP, JSON.stringify(saved, null, 2));
  }
  return saved;
}

export async function restoreNotify(saved = JSON.parse(fs.readFileSync(BACKUP, "utf8"))) {
  const sb = await adminClient();
  if (saved.added.length) must(await sb.from("notify_recipients").delete().in("id", saved.added));
  for (const active of [true, false]) {
    const ids = saved.rows.filter((r) => r.active === active).map((r) => r.id);
    if (ids.length) must(await sb.from("notify_recipients").update({ active }).in("id", ids));
  }
  fs.rmSync(BACKUP, { force: true });
}

// Waits until notify_log has a row about this request (sent or failed), so the
// list is not restored while the mail is still on its way.
export async function waitForNotify(requestId, seconds = 40) {
  const sb = await adminClient();
  for (let i = 0; i < seconds; i++) {
    const { count } = await sb.from("notify_log").select("id", { count: "exact", head: true }).like("subject", `%#${requestId}:%`);
    if (count) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn(`no notify_log row for #${requestId} after ${seconds}s — is the notify function deployed and the webhook secret set?`);
  return false;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === "solo") { await soloNotify(arg); console.log(`Only ${arg || process.env.SOLO_EMAIL} is active. Run "restore" when done.`); }
    else if (cmd === "restore") { await restoreNotify(); console.log("Recipient list restored."); }
    else if (cmd === "status") {
      const rows = must(await (await adminClient()).from("notify_recipients").select("*").order("purpose"));
      for (const r of rows) console.log(`${r.active ? "ON " : "off"}  ${r.purpose.padEnd(18)} ${r.email}`);
      if (fs.existsSync(BACKUP)) console.log(`\n${BACKUP} exists: a solo run has not been restored.`);
    } else { console.error("usage: notify-guard.mjs status | solo [email] | restore"); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
