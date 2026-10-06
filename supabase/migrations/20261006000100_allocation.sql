-- 20261006000100_allocation.sql
--
-- WHY: check-out and check-in must each be ONE atomic database call, not a
-- sequence of client writes. A browser that dies between "insert assignment"
-- and "mark request Allocated" leaves the register and the request queue
-- disagreeing, and two officers allocating the same laptop at the same moment
-- is a race only the database can settle.
--
-- These are FUNCTIONS, not triggers: an administrator correcting a typo on an
-- assignment row must not mint a second allocation as a side effect.
--
-- Also adds assignment_value, the snapshot of what an asset was worth when it
-- was issued. History must not change when someone corrects a purchase cost
-- tomorrow, so /value reports from this snapshot rather than re-joining the
-- asset. It is a separate admin-read table for the same reason asset_value is:
-- asset_assignment is readable by every login, and money is not.

create table public.assignment_value (
  assignment_id bigint primary key references public.asset_assignment on delete cascade,
  cost_rm       numeric(12,2),
  book_value_rm numeric(12,2)
);
alter table public.assignment_value enable row level security;
-- Admin read; NO write policy. Rows arrive only through allocate_asset().
create policy "admin read" on public.assignment_value for select to authenticated using (public.is_admin());
revoke all on public.assignment_value from anon;

-- Who may move custody: any signed-in non-viewer, or the service role (the
-- email /assign flow in phase 6). These functions are SECURITY DEFINER (they
-- write assignment_value, which has no write policy), so RLS does not apply
-- inside them and this check IS the access rule. Keep it the first statement.
create or replace function public.assert_can_move_custody() returns void
language plpgsql stable set search_path to 'public' as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') or public.is_viewer() then
    raise exception 'Your access level cannot issue or return assets.' using errcode = '42501';
  end if;
end $$;

-- Check out. Returns the new assignment_id.
create or replace function public.allocate_asset(
  p_request_id    bigint,
  p_asset_id      bigint,
  p_staff_id      bigint default null,
  p_location_id   bigint default null,
  p_issued_on     date   default current_date,
  p_due_back_on   date   default null,
  p_condition_out text   default 'Good',
  p_notes_out     text   default null
) returns bigint
language plpgsql security definer set search_path to 'public' as $$
declare
  a      assets%rowtype;
  r      equipment_request%rowtype;
  cost   numeric;
  new_id bigint;
begin
  -- 1. Refuse viewers FIRST, before reading anything, so the error cannot be
  --    used to probe which asset ids exist.
  perform public.assert_can_move_custody();

  if p_staff_id is null and p_location_id is null then
    raise exception 'Choose a person or a location to hold the asset.' using errcode = '22023';
  end if;
  if p_due_back_on is not null and p_due_back_on < coalesce(p_issued_on, current_date) then
    raise exception 'The due-back date is before the issue date.' using errcode = '22023';
  end if;

  -- 2. Lock the asset row. A concurrent allocation of the same asset waits
  --    here, then sees the status the first one set.
  select * into a from assets where asset_id = p_asset_id for update;
  if not found then
    raise exception 'Asset % does not exist.', p_asset_id using errcode = 'P0002';
  end if;

  -- 3. Only stock can be issued, and the message says why not.
  if a.status <> 'In stock' then
    raise exception 'Asset % is % — only In stock assets can be issued.', a.asset_tag, a.status using errcode = 'P0001';
  end if;
  if not a.active then
    raise exception 'Asset % is marked inactive.', a.asset_tag using errcode = 'P0001';
  end if;

  if p_request_id is not null then
    select * into r from equipment_request where request_id = p_request_id for update;
    if not found then
      raise exception 'Request #% does not exist.', p_request_id using errcode = 'P0002';
    end if;
    if r.status not in ('Requested', 'Approved') then
      raise exception 'Request #% is already %.', p_request_id, r.status using errcode = 'P0001';
    end if;
  end if;

  -- 4. The partial unique index uq_assignment_open is the real double-issue
  --    guard; the FOR UPDATE above just turns most races into a clear message.
  begin
    insert into asset_assignment (asset_id, staff_id, location_id, request_id, issued_on,
                                  due_back_on, condition_out, notes_out)
    values (p_asset_id, p_staff_id, p_location_id, p_request_id, coalesce(p_issued_on, current_date),
            p_due_back_on, p_condition_out, nullif(btrim(p_notes_out), ''))
    returning assignment_id into new_id;
  exception when unique_violation then
    raise exception 'Asset % has just been issued by someone else.', a.asset_tag using errcode = '23505';
  end;

  -- 5. Close the loop on the request.
  if p_request_id is not null then
    update equipment_request set status = 'Allocated', asset_id = p_asset_id where request_id = p_request_id;
  end if;

  -- 6. Snapshot the value at issue. Never re-join assets for historical
  --    figures: the cost can be corrected tomorrow and history must not move.
  select purchase_cost_rm into cost from asset_value where asset_id = p_asset_id;
  insert into assignment_value (assignment_id, cost_rm, book_value_rm)
  values (new_id, cost,
    case
      when cost is null then null
      when a.purchase_date is null or coalesce(a.refresh_years, 0) <= 0 then cost
      else round(cost * greatest(0, 1 - ((coalesce(p_issued_on, current_date) - a.purchase_date) / 365.25)
                                         / a.refresh_years), 2)
    end);

  return new_id;
end $$;

-- Check in. Closes the open assignment; trg_sync_asset_status then puts the
-- asset back to In stock or In repair. Returns the closed assignment_id.
create or replace function public.return_asset(
  p_asset_id      bigint,
  p_returned_on   date default current_date,
  p_condition_in  text default 'Good',
  p_notes_in      text default null,
  p_return_status text default 'In stock'
) returns bigint
language plpgsql security definer set search_path to 'public' as $$
declare
  open_row asset_assignment%rowtype;
begin
  perform public.assert_can_move_custody();

  if p_return_status not in ('In stock', 'In repair') then
    raise exception 'A returned asset goes back In stock or In repair.' using errcode = '22023';
  end if;

  select * into open_row from asset_assignment
   where asset_id = p_asset_id and returned_on is null for update;
  if not found then
    raise exception 'That asset is not currently held by anyone.' using errcode = 'P0002';
  end if;
  if coalesce(p_returned_on, current_date) < open_row.issued_on then
    raise exception 'The return date is before the issue date (%).', open_row.issued_on using errcode = '22023';
  end if;

  update asset_assignment
     set returned_on   = coalesce(p_returned_on, current_date),
         condition_in  = p_condition_in,
         notes_in      = nullif(btrim(p_notes_in), ''),
         return_status = p_return_status
   where assignment_id = open_row.assignment_id;

  return open_row.assignment_id;
end $$;

revoke execute on function public.assert_can_move_custody() from public, anon;
revoke execute on function public.allocate_asset(bigint, bigint, bigint, bigint, date, date, text, text) from public, anon;
revoke execute on function public.return_asset(bigint, date, text, text, text) from public, anon;
grant execute on function public.assert_can_move_custody() to authenticated, service_role;
grant execute on function public.allocate_asset(bigint, bigint, bigint, bigint, date, date, text, text) to authenticated, service_role;
grant execute on function public.return_asset(bigint, date, text, text, text) to authenticated, service_role;
