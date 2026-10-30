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

   The service-role key is required for staff invitations and permanent admin
   user deletion. Keep it in the server environment only; never expose it to
   browser code or commit it to Git. Normal database requests continue to use
   the publishable/anon key with PostgreSQL RLS.

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
   for sensitive uploads. Reporter photos use a locally bundled Cropper.js
   square crop tool with drag, zoom, rotate and reset controls. Applicants must
   upload a masked Aadhaar copy only;
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
   enabled. Migration 0027 itself leaves existing reporter ID records unchanged.
   Migration 0028 adds an RTO-code field to Districts and
   automatically links that code to the existing `rto_offices` table,
   reusing a matching State/code row or creating one when needed. The
   pre-seeded State and Uttar Pradesh RTO records from migration 0009 remain
   available. Districts are the admin source for RTO codes; `rto_offices` stays
   as the linked compatibility table used by existing reporter assignments and
   ID generation, not as a second admin-managed catalog.
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
   where their foreign keys already support anonymization. Migration 0054
   requires at least one specific field request when asking an applicant for
   more information, so applications without requested changes can proceed to
   approval. Migration 0059 depends on `staff_onboarding` created by
   `0058_staff_member_onboarding.sql`; do not run 0059 by itself. Apply
   migrations 0001 through 0058 in order before applying 0059, then apply
   0060 and 0061 in order. Migration 0059 adds moderator/editor agreement
   setup, immutable wording versions and acceptance snapshots, and requires
   acceptance of the currently published role agreement before staff access
   is activated.
   Moderator and editor agreements remain unpublished until a super admin
   supplies and publishes their approved wording. Admins can manage structured
   term values, but those values are optional: complete approved clauses can be
   pasted directly into the wording template. A structured value appears in the
   agreement only when the template includes its matching `{{terms.<key>}}`
   placeholder. Only super admins can edit or publish agreement wording.
   Migration 0060 adds safe `{{staff.*}}` and `{{terms.<key>}}` placeholders, rejects
   unknown or unresolved placeholders at publish/accept time, and stores the
   exact personalized agreement and SHA-256 accepted by each staff invitee.
   Existing active moderator/editor accounts retain their current access when
   the migration is applied; the agreement gate applies to new activations.
   Plan a separate re-acceptance rollout for existing staff after approved
   wording is published. Migration 0061 allows a fresh immutable acceptance
   when corrected profile details change the personalized copy, validates that
   copy again before activation, serializes approval with publishing and
   acceptance, and adds a sample preview for saved drafts.
   Migration 0062 adds an Admin-managed newsroom-role catalog and dated
   assignments. Migration 0080 extends each role to include explicit scoped
   system permissions, so admins configure responsibilities and access once and
   assign that one role to a newsroom collaborator. Reporter applications remain
   a separate workflow. Legacy account profiles are retained internally for
   existing newsroom workflows and agreement code; they are not separately
   configured as the role's permissions.
   Existing installations must run all additive migrations in order before
   deploying these features. Migration 0064 introduces the configurable HR
   foundation: departments, job positions, employee records and numbers,
   effective-dated employee assignments, scoped access permissions, versioned
   policies, immutable acceptance records, and safe deletion rules. Migration
   0065 adds configurable
   organization data models, typed fields, per-role action scopes, configurable
   workflow transitions, optimistic record revisions, and
   immutable record history. Administrators configure these models in Admin →
   HR management → Data models; permitted employees use `/organization`. Custom
   model rules are enforced by database functions rather than the UI.
   Migration 0066 adds the single-organization identity, explicit employee and
   newsroom-collaborator relationship history, organization-scoped IDs for
   existing HR/model records, a module catalog, and reusable workflow
   definitions. Migration 0067 adds super-admin identity/settings/module
   configuration, organization-person access assignment, reusable workflow
   states/transitions, workflow instances and approvals, permission lookup,
   and organization-role enforcement for newsroom article operations. Disabled
   modules are checked by application routes and permission lookups. The
   generic workflow runtime is available at `/organization-workflows`; native
   newsroom content still retains its domain-specific editorial states and
   validation.
   The module catalog includes optional domains such as payroll and
   recruitment, but catalog entries do not implement those modules. Admin
   newsroom routes and employee HR policy/profile endpoints check their module
   state. Native article creation, editing, reading, and transitions also
   require an active organization permission assignment; department-scoped
   permissions do not grant newsroom article access because articles do not
   currently carry an organization department.
  Super admins retain full organization-configuration control; other admins
  retain existing account-level administration. Ordinary admins do not inherit
  organization permissions or HR access; HR access requires an active
   organization relationship with `hr.console.access`. Departments, positions,
   and access roles cannot be deleted while dependent records reference them.
   HR policy versions and employee assignments can be permanently deleted;
   audit logs remain retained. Configurable model records can be permanently
   deleted while their immutable event snapshots remain. Apply migration 0064 after 0063 and
  migration 0065 after 0064, before deploying the matching application code,
  then apply migrations 0066, 0067, 0068, 0069, and 0070 in order. Migration 0068
   adds organization IDs and composite foreign keys to workflow and
   access-history rows so records cannot reference a workflow, state, role,
   department, or relationship owned by another organization. Migration 0069
   enforces organization scope across HR, people, policy, custom-model, and
   configuration-history references. It checks existing references before
   adding constraints and updates the configuration-history writers to include
   organization scope. This scope-integrity migration does not complete the
   architecture's separate audit-event store, notification outbox, module
   readiness/dependency lifecycle, immutable custom-model publication
   revisions, or second-person approval policy; those require their own
   reviewed implementation and acceptance tests. Do not apply 0066 to
   a database with an independently created organization identity, legacy
   function bodies, or both legacy and canonical table names until its schema
   has been reconciled. The migration rejects known incompatible function
  bodies rather than leave the application calling renamed tables. Migration
  0070 removes implicit organization-permission grants for ordinary admin
  accounts; explicit organization access-role assignments are now required
  for organization and HR capabilities. Apply it after 0069 and before
  deploying the matching server code. Migration 0071 requires active employees
  to accept each current required HR policy before organization permissions are
  granted, preserves assignment history on change, and adds confirmed permanent
  deletes for HR employment and configurable model records while retaining
  audit history. Apply it after 0070 and before deploying the matching code.
  Migration 0072 enforces a single super-admin account, lets the super-admin
  permanently delete other Supabase accounts from Chowk, cleans their private
  application files, and preserves audit history while removing restrictive
  account references. It also adds permanent deletion for staff applications
  and custom newsroom roles; built-in roles remain protected. Apply it
  after 0071 and before deploying the matching code. Account deletion requires
  `SUPABASE_SERVICE_ROLE_KEY` on the server; no manual Supabase dashboard delete
  is needed. Migration 0073 updates the organization-scope foreign keys on
  HR assignments and policy acceptances so they cascade consistently with
  account deletion, while nulling deleted manager and relationship references
  in retained history. Apply it after 0072 before retrying deletion of an employee
  account. Migration 0074 fixes an ambiguous organization ID in the organization
  setup loader; apply it after 0073 before using Organization setup. The admin
  sidebar groups Locations, Reporter setup, and Organization setup under one
  Configuration page, with only the sections permitted for the signed-in role
  shown as in-page tabs.

  The generic workflow runtime currently stores a format-validated subject
  type and ID as text; it does not resolve or bind them to authoritative
  domain records. Starts, transitions, and approval decisions are therefore
  blocked for newsroom, reporter, agreement, and HR modules until domain-bound
  adapters are implemented.

The HR vocabulary is intentional: a **profile** is an account/identity;
`hr_employees` is the employment record linked to that profile (its ID is the
profile ID), with a generated `employee_number`, `employment_type`,
`employment_status`, `hired_on`, and `terminated_on`. An
`hr_employee_assignments` row links an employee to a department, position,
organization permission role, manager employee, and dated assignment status.
**Position** means the job in the organization; **permission role** means
database-enforced capabilities. Policy acceptances reference `employee_id` and an immutable
policy-version hash. Employment types are `full_time`, `part_time`,
`fixed_term`, `temporary`, `intern`, or `other`; employment lifecycle states
are `preboarding`, `active`, `suspended`, and `terminated`.

The HR employee model is not a relabeling of every newsroom participant.
Reporter applications and service agreements remain in their existing
reporter domain; moderators/editors and other non-employees are not silently
classified as employees. Employee policy acceptance is enforced only for HR
employees. `newsroom.people.manage` is the catalogued newsroom people
capability, while `hr.employee.*` governs employment records.

Core tables and ownership:

- `hr_departments`: `id`, unique `department_key`, `name`, `description`,
  `parent_id`, active flag, creator, and timestamps.
- `hr_positions`: `id`, unique `position_key`, `title`, `description`,
  `department_id`, active flag, creator, and timestamps.
- `hr_employees`: shared profile `id`, generated unique `employee_number`,
  `employment_type`, `employment_status`, `hired_on`, `terminated_on`,
  creator, and timestamps. Its shared primary key avoids duplicating account
  identity or contact data.
- `hr_employee_assignments`: `id`, `employee_id`, `department_id`,
  `position_id`, `access_role_id`, `manager_employee_id`, assignment `status`,
  `is_primary`, `starts_at`, `ends_at`, `end_reason`, `assigned_by`, and
  timestamps. Ended assignments remain for history.
- `hr_access_roles`, `hr_permission_catalog`, and
  `hr_access_role_permissions`: named authorization roles, registered
  capabilities, and each role's permission scope.
- `hr_policy_documents`, `hr_policy_versions`, and `hr_policy_acceptances`:
  policy metadata, immutable version content/hash, and acceptance tied to
  `employee_id` plus the exact version.
- `hr_custom_models`, `hr_custom_model_fields`,
  `hr_custom_model_permissions`, and `hr_custom_model_transitions`: configured
  record types, typed field definitions, role/action scopes, and valid state
  changes.
- `hr_custom_records` and `hr_custom_record_events`: validated JSON record
  values with revision numbers and preserved change/deletion history.

Employee activation is derived transactionally from assignment lifecycle
changes: a pending assignment creates a `preboarding` employee, an active
assignment activates the employment record after profile and policy checks,
and ending the last current assignment terminates it. The model stores no
payroll or sensitive identity-document data in these general HR tables.
4. Start the portal:

   ```powershell
   npm start
   ```

   Open <http://127.0.0.1:3000>. `npm run dev` restarts the server on changes.
   The process health endpoint is <http://127.0.0.1:3000/healthz>; it confirms
   the Node.js process is responding, not that Supabase credentials or the schema
   are configured.

Migrations are versioned and must be inspected before running; some rename or
backfill existing schema and data. They also install a trigger on `auth.users`
to create a subscriber profile when a Supabase Auth account is created.

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
  locations, reporter configuration, and searchable, paginated, read-only audit
  history with actor snapshots, request context, reasons, before/after field diffs,
  and CSV export of up to 10,000 filtered events per export.
- People administration is organized around Applications, Directory,
  Agreements, Credentials, and Coverage. Applications separates reporter
  intake from newsroom-role onboarding; the directory combines active newsroom
  roles; and Agreements separates role-specific templates from per-person
  issued and accepted records. Existing role-specific tables and legal history are
  retained rather than destructively merged or reset.
  Reporter Coverage and Credentials are backed by authenticated admin API
  routes for assignment, ending, issue, revoke, and print actions. Configuration
  uses one grouped navigation; Organization people shows only active,
  non-employee relationships, with employee access and invitations managed in
  HR Management. User accounts owns general account access and account deletion;
  HR employee records and their dated assignment histories remain in HR, while
  reporter office and designation changes are managed from the Newsroom
  Directory, separately from Reporter Coverage.
  Newsroom roles combine title, responsibilities, and scoped system permissions.
  Admins configure one role, assign it to staff, and preserve changes as dated
  history through the shared onboarding and agreement process. HR access roles
  remain separate because they apply to HR employee assignments.
  Migration `0078_newsroom_title_access_mapping.sql` corrects the compatibility
  bridge for existing installations; apply it after migrations through `0077`.
  Migration `0079_location_state_reporter_codes.sql` makes Locations the source
  for reporter State codes. It creates any missing top-level State locations
  from the existing `states` records, then links each legacy row by unambiguous
  normalized name without changing its ID. State changes in Locations keep
  the legacy table synchronized for reporter applications, assignments, and ID
  generation. Direct authenticated writes to the compatibility `states` and
  `rto_offices` tables are disabled. The migration aborts with a diagnostic
  rather than guessing if State names or codes cannot be linked one-to-one.
  Apply it after migrations through `0078` and before deploying the matching UI.
  Migration `0080_unified_newsroom_roles.sql` moves newsroom permission grants
  onto the newsroom role itself, backfills existing grants without changing
  title or assignment IDs, and makes newsroom capability checks read those
  grants directly. It also clears the mapped organization permission role from
  newsroom relationships so there is only one admin-managed permission bundle.
  Some legacy workflows still use the fixed Reporter/Moderator/Editor account
  profiles internally; profiles are compatibility gates, not configurable
  permission bundles. Apply migration 0080 after 0079 and before deploying the
  matching server and UI.
- Territory leadership adds configurable geographic titles and dated
  appointments for active HR employees or active newsroom contributors.
  Built-in titles cover State, Region, Zone, Range, District, and Coverage Area
  heads; admins can add other titles and choose their location level. Permanent
  and acting appointments are tracked separately, overlapping appointments of
  the same type and role are rejected per territory, and replacements, endings,
  and scheduled cancellations retain an audited history with reasons. An
  appointment records responsibility only; it does not grant application
  permissions or change an HR reporting line. The feature is defined in
  migration `0075_geographic_leadership_assignments.sql` and requires that
  migration to be applied before its admin screen can be used. Migration
  `0076_hr_manager_cycles_and_leadership_eligibility.sql` prevents new circular
  HR manager chains and rejects pre-existing cycles before it installs the
  protection. It also excludes future-dated reporter/HR assignments from
  current geographic-leadership eligibility. Migration
  `0077_hr_department_head_appointments.sql` adds a separate dated Department
  Head appointment for one holder at a time. Acting appointments replace the
  current holder; eligible appointees must be active HR employees with a current
  active assignment. The appointment is not a job title, manager link, or
  permission grant. Employment changes do not automatically end head
  appointments; HR displays an alert so an administrator can review and close
  affected appointments with a reason.
- HR management adds organization departments and positions, employee records
  with generated employee numbers and employment lifecycle/type, configurable
  organization permission-role bundles with `all`, `department`, `assigned`, and
  `own` scopes, employee assignment lifecycle history, and versioned required
  policy acceptance. Super admins can configure and delegate HR access; users
  with delegated HR access are restricted to HR endpoints. Permissions for
  existing newsroom features are catalogued for role configuration but must
  be connected to the corresponding newsroom authorization checks before
  custom roles can replace the existing fixed newsroom account roles.
- Organization model builder adds admin-defined business forms with typed and
  validated fields, per-access-role CRUD/workflow permissions and record
  scopes, configurable state transitions, and employee record history. Employees
  use `/organization`; updates require the current record revision, deletes
  are soft deletes, and data model rules are checked in database functions.
  These custom models extend the organization with configurable records; they
  do not replace native newsroom article, reporter, or location tables or their
  existing fixed-role workflows.
- The organization-platform migration adds an organization root, organization
  relationship history for employees and newsroom collaborators, module
  catalog metadata, and reusable workflow-definition tables. Those catalog and
  workflow records are not yet managed through the admin UI or enforced by all
  native modules. Optional modules listed in the catalog (for example payroll,
  leave/attendance, and recruitment) are not implemented features.
- The standalone visual system map is available at
  `/organization-hierarchy.html`. It explains the enforced location and HR
  trees, the people and access relationships, and the boundaries between
  newsroom titles, HR positions, reporter coverage, and geographic leadership.
- System configuration includes shared locations, reporter application setup,
  and the organization legal profile used in reporter agreements; agreement
  wording and publication remain under Agreements.
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
version, signer, and acceptance timestamp. The service-agreement editor also
provides an Admin form for the agreement's payment, retention, liability,
arbitration, term, fee, and insurance clauses. Admins must enter approved wording
for every required term, save the terms, then save a new template draft; the
draft snapshots those terms so issued agreements retain the exact approved
wording. Publishing is blocked until the company profile is verified and the
draft's complete terms match the current Admin settings. ID-card and authority-letter issuance
requires acceptance of the current issued agreement. The service template
editor starts with the existing Reporter Engagement Agreement format and
inserts verified database details; it does not draft or approve legal terms.
Legal and business terms must be entered by an authorized Admin and reviewed
before publication. Editing and publishing replaces the
active template for future issues, while previous versions and issued or
accepted PDFs remain retained as legal history. To prepare an agreement, open
the approved reporter's application and use **Preview / issue agreement**.
Reporter designation is a position label, separate from account permissions.
The admin must choose an active designation in the approval dialog; its
two-digit code is used for new reporter IDs and the designation itself is
included in the personalized service-agreement PDF. New reporter IDs use the
format `state-RTO-code-number`, for example `up-80-01-0001`. Admins configure
a unique two-digit code in **Reporter setup**. Codes are used with a per-RTO
sequence, and old reporter IDs are never rewritten when a code changes. Admins
can add and edit designations and deactivate labels that should no longer be
offered for new assignments; existing reporter and agreement history is
retained. Applications, the approved reporter directory, and coverage
assignments remain separate lifecycle and operations workflows; they do not
represent additional job titles or permission roles. The database still has a
legacy reporter-category field used by existing records and database functions.
It is not a designation or account role, is no longer managed as a separate
admin concept, and must not be removed until its remaining schema and credential
verification dependencies are migrated. The
agreement template explains that designation is an
administrative newsroom title that may change based on performance or newsroom
needs, without by itself changing compensation or other agreement terms.
Review this clause with counsel and publish an updated template before it takes
effect; already-issued agreements remain unchanged historical records. Review
Configure each State's two-character reporter ID code and each District's RTO
code in Locations; the linked `states` and `rto_offices` rows are maintained by
the database for compatibility with existing reporter records and ID generation.
Reporter setup no longer provides duplicate State-code or RTO-office catalogs.
Applicants create and
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
reporter-ID generation), 0047 (designation snapshots on newly issued staff
credentials), and 0048 (credential conflict guards and onboarding status
verification plus serialized single-template publishing), and 0049 (supersede
credentials when a personalized service agreement is reissued), before deploying the
matching application code. Migration 0050 enables Coverage Area and District
fields in service-agreement templates. Migration 0055 adds Admin-managed
service-agreement legal terms and immutable per-template term snapshots; apply
it after migration 0054 and before deploying the matching application code.
Migration 0056 seeds the categories shown in the homepage design; apply it
after migration 0055 and before deploying the matching frontend. “All news” is
a filter control and is not stored as a news category.
Migration 0057 makes Section 11.7 the only reporter-liability clause in new
service agreements; apply it after migration 0056 and before deploying the
matching agreement code. After deployment, admins must publish a new agreement
template and issue a fresh agreement where needed; existing issued PDF records
are preserved unchanged. The application also upgrades legacy
Schedule A assigned-area placeholders when rendering existing templates. The
public homepage category chips load active categories from the database.
Migration 0058 adds secure moderator/editor invitations, private staff profile
completion, Admin review, and database-enforced role activation. Apply it after
migration 0057 and before deploying the matching application code. Staff
invitations require `SUPABASE_SERVICE_ROLE_KEY` on the server. Include `/staff-onboarding`, `/hr-policies`, and `/employee-policies` in
Supabase Auth's allowed redirect URLs
so legacy staff and HR invitations return to the correct profile and policy
workflows. Authenticated staff use `/organization` to access the custom models
assigned to their active organization permission role.
The public site,
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
`SUPABASE_SERVICE_ROLE_KEY` is additionally required for staff invitations and
permanent admin user deletion and must remain server-only. Do not commit `.env`,
database passwords, service-role keys, or other secrets. Keep local development
on the same project only while it is still empty or after confirming its data is
backed up.

Configure Hostinger to deploy the dedicated Chowk portal repository with
`npm start`. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, and `NODE_ENV=production` in the hosting
environment, install dependencies with `npm ci`, and use the host-provided
`PORT`. Do not upload `.env` or commit it to Git.
