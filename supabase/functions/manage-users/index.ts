// manage-users — every account operation User Management needs. They all need
// the SERVICE ROLE key, which can never be in the static bundle, so they live
// here. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by the platform
// into every Edge Function (not hand-set, not in this file).
//
// verify_jwt alone is NOT enough: the anon key is itself a valid JWT. So the
// caller's token is resolved to a user and that user's app_metadata.role —
// read fresh from auth, the same claim is_admin() checks in RLS — must be
// admin or super_admin before anything happens. The page's own admin gate is
// for the interface only; an officer's token reaches this function and is refused.
//
// Actions (POST JSON { action, ... }):
//   list                                        -> { users }
//   save { user_id?, id_number, password?, full_name, role, staff }  (create or update login + staff row)
//   set_password { user_id, password }
//   set_disabled { user_id, disabled }
// Refusals answer 200 { error } so the page can show the sentence; only auth
// failures are 401/403.
import { createClient } from "npm:@supabase/supabase-js@2";

const INTERNAL_DOMAIN = "tomypak.internal"; // must match INTERNAL_DOMAIN in AuthProvider.js
const ROLES = ["", "viewer", "approver", "admin", "super_admin"]; // "" = IT officer (no role)
const ADMIN_ROLES = ["admin", "super_admin"];
// Disable, never delete: a departed officer's name stands against every
// allocation and audit row they caused. ~100 years is "until re-enabled".
const BAN_FOREVER = "876000h";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// deno-lint-ignore no-explicit-any
type User = any;
const roleOf = (u: User) => (u?.app_metadata?.role ?? "") as string;
const isDisabled = (u: User) => !!u?.banned_until && new Date(u.banned_until) > new Date();
const idOf = (u: User) => String(u?.email ?? "").split("@")[0];

async function allUsers(): Promise<User[]> {
  const out: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 1000) return out;
  }
}

// The last remaining active administrator cannot be demoted or disabled:
// recovering from that means hand-written SQL against auth.users.
async function wouldOrphanAdmins(target: User, nextRole: string, nextDisabled: boolean) {
  const losesAdmin = ADMIN_ROLES.includes(roleOf(target)) && !isDisabled(target)
    && (!ADMIN_ROLES.includes(nextRole) || nextDisabled);
  if (!losesAdmin) return false;
  const others = (await allUsers()).filter((u) => u.id !== target.id && ADMIN_ROLES.includes(roleOf(u)) && !isDisabled(u));
  return others.length === 0;
}

async function audit(actor: User, actorName: string, event_type: string, target: User | null, target_name: string, detail: string) {
  // Written with the service role: audit_event has no write policy at all.
  await admin.from("audit_event").insert({
    event_type, actor_id: actor.id, actor_name: actorName, target_id: target?.id ?? null, target_name, detail,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !who?.user) return json({ error: "Not signed in" }, 401);
  const caller = who.user;
  if (!ADMIN_ROLES.includes(roleOf(caller)) || isDisabled(caller)) return json({ error: "Administrators only" }, 403);
  const callerIsSuper = roleOf(caller) === "super_admin";
  const { data: callerStaff } = await admin.from("staff").select("full_name").eq("login_id", idOf(caller)).maybeSingle();
  const actorName = callerStaff?.full_name || caller.user_metadata?.full_name || idOf(caller);

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  try {
    if (body.action === "list") {
      const users = (await allUsers()).map((u) => ({
        id: u.id, id_number: idOf(u), email: u.email, full_name: u.user_metadata?.full_name ?? null,
        role: roleOf(u), disabled: isDisabled(u), last_sign_in_at: u.last_sign_in_at ?? null, created_at: u.created_at,
      }));
      return json({ users });
    }

    const target: User | null = body.user_id
      ? (await admin.auth.admin.getUserById(body.user_id)).data?.user ?? null : null;
    if (body.user_id && !target) return json({ error: "That account no longer exists." });
    if (!target && body.action !== "save") return json({ error: "user_id is required" }, 400);
    const targetName = (u: User | null, fallback = "") => u?.user_metadata?.full_name || (u ? idOf(u) : fallback);

    if (body.action === "set_password") {
      if (String(body.password ?? "").length < 8) return json({ error: "Passwords must be at least 8 characters." });
      const { error } = await admin.auth.admin.updateUserById(target.id, { password: body.password });
      if (error) return json({ error: error.message });
      await audit(caller, actorName, "user_password_reset", target, targetName(target), "password set by an administrator");
      return json({ ok: true });
    }

    if (body.action === "set_disabled") {
      const disabled = !!body.disabled;
      if (disabled && target.id === caller.id) return json({ error: "You cannot disable your own account." });
      if (roleOf(target) === "super_admin" && !callerIsSuper) return json({ error: "Only the IT HOD (super admin) can change a super admin account." });
      if (disabled && await wouldOrphanAdmins(target, roleOf(target), true)) {
        return json({ error: "This is the last active administrator. Make someone else an administrator first." });
      }
      const { error } = await admin.auth.admin.updateUserById(target.id, { ban_duration: disabled ? BAN_FOREVER : "none" });
      if (error) return json({ error: error.message });
      await audit(caller, actorName, disabled ? "user_disabled" : "user_enabled", target, targetName(target), disabled ? "sign-in blocked" : "sign-in restored");
      return json({ ok: true });
    }

    if (body.action === "save") {
      const role = String(body.role ?? "");
      const idNumber = String(body.id_number ?? "").trim();
      const fullName = String(body.full_name ?? "").trim();
      if (!ROLES.includes(role)) return json({ error: "Unknown access level." });
      if (!fullName) return json({ error: "Full name is required." });
      // Granting or removing super admin is the IT HOD's decision alone.
      if ((role === "super_admin" || roleOf(target) === "super_admin") && role !== roleOf(target) && !callerIsSuper) {
        return json({ error: "Only the IT HOD (super admin) can grant or remove super admin." });
      }

      let user = target;
      if (!target) {
        if (!/^[A-Za-z0-9._-]+$/.test(idNumber)) return json({ error: "The ID number may contain only letters, digits, dot, dash and underscore." });
        if (String(body.password ?? "").length < 8) return json({ error: "Passwords must be at least 8 characters." });
        const { data, error } = await admin.auth.admin.createUser({
          email: `${idNumber}@${INTERNAL_DOMAIN}`, password: body.password, email_confirm: true,
          user_metadata: { full_name: fullName }, app_metadata: { role: role || null },
        });
        if (error) return json({ error: /already/i.test(error.message) ? `ID number ${idNumber} already has a login.` : error.message });
        user = data.user;
        await audit(caller, actorName, "user_created", user, fullName, `ID ${idNumber}, ${role || "officer"}`);
      } else {
        if (target.id === caller.id && !ADMIN_ROLES.includes(role)) return json({ error: "You cannot remove your own administrator access." });
        if (await wouldOrphanAdmins(target, role, false)) {
          return json({ error: "This is the last active administrator. Make someone else an administrator first." });
        }
        const { data, error } = await admin.auth.admin.updateUserById(target.id, {
          user_metadata: { ...target.user_metadata, full_name: fullName },
          app_metadata: { ...target.app_metadata, role: role || null },
        });
        if (error) return json({ error: error.message });
        user = data.user;
        if (role !== roleOf(target)) {
          await audit(caller, actorName, "user_role_changed", user, fullName, `${roleOf(target) || "officer"} -> ${role || "officer"}`);
        } else if (fullName !== targetName(target)) {
          await audit(caller, actorName, "user_updated", user, fullName, `name: ${targetName(target)} -> ${fullName}`);
        }
      }

      // The staff record: login_id is what joins the account to the person.
      // Without it they cannot be assigned an asset or get a handover email.
      const s = body.staff ?? {};
      const nz = (v: unknown) => (typeof v === "string" ? v.trim() || null : v ?? null);
      const row = {
        full_name: fullName, email: nz(s.email), department: nz(s.department), role: nz(s.role),
        eligible: s.eligible ?? null, login_id: idOf(user),
      };
      // Unlink any other record still carrying this ID before linking the chosen one.
      await admin.from("staff").update({ login_id: null }).eq("login_id", row.login_id).neq("staff_id", s.staff_id ?? -1);
      const { error: staffErr } = s.staff_id
        ? await admin.from("staff").update(row).eq("staff_id", s.staff_id)
        : await admin.from("staff").insert(row);
      if (staffErr) return json({ error: `Login saved, but the staff record was not: ${staffErr.message}`, user_id: user.id });
      return json({ ok: true, user_id: user.id });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
