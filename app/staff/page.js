"use client";
// User Management — admin only. Logins and staff records are ONE screen,
// because they are one person and keeping them apart lets the halves drift.
// Every account operation goes through the manage-users Edge Function (it
// needs the service-role key); that function re-checks the caller is an admin
// and enforces the lock-out guards. isAdmin here only decides what renders.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, KeyRound, Lock, Pencil, Plus, RotateCcw, Save, Search, ShieldCheck, UserCog, Users } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { fetchAll, fmtDateTime } from "../../lib/assets";
import { idToEmail, useAuth } from "../components/AuthProvider";
import { inputCls } from "../components/AssetForm";
import {
  Card, EmptyState, HoldToConfirmButton, KpiCard, ModalPortal, PageHeader, Pagination, SortableTh, TableSkeleton, cn, toast,
} from "../components/ui";

// Described by what each GRANTS, not by its name (brief §3.2).
const ACCESS = [
  { value: "", label: "IT officer", grants: "Register, allocate and return, request entry, asset history. No master data." },
  { value: "approver", label: "Approver", grants: "Officer screens plus the only right to approve an asset release." },
  { value: "viewer", label: "Viewer", grants: "Reads everything operational, changes nothing. May still raise a request." },
  { value: "admin", label: "Administrator", grants: "Master data, user management, asset value, change log. Cannot release an asset." },
  { value: "super_admin", label: "IT HOD (super admin)", grants: "Everything, including releasing an asset." },
];
const accessLabel = (r) => ACCESS.find((a) => a.value === (r || ""))?.label ?? r;
const FILTERS = [
  { id: "all", label: "All accounts", test: () => true, icon: Users },
  { id: "admin", label: "Administrators", test: (u) => ["admin", "super_admin"].includes(u.role), icon: ShieldCheck },
  { id: "approver", label: "Approvers", test: (u) => u.role === "approver", icon: ShieldCheck },
  { id: "officer", label: "IT officers", test: (u) => !u.role, icon: UserCog },
  { id: "viewer", label: "Viewers", test: (u) => u.role === "viewer", icon: Users },
  { id: "disabled", label: "Disabled", test: (u) => u.disabled, icon: Ban },
];

async function call(body) {
  const { data, error } = await supabase.functions.invoke("manage-users", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function UserForm({ user, staff, onDone, onCancel }) {
  const editing = !!user;
  const linked = user ? staff.find((s) => s.login_id === user.id_number) : null;
  const [f, setF] = useState(() => ({
    id_number: user?.id_number ?? "", password: "", role: user?.role ?? "",
    staff_id: linked?.staff_id ?? "", full_name: linked?.full_name ?? user?.full_name ?? "",
    email: linked?.email ?? "", department: linked?.department ?? "", job: linked?.role ?? "",
    eligible: linked?.eligible == null ? "" : String(linked.eligible),
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  // Offer the values already in use rather than a fixed list.
  const inUse = (k) => [...new Set(staff.map((s) => s[k]).filter(Boolean))].sort();
  // People without a login (or this user's own record) can be picked.
  const pickable = staff.filter((s) => !s.login_id || s.staff_id === linked?.staff_id);

  function pick(e) {
    const s = staff.find((x) => String(x.staff_id) === e.target.value);
    setF((v) => ({ ...v, staff_id: e.target.value, ...(s ? {
      full_name: s.full_name, email: s.email ?? "", department: s.department ?? "", job: s.role ?? "",
      eligible: s.eligible == null ? "" : String(s.eligible),
    } : {}) }));
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await call({
        action: "save", user_id: user?.id, id_number: f.id_number.trim(), password: editing ? undefined : f.password,
        full_name: f.full_name, role: f.role,
        staff: { staff_id: f.staff_id ? Number(f.staff_id) : null, email: f.email, department: f.department, role: f.job,
          eligible: f.eligible === "" ? null : f.eligible === "true" },
      });
      toast.success(editing ? "User updated." : "User created.");
      onDone();
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(false);
  }

  const access = ACCESS.find((a) => a.value === f.role);
  return (
    <form onSubmit={save}>
      <h2 id="user-form-title" className="mb-4 text-lg font-semibold">{editing ? `Edit ${user.id_number}` : "Add a user"}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">ID number *</span>
          <input className={inputCls} value={f.id_number} onChange={set("id_number")} required disabled={editing} autoFocus={!editing}
            pattern="[A-Za-z0-9._\-]+" title="Letters, digits, dot, dash or underscore" />
          {/* Shown BEFORE saving: the address is the ID, not a second fact to collect. */}
          {f.id_number.trim() && <span className="mt-1 block text-xs text-muted">Signs in as {idToEmail(f.id_number)}</span>}
        </label>
        {!editing && (
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Password * (min 8 — hand it over yourself; there is no reset email)</span>
            <input type="text" autoComplete="off" className={inputCls} value={f.password} onChange={set("password")} required minLength={8} />
          </label>
        )}
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs text-muted">Staff record</span>
          <select className={inputCls} value={f.staff_id} onChange={pick}>
            <option value="">Create new</option>
            {pickable.map((s) => <option key={s.staff_id} value={s.staff_id}>{s.full_name}{s.department ? ` — ${s.department}` : ""}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-1 block text-xs text-muted">Full name *</span>
          <input className={inputCls} value={f.full_name} onChange={set("full_name")} required /></label>
        <label className="block"><span className="mb-1 block text-xs text-muted">Email (for handover mail)</span>
          <input type="email" className={inputCls} value={f.email} onChange={set("email")} /></label>
        <label className="block"><span className="mb-1 block text-xs text-muted">Department</span>
          <input className={inputCls} list="dept-list" value={f.department} onChange={set("department")} />
          <datalist id="dept-list">{inUse("department").map((d) => <option key={d} value={d} />)}</datalist></label>
        <label className="block"><span className="mb-1 block text-xs text-muted">Job title (not the access level)</span>
          <input className={inputCls} list="job-list" value={f.job} onChange={set("job")} />
          <datalist id="job-list">{inUse("role").map((d) => <option key={d} value={d} />)}</datalist></label>
        <label className="block"><span className="mb-1 block text-xs text-muted">Eligible for equipment</span>
          <select className={inputCls} value={f.eligible} onChange={set("eligible")}>
            <option value="">Use the department rule</option><option value="true">Yes</option><option value="false">No</option>
          </select></label>
        <label className="block"><span className="mb-1 block text-xs text-muted">Access level</span>
          <select className={inputCls} value={f.role} onChange={set("role")}>
            {ACCESS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <span className="mt-1 block text-xs text-muted">{access?.grants}</span></label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
        <button disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg disabled:opacity-50">
          <Save className="h-4 w-4" /> Save
        </button>
      </div>
    </form>
  );
}

function PasswordForm({ user, onDone, onCancel }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try { await call({ action: "set_password", user_id: user.id, password: pw }); toast.success(`Password set for ${user.id_number}. Hand it over in person.`); onDone(); }
    catch (err) { toast.error(err.message); }
    setBusy(false);
  }
  return (
    <form onSubmit={save}>
      <h2 id="user-form-title" className="text-lg font-semibold">Set a password for {user.full_name || user.id_number}</h2>
      <p className="mt-1 text-sm text-muted">There is no reset email: the ID-number address receives no mail. Give the new password to the person yourself.</p>
      <input type="text" autoComplete="off" className={cn(inputCls, "mt-4")} value={pw} onChange={(e) => setPw(e.target.value)}
        required minLength={8} autoFocus aria-label="New password" placeholder="At least 8 characters" />
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
        <button disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg disabled:opacity-50">Set password</button>
      </div>
    </form>
  );
}

export default function StaffPage() {
  const { isAdmin, user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState({ field: "id_number", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [modal, setModal] = useState(null); // { kind: "edit" | "new" | "password", user }

  const reload = useCallback(() => {
    Promise.all([call({ action: "list" }), fetchAll(() => supabase.from("staff").select("*").order("staff_id"))])
      .then(([l, s]) => { setUsers(l.users); setStaff(s); setError(null); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { if (isAdmin) reload(); }, [isAdmin, reload]);
  // Deep link from the command palette: /staff/?q=Name
  useEffect(() => { const p = new URLSearchParams(window.location.search).get("q"); if (p) setQ(p); }, []);

  const rows = useMemo(() => (users ?? []).map((u) => {
    const s = staff.find((x) => x.login_id === u.id_number);
    return { ...u, name: s?.full_name || u.full_name || "", department: s?.department || "", linked: !!s, access: accessLabel(u.role) };
  }), [users, staff]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const test = FILTERS.find((f) => f.id === filter).test;
    return rows.filter((r) => test(r) && (!t || [r.id_number, r.name, r.department, r.access].some((v) => v?.toLowerCase().includes(t))))
      .sort((a, b) => String(a[sort.field] ?? "").localeCompare(String(b[sort.field] ?? ""), undefined, { numeric: true }) * (sort.dir === "asc" ? 1 : -1));
  }, [rows, q, filter, sort]);
  const pageRows = shown.slice((page - 1) * pageSize, page * pageSize);

  async function setDisabled(u, disabled) {
    try { await call({ action: "set_disabled", user_id: u.id, disabled }); toast.success(`${u.id_number} ${disabled ? "disabled" : "re-enabled"}.`); reload(); }
    catch (err) { toast.error(err.message); }
  }

  if (!isAdmin) {
    return <><PageHeader title="User Management" /><Card><EmptyState icon={Lock} title="Administrators only" /></Card></>;
  }
  const close = () => setModal(null);
  const done = () => { close(); reload(); };

  return (
    <>
      <PageHeader title="User Management" help="user-management"
        subtitle="Logins and staff records together. Accounts are disabled, never deleted, so their history keeps a name."
        actions={<button onClick={() => setModal({ kind: "new" })} disabled={!users}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-fg disabled:opacity-50">
          <Plus className="h-4 w-4" /> Add user</button>} />
      {error && <Card className="mb-4 p-4 text-danger" role="alert">Error loading data: {error}</Card>}

      {users && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {FILTERS.map((f) => (
            <KpiCard key={f.id} label={f.label} icon={f.icon} tone={f.id === "disabled" ? "muted" : "brand"}
              value={rows.filter(f.test).length} active={filter === f.id} onClick={() => { setFilter(f.id); setPage(1); }} />
          ))}
        </div>
      )}

      <Card className="mt-4 p-3 md:p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input className={cn(inputCls, "pl-9")} placeholder="Search ID number, name, department or access level" aria-label="Search users"
            value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="mt-3">
          {!users && !error && <TableSkeleton rows={6} cols={5} />}
          {users && shown.length === 0 && <EmptyState icon={Users} title="No matching accounts" />}
          {shown.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border">
                    <tr>
                      <SortableTh label="ID number" field="id_number" sort={sort} setSort={setSort} />
                      <SortableTh label="Name" field="name" sort={sort} setSort={setSort} />
                      <SortableTh label="Access level" field="access" sort={sort} setSort={setSort} />
                      <SortableTh label="Department" field="department" sort={sort} setSort={setSort} className="hidden lg:table-cell" />
                      <SortableTh label="Last sign-in" field="last_sign_in_at" sort={sort} setSort={setSort} className="hidden md:table-cell" />
                      <th className="px-2 text-right text-xs font-medium text-muted">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((u) => (
                      <tr key={u.id} className={cn("border-b border-border hover:bg-sunken", u.disabled && "text-muted")}>
                        <td className="whitespace-nowrap px-3 py-2 font-medium">{u.id_number}{u.id === me?.id && <span className="ml-1 text-xs text-muted">(you)</span>}</td>
                        <td className="px-3 py-2">
                          {u.name || "—"}
                          {!u.linked && <span className="ml-1 rounded bg-warn/10 px-1 text-xs text-warn" title="No staff record carries this ID number, so this person cannot be issued an asset or receive handover mail.">no staff record</span>}
                          {u.disabled && <span className="ml-1 rounded bg-muted/10 px-1 text-xs">disabled</span>}
                        </td>
                        <td className="px-3 py-2">{u.access}</td>
                        <td className="hidden px-3 py-2 lg:table-cell">{u.department || "—"}</td>
                        <td className="hidden whitespace-nowrap px-3 py-2 md:table-cell">{u.last_sign_in_at ? fmtDateTime(u.last_sign_in_at) : "Never"}</td>
                        <td className="px-2 py-1">
                          <div className="flex justify-end gap-1">
                            <button onClick={() => setModal({ kind: "edit", user: u })} aria-label={`Edit ${u.id_number}`} title="Edit"
                              className="rounded-lg p-1.5 text-muted hover:bg-border/50 hover:text-fg"><Pencil className="h-4 w-4" /></button>
                            <button onClick={() => setModal({ kind: "password", user: u })} aria-label={`Set password for ${u.id_number}`} title="Set a password"
                              className="rounded-lg p-1.5 text-muted hover:bg-border/50 hover:text-fg"><KeyRound className="h-4 w-4" /></button>
                            {u.disabled ? (
                              <button onClick={() => setDisabled(u, false)} aria-label={`Re-enable ${u.id_number}`} title="Re-enable"
                                className="rounded-lg p-1.5 text-muted hover:bg-border/50 hover:text-fg"><RotateCcw className="h-4 w-4" /></button>
                            ) : u.id !== me?.id && (
                              <HoldToConfirmButton label="Disable" confirmIcon={Ban} className="px-2 py-1 text-xs" onConfirm={() => setDisabled(u, true)} />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={pageSize} total={shown.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
            </>
          )}
        </div>
      </Card>

      <ModalPortal wide open={!!modal} onClose={close} labelledBy="user-form-title">
        {modal?.kind === "password" && <PasswordForm user={modal.user} onDone={done} onCancel={close} />}
        {(modal?.kind === "edit" || modal?.kind === "new") && <UserForm user={modal.user} staff={staff} onDone={done} onCancel={close} />}
      </ModalPortal>
    </>
  );
}
