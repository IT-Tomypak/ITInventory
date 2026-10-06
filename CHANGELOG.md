# Changelog

Every change, newest first. Releases are summarised in `VERSION_HISTORY.md`;
the running version is in `app/version.js` and shown in the app's sidebar.

## Unreleased

- Help & User Guide: `USER_GUIDE.md` compiled into the `/help` page, with a
  contents rail, search, deep links and a print layout. `tools/check-help.mjs`
  checks that every help link resolves.
- `FEATURES.md`, `CHANGELOG.md`, `VERSION_HISTORY.md`.
- Printing no longer keeps the sidebar's left margin.

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
