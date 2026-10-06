# Build Prompt — ITrack, an IT Hardware Inventory & Assignment System

> **How to use this file.** Paste it whole into Claude Code (or any capable coding
> agent) as the opening instruction, or feed it one numbered section at a time in
> the order given in §12. Fill in the placeholders in §0 first. Every constraint in
> here has a reason attached — the reasons are part of the brief, not commentary.
> Do not drop them, and do not "improve" a constraint whose reason you have not
> read.

---

## 0. Placeholders — replace these before building

| Placeholder | Meaning | Example |
|---|---|---|
| `{{COMPANY}}` | Legal company name, used in footers and email | `Acme Industries Sdn Bhd` |
| `{{DOMAIN}}` | Public domain the app is served from | `itrack.acme.com` |
| `{{MAIL_DOMAIN}}` | Domain the outbound mail is authenticated for | `acme.com` |
| `{{SUPABASE_REF}}` | Supabase project ref | `abcdefghijklmnopqrst` |
| `{{FROM}}` | Sender shown on notification email | `ITrack <itrack@acme.com>` |
| `{{INTERNAL}}` | Internal login domain — **must not exist, must never receive mail** | `acme.internal` |

§3 explains why `{{INTERNAL}}` has to be a dead domain.

---

## 1. What to build, and what this is not

Build **ITrack**: the company's single register of IT hardware, and the record of
who is holding each item.

It answers five questions, and it must answer all five without anyone opening a
spreadsheet:

1. What IT hardware do we own, and what state is each item in?
2. Who is holding a given item right now, and since when?
3. What was the last thing that happened to this item, who did it, and when?
4. What is out of warranty, nearly out of warranty, or old enough to replace?
5. A member of staff needs a laptop — where is that request, and who approved it?

**In scope:** the asset register; assignment of an asset to a person, a location or
a department; check-out and check-in with a condition note at each end; the
lifecycle status of every item; warranty and refresh dates; a request flow for
staff who need equipment; an immutable audit trail; an admin-only value report.

**Explicitly out of scope. Do not build these, do not add tables for them, and do
not add nav entries for them:**

- **No consumables or stock control.** Toner, cables, RAM sticks and spare
  keyboards are not modelled. There is no quantity-on-hand, no minimum-quantity
  reorder, no purchase-order module. An asset is a single serialised item with its
  own tag, or it does not belong in this system.
- **No software licences or subscriptions.** No licence keys, no seats-used
  counting, no renewal tracking.
- **No helpdesk ticketing.** "My Outlook is broken" is not an equipment request.
  The only request this system accepts is a request **for hardware**.

If you believe one of those three is needed, say so in one line and build the
system without it. Scope creep here is the difference between a register people
trust and a second spreadsheet.

---

## 2. Stack and the constraints that come with it

### 2.1 The stack, exactly

| Layer | Choice |
|---|---|
| Framework | **Next.js 14.2.5**, App Router (`app/`), every page `"use client"` |
| Build | **Static export** — `output: "export"`, `trailingSlash: true`, `images: { unoptimized: true }` |
| Hosting | Apache / DirectAdmin shared hosting. **No Node process in production.** |
| Backend | **Supabase** — Postgres + RLS, Auth, Storage, Edge Functions (Deno), Vault, `pg_net` |
| Email | **Resend** (`POST https://api.resend.com/emails`) |
| Styling | **Tailwind 3.4** over a CSS-variable token layer, `darkMode: "class"` |
| Charts | `recharts` |
| CSV | `papaparse` |
| Icons | `lucide-react` |
| Misc | `framer-motion`, `clsx`, `tailwind-merge` |
| Tests | `playwright` as a **devDependency only**, driven by standalone scripts (§10) |

`package.json` scripts:

```json
{
  "dev": "next dev",
  "prebuild": "node -e \"require('fs').rmSync('out',{recursive:true,force:true})\" && node tools/build-help.mjs",
  "build": "next build",
  "package": "node tools/make-zip.mjs",
  "start": "next start"
}
```

`prebuild` wipes `out/` first so a file from an earlier build can never be shipped
by accident.

### 2.2 Hard constraints — read the reason before arguing with the rule

**There is no server.** `output: "export"` emits plain HTML/CSS/JS. There is no
`app/api/`, no server component doing privileged work, no middleware. Everything
the browser holds is public. It follows that:

- **The bundle carries exactly two secret-shaped values, and neither is a
  secret**: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. They
  are safe *only* because RLS decides what they can reach. Write that sentence
  into `.env.local.example` so the next person does not "tidy up" by adding a
  service-role key.
- **Anything needing a privileged key is an Edge Function**, and the key lives in
  **Supabase Vault**, read at call time. Never in a function body, never in a
  hand-set env var, never in the bundle.
- **No state-management library.** `useState` / `useMemo` per page, one React
  context for auth, a module-level `Set` of listeners for the theme, and a
  custom-event bus for toasts. That is the whole state architecture. Redux,
  Zustand or React Query on a static site talking to one API is weight with no
  payoff.
- **Server-side rendering is unavailable**, so anything a server would normally
  generate is built at build time or hand-rolled in the browser:
  - **CSV** via `papaparse`.
  - **XLSX**: a zero-dependency OOXML writer (`lib/xlsx.js`). SheetJS's free build
    cannot write native charts, and the workbook needs charts.
  - **PDF** (the request receipt): a zero-dependency writer using only the
    base-14 PDF fonts, so there is no font embedding (`lib/receipt-pdf.js`).
    jsPDF is ~300 KB for one A5 docket.
  - **Markdown** (the in-app user guide): compiled to a JS module at build time by
    `tools/build-help.mjs`, with the output **committed**, because `prebuild` does
    not run before `next dev`. Do not ship a Markdown renderer to the client.
- **Client-side redirects only.** A static export ignores `redirects` in
  `next.config.js`. A retired route is a page that calls `router.replace()`.
- **Pathnames arrive with a trailing slash.** Normalise every read of the current
  path: `(usePathname() || "/").replace(/\/+$/, "") || "/"`. Skip this and every
  breadcrumb reads "Not found" in production while working perfectly in dev.

### 2.3 The Supabase client

One file, and it stays this small:

```js
// lib/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Missing Supabase env vars. Check .env.local");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

### 2.4 Styling and dark mode

Map **every** colour in `tailwind.config.js` to a CSS variable:
`rgb(var(--c-surface) / <alpha-value>)`. Define the tokens in `app/globals.css`
under `:root`, redefine them under a `.dark` selector, and set
`darkMode: "class"`. Dark mode is then **one class flip on `<html>`** instead of a
`dark:` twin for every utility.

Two details that are easy to get wrong:

- Apply the saved theme in an **inline `<script>` in `<head>`**, before first
  paint, or the app flashes light before going dark.
- Make the **DOM the source of truth** for the theme, not React state: the toggle
  flips `documentElement.classList`, writes `localStorage`, then notifies a
  module-level `Set` of listeners. A `useTheme()` hook returns `dark === null`
  until mount so nothing renders the wrong icon during hydration — and the
  toggle's own sun/moon swap is pure CSS (`dark:hidden` / `hidden dark:block`) so
  it is correct on the very first paint.

Default to **light mode**, and deliberately ignore `prefers-color-scheme`: on
company phones the OS is usually dark, and a dark register surprises everyone who
opens it for the first time.

### 2.5 One shared UI module

`app/components/ui.js` exports every reusable piece and every page composes from
it. Nothing bespoke per page:

`toast` + `<Toaster />` (custom-event bus, no library), `BrandLogo`,
`ModalPortal`, `ConfirmDialog`, `HoldToConfirmButton` (press-and-hold with a
sweeping fill for destructive actions — works with pointer **and** keyboard, and
takes a `confirmIcon` so a non-delete action does not show a bin), `KpiCard`,
`StatusBadge`, `Skeleton` / `TableSkeleton` / `KpiSkeleton`, `EmptyState`,
`SortableTh`, `Pagination`, `PageHeader`, `HelpLink`, `Card`.

### 2.6 The shell

`app/components/AppShell.js`. Nav is **one flat array**, not a nested structure,
because the role filter, the breadcrumb labels and the command palette all read
the same list:

```js
const NAV_ITEMS = [
  { href: "/",          label: "Asset Register",     icon: Boxes },
  { href: "/analytics", label: "Analytics",          icon: BarChart3 },
  { href: "/value",     label: "Asset Value",        icon: Wallet,     adminOnly: true },
  { href: "/warranty",  label: "Warranty & Refresh", icon: CalendarClock },
  { href: "/allocate",  label: "Allocate / Return",  icon: ArrowLeftRight },
  { href: "/entry",     label: "Equipment Request",  icon: ClipboardList },
  { href: "/manage",    label: "Data Management",    icon: Database,   adminOnly: true },
  { href: "/staff",     label: "User Management",    icon: UserCog,    adminOnly: true },
  { href: "/audit",     label: "Change Log",         icon: ScrollText, adminOnly: true, section: "Audit Trail" },
  { href: "/assets",    label: "Asset History",      icon: History,    section: "Audit Trail" },
  { href: "/help",      label: "Help & User Guide",  icon: BookOpen },
];
```

`section` is a flat property on the item, not nesting. Compute each section
heading against the previous **visible** item, so filtering out an admin-only
entry cannot leave an orphaned heading.

Shell behaviour:

- Fixed desktop rail (`hidden md:flex`), `w-60` expanded ↔ `w-[4.5rem]`
  collapsed, preference in `localStorage`, **restored in a mount effect** to avoid
  a hydration mismatch. The main column's padding mirrors it.
- Sticky `h-14` header: hamburger (`md:hidden`), breadcrumb from a `ROUTE_LABELS`
  map, a palette trigger showing a `Ctrl K` hint, theme toggle, notification bell,
  user menu. Pad the header with `env(safe-area-inset-top)`.
- The mobile drawer **reuses the same `SidebarContent`** component and closes on a
  `useEffect` keyed to the pathname.
- Ctrl/Cmd+K command palette searching pages, assets, staff **and** user-guide
  headings and body text.
- The public routes short-circuit the shell — `if (PUBLIC_ROUTES.includes(path))
  return <>{children}</>` — placed **after every hook**, so hook order stays
  stable between renders. That list is duplicated in `AuthProvider`; have both
  files comment at each other about it, because they must change together.

---

## 3. Roles and access

### 3.1 Login is a staff ID number, not an email address

Staff sign in with their **ID number**. Map it internally:
`12345` → `12345@{{INTERNAL}}`. That domain does not exist and receives no mail.

Consequences to design for rather than work around:

- **There is no password-reset email.** An administrator sets a new password in
  User Management and hands it over. Build that, and say so on the login screen.
- **There is no self-service sign-up.** Accounts are created by an administrator.
- The address **is** the ID, so show the generated address in the create-user form
  *before* saving, not after. It is not a second fact to collect.

### 3.2 The five access levels

The role lives in `app_metadata.role` on the Supabase user — admin-set, not
writable by the user. Keep **job title** (free text: "IT Executive", "Manager",
"HOD") as a separate `staff.role` column. The two share a name and mean different
things; conflating them is how eligibility rules end up wrong.

| `app_metadata.role` | Who | What it grants |
|---|---|---|
| `super_admin` | IT HOD | Everything, **including** releasing an asset. Exists so the system is not stuck when the approver is on leave. |
| `admin` | IT manager | Master data, user management, value report, change log. **Cannot** release an asset. |
| `approver` | Asset custodian | The operational screens, plus the **only** right to approve an asset release. Deliberately not an admin: approving a release is their job, keying in master data is not. |
| *(no role)* | IT officer — the default | Register, allocate, return, request entry, asset history. No master data. |
| `viewer` | Supervisors, auditors | Read everything operational, change nothing — with one deliberate exception: **a viewer may still raise an equipment request** (§5.3). |

### 3.3 The access matrix

| Page | officer | approver | viewer | admin | super_admin |
|---|---|---|---|---|---|
| `/request`, `/status` (public) | ✔ | ✔ | ✔ | ✔ | ✔ |
| `/` Asset Register (read) | ✔ | ✔ | ✔ | ✔ | ✔ |
| `/` edit / bulk / delete | ✔ | ✔ | — | ✔ | ✔ |
| `/allocate` check-out / check-in | ✔ | ✔ | — | ✔ | ✔ |
| Approve an asset **release** | — | ✔ | — | — | ✔ |
| `/assets`, `/warranty`, `/analytics` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `/entry` request entry | ✔ | ✔ | ✔ (insert only) | ✔ | ✔ |
| `/value`, `/manage`, `/staff`, `/audit` | — | — | — | ✔ | ✔ |

**Every row of that table is enforced by a SQL policy or a trigger guard.** The
client-side flags (`isAdmin`, `isApprover`, `isViewer`) filter the nav and hide
buttons, and that is *all* they do. Put a comment saying so at every call site.
A hidden button is not access control: the anon key is itself a valid JWT,
PostgREST is a public URL, and anyone can craft the request by hand.

### 3.4 AuthProvider and the gate

`app/components/AuthProvider.js` exposes `{ session, user, idNumber, fullName,
isSuperAdmin, isAdmin, isApprover, isViewer, loading }`. `idNumber` is recovered
as the email local part; `fullName` from `user_metadata.full_name`.

`AuthGate` wraps the app, in this order: public route → render children bare;
`loading` → spinner; Supabase `PASSWORD_RECOVERY` event → force the
set-new-password screen; no session → the role landing screen, then the login
screen; otherwise → children.

**Login history.** Supabase keeps none you can query, so record it yourself:
`supabase.rpc("log_login")` and `log_logout()`. Both take **no arguments** and
read `auth.uid()` inside the database, so the browser cannot forge who signed in.
Two traps, both of which have bitten before:

- Fire `log_login` **inside a try/catch and do not await it in the auth
  callback**. A PostgREST query builder has no `.catch()`; calling one threw
  inside `onAuthStateChange` and surfaced to the user as a failed login on a
  correct password.
- **Await `log_logout` before calling `signOut()`** — after sign-out there is no
  JWT left for the database to read.

---

## 4. The data model

Every table lives in `public`. Every change is a **named, dated migration** —
`supabase/migrations/YYYYMMDD_description.sql` — never an ad-hoc edit in the
dashboard. A migration carries a comment block at the top saying *why*, not just
what.

### 4.1 Master data

**`assets`** — one row per serialised item. PK `asset_id bigserial`.

| Column | Type | Notes |
|---|---|---|
| `asset_tag` | text UNIQUE NOT NULL | The sticker on the item. The number people quote. |
| `asset_type` | text NOT NULL | CHECK: `Laptop`, `Desktop`, `Monitor`, `Printer`, `Network`, `Server`, `Phone`, `Tablet`, `Peripheral`, `Other` |
| `make` / `model` | text | |
| `serial_no` | text | Indexed. Not unique — vendors do reuse them, and a wrong unique constraint blocks a legitimate entry at 5pm. |
| `status` | text NOT NULL DEFAULT `'In stock'` | CHECK: `In stock`, `Assigned`, `In repair`, `Loaned`, `Retired`, `Lost/Stolen` |
| `location_id` | → `locations` ON DELETE SET NULL | Where it physically is when not with a person |
| `department` | text | The owning department, which is not the holder |
| `purchase_date` | date | |
| `purchase_cost_rm` | numeric(12,2) | |
| `po_no` / `invoice_no` | text | |
| `vendor_id` | → `vendors` ON DELETE SET NULL | |
| `warranty_end` | date | |
| `refresh_years` | int DEFAULT 4 | How long this class of item is expected to serve |
| `refresh_due` | date | **Stored, not derived** — see the note below |
| `spec_notes` | text | CPU/RAM/disk, free text. Not a schema. |
| `photo_path` | text | Newline-separated public URLs (§4.6) |
| `active` | boolean NOT NULL DEFAULT true | |
| `created_at` | timestamptz DEFAULT now() | |
| `created_by` / `created_by_name` / `created_by_id` | uuid / text / text | Stamped by trigger (§4.5) |

`refresh_due` is **stored**, defaulted by trigger to
`purchase_date + refresh_years`, and editable afterwards. Derive it in a view and
you can never record the one laptop whose replacement was deferred — and
"derived" silently changes history every time someone edits `refresh_years`.

**`locations`** — `location_id`, `name` UNIQUE, `site`, `floor`, `notes`, `active`.

**`vendors`** — `vendor_id`, `name` UNIQUE, `contact_name`, `contact_email`,
`phone`, `notes`, `active`.

**`staff`** — `staff_id`, `full_name`, `email` (UNIQUE, **NULL when absent, never
`''`** — an empty string collides on the second row), `department`, `role` (job
title), `login_id` (the ID number the person actually signs in with — this is what
joins a staff record to an auth user), `eligible` boolean **nullable** (NULL means
"fall back to the department rule"; a three-state flag is deliberate — an explicit
`false` for one person is different from never having been considered).

### 4.2 The work tables

**`equipment_request`** — PK `request_id bigserial`. This id **is** the request
number the requester quotes, so do not add a separate human reference.

| Column | Notes |
|---|---|
| `requested_by_name` | NOT NULL. Free text — the public form has no session. |
| `department` | NOT NULL |
| `asset_type` | What they are asking for; same CHECK list as `assets.asset_type` |
| `justification` | text |
| `urgency` | CHECK `Normal`, `Urgent` |
| `status` | NOT NULL DEFAULT `'Requested'`. CHECK `Requested`, `Approved`, `Allocated`, `Delivered`, `Rejected`, `Cancelled` |
| `release_status` | CHECK `Pending`, `Approved`, `Rejected`. NULL until a release is asked for. |
| `approved_by` / `approved_at` / `approval_note` | The approver's name **from the session**, never typed |
| `asset_id` | → `assets` ON DELETE SET NULL. Filled when an asset is allocated. |
| `handled_by` | → `staff`. The IT officer who owns the request. |
| `attachment_path` | Photos from the requester |
| `delivered_at`, `ack_at`, `ack_by_name` | The receipt acknowledgement (§6.6) |
| `created_at`, `created_by`, `created_by_name` | Trigger-stamped |

`status = 'Requested'` is the **magic value**: it is what fires the notification
email and the receipt archive. Nothing else does.

**`asset_assignment`** — the holder history. One row per period of custody, never
updated in place except to close it.

| Column | Notes |
|---|---|
| `assignment_id` | PK |
| `asset_id` | → `assets` ON DELETE CASCADE |
| `staff_id` | → `staff` ON DELETE SET NULL. NULL when assigned to a location rather than a person. |
| `location_id` | → `locations` ON DELETE SET NULL |
| `request_id` | → `equipment_request` ON DELETE SET NULL |
| `issued_on` | date NOT NULL |
| `due_back_on` | date — set for a loan, NULL for a permanent issue |
| `returned_on` | date NULL. **NULL means currently held.** |
| `condition_out` / `condition_in` | CHECK `New`, `Good`, `Fair`, `Damaged` |
| `notes_out` / `notes_in` | text |
| `issued_by` / `received_by` | uuid, trigger-stamped from `auth.uid()` |
| `created_at` | |

Enforce **one open assignment per asset** with a partial unique index, not with
application code:

```sql
CREATE UNIQUE INDEX uq_assignment_open
  ON asset_assignment (asset_id) WHERE returned_on IS NULL;
```

That single line is the whole double-issue defence. Two officers allocating the
same laptop at the same moment is a race no amount of UI disabling fixes.

### 4.3 Audit

**`asset_audit`** — one row **per changed field**, so a single edit that touches
three fields writes three rows.

`audit_id`, `asset_id bigint NOT NULL`, `action` (`created` | `updated` |
`deleted` | `assigned` | `returned`), `field` (a **human label**: "Status",
"Warranty end", "Location", "Holder" — not a column name), `old_value`,
`new_value`, `changed_by uuid`, `changed_by_name`, `changed_at timestamptz`.
Index `(asset_id, changed_at DESC)`.

Three deliberate decisions:

- **No foreign key to `assets`.** Deleting an asset must not erase the record that
  it existed and was deleted. An audit trail with a cascade is not an audit trail.
- **Written only by a `SECURITY DEFINER` trigger.** The table has a `SELECT`
  policy and **no write policy at all**, so no one — administrators included — can
  edit or delete an entry through the app.
- The trigger **enumerates the columns it watches**. That means a column added
  later is invisible to the audit until the trigger is re-declared. Write that in a
  comment inside the trigger body, because it will otherwise be discovered a year
  later by someone wondering why a field has no history.

**`audit_event`** — account and session events. `event_id`, `event_type`
(`login` | `logout` | `user_created` | `user_updated` | `user_role_changed` |
`user_password_reset` | `user_disabled` | `user_enabled`), `actor_id`,
`actor_name`, `target_id`, `target_name`, `detail` (**pre-written for humans**:
`"officer -> admin"`), `session_id`, `occurred_at`.

One index earns its place:

```sql
CREATE UNIQUE INDEX audit_event_login_session_idx
  ON audit_event (session_id)
  WHERE event_type = 'login' AND session_id IS NOT NULL;
```

Without it every token refresh and every extra browser tab writes another "login"
and the change log becomes unreadable within a week.

**`audit_feed`** — the one view, a UNION ALL of both tables with ids prefixed
(`'e' || event_id`, `'a' || audit_id`) and a `category` column (`security` /
`asset`):

```sql
CREATE VIEW audit_feed WITH (security_invoker = true) AS ...
```

`security_invoker = true` is **load-bearing**. Without it a view over two
RLS-protected tables runs as its owner and hands every authenticated user
everything in both.

### 4.4 Notification plumbing

**`notify_recipients`** — `id`, `email`, `name`, `purpose`, `active boolean`.
Deliberately **no unique key on `email`**: one address legitimately appears once
per purpose. Seed inserts guard with `WHERE NOT EXISTS`, not `ON CONFLICT`.

**`notify_log`** — `id bigserial`, `purpose`, `recipients text[]`, `subject`,
`ok boolean NOT NULL`, `provider_status int`, `provider_id text` (the Resend
message id), `error text` (truncated to 500 chars, failure rows only),
`created_at`. One row per **provider call**, not per recipient. Partial index:

```sql
CREATE INDEX notify_log_failures_idx ON notify_log (created_at DESC) WHERE ok = false;
```

**`assign_token`** — the bearer credential in an action email (§6.4). `token`
(PK, a 32-byte random value, base64url), `request_id`, `created_at`,
`expires_at` (created_at + 7 days), `used_at`, `used_for` (`allocate` |
`assign_officer`), `chosen_id`, `used_ip`.

**`request_submission_log`** — every attempt at the public form, including the
refused ones: `id`, `requester_name`, `ip`, `created_at`, `accepted boolean`,
`reason`. The refusals are the valuable rows.

**`push_subscriptions`** — `id`, `user_id` (→ `auth.users`), `endpoint` UNIQUE,
`p256dh`, `auth`, `user_agent`, `created_at`.

### 4.5 Triggers

Name them so that **alphabetical order is the order you need**, because that is the
order Postgres fires same-event triggers in. Where one trigger must run last, name
it `trg_z_…` and say why in a comment.

On `assets`:

- `trg_stamp_asset_author` BEFORE INSERT — sets `created_by` from `auth.uid()`,
  `created_by_name`/`created_by_id` from the staff record. **Never accepted from
  the browser, and immutable afterwards.** An author the client can set, or anyone
  can rewrite, is worth nothing in an audit.
- `trg_default_refresh_due` BEFORE INSERT — `refresh_due :=
  COALESCE(NEW.refresh_due, NEW.purchase_date + (NEW.refresh_years || ' years')::interval)`.
- `trg_retired_clears_holder` BEFORE UPDATE — a status of `Retired` or
  `Lost/Stolen` with an open assignment is refused with a clear message. Closing
  the assignment is a decision, not something a status change should do silently.
- `trg_audit_asset_change` AFTER INSERT/UPDATE/DELETE — writes `asset_audit`.
  `SECURITY DEFINER`, `SET search_path TO 'public'`.

On `equipment_request`:

- `trg_stamp_request_author` BEFORE INSERT.
- `trg_guard_asset_release` BEFORE UPDATE — **refuses a change to
  `release_status`, `approved_by`, `approved_at` or `approval_note` from anyone who
  is not `is_approver()`**, and refuses a non-admin approver changing anything
  else on the row. This is the rule from §3.3 living where the write happens. RLS
  lets any officer update the table; hidden buttons are not access control.
- `trg_notify_new_request` AFTER INSERT WHEN `NEW.status = 'Requested'` → §6.
- `trg_archive_request_receipt` AFTER INSERT WHEN `NEW.status = 'Requested'` → the
  `store-receipt` function (§6.7).
- `trg_notify_release` AFTER UPDATE OF `release_status`, plus AFTER INSERT WHEN
  `release_status = 'Approved'` → §6.5.

On `asset_assignment`:

- `trg_stamp_assignment_author` BEFORE INSERT.
- `trg_sync_asset_status` AFTER INSERT/UPDATE — an open row sets the asset to
  `Assigned` (or `Loaned` when `due_back_on` is set); closing the row (`returned_on`
  set) puts the asset back to `In stock` unless the officer chose `In repair`.
  One place decides asset status, so the register and the history cannot disagree.
- `trg_audit_assignment` AFTER INSERT/UPDATE — writes `assigned` / `returned` rows
  into `asset_audit` with the holder's name as the value.
- `trg_notify_handover` AFTER INSERT → §6.6.

### 4.6 Storage

Two buckets, with deliberately different rules.

**`attachments`** — **public read**. Request photos (`attachment_path`), asset
photos (`assets.photo_path`), condition photos on return. Policies are **named,
separate** INSERT and SELECT policies for `authenticated`, plus the one
anonymous-upload policy the public form needs. Keep them separate so a later
migration cannot clobber the hand-made one.

Store photos as **newline-separated public URLs in one text column**. No join
table. It is one read, one write, trivially exportable to CSV, and a helper
(`lib/photos.js`) splits on `/[\n,]/` so legacy comma-separated values still read.
A join table buys referential tidiness and costs an extra query on every row of
every list.

**`receipts`** — **private**. The archived request receipt PDF, named
`ITrack-Request-<request_id>.pdf`. `SELECT` for `authenticated`, read through
`createSignedUrl(path, 300)`. **No INSERT policy at all** — only the
`store-receipt` Edge Function writes, under the service role. An archived receipt
that a client could upload would be worthless as evidence, which is the entire
reason the archive exists.

---

## 5. Row Level Security

RLS is the access control. Everything in §3.3 is restated here as policy, and the
UI is a convenience on top.

### 5.1 The three predicates

```sql
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','super_admin'), false)
$$;

CREATE OR REPLACE FUNCTION public.is_viewer() RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'viewer', false)
$$;
```

`is_approver()` is the same shape for `('approver','super_admin')`, but make it
`SECURITY DEFINER` reading `auth.users.raw_app_meta_data` for the current
`auth.uid()`. Reason: a role granted after the user's token was issued is not in
that token until it refreshes, and an approver who was promoted five minutes ago
must not be told "no".

### 5.2 The two standard shapes

**Work tables** (`assets`, `asset_assignment`, `equipment_request`):

```sql
CREATE POLICY "read for authenticated" ON t FOR SELECT TO authenticated USING (true);
CREATE POLICY "write for non-viewers"  ON t FOR ALL    TO authenticated
  USING (NOT public.is_viewer()) WITH CHECK (NOT public.is_viewer());
```

A `FOR ALL` policy also governs `SELECT`, so the read policy must exist
separately or viewers lose read access too. Policies are permissive and OR
together.

**Master data** (`locations`, `vendors`, `staff`, `notify_recipients`):

```sql
CREATE POLICY "read for authenticated" ON t FOR SELECT TO authenticated USING (true);
CREATE POLICY "write for admins"       ON t FOR ALL    TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
```

### 5.3 The split-policy technique — "may add, may not change"

`equipment_request` cannot use either shape, because a **viewer must still be able
to raise a request**. Supervisors report a need but never do the work, and refusing
their insert only pushes them to the public `/request` form, which needs no login
at all — the same row with less traceability.

So split the blanket policy into four:

```sql
CREATE POLICY "read for authenticated" ON equipment_request
  FOR SELECT TO authenticated USING (true);

-- Deliberately open to viewers; see the note above.
CREATE POLICY "insert for authenticated" ON equipment_request
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "update for non-viewers" ON equipment_request
  FOR UPDATE TO authenticated
  USING (NOT public.is_viewer()) WITH CHECK (NOT public.is_viewer());

CREATE POLICY "delete for non-viewers" ON equipment_request
  FOR DELETE TO authenticated USING (NOT public.is_viewer());
```

Splitting is the only way to express "may add, may not change". Use the same
technique anywhere else that distinction appears.

### 5.4 The three deliberate exceptions

- **The value report's table is admin-read only.** Purchase cost and vendor
  pricing are commercially sensitive, and "read-only to all authenticated" is not
  the right default for money. `SELECT … USING (public.is_admin())`.
- **`asset_audit`, `audit_event`, `notify_log`: admin `SELECT`, and no write
  policy whatsoever.** Rows arrive only through `SECURITY DEFINER` triggers or the
  service role. Add `REVOKE ALL ON notify_log FROM anon;`.
- **Any backup or scratch table** you create during a data repair gets
  `ENABLE ROW LEVEL SECURITY` with **zero policies**, plus
  `REVOKE ALL FROM anon, authenticated`. Keep it rather than drop it, so the
  repair stays auditable — but a table sitting in `public` with RLS off is exposed
  through PostgREST to anyone holding the anon key, which is everyone.

### 5.5 What anonymous users may do — exactly two things

**One write**, through a `SECURITY DEFINER` function and nothing else:

```sql
CREATE FUNCTION public.submit_equipment_request(
  p_name text, p_department text, p_asset_type text,
  p_justification text, p_urgency text, p_attachment text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ ... $$;
GRANT EXECUTE ON FUNCTION public.submit_equipment_request(...) TO anon;
```

Inside it, **before** the insert, enforce a sliding-window rate limit against
`request_submission_log`: **5 per requester name per hour** and **40 per hour
overall**. Log the attempt either way — accepted or refused — with the reason.
The form is open by design; rate limiting rather than authentication is what
protects it.

**One read**: `check_request_status(p_request_id bigint)`, granted to `anon`,
returning only status, dates and the asset type — never the holder, never a cost,
never a note. Take the request number **only**. A name-plus-number version was
tried and removed: requesters mistype their own name, the lookup failed, and they
re-submitted the request instead — which is worse than a guessable id for data
this bland.

Everything else anonymous is `REVOKE`d. Also provide `public_asset_type_list()` if
the form needs a dropdown; never expose the asset table to `anon`.

---

## 6. Notifications and the email function

This is the part most likely to be built wrong, so it is specified in full.

### 6.1 The chain

```
INSERT INTO equipment_request (status = 'Requested')
        │
        ▼  AFTER INSERT trigger: trg_notify_new_request
public.notify_new_request()          ← plpgsql, SECURITY DEFINER, search_path = public
        │   BEGIN … EXCEPTION WHEN OTHERS THEN NULL; END
        │   ← a notification failure can NEVER fail or block the insert
        ▼  net.http_post(...)  — pg_net, ASYNC, fire-and-forget
Edge Function: notify-new-request    ← Deno, verify_jwt = false
        │  ├─ get_notify_config()  → reads Vault
        │  ├─ reject 401 unless header x-webhook-secret matches
        │  ├─ notify_recipients WHERE active AND purpose = 'equipment_request'
        │  ├─ build table-based HTML
        │  └─ logSend() → notify_log  (best effort, wrapped in try/catch)
        ▼  HTTPS POST https://api.resend.com/emails
Resend  →  recipient mail servers
```

Three invariants in **every** trigger function that posts:

```sql
BEGIN
  PERFORM net.http_post(
    url     := 'https://{{SUPABASE_REF}}.supabase.co/functions/v1/notify-new-request',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-webhook-secret', public.notify_secret()),
    body    := jsonb_build_object('request_id', NEW.request_id, ...),
    timeout_milliseconds := 20000
  );
EXCEPTION WHEN OTHERS THEN
  NULL;   -- the request is always saved; the email is best effort
END;
```

- **`timeout_milliseconds := 20000`.** The default 5 s is not enough for an Edge
  Function cold start, and a timeout throws the response away — the mail still
  sends, but you lose every trace of it.
- **The whole call is wrapped and the exception swallowed.** Logging a request must
  never fail because a mail provider is down.
- **`pg_net` is asynchronous.** The user's insert returns immediately. Responses
  land in `net._http_response`, a self-pruning debug table, which is your
  last-resort trail.

### 6.2 Config and secrets

Nothing is hard-coded and nothing is a hand-set env var. The only env vars an Edge
Function uses are the ones Supabase injects: `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`.

Everything else lives in **Supabase Vault** and is read at call time through one
RPC granted to `service_role` only:

| Vault secret | Purpose |
|---|---|
| `notify_webhook_secret` | The shared secret between the database and its own functions |
| `notify_resend_key` | Resend API key |
| `notify_from` | Sender, e.g. `{{FROM}}` |
| `notify_app_url` | `https://{{DOMAIN}}` — where the action links point |

```sql
CREATE OR REPLACE FUNCTION public.notify_secret() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','vault' AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notify_webhook_secret'
$$;
REVOKE ALL ON FUNCTION public.notify_secret() FROM PUBLIC, anon, authenticated;
```

**Do not put the secret as a literal in the trigger function body.** A value
written into a function body is readable by anyone who can read `pg_proc` — every
SQL client, every schema dump, every support session — which makes the credential
*more* exposed than the Vault it was supposed to be protected by. Reading it from
the Vault at call time also makes rotation a single `vault.update_secret()`: no
function rewritten, no redeploy, no rebuild of the static site.

`verify_jwt = false` on every notify function, because the caller is the database,
not a signed-in user. The `x-webhook-secret` header is therefore the **entire**
perimeter — `verify_jwt` would not help anyway, since the anon key is itself a
valid JWT. Return `401` on a mismatch and `405` on anything that is not POST.

### 6.3 Recipients are resolved by purpose, never by role

This is the single most important design decision in the notification layer.

```ts
const { data: recips } = await supabase
  .from("notify_recipients").select("email")
  .eq("active", true)
  .eq("purpose", "equipment_request");
```

Purposes in use:

| `purpose` | Who is on it |
|---|---|
| `equipment_request` | IT HOD and managers — a new request has arrived |
| `release_pending` | The asset custodian — a release is waiting for a decision |
| `release_decided` | The requester's manager and IT — approved **and** rejected both use this one |

**Being an admin in ITrack grants no email.** Mailing every admin automatically is
the fastest way to get the notification filed into a folder and ignored. The list
is edited in Data Management → Notify Emails, by an administrator, with **no
redeploy** needed to change who is notified.

The `purpose` filter is load-bearing: without it the custodian would start
receiving every equipment request. Make it impossible to forget by selecting on it
in the same statement as `active`.

Zero matching recipients is **not an error** — return
`200 {ok: false, reason: "no active recipients"}`. Raising here would mean a
misconfigured list breaks nothing visible but logs a scary failure.

### 6.4 `notify-new-request` — and the buttons that act from the inbox

**Content:** request number, requested-by, department, asset type, urgency,
justification, and **the photos the requester attached** — up to 4, as linked
150px thumbnails. Photos are referenced **by URL**, not attached, because the
bucket is public-read: the images load without a login and the message stays
small. (Outlook desktop blocks remote images until the reader clicks "Download
pictures"; the links still work.)

**The action block** is what makes the email worth sending. The IT HOD should
never have to sign in to move a request forward:

- One **Allocate** button per in-stock asset of the requested type (cap at the 6
  most recently acquired), and one **Assign** button per eligible IT officer.
- **One choice per table row**, not one per column. Six cells splitting 560 px
  wrapped a long name across three lines and rendered a `border-radius: 9999px`
  pill as a circle. The name is ordinary text that may wrap freely; the tap target
  is a short fixed-width button in its own `nowrap` column, so it cannot be
  squeezed however long the name or however narrow the client.
- Each button carries a token from `create_assignment_link(p_request_id)`:
  **single use**, **7-day expiry**, scoped to one request and one action.
- The link points at **`${appUrl}/assign/`** on `{{DOMAIN}}` — a page in the app,
  **never at the Edge Function**. Supabase forces function responses to
  `text/plain`, so a page served from a function renders as visible source.
- **Opening the link must perform no write.** Microsoft 365 Safe Links pre-fetches
  every URL in an incoming message; a link that acted on `GET` would be triggered
  by the scanner before any human saw it. The page only renders a confirmation
  screen. The write happens on the confirmation press.
- The eligibility list is **re-checked server-side** against the same rule the app
  uses, so editing an id in the URL cannot allocate a retired asset or assign an
  ineligible person.
- Every use is recorded: the chosen target, the time, and the requester IP.
- Wrap the whole action block in a `try/catch` that only `console.error`s. A
  missing `notify_app_url` should degrade to an email with no buttons, not no
  email.

State the trade-off in a comment, because someone will ask: *the token in the link
is a bearer credential — anyone holding the email can use it. It is scoped to one
request and one action, it expires, and it is reversible in the app, which is why
this is acceptable for allocation and would not be for anything destructive.*

### 6.5 `notify-release` — the decision is made in the app, not in the mail

Fired by `trg_notify_release`. `mode` is `lower(NEW.release_status)` →
`pending` | `approved` | `rejected`. Recipients by purpose:
`pending` → `release_pending`, everything else → `release_decided`.

The email's **only** button opens `${appUrl}/entry/`. The decision deliberately
does *not* happen in the mail, so that:

- there is **one** place an approval can happen and one place that records it;
- `approved_by` is a signed-in identity rather than a name somebody typed.

On the approval screen itself, require the approver to retype **their own ID
number**, checked against the signed-in account. It is a signature, not a
password — it makes the approval a deliberate act without inventing a second
credential. `approved_by` always comes from the session.

Give each mode an accent colour in the template (`#1d1d1f` pending, `#0f7a3d`
approved, `#a3341f` rejected) and nothing else different, so the three cannot
drift apart.

### 6.6 `notify-handover` — the receipt acknowledgement

Fired by `trg_notify_handover` AFTER INSERT on `asset_assignment`, when the row
has a `staff_id` and that staff member has a real `email` (not the
`{{INTERNAL}}` login address — that domain receives nothing).

Content: asset tag, type, make/model, serial, condition out, issued date, due back
if it is a loan, and the officer who issued it. One button: **Confirm receipt**,
same single-use token mechanics as §6.4, landing on a page where the holder
retypes their ID number. That writes `ack_at` / `ack_by_name`.

Deliberately silent when the officer assigns an asset **to themselves**, and when
any other field on the assignment is edited. A notification that fires on
everything gets muted, and then the ones that matter are lost too.

### 6.7 `store-receipt` — the one idempotent function

Fired by `trg_archive_request_receipt`. It builds the **same** A5 PDF the
requester downloaded, server-side, and files it in the private `receipts` bucket
as `ITrack-Request-<request_id>.pdf` with `upload(..., { upsert: true })`. Upsert
on a name derived from the id makes a retry replace rather than accumulate — the
only function here that is safely repeatable.

Staff read it through `createSignedUrl(path, 300)`. There is no write policy on the
bucket at all (§4.6).

### 6.8 `notify_log` — observability, not idempotency

Both notify functions call a local helper:

```ts
async function logSend(purpose, recipients, subject, res, body) {
  try {
    let providerId = null;
    try { providerId = JSON.parse(body).id ?? null; } catch { /* not JSON */ }
    await supabase.from("notify_log").insert({
      purpose, recipients, subject,
      ok: res.ok,
      provider_status: res.status,
      provider_id: providerId,
      error: res.ok ? null : body.slice(0, 500),
    });
  } catch { /* a logging failure must never change what this function returns */ }
}
```

Four things to get right, each with a reason:

- **Duplicate this helper in each function rather than sharing a module.** Edge
  functions deploy independently; a shared module means neither can be redeployed
  alone.
- **Hold the subject in a variable** and pass it to both the send and the log. A
  second copy of the expression is free to drift from what was actually sent.
- **Both functions always return HTTP 200**, including when Resend fails
  (`{ok: res.ok, status, result}`). The only non-200s are `405` and `401`. The
  caller is a trigger that swallows errors anyway; a notification that half-works
  is worse than one that works and goes unrecorded.
- **This records what the provider *accepted*, not what was delivered.**
  Accepted-then-quarantined happens. Delivery status lives in the provider
  dashboard, and a send-only API key cannot read it back. Say so in the file.

Surface it in the app: a **Notify Health** panel on `/manage` counting ok/failed
over the last 7 days. Treat "zero sent" as **neutral, not a green tick**, and
render `null` on its own error — the recipient table below it must stay editable
when the log is unreadable.

**There is no dedupe and there are no retries.** Each trigger fire is one provider
call. Idempotency is handled upstream where it belongs: the unique index on open
assignments (§4.2), and `store-receipt`'s upsert.

### 6.9 Deliverability — do this on day one, not after the first complaint

- Authenticate the sending domain with **DKIM + SPF + DMARC** for
  `{{MAIL_DOMAIN}}`. The provider will give you a `send.` subdomain to verify.
- Send a **custom header on every message** and record why:

```ts
headers: {
  "X-ITrack-Notify": "<a fixed random value chosen once>",
  "X-Entity-Ref-ID": String(requestId),   // thread-collapse hint for Gmail/Resend
}
```

  If the recipient is on Microsoft 365, a **custom Exchange transport rule** is
  the likely cause of mail vanishing into quarantine — not spam scoring, not spoof
  filtering, with DMARC/DKIM/SPF all passing. The exception on that rule must match
  this custom header. Excepting on the sender address, or on
  `dkim=pass header.d=…`, does **not** work, because the envelope sender is
  `…@send.{{MAIL_DOMAIN}}`, not the From address. Put a comment above the constant
  saying it must not be changed without updating the mail rule in the same breath.
- **SMTP is not an option** and you should not spend time on it: Deno Deploy blocks
  ports 25/465/587, and the app is a static export with no server route to send
  from. The only alternative to an HTTP mail API would be Microsoft Graph
  `POST /v1.0/users/{id}/sendMail`.

### 6.10 The HTML template

Table-based, **inline styles only, no flex and no grid** — Outlook renders with
Word's engine. One shared `shell(headline, sub, rows, extra, accent)` builder and
one `row(label, value)` helper, so every message is the same shape:

- Outer `max-width: 560px`, page background `#f1f5fa`, card `#ffffff` with
  `border: 1px solid #dde4ed; border-radius: 14px`, system font stack.
- A dark header bar with a 38px logo, the brand name, and "IT Asset Management".
  The logo is an **absolute https URL** — a `data:` URI is stripped by many
  clients, and a `cid:` attachment needs multipart.
- Headline, sub-line, then the label/value table (`#898781` labels, `#1d1d1f`
  values), then the optional photo and action blocks, then a footer:
  `Automated notification from ITrack — {{COMPANY}}`.
- **Every interpolated value goes through an `esc()`** that escapes `& < > "`. A
  requester typing an angle bracket must not break the layout, and a requester
  pasting markup must not inject it.

### 6.11 What is *not* an email

There is **no `pg_cron` job, no scheduled function and no digest email** in this
system. That is deliberate. A nightly job that mails a list nobody asked for
trains people to filter the sender, and then the new-request mail goes with it.

Everything that needs attention but has no insert event to hang off — warranty
expiring, refresh overdue, an asset assigned to someone who has left, a request
sitting unhandled — surfaces **in the app** instead:

- One shared query in **`lib/alerts.js`** exporting `loadAlerts()` and
  `ALERT_TONES`. It returns plain data with no React import; the consumer picks
  the icon.
- A **notification bell** in the header lists everything it returns, live.
- The **same list** is shown once per sign-in as a briefing panel for admins, so a
  manager who opened ITrack for one specific thing still learns that four
  warranties expire this month. It never appears when there is nothing to report,
  and not again until the next sign-in.

Both read that one function, so the bell and the briefing cannot disagree.

*If* a weekly warranty digest is genuinely wanted later, it is the one piece here
with no proven pattern behind it: add `pg_cron` calling a `notify-warranty`
function with `purpose = 'warranty_digest'`, reusing §6.1–6.3 and §6.8 unchanged.
Build it only when someone asks.

### 6.12 Keep tests from mailing the whole department

Write `tools/notify-guard.mjs` with three commands — `status`, `solo [email]`,
`restore` — that deactivate every recipient except one test address and put the
list back afterwards, backing the previous state up to a JSON file first so a
crashed run can still be repaired. Export `soloNotify()` / `restoreNotify()` for
use from a check script:

```js
const saved = await soloNotify();
try { /* ...submit a request... */ } finally { await restoreNotify(saved); }
```

This exists because creating a request in a UI test fires the real trigger and
emails real colleagues, and remembering to deactivate recipients by hand does not
work. The `try/finally` shape restores the list even when the test throws.

### 6.13 Push notifications (optional, build last)

If the installable-app layer is wanted: Web Push with **VAPID**, keys in the
Vault, subscriptions per user in `push_subscriptions`, one row readable and
deletable only by its own user. Each payload is encrypted to that device's own
public key, so the push relay cannot read it. Alerts are enabled **per device**,
from the sidebar. On iPhone this requires **iOS 16.4+ and the app opened from the
home-screen icon** — Apple does not permit web notifications from a Safari tab.
Android works either way. Document that in the user guide, because it is the
single most common support question.

Keep **every** Edge Function in version control, including the push and
token-confirmation ones. A function that exists only in the dashboard is a
function nobody can review, diff or restore.

---

## 7. Page by page

Every page states its role gate, what it reads, and what it writes. Phone first:
a table that scrolls sideways on a phone is a table nobody uses while standing in
a server room.

### 7.1 Landing (before login)

Two choices, nothing else: **IT Department** (sign in) and **I Need Equipment**
(the public request form, no login). The pre-login screens live outside
`AppShell`, so they carry their own theme toggle — a user who prefers dark must not
be forced through a white login screen to get to it.

### 7.2 `/request` — public equipment request, no login

Fields: name, department, asset type, urgency, justification, and **photo attach /
camera capture** (up to 4; on a phone a Camera button opens the camera directly).

Submits through `submit_equipment_request(...)` — the only write anonymous users
have — and returns the request number.

**Receipt on submission.** The confirmation screen is a printed-docket-style
receipt showing the request number, timestamp, requester, department, asset type,
urgency, photo count and justification, plus a **Download receipt** button
producing an A5 **PDF**. The PDF is generated in the browser, so nothing about the
request leaves the site to produce it. The same PDF is archived server-side by
§6.7.

Show the rate-limit refusal as a plain, human message with the number to call —
not a generic error. A person who has been refused needs to know what to do next.

### 7.3 `/status` — public tracking, no login

Request number in, status out: current status, the dates, the asset type, and
whether it has been delivered and acknowledged. Reads
`check_request_status(p_request_id)` and nothing else. No holder name, no cost, no
internal note.

### 7.4 `/` — the asset register (all roles read)

The main screen. Live from the database, no cached copy.

- **KPI cards** per status (`In stock`, `Assigned`, `In repair`, `Loaned`,
  `Retired`, `Lost/Stolen`), plus total book value for admins only.
- **Filters**: free-text search (tag, serial, make, model, holder), asset type,
  status, department, location, warranty state, date range.
- **Phone**: each asset is a large readable **card** with an "Open / Update"
  button. **Tablet and desktop**: a full sortable table with a sticky action
  column, row selection, and bulk status change / delete.
- Column sorting, pagination (10/25/50/100), **CSV export that respects the
  current selection** — exporting everything when four rows are ticked is a bug
  users do not report, they just stop trusting the button.
- **Expand a row** for the full record: all fields, photos, the current holder with
  the issue date, past holders, and the **History** of every change from
  `asset_audit`.
- Destructive actions use `HoldToConfirmButton`. A viewer gets **no handler at
  all**, not a disabled button — a disabled button that an extension can re-enable
  is theatre.

### 7.5 `/assets` — asset history

Wildcard search (`*` lists all), a latest-activity overview, and the full
per-asset record: every assignment period with condition in/out, every audited
change, every request it was allocated against. Open to **all** roles including
viewer — an officer looking up what happened to a laptop is operational work, not
an administrative privilege. (Contrast `/audit`, which is admin-only.)

### 7.6 `/allocate` — check-out and check-in

The operational heart. Two modes on one screen:

**Check out.** Pick an asset (`In stock` only, searchable by tag or serial), pick a
holder — a staff member **or** a location — set `issued_on`, optional
`due_back_on` (setting it makes the asset `Loaned`, not `Assigned`),
`condition_out` and notes. Optionally link an open `equipment_request`.

**Check in.** Pick a currently-held asset, set `returned_on`, `condition_in`,
notes, and the resulting status (`In stock` by default, or `In repair`).

Both go through **one atomic RPC**, not a sequence of client writes. Build
`allocate_asset(p_request_id, p_asset_id, ...)` on this shape, which is the
pattern worth copying exactly:

```
1. Refuse viewers FIRST, before reading anything — so the error cannot be used
   to probe which asset ids exist.
2. SELECT ... FOR UPDATE on the asset row.
3. Reject a status that is not 'In stock' with a specific message.
4. Insert the asset_assignment row (the partial unique index is the real
   double-issue guard).
5. Update the request row to 'Allocated' and stamp asset_id.
6. Snapshot any value you will report on later into the assignment row — never
   re-join the asset table for historical figures, because the asset's cost
   can be corrected tomorrow and your history must not change with it.
```

Keep it a **function, not a trigger**: an administrator fixing a status typo on an
assignment must not mint a second allocation as a side effect.

The staff picker is a **toggle list, not `<select multiple>`** — multi-select is
unusable on a phone — and it states on screen which entry is the primary holder.

### 7.7 `/entry` — equipment request entry and approval (staff, logged in)

The internal version of `/request`, plus the request queue: every open request,
soonest first, with its status, who is handling it, and the allocated asset if any.

**Approvals.** When a request needs a release decision, it shows a decision box
with remarks and the ID-number signature field (§6.5). That box is rendered only
for `isApprover`, and the write is refused by `trg_guard_asset_release` for anyone
else. If something is waiting, land the approver on this view automatically and put
a count badge on the nav entry.

### 7.8 `/assign` — the email confirmation page (public route, token-authorised)

Reached from an action button in a notification email. **The token in the URL is
the authorisation; there is no session.**

Rules, all of them non-negotiable:

- **Opening the page performs no write.** It reads the token, shows what will
  happen ("Allocate asset `IT-0241` (Dell Latitude 5420) to request #118?"), and
  waits. Safe Links will open this URL by itself; it must be harmless.
- The write happens on the confirmation press, through an Edge Function that
  re-validates the token (exists, unused, unexpired) and **re-checks eligibility
  server-side**.
- After success, show what happened and who was notified. After failure — expired,
  already used, no longer eligible — say which, in plain words.
- Record `used_at`, `used_for`, `chosen_id` and `used_ip`.

### 7.9 `/warranty` — warranty and refresh

Four sections, all reading the same source as the alert bell so they cannot
disagree: **Expired**, **Expiring in 30 / 60 / 90 days**, **Refresh overdue**
(`refresh_due < today`), and **Refresh due this year**. Each row links to the
asset. CSV and XLSX export.

### 7.10 `/analytics` — theme-aware charts

Assets by type, by status, by department; age distribution; acquisitions per month;
warranty expiry per quarter; assignment turnover. Validate every chart against
both themes: labels must never be drawn outside a donut ring, and no series may
rely on a colour that vanishes in dark mode.

### 7.11 `/value` — asset value (admin only)

Book value by department and by asset type, acquisitions per month, and
straight-line depreciation over `refresh_years`. Read-only: every figure comes from
`purchase_cost_rm` and the snapshotted values in the assignment history.

Gate it in **SQL** (`USING (public.is_admin())`), not only in the nav. Purchase
cost and vendor pricing are not something every login should read, which is why
this is the one page whose data is admin-read (§5.4).

### 7.12 `/manage` — data management (admin only)

CRUD for `assets`, `locations`, `vendors`, `staff`, `notify_recipients`, with
sorting, pagination, search and CSV export per table. Plus:

- **Notify Emails** — the recipient list from §6.3, with the `purpose` shown as a
  plain-language label ("New equipment request", "Release waiting for decision").
- **Notify Health** — the 7-day panel from §6.8.

### 7.13 `/staff` — user management (admin only)

Logins and staff records are **one screen**, because they are one person and
keeping them apart lets the two halves drift.

- All accounts in one list: ID number, name, access level, linked staff record,
  last sign-in, active or disabled. Search, sorting, pagination, and count cards
  that double as filters.
- **Add a user — login and staff record in one form.** Fields are the staff table's
  own columns plus the ID number and password. Show the generated
  `<id>@{{INTERNAL}}` address **before** saving. Picking an existing person fills
  their details and updates that row; leaving it on *Create new* inserts one.
  Either way set `staff.login_id`, which is what joins the account to the person —
  without it they cannot be assigned an asset or receive a handover email.
- **Access level** (officer / approver / admin) and **job title** are separate
  fields, each offering the values already in use rather than a fixed list, and
  each described by what it grants rather than by its name.
- **Set a password** — there is no reset email (§3.1).
- **Disable, never delete.** A departed officer's name still stands against every
  allocation they made and every audit row they caused; deleting the account
  orphans that history. A disabled account cannot sign in and can be restored.
- **Lock-out guards**: you cannot remove your own admin access or disable your own
  account, and the last remaining active administrator cannot be demoted or
  disabled. Recovering from either means hand-written SQL against `auth.users`.

**How this is secured.** Every one of those operations needs the **service role
key**, which can never be in the bundle. It lives in a `manage-users` Edge
Function that resolves the caller's token to a user and **requires
`app_metadata.role` to be admin before it acts** — the same claim `is_admin()`
checks in RLS. `verify_jwt` alone is not enough, because the anon key is a valid
JWT. An officer's token reaches the function and is refused; the page's own admin
gate is for the interface only.

### 7.14 `/audit` — change log (admin only)

One feed from the `audit_feed` view: sign-ins, account changes, and every audited
asset change, newest first, filterable by category, actor and date. Read-only by
construction (§4.3) — there is no edit affordance to build, and that is the point.

### 7.15 `/help` — the user guide, in the app

`USER_GUIDE.md` rendered as a page: a contents rail, search, deep links, and a
print stylesheet that drops the app chrome so printing produces the document.

**Generated at build time from one source.** `tools/build-help.mjs` splits
`USER_GUIDE.md` on its own headings into sections — each with a stable slug, its
rendered HTML and its plain text — and writes `app/help/guideContent.js`.
`prebuild` re-runs it, so the page cannot drift from the document people print.
**Commit the output**, because `prebuild` does not run before `next dev`.

Runtime Markdown is not an option: there is no server, Apache serves `.md` without
a content type (some browsers download it), the renderer would move into the client
bundle, and an installed PWA must work offline.

**Screenshots are embedded, not served** — downscale to ~900px JPEG and write them
as `data:` URIs into a separate `app/help/guideImages.js`, imported **lazily** so
the guide text paints before a megabyte of base64 arrives and still works if it
never does. They cannot live in `public/`: see §9.

`<HelpLink section="…" />` renders a "?" beside the feature it explains, linking to
`/help/#slug` — note the **trailing slash before the hash**, because Apache 301s
`/help#slug` and the redirect drops the fragment in some browsers. The generated
slugs are a contract: renaming a heading silently breaks every `HelpLink` pointing
at it, so `tools/check-help.mjs` asserts they all resolve.

---

## 8. Security and compliance

Build these in from the start; they are not a hardening pass at the end.

1. **Transport.** HTTPS only. Service workers and Web Push are permitted by
   browsers only on HTTPS, so the notification layer cannot work without it.
2. **Authentication.** ID number + password, issued by an administrator.
   Passwords are stored by Supabase Auth, salted and hashed — never by the
   application and never in a table you own. Sessions are short-lived JWTs,
   refreshed automatically and revoked on sign-out.
3. **Authorisation.** RLS in the database, not merely hidden in the interface. An
   officer's own token must be rejected by Postgres when it attempts a master-data
   write, **even if the request is crafted by hand**. Anonymous visitors can do
   exactly two things (§5.5).
4. **Secrets.** No secret in the deployed site. Every privileged credential in
   Supabase Vault, encrypted at rest, readable only by `SECURITY DEFINER`
   functions granted to `service_role` with `anon` and `authenticated` explicitly
   revoked. Rotation is one SQL statement, with no rebuild and no redeploy.
5. **Internal webhooks.** Database → Edge Function requires the shared secret
   header; a request without it gets `401`. The secret is read from the Vault at
   call time, never embedded in a function body (§6.2).
6. **Data protection.** Managed Postgres with encryption in transit and at rest,
   automated backups and point-in-time recovery. Photos in Storage; notification
   mail **links** to images rather than attaching them, so nothing is duplicated
   into mailboxes.
7. **Anti-abuse.** Sliding-window rate limits on the public form, every attempt
   logged including refusals (§5.5).
8. **Auditability.** Immutable `asset_audit` and `audit_event`; versioned
   migrations rather than ad-hoc edits; the running version displayed in the app so
   the deployed build can be identified on screen; `CHANGELOG.md` for changes and
   `VERSION_HISTORY.md` for releases.
9. **Account lifecycle.** Disable, never delete. Lock-out guards on the last
   administrator (§7.13).

**State the limitations plainly in `FEATURES.md`** rather than letting someone
discover them:

- Notification delivery is **best effort**. If the provider is unavailable the
  alert is lost silently, by design, so that logging a request never fails. The
  request is always saved.
- The public request form is **open by design**, protected by rate limiting rather
  than authentication.
- Email content travels through a third-party provider and is **not end-to-end
  encrypted**; confidential information should not be placed in request text.
- `verify_jwt = false` on the notify functions means the shared secret is the whole
  perimeter for those endpoints.
- `notify_log` records what the provider accepted, not what was delivered.

---

## 9. Deployment

The app is a **static site**: the browser downloads plain HTML/CSS/JS and talks to
Supabase directly over HTTPS. No application server, no PHP, no database on the web
host — which is most of why the hosting attack surface is small.

**Who can publish.** Publishing needs control-panel credentials for `{{DOMAIN}}`,
held by whoever owns the hosting. Application users, administrators included, have
no ability to change the deployed site. Publishing is a manual, deliberate act;
there is no automatic deployment from a developer machine to production.

**How to publish.**

1. `npm run build` — emits the static site into `out/` (and clears it first).
2. `npm run package` — produces `itrack-vX.Y.Z-deploy.zip`. This tool **sets Unix
   permissions inside the archive** (files `0644`, directories `0755`) by writing
   `version made by = Unix(3)` and `externalAttributes = mode << 16`. This is
   required: an archive without them extracts unreadable and the site returns HTTP
   403. `Compress-Archive` does not do it.
3. `node tools/check-zip-perms.mjs <file>.zip` — verifies the archive and exits
   non-zero if any entry lacks correct permissions.
4. Control panel → File Manager → `public_html` → upload the zip → Extract.
5. Confirm the version at the bottom of the sidebar matches the release just
   published.

**What ships.** `.htaccess` (404 handling, gzip, cache headers), `manifest.json`,
`sw.js`, app icons. `sw.js` and `manifest.json` are explicitly **no-cache** so an
update reaches installed phones; hashed assets cache for a year. **No secrets** —
nothing in the deployed files can read or write data on its own.

**The `.png` trap.** Shared hosts commonly enable hotlink protection that blocks
image requests outright. Assume it: inline the logo and the favicon as `data:`
URIs in a generated `app/components/logoData.js`, inline the guide screenshots
(§7.15), and add `tools/check-nopng.mjs` which **simulates the block** — it fails
the build if the app makes any `.png` request while every one is answered with 403.
This is not hypothetical; it is why the logo is inline.

**Rollback.** Keep every release zip. To roll back, extract the previous zip over
`public_html`. Database migrations are separate and versioned, so a front-end
rollback does not touch stored data.

---

## 10. Verification you must deliver

No test framework, no fixtures. Write **standalone Playwright scripts** in
`tools/`, each named after the thing it guards, each with a header comment saying
**which specific failure** it exists to prevent. Run them against the real built
site served by `tools/serve-out.mjs` (which must mirror Apache's trailing-slash
resolution), screenshot into `tools/shots/` and `process.exit(1)` on failure.

```
node tools/serve-out.mjs &        # BASE=http://localhost:4321
node tools/check-pages-load.mjs
```

The minimum set, with what each must assert:

| Script | Assertion |
|---|---|
| `check-pages-load.mjs` | Signs in as an **administrator**, visits every route, fails on any visible "Error loading data" **and** on the register showing zero assets. A build succeeding says nothing about whether a page loads data; only loading it does. (Adding a second foreign-key path to the same table makes a PostgREST embed ambiguous and silently blanks whole pages — this is the script that catches it.) |
| `check-nopng.mjs` | No `.png` request is made while every one is answered 403 (§9). |
| `check-zip-perms.mjs` | Every entry in the deploy zip carries Unix `0644`/`0755`. |
| `check-rls.mjs` | Signs in as a **viewer**, then issues a hand-crafted PostgREST `PATCH` against `assets` and asserts it is **refused**. This is the only test that proves §3.3 is real. |
| `check-assign.mjs` | `GET` on an `/assign/` token URL writes **nothing** (re-read the row and the token), and the confirmation press writes exactly once. A second press is refused. |
| `check-allocate.mjs` | Two concurrent allocations of the same asset: one succeeds, one is refused by the partial unique index. |
| `check-receipt.mjs` | The public form returns a request number, the PDF downloads, and the archived copy is readable through a signed URL. |
| `check-audit.mjs` | An edit writes one `asset_audit` row **per changed field**, and no API call can delete one. |
| `check-mobile.mjs` / `check-desktop.mjs` | The register renders as cards on a phone viewport with **no horizontal page scroll**, and as a table on desktop. |
| `check-help.mjs` | Every `HelpLink` slug resolves to a heading in the generated guide. |
| `check-exports.mjs` | CSV and XLSX exports respect the current row selection. |

Keep a `tools/hooks/pre-commit` that runs the cheap ones.

---

## 11. Documentation you must produce

| File | Contents |
|---|---|
| `FEATURES.md` | What the system does, by area, **including the stated limitations** from §8. This is the document shown to management. |
| `USER_GUIDE.md` | The end-user guide, written in parts: requesting equipment (no login), for IT officers, for managers and administrators, common questions, who to contact. It is the **single source** for `/help` (§7.15) and the one exported to Word. |
| `CHANGELOG.md` | Every change, newest first. |
| `VERSION_HISTORY.md` | Releases, with dates and what shipped. |
| `EMAIL_PIPELINE.md` | §6 as operational documentation: the chain, how to change who is notified, how to rotate the API key, how to debug "no email arrived", how to test end to end. |
| `supabase/migrations/YYYYMMDD_*.sql` | One per change, each opening with a comment saying **why**. |
| `app/version.js` | `export const APP_VERSION = "1.0.0";` — the single version source, rendered in the sidebar. |
| `.env.local.example` | The two public vars, and the paragraph from §2.2 explaining why they are public and where real secrets live. |

---

## 12. Build order

Work in this order and the thing stands up at every step. Each phase is a sensible
place to stop and show someone.

1. **Schema.** `supabase/migrations/` — tables (§4.1–4.4), indexes, the three
   predicates and all policies (§5), triggers (§4.5), the two Storage buckets and
   their policies (§4.6). Verify with `check-rls.mjs` before any UI exists.
2. **Shell and auth.** `next.config.js`, Tailwind token layer, `lib/supabaseClient.js`,
   `ui.js`, `AuthProvider` + `AuthGate`, `AppShell`, the landing and login screens,
   `app/version.js`. Verify with `check-pages-load.mjs` against empty tables.
3. **The register.** `/` with KPI cards, filters, phone cards and desktop table,
   row expansion, audit history, CSV export. Then `/assets`.
4. **Allocation.** `allocate_asset` and the return path, `/allocate`, the
   assignment history, `trg_sync_asset_status`. Verify with `check-allocate.mjs`.
5. **The request flow.** `submit_equipment_request` with rate limiting, `/request`
   with photos and the PDF receipt, `/status`, `/entry` with the approval box and
   `trg_guard_asset_release`.
6. **Email.** Vault secrets, `get_notify_config()`, `notify_secret()`,
   `notify-new-request`, `notify-handover`, `notify-release`, `store-receipt`,
   `notify_log` + `logSend`, `assign_token` + `/assign`, `notify-guard.mjs`.
   Verify with `check-assign.mjs` **and** `check-receipt.mjs` under solo mode.
7. **The rest of the screens.** `/warranty`, `lib/alerts.js` + the bell + the
   briefing, `/analytics`, `/value`, `/manage` (incl. Notify Emails and Notify
   Health), `/staff` + the `manage-users` function, `/audit`.
8. **Docs and help.** `USER_GUIDE.md`, `tools/build-help.mjs`, `/help`,
   `FEATURES.md`, `EMAIL_PIPELINE.md`, `CHANGELOG.md`, `VERSION_HISTORY.md`.
9. **Packaging.** `tools/make-zip.mjs`, `check-zip-perms.mjs`, `check-nopng.mjs`,
   `.htaccess`, `manifest.json`, `sw.js`, icons. Then the full check suite.
10. **Optional, only if asked.** Web Push (§6.13); a `pg_cron` warranty digest
    (§6.11).

---

## Final instruction to the builder

Where this brief gives a reason for a constraint, **keep the reason as a comment in
the code**. Every one of them is a bug somebody already paid for: the trailing
slash, the Safe Links pre-fetch, the 20-second timeout, the no-FK audit, the
`security_invoker` view, the partial unique index, the `.png` block, the zip
permissions, the duplicated `logSend`.

A rule without its reason gets removed by the next person during a tidy-up.

