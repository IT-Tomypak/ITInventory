# Version history

Releases, with dates and what shipped. Every change is in `CHANGELOG.md`. The
version number lives in one place, `app/version.js`, and is shown at the foot
of the sidebar so the deployed build can be identified on screen.

| Version | Date | What shipped |
|---|---|---|
| 1.10.1 | 2026-11-02 | Allocate / Return: hand over or return several items on one form. The handover form lists them all (up to 8) with the person's Employee ID. |
| 1.10.0 | 2026-10-30 | IT Inventory status **Registered** is gone: those devices are now Active (someone holds it) or Vacant. Allocate / Return: Handover lists only items nobody holds — an in-use item must be returned first, then handed over again. Category dropdown on Handover and Return. Needs migration `20261030000000_drop_hw_registered` applied **before** uploading. |
| 1.9.9 | 2026-10-27 | Request equipment and Borrow an accessory no longer ask for a name: it is taken from the staff list by the Staff ID. Needs migration `20261027000000_name_from_staff_id` applied **before** uploading. |
| 1.9.8 | 2026-10-23 | Allocate / Return: **Handover** searches every record (IT Hardware, Accessories, Fixed Assets), not only In-stock items; handing over an item someone holds transfers it. Search on both tabs also matches device type, department, location and FA code. |
| 1.9.7 | 2026-10-16 | **Check** button (scan a QR) on IT Inventory, IT Accessories and IT Fixed Assets: shows the record if it exists. Projector and UPS categories. Email is on: admins are emailed on every new equipment request and loan request. |
| 1.9.6 | 2026-10-16 | IT Accessories: pick a category above the status cards to see its counts. **Ink** shows stock left per brand and colour; register ink from Register asset, take one with −. Needs migration `20261016000000_ink_stock`. |
| 1.9.5 | 2026-10-15 | Handover to a person downloads a handover form (PDF) for them to sign. Request equipment and Borrow an accessory need the person's **Staff ID** and **Password** (the staff ID); email is optional. Needs migration `20261015000000_staff_login_on_public_forms` and staff IDs filled in on staff records. |
| 1.9.4 | 2026-10-15 | Serial Scan button reads the number after "S/N", "SN:" or "Serial number:" in the QR text. |
| 1.9.3 | 2026-10-15 | Photos on IT hardware registration; fixed-asset QR fills Asset Tag / Make / Model; serial-only Scan button on every register form; scanner can import an image from the gallery. |
| 1.9.2 | 2026-10-14 | IT Inventory: fixed series numbering (TPPC, TPLL, TPDL, TPML) tracks the current highest number per series; new items automatically increment and must be strictly greater than the current number. Quick-select series buttons and validation in hardware form. |
| 1.9.1 | 2026-10-14 | IT Inventory: setting status to **Vacant** (via table dropdown, bulk action, hardware form, or Excel import) automatically moves the current user into **Previous user** and frees the device. |
| 1.9.0 | 2026-10-13 | Status **Retired** is now **Damaged** (needs migration `20261013030000_damaged_status`). The status cards on IT Accessories and the Dashboard's custody row also count **Lost/Stolen**. |
| 1.8.0 | 2026-10-13 | IT Accessories: **Bulk add** registers several items of one category in one save, each with the next free tag. Serial numbers are optional. Everything else as 1.7.1. |
| 1.7.1 | 2026-10-13 | Equipment requests are approved in two steps: the requester's **HOD** approves or rejects from an email, then **IT** decides in ITrack. Assign handler, Set status, Allocate and Ask for release are gone from the request queue. Needs migrations `20261013000000`, `20261013010000`, `20261013020000` and the `notify` function redeployed. HOD mail is sent only once the mail triggers are enabled. |
| 1.7.0 | 2026-10-13 | Not for upload (use 1.7.1): built before the request queue was changed, so it still shows Assign handler, Set status, Allocate and Ask for release. |
| 1.6.0 | 2026-10-12 | Hardware request: the requester gives their own email, and **HOD Department** is a type-to-search list of IT's HODs, each paired with an email in the database. Needs migration `20261012050000_request_email_and_hods`. No email is sent yet. |
| 1.5.0 | 2026-10-12 | Hardware request form asks for Requester name, Employee no, Department, HOD Department, Request for Service(s) (tick several) and an optional Description. New public **Borrow an Accessory** loan request and a **Loan requests** tab for IT. Needs migration `20261012040000_request_fields_and_loans` and the `notify` function redeployed. |
| 1.4.0 | 2026-10-12 | New **Process Flow** page: IT's procedure flowcharts for hardware requests, handover and return, and accessory loans, for reference. |
| 1.3.0 | 2026-10-12 | New **Dashboard** home page summarising all records. The **Asset Register** module is removed; its records are on IT Inventory, IT Accessories and IT Fixed Assets. |
| 1.2.6 | 2026-10-12 | IT Inventory table: Status is the second column and is a dropdown that saves at once. Choosing Active for a device nobody holds opens the form to enter the current user first. |
| 1.2.5 | 2026-10-12 | Allocate / Return says **Handover** and **Return** instead of Check out and Check in. |
| 1.2.4 | 2026-10-12 | Sort box beside Filters on every record list: A–Z or Recently added. |
| 1.2.3 | 2026-10-12 | IT Inventory table shows five columns: Device Name, Employee Name, Model, Serial number, Status. Export and the detail pop-up keep every column. |
| 1.2.2 | 2026-10-12 | Sixth hardware status **Returned**, as used in IT's PC list. Everything else as 1.2.1. |
| 1.2.1 | 2026-10-12 | Hardware status **Handover** is back: the five statuses are Registered, Active, Handover, Repair, Vacant. Everything else as 1.2.0. |
| 1.2.0 | 2026-10-12 | Not for upload (use 1.2.1). Status **Assigned** is now **In use** (needs migration `20261008000000_in_use_status`). Hardware status **Handover** merged into **Active** (undone in 1.2.1). New logins: ID number is exactly 6 digits, password minimum 6 characters (needs the `manage-users` function redeployed). |
| 1.1.0 | 2026-10-08 | Scan QR on the register forms: a photo of a device label fills the serial (and any labelled fields); a serial already registered opens that record instead. Asset photos: separate Camera and Gallery buttons. |
| 1.0.0 | 2026-10-07 | First release: IT Inventory (hardware, IT's 29-column sheet + Location, Excel import/export), IT Accessories and IT Fixed Assets listings with editable categories; asset register and history, allocation and return, equipment requests with approvals, warranty and refresh, analytics, asset value, data and user management, change log, in-app user guide. Email is off (Resend pending); the PDF request receipt archive runs. |

## Publishing a release

Publishing is manual and needs the hosting control panel. Nothing deploys
automatically.

1. Set the new version in `app/version.js` and add a row above.
2. `npm run build`. This also regenerates the user guide. If `npm run dev` is
   running, use `NEXT_DIST_DIR=.next-build npm run build`, then rename
   `.next-build` to `out`: a plain build rewrites the `.next` folder the dev
   server is serving from, and `NEXT_DIST_DIR=out` was seen to pick up dev
   chunks (`chunks/main.js`, `fallback/`), a zip about 4 MB instead of about 0.7 MB.
3. `npm run package`. This writes `itrack-vX.Y.Z-deploy.zip` and refuses to
   overwrite an existing one.
4. `node tools/check-zip-perms.mjs itrack-vX.Y.Z-deploy.zip`. Do not upload
   a zip that fails. Never re-zip with Windows' Compress-Archive: the host
   would answer every page with HTTP 403.
5. Control panel → File Manager → `public_html` → upload the zip → Extract,
   overwriting.
6. Open the site and check that the version at the foot of the sidebar matches.

**Rollback:** extract the previous release's zip over `public_html`. Keep every
release zip for this. Database migrations are separate, so a rollback does not
touch data.
