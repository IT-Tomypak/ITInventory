-- 20261013020000_two_stage_fixes.sql
--
-- WHY: two faults in the two-stage approval migrations.
--
-- 1. 20261013000000 let assign_token.action be hod_approve / hod_reject but
--    left the used_for CHECK at the original three values, so burning a HOD
--    token failed and assignment_link() rolled the HOD's decision back.
alter table public.assign_token
  drop constraint if exists assign_token_used_for_check;
alter table public.assign_token
  add constraint assign_token_used_for_check
  check (used_for in ('allocate','assign_officer','ack','hod_approve','hod_reject'));

-- 2. 20261013010000 rewrote guard_asset_release() to treat ANY change of
--    status as a release decision. That refused allocate_asset (status ->
--    Allocated) for officers and a HOD's rejection from the email link, and it
--    dropped the "no other fields" and "name from the session" rules. This is
--    the original guard again, plus the one thing that rewrite wanted: IT's
--    decision moves status with it, set HERE so the browser sends only
--    release_status and approval_note.
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
    new.status      := new.release_status;
  end if;
  return new;
end $$;
