# CHOWK NEWS

A local-first Node.js news portal backed by the user's Supabase project. The app
serves the website and its API from one Node.js process. It does not depend on
the old Chowk API.

## Local setup

Requires Node.js 18 or newer.

1. Copy `.env.example` to `.env`.
2. In Supabase, open **Project Settings → API Keys** and copy the Project URL
   and the **publishable** key (the legacy `anon` key is also accepted). Put
   those values only in `.env`:

   ```dotenv
   SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
   ```

   Never use a `service_role` or `sb_secret_...` key in the browser, this app,
   or Git. The Node server uses only the publishable/anon key; PostgreSQL RLS
   enforces access.

3. In the Supabase dashboard for the blank Chowk project, open **SQL Editor**,
   create a new query, paste `supabase/migrations/0001_chowk_portal.sql`, and
   run it. This creates the profiles, categories, and articles tables, signup
   profile trigger, role helper, and RLS policies. The app does not run SQL
   migrations automatically.
   Then run the additive migrations in order:
   `supabase/migrations/0002_admin_foundation.sql` and
   `supabase/migrations/0003_newsroom_modules.sql`, followed by
   `supabase/migrations/0004_audit_history.sql` and
   `supabase/migrations/0005_reporter_lifecycle.sql` and
   `supabase/migrations/0006_editorial_workflow.sql` and
   `supabase/migrations/0007_newsroom_operations.sql` and
   `supabase/migrations/0008_reporter_location_parity.sql`,
   `supabase/migrations/0009_reporter_registration_workflow.sql`,
   `supabase/migrations/0010_reporter_onboarding.sql`,
   `supabase/migrations/0011_reporter_application_intake.sql`, and
   `supabase/migrations/0012_reporter_organization_profile.sql`, and
   `supabase/migrations/0013_reporter_agreement_admin_controls.sql`. These add account email
   and role support, admin account settings, newsroom management tables, RLS
   policies, detailed audit history, the reporter lifecycle, editorial
   workflow, staff notifications, secured media storage, location hierarchy
   validation, and scheduled publication processing. Migration 0008 separates
   zones and districts beneath each state, preserves zone/district mappings as
   dated history, treats coverage areas as divisions under districts or cities,
   and connects admin reporter assignment updates and staff coverage to that
   hierarchy. Migration 0009 seeds states, the legacy Uttar Pradesh RTO
   reporting areas, and the Tehsil Reporter type. Migration 0010 separates
   account signup from reporter applications, adds applicant-visible
   information requests, versioned service-agreement acceptance, and requires
   authority-letter acknowledgement before an approved reporter receives the
   reporter role. Migration 0011 keeps application intake open when no finalized
   agreement is published and records the applicant's accuracy confirmation;
   it does not treat the supplied draft agreement as accepted. Migration 0012
   adds the admin-only organization legal profile with clearly labeled demo
   values and blocks publishing new agreement versions until an admin verifies
   the profile. Finalized agreements remain lawyer-reviewed documents; profile
   values are not merged into or used to generate PDF text. Migration 0013 adds
   admin PDF uploads to private Supabase Storage, server-calculated SHA-256
   hashes, previewable immutable versions, publish/archive controls, scoped
   signed links for published or accepted PDFs, and protections against
   modifying or deleting recorded agreement versions. Existing
   installations must run all additive migrations in order before deploying
   these features.
4. Start the portal:

   ```powershell
   npm start
   ```

   Open <http://127.0.0.1:3000>. `npm run dev` restarts the server on changes.
   The process health endpoint is <http://127.0.0.1:3000/healthz>; it confirms
   the Node.js process is responding, not that Supabase credentials or the schema
   are configured.

The SQL migrations are additive, but inspect them before running; they install a trigger on
`auth.users` to create a subscriber profile when a Supabase Auth account is
created.

## First admin account

Use the local bootstrap command to create or promote the account without
copying privileged credentials into the website. In Supabase, get the database
connection URI from **Connect → Session pooler** (recommended if direct
connections are not available). The database password is distinct from the
publishable key; enter the URI only at the script's masked local prompt. It is
not saved in `.env` or in the deployed app.

If the local bootstrap reports a self-signed certificate error, download the
CA certificate from **Project Settings → Database → SSL Configuration**. Save
it locally outside Git and add its path to the ignored `.env`, for example:

```dotenv
SUPABASE_DB_SSL_CA=C:\Users\YOUR_NAME\Downloads\prod-ca-2021.crt
```

The bootstrap verifies the server certificate against this CA; do not disable
TLS verification.

Run this in a local terminal from the project folder:

```powershell
npm run admin:bootstrap
```

The script asks you to confirm the configured project, enter the email/name/
phone for the admin, and enter a password using masked terminal input. It
applies the Chowk schema, creates the Supabase Auth account if needed, verifies
the password locally against Supabase if that email already exists, and
promotes only that account to `super_admin`. If email confirmation is enabled,
confirm the message before signing in. Then use
<http://127.0.0.1:3000/admin>. Admin routes continue to verify the role from
the database; the browser cannot grant itself access.

The command uses the database connection URI only in this local, one-time
provisioning tool. The deployed web app continues to use only the publishable
key and authenticated user tokens.

## Current Supabase-backed features

- Public published-news feed, category list, search, and category filtering.
- Supabase email/password subscriber registration and login.
- Short-lived HTTP-only, SameSite session cookies with Supabase refresh-token
  rotation kept server-side.
- Protected admin login, newsroom overview, article/category CRUD, user
  provisioning and role changes through a restricted database function,
  profile editing, and password updates.
- Admin management screens for reporter application review, moderation of
  article reports and comments, media catalog entries, YouTube stream listings,
  locations, reporter types, and searchable, paginated, read-only audit history
  with actor snapshots, request context, reasons, before/after field diffs, and
  CSV export of up to 10,000 filtered events per export.
- Reporter desk for signed-in applicants to submit and track applications,
  accept updated application-agreement versions, review and accept a separate
  published service/appointment agreement after approval, view stable reporter
  IDs and assignment history, print their own credentials, and acknowledge
  authority letters. Public credential verification exposes only the credential
  record, status, and limited identity/scope details.
- Reporter administration for application review, state/RTO/type-code setup,
  stable reporter ID allocation, assignment and coverage history, versioned
  agreement PDF uploads, preview, immutable versioning, publish/archive
  controls, organization-profile verification, staff ID/authority-letter
  issuance, revocation, and expanded audit filtering.
- Role-specific reporter, moderator, editor, and publisher workspaces for
  drafting, coverage-scoped moderation, editorial review, scheduling,
  publishing, revisions, and workflow history. Story changes are authorized by
  database RPCs; admins use audited reasons for article edits and publication
  overrides.
- Reporter media upload (images, video, and audio up to 25 MB) to a dedicated
  Supabase Storage bucket, private staff inbox notifications, a printable
  daily submission report, hierarchical location selection/validation, and
  printable staff credentials with a locally generated QR verification code.
- RLS policies restrict public reads to published news and media and active
  categories.
  Profile roles are assigned as `subscriber` on signup; users cannot self-promote.
- Public web pages expose published Patrika, Charcha, and podcast catalogue
  entries at `/chowk-patrika`, `/chowk-charcha`, and `/podcasts`. The `/legal`
  pages list the legacy policy titles, but do not publish their draft text until
  the legal placeholders are completed and the documents are approved.

Reporter applications remain open while legal documents are being finalized.
In Admin → Reporter setup, replace and verify the organization legal profile
before publishing new application or service agreements. In each agreement
manager, upload the signed-off PDF; the server calculates its SHA-256 and stores
the document. The supplied draft PDF remains preview-only. Verify the contents
of any agreements already published before migration 0012 separately.
In the application and service agreement screens, upload and preview finalized
PDF drafts, publish the version reporters should accept, and archive outdated
versions. Published documents and their SHA-256 values are immutable; upload a
new version to make corrections or replace an agreement. Archiving the current
version stops new acceptances but does not erase historical acceptance records
or revoke existing reporter access.
Review the seeded states, legacy Uttar Pradesh RTOs, and Tehsil Reporter type;
add RTO/reporting areas for other states as needed. Applicants create and
verify a subscriber account, then submit their state, RTO/reporting area, and
reporter type from the reporter desk. If a finalized application agreement is
published, it is shown for acceptance during application; otherwise the desk
shows the supplied Reporter Engagement Agreement as an explicitly labeled
draft preview and records no legal acceptance. Admins review the application,
request information, or approve/reject it. Approval creates the stable reporter
code and assignment but does not activate newsroom access. A finalized service
agreement must be accepted before credentials can be issued; the reporter
acknowledges the valid authority letter before their account becomes a
reporter. Admins cannot create or directly promote reporter accounts; they can
update assignments for reporters who have completed onboarding. The recorded
company approval checkbox is an audit attestation, not a digital signature.
Coverage and reporter assignments are retained as dated history. Applying the
SQL migrations is a manual Supabase dashboard step; run migrations 0001 through
0013 in order before deploying the expanded newsroom workspace. Migration 0008 adds
legacy-compatible zone/district mapping and coverage. Migration 0007
provisions public media reads and per-user upload ownership; it also schedules
due-article processing when `pg_cron` is available. If the extension is
unavailable, enable it or schedule `public.chowk_process_due_articles()`
through a trusted server-side scheduler. AI moderation and official-feed review have not been
ported. AI moderation processes article data with an external provider in the
legacy system and must not be enabled until provider configuration and explicit
data-processing approval are in place. YouTube stream entries reference videos;
they do not start a broadcast. Test the migration and workflows in a
non-production Supabase project first.

## Environment and deployment

`.env` is ignored by Git. `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` must be
set in Hostinger's private application environment before deployment. Do not
commit `.env`, database passwords, service-role keys, or other secrets. Keep
local development on the same project only while it is still empty or after
confirming its data is backed up.

Configure Hostinger to deploy the dedicated Chowk portal repository with
`npm start`. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and
`NODE_ENV=production` in the hosting environment, install dependencies with
`npm ci`, and use the host-provided `PORT`. Do not upload `.env` or commit it
to Git.
