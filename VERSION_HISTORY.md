# Version history

Releases, with dates and what shipped. Every change is in `CHANGELOG.md`. The
version number lives in one place, `app/version.js`, and is shown at the foot
of the sidebar so the deployed build can be identified on screen.

| Version | Date | What shipped |
|---|---|---|
| 1.0.0 | 2026-10-07 | First release: IT Inventory (hardware, IT's 29-column sheet + Location, Excel import/export), IT Accessories and IT Fixed Assets listings with editable categories; asset register and history, allocation and return, equipment requests with approvals, warranty and refresh, analytics, asset value, data and user management, change log, in-app user guide. Email is off (Resend pending); the PDF request receipt archive runs. |

## Publishing a release

Publishing is manual and needs the hosting control panel. Nothing deploys
automatically.

1. Set the new version in `app/version.js` and add a row above.
2. `npm run build`. This also regenerates the user guide. If `npm run dev` is
   running, use `NEXT_DIST_DIR=out npm run build` instead: a plain build
   rewrites the `.next` folder the dev server is serving from.
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
