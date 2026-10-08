# Email pipeline

> **Status (2026-10-07): email is OFF.** IT dropped the Microsoft Graph route
> and will use **Resend** later. The four mail triggers are disabled
> (`20261007000600_email_paused.sql`) and the `notify_graph_*` secrets were
> deleted from Vault. The PDF receipt archive still runs. The `notify` function
> already sends through **Resend** (deployed v2, 2026-10-07). To go live:
> verify the domain in Resend, add `notify_resend_api_key` to Vault, set
> `notify_from` / `notify_app_url`, then `enable trigger` the four triggers.
> Sections below that mention Graph, Entra or Exchange describe the old route.

ITrack sends mail through **Microsoft Graph** from a Tomypak Microsoft 365
mailbox. There is no third-party mail service and no SMTP. Edge Functions
cannot open SMTP ports, and the site is static, so it has no server of its own.

## The chain

```
INSERT/UPDATE on equipment_request or asset_assignment
   │  trigger (trg_notify_*, trg_archive_request_receipt) → public.notify_trigger()
   ▼
public.notify_post()        pg_net, async, after COMMIT, 20 s timeout, errors swallowed
   ▼  POST /functions/v1/notify   header x-webhook-secret
Edge Function `notify`      reads Vault via get_notify_config()
   ├─ new_request → recipients with purpose equipment_request (+ Allocate / Assign buttons)
   ├─ release     → release_pending (mode pending) or release_decided
   ├─ handover    → the holder's own staff email (+ Confirm receipt button)
   └─ receipt     → PDF into the private `receipts` bucket (no email)
   ▼  client-credentials token, then POST graph.microsoft.com/v1.0/users/{mailbox}/sendMail
Exchange Online → inboxes
   │
   └─ every send is logged in notify_log (what Graph ACCEPTED, not what was delivered)
```

The buttons in an email go to `https://<site>/assign/?t=<token>`. Opening that
page writes **nothing**, because Safe Links opens every link before a person
does. The press calls the `assign-action` function, which calls
`public.assignment_link()`. Each token works once, lasts 7 days, and covers
one request (or one assignment) and one action.

## One-time setup

### 1. Sending mailbox

ITrack sends as the existing **`helpdesk@tomypak.com.my`** mailbox, so replies
reach the IT helpdesk. Mail is sent with `saveToSentItems: false`, so it does
not fill that mailbox's Sent Items.

### 2. App registration (Microsoft 365 / Entra admin)

1. Entra admin centre → **App registrations → New registration**. Name: `ITrack mail`,
   single tenant, no redirect URI.
2. Note the **Application (client) ID** and **Directory (tenant) ID**.
3. **Certificates & secrets → New client secret**. Copy the *value*.
   **Note the expiry date** (max 24 months). When the secret expires, mail
   stops. See *Rotating the secret* below.
4. **Do not** add the Graph `Mail.Send` application permission here. That
   would let the app send as *every* mailbox in the tenant. Grant it to the
   one mailbox in step 3 instead.

### 3. Limit the app to the one mailbox (Exchange Online PowerShell)

```powershell
Connect-ExchangeOnline
# ObjectId = Entra → Enterprise applications → ITrack mail → Object ID
New-ServicePrincipal -AppId <client-id> -ObjectId <enterprise-app-object-id> -DisplayName "ITrack mail"
New-ManagementScope -Name "ITrack sender" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'helpdesk@tomypak.com.my'"
New-ManagementRoleAssignment -App <client-id> -Role "Application Mail.Send" -CustomResourceScope "ITrack sender"
# Expect InScope = True for the mailbox, False for anyone else:
Test-ServicePrincipalAuthorization -Identity <client-id> -Resource helpdesk@tomypak.com.my
```

The change can take up to an hour to apply.

### 4. Vault secrets (Supabase → SQL editor)

```sql
select vault.create_secret('<long random string>', 'notify_webhook_secret');
select vault.create_secret('<tenant-id>',          'notify_graph_tenant_id');
select vault.create_secret('<client-id>',          'notify_graph_client_id');
select vault.create_secret('<client-secret value>','notify_graph_client_secret');
select vault.create_secret('helpdesk@tomypak.com.my','notify_from');
select vault.create_secret('https://<site domain>','notify_app_url');
```

Generate the webhook secret with e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
No secret is ever written into a function body or the website bundle.

### 5. Deploy

1. Run `supabase/migrations/20261006000300_notify.sql` in the SQL editor.
2. Deploy the Edge Function `notify` with both files (`index.ts`,
   `receipt-pdf.js`). Turn **Verify JWT OFF**, because the caller is the
   database, not a user. The webhook secret is the only protection, and it
   is enough.
3. Deploy `assign-action`. Verify JWT can stay on.

With the CLI: `supabase functions deploy notify --no-verify-jwt` and `supabase functions deploy assign-action`.

### 6. Who is notified

Go to **Data Management → Notify Emails** and add an address per purpose. No
redeploy is needed. Being an administrator does **not** add anyone to a list.

| purpose | who |
|---|---|
| `equipment_request` | IT HOD and managers (new request arrived) |
| `release_pending` | the asset custodian (a release needs a decision) |
| `release_decided` | the requester's manager and IT (approved or rejected) |

Handover mail goes to the holder's own `staff.email` and does not use these
lists. It is not sent when the holder has no real email, or when an officer
issues an asset to themselves.

## "No email arrived": what to check, in order

1. **Data Management → Notify Health / `notify_log`**. A failed row's `error`
   shows Graph's reply:
   - `token: ... AADSTS7000215` means the client secret is wrong or expired.
   - `403 ErrorAccessDenied` means step 3 (mailbox scope) is missing, or has
     not applied yet.
   - `404` means `notify_from` is not a real mailbox.
2. **No row at all.** Look at the function logs (Supabase → Edge Functions →
   notify → Logs). A `401` means the `notify_webhook_secret` in Vault does not
   match. Also check whether anyone is on the recipient list. Zero recipients
   returns `{ok:false, reason:"no active recipients"}` and logs nothing.
3. **No function call at all.** Run `select * from net._http_response order by created desc limit 20;`
   (pruned automatically after a few hours).
4. **Logged ok but not in the inbox.** Check Exchange admin centre → **Message
   trace** for the recipient. `notify_log.provider_id` is Graph's `request-id`.
   Every message carries the header `X-ITrack-Notify: 8e48692da63ee9d16e6c32e0`,
   which a mail-flow rule can match on.

## Rotating the secret

Create a new client secret in Entra, then run
`select vault.update_secret((select id from vault.secrets where name = 'notify_graph_client_secret'), '<new value>');`
and delete the old secret. Nothing needs redeploying.
The webhook secret rotates the same way.

## Testing without mailing the department

```
node tools/notify-guard.mjs status
node tools/notify-guard.mjs solo you@tomypak.com.my    # only you get mail
node tools/notify-guard.mjs restore
```

`check-assign.mjs` and `check-receipt.mjs` switch solo mode on and off
themselves (set `ADMIN_ID`, `ADMIN_PASSWORD`, `SOLO_EMAIL`). `check-assign.mjs`
also needs the site running (`node tools/serve-out.mjs`).

## Not email, on purpose

There is no scheduled digest. Expiring warranties, overdue refreshes and old
requests are shown in the app (the bell and the sign-in briefing). A nightly
mail nobody asked for teaches people to filter the sender, and the mail that
matters gets filtered with it.
