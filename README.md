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
   SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
   ```

   The service-role key is required only for permanent admin user deletion. Keep
   it in the server environment only; never expose it to browser code or commit
   it to Git. Normal database requests continue to use the publishable/anon key
   with PostgreSQL RLS.

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
   `supabase/migrations/0013_reporter_agreement_admin_controls.sql`, and
   `supabase/migrations/0014_dynamic_reporter_agreements.sql`, and
   `supabase/migrations/0015_reporter_application_documents.sql`, and
   `supabase/migrations/0016_required_reporter_coverage_locations.sql`, and
   `supabase/migrations/0017_reporter_application_admin_controls.sql`, and
   `supabase/migrations/0018_admin_location_range_level.sql`, and
   `supabase/migrations/0019_range_locations_require_zone_parent.sql`, and
   `supabase/migrations/0020_district_range_mappings.sql`,
   `supabase/migrations/0021_cascade_location_deactivation.sql`, and
   `supabase/migrations/0022_bidirectional_location_activation.sql`, and
   `supabase/migrations/0023_sync_range_location_activation.sql`, and
   `supabase/migrations/0024_enforce_location_tree.sql`, and
   `supabase/migrations/0025_enforce_zone_consistent_coverage.sql`, and
   `supabase/migrations/0026_allow_location_deactivation.sql`, and
   `supabase/migrations/0027_add_region_location_level.sql`, and
   `supabase/migrations/0028_district_rto_codes.sql`, and
   `supabase/migrations/0029_reporter_region_district_application.sql`, and
   `supabase/migrations/0030_backfill_reporter_district_rto_links.sql`, and
   `supabase/migrations/0031_fix_reporter_district_state_rto_mapping.sql`. These add account email
   and role support, admin account settings, newsroom management tables, RLS
   policies, detailed audit history, the reporter lifecycle, editorial
   workflow, staff notifications, secured media storage, location hierarchy
   validation, and scheduled publication processing. Migration 0008 separates
   zones and districts beneath each state, preserves zone/district mappings as
   dated history, treats coverage areas as divisions under districts or cities,
   and connects admin reporter assignment updates and staff coverage to that
   hierarchy. Migration 0009 seeds states, the legacy Uttar Pradesh RTO
   reporting areas, and the legacy Tehsil Reporter reporter-ID category. Migration 0010 separates
   account signup from reporter applications, adds applicant-visible
   information requests, versioned service-agreement acceptance, and requires
   authority-letter acknowledgement before an approved reporter receives the
   reporter role. Migration 0011 keeps application intake open when no finalized
   agreement is published and records the applicant's accuracy confirmation;
   it does not treat an unpublished template as accepted. Migration 0012
   adds the admin-only organization legal profile with clearly labeled demo
   values and blocks publishing new agreement versions until an admin verifies
   the profile. Migration 0013 adds private storage and immutable version controls
   for uploaded reporter service-agreement PDFs. Migration 0014 adds editable,
   immutable application-agreement templates and server-generated personalized
   PDFs. Migration 0042 retires application-agreement acceptance while
   preserving historical records, makes application submission require only
   the applicant's accuracy confirmation, and requires acceptance of the exact
   admin-issued service-agreement PDF before issuing reporter credentials. The
   existing engagement-agreement text is reused as the initial service-agreement
   draft format, populated with verified company and approved reporter details,
   then previewed and issued by an admin. Migration 0015 adds the multi-step
   reporter application, profile-photo cropping, emergency contact and
   reporting-profile fields, masked-Aadhaar/PAN/bank-proof uploads, bank
   account details, and a private storage bucket with admin-only review access
   for sensitive uploads. Applicants must upload a masked Aadhaar copy only;
   never accept an unmasked copy. Migration 0016 makes preferred reporting
   locations mandatory while leaving existing application records intact.
   Migration 0017 adds audited admin deletion for applications that have not
   been approved; migration 0052 extends this to approved applications while
   ending reporter access and revoking credentials. Migration
   0018 adds Range as a parentable level in the admin newsroom location
   directory without changing the separate State and City/RTO reporter data.
   Migration 0019 requires new or updated range locations to have an active
   zone as their parent. Migration 0020 adds audited district-to-range mapping
   history and keeps zone coverage effective for districts mapped through a
   range. Migration 0021 cascades deactivation to descendants. Migration 0022 makes
   activation and deactivation bidirectional: changing a parent immediately
   updates all physical descendants and mapped districts; reactivation turns
   every descendant back on and restores the latest district mapping while
   preserving prior mapping history. It also restores inactive descendants
   during migration. Migration 0023 repairs range cascades by following the
   latest district mapping history even when a mapping was previously ended,
   and synchronizes mapping history with deactivation and reactivation.
   Migration 0024 makes the physical location tree State > Zone > Range >
   District > Coverage area, moves districts to their latest assigned range,
   and makes parent activation cascades follow that tree directly. New city
   location records are blocked; legacy city records are retained, as are
   the separate state, RTO code, and city-name fields used for reporter IDs.
   Districts without a saved range assignment remain visible in the admin
   "Districts needing a range" tab until assigned.
   Migration 0025 requires district-to-range assignments to stay within the
   district's latest mapped zone by default. An admin can explicitly confirm a
   cross-zone transfer; both zone and range mapping histories are then retained.
   The migration repairs mismatched parents when matching range history exists
   and stops with affected district IDs if it cannot safely repair them.
   Zone-level staff coverage also includes active legacy districts that still
   lack a range when their latest saved zone mapping identifies that zone,
   including descendant coverage areas. Districts with no zone mapping must be
   assigned to a range before they can inherit zone coverage.
   Migration 0026 allows location deactivation cascades to close historical
   district/range assignments even after the affected District or Range becomes
   inactive. New assignments still require active locations and a valid
   hierarchy. Migration 0027 adds Region between State and Zone, reparents
   existing Zones under an explicitly named "Unassigned Region" for each State
   that has direct-child Zones, and adds Region-level newsroom coverage.
   Administrators should move Zones into correctly named Regions as regional
   boundaries are confirmed; the migration does not guess real-world groupings.
   Region coverage can include its descendant Zones, Ranges, Districts,
   Coverage areas, and mapped legacy Districts when descendant coverage is
   enabled. State/RTO/city-name records used to generate reporter IDs are
   unchanged. Migration 0028 adds an RTO-code field to Districts and
   automatically links that code to the existing `rto_offices` table,
   reusing a matching State/code row or creating one when needed. The
   pre-seeded State and Uttar Pradesh RTO records from migration 0009 remain
   available; no separate RTO-code store is introduced.
   Migration 0029 updates the reporter application location step to use active
   State > named Region > District choices. The District's linked RTO code is
   displayed and used automatically; applicants do not enter it. The database
   and application API reject District selections outside the selected active
   hierarchy. The reporter ID is still generated after admin approval.
   Migration 0030 safely links existing Districts to existing active RTO offices
   only when their State and District/city names match uniquely. Ambiguous or
   unmatched records are left unchanged for administrator review.
   Migration 0031 fixes the District-to-State mapping used by RTO synchronization
   (location IDs are not State IDs), repairs linked RTO rows and references, and
   normalizes a State-prefixed RTO input (for example, `UP80` to `80`) to prevent
   duplicate State prefixes in reporter IDs. Migration 0032 makes coverage
   optional and stores Aadhaar front and back separately; 0033 adds the optional
   coverage-area field. Migrations 0034–0037 add targeted review requests and
   resubmission of only the requested fields/documents. Migration 0038 adds
   parent names and permanent-address fields. Migration 0039 adds personalized
   service-agreement templates and acceptance receipts; 0040 stores age
   calculated at the application date; 0041 adds admin-issued, per-reporter
   service-agreement PDFs and gates credential issuance on acceptance of the
   current issued copy. Migration 0051 repairs persistence of required reporter
   mobile, date-of-birth and Coverage Area fields. Migration 0052 permits
   confirmed deletion of approved reporter applications while revoking access
   and credentials. Migration 0053 enables admin deletion of non-super-admin
   accounts, cascades account-owned records, and retains audit/history records
   where their foreign keys already support anonymization. Apply 0051, 0052
   and 0053 in order.
   Existing installations must run all additive migrations in order before
   deploying these features.
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
  locations, reporter designations, and searchable, paginated, read-only audit history
  with actor snapshots, request context, reasons, before/after field diffs, and
  CSV export of up to 10,000 filtered events per export.
- Reporter desk for signed-in applicants to submit and track applications,
  review and accept the personalized service/appointment agreement issued after
  approval, view stable reporter IDs and assignment history, print their own
  credentials, and acknowledge authority letters. Public credential
  verification exposes only the credential record, status, and limited
  identity/scope details.
- Reporter administration for application review, state/RTO/reporter-ID category-code setup,
  stable reporter ID allocation, assignment and coverage history, personalized
  service-agreement template editing and generated-PDF previews, immutable
  versioning,
  publish/archive controls, organization-profile verification, restricted
  review of applicant identity and bank documents, staff ID/authority-letter
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
In Admin → Service agreement setup, replace and verify the organization legal
profile and maintain the single active service-agreement template. There is one
reporter contract workflow: the application collects and confirms reporter details; it does not
ask for contract acceptance. After approval, an administrator prepares a
personalized service-agreement PDF from the verified company profile and the
reporter's approved application, previews it, and explicitly issues that exact
copy to the reporter. The reporter can view and download the PDF and must accept
that issued copy. The database retains the issue, exact PDF hash, agreement
version, signer, and acceptance timestamp. ID-card and authority-letter issuance
requires acceptance of the current issued agreement. The service template
editor starts with the existing Reporter Engagement Agreement format and
inserts verified database details; it does not draft or approve legal terms.
Square-bracket legal/business placeholders must be finalized by the company and
reviewed by counsel before publication. Editing and publishing replaces the
active template for future issues, while previous versions and issued or
accepted PDFs remain retained as legal history. To prepare an agreement, open
the approved reporter's application and use **Preview / issue agreement**.
Reporter designation is a position label, separate from account permissions.
The admin must choose an active designation in the approval dialog; its
two-digit code is used for new reporter IDs and the designation itself is
included in the personalized service-agreement PDF. New reporter IDs use the
format `state-RTO-code-number`, for example `up-80-01-0001`. Admins configure
a unique two-digit code in **Reporter designations**, similar to the old
reporter-type code. The legacy reporter-type field remains separate and does
not determine the ID code. Codes are used with a per-RTO sequence, and old
reporter IDs are never rewritten when a code changes. Admins can add and edit
designations and deactivate labels that should no longer be offered for new
assignments; existing reporter and agreement history is retained. The
agreement template explains that designation is an
administrative newsroom title that may change based on performance or newsroom
needs, without by itself changing compensation or other agreement terms.
Review this clause with counsel and publish an updated template before it takes
effect; already-issued agreements remain unchanged historical records. Review
the seeded states and legacy Uttar
Pradesh RTOs; add RTO/reporting areas for other states as needed. Applicants create and
verify a subscriber account, then complete the four-step reporter application:
profile and emergency contact; State, City, and Area Coverage; cropped profile
photo, masked Aadhaar, PAN and bank proof plus payment details; and final review.
The form reuses account name/email/phone and asks for optional reporting
experience, preferred language, localities and availability. Sensitive files
are stored privately; only the applicant and admins can access them. Aadhaar
must be masked with only its last four digits visible. The database calculates
and stores age at the application date from the date of birth for restricted
admin review. Application submission records the applicant's accuracy
confirmation and does not create a contract acceptance. Admins edit and publish
the service-agreement template after completing all legal terms and verifying
organization details. Admins can open a
restricted private-details view from
each application to review the submitted details and short-lived document links.
Admins review the application,
request information, or approve/reject it. Approval creates the stable reporter
code and assignment but does not activate newsroom access. A current issued service agreement must be accepted before credentials can be issued; the reporter
acknowledges the valid authority letter before their account becomes a
reporter. Admins cannot create or directly promote reporter accounts; they can
assign a designation while approving the application and update reporting
areas or designation for any reporter who has completed onboarding. Designation
changes create a new dated assignment-history record, including when an
agreement has already been issued. Previously issued PDFs remain unchanged and
show the designation recorded when they were issued; designation updates do not
change account permissions or the stable reporter ID. The recorded
company approval checkbox is an audit attestation, not a digital signature.
Coverage and reporter assignments are retained as dated history. Applying the
SQL migrations is a manual Supabase dashboard step; apply all migrations in
order, including 0040 (stored application-age snapshot), 0041 (per-reporter
service-agreement issues), 0042 (single service-agreement workflow), 0043
(safe admin deletion of unused agreement versions), 0044 (admin-assigned
reporter designations in service agreements), 0045 (admin updates to reporter
designations and dated assignment history), and 0046 (designation codes and
reporter-ID generation), before deploying the
matching application code. The
public site,
account, reporter, credential, and newsroom pages use one shared site header and
footer; the admin console retains its dedicated management navigation.
Migration 0008 adds legacy-compatible zone/district mapping and coverage. Migration 0007
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
set in Hostinger's private application environment before deployment.
`SUPABASE_SERVICE_ROLE_KEY` is additionally required for permanent admin user
deletion and must remain server-only. Do not commit `.env`, database passwords,
service-role keys, or other secrets. Keep local development on the same project
only while it is still empty or after confirming its data is backed up.

Configure Hostinger to deploy the dedicated Chowk portal repository with
`npm start`. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, and `NODE_ENV=production` in the hosting
environment, install dependencies with `npm ci`, and use the host-provided
`PORT`. Do not upload `.env` or commit it to Git.
