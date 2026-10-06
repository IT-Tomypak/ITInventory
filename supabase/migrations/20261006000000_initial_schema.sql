-- 20261006000000_initial_schema.sql
--
-- WHY: ITrack's first schema. RLS is the access control for this system: the
-- static site ships only the anon key, which is itself a valid JWT, and
-- PostgREST is a public URL, so every rule in the access matrix (brief §3.3)
-- has to live here as a policy or a trigger guard. The UI only hides buttons.
--
-- Covers build phases 1–2: tables, indexes, the three role predicates, all
-- policies, the non-notification triggers, the two Storage buckets, and the
-- login/logout history RPCs. Notification triggers, Vault reads and the anon
-- RPCs (submit_equipment_request, check_request_status) arrive in their own
-- migrations with phases 5–6.
--
-- One deliberate deviation from the brief's column list: purchase cost lives in
-- `asset_value`, not on `assets`. `assets` must be readable by every login
-- (§5.2), and purchase cost must be admin-read only (§5.4, §7.11). Postgres RLS
-- is per row, not per column, so the money has to sit in its own table.

create extension if not exists pgcrypto with schema extensions;

-- ===========================================================================
-- Shared value lists — one definition, used by every table that needs it, so
-- the request form and the register cannot disagree about what a type is.
-- ===========================================================================
create domain public.asset_type_t as text check (value in
  ('Laptop','Desktop','Monitor','Printer','Network','Server','Phone','Tablet','Peripheral','Other'));
create domain public.asset_condition_t as text check (value in ('New','Good','Fair','Damaged'));

-- ===========================================================================
-- Master data
-- ===========================================================================
create table public.locations (
  location_id bigserial primary key,
  name        text not null unique,
  site        text,
  floor       text,
  notes       text,
  active      boolean not null default true
);

create table public.vendors (
  vendor_id     bigserial primary key,
  name          text not null unique,
  contact_name  text,
  contact_email text,
  phone         text,
  notes         text,
  active        boolean not null default true
);

create table public.staff (
  staff_id   bigserial primary key,
  full_name  text not null,
  -- NULL when absent, never '': an empty string collides on the second row.
  email      text unique check (email is null or btrim(email) <> ''),
  department text,
  -- Job title (free text). NOT the access level — that is app_metadata.role.
  role       text,
  -- The ID number this person signs in with; joins the staff row to auth.users.
  login_id   text unique check (login_id is null or btrim(login_id) <> ''),
  -- Three-state on purpose: NULL = fall back to the department rule; an
  -- explicit false is a decision about one person, not an absence of one.
  eligible   boolean
);

create table public.assets (
  asset_id        bigserial primary key,
  asset_tag       text not null unique,
  asset_type      public.asset_type_t not null,
  make            text,
  model           text,
  -- Not unique: vendors reuse serials, and a wrong unique constraint blocks a
  -- legitimate entry at 5pm.
  serial_no       text,
  status          text not null default 'In stock' check (status in
                    ('In stock','Assigned','In repair','Loaned','Retired','Lost/Stolen')),
  location_id     bigint references public.locations on delete set null,
  department      text,  -- owning department, which is not the holder
  purchase_date   date,
  po_no           text,
  invoice_no      text,
  vendor_id       bigint references public.vendors on delete set null,
  warranty_end    date,
  refresh_years   int default 4,
  -- STORED, not derived: a derived value can never record the one laptop whose
  -- replacement was deferred, and silently rewrites history whenever someone
  -- edits refresh_years. Defaulted by trg_default_refresh_due.
  refresh_due     date,
  spec_notes      text,
  photo_path      text,  -- newline-separated public URLs; see lib/photos.js
  active          boolean not null default true,
  created_at      timestamptz default now(),
  created_by      uuid,
  created_by_name text,
  created_by_id   text
);
create index assets_serial_no_idx   on public.assets (serial_no);
create index assets_location_id_idx on public.assets (location_id);
create index assets_vendor_id_idx   on public.assets (vendor_id);

-- Purchase cost, split out so it can be admin-read only (see header).
create table public.asset_value (
  asset_id         bigint primary key references public.assets on delete cascade,
  purchase_cost_rm numeric(12,2) check (purchase_cost_rm >= 0)
);

-- ===========================================================================
-- Work tables
-- ===========================================================================
create table public.equipment_request (
  -- This id IS the request number the requester quotes. No second reference.
  request_id        bigserial primary key,
  requested_by_name text not null,  -- free text: the public form has no session
  department        text not null,
  asset_type        public.asset_type_t not null,
  justification     text,
  urgency           text not null default 'Normal' check (urgency in ('Normal','Urgent')),
  -- 'Requested' is the magic value: it alone fires the notification email and
  -- the receipt archive.
  status            text not null default 'Requested' check (status in
                      ('Requested','Approved','Allocated','Delivered','Rejected','Cancelled')),
  release_status    text check (release_status in ('Pending','Approved','Rejected')),
  approved_by       text,  -- always from the session, stamped by trg_guard_asset_release
  approved_at       timestamptz,
  approval_note     text,
  asset_id          bigint references public.assets on delete set null,
  handled_by        bigint references public.staff on delete set null,
  attachment_path   text,
  delivered_at      timestamptz,
  ack_at            timestamptz,
  ack_by_name       text,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  created_by_name   text
);
create index equipment_request_status_idx on public.equipment_request (status, created_at);
create index equipment_request_asset_idx  on public.equipment_request (asset_id);

-- One row per period of custody; never updated in place except to close it.
create table public.asset_assignment (
  assignment_id bigserial primary key,
  asset_id      bigint not null references public.assets on delete cascade,
  staff_id      bigint references public.staff on delete set null,  -- NULL when held by a location
  location_id   bigint references public.locations on delete set null,
  request_id    bigint references public.equipment_request on delete set null,
  issued_on     date not null default current_date,
  due_back_on   date,  -- set for a loan, NULL for a permanent issue
  returned_on   date,  -- NULL means currently held
  -- What the officer chose on check-in; read by trg_sync_asset_status.
  return_status text check (return_status in ('In stock','In repair')),
  condition_out public.asset_condition_t,
  condition_in  public.asset_condition_t,
  notes_out     text,
  notes_in      text,
  issued_by     uuid,
  received_by   uuid,
  created_at    timestamptz not null default now(),
  check (returned_on is null or returned_on >= issued_on)
);
-- The whole double-issue defence. Two officers allocating the same laptop at
-- the same moment is a race no amount of UI disabling fixes.
create unique index uq_assignment_open
  on public.asset_assignment (asset_id) where returned_on is null;
create index asset_assignment_asset_idx on public.asset_assignment (asset_id, issued_on desc);
create index asset_assignment_staff_idx on public.asset_assignment (staff_id);

-- ===========================================================================
-- Audit
-- ===========================================================================
-- One row per changed field. NO foreign key to assets: deleting an asset must
-- not erase the record that it existed and was deleted. An audit trail with a
-- cascade is not an audit trail.
create table public.asset_audit (
  audit_id        bigserial primary key,
  asset_id        bigint not null,
  action          text not null check (action in ('created','updated','deleted','assigned','returned')),
  field           text,  -- a human label ("Warranty end"), not a column name
  old_value       text,
  new_value       text,
  changed_by      uuid,
  changed_by_name text,
  changed_at      timestamptz not null default now()
);
create index asset_audit_asset_idx on public.asset_audit (asset_id, changed_at desc);

create table public.audit_event (
  event_id    bigserial primary key,
  event_type  text not null check (event_type in ('login','logout','user_created','user_updated',
                'user_role_changed','user_password_reset','user_disabled','user_enabled')),
  actor_id    uuid,
  actor_name  text,
  target_id   uuid,
  target_name text,
  detail      text,  -- pre-written for humans: 'officer -> admin'
  session_id  text,
  occurred_at timestamptz not null default now()
);
create index audit_event_occurred_idx on public.audit_event (occurred_at desc);
-- Without this every token refresh and every extra tab writes another "login"
-- and the change log is unreadable within a week.
create unique index audit_event_login_session_idx
  on public.audit_event (session_id)
  where event_type = 'login' and session_id is not null;

-- ===========================================================================
-- Notification plumbing (tables only; the functions arrive in phase 6)
-- ===========================================================================
-- Deliberately no unique key on email: one address legitimately appears once
-- per purpose. Seeds guard with WHERE NOT EXISTS, not ON CONFLICT.
create table public.notify_recipients (
  id      bigserial primary key,
  email   text not null,
  name    text,
  purpose text not null check (purpose in ('equipment_request','release_pending','release_decided')),
  active  boolean not null default true
);

-- One row per provider call, not per recipient. Records what the provider
-- ACCEPTED, not what was delivered.
create table public.notify_log (
  id              bigserial primary key,
  purpose         text,
  recipients      text[],
  subject         text,
  ok              boolean not null,
  provider_status int,
  provider_id     text,
  error           text,  -- truncated to 500 chars, failure rows only
  created_at      timestamptz not null default now()
);
create index notify_log_failures_idx on public.notify_log (created_at desc) where ok = false;
create index notify_log_created_idx  on public.notify_log (created_at desc);

-- Bearer credential in an action email: single use, 7-day expiry, one request,
-- one action. Only reachable through SECURITY DEFINER functions (no policies).
create table public.assign_token (
  token      text primary key default translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_'),
  request_id bigint references public.equipment_request on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at    timestamptz,
  used_for   text check (used_for in ('allocate','assign_officer','ack')),
  chosen_id  text,
  used_ip    text
);

-- Every attempt at the public form, including refusals — the valuable rows.
create table public.request_submission_log (
  id             bigserial primary key,
  requester_name text,
  ip             text,
  created_at     timestamptz not null default now(),
  accepted       boolean not null,
  reason         text
);
create index request_submission_log_window_idx on public.request_submission_log (created_at desc);
create index request_submission_log_name_idx   on public.request_submission_log (lower(requester_name), created_at desc);

create table public.push_subscriptions (
  id         bigserial primary key,
  user_id    uuid not null references auth.users on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- ===========================================================================
-- Role predicates
-- ===========================================================================
create or replace function public.is_admin() returns boolean
language sql stable set search_path to 'public' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','super_admin'), false)
$$;

create or replace function public.is_viewer() returns boolean
language sql stable set search_path to 'public' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'viewer', false)
$$;

-- Reads auth.users, not the token: a role granted after the token was issued
-- is not in that token until it refreshes, and an approver promoted five
-- minutes ago must not be told "no".
create or replace function public.is_approver() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select raw_app_meta_data ->> 'role' from auth.users where id = auth.uid()) in ('approver','super_admin'),
    false)
$$;

-- The ID number is the email local part: 12345@tomypak.internal -> 12345.
create or replace function public.current_login_id() returns text
language sql stable set search_path to 'public' as $$
  select nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), '')
$$;

-- Who is acting, for author stamps and audit rows. Never taken from the browser.
create or replace function public.current_actor_name() returns text
language sql stable security definer set search_path to 'public' as $$
  select case when auth.role() = 'anon' then 'Public form' else coalesce(
    (select full_name from public.staff where login_id = public.current_login_id() limit 1),
    auth.jwt() -> 'user_metadata' ->> 'full_name',
    public.current_login_id(),
    auth.role(),
    'system') end
$$;

-- ===========================================================================
-- Triggers. Same-event triggers fire in ALPHABETICAL order of name, so names
-- are chosen to make that the order needed.
-- ===========================================================================

-- Author stamps: set from auth.uid() on insert, restored from OLD on update.
-- An author the client can set, or anyone can rewrite, is worth nothing in an
-- audit. Shared by assets and equipment_request (keys a table lacks are ignored).
create or replace function public.stamp_author() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    new := jsonb_populate_record(new, jsonb_build_object(
      'created_by', auth.uid(),
      'created_by_name', public.current_actor_name(),
      'created_by_id', public.current_login_id(),
      'created_at', now()));
  else
    new := jsonb_populate_record(new, (
      select jsonb_object_agg(k, v) from jsonb_each(to_jsonb(old)) as e(k, v)
      where k in ('created_by','created_by_name','created_by_id','created_at')));
  end if;
  return new;
end $$;

create trigger trg_stamp_asset_author before insert or update on public.assets
  for each row execute function public.stamp_author();
create trigger trg_stamp_request_author before insert or update on public.equipment_request
  for each row execute function public.stamp_author();

-- refresh_due := purchase_date + refresh_years, only when not given. After that
-- it is an ordinary editable fact (see the column comment).
create or replace function public.default_refresh_due() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.refresh_due is null and new.purchase_date is not null and new.refresh_years is not null then
    new.refresh_due := (new.purchase_date + make_interval(years => new.refresh_years))::date;
  end if;
  return new;
end $$;
create trigger trg_default_refresh_due before insert or update of purchase_date on public.assets
  for each row execute function public.default_refresh_due();

-- Custody decides Assigned/Loaned; nothing else may. Closing an assignment is
-- a decision, not something a status change (single edit or bulk) should do
-- silently, and an asset cannot be "Assigned" to nobody. trg_sync_asset_status
-- always satisfies this, because it runs AFTER the assignment row changed.
create or replace function public.retired_clears_holder() returns trigger
language plpgsql set search_path to 'public' as $$
declare held boolean;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  held := tg_op = 'UPDATE' and exists
    (select 1 from public.asset_assignment where asset_id = new.asset_id and returned_on is null);
  if held and new.status not in ('Assigned','Loaned') then
    raise exception 'Asset % is still held. Check it in on Allocate / Return before marking it %.',
      new.asset_tag, new.status using errcode = 'P0001';
  end if;
  if not held and new.status in ('Assigned','Loaned') then
    raise exception 'Asset % is not held by anyone. Use Allocate / Return to issue it.',
      new.asset_tag using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_retired_clears_holder before insert or update of status on public.assets
  for each row execute function public.retired_clears_holder();

-- One asset_audit row per changed field. SECURITY DEFINER because asset_audit
-- has no write policy at all.
--
-- !! This trigger ENUMERATES the columns it watches. A column added to
-- !! `assets` later has NO history until it is added to the list below and
-- !! this function is re-declared in a new migration.
create or replace function public.audit_asset_change() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    insert into asset_audit (asset_id, action, field, new_value, changed_by, changed_by_name)
    values (new.asset_id, 'created', 'Asset', new.asset_tag, auth.uid(), current_actor_name());
    return new;
  elsif tg_op = 'DELETE' then
    insert into asset_audit (asset_id, action, field, old_value, changed_by, changed_by_name)
    values (old.asset_id, 'deleted', 'Asset', old.asset_tag, auth.uid(), current_actor_name());
    return old;
  end if;

  insert into asset_audit (asset_id, action, field, old_value, new_value, changed_by, changed_by_name)
  select new.asset_id, 'updated', f.label, f.o, f.n, auth.uid(), current_actor_name()
  from (values
    ('Asset tag',     old.asset_tag,             new.asset_tag),
    ('Type',          old.asset_type::text,      new.asset_type::text),
    ('Make',          old.make,                  new.make),
    ('Model',         old.model,                 new.model),
    ('Serial no',     old.serial_no,             new.serial_no),
    ('Status',        old.status,                new.status),
    ('Location',      (select name from locations where location_id = old.location_id),
                      (select name from locations where location_id = new.location_id)),
    ('Department',    old.department,            new.department),
    ('Purchase date', old.purchase_date::text,   new.purchase_date::text),
    ('PO no',         old.po_no,                 new.po_no),
    ('Invoice no',    old.invoice_no,            new.invoice_no),
    ('Vendor',        (select name from vendors where vendor_id = old.vendor_id),
                      (select name from vendors where vendor_id = new.vendor_id)),
    ('Warranty end',  old.warranty_end::text,    new.warranty_end::text),
    ('Refresh years', old.refresh_years::text,   new.refresh_years::text),
    ('Refresh due',   old.refresh_due::text,     new.refresh_due::text),
    ('Spec notes',    old.spec_notes,            new.spec_notes),
    ('Photos',        old.photo_path,            new.photo_path),
    ('Active',        old.active::text,          new.active::text)
  ) as f(label, o, n)
  where f.o is distinct from f.n;
  return new;
end $$;
create trigger trg_audit_asset_change after insert or update or delete on public.assets
  for each row execute function public.audit_asset_change();

-- Purchase cost changes are audited too; the asset_audit SELECT policy hides
-- these rows from non-admins.
create or replace function public.audit_asset_value() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' and new.purchase_cost_rm is not null
     or tg_op = 'UPDATE' and new.purchase_cost_rm is distinct from old.purchase_cost_rm then
    insert into asset_audit (asset_id, action, field, old_value, new_value, changed_by, changed_by_name)
    values (new.asset_id, 'updated', 'Purchase cost',
            case when tg_op = 'UPDATE' then old.purchase_cost_rm::text end,
            new.purchase_cost_rm::text, auth.uid(), current_actor_name());
  end if;
  return new;
end $$;
create trigger trg_audit_asset_value after insert or update on public.asset_value
  for each row execute function public.audit_asset_value();

-- §3.3 "only the approver releases an asset", living where the write happens.
-- RLS lets any officer UPDATE equipment_request; a hidden button is not access
-- control. Rules:
--   * release_status / approved_* may be decided only by is_approver().
--   * Anyone who may write the row may ASK for a release (NULL/Rejected -> Pending).
--   * A non-admin approver's decision may not change any other field in the
--     same write — approving is their job, editing the request is not.
--   * approved_by / approved_at always come from the session, never the client.
create or replace function public.guard_asset_release() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  rel_keys    constant text[] := array['release_status','approved_by','approved_at','approval_note'];
  rel_changed boolean;
  asking      boolean;
begin
  if tg_op = 'INSERT' then
    if public.is_approver() and new.release_status in ('Approved','Rejected') then
      new.approved_by := public.current_actor_name();
      new.approved_at := now();
    else
      if new.release_status is not null and new.release_status <> 'Pending' then
        raise exception 'Only the asset custodian can decide an asset release.' using errcode = '42501';
      end if;
      new.approved_by := null; new.approved_at := null;
      if not public.is_approver() then new.approval_note := null; end if;
    end if;
    return new;
  end if;

  rel_changed := new.release_status  is distinct from old.release_status
              or new.approved_by   is distinct from old.approved_by
              or new.approved_at   is distinct from old.approved_at
              or new.approval_note is distinct from old.approval_note;
  if not rel_changed then return new; end if;

  asking := new.release_status = 'Pending'
        and coalesce(old.release_status, 'Rejected') = 'Rejected';

  if not asking and not public.is_approver() then
    raise exception 'Only the asset custodian can decide an asset release.' using errcode = '42501';
  end if;
  if not asking and not public.is_admin()
     and (to_jsonb(new) - rel_keys) <> (to_jsonb(old) - rel_keys) then
    raise exception 'A release decision cannot change other fields of the request in the same save.'
      using errcode = '42501';
  end if;

  if asking then
    new.approved_by := null; new.approved_at := null; new.approval_note := null;
  elsif new.release_status in ('Approved','Rejected') then
    new.approved_by := public.current_actor_name();
    new.approved_at := now();
  end if;
  return new;
end $$;
create trigger trg_guard_asset_release before insert or update on public.equipment_request
  for each row execute function public.guard_asset_release();

-- issued_by / received_by from auth.uid(), never from the browser.
create or replace function public.stamp_assignment_author() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    new.issued_by   := auth.uid();
    new.received_by := case when new.returned_on is not null then auth.uid() end;
  else
    new.issued_by   := old.issued_by;
    new.received_by := case when old.returned_on is null and new.returned_on is not null
                            then auth.uid() else old.received_by end;
  end if;
  return new;
end $$;
create trigger trg_stamp_assignment_author before insert or update on public.asset_assignment
  for each row execute function public.stamp_assignment_author();

-- 'assigned' / 'returned' rows in asset_audit, with the holder's name as value.
create or replace function public.audit_assignment() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare holder text;
begin
  holder := coalesce((select full_name from staff where staff_id = new.staff_id),
                     (select name from locations where location_id = new.location_id));
  if tg_op = 'INSERT' and new.returned_on is null then
    insert into asset_audit (asset_id, action, field, new_value, changed_by, changed_by_name)
    values (new.asset_id, 'assigned', 'Holder', holder, auth.uid(), current_actor_name());
  elsif tg_op = 'UPDATE' and old.returned_on is null and new.returned_on is not null then
    insert into asset_audit (asset_id, action, field, old_value, changed_by, changed_by_name)
    values (new.asset_id, 'returned', 'Holder', holder, auth.uid(), current_actor_name());
  end if;
  return new;
end $$;
create trigger trg_audit_assignment after insert or update on public.asset_assignment
  for each row execute function public.audit_assignment();

-- ONE place decides asset status from custody, so the register and the history
-- cannot disagree. Open row -> Assigned (Loaned when due_back_on is set);
-- closing the row -> In stock, or In repair if the officer chose it.
-- A historical row inserted already-closed never moves the asset.
create or replace function public.sync_asset_status() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.returned_on is null then
    update assets
       set status = case when new.due_back_on is not null then 'Loaned' else 'Assigned' end
     where asset_id = new.asset_id
       and status is distinct from case when new.due_back_on is not null then 'Loaned' else 'Assigned' end;
  elsif tg_op = 'UPDATE' and old.returned_on is null then
    update assets set status = coalesce(new.return_status, 'In stock')
     where asset_id = new.asset_id;
  end if;
  return new;
end $$;
create trigger trg_sync_asset_status after insert or update of returned_on, due_back_on, return_status
  on public.asset_assignment for each row execute function public.sync_asset_status();

-- ===========================================================================
-- Login history. Supabase keeps none you can query. No arguments: both read
-- auth.uid() inside the database so the browser cannot forge who signed in.
-- ===========================================================================
create or replace function public.log_login() returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return; end if;
  insert into audit_event (event_type, actor_id, actor_name, session_id)
  values ('login', auth.uid(), current_actor_name(), auth.jwt() ->> 'session_id')
  on conflict (session_id) where event_type = 'login' and session_id is not null do nothing;
end $$;

create or replace function public.log_logout() returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return; end if;
  insert into audit_event (event_type, actor_id, actor_name, session_id)
  values ('logout', auth.uid(), current_actor_name(), auth.jwt() ->> 'session_id');
end $$;

-- ===========================================================================
-- The audit feed. security_invoker = true is LOAD-BEARING: without it a view
-- over two RLS-protected tables runs as its owner and hands every
-- authenticated user everything in both.
-- ===========================================================================
create view public.audit_feed with (security_invoker = true) as
  select 'e' || e.event_id as id, 'security'::text as category, e.event_type as action,
         null::bigint as asset_id, null::text as field, null::text as old_value, null::text as new_value,
         e.detail, e.actor_id, e.actor_name, e.target_name, e.occurred_at
    from public.audit_event e
  union all
  select 'a' || a.audit_id, 'asset', a.action,
         a.asset_id, a.field, a.old_value, a.new_value,
         null, a.changed_by, a.changed_by_name, null, a.changed_at
    from public.asset_audit a;

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
alter table public.locations              enable row level security;
alter table public.vendors                enable row level security;
alter table public.staff                  enable row level security;
alter table public.assets                 enable row level security;
alter table public.asset_value            enable row level security;
alter table public.equipment_request      enable row level security;
alter table public.asset_assignment       enable row level security;
alter table public.asset_audit            enable row level security;
alter table public.audit_event            enable row level security;
alter table public.notify_recipients      enable row level security;
alter table public.notify_log             enable row level security;
alter table public.assign_token           enable row level security;  -- no policies: functions only
alter table public.request_submission_log enable row level security;  -- no policies: functions only
alter table public.push_subscriptions     enable row level security;

-- Work tables. A FOR ALL policy also governs SELECT, so the read policy must
-- exist separately or viewers lose read access too. Policies OR together.
create policy "read for authenticated" on public.assets for select to authenticated using (true);
create policy "write for non-viewers"  on public.assets for all to authenticated
  using (not public.is_viewer()) with check (not public.is_viewer());

create policy "read for authenticated" on public.asset_assignment for select to authenticated using (true);
create policy "write for non-viewers"  on public.asset_assignment for all to authenticated
  using (not public.is_viewer()) with check (not public.is_viewer());

-- equipment_request: split policies — "may add, may not change". A viewer must
-- still be able to raise a request: refusing them only pushes them to the
-- public /request form, which is the same row with less traceability.
create policy "read for authenticated" on public.equipment_request
  for select to authenticated using (true);
create policy "insert for authenticated" on public.equipment_request  -- deliberately open to viewers
  for insert to authenticated with check (true);
create policy "update for non-viewers" on public.equipment_request
  for update to authenticated using (not public.is_viewer()) with check (not public.is_viewer());
create policy "delete for non-viewers" on public.equipment_request
  for delete to authenticated using (not public.is_viewer());

-- Master data.
create policy "read for authenticated" on public.locations for select to authenticated using (true);
create policy "write for admins"       on public.locations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "read for authenticated" on public.vendors for select to authenticated using (true);
create policy "write for admins"       on public.vendors for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "read for authenticated" on public.staff for select to authenticated using (true);
create policy "write for admins"       on public.staff for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "read for authenticated" on public.notify_recipients for select to authenticated using (true);
create policy "write for admins"       on public.notify_recipients for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Money is admin-read: "read-only to all authenticated" is not the right
-- default for purchase cost and vendor pricing.
create policy "admin read"  on public.asset_value for select to authenticated using (public.is_admin());
create policy "admin write" on public.asset_value for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Audit tables: SELECT only, and NO write policy whatsoever. Rows arrive only
-- through SECURITY DEFINER triggers/functions or the service role, so nobody —
-- administrators included — can edit or delete an entry through the app.
-- asset_audit is readable by every login because asset history (/assets and
-- the register's History panel) is operational work open to all roles; cost
-- rows stay admin-only.
create policy "read history" on public.asset_audit for select to authenticated
  using (field is distinct from 'Purchase cost' or public.is_admin());
create policy "admin read" on public.audit_event for select to authenticated using (public.is_admin());
create policy "admin read" on public.notify_log  for select to authenticated using (public.is_admin());

-- Push subscriptions: each user sees and removes only their own devices.
create policy "own rows read"   on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "own rows insert" on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy "own rows delete" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- ===========================================================================
-- Anonymous access: exactly two things (§5.5), both added as SECURITY DEFINER
-- functions in phase 5. Everything else is revoked here, including on objects
-- created later by this role.
-- ===========================================================================
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- ===========================================================================
-- Storage
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  -- Public read: request, asset and condition photos. Emails link to them by URL.
  ('attachments', 'attachments', true,  10485760,
     array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']),
  -- Private: archived request receipts, read via createSignedUrl(path, 300).
  ('receipts',    'receipts',    false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

-- Separate, named policies so a later migration cannot clobber the hand-made one.
create policy "attachments insert for authenticated" on storage.objects
  for insert to authenticated with check (bucket_id = 'attachments');
create policy "attachments select for authenticated" on storage.objects
  for select to authenticated using (bucket_id = 'attachments');
-- The one anonymous upload the public /request form needs, confined to requests/.
create policy "attachments anon upload to requests" on storage.objects
  for insert to anon with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = 'requests');
-- receipts: SELECT only. NO insert policy at all — only the store-receipt Edge
-- Function writes, under the service role. A receipt a client could upload
-- would be worthless as evidence, which is the reason the archive exists.
create policy "receipts select for authenticated" on storage.objects
  for select to authenticated using (bucket_id = 'receipts');
