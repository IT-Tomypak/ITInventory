-- 20261006000200_requests.sql
--
-- WHY: the two things an anonymous visitor may do (brief §5.5), and nothing
-- else. The public /request form is open BY DESIGN — staff without an ITrack
-- login must be able to ask for hardware — so rate limiting, not
-- authentication, is what protects it.
--
-- Deviation from the brief's signature: submit_equipment_request returns
-- jsonb ({ok, request_id, created_at} or {ok:false, reason}) instead of a
-- bare bigint. Every attempt — refusals included — must be logged, and a
-- refusal that RAISEs rolls back its own log row. Returning the refusal
-- keeps the row, and the refusals are the valuable rows.

create or replace function public.submit_equipment_request(
  p_name text, p_department text, p_asset_type text,
  p_justification text, p_urgency text, p_attachment text
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
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

  -- Sliding one-hour window over ACCEPTED submissions: refusals do not extend
  -- anyone's lock-out.
  if v_name = '' or btrim(coalesce(p_department, '')) = '' then
    v_reason := 'missing_fields';
  elsif p_asset_type is null or p_asset_type not in
        ('Laptop','Desktop','Monitor','Printer','Network','Server','Phone','Tablet','Peripheral','Other') then
    v_reason := 'invalid_asset_type';
  elsif coalesce(p_urgency, 'Normal') not in ('Normal', 'Urgent') then
    v_reason := 'invalid_urgency';
  elsif length(coalesce(p_justification, '')) > 2000 then
    v_reason := 'justification_too_long';
  elsif cardinality(v_photos) > 4 or exists (
          select 1 from unnest(v_photos) u
          where u !~ '^https://[^/\s]+/storage/v1/object/public/attachments/requests/[^\s]+$') then
    -- Only links into our own bucket's requests/ folder, so the notification
    -- email cannot be made to embed an arbitrary third-party URL.
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

  insert into equipment_request (requested_by_name, department, asset_type, justification, urgency, attachment_path)
  values (v_name, left(btrim(p_department), 100), p_asset_type, nullif(btrim(p_justification), ''),
          coalesce(p_urgency, 'Normal'), nullif(array_to_string(v_photos, E'\n'), ''))
  returning request_id, created_at into v_id, v_at;

  return jsonb_build_object('ok', true, 'request_id', v_id, 'created_at', v_at);
end $$;

-- Request number in, status out. Takes the number ONLY: a name-plus-number
-- version was tried and removed — requesters mistyped their own name, the
-- lookup failed, and they re-submitted instead, which is worse than a
-- guessable id for data this bland. Never returns the holder, a cost, a note
-- or anyone's name.
create or replace function public.check_request_status(p_request_id bigint)
returns table (request_id bigint, status text, asset_type text, urgency text, created_at timestamptz,
               release_status text, approved_at timestamptz, allocated boolean,
               delivered_at timestamptz, ack_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select r.request_id, r.status, r.asset_type::text, r.urgency, r.created_at,
         r.release_status, r.approved_at, r.asset_id is not null, r.delivered_at, r.ack_at
    from equipment_request r
   where r.request_id = p_request_id
$$;

revoke execute on function public.submit_equipment_request(text, text, text, text, text, text) from public;
revoke execute on function public.check_request_status(bigint) from public;
grant execute on function public.submit_equipment_request(text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.check_request_status(bigint) to anon, authenticated, service_role;

-- Admins may read the submission log (who was refused, when, from where);
-- nobody writes it except submit_equipment_request().
create policy "admin read" on public.request_submission_log for select to authenticated using (public.is_admin());
