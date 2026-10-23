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

1. Register a normal subscriber at <http://127.0.0.1:3000/auth?mode=register>.
2. Confirm the address if Supabase email confirmation is enabled.
3. In Supabase SQL Editor, promote that one account by replacing the email:

   ```sql
   update public.profiles
   set role = 'super_admin'
   where id = (
     select id from auth.users
     where email = 'YOUR_ADMIN_EMAIL'
   );
   ```

4. Sign in at <http://127.0.0.1:3000/admin>. Admin-only routes recheck the
   current profile role in the database; the browser cannot grant itself a role.

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
