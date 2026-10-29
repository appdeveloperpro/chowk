const message = document.querySelector("#organization-workflow-message");
const content = document.querySelector("#organization-workflow-content");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

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
    window.location.replace("/auth?mode=login&next=%2Forganization-workflows");
    throw new Error("Sign in to access organization workflows.");
  }
  if (!response.ok) throw new Error(result.error || "Organization workflow request failed.");
  return result;
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.dataset.error = String(isError);
  message.hidden = false;
}

async function loadWorkflows() {
  message.hidden = false;
  content.replaceChildren();
  try {
    const result = await request("/api/organization/workflows");
    renderWorkflows(result.data || {});
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Workflows could not be loaded.", true);
  }
}

function renderWorkflows(data) {
  message.hidden = true;
  const workflows = data.workflows || [];
  const approvals = data.approvals || [];
  const page = element("div", "organization-workflow-page");

  if (approvals.length) {
    const approvalPanel = element("section", "organization-model-panel");
    approvalPanel.append(element("h2", "", "Approval inbox"));
    approvals.forEach((approval) => approvalPanel.append(renderApproval(approval)));
    page.append(approvalPanel);
  }

  const workflowPanel = element("section", "organization-model-panel");
  workflowPanel.append(element("h2", "", "Available workflows"));
  if (!workflows.length) {
    workflowPanel.append(element("p", "", "No workflows are currently available to start with your permissions."));
  }
  workflows.forEach((workflow) => workflowPanel.append(renderWorkflow(workflow)));
  page.append(workflowPanel);
  content.replaceChildren(page);
}

function renderWorkflow(workflow) {
  const card = element("article", "organization-record-card");
  card.append(element("h3", "", workflow.name));
  card.append(element("p", "organization-record-meta",
    `${workflow.module_key} · starts in ${workflow.initial_state_label}`));
  if (workflow.description) card.append(element("p", "", workflow.description));
  const actions = element("div", "organization-record-actions");
  const subjectType = document.createElement("input");
  subjectType.placeholder = "Subject type (e.g. leave_request)";
  subjectType.maxLength = 80;
  subjectType.setAttribute("aria-label", `${workflow.name} subject type`);
  const subjectId = document.createElement("input");
  subjectId.placeholder = "Subject ID";
  subjectId.maxLength = 200;
  subjectId.setAttribute("aria-label", `${workflow.name} subject ID`);
  const start = element("button", "organization-action is-primary", "Start workflow");
  start.type = "button";
  start.addEventListener("click", async () => {
    if (!subjectType.value.trim() || !subjectId.value.trim()) {
      showMessage("Enter the subject type and subject ID before starting this workflow.", true);
      return;
    }
    try {
      await request(`/api/organization/workflows/${workflow.id}/start`, "POST", {
        subject_type: subjectType.value.trim(),
        subject_id: subjectId.value.trim()
      });
      await loadWorkflows();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Workflow could not be started.", true);
    }
  });
  actions.append(subjectType, subjectId, start);
  card.append(actions);
  const instances = element("div", "organization-workflow-instances");
  const list = element("button", "organization-action", "Load my workflow instances");
  list.type = "button";
  list.addEventListener("click", async () => {
    list.disabled = true;
    try {
      const result = await request(`/api/organization/workflows/${workflow.id}/instances`);
      instances.replaceChildren();
      if (!result.data?.length) {
        instances.append(element("p", "", "No workflow instances are visible."));
      } else {
        result.data.forEach((instance) => instances.append(renderInstance(instance)));
      }
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Workflow instances could not be loaded.", true);
    } finally {
      list.disabled = false;
    }
  });
  card.append(list, instances);
  return card;
}

function renderInstance(instance) {
  const row = element("article", "organization-record-card");
  row.append(element("h3", "", `${instance.subject_type} · ${instance.subject_id}`));
  row.append(element("p", "organization-record-meta",
    `${instance.state_label} · revision ${instance.revision} · updated ${new Date(instance.updated_at).toLocaleString()}`));
  const actions = element("div", "organization-record-actions");
  (instance.available_transitions || []).forEach((transition) => {
    const button = element("button", "organization-action", transition.label);
    button.type = "button";
    button.addEventListener("click", async () => {
      let reason = "";
      if (transition.requires_reason || transition.requires_approval) {
        reason = window.prompt("Enter a reason for this workflow action.") || "";
        if (transition.requires_reason && reason.trim().length < 2) return;
      } else if (!window.confirm(`Continue with "${transition.label}"?`)) {
        return;
      }
      button.disabled = true;
      try {
        const result = await request(`/api/organization/workflow-instances/${instance.id}/transitions`, "POST", {
          transition_id: transition.id,
          expected_revision: instance.revision,
          reason: reason.trim()
        });
        if (result.data?.status === "approval_pending") {
          showMessage("Approval requested. The workflow will advance after an authorized person approves it.");
        }
        await loadWorkflows();
      } catch (error) {
        showMessage(error instanceof Error ? error.message : "Workflow action failed.", true);
      } finally {
        button.disabled = false;
      }
    });
    actions.append(button);
  });
  if (actions.childElementCount) row.append(actions);
  return row;
}

function renderApproval(approval) {
  const card = element("article", "organization-record-card");
  card.append(element("h3", "", `${approval.workflow_name} · ${approval.subject_type} ${approval.subject_id}`));
  card.append(element("p", "organization-record-meta",
    `${approval.from_state} → ${approval.to_state} · requested by ${approval.requested_by || "organization user"}`));
  if (approval.request_reason) card.append(element("p", "", `Reason: ${approval.request_reason}`));
  card.append(element("p", "organization-record-meta", `Pending since ${new Date(approval.created_at).toLocaleString()}`));
  const reason = document.createElement("input");
  reason.placeholder = "Decision note (optional)";
  reason.maxLength = 2000;
  reason.setAttribute("aria-label", "Decision note");
  const actions = element("div", "organization-record-actions");
  [
    ["Approve", true, "organization-action is-primary"],
    ["Reject", false, "organization-action"]
  ].forEach(([label, approve, className]) => {
    const button = element("button", className, label);
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await request(`/api/organization/workflow-approvals/${approval.id}/decision`, "POST", {
          approve,
          expected_revision: approval.revision,
          reason: reason.value.trim()
        });
        await loadWorkflows();
      } catch (error) {
        showMessage(error instanceof Error ? error.message : "Approval decision failed.", true);
      } finally {
        button.disabled = false;
      }
    });
    actions.append(button);
  });
  card.append(reason, actions);
  return card;
}

void loadWorkflows();
