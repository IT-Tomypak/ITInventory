-- 20261012050000_request_email_and_hods.sql
--
-- WHY (2026-10-12): for the request emails (still switched off, see
-- 20261007000600_email_paused). The requester gives their own email so
-- progress mail can reach them, and picks their HOD from IT's list so the
-- approval mail has an address to go to.
--
-- The public form is open to the internet, so it is given the HODs' NAMES
-- only (hod_names()). The email is paired here, in the database, at submit.

create table public.hod (
  hod_id bigserial primary key,
  name   text not null unique,
  email  text not null,
  active boolean not null default true
);
alter table public.hod enable row level security;
create policy "read for authenticated" on public.hod for select to authenticated using (true);
create policy "write for admins" on public.hod for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.hod from anon;
grant select, insert, update, delete on public.hod to authenticated, service_role;
grant usage, select on sequence public.hod_hod_id_seq to authenticated, service_role;

-- IT's list, as given.
insert into public.hod (name, email) values
  ('Alif TEST', 'alifteoh@tomypak.com.my'),
  ('Tan See Yin', 'tansy@tomypak.com.my'),
  ('Tok Fu Soon', 'fstok@tomypak.com.my'),
  ('Nor Suzila binti Salem', 'suzila@tomypak.com.my'),
  ('Benjamin Low', 'benjamin@tomypak.com.my'),
  ('Mohd Ariff bin Daud', 'mariff.daud@tomypak.com.my'),
  ('Chen Yi Hwai', 'chenyh@tomypak.com.my'),
  ('Muhamad Saiful Syazuwan bin Rahman', 'msaiful.syazuwan@tomypak.com.my'),
  ('Sukeertha binti Ravi Raveendran', 'sukeertha@tomypak.com.my'),
  ('Muhammad Basyar bin Ramli', 'basyar@tomypak.com.my'),
  ('Nurul Izaan binti Abdullah Halid', 'izaan@tomypak.com.my'),
  ('Nur Amalina binti Abdullah Sani', 'amalina@tomypak.com.my'),
  ('Nur Faezah binti Abdul Majid', 'faezahm@tomypak.com.my'),
  ('Siti Najwa binti Ahmad', 'siti.najwa@tomypak.com.my'),
  ('Liew Sai Wah', 'swliew@tomypak.com.my'),
  ('Chloe Lee Fui Ling', 'chloelee@tomypak.com.my'),
  ('Atty Affiza binti Zainal', 'atty@tomypak.com.my'),
  ('Raudah binti Samian', 'raudah@tomypak.com.my'),
  ('Shahiran bin Abdul Sofi', 'shahiran@tomypak.com.my'),
  ('Yusmadi bin Ahmad', 'yusmadi.ahmad@tomypak.com.my');

create function public.hod_names() returns setof text
language sql stable security definer set search_path to 'public' as $$
  select name from hod where active order by name
$$;
revoke execute on function public.hod_names() from public;
grant execute on function public.hod_names() to anon, authenticated, service_role;

alter table public.equipment_request
  add column requester_email text,
  add column hod_email       text;

-- One more defaulted parameter, so the nine-argument function goes (a
-- defaulted overload beside it would be ambiguous to PostgREST).
drop function public.submit_equipment_request(text, text, text, text, text, text, text, text, text[]);

create function public.submit_equipment_request(
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
  v_hod    hod%rowtype;
  v_reason text;
  v_photos text[];
  v_id     bigint;
  v_at     timestamptz;
begin
  -- Serialise submissions so two at once cannot both slip under a limit.
  perform pg_advisory_xact_lock(hashtext('submit_equipment_request'));

  v_photos := array_remove(regexp_split_to_array(coalesce(btrim(p_attachment), ''), '\s*\n\s*'), '');
  select * into v_hod from hod where active and lower(name) = lower(btrim(coalesce(p_hod, '')));

  if v_name = '' or btrim(coalesce(p_department, '')) = '' then
    v_reason := 'missing_fields';
  -- ponytail: p_services / p_email null = a page built before that field
  -- existed, which cannot send it; it is held to the rules of its day. Make
  -- the four parameters required once no such page is in use.
  elsif p_services is not null and (btrim(coalesce(p_employee_no, '')) = '' or btrim(coalesce(p_hod, '')) = ''
                                    or cardinality(p_services) = 0) then
    v_reason := 'missing_fields';
  elsif p_services is not null and not (p_services <@ v_types) then
    v_reason := 'invalid_asset_type';
  elsif p_services is null and (p_asset_type is null or p_asset_type <> all (v_types)) then
    v_reason := 'invalid_asset_type';
  elsif p_email is not null and (length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    v_reason := 'invalid_email';
  elsif p_email is not null and v_hod.hod_id is null then
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
          -- The list's own spelling when the HOD is on it; what was typed otherwise (older pages).
          coalesce(v_hod.name, nullif(left(btrim(p_hod), 100), '')), array_to_string(p_services, ', '),
          nullif(v_email, ''), v_hod.email)
  returning request_id, created_at into v_id, v_at;

  return jsonb_build_object('ok', true, 'request_id', v_id, 'created_at', v_at);
end $$;

revoke execute on function public.submit_equipment_request(text, text, text, text, text, text, text, text, text[], text) from public;
grant execute on function public.submit_equipment_request(text, text, text, text, text, text, text, text, text[], text) to anon, authenticated, service_role;
