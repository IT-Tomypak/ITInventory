-- 20261012020000_hw_returned.sql
--
-- WHY: IT's PC list (PC List_Latest_2026) carries a sixth hardware status,
-- 'Returned', on 21 rows. It was not in the allowed list, so those rows could
-- not be imported under their own word.

alter table public.assets drop constraint assets_hw_status_check;
alter table public.assets add constraint assets_hw_status_check check (hw_status in
  ('Registered','Active','Handover','Returned','Repair','Vacant'));
