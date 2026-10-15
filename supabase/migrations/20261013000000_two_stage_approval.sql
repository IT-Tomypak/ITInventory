-- 20261013000000_two_stage_approval.sql
--
-- WHY (2026-10-13): the equipment request flow is two-stage, not one:
--   Stage 1 -- HOD approval: the requester's own boss must endorse the need.
--              If rejected, the requester is notified and the flow stops.
--   Stage 2 -- IT HOD review: IT checks stock and decides. The custodian's
--              release_status field already models this; it is promoted to be
--              a real second stage that only activates after HOD approves.
--
-- Previously, hod/hod_email were stored on the request but nothing was done
-- with them: no email was sent to the HOD and they had no approval action.
-- This migration adds the HOD approval columns and the triggers that drive
-- both email stages. The email triggers for Stage 2 (release) already exist
-- but remain DISABLED (20261007000600_email_paused.sql); this migration adds
-- the new Stage 1 triggers in DISABLED state too. Enable all mail triggers
-- together when Resend is verified (notify_resend_api_key added to Vault):
--
--   alter table public.equipment_request enable trigger trg_notify_new_request;
--   alter table public.equipment_request enable trigger trg_notify_release;
--   alter table public.equipment_request enable trigger trg_notify_release_on_insert;
--   alter table public.equipment_request enable trigger trg_notify_hod_on_submit;
--   alter table public.equipment_request enable trigger trg_notify_hod_approved;
--   alter table public.equipment_request enable trigger trg_notify_hod_rejected;
--   alter table public.asset_assignment  enable trigger trg_notify_handover;

-- ---------------------------------------------------------------------------
-- 1. New columns on equipment_request
-- ---------------------------------------------------------------------------
alter table public.equipment_request
  add column hod_approval_status  text
    check (hod_approval_status in ('Pending','Approved','Rejected'))
    default 'Pending',
  add column hod_approved_by_name text,
  add column hod_approved_at      timestamptz,
  add column hod_approval_note    text;

-- Back-fill: existing rows without hod_email cannot go through a HOD stage,
-- so mark them Approved to avoid blocking the existing queue.
update public.equipment_request
   set hod_approval_status  = 'Approved',
       hod_approved_by_name = 'Pre-existing request',
       hod_approved_at      = created_at
 where hod_email is null or hod_email = '';

create index equipment_request_hod_status_idx
  on public.equipment_request (hod_approval_status, created_at);

-- ---------------------------------------------------------------------------
-- 2. New assign_token action values for HOD approve / reject
-- ---------------------------------------------------------------------------
alter table public.assign_token
  drop constraint if exists assign_token_action_check;
alter table public.assign_token
  add constraint assign_token_action_check
  check (action in ('allocate','assign_officer','ack','hod_approve','hod_reject'));

-- ---------------------------------------------------------------------------
-- 3. Re-declare assignment_link() with hod_approve and hod_reject branches.
--
-- The HOD taps a link in the email. Safe Links opens it first -- writes
-- nothing on GET. On confirm the HOD types their ID number (a signature, not
-- a password: deliberate act, not a mis-click). A HOD without an ITrack
-- login has no login_id; their typed number is stored in chosen_id.
-- ---------------------------------------------------------------------------
create or replace function public.assignment_link(
  p_token    text,
  p_choice   text,
  p_signature text  default null,
  p_ip        text  default null,
  p_commit    boolean default false
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
    select * into t from assign_token where token = p_token for update;
  else
    select * into t from assign_token where token = p_token;
  end if;
  if not found then
    return jsonb_build_object('ok',false,refuse,
      'This link is not valid. Check that the whole link was copied from the email.');
  end if;
  if t.used_at is not null then
    return jsonb_build_object('ok',false,refuse,format(
      'This link was already used on %s. Open the request in ITrack to see what was done.',
      to_char(t.used_at at time zone 'Asia/Kuala_Lumpur','DD Mon YYYY HH24:MI')));
  end if;
  if t.expires_at < now() then
    return jsonb_build_object('ok',false,refuse,
      'This link has expired (links in ITrack emails work for 7 days). Open the request in ITrack instead.');
  end if;
  if t.request_id is not null then
    select * into r from equipment_request where request_id = t.request_id;
  end if;

  -- allocate
  if t.action = 'allocate' then
    if r.status not in ('Requested','Approved') then
      return jsonb_build_object('ok',false,refuse,
        format('Request #%s is already %s.',r.request_id,r.status));
    end if;
    select * into s from staff where staff_id = public.request_holder(r.request_id);
    if not found then
      return jsonb_build_object('ok',false,refuse,format(
        '"%s" does not match exactly one staff record, so this request has to be allocated in ITrack.',
        r.requested_by_name));
    end if;
    if p_choice ~ '^\d+$' then select * into a from assets where asset_id = p_choice::bigint; end if;
    if a.asset_id is null or a.status <> 'In stock' or not a.active or a.asset_type <> r.asset_type then
      return jsonb_build_object('ok',false,refuse,format(
        'That asset is no longer available for this request%s.',
        case when a.asset_id is not null then format(' (%s is %s)',a.asset_tag,a.status) else '' end));
    end if;
    v_what := format('Allocate %s (%s) to %s for request #%s',a.asset_tag,
                     coalesce(nullif(concat_ws(' ',a.make,a.model),''),a.asset_type),
                     s.full_name,r.request_id);
    if s.email is not null and s.email not ilike '%@tomypak.internal' then
      v_note := format('%s will get a handover email to confirm receipt.',s.full_name);
    end if;

  -- assign_officer
  elsif t.action = 'assign_officer' then
    if r.status not in ('Requested','Approved','Allocated') then
      return jsonb_build_object('ok',false,refuse,
        format('Request #%s is already %s.',r.request_id,r.status));
    end if;
    if p_choice ~ '^\d+$' then
      select * into s from public.eligible_handlers() h where h.staff_id = p_choice::bigint;
    end if;
    if s.staff_id is null then
      return jsonb_build_object('ok',false,refuse,'That person can no longer be assigned requests.');
    end if;
    v_what := format('Make %s the handler of request #%s',s.full_name,r.request_id);

  -- ack
  elsif t.action = 'ack' then
    select * into g from asset_assignment where assignment_id = t.assignment_id;
    if not found or g.returned_on is not null then
      return jsonb_build_object('ok',false,refuse,
        'This asset has since been returned, so there is nothing to confirm.');
    end if;
    select * into a from assets where asset_id = g.asset_id;
    select * into s from staff where staff_id = g.staff_id;
    v_what := format('Confirm that %s received %s (%s)',s.full_name,a.asset_tag,
                     coalesce(nullif(concat_ws(' ',a.make,a.model),''),a.asset_type));
    if p_commit and btrim(coalesce(p_signature,'')) = '' then
      return jsonb_build_object('ok',false,refuse,'Type your ID number to confirm.');
    end if;
    if p_commit and s.login_id is not null and btrim(p_signature) <> s.login_id then
      return jsonb_build_object('ok',false,refuse,
        'That ID number does not match the person this asset was issued to.');
    end if;

  -- hod_approve: Stage 1 approval from email link.
  -- Requires ID-number signature (deliberate act). HOD without an ITrack
  -- login has no login_id; their typed number is kept in chosen_id.
  elsif t.action = 'hod_approve' then
    if r.request_id is null then
      return jsonb_build_object('ok',false,refuse,'This link is not valid.');
    end if;
    if r.hod_approval_status = 'Approved' then
      return jsonb_build_object('ok',false,refuse,
        format('Request #%s has already been approved by the HOD.',r.request_id));
    end if;
    if r.hod_approval_status = 'Rejected' then
      return jsonb_build_object('ok',false,refuse,
        format('Request #%s was already rejected. Contact IT to reopen it.',r.request_id));
    end if;
    if r.status in ('Rejected','Cancelled') then
      return jsonb_build_object('ok',false,refuse,
        format('Request #%s is already %s.',r.request_id,r.status));
    end if;
    if p_commit and btrim(coalesce(p_signature,'')) = '' then
      return jsonb_build_object('ok',false,refuse,'Type your ID number to endorse this approval.');
    end if;
    v_what := format('Approve the equipment request #%s from %s (%s)',
                     r.request_id,r.requested_by_name,r.department);
    v_note := 'IT will be notified to complete the secondary review.';

  -- hod_reject: Stage 1 rejection from email link.
  -- p_choice carries the HOD''s rejection note (sent from the /assign page form).
  elsif t.action = 'hod_reject' then
    if r.request_id is null then
      return jsonb_build_object('ok',false,refuse,'This link is not valid.');
    end if;
    if r.hod_approval_status <> 'Pending' then
      return jsonb_build_object('ok',false,refuse,
        format('Request #%s has already been %s by the HOD.',
               r.request_id,lower(r.hod_approval_status)));
    end if;
    if r.status in ('Rejected','Cancelled') then
      return jsonb_build_object('ok',false,refuse,
        format('Request #%s is already %s.',r.request_id,r.status));
    end if;
    if p_commit and btrim(coalesce(p_signature,'')) = '' then
      return jsonb_build_object('ok',false,refuse,'Type your ID number to sign the rejection.');
    end if;
    v_what := format('Reject the equipment request #%s from %s (%s)',
                     r.request_id,r.requested_by_name,r.department);
    v_note := 'The requester will be notified by email.';

  else
    return jsonb_build_object('ok',false,refuse,'This link is not valid.');
  end if;

  if not p_commit then
    return jsonb_build_object('ok',true,'action',t.action,'what',v_what,'note',v_note);
  end if;

  begin
    perform set_config('request.jwt.claims',
      jsonb_build_object('role','service_role',
        'user_metadata',jsonb_build_object('full_name','Email link'))::text, true);

    if t.action = 'allocate' then
      perform public.allocate_asset(r.request_id,a.asset_id,s.staff_id);

    elsif t.action = 'assign_officer' then
      update equipment_request set handled_by = s.staff_id where request_id = r.request_id;

    elsif t.action = 'ack' then
      update asset_assignment set ack_at = now(), ack_by_name = s.full_name
       where assignment_id = g.assignment_id;
      update equipment_request set ack_at = now(), ack_by_name = s.full_name
       where request_id = g.request_id;

    elsif t.action = 'hod_approve' then
      -- trg_notify_hod_approved fires on this UPDATE to send the IT email.
      update equipment_request
         set hod_approval_status  = 'Approved',
             release_status       = coalesce(release_status, 'Pending'),
             hod_approved_by_name = coalesce(
               (select full_name from staff
                 where login_id = btrim(p_signature) limit 1),
               btrim(p_signature)
             ),
             hod_approved_at = now()
       where request_id = r.request_id;

    elsif t.action = 'hod_reject' then
      -- trg_notify_hod_rejected fires on this UPDATE to send the requester email.
      -- p_choice holds the HOD's note (passed from the /assign page textarea).
      update equipment_request
         set hod_approval_status  = 'Rejected',
             status               = 'Rejected',
             hod_approved_by_name = coalesce(
               (select full_name from staff
                 where login_id = btrim(p_signature) limit 1),
               btrim(p_signature)
             ),
             hod_approved_at   = now(),
             hod_approval_note = nullif(btrim(coalesce(p_choice,'')), '')
       where request_id = r.request_id;
    end if;

    update assign_token
       set used_at  = now(),
           used_for = t.action,
           chosen_id = case when t.action in ('ack','hod_approve','hod_reject')
                            then btrim(p_signature)
                            else p_choice end,
           used_ip  = p_ip
     where token = p_token;

  exception when others then
    return jsonb_build_object('ok',false,refuse,sqlerrm);
  end;
  return jsonb_build_object('ok',true,'done',true,'action',t.action,
                             'what',v_what,'note',v_note);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Extend notify_trigger() for the three new kinds.
-- ---------------------------------------------------------------------------
create or replace function public.notify_trigger() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_email text;
  v_login text;
begin
  if tg_argv[0] = 'handover' then
    if new.staff_id is null or new.returned_on is not null then return null; end if;
    select email, login_id into v_email, v_login from staff where staff_id = new.staff_id;
    if v_email is null or v_email ilike '%@tomypak.internal' then return null; end if;
    if v_login is not null and v_login =
       (select split_part(email,'@',1) from auth.users where id = new.issued_by) then
      return null;
    end if;
    perform notify_post(jsonb_build_object('kind','handover',
                                           'assignment_id',new.assignment_id,
                                           'issued_by_name',current_actor_name()));

  elsif tg_argv[0] = 'release' then
    perform notify_post(jsonb_build_object('kind','release',
                                           'request_id',new.request_id,
                                           'mode',lower(new.release_status)));

  elsif tg_argv[0] = 'hod_request' then
    -- Only send when hod_email is present on the row.
    if new.hod_email is null or new.hod_email = '' then return null; end if;
    perform notify_post(jsonb_build_object('kind','hod_request',
                                           'request_id',new.request_id));

  elsif tg_argv[0] = 'hod_approved' then
    -- Stage 1 passed; notify IT for Stage 2.
    if new.hod_email is null or new.hod_email = '' then return null; end if;
    perform notify_post(jsonb_build_object('kind','it_review',
                                           'request_id',new.request_id));

  elsif tg_argv[0] = 'hod_rejected' then
    -- Stage 1 failed; notify requester.
    if new.requester_email is null or new.requester_email = '' then return null; end if;
    perform notify_post(jsonb_build_object('kind','hod_rejected',
                                           'request_id',new.request_id));

  else  -- new_request | receipt
    perform notify_post(jsonb_build_object('kind',tg_argv[0],
                                           'request_id',new.request_id));
  end if;
  return null;
end $$;

-- Stage 1: HOD email on submit. Drop the legacy direct-to-IT trigger so IT
-- does NOT get emailed upon submission. IT only gets emailed in Stage 2.
drop trigger if exists trg_notify_new_request on public.equipment_request;
drop trigger if exists trg_notify_hod_on_submit on public.equipment_request;
create trigger trg_notify_hod_on_submit
  after insert on public.equipment_request
  for each row
  when (new.status = 'Requested' and new.hod_email is not null and new.hod_email <> '')
  execute function public.notify_trigger('hod_request');

-- IT email after HOD approves (Stage 2 kick-off).
create trigger trg_notify_hod_approved
  after update of hod_approval_status on public.equipment_request
  for each row
  when (new.hod_approval_status = 'Approved'
        and old.hod_approval_status is distinct from 'Approved')
  execute function public.notify_trigger('hod_approved');

-- Requester email when HOD rejects.
create trigger trg_notify_hod_rejected
  after update of hod_approval_status on public.equipment_request
  for each row
  when (new.hod_approval_status = 'Rejected'
        and old.hod_approval_status is distinct from 'Rejected')
  execute function public.notify_trigger('hod_rejected');

-- Disabled immediately: enable with the other mail triggers when Resend is live.
alter table public.equipment_request disable trigger trg_notify_hod_on_submit;
alter table public.equipment_request disable trigger trg_notify_hod_approved;
alter table public.equipment_request disable trigger trg_notify_hod_rejected;

-- ---------------------------------------------------------------------------
-- 5. Update check_request_status() so /status shows both approval stages.
-- ---------------------------------------------------------------------------
drop function if exists public.check_request_status(bigint);

create function public.check_request_status(p_request_id bigint)
returns table (
  request_id           bigint,
  status               text,
  asset_type           text,
  urgency              text,
  created_at           timestamptz,
  hod_approval_status  text,
  hod_approved_by_name text,
  hod_approved_at      timestamptz,
  hod_approval_note    text,
  release_status       text,
  approved_at          timestamptz,
  allocated            boolean,
  delivered_at         timestamptz,
  ack_at               timestamptz
)
language sql stable security definer set search_path to 'public' as $$
  select r.request_id,
         r.status,
         coalesce(r.services, r.asset_type::text),
         r.urgency,
         r.created_at,
         r.hod_approval_status,
         r.hod_approved_by_name,
         r.hod_approved_at,
         r.hod_approval_note,
         r.release_status,
         r.approved_at,
         r.asset_id is not null,
         r.delivered_at,
         r.ack_at
    from equipment_request r
   where r.request_id = p_request_id
$$;

revoke execute on function public.check_request_status(bigint) from public;
grant execute on function public.check_request_status(bigint) to anon, authenticated, service_role;
