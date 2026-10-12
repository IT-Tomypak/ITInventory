-- 20261012040000_request_fields_and_loans.sql
--
-- WHY (2026-10-12): IT's forms ask for more than ITrack did.
--   * IT hardware request: Requester name, Employee no, Department, HOD
--     Department, Request for Service(s) (several may be ticked), Description.
--   * Loan accessories request (new): Loaner name, Employee no, Loaner dept,
--     Phone no, Loaned item (a type that has stock), Reason, start and end date.
--
-- equipment_request.asset_type stays ONE type (the first ticked): the stock
-- suggestions, the allocate page and the email all match on it. `services`
-- holds everything that was ticked, for people to read.

alter table public.equipment_request
  add column employee_no text,
  add column hod         text,
  add column services    text;

-- Three new parameters, all defaulted. A defaulted overload beside the old
-- six-argument function would be ambiguous to PostgREST, so the old one goes.
drop function public.submit_equipment_request(text, text, text, text, text, text);

create function public.submit_equipment_request(
  p_name text, p_department text, p_asset_type text,
  p_justification text, p_urgency text, p_attachment text,
  p_employee_no text default null, p_hod text default null, p_services text[] default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_types  constant text[] := array['Laptop','Desktop','Monitor','Printer','Network','Server','Phone','Tablet','Peripheral','Other'];
  v_name   text := left(btrim(coalesce(p_name, '')), 100);
  v_ip     text := btrim(split_part(coalesce(
                     current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1));
  v_reason text;
  v_photos text[];
  v_id     bigint;
  v_at     timestamptz;
begin
  -- Serialise submissions so two at once cannot both slip under a limit.
  perform pg_advisory_xact_lock(hashtext('submit_equipment_request'));

  v_photos := array_remove(regexp_split_to_array(coalesce(btrim(p_attachment), ''), '\s*\n\s*'), '');

  if v_name = '' or btrim(coalesce(p_department, '')) = '' then
    v_reason := 'missing_fields';
  -- ponytail: p_services null = a page built before this migration, which
  -- cannot send the new fields; it is held to the old rules. Make the three
  -- parameters required once no such page is in use.
  elsif p_services is not null and (btrim(coalesce(p_employee_no, '')) = '' or btrim(coalesce(p_hod, '')) = ''
                                    or cardinality(p_services) = 0) then
    v_reason := 'missing_fields';
  elsif p_services is not null and not (p_services <@ v_types) then
    v_reason := 'invalid_asset_type';
  elsif p_services is null and (p_asset_type is null or p_asset_type <> all (v_types)) then
    v_reason := 'invalid_asset_type';
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
                                 employee_no, hod, services)
  values (v_name, left(btrim(p_department), 100), coalesce(p_services[1], p_asset_type), nullif(btrim(p_justification), ''),
          coalesce(p_urgency, 'Normal'), nullif(array_to_string(v_photos, E'\n'), ''),
          nullif(left(btrim(p_employee_no), 30), ''), nullif(left(btrim(p_hod), 100), ''), array_to_string(p_services, ', '))
  returning request_id, created_at into v_id, v_at;

  return jsonb_build_object('ok', true, 'request_id', v_id, 'created_at', v_at);
end $$;

revoke execute on function public.submit_equipment_request(text, text, text, text, text, text, text, text, text[]) from public;
grant execute on function public.submit_equipment_request(text, text, text, text, text, text, text, text, text[]) to anon, authenticated, service_role;

-- The tracker shows everything that was asked for, not only the first type.
create or replace function public.check_request_status(p_request_id bigint)
returns table (request_id bigint, status text, asset_type text, urgency text, created_at timestamptz,
               release_status text, approved_at timestamptz, allocated boolean,
               delivered_at timestamptz, ack_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select r.request_id, r.status, coalesce(r.services, r.asset_type::text), r.urgency, r.created_at,
         r.release_status, r.approved_at, r.asset_id is not null, r.delivered_at, r.ack_at
    from equipment_request r
   where r.request_id = p_request_id
$$;

-- ---------------------------------------------------------------------------
-- Loan accessories requests
-- ---------------------------------------------------------------------------
-- A request to borrow, not the loan itself: IT issues the unit on Allocate /
-- Return (asset_assignment with due_back_on) and moves the status here by hand.
create table public.loan_request (
  loan_id     bigserial primary key,
  loaner_name text not null,
  employee_no text not null,
  department  text not null,
  phone       text not null,
  item_type   text not null,  -- an accessory category that had stock when asked
  reason      text not null,
  start_on    date not null,
  end_on      date not null check (end_on >= start_on),
  status      text not null default 'Requested' check (status in
                ('Requested','Approved','Issued','Returned','Rejected','Cancelled')),
  created_at  timestamptz not null default now()
);
create index loan_request_status_idx on public.loan_request (status, created_at);

alter table public.loan_request enable row level security;
-- No insert policy: rows arrive only through submit_loan_request().
create policy "read for authenticated" on public.loan_request for select to authenticated using (true);
create policy "update for non-viewers" on public.loan_request for update to authenticated
  using (not public.is_viewer()) with check (not public.is_viewer());
revoke all on public.loan_request from anon;
grant select, update on public.loan_request to authenticated, service_role;

-- What the public loan form may offer: accessory types with stock, and how
-- many. Counts only; no tag, serial or holder leaves the database.
create function public.loanable_accessories()
returns table (item_type text, available int)
language sql stable security definer set search_path to 'public' as $$
  select a.asset_type::text, count(*)::int
    from assets a join categories c on c.name = a.asset_type
   where c.list = 'accessory' and c.active and a.active and a.status = 'In stock'
   group by 1 order by 1
$$;

create function public.submit_loan_request(
  p_name text, p_employee_no text, p_department text, p_phone text,
  p_item_type text, p_reason text, p_start_on date, p_end_on date
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_name   text := left(btrim(coalesce(p_name, '')), 100);
  v_ip     text := btrim(split_part(coalesce(
                     current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1));
  v_reason text;
  v_id     bigint;
  v_at     timestamptz;
begin
  -- Same lock and the same hourly limits as the hardware request: one log.
  perform pg_advisory_xact_lock(hashtext('submit_equipment_request'));

  if v_name = '' or btrim(coalesce(p_employee_no, '')) = '' or btrim(coalesce(p_department, '')) = ''
     or btrim(coalesce(p_phone, '')) = '' or btrim(coalesce(p_reason, '')) = '' then
    v_reason := 'missing_fields';
  elsif p_start_on is null or p_end_on is null or p_end_on < p_start_on then
    v_reason := 'invalid_dates';
  elsif length(p_reason) > 2000 then
    v_reason := 'reason_too_long';
  elsif not exists (select 1 from loanable_accessories() l where l.item_type = p_item_type) then
    v_reason := 'item_unavailable';
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

  insert into loan_request (loaner_name, employee_no, department, phone, item_type, reason, start_on, end_on)
  values (v_name, left(btrim(p_employee_no), 30), left(btrim(p_department), 100), left(btrim(p_phone), 30),
          p_item_type, btrim(p_reason), p_start_on, p_end_on)
  returning loan_id, created_at into v_id, v_at;

  return jsonb_build_object('ok', true, 'loan_id', v_id, 'created_at', v_at);
end $$;

revoke execute on function public.loanable_accessories() from public;
revoke execute on function public.submit_loan_request(text, text, text, text, text, text, date, date) from public;
grant execute on function public.loanable_accessories() to anon, authenticated, service_role;
grant execute on function public.submit_loan_request(text, text, text, text, text, text, date, date) to anon, authenticated, service_role;
