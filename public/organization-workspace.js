const message = document.querySelector("#organization-message");
const modelNav = document.querySelector("#organization-model-nav");
const modelContent = document.querySelector("#organization-model-content");

let models = [];
let selectedModelId = null;
let records = [];

async function request(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.replace("/auth?mode=login&next=%2Forganization");
    throw new Error("Sign in to open your organization workspace.");
  }
  if (!response.ok) throw new Error(result.error || "Organization request failed.");
  return result;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.dataset.error = String(isError);
  message.hidden = false;
}

async function loadWorkspace() {
  try {
    const result = await request("/api/employee/org-models");
    modelsSnapshotCanConfigure = result.data?.can_configure === true;
    models = (result.data?.models || []).filter((model) => model.is_active);
    modelNav.replaceChildren();
    modelNav.hidden = models.length === 0;
    if (!models.length) {
      modelContent.hidden = true;
      setMessage("No organization models are currently assigned to your employee role.");
      return;
    }
    if (!models.some((model) => model.id === selectedModelId)) {
      selectedModelId = models[0].id;
    }
    models.forEach((model) => {
      const tab = element("button", "organization-model-tab", model.name);
      tab.type = "button";
      tab.setAttribute("aria-pressed", String(model.id === selectedModelId));
      tab.addEventListener("click", () => {
        selectedModelId = model.id;
        void renderSelectedModel();
      });
      modelNav.append(tab);
    });
    await renderSelectedModel();
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "Organization models could not be loaded.", true);
  }
}

async function renderSelectedModel() {
  const model = models.find((item) => item.id === selectedModelId);
  if (!model) return;
  [...modelNav.children].forEach((tab, index) => {
    tab.setAttribute("aria-pressed", String(models[index]?.id === model.id));
  });
  message.hidden = true;
  modelContent.hidden = false;
  modelContent.replaceChildren();
  const panel = element("section", "organization-model-panel");
  panel.append(element("h2", "", model.name));
  if (model.description) panel.append(element("p", "", model.description));
  const capabilities = model.actions || [];
  const hasRead = capabilities.includes("read") || Boolean(modelsSnapshotCanConfigure);
  const canCreate = capabilities.includes("create") || Boolean(modelsSnapshotCanConfigure);
  let addRecord;
  if (canCreate) {
    addRecord = element("button", "organization-action is-primary", "New record");
    addRecord.type = "button";
    addRecord.addEventListener("click", () => openRecordDialog(model, null));
    panel.append(addRecord);
  }
  const list = element("div", "organization-record-list");
  panel.append(list);
  modelContent.append(panel);
  if (!hasRead) {
    list.append(element("p", "", "You can create records, but this role does not include permission to view the record list."));
    return;
  }
  try {
    const result = await request(`/api/employee/org-models/${model.id}/records`);
    records = result.data || [];
    if (!records.length) {
      list.append(element("p", "", "No records are available in this scope yet."));
      return;
    }
    records.forEach((record) => list.append(renderRecord(model, record)));
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "Records could not be loaded.", true);
  }
}

let modelsSnapshotCanConfigure = false;

function renderRecord(model, record) {
  const card = element("article", "organization-record-card");
  const titleField = (model.fields || []).find((field) =>
    field.is_active && record.data?.[field.field_key] !== undefined);
  const heading = titleField
    ? String(record.data[titleField.field_key])
    : `${model.name} record`;
  card.append(element("h3", "", heading));
  card.append(element("p", "organization-record-meta",
    `Status: ${record.status} · Owner: ${record.owner_name || "Employee"} · Updated ${new Date(record.updated_at).toLocaleString()}`));
  const values = element("div", "organization-record-values");
  (model.fields || []).filter((field) => field.is_active && record.data?.[field.field_key] !== undefined)
    .forEach((field) => {
      const item = element("div");
      item.append(element("strong", "", field.label));
      const value = record.data[field.field_key];
      item.append(element("span", "", typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? "—")));
      values.append(item);
    });
  card.append(values);
  const actions = element("div", "organization-record-actions");
  if (record.can_update) {
    const edit = element("button", "organization-action", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => openRecordDialog(model, record));
    actions.append(edit);
  }
  (record.available_transitions || []).forEach((transition) => {
    const button = element("button", "organization-action", transition.label);
    button.type = "button";
    button.addEventListener("click", () => void runTransition(record, transition));
    actions.append(button);
  });
  if (record.can_delete) {
    const remove = element("button", "organization-action", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => void deleteRecord(record));
    actions.append(remove);
  }
  const history = element("details", "organization-history");
  const summary = element("summary", "", "Record history");
  history.append(summary);
  history.addEventListener("toggle", () => {
    if (history.open && history.dataset.loaded !== "true") {
      history.dataset.loaded = "true";
      void loadRecordHistory(history, record.id);
    }
  });
  card.append(actions, history);
  return card;
}

function openRecordDialog(model, record) {
  const dialog = element("dialog", "organization-record-dialog");
  const form = element("form", "organization-record-form");
  form.method = "dialog";
  form.append(element("h2", "", record ? `Edit ${model.name}` : `New ${model.name} record`));
  const controls = new Map();
  (model.fields || []).filter((field) => field.is_active).forEach((field) => {
    const label = element("label", "", `${field.label}${field.is_required ? " *" : ""}`);
    let input;
    if (field.field_type === "long_text") {
      input = document.createElement("textarea");
      input.rows = 4;
    } else if (field.field_type === "select") {
      input = document.createElement("select");
      if (!field.is_required) input.append(new Option("Choose an option", ""));
      (field.options || []).forEach((optionValue) => input.append(new Option(optionValue, optionValue)));
    } else {
      input = document.createElement("input");
      input.type = field.field_type === "text" ? "text"
        : field.field_type === "number" ? "number"
          : field.field_type === "date" ? "date"
            : field.field_type === "boolean" ? "checkbox"
              : field.field_type;
      if (field.field_type === "number") input.step = "any";
    }
    input.name = field.field_key;
    input.required = field.is_required;
    const value = record?.data?.[field.field_key];
    if (field.field_type === "boolean") input.checked = value === true;
    else input.value = value === undefined || value === null ? "" : String(value);
    controls.set(field.field_key, { input, field });
    label.append(input);
    form.append(label);
  });
  const error = element("p", "organization-record-dialog-error");
  error.hidden = true;
  error.setAttribute("role", "alert");
  const actions = element("div", "organization-record-dialog-actions");
  const cancel = element("button", "organization-action", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  const save = element("button", "organization-action is-primary", "Save");
  save.type = "submit";
  actions.append(cancel, save);
  form.append(error, actions);
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    save.disabled = true;
    const data = {};
    controls.forEach(({ input, field }, key) => {
      if (field.field_type === "boolean") data[key] = input.checked;
      else if (input.value === "" && !field.is_required) data[key] = null;
      else if (field.field_type === "number") data[key] = Number(input.value);
      else data[key] = input.value;
    });
    try {
      const path = record
        ? `/api/employee/org-model-records/${record.id}`
        : `/api/employee/org-models/${model.id}/records`;
      await request(path, record ? "PATCH" : "POST", {
        model_id: model.id, data, revision: record?.revision
      });
      dialog.close();
      await renderSelectedModel();
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : "The record could not be saved.";
      error.hidden = false;
    } finally {
      save.disabled = false;
    }
  });
  dialog.showModal();
}

async function runTransition(record, transition) {
  if (!window.confirm(`Continue with "${transition.label}"?`)) return;
  try {
    await request(`/api/employee/org-model-records/${record.id}/transitions`, "POST", {
      transition_id: transition.id, revision: record.revision
    });
    await renderSelectedModel();
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "The workflow action failed.", true);
  }
}

async function deleteRecord(record) {
  if (!window.confirm("Permanently delete this record? Its immutable audit history will be retained.")) return;
  try {
    await request(`/api/employee/org-model-records/${record.id}`, "DELETE");
    await renderSelectedModel();
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "The record could not be deleted.", true);
  }
}

async function loadRecordHistory(container, recordId) {
  try {
    const result = await request(`/api/employee/org-model-records/${recordId}/history`);
    const events = result.data || [];
    if (!events.length) {
      container.append(element("p", "", "No history is available."));
      return;
    }
    events.forEach((event) => {
      const entry = element("div");
      entry.append(element("strong", "",
        `${event.event_type} · ${event.actor_name || "System"} · ${new Date(event.created_at).toLocaleString()}`));
      if (event.from_status || event.to_status) {
        entry.append(element("p", "", `${event.from_status || "—"} → ${event.to_status || "—"} · revision ${event.revision}`));
      }
      const snapshot = element("pre");
      snapshot.textContent = JSON.stringify(event.data_snapshot, null, 2);
      entry.append(snapshot);
      container.append(entry);
    });
  } catch (error) {
    container.append(element("p", "", error instanceof Error ? error.message : "History could not be loaded."));
  }
}

void loadWorkspace();
