-- 20261007000500_item_location.sql
--
-- WHY: IT needs to note where an item physically sits (store, which cabinet,
-- which shelf) on all three listings. Free text on purpose: location_id is a
-- managed pick-list of sites/rooms; this is the finer "Cabinet 2, shelf 3"
-- detail nobody should have to register as master data first.

alter table public.assets add column item_location text;

-- Re-declared with the new field (see 20261007000400).
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
    ('Workgroup',     old.workgroup,             new.workgroup),
    ('Plant',         old.plant,                 new.plant),
    ('Special app',   old.special_app,           new.special_app),
    ('App licenses',  old.app_licenses,          new.app_licenses),
    ('Batch number',  old.batch_number,          new.batch_number),
    ('F/A code',      old.fa_code,               new.fa_code),
    ('Quantity',      old.quantity::text,        new.quantity::text),
    ('Item location', old.item_location,         new.item_location),
    ('Photos',        old.photo_path,            new.photo_path),
    ('Active',        old.active::text,          new.active::text)
  ) as f(label, o, n)
  where f.o is distinct from f.n;
  return new;
end $$;
