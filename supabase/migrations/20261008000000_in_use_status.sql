-- 20261008000000_in_use_status.sql
--
-- WHY: IT calls a held asset "In use" (2026-10-08). The status 'Assigned' is
-- renamed, not added beside it: both would mean "someone has it". Still set
-- only by custody (an open asset_assignment = a handover with a person or
-- location), so an asset cannot be In use by nobody.
--
-- ORDER: the functions are replaced BEFORE the rows are renamed. The old
-- retired_clears_holder refuses 'In use' on a held asset, so the update would
-- fail on any database that has held assets.

alter table public.assets drop constraint assets_status_check;

create or replace function public.retired_clears_holder() returns trigger
language plpgsql set search_path to 'public' as $$
declare held boolean;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  held := tg_op = 'UPDATE' and exists
    (select 1 from public.asset_assignment where asset_id = new.asset_id and returned_on is null);
  if held and new.status not in ('In use','Loaned') then
    raise exception 'Asset % is still held. Check it in on Allocate / Return before marking it %.',
      new.asset_tag, new.status using errcode = 'P0001';
  end if;
  if not held and new.status in ('In use','Loaned') then
    raise exception 'Asset % is not held by anyone. Fill in the handover to mark it In use.',
      new.asset_tag using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.sync_asset_status() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.returned_on is null then
    update assets
       set status = case when new.due_back_on is not null then 'Loaned' else 'In use' end
     where asset_id = new.asset_id
       and status is distinct from case when new.due_back_on is not null then 'Loaned' else 'In use' end;
  elsif tg_op = 'UPDATE' and old.returned_on is null then
    update assets set status = coalesce(new.return_status, 'In stock')
     where asset_id = new.asset_id;
  end if;
  return new;
end $$;

update public.assets set status = 'In use' where status = 'Assigned';
alter table public.assets add constraint assets_status_check check (status in
  ('In stock','In use','In repair','Loaned','Retired','Lost/Stolen'));
