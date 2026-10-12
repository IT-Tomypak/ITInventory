-- 20261012010000_restore_hw_handover.sql
--
-- WHY: undoes 20261012000000_drop_hw_handover the same day: IT keeps five
-- hardware statuses (Registered, Active, Handover, Repair, Vacant). The 25
-- assets that migration moved to Active are found by its own audit rows (one
-- statement, so one timestamp) and put back, unless edited since.

alter table public.assets drop constraint assets_hw_status_check;
alter table public.assets add constraint assets_hw_status_check check (hw_status in
  ('Registered','Active','Handover','Repair','Vacant'));

update public.assets a set hw_status = 'Handover'
 where a.hw_status = 'Active'
   and exists (select 1 from public.asset_audit au
                where au.asset_id = a.asset_id and au.field = 'Hardware status'
                  and au.old_value = 'Handover' and au.new_value = 'Active'
                  and au.changed_by is null
                  and au.changed_at = '2026-10-12 02:56:12.168698+00');
