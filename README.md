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
   `supabase/migrations/0007_newsroom_operations.sql`. These add account email
   and role support, admin account settings, newsroom management tables, RLS
   policies, detailed audit history, the reporter lifecycle, editorial
   workflow, staff notifications, secured media storage, location hierarchy
   validation, and scheduled publication processing. Existing installations
   must run all additive migrations in order before deploying these features.
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
  accept updated agreement versions, view stable reporter IDs and assignment
  history, and acknowledge authority letters. Public credential verification
  exposes only the credential record, status, and limited identity/scope details.
- Reporter administration for application review, state/RTO/type-code setup,
  stable reporter ID allocation, assignment and coverage history, versioned
  agreement publication, staff ID/authority-letter issuance, revocation, and
  expanded audit filtering.
- Role-specific reporter, moderator, editor, and publisher workspaces for
  drafting, coverage-scoped moderation, editorial review, scheduling,
  publishing, revisions, and workflow history. Story changes are authorized by
  database RPCs; admins use audited reasons for article edits and publication
  overrides.
- Reporter media upload (images, video, and audio up to 25 MB) to a dedicated
  Supabase Storage bucket, private staff inbox notifications, a printable
  daily submission report, hierarchical location selection/validation, and
  printable staff credentials with a locally generated QR verification code.
- RLS policies restrict public reads to published news and active categories.
  Profile roles are assigned as `subscriber` on signup; users cannot self-promote.

Before accepting reporter applications, configure active states, RTOs, and
reporter types, add the agreement document URL and its exact SHA-256, then
publish that agreement in the admin console. New installations have no
preconfigured states or RTOs. The reporter code is allocated on approval and
remains stable across future assignments. Coverage and reporter assignments
are retained as dated history. Applying the SQL migrations is a manual
Supabase dashboard step; run migrations 0001 through 0007 in order before
deploying the expanded newsroom workspace. Migration 0007 provisions public
media reads and per-user upload ownership; it also schedules due-article
processing when `pg_cron` is available. If the extension is unavailable,
enable it or schedule `public.chowk_process_due_articles()` through a trusted
server-side scheduler. AI moderation and official-feed review have not been
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
