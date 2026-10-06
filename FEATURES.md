# ITrack: features

ITrack is Tomypak's IT asset register: every hardware item the company owns,
who holds it, what it cost, and every request for new equipment. It runs in any
browser, on a phone as well as a desktop, with light and dark themes.

## Asset register

- One live list of every asset, with counts by status: In stock, Assigned,
  Loaned, In repair, Retired, Lost/Stolen.
- Search by tag, serial, make, model or holder; filter by type, status,
  department, location and warranty.
- Full record per asset: details, photos, current and past holders, and the
  history of every change.
- Bulk status change and delete (press-and-hold to confirm), CSV export of the
  selection or of the filtered list.
- Asset History: everything that happened to any item, including deleted ones,
  with wildcard search.

## Allocation and return

- Check out to a person or a location, with condition notes and an optional due
  date (a loan). Check in with condition notes, back to stock or to repair.
- Each movement is one atomic database operation: two people cannot issue the
  same item at once.
- The value of an item is recorded at the moment of issue, so history does not
  change when a cost is corrected later.

## Equipment requests

- A public request form that needs no login, with up to 4 photos (camera on a
  phone), and a printable PDF receipt with a request number.
- Public status tracking by request number. It shows status and dates only: no
  names, costs or internal notes.
- An internal queue for IT: status, handler, allocation, delivery.
- Asset releases need a decision from the asset custodian (or the IT HOD),
  signed with their ID number and recorded with their name.
- The requester confirms receipt from an email, signed with their ID number.

## Email notifications

Sent through Microsoft 365 from the IT helpdesk mailbox:

- New request: to the IT managers on the list, with one-click **Allocate** and
  **Assign** buttons.
- Release waiting for a decision: to the custodian. Release decided: to the
  requester's manager and IT.
- Handover: to the person who received an item, with a **Confirm receipt** button.

Who receives which email is managed in the app, by purpose. Email links are
single-use, expire after 7 days, and do nothing until a person presses Confirm
(Microsoft's link scanner opens links before people do). Every send is logged
and a 7-day health panel shows failures.

## Warranty, refresh and alerts

- Expired and expiring warranties (30 / 60 / 90 days), overdue refreshes and
  refreshes due this year, exportable to CSV and Excel.
- A bell in the header and a once-per-sign-in briefing for administrators,
  drawn from the same list so they always agree.

## Reporting

- Analytics: assets by type, status, department and age; purchases per month;
  warranties ending per quarter; assignment turnover. Every chart also as a table.
- Asset Value (administrators only): cost and straight-line book value by
  department and type, purchases per month, value at year end.

## Users, access and audit

- Staff sign in with their ID number. Five access levels: officer, approver
  (asset custodian), viewer (read-only), admin, super admin (IT HOD).
- Access is enforced by the database itself, not just hidden in the screens: a
  hand-crafted request without the right access is refused.
- Administrators create accounts, set passwords and disable (never delete)
  accounts. The last administrator cannot be locked out.
- Change Log: every sign-in, account change and asset change, read-only.
- The running version is shown in the app, so the deployed build can be
  identified on screen.

## Security

- No password or key is in the website. Credentials live in the Supabase Vault,
  encrypted, and can be rotated without redeploying.
- The database is managed Postgres (Supabase), encrypted in transit and at rest,
  with automated daily backups. Point-in-time recovery is a Supabase add-on.
- The public form is rate-limited (5 requests per name per hour, 40 per hour in
  total), and every attempt, including refusals, is logged.

## Limitations

These are deliberate, and stated here so nobody discovers them the hard way.

- **Email is best effort.** If Microsoft 365 is unavailable, the email is lost
  without a retry, by design, so that saving a request never fails. The request
  itself is always saved, and the failure shows in Notify Health.
- **The log shows what Microsoft accepted, not what was delivered.** Delivery is
  traced in the Exchange admin centre (Message trace).
- **The public request form is open by design.** Anyone who can reach the site
  can submit; rate limiting, not a login, protects it.
- **Email is not end-to-end encrypted.** Do not put confidential information in
  request text.
- **Email action links are bearer links.** Anyone holding the email can use the
  button, once, within 7 days. Every action they allow can be undone in the app.
- **The notification endpoint is protected by one shared secret** (kept in the
  Vault), not by a user login, because its caller is the database.
- **There is no password-reset email.** Sign-in is by ID number, so an
  administrator sets a new password and hands it over.
- **No scheduled email digest.** Expiring warranties and old requests are shown
  in the app, not mailed.
