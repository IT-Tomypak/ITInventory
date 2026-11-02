-- 20261013010000_simplify_notify_recipients.sql
--
-- WHY: Simplify notification management so admins manage only two groups:
--   1. HOD (Stage 1)           - the Heads of Department who approve requests first
--   2. IT Department (Stage 2) - IT team who reviews stock and does secondary approval
--

-- 1. Allow 'hod' as a purpose in notify_recipients
alter table public.notify_recipients
  drop constraint if exists notify_recipients_purpose_check;

alter table public.notify_recipients
  add constraint notify_recipients_purpose_check
  check (purpose in ('hod', 'equipment_request', 'release_pending', 'release_decided'));

-- 2. Sync any pre-existing HODs into notify_recipients so they are visible and editable in Manage -> Notify Emails
insert into public.notify_recipients (name, email, purpose, active)
select h.name, h.email, 'hod', h.active
  from public.hod h
 where not exists (
   select 1 from public.notify_recipients nr
    where nr.purpose = 'hod' and lower(nr.email) = lower(h.email)
 );

-- 3. Update hod_names() to read from notify_recipients as well as hod table
create or replace function public.hod_names() returns setof text
language sql stable security definer set search_path to 'public' as $$
  select name from (
    select name from hod where active and name is not null
    union
    select name from notify_recipients where purpose = 'hod' and active and name is not null
  ) s
  order by name;
$$;

revoke execute on function public.hod_names() from public;
grant execute on function public.hod_names() to anon, authenticated, service_role;

-- 4. Update submit_equipment_request to find HOD email in notify_recipients or hod table
create or replace function public.submit_equipment_request(
  p_name text, p_department text, p_asset_type text,
  p_justification text, p_urgency text, p_attachment text,
  p_employee_no text default null, p_hod text default null, p_services text[] default null,
  p_email text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_types  constant text[] := array['Laptop','Desktop','Monitor','Printer','Network','Server','Phone','Tablet','Peripheral','Other'];
  v_name   text := left(btrim(coalesce(p_name, '')), 100);
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_ip     text := btrim(split_part(coalesce(
                     current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1));
  v_hod_name  text;
  v_hod_email text;
  v_reason text;
  v_photos text[];
  v_id     bigint;
  v_at     timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('submit_equipment_request'));

  v_photos := array_remove(regexp_split_to_array(coalesce(btrim(p_attachment), ''), '\s*\n\s*'), '');

  -- Look up HOD in notify_recipients first, then hod table
  select name, email into v_hod_name, v_hod_email
    from (
      select name, email from notify_recipients where purpose = 'hod' and active and lower(name) = lower(btrim(coalesce(p_hod, '')))
      union all
      select name, email from hod where active and lower(name) = lower(btrim(coalesce(p_hod, '')))
    ) h limit 1;

  if v_name = '' or btrim(coalesce(p_department, '')) = '' then
    v_reason := 'missing_fields';
  elsif p_services is not null and (btrim(coalesce(p_employee_no, '')) = '' or btrim(coalesce(p_hod, '')) = ''
                                    or cardinality(p_services) = 0) then
    v_reason := 'missing_fields';
  elsif p_services is not null and not (p_services <@ v_types) then
    v_reason := 'invalid_asset_type';
  elsif p_services is null and (p_asset_type is null or p_asset_type <> all (v_types)) then
    v_reason := 'invalid_asset_type';
  elsif p_email is not null and (length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    v_reason := 'invalid_email';
  elsif p_email is not null and v_hod_email is null then
    v_reason := 'invalid_hod';
  elsif coalesce(p_urgency, 'Normal') not in ('Normal', 'Urgent') then
    v_reason := 'invalid_urgency';
  elsif length(coalesce(p_justification, '')) > 2000 then
    v_reason := 'justification_too_long';
  elsif cardinality(v_photos) > 4 or exists (
          select 1 from unnest(v_photos) u
          where u !~ '^https://[^/\s]+/storage/v1/object/public/attachments/requests/[^\s]+$') then
    v_reason := 'invalid_attachment';
  elsif (select count(*) from request_submission_log
          where accepted and lower(requester_name) = lower(v_name)
            and created_at > now() - interval '1 hour') >= 5 then
    v_reason := 'rate_limited_name';
  elsif (select count(*) from request_submission_log
          where accepted and created_at > now() - interval '1 hour') >= 40 then
    v_reason := 'rate_limited_overall';
  end if;

  insert into request_submission_log (requester_name, ip, accepted, reason)
  values (nullif(v_name, ''), nullif(v_ip, ''), v_reason is null, v_reason);

  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  insert into equipment_request (requested_by_name, department, asset_type, justification, urgency, attachment_path,
                                 employee_no, hod, services, requester_email, hod_email)
  values (v_name, left(btrim(p_department), 100), coalesce(p_services[1], p_asset_type), nullif(btrim(p_justification), ''),
          coalesce(p_urgency, 'Normal'), nullif(array_to_string(v_photos, E'\n'), ''),
          nullif(left(btrim(p_employee_no), 30), ''),
          coalesce(v_hod_name, nullif(left(btrim(p_hod), 100), '')), array_to_string(p_services, ', '),
          nullif(v_email, ''), v_hod_email)
  returning request_id, created_at into v_id, v_at;

  return jsonb_build_object('ok', true, 'request_id', v_id, 'created_at', v_at);
end $$;

revoke execute on function public.submit_equipment_request(text, text, text, text, text, text, text, text, text[], text) from public;
grant execute on function public.submit_equipment_request(text, text, text, text, text, text, text, text, text[], text) to anon, authenticated, service_role;

-- 5. Automatically keep status in sync with release_status on IT decision
create or replace function public.guard_asset_release() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  rel_keys    constant text[] := array['release_status','status','approved_by','approved_at','approval_note'];
  rel_changed boolean;
  asking      boolean;
begin
  if tg_op = 'INSERT' then
    if public.is_approver() and new.release_status in ('Approved','Rejected') then
      new.approved_by := public.current_actor_name();
      new.approved_at := now();
      new.status      := new.release_status;
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
              or new.status          is distinct from old.status
              or new.approved_by     is distinct from old.approved_by
              or new.approved_at     is distinct from old.approved_at
              or new.approval_note   is distinct from old.approval_note;
  if not rel_changed then return new; end if;

  asking := new.release_status = 'Pending'
        and coalesce(old.release_status, 'Rejected') = 'Rejected';

  if not asking and not public.is_approver() then
    raise exception 'Only the asset custodian can decide an asset release.' using errcode = '42501';
  end if;

  if asking then
    new.approved_by := null; new.approved_at := null; new.approval_note := null;
  elsif new.release_status in ('Approved','Rejected') then
    new.status      := new.release_status;
    new.approved_by := coalesce(new.approved_by, public.current_actor_name());
    new.approved_at := coalesce(new.approved_at, now());
  end if;
  return new;
end $$;

