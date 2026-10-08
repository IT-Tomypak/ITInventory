-- 20261007000000_categories.sql
--
-- WHY: the register splits into two listings, IT Inventory and IT Accessories,
-- each with its own categories that IT adds over time. A table, not the
-- asset_type_t CHECK, so a new category is a row an admin adds on Data
-- Management, not a migration. assets.asset_type now holds the category name;
-- the FK cascades a rename onto every asset that uses it.
--
-- equipment_request keeps asset_type_t: the public request form asks for a
-- kind of device, which is a different list from how IT files its stock.

create table public.categories (
  name   text primary key check (btrim(name) <> ''),
  list   text not null check (list in ('inventory','accessory')),
  active boolean not null default true
);
alter table public.categories enable row level security;
create policy "read for authenticated" on public.categories for select to authenticated using (true);
create policy "write for admins"       on public.categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into public.categories(name, list) values
  ('PC','inventory'), ('Laptop','inventory'), ('Desktop','inventory'),
  ('Adapter','accessory'), ('Cable','accessory'), ('Charger','accessory'), ('Headset','accessory'),
  ('HP Adapter','accessory'), ('Keyboard','accessory'), ('Laptop Bag','accessory'),
  ('MacBook Adapter','accessory'), ('Monitor','accessory'), ('Mouse','accessory'), ('RAM','accessory'),
  ('Screwdriver set','accessory'), ('SSD','accessory'), ('USB Adapter','accessory'),
  ('USB Cable','accessory'), ('USB Flash Drive','accessory');

alter table public.assets alter column asset_type type text;

-- The 2026-10-07 accessories import parked the category in spec notes
-- ("Category: Laptop Bag. …") because the old CHECK had no room for it.
update public.assets
   set asset_type = substring(spec_notes from '^Category: ([^.]+)\.'),
       spec_notes = nullif(regexp_replace(spec_notes, '^Category: [^.]+\.\s*', ''), '')
 where spec_notes ~ '^Category: [^.]+\.';

-- Any other type already in use keeps working rather than failing the FK.
insert into public.categories(name, list)
  select distinct asset_type, 'inventory' from public.assets on conflict (name) do nothing;

alter table public.assets add constraint assets_asset_type_fkey
  foreign key (asset_type) references public.categories(name) on update cascade;
