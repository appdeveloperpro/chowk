const content = document.querySelector("#admin-content");
const navItems = [...document.querySelectorAll(".admin-nav-item")];
const sectionLabels = Object.fromEntries(
  navItems.map((item) => [item.dataset.section, item.textContent.trim()])
);

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
  users: {
    path: "admin/users",
    description: "Create newsroom accounts, review access, and assign role-based permissions."
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
  "reporter-coverage": {
    path: "admin/reporter-coverage",
    description: "Assign and end hierarchical newsroom coverage with a complete effective-date history."
  },
  "reporter-credentials": {
    path: "admin/reporter-credentials",
    description: "Issue ID cards and authority letters; reporter access starts only after the authority letter is acknowledged."
  },
  "reporter-service-agreements": {
    path: "admin/reporter-service-agreement-template",
    description: "Maintain the approved service agreement template and company legal details used to prepare agreements for approved reporters."
  },
  "reporter-options": {
    path: "admin/reporter-options",
    description: "Configure states, RTO/reporting areas, and reporter type codes."
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
    description: "Manage the State > Region > Zone > Range > District > Coverage area hierarchy. Enter an RTO code when creating a District; it is added to the existing State/RTO records used for reporter IDs. Existing Zones migrated under an 'Unassigned Region' must be moved into the correct Region.",
    createPath: "admin/locations",
    formFields: [
      { name: "name", label: "Location name", type: "text" },
      { name: "slug", label: "URL slug", type: "text" },
      { name: "location_type", label: "Location level", type: "select", options: ["state", "region", "zone", "range", "district", "coverage_area"] },
      { name: "rto_code", label: "RTO code (without State prefix; e.g. 80)", type: "text", required: false, maxLength: 8 },
      { name: "parent_id", label: "Parent location", type: "number", required: false },
      { name: "is_active", label: "Active", type: "checkbox" }
    ]
  },
  "reporter-types": {
    path: "admin/reporter-types",
    description: "Configure reporter classifications used by applications.",
    createPath: "admin/reporter-types",
    formFields: [
      { name: "name", label: "Reporter type", type: "text" },
      { name: "type_code", label: "Reporter type code (2 digits)", type: "text", pattern: "[0-9]{2}", maxLength: 2 },
      { name: "description", label: "Description", type: "textarea", required: false },
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
    ["unassigned", "Districts needing a range", (row) =>
      row._source_type === "district" && row._parent_type !== "range"],
    ["coverage-area", "Coverage areas", (row) => row._source_type === "coverage_area"]
  ];
  const panel = makeElement("section", "admin-panel admin-location-panel");
  const panelHeader = makeElement("div", "admin-panel-heading");
  panelHeader.append(makeElement("h2", "", "Locations"));
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

const allowedLocationParents = {
  state: [],
  region: ["state"],
  zone: ["region"],
  range: ["zone"],
  city: ["district"],
  district: ["range"],
  coverage_area: ["district"]
};

let activeSection = "overview";
let sessionIdentity = null;
let overviewData = null;
let locationRecords = [];
let reporterSetupView = "overview";
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

function addHeading(root, eyebrow, title, description) {
  const heading = makeElement("div", "admin-page-heading");
  const copy = makeElement("div");
  copy.append(makeElement("span", "admin-eyebrow", eyebrow));
  copy.append(makeElement("h1", "", title));
  copy.append(makeElement("p", "", description));
  heading.append(copy);
  const refresh = makeElement("button", "admin-secondary-button", "Refresh");
  refresh.type = "button";
  refresh.addEventListener("click", () => void loadSection(activeSection));
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

async function loadSection(section) {
  activeSection = section;
  const label = sectionLabels[section] || "Overview";
  document.querySelector("#breadcrumb-section").textContent = label;
  navItems.forEach((item) =>
    item.classList.toggle("is-active", item.dataset.section === section)
  );
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
  if (section.startsWith("reporter-") && section !== "reporter-types") {
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
  if (section === "users") {
    const button = makeElement("button", "admin-primary-button admin-create-button", "Add user");
    button.type = "button";
    button.addEventListener("click", () => openUserDialog());
    actions.append(button);
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
    window.alert("Enter the date in YYYY-MM-DD format.");
    return;
  }
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    window.alert("Allow pop-ups to open the printable newsroom report.");
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
    window.alert(error instanceof Error ? error.message : "The daily submission report could not be generated.");
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
      return {
        full_name: reporter.user?.full_name || "—",
        email: reporter.user?.email || "—",
        reporter_code: reporter.reporter_code,
        current_assignment: current
          ? `${current.rto?.state?.state_code || ""}${current.rto?.rto_code || ""} · ${current.reporter_type?.name || ""}`
          : "No current assignment",
        assignment_history: assignments.map((assignment) =>
          `${assignment.rto?.state?.state_code || ""}${assignment.rto?.rto_code || ""} · ${assignment.reporter_type?.name || ""} · ${assignment.effective_to ? formatDate(assignment.effective_from) + " – " + formatDate(assignment.effective_to) : "Current"}`
        ).join(" | ") || "No assignment history",
        role: reporter.user?.role || "—",
        assignments: assignments.length,
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
    const rows = credentials.map((credential) => ({
      name: credential.name_snapshot,
      role: credential.role_snapshot,
      reporter_code: credential.reporter_code_snapshot || "—",
      type: credential.credential_type.replace("_", " "),
      reference: credential.reference_code,
      status: credential.status.replaceAll("_", " "),
      scope: [
        credential.scope_snapshot?.state_name,
        credential.scope_snapshot?.rto_code,
        credential.scope_snapshot?.city_name
      ].filter(Boolean).join(" · ") || "—",
      valid_until: formatDate(credential.valid_until),
      id: credential.id
    }));
    reporterActionButton(root, "Issue credential", () => openCredentialDialog(data.staff || []));
    reporterPanel(root, "Issued staff credentials", rows, section);
    return;
  }

  if (section === "reporter-service-agreements") {
    const panel = makeElement("section", "admin-panel");
    const header = makeElement("div", "admin-panel-heading");
    header.append(makeElement("h2", "", "Approved service agreement"));
    const published = data.published_version;
    const latestDraft = data.latest_status === "draft";
    header.append(makeElement(
      "span",
      "",
      published ? `Published · ${published}` : "Not published"
    ));
    panel.append(header);
    panel.append(makeElement(
      "p",
      "admin-dialog-help",
      "Maintain one approved template here. After a reporter is approved, open their application to preview and issue a personalized PDF. The system keeps previous versions and accepted documents for legal history."
    ));
    if (latestDraft) {
      panel.append(makeElement(
        "p",
        "admin-inline-warning",
        "An unpublished draft is saved. Review and publish it before issuing agreements based on the updated terms."
      ));
    } else if (!published) {
      panel.append(makeElement(
        "p",
        "admin-inline-warning",
        "No service agreement is published yet. Finalize the legal terms and verify company details before issuing agreements."
      ));
    }
    const actions = makeElement("div", "admin-page-actions");
    const editTemplate = makeElement(
      "button",
      "admin-primary-button admin-create-button",
      data.is_default ? "Set up and publish template" : "Edit and publish template"
    );
    editTemplate.type = "button";
    editTemplate.addEventListener("click", () => void openReporterServiceAgreementTemplateDialog());
    const manageCompany = makeElement("button", "admin-secondary-button", "Manage company legal details");
    manageCompany.type = "button";
    manageCompany.addEventListener("click", async () => {
      try {
        const setup = await apiRequest("admin/reporter-options");
        openReporterOrganizationProfileDialog(setup.data?.organization_profile);
      } catch (error) {
        void showAdminMessage("Company details unavailable", error.message);
      }
    });
    actions.append(editTemplate, manageCompany);
    panel.append(actions);
    root.append(panel);
    return;
  }

  if (section === "reporter-options") {
    renderReporterSetup(root, data);
  }
}

function renderReporterSetup(root, data) {
  root.querySelectorAll(".reporter-setup-overview, .reporter-setup-detail")
    .forEach((view) => view.remove());
  const states = data.states || [];
  const rtos = data.rtos || [];
  const types = data.reporter_types || [];
  const serviceAgreements = data.service_agreements || [];
  const publishedServiceAgreement = serviceAgreements.find((agreement) => agreement.status === "published");
  const organizationProfile = data.organization_profile;
  const setupSections = [
    {
      key: "organization_profile",
      title: "Organization legal profile",
      count: organizationProfile?.is_verified ? "Verified" : "Demo only",
      detail: organizationProfile?.legal_name || "Add organization legal details before publishing agreements."
    },
    {
      key: "states",
      title: "States & UTs",
      count: states.length,
      detail: `${states.filter((state) => state.is_active).length} active · Territories served by Chowk.`
    },
    {
      key: "rtos",
      title: "RTO / reporting areas",
      count: rtos.length,
      detail: `${rtos.filter((rto) => rto.is_active).length} active · Offices connected to a state.`
    },
    {
      key: "types",
      title: "Reporter types",
      count: types.length,
      detail: `${types.filter((type) => type.is_active).length} active · Roles available to applicants.`
    },
    {
      key: "service_agreement",
      title: "Service agreement setup",
      count: publishedServiceAgreement ? "Published" : "Needed for credentials",
      detail: publishedServiceAgreement?.version || "Publish finalized service terms before issuing reporter credentials."
    }
  ];
  const overview = makeElement("section", "reporter-setup-overview");
  const overviewHeading = makeElement("div", "reporter-setup-overview-heading");
  overviewHeading.append(
    makeElement("div", "", "REPORTER APPLICATION & ONBOARDING SETUP"),
    makeElement("p", "", "Applications collect reporter details for review. Verify the organization profile and prepare the service agreement for approved reporters, then configure active coverage choices.")
  );
  overview.append(overviewHeading);

  const cards = makeElement("div", "reporter-setup-cards");
  setupSections.forEach((item) => {
    const needsAttention = (item.key === "service_agreement" && !publishedServiceAgreement)
      || (item.key === "organization_profile" && !organizationProfile?.is_verified);
    const card = makeElement("button", `reporter-setup-card${needsAttention ? " needs-attention" : ""}`);
    card.type = "button";
    card.setAttribute("aria-pressed", String(reporterSetupView === item.key));
    card.append(
      makeElement("span", "reporter-setup-card-label", item.title),
      makeElement("strong", "reporter-setup-card-count", String(item.count)),
      makeElement("span", "reporter-setup-card-detail", item.detail),
      makeElement("span", "reporter-setup-card-action", item.key === "service_agreement"
        ? "Open setup →"
        : reporterSetupView === item.key ? "Currently open" : "Manage →")
    );
    card.addEventListener("click", () => {
      if (item.key === "service_agreement") {
        void loadSection("reporter-service-agreements");
        return;
      }
      reporterSetupView = item.key;
      renderReporterAdminSection("reporter-options", root, data);
    });
    cards.append(card);
  });
  overview.append(cards);

  if (reporterSetupView === "overview") {
    const reporterSetupReady = Boolean(publishedServiceAgreement && organizationProfile?.is_verified);
    const setupNote = makeElement("div", `reporter-setup-readiness${reporterSetupReady ? " is-ready" : " is-incomplete"}`);
    setupNote.append(
      makeElement("strong", "", reporterSetupReady && organizationProfile?.is_verified
        ? "Reporter onboarding agreement published"
        : "Applications open · service agreement setup needed"),
      makeElement("span", "", reporterSetupReady
        ? "Applicants submit details for review. After approval, the reporter receives and accepts their personalized service agreement before credentials can be issued."
        : "Reporter applications can be submitted and reviewed without a contract. Verify company legal details and publish finalized service terms before issuing reporter credentials.")
    );
    overview.append(setupNote);
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
    renderReporterAdminSection("reporter-options", root, data);
  });
  actions.append(back);
  if (reporterSetupView === "states") {
    rowButton(actions, "Add state", openStateDialog, "admin-primary-button reporter-setup-add");
  } else if (reporterSetupView === "rtos") {
    rowButton(actions, "Add RTO / area", () => openRtoDialog(states), "admin-primary-button reporter-setup-add");
  } else if (reporterSetupView === "types") {
    rowButton(actions, "Add reporter type", () => openConfiguredRecordDialog("reporter-types", null), "admin-primary-button reporter-setup-add");
  } else if (reporterSetupView === "organization_profile") {
    rowButton(
      actions,
      organizationProfile ? "Edit legal profile" : "Set up legal profile",
      () => openReporterOrganizationProfileDialog(organizationProfile),
      "admin-primary-button reporter-setup-add"
    );
  }
  header.append(actions);

  if (reporterSetupView === "organization_profile") {
    const profileCard = makeElement("div", "reporter-organization-profile");
    const verified = organizationProfile?.is_verified === true;
    profileCard.append(
      makeElement(
        "div",
        `reporter-organization-status${verified ? " is-verified" : " is-demo"}`,
        verified ? "Legal profile verified" : "DEMO PLACEHOLDERS · NOT FOR LEGAL USE"
      ),
      makeElement(
        "p",
        "reporter-organization-help",
        "Verified company legal details are inserted into personalized agreement PDFs. Keep this profile accurate before preparing and issuing an agreement to a reporter. Legal terms must be finalized and reviewed before the template is published."
      )
    );
    const profileFields = [
      ["Legal name", organizationProfile?.legal_name],
      ["Trading name", organizationProfile?.trade_name],
      ["Entity type", organizationProfile?.entity_type],
      ["Registered address", organizationProfile?.registered_address],
      ["Registration number", organizationProfile?.registration_number || "Not provided"],
      ["Official email", organizationProfile?.official_email],
      ["Official phone", organizationProfile?.official_phone],
      ["Website", organizationProfile?.website_url || "Not provided"]
    ];
    const details = makeElement("dl", "reporter-organization-fields");
    profileFields.forEach(([label, value]) => {
      details.append(
        makeElement("dt", "", label),
        makeElement("dd", "", value || "Not configured")
      );
    });
    profileCard.append(details);
    section.append(header, profileCard);
    root.append(overview, section);
    return;
  }

  let rows = [];
  let tableSection = "reporter-options";
  if (reporterSetupView === "states") {
    rows = states.map((state) => ({
      state_name: state.state_name,
      state_code: state.state_code,
      is_active: state.is_active,
      id: state.id
    }));
  } else if (reporterSetupView === "rtos") {
    rows = rtos.map((rto) => ({
      rto_code: rto.rto_code,
      city_name: rto.city_name || "—",
      state: states.find((state) => String(state.id) === String(rto.state_id))?.state_name || "—",
      is_active: rto.is_active,
      id: rto.id
    }));
  } else {
    tableSection = "reporter-types";
    rows = types.map((type) => ({
      name: type.name,
      type_code: type.type_code,
      description: type.description || "—",
      is_active: type.is_active,
      id: type.id
    }));
  }
  const tableHeader = makeElement("div", "admin-panel-heading reporter-setup-table-heading");
  tableHeader.append(
    makeElement("strong", "", selected?.title || "Reporter setup"),
    makeElement("span", "", `${rows.length} ${rows.length === 1 ? "record" : "records"}`)
  );
  section.append(header, tableHeader, buildTable(rows, tableSection));
  root.append(overview, section);
}

async function openReporterAssignmentDialog(reporter, refresh) {
  try {
    const result = await apiRequest("admin/reporter-options");
    const options = unwrapData(result) || {};
    const activeRtos = (options.rtos || []).filter((rto) => rto.is_active);
    const activeTypes = (options.reporter_types || []).filter((type) => type.is_active);
    openFormDialog(
      "Assign reporter area",
      `Reporter ID ${reporter.reporter_code} stays the same after reassignment. The new area is added to the reporter's assignment history.`,
      (form) => {
        appendReporterSelect(form, "rto_office_id", "RTO / reporting area", activeRtos,
          (rto) => `${rto.rto_code} · ${rto.city_name || "Reporting area"}`);
        appendReporterSelect(form, "reporter_type_id", "Reporter type", activeTypes,
          (type) => `${type.name} (${type.type_code})`);
      },
      async (values) => {
        await apiRequest(`admin/reporter-directory/${reporter.user_id}/assignment`, "POST", {
          rto_office_id: Number(values.get("rto_office_id")),
          reporter_type_id: Number(values.get("reporter_type_id"))
        });
        await refresh();
      },
      "Assign reporter"
    );
  } catch (error) {
    void showAdminMessage("Template editor could not be opened", error.message);
  }
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
    window.alert(`District/zone mappings could not be loaded: ${error.message}`);
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
    window.alert("Create an active range and district before mapping.");
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

function openCredentialDialog(staff) {
  const eligibleStaff = staff.filter((person) =>
    ["reporter", "moderator", "editor"].includes(person.role)
      || person.can_issue_id_card
  );
  openFormDialog(
    "Issue staff credential",
    "Approved applicants can receive an ID card and authority letter only after accepting the current service agreement. Reporter access starts only after they acknowledge a valid authority letter.",
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
      const start = addField(form, "Valid from", "valid_from", "date", today);
      start.min = today;
      const end = addField(form, "Valid until", "valid_until", "date", today);
      end.min = today;
      const signer = addField(form, "Authorized signer name", "signer_name", "text", "", { required: false, maxLength: 120 });
      const designation = addField(form, "Signer designation", "signer_designation", "text", "", { required: false, maxLength: 120 });
      const address = addField(form, "Return address", "return_address", "text", "", { required: false, maxLength: 500 });
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
          const maximum = new Date(`${start.value}T00:00:00`);
          maximum.setDate(maximum.getDate() + 366);
          end.max = maximum.toISOString().slice(0, 10);
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

async function openReporterServiceAgreementTemplateDialog() {
  let template = {};
  try {
    template = unwrapData(await apiRequest("admin/reporter-service-agreement-template")) || {};
  } catch (error) {
    void showAdminMessage("Template could not be loaded", error.message);
    return;
  }
  return openReporterServiceAgreementTemplateEditor(template);
}

function openReporterServiceAgreementTemplateEditor(template) {
  let previewUrl = "";
  try {
    const dialog = openFormDialog(
      "Approved reporter service agreement",
      "Edit the single template used for new reporter agreements. Review all legal terms with counsel and replace every square-bracket drafting placeholder. Publishing a change creates a retained version; previously issued or accepted PDFs remain unchanged.",
      (form) => {
        const contentLabel = makeElement("label", "admin-form-field admin-agreement-template-field");
        contentLabel.append(makeElement("span", "", "Service agreement text"));
        const content = document.createElement("textarea");
        content.name = "template_content";
        content.required = true;
        content.minLength = 1000;
        content.maxLength = 50000;
        content.rows = 28;
        content.spellcheck = false;
        content.value = template.template_content || "";
        contentLabel.append(content);
        form.append(contentLabel);

        const fields = makeElement("details", "admin-agreement-template-fields");
        fields.append(makeElement("summary", "", "Available personalization fields"));
        fields.append(makeElement("p", "admin-dialog-help", (template.supported_fields || []).join("  ·  ")));
        form.append(fields);

        const preview = makeElement("button", "admin-secondary-button", "Preview generated PDF");
        preview.type = "button";
        preview.addEventListener("click", async () => {
          const previewWindow = window.open("about:blank", "_blank");
          if (!previewWindow) {
            void showAdminMessage("Preview unavailable", "Allow pop-ups to open the generated PDF preview.");
            return;
          }
          previewWindow.opener = null;
          preview.disabled = true;
          try {
            const response = await fetch(proxyUrl("admin/reporter-service-agreement-template/preview"), {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ template_content: content.value })
            });
            if (!response.ok) {
              const result = await response.json().catch(() => ({}));
              throw new Error(responseMessage(result));
            }
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewUrl = URL.createObjectURL(await response.blob());
            previewWindow.location.replace(previewUrl);
          } catch (error) {
            previewWindow.close();
            void showAdminMessage("Preview failed", error.message);
          } finally {
            preview.disabled = false;
          }
        });
        form.append(preview);
      },
      async (values) => {
        const templateContent = String(values.get("template_content") || "").trim();
        const placeholders = [...new Set(
          [...templateContent.matchAll(/\[([^\]]+)\]/g)].map((match) => match[0])
        )];
        if (placeholders.length) {
          throw new Error(`Replace all square-bracket drafting placeholders before publishing: ${placeholders.slice(0, 5).join(", ")}${placeholders.length > 5 ? ", …" : ""}`);
        }
        if (templateContent.length < 1000 || templateContent.length > 50000) {
          throw new Error("The service agreement must contain between 1,000 and 50,000 characters.");
        }
        const version = `service-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const saved = await apiRequest("admin/reporter-service-agreements/template", "POST", {
          version,
          template_content: templateContent
        });
        const agreementId = saved.data?.id;
        if (!Number.isSafeInteger(agreementId) || agreementId < 1) {
          throw new Error("The template draft was saved, but its version could not be identified for publishing. Refresh the page and try again.");
        }
        try {
          await apiRequest(`admin/reporter-service-agreements/${agreementId}/publish`, "POST", {});
        } catch (error) {
          throw new Error(`The draft was saved but could not be published: ${error.message}`);
        }
        await loadSection("reporter-service-agreements");
      },
      "Save and publish"
    );
    dialog.addEventListener("close", () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    }, { once: true });
  } catch (error) {
    void showAdminMessage("Template editor could not be opened", error.message);
  }
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
      await loadSection("reporter-options");
    },
    "Save profile"
  );
}

function openStateDialog() {
  openFormDialog(
    "Add state",
    "State codes are two alphanumeric characters and are part of future reporter IDs.",
    (form) => {
      const code = addField(form, "State code", "state_code", "text", "", { maxLength: 2 });
      code.pattern = "[A-Za-z0-9]{2}";
      addField(form, "State name", "state_name", "text", "", { maxLength: 100 });
    },
    async (values) => {
      await apiRequest("admin/states", "POST", Object.fromEntries(values.entries()));
      await loadSection("reporter-options");
    },
    "Add state"
  );
}

function openRtoDialog(states) {
  openFormDialog(
    "Add RTO / reporting area",
    "Enter the RTO code without the State prefix (for example, 80); the system combines the State, RTO, and reporter type codes for reporter IDs.",
    (form) => {
      appendReporterSelect(form, "state_id", "State", states.filter((state) => state.is_active),
        (state) => `${state.state_name} (${state.state_code})`);
      const code = addField(form, "RTO code", "rto_code", "text", "", { maxLength: 8 });
      code.pattern = "[A-Za-z0-9]{2,8}";
      addField(form, "City / reporting area name", "city_name", "text", "", { required: false, maxLength: 120 });
    },
    async (values) => {
      await apiRequest("admin/rto-offices", "POST", {
        state_id: Number(values.get("state_id")),
        rto_code: values.get("rto_code"),
        city_name: values.get("city_name") || ""
      });
      await loadSection("reporter-options");
    },
    "Add RTO"
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
    ["reporter_types", "Reporter types"],
    ["reporter_applications", "Reporter applications"],
    ["live_streams", "Live streams"],
    ["article_reports", "Article reports"],
    ["comments", "Comments"],
    ["media_catalog", "Media catalog"],
    ["states", "States"],
    ["rto_offices", "RTO offices"],
    ["reporter_agreement_versions", "Reporter agreements"],
    ["reporter_agreement_acceptances", "Agreement acceptances"],
    ["reporter_service_agreement_versions", "Reporter service agreements"],
    ["reporter_service_agreement_acceptances", "Service agreement acceptances"],
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
    window.alert(error instanceof Error ? error.message : "Audit history could not be exported.");
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

function buildTable(rows, section) {
  if (!rows.length) return makeElement("p", "admin-empty", "No records are available.");

  const excluded = new Set(["content", "body", "password", "token", "credentials"]);
  const internalColumns = new Set(["id", "user_id", "application_id", "credential_id"]);
  const preferredColumns = section === "locations"
    ? ["hierarchy", "location_type", "parent_location", "is_active"]
    : section === "users"
    ? ["full_name", "email", "phone", "role", "created_at"]
    : section === "reporter-applications"
      ? ["applicant_name", "email", "state_name", "city", "area_coverage", "status", "details_confirmed"]
      : section === "reporter-credentials"
        ? ["name", "role", "type", "reference", "status", "scope", "valid_until"]
        : section === "reporter-directory"
          ? ["full_name", "email", "reporter_code", "current_assignment", "assignment_history"]
          : [];
  const keys = [...new Set([
    ...preferredColumns.filter((key) => rows.some((row) => Object.hasOwn(row, key))),
    ...rows.flatMap((row) => Object.keys(row))
  ])]
    .filter((key) => !key.startsWith("_") && !excluded.has(key) && !internalColumns.has(key) && key !== "document_url")
    .slice(0, section === "reporter-applications" || section === "reporter-credentials" ? 7 : section === "reporter-coverage" || section === "reporter-directory" ? 6 : 5);
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
      const cell = makeElement("td", key === "title" || key === "name" ? "article-title-cell" : "", formatCell(value));
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
  const refresh = () => loadSection(section);

  if (section === "users") {
    const role = document.createElement("select");
    role.className = "admin-role-select";
    role.setAttribute("aria-label", `Role for ${row.name || id}`);
    const roles = sessionIdentity?.role === "super_admin"
      ? ["subscriber", "reporter", "moderator", "editor", "publisher", "admin", "super_admin"]
      : ["subscriber", "reporter", "moderator", "editor", "publisher", "admin"];
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
        window.alert("Reporter access is granted only after the applicant completes the reporter onboarding steps.");
        return;
      }
      try {
        await apiRequest(`admin/users/${id}/role`, "PATCH", { role: role.value });
        await refresh();
      } catch (error) {
        window.alert(error.message);
        await refresh();
      }
    });
    container.append(role);
    if (row.role === "reporter") {
      rowButton(container, "Update assignment", () => {
        void openReporterAssignmentDialog(row, refresh);
      });
    }
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
    if (["approved", "active"].includes(row.status)) {
      rowButton(container, "Preview / issue agreement", () => void openReporterServiceAgreementIssueDialog(row, refresh));
    }
    if (["pending", "needs_information"].includes(row.status)) {
      rowButton(container, "Review", () => openReporterReviewDialog(row, refresh));
    }
    if (["pending", "needs_information", "rejected"].includes(row.status)) {
      rowButton(container, "Delete application", () => {
        const applicant = row.applicant_name && row.applicant_name !== "—"
          ? row.applicant_name
          : row.email || `application #${id}`;
        void confirmAdminAction(
          "Delete reporter application?",
          `Permanently delete ${applicant}'s ${row.status.replace("_", " ")} application and its private documents? The account itself will remain unchanged. This action cannot be undone.`
        ).then((confirmed) => {
          if (!confirmed) return;
          void runAction(() => apiRequest(`admin/reporter-applications/${id}`, "DELETE"), refresh);
        });
      }, "admin-row-button danger");
    } else {
      container.append(makeElement("small", "admin-row-note", "Deletion is disabled after approval to preserve reporter access and credential history."));
    }
    return;
  }

  if (section === "reporter-directory") {
    rowButton(container, "Assign / reassign", () => void openReporterAssignmentDialog(row, refresh));
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

  if (section === "reporter-credentials" && ["active", "pending_acceptance", "pending acceptance"].includes(row.status)) {
    rowButton(container, "Print / QR", () => {
      const printWindow = window.open(
        proxyUrl(`admin/reporter-credentials/${id}/print`),
        "_blank"
      );
      if (!printWindow) window.alert("Allow pop-ups to open the printable credential.");
      else printWindow.opener = null;
    });
    rowButton(container, "Revoke", () => openCredentialRevokeDialog(id, refresh), "admin-row-button danger");
    return;
  }

  if (section === "reporter-options" && typeof row.is_active === "boolean") {
    const endpoint = row.state_code ? `admin/states/${id}` : `admin/rto-offices/${id}`;
    rowButton(container, row.is_active ? "Deactivate" : "Activate", () =>
      void runAction(() => apiRequest(endpoint, "PATCH", { is_active: !row.is_active }), refresh)
    );
    return;
  }

  if (section === "reporter-types") {
    rowButton(container, "Edit", () => openConfiguredRecordDialog(section, row));
    rowButton(container, row.is_active ? "Deactivate" : "Activate", () =>
      void runAction(() => apiRequest(`admin/reporter-types/${id}`, "PATCH", { is_active: !row.is_active }), refresh)
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
        if (field.pattern) input.pattern = field.pattern;
        if (field.maxLength) input.maxLength = field.maxLength;
        if (field.type === "select") {
          const options = section === "locations"
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
    window.alert(error.message);
  }
}

async function openReporterServiceAgreementIssueDialog(application, refresh) {
  const dialog = document.createElement("dialog");
  dialog.className = "admin-json-dialog";
  const body = makeElement("section", "admin-json-form");
  body.append(
    makeElement("span", "admin-eyebrow", "REPORTER-SPECIFIC SERVICE AGREEMENT"),
    makeElement("h2", "", `Prepare agreement · ${application.applicant_name || application.user?.full_name || application.email || `application #${application.id}`}`),
    makeElement(
      "p",
      "admin-dialog-help",
      "Preview a personalized PDF generated from the current template, verified company details, and this reporter's approved application. Draft templates can be previewed for review, but only a published template can be issued. Issuing does not itself record reporter acceptance."
    )
  );
  const preview = makeElement("button", "admin-secondary-button", "Generate and preview reporter PDF");
  preview.type = "button";
  const publish = makeElement("button", "admin-primary-button", "Issue agreement to reporter");
  publish.type = "button";
  publish.disabled = true;
  const openSetup = makeElement("button", "admin-secondary-button", "Service agreement setup");
  openSetup.type = "button";
  openSetup.addEventListener("click", () => {
    dialog.close();
    void loadSection("reporter-service-agreements");
  });
  const manageCompany = makeElement("button", "admin-secondary-button", "Manage company legal details");
  manageCompany.type = "button";
  manageCompany.addEventListener("click", async () => {
    try {
      const setup = await apiRequest("admin/reporter-options");
      openReporterOrganizationProfileDialog(setup.data?.organization_profile);
    } catch (error) {
      status.textContent = `Company legal details could not be loaded: ${error.message}`;
    }
  });
  const status = makeElement("p", "admin-dialog-help");
  status.setAttribute("role", "status");
  status.textContent = "Generate the personalized PDF, review it, then issue it to this reporter. The reporter must accept this exact document before credentials can be issued.";
  const frame = document.createElement("iframe");
  frame.title = "Personalized reporter service agreement preview";
  frame.hidden = true;
  frame.style.width = "100%";
  frame.style.height = "65vh";
  frame.style.border = "1px solid #d8dde6";
  let previewUrl = "";
  let previewToken = "";
  let previewIsPublished = false;
  preview.addEventListener("click", async () => {
    preview.disabled = true;
    publish.disabled = true;
    previewToken = "";
    previewIsPublished = false;
    frame.hidden = true;
    frame.removeAttribute("src");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = "";
    }
    status.textContent = "Generating a personalized preview from the current template and reporter details…";
    try {
      const response = await fetch(proxyUrl(`admin/reporter-applications/${application.id}/service-agreement/preview`), {
        cache: "no-store"
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(responseMessage(result) || "The personalized agreement preview could not be generated.");
      }
      const token = response.headers.get("X-Preview-Token");
      if (!token) {
        throw new Error("The preview could not be secured for publishing. Generate a new preview.");
      }
      const publishedHeader = response.headers.get("X-Agreement-Published");
      if (publishedHeader === null) {
        throw new Error("The agreement preview service is outdated. Refresh the admin page after the server update is deployed.");
      }
      const pdf = await response.blob();
      if (pdf.type !== "application/pdf") {
        throw new Error("The preview service returned an invalid document. No agreement was published.");
      }
      previewToken = token;
      previewIsPublished = publishedHeader === "true";
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(pdf);
      frame.src = previewUrl;
      frame.hidden = false;
      publish.disabled = !previewIsPublished;
      status.textContent = previewIsPublished
        ? "Preview generated from the published template. Review the PDF above before issuing it to this reporter."
        : "Draft preview only. The template is not published, so this PDF cannot be issued. Finalize the legal terms in Service agreement setup and publish, then generate a fresh preview.";
    } catch (error) {
      status.textContent = `Preview failed: ${error.message}`;
    } finally {
      preview.disabled = false;
    }
  });
  publish.addEventListener("click", async () => {
    if (!previewIsPublished || !previewToken) {
      status.textContent = "Only a preview generated from the currently published template can be issued.";
      publish.disabled = true;
      return;
    }
    publish.disabled = true;
    preview.disabled = true;
    status.textContent = "Issuing the reviewed agreement to the reporter…";
    try {
      await apiRequest(`admin/reporter-applications/${application.id}/service-agreement/publish`, "POST", {
        preview_token: previewToken
      });
      status.textContent = "The personalized agreement was issued and is now available to the reporter.";
      dialog.close();
      await refresh();
    } catch (error) {
      previewToken = "";
      status.textContent = `Publish failed: ${error.message} Generate and review a fresh preview before trying again.`;
      publish.disabled = true;
      preview.disabled = false;
    }
  });
  const close = makeElement("button", "admin-secondary-button", "Close");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  body.append(openSetup, manageCompany, preview, publish, close, status, frame);
  dialog.append(body);
  dialog.addEventListener("close", () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    dialog.remove();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

async function openReporterReviewDialog(application, refresh) {
  try {
    const result = await apiRequest(`admin/reporter-applications/${application.id}/private-details`);
    const privateData = result.data || {};
    const details = privateData.details || {};
    const documents = Array.isArray(privateData.documents) ? privateData.documents : [];
    const requestControls = [];
    openFormDialog(
      "Review reporter application",
      "Review the applicant's details and documents together. Sensitive identity and bank documents are restricted to authorized admins; previews expire shortly. Request field-specific corrections or reuploads when needed.",
      (form) => {
        const decisionLabel = makeElement("label", "admin-form-field");
        decisionLabel.append(makeElement("span", "", "Decision"));
        const decision = document.createElement("select");
        decision.name = "decision";
        [["needs_information", "Request more information"], ["approve", "Approve"], ["reject", "Reject"]].forEach(([value, text]) => {
          decision.append(new Option(text, value));
        });
        decisionLabel.append(decision);
        form.append(decisionLabel);
        addField(form, "Review note", "note", "text", "", { required: false, maxLength: 1000 });

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
        if (payload.review_requests.some((request) => request.instruction.length < 2)) {
          throw new Error("Add a clear instruction to every requested field.");
        }
        await apiRequest(`admin/reporter-applications/${application.id}/review`, "POST", payload);
        await refresh();
      },
      "Save decision"
    );
  } catch (error) {
    window.alert(error.message);
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
    ? ["subscriber", "moderator", "editor", "publisher", "admin", "super_admin"]
    : ["subscriber", "moderator", "editor", "publisher", "admin"];
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
    "Create newsroom account",
    "Create the applicant’s subscriber account first. Reporter access is granted only after the person submits an application and completes every onboarding step.",
    (form) => {
      addField(form, "Full name", "full_name", "text", "", { minLength: 2, maxLength: 120, autocomplete: "name" });
      addField(form, "Email address", "email", "email", "", { maxLength: 254, autocomplete: "email" });
      addField(form, "Phone (optional)", "phone", "tel", "", { required: false, autocomplete: "tel" });
      addRoleField(form);
      addField(form, "Temporary password", "password", "password", "", { minLength: 8, maxLength: 72, autocomplete: "new-password" });
    },
    async (formData) => {
      const payload = Object.fromEntries(formData.entries());
      const result = await apiRequest("admin/users", "POST", payload);
      await loadSection("users");
      window.alert(result.confirmation_required
        ? "Account created. The user must confirm the email before signing in."
        : "Account created successfully.");
    },
    "Create account"
  );
}

async function openReporterAssignmentDialog(user, refresh) {
  let options;
  try {
    options = unwrapData(await apiRequest("admin/reporter-options")) || {};
  } catch (error) {
    window.alert(`Reporter account options could not be loaded: ${error.message}`);
    return;
  }
  const states = (options.states || []).filter((state) => state.is_active);
  const rtos = (options.rtos || []).filter((rto) => rto.is_active);
  const types = (options.reporter_types || []).filter((type) => type.is_active);
  openFormDialog(
    "Update reporter assignment",
    "This changes the RTO and reporter type for an already-onboarded reporter. It does not grant reporter access or bypass the reporter application, service agreement, ID card, or authority-letter steps.",
    (form) => {
      form.append(makeElement("p", "admin-dialog-help", `${user.full_name || user.email} · ${user.email}`));
      const stateSelect = appendReporterSelect(form, "state_id", "State / UT", states,
        (state) => `${state.state_name} (${state.state_code})`);
      const rtoSelect = appendReporterSelect(form, "rto_office_id", "RTO / reporting area", [],
        (rto) => `${rto.rto_code}${rto.city_name ? ` · ${rto.city_name}` : ""}`);
      appendReporterSelect(form, "reporter_type_id", "Reporter type", types,
        (type) => `${type.name} (${type.type_code})`);
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
        rto_office_id: Number(values.get("rto_office_id")),
        reporter_type_id: Number(values.get("reporter_type_id"))
      });
      await refresh();
      window.alert(`Reporter assignment updated. Reporter ID: ${result.data.reporter_code}`);
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
    window.alert(error instanceof Error ? error.message : "Could not sign out.");
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
    document.querySelector("#admin-name").textContent =
      sessionIdentity.name || sessionIdentity.email;
    document.querySelector("#admin-role").textContent =
      String(sessionIdentity.role).replace("_", " ");
    document.querySelector("#admin-avatar").textContent =
      (sessionIdentity.name || sessionIdentity.email || "C").slice(0, 1).toUpperCase();
    await loadSection("overview");
  } catch (error) {
    showPageError(
      error instanceof Error ? error.message : "Admin session could not be checked.",
      loadSession
    );
  }
}

loadSession();
