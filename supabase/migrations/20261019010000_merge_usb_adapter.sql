-- 20261019010000_merge_usb_adapter.sql
-- IT Accessories: "USB Adapter" folds into "Adapter". Move its assets over,
-- then drop the category. Safe to re-run.
insert into public.categories (name, list) values ('Adapter', 'accessory')
on conflict (name) do update set active = true;

update public.assets set asset_type = 'Adapter' where asset_type = 'USB Adapter';

delete from public.categories where name = 'USB Adapter';
