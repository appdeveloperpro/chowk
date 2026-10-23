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
    description: "Organize published stories into categories.",
    createPath: "admin/categories",
    formFields: [
      { name: "name", label: "Category name", type: "text" },
      { name: "slug", label: "URL slug", type: "text" },
      { name: "is_active", label: "Active", type: "checkbox" }
    ]
  },
  "reporter-applications": {
    path: "admin/reporter-applications",
    description: "Review the full application history, agreement acceptance, and company authorization."
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
    description: "Issue and revoke staff ID cards and reporter authority letters."
  },
  "reporter-agreements": {
    path: "admin/reporter-agreements",
    description: "Publish immutable agreement versions and inspect their document hashes."
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
    related: [
      { label: "Zone / district mapping history", path: "admin/zone-district-mappings" }
    ],
    description: "Maintain the state, zone, district, city, and coverage-area directory.",
    createPath: "admin/locations",
    formFields: [
      { name: "name", label: "Location name", type: "text" },
      { name: "slug", label: "URL slug", type: "text" },
      { name: "location_type", label: "Location level", type: "select", options: ["state", "zone", "district", "city", "coverage_area"] },
      { name: "parent_id", label: "Parent location ID (optional)", type: "number", required: false },
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
  const mapDistrict = makeElement("button", "admin-secondary-button admin-create-button", "Map district to zone");
  mapDistrict.type = "button";
  mapDistrict.disabled = Boolean(results[1]?.error);
  mapDistrict.addEventListener("click", () => {
    if (Array.isArray(results[1]?.data)) {
      openZoneDistrictDialog(locationRecords);
    }
  });
  pageActions(root).append(addLocation, mapDistrict);

  const byId = new Map(locationRecords.map((item) => [String(item.id), item]));
  const locationRows = locationRecords.map((location) => ({
    ...location,
    hierarchy: locationPath(location, byId),
    parent_location: byId.get(String(location.parent_id))?.name || "Top level"
  }));
  reporterPanel(root, "Locations", locationRows, "locations");

  const mappingsResult = results[1];
  const mappingPanel = makeElement("section", "admin-panel");
  const mappingHeader = makeElement("div", "admin-panel-heading");
  mappingHeader.append(makeElement("h2", "", "Zone / district mapping history"));
  if (mappingsResult?.error) {
    mappingPanel.append(mappingHeader, makeElement("p", "admin-empty admin-inline-error", mappingsResult.error));
  } else {
    const mappings = Array.isArray(mappingsResult?.data) ? mappingsResult.data : [];
    const rows = mappings.map((mapping) => ({
      zone: byId.get(String(mapping.zone_id))?.name || "Unavailable zone",
      district: byId.get(String(mapping.district_id))?.name || "Unavailable district",
      valid_from: formatDate(mapping.valid_from),
      valid_to: mapping.valid_to ? formatDate(mapping.valid_to) : "Current",
      id: mapping.id,
      _active: !mapping.valid_to
    }));
    mappingPanel.append(mappingHeader, buildTable(rows, "zone-district-mappings"));
  }
  root.append(mappingPanel);
}

const allowedLocationParents = {
  state: [],
  zone: ["state"],
  district: ["state"],
  city: ["district"],
  coverage_area: ["district", "city"]
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
      reporting_area: [application.rto?.rto_code, application.rto?.city_name].filter(Boolean).join(" · ") || "—",
      reporter_type_name: application.reporter_type?.name || "—"
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
      const locationId = assignment.zone_id || assignment.district_id || assignment.city_id || assignment.coverage_area_id;
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

  if (section === "reporter-agreements") {
    const agreements = Array.isArray(data) ? data : [];
    const rows = agreements.map((agreement) => ({
      version: agreement.version,
      sha256: agreement.sha256,
      document_url: agreement.document_url,
      status: agreement.status,
      published_at: formatDate(agreement.published_at),
      id: agreement.id
    }));
    reporterActionButton(root, "Add agreement version", () => openAgreementDialog());
    reporterPanel(root, "Versioned agreements", rows, section);
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
  const agreements = data.agreements || [];
  const publishedAgreement = agreements.find((agreement) => agreement.status === "published");
  const setupSections = [
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
      key: "agreement",
      title: "Application agreement",
      count: publishedAgreement ? "Ready" : "Required",
      detail: publishedAgreement?.version || "Publish an agreement to accept applications."
    }
  ];
  const overview = makeElement("section", "reporter-setup-overview");
  const overviewHeading = makeElement("div", "reporter-setup-overview-heading");
  overviewHeading.append(
    makeElement("div", "", "REGISTRATION CONFIGURATION"),
    makeElement("p", "", "Choose one setup area to manage. Reporter applicants can only select active options.")
  );
  overview.append(overviewHeading);

  const cards = makeElement("div", "reporter-setup-cards");
  setupSections.forEach((item) => {
    const needsAttention = item.key === "agreement" && !publishedAgreement;
    const card = makeElement("button", `reporter-setup-card${needsAttention ? " needs-attention" : ""}`);
    card.type = "button";
    card.setAttribute("aria-pressed", String(reporterSetupView === item.key));
    card.append(
      makeElement("span", "reporter-setup-card-label", item.title),
      makeElement("strong", "reporter-setup-card-count", String(item.count)),
      makeElement("span", "reporter-setup-card-detail", item.detail),
      makeElement("span", "reporter-setup-card-action", item.key === "agreement"
        ? "Open agreements →"
        : reporterSetupView === item.key ? "Currently open" : "Manage →")
    );
    card.addEventListener("click", () => {
      if (item.key === "agreement") {
        void loadSection("reporter-agreements");
        return;
      }
      reporterSetupView = item.key;
      renderReporterAdminSection("reporter-options", root, data);
    });
    cards.append(card);
  });
  overview.append(cards);

  if (reporterSetupView === "overview") {
    const setupNote = makeElement("div", `reporter-setup-readiness${publishedAgreement ? " is-ready" : " is-incomplete"}`);
    setupNote.append(
      makeElement("strong", "", publishedAgreement ? "Agreement published" : "Applications are not ready"),
      makeElement("span", "", publishedAgreement
        ? "New reporter applications can accept the current agreement."
        : "Publish a reporter agreement before accepting reporter applications.")
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
  }
  header.append(actions);

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
    window.alert(error.message);
  }
}

function openCoverageDialog(data) {
  const staff = (data.staff || []).filter((person) => ["reporter", "moderator", "editor"].includes(person.role));
  const locations = data.locations || [];
  openFormDialog(
    "Assign newsroom coverage",
    "Choose a zone, district, city, or division. Parent-child location assignments and their effective dates are retained in coverage history.",
    (form) => {
      appendReporterSelect(form, "user_id", "Newsroom staff", staff,
        (person) => `${person.full_name || person.email} · ${person.role}`);
      const typeSelect = appendValueSelect(form, "coverage_type", "Coverage level", [
        ["zone", "Zone / region"],
        ["district", "District"],
        ["city", "City"],
        ["coverage_area", "Division"]
      ]);
      const stateSelect = appendReporterSelect(form, "state_id", "State / UT", [], (state) => state.name);
      const districtSelect = appendReporterSelect(form, "district_id", "District", [], (district) => district.name);
      const citySelect = appendReporterSelect(form, "city_id", "City (optional)", [], (city) => city.name, "No city — division belongs to the district");
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
      const setDisabled = (select, disabled) => {
        select.disabled = disabled;
        select.required = !disabled && select.name !== "city_id";
      };
      const refreshLocationChoices = () => {
        const selectedState = stateSelect.value;
        const selectedType = typeSelect.value;
        const districts = locations.filter((location) =>
          location.location_type === "district"
          && location.is_active
          && getStateId(location) === selectedState
        );
        replaceValueOptions(districtSelect, districts, "Choose a district", (district) => district.name);

        const parentDistrictId = districtSelect.value;
        const cities = locations.filter((location) =>
          location.location_type === "city"
          && location.is_active
          && String(location.parent_id) === parentDistrictId
        );
        replaceValueOptions(citySelect, cities, "No city — division belongs to the district", (city) => city.name);

        const eligible = locations.filter((location) => {
          if (!location.is_active) return false;
          if (selectedType === "zone" || selectedType === "district") {
            return location.location_type === selectedType && getStateId(location) === selectedState;
          }
          if (selectedType === "city") {
            return location.location_type === "city" && String(location.parent_id) === parentDistrictId;
          }
          const parentId = citySelect.value || parentDistrictId;
          return location.location_type === "coverage_area" && String(location.parent_id) === parentId;
        });
        replaceValueOptions(targetSelect, eligible, "Choose coverage location", (location) => location.name);
        setDisabled(districtSelect, !selectedState || !["city", "coverage_area"].includes(selectedType));
        setDisabled(citySelect, !selectedState || selectedType !== "coverage_area" || !parentDistrictId);
        districtSelect.required = Boolean(selectedState && ["city", "coverage_area"].includes(selectedType));
        citySelect.required = false;
        setDisabled(targetSelect, !selectedState || (["city", "coverage_area"].includes(selectedType) && !parentDistrictId));
      };
      [typeSelect, stateSelect, districtSelect, citySelect].forEach((select) =>
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

function openZoneDistrictDialog(locations) {
  const statesById = new Map(locations
    .filter((location) => location.location_type === "state")
    .map((location) => [String(location.id), location]));
  const zones = locations.filter((location) => location.location_type === "zone" && location.is_active);
  const districts = locations.filter((location) => location.location_type === "district" && location.is_active);
  if (!zones.length || !districts.length) {
    window.alert("Create an active zone and district under the same state before mapping.");
    return;
  }
  openFormDialog(
    "Map district to zone",
    "A district can have one active zone mapping at a time. Reassigning it ends the previous mapping and keeps its history.",
    (form) => {
      const zoneSelect = appendReporterSelect(form, "zone_id", "Zone / region", zones, (zone) =>
        `${zone.name} · ${statesById.get(String(zone.parent_id))?.name || "State unavailable"}`
      );
      const districtSelect = appendReporterSelect(form, "district_id", "District", [], (district) => district.name);
      const populateDistricts = () => {
        const zone = zones.find((item) => String(item.id) === zoneSelect.value);
        const eligible = districts.filter((district) =>
          String(district.parent_id) === String(zone?.parent_id)
        );
        replaceValueOptions(districtSelect, eligible, "Choose a district", (district) => district.name);
      };
      zoneSelect.addEventListener("change", populateDistricts);
      populateDistricts();
    },
    async (values) => {
      await apiRequest("admin/zone-district-mappings", "POST", {
        zone_id: Number(values.get("zone_id")),
        district_id: Number(values.get("district_id"))
      });
      await loadSection("locations");
    },
    "Map district"
  );
}

function openCredentialDialog(staff) {
  const eligibleStaff = staff.filter((person) => ["reporter", "moderator", "editor"].includes(person.role));
  openFormDialog(
    "Issue staff credential",
    "ID cards are active immediately; authority letters remain pending until the reporter acknowledges them.",
    (form) => {
      const userSelect = appendReporterSelect(form, "user_id", "Staff member", eligibleStaff,
        (person) => `${person.full_name || person.email} · ${person.role}`);
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
        authorityOption.disabled = selectedStaff?.role !== "reporter";
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

function openAgreementDialog() {
  openFormDialog(
    "Add agreement version",
    "The SHA-256 must match the published document exactly. Publishing archives the previous current version; applicants must accept the new version.",
    (form) => {
      addField(form, "Version label", "version", "text", "", { maxLength: 40 });
      const hash = addField(form, "Document SHA-256", "sha256", "text", "");
      hash.pattern = "[a-fA-F0-9]{64}";
      addField(form, "HTTPS document URL", "document_url", "url", "");
    },
    async (values) => {
      await apiRequest("admin/reporter-agreements", "POST", Object.fromEntries(values.entries()));
      await loadSection("reporter-agreements");
    },
    "Add draft"
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
    "RTO codes are 2-8 alphanumeric characters and combine with the state and reporter type codes for reporter IDs.",
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
      ? ["applicant_name", "email", "state_name", "reporting_area", "reporter_type_name", "status", "agreement_version"]
      : section === "reporter-credentials"
        ? ["name", "role", "type", "reference", "status", "scope", "valid_until"]
          : section === "reporter-directory"
            ? ["full_name", "email", "reporter_code", "current_assignment", "assignment_history"]
          : [];
  const keys = [...new Set([
    ...preferredColumns.filter((key) => rows.some((row) => Object.hasOwn(row, key))),
    ...rows.flatMap((row) => Object.keys(row))
  ])]
    .filter((key) => !key.startsWith("_") && !excluded.has(key) && !internalColumns.has(key))
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
    roles.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value.replace("_", " ");
      option.selected = value === row.role;
      role.append(option);
    });
    role.addEventListener("change", async () => {
      if (role.value === "reporter" && row.role !== "reporter") {
        role.value = row.role;
        await openReporterProvisioningDialog(row, refresh);
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
      rowButton(container, "Reporter assignment", () => {
        void openReporterProvisioningDialog(row, refresh);
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
      if (window.confirm(`Delete article ${row.title || id}? This cannot be undone.`)) {
        void runAction(() => apiRequest(`admin/articles/${id}`, "DELETE"), refresh);
      }
    }, "admin-row-button danger");
    return;
  }

  if (section === "categories") {
    const route = `admin/categories/${id}`;
    rowButton(container, "Edit", () => openConfiguredRecordDialog(section, row));
    rowButton(container, "Delete", () => {
      if (window.confirm(`Delete this ${singular(sectionLabels[section]).toLowerCase()}?`)) {
        void runAction(() => apiRequest(route, "DELETE"), refresh);
      }
    }, "admin-row-button danger");
    return;
  }

  if (["locations", "live-streams", "media"].includes(section)) {
    rowButton(container, "Edit", () => openConfiguredRecordDialog(section, row));
    rowButton(container, "Delete", () => {
      if (window.confirm(`Delete "${row.title || row.name || row.id}"? This cannot be undone.`)) {
        void runAction(() => apiRequest(`admin/${section}/${id}`, "DELETE"), refresh);
      }
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
      if (window.confirm("Delete this comment? This cannot be undone.")) {
        void runAction(() => apiRequest(`admin/comments/${id}`, "DELETE"), refresh);
      }
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

  if (section === "zone-district-mappings" && row._active) {
    rowButton(container, "End mapping", () => {
      if (window.confirm("End this zone/district mapping now? Its history will be retained.")) {
        void runAction(() => apiRequest(`admin/zone-district-mappings/${id}/end`, "POST", {}), refresh);
      }
    }, "admin-row-button danger");
    return;
  }

  if (section === "reporter-applications" && row.status === "pending") {
    rowButton(container, "Review", () => openReporterReviewDialog(row, refresh));
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

  if (section === "reporter-agreements" && row.status !== "published") {
    rowButton(container, "Publish", () => {
      if (window.confirm(`Publish agreement version ${row.version}? New applicants must accept it.`)) {
        void runAction(() => apiRequest(`admin/reporter-agreements/${id}/publish`, "POST", {}), refresh);
      }
    });
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
          field.options.forEach((optionValue, index) => {
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
      && location.is_active
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

function openReporterReviewDialog(application, refresh) {
  openFormDialog(
    "Review reporter application",
    "Approval requires accepted agreement and company signatory details. Rejection requires a review note.",
    (form) => {
      const decisionLabel = makeElement("label", "admin-form-field");
      decisionLabel.append(makeElement("span", "", "Decision"));
      const decision = document.createElement("select");
      decision.name = "decision";
      [["approve", "Approve"], ["reject", "Reject"]].forEach(([value, text]) => {
        const option = makeElement("option", "", text);
        option.value = value;
        decision.append(option);
      });
      decisionLabel.append(decision);
      form.append(decisionLabel);
      addField(form, "Review note", "note", "text", "", { required: false, maxLength: 1000 });
      addField(form, "Company signer name", "signer_name", "text", "", { required: false, maxLength: 120 });
      addField(form, "Signer designation", "signer_designation", "text", "", { required: false, maxLength: 120 });
      const acceptLabel = makeElement("label", "admin-form-checkbox");
      const signature = document.createElement("input");
      signature.type = "checkbox";
      signature.name = "signature_accepted";
      acceptLabel.append(signature, makeElement("span", "", "I accept the company signature"));
      form.append(acceptLabel);
      const updateRequirements = () => {
        const approval = decision.value === "approve";
        form.elements.note.required = !approval;
        form.elements.signer_name.required = approval;
        form.elements.signer_designation.required = approval;
        signature.required = approval;
      };
      decision.addEventListener("change", updateRequirements);
      updateRequirements();
      const details = makeElement("section", "admin-application-review-details");
      const user = application.user || {};
      [
        ["Application", `#${application.id} · ${application.status}`],
        ["Applicant", user.full_name || "—"],
        ["Email / phone", [user.email, user.phone].filter(Boolean).join(" · ") || "—"],
        ["Requested coverage", [
          application.state?.state_name,
          application.rto?.rto_code,
          application.rto?.city_name,
          application.reporter_type?.name
        ].filter(Boolean).join(" · ") || "—"],
        ["Agreement", `${application.agreement_version || "—"} · SHA-256 ${application.agreement_sha256 || "—"}`],
        ["Signer", `${application.agreement_signer_name || "—"} · accepted ${formatDate(application.agreement_accepted_at)}`],
        ["Acceptance statement", application.agreement_acceptance_statement || "—"]
      ].forEach(([label, value]) => {
        details.append(makeElement("strong", "", label), makeElement("span", "", value));
      });
      (application.acceptances || []).forEach((receipt) => {
        details.append(
          makeElement("strong", "", `Accepted v${receipt.agreement_version}`),
          makeElement("span", "", `${receipt.signer_name} · ${formatDate(receipt.accepted_at)} · ${receipt.acceptance_statement}`)
        );
      });
      if (application.agreement_document_url) {
        const link = makeElement("a", "", "Open accepted agreement document");
        link.href = application.agreement_document_url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        details.append(link);
      }
      form.prepend(details);
      form.prepend(makeElement("p", "admin-dialog-help", `User ID: ${application.user_id}`));
    },
    async (formData) => {
      const payload = Object.fromEntries(formData.entries());
      payload.signature_accepted = formData.has("signature_accepted");
      await apiRequest(`admin/reporter-applications/${application.id}/review`, "POST", payload);
      await refresh();
    },
    "Submit review"
  );
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
    ? ["subscriber", "reporter", "moderator", "editor", "publisher", "admin", "super_admin"]
    : ["subscriber", "reporter", "moderator", "editor", "publisher", "admin"];
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
  let reporterOptions;
  try {
    reporterOptions = unwrapData(await apiRequest("admin/reporter-options")) || {};
  } catch (error) {
    window.alert(`Reporter account options could not be loaded: ${error.message}`);
    return;
  }

  openFormDialog(
    "Create newsroom account",
    "Reporter accounts require a state, RTO / reporting area, and reporter type. Their reporter ID is generated from that assignment. Other newsroom roles do not need these fields.",
    (form) => {
      addField(form, "Full name", "full_name", "text", "", { minLength: 2, maxLength: 120, autocomplete: "name" });
      addField(form, "Email address", "email", "email", "", { maxLength: 254, autocomplete: "email" });
      addField(form, "Phone (optional)", "phone", "tel", "", { required: false, autocomplete: "tel" });
      const roleSelect = addRoleField(form);
      const reporterFields = makeElement("div", "admin-reporter-fields");
      reporterFields.hidden = roleSelect.value !== "reporter";
      const states = (reporterOptions.states || []).filter((state) => state.is_active);
      const rtos = (reporterOptions.rtos || []).filter((rto) => rto.is_active);
      const types = (reporterOptions.reporter_types || []).filter((type) => type.is_active);
      const stateSelect = appendReporterSelect(reporterFields, "state_id", "State / UT", states,
        (state) => `${state.state_name} (${state.state_code})`);
      const rtoSelect = appendReporterSelect(reporterFields, "rto_office_id", "RTO / reporting area", [],
        (rto) => `${rto.rto_code}${rto.city_name ? ` · ${rto.city_name}` : ""}`);
      const typeSelect = appendReporterSelect(reporterFields, "reporter_type_id", "Reporter type", types,
        (type) => `${type.name} (${type.type_code})`);
      const reporterInputs = [stateSelect, rtoSelect, typeSelect];
      const updateReporterFields = () => {
        const enabled = roleSelect.value === "reporter";
        reporterFields.hidden = !enabled;
        reporterInputs.forEach((input) => {
          input.disabled = !enabled;
          input.required = enabled;
        });
      };
      const updateRtos = () => {
        const stateId = stateSelect.value;
        const eligibleRtos = rtos.filter((rto) => String(rto.state_id) === stateId);
        replaceValueOptions(rtoSelect, eligibleRtos, "Choose an RTO / reporting area", (rto) =>
          `${rto.rto_code}${rto.city_name ? ` · ${rto.city_name}` : ""}`
        );
      };
      stateSelect.addEventListener("change", updateRtos);
      roleSelect.addEventListener("change", updateReporterFields);
      updateReporterFields();
      reporterFields.append(makeElement("p", "admin-dialog-help", "The reporter ID is assigned after account creation and is retained when the reporter changes assignment."));
      form.append(reporterFields);
      addField(form, "Temporary password", "password", "password", "", { minLength: 8, maxLength: 72, autocomplete: "new-password" });
    },
    async (formData) => {
      const payload = Object.fromEntries(formData.entries());
      if (payload.role === "reporter") {
        ["state_id", "rto_office_id", "reporter_type_id"].forEach((field) => {
          payload[field] = Number(payload[field]);
        });
      }
      const result = await apiRequest("admin/users", "POST", payload);
      await loadSection("users");
      window.alert(result.confirmation_required
        ? `Account created. The user must confirm the email before signing in.${result.data?.reporter_code ? ` Reporter ID: ${result.data.reporter_code}` : ""}`
        : `Account created successfully.${result.data?.reporter_code ? ` Reporter ID: ${result.data.reporter_code}` : ""}`);
    },
    "Create account"
  );
}

async function openReporterProvisioningDialog(user, refresh) {
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
    "Provision reporter account",
    "A reporter role is granted only with an active state, matching RTO / reporting area, and reporter type. A stable reporter ID will be generated.",
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
      const result = await apiRequest(`admin/users/${user.id}/reporter-provisioning`, "POST", {
        state_id: Number(values.get("state_id")),
        rto_office_id: Number(values.get("rto_office_id")),
        reporter_type_id: Number(values.get("reporter_type_id"))
      });
      await refresh();
      window.alert(`Reporter account provisioned. Reporter ID: ${result.data.reporter_code}`);
    },
    "Provision reporter"
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
    await action();
    await reload();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "The action could not be completed.");
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
