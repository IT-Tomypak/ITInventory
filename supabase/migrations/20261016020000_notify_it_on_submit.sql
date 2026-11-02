-- 20261016020000_notify_it_on_submit.sql
--
-- WHY: IT wants to hear about a new equipment request the moment it is sent
-- (not only after the HOD approves) and about every new loan request. Both go
-- to notify_recipients purpose 'equipment_request' ("IT Department" on
-- Data Management > Notify Emails). On phones they arrive via the Outlook app.
--
-- Shipped DISABLED like every other mail trigger (email paused, see
-- 20261007000600_email_paused.sql). Go live, once notify_resend_api_key and
-- notify_app_url are in Vault and the IT Department list has an address:
--
--   alter table public.equipment_request enable trigger trg_notify_new_request;
--   alter table public.equipment_request enable trigger trg_notify_hod_on_submit;
--   alter table public.equipment_request enable trigger trg_notify_hod_approved;
--   alter table public.equipment_request enable trigger trg_notify_hod_rejected;
--   alter table public.equipment_request enable trigger trg_notify_release;
--   alter table public.equipment_request enable trigger trg_notify_release_on_insert;
--   alter table public.asset_assignment  enable trigger trg_notify_handover;
--   alter table public.loan_request      enable trigger trg_notify_new_loan;

-- notify_trigger's fallback branch posts { kind: tg_argv[0], request_id }.
drop trigger if exists trg_notify_new_request on public.equipment_request;
create trigger trg_notify_new_request after insert on public.equipment_request
  for each row execute function public.notify_trigger('new_request');
alter table public.equipment_request disable trigger trg_notify_new_request;

create function public.notify_new_loan() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  perform notify_post(jsonb_build_object('kind', 'new_loan', 'loan_id', new.loan_id));
  return null;
end $$;
revoke execute on function public.notify_new_loan() from public, anon, authenticated;

create trigger trg_notify_new_loan after insert on public.loan_request
  for each row execute function public.notify_new_loan();
alter table public.loan_request disable trigger trg_notify_new_loan;
