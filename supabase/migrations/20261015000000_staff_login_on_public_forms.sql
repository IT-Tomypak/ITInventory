-- 20261015000000_staff_login_on_public_forms.sql
--
-- WHY: the public equipment and loan request forms take anyone's word for who
-- they are. Now the person must give their staff ID (the staff row's
-- employee_no) and a password before the request is accepted. The email box
-- becomes optional on both forms; given, it is where status mail goes.
--
-- The old signatures are DROPPED, not overloaded: a leftover overload without
-- p_password would let the anon role skip the check.

-- ponytail: the password IS the staff ID for now (IT's decision). Per-person
-- passwords need a hashed column on staff (pgcrypto crypt()) checked here.
create function public.staff_login_ok(p_staff_id text, p_password text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select btrim(coalesce(p_staff_id, '')) <> ''
     and btrim(coalesce(p_password, '')) = btrim(p_staff_id)
     and exists (select 1 from staff where lower(btrim(employee_no)) = lower(btrim(p_staff_id)));
$$;
revoke execute on function public.staff_login_ok(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Equipment request: + p_password; email optional; HOD must be on the list
-- whether or not an email is given.
drop function public.submit_equipment_request(text, text, text, text, text, text, text, text, text[], text);
create function public.submit_equipment_request(
  p_name text, p_department text, p_asset_type text,
  p_justification text, p_urgency text, p_attachment text,
  p_employee_no text default null, p_hod text default null, p_services text[] default null,
  p_email text default null, p_password text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_types  constant text[] := array['Laptop','Desktop','Monitor','Printer','Network','Server','Phone','Tablet','Peripheral','Other'];
  v_name   text := left(btrim(coalesce(p_name, '')), 100);
  v_email  text := nullif(lower(btrim(coalesce(p_email, ''))), '');
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
  elsif v_email is not null and (length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    v_reason := 'invalid_email';
  elsif p_services is not null and v_hod_email is null then
    v_reason := 'invalid_hod';
  elsif coalesce(p_urgency, 'Normal') not in ('Normal', 'Urgent') then
    v_reason := 'invalid_urgency';
  elsif length(coalesce(p_justification, '')) > 2000 then
    v_reason := 'justification_too_long';
  elsif cardinality(v_photos) > 4 or exists (
          select 1 from unnest(v_photos) u
          where u !~ '^https://[^/\s]+/storage/v1/object/public/attachments/requests/[^\s]+$') then
    v_reason := 'invalid_attachment';
  elsif not staff_login_ok(p_employee_no, p_password) then
    v_reason := 'invalid_login';
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
          v_email, v_hod_email)
  returning request_id, created_at into v_id, v_at;

  return jsonb_build_object('ok', true, 'request_id', v_id, 'created_at', v_at);
end $$;

revoke execute on function public.submit_equipment_request(text, text, text, text, text, text, text, text, text[], text, text) from public;
grant execute on function public.submit_equipment_request(text, text, text, text, text, text, text, text, text[], text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Loan request: + p_password, + optional p_email (kept for status mail).
alter table public.loan_request add column requester_email text;

drop function public.submit_loan_request(text, text, text, text, text, text, date, date);
create function public.submit_loan_request(
  p_name text, p_employee_no text, p_department text, p_phone text,
  p_item_type text, p_reason text, p_start_on date, p_end_on date,
  p_password text default null, p_email text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_name   text := left(btrim(coalesce(p_name, '')), 100);
  v_email  text := nullif(lower(btrim(coalesce(p_email, ''))), '');
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
  elsif v_email is not null and (length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    v_reason := 'invalid_email';
  elsif not exists (select 1 from loanable_accessories() l where l.item_type = p_item_type) then
    v_reason := 'item_unavailable';
  elsif not staff_login_ok(p_employee_no, p_password) then
    v_reason := 'invalid_login';
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

  insert into loan_request (loaner_name, employee_no, department, phone, item_type, reason, start_on, end_on, requester_email)
  values (v_name, left(btrim(p_employee_no), 30), left(btrim(p_department), 100), left(btrim(p_phone), 30),
          p_item_type, btrim(p_reason), p_start_on, p_end_on, v_email)
  returning loan_id, created_at into v_id, v_at;

  return jsonb_build_object('ok', true, 'loan_id', v_id, 'created_at', v_at);
end $$;

revoke execute on function public.submit_loan_request(text, text, text, text, text, text, date, date, text, text) from public;
grant execute on function public.submit_loan_request(text, text, text, text, text, text, date, date, text, text) to anon, authenticated, service_role;
