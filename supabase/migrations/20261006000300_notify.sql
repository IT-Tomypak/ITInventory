-- 20261006000300_notify.sql
--
-- WHY: phase 6, email. The database decides WHEN a message is due (triggers);
-- one Edge Function, `notify`, decides WHAT it says and sends it through
-- Microsoft Graph from the company's own mailbox. Graph, not Resend: Tomypak
-- is on Microsoft 365, so the mail is internal (no Exchange quarantine rule to
-- except, no new vendor, no DNS records), and SMTP is impossible from an Edge
-- Function (ports 25/465/587 are blocked).
--
-- Deviations from the brief, each for a reason:
--   * ONE function `notify` (kind = new_request | release | handover | receipt)
--     instead of four. The brief duplicated logSend per function so each could
--     deploy alone; with one function there is nothing to keep in step.
--   * assign_token gains `action` (fixed when the link is minted) and
--     `assignment_id` (the handover acknowledgement is about an assignment,
--     which need not have a request).
--   * asset_assignment gains ack_at / ack_by_name for the same reason. The
--     request's own ack_at is still written when there is one (/status shows it).
--
-- Secrets live in Supabase Vault (names in get_notify_config below), never in
-- a function body: a literal in a body is readable by anyone who can read
-- pg_proc. Rotation is one vault.update_secret(), no redeploy.

create extension if not exists pg_net with schema extensions;  -- not public: the linter flags it, and its functions live in schema net either way

alter table public.assign_token
  add column action        text check (action in ('allocate','assign_officer','ack')),
  add column assignment_id bigint references public.asset_assignment on delete cascade;
alter table public.asset_assignment
  add column ack_at      timestamptz,
  add column ack_by_name text;

-- ---------------------------------------------------------------------------
-- Vault reads. service_role only.
-- ---------------------------------------------------------------------------
-- Every secret named notify_*: notify_webhook_secret, notify_graph_tenant_id,
-- notify_graph_client_id, notify_graph_client_secret, notify_from (the
-- sending mailbox), notify_app_url (https://<site>, where links point).
create or replace function public.get_notify_config() returns jsonb
language sql stable security definer set search_path to 'public', 'vault' as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}')
    from vault.decrypted_secrets where name like 'notify\_%'
$$;

create or replace function public.notify_secret() returns text
language sql stable security definer set search_path to 'public', 'vault' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'notify_webhook_secret'
$$;

-- ---------------------------------------------------------------------------
-- The one place the database calls the notify function. Three invariants:
--   * timeout 20 s: the default 5 s loses the response on a cold start (the
--     mail still sends, but every trace of it is gone);
--   * every exception swallowed: a request is always saved, email is best effort;
--   * pg_net is async and only sends after COMMIT, so a rolled-back insert
--     mails nobody. Responses land in net._http_response (self-pruning).
-- ---------------------------------------------------------------------------
create or replace function public.notify_post(p_body jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform net.http_post(
    url := 'https://rpstyfeigkamftwlkcjf.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-webhook-secret', public.notify_secret()),
    body := p_body,
    timeout_milliseconds := 20000);
exception when others then
  null;  -- the row is always saved; the email is best effort
end $$;

-- Trigger body shared by every notification trigger; TG_ARGV[0] is the kind.
create or replace function public.notify_trigger() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_email text;
  v_login text;
begin
  if tg_argv[0] = 'handover' then
    -- Silent unless the holder is a person with a real mailbox. The internal
    -- login domain receives nothing.
    if new.staff_id is null or new.returned_on is not null then return null; end if;
    select email, login_id into v_email, v_login from staff where staff_id = new.staff_id;
    if v_email is null or v_email ilike '%@tomypak.internal' then return null; end if;
    -- Silent when an officer issues an asset to themselves. A notification
    -- that fires on everything gets muted, and then the ones that matter go too.
    if v_login is not null and v_login =
       (select split_part(email, '@', 1) from auth.users where id = new.issued_by) then
      return null;
    end if;
    perform notify_post(jsonb_build_object('kind', 'handover', 'assignment_id', new.assignment_id,
                                           'issued_by_name', current_actor_name()));
  elsif tg_argv[0] = 'release' then
    perform notify_post(jsonb_build_object('kind', 'release', 'request_id', new.request_id,
                                           'mode', lower(new.release_status)));
  else  -- new_request | receipt
    perform notify_post(jsonb_build_object('kind', tg_argv[0], 'request_id', new.request_id));
  end if;
  return null;
end $$;

create trigger trg_archive_request_receipt after insert on public.equipment_request
  for each row when (new.status = 'Requested') execute function public.notify_trigger('receipt');
create trigger trg_notify_new_request after insert on public.equipment_request
  for each row when (new.status = 'Requested') execute function public.notify_trigger('new_request');
create trigger trg_notify_release after update of release_status on public.equipment_request
  for each row when (new.release_status is distinct from old.release_status and new.release_status is not null)
  execute function public.notify_trigger('release');
-- A request keyed in by the custodian already approved never passes through an UPDATE.
create trigger trg_notify_release_on_insert after insert on public.equipment_request
  for each row when (new.release_status = 'Approved') execute function public.notify_trigger('release');
-- INSERT only: editing any field of an assignment later must not re-send.
create trigger trg_notify_handover after insert on public.asset_assignment
  for each row execute function public.notify_trigger('handover');

-- ---------------------------------------------------------------------------
-- Who may be made the handler of a request. ONE rule, used by the email
-- buttons and re-checked when a button is pressed: a person with a login, and
-- either explicitly eligible, or (eligible IS NULL) in the IT department.
-- An explicit false always wins.
-- ---------------------------------------------------------------------------
create or replace function public.eligible_handlers() returns setof public.staff
language sql stable set search_path to 'public' as $$
  select * from staff
   where login_id is not null
     and coalesce(eligible, department ~* '^\s*(it|information technology)\M')
   order by full_name
$$;

-- The staff record a request is for. requested_by_name is free text from the
-- public form, so only an exact (case-insensitive) single match counts; no
-- match or two matches means "allocate in the app", never a guess.
create or replace function public.request_holder(p_request_id bigint) returns bigint
language sql stable set search_path to 'public' as $$
  select case when count(*) = 1 then min(s.staff_id) end
    from equipment_request r
    join staff s on lower(btrim(s.full_name)) = lower(btrim(r.requested_by_name))
   where r.request_id = p_request_id
$$;

-- ---------------------------------------------------------------------------
-- Action links in emails. The token is a BEARER credential: anyone holding
-- the email can use it. Acceptable because it is single use, expires in 7
-- days, is scoped to one request (or assignment) and one action, and every
-- action it allows is reversible in the app. Do NOT add anything destructive.
-- ---------------------------------------------------------------------------
create or replace function public.create_assignment_link(
  p_request_id bigint, p_action text, p_assignment_id bigint default null
) returns text
language plpgsql security definer set search_path to 'public' as $$
declare v_token text;
begin
  -- The notify function (service role), or an administrator (check-assign.mjs).
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'Administrators only.' using errcode = '42501';
  end if;
  insert into assign_token (request_id, action, assignment_id)
  values (p_request_id, p_action, p_assignment_id) returning token into v_token;
  return v_token;
end $$;

-- Preview (p_commit = false) and act (p_commit = true) share every check, so
-- what the page shows is exactly what the press will do. The preview writes
-- NOTHING: Microsoft 365 Safe Links opens every link in an incoming message
-- before a human does.
create or replace function public.assignment_link(
  p_token text, p_choice text, p_signature text default null, p_ip text default null,
  p_commit boolean default false
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  t      assign_token%rowtype;
  r      equipment_request%rowtype;
  a      assets%rowtype;
  s      staff%rowtype;
  g      asset_assignment%rowtype;
  v_what text;
  v_note text;
  refuse constant text := 'reason';
begin
  if p_commit then
    -- Locks the token: two presses at once queue here, and the second sees used_at.
    select * into t from assign_token where token = p_token for update;
  else
    select * into t from assign_token where token = p_token;
  end if;
  if not found then
    return jsonb_build_object('ok', false, refuse, 'This link is not valid. Check that the whole link was copied from the email.');
  end if;
  if t.used_at is not null then
    return jsonb_build_object('ok', false, refuse, format('This link was already used on %s. Open the request in ITrack to see what was done.',
      to_char(t.used_at at time zone 'Asia/Kuala_Lumpur', 'DD Mon YYYY HH24:MI')));
  end if;
  if t.expires_at < now() then
    return jsonb_build_object('ok', false, refuse, 'This link has expired (links in ITrack emails work for 7 days). Open the request in ITrack instead.');
  end if;
  if t.request_id is not null then
    select * into r from equipment_request where request_id = t.request_id;
  end if;

  if t.action = 'allocate' then
    if r.status not in ('Requested', 'Approved') then
      return jsonb_build_object('ok', false, refuse, format('Request #%s is already %s.', r.request_id, r.status));
    end if;
    select * into s from staff where staff_id = public.request_holder(r.request_id);
    if not found then
      return jsonb_build_object('ok', false, refuse, format('"%s" does not match exactly one staff record, so this request has to be allocated in ITrack.', r.requested_by_name));
    end if;
    if p_choice ~ '^\d+$' then select * into a from assets where asset_id = p_choice::bigint; end if;
    if a.asset_id is null or a.status <> 'In stock' or not a.active or a.asset_type <> r.asset_type then
      return jsonb_build_object('ok', false, refuse, format('That asset is no longer available for this request%s.',
        case when a.asset_id is not null then format(' (%s is %s)', a.asset_tag, a.status) else '' end));
    end if;
    v_what := format('Allocate %s (%s) to %s for request #%s', a.asset_tag,
                     coalesce(nullif(concat_ws(' ', a.make, a.model), ''), a.asset_type), s.full_name, r.request_id);
    if s.email is not null and s.email not ilike '%@tomypak.internal' then
      v_note := format('%s will get a handover email to confirm receipt.', s.full_name);
    end if;

  elsif t.action = 'assign_officer' then
    if r.status not in ('Requested', 'Approved', 'Allocated') then
      return jsonb_build_object('ok', false, refuse, format('Request #%s is already %s.', r.request_id, r.status));
    end if;
    if p_choice ~ '^\d+$' then select * into s from public.eligible_handlers() h where h.staff_id = p_choice::bigint; end if;
    if s.staff_id is null then
      return jsonb_build_object('ok', false, refuse, 'That person can no longer be assigned requests.');
    end if;
    v_what := format('Make %s the handler of request #%s', s.full_name, r.request_id);

  elsif t.action = 'ack' then
    select * into g from asset_assignment where assignment_id = t.assignment_id;
    if not found or g.returned_on is not null then
      return jsonb_build_object('ok', false, refuse, 'This asset has since been returned, so there is nothing to confirm.');
    end if;
    select * into a from assets where asset_id = g.asset_id;
    select * into s from staff where staff_id = g.staff_id;
    v_what := format('Confirm that %s received %s (%s)', s.full_name, a.asset_tag,
                     coalesce(nullif(concat_ws(' ', a.make, a.model), ''), a.asset_type));
    -- Retyping one's ID number is a signature, not a password: it makes the
    -- confirmation a deliberate act by the holder, not by whoever opened the mail.
    -- A holder with no login has no ID number on file; their typed one is kept
    -- in chosen_id as the record of who confirmed.
    if p_commit and btrim(coalesce(p_signature, '')) = '' then
      return jsonb_build_object('ok', false, refuse, 'Type your ID number to confirm.');
    end if;
    if p_commit and s.login_id is not null and btrim(p_signature) <> s.login_id then
      return jsonb_build_object('ok', false, refuse, 'That ID number does not match the person this asset was issued to.');
    end if;
  else
    return jsonb_build_object('ok', false, refuse, 'This link is not valid.');
  end if;

  if not p_commit then
    return jsonb_build_object('ok', true, 'action', t.action, 'what', v_what);
  end if;

  begin
    -- Audit rows written below name "Email link" instead of "service_role".
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role',
      'user_metadata', jsonb_build_object('full_name', 'Email link'))::text, true);
    if t.action = 'allocate' then
      perform public.allocate_asset(r.request_id, a.asset_id, s.staff_id);
    elsif t.action = 'assign_officer' then
      update equipment_request set handled_by = s.staff_id where request_id = r.request_id;
    else
      update asset_assignment set ack_at = now(), ack_by_name = s.full_name where assignment_id = g.assignment_id;
      update equipment_request set ack_at = now(), ack_by_name = s.full_name where request_id = g.request_id;
    end if;
    update assign_token set used_at = now(), used_for = t.action,
           chosen_id = case when t.action = 'ack' then btrim(p_signature) else p_choice end, used_ip = p_ip
     where token = p_token;
  exception when others then
    -- Rolls back to the block start: nothing written, the link still works.
    return jsonb_build_object('ok', false, refuse, sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'done', true, 'action', t.action, 'what', v_what, 'note', v_note);
end $$;

revoke execute on function public.get_notify_config() from public, anon, authenticated;
revoke execute on function public.notify_secret() from public, anon, authenticated;
revoke execute on function public.notify_post(jsonb) from public, anon, authenticated;
revoke execute on function public.notify_trigger() from public, anon, authenticated;  -- triggers still fire: EXECUTE is checked only at CREATE TRIGGER
revoke execute on function public.assignment_link(text, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.create_assignment_link(bigint, text, bigint) from public, anon;
revoke execute on function public.eligible_handlers() from public, anon;
revoke execute on function public.request_holder(bigint) from public, anon;
grant execute on function public.get_notify_config() to service_role;
grant execute on function public.notify_secret() to service_role;
grant execute on function public.assignment_link(text, text, text, text, boolean) to service_role;
grant execute on function public.create_assignment_link(bigint, text, bigint) to authenticated, service_role;
grant execute on function public.eligible_handlers() to authenticated, service_role;
grant execute on function public.request_holder(bigint) to authenticated, service_role;
