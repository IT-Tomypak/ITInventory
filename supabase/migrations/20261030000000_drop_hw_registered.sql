-- 20261030000000_drop_hw_registered.sql
--
-- WHY: IT dropped the hardware status 'Registered'. A Registered device with a
-- person holding it is Active; anything else is Vacant.

update public.assets a set hw_status = case
    when exists (select 1 from public.asset_assignment x
                  where x.asset_id = a.asset_id and x.returned_on is null and x.staff_id is not null)
    then 'Active' else 'Vacant' end
 where a.hw_status = 'Registered';

alter table public.assets drop constraint assets_hw_status_check;
alter table public.assets add constraint assets_hw_status_check check (hw_status in
  ('Active','Handover','Returned','Repair','Vacant'));
