-- 20261016000000_ink_stock.sql
--
-- WHY: printer ink is a consumable, not a tagged asset. IT only needs to know
-- how many of each colour are left per brand, and take one off when issued.

create table public.ink_stock (
  brand text not null,
  color text not null,
  qty   integer not null default 0 check (qty >= 0),
  primary key (brand, color)
);

insert into public.ink_stock (brand, color)
select b, c from unnest(array['Epson','Canon','HP']) b, unnest(array['Black','Cyan','Magenta','Yellow']) c;

alter table public.ink_stock enable row level security;
create policy "read for authenticated" on public.ink_stock for select to authenticated using (true);
create policy "write for non-viewers"  on public.ink_stock for all to authenticated
  using (not public.is_viewer()) with check (not public.is_viewer());

-- Atomic +/- so two people taking the last cartridge cannot both succeed;
-- the qty >= 0 check refuses the second. A new brand/colour is registered by
-- adding to it. Invoker rights: RLS still applies.
create function public.adjust_ink(p_brand text, p_color text, p_delta integer) returns integer
language sql security invoker set search_path to 'public' as $$
  -- The inserted row is checked before the merge, so it never carries a negative.
  insert into ink_stock (brand, color, qty) values (btrim(p_brand), btrim(p_color), greatest(p_delta, 0))
  on conflict (brand, color) do update set qty = ink_stock.qty + p_delta
  returning qty;
$$;
revoke execute on function public.adjust_ink(text, text, integer) from public, anon;
grant execute on function public.adjust_ink(text, text, integer) to authenticated;

-- Make the API see the new table and function straight away.
notify pgrst, 'reload schema';
