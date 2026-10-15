-- 20261013030000_damaged_status.sql
--
-- WHY: IT writes an unusable item off as "Damaged", not "Retired"
-- (2026-10-13). Renamed, not added beside it: both would mean "out of
-- service for good". No function names the old word, so only the CHECK and
-- the rows change. The audit trail keeps the old word for past changes.
alter table public.assets drop constraint assets_status_check;
update public.assets set status = 'Damaged' where status = 'Retired';
alter table public.assets add constraint assets_status_check check (status in
  ('In stock','In use','In repair','Loaned','Damaged','Lost/Stolen'));
