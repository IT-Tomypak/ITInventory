-- 20261016010000_projector_ups_categories.sql
-- Two more IT Accessories categories. Safe to re-run.
insert into public.categories (name, list) values ('Projector', 'accessory'), ('UPS', 'accessory')
on conflict (name) do update set list = 'accessory', active = true;
