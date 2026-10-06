// tools/check-schema.mjs — runs every migration in an in-process Postgres
// (PGlite) with Supabase's auth/storage stubbed, then exercises the access
// matrix as each role. Guards against: a policy or trigger edit that silently
// lets a viewer write, an officer approve a release, an audit row be deleted,
// or the same asset be issued twice. No Supabase project or network needed, so
// it is cheap enough for the pre-commit hook. check-rls.mjs proves the same on
// the real project.
//   node tools/check-schema.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "fs";
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
create schema auth; create schema storage; create schema extensions;
create role anon; create role authenticated; create role service_role;
create table auth.users(id uuid primary key, raw_app_meta_data jsonb default '{}');
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
create table storage.buckets(id text primary key, name text, public bool, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id serial, bucket_id text, name text); alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
grant usage on schema public, auth, extensions, storage to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a','{"role":"admin"}'),
 ('00000000-0000-0000-0000-00000000000b','{}'),
 ('00000000-0000-0000-0000-00000000000c','{"role":"viewer"}'),
 ('00000000-0000-0000-0000-00000000000d','{"role":"approver"}');
`);
for (const f of fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort())
  await db.exec(fs.readFileSync("supabase/migrations/" + f, "utf8"));
const who = { admin: ["a", "admin", "9001"], officer: ["b", null, "9002"], viewer: ["c", "viewer", "9003"], approver: ["d", "approver", "9004"] };
async function as(name, sql) {
  const [s, role, id] = who[name];
  const claims = JSON.stringify({ sub: "00000000-0000-0000-0000-00000000000" + s, role: "authenticated", email: id + "@tomypak.internal", session_id: "sess-" + s, app_metadata: role ? { role } : {} });
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
  await db.query("set role authenticated");
  try { return await db.query(sql); } finally { await db.query("reset role"); }
}
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const refused = async (fn, m) => { try { await fn(); ok(false, m + " (was allowed)"); } catch (e) { ok(true, m + " -> " + e.message); } };

await as("admin", "insert into staff(full_name, login_id, department) values ('Ada Admin','9001','IT'),('Olly Officer','9002','IT'),('Ann Approver','9004','IT')");
await as("admin", "insert into locations(name) values ('Server Room')");
await as("officer", "insert into assets(asset_tag, asset_type, purchase_date, created_by_name) values ('IT-0001','Laptop','2024-01-15','HACKER')");
let r = await as("officer", "select created_by_name, created_by_id, refresh_due::text from assets");
ok(r.rows[0].created_by_name === "Olly Officer" && r.rows[0].refresh_due === "2028-01-15", "author stamped, refresh_due defaulted " + JSON.stringify(r.rows[0]));
await as("officer", "update assets set created_by_name='X' where asset_tag='IT-0001'");
r = await as("officer", "select created_by_name from assets"); ok(r.rows[0].created_by_name === "Olly Officer", "author immutable");
r = await as("viewer", "update assets set make='Hacked' where asset_tag='IT-0001' returning *"); ok(r.rows.length === 0, "viewer PATCH on assets changes nothing");
await refused(() => as("viewer", "insert into locations(name) values ('x')"), "viewer master-data insert");
await refused(() => as("officer", "insert into vendors(name) values ('x')"), "officer master-data insert");
r = await as("viewer", "select count(*)::int n from assets"); ok(r.rows[0].n === 1, "viewer can read assets");
await as("officer", "update assets set make='Dell', model='5420', warranty_end='2027-01-01' where asset_tag='IT-0001'");
r = await as("admin", "select field from asset_audit where action='updated' order by audit_id"); ok(r.rows.length === 3, "3 fields -> 3 audit rows " + r.rows.map((x) => x.field));
r = await as("admin", "delete from asset_audit returning *"); ok(r.rows.length === 0, "admin cannot delete audit rows");
await refused(() => as("officer", "insert into asset_audit(asset_id, action) values (1,'created')"), "officer audit insert");
await refused(() => as("officer", "insert into asset_value values (1, 100)"), "officer writes cost");
await as("admin", "insert into asset_value values (1, 4200)");
r = await as("officer", "select * from asset_value"); ok(r.rows.length === 0, "officer cannot read cost");
r = await as("officer", "select * from asset_audit where field='Purchase cost'"); ok(r.rows.length === 0, "officer cannot read cost audit");
r = await as("admin", "select * from asset_audit where field='Purchase cost'"); ok(r.rows.length === 1, "admin sees cost audit");

await as("officer", "insert into asset_assignment(asset_id, staff_id, condition_out) values (1, 2, 'Good')");
r = await as("officer", "select status from assets"); ok(r.rows[0].status === "Assigned", "open assignment -> Assigned");
await refused(() => as("officer", "insert into asset_assignment(asset_id, location_id) values (1, 1)"), "second open assignment");
await refused(() => as("officer", "update assets set status='Retired' where asset_id=1"), "retire while held");
await as("officer", "update asset_assignment set returned_on=current_date, return_status='In repair', condition_in='Damaged' where asset_id=1");
r = await as("officer", "select status from assets"); ok(r.rows[0].status === "In repair", "return with In repair");
r = await as("officer", "select issued_by is not null and received_by is not null as ok from asset_assignment"); ok(r.rows[0].ok, "issued_by/received_by stamped");
r = await as("admin", "select action, new_value, old_value from asset_audit where field='Holder' order by audit_id"); ok(r.rows.length === 2 && r.rows[0].new_value === "Olly Officer", "assigned/returned audit " + JSON.stringify(r.rows));

await as("viewer", "insert into equipment_request(requested_by_name, department, asset_type) values ('Vic','Ops','Laptop')");
ok(true, "viewer may raise a request");
await refused(() => as("viewer", "insert into equipment_request(requested_by_name, department, asset_type, release_status) values ('Vic','Ops','Laptop','Approved')"), "viewer inserts approved release");
r = await as("viewer", "update equipment_request set status='Cancelled' returning *"); ok(r.rows.length === 0, "viewer cannot update request");
await refused(() => as("officer", "update equipment_request set release_status='Approved'"), "officer approves release");
await as("officer", "update equipment_request set release_status='Pending', approved_by='Fake'");
r = await as("officer", "select release_status, approved_by from equipment_request"); ok(r.rows[0].release_status === "Pending" && r.rows[0].approved_by === null, "officer may ask; approved_by not typeable");
await refused(() => as("approver", "update equipment_request set release_status='Approved', urgency='Urgent'"), "approver changes other fields with decision");
await as("approver", "update equipment_request set release_status='Approved', approval_note='ok', approved_by='Someone Else'");
r = await as("approver", "select approved_by, approved_at is not null as stamped from equipment_request"); ok(r.rows[0].approved_by === "Ann Approver" && r.rows[0].stamped, "approver decides, name from session " + JSON.stringify(r.rows[0]));
r = await as("viewer", "select created_by_name from equipment_request"); ok(r.rows[0].created_by_name === "9003", "request author stamped " + r.rows[0].created_by_name);

await as("officer", "select log_login()"); await as("officer", "select log_login()");
r = await as("admin", "select count(*)::int n from audit_event where event_type='login'"); ok(r.rows[0].n === 1, "login logged once per session");
r = await as("officer", "select category from audit_feed"); ok(r.rows.length > 0 && r.rows.every((x) => x.category === "asset"), "officer audit_feed has no security rows");
r = await as("admin", "select count(distinct category)::int n from audit_feed"); ok(r.rows[0].n === 2, "admin audit_feed has both");
await as("officer", "delete from assets where asset_id=1");
r = await as("admin", "select count(*)::int n from asset_audit where asset_id=1"); ok(r.rows[0].n > 5, "audit survives asset delete");
await db.query("reset role"); await db.query("set role anon");
await refused(() => db.query("select * from assets"), "anon reads assets");
await refused(() => db.query("select public.log_login()"), "anon executes functions");
await db.query("reset role");
r = await db.query("insert into assign_token(request_id) values (null) returning token"); ok(/^[A-Za-z0-9_-]{43}$/.test(r.rows[0].token), "token is base64url " + r.rows[0].token);
console.log(fails ? fails + " FAILED" : "ALL PASS"); process.exit(fails ? 1 : 0);
