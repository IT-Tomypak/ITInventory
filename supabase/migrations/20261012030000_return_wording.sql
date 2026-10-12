-- 20261012030000_return_wording.sql
--
-- WHY: the Allocate / Return page now says Handover and Return instead of
-- Check out and Check in (2026-10-12). The one database message that used the
-- old word follows. Logic unchanged from 20261008000000_in_use_status.

create or replace function public.retired_clears_holder() returns trigger
language plpgsql set search_path to 'public' as $$
declare held boolean;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  held := tg_op = 'UPDATE' and exists
    (select 1 from public.asset_assignment where asset_id = new.asset_id and returned_on is null);
  if held and new.status not in ('In use','Loaned') then
    raise exception 'Asset % is still held. Return it on Allocate / Return before marking it %.',
      new.asset_tag, new.status using errcode = 'P0001';
  end if;
  if not held and new.status in ('In use','Loaned') then
    raise exception 'Asset % is not held by anyone. Fill in the handover to mark it In use.',
      new.asset_tag using errcode = 'P0001';
  end if;
  return new;
end $$;
