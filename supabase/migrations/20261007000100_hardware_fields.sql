-- 20261007000100_hardware_fields.sql
--
-- WHY: IT Hardware is listed with the columns IT keeps for each PC/laptop
-- (handwritten sheet, 2026-10-07): its own status words, the user's employee
-- ID and designation, previous user, MAC, OS, M365 licence, Office key, RAM,
-- storage, AnyDesk ID and PowerApps ID.
--
-- hw_status is deliberately separate from `status`. `status` is driven by
-- custody (Allocate / Return, trg_sync_asset_status) and other modules read
-- it; the hardware sheet's words (Registered, Handover, Vacant…) are IT's own
-- labels and must not fight the custody triggers.
--
-- Employee name / ID / designation are NOT copied onto assets: the holder
-- comes from the open assignment, and ID and designation from that staff row,
-- so a person's details are fixed in one place.

alter table public.assets
  add column hw_status          text check (hw_status in ('Registered','Active','Handover','Repair','Vacant')),
  add column remark             text,
  add column previous_user      text,
  add column mac_address        text,
  add column os                 text,
  add column m365_license       text,
  -- ponytail: readable by every login, like the rest of the row. Move to an
  -- admin-only table (the asset_value pattern) if viewers must not see keys.
  add column office_product_key text,
  add column ram                text,
  add column storage            text,
  add column anydesk_id         text,
  add column powerapps_id       text;

alter table public.staff add column employee_no text;

-- The sheet lists iPad, Laptop, Desktop. PC had no assets; the FK cascades
-- the rename onto any that appear before this runs.
update public.categories set name = 'iPad' where name = 'PC';

-- The accessories import parked these in spec notes; they have columns now.
update public.assets
   set previous_user = substring(spec_notes from 'Previous user: ([^.]+)\.'),
       powerapps_id  = substring(spec_notes from 'PowerApps ID: ([0-9a-f-]+)'),
       spec_notes    = nullif(btrim(regexp_replace(regexp_replace(spec_notes,
                         'Previous user: [^.]+\.\s*', ''), 'PowerApps ID: [0-9a-f-]+\.?\s*', '')), '')
 where spec_notes ~ '(Previous user|PowerApps ID): ';

-- Re-declared with the new fields, per the warning on the original.
create or replace function public.audit_asset_change() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    insert into asset_audit (asset_id, action, field, new_value, changed_by, changed_by_name)
    values (new.asset_id, 'created', 'Asset', new.asset_tag, auth.uid(), current_actor_name());
    return new;
  elsif tg_op = 'DELETE' then
    insert into asset_audit (asset_id, action, field, old_value, changed_by, changed_by_name)
    values (old.asset_id, 'deleted', 'Asset', old.asset_tag, auth.uid(), current_actor_name());
    return old;
  end if;

  insert into asset_audit (asset_id, action, field, old_value, new_value, changed_by, changed_by_name)
  select new.asset_id, 'updated', f.label, f.o, f.n, auth.uid(), current_actor_name()
  from (values
    ('Asset tag',     old.asset_tag,             new.asset_tag),
    ('Category',      old.asset_type,            new.asset_type),
    ('Make',          old.make,                  new.make),
    ('Model',         old.model,                 new.model),
    ('Serial no',     old.serial_no,             new.serial_no),
    ('Status',        old.status,                new.status),
    ('Hardware status', old.hw_status,           new.hw_status),
    ('Location',      (select name from locations where location_id = old.location_id),
                      (select name from locations where location_id = new.location_id)),
    ('Department',    old.department,            new.department),
    ('Purchase date', old.purchase_date::text,   new.purchase_date::text),
    ('PO no',         old.po_no,                 new.po_no),
    ('Invoice no',    old.invoice_no,            new.invoice_no),
    ('Vendor',        (select name from vendors where vendor_id = old.vendor_id),
                      (select name from vendors where vendor_id = new.vendor_id)),
    ('Warranty end',  old.warranty_end::text,    new.warranty_end::text),
    ('Refresh years', old.refresh_years::text,   new.refresh_years::text),
    ('Refresh due',   old.refresh_due::text,     new.refresh_due::text),
    ('Spec notes',    old.spec_notes,            new.spec_notes),
    ('Remark',        old.remark,                new.remark),
    ('Previous user', old.previous_user,         new.previous_user),
    ('MAC address',   old.mac_address,           new.mac_address),
    ('OS',            old.os,                    new.os),
    ('M365 licence',  old.m365_license,          new.m365_license),
    ('Office product key', old.office_product_key, new.office_product_key),
    ('RAM',           old.ram,                   new.ram),
    ('Storage',       old.storage,               new.storage),
    ('AnyDesk ID',    old.anydesk_id,            new.anydesk_id),
    ('PowerApps ID',  old.powerapps_id,          new.powerapps_id),
    ('Photos',        old.photo_path,            new.photo_path),
    ('Active',        old.active::text,          new.active::text)
  ) as f(label, o, n)
  where f.o is distinct from f.n;
  return new;
end $$;
