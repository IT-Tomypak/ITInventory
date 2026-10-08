-- 20261007000600_email_paused.sql
--
-- WHY: IT dropped the Microsoft Graph mail route (2026-10-07) and will move to
-- Resend later. Until then no email is sent: the four triggers that queue a
-- mail are switched OFF, not dropped, so the Resend switch-over only changes
-- the send step in supabase/functions/notify and re-enables these lines with
-- `enable trigger`.
--
-- trg_archive_request_receipt stays ON: it files the PDF receipt in Storage
-- through the same function and sends no mail.
--
-- The Graph credentials (notify_graph_*) were deleted from Vault by hand;
-- notify_from and notify_webhook_secret remain.

alter table public.equipment_request disable trigger trg_notify_new_request;
alter table public.equipment_request disable trigger trg_notify_release;
alter table public.equipment_request disable trigger trg_notify_release_on_insert;
alter table public.asset_assignment  disable trigger trg_notify_handover;
