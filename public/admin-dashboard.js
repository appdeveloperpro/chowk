const content = document.querySelector("#admin-content");
const navItems = [...document.querySelectorAll(".admin-nav-item")];
const agreementPreviewUrls = new Set();
const sectionLabels = Object.fromEntries(
  navItems.map((item) => [
    item.dataset.section,
    item.querySelector(".admin-nav-label").textContent.trim()
  ])
);
const workflowTabs = {
  applications: [
    { key: "reporter", label: "Reporters" },
    { key: "newsroom", label: "Newsroom staff" }
  ],
  directory: [
    { key: "all", label: "All active staff" },
    { key: "reporter", label: "Reporters" },
    { key: "newsroom", label: "Newsroom staff" }
  ],
  agreements: [
    { key: "reporter", label: "Reporters" },
    { key: "moderator", label: "Moderators" },
    { key: "editor", label: "Editors" }
  ],
  credentials: [
    { key: "all", label: "Staff ID cards & authority letters" }
  ]
};
const activeWorkflowTabs = {
  applications: "reporter",
  directory: "all",
  agreements: "reporter",
  credentials: "all"
};
let agreementPanelMode = "templates";
const legacySectionRoutes = {
  users: "accounts",
  "staff-onboarding": "applications",
  "reporter-applications": "applications",
  "reporter-directory": "directory",
  "reporter-credentials": "credentials",
  "role-agreements": "agreements",
  "reporter-coverage": "coverage",
  "reporter-options": "reporter-configuration"
};
const configurationSections = [
  {
    key: "locations",
    label: "Locations",
    description: "Manage State, Region, Zone, Range, District, and optional Tehsil/Block levels with Coverage areas.",
    permission: "newsroom.locations.manage",
    navSection: "locations",
    group: "GEOGRAPHY"
  },
  {
    key: "reporter-configuration",
    label: "Reporter setup",
    description: "Manage reporter organization details, state codes, and designations. Reporter job agreements are managed under Agreements; District RTO codes are managed in Locations.",
    permission: "reporters.manage",
    navSection: "reporter-configuration",
    group: "REPORTING"
  },
  {
    key: "reporter-review-access",
    label: "Application reviewer access",
    description: "Assign reporter application reviewers to one or more geographic locations. Their access is limited to those locations and their descendants.",
    anyPermissions: ["reporters.manage", "newsroom.people.manage"],
    navSection: "reporter-configuration",
    group: "REPORTING"
  },
  {
    key: "organization-identity",
    label: "Organization identity",
    description: "Set the legal name, contact details, locale, timezone, and currency used for new records.",
    superAdminOnly: true,
    group: "ORGANIZATION"
  },
  {
    key: "organization-people",
    label: "People & access",
    description: "Manage organization access relationships. Employee assignments are managed in HR Management.",
    superAdminOnly: true,
    group: "ORGANIZATION"
  },
  {
    key: "organization-settings",
    label: "Settings",
    description: "Manage versioned organization-wide settings.",
    superAdminOnly: true,
    group: "ORGANIZATION"
  },
  {
    key: "organization-modules",
    label: "Modules",
    description: "Review enabled system modules and update supported configuration.",
    superAdminOnly: true,
    group: "ORGANIZATION"
  },
  {
    key: "organization-workflows",
    label: "Workflows",
    description: "Configure reusable workflow definitions, states, and transitions.",
    superAdminOnly: true,
    group: "ORGANIZATION"
  },
  {
    key: "organization-models",
    label: "Data models",
    description: "Configure organization-wide record types, fields, access, and workflow.",
    requiredPermissions: ["hr.console.access", "hr.configuration.manage"],
    group: "ORGANIZATION"
  }
];

window.addEventListener("beforeunload", () => {
  agreementPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  agreementPreviewUrls.clear();
});

const modules = {
  articles: {
    path: "admin/articles",
    description: "Create, publish, edit, and remove articles stored in Supabase.",
    createPath: "admin/articles",
    formFields: [
      { name: "title", label: "Headline", type: "text" },
      { name: "slug", label: "URL slug", type: "text" },
      { name: "excerpt", label: "Summary", type: "textarea", required: false },
      { name: "content", label: "Article content", type: "textarea" },
      { name: "category_id", label: "Category ID (optional)", type: "number", required: false },
      { name: "image_url", label: "Image URL (optional)", type: "url", required: false },
    ]
  },
  accounts: {
    path: "admin/users",
    description: "Manage general account access and account deletion. Newsroom staff responsibilities and permissions are managed through assigned newsroom roles."
  },
  "staff-roles": {
    path: "admin/staff-roles",
    description: "Create one assignable newsroom role with its title, responsibilities, and system permissions."
  },
  "staff-onboarding": {
    path: "admin/staff-onboarding",
    description: "Review complete staff profiles before assigned newsroom role access is activated."
  },
  "role-agreements": {
    path: "admin/role-agreements",
    description: "Manage agreement terms for every staff role. Only super admins can edit or publish legal wording."
  },
  categories: {
    path: "admin/categories",
    description: "Organize published stories into categories and choose a matching icon for each one.",
    createPath: "admin/categories",
    formFields: [
      { name: "name", label: "Category name", type: "text" },
      { name: "slug", label: "URL slug", type: "text" },
      { name: "icon_key", label: "Category icon", type: "icon-picker" },
      { name: "is_active", label: "Active", type: "checkbox" }
    ]
  },
  "reporter-applications": {
    path: "admin/reporter-applications",
    description: "Review each reporter application, request missing information, then approve or reject the application."
  },
  "reporter-directory": {
    path: "admin/reporter-directory",
    description: "Manage approved reporter identities, stable reporter codes, and assignment history."
  },
  coverage: {
    path: "admin/reporter-coverage",
    description: "Manage reporter coverage assignments and their effective-date history."
  },
  "territory-leadership": {
    path: "admin/territory-leadership",
    description: "Appoint newsroom and HR personnel to geographic leadership roles with effective dates and retained history."
  },
  "reporter-credentials": {
    path: "admin/reporter-credentials",
    description: "Issue ID cards and authority letters; reporter access starts only after the authority letter is acknowledged."
  },
  "reporter-configuration": {
    path: "admin/reporter-options",
    description: "Manage organization legal details and reporter application settings used across newsroom workflows."
  },
  media: {
    path: "admin/media",
    description: "Manage the podcast, Charcha, and Patrika catalog.",
    createPath: "admin/media",
    formFields: [
      { name: "title", label: "Title", type: "text" },
      { name: "media_type", label: "Media type", type: "select", options: ["podcast", "charcha", "patrika"] },
      { name: "description", label: "Description", type: "textarea", required: false },
      { name: "media_url", label: "Media URL", type: "url" },
      { name: "cover_url", label: "Cover image URL", type: "url", required: false },
      { name: "episode_label", label: "Episode / issue label", type: "text", required: false },
      { name: "duration_seconds", label: "Duration (seconds)", type: "number", required: false },
      { name: "issue_date", label: "Issue date", type: "date", required: false },
      { name: "status", label: "Status", type: "select", options: ["draft", "published", "archived"] }
    ]
  },
  "live-streams": {
    path: "admin/live-streams",
    description: "Schedule and manage YouTube-backed newsroom broadcasts.",
    createPath: "admin/live-streams",
    formFields: [
      { name: "title", label: "Stream title", type: "text" },
      { name: "description", label: "Description", type: "textarea", required: false },
      { name: "youtube_video_id", label: "YouTube video ID", type: "text", required: false },
      { name: "youtube_url", label: "YouTube URL", type: "url", required: false },
      { name: "scheduled_at", label: "Scheduled for", type: "datetime-local", required: false }
    ]
  },
  reports: {
    path: "admin/reports",
    description: "Review open reports submitted against published articles."
  },
  comments: {
    path: "admin/comments",
    description: "Moderate reader comments before they appear publicly."
  },
  locations: {
    path: "admin/locations",
    description: "Manage the State > Region > Zone > Range > District > Coverage area hierarchy. Enter a two-character reporter ID code on each State and an RTO code on each District. State locations linked to reporter IDs cannot be converted or deleted; deactivate them instead. Existing Zones migrated under an 'Unassigned Region' must be moved into the correct Region.",
    createPath: "admin/locations",
    formFields: [
      { name: "name", label: "Location name", type: "text" },
      { name: "slug", label: "URL slug", type: "text" },
      { name: "location_type", label: "Location level", type: "select", options: ["state", "region", "zone", "range", "district", "tehsil", "block", "coverage_area"] },
      { name: "state_code", label: "Reporter ID state code (exactly 2 letters or numbers)", type: "text", required: false, maxLength: 2 },
      { name: "rto_code", label: "RTO code (without State prefix; e.g. 80)", type: "text", required: false, maxLength: 8 },
      { name: "parent_id", label: "Parent location", type: "number", required: false },
      { name: "is_active", label: "Active", type: "checkbox" }
    ]
  },
  "reporter-designations": {
    path: "admin/reporter-designations",
    description: "Add and edit reporter positions and their unique two-digit reporter-ID codes. New IDs use state-RTO-code-number (for example, UP-80-01-0001). Existing IDs never change. Deactivate a designation to remove it from future choices while preserving history.",
    createPath: "admin/reporter-designations",
    formFields: [
      { name: "name", label: "Reporter designation", type: "text", minLength: 2, maxLength: 80 },
      { name: "designation_code", label: "Designation code (exactly 2 digits)", type: "text", minLength: 2, maxLength: 2, pattern: "[0-9]{2}" },
      { name: "description", label: "Description", type: "textarea", required: false, maxLength: 300 },
      { name: "is_active", label: "Active", type: "checkbox" }
    ]
  },
  "audit-logs": {
    path: "admin/audit-logs",
    description: "Search the newsroom activity ledger, inspect before-and-after changes, and identify the staff account responsible.",
    audit: true
  },
  settings: {
    description: "Manage your admin profile and account security."
  }
};

function renderLocationModule(root, results) {
  const addLocation = makeElement("button", "admin-primary-button admin-create-button", "Add location");
  addLocation.type = "button";
  addLocation.addEventListener("click", () => openConfiguredRecordDialog("locations", null));
  const assignDistrict = makeElement("button", "admin-secondary-button admin-create-button", "Assign district to range");
  assignDistrict.type = "button";
  assignDistrict.addEventListener("click", () => openDistrictRangeDialog(locationRecords));
  pageActions(root).append(addLocation, assignDistrict);

  const byId = new Map(locationRecords.map((item) => [String(item.id), item]));
  const locationRows = locationRecords.map((location) => ({
    ...location,
    _source_type: location.location_type,
    _parent_type: byId.get(String(location.parent_id))?.location_type || "",
    state_code: location.location_type === "state" ? location.state_code || "—" : "—",
    rto_code: location.location_type === "district" ? location.rto_code || "—" : "—",
    hierarchy: locationPath(location, byId),
    parent_location: byId.get(String(location.parent_id))?.name || "Top level"
  }));
  const managedLocationRows = locationRows.filter((row) => row._source_type !== "city");
  const groups = [
    ["state", "States", (row) => row._source_type === "state"],
    ["region", "Regions", (row) => row._source_type === "region"],
    ["zone", "Zones", (row) => row._source_type === "zone"],
    ["range", "Ranges", (row) => row._source_type === "range"],
    ["district", "Districts", (row) =>
      row._source_type === "district" && row._parent_type === "range"],
    ["tehsil", "Tehsils", (row) => row._source_type === "tehsil"],
    ["block", "Blocks", (row) => row._source_type === "block"],
    ["unassigned", "Districts needing a range", (row) =>
      row._source_type === "district" && row._parent_type !== "range"],
    ["coverage-area", "Coverage areas", (row) => row._source_type === "coverage_area"]
  ];
  const panel = makeElement("section", "admin-panel admin-location-panel");
  const panelHeader = makeElement("div", "admin-panel-heading");
  panelHeader.append(makeElement("h2", "", "Location records"));
  panelHeader.append(makeElement("span", "", `${managedLocationRows.length} managed locations`));
  const groupList = makeElement("div", "admin-location-groups");
  groups.forEach(([key, label, matches]) => {
    const rows = managedLocationRows.filter(matches);
    const details = makeElement("details", "admin-location-group");
    details.dataset.locationGroup = key;
    const summary = makeElement("summary", "admin-location-group-summary");
    summary.append(makeElement("span", "admin-location-group-name", label));
    summary.append(makeElement(
      "span",
      "admin-location-group-count",
      `${rows.length} ${rows.length === 1 ? "record" : "records"}`
    ));
    const content = makeElement("div", "admin-location-group-content");
    content.append(buildTable(rows, "locations"));
    details.append(summary, content);
    groupList.append(details);
  });
  panel.append(panelHeader, groupList);
  root.append(panel);
}

function renderReporterReviewAccess(root, data = {}) {
  const reviewers = Array.isArray(data.reviewers) ? data.reviewers : [];
  const locations = Array.isArray(data.locations) ? data.locations : [];
  const assignments = Array.isArray(data.assignments) ? data.assignments : [];
  const panel = makeElement("section", "admin-panel");
  panel.append(
    makeElement("h2", "", "Assign application reviewers"),
    makeElement(
      "p",
      "admin-workflow-scope-note",
      "First give a staff member the Reporter Application Reviewer permission in their newsroom role. Then assign one or more location scopes here. A scope grants review access only to applications in that location and its descendants; a leadership title alone grants no system access."
    )
  );
  if (!reviewers.length) {
    panel.append(makeElement(
      "p",
      "admin-empty",
      "No active staff member currently has the Reporter Application Reviewer permission. Configure a newsroom role and assign it to staff first."
    ));
  } else {
    const form = document.createElement("form");
    form.className = "admin-form-grid";
    const reviewerSelect = document.createElement("select");
    reviewerSelect.name = "user_id";
    reviewerSelect.required = true;
    reviewerSelect.append(new Option("Choose a reviewer", ""));
    reviewers.forEach((reviewer) => {
      reviewerSelect.append(new Option(
        `${reviewer.full_name || reviewer.email} · ${reviewer.role_name}`,
        reviewer.user_id
      ));
    });
    const locationSelect = document.createElement("select");
    locationSelect.name = "location_id";
    locationSelect.required = true;
    locationSelect.append(new Option("Choose a location scope", ""));
    const byId = new Map(locations.map((location) => [String(location.id), location]));
    locations.forEach((location) => {
      locationSelect.append(new Option(
        `${locationPath(location, byId)} · ${location.location_type.replaceAll("_", " ")}`,
        String(location.id)
      ));
    });
    const reviewerField = makeElement("label", "admin-form-field");
    reviewerField.append(makeElement("span", "", "Reviewer"), reviewerSelect);
    const locationField = makeElement("label", "admin-form-field");
    locationField.append(makeElement("span", "", "Geographic scope"), locationSelect);
    const submit = makeElement("button", "admin-primary-button", "Assign scope");
    submit.type = "submit";
    form.append(reviewerField, locationField, submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        await apiRequest("admin/reporter-review-scopes", "POST", {
          user_id: reviewerSelect.value,
          location_id: Number(locationSelect.value),
          is_active: true
        });
        await loadConfigurationPage("reporter-review-access");
      } catch (error) {
        void showAdminMessage(
          "Reviewer scope could not be saved",
          error instanceof Error ? error.message : "The request failed."
        );
      } finally {
        submit.disabled = false;
      }
    });
    panel.append(form);
  }

  panel.append(makeElement("h3", "", "Reviewer scope assignments"));
  panel.append(makeElement(
    "p",
    "admin-dialog-help",
    "Inactive scopes remain listed. The audit log records changes; this table shows current active/inactive state, not assignment periods."
  ));
  if (!assignments.length) {
    panel.append(makeElement("p", "admin-empty", "No reviewer scopes have been assigned."));
  } else {
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const header = document.createElement("tr");
    ["Reviewer", "Access role", "Location scope", "Status", "Action"].forEach((label) =>
      header.append(makeElement("th", "", label))
    );
    head.append(header);
    table.append(head);
    const body = document.createElement("tbody");
    assignments.forEach((assignment) => {
      const row = document.createElement("tr");
      [
        `${assignment.reviewer_name || "—"}${assignment.reviewer_email ? ` · ${assignment.reviewer_email}` : ""}`,
        assignment.role_name || "Role no longer assigned",
        `${assignment.location_name} · ${String(assignment.location_type).replaceAll("_", " ")}`,
        assignment.is_active ? "Active" : "Inactive"
      ].forEach((value) => row.append(makeElement("td", "", value)));
      const action = makeElement("td", "admin-row-actions");
      if (assignment.is_active) {
        rowButton(action, "Remove scope", async () => {
          try {
            await apiRequest("admin/reporter-review-scopes", "POST", {
              user_id: assignment.user_id,
              location_id: assignment.location_id,
              is_active: false
            });
            await loadConfigurationPage("reporter-review-access");
          } catch (error) {
            void showAdminMessage(
              "Reviewer scope could not be removed",
              error instanceof Error ? error.message : "The request failed."
            );
          }
        }, "admin-row-button danger");
      }
      row.append(action);
      body.append(row);
    });
    table.append(body);
    const wrapper = makeElement("div", "admin-table-wrap");
    wrapper.append(table);
    panel.append(wrapper);
  }
  root.append(panel);
}

const allowedLocationParents = {
  state: [],
  region: ["state"],
  zone: ["region"],
  range: ["zone"],
  city: ["district"],
  district: ["range"],
  tehsil: ["district"],
  block: ["district", "tehsil"],
  coverage_area: ["district", "tehsil", "block"]
};

let activeSection = "overview";
let sessionIdentity = null;
let overviewData = null;
let locationRecords = [];
let reporterSetupView = "overview";
let hrManagementData = null;
const legacyNewsroomPermissionRoleKeys = new Set(["reporter", "moderator", "editor", "publisher"]);

function hrEmployeePermissionRoles() {
  return (hrManagementData?.access_roles || [])
    .filter((role) => !legacyNewsroomPermissionRoleKeys.has(role.role_key));
}
let activeHrTab = "departments";
let organizationConfigurationData = null;
let activeConfigurationSection = "locations";
let sessionPermissions = [];
const auditFilters = { q: "", table: "", action: "", from: "", to: "", page: 1, page_size: 25 };

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function responseMessage(result) {
  return result?.error ||
    (Array.isArray(result?.message) ? result.message[0] : result?.message) ||
    "The request could not be completed.";
}

function proxyUrl(path) {
  return `/api/${path}`;
}

async function apiRequest(path, method = "GET", body) {
  const options = { method, cache: "no-store" };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }

  const response = await fetch(proxyUrl(path), options);
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.replace("/admin");
    throw new Error("Your admin session has expired.");
  }
  if (!response.ok) throw new Error(responseMessage(result));
  return result;
}

function unwrapData(result) {
  return result && Object.hasOwn(result, "data") ? result.data : result;
}

function rowsFromData(value, group = "") {
  if (Array.isArray(value)) {
    return value.map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? { ...item, ...(group ? { _group: group } : {}) }
        : { value: item, ...(group ? { _group: group } : {}) }
    );
  }
  if (!value || typeof value !== "object") return [];

  const arrays = Object.entries(value).filter(([, item]) => Array.isArray(item));
  if (arrays.length) {
    return arrays.flatMap(([key, items]) => rowsFromData(items, key));
  }
  return [{ ...value, ...(group ? { _group: group } : {}) }];
}

function formatCell(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric"
      }).format(date);
}

function dateInputValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function currentCredentialStatus(credential) {
  if (!["active", "pending_acceptance"].includes(credential.status)) return credential.status;
  const today = new Date().toISOString().slice(0, 10);
  if (credential.valid_until < today) return "expired";
  if (credential.valid_from > today) return "not_yet_valid";
  return credential.status;
}

function addHeading(root, eyebrow, title, description) {
  const heading = makeElement("div", "admin-page-heading");
  const copy = makeElement("div");
  copy.append(makeElement("span", "admin-eyebrow", eyebrow));
  copy.append(makeElement("h1", "", title));
  copy.append(makeElement("p", "", description));
  heading.append(copy);
  const refresh = makeElement("button", "admin-secondary-button", "Refresh");
  refresh.type = "button";
  refresh.addEventListener("click", () => activeSection === "configurations"
    ? void loadConfigurationPage(activeConfigurationSection)
    : void loadSection(activeSection));
  heading.append(refresh);
  root.append(heading);
}

function showPageError(message, retry) {
  const panel = makeElement("div", "admin-error-panel");
  panel.append(makeElement("strong", "", "Couldn’t load admin data."));
  panel.append(makeElement("p", "", message));
  const button = makeElement("button", "admin-secondary-button", "Try again");
  button.type = "button";
  button.addEventListener("click", retry);
  panel.append(button);
  content.replaceChildren(panel);
}

function renderWorkflowTabs(root, page, selectedKey) {
  const tabs = makeElement("div", "admin-workflow-tabs");
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", `${sectionLabels[page]} views`);
  workflowTabs[page].forEach(({ key, label }) => {
    const tab = makeElement("button", "admin-workflow-tab", label);
    tab.type = "button";
    tab.setAttribute("aria-pressed", String(key === selectedKey));
    tab.classList.toggle("is-active", key === selectedKey);
    tab.addEventListener("click", () => void loadWorkflowPage(page, key));
    tabs.append(tab);
  });
  root.append(tabs);
}

function renderAgreementModeTabs(root) {
  const modes = makeElement("div", "admin-workflow-tabs admin-workflow-tabs-secondary");
  modes.setAttribute("role", "group");
  modes.setAttribute("aria-label", "Agreement management view");
  [
    ["templates", "Templates & wording"],
    ["records", "People's agreements"]
  ].forEach(([key, label]) => {
    const button = makeElement("button", "admin-workflow-tab", label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(agreementPanelMode === key));
    button.classList.toggle("is-active", agreementPanelMode === key);
    button.addEventListener("click", () => {
      agreementPanelMode = key;
      void loadWorkflowPage("agreements", activeWorkflowTabs.agreements);
    });
    modes.append(button);
  });
  root.append(modes);
}

async function loadWorkflowPage(page, tabKey = activeWorkflowTabs[page]) {
  document.body.classList.remove("admin-hr-theme");
  let agreementRoleData = null;
  if (page === "agreements") {
    const roleResult = await apiRequest(modules["role-agreements"].path).catch(() => null);
    agreementRoleData = roleResult ? unwrapData(roleResult) : null;
    workflowTabs.agreements = (agreementRoleData?.roles || []).map((role) => ({
      key: role.role,
      label: role.label || role.role
    }));
  }
  if (!workflowTabs[page]?.some((tab) => tab.key === tabKey)) tabKey = workflowTabs[page]?.[0]?.key;
  if (!tabKey) return;
  activeWorkflowTabs[page] = tabKey;
  activeSection = page;
  const label = sectionLabels[page];
  document.querySelector("#breadcrumb-section").textContent = label;
  navItems.forEach((item) => {
    const isCurrent = item.dataset.section === page;
    item.classList.toggle("is-active", isCurrent);
    if (isCurrent) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  content.replaceChildren(makeElement("div", "admin-loading", `Loading ${label.toLowerCase()}…`));

  const root = makeElement("div", "admin-section");
  const headingGroup = ["agreements", "credentials"].includes(page)
    ? "PEOPLE OPERATIONS"
    : "NEWSROOM · PEOPLE";
  addHeading(root, headingGroup, label, {
    applications: "Review reporter applications and newsroom role invitations in one queue.",
    directory: "Browse reporters and newsroom staff by their assigned newsroom role.",
    agreements: "Manage Reporter and newsroom role agreements, wording, and acceptance records.",
    credentials: "Issue and manage staff ID cards and reporter authority letters."
  }[page]);
  renderWorkflowTabs(root, page, tabKey);
  if (page === "agreements") renderAgreementModeTabs(root);

  try {
    if (page === "applications") {
      if (tabKey === "reporter") {
        const result = await apiRequest(modules["reporter-applications"].path);
        renderReporterAdminSection("reporter-applications", root, unwrapData(result));
      } else {
        const result = await apiRequest(modules["staff-onboarding"].path);
        const records = (unwrapData(result) || []).filter((row) =>
          ["moderator", "editor"].includes(row.requested_role)
        );
        if (["admin", "super_admin"].includes(sessionIdentity?.role)) {
          const actions = pageActions(root);
          const manageRoles = makeElement("button", "admin-secondary-button admin-create-button", "Manage newsroom roles");
          manageRoles.type = "button";
          manageRoles.addEventListener("click", () => void loadSection("staff-roles"));
          actions.append(manageRoles);
          const invite = makeElement("button", "admin-primary-button admin-create-button", "Invite newsroom staff");
          invite.type = "button";
          invite.addEventListener("click", () => void openStaffInvitationDialog(
            () => loadWorkflowPage("applications", tabKey)
          ));
          actions.append(invite);
        }
        renderStaffOnboarding(root, records, () => loadWorkflowPage("applications", tabKey), false);
      }
    } else if (page === "directory") {
      const canReadStaffDirectory = [
        "reporters.manage",
        "newsroom.people.manage"
      ].some((permission) => sessionPermissions.includes(permission));
      const canReadReporterDirectory = [
        "people.directory.read",
        "reporters.manage"
      ].some((permission) => sessionPermissions.includes(permission));
      const [reporterResult, onboardingResult] = await Promise.all([
        canReadReporterDirectory
          ? apiRequest(modules["reporter-directory"].path)
          : Promise.resolve({ success: true, data: [] }),
        canReadStaffDirectory
          ? apiRequest(modules["staff-onboarding"].path)
          : Promise.resolve({ success: true, data: [] })
      ]);
      const reporters = unwrapData(reporterResult) || [];
      const staff = (unwrapData(onboardingResult) || []).filter((row) =>
        row.status === "active"
        && ["moderator", "editor"].includes(row.requested_role)
        && (tabKey === "all" || tabKey === "newsroom")
      ).map((row) => ({
        id: row.user_id,
        staff_role_id: row.staff_role_id,
        access_profile: row.requested_role,
        _role_assignment_history: row.role_assignment_history || [],
        _pending_role_change: row.pending_role_change || null,
        full_name: row.profile?.full_name || "—",
        email: row.profile?.email || "—",
        phone: row.profile?.phone || "—",
        role: row.staff_role?.display_name || row.requested_role,
        status: row.pending_role_change?.role
          ? "Role change awaiting acceptance"
          : "Active",
        active_since: formatDate(row.reviewed_at),
        location: row.permanent_address_city || "—"
      }));
      if (canReadReporterDirectory && (tabKey === "all" || tabKey === "reporter")) {
        renderReporterAdminSection("reporter-directory", root, reporters);
      }
      if (tabKey !== "reporter") {
        if (!canReadStaffDirectory && tabKey === "newsroom") {
          root.append(makeElement("p", "admin-empty", "Your access does not include the newsroom staff directory."));
        } else {
          root.append(renderTablePanel("Active newsroom staff", staff, "workflow-directory"));
        }
      }
    } else if (page === "agreements") {
      if (agreementPanelMode === "records") {
        const result = await apiRequest(`admin/agreement-records?role=${encodeURIComponent(tabKey)}`);
        renderAgreementRecords(root, unwrapData(result));
      } else {
        const result = agreementRoleData || unwrapData(await apiRequest(modules["role-agreements"].path));
        renderRoleAgreements(root, result, tabKey);
      }
    } else if (page === "credentials") {
      root.append(makeElement(
        "p",
        "admin-workflow-scope-note",
        "Issue and manage ID cards for approved newsroom staff. Authority letters are reporter-specific and require acceptance of the current service agreement."
      ));
      const result = await apiRequest(modules["reporter-credentials"].path);
      renderReporterAdminSection("reporter-credentials", root, unwrapData(result));
    }
    content.replaceChildren(root);
  } catch (error) {
    showPageError(error instanceof Error ? error.message : `${label} could not be loaded.`, () =>
      void loadWorkflowPage(page, tabKey));
  }
}

function canAccessConfigurationSection(section) {
  const config = configurationSections.find((item) => item.key === section);
  if (!config) return false;
  if (config.superAdminOnly) return sessionIdentity?.role === "super_admin";
  if (["admin", "super_admin"].includes(sessionIdentity?.role)) return true;
  if (config.permission && !sessionPermissions.includes(config.permission)) return false;
  if (config.anyPermissions?.length
      && !config.anyPermissions.some((permission) => sessionPermissions.includes(permission))) return false;
  return (config.requiredPermissions || []).every((permission) =>
    sessionPermissions.includes(permission));
}

function renderConfigurationNavigation() {
  const navigation = makeElement("nav", "admin-configuration-nav");
  navigation.setAttribute("aria-label", "Organization, location, and reporter setup sections");
  const availableSections = configurationSections.filter((section) =>
    canAccessConfigurationSection(section.key)
  );
  [...new Set(availableSections.map((section) => section.group))].forEach((groupName) => {
    const group = makeElement("div", "admin-configuration-nav-group");
    group.append(makeElement("span", "admin-configuration-nav-heading", groupName));
    availableSections.filter((section) => section.group === groupName).forEach((section) => {
      const button = makeElement("button", "admin-configuration-nav-item", section.label);
      button.type = "button";
      button.classList.toggle("is-active", activeConfigurationSection === section.key);
      if (activeConfigurationSection === section.key) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => void loadConfigurationPage(section.key));
      group.append(button);
    });
    navigation.append(group);
  });
  return navigation;
}

async function loadConfigurationPage(requestedSection = "configurations") {
  document.body.classList.remove("admin-hr-theme");
  const permittedSections = configurationSections.filter((section) =>
    canAccessConfigurationSection(section.key)
  );
  const requested = configurationSections.some((section) => section.key === requestedSection)
    ? requestedSection
    : requestedSection === "configurations"
      ? activeConfigurationSection.startsWith("organization-")
        ? activeConfigurationSection
        : "organization-identity"
      : activeConfigurationSection;
  const selected = permittedSections.some((section) => section.key === requested)
    ? requested
    : permittedSections[0]?.key;
  if (!selected) {
    showPageError("You do not have permission to access configuration.", loadSession);
    return;
  }

  activeConfigurationSection = selected;
  const section = configurationSections.find((item) => item.key === selected);
  const navSection = section.navSection || "configurations";
  const breadcrumbGroup = navSection === "locations" || navSection === "reporter-configuration"
    ? "Reporter operations"
    : sectionLabels[navSection] || "Organization & system";
  activeSection = navSection;
  document.querySelector("#breadcrumb-section").textContent =
    `${breadcrumbGroup} · ${section.label}`;
  navItems.forEach((item) => {
    const isCurrent = item.dataset.section === navSection;
    item.classList.toggle("is-active", isCurrent);
    if (isCurrent) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  content.replaceChildren(makeElement("div", "admin-loading", `Loading ${section.label.toLowerCase()}…`));

  const root = makeElement("div", "admin-section");
  root.classList.add("admin-configuration-page");
  addHeading(
    root,
    navSection === "configurations" ? "ORGANIZATION & SYSTEM" : "NEWSROOM · REPORTER OPERATIONS",
    navSection === "configurations" ? "Organization & system" : "Reporter operations",
    navSection === "configurations"
      ? "Manage organization identity, access, modules, workflows, and shared data models."
      : "Manage newsroom geography and reporter-specific setup."
  );
  const layout = makeElement("div", "admin-configuration-layout");
  const view = makeElement("main", "admin-configuration-view");
  const viewHeader = makeElement("header", "admin-configuration-view-header");
  viewHeader.append(
    makeElement("span", "admin-eyebrow", section.group),
    makeElement("h2", "", section.label),
    makeElement("p", "", section.description)
  );
  const viewContent = makeElement("div", "admin-configuration-content");
  layout.append(renderConfigurationNavigation(), view);
  view.append(viewHeader, viewContent);
  root.append(layout);

  try {
    if (selected === "locations") {
      const result = await apiRequest(modules.locations.path);
      locationRecords = unwrapData(result) || [];
      renderLocationModule(viewContent, []);
    } else if (selected === "reporter-configuration") {
      const result = await apiRequest(modules["reporter-configuration"].path);
      renderReporterAdminSection("reporter-configuration", viewContent, unwrapData(result));
    } else if (selected === "reporter-review-access") {
      const result = await apiRequest("admin/reporter-review-scopes");
      renderReporterReviewAccess(viewContent, unwrapData(result));
    } else if (selected === "organization-models") {
      const result = await apiRequest("admin/hr/configuration");
      hrManagementData = unwrapData(result) || {};
      if (hrManagementData.capabilities?.configuration !== true) {
        throw new Error("You do not have permission to manage organization data models.");
      }
      renderOrganizationModels(viewContent);
    } else {
      const result = await apiRequest("admin/organization/configuration");
      organizationConfigurationData = unwrapData(result) || {};
      renderOrganizationConfiguration(viewContent, selected);
    }
  } catch (error) {
    const panel = makeElement("section", "admin-error-panel");
    panel.append(
      makeElement("strong", "", "Couldn’t load this configuration."),
      makeElement("p", "", error instanceof Error ? error.message : "The request could not be completed.")
    );
    const retry = makeElement("button", "admin-secondary-button", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => void loadConfigurationPage(selected));
    panel.append(retry);
    viewContent.append(panel);
  }
  content.replaceChildren(root);
}

async function loadSection(section) {
  document.body.classList.remove("admin-hr-theme");
  if (legacySectionRoutes[section]) {
    const destination = legacySectionRoutes[section];
    if (workflowTabs[destination]) {
      const preferredTab = section === "reporter-applications" ? "reporter"
        : section === "staff-onboarding" ? "newsroom"
          : section === "reporter-directory" ? "reporter"
            : section === "role-agreements" ? activeWorkflowTabs.agreements
              : undefined;
      return loadWorkflowPage(destination, preferredTab || activeWorkflowTabs[destination]);
    }
    section = destination;
  }
  if (section === "configurations" || configurationSections.some((item) => item.key === section)) {
    return loadConfigurationPage(section);
  }
  if (workflowTabs[section]) {
    return loadWorkflowPage(section);
  }
  activeSection = section;
  const label = sectionLabels[section] || "Overview";
  document.querySelector("#breadcrumb-section").textContent = label;
  navItems.forEach((item) => {
    const isCurrent = item.dataset.section === section;
    item.classList.toggle("is-active", isCurrent);
    if (isCurrent) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  content.replaceChildren(
    makeElement("div", "admin-loading", `Loading ${label.toLowerCase()}…`)
  );

  if (section === "overview") {
    try {
      const result = await apiRequest("admin/dashboard");
      overviewData = unwrapData(result) || {};
      renderOverview();
    } catch (error) {
      showPageError(error.message, () => void loadSection(section));
    }
    return;
  }

  if (section === "settings") {
    renderSettings();
    return;
  }

  if (section === "hr-management") {
    void loadHrManagement();
    return;
  }

  if (section === "staff-roles") {
    try {
      const result = await apiRequest(modules["staff-roles"].path);
      const root = makeElement("div", "admin-section");
      addHeading(root, "NEWSROOM · PEOPLE", "Newsroom roles", modules["staff-roles"].description);
      const actions = pageActions(root);
      const addRole = makeElement("button", "admin-primary-button admin-create-button", "Add newsroom role");
      addRole.type = "button";
      addRole.addEventListener("click", () => void openStaffRoleDialog(null, () => loadSection("staff-roles")));
      actions.append(addRole);
      renderStaffRoleCatalog(root, unwrapData(result) || []);
      content.replaceChildren(root);
    } catch (error) {
      showPageError(error.message, () => void loadSection(section));
    }
    return;
  }

  const config = modules[section];
  if (!config) {
    showPageError("This admin section is not configured.", () => void loadSection(section));
    return;
  }

  const requests = [
    { label, path: config.path, main: true },
    ...(config.related || []).map((item) => ({ ...item, main: false }))
  ];
  const results = await Promise.all(
    requests.map(async (item) => {
      try {
        const path = item.audit
          ? `${item.path}?${new URLSearchParams(auditFilters)}`
          : item.path;
        const response = await apiRequest(path);
        return { ...item, data: unwrapData(response), meta: response?.meta };
      } catch (error) {
        return { ...item, error: error.message };
      }
    })
  );
  const mainResult = results[0];
  if (mainResult.error) {
    showPageError(mainResult.error, () => void loadSection(section));
    return;
  }
  renderModule(section, results);
}

function renderOverview() {
  const data = overviewData || {};
  const cards = [
    ["Users", data.total_users],
    ["Articles", data.total_articles],
    ["Categories", data.total_categories],
    ["Published", data.published_articles]
  ];
  const root = makeElement("div", "admin-section");
  addHeading(root, "WORKSPACE", "Overview", "A live snapshot of your Chowk newsroom.");

  const grid = makeElement("div", "admin-metric-grid");
  const icons = ["♙", "▤", "✓", "◈", "▧"];
  const tones = ["orange", "blue", "green", "purple", "cyan"];
  cards.forEach(([label, value], index) => {
    const card = makeElement("article", "admin-metric-card");
    card.append(makeElement("span", `metric-icon ${tones[index]}`, icons[index]));
    card.append(makeElement("span", "metric-label", label));
    card.append(makeElement("strong", "metric-value", value ?? "—"));
    grid.append(card);
  });
  root.append(grid);

  const recentArticles = Array.isArray(data.recent_articles) ? data.recent_articles : [];
  const recentUsers = Array.isArray(data.recent_users) ? data.recent_users : [];
  root.append(renderTablePanel("Latest articles", rowsFromData(recentArticles), "articles"));
  root.append(renderTablePanel("Recently joined users", rowsFromData(recentUsers), "users"));
  content.replaceChildren(root);
}

function renderModule(section, results) {
  const config = modules[section];
  const label = sectionLabels[section] || section;
  const root = makeElement("div", "admin-section");
  addHeading(root, "NEWSROOM", label, config.description);

  if (section === "audit-logs") {
    renderAuditHistory(root, results[0]);
    content.replaceChildren(root);
    return;
  }
  if (section === "staff-onboarding") {
    renderStaffOnboarding(root, results[0].data);
    content.replaceChildren(root);
    return;
  }
  if (section === "role-agreements") {
    renderRoleAgreements(root, results[0].data);
    content.replaceChildren(root);
    return;
  }
  if (section === "coverage") {
    renderReporterAdminSection("reporter-coverage", root, results[0].data);
    content.replaceChildren(root);
    return;
  }
  if (section === "territory-leadership") {
    renderTerritoryLeadership(root, results[0].data || {});
    content.replaceChildren(root);
    return;
  }
  if (section.startsWith("reporter-")
      && section !== "reporter-designations") {
    renderReporterAdminSection(section, root, results[0].data);
    content.replaceChildren(root);
    return;
  }
  if (section === "locations") {
    locationRecords = Array.isArray(results[0]?.data) ? results[0].data : [];
    renderLocationModule(root, results);
    content.replaceChildren(root);
    return;
  }

  const actions = makeElement("div", "admin-page-actions");
  if (section === "accounts") {
    const createSubscriber = makeElement("button", "admin-secondary-button admin-create-button", "Create subscriber");
    createSubscriber.type = "button";
    createSubscriber.addEventListener("click", () => openUserDialog());
    actions.append(createSubscriber);
  } else if (config.createPath) {
    const button = makeElement("button", "admin-primary-button admin-create-button", `Add ${singular(label)}`);
    button.type = "button";
    button.addEventListener("click", () => openConfiguredRecordDialog(section, null));
    actions.append(button);
  }
  if (section === "articles") {
    const reportButton = makeElement("button", "admin-secondary-button admin-create-button", "Daily submission report");
    reportButton.type = "button";
    reportButton.addEventListener("click", () => void openDailySubmissionReport(reportButton));
    actions.append(reportButton);
  }
  if (actions.childElementCount) root.append(actions);

  results.forEach((result) => {
    const panel = makeElement("section", "admin-panel");
    const header = makeElement("div", "admin-panel-heading");
    header.append(makeElement("h2", "", result.label));
    if (result.error) {
      panel.append(header, makeElement("p", "admin-empty admin-inline-error", result.error));
      root.append(panel);
      return;
    }
    let rows = rowsFromData(result.data, result.label);
    if (section === "locations") {
      const byId = new Map(locationRecords.map((location) => [String(location.id), location]));
      rows = rows.map((location) => ({
        ...location,
        hierarchy: locationPath(location, byId),
        parent_location: byId.get(String(location.parent_id))?.name || "Top level"
      }));
    }
    header.append(makeElement("span", "", `${rows.length} records`));
    panel.append(header, buildTable(rows, section));
    root.append(panel);
  });
  content.replaceChildren(root);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

async function openDailySubmissionReport(button) {
  const today = new Date();
  const suggested = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");
  const date = window.prompt("Report date (YYYY-MM-DD; report timezone is UTC)", suggested);
  if (!date) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    void showAdminMessage("Invalid date", "Enter the date in YYYY-MM-DD format.");
    return;
  }
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    void showAdminMessage("Report window blocked", "Allow pop-ups to open the printable newsroom report.");
    return;
  }
  button.disabled = true;
  try {
    const result = await apiRequest(`admin/daily-submission-report?date=${encodeURIComponent(date)}`);
    const submissions = result.data?.submissions || [];
    const rows = submissions.map((item) => `<tr>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.author?.full_name || item.author?.email || "—")}</td>
      <td>${escapeHtml(item.reporting_location?.name || "—")}</td>
      <td>${escapeHtml(String(item.workflow_status || "draft").replaceAll("_", " "))}</td>
      <td>${escapeHtml(item.submitted_at ? new Date(item.submitted_at).toLocaleString() : "—")}</td>
      <td>${escapeHtml(item.review_note || "—")}</td>
    </tr>`).join("");
    reportWindow.document.open();
    reportWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Daily newsroom report ${escapeHtml(date)}</title>
      <style>body{font:14px Arial,sans-serif;margin:32px;color:#253149}h1{font-size:24px}p{color:#68758a}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{border:1px solid #d9dee7;padding:9px;text-align:left;vertical-align:top}th{background:#f3f5f8}@media print{button{display:none}}</style>
      </head><body><h1>Daily newsroom submission report</h1><p>Date: ${escapeHtml(date)} (UTC) · ${submissions.length} submission(s)</p>
      <table><thead><tr><th>Headline</th><th>Reporter</th><th>Location</th><th>Workflow status</th><th>Submitted</th><th>Latest note</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">No stories were submitted on this date.</td></tr>'}</tbody></table>
      <button onclick="window.print()">Print / Save as PDF</button></body></html>`);
    reportWindow.document.close();
  } catch (error) {
    reportWindow.close();
    void showAdminMessage("Report could not be generated", error instanceof Error ? error.message : "The daily submission report could not be generated.");
  } finally {
    button.disabled = false;
  }
}

function locationPath(location, byId) {
  const names = [];
  const visited = new Set();
  let current = location;
  while (current && !visited.has(String(current.id))) {
    visited.add(String(current.id));
    names.unshift(current.name);
    current = current.parent_id ? byId.get(String(current.parent_id)) : null;
  }
  return names.join(" / ");
}

function reporterPanel(root, title, rows, section) {
  const panel = makeElement("section", "admin-panel");
  const header = makeElement("div", "admin-panel-heading");
  header.append(makeElement("h2", "", title));
  header.append(makeElement("span", "", `${rows.length} records`));
  panel.append(header, buildTable(rows, section));
  root.append(panel);
}

function appendReporterSelect(form, name, title, values, labelFor, placeholder = "Choose an option") {
  const label = makeElement("label", "admin-form-field");
  label.append(makeElement("span", "", title));
  const select = document.createElement("select");
  select.name = name;
  select.required = true;
  const first = makeElement("option", "", placeholder);
  first.value = "";
  first.disabled = true;
  first.selected = true;
  select.append(first);
  values.forEach((value) => {
    const option = makeElement("option", "", labelFor(value));
    option.value = String(value.id);
    select.append(option);
  });
  label.append(select);
  form.append(label);
  return select;
}

function reporterActionButton(root, label, handler) {
  const button = makeElement("button", "admin-primary-button admin-create-button", label);
  button.type = "button";
  button.addEventListener("click", handler);
  pageActions(root).append(button);
}

function pageActions(root) {
  let actions = root.querySelector(".admin-page-actions");
  if (!actions) {
    actions = makeElement("div", "admin-page-actions");
    root.append(actions);
  }
  return actions;
}

function renderReporterAdminSection(section, root, data) {
  if (section === "reporter-applications") {
    const applications = Array.isArray(data) ? data : [];
    const rows = applications.map((application) => ({
      ...application,
      applicant_name: application.user?.full_name || "—",
      email: application.user?.email || "—",
      state_name: application.state?.state_name || "—",
      city: application.rto?.city_name && application.rto?.rto_code
        ? `${application.rto.city_name} (${application.rto.rto_code})`
        : application.rto?.city_name || application.rto?.rto_code || "—",
      area_coverage: application.coverage_area_name || "—",
      details_confirmed: application.applicant_details_confirmed ? "Confirmed" : "Not recorded"
    }));
    reporterPanel(root, "Reporter applications", rows, section);
    return;
  }

  if (section === "reporter-directory") {
    const reporters = Array.isArray(data) ? data : [];
    const rows = reporters.map((reporter) => {
      const assignments = Array.isArray(reporter.assignments) ? reporter.assignments : [];
      const current = assignments.find((assignment) => !assignment.effective_to);
      const coverageArea = reporter.coverage_area_name || "Coverage area not recorded";
      const formatAssignment = (assignment) => [
        `${assignment.rto?.state?.state_code || ""}${assignment.rto?.rto_code || ""}`,
        coverageArea,
        assignment.reporter_designation?.name || "Designation not assigned"
      ].filter(Boolean).join(" · ");
      return {
        full_name: reporter.user?.full_name || "—",
        email: reporter.user?.email || "—",
        reporter_code: reporter.reporter_code,
        current_assignment: current
          ? formatAssignment(current)
          : "No current assignment",
        assignment_history: assignments.map((assignment) =>
          `${formatAssignment(assignment)} · ${assignment.effective_to ? formatDate(assignment.effective_from) + " – " + formatDate(assignment.effective_to) : "Current"}`
        ).join(" | ") || "No assignment history",
        role: reporter.user?.role || "—",
        assignments: assignments.length,
        _current_designation_id: current?.reporter_designation_id || "",
        user_id: reporter.user_id
      };
    });
    reporterPanel(root, "Approved reporter directory", rows, section);
    return;
  }

  if (section === "reporter-coverage") {
    const locationsById = new Map((data.locations || []).map((location) => [String(location.id), location]));
    const staffById = new Map((data.staff || []).map((staff) => [staff.id, staff]));
    const rows = (data.assignments || []).map((assignment) => {
      const locationId = assignment.region_id || assignment.zone_id || assignment.district_id || assignment.city_id || assignment.coverage_area_id;
      const location = locationsById.get(String(locationId));
      const staff = staffById.get(assignment.user_id);
      return {
        staff: staff?.full_name || staff?.email || assignment.user_id,
        role: staff?.role || "—",
        coverage: location ? `${location.name} · ${location.location_type}` : "Unavailable location",
        include_descendants: assignment.include_descendants,
        valid_from: formatDate(assignment.valid_from),
        valid_to: assignment.valid_to ? formatDate(assignment.valid_to) : "Current",
        id: assignment.id,
        _active: !assignment.valid_to
      };
    });
    reporterActionButton(root, "Assign coverage", () => openCoverageDialog(data));
    reporterPanel(root, "Coverage history", rows, section);
    return;
  }

  if (section === "reporter-credentials") {
    const credentials = Array.isArray(data.credentials) ? data.credentials : [];
    const rows = credentials.map((credential) => {
      let status = currentCredentialStatus(credential);
      const onboardingPending = data.staff?.some((person) =>
        person.id === credential.subject_user_id_snapshot
          && person.onboarding_status === "approved"
      ) && credentials.some((item) =>
        item.subject_user_id_snapshot === credential.subject_user_id_snapshot
          && item.credential_type === "authority_letter"
          && item.status === "pending_acceptance"
      );
      if (status === "active"
          && onboardingPending
          && credential.credential_type === "id_card") {
        status = "pending_acceptance";
      }
      return {
        name: credential.name_snapshot,
        role: credential.role_snapshot,
        reporter_code: credential.reporter_code_snapshot || "—",
        type: credential.credential_type.replace("_", " "),
        reference: credential.reference_code,
        status: status.replaceAll("_", " "),
        _stored_status: credential.status,
        scope: [
          credential.scope_snapshot?.designation,
          credential.scope_snapshot?.state_name,
          credential.scope_snapshot?.rto_code,
          credential.scope_snapshot?.city_name
        ].filter(Boolean).join(" · ") || "—",
        valid_until: formatDate(credential.valid_until),
        id: credential.id
      };
    });
    reporterActionButton(root, "Issue credential", () => void openCredentialDialog(data.staff || []));
    reporterPanel(root, "Issued staff credentials", rows, section);
    return;
  }

  if (section === "reporter-configuration" || section === "reporter-options") {
    renderReporterSetup(root, data);
  }
}

function renderTerritoryLeadership(root, data) {
  const locations = Array.isArray(data.locations) ? data.locations : [];
  const roles = Array.isArray(data.roles) ? data.roles : [];
  const people = Array.isArray(data.people) ? data.people : [];
  const assignments = Array.isArray(data.assignments) ? data.assignments : [];
  const locationsById = new Map(locations.map((location) => [String(location.id), location]));
  const locationLabel = (location) => {
    const hierarchy = [];
    const visited = new Set();
    let current = location;
    while (current && !visited.has(String(current.id))) {
      visited.add(String(current.id));
      hierarchy.push(current.name);
      current = locationsById.get(String(current.parent_id));
    }
    return hierarchy.reverse().join(" › ");
  };
  const formatInclusiveEndDate = (value) =>
    value ? formatDate(new Date(new Date(value).getTime() - 1)) : "No scheduled end";
  const actions = pageActions(root);
  const manageRoles = makeElement("button", "admin-secondary-button admin-create-button", "Manage leadership roles");
  manageRoles.type = "button";
  manageRoles.addEventListener("click", () => openLeadershipRolesDialog(roles));
  const appoint = makeElement("button", "admin-primary-button admin-create-button", "Appoint leader");
  appoint.type = "button";
  appoint.disabled = !roles.some((role) => role.is_active)
    || !locations.some((location) => location.is_active)
    || !people.length;
  appoint.addEventListener("click", () => openLeadershipAppointmentDialog({
    roles, people, locations, assignments, locationLabel
  }));
  actions.append(manageRoles, appoint);

  const note = makeElement(
    "p",
    "admin-workflow-scope-note",
    "Appointments record who leads a territory and for what dates. They do not grant system access or change HR reporting lines. Permanent and acting appointments are tracked separately; replacement and ending actions retain the history."
  );
  root.append(note);
  const eligiblePeople = new Set(people.map((person) => String(person.id || person.user_id)));
  const appointmentsNeedingReview = assignments.filter((assignment) =>
    ["active", "scheduled"].includes(assignment.appointment_state)
      && !eligiblePeople.has(String(assignment.person_id))
  );
  if (appointmentsNeedingReview.length) {
    root.append(makeElement(
      "p",
      "admin-workflow-scope-note admin-workflow-scope-note-warning",
      `${appointmentsNeedingReview.length} active or scheduled appointment(s) have an appointee who no longer meets the current eligibility rules. Review and end or cancel these appointments; leadership appointments do not end automatically.`
    ));
  }

  const panel = makeElement("section", "admin-panel");
  const header = makeElement("div", "admin-panel-heading");
  header.append(
    makeElement("h2", "", "Appointment history"),
    makeElement("span", "", `${assignments.length} records`)
  );
  panel.append(header);
  if (!assignments.length) {
    panel.append(makeElement("p", "admin-empty", "No territory leadership appointments have been made."));
  } else {
    const wrapper = makeElement("div", "admin-table-wrap");
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Role", "Territory", "Appointee", "Type", "Status", "Effective dates", "Reason", "Actions"]
      .forEach((label) => headerRow.append(makeElement("th", "", label)));
    thead.append(headerRow);
    table.append(thead);
    const tbody = document.createElement("tbody");
    assignments.forEach((assignment) => {
      const row = document.createElement("tr");
      const location = locationsById.get(String(assignment.location_id));
      const cells = [
        assignment.role_name,
        location ? locationLabel(location) : assignment.location_name || "Unavailable location",
        assignment.appointment_type,
        String(assignment.appointment_state || "unknown").replaceAll("_", " "),
        `${formatDate(assignment.valid_from)} – ${formatInclusiveEndDate(assignment.valid_to)}`
      ];
      const personCell = makeElement("td", "", assignment.person_name || assignment.person_email || "Unavailable person");
      if (assignment.person_email && assignment.person_name) {
        personCell.append(makeElement("small", "", assignment.person_email));
      }
      row.append(makeElement("td", "article-title-cell", cells[0] || "—"));
      row.append(makeElement("td", "article-title-cell", cells[1] || "—"));
      row.append(personCell);
      cells.slice(2).forEach((value, index) => {
        const cell = makeElement("td", "", value || "—");
        if (index === 2 && assignment.ended_at) {
          cell.append(makeElement("small", "", `Ended ${formatDate(assignment.ended_at)}`));
        } else if (index === 2 && assignment.cancelled_at) {
          cell.append(makeElement("small", "", `Cancelled ${formatDate(assignment.cancelled_at)}`));
        }
        row.append(cell);
      });
      const reasonCell = makeElement("td", "", assignment.assignment_reason || "—");
      if (assignment.end_reason) {
        reasonCell.append(makeElement("small", "", `Closure: ${assignment.end_reason}`));
      }
      row.append(reasonCell);
      const actionCell = makeElement("td", "admin-row-actions");
      if (["active", "scheduled"].includes(assignment.appointment_state)) {
        rowButton(
          actionCell,
          assignment.appointment_state === "scheduled" ? "Cancel" : "End appointment",
          () => openEndLeadershipAppointmentDialog(assignment.id, assignment.appointment_state === "scheduled"),
          "admin-row-button danger"
        );
      }
      row.append(actionCell);
      tbody.append(row);
    });
    table.append(tbody);
    wrapper.append(table);
    panel.append(wrapper);
  }
  root.append(panel);

  const rolePanel = makeElement("section", "admin-panel");
  const roleHeader = makeElement("div", "admin-panel-heading");
  roleHeader.append(
    makeElement("h2", "", "Configured leadership roles"),
    makeElement("span", "", `${roles.filter((role) => role.is_active).length} active · ${roles.length} total`)
  );
  rolePanel.append(roleHeader);
  if (!roles.length) {
    rolePanel.append(makeElement("p", "admin-empty", "No leadership roles are configured."));
  } else {
    const roleList = makeElement("div", "admin-table-wrap");
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Role", "Territory level", "Kind", "Status", "Description", "Actions"]
      .forEach((label) => headerRow.append(makeElement("th", "", label)));
    thead.append(headerRow);
    table.append(thead);
    const tbody = document.createElement("tbody");
    roles.forEach((role) => {
      const row = document.createElement("tr");
      [
        role.name,
        String(role.location_type).replaceAll("_", " "),
        role.is_builtin ? "Built-in" : "Custom",
        role.is_active ? "Active" : "Inactive",
        role.description || "—"
      ].forEach((value, index) =>
        row.append(makeElement("td", index === 0 ? "article-title-cell" : "", value))
      );
      const actionsCell = makeElement("td", "admin-row-actions");
      rowButton(actionsCell, "Edit", () => openLeadershipRoleDialog(role));
      row.append(actionsCell);
      tbody.append(row);
    });
    table.append(tbody);
    roleList.append(table);
    rolePanel.append(roleList);
  }
  root.append(rolePanel);
}

function openLeadershipRolesDialog(roles) {
  const dialog = document.createElement("dialog");
  dialog.className = "admin-json-dialog";
  const body = makeElement("section", "admin-json-form admin-confirm-content");
  body.append(
    makeElement("span", "admin-eyebrow", "TERRITORY LEADERSHIP"),
    makeElement("h2", "", "Manage leadership roles"),
    makeElement("p", "admin-dialog-help", "Create additional titles or edit existing roles. Built-in role keys and territory levels are fixed to protect their assignment history.")
  );
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  roles.forEach((role) => {
    const row = document.createElement("tr");
    row.append(makeElement("td", "", role.name));
    row.append(makeElement("td", "", String(role.location_type).replaceAll("_", " ")));
    row.append(makeElement("td", "", role.is_active ? "Active" : "Inactive"));
    const actions = makeElement("td", "admin-row-actions");
    rowButton(actions, "Edit", () => {
      dialog.close();
      openLeadershipRoleDialog(role);
    });
    row.append(actions);
    tbody.append(row);
  });
  table.append(tbody);
  const wrapper = makeElement("div", "admin-table-wrap");
  wrapper.append(table);
  body.append(wrapper);
  const actions = makeElement("div", "admin-dialog-actions");
  const close = makeElement("button", "admin-secondary-button", "Close");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  const add = makeElement("button", "admin-primary-button", "Add role");
  add.type = "button";
  add.addEventListener("click", () => {
    dialog.close();
    openLeadershipRoleDialog(null);
  });
  actions.append(close, add);
  body.append(actions);
  dialog.append(body);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

function openLeadershipRoleDialog(role) {
  openFormDialog(
    role ? "Edit leadership role" : "Create leadership role",
    "Role titles identify the responsibility, not a permission set. Deactivate a role to prevent future appointments while retaining its appointment history.",
    (form) => {
      addField(form, "Role name", "name", "text", role?.name || "", { minLength: 2, maxLength: 100 });
      addField(form, "Role key", "role_key", "text", role?.role_key || "", {
        minLength: 2, maxLength: 50, required: !role?.is_builtin
      }).readOnly = Boolean(role?.is_builtin);
      const levels = [
        ["state", "State"], ["region", "Region"], ["zone", "Zone"], ["range", "Range"],
        ["district", "District"], ["tehsil", "Tehsil"], ["block", "Block"],
        ["coverage_area", "Coverage area"]
      ];
      const level = appendValueSelect(form, "location_type", "Territory level", levels);
      level.value = role?.location_type || "state";
      level.disabled = Boolean(role?.is_builtin);
      const description = makeElement("label", "admin-form-field");
      description.append(makeElement("span", "", "Description"));
      const textarea = document.createElement("textarea");
      textarea.name = "description";
      textarea.maxLength = 2000;
      textarea.value = role?.description || "";
      description.append(textarea);
      form.append(description);
      appendValueSelect(form, "is_active", "Status", [
        ["true", "Active"], ["false", "Inactive"]
      ]).value = String(role?.is_active !== false);
    },
    async (values) => {
      await apiRequest("admin/territory-leadership/roles", "POST", {
        id: role?.id || null,
        role_key: role?.role_key || values.get("role_key"),
        name: values.get("name"),
        description: values.get("description"),
        location_type: role?.location_type || values.get("location_type"),
        is_active: values.get("is_active") === "true"
      });
      await loadSection("territory-leadership");
    },
    role ? "Save role" : "Create role"
  );
}

function openLeadershipAppointmentDialog({ roles, people, locations, assignments, locationLabel }) {
  const activeRoles = roles.filter((role) => role.is_active);
  const activeLocations = locations.filter((location) => location.is_active);
  openFormDialog(
    "Appoint territory leader",
    "Choose an eligible active HR employee or newsroom contributor. An appointment does not grant system access. End dates include the entire selected day.",
    (form) => {
      const roleSelect = appendReporterSelect(
        form, "role_id", "Leadership role", activeRoles,
        (role) => `${role.name} · ${String(role.location_type).replaceAll("_", " ")}`
      );
      const locationSelect = appendReporterSelect(form, "location_id", "Territory", [], (location) =>
        locationLabel(location)
      );
      const personSelect = appendReporterSelect(form, "person_id", "Appointee", people, (person) =>
        `${person.full_name || person.email} · ${person.relationship} · ${person.email}`
      );
      const typeSelect = appendValueSelect(form, "appointment_type", "Appointment type", [
        ["permanent", "Permanent"], ["acting", "Acting"]
      ]);
      const start = addField(form, "Effective from", "valid_from", "date", dateInputValue());
      const end = addField(form, "Effective through (required for acting appointments)", "valid_to", "date", "", { required: false });
      typeSelect.addEventListener("change", () => {
        end.required = typeSelect.value === "acting";
      });
      end.required = typeSelect.value === "acting";
      const reason = makeElement("label", "admin-form-field");
      reason.append(makeElement("span", "", "Appointment reason"));
      const reasonInput = document.createElement("textarea");
      reasonInput.name = "reason";
      reasonInput.required = true;
      reasonInput.minLength = 2;
      reasonInput.maxLength = 1000;
      reason.append(reasonInput);
      form.append(reason);
      const replacementSelect = appendOptionalLeadershipSelect(
        form, "replace_assignment_id", "Replace overlapping appointment (optional)"
      );
      const replacementReason = makeElement("label", "admin-form-field");
      replacementReason.append(makeElement("span", "", "Replacement reason"));
      const replacementNote = document.createElement("textarea");
      replacementNote.name = "replace_reason";
      replacementNote.maxLength = 1000;
      replacementNote.disabled = true;
      replacementReason.append(replacementNote);
      form.append(replacementReason);

      const refreshLocationsAndReplacements = () => {
        const selectedRole = activeRoles.find((item) => String(item.id) === roleSelect.value);
        const eligibleLocations = activeLocations.filter((location) =>
          location.location_type === selectedRole?.location_type
        );
        replaceValueOptions(locationSelect, eligibleLocations, "Choose a territory", locationLabel);
        const selectedLocation = locationSelect.value;
        const selectedType = typeSelect.value;
        const proposedStart = start.value ? new Date(`${start.value}T00:00:00`).getTime() : NaN;
        const replacements = assignments.filter((assignment) =>
          assignment.role_id === roleSelect.value
          && String(assignment.location_id) === selectedLocation
          && assignment.appointment_type === selectedType
          && assignment.appointment_state !== "cancelled"
          && Number.isFinite(proposedStart)
          && new Date(assignment.valid_from).getTime() < proposedStart
          && Math.min(
            assignment.valid_to ? new Date(assignment.valid_to).getTime() : Infinity,
            assignment.ended_at ? new Date(assignment.ended_at).getTime() : Infinity
          ) > proposedStart
        );
        const previous = replacementSelect.value;
        replacementSelect.replaceChildren(new Option("No replacement", ""));
        replacements.forEach((assignment) => {
          replacementSelect.append(new Option(
            `${assignment.person_name || assignment.person_email} · ${formatDate(assignment.valid_from)}`,
            assignment.id
          ));
        });
        if (replacements.some((assignment) => String(assignment.id) === previous)) {
          replacementSelect.value = previous;
        }
        replacementNote.disabled = !replacementSelect.value;
        replacementNote.required = Boolean(replacementSelect.value);
      };
      [roleSelect, locationSelect, typeSelect, start].forEach((control) =>
        control.addEventListener("change", refreshLocationsAndReplacements)
      );
      replacementSelect.addEventListener("change", () => {
        replacementNote.disabled = !replacementSelect.value;
        replacementNote.required = Boolean(replacementSelect.value);
      });
      refreshLocationsAndReplacements();
    },
    async (values) => {
      const dateToIso = (value, inclusiveEnd = false) => {
        if (!value) return null;
        const date = new Date(`${value}T00:00:00`);
        if (inclusiveEnd) date.setDate(date.getDate() + 1);
        return date.toISOString();
      };
      await apiRequest("admin/territory-leadership/appointments", "POST", {
        role_id: values.get("role_id"),
        location_id: values.get("location_id"),
        person_id: values.get("person_id"),
        appointment_type: values.get("appointment_type"),
        valid_from: dateToIso(values.get("valid_from")),
        valid_to: dateToIso(values.get("valid_to"), true),
        reason: values.get("reason"),
        replace_assignment_id: values.get("replace_assignment_id") || null,
        replace_reason: values.get("replace_reason") || ""
      });
      await loadSection("territory-leadership");
    },
    "Save appointment"
  );
}

function appendOptionalLeadershipSelect(form, name, title) {
  const label = makeElement("label", "admin-form-field");
  label.append(makeElement("span", "", title));
  const select = document.createElement("select");
  select.name = name;
  select.append(new Option("No replacement", ""));
  label.append(select);
  form.append(label);
  return select;
}

function openEndLeadershipAppointmentDialog(assignmentId, isScheduled) {
  openFormDialog(
    isScheduled ? "Cancel scheduled appointment" : "End leadership appointment",
    isScheduled
      ? "The appointment has not started yet. Cancelling it retains the record and prevents it from taking effect."
      : "Enter why this appointment is ending. The historical appointment record will be retained.",
    (form) => {
      const label = makeElement("label", "admin-form-field");
      label.append(makeElement("span", "", isScheduled ? "Cancellation reason" : "End reason"));
      const textarea = document.createElement("textarea");
      textarea.name = "reason";
      textarea.required = true;
      textarea.minLength = 2;
      textarea.maxLength = 1000;
      label.append(textarea);
      form.append(label);
    },
    async (values) => {
      await apiRequest(
        `admin/territory-leadership/appointments/${assignmentId}/end`,
        "POST",
        { reason: values.get("reason") }
      );
      await loadSection("territory-leadership");
    },
    isScheduled ? "Cancel appointment" : "End appointment"
  );
}

function renderReporterSetup(root, data) {
  root.querySelectorAll(".reporter-setup-overview, .reporter-setup-detail")
    .forEach((view) => view.remove());
  const designations = data.reporter_designations || [];
  const reporterJobAgreement = data.reporter_job_agreement;
  const organizationProfile = data.organization_profile;
  const setupSections = [
    {
      key: "types",
      title: "Reporter designations",
      count: designations.length,
      detail: `${designations.filter((designation) => designation.is_active).length} active · Two-digit designation codes are used in new state-RTO-code-number IDs.`
    },
  ];
  if (!setupSections.some((item) => item.key === reporterSetupView)) reporterSetupView = "overview";
  const overview = makeElement("section", "reporter-setup-overview");
  const cards = makeElement("div", "reporter-setup-cards");
  setupSections.forEach((item) => {
    const card = makeElement("button", "reporter-setup-card");
    card.type = "button";
    card.setAttribute("aria-pressed", String(reporterSetupView === item.key));
    card.append(
      makeElement("span", "reporter-setup-card-label", item.title),
      makeElement("strong", "reporter-setup-card-count", String(item.count)),
      makeElement("span", "reporter-setup-card-detail", item.detail),
      makeElement("span", "reporter-setup-card-action", reporterSetupView === item.key ? "Currently open" : "Manage →")
    );
    card.addEventListener("click", () => {
      reporterSetupView = item.key;
      renderReporterAdminSection("reporter-configuration", root, data);
    });
    cards.append(card);
  });
  overview.append(cards);

  if (reporterSetupView === "overview") {
    const organizationCard = makeElement("section", "admin-panel reporter-organization-profile");
    const organizationHeading = makeElement("div", "admin-panel-heading");
    const organizationHeadingCopy = makeElement("div", "reporter-setup-detail-copy");
    organizationHeadingCopy.append(makeElement("h2", "", "Organization legal profile"));
    organizationHeadingCopy.append(makeElement(
      "span",
      "",
      "Legal identity and official contact details used in finalized reporter agreements."
    ));
    organizationHeading.append(organizationHeadingCopy);
    const organizationStatus = makeElement(
      "span",
      `reporter-organization-status${organizationProfile?.is_verified ? " is-verified" : ""}`,
      organizationProfile?.is_verified ? "VERIFIED" : "NOT VERIFIED"
    );
    organizationHeading.append(organizationStatus);
    organizationCard.append(organizationHeading);
    const organizationFields = [
      ["Registered legal name", organizationProfile?.legal_name],
      ["Trading name", organizationProfile?.trade_name],
      ["Entity type", organizationProfile?.entity_type],
      ["Registered office", organizationProfile?.registered_address],
      ["Registration number", organizationProfile?.registration_number],
      ["Official email", organizationProfile?.official_email],
      ["Official phone", organizationProfile?.official_phone],
      ["Official website", organizationProfile?.website_url]
    ];
    const organizationDetails = makeElement("dl", "reporter-organization-fields");
    organizationFields.forEach(([label, value]) => {
      organizationDetails.append(
        makeElement("dt", "", label),
        makeElement("dd", "", value || "Not set")
      );
    });
    organizationCard.append(organizationDetails);
    const organizationActions = makeElement("div", "admin-page-actions");
    const manageOrganization = makeElement("button", "admin-secondary-button", "Manage legal details");
    manageOrganization.type = "button";
    manageOrganization.addEventListener("click", () =>
      openReporterOrganizationProfileDialog(organizationProfile));
    organizationActions.append(manageOrganization);
    organizationCard.append(organizationActions);
    overview.append(organizationCard);

    const locationNote = makeElement("section", "admin-panel reporter-setup-location-note");
    locationNote.append(
      makeElement("h2", "", "State codes, Districts, and RTO codes"),
      makeElement("p", "admin-dialog-help",
        "Manage each State's two-character reporter ID code and each District's RTO code in Locations. Reporter setup does not maintain a second state-code or RTO-office catalog; the application keeps linked legacy records internally so existing reporter assignments, IDs, and history continue to work.")
    );
    const locationsButton = makeElement("button", "admin-secondary-button", "Open Locations");
    locationsButton.type = "button";
    locationsButton.addEventListener("click", () => void loadSection("locations"));
    locationNote.append(locationsButton);
    overview.append(locationNote);
    const reporterSetupReady = Boolean(reporterJobAgreement && organizationProfile?.is_verified);
    const setupNote = makeElement("div", `reporter-setup-readiness${reporterSetupReady ? " is-ready" : " is-incomplete"}`);
    setupNote.append(
      makeElement("strong", "", reporterSetupReady && organizationProfile?.is_verified
        ? `Reporter job agreement v${reporterJobAgreement.version} published`
        : "Applications open · Reporter job agreement setup needed"),
      makeElement("span", "", "After approval, the reporter must accept the current Reporter job agreement before credentials can be issued, then acknowledge the authority letter.")
    );
    overview.append(setupNote);
    const agreementsButton = makeElement("button", "admin-secondary-button", "Manage Reporter job agreement");
    agreementsButton.type = "button";
    agreementsButton.addEventListener("click", () => void loadSection("role-agreements"));
    overview.append(agreementsButton);
    root.append(overview);
    return;
  }

  const selected = setupSections.find((item) => item.key === reporterSetupView);
  const section = makeElement("section", "admin-panel reporter-setup-detail");
  const header = makeElement("div", "admin-panel-heading reporter-setup-detail-heading");
  const headingCopy = makeElement("div", "reporter-setup-detail-copy");
  headingCopy.append(makeElement("h2", "", selected?.title || "Reporter setup"));
  headingCopy.append(makeElement("span", "", selected?.detail || ""));
  header.append(headingCopy);
  const actions = makeElement("div", "reporter-setup-detail-actions");
  const back = makeElement("button", "admin-secondary-button", "← Setup overview");
  back.type = "button";
  back.addEventListener("click", () => {
    reporterSetupView = "overview";
    renderReporterAdminSection("reporter-configuration", root, data);
  });
  actions.append(back);
  if (reporterSetupView === "types") {
    rowButton(actions, "Add designation", () => openConfiguredRecordDialog("reporter-designations", null), "admin-primary-button reporter-setup-add");
  }
  header.append(actions);

  const tableSection = "reporter-designations";
  const rows = designations.map((designation) => ({
    name: designation.name,
    designation_code: designation.designation_code,
    description: designation.description || "—",
    is_active: designation.is_active,
    id: designation.id
  }));
  const tableHeader = makeElement("div", "admin-panel-heading reporter-setup-table-heading");
  tableHeader.append(
    makeElement("strong", "", selected?.title || "Reporter setup"),
    makeElement("span", "", `${rows.length} ${rows.length === 1 ? "record" : "records"}`)
  );
  section.append(header, tableHeader, buildTable(rows, tableSection));
  root.append(overview, section);
}

async function openReporterDesignationDialog(reporter, refresh) {
  let options;
  try {
    options = unwrapData(await apiRequest("admin/reporter-options")) || {};
  } catch (error) {
    void showAdminMessage("Reporter designations could not be loaded", error.message);
    return;
  }
  const designations = (options.reporter_designations || [])
    .filter((designation) => designation.is_active);
  if (!designations.length) {
    void showAdminMessage("No active designations", "Add an active reporter designation before changing this reporter's position.");
    return;
  }

  openFormDialog(
    "Change reporter designation",
    "This updates the reporter's current position. If it changes, a new dated assignment-history record is created. Existing signed staff-agreement history remains unchanged.",
    (form) => {
      form.append(makeElement(
        "p",
        "admin-dialog-help",
        `${reporter.full_name || reporter.email} · Reporter ID ${reporter.reporter_code}`
      ));
      const select = appendReporterSelect(
        form,
        "designation_id",
        "Reporter designation",
        designations,
        (designation) => `${designation.name} · Code ${designation.designation_code}`
      );
      const currentId = String(reporter._current_designation_id || "");
      if (designations.some((designation) => String(designation.id) === currentId)) {
        select.value = currentId;
      }
    },
    async (values) => {
      await apiRequest(`admin/reporter-directory/${reporter.user_id}/designation`, "POST", {
        designation_id: Number(values.get("designation_id"))
      });
      await refresh();
    },
    "Update designation"
  );
}

function openCoverageDialog(data) {
  const staff = (data.staff || []).filter((person) => ["reporter", "moderator", "editor"].includes(person.role));
  const locations = data.locations || [];
  openFormDialog(
    "Assign newsroom coverage",
    "Choose a region, zone, district, or coverage area. Legacy city locations remain stored for existing records but are not offered for new assignments.",
    (form) => {
      appendReporterSelect(form, "user_id", "Newsroom staff", staff,
        (person) => `${person.full_name || person.email} · ${person.role}`);
      const typeSelect = appendValueSelect(form, "coverage_type", "Coverage level", [
        ["region", "Region"],
        ["zone", "Zone"],
        ["district", "District"],
        ["coverage_area", "Coverage area"]
      ]);
      const stateSelect = appendReporterSelect(form, "state_id", "State / UT", [], (state) => state.name);
      const targetSelect = appendReporterSelect(form, "location_id", "Coverage location", [], (location) => location.name);

      const byId = new Map(locations.map((location) => [String(location.id), location]));
      const getStateId = (location) => {
        let current = location;
        const visited = new Set();
        while (current && current.location_type !== "state" && !visited.has(String(current.id))) {
          visited.add(String(current.id));
          current = byId.get(String(current.parent_id));
        }
        return current?.location_type === "state" ? String(current.id) : "";
      };
      const states = locations.filter((location) => location.location_type === "state" && location.is_active);
      replaceValueOptions(stateSelect, states, "Choose a state / UT", (state) => state.name);
      const refreshLocationChoices = () => {
        const selectedState = stateSelect.value;
        const selectedType = typeSelect.value;
        const eligible = locations.filter((location) =>
          location.is_active
          && location.location_type === selectedType
          && !(selectedType === "region" && location.slug?.startsWith("unassigned-region-"))
          && getStateId(location) === selectedState
        );
        replaceValueOptions(targetSelect, eligible, "Choose coverage location", (location) => location.name);
        targetSelect.disabled = !selectedState;
        targetSelect.required = Boolean(selectedState);
      };
      [typeSelect, stateSelect].forEach((select) =>
        select.addEventListener("change", refreshLocationChoices)
      );
      refreshLocationChoices();
      const label = makeElement("label", "admin-form-checkbox");
      const descendants = document.createElement("input");
      descendants.type = "checkbox";
      descendants.name = "include_descendants";
      descendants.checked = true;
      label.append(descendants, makeElement("span", "", "Include descendant locations"));
      form.append(label);
    },
    async (values) => {
      await apiRequest("admin/reporter-coverage", "POST", {
        user_id: values.get("user_id"),
        location_id: Number(values.get("location_id")),
        include_descendants: values.has("include_descendants")
      });
      await loadSection("reporter-coverage");
    },
    "Assign coverage"
  );
}

function appendValueSelect(form, name, title, values) {
  const label = makeElement("label", "admin-form-field");
  label.append(makeElement("span", "", title));
  const select = document.createElement("select");
  select.name = name;
  select.required = true;
  values.forEach(([value, text], index) => {
    const option = new Option(text, value);
    option.selected = index === 0;
    select.append(option);
  });
  label.append(select);
  form.append(label);
  return select;
}

function replaceValueOptions(select, values, placeholder, labelFor) {
  const current = select.value;
  select.replaceChildren(new Option(placeholder, ""));
  values.forEach((value) => select.append(new Option(labelFor(value), String(value.id))));
  if (values.some((value) => String(value.id) === current)) {
    select.value = current;
  }
}

async function openDistrictRangeDialog(locations) {
  let zoneMappings;
  try {
    zoneMappings = unwrapData(await apiRequest("admin/district-zone-mappings")) || [];
  } catch (error) {
    void showAdminMessage("District/zone mappings could not be loaded", error.message);
    return;
  }
  const byId = new Map(locations.map((location) => [String(location.id), location]));
  const latestZoneForDistrict = new Map();
  zoneMappings.forEach((mapping) => {
    if (!latestZoneForDistrict.has(String(mapping.district_id))) {
      latestZoneForDistrict.set(String(mapping.district_id), String(mapping.zone_id));
    }
  });
  const stateIdFor = (location) => {
    let current = location;
    const visited = new Set();
    while (current && current.location_type !== "state" && !visited.has(String(current.id))) {
      visited.add(String(current.id));
      current = byId.get(String(current.parent_id));
    }
    return current?.location_type === "state" ? String(current.id) : "";
  };
  const ranges = locations.filter((location) => location.location_type === "range" && location.is_active);
  const districts = locations.filter((location) => location.location_type === "district" && location.is_active);
  if (!ranges.length || !districts.length) {
    void showAdminMessage("Mapping unavailable", "Create an active range and district before mapping.");
    return;
  }
  openFormDialog(
    "Assign district to range",
    "Choose a range in the district's mapped zone. Districts without a saved zone mapping can be assigned to any range in their state. Confirm a zone transfer explicitly if the district must move to another zone; zone and range mapping histories will both be retained.",
    (form) => {
      const rangeSelect = appendReporterSelect(form, "range_id", "Range", ranges, (range) => {
        const zone = byId.get(String(range.parent_id));
        return `${range.name} · ${zone?.name || "Zone unavailable"}`;
      });
      const districtSelect = appendReporterSelect(form, "district_id", "District", [], (district) => district.name);
      const transferLabel = makeElement("label", "admin-form-checkbox");
      const allowZoneTransfer = document.createElement("input");
      allowZoneTransfer.type = "checkbox";
      allowZoneTransfer.name = "allow_zone_transfer";
      transferLabel.append(
        allowZoneTransfer,
        makeElement("span", "", "Confirm transfer to the selected range's zone and record the zone mapping history")
      );
      form.append(transferLabel);
      const populateDistricts = () => {
        const range = ranges.find((item) => String(item.id) === rangeSelect.value);
        const zone = byId.get(String(range?.parent_id));
        const selectedStateId = stateIdFor(zone);
        const eligible = districts.filter((district) => {
          if (!selectedStateId || stateIdFor(district) !== selectedStateId) return false;
          if (allowZoneTransfer.checked) return true;
          const mappedZoneId = latestZoneForDistrict.get(String(district.id));
          const parent = byId.get(String(district.parent_id));
          const currentZoneId = parent?.location_type === "range"
            ? String(parent.parent_id)
            : "";
          const expectedZoneId = mappedZoneId || currentZoneId;
          return !expectedZoneId || expectedZoneId === String(zone?.id);
        });
        replaceValueOptions(districtSelect, eligible, "Choose a district", (district) => district.name);
      };
      [rangeSelect, allowZoneTransfer].forEach((select) =>
        select.addEventListener("change", populateDistricts)
      );
      populateDistricts();
    },
    async (values) => {
      await apiRequest("admin/district-range-mappings", "POST", {
        range_id: Number(values.get("range_id")),
        district_id: Number(values.get("district_id")),
        allow_zone_transfer: values.has("allow_zone_transfer")
      });
      await loadSection("locations");
    },
    "Assign district"
  );
}

async function openCredentialDialog(staff) {
  const eligibleStaff = staff.filter((person) => person.onboarding_status
    ? person.can_issue_id_card || person.can_receive_authority_letter
    : ["reporter", "moderator", "editor"].includes(person.role));
  if (!eligibleStaff.length) {
    void showAdminMessage(
      "No eligible staff members",
      "Credential issuance is available for newsroom staff and approved reporters who have accepted the current agreement for their role."
    );
    return;
  }
  let organizationProfile;
  try {
    const options = unwrapData(await apiRequest("admin/reporter-options")) || {};
    organizationProfile = options.organization_profile;
    if (!organizationProfile?.registered_address) {
      throw new Error("Add the registered office address in the company legal details before issuing a credential.");
    }
  } catch (error) {
    void showAdminMessage("Company return address unavailable", error.message);
    return;
  }
  openFormDialog(
    "Issue staff credential",
    "Approved applicants can receive an ID card and authority letter only after accepting the current Reporter job agreement. Reporter access starts only after they acknowledge a valid authority letter.",
    (form) => {
      const userSelect = appendReporterSelect(form, "user_id", "Staff member", eligibleStaff,
        (person) => `${person.full_name || person.email} · ${person.onboarding_status
          ? `approved applicant · ${person.onboarding_status}`
          : person.role}`);
      const type = document.createElement("select");
      type.name = "credential_type";
      type.required = true;
      [["id_card", "Staff ID card"], ["authority_letter", "Authority letter"]].forEach(([value, text]) => {
        const option = makeElement("option", "", text);
        option.value = value;
        type.append(option);
      });
      const authorityOption = type.options[1];
      const typeLabel = makeElement("label", "admin-form-field");
      typeLabel.append(makeElement("span", "", "Credential type"), type);
      form.append(typeLabel);
      const today = new Date().toISOString().slice(0, 10);
      const endDateFor = (startDate) => {
        const [year, month, day] = startDate.split("-").map(Number);
        const nextYear = year + 1;
        const lastDayOfMonth = new Date(Date.UTC(nextYear, month, 0)).getUTCDate();
        return `${nextYear}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDayOfMonth)).padStart(2, "0")}`;
      };
      const start = addField(form, "Valid from", "valid_from", "date", today);
      start.min = today;
      let defaultEndDate = endDateFor(today);
      const end = addField(form, "Valid until", "valid_until", "date", defaultEndDate);
      end.min = today;
      const signerName = sessionIdentity?.full_name || sessionIdentity?.name || "";
      const signerDesignation = sessionIdentity?.role === "super_admin"
        ? "Super Administrator"
        : "Administrator";
      const signer = addField(form, "Authorized signer name", "signer_name", "text", signerName, { required: false, maxLength: 120 });
      const designation = addField(form, "Signer designation", "signer_designation", "text", signerDesignation, { required: false, maxLength: 120 });
      const address = addField(form, "Return address", "return_address", "text", organizationProfile.registered_address, { required: false, maxLength: 500 });
      const setKind = () => {
        const selectedStaff = eligibleStaff.find((person) => person.id === userSelect.value);
        authorityOption.disabled = selectedStaff?.onboarding_status
          ? !selectedStaff.can_receive_authority_letter
          : selectedStaff?.role !== "reporter";
        if (authorityOption.disabled && type.value === "authority_letter") type.value = "id_card";
        const authority = type.value === "authority_letter";
        signer.required = authority;
        designation.required = authority;
        address.required = authority;
        start.min = today;
        end.min = start.value || today;
        if (start.value) {
          const nextDefaultEndDate = endDateFor(start.value);
          if (end.value === defaultEndDate) end.value = nextDefaultEndDate;
          defaultEndDate = nextDefaultEndDate;
          end.max = nextDefaultEndDate;
        } else {
          end.removeAttribute("max");
        }
        start.readOnly = type.value === "id_card";
        if (type.value === "id_card") start.value = today;
      };
      userSelect.addEventListener("change", setKind);
      type.addEventListener("change", setKind);
      start.addEventListener("change", setKind);
      setKind();
    },
    async (values) => {
      await apiRequest("admin/reporter-credentials", "POST", Object.fromEntries(values.entries()));
      await loadSection("reporter-credentials");
    },
    "Issue credential"
  );
}

function openReporterOrganizationProfileDialog(profile) {
  openFormDialog(
    "Organization legal profile",
    "Use the registered legal identity and official contact details that appear on finalized agreement PDFs. Demo values can be saved for setup, but agreements cannot be published until the profile is verified.",
    (form) => {
      addField(form, "Registered legal name", "legal_name", "text", profile?.legal_name, { maxLength: 160 });
      addField(form, "Trading name", "trade_name", "text", profile?.trade_name, { maxLength: 160 });
      addField(form, "Entity type", "entity_type", "text", profile?.entity_type, { maxLength: 100 });
      addField(form, "Registered office address", "registered_address", "text", profile?.registered_address, { maxLength: 500 });
      addField(form, "Registration number (if applicable)", "registration_number", "text", profile?.registration_number, { required: false, maxLength: 100 });
      addField(form, "Official email", "official_email", "email", profile?.official_email, { maxLength: 254 });
      addField(form, "Official phone", "official_phone", "tel", profile?.official_phone, { maxLength: 40 });
      addField(form, "Official website (optional)", "website_url", "url", profile?.website_url, { required: false, maxLength: 500 });

      const verifiedLabel = makeElement("label", "admin-form-checkbox");
      const verified = document.createElement("input");
      verified.type = "checkbox";
      verified.name = "is_verified";
      verified.checked = profile?.is_verified === true;
      verifiedLabel.append(verified, makeElement("span", "", "Mark this organization profile as verified"));
      form.append(verifiedLabel);

      const confirmationLabel = makeElement("label", "admin-form-checkbox");
      const confirmation = document.createElement("input");
      confirmation.type = "checkbox";
      confirmation.name = "confirm_legal_details";
      confirmation.required = verified.checked;
      confirmationLabel.append(
        confirmation,
        makeElement("span", "", "I confirmed these legal identity details and that the finalized agreement PDFs match them.")
      );
      form.append(confirmationLabel);
      verified.addEventListener("change", () => {
        confirmation.required = verified.checked;
        if (!verified.checked) confirmation.checked = false;
      });
    },
    async (values) => {
      await apiRequest("admin/reporter-organization-profile", "PATCH", {
        legal_name: values.get("legal_name"),
        trade_name: values.get("trade_name"),
        entity_type: values.get("entity_type"),
        registered_address: values.get("registered_address"),
        registration_number: values.get("registration_number") || "",
        official_email: values.get("official_email"),
        official_phone: values.get("official_phone"),
        website_url: values.get("website_url") || "",
        is_verified: values.get("is_verified") === "on",
        confirm_legal_details: values.get("confirm_legal_details") === "on"
      });
      await loadSection("reporter-configuration");
    },
    "Save profile"
  );
}

function renderAuditHistory(root, result) {
  const panel = makeElement("section", "admin-panel admin-audit-panel");
  const header = makeElement("div", "admin-panel-heading");
  header.append(makeElement("h2", "", "Activity history"));
  const headingActions = makeElement("div", "admin-audit-heading-actions");
  headingActions.append(makeElement("span", "", `${result.meta?.total ?? 0} matching events`));
  const exportButton = makeElement("button", "admin-secondary-button", "Export CSV");
  exportButton.type = "button";
  exportButton.addEventListener("click", () => void exportAuditHistory(exportButton));
  headingActions.append(exportButton);
  header.append(headingActions);
  panel.append(header);

  const filters = makeElement("form", "admin-audit-filters");
  const searchLabel = makeElement("label", "admin-form-field");
  searchLabel.append(makeElement("span", "", "Search actor, action, record"));
  const search = document.createElement("input");
  search.type = "search";
  search.name = "q";
  search.maxLength = 100;
  search.value = auditFilters.q;
  search.placeholder = "Name, email, table, or record ID";
  searchLabel.append(search);
  filters.append(searchLabel);
  appendAuditSelect(filters, "table", "Table", [
    ["", "All tables"],
    ["profiles", "Users and profiles"],
    ["articles", "Articles"],
    ["categories", "Categories"],
    ["locations", "Locations"],
    ["reporter_designations", "Reporter designations"],
    ["reporter_applications", "Reporter applications"],
    ["live_streams", "Live streams"],
    ["article_reports", "Article reports"],
    ["comments", "Comments"],
    ["media_catalog", "Media catalog"],
    ["states", "States"],
    ["rto_offices", "RTO offices"],
    ["reporter_agreement_versions", "Legacy application agreements"],
    ["reporter_agreement_acceptances", "Legacy application agreement acceptances"],
    ["reporter_service_agreement_versions", "Legacy reporter service agreements"],
    ["reporter_service_agreement_acceptances", "Legacy service agreement acceptances"],
    ["reporter_profiles", "Reporter profiles"],
    ["reporter_assignments", "Reporter assignments"],
    ["user_coverage_assignments", "Coverage assignments"],
    ["staff_credentials", "Staff credentials"]
  ]);
  appendAuditSelect(filters, "action", "Action", [
    ["", "All actions"],
    ["INSERT", "Created"],
    ["UPDATE", "Updated"],
    ["DELETE", "Deleted"],
    ["USER_CREATED", "Staff account created"],
    ["PASSWORD_CHANGED", "Password changed"]
  ]);
  appendAuditDate(filters, "from", "From date");
  appendAuditDate(filters, "to", "To date");
  const sizeLabel = makeElement("label", "admin-form-field");
  sizeLabel.append(makeElement("span", "", "Rows per page"));
  const size = document.createElement("select");
  size.name = "page_size";
  [25, 50, 100].forEach((value) => {
    const option = makeElement("option", "", String(value));
    option.value = String(value);
    option.selected = value === auditFilters.page_size;
    size.append(option);
  });
  sizeLabel.append(size);
  filters.append(sizeLabel);
  const apply = makeElement("button", "admin-primary-button admin-audit-apply", "Apply filters");
  apply.type = "submit";
  filters.append(apply);
  filters.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(filters);
    auditFilters.q = String(values.get("q") || "").trim();
    auditFilters.table = String(values.get("table") || "");
    auditFilters.action = String(values.get("action") || "");
    auditFilters.from = String(values.get("from") || "");
    auditFilters.to = String(values.get("to") || "");
    auditFilters.page_size = Number(values.get("page_size")) || 25;
    auditFilters.page = 1;
    void loadSection("audit-logs");
  });
  panel.append(filters);

  const rows = Array.isArray(result.data) ? result.data : [];
  if (!rows.length) {
    panel.append(makeElement("p", "admin-empty", "No audit events match these filters."));
  } else {
    const tableWrap = makeElement("div", "admin-table-wrap");
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headingRow = document.createElement("tr");
    ["When", "Actor", "Action", "Record", "Changed fields", ""].forEach((label) => {
      headingRow.append(makeElement("th", "", label));
    });
    head.append(headingRow);
    table.append(head);
    const body = document.createElement("tbody");
    rows.forEach((entry) => {
      const row = document.createElement("tr");
      row.append(
        makeElement("td", "", formatAuditDate(entry.created_at)),
        makeElement("td", "audit-actor-cell", entry.actor_name || entry.actor_email || "System / unknown"),
        makeElement("td", "", `${entry.action} · ${entry.table_name}`),
        makeElement("td", "", `#${entry.record_id || "—"}`),
        makeElement("td", "audit-fields-cell", auditFieldSummary(entry)),
      );
      const actionCell = document.createElement("td");
      actionCell.className = "admin-row-actions";
      rowButton(actionCell, "View changes", () => openAuditDetails(entry));
      row.append(actionCell);
      body.append(row);
    });
    table.append(body);
    tableWrap.append(table);
    panel.append(tableWrap);
  }

  const meta = result.meta || { page: auditFilters.page, total_pages: 0, total: 0 };
  const pagination = makeElement("div", "admin-audit-pagination");
  const previous = makeElement("button", "admin-secondary-button", "Previous");
  previous.type = "button";
  previous.disabled = meta.page <= 1;
  previous.addEventListener("click", () => {
    auditFilters.page = Math.max(1, meta.page - 1);
    void loadSection("audit-logs");
  });
  const pageSummary = makeElement(
    "span",
    "",
    meta.total
      ? `Page ${meta.page} of ${meta.total_pages} · ${meta.total} events`
      : "No events"
  );
  const next = makeElement("button", "admin-secondary-button", "Next");
  next.type = "button";
  next.disabled = meta.page >= meta.total_pages;
  next.addEventListener("click", () => {
    auditFilters.page = meta.page + 1;
    void loadSection("audit-logs");
  });
  pagination.append(previous, pageSummary, next);
  panel.append(pagination);
  root.append(panel);
}

function appendAuditSelect(form, name, title, options) {
  const label = makeElement("label", "admin-form-field");
  label.append(makeElement("span", "", title));
  const select = document.createElement("select");
  select.name = name;
  options.forEach(([value, text]) => {
    const option = makeElement("option", "", text);
    option.value = value;
    option.selected = value === auditFilters[name];
    select.append(option);
  });
  label.append(select);
  form.append(label);
  return select;
}

function appendAuditDate(form, name, title) {
  const label = makeElement("label", "admin-form-field");
  label.append(makeElement("span", "", title));
  const input = document.createElement("input");
  input.type = "date";
  input.name = name;
  input.value = auditFilters[name];
  label.append(input);
  form.append(label);
}

function auditFieldSummary(entry) {
  const fields = Array.isArray(entry.changed_fields)
    ? entry.changed_fields.map((field) => field.field).filter(Boolean)
    : [];
  if (!fields.length) return "No field-level detail";
  return fields.length > 4
    ? `${fields.slice(0, 4).join(", ")} +${fields.length - 4}`
    : fields.join(", ");
}

function formatAuditDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
}

function openAuditDetails(entry) {
  const dialog = document.createElement("dialog");
  dialog.className = "admin-json-dialog admin-audit-dialog";
  const body = makeElement("div", "admin-audit-detail");
  body.append(
    makeElement("span", "admin-eyebrow", "AUDIT EVENT"),
    makeElement("h2", "", `${entry.action} ${entry.table_name}`),
    makeElement("p", "admin-dialog-help", `${formatAuditDate(entry.created_at)} · ${entry.actor_name || "System / unknown"}${entry.actor_email ? ` (${entry.actor_email})` : ""} · Record #${entry.record_id || "—"} · Outcome: ${entry.outcome || "success"}`)
  );
  const requestDetails = makeElement("dl", "admin-audit-request-details");
  [
    ["Reason", entry.reason || "—"],
    ["Client IP", entry.actor_ip || "—"],
    ["Request ID", entry.request_id || "—"],
    ["User agent", entry.user_agent || "—"]
  ].forEach(([label, value]) => {
    requestDetails.append(
      makeElement("dt", "", label),
      makeElement("dd", "", value)
    );
  });
  body.append(requestDetails);

  const changes = Array.isArray(entry.changed_fields) ? entry.changed_fields : [];
  if (changes.length) {
    const changeList = makeElement("div", "admin-audit-change-list");
    changes.forEach((change) => {
      const item = makeElement("article", "admin-audit-change");
      item.append(makeElement("h3", "", change.field || "Field"));
      const values = makeElement("div", "admin-audit-value-grid");
      values.append(
        auditValuePanel("Before", change.before),
        auditValuePanel("After", change.after)
      );
      item.append(values);
      changeList.append(item);
    });
    body.append(changeList);
  } else {
    body.append(makeElement("p", "admin-empty", "No field-level diff was recorded for this event."));
  }

  const snapshot = makeElement("details", "admin-audit-snapshot");
  snapshot.append(makeElement("summary", "", "Full record snapshots"));
  const snapshotValues = makeElement("div", "admin-audit-value-grid");
  snapshotValues.append(
    auditValuePanel("Before snapshot", entry.before_data),
    auditValuePanel("After snapshot", entry.after_data)
  );
  snapshot.append(snapshotValues);
  body.append(snapshot);

  const actions = makeElement("div", "admin-dialog-actions");
  const close = makeElement("button", "admin-primary-button", "Close");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  actions.append(close);
  body.append(actions);
  dialog.append(body);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

function auditValuePanel(title, value) {
  const panel = makeElement("section", "admin-audit-value");
  panel.append(makeElement("span", "admin-eyebrow", title));
  const contentNode = makeElement("pre");
  contentNode.textContent = value === null || value === undefined
    ? "—"
    : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);
  panel.append(contentNode);
  return panel;
}

async function exportAuditHistory(button) {
  button.disabled = true;
  button.textContent = "Preparing…";
  try {
    const params = new URLSearchParams({ ...auditFilters, page: "1", page_size: "100" });
    const first = await apiRequest(`admin/audit-logs?${params}`);
    const totalPages = first.meta?.total_pages || 0;
    if (totalPages > 100) {
      throw new Error("This export exceeds 10,000 events. Narrow the date range or filters and try again.");
    }
    const entries = Array.isArray(first.data) ? [...first.data] : [];
    for (let page = 2; page <= totalPages; page += 1) {
      params.set("page", String(page));
      const result = await apiRequest(`admin/audit-logs?${params}`);
      if (!Array.isArray(result.data)) throw new Error("Audit export returned an invalid page.");
      entries.push(...result.data);
      button.textContent = `Loading ${entries.length}…`;
    }
    const columns = [
      ["id", "Event ID"],
      ["created_at", "Time"],
      ["actor_name", "Actor"],
      ["actor_email", "Actor email"],
      ["action", "Action"],
      ["table_name", "Table"],
      ["record_id", "Record ID"],
      ["actor_ip", "Client IP"],
      ["request_id", "Request ID"],
      ["user_agent", "User agent"],
      ["outcome", "Outcome"],
      ["reason", "Reason"],
      ["before_data", "Before"],
      ["after_data", "After"],
      ["changed_fields", "Changed fields"]
    ];
    const escapeCsv = (value) => {
      const text = String(value ?? "");
      const safeText = /^[\x00-\x20]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safeText.replace(/"/g, '""')}"`;
    };
    const csv = [
      columns.map(([, label]) => escapeCsv(label)).join(","),
      ...entries.map((entry) => columns
        .map(([key]) => escapeCsv(typeof entry[key] === "object" && entry[key] !== null
          ? JSON.stringify(entry[key])
          : entry[key]))
        .join(","))
    ].join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = makeElement("a");
    link.href = downloadUrl;
    link.download = `chowk-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  } catch (error) {
    void showAdminMessage("Audit export failed", error instanceof Error ? error.message : "Audit history could not be exported.");
  } finally {
    button.disabled = false;
    button.textContent = "Export CSV";
  }
}

function singular(label) {
  if (label.endsWith("ies")) return `${label.slice(0, -3)}y`;
  return label.endsWith("s") ? label.slice(0, -1) : label;
}

function renderTablePanel(title, rows, section) {
  const panel = makeElement("section", "admin-panel");
  const header = makeElement("div", "admin-panel-heading");
  header.append(makeElement("h2", "", title));
  header.append(makeElement("span", "", `${rows.length} records`));
  panel.append(header);
  panel.append(buildTable(rows, section));
  return panel;
}

function renderRoleAgreements(root, data, roleFilter) {
  const canEditWording = data?.can_edit_wording === true;
  const allRoles = Array.isArray(data?.roles) ? data.roles : [];
  const roles = roleFilter ? allRoles.filter((agreement) => agreement.role === roleFilter) : allRoles;
  root.append(makeElement(
    "p",
    "admin-dialog-help",
    `${roleFilter ? allRoles.find((agreement) => agreement.role === roleFilter)?.label || roleFilter : "Staff role"} agreement wording is controlled by super admins. Paste the complete approved clauses directly into the wording template; structured key/value terms are optional and only needed when you want values inserted through matching placeholders.`
  ));
  roles.forEach((agreement) => {
    const role = agreement.role;
    const versions = Array.isArray(agreement.versions) ? agreement.versions : [];
    const published = versions.find((version) => version.status === "published");
    const card = makeElement("section", "admin-panel admin-role-agreement-card");
    const header = makeElement("div", "admin-panel-heading");
    header.append(
      makeElement("h2", "", `${agreement.label || role} agreement`),
      makeElement("span", "", published ? `Published · ${published.version}` : "Not published")
    );
    card.append(header);
    card.append(makeElement(
      "p",
      "admin-dialog-help",
      published
        ? `Version ${published.version} published ${formatDate(published.published_at)}.`
        : "Activation is blocked for this role until a super admin publishes an agreement."
    ));

    const termSection = makeElement("div", "admin-role-agreement-terms");
    termSection.append(makeElement("h3", "", "Optional structured term values"));
    const termEntries = Object.entries(agreement.terms || {});
    if (!termEntries.length) {
      termSection.append(makeElement("p", "admin-dialog-help", "None are required if the complete clauses are written directly in the agreement template."));
    } else {
      const list = makeElement("dl", "admin-role-agreement-term-list");
      termEntries.forEach(([key, value]) => {
        list.append(makeElement("dt", "", key.replaceAll("_", " ")), makeElement("dd", "", value));
      });
      termSection.append(list);
    }
    if (published) {
      termSection.append(makeElement("h3", "", `Values snapshotted in version ${published.version}`));
      const snapshotEntries = Object.entries(published.terms_snapshot || {});
      if (!snapshotEntries.length) {
        termSection.append(makeElement("p", "admin-dialog-help", "This version uses no structured terms; its clauses can be written directly in the template."));
      } else {
        const snapshot = makeElement("dl", "admin-role-agreement-term-list");
        snapshotEntries.forEach(([key, value]) => {
          snapshot.append(makeElement("dt", "", key.replaceAll("_", " ")), makeElement("dd", "", value));
        });
        termSection.append(snapshot);
      }
    }
    if (["admin", "super_admin"].includes(sessionIdentity?.role)) {
      const manageTerms = makeElement("button", "admin-secondary-button", "Manage optional term values");
      manageTerms.type = "button";
      manageTerms.addEventListener("click", () => openRoleAgreementTermsDialog(role, agreement.terms || {}));
      termSection.append(manageTerms);
    }
    card.append(termSection);

    if (published) {
      const wording = document.createElement("details");
      wording.className = "admin-role-agreement-wording";
      wording.append(makeElement("summary", "", "Review published wording"));
      const text = makeElement("pre", "", published.template_content);
      wording.append(text);
      card.append(wording);
    }

    if (canEditWording) {
      const createDraft = makeElement("button", "admin-primary-button", "Create wording draft");
      createDraft.type = "button";
      createDraft.addEventListener("click", () =>
        openRoleAgreementDraftDialog(role, published?.template_content || "", agreement.terms || {}));
      card.append(createDraft);
    }

    const history = versions.filter((version) => version.status !== "published");
    history.forEach((version) => {
      const row = makeElement("div", "admin-role-agreement-version");
      row.append(makeElement("span", "", `${version.version} · ${version.status}`));
      if (version.status === "draft") {
        const draftWording = document.createElement("details");
        draftWording.className = "admin-role-agreement-wording";
        draftWording.append(makeElement("summary", "", "Review draft wording"));
        draftWording.append(makeElement("pre", "", version.template_content));
        const draftTerms = Object.entries(version.terms_snapshot || {});
        if (draftTerms.length) {
          draftWording.append(makeElement("h3", "", "Term values snapshotted in this draft"));
          const snapshot = makeElement("dl", "admin-role-agreement-term-list");
          draftTerms.forEach(([key, value]) => {
            snapshot.append(makeElement("dt", "", key.replaceAll("_", " ")), makeElement("dd", "", value));
          });
          draftWording.append(snapshot);
        }
        row.append(draftWording);
      }
      if (canEditWording && version.status === "draft") {
        const preview = makeElement("button", "admin-secondary-button", "Preview with sample details");
        preview.type = "button";
        preview.addEventListener("click", async () => {
          preview.disabled = true;
          try {
            const result = unwrapData(await apiRequest(
              `admin/role-agreements/${role}/${encodeURIComponent(version.id)}/preview`
            ));
            openRoleAgreementPreviewDialog(role, version.version, result?.resolved_content);
          } catch (error) {
            void showAdminMessage("Agreement preview failed", error.message);
          } finally {
            preview.disabled = false;
          }
        });
        const publish = makeElement("button", "admin-secondary-button", "Publish");
        publish.type = "button";
        publish.addEventListener("click", async () => {
          publish.disabled = true;
          try {
            await apiRequest(
              `admin/role-agreements/${role}/${encodeURIComponent(version.id)}/publish`,
              "POST",
              {}
            );
            await loadSection("role-agreements");
          } catch (error) {
            void showAdminMessage("Agreement not published", error.message);
          } finally {
            publish.disabled = false;
          }
        });
        row.append(preview, publish);
      }
      card.append(row);
    });
    root.append(card);
  });
}

function renderAgreementRecords(root, records) {
  const rows = Array.isArray(records) ? records : [];
  root.append(makeElement(
    "p",
    "admin-workflow-scope-note",
    "This view combines issued reporter agreements and moderator/editor acceptance records. Historical copies are retained; status here does not replace the agreement's signed or accepted record."
  ));
  const panel = makeElement("section", "admin-panel");
  const header = makeElement("div", "admin-panel-heading");
  header.append(
    makeElement("h2", "", "Agreement records"),
    makeElement("span", "", `${rows.length} ${rows.length === 1 ? "record" : "records"}`)
  );
  panel.append(header);
  if (!rows.length) {
    panel.append(makeElement("p", "admin-empty", "No issued or accepted agreements are recorded for this role yet."));
    root.append(panel);
    return;
  }

  const wrapper = makeElement("div", "admin-table-wrap");
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const heading = document.createElement("tr");
  ["Person", "Email", "Role", "Version", "Status", "Issued", "Accepted"].forEach((label) =>
    heading.append(makeElement("th", "", label))
  );
  heading.append(makeElement("th", "", "Copy"));
  head.append(heading);
  table.append(head);
  const body = document.createElement("tbody");
  rows.forEach((record) => {
    const row = document.createElement("tr");
    [
      record.full_name || "—",
      record.email || "—",
      record.role || "—",
      record.version || "—",
      record.status || "—",
      record.issued_at ? formatDate(record.issued_at) : "—",
      record.accepted_at ? formatDate(record.accepted_at) : "Not accepted"
    ].forEach((value) => row.append(makeElement("td", "", value)));
    const copyCell = document.createElement("td");
    if (record.rendered_content) {
      rowButton(copyCell, "View accepted copy", () => openAcceptedAgreementCopy(record));
    } else {
      copyCell.textContent = "—";
    }
    row.append(copyCell);
    body.append(row);
  });
  table.append(body);
  wrapper.append(table);
  panel.append(wrapper);
  root.append(panel);
}

function openAcceptedAgreementCopy(record) {
  if (typeof record.rendered_content !== "string" || !record.rendered_content) {
    void showAdminMessage("Agreement copy unavailable", "The stored accepted copy was not available.");
    return;
  }
  const dialog = document.createElement("dialog");
  dialog.className = "admin-json-dialog admin-role-agreement-preview-dialog";
  const body = makeElement("section", "admin-json-form");
  body.append(
    makeElement("span", "admin-eyebrow", "PERSONALIZED COPY · ACCEPTED"),
    makeElement("h2", "", `${record.full_name || "Staff member"} · ${record.role} agreement · ${record.version}`),
    makeElement(
      "p",
      "admin-dialog-help",
      `Accepted ${record.accepted_at ? formatDate(record.accepted_at) : "date unavailable"}. This is the immutable personalized wording stored at acceptance.`
    )
  );
  const wording = document.createElement("pre");
  wording.className = "admin-role-agreement-preview-copy";
  wording.textContent = record.rendered_content;
  body.append(wording);
  const close = makeElement("button", "admin-secondary-button", "Close copy");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  body.append(close);
  dialog.append(body);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

function openRoleAgreementPreviewDialog(role, version, content) {
  if (typeof content !== "string" || !content) {
    void showAdminMessage("Agreement preview failed", "The preview did not contain rendered agreement wording.");
    return;
  }
  const dialog = document.createElement("dialog");
  dialog.className = "admin-json-dialog admin-role-agreement-preview-dialog";
  const body = makeElement("section", "admin-json-form");
  body.append(
    makeElement("span", "admin-eyebrow", "SAMPLE PREVIEW · NOT FOR SIGNATURE"),
    makeElement("h2", "", `${role.charAt(0).toUpperCase()}${role.slice(1)} agreement · ${version}`),
    makeElement(
      "p",
      "admin-dialog-help",
      "This sample uses placeholder identity details. Review how approved wording and role terms render; invitees will see their own personalized copy."
    )
  );
  const wording = document.createElement("pre");
  wording.className = "admin-role-agreement-preview-copy";
  wording.textContent = content;
  body.append(wording);
  const close = makeElement("button", "admin-secondary-button", "Close preview");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  body.append(close);
  dialog.append(body);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

function openRoleAgreementTermsDialog(role, initialTerms) {
  let termRows;
  openFormDialog(
    `Manage ${role} term values`,
    "This form is optional. Add approved key/value text only if the agreement template uses matching {{terms.key}} placeholders. Otherwise, paste the complete approved clauses directly into the agreement wording editor. Saving values does not change published wording; a new version snapshots them.",
    (form) => {
      const rows = makeElement("div", "admin-role-agreement-term-editor");
      termRows = rows;
      const addRow = (key = "", value = "") => {
        const row = makeElement("div", "admin-role-agreement-term-row");
        const keyInput = document.createElement("input");
        keyInput.className = "admin-form-input";
        keyInput.dataset.termKey = "true";
        keyInput.value = key;
        keyInput.maxLength = 50;
        keyInput.placeholder = "term_key";
        keyInput.setAttribute("aria-label", "Term key");
        const valueInput = document.createElement("textarea");
        valueInput.dataset.termValue = "true";
        valueInput.value = value;
        valueInput.maxLength = 5000;
        valueInput.rows = 2;
        valueInput.placeholder = "Approved value";
        valueInput.setAttribute("aria-label", "Term value");
        const remove = makeElement("button", "admin-row-button danger", "Remove");
        remove.type = "button";
        remove.addEventListener("click", () => row.remove());
        row.append(keyInput, valueInput, remove);
        rows.append(row);
      };
      Object.entries(initialTerms).forEach(([key, value]) => addRow(key, value));
      form.append(rows);
      const add = makeElement("button", "admin-secondary-button", "Add term");
      add.type = "button";
      add.addEventListener("click", () => addRow());
      form.append(add);
      form.dataset.role = role;
    },
    async () => {
      const terms = {};
      for (const row of termRows.querySelectorAll(".admin-role-agreement-term-row")) {
        const key = row.querySelector("[data-term-key]").value.trim();
        const value = row.querySelector("[data-term-value]").value.trim();
        if (!/^[a-z][a-z0-9_]{0,49}$/.test(key) || key in terms) {
          throw new Error("Use unique term keys with lowercase letters, numbers, and underscores.");
        }
        if (value.length > 5000) throw new Error("Each term value must be 5,000 characters or fewer.");
        terms[key] = value;
      }
      await apiRequest(`admin/role-agreements/${role}/terms`, "PATCH", { terms });
      await loadSection("role-agreements");
    },
    "Save term values"
  );
}

function openRoleAgreementDraftDialog(role, existingTemplate, terms) {
  openFormDialog(
    `Create ${role} agreement version`,
    "Paste the complete approved agreement wording here. Structured key/value terms are optional—use them only when the text should be inserted through a matching placeholder. Saving creates an immutable draft; publishing remains a separate super-admin action.",
    (form) => {
      addField(form, "Version label", "version", "text", "", { minLength: 1, maxLength: 40 });
      const label = makeElement("label", "admin-form-field admin-agreement-template-field");
      label.append(makeElement("span", "", "Agreement wording"));
      const content = document.createElement("textarea");
      content.name = "template_content";
      content.required = true;
      content.maxLength = 50000;
      content.minLength = 1;
      content.rows = 24;
      content.value = existingTemplate;
      content.spellcheck = false;
      label.append(content);
      form.append(label);
      const placeholders = document.createElement("details");
      placeholders.className = "admin-agreement-template-fields";
      placeholders.append(makeElement("summary", "", "Optional personalization placeholders"));
      placeholders.append(makeElement(
        "p",
        "admin-dialog-help",
        [
          "{{staff.full_name}}", "{{staff.email}}", "{{staff.phone}}", "{{staff.role}}",
          "{{staff.address}}", "{{staff.address_line1}}", "{{staff.address_line2}}",
          "{{staff.city}}", "{{staff.district}}", "{{staff.state}}",
          "{{staff.postal_code}}", "{{staff.date_of_birth}}"
        ].join(" · ") || "No structured term placeholders are currently available."
      ));
      const availableTerms = Object.keys(terms);
      placeholders.append(makeElement(
        "p",
        "admin-dialog-help",
        availableTerms.length
          ? `Optional structured term placeholders: ${availableTerms.map((key) => `{{terms.${key}}}`).join(" · ")}`
          : "No optional structured terms are configured. Complete clauses can be written directly in the agreement wording above."
      ));
      form.append(placeholders);
    },
    async (values) => {
      await apiRequest(`admin/role-agreements/${role}/drafts`, "POST", {
        version: String(values.get("version") || "").trim(),
        template_content: String(values.get("template_content") || "")
      });
      await loadSection("role-agreements");
    },
    "Save draft"
  );
}

function renderStaffOnboarding(root, rows, refresh = () => loadSection("applications"), includeHeading = true) {
  if (includeHeading) {
    addHeading(
      root,
      "NEWSROOM · PEOPLE",
      "Applications & onboarding",
      "Review each staff member's assigned newsroom role and submitted profile before granting access."
    );
  }
  const records = Array.isArray(rows) ? rows : [];
  const submittedCount = records.filter((row) => row.status === "submitted").length;
  const summary = makeElement("div", "admin-staff-onboarding-summary");
  summary.append(
    makeElement("strong", "", String(submittedCount)),
    makeElement("span", "", submittedCount === 1 ? "profile waiting for review" : "profiles waiting for review")
  );
  root.append(summary);
  if (!records.length) {
    root.append(makeElement(
      "section",
      "admin-panel admin-staff-onboarding-empty",
      "No newsroom staff applications or invitations yet."
    ));
    return;
  }

  const grid = makeElement("div", "admin-staff-onboarding-grid");
  records.forEach((record) => {
    const profile = record.profile || {};
    const name = profile.full_name || "Profile not submitted";
    const card = makeElement("article", "admin-panel admin-staff-onboarding-card");
    const heading = makeElement("div", "admin-staff-onboarding-card-heading");
    const headingCopy = makeElement("div");
    headingCopy.append(
      makeElement("span", "admin-eyebrow", String(record.staff_role?.display_name || record.requested_role || "staff").toUpperCase()),
      makeElement("h2", "", name),
      makeElement("p", "", profile.email || "Email unavailable")
    );
    const status = makeElement("span", `admin-staff-status ${record.status || "unknown"}`, String(record.status || "unknown").replaceAll("_", " "));
    heading.append(headingCopy, status);
    card.append(heading);
    if (record.staff_role?.duties) {
      card.append(makeElement("p", "admin-dialog-help", `Responsibilities: ${record.staff_role.duties}`));
    }
    if (record.status === "submitted") {
      card.append(makeElement("p", "admin-dialog-help", "Profile submitted for review. Access is still restricted until approval."));
      const review = makeElement("button", "admin-primary-button", "Review profile");
      review.type = "button";
      review.addEventListener("click", () => openStaffReviewDialog(record, refresh));
      card.append(review);
    } else if (record.status === "invited") {
      card.append(makeElement("p", "admin-dialog-help", `Invitation sent ${formatDate(record.invited_at)}. Waiting for the invitee to verify their email and complete the profile.`));
    } else if (record.status === "changes_requested") {
      card.append(
        makeElement("p", "admin-dialog-help", "Changes requested; waiting for the staff member to resubmit."),
        makeElement("p", "admin-staff-review-note", record.review_note || "No review note.")
      );
    } else if (record.status === "approved_pending_agreement") {
      card.append(makeElement(
        "p",
        "admin-inline-warning",
        "Profile approved. The account remains limited until the invitee accepts the currently published agreement for this role."
      ));
    } else if (record.status === "active" && record.pending_role_change?.role) {
      card.append(
        makeElement("p", "admin-dialog-help", `Active in ${record.staff_role?.display_name || record.requested_role}. Waiting for staff acceptance before changing to ${record.pending_role_change.role.display_name}.`),
        makeElement("span", "admin-staff-contact", `${profile.phone || "Phone unavailable"} · ${record.permanent_address_city || "Address not submitted"}`)
      );
      if (["admin", "super_admin"].includes(sessionIdentity?.role)) {
        const cancel = makeElement("button", "admin-secondary-button", "Cancel role change request");
        cancel.type = "button";
        cancel.addEventListener("click", () => {
          void runAction(
            () => apiRequest(`admin/staff-onboarding/${record.user_id}/job-role`, "DELETE"),
            refresh
          );
        });
        card.append(cancel);
      }
    } else if (record.status === "active") {
      card.append(
        makeElement("p", "admin-dialog-help", `Approved and active since ${formatDate(record.reviewed_at)}.`),
        makeElement("span", "admin-staff-contact", `${profile.phone || "Phone unavailable"} · ${record.permanent_address_city || "Address not submitted"}`)
      );
    } else {
      card.append(
        makeElement("p", "admin-dialog-help", `Invitation status: ${String(record.status || "unknown").replaceAll("_", " ")}.`),
        record.review_note ? makeElement("p", "admin-staff-review-note", record.review_note) : makeElement("span")
      );
    }
    if (sessionIdentity?.role === "super_admin") {
      const actions = makeElement("div", "admin-page-actions");
      if (record.status === "invited") {
        const removeInvitation = makeElement("button", "admin-secondary-button admin-danger-button",
          "Delete invitation and account");
        removeInvitation.type = "button";
        removeInvitation.addEventListener("click", () => {
          void confirmAdminAction(
            "Permanently delete staff invitation?",
            `Delete the invitation, unaccepted Supabase login, Chowk profile, and private files for ${profile.email || name}? Audit/security history is retained. This cannot be undone.`
          ).then((confirmed) => {
            if (confirmed) {
              void runAction(() => apiRequest(`admin/users/${record.user_id}`, "DELETE"), refresh);
            }
          });
        });
        actions.append(removeInvitation);
      } else if (["submitted", "changes_requested", "approved_pending_agreement", "rejected"].includes(record.status)) {
        const removeApplication = makeElement("button", "admin-secondary-button admin-danger-button",
          "Delete staff application");
        removeApplication.type = "button";
        removeApplication.addEventListener("click", () => {
          void confirmAdminAction(
            "Permanently delete staff application?",
            `Delete ${profile.email || name}'s staff onboarding application and private profile photo? The Chowk login account will remain; audit/security history is retained. This cannot be undone.`
          ).then((confirmed) => {
            if (confirmed) {
              void runAction(() => apiRequest(`admin/staff-onboarding/${record.user_id}`, "DELETE"), refresh);
            }
          });
        });
        actions.append(removeApplication);
      }
      if (actions.childElementCount) card.append(actions);
    }
    grid.append(card);
  });
  root.append(grid);
}

function renderStaffRoleCatalog(root, roles) {
  const records = Array.isArray(roles) ? roles : [];
  const catalog = makeElement("div", "admin-staff-role-catalog");
  if (!records.length) {
    catalog.append(makeElement("section", "admin-panel admin-staff-onboarding-empty", "No newsroom roles are configured."));
  }
  records.forEach((role) => {
    const card = makeElement("article", "admin-panel admin-role-agreement-card");
    const header = makeElement("div", "admin-panel-heading");
    header.append(
      makeElement("h2", "", role.display_name),
      makeElement("span", "", role.is_active ? "Active" : "Inactive")
    );
    card.append(header);
    card.append(makeElement(
      "p",
      "admin-dialog-help",
      `${role.description || "No description"}${role.is_builtin ? " · built-in role" : ""}`
    ));
    card.append(makeElement("p", "", role.duties || "No duties defined."));
    const assignedPermissions = Array.isArray(role.permissions) ? role.permissions : [];
    card.append(makeElement(
      "p",
      "admin-dialog-help",
      `System access: ${assignedPermissions.length
        ? assignedPermissions.map(({ permission_key, scope }) => `${permission_key} (${scope})`).join(", ")
        : "None"}`
    ));
    const edit = makeElement("button", "admin-secondary-button", "Edit role");
    edit.type = "button";
    edit.addEventListener("click", () => void openStaffRoleDialog(role, () => loadSection("staff-roles")));
    card.append(edit);
    if (!role.is_builtin && sessionIdentity?.role === "super_admin") {
      const remove = makeElement("button", "admin-secondary-button admin-danger-button", "Delete role");
      remove.type = "button";
      remove.addEventListener("click", () => {
        void confirmAdminAction(
          "Permanently delete newsroom role?",
          `Delete "${role.display_name}" from the newsroom-role catalog? Existing staff assignments retain their saved title and duties for history; new assignments can no longer select it. This cannot be undone.`
        ).then(async (confirmed) => {
          if (!confirmed) return;
          try {
            await apiRequest(`admin/staff-roles/${role.id}`, "DELETE");
            await loadSection("staff-roles");
          } catch (error) {
            void showAdminMessage("Newsroom role was not deleted", error.message);
          }
        });
      });
      card.append(remove);
    }
    catalog.append(card);
  });
  root.append(catalog);
  root.append(makeElement(
    "p",
    "admin-dialog-help",
    "Each newsroom role combines responsibilities with its system permissions. The same role is assigned to the staff member; agreement acceptance is still required."
  ));
}

async function loadHrManagement() {
  content.replaceChildren(makeElement("div", "admin-loading", "Loading HR configuration…"));
  try {
    const result = await apiRequest("admin/hr/configuration");
    hrManagementData = unwrapData(result) || {};
    renderHrManagement();
  } catch (error) {
    showPageError(error instanceof Error ? error.message : "HR configuration could not be loaded.", loadHrManagement);
  }
}

async function loadOrganizationConfiguration() {
  return loadConfigurationPage(
    activeConfigurationSection.startsWith("organization-")
      ? activeConfigurationSection
      : "organization-identity"
  );
}

function renderOrganizationConfiguration(root, section) {
  if (section === "organization-identity") renderOrganizationIdentity(root);
  else if (section === "organization-people") renderOrganizationPeople(root);
  else if (section === "organization-settings") renderOrganizationSettings(root);
  else if (section === "organization-modules") renderOrganizationModules(root);
  else if (section === "organization-workflows") renderOrganizationWorkflows(root);
}

function renderOrganizationIdentity(root) {
  const organization = organizationConfigurationData.organization || {};
  const panel = makeElement("section", "admin-panel admin-configuration-panel");
  panel.append(makeElement("p", "admin-dialog-help",
    "Identity and locale are organization-wide values. Updating them does not rewrite issued legal agreements."));
  const edit = makeElement("button", "admin-primary-button", "Edit organization identity");
  edit.type = "button";
  edit.addEventListener("click", () => openFormDialog(
    "Organization identity",
    "Use the legal organization name used in new organization records. Historical documents remain unchanged.",
    (form) => {
      addField(form, "Display name", "display_name", "text", organization.display_name, { minLength: 2, maxLength: 160 });
      addField(form, "Legal name", "legal_name", "text", organization.legal_name, { required: false, maxLength: 200 });
      addField(form, "Website URL", "website_url", "url", organization.website_url, { required: false, maxLength: 500 });
      addField(form, "Contact email", "contact_email", "email", organization.contact_email, { required: false, maxLength: 254 });
      addField(form, "Contact phone", "contact_phone", "tel", organization.contact_phone, { required: false, maxLength: 30 });
      addField(form, "Country code (ISO 3166-1 alpha-2)", "country_code", "text", organization.country_code, { minLength: 2, maxLength: 2 });
      addField(form, "Locale", "locale", "text", organization.locale, { minLength: 2, maxLength: 20 });
      addField(form, "Timezone", "timezone", "text", organization.timezone, { minLength: 1, maxLength: 80 });
      addField(form, "Currency code (ISO 4217)", "currency_code", "text", organization.currency_code, { minLength: 3, maxLength: 3 });
    },
    async (values) => {
      await apiRequest("admin/organization/identity", "PUT", Object.fromEntries(values));
      await loadOrganizationConfiguration();
    }
  ));
  const fields = makeElement("dl", "admin-organization-summary");
  [
    ["Organization key", organization.organization_key],
    ["Display name", organization.display_name],
    ["Legal name", organization.legal_name],
    ["Website", organization.website_url],
    ["Contact email", organization.contact_email],
    ["Contact phone", organization.contact_phone],
    ["Country", organization.country_code],
    ["Locale", organization.locale],
    ["Timezone", organization.timezone],
    ["Currency", organization.currency_code]
  ].forEach(([label, value]) => {
    fields.append(makeElement("dt", "", label), makeElement("dd", "", value || "Not set"));
  });
  panel.append(edit, fields);
  root.append(panel);
}

function renderOrganizationPeople(root) {
  const allPeople = organizationConfigurationData.people || [];
  const activeEmployeeIds = new Set(allPeople
    .filter((person) => person.relationship_type === "employee"
      && person.status === "active"
      && !person.ends_at)
    .map((person) => person.person_id));
  const people = allPeople.filter((person) =>
    person.relationship_type !== "employee"
      && !person.ends_at
      && person.status === "active"
      && !activeEmployeeIds.has(person.person_id)
  );
  const panel = makeElement("section", "admin-panel admin-configuration-panel");
  panel.append(makeElement("p", "admin-dialog-help",
    "Manage active non-employee relationships here. Employee access belongs in HR Management; pending invitations are managed in Accounts."));
  if (!people.length) panel.append(makeElement("p", "admin-empty",
    "No active non-employee relationships are recorded."));
  people.forEach((person) => {
    const card = makeElement("article", "admin-configuration-person-card");
    card.append(makeElement("h3", "", person.full_name || person.email || "Organization person"));
    card.append(makeElement("p", "admin-dialog-help",
      `${person.email || "No email"} · ${(person.relationship_type || "person").replaceAll("_", " ")} · ${person.status || "active"}`));
    card.append(makeElement("p", "admin-dialog-help",
      `Organization permission role: ${person.access_role_name || "None"} · Department: ${person.department_name || "None"} · Source: ${person.source_type}`));
    const edit = makeElement("button", "admin-secondary-button", "Assign organization permission role");
    edit.type = "button";
    edit.addEventListener("click", () => openOrganizationPersonAccessDialog(person));
    card.append(edit);
    panel.append(card);
  });
  root.append(panel);
}

function openOrganizationPersonAccessDialog(person) {
  const roles = (organizationConfigurationData.access_roles || [])
    .filter((role) => !legacyNewsroomPermissionRoleKeys.has(role.role_key));
  const departments = organizationConfigurationData.departments || [];
  openFormDialog(
    "Assign organization access",
    "This organization-wide access role applies to non-employee, non-newsroom people. Newsroom staff permissions come from the assigned newsroom role. Changes are recorded in organization access history.",
    (form) => {
      addHrSelect(form, "Organization permission role", "access_role_id",
        roles.map((role) => ({ value: role.id, label: `${role.name} · ${role.role_key}` })),
        person.access_role_id, "No permission role", false);
      addHrSelect(form, "Department", "department_id",
        departments.map((department) => ({ value: department.id, label: department.name })),
        person.department_id, "No department", false);
    },
    async (values) => {
      await apiRequest(`admin/organization/people/${person.id}/access`, "PUT", {
        access_role_id: values.get("access_role_id") || null,
        department_id: values.get("department_id") || null
      });
      await loadOrganizationConfiguration();
    }
  );
}

function renderOrganizationSettings(root) {
  const settings = organizationConfigurationData.settings || [];
  const panel = makeElement("section", "admin-panel admin-configuration-panel");
  const header = makeElement("div", "admin-panel-heading");
  header.append(makeElement("span", "", `${settings.length} active settings`));
  const add = makeElement("button", "admin-primary-button", "Add setting");
  add.type = "button";
  add.addEventListener("click", () => openOrganizationSettingDialog(null));
  panel.append(header, add);
  if (!settings.length) panel.append(makeElement("p", "admin-empty", "No organization settings are configured."));
  settings.forEach((setting) => {
    const card = makeElement("article", "admin-panel admin-role-agreement-card");
    card.append(makeElement("h3", "", setting.setting_key));
    if (setting.description) card.append(makeElement("p", "admin-dialog-help", setting.description));
    const value = makeElement("pre", "admin-organization-json");
    value.textContent = JSON.stringify(setting.value, null, 2);
    card.append(value);
    const actions = makeElement("div", "admin-page-actions");
    const edit = makeElement("button", "admin-secondary-button", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => openOrganizationSettingDialog(setting));
    const archive = makeElement("button", "admin-secondary-button", "Archive");
    archive.type = "button";
    archive.addEventListener("click", () => void confirmAdminAction(
      "Archive organization setting?",
      `Archive "${setting.setting_key}"? Its previous values remain in audit history.`
    ).then((confirmed) => confirmed && runAction(
      () => apiRequest(`admin/organization/settings/${setting.id}`, "DELETE"),
      loadOrganizationConfiguration
    )));
    actions.append(edit, archive);
    card.append(actions);
    panel.append(card);
  });
  root.append(panel);
}

function openOrganizationSettingDialog(setting) {
  openFormDialog(
    setting ? "Edit organization setting" : "Add organization setting",
    "Settings are versioned JSON values. Keep secrets in server environment variables, never in organization settings.",
    (form) => {
      addField(form, "Setting key", "setting_key", "text", setting?.setting_key, {
        minLength: 2, maxLength: 100
      }).pattern = "[a-z][a-z0-9_.-]{1,99}";
      addField(form, "Description", "description", "text", setting?.description, {
        required: false, maxLength: 1000
      });
      addHrTextArea(form, "JSON value", "value_json",
        JSON.stringify(setting?.value ?? {}, null, 2), 20000, true);
    },
    async (values) => {
      let value;
      try {
        value = JSON.parse(String(values.get("value_json") || ""));
      } catch {
        throw new Error("Enter a valid JSON value.");
      }
      await apiRequest("admin/organization/settings", "POST", {
        setting_key: values.get("setting_key"),
        description: values.get("description"),
        value,
        revision: setting?.revision ?? null
      });
      await loadOrganizationConfiguration();
    }
  );
}

function renderOrganizationModules(root) {
  const modules = organizationConfigurationData.modules || [];
  const panel = makeElement("section", "admin-panel admin-configuration-panel");
  panel.append(makeElement("p", "admin-dialog-help",
    "Disabling a module blocks its configured API routes. Required core modules cannot be disabled. Module catalog entries do not implement absent application features."));
  modules.forEach((module) => {
    const card = makeElement("article", "admin-panel admin-role-agreement-card");
    const title = makeElement("div", "admin-panel-heading");
    title.append(makeElement("h3", "", module.name),
      makeElement("span", "", module.is_required ? "Required" : module.module_type));
    card.append(title, makeElement("p", "admin-dialog-help", module.description));
    card.append(makeElement("p", "admin-dialog-help",
      `${module.module_key} · ${module.is_enabled ? "Enabled" : "Disabled"} · configuration revision ${module.revision || 0}`));
    const edit = makeElement("button", "admin-secondary-button", "Configure module");
    edit.type = "button";
    edit.addEventListener("click", () => openOrganizationModuleDialog(module));
    card.append(edit);
    panel.append(card);
  });
  root.append(panel);
}

function openOrganizationModuleDialog(module) {
  openFormDialog(
    `Configure ${module.name}`,
    "Module configuration is versioned. Disabling a module blocks its API routes without deleting its records.",
    (form) => {
      const active = makeElement("label", "admin-form-checkbox");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "is_enabled";
      checkbox.checked = module.is_enabled === true;
      checkbox.disabled = module.is_required === true;
      active.append(checkbox, makeElement("span", "", module.is_required
        ? "Required module (cannot be disabled)" : "Enabled"));
      form.append(active);
      addHrTextArea(form, "Module configuration (JSON object)", "configuration",
        JSON.stringify(module.configuration || {}, null, 2), 20000, true);
    },
    async (values) => {
      let configuration;
      try {
        configuration = JSON.parse(String(values.get("configuration") || ""));
      } catch {
        throw new Error("Enter a valid JSON configuration object.");
      }
      if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
        throw new Error("Module configuration must be a JSON object.");
      }
      await apiRequest(`admin/organization/modules/${module.module_key}`, "PUT", {
        is_enabled: module.is_required || values.get("is_enabled") === "on",
        configuration,
        revision: module.revision || null
      });
      await loadOrganizationConfiguration();
    }
  );
}

function renderOrganizationWorkflows(root) {
  const workflows = organizationConfigurationData.workflows || [];
  const panel = makeElement("section", "admin-panel admin-configuration-panel");
  const header = makeElement("div", "admin-panel-heading");
  header.append(makeElement("span", "", `${workflows.length} workflows`));
  const add = makeElement("button", "admin-primary-button", "Create workflow");
  add.type = "button";
  add.addEventListener("click", () => openOrganizationWorkflowDialog(null));
  panel.append(header, add);
  panel.append(makeElement("p", "admin-dialog-help",
    "Definitions and execution history are enforced by the workflow API. Native newsroom features continue to use their existing workflows unless specifically integrated."));
  if (!workflows.length) panel.append(makeElement("p", "admin-empty", "No reusable workflows have been configured."));
  workflows.forEach((workflow) => {
    const card = makeElement("article", "admin-panel admin-role-agreement-card");
    const title = makeElement("div", "admin-panel-heading");
    title.append(makeElement("h3", "", workflow.name),
      makeElement("span", "", workflow.is_active ? "Active" : "Inactive"));
    card.append(title, makeElement("p", "admin-dialog-help",
      `${workflow.module_key} · ${workflow.workflow_key} · v${workflow.version}${workflow.description ? ` · ${workflow.description}` : ""}`));
    const actions = makeElement("div", "admin-page-actions");
    const edit = makeElement("button", "admin-secondary-button", "Edit workflow");
    edit.type = "button";
    edit.addEventListener("click", () => openOrganizationWorkflowDialog(workflow));
    const addState = makeElement("button", "admin-secondary-button", "Add state");
    addState.type = "button";
    addState.addEventListener("click", () => openOrganizationWorkflowStateDialog(workflow, null));
    const addTransition = makeElement("button", "admin-secondary-button", "Add transition");
    addTransition.type = "button";
    addTransition.disabled = (workflow.states || []).length < 2;
    addTransition.addEventListener("click", () => openOrganizationWorkflowTransitionDialog(workflow, null));
    const deleteWorkflow = makeElement("button", "admin-secondary-button", "Delete if unused");
    deleteWorkflow.type = "button";
    deleteWorkflow.addEventListener("click", () => void confirmAdminAction(
      "Delete workflow?",
      `Delete "${workflow.name}"? Workflows with execution history cannot be deleted.`
    ).then((confirmed) => confirmed && runAction(
      () => apiRequest(`admin/organization/workflows/${workflow.id}`, "DELETE"),
      loadOrganizationConfiguration
    )));
    actions.append(edit, addState, addTransition, deleteWorkflow);
    card.append(actions);
    (workflow.states || []).forEach((state) => {
      const row = makeElement("div", "admin-organization-workflow-row");
      row.append(makeElement("span", "", `${state.label} · ${state.state_key}${state.is_initial ? " · initial" : ""}${state.is_terminal ? " · terminal" : ""}`));
      const editState = makeElement("button", "admin-secondary-button", "Edit state");
      editState.type = "button";
      editState.addEventListener("click", () => openOrganizationWorkflowStateDialog(workflow, state));
      const deleteState = makeElement("button", "admin-secondary-button", "Delete state");
      deleteState.type = "button";
      deleteState.addEventListener("click", () => void confirmAdminAction(
        "Delete workflow state?",
        "A state can be deleted only when it is not the initial state and has no transitions or execution history."
      ).then((confirmed) => confirmed && runAction(
        () => apiRequest(`admin/organization/workflows/${workflow.id}/states/${state.id}`, "DELETE"),
        loadOrganizationConfiguration
      )));
      row.append(editState, deleteState);
      card.append(row);
    });
    (workflow.transitions || []).forEach((transition) => {
      const source = workflow.states.find((state) => state.id === transition.from_state_id);
      const destination = workflow.states.find((state) => state.id === transition.to_state_id);
      const row = makeElement("div", "admin-organization-workflow-row");
      row.append(makeElement("span", "", `${source?.label || "?"} → ${destination?.label || "?"} · ${transition.label} · ${transition.required_permission}${transition.requires_approval ? " · approval required" : ""}`));
      const editTransition = makeElement("button", "admin-secondary-button", "Edit transition");
      editTransition.type = "button";
      editTransition.addEventListener("click", () => openOrganizationWorkflowTransitionDialog(workflow, transition));
      const deleteTransition = makeElement("button", "admin-secondary-button", "Delete transition");
      deleteTransition.type = "button";
      deleteTransition.addEventListener("click", () => void confirmAdminAction(
        "Delete workflow transition?",
        "Transitions referenced by approval history cannot be deleted."
      ).then((confirmed) => confirmed && runAction(
        () => apiRequest(`admin/organization/workflow-transitions/${transition.id}`, "DELETE"),
        loadOrganizationConfiguration
      )));
      row.append(editTransition, deleteTransition);
      card.append(row);
    });
    panel.append(card);
  });
  root.append(panel);
}

function openOrganizationWorkflowDialog(workflow) {
  const catalog = organizationConfigurationData.modules_catalog || [];
  openFormDialog(
    workflow ? "Edit workflow" : "Create workflow",
    "Workflows belong to an enabled module. Define states and permission-gated transitions after saving.",
    (form) => {
      addHrSelect(form, "Module", "module_key",
        catalog.map((module) => ({ value: module.module_key, label: module.name })),
        workflow?.module_key, null, true);
      const name = addField(form, "Workflow name", "name", "text", workflow?.name, {
        minLength: 2, maxLength: 120
      });
      addHrKeyField(form, "Workflow key", "workflow_key", workflow?.workflow_key, name);
      addField(form, "Description", "description", "text", workflow?.description, {
        required: false, maxLength: 2000
      });
      addHrActiveField(form, workflow?.is_active);
    },
    async (values) => {
      await apiRequest("admin/organization/workflows", "POST", {
        id: workflow?.id || null,
        module_key: values.get("module_key"),
        workflow_key: values.get("workflow_key"),
        name: values.get("name"),
        description: values.get("description"),
        is_active: values.get("is_active") === "on"
      });
      await loadOrganizationConfiguration();
    }
  );
}

function openOrganizationWorkflowStateDialog(workflow, state) {
  openFormDialog(
    state ? "Edit workflow state" : "Add workflow state",
    "Every active workflow needs one initial state before it can be started.",
    (form) => {
      const label = addField(form, "State label", "label", "text", state?.label, {
        minLength: 1, maxLength: 80
      });
      addHrKeyField(form, "State key", "state_key", state?.state_key, label);
      const initial = makeElement("label", "admin-form-checkbox");
      const isInitial = document.createElement("input");
      isInitial.type = "checkbox";
      isInitial.name = "is_initial";
      isInitial.checked = state?.is_initial === true;
      initial.append(isInitial, makeElement("span", "", "Initial state"));
      form.append(initial);
      const terminal = makeElement("label", "admin-form-checkbox");
      const isTerminal = document.createElement("input");
      isTerminal.type = "checkbox";
      isTerminal.name = "is_terminal";
      isTerminal.checked = state?.is_terminal === true;
      terminal.append(isTerminal, makeElement("span", "", "Terminal state"));
      form.append(terminal);
      addField(form, "Sort order", "sort_order", "number", state?.sort_order ?? 0, {
        required: true, minLength: 0
      }).min = "0";
    },
    async (values) => {
      await apiRequest(`admin/organization/workflows/${workflow.id}/states`, "POST", {
        id: state?.id || null,
        state_key: values.get("state_key"),
        label: values.get("label"),
        is_initial: values.get("is_initial") === "on",
        is_terminal: values.get("is_terminal") === "on",
        sort_order: Number(values.get("sort_order") || 0)
      });
      await loadOrganizationConfiguration();
    }
  );
}

function openOrganizationWorkflowTransitionDialog(workflow, transition) {
  const states = workflow.states || [];
  const permissions = organizationConfigurationData.permissions || [];
  openFormDialog(
    transition ? "Edit workflow transition" : "Add workflow transition",
    "Transitions are checked against the actor's current organization permissions. Approval-required transitions do not change state until another authorized user approves.",
    (form) => {
      addHrSelect(form, "From state", "from_state_id",
        states.map((state) => ({ value: state.id, label: state.label })),
        transition?.from_state_id, null, true);
      addHrSelect(form, "To state", "to_state_id",
        states.map((state) => ({ value: state.id, label: state.label })),
        transition?.to_state_id, null, true);
      const label = addField(form, "Transition label", "label", "text", transition?.label, {
        minLength: 2, maxLength: 80
      });
      addHrKeyField(form, "Transition key", "transition_key", transition?.transition_key, label);
      addHrSelect(form, "Required permission", "required_permission",
        permissions.map((permission) => ({
          value: permission.permission_key,
          label: `${permission.permission_key} · ${permission.area}`
        })), transition?.required_permission || "hr.employee.manage", null, true);
      [
        ["requires_reason", "Require a reason", transition?.requires_reason],
        ["requires_approval", "Require a second-person approval", transition?.requires_approval],
        ["is_active", "Active", transition?.is_active !== false]
      ].forEach(([name, labelText, checked]) => {
        const labelNode = makeElement("label", "admin-form-checkbox");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.name = name;
        checkbox.checked = checked === true;
        labelNode.append(checkbox, makeElement("span", "", labelText));
        form.append(labelNode);
      });
      addField(form, "Sort order", "sort_order", "number", transition?.sort_order ?? 0)
        .min = "0";
    },
    async (values) => {
      await apiRequest(`admin/organization/workflows/${workflow.id}/transitions`, "POST", {
        id: transition?.id || null,
        from_state_id: values.get("from_state_id"),
        to_state_id: values.get("to_state_id"),
        transition_key: values.get("transition_key"),
        label: values.get("label"),
        required_permission: values.get("required_permission"),
        requires_reason: values.get("requires_reason") === "on",
        requires_approval: values.get("requires_approval") === "on",
        is_active: values.get("is_active") === "on",
        sort_order: Number(values.get("sort_order") || 0)
      });
      await loadOrganizationConfiguration();
    }
  );
}

function renderHrManagement() {
  document.body.classList.add("admin-hr-theme");
  const root = makeElement("div", "admin-section");
  addHeading(
    root,
    "HUMAN RESOURCES",
    "HR management",
    "Manage employee records, assignments, departments, positions, and policies. HR permission roles control HR access; newsroom responsibilities and permissions are configured together under Newsroom roles."
  );
  const tabBar = makeElement("div", "admin-workflow-tabs");
  tabBar.setAttribute("aria-label", "HR management areas");
  [
    ["departments", "Departments"],
    ["positions", "Employee positions"],
    ["access_roles", "HR permission roles"],
    ["assignments", "Employees"],
    ["policies", "Policies"]
  ].forEach(([key, label]) => {
    const tab = makeElement("button", `admin-workflow-tab${activeHrTab === key ? " is-active" : ""}`, label);
    tab.type = "button";
    tab.setAttribute("aria-pressed", String(activeHrTab === key));
    tab.addEventListener("click", () => {
      activeHrTab = key;
      renderHrManagement();
    });
    tabBar.append(tab);
  });
  root.append(tabBar);
  root.append(makeElement("p", "admin-hr-guidance",
    "Manage employee records, assignments, departments, positions, HR access, and policies. Newsroom contributors and organization-wide data models are managed separately."));
  const canConfigure = hrManagementData?.capabilities?.configuration === true;
  const canManageEmployees = hrManagementData?.capabilities?.employees === true;
  const canAssignEmployees = hrManagementData?.capabilities?.manage_employees === true;
  const canManagePolicies = hrManagementData?.capabilities?.policies === true;

  if (["departments", "positions", "access_roles"].includes(activeHrTab) && canConfigure) {
    renderHrConfigurationTab(root);
  } else if (activeHrTab === "assignments" && canManageEmployees) {
    renderHrAssignmentsTab(root, canAssignEmployees);
  } else if (activeHrTab === "policies" && canManagePolicies) {
    renderHrPoliciesTab(root);
  } else {
    root.append(makeElement("section", "admin-panel admin-empty", "Your HR account does not have permission to manage this area."));
  }
  content.replaceChildren(root);
}

function renderHrConfigurationTab(root) {
  const isDepartments = activeHrTab === "departments";
  const isPositions = activeHrTab === "positions";
  const records = isDepartments ? hrManagementData.departments || []
    : isPositions ? hrManagementData.positions || []
      : hrEmployeePermissionRoles();
  const panel = makeElement("section", "admin-panel admin-hr-panel");
  const header = makeElement("div", "admin-panel-heading");
  const heading = isDepartments ? "Organization departments"
    : isPositions ? "Employee positions" : "HR employee permission roles";
  header.append(makeElement("h2", "", heading), makeElement("span", "", `${records.length} records`));
  const add = makeElement("button", "admin-primary-button", isDepartments ? "Add department"
    : isPositions ? "Add position" : "Add HR permission role");
  add.type = "button";
  add.addEventListener("click", () => {
    if (isDepartments) openHrDepartmentDialog(null);
    else if (isPositions) openHrPositionDialog(null);
    else openHrAccessRoleDialog(null);
  });
  panel.append(header, add);
  let orderedRecords = records.map((record) => ({ record, depth: 0 }));
  if (isDepartments) {
    const recordsById = new Map(records.map((record) => [String(record.id), record]));
    const childrenByParent = new Map();
    const roots = [];
    records.forEach((record) => {
      const parentId = record.parent_id ? String(record.parent_id) : "";
      if (!parentId || parentId === String(record.id) || !recordsById.has(parentId)) {
        roots.push(record);
        return;
      }
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(record);
    });
    orderedRecords = [];
    const visited = new Set();
    const appendDepartment = (record, depth) => {
      const id = String(record.id);
      if (visited.has(id)) return;
      visited.add(id);
      orderedRecords.push({ record, depth });
      (childrenByParent.get(id) || []).forEach((child) => appendDepartment(child, depth + 1));
    };
    roots.forEach((record) => appendDepartment(record, 0));
    records.forEach((record) => appendDepartment(record, 0));
  }
  orderedRecords.forEach(({ record, depth }) => {
    const card = makeElement("article", "admin-hr-record");
    if (isDepartments && depth > 0) {
      card.classList.add("is-nested-department");
      card.style.marginInlineStart = `${Math.min(depth, 6) * 18}px`;
    }
    const title = isDepartments ? record.name : isPositions ? record.title : record.name;
    const key = isDepartments ? record.department_key : isPositions ? record.position_key : record.role_key;
    card.append(makeElement("h3", "", title));
    card.append(makeElement("p", "admin-dialog-help",
      `${key} · ${record.is_active ? "Active" : "Inactive"}${record.description ? ` · ${record.description}` : ""}`));
    if (isDepartments && record.parent_id) {
      const parent = (hrManagementData.departments || [])
        .find((item) => String(item.id) === String(record.parent_id));
      card.append(makeElement("p", "admin-dialog-help",
        `Sub-department of ${parent?.name || "unavailable parent"}`));
    }
    if (isPositions) {
      const department = (hrManagementData.departments || []).find((item) => item.id === record.department_id);
      card.append(makeElement("p", "admin-dialog-help", `Department: ${department?.name || "Organization-wide"}`));
    }
    if (activeHrTab === "access_roles") {
      card.append(makeElement("p", "admin-dialog-help",
        `${(record.permissions || []).length} permission(s) · ${record.is_system ? "Protected system permission role" : "Custom permission role"}`));
    }
    const actions = makeElement("div", "admin-page-actions");
    const edit = makeElement("button", "admin-secondary-button", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => {
      if (isDepartments) openHrDepartmentDialog(record);
      else if (isPositions) openHrPositionDialog(record);
      else openHrAccessRoleDialog(record);
    });
    actions.append(edit);
    if (activeHrTab === "access_roles") {
      const permissions = makeElement("button", "admin-secondary-button", "Configure permissions");
      permissions.type = "button";
      permissions.addEventListener("click", () => openHrRolePermissionsDialog(record));
      actions.append(permissions);
    }
    if (!record.is_system) {
      const remove = makeElement("button", "admin-secondary-button admin-danger-button", "Delete");
      remove.type = "button";
      const deleteExplanation = isDepartments
        ? "This permanently deletes the department only when nothing references it. Department head appointment history cannot be deleted; deactivate the department if it has appointment history. Other dependent positions, assignments, policies, and model records must also be absent. Audit logs are retained."
        : isPositions
          ? "This permanently deletes the position only when no assignments reference it. Audit logs are retained."
            : "This permanently deletes the permission role only when no assignments or policies reference it. It also removes this role's configurable-model permissions and may revoke organization access mapped to the role. Audit logs are retained.";
      remove.addEventListener("click", () => void deleteHrRecord(
        isDepartments ? "departments" : isPositions ? "positions" : "access-roles",
        record.id,
        `Delete ${title}?`,
        deleteExplanation
      ));
      actions.append(remove);
    }
    card.append(actions);
    panel.append(card);
  });
  root.append(panel);
  if (activeHrTab === "access_roles") {
    root.append(makeElement("p", "admin-dialog-help",
      "These permission roles apply to HR employees only. Newsroom roles combine newsroom responsibilities and newsroom system permissions in one record."));
  }
}

function renderOrganizationModels(root) {
  const models = hrManagementData.models || [];
  const panel = makeElement("section", "admin-panel admin-hr-panel");
  const header = makeElement("div", "admin-panel-heading");
  header.append(makeElement("h2", "", "Configurable data models"),
    makeElement("span", "", `${models.length} models`));
  const add = makeElement("button", "admin-primary-button", "Create model");
  add.type = "button";
  add.addEventListener("click", () => openHrModelDialog(null));
  const workspaceLink = makeElement("a", "admin-secondary-button", "Open organization workspace");
  workspaceLink.href = "/organization";
  panel.append(header, add, workspaceLink);
  panel.append(makeElement("p", "admin-dialog-help",
    "Build safe, validated business forms without custom code. Configure each model's fields, workflow states, and scoped access. Record history is retained; models with records can only be deactivated."));
  if (!models.length) panel.append(makeElement("p", "admin-empty", "No configurable models yet."));
  models.forEach((model) => {
    const card = makeElement("article", "admin-hr-record");
    card.append(makeElement("h3", "", model.name));
    card.append(makeElement("p", "admin-dialog-help",
      `${model.model_key} · ${model.is_active ? "Active" : "Inactive"} · ${model.workflow_enabled ? `Workflow starts at ${model.initial_status}` : "No approval workflow"}`));
    if (model.description) card.append(makeElement("p", "admin-dialog-help", model.description));
    const actions = makeElement("div", "admin-page-actions");
    const edit = makeElement("button", "admin-secondary-button", "Edit model");
    edit.type = "button";
    edit.addEventListener("click", () => openHrModelDialog(model));
    const addField = makeElement("button", "admin-secondary-button", "Add field");
    addField.type = "button";
    addField.disabled = !model.is_active;
    addField.addEventListener("click", () => openHrModelFieldDialog(model, null));
    const permissions = makeElement("button", "admin-secondary-button", "Configure role access");
    permissions.type = "button";
    permissions.addEventListener("click", () => openHrModelPermissionsDialog(model));
    actions.append(edit, addField, permissions);
    if (model.workflow_enabled) {
      const transition = makeElement("button", "admin-secondary-button", "Add workflow transition");
      transition.type = "button";
      transition.disabled = !model.is_active;
      transition.addEventListener("click", () => openHrModelTransitionDialog(model, null));
      actions.append(transition);
    }
    const remove = makeElement("button", "admin-secondary-button admin-danger-button", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => void deleteHrModel(model));
    actions.append(remove);
    card.append(actions);
    const fieldList = makeElement("div", "admin-hr-model-list");
    (model.fields || []).forEach((field) => {
      const row = makeElement("div", "admin-hr-model-item");
      row.append(makeElement("span", "", `${field.label} · ${field.field_type}${field.is_required ? " · Required" : ""}${field.is_active ? "" : " · Inactive"}`));
      const editField = makeElement("button", "admin-secondary-button", "Edit");
      editField.type = "button";
      editField.disabled = !model.is_active;
      editField.addEventListener("click", () => openHrModelFieldDialog(model, field));
      const deleteField = makeElement("button", "admin-secondary-button admin-danger-button", "Delete field");
      deleteField.type = "button";
      deleteField.disabled = !model.is_active;
      deleteField.addEventListener("click", () => void deleteHrRecord(
        "model-fields",
        field.id,
        `Delete the "${field.label}" field?`,
        "This permanently removes the field and its current values from model records. Immutable record history remains.",
        () => loadConfigurationPage("organization-models")
      ));
      row.append(editField, deleteField);
      fieldList.append(row);
    });
    (model.transitions || []).forEach((transition) => {
      const row = makeElement("div", "admin-hr-model-item");
      row.append(makeElement("span", "",
        `${transition.label} · ${transition.from_status} → ${transition.to_status} · ${transition.required_action}`));
      const editTransition = makeElement("button", "admin-secondary-button", "Edit");
      editTransition.type = "button";
      editTransition.addEventListener("click", () => openHrModelTransitionDialog(model, transition));
      const removeTransition = makeElement("button", "admin-secondary-button", "Delete");
      removeTransition.type = "button";
      removeTransition.addEventListener("click", () => void deleteHrModelTransition(transition));
      row.append(editTransition, removeTransition);
      fieldList.append(row);
    });
    card.append(fieldList);
    panel.append(card);
  });
  root.append(panel);
}

function openHrModelDialog(model) {
  openFormDialog(model ? "Edit configurable model" : "Create configurable model",
    "Models define validated organization records. The initial workflow state cannot be changed after records are created.",
    (form) => {
      const name = addField(form, "Model name", "name", "text", model?.name, { minLength: 2, maxLength: 100 });
      addHrKeyField(form, "Model key", "model_key", model?.model_key, name);
      addHrTextArea(form, "Description", "description", model?.description, 2000);
      const initialState = addField(form, "Initial workflow state", "initial_status", "text",
        model?.initial_status || "draft", { maxLength: 40 });
      initialState.pattern = "[a-z][a-z0-9_]{1,39}";
      const workflow = makeElement("label", "admin-form-checkbox");
      const workflowBox = document.createElement("input");
      workflowBox.type = "checkbox";
      workflowBox.name = "workflow_enabled";
      workflowBox.checked = model?.workflow_enabled === true;
      workflow.append(workflowBox, makeElement("span", "", "Require configured workflow transitions"));
      form.append(workflow);
      addHrActiveField(form, model?.is_active);
    },
    async (values) => {
      await apiRequest("admin/hr/models", "POST", {
        id: model?.id || null,
        model_key: values.get("model_key"),
        name: values.get("name"),
        description: values.get("description"),
        initial_status: values.get("initial_status"),
        workflow_enabled: values.get("workflow_enabled") === "on",
        is_active: values.get("is_active") === "on"
      });
      await loadConfigurationPage("organization-models");
    });
}

function openHrModelFieldDialog(model, field) {
  openFormDialog(field ? "Edit model field" : `Add field to ${model.name}`,
    "Field keys are stable identifiers. Once values exist, a field's data type cannot be changed.",
    (form) => {
      const label = addField(form, "Field label", "label", "text", field?.label, { minLength: 1, maxLength: 100 });
      addHrKeyField(form, "Field key", "field_key", field?.field_key, label);
      addHrSelect(form, "Field type", "field_type", [
        { value: "text", label: "Short text" },
        { value: "long_text", label: "Long text" },
        { value: "number", label: "Number" },
        { value: "date", label: "Date" },
        { value: "boolean", label: "Yes / no" },
        { value: "select", label: "Single choice" },
        { value: "email", label: "Email" },
        { value: "url", label: "Web address" }
      ], field?.field_type || "text");
      addHrTextArea(form, "Choice options (one per line; select fields only)", "options",
        (field?.options || []).join("\n"), 5000);
      const required = makeElement("label", "admin-form-checkbox");
      const requiredBox = document.createElement("input");
      requiredBox.type = "checkbox";
      requiredBox.name = "is_required";
      requiredBox.checked = field?.is_required === true;
      required.append(requiredBox, makeElement("span", "", "Required field"));
      form.append(required);
      addHrActiveField(form, field?.is_active);
    },
    async (values) => {
      const options = String(values.get("options") || "").split(/\r?\n/)
        .map((option) => option.trim()).filter(Boolean);
      await apiRequest(`admin/hr/models/${model.id}/fields`, "POST", {
        id: field?.id || null,
        field_key: values.get("field_key"),
        label: values.get("label"),
        field_type: values.get("field_type"),
        options,
        is_required: values.get("is_required") === "on",
        is_active: values.get("is_active") === "on",
        sort_order: field?.sort_order ?? (model.fields || []).length
      });
      await loadConfigurationPage("organization-models");
    });
}

function openHrModelPermissionsDialog(model) {
  const roles = hrEmployeePermissionRoles().filter((role) => role.is_active);
  if (!roles.length) {
    void showAdminMessage("No active HR permission roles", "Create an HR permission role before configuring model access.");
    return;
  }
  openFormDialog(`Configure ${model.name} access`,
    "Each role receives only the model actions and record scope selected here. Scope changes are enforced by the database.",
    (form) => {
      addHrSelect(form, "HR permission role", "role_id",
        roles.map((role) => ({ value: role.id, label: role.name })), roles[0].id);
      const permissions = model.permissions || [];
      const actionLabels = [
        ["read", "Read records"], ["create", "Create records"], ["update", "Edit records"],
        ["delete", "Delete records"], ["submit", "Submit workflow"], ["approve", "Approve workflow"]
      ];
      actionLabels.forEach(([action, labelText]) => {
        const row = makeElement("div", "admin-hr-permission-row");
        const label = makeElement("label", "admin-form-checkbox");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.name = `model-action:${action}`;
        checkbox.checked = permissions.some((permission) =>
          permission.role_id === roles[0].id && permission.action === action);
        label.append(checkbox, makeElement("span", "", labelText));
        row.append(label);
        const scope = document.createElement("select");
        scope.name = `model-scope:${action}`;
        const scopes = action === "create" || action === "delete"
          ? ["all", "department", "own"] : ["all", "department", "assigned", "own"];
        scopes.forEach((value) => {
          const option = new Option(value, value);
          const current = permissions.find((permission) =>
            permission.role_id === roles[0].id && permission.action === action);
          option.selected = value === (current?.scope || "own");
          scope.append(option);
        });
        row.append(scope);
        form.append(row);
      });
      form.elements.role_id.addEventListener("change", (event) => {
        const selected = event.target.value;
        actionLabels.forEach(([action]) => {
          const grant = permissions.find((permission) =>
            permission.role_id === selected && permission.action === action);
          form.elements[`model-action:${action}`].checked = Boolean(grant);
          form.elements[`model-scope:${action}`].value = grant?.scope || "own";
        });
      });
    },
    async (values) => {
      const roleId = values.get("role_id");
      const permissions = ["read", "create", "update", "delete", "submit", "approve"]
        .filter((action) => values.get(`model-action:${action}`) === "on")
        .map((action) => ({
          action, scope: values.get(`model-scope:${action}`)
        }));
      await apiRequest(`admin/hr/models/${model.id}/roles/${roleId}`, "PUT", { permissions });
      await loadConfigurationPage("organization-models");
    },
    "Save access");
}

function openHrModelTransitionDialog(model, transition) {
  openFormDialog(transition ? "Edit workflow transition" : `Add ${model.name} transition`,
    "Transitions are only available from the exact source state. Staff need the selected permission at the configured scope.",
    (form) => {
      const from = addField(form, "From state", "from_status", "text",
        transition?.from_status || model.initial_status, { maxLength: 40 });
      from.pattern = "[a-z][a-z0-9_]{1,39}";
      const to = addField(form, "To state", "to_status", "text",
        transition?.to_status, { maxLength: 40 });
      to.pattern = "[a-z][a-z0-9_]{1,39}";
      addField(form, "Button label", "label", "text", transition?.label, { minLength: 2, maxLength: 80 });
      addHrSelect(form, "Required action permission", "required_action", [
        { value: "update", label: "Update" },
        { value: "submit", label: "Submit" },
        { value: "approve", label: "Approve" }
      ], transition?.required_action || "submit");
    },
    async (values) => {
      await apiRequest(`admin/hr/models/${model.id}/transitions`, "POST", {
        id: transition?.id || null,
        from_status: values.get("from_status"),
        to_status: values.get("to_status"),
        label: values.get("label"),
        required_action: values.get("required_action"),
        sort_order: transition?.sort_order ?? (model.transitions || []).length
      });
      await loadConfigurationPage("organization-models");
    });
}

async function deleteHrModelTransition(transition) {
  if (!await confirmAdminAction("Delete workflow transition?",
    "Transitions used by records in the source state cannot be deleted.", "Delete")) return;
  try {
    await apiRequest(`admin/hr/model-transitions/${transition.id}`, "DELETE");
    await loadConfigurationPage("organization-models");
  } catch (error) {
    void showAdminMessage("Transition could not be deleted", error.message);
  }
}

async function deleteHrModel(model) {
  if (!await confirmAdminAction(`Delete ${model.name}?`,
    "This permanently deletes the model configuration after its records have been deleted. Audit history is retained.", "Delete permanently")) return;
  try {
    await apiRequest(`admin/hr/models/${model.id}`, "DELETE");
    await loadConfigurationPage("organization-models");
  } catch (error) {
    void showAdminMessage("Model was not deleted", error.message);
  }
}

function renderHrAssignmentsTab(root, canAssignEmployees) {
  const assignments = hrManagementData.assignments || [];
  const assignmentsByEmployee = new Map();
  const employeesById = new Map();
  assignments.forEach((assignment) => {
    const employeeKey = assignment.employee_id || assignment.id;
    if (!assignmentsByEmployee.has(employeeKey)) assignmentsByEmployee.set(employeeKey, []);
    assignmentsByEmployee.get(employeeKey).push(assignment);
  });
  (hrManagementData.employees || []).forEach((employee) => {
    const employeeKey = employee.id;
    employeesById.set(employeeKey, employee);
    if (!assignmentsByEmployee.has(employeeKey)) assignmentsByEmployee.set(employeeKey, []);
  });
  const panel = makeElement("section", "admin-panel admin-hr-panel");
  const header = makeElement("div", "admin-panel-heading");
  header.append(makeElement("h2", "", "Employees and assignment history"),
    makeElement("span", "", `${assignmentsByEmployee.size} employees · ${assignments.length} assignments`));
  if (canAssignEmployees) {
    const add = makeElement("button", "admin-primary-button", "Assign existing account");
    add.type = "button";
    add.addEventListener("click", () => openHrAssignmentDialog(null));
    const invite = makeElement("button", "admin-secondary-button", "Invite by email");
    invite.type = "button";
    invite.addEventListener("click", () => openHrInvitationDialog());
    const actions = makeElement("div", "admin-page-actions");
    actions.append(add, invite);
    panel.append(header, actions);
    const note = makeElement("p", "admin-dialog-help",
      "Create an employment record for an existing account or invite an employee by email. Employees complete their profile and accept required policies before HR activates their assignment.");
    panel.append(note);
  } else {
    panel.append(header);
  }
  renderHrDepartmentHeads(panel, canAssignEmployees);
  assignmentsByEmployee.forEach((employeeAssignments, employeeKey) => {
    employeeAssignments.sort((left, right) => {
      const startDifference = (Date.parse(left.starts_at || "") || 0)
        - (Date.parse(right.starts_at || "") || 0);
      if (startDifference) return startDifference;
      return (Date.parse(left.created_at || "") || 0)
        - (Date.parse(right.created_at || "") || 0);
    });
    const employee = employeeAssignments[0] || employeesById.get(employeeKey) || {};
    const employeeId = employee.employee_id || employee.id || employeeKey;
    const employeeName = employee.employee_name || employee.employee_email
      || employee.full_name || employee.email || employeeId;
    const card = makeElement("article", "admin-hr-record");
    card.append(makeElement("h3", "", `${employeeName} · ${employee.employee_number || "No employee number"}`));
    card.append(makeElement("p", "admin-dialog-help",
      `${employee.employment_type?.replace(/_/g, " ") || "Employment type not set"} · Employment status: ${employee.employment_status || "Not set"}`));
    card.append(makeElement("strong", "admin-hr-assignment-heading",
      employeeAssignments.length
        ? `Assignment history (${employeeAssignments.length})`
        : "No assignment history recorded"));
    const history = makeElement("div", "admin-hr-assignment-history");
    employeeAssignments.forEach((assignment) => {
      const assignmentCard = makeElement("div", "admin-hr-assignment");
      assignmentCard.append(makeElement("strong", "",
        `${assignment.position_title || "Position not set"} · ${assignment.department_name || "Department not set"}`));
      assignmentCard.append(makeElement("p", "admin-dialog-help",
        `HR permission role: ${assignment.access_role_name || "Missing"} · ${assignment.status}${assignment.is_primary ? " · Primary" : ""}`));
      assignmentCard.append(makeElement("p", "admin-dialog-help",
        `Effective: ${formatDate(assignment.starts_at)} – ${assignment.ends_at ? formatDate(assignment.ends_at) : "Current"} · Manager: ${assignment.manager_name || "Not assigned"}`));
      if (assignment.end_reason) {
        assignmentCard.append(makeElement("p", "admin-dialog-help", `End reason: ${assignment.end_reason}`));
      }
      if (canAssignEmployees) {
        const actions = makeElement("div", "admin-page-actions");
        if (assignment.status !== "ended") {
          const edit = makeElement("button", "admin-secondary-button", "Change assignment");
          edit.type = "button";
          edit.addEventListener("click", () => openHrAssignmentDialog(assignment));
          actions.append(edit);
          const end = makeElement("button", "admin-secondary-button", "End assignment");
          end.type = "button";
          end.addEventListener("click", () => openHrAssignmentDialog(assignment, true));
          actions.append(end);
        }
        const removeAssignment = makeElement("button", "admin-secondary-button admin-danger-button", "Delete assignment");
        removeAssignment.type = "button";
        removeAssignment.addEventListener("click", () => void deleteHrRecord(
          "assignments",
          assignment.id,
          "Permanently delete this assignment?",
          "The assignment and its employment history will be removed. Its audit log entry will remain."
        ));
        actions.append(removeAssignment);
        assignmentCard.append(actions);
      }
      history.append(assignmentCard);
    });
    if (!employeeAssignments.length) {
      history.append(makeElement("p", "admin-empty", "This employee currently has no recorded HR assignments."));
    }
    card.append(history);
    if (canAssignEmployees) {
      const actions = makeElement("div", "admin-page-actions");
      const removeEmployee = makeElement("button", "admin-secondary-button admin-danger-button", "Delete HR employee record");
      removeEmployee.type = "button";
      removeEmployee.addEventListener("click", () => void deleteHrRecord(
        "employees",
        employeeId,
        `Permanently delete ${employeeName}'s HR record?`,
        "This removes the HR employee record, assignments, and policy acceptance records. The Chowk login account remains; audit logs are retained."
      ));
      actions.append(removeEmployee);
      card.append(actions);
    }
    panel.append(card);
  });
  if (!assignmentsByEmployee.size) {
    panel.append(makeElement("p", "admin-empty",
      "No employee assignment history yet. Assign an existing account or invite an employee to get started."));
  }
  root.append(panel);
}

function renderHrDepartmentHeads(root, canAssignEmployees) {
  const appointments = hrManagementData.department_head_appointments || [];
  const departmentMap = new Map((hrManagementData.departments || [])
    .filter((department) => department.is_active)
    .map((department) => [String(department.id), department]));
  appointments.forEach((appointment) => {
    const key = String(appointment.department_id);
    if (!departmentMap.has(key)) {
      departmentMap.set(key, {
        id: appointment.department_id,
        name: appointment.department_name || "Unavailable or inactive department",
        is_active: false
      });
    }
  });
  const departments = [...departmentMap.values()];
  if (!departments.length) return;
  const panel = makeElement("section", "admin-panel admin-hr-panel admin-hr-department-heads");
  const header = makeElement("div", "admin-panel-heading");
  const activeEmployeeIds = new Set((hrManagementData.employees || []).map((employee) => String(employee.id)));
  const employeeAssignmentIds = new Set((hrManagementData.assignments || [])
    .filter((assignment) => assignment.status === "active"
      && Date.parse(assignment.starts_at || "") <= Date.now())
    .map((assignment) => String(assignment.employee_id)));
  const eligibleEmployeeIds = new Set([...activeEmployeeIds].filter((id) => employeeAssignmentIds.has(id)));
  const appointmentsNeedingReview = appointments.filter((appointment) =>
    ["active", "scheduled"].includes(appointment.appointment_state)
      && !eligibleEmployeeIds.has(String(appointment.employee_id))
  );
  header.append(
    makeElement("h2", "", "Department head appointments"),
    makeElement("span", "", `${departments.length} departments · ${appointments.length} appointments`)
  );
  panel.append(header);
  panel.append(makeElement("p", "admin-dialog-help",
    "Each department has one head at a time. An acting appointment replaces the current appointment; dated history is retained. Head appointments do not grant access permissions or replace an employee's manager assignment."));
  if (appointmentsNeedingReview.length) {
    panel.append(makeElement("p", "admin-workflow-scope-note admin-workflow-scope-note-warning",
      `${appointmentsNeedingReview.length} active or scheduled department head appointment(s) have an appointee who no longer meets current HR eligibility. Review and end or cancel these appointments; employment changes do not end them automatically.`));
  }

  departments.forEach((department) => {
    const departmentAppointments = appointments
      .filter((appointment) => String(appointment.department_id) === String(department.id))
      .sort((left, right) => (Date.parse(left.valid_from || "") || 0) - (Date.parse(right.valid_from || "") || 0));
    const current = departmentAppointments.find((appointment) => appointment.appointment_state === "active");
    const scheduled = departmentAppointments.filter((appointment) => appointment.appointment_state === "scheduled");
    const card = makeElement("article", "admin-hr-record admin-hr-department-head");
    card.append(makeElement("h3", "", department.name));
    if (!department.is_active) {
      card.append(makeElement("p", "admin-dialog-help",
        "This department is inactive. Existing appointment history is retained; new appointments cannot be created."));
    }
    card.append(makeElement("p", "admin-dialog-help", current
      ? `Current head: ${current.employee_name || current.employee_email || "Employee unavailable"} · ${current.appointment_type}`
      : "No current department head"));
    if (current) {
      card.append(makeElement("p", "admin-dialog-help",
        `Effective ${formatDate(current.valid_from)} – ${current.valid_to ? formatDate(new Date(new Date(current.valid_to).getTime() - 1)) : "Until ended"} · ${current.appointment_reason}`));
    }
    if (scheduled.length) {
      card.append(makeElement("p", "admin-dialog-help",
        `${scheduled.length} future appointment${scheduled.length === 1 ? "" : "s"} scheduled`));
    }
    if (canAssignEmployees && department.is_active) {
      const appoint = makeElement("button", "admin-secondary-button", current || scheduled.length
        ? "Replace / schedule head" : "Appoint department head");
      appoint.type = "button";
      appoint.addEventListener("click", () => openHrDepartmentHeadDialog(department, appointments));
      card.append(appoint);
    }
    if (departmentAppointments.length) {
      const history = document.createElement("details");
      history.className = "admin-hr-department-head-history";
      const summary = document.createElement("summary");
      summary.textContent = `Appointment history (${departmentAppointments.length})`;
      history.append(summary);
      departmentAppointments.forEach((appointment) => {
        const row = makeElement("div", "admin-hr-department-head-appointment");
        row.append(makeElement("strong", "",
          `${appointment.employee_name || appointment.employee_email || "Employee unavailable"} · ${appointment.appointment_type} · ${appointment.appointment_state}`));
        row.append(makeElement("p", "admin-dialog-help",
          `${formatDate(appointment.valid_from)} – ${appointment.valid_to ? formatDate(new Date(new Date(appointment.valid_to).getTime() - 1)) : "No scheduled end"}`));
        row.append(makeElement("p", "admin-dialog-help", appointment.appointment_reason));
        if (appointment.end_reason) {
          row.append(makeElement("p", "admin-dialog-help", `Closure: ${appointment.end_reason}`));
        }
        if (canAssignEmployees && ["active", "scheduled"].includes(appointment.appointment_state)) {
          const end = makeElement("button", "admin-secondary-button admin-danger-button",
            appointment.appointment_state === "scheduled" ? "Cancel appointment" : "End appointment");
          end.type = "button";
          end.addEventListener("click", () => openEndHrDepartmentHeadDialog(
            appointment.id,
            appointment.appointment_state === "scheduled"
          ));
          row.append(end);
        }
        history.append(row);
      });
      card.append(history);
    }
    panel.append(card);
  });
  root.append(panel);
}

function openHrDepartmentHeadDialog(department, appointments) {
  const now = Date.now();
  const currentEmployeeIds = new Set((hrManagementData.assignments || [])
    .filter((assignment) => assignment.status === "active"
      && Date.parse(assignment.starts_at || "") <= now)
    .map((assignment) => String(assignment.employee_id)));
  const employees = (hrManagementData.employees || [])
    .filter((employee) => employee.employment_status === "active"
      && currentEmployeeIds.has(String(employee.id)))
    .sort((left, right) => String(left.full_name || left.email)
      .localeCompare(String(right.full_name || right.email)));
  if (!employees.length) {
    void showAdminMessage(
      "No eligible employees",
      "A department head must be an active HR employee with a current active assignment."
    );
    return;
  }
  const replacements = appointments.filter((appointment) =>
    String(appointment.department_id) === String(department.id)
      && ["active", "scheduled"].includes(appointment.appointment_state)
  );
  openFormDialog(
    `${department.name}: appoint department head`,
    "Choose an active HR employee. A head appointment records responsibility only; it does not grant system access or change the employee's manager.",
    (form) => {
      addHrSelect(form, "Active HR employee", "employee_id", employees.map((employee) => ({
        value: employee.id,
        label: `${employee.full_name || employee.email} · ${employee.employee_number}`
      })), null, "Choose an employee");
      const type = addHrSelect(form, "Appointment type", "appointment_type", [
        { value: "permanent", label: "Permanent" },
        { value: "acting", label: "Acting" }
      ], "permanent");
      addField(form, "Effective from", "valid_from", "date", dateInputValue(), { required: true });
      const validTo = addField(form, "Effective through (inclusive)", "valid_to", "date", "", { required: false });
      const updateEndRequirement = () => {
        validTo.required = type.value === "acting";
      };
      type.addEventListener("change", updateEndRequirement);
      updateEndRequirement();
      addHrTextArea(form, "Reason for appointment", "reason", "", 1000, true);
      addHrSelect(form, "Replace existing appointment", "replace_appointment_id",
        replacements.map((appointment) => ({
          value: appointment.id,
          label: `${appointment.employee_name || appointment.employee_email} · ${appointment.appointment_type} · ${appointment.appointment_state}`
        })), null, "No replacement", false);
      const replaceReason = addHrTextArea(form, "Reason for replacement", "replace_reason", "", 1000, false);
      const replaceSelect = form.elements.replace_appointment_id;
      const updateReplacementRequirement = () => {
        replaceReason.required = Boolean(replaceSelect.value);
      };
      replaceSelect.addEventListener("change", updateReplacementRequirement);
      updateReplacementRequirement();
      form.append(makeElement("p", "admin-dialog-help",
        "If another appointment overlaps the selected start date, select it for replacement. Replacements end the previous appointment on the new start date and preserve its history."));
    },
    async (values) => {
      const asStartOfDay = (value) => value
        ? new Date(`${value}T00:00:00`).toISOString()
        : null;
      const asEndOfInclusiveDay = (value) => {
        if (!value) return null;
        const date = new Date(`${value}T00:00:00`);
        date.setDate(date.getDate() + 1);
        return date.toISOString();
      };
      await apiRequest("admin/hr/department-head-appointments", "POST", {
        department_id: department.id,
        employee_id: values.get("employee_id"),
        appointment_type: values.get("appointment_type"),
        valid_from: asStartOfDay(values.get("valid_from")),
        valid_to: asEndOfInclusiveDay(values.get("valid_to")),
        reason: values.get("reason"),
        replace_appointment_id: values.get("replace_appointment_id") || null,
        replace_reason: values.get("replace_reason") || ""
      });
      await loadHrManagement();
    },
    "Save appointment"
  );
}

function openEndHrDepartmentHeadDialog(appointmentId, isScheduled) {
  openFormDialog(
    isScheduled ? "Cancel department head appointment" : "End department head appointment",
    "Provide a reason. The appointment record remains in department history.",
    (form) => addHrTextArea(form, "Reason", "end_reason", "", 1000, true),
    async (values) => {
      await apiRequest(`admin/hr/department-head-appointments/${appointmentId}/end`, "POST", {
        end_reason: values.get("end_reason")
      });
      await loadHrManagement();
    },
    isScheduled ? "Cancel appointment" : "End appointment"
  );
}

function renderHrPoliciesTab(root) {
  const policies = hrManagementData.policies || [];
  const panel = makeElement("section", "admin-panel admin-hr-panel");
  const header = makeElement("div", "admin-panel-heading");
  header.append(makeElement("h2", "", "Policies and terms"), makeElement("span", "", `${policies.length} policies`));
  const add = makeElement("button", "admin-primary-button", "Add policy");
  add.type = "button";
  add.addEventListener("click", () => openHrPolicyDialog(null));
  panel.append(header, add);
  policies.forEach((policy) => {
    const card = makeElement("article", "admin-hr-record");
    card.append(makeElement("h3", "", policy.title));
    card.append(makeElement("p", "admin-dialog-help",
      `${policy.policy_key} · ${policy.is_active ? "Active" : "Inactive"} · ${policy.requires_acceptance ? "Acceptance required" : "Informational"}`));
    const departmentName = (hrManagementData.departments || [])
      .find((item) => item.id === policy.department_id)?.name;
    const roleName = hrEmployeePermissionRoles()
      .find((item) => item.id === policy.access_role_id)?.name;
    card.append(makeElement("p", "admin-dialog-help",
      `Audience: ${departmentName || "All departments"} · ${roleName || "All HR permission roles"}`));
    const edit = makeElement("button", "admin-secondary-button", "Edit policy");
    edit.type = "button";
    edit.addEventListener("click", () => openHrPolicyDialog(policy));
    card.append(edit);
    const newVersion = makeElement("button", "admin-secondary-button", "Create draft version");
    newVersion.type = "button";
    newVersion.addEventListener("click", () => openHrPolicyVersionDialog(policy, null));
    card.append(newVersion);
    (policy.versions || []).forEach((version) => {
      const versionRow = makeElement("div", "admin-hr-policy-version");
      versionRow.append(makeElement("strong", "",
        `Version ${version.version} · ${version.status} · ${(version.accepted_employees || []).length} accepted`));
      if (version.accepted_employees?.length) {
        versionRow.append(makeElement("span", "admin-dialog-help",
          version.accepted_employees.map((person) => person.full_name || person.email || person.employee_id).join(", ")));
      }
      if (version.status === "draft") {
        const editDraft = makeElement("button", "admin-secondary-button", "Edit draft");
        editDraft.type = "button";
        editDraft.addEventListener("click", () => openHrPolicyVersionDialog(policy, version));
        const publish = makeElement("button", "admin-primary-button", "Publish");
        publish.type = "button";
        publish.addEventListener("click", () => void publishHrPolicyVersion(version.id));
        versionRow.append(editDraft, publish);
      } else {
        versionRow.append(makeElement("span", "admin-dialog-help",
          `Published ${formatDate(version.published_at)} · SHA-256 ${version.sha256}`));
      }
      const removeVersion = makeElement("button", "admin-secondary-button admin-danger-button", "Delete version");
      removeVersion.type = "button";
      removeVersion.addEventListener("click", () => void deleteHrRecord(
        "policy-versions",
        version.id,
        `Permanently delete version ${version.version}?`,
        "This removes the version and its employee acceptances. The audit log is retained. An active required policy must have another published version."
      ));
      versionRow.append(removeVersion);
      card.append(versionRow);
    });
    const remove = makeElement("button", "admin-secondary-button admin-danger-button", "Delete policy");
    remove.type = "button";
    remove.addEventListener("click", () => void deleteHrRecord(
      "policies", policy.id, `Delete ${policy.title}?`,
      "This permanently removes the policy, all versions, and all associated employee acceptances. Audit logs are retained."
    ));
    card.append(remove);
    panel.append(card);
  });
  root.append(panel);
  root.append(makeElement("p", "admin-dialog-help",
    "Publishing a new required version retires the prior version. Existing employees lose organization access until they accept the new version. Audit history is retained after HR records are deleted."));
}

function addHrSelect(form, labelText, name, options, selected, emptyLabel = null, required = true) {
  const label = makeElement("label", "admin-form-field");
  label.append(makeElement("span", "", labelText));
  const select = document.createElement("select");
  select.name = name;
  select.required = required;
  if (emptyLabel !== null) select.append(new Option(emptyLabel, ""));
  options.forEach((item) => {
    const option = new Option(item.label, item.value);
    option.selected = String(item.value) === String(selected || "");
    select.append(option);
  });
  label.append(select);
  form.append(label);
  return select;
}

function addHrKeyField(form, label, name, current, titleInput) {
  const field = addField(form, label, name, "text", current || "", { maxLength: 50 });
  field.pattern = "[a-z][a-z0-9_]{1,49}";
  if (!current && titleInput) {
    titleInput.addEventListener("input", () => {
      field.value = titleInput.value.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+/, "").replace(/_+$/g, "").slice(0, 50);
    });
  }
  return field;
}

function addHrTextArea(form, labelText, name, value, maxLength, required = false) {
  const label = makeElement("label", "admin-form-field");
  label.append(makeElement("span", "", labelText));
  const textarea = document.createElement("textarea");
  textarea.name = name;
  textarea.rows = 5;
  textarea.maxLength = maxLength;
  textarea.required = required;
  textarea.value = value || "";
  label.append(textarea);
  form.append(label);
  return textarea;
}

function addHrActiveField(form, isActive) {
  const label = makeElement("label", "admin-form-checkbox");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "is_active";
  checkbox.checked = isActive !== false;
  label.append(checkbox, makeElement("span", "", "Active and available"));
  form.append(label);
}

function openHrDepartmentDialog(record) {
  openFormDialog(record ? "Edit department" : "Add department",
    "Departments organize employees. Department head appointments are separately dated and retained; in-use departments can be deactivated but not hard-deleted.",
    (form) => {
      const name = addField(form, "Department name", "name", "text", record?.name, { minLength: 2, maxLength: 100 });
      addHrKeyField(form, "Department key", "department_key", record?.department_key, name);
      addField(form, "Description", "description", "text", record?.description, { required: false, maxLength: 2000 });
      const parents = (hrManagementData.departments || []).filter((item) => item.id !== record?.id);
      addHrSelect(form, "Parent department", "parent_id",
        parents.map((item) => ({ value: item.id, label: item.name })), record?.parent_id,
        "No parent", false);
      addHrActiveField(form, record?.is_active);
    },
    async (values) => {
      await apiRequest("admin/hr/departments", "POST", {
        id: record?.id || null, department_key: values.get("department_key"),
        name: values.get("name"), description: values.get("description"),
        parent_id: values.get("parent_id") || null, is_active: values.get("is_active") === "on"
      });
      await loadHrManagement();
    });
}

function openHrPositionDialog(record) {
  openFormDialog(record ? "Edit position" : "Add position",
    "Employee positions describe organizational work; HR application access is granted separately through an HR permission role.",
    (form) => {
      const title = addField(form, "Position title", "title", "text", record?.title, { minLength: 2, maxLength: 100 });
      addHrKeyField(form, "Position key", "position_key", record?.position_key, title);
      addHrTextArea(form, "Description", "description", record?.description, 5000);
      addHrSelect(form, "Department", "department_id",
        (hrManagementData.departments || []).filter((item) => item.is_active)
          .map((item) => ({ value: item.id, label: item.name })),
        record?.department_id, "Organization-wide", false);
      addHrActiveField(form, record?.is_active);
    },
    async (values) => {
      await apiRequest("admin/hr/positions", "POST", {
        id: record?.id || null, position_key: values.get("position_key"),
        title: values.get("title"), description: values.get("description"),
        department_id: values.get("department_id") || null, is_active: values.get("is_active") === "on"
      });
      await loadHrManagement();
    });
}

function openHrAccessRoleDialog(record) {
  openFormDialog(record ? "Edit HR permission role" : "Add HR permission role",
    "Configure HR employee access here. Newsroom roles combine newsroom responsibilities and system permissions and are managed separately under Newsroom · People.",
    (form) => {
      const name = addField(form, "Permission role name", "name", "text", record?.name, { minLength: 2, maxLength: 100 });
      addHrKeyField(form, "Permission role key", "role_key", record?.role_key, name);
      addHrTextArea(form, "Description", "description", record?.description, 2000);
      addHrActiveField(form, record?.is_active);
    },
    async (values) => {
      await apiRequest("admin/hr/access-roles", "POST", {
        id: record?.id || null, role_key: values.get("role_key"),
        name: values.get("name"), description: values.get("description"),
        is_active: values.get("is_active") === "on"
      });
      await loadHrManagement();
    });
}

function openHrRolePermissionsDialog(role) {
  const permissions = (hrManagementData.permissions || []).filter(({ permission_key }) =>
    /^(hr|organization\.workflows)\./.test(permission_key)
    || permission_key === "organization.audit.read"
  );
  const current = new Map((role.permissions || []).map((item) => [item.permission_key, item.scope]));
  openFormDialog("Configure HR permission role",
    "Grant only HR and shared HR workflow capabilities. Newsroom responsibilities and permissions are configured together under Newsroom roles.",
    (form) => {
      permissions.forEach((permission) => {
        const row = makeElement("div", "admin-hr-permission-row");
        const label = makeElement("label", "admin-form-checkbox");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.name = `permission:${permission.permission_key}`;
        checkbox.checked = current.has(permission.permission_key);
        label.append(checkbox, makeElement("span", "", `${permission.area} · ${permission.permission_key}`));
        row.append(label, makeElement("small", "", permission.description));
        const scope = document.createElement("select");
        scope.name = `scope:${permission.permission_key}`;
        const scopes = ["hr.console.access", "hr.configuration.manage", "hr.policy.manage"]
          .includes(permission.permission_key)
          ? ["all"]
          : ["all", "department", "assigned", "own"];
        scopes.forEach((value) => {
          const option = new Option(value, value);
          option.selected = value === (current.get(permission.permission_key) || "own");
          scope.append(option);
        });
        row.append(scope);
        form.append(row);
      });
    },
    async (values) => {
      const grants = permissions.flatMap((permission) => values.has(`permission:${permission.permission_key}`)
        ? [{ permission_key: permission.permission_key, scope: values.get(`scope:${permission.permission_key}`) }]
        : []);
      await apiRequest(`admin/hr/access-roles/${role.id}/permissions`, "PUT", { permissions: grants });
      await loadHrManagement();
    },
    "Save permissions");
}

function openHrAssignmentDialog(record, ending = false) {
  const accounts = hrManagementData.accounts || [];
  const employees = hrManagementData.employees || [];
  const departments = (hrManagementData.departments || []).filter((item) => item.is_active);
  const positions = (hrManagementData.positions || []).filter((item) => item.is_active);
  const roles = hrEmployeePermissionRoles().filter((item) => item.is_active);
  openFormDialog(ending ? "End employee assignment" : record ? "Change employee assignment" : "Assign employee",
    ending ? "Ending access preserves the assignment and all audit history."
      : record
        ? "This creates a new effective-dated assignment and ends the previous one, preserving the assignment history."
        : "Assign an employee account to a department, position, manager, and HR permission role. Access activates only after required policy acceptance.",
    (form) => {
      addHrSelect(form, "Employee account", "employee_id",
        accounts.map((item) => ({ value: item.id, label: `${item.full_name || item.email} · ${item.email || item.role}` })),
        record?.employee_id, null, !record);
      if (record) {
        const value = accounts.find((item) => item.id === record.employee_id);
        const note = makeElement("p", "admin-dialog-help", `${value?.full_name || value?.email || record.employee_id} · ${record.employee_number}`);
        form.append(note);
      }
      addHrSelect(form, "Employment type", "employment_type", [
        { value: "full_time", label: "Full-time" },
        { value: "part_time", label: "Part-time" },
        { value: "fixed_term", label: "Fixed-term" },
        { value: "temporary", label: "Temporary" },
        { value: "intern", label: "Intern" },
        { value: "other", label: "Other" }
      ], record?.employment_type || null, record ? null : "Choose employment type");
      addHrSelect(form, "Department", "department_id",
        departments.map((item) => ({ value: item.id, label: item.name })),
        record?.department_id, "No department", false);
      addHrSelect(form, "Position", "position_id",
        positions.map((item) => ({ value: item.id, label: item.title })),
        record?.position_id, "No position", false);
      addHrSelect(form, "HR permission role", "access_role_id",
        roles.map((item) => ({ value: item.id, label: item.name })),
        record?.access_role_id, null);
      addHrSelect(form, "Manager", "manager_employee_id",
        employees.filter((item) => item.id !== record?.employee_id)
          .map((item) => ({ value: item.id, label: `${item.full_name || item.email} · ${item.employee_number}` })),
        record?.manager_employee_id, "No manager", false);
      addHrSelect(form, "Assignment status", "status",
        (ending ? ["ended"] : record ? ["pending", "active", "suspended"] : ["pending", "active", "suspended"])
          .map((item) => ({ value: item, label: item })),
        ending ? "ended" : record?.status || "pending", null);
      const today = dateInputValue();
      const start = today;
      const dateField = addField(form, ending ? "End date" : record ? "Effective date" : "Start date",
        "starts_at", "date", start, { required: Boolean(record) });
      if (record) dateField.max = today;
      if (ending || record?.status === "ended") {
        addField(form, "Reason for ending", "end_reason", "text", record?.end_reason || "", { minLength: 2, maxLength: 1000 });
      }
      const primary = makeElement("label", "admin-form-checkbox");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "is_primary";
      checkbox.checked = record?.is_primary !== false;
      primary.append(checkbox, makeElement("span", "", "Primary assignment"));
      form.append(primary);
      if (ending) form.elements.status.disabled = true;
      if (record) {
        form.elements.employee_id.disabled = true;
      }
    },
    async (values) => {
      const date = values.get("starts_at");
      const payload = {
        employee_id: record?.employee_id || values.get("employee_id"),
        employment_type: values.get("employment_type"),
        department_id: values.get("department_id") || null,
        position_id: values.get("position_id") || null,
        access_role_id: values.get("access_role_id"),
        manager_employee_id: values.get("manager_employee_id") || null,
        status: ending ? "ended" : values.get("status"),
        is_primary: values.get("is_primary") === "on",
        starts_at: date ? new Date(`${date}T00:00:00`).toISOString()
          : record?.starts_at || (ending ? new Date().toISOString() : null),
        end_reason: values.get("end_reason") || ""
      };
      if (record && ending) {
        await apiRequest(`admin/hr/assignments/${record.id}/end`, "POST", {
          ends_at: payload.starts_at,
          end_reason: payload.end_reason
        });
      } else if (record) {
        await apiRequest(`admin/hr/assignments/${record.id}/change`, "POST", payload);
      } else {
        await apiRequest("admin/hr/assignments", "POST", { ...payload, id: record?.id || null });
      }
      await loadHrManagement();
    },
    ending ? "End assignment" : "Save assignment");
}

function openHrInvitationDialog() {
  const departments = (hrManagementData.departments || []).filter((item) => item.is_active);
  const positions = (hrManagementData.positions || []).filter((item) => item.is_active);
  const roles = hrEmployeePermissionRoles().filter((item) => item.is_active);
  openFormDialog("Invite an employee",
    "Send a secure email invitation and create a pending employment record. The employee completes their profile and accepts current required policies before access is activated.",
    (form) => {
      addField(form, "Email address", "email", "email", "", { maxLength: 254 });
      addHrSelect(form, "Employment type", "employment_type", [
        { value: "full_time", label: "Full-time" },
        { value: "part_time", label: "Part-time" },
        { value: "fixed_term", label: "Fixed-term" },
        { value: "temporary", label: "Temporary" },
        { value: "intern", label: "Intern" },
        { value: "other", label: "Other" }
      ], null, "Choose employment type");
      addHrSelect(form, "Department", "department_id",
        departments.map((item) => ({ value: item.id, label: item.name })), "", "No department", false);
      addHrSelect(form, "Position", "position_id",
        positions.map((item) => ({ value: item.id, label: item.title })), "", "No position", false);
      addHrSelect(form, "HR permission role", "access_role_id",
        roles.map((item) => ({ value: item.id, label: item.name })), "", null);
      addHrSelect(form, "Manager", "manager_employee_id",
        (hrManagementData.employees || []).map((item) => ({
          value: item.id, label: `${item.full_name || item.email} · ${item.employee_number}`
        })), "", "No manager", false);
    },
    async (values) => {
      await apiRequest("admin/hr/invitations", "POST", {
        email: values.get("email"),
        department_id: values.get("department_id") || null,
        position_id: values.get("position_id") || null,
        access_role_id: values.get("access_role_id"),
        manager_employee_id: values.get("manager_employee_id") || null,
        employment_type: values.get("employment_type")
      });
      await loadHrManagement();
    },
    "Send employee invitation");
}

function openHrPolicyDialog(policy) {
  openFormDialog(policy ? "Edit HR policy" : "Add HR policy",
    "Create a versioned organization policy. Active required policies must have a published version before employee activation.",
    (form) => {
      const title = addField(form, "Policy title", "title", "text", policy?.title, { minLength: 2, maxLength: 160 });
      addHrKeyField(form, "Policy key", "policy_key", policy?.policy_key, title);
      addHrTextArea(form, "Description", "description", policy?.description, 2000);
      addHrSelect(form, "Applies to department", "department_id",
        (hrManagementData.departments || []).filter((item) => item.is_active)
          .map((item) => ({ value: item.id, label: item.name })),
        policy?.department_id, "All departments", false);
      addHrSelect(form, "Applies to HR permission role", "access_role_id",
        hrEmployeePermissionRoles().filter((item) => item.is_active)
          .map((item) => ({ value: item.id, label: item.name })),
        policy?.access_role_id, "All permission roles", false);
      const required = makeElement("label", "admin-form-checkbox");
      const requiredBox = document.createElement("input");
      requiredBox.type = "checkbox";
      requiredBox.name = "requires_acceptance";
      requiredBox.checked = policy?.requires_acceptance !== false;
      required.append(requiredBox, makeElement("span", "", "Require employee acceptance"));
      form.append(required);
      addHrActiveField(form, policy?.is_active);
    },
    async (values) => {
      await apiRequest("admin/hr/policies", "POST", {
        id: policy?.id || null, policy_key: values.get("policy_key"),
        title: values.get("title"), description: values.get("description"),
        department_id: values.get("department_id") || null,
        access_role_id: values.get("access_role_id") || null,
        requires_acceptance: values.get("requires_acceptance") === "on",
        is_active: values.get("is_active") === "on"
      });
      await loadHrManagement();
    });
}

function openHrPolicyVersionDialog(policy, version) {
  openFormDialog(version ? "Edit policy draft" : "Create policy draft",
    "Published versions cannot be edited or deleted. Create a new version when wording changes.",
    (form) => {
      addField(form, "Version label", "version", "text", version?.version || "", { maxLength: 40 });
      addHrTextArea(form, "Policy wording", "content", version?.content, 100000, true);
    },
    async (values) => {
      await apiRequest(`admin/hr/policies/${policy.id}/versions`, "POST", {
        id: version?.id || null, version: values.get("version"), content: values.get("content")
      });
      await loadHrManagement();
    },
    version ? "Save draft" : "Create draft");
}

async function publishHrPolicyVersion(id) {
  if (!await confirmAdminAction("Publish policy version?",
    "This makes the exact version effective and retires the prior one. Active employees in scope lose organization access until they accept this version.",
    "Publish", false)) return;
  try {
    await apiRequest(`admin/hr/policy-versions/${id}/publish`, "POST", {});
    await loadHrManagement();
    void showAdminMessage("Policy published", "The version is now current.");
  } catch (error) {
    void showAdminMessage("Policy publish failed", error.message);
  }
}

async function deleteHrRecord(collection, id, title, explanation, refresh = loadHrManagement) {
  if (!await confirmAdminAction(title, explanation, "Delete permanently")) return;
  try {
    await apiRequest(`admin/hr/${collection}/${id}`, "DELETE");
    await refresh();
  } catch (error) {
    void showAdminMessage("Record was not deleted", error.message);
  }
}

async function openStaffRoleDialog(role = null, refresh = () => loadSection("staff-roles")) {
  const isEditing = Boolean(role);
  let permissionCatalog;
  try {
    permissionCatalog = unwrapData(await apiRequest("admin/staff-role-permissions")) || [];
  } catch (error) {
    void showAdminMessage("Newsroom permissions could not be loaded", error.message);
    return;
  }
  const currentPermissions = new Map(
    (Array.isArray(role?.permissions) ? role.permissions : [])
      .map((permission) => [permission.permission_key, permission.scope])
  );
  openFormDialog(
    isEditing ? "Edit newsroom role" : "Create newsroom role",
    "Set the role's title, responsibilities, and system permissions together. Assign this single newsroom role to staff.",
    (form) => {
      const nameInput = addField(form, "Role title", "display_name", "text", role?.display_name || "", {
        minLength: 2,
        maxLength: 80
      });
      nameInput.autocomplete = "off";
      const keyLabel = makeElement("label", "admin-form-field");
      keyLabel.append(makeElement("span", "", "Internal role key (lowercase English letters, numbers, underscores)"));
      const keyInput = document.createElement("input");
      keyInput.type = "text";
      keyInput.name = "role_key";
      keyInput.maxLength = 50;
      keyInput.value = role?.role_key || "";
      keyInput.readOnly = Boolean(role);
      keyLabel.append(keyInput);
      form.append(keyLabel);
      if (!isEditing) {
        nameInput.addEventListener("input", () => {
          keyInput.value = nameInput.value.trim().toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^[^a-z]+/, "")
            .replace(/_+$/g, "")
            .slice(0, 50);
        });
      }
      addField(form, "Short description (optional)", "description", "text", role?.description || "", {
        required: false,
        maxLength: 500
      });
      const dutiesLabel = makeElement("label", "admin-form-field");
      dutiesLabel.append(makeElement("span", "", "Responsibilities"));
      const duties = document.createElement("textarea");
      duties.name = "duties";
      duties.rows = 4;
      duties.maxLength = 5000;
      duties.value = role?.duties || "";
      dutiesLabel.append(duties);
      form.append(dutiesLabel);

      form.append(makeElement("h3", "admin-form-section-heading", "System permissions"));
      form.append(makeElement(
        "p",
        "admin-dialog-help",
        "Grant only what this role needs. Reporter application review is limited further by a separate location scope assigned by a reporter or people manager."
      ));
      permissionCatalog.forEach((permission) => {
        const row = makeElement("div", "admin-hr-permission-row");
        const label = makeElement("label", "admin-form-checkbox");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.name = `permission:${permission.permission_key}`;
        checkbox.checked = currentPermissions.has(permission.permission_key);
        label.append(
          checkbox,
          makeElement("span", "", `${permission.area} · ${permission.permission_key}`)
        );
        row.append(label, makeElement("small", "", permission.description));
        const scope = document.createElement("select");
        scope.name = `scope:${permission.permission_key}`;
        const fixedScope = [
          "newsroom.articles.publish",
          "newsroom.articles.delete",
          "newsroom.categories.manage",
          "newsroom.comments.moderate",
          "newsroom.reports.manage",
          "newsroom.media.manage",
          "newsroom.locations.manage",
          "newsroom.people.manage",
          "reporters.manage",
          "reporters.applications.review"
        ].includes(permission.permission_key);
        const scopes = fixedScope ? ["all"] : ["all", "assigned", "own"];
        scopes.forEach((value) => {
          const option = new Option(value, value);
          option.selected = value === (
            fixedScope ? "all" : currentPermissions.get(permission.permission_key) || "own"
          );
          scope.append(option);
        });
        scope.disabled = fixedScope;
        row.append(scope);
        form.append(row);
      });

      const activeLabel = makeElement("label", "admin-form-field");
      activeLabel.append(makeElement("span", "", "Available for new invitations"));
      const active = document.createElement("input");
      active.type = "checkbox";
      active.name = "is_active";
      active.checked = role?.is_active !== false;
      active.disabled = Boolean(role?.is_builtin);
      activeLabel.append(active);
      form.append(activeLabel);
    },
    async (values) => {
      const name = String(values.get("display_name") || "").trim();
      const roleKey = String(values.get("role_key") || "").trim();
      if (!/^[a-z][a-z0-9_]{1,49}$/.test(roleKey)) {
        throw new Error("Enter a role name that generates a valid internal key.");
      }
      await apiRequest("admin/staff-roles", "POST", {
        id: role?.id || null,
        role_key: roleKey,
        display_name: name,
        description: values.get("description"),
        duties: values.get("duties"),
        permissions: permissionCatalog.flatMap((permission) =>
          values.has(`permission:${permission.permission_key}`)
            ? [{
              permission_key: permission.permission_key,
              scope: values.get(`scope:${permission.permission_key}`)
            }]
            : []
        ),
        is_active: role?.is_builtin ? true : values.get("is_active") === "on"
      });
      await refresh();
    },
    isEditing ? "Save newsroom role" : "Create newsroom role"
  );
}

async function openStaffNewsroomRoleDialog(user, refresh) {
  let roles;
  try {
    roles = unwrapData(await apiRequest("admin/staff-roles")) || [];
  } catch (error) {
    void showAdminMessage("Newsroom roles could not be loaded", error.message);
    return;
  }
  roles = roles.filter((role) =>
    role.is_active
    && role.access_profile === user.access_profile
    && role.id !== user.staff_role_id
  );
  if (!roles.length) {
    void showAdminMessage(
      "No other active newsroom roles are available",
      "Create or activate a role in this staff member's current onboarding workflow, or use a new invitation to change workflows."
    );
    return;
  }
  openFormDialog(
    "Change staff newsroom role",
    user._pending_role_change?.role
      ? `A change to ${user._pending_role_change.role.display_name} is already waiting for acceptance. Choosing another role replaces that request. The current role and permissions stay active until acceptance.`
      : "The staff member keeps the current role and permissions until they review and accept the agreement for the new role. Acceptance then switches the role and records the assignment history.",
    (form) => {
      form.append(makeElement("p", "admin-dialog-help", user.full_name || user.email || "Staff member"));
      const label = makeElement("label", "admin-form-field");
      label.append(makeElement("span", "", "New newsroom role"));
      const select = document.createElement("select");
      select.name = "staff_role_id";
      select.required = true;
      roles.forEach((role) => {
        const option = makeElement("option", "", role.display_name);
        option.value = role.id;
        option.selected = role.id === (user._pending_role_change?.target_staff_role_id || user.staff_role_id);
        select.append(option);
      });
      label.append(select);
      form.append(label);
    },
    async (values) => {
      await apiRequest(`admin/staff-onboarding/${user.id}/job-role`, "POST", {
        staff_role_id: values.get("staff_role_id")
      });
      await refresh();
    },
    "Save newsroom role"
  );
}

function openStaffRoleHistoryDialog(user) {
  const history = Array.isArray(user._role_assignment_history) ? user._role_assignment_history : [];
  const dialog = document.createElement("dialog");
  dialog.className = "admin-json-dialog";
  const body = makeElement("section", "admin-json-form");
  body.append(
    makeElement("span", "admin-eyebrow", "STAFF ASSIGNMENT HISTORY"),
    makeElement("h2", "", user.full_name || user.email || "Staff member"),
    makeElement("p", "admin-dialog-help", user.email || "Email unavailable")
  );
  if (!history.length) {
    body.append(makeElement("p", "admin-empty", "No assignment history is available."));
  } else {
    const list = document.createElement("ol");
    list.className = "admin-staff-role-history";
    history.forEach((assignment) => {
      const item = document.createElement("li");
      item.append(
        makeElement("strong", "", assignment.display_name_snapshot),
        makeElement("span", "", `${assignment.status.replaceAll("_", " ")} · assigned ${formatDate(assignment.assigned_at)}`)
      );
      if (assignment.starts_at) {
        item.append(makeElement("span", "", `Effective from ${formatDate(assignment.starts_at)}`));
      }
      if (assignment.ended_at) {
        item.append(makeElement("span", "", `Ended ${formatDate(assignment.ended_at)}${assignment.end_reason ? ` · ${assignment.end_reason}` : ""}`));
      }
      if (assignment.duties_snapshot) item.append(makeElement("p", "", assignment.duties_snapshot));
      list.append(item);
    });
    body.append(list);
  }
  const actions = makeElement("div", "admin-dialog-actions");
  const close = makeElement("button", "admin-secondary-button", "Close");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  actions.append(close);
  body.append(actions);
  dialog.append(body);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

function openStaffReviewDialog(record, refresh) {
  const profile = record.profile || {};
  const dialog = document.createElement("dialog");
  dialog.className = "admin-json-dialog admin-staff-review-dialog";
  const body = makeElement("section", "admin-json-form");
  body.append(
    makeElement("span", "admin-eyebrow", `${String(record.staff_role?.display_name || "Newsroom staff").toUpperCase()} CANDIDATE`),
    makeElement("h2", "", profile.full_name || "Staff profile review"),
    makeElement("p", "admin-dialog-help", `${profile.email || "Email unavailable"} · ${profile.phone || "Phone unavailable"}`)
  );
  const profileLayout = makeElement("div", "admin-staff-review-layout");
  if (record.profile_photo_url) {
    const photo = document.createElement("img");
    photo.className = "admin-staff-profile-photo";
    photo.src = record.profile_photo_url;
    photo.alt = `Profile photo for ${profile.full_name || "staff candidate"}`;
    photo.loading = "lazy";
    profileLayout.append(photo);
  }
  const details = makeElement("dl", "admin-staff-profile-details");
  [
    ["Date of birth", record.date_of_birth ? formatDate(record.date_of_birth) : "Not provided"],
    ["Emergency contact", record.emergency_contact_name],
    ["Relationship", record.emergency_contact_relationship],
    ["Emergency phone", record.emergency_contact_phone],
    ["Address", [
      record.permanent_address_line1,
      record.permanent_address_line2,
      record.permanent_address_city,
      record.permanent_address_district,
      record.permanent_address_state,
      record.permanent_address_postal_code
    ].filter(Boolean).join(", ")],
    ["Preferred language", record.preferred_language || "Not provided"],
    ["Experience", record.experience_years == null ? "Not provided" : `${record.experience_years} years`],
    ["Experience summary", record.experience_summary || "Not provided"]
  ].forEach(([label, value]) => {
    details.append(makeElement("dt", "", label), makeElement("dd", "", value || "—"));
  });
  profileLayout.append(details);
  body.append(profileLayout);
  if (record.status === "changes_requested" && record.review_note) {
    body.append(makeElement("p", "admin-staff-review-note", `Previous note: ${record.review_note}`));
  }
  const reviewNote = document.createElement("textarea");
  reviewNote.className = "admin-staff-review-input";
  reviewNote.name = "review_message";
  reviewNote.maxLength = 1000;
  reviewNote.rows = 3;
  reviewNote.placeholder = "Add a clear reason when requesting changes or rejecting.";
  body.append(reviewNote);
  const feedback = makeElement("p", "admin-staff-review-feedback");
  feedback.setAttribute("role", "alert");
  feedback.hidden = true;
  body.append(feedback);
  const actions = makeElement("div", "admin-dialog-actions admin-staff-review-actions");
  const close = makeElement("button", "admin-secondary-button", "Close");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  actions.append(close);
  [
    ["Request changes", "request_changes", "admin-secondary-button"],
    ["Reject", "reject", "admin-row-button danger"],
    ["Approve profile", "approve", "admin-primary-button"]
  ].forEach(([label, decision, style]) => {
    const button = makeElement("button", style, label);
    button.type = "button";
    button.addEventListener("click", async () => {
      const note = reviewNote.value.trim();
      if (decision !== "approve" && note.length < 5) {
        feedback.textContent = "Add at least five characters explaining this decision.";
        feedback.hidden = false;
        reviewNote.focus();
        return;
      }
      feedback.hidden = true;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        const reviewResult = await apiRequest(`admin/staff-onboarding/${record.user_id}/review`, "POST", {
          decision,
          review_message: note
        });
        dialog.close();
        await refresh();
        void showAdminMessage(
          decision === "approve" && reviewResult.status === "active" ? "Staff member activated"
            : decision === "approve" ? "Profile approved"
            : decision === "request_changes" ? "Profile changes requested" : "Staff invitation rejected",
          decision === "approve" && reviewResult.status === "active"
            ? `${profile.full_name || profile.email} can now sign in with the assigned newsroom role.`
            : decision === "approve"
              ? "The profile is approved. The invitee must accept the currently published agreement before role access is activated."
            : "The decision and review note were saved."
        );
      } catch (error) {
        feedback.textContent = error instanceof Error ? error.message : "The review could not be saved.";
        feedback.hidden = false;
      } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    });
    actions.append(button);
  });
  body.append(actions);
  dialog.append(body);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

function buildTable(rows, section) {
  if (!rows.length) {
    const message = section === "reporter-credentials"
      ? "No credentials have been issued yet. Issued ID cards and authority letters will appear here."
      : "No records are available.";
    return makeElement("p", "admin-empty", message);
  }

  const excluded = new Set(["content", "body", "password", "token", "credentials"]);
  if (section === "users" || section === "accounts") excluded.add("requested_role");
  const internalColumns = new Set(["id", "user_id", "application_id", "credential_id"]);
  const preferredColumns = section === "locations"
    ? ["hierarchy", "location_type", "state_code", "rto_code", "parent_location", "is_active"]
    : section === "users" || section === "accounts"
    ? ["full_name", "email", "phone", "role", "requested_role", "staff_status", "created_at"]
    : section === "reporter-applications"
      ? ["applicant_name", "email", "state_name", "city", "area_coverage", "status", "details_confirmed"]
      : section === "reporter-credentials"
        ? ["name", "role", "type", "reference", "status", "scope", "valid_until"]
        : section === "reporter-directory"
          ? ["full_name", "email", "reporter_code", "current_assignment", "assignment_history"]
          : section === "workflow-directory"
            ? ["full_name", "email", "phone", "role", "status", "active_since", "location"]
          : [];
  const keys = [...new Set([
    ...preferredColumns.filter((key) => rows.some((row) => Object.hasOwn(row, key))),
    ...rows.flatMap((row) => Object.keys(row))
  ])]
    .filter((key) => !key.startsWith("_") && !excluded.has(key) && !internalColumns.has(key) && key !== "document_url")
    .slice(0, section === "locations" || section === "reporter-applications" || section === "reporter-credentials" ? 7 : section === "reporter-coverage" || section === "reporter-directory" || section === "workflow-directory" ? 7 : 5);
  const wrapper = makeElement("div", "admin-table-wrap");
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  keys.forEach((key) => headerRow.append(makeElement("th", "", key.replaceAll("_", " "))));
  headerRow.append(makeElement("th", "", "Actions"));
  head.append(headerRow);
  table.append(head);

  const body = document.createElement("tbody");
  rows.forEach((row) => {
    const rowElement = document.createElement("tr");
    keys.forEach((key) => {
      const value = row[key];
      const displayValue = (section === "users" || section === "accounts")
        && key === "role" && ["moderator", "editor"].includes(value)
        ? "Newsroom staff"
        : value;
      const cell = makeElement("td", key === "title" || key === "name" ? "article-title-cell" : "", formatCell(displayValue));
      rowElement.append(cell);
    });
    const actions = makeElement("td", "admin-row-actions");
    addRowActions(actions, row, section);
    rowElement.append(actions);
    body.append(rowElement);
  });
  table.append(body);
  wrapper.append(table);
  return wrapper;
}

function rowButton(container, label, handler, style = "admin-row-button") {
  const button = makeElement("button", style, label);
  button.type = "button";
  button.addEventListener("click", handler);
  container.append(button);
}

function confirmAdminAction(title, message, confirmLabel = "Delete", destructive = true) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "admin-json-dialog admin-confirm-dialog";
    const body = makeElement("section", "admin-json-form admin-confirm-content");
    body.append(
      makeElement("span", "admin-eyebrow", "CONFIRM ACTION"),
      makeElement("h2", "", title),
      makeElement("p", "admin-dialog-help", message)
    );
    const actions = makeElement("div", "admin-dialog-actions");
    const cancel = makeElement("button", "admin-secondary-button", "Cancel");
    cancel.type = "button";
    cancel.autofocus = true;
    cancel.addEventListener("click", () => dialog.close("cancel"));
    const confirm = makeElement(
      "button",
      destructive ? "admin-primary-button admin-confirm-danger" : "admin-primary-button",
      confirmLabel
    );
    confirm.type = "button";
    confirm.addEventListener("click", () => dialog.close("confirm"));
    actions.append(cancel, confirm);
    body.append(actions);
    dialog.append(body);
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(dialog.returnValue === "confirm");
    }, { once: true });
    dialog.showModal();
  });
}

function showAdminMessage(title, message) {
  const kind = /fail|error|could not|unavailable|not saved/i.test(title)
    ? "error"
    : /warning|no active|no eligible|window blocked|preview unavailable|mapping unavailable/i.test(title)
      ? "warning"
      : /saved|published|completed|success|created|updated|issued|sent|acknowledged|exported/i.test(title)
        ? "success"
        : "info";
  if (window.ChowkInlineFeedback?.show(kind, `${title}: ${message}`)) return;
  const dialog = document.createElement("dialog");
  dialog.className = "admin-json-dialog admin-message-dialog";
  const body = makeElement("section", "admin-json-form admin-confirm-content");
  body.append(
    makeElement("span", "admin-eyebrow", "CHOWK ADMIN"),
    makeElement("h2", "", title),
    makeElement("p", "admin-dialog-help", message)
  );
  const actions = makeElement("div", "admin-dialog-actions");
  const close = makeElement("button", "admin-primary-button", "Close");
  close.type = "button";
  close.autofocus = true;
  close.addEventListener("click", () => dialog.close());
  actions.append(close);
  body.append(actions);
  dialog.append(body);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

function recordId(row) {
  const id = String(row.id ?? row.application_id ?? row.credential_id ?? row.user_id ?? "");
  return /^[1-9]\d*$/.test(id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : "";
}

function addRowActions(container, row, section) {
  const id = recordId(row);
  if (!id) return;
  const refresh = () => loadSection(section === "workflow-directory" ? "directory" : section);

  if (section === "users" || section === "accounts") {
    if (row.role === "super_admin") {
      container.append(makeElement("span", "admin-dialog-help", "Single super-admin account"));
    } else if (["moderator", "editor"].includes(row.role)) {
      container.append(makeElement(
        "span",
        "admin-dialog-help",
        "Manage responsibilities and permissions in Newsroom roles."
      ));
    } else {
      const role = document.createElement("select");
      role.className = "admin-role-select";
      role.setAttribute("aria-label", `Role for ${row.name || id}`);
      const roles = ["subscriber", "reporter", "publisher", "admin"];
      if (["moderator", "editor"].includes(row.role)) roles.push(row.role);
      roles.filter((value) => value !== "reporter" || row.role === "reporter").forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value.replace("_", " ");
        option.selected = value === row.role;
        role.append(option);
      });
      role.addEventListener("change", async () => {
        if (role.value === "reporter" && row.role !== "reporter") {
          role.value = row.role;
          void showAdminMessage("Reporter access unavailable", "Reporter access is granted only after the applicant completes the reporter onboarding steps.");
          return;
        }

        try {
          await apiRequest(`admin/users/${id}/role`, "PATCH", { role: role.value });
          await refresh();
        } catch (error) {
          void showAdminMessage("Role update failed", error.message);
          await refresh();
        }
      });
      container.append(role);
    }
    if (sessionIdentity?.role === "super_admin"
        && row.role !== "super_admin"
        && String(row.id).toLowerCase() !== sessionIdentity?.id?.toLowerCase()) {
      rowButton(container, "Delete user", () => {
        const displayName = row.full_name && row.full_name !== "—"
          ? row.full_name
          : row.email || id;
        void confirmAdminAction(
          "Permanently delete user account?",
          `Permanently delete ${displayName}'s Supabase login and Chowk profile? HR and reporter account records, private application files, staff photos, and custom organization records owned by this account will be removed. Shared articles and comments remain without the account link where supported; audit/security history is retained. The single super-admin account and your own account cannot be deleted. This cannot be undone.`
        ).then((confirmed) => {
          if (!confirmed) return;
          void runAction(() => apiRequest(`admin/users/${id}`, "DELETE"), refresh);
        });
      }, "admin-row-button danger");
    }
    return;
  }

  if (section === "reporter-directory") {
    rowButton(container, "Change designation", () => {
      void openReporterDesignationDialog(row, refresh);
    });
    rowButton(container, "Update assignment", () => {
      void openReporterAssignmentDialog(row, refresh);
    });
    return;
  }

  if (section === "workflow-directory") {
    if (["admin", "super_admin"].includes(sessionIdentity?.role)) {
      rowButton(container, "Change newsroom role", () => {
        void openStaffNewsroomRoleDialog(row, refresh);
      });
    }
    rowButton(container, "View assignment history", () => openStaffRoleHistoryDialog(row));
    return;
  }

  if (section === "articles") {
    const workflowStatus = row.workflow_status || row.status;
    if (!["published", "rejected", "withdrawn", "archived"].includes(workflowStatus)
        || workflowStatus === "scheduled") {
      rowButton(container, "Publish", () => {
        const reason = window.prompt("Reason for this admin publication override");
        if (!reason || reason.trim().length < 2) return;
        void runAction(() => apiRequest(`admin/articles/${id}/publish`, "POST", { reason }), refresh);
      });
    }
    if (row.workflow_status === "rejected") {
      rowButton(container, "Return to review", () => {
        const note = window.prompt("Reason for returning this rejected story to review");
        if (!note || note.trim().length < 2) return;
        void runAction(() => apiRequest(`admin/articles/${id}/transition`, "POST", {
          action: "reopen_rejected",
          note: note.trim()
        }), refresh);
      });
    }
    rowButton(container, "Edit", () => openConfiguredRecordDialog(section, row));
    rowButton(container, "Delete", () => {
      void confirmAdminAction(
        "Delete article?",
        `Delete "${row.title || id}"? This cannot be undone.`
      ).then((confirmed) => {
        if (!confirmed) return;
        void runAction(() => apiRequest(`admin/articles/${id}`, "DELETE"), refresh);
      });
    }, "admin-row-button danger");
    return;
  }

  if (section === "categories") {
    const route = `admin/categories/${id}`;
    rowButton(container, "Edit", () => openConfiguredRecordDialog(section, row));
    rowButton(container, "Delete", () => {
      void confirmAdminAction(
        `Delete ${singular(sectionLabels[section]).toLowerCase()}?`,
        "This action cannot be undone."
      ).then((confirmed) => {
        if (!confirmed) return;
        void runAction(() => apiRequest(route, "DELETE"), refresh);
      });
    }, "admin-row-button danger");
    return;
  }

  if (section === "locations" && row._source_type === "city") {
    rowButton(container, "Edit", () => openConfiguredRecordDialog(section, row));
    return;
  }

  if (section === "locations" && row._district_range_mapping) {
    if (row._active) {
      rowButton(container, "End mapping", () => {
        if (window.confirm("End this district/range mapping now? Its history will be retained.")) {
          void runAction(() => apiRequest(`admin/district-range-mappings/${id}/end`, "POST", {}), refresh);
        }
      }, "admin-row-button danger");
    }
    return;
  }

  if (["locations", "live-streams", "media"].includes(section)) {
    rowButton(container, "Edit", () => openConfiguredRecordDialog(section, row));
    rowButton(container, "Delete", () => {
      void confirmAdminAction(
        "Delete this record?",
        `Delete "${row.title || row.name || row.id}"? This action cannot be undone.`
      ).then((confirmed) => {
        if (!confirmed) return;
        void runAction(() => apiRequest(`admin/${section}/${id}`, "DELETE"), refresh);
      });
    }, "admin-row-button danger");
    return;
  }

  if (section === "comments") {
    if (!row.is_approved) {
      rowButton(container, "Approve", () =>
        void runAction(() => apiRequest(`admin/comments/${id}`, "PATCH", { is_approved: true }), refresh)
      );
    }
    rowButton(container, "Delete", () => {
      void confirmAdminAction(
        "Delete this comment?",
        "The comment will be permanently removed. This action cannot be undone."
      ).then((confirmed) => {
        if (!confirmed) return;
        void runAction(() => apiRequest(`admin/comments/${id}`, "DELETE"), refresh);
      });
    }, "admin-row-button danger");
    return;
  }

  if (section === "reports") {
    if (row.status === "open") {
      rowButton(container, "Resolve", () =>
        void runAction(() => apiRequest(`admin/reports/${id}`, "PATCH", { status: "resolved" }), refresh)
      );
      rowButton(container, "Dismiss", () =>
        void runAction(() => apiRequest(`admin/reports/${id}`, "PATCH", { status: "dismissed" }), refresh),
        "admin-row-button danger"
      );
    }
    return;
  }

  if (section === "reporter-applications") {
    rowButton(container, "Private details", () => void openReporterPrivateDetailsDialog(row));
    if (["pending", "needs_information"].includes(row.status)) {
      rowButton(container, "Review", () => openReporterReviewDialog(row, refresh));
    }
    if (["admin", "super_admin"].includes(sessionIdentity?.role)
        || sessionPermissions.includes("reporters.manage")) rowButton(container, "Delete application", () => {
      const applicant = row.applicant_name && row.applicant_name !== "—"
        ? row.applicant_name
        : row.email || `application #${id}`;
      const approved = ["approved", "active"].includes(row.status);
      const consequences = approved
        ? " This also revokes the reporter's credentials, ends active assignments, removes the reporter profile, and returns the account to subscriber access. Credential and assignment history is retained."
        : " The account itself will remain unchanged.";
      void confirmAdminAction(
        "Delete reporter application?",
        `Permanently delete ${applicant}'s ${row.status.replace("_", " ")} application and its private documents?${consequences} This action cannot be undone.`
      ).then((confirmed) => {
        if (!confirmed) return;
        void runAction(() => apiRequest(`admin/reporter-applications/${id}`, "DELETE"), refresh);
      });
    }, "admin-row-button danger");
    return;
  }

  if (section === "reporter-coverage" && row._active) {
    rowButton(container, "End coverage", () => {
      if (window.confirm("End this coverage assignment now? Its history will be retained.")) {
        void runAction(() => apiRequest(`admin/reporter-coverage/${id}/end`, "POST", {}), refresh);
      }
    }, "admin-row-button danger");
    return;
  }

  if (section === "reporter-credentials"
      && ["active", "pending_acceptance"].includes(row._stored_status)) {
    rowButton(container, "Print / QR", () => {
      const printWindow = window.open(
        proxyUrl(`admin/reporter-credentials/${id}/print`),
        "_blank"
      );
      if (!printWindow) void showAdminMessage("Print window blocked", "Allow pop-ups to open the printable credential.");
      else printWindow.opener = null;
    });
    rowButton(container, "Revoke", () => openCredentialRevokeDialog(id, refresh), "admin-row-button danger");
    return;
  }

  if (section === "reporter-designations") {
    rowButton(container, "Edit", () => openConfiguredRecordDialog(section, row));
    rowButton(container, row.is_active ? "Deactivate" : "Activate", () =>
      void runAction(() => apiRequest(`admin/reporter-designations/${id}`, "PATCH", { is_active: !row.is_active }), refresh)
    );
  }
}

function openConfiguredRecordDialog(section, existing) {
  const config = modules[section];
  if (!config?.formFields) return;
  const isEditing = Boolean(existing);
  openFormDialog(
    `${isEditing ? "Edit" : "Add"} ${singular(sectionLabels[section])}`,
    config.description,
    (form) => {
      config.formFields.forEach((field) => {
        const value = existing?.[field.name];
        if (section === "locations" && field.name === "state_code") {
          const locationTypeSelect = form.elements.location_type;
          const label = makeElement("label", "admin-form-field");
          label.append(makeElement("span", "", field.label));
          const input = document.createElement("input");
          input.name = field.name;
          input.type = "text";
          input.maxLength = field.maxLength;
          input.pattern = "[A-Za-z0-9]{2}";
          input.required = locationTypeSelect.value === "state";
          if (value !== null && value !== undefined) input.value = String(value);
          label.append(input);
          form.append(label);
          const refreshStateCodeField = () => {
            const isState = locationTypeSelect.value === "state";
            label.hidden = !isState;
            input.disabled = !isState;
            input.required = isState;
            if (!isState) input.value = "";
          };
          locationTypeSelect.addEventListener("change", refreshStateCodeField);
          refreshStateCodeField();
          return;
        }
        if (section === "locations" && field.name === "rto_code") {
          const locationTypeSelect = form.elements.location_type;
          const label = makeElement("label", "admin-form-field");
          label.append(makeElement("span", "", field.label));
          const input = document.createElement("input");
          input.name = field.name;
          input.type = "text";
          input.maxLength = field.maxLength;
          input.pattern = "[A-Za-z0-9]{2,8}";
          input.required = locationTypeSelect.value === "district";
          if (value !== null && value !== undefined) input.value = String(value);
          label.append(input);
          form.append(label);
          const refreshRtoField = () => {
            const isDistrict = locationTypeSelect.value === "district";
            label.hidden = !isDistrict;
            input.disabled = !isDistrict;
            input.required = isDistrict;
            if (!isDistrict) input.value = "";
          };
          locationTypeSelect.addEventListener("change", refreshRtoField);
          refreshRtoField();
          return;
        }
        if (section === "locations" && field.name === "parent_id") {
          const label = makeElement("label", "admin-form-field");
          label.append(makeElement("span", "", "Parent location"));
          const select = document.createElement("select");
          select.name = field.name;
          select.required = form.elements.location_type.value !== "state";
          populateLocationParents(select, form.elements.location_type.value, value, existing?.id);
          form.elements.location_type.addEventListener("change", () => {
            select.required = form.elements.location_type.value !== "state";
            populateLocationParents(select, form.elements.location_type.value, select.value, existing?.id);
          });
          label.append(select);
          form.append(label);
          return;
        }
        if (field.type === "icon-picker") {
          const label = makeElement("div", "admin-form-field admin-category-icon-field");
          label.append(makeElement("span", "", field.label));
          const selectedKey = window.ChowkCategoryIcons.has(value) ? value : "newspaper";
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = field.name;
          input.value = selectedKey;
          const picker = makeElement("div", "admin-category-icon-picker");
          picker.setAttribute("role", "group");
          picker.setAttribute("aria-label", field.label);
          window.ChowkCategoryIcons.icons.forEach((icon) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "admin-category-icon-option";
            button.setAttribute("aria-label", icon.label);
            button.setAttribute("aria-pressed", String(icon.key === selectedKey));
            button.title = icon.label;
            button.append(window.ChowkCategoryIcons.create(icon.key), makeElement("small", "", icon.label));
            button.addEventListener("click", () => {
              input.value = icon.key;
              picker.querySelectorAll(".admin-category-icon-option").forEach((option) => {
                option.setAttribute("aria-pressed", String(option === button));
              });
            });
            picker.append(button);
          });
          label.append(input, picker);
          form.append(label);
          return;
        }
        if (field.type === "checkbox") {
          const label = makeElement("label", "admin-form-checkbox");
          const input = document.createElement("input");
          input.type = "checkbox";
          input.name = field.name;
          input.checked = value === undefined ? true : Boolean(value);
          label.append(input, makeElement("span", "", field.label));
          form.append(label);
          return;
        }

        const label = makeElement("label", "admin-form-field");
        label.append(makeElement("span", "", field.label));
        const input = field.type === "textarea"
          ? document.createElement("textarea")
          : field.type === "select"
            ? document.createElement("select")
            : document.createElement("input");
        input.name = field.name;
        if (field.type !== "textarea" && field.type !== "select") input.type = field.type;
        input.required = field.required !== false;
        if (field.minLength) input.minLength = field.minLength;
        if (field.pattern) input.pattern = field.pattern;
        if (field.maxLength) input.maxLength = field.maxLength;
        if (field.type === "select") {
          const options = section === "locations"
            && field.name === "location_type"
            && existing?.location_type === "state"
            ? ["state"]
            : section === "locations"
            && field.name === "location_type"
            && existing?.location_type === "city"
            ? [...field.options, "city"]
            : field.options;
          options.forEach((optionValue, index) => {
            const option = makeElement("option", "", optionValue);
            option.value = optionValue;
            option.selected = value === optionValue || (value === undefined && index === 0);
            input.append(option);
          });
        } else if (value !== null && value !== undefined) {
          input.value = field.type === "datetime-local"
            ? String(value).slice(0, 16)
            : String(value);
        }
        label.append(input);
        form.append(label);
      });
    },
    async (formData) => {
      const payload = Object.fromEntries(formData.entries());
      if (section === "reporter-designations") {
        payload.is_active = form.elements.is_active.checked;
      }
      if (section === "articles" && isEditing) {
        const reason = window.prompt("Reason for this admin article edit (required for audit history)");
        if (!reason || reason.trim().length < 2) {
          throw new Error("A reason is required to record this admin edit.");
        }
        payload.change_reason = reason.trim();
      }
      config.formFields.forEach((field) => {
        if (field.type === "checkbox") payload[field.name] = formData.has(field.name);
        if (field.type === "number") {
          payload[field.name] = payload[field.name] ? Number(payload[field.name]) : null;
        }
        if (field.type === "datetime-local" && payload[field.name]) {
          payload[field.name] = new Date(payload[field.name]).toISOString();
        }
      });
      if (section === "locations") {
        payload.parent_id = payload.parent_id ? Number(payload.parent_id) : null;
        payload.state_code = payload.location_type === "state" && payload.state_code
          ? payload.state_code.trim().toUpperCase()
          : null;
        payload.rto_code = payload.location_type === "district" && payload.rto_code
          ? payload.rto_code.trim().toUpperCase()
          : null;
      }
      const path = isEditing ? `admin/${section}/${recordId(existing)}` : config.createPath;
      await apiRequest(path, isEditing ? "PATCH" : "POST", payload);
      await loadSection(section);
    },
    isEditing ? "Save changes" : `Create ${singular(sectionLabels[section])}`
  );
}

function populateLocationParents(select, childType, selected, excludedId) {
  select.replaceChildren(new Option(childType === "state" ? "No parent required" : "Choose a parent location", ""));
  const types = allowedLocationParents[childType] || [];
  locationRecords
    .filter((location) => String(location.id) !== String(excludedId)
      && (location.is_active || String(location.id) === String(selected))
      && types.includes(location.location_type))
    .forEach((location) => {
      const option = new Option(
        `${locationPath(location, new Map(locationRecords.map((item) => [String(item.id), item])))} · ${location.location_type}`,
        String(location.id)
      );
      option.selected = String(location.id) === String(selected);
      select.append(option);
    });
}

async function openReporterPrivateDetailsDialog(application) {
  try {
    const result = await apiRequest(`admin/reporter-applications/${application.id}/private-details`);
    const data = result.data || {};
    const details = data.details || {};
    const dialog = document.createElement("dialog");
    dialog.className = "admin-json-dialog";
    const body = makeElement("section", "admin-json-form");
    body.append(
      makeElement("span", "admin-eyebrow", "RESTRICTED · ADMIN REVIEW"),
      makeElement("h2", "", `Private application details · ${application.user?.full_name || application.id}`),
      makeElement("p", "admin-dialog-help", "Identity and bank documents are sensitive. Open them only to review this application. Document links expire shortly.")
    );
    const detailsGrid = makeElement("div", "admin-application-private-grid");
    [
      ["Mobile number", details.mobile_number],
      ["Date of birth", details.date_of_birth],
      ["Age at application", details.age_at_application == null ? "—" : `${details.age_at_application} years`],
      ["Father's first name", details.father_first_name],
      ["Father's last name", details.father_last_name],
      ["Permanent address", [
        details.permanent_address_line1,
        details.permanent_address_line2,
        details.permanent_address_city,
        details.permanent_address_district,
        details.permanent_address_state,
        details.permanent_address_postal_code
      ].filter(Boolean).join(", ")],
      ["Emergency contact", details.emergency_contact_name],
      ["Relationship", details.emergency_contact_relationship],
      ["Emergency phone", details.emergency_contact_phone],
      ["Blood group", details.blood_group],
      ["Masked Aadhaar confirmed", details.masked_aadhaar_confirmed ? "Yes" : "No"],
      ["Document privacy consent", details.document_processing_consent ? "Recorded" : "Not recorded"],
      ["Selected Coverage Area", details.coverage_area?.name],
      ["Preferred language", details.preferred_language],
      ["Preferred locations to cover", String(details.coverage_localities || "").replace(/\r?\n/g, ", ")],
      ["Experience", details.experience_years == null ? "—" : `${details.experience_years} years`],
      ["Availability", details.availability],
      ["Bank account holder", details.bank_account_holder],
      ["Bank name", details.bank_name],
      ["IFSC", details.bank_ifsc]
    ].forEach(([label, value]) => {
      detailsGrid.append(
        makeElement("strong", "", label),
        makeElement("span", "", value || "—")
      );
    });
    const accountNumber = String(details.bank_account_number || "");
    const accountNumberValue = makeElement(
      "span",
      "",
      accountNumber ? `${"*".repeat(Math.max(0, accountNumber.length - 4))}${accountNumber.slice(-4)}` : "—"
    );
    const revealAccount = makeElement("button", "admin-secondary-button", "Show full account number");
    revealAccount.type = "button";
    revealAccount.addEventListener("click", () => {
      const revealed = revealAccount.dataset.revealed === "true";
      accountNumberValue.textContent = revealed
        ? `${"*".repeat(Math.max(0, accountNumber.length - 4))}${accountNumber.slice(-4)}`
        : accountNumber;
      revealAccount.dataset.revealed = String(!revealed);
      revealAccount.textContent = revealed ? "Show full account number" : "Hide full account number";
    });
    const accountNumberCell = makeElement("div", "admin-private-account-value");
    accountNumberCell.append(accountNumberValue, revealAccount);
    detailsGrid.append(makeElement("strong", "", "Bank account number"), accountNumberCell);
    if (details.experience_summary) {
      detailsGrid.append(makeElement("strong", "", "Experience summary"), makeElement("span", "", details.experience_summary));
    }
    body.append(detailsGrid, makeElement("h3", "", "Submitted documents"));
    const documentLabels = {
      profile_photo: "Passport-size profile photo",
      masked_aadhaar: "Masked Aadhaar copy",
      aadhaar_front: "Masked Aadhaar front",
      aadhaar_back: "Masked Aadhaar back",
      pan_card: "PAN card",
      bank_proof: "Cancelled cheque / bank proof"
    };
    const documents = Array.isArray(data.documents) ? data.documents : [];
    if (documents.length) {
      const list = makeElement("div", "admin-application-private-documents");
      documents.forEach((document) => {
        const item = makeElement("div", "admin-application-private-document");
        item.append(makeElement("span", "", documentLabels[document.document_type] || document.document_type));
        const link = makeElement("a", "", "Open private document");
        link.href = document.preview_url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        item.append(link, makeElement("small", "", `SHA-256 ${document.sha256}`));
        list.append(item);
      });
      body.append(list);
    } else {
      body.append(makeElement("p", "admin-empty", "No private documents were found for this application."));
    }
    const actions = makeElement("div", "admin-dialog-actions");
    const close = makeElement("button", "admin-primary-button", "Close");
    close.type = "button";
    close.addEventListener("click", () => dialog.close());
    actions.append(close);
    body.append(actions);
    dialog.append(body);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
  } catch (error) {
    void showAdminMessage("Application details unavailable", error.message);
  }
}

async function openReporterReviewDialog(application, refresh) {
  try {
    const [result, optionsResult] = await Promise.all([
      apiRequest(`admin/reporter-applications/${application.id}/private-details`),
      apiRequest("admin/reporter-review-options")
    ]);
    const privateData = result.data || {};
    const options = unwrapData(optionsResult) || {};
    const designations = (options.reporter_designations || []).filter((item) => item.is_active);
    const details = privateData.details || {};
    const documents = Array.isArray(privateData.documents) ? privateData.documents : [];
    const requestControls = [];
    openFormDialog(
      "Review reporter application",
      "Review the applicant's details and documents together. If no changes are needed, choose Approve, select a reporter designation, and confirm your authority. Choose Request more information only when you select at least one field and explain the required update.",
      (form) => {
        const decisionLabel = makeElement("label", "admin-form-field");
        decisionLabel.append(makeElement("span", "", "Decision"));
        const decision = document.createElement("select");
        decision.name = "decision";
        decision.required = true;
        decision.append(new Option("Choose a decision", ""));
        decision.append(new Option("Request more information (select fields below)", "needs_information"));
        const approveOption = new Option("Approve", "approve");
        approveOption.disabled = designations.length === 0;
        decision.append(approveOption, new Option("Reject", "reject"));
        decisionLabel.append(decision);
        form.append(decisionLabel);
        addField(form, "Review note", "note", "text", "", { required: false, maxLength: 1000 });
        const designationField = makeElement("div", "admin-application-designation-field");
        const designationSelect = appendReporterSelect(
          designationField,
          "designation_id",
          "Reporter designation",
          designations,
          (item) => `${item.name} · Code ${item.designation_code}`
        );
        const currentDesignationId = String(
          application.reporter_designation_id || application.reporter_designation?.id || ""
        );
        if (designations.some((item) => String(item.id) === currentDesignationId)) {
          designationSelect.value = currentDesignationId;
        }
        designationField.hidden = true;
        form.append(designationField);
        form.append(makeElement(
          "p",
          "admin-dialog-help",
          designations.length
            ? "Required when approving. This is the reporter's position, not an account permission. Its two-digit code is used in the new reporter ID (state-RTO-code-number) and the designation appears in the service agreement."
            : "No active reporter designations are configured. Add one before approving an application."
        ));

        const reviewerName = sessionIdentity?.full_name || sessionIdentity?.name || "Reviewer profile name missing";
        const reviewerDesignation = sessionIdentity?.role === "super_admin" ? "Super Administrator" : "Administrator";
        form.append(makeElement("p", "admin-dialog-help", `Approval signer (from your account): ${reviewerName} · ${reviewerDesignation}`));
        const acceptLabel = makeElement("label", "admin-form-checkbox");
        const signature = document.createElement("input");
        signature.type = "checkbox";
        signature.name = "signature_accepted";
        acceptLabel.append(signature, makeElement("span", "", "I confirm I am authorized to approve this application. This is an attestation, not a digital signature."));
        form.append(acceptLabel);

        const reviewDetails = makeElement("section", "admin-application-review-details");
        const user = application.user || {};
        [
          ["Application", `#${application.id} · ${application.status}`],
          ["Applicant", user.full_name || "—"],
          ["Email / account phone", [user.email, user.phone].filter(Boolean).join(" · ") || "—"],
          ["Applicant confirms details", application.applicant_details_confirmed ? "Yes" : "Not recorded"]
        ].forEach(([label, value]) => {
          reviewDetails.append(makeElement("strong", "", label), makeElement("span", "", value));
        });

        reviewDetails.append(makeElement("h3", "", "Applicant details"));
        const fieldGrid = makeElement("div", "admin-application-review-fields");
        const fieldRows = [
          ["state_id", "State", application.state?.state_name],
          ["rto_office_id", "District", application.rto?.city_name && application.rto?.rto_code
            ? `${application.rto.city_name} (${application.rto.rto_code})`
            : application.rto?.city_name || application.rto?.rto_code],
          ["mobile_number", "Mobile number", details.mobile_number],
          ["date_of_birth", "Date of birth", details.date_of_birth],
          ["father_first_name", "Father's first name", details.father_first_name],
          ["father_last_name", "Father's last name", details.father_last_name],
          ["permanent_address_line1", "Permanent address · House / building and street", details.permanent_address_line1],
          ["permanent_address_line2", "Permanent address · Area / locality", details.permanent_address_line2],
          ["permanent_address_city", "Permanent address · City / town / village", details.permanent_address_city],
          ["permanent_address_district", "Permanent address · District", details.permanent_address_district],
          ["permanent_address_state", "Permanent address · State", details.permanent_address_state],
          ["permanent_address_postal_code", "Permanent address · PIN / ZIP code", details.permanent_address_postal_code],
          ["emergency_contact_name", "Emergency contact", details.emergency_contact_name],
          ["emergency_contact_relationship", "Emergency relationship", details.emergency_contact_relationship],
          ["emergency_contact_phone", "Emergency phone", details.emergency_contact_phone],
          ["blood_group", "Blood group", details.blood_group],
          ["coverage_area_id", "Selected Coverage Area", details.coverage_area?.name],
          ["coverage_localities", "Preferred locations", String(details.coverage_localities || "").replace(/\r?\n/g, ", ")],
          ["preferred_language", "Preferred language", details.preferred_language],
          ["experience_years", "Reporting experience", details.experience_years == null ? "—" : `${details.experience_years} years`],
          ["experience_summary", "Experience summary", details.experience_summary],
          ["availability", "Availability", details.availability],
          ["bank_account_holder", "Bank account holder", details.bank_account_holder],
          ["bank_name", "Bank name", details.bank_name],
          ["bank_account_number", "Bank account number", details.bank_account_number],
          ["bank_ifsc", "IFSC", details.bank_ifsc]
        ];
        fieldRows.forEach(([field, label, value]) => {
          const row = makeElement("div", "admin-application-review-field");
          row.append(makeElement("strong", "", label), makeElement("span", "", value || "—"));
          addReviewRequestControl(row, field, label, ["correction", "other"], requestControls);
          fieldGrid.append(row);
        });
        const consentRows = makeElement("div", "admin-application-review-fields");
        [
          ["Masked Aadhaar confirmed", details.masked_aadhaar_confirmed ? "Yes" : "No"],
          ["Document privacy consent", details.document_processing_consent ? "Recorded" : "Not recorded"]
        ].forEach(([label, value]) => {
          const row = makeElement("div", "admin-application-review-field");
          row.append(makeElement("strong", "", label), makeElement("span", "", value));
          consentRows.append(row);
        });
        reviewDetails.append(fieldGrid, consentRows, makeElement("h3", "", "Submitted documents"));
        const documentList = makeElement("div", "admin-application-private-documents");
        const documentLabels = {
          profile_photo: "Profile photo",
          aadhaar_front: "Masked Aadhaar front",
          aadhaar_back: "Masked Aadhaar back",
          pan_card: "PAN card",
          bank_proof: "Bank proof"
        };
        documents.forEach((submittedDocument) => {
          const row = makeElement("div", "admin-application-private-document");
          const label = documentLabels[submittedDocument.document_type] || submittedDocument.document_type;
          row.append(makeElement("span", "", label));
          const preview = makeElement("a", "", "Open document");
          preview.href = submittedDocument.preview_url;
          preview.target = "_blank";
          preview.rel = "noopener noreferrer";
          row.append(preview, makeElement("small", "", `SHA-256 ${submittedDocument.sha256}`));
          const documentPreview = makeElement("div", "admin-review-document-preview");
          if (submittedDocument.mime_type?.startsWith("image/")) {
            const image = document.createElement("img");
            image.src = submittedDocument.preview_url;
            image.alt = `${label} preview`;
            image.loading = "lazy";
            documentPreview.append(image);
          } else if (submittedDocument.mime_type === "application/pdf") {
            const frame = document.createElement("iframe");
            frame.src = submittedDocument.preview_url;
            frame.title = `${label} preview`;
            frame.loading = "lazy";
            documentPreview.append(frame);
          }
          if (documentPreview.childElementCount) row.append(documentPreview);
          addReviewRequestControl(row, submittedDocument.document_type, label, ["reupload", "other"], requestControls);
          documentList.append(row);
        });
        reviewDetails.append(documentList);
        reviewDetails.append(makeElement("p", "admin-dialog-help", `User ID: ${application.user_id}`));
        form.prepend(reviewDetails);

        const updateRequirements = () => {
          const approval = decision.value === "approve";
          const requestEnabled = decision.value === "needs_information";
          designationField.hidden = !approval;
          designationSelect.required = approval;
          form.elements.note.required = !approval;
          signature.required = approval;
          form.elements.note.placeholder = requestEnabled
            ? "Summarize the updates the applicant must make"
            : decision.value === "reject"
              ? "Explain the reason for rejection"
              : "Optional applicant-facing note";
          requestControls.forEach(({ checkbox, editor }) => {
            checkbox.disabled = !requestEnabled;
            editor.hidden = !requestEnabled || !checkbox.checked;
            if (!requestEnabled) checkbox.checked = false;
          });
        };
        decision.addEventListener("change", updateRequirements);
        updateRequirements();
      },
      async (formData) => {
        const payload = Object.fromEntries(formData.entries());
        payload.signature_accepted = formData.has("signature_accepted");
        payload.review_requests = requestControls
          .filter(({ checkbox }) => checkbox.checked)
          .map(({ field, kind, instruction }) => ({
            field,
            kind: kind.value,
            instruction: instruction.value.trim()
          }));
        if (payload.decision === "needs_information" && payload.review_requests.length === 0) {
          throw new Error("Select at least one field to request. If no changes are needed, choose Approve.");
        }
        if (payload.review_requests.some((request) => request.instruction.length < 2)) {
          throw new Error("Add a clear instruction to every requested field.");
        }
        await apiRequest(`admin/reporter-applications/${application.id}/review`, "POST", payload);
        await refresh();
      },
      "Save decision"
    );
  } catch (error) {
    void showAdminMessage("Application review failed", error.message);
  }
}

function addReviewRequestControl(container, field, label, actionKinds, requestControls) {
  const controls = makeElement("div", "admin-review-request-controls");
  const toggleLabel = makeElement("label", "admin-form-checkbox");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.disabled = true;
  toggleLabel.append(checkbox, makeElement("span", "", `Request update for ${label}`));
  const editor = makeElement("div", "admin-review-request-editor");
  editor.hidden = true;
  const kind = document.createElement("select");
  actionKinds.forEach((value) => {
    kind.append(new Option(value === "other" ? "Other action" : value[0].toUpperCase() + value.slice(1), value));
  });
  const instruction = document.createElement("textarea");
  instruction.maxLength = 500;
  instruction.placeholder = "Explain exactly what needs to be corrected or reuploaded";
  editor.append(kind, instruction);
  checkbox.addEventListener("change", () => { editor.hidden = !checkbox.checked; });
  controls.append(toggleLabel, editor);
  container.append(controls);
  requestControls.push({ field, checkbox, editor, kind, instruction });
}

function openCredentialRevokeDialog(id, refresh) {
  openFormDialog(
    "Revoke staff credential",
    "Revocation is immediate and permanently visible in credential verification and the audit history.",
    (form) => addField(form, "Reason for revocation", "reason", "text", "", { minLength: 2, maxLength: 500 }),
    async (values) => {
      await apiRequest(`admin/reporter-credentials/${id}/revoke`, "POST", {
        reason: values.get("reason")
      });
      await refresh();
    },
    "Revoke credential"
  );
}

function addField(form, labelText, name, type, value, { required = true, minLength, maxLength, autocomplete } = {}) {
  const label = makeElement("label", "admin-form-field");
  label.append(makeElement("span", "", labelText));
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.value = value || "";
  input.required = required;
  if (minLength) input.minLength = minLength;
  if (maxLength) input.maxLength = maxLength;
  if (autocomplete) input.autocomplete = autocomplete;
  label.append(input);
  form.append(label);
  return input;
}

function addRoleField(form, value = "subscriber") {
  const label = makeElement("label", "admin-form-field");
  label.append(makeElement("span", "", "Account role"));
  const select = document.createElement("select");
  select.name = "role";
  const roles = sessionIdentity?.role === "super_admin"
    ? ["subscriber", "publisher", "admin", "super_admin"]
    : ["subscriber", "publisher", "admin"];
  roles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role.replace("_", " ");
    option.selected = role === value;
    select.append(option);
  });
  label.append(select);
  form.append(label);
  return select;
}

function openFormDialog(title, helpText, fields, onSubmit, submitLabel = "Save changes") {
  const dialog = document.createElement("dialog");
  dialog.className = "admin-json-dialog";
  const form = makeElement("form", "admin-json-form admin-account-form");
  form.method = "dialog";
  form.append(makeElement("span", "admin-eyebrow", "CHOWK ADMIN"));
  form.append(makeElement("h2", "", title));
  form.append(makeElement("p", "admin-dialog-help", helpText));
  fields(form);
  const error = makeElement("p", "admin-error");
  error.hidden = true;
  error.setAttribute("role", "alert");
  form.append(error);
  const actions = makeElement("div", "admin-dialog-actions");
  const cancel = makeElement("button", "admin-secondary-button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  const submit = makeElement("button", "admin-primary-button", submitLabel);
  submit.type = "submit";
  actions.append(cancel, submit);
  form.append(actions);
  dialog.append(form);
  document.body.append(dialog);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      await onSubmit(new FormData(form));
      dialog.close();
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : "The request failed.";
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = submitLabel;
    }
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  return dialog;
}

async function openUserDialog() {
  openFormDialog(
    "Create subscriber account",
    "Create a standard account. Reporter applications use the Reporter Desk; newsroom access requires an assigned role and reviewed staff invitation.",
    (form) => {
      addField(form, "Full name", "full_name", "text", "", { minLength: 2, maxLength: 120, autocomplete: "name" });
      addField(form, "Email address", "email", "email", "", { maxLength: 254, autocomplete: "email" });
      addField(form, "Phone (optional)", "phone", "tel", "", { required: false, autocomplete: "tel" });
      addRoleField(form, "subscriber");
      addField(form, "Temporary password", "password", "password", "", { minLength: 8, maxLength: 72, autocomplete: "new-password" });
    },
    async (formData) => {
      const payload = Object.fromEntries(formData.entries());
      const result = await apiRequest("admin/users", "POST", payload);
      await loadSection("users");
      void showAdminMessage(
        "Account created",
        result.confirmation_required
          ? "The user must confirm the email before signing in."
          : "The account is ready to use."
      );
    },
    "Create subscriber"
  );
}

async function openStaffInvitationDialog(refresh = () => loadSection("applications")) {
  let roles;
  try {
    roles = unwrapData(await apiRequest("admin/staff-roles")) || [];
  } catch (error) {
    void showAdminMessage("Newsroom roles could not be loaded", error.message);
    return;
  }
  roles = roles.filter((role) =>
    role.is_active && ["moderator", "editor"].includes(role.access_profile)
  );
  if (!roles.length) {
    void showAdminMessage("No active newsroom roles", "Create or activate a newsroom role before sending an invitation.");
    return;
  }
  openFormDialog(
    "Invite newsroom staff",
    "We will email a secure invitation link. The selected newsroom role defines both responsibilities and system permissions. The invitee completes the shared staff profile and accepts the agreement before admin approval.",
    (form) => {
      addField(form, "Staff member email", "email", "email", "", {
        maxLength: 254,
        autocomplete: "email"
      });
      const label = makeElement("label", "admin-form-field");
      label.append(makeElement("span", "", "Newsroom role"));
      const select = document.createElement("select");
      select.name = "staff_role_id";
      select.required = true;
      const preferredRole = roles[0];
      roles.forEach((role) => {
        const option = makeElement("option", "", role.display_name);
        option.value = role.id;
        option.selected = role.id === preferredRole.id;
        select.append(option);
      });
      label.append(select);
      form.append(label);
      const duties = makeElement("p", "admin-dialog-help");
      const updateDuties = () => {
        const selected = roles.find((role) => role.id === select.value);
        const grants = Array.isArray(selected?.permissions) ? selected.permissions : [];
        duties.textContent = [
          selected?.duties ? `Responsibilities: ${selected.duties}` : "No responsibilities have been described.",
          `System permissions: ${grants.length ? grants.map((grant) => grant.permission_key).join(", ") : "none"}`
        ].join(" · ");
      };
      select.addEventListener("change", updateDuties);
      updateDuties();
      form.append(duties);
      form.append(makeElement(
        "p",
        "admin-dialog-help",
        "Reporter applications remain a separate workflow."
      ));
    },
    async (values) => {
      const result = await apiRequest("admin/staff-invitations", "POST", {
        email: String(values.get("email") || "").trim(),
        staff_role_id: values.get("staff_role_id")
      });
      await refresh();
      void showAdminMessage(
        "Staff invitation sent",
        `A secure ${result.data.staff_role_name} onboarding invitation was sent to ${result.data.email}. The role stays inactive until an admin approves the completed profile.`
      );
    },
    "Send invitation"
  );
}

async function openReporterAssignmentDialog(user, refresh) {
  let options;
  try {
    options = unwrapData(await apiRequest("admin/reporter-options")) || {};
  } catch (error) {
    void showAdminMessage("Reporter account options could not be loaded", error.message);
    return;
  }
  const states = (options.states || []).filter((state) => state.is_active);
  const rtos = (options.rtos || []).filter((rto) => rto.is_active);
  openFormDialog(
    "Update reporter assignment",
    "This changes the reporting area for an already-onboarded reporter while preserving their current designation and assignment history.",
    (form) => {
      form.append(makeElement("p", "admin-dialog-help", `${user.full_name || user.email} · ${user.email}`));
      const stateSelect = appendReporterSelect(form, "state_id", "State / UT", states,
        (state) => `${state.state_name} (${state.state_code})`);
      const rtoSelect = appendReporterSelect(form, "rto_office_id", "RTO / reporting area", [],
        (rto) => `${rto.rto_code}${rto.city_name ? ` · ${rto.city_name}` : ""}`);
      stateSelect.addEventListener("change", () => {
        replaceValueOptions(
          rtoSelect,
          rtos.filter((rto) => String(rto.state_id) === stateSelect.value),
          "Choose an RTO / reporting area",
          (rto) => `${rto.rto_code}${rto.city_name ? ` · ${rto.city_name}` : ""}`
        );
      });
    },
    async (values) => {
      const result = await apiRequest(`admin/users/${user.id}/reporter-assignment`, "POST", {
        state_id: Number(values.get("state_id")),
        rto_office_id: Number(values.get("rto_office_id"))
      });
      await refresh();
      void showAdminMessage("Reporter assignment updated", `Reporter ID: ${result.data.reporter_code}`);
    },
    "Save assignment"
  );
}

function renderSettings() {
  const identity = sessionIdentity || {};
  const root = makeElement("div", "admin-section");
  addHeading(root, "ACCOUNT", "Profile & security", "Keep your admin profile current and protect access to your newsroom.");

  const profilePanel = makeElement("section", "admin-panel admin-settings-panel");
  const profileHeading = makeElement("div", "admin-panel-heading");
  profileHeading.append(makeElement("h2", "", "Profile information"));
  profilePanel.append(profileHeading);
  const profileForm = makeElement("form", "admin-settings-form");
  addField(profileForm, "Full name", "full_name", "text", identity.full_name || identity.name, { minLength: 2, maxLength: 120, autocomplete: "name" });
  addField(profileForm, "Email address", "email", "email", identity.email || "", { required: false, maxLength: 254, autocomplete: "email" }).disabled = true;
  addField(profileForm, "Phone number", "phone", "tel", identity.phone || "", { required: false, autocomplete: "tel" });
  const profileMessage = makeElement("p", "admin-settings-message");
  profileMessage.hidden = true;
  const saveProfile = makeElement("button", "admin-primary-button admin-settings-button", "Save profile");
  saveProfile.type = "submit";
  profileForm.append(profileMessage, saveProfile);
  profilePanel.append(profileForm);
  profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveProfile.disabled = true;
    saveProfile.textContent = "Saving…";
    profileMessage.hidden = true;
    try {
      const result = await apiRequest("admin/profile", "PATCH", Object.fromEntries(new FormData(profileForm).entries()));
      sessionIdentity = result.identity;
      document.querySelector("#admin-name").textContent = sessionIdentity.name || sessionIdentity.email;
      document.querySelector("#admin-avatar").textContent = (sessionIdentity.name || sessionIdentity.email || "C").slice(0, 1).toUpperCase();
      profileMessage.textContent = "Profile updated.";
      profileMessage.className = "admin-settings-message is-success";
    } catch (error) {
      profileMessage.textContent = error.message;
      profileMessage.className = "admin-settings-message is-error";
    } finally {
      profileMessage.hidden = false;
      saveProfile.disabled = false;
      saveProfile.textContent = "Save profile";
    }
  });
  root.append(profilePanel);

  const securityPanel = makeElement("section", "admin-panel admin-settings-panel");
  const securityHeading = makeElement("div", "admin-panel-heading");
  securityHeading.append(makeElement("h2", "", "Change password"));
  securityPanel.append(securityHeading);
  const passwordForm = makeElement("form", "admin-settings-form");
  addField(passwordForm, "New password", "password", "password", "", { minLength: 8, maxLength: 72, autocomplete: "new-password" });
  addField(passwordForm, "Confirm new password", "confirm_password", "password", "", { minLength: 8, maxLength: 72, autocomplete: "new-password" });
  const passwordMessage = makeElement("p", "admin-settings-message");
  passwordMessage.hidden = true;
  const savePassword = makeElement("button", "admin-primary-button admin-settings-button", "Update password");
  savePassword.type = "submit";
  passwordForm.append(passwordMessage, savePassword);
  securityPanel.append(passwordForm);
  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    savePassword.disabled = true;
    savePassword.textContent = "Updating…";
    passwordMessage.hidden = true;
    try {
      await apiRequest("admin/password", "PATCH", Object.fromEntries(new FormData(passwordForm).entries()));
      passwordForm.reset();
      passwordMessage.textContent = "Password updated successfully.";
      passwordMessage.className = "admin-settings-message is-success";
    } catch (error) {
      passwordMessage.textContent = error.message;
      passwordMessage.className = "admin-settings-message is-error";
    } finally {
      passwordMessage.hidden = false;
      savePassword.disabled = false;
      savePassword.textContent = "Update password";
    }
  });
  root.append(securityPanel);
  content.replaceChildren(root);
}

async function runAction(action, reload) {
  try {
    const result = await action();
    await reload();
    if (result?.cleanup_warning) {
      void showAdminMessage("Action completed with a warning", result.cleanup_warning);
    }
  } catch (error) {
    void showAdminMessage(
      "Action could not be completed",
      error instanceof Error ? error.message : "The action could not be completed."
    );
  }
}

function openJsonDialog(title, initialValue, onSubmit) {
  const dialog = document.createElement("dialog");
  dialog.className = "admin-json-dialog";
  const form = makeElement("form", "admin-json-form");
  form.method = "dialog";
  form.append(makeElement("h2", "", title));
  form.append(makeElement(
    "p",
    "admin-dialog-help",
    "Edit the request as JSON. Supabase row-level security authorizes each operation."
  ));
  const textarea = document.createElement("textarea");
  textarea.name = "payload";
  textarea.spellcheck = false;
  textarea.required = true;
  textarea.value = JSON.stringify(initialValue, null, 2);
  form.append(textarea);
  const error = makeElement("p", "admin-error");
  error.hidden = true;
  error.setAttribute("role", "alert");
  form.append(error);
  const actions = makeElement("div", "admin-dialog-actions");
  const cancel = makeElement("button", "admin-secondary-button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  const submit = makeElement("button", "admin-primary-button", "Save");
  submit.type = "submit";
  actions.append(cancel, submit);
  form.append(actions);
  dialog.append(form);
  document.body.append(dialog);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    let payload;
    try {
      payload = JSON.parse(textarea.value);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("The request body must be a JSON object.");
      }
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : "Invalid JSON.";
      error.hidden = false;
      return;
    }
    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      await onSubmit(payload);
      dialog.close();
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : "The request failed.";
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = "Save";
    }
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

document.querySelector("#admin-sign-out").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/admin/session", { method: "DELETE" });
    if (!response.ok) throw new Error("Could not sign out.");
    window.location.replace("/admin");
  } catch (error) {
    void showAdminMessage("Sign out failed", error instanceof Error ? error.message : "Could not sign out.");
  }
});

navItems.forEach((item) => {
  item.addEventListener("click", () => void loadSection(item.dataset.section));
});

async function loadSession() {
  try {
    const response = await fetch("/api/admin/session", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      throw new Error(responseMessage(result));
    }
    sessionIdentity = result.identity;
    sessionPermissions = Array.isArray(result.permissions) ? result.permissions : [];
    document.querySelector("#admin-name").textContent =
      sessionIdentity.name || sessionIdentity.email;
    document.querySelector("#admin-role").textContent =
      ["admin", "super_admin"].includes(sessionIdentity.role)
        ? String(sessionIdentity.role).replace("_", " ")
        : "Delegated HR";
    document.querySelector("#admin-avatar").textContent =
      (sessionIdentity.name || sessionIdentity.email || "C").slice(0, 1).toUpperCase();
    const isLegacyAdmin = ["admin", "super_admin"].includes(sessionIdentity.role);
    const sectionPermissions = {
      articles: ["newsroom.articles.read"],
      categories: ["newsroom.categories.manage"],
      media: ["newsroom.media.manage"],
      "live-streams": ["newsroom.media.manage"],
      comments: ["newsroom.comments.moderate"],
      reports: ["newsroom.reports.manage"],
      applications: ["reporters.manage", "reporters.applications.review", "newsroom.people.manage"],
      directory: ["people.directory.read", "reporters.manage", "newsroom.people.manage"],
      "staff-roles": [],
      "hr-management": ["hr.console.access"],
      agreements: ["reporters.manage", "newsroom.people.manage"],
      credentials: ["reporters.manage", "newsroom.people.manage"],
      coverage: ["reporters.manage", "newsroom.people.manage"],
      locations: ["newsroom.locations.manage"],
      "territory-leadership": ["newsroom.locations.manage"],
      "reporter-configuration": ["reporters.manage"],
      accounts: ["organization.accounts.manage"],
      "audit-logs": ["organization.audit.read"]
    };
    navItems.forEach((item) => {
      const section = item.dataset.section;
      const allowed = section === "configurations"
        ? configurationSections.some((configuration) =>
          canAccessConfigurationSection(configuration.key))
        : isLegacyAdmin
          || sectionPermissions[section]?.some((permission) => sessionPermissions.includes(permission)) === true
          || section === "settings";
      item.hidden = !allowed;
    });
    document.querySelectorAll(".admin-nav-group").forEach((group) => {
      group.hidden = !group.querySelector(".admin-nav-item:not([hidden])");
    });
    if (isLegacyAdmin) {
      await loadSection("overview");
    } else {
      const firstAllowed = navItems.find((item) => !item.hidden)?.dataset.section;
      await loadSection(firstAllowed || "settings");
    }
  } catch (error) {
    showPageError(
      error instanceof Error ? error.message : "Admin session could not be checked.",
      loadSession
    );
  }
}

loadSession();
