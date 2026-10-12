-- 20261012000000_drop_hw_handover.sql
--
-- WHY: IT confirmed (2026-10-12) that hardware status 'Handover' means the
-- same as 'Active': an employee has the device. Merged into Active rather
-- than kept beside it. The Excel import still accepts the old word.

update public.assets set hw_status = 'Active' where hw_status = 'Handover';
alter table public.assets drop constraint assets_hw_status_check;
alter table public.assets add constraint assets_hw_status_check check (hw_status in
  ('Registered','Active','Repair','Vacant'));
