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
    createBody: { title: "", slug: "", excerpt: "", content: "", category_id: null, status: "draft" }
  },
  users: {
    path: "admin/users",
    description: "Review account profiles and change roles using the protected Supabase role function."
  },
  categories: {
    path: "admin/categories",
    description: "Organize published stories into categories.",
    createPath: "admin/categories",
    createBody: { name: "", slug: "" }
  }
};

let activeSection = "overview";
let sessionIdentity = null;
let overviewData = null;

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
        return { ...item, data: unwrapData(await apiRequest(item.path)) };
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

  if (config.createPath) {
    const button = makeElement("button", "admin-primary-button admin-create-button", `Add ${singular(label)}`);
    button.type = "button";
    button.addEventListener("click", () =>
      openJsonDialog(`Add ${singular(label)}`, config.createBody || {}, async (value) => {
        await apiRequest(config.createPath, "POST", value);
        await loadSection(section);
      })
    );
    root.append(button);
  }
  results.forEach((result) => {
    const panel = makeElement("section", "admin-panel");
    const header = makeElement("div", "admin-panel-heading");
    header.append(makeElement("h2", "", result.label));
    if (result.error) {
      const errorPanel = makeElement("section", "admin-panel");
      const errorHeader = makeElement("div", "admin-panel-heading");
      errorHeader.append(makeElement("h2", "", result.label));
      errorPanel.append(errorHeader);
      errorPanel.append(makeElement("p", "admin-empty admin-inline-error", result.error));
      root.append(errorPanel);
      return;
    }
    const rows = rowsFromData(result.data, result.label);
    header.append(makeElement("span", "", `${rows.length} records`));
    panel.append(header);
    panel.append(buildTable(rows, section));
    root.append(panel);
  });
  content.replaceChildren(root);
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
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    .filter((key) => !key.startsWith("_") && !excluded.has(key))
    .slice(0, 5);
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
  const id = String(row.id ?? row.application_id ?? row.credential_id ?? "");
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
    ["subscriber", "reporter", "editor", "admin", "super_admin"].forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value.replace("_", " ");
      option.selected = value === row.role;
      role.append(option);
    });
    role.addEventListener("change", async () => {
      try {
        await apiRequest(`admin/users/${id}/role`, "PATCH", { role: role.value });
        await refresh();
      } catch (error) {
        window.alert(error.message);
        await refresh();
      }
    });
    container.append(role);
    return;
  }

  if (section === "articles") {
    if (row.status !== "published") {
      rowButton(container, "Publish", () =>
        void runAction(() => apiRequest(`admin/articles/${id}/publish`, "POST", {}), refresh)
      );
    }
    rowButton(container, "Edit", async () => {
      try {
        openJsonDialog(`Edit article ${id}`, row, async (value) => {
          await apiRequest(`admin/articles/${id}`, "PATCH", value);
          await refresh();
        });
      } catch (error) {
        window.alert(error.message);
      }
    });
    rowButton(container, "Delete", () => {
      if (window.confirm(`Delete article ${row.title || id}? This cannot be undone.`)) {
        void runAction(() => apiRequest(`admin/articles/${id}`, "DELETE"), refresh);
      }
    }, "admin-row-button danger");
    return;
  }

  if (section === "categories") {
    const route = {
      categories: `admin/categories/${id}`
    }[section];
    rowButton(container, "Edit JSON", () =>
      openJsonDialog(`Edit ${singular(sectionLabels[section])}`, row, async (value) => {
        await apiRequest(route, "PATCH", value);
        await refresh();
      })
    );
    rowButton(container, "Delete", () => {
      if (window.confirm(`Delete this ${singular(sectionLabels[section]).toLowerCase()}?`)) {
        void runAction(() => apiRequest(route, "DELETE"), refresh);
      }
    }, "admin-row-button danger");
    return;
  }

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
