-- 20261019000000_rename_flash_drive.sql
-- IT Accessories: "USB Flash Drive" becomes "External Hard Disk". The FK on
-- assets.asset_type cascades the rename onto every asset. Safe to re-run.
update public.categories set name = 'External Hard Disk'
 where name = 'USB Flash Drive'
   and not exists (select 1 from public.categories where name = 'External Hard Disk');
