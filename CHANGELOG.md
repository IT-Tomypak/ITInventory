# Changelog

Every change, newest first. Releases are summarised in `VERSION_HISTORY.md`;
the running version is in `app/version.js` and shown in the app's sidebar.

## Unreleased

- **1.6.0.** Request emails, groundwork (`20261012050000_request_email_and_hods.sql`).
  New `hod` table (name, email; admin-written) seeded with IT's 20 HODs;
  `hod_names()` gives the public form names only. `equipment_request` gains
  `requester_email` and `hod_email`; `submit_equipment_request` takes `p_email`
  and pairs the HOD's email itself. The form's HOD box is an `<input list>`
  combo. Nothing is sent: the mail triggers are still disabled.
- **1.5.0.** Requests (`20261012040000_request_fields_and_loans.sql`).
  `equipment_request` gains `employee_no`, `hod`, `services`; `asset_type` is
  the first service ticked. `submit_equipment_request` takes three more
  (defaulted) parameters and keeps accepting the old six. New `loan_request`
  table, `loanable_accessories()` and `submit_loan_request()` behind the public
  `/loan` page; IT works them on Equipment Request → Loan requests
  (`/allocate/?due=` starts the loan) and the bell counts those waiting. Receipt
  PDF and the `notify` function show the new fields.
- **1.4.0.** Process Flow (`/flow`): the procedure document's Flowcharts 8, 15,
  16 and 18 drawn as inline SVG by `app/components/Flowchart.js` from the data in
  `lib/flowcharts.js` (no image files: the host blocks .png). Reference only; no
  workflow changed.
- **1.3.0.** `/` is now the Dashboard (`app/page.js`): list counts, IT
  Inventory by hardware status, custody counts, the bell's alerts and the six
  newest records. The Asset Register module is gone from the menu; its page
  became `app/components/RegisterPage.js`, used only by the three record lists,
  and its all-assets tabs and Book value card were removed. Record lists accept
  `?status=` (dashboard cards link with it).
- **1.2.6.** IT Inventory table order is Device Name, Status, Employee Name,
  Model, Serial number. Status is a dropdown for non-viewers (`changeHwStatus`
  in `app/page.js`) and saves directly; Active on a device with no holder opens
  `HardwareForm` with `activate`, where the employee is required.
- **1.2.5.** Wording only: "Check out" is now "Handover" and "Check in" is
  "Return" on Allocate / Return, the row shortcuts, the asset form hint, the
  user guide and the still-held database message
  (`20261012030000_return_wording.sql`).
- **1.2.4.** Sort box beside Filters on IT Inventory, Accessories, Fixed Assets
  and Asset Register: A–Z (by tag) or Recently added (newest `asset_id` first).
- **1.2.3.** IT Inventory table cut to five columns (`HW_TABLE` in
  `app/page.js`): Device Name, Employee Name, Model, Serial number, Status.
  Excel export and the detail pop-up still use all of `HW_COLUMNS`.
- **1.2.2.** Hardware status `Returned` added
  (`20261012020000_hw_returned.sql`): IT's PC list uses it on 21 rows. Set by
  hand or by import only, like Handover and Repair.
- **1.2.1.** Hardware status `Handover` restored the same day it was merged
  into `Active` (`20261012000000_drop_hw_handover.sql`, undone by
  `20261012010000_restore_hw_handover.sql`, which puts the 25 assets back).
- **1.2.0.** Custody status `Assigned` renamed `In use`
  (`20261008000000_in_use_status.sql`). New logins need a 6-digit ID number, and passwords are
  at least 6 characters (was 8) in User Management, the set-password screen and
  the `manage-users` function.
- **Scan QR (1.1.0).** Register forms (IT Inventory, Accessories, Fixed Assets)
  have a Scan QR button: it opens the phone camera, decodes the label
  (BarcodeDetector, else jsQR) and fills the form via `parseQr` in
  `lib/hardwareImport.js`. A serial already registered opens that record
  instead, switching listing if needed (`?q=TAG&open=1`).
- Asset form photos: separate **Camera** (capture) and **Gallery** buttons;
  Android's photo picker otherwise hides the camera.

- Help & User Guide: `USER_GUIDE.md` compiled into the `/help` page, with a
  contents rail, search, deep links and a print layout. `tools/check-help.mjs`
  checks that every help link resolves.
- `FEATURES.md`, `CHANGELOG.md`, `VERSION_HISTORY.md`.
- Printing no longer keeps the sidebar's left margin.
- **Packaging (phase 9).** `npm run package` builds the deploy zip with Unix
  permissions; `check-zip-perms.mjs` verifies it. `.htaccess` (HTTPS, 404 page,
  gzip, cache headers), `manifest.json` with an SVG icon, and `sw.js` (installed
  app opens offline). `check-nopng.mjs` simulates hotlink protection.
- `check-schema.mjs` runs again: it stubs pg_net and Vault, and now covers the
  notification triggers and email links. `tools/hooks/pre-commit` runs the
  offline checks.

## 2026-10-06

- **Email (phase 6).** One `notify` Edge Function sends new-request, release and
  handover mail through Microsoft Graph from `helpdesk@tomypak.com.my`, and
  archives each request's PDF receipt. Email action links (`/assign`) with
  single-use 7-day tokens; opening a link writes nothing. Setup in
  `EMAIL_PIPELINE.md`. `pg_net` installed in the `extensions` schema.
- **Screens (phase 7).** Warranty & Refresh, the alert bell and admin briefing,
  Analytics, Asset Value, Data Management (incl. Notify Emails and Notify
  Health), User Management with the `manage-users` function, Change Log.
- `tools/check-anon.mjs` probes the live project as an anonymous visitor.
- An `allocate_asset` error message uses an ASCII hyphen.
- **Request flow (phase 5).** Public request form with photos and PDF receipt,
  public status page, the internal queue, release approvals.
- **Allocation (phase 4).** Atomic check-out / check-in (`allocate_asset`,
  `return_asset`) and the Allocate / Return page.
- **Register (phase 3).** Asset Register and Asset History.
- **Foundation (phases 1–2).** Schema, Row Level Security, triggers, storage,
  the app shell and sign-in.
