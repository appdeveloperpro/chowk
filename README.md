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
4. Start the portal:

   ```powershell
   npm start
   ```

   Open <http://127.0.0.1:3000>. `npm run dev` restarts the server on changes.
   The process health endpoint is <http://127.0.0.1:3000/healthz>; it confirms
   the Node.js process is responding, not that Supabase credentials or the schema
   are configured.

The screenshot showed a blank production project with no migrations. The SQL
file is additive, but inspect it before running; it installs a trigger on
`auth.users` to create a subscriber profile when a Supabase Auth account is
created.

## First admin account

Use the local bootstrap command to create or promote the account without
copying privileged credentials into the website. In Supabase, get the database
connection URI from **Connect → Session pooler** (recommended if direct
connections are not available). The database password is distinct from the
publishable key; enter the URI only at the script's masked local prompt. It is
not saved in `.env` or in the deployed app.

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
- Protected admin login, overview, article/category management, and role
  changes through a restricted database function.
- RLS policies restrict public reads to published news and active categories.
  Profile roles are assigned as `subscriber` on signup; users cannot self-promote.

Reporter applications, media storage, comments, live streams, and the remaining
legacy Flutter newsroom modules are not implemented in this first Supabase
portal version. The admin interface only shows modules backed by real routes.

## Environment and deployment

`.env` is ignored by Git. `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` must be
set in Hostinger's private application environment before deployment. Do not
commit `.env`, database passwords, service-role keys, or other secrets. Keep
local development on the same project only while it is still empty or after
confirming its data is backed up.

The current workspace does not yet have Git metadata or a connected GitHub
repository. After local Supabase tests pass, connect this folder to a dedicated
Chowk portal repository and configure Hostinger to deploy that repository with
`npm start`. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and
`NODE_ENV=production` in the hosting environment, install dependencies with
`npm ci`, and use the host-provided `PORT`. Do not upload `.env` or commit it
to Git.
