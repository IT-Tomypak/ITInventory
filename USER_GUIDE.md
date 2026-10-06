# ITrack User Guide

ITrack is Tomypak's register of IT hardware: what the company owns, who holds
it, and every request for new equipment. This guide is also inside ITrack, under
**Help & User Guide**.

## Part 1: Requesting equipment (no login)

Anyone in the company can ask IT for hardware. You do not need an ITrack account.

### Request equipment

1. Open ITrack and choose **I Need Equipment**.
2. Fill in **Your name** and **Department**. Use your name as it appears in the
   staff list; IT uses it to match the request to you.
3. Under **What do you need?** pick the type of item (laptop, monitor, printer…).
4. Choose **Normal** or **Urgent**, and say **Why do you need it?**. A sentence
   or two helps IT decide quickly.
5. Optionally attach up to 4 photos, for example of a broken item. On a phone,
   **Camera** opens the camera directly.
6. Press **Send request**.

You get a **receipt** with your request number. Press **Download receipt** to
keep a PDF copy, and quote the number whenever you contact IT.

> The form is for hardware only. For software, email or account problems,
> contact IT directly.

If the form says you have sent too many requests, wait an hour or call IT.
Each name can send 5 requests an hour, to stop the form being flooded.

### Track your request

Choose **Track this request** on your receipt, or open **Track your request**
from the request page, and type your request number. You will see the status,
the dates, and whether the item has been delivered and its receipt confirmed.

| Status | Meaning |
|---|---|
| Requested | IT has your request and has not acted on it yet. |
| Approved | IT has agreed to supply the item. |
| Allocated | A specific item has been set aside for you. |
| Delivered | The item has been handed over. |
| Rejected / Cancelled | The request is closed. Contact IT if you need to know why. |

### Confirm you received an item

When IT issues an item to you, you get an email from the IT helpdesk titled
**"… has been issued to you"**. Check the item, then press **Confirm receipt**
in the email. ITrack asks for your **ID number** as a signature, then records
that you received it.

The link works once and expires after 7 days. Opening it does nothing on its
own; only pressing the button records anything.

## Part 2: For IT officers

### Signing in

Choose **IT Department**, then sign in with your **ID number** and password.
There is no "forgot password" email: if you forget it, ask an administrator to
set a new one.

Press **Ctrl K** (or **Search** in the header) to jump to any page, asset or
person by typing.

### Asset Register

The home page lists every IT item the company owns, live from the database.

- The **cards** at the top count assets by status. Press one to filter by it.
- **Search** finds tag, serial, make, model or holder. **Filters** narrows by
  type, status, department, location and warranty.
- **Register asset** adds a new item. **Open / Update** (or a row) shows the full
  record: details, photos, current and past holders, and the history of every
  change.
- Tick rows to **Change status…** or delete several at once. Deleting needs you
  to **press and hold** the button, so it cannot happen by a stray click.
- **Export CSV** exports the ticked rows, or every row matching the filters if
  none are ticked.

Statuses are **In stock**, **Assigned**, **Loaned**, **In repair**, **Retired**
and **Lost/Stolen**. Assigned and Loaned are set by Allocate / Return, not by hand.

### Allocate / Return

Every hand-over and every return goes through this page, so the register always
knows who holds what.

**Check out** (issue an item):

1. **Asset to issue**: search by tag, serial, make or model. Only items that are
   In stock appear.
2. **Holder**: pick a **Person**, or a **Location** for shared equipment.
3. **Details**: the issue date, the **Condition out** (e.g. "with charger and
   bag"), and optionally the request it fulfils. Setting **Due back** makes it a
   loan.
4. Press **Issue asset** (or **Loan asset**).

If the person has an email address in their staff record, they receive a
handover email asking them to confirm receipt.

**Check in** (take an item back): pick the **Asset to return**, set the
**Returned on** date and **Condition in**, and choose where it **Goes back to**:
In stock, or In repair.

Two people cannot issue the same item at once; the second gets a clear message.

### Equipment Request

The queue of every open request, from the public form and from staff.

- **New equipment request** raises one on someone's behalf.
- **Set status…** moves a request on: Requested → Approved → Allocated →
  Delivered. Setting Delivered records the date.
- **Assign handler…** makes an officer responsible for it.
- **Allocate** opens Allocate / Return with the request already filled in.
- **Ask for release** sends the request to the asset custodian for a release
  decision (see [Release decisions](/help/#release-decisions)).
- Tick **Show delivered and closed** to see finished requests.

**From your inbox.** IT managers receive an email for each new request. It can
carry **Allocate** buttons (in-stock items of the right type) and **Assign**
buttons (officers). Pressing one opens a page that shows exactly what will
happen and asks you to **Confirm**. Nothing happens until you press it, and
each email link works once, for 7 days.

### Warranty & Refresh

Four lists: warranties **Expired**, warranties **expiring** in the next 30, 60
or 90 days, **Refresh overdue**, and **Refresh due this year**. Each row opens
the asset. Export to CSV or Excel for purchasing.

The **bell** in the header shows the same items, so the two never disagree.

### Analytics

Charts of the active assets: by type, status and department, age, purchases per
month, warranties ending per quarter, and how often items change hands. Under
each chart, **Show as table** gives the figures.

### Asset History

Look up everything that ever happened to an item, including deleted ones: every
holder with condition notes, every change, and every request it was allocated
against.

Search by tag, serial, make or model. Use `*` as a wildcard: `IT-02*` finds
every tag starting IT-02; `*` on its own lists everything.

## Part 3: For approvers, managers and administrators

### Access levels

| Access level | Who | Can do |
|---|---|---|
| Officer (default) | IT officers | Register, Allocate / Return, Equipment Request, Asset History. |
| Approver | Asset custodian | Everything an officer can, plus **approve or reject a release**. |
| Viewer | Supervisors, auditors | Read everything operational, change nothing. May still raise a request. |
| Admin | IT manager | Everything except release decisions, plus Asset Value, Data Management, User Management and Change Log. |
| Super admin | IT HOD | Everything, including release decisions. |

The access level is not the job title. Both are set in User Management.

### Release decisions

When an officer presses **Ask for release**, the custodian receives an email,
and the request appears under **Equipment Request → Approvals** with a count on
the menu. If something is waiting when an approver signs in, ITrack opens
that view for them.

To decide, add remarks (required to reject), type **your own ID number** as a
signature, and press **Approve release** or **Reject**. The requester's manager
and IT are emailed the outcome. The decision is only ever made in ITrack, never
from an email, so it always carries a signed-in name.

### Asset Value

_Administrators only._ Purchase cost and today's book value by department and
asset type, purchases per month, and value at year end. Book value is
straight-line depreciation over the item's refresh period. Items with no
recorded cost are counted separately so the totals are not misleading.

### Data Management

_Administrators only._ The lists behind the rest of ITrack: **Locations**,
**Vendors**, **Staff** records and **Notify Emails**.

- **Notify Emails** decides who is emailed, by purpose: _New equipment request_,
  _Release waiting for decision_ and _Release decided_. Being an administrator
  does not add you to any list; add your address for the purposes you want.
- **Notify Health** shows the last 7 days of email: sent, failed, and why.
  "Accepted by mail provider" means Microsoft accepted the message, not that it
  reached the inbox. To trace one, use **Message trace** in the Exchange admin
  centre.

A staff record's **Eligible** setting decides whether they can be made a request
handler. **Use the department rule** means "yes if their department is IT".

### User Management

_Administrators only._ Logins and staff records on one screen.

- **Add user** creates the login and the staff record together. The ID number
  is the login; ITrack shows the sign-in address it generates before you save.
- Give an **email address** if the person should get handover emails.
- **Access level** and **Job title** are separate. See
  [Access levels](/help/#access-levels).
- **Set password** gives someone a new password. Tell them in person; there is
  no reset email.
- **Disable**, never delete. A disabled account cannot sign in, keeps its
  history, and can be **Re-enabled**.

You cannot remove your own admin access or disable yourself, and the last
active administrator cannot be demoted or disabled.

### Change Log

_Administrators only._ One read-only feed of sign-ins, account changes and
every change to an asset, newest first. Filter by category, person and date.
Nothing in it can be edited or deleted.

### Sign-in briefing

Administrators see a short **Needs attention** summary once per sign-in:
expiring warranties, overdue refreshes, and requests left untouched. The bell
keeps the same list for the rest of the session.

## Common questions

### I forgot my password

Ask an ITrack administrator to set a new one in User Management. There is no
reset email, because sign-in uses your ID number, not an email address.

### The item I want to issue is not in the list

Only **In stock** items can be issued. Check its status on the Asset Register;
if it is still held by someone, check it in first.

### Someone did not get the handover email

Their staff record needs a real email address (User Management or Data
Management → Staff). No email is sent when you issue an item to yourself.

### An email button says the link was already used or has expired

Each link works once and for 7 days. Do the same thing in ITrack instead: the
email's **Open in ITrack** button takes you to the queue.

### Is email guaranteed?

No. Email is best effort: a request is always saved, even when the email
cannot be sent. Check **Notify Health** if mail seems to be missing, and do not
put confidential information in a request.

## Who to contact

For help with ITrack, a forgotten password or a new account, contact the IT
Department (IT helpdesk, `helpdesk@tomypak.com.my`). Quote the request number
or asset tag if you have one.
