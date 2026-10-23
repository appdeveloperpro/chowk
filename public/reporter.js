const sessionPanel = document.querySelector("#reporter-session");
const applicationPanel = document.querySelector("#reporter-application");
const statusPanel = document.querySelector("#reporter-status");
const credentialsPanel = document.querySelector("#reporter-credentials");
const messagePanel = document.querySelector("#reporter-message");

let identity = null;
let options = null;
let reporterData = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function showMessage(text, success = false) {
  messagePanel.textContent = text;
  messagePanel.classList.toggle("success", success);
  messagePanel.hidden = false;
  messagePanel.scrollIntoView({ behavior: "smooth", block: "center" });
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
    window.location.replace("/auth?mode=login");
    throw new Error("Sign in to access your reporter account.");
  }
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
  return result;
}

function addField(form, labelText, name, type, value = "", required = true) {
  const label = element("label", "reporter-field");
  label.append(element("span", "", labelText));
  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  input.required = required;
  if (value !== null && value !== undefined) input.value = String(value);
  label.append(input);
  form.append(label);
  return input;
}

function addSelect(form, name, labelText, values, selected, placeholder) {
  const label = element("label", "reporter-field");
  label.append(element("span", "", labelText));
  const select = document.createElement("select");
  select.name = name;
  select.required = true;
  const first = element("option", "", placeholder);
  first.value = "";
  first.disabled = true;
  first.selected = !selected;
  select.append(first);
  values.forEach((value) => {
    const option = element("option", "", value.label);
    option.value = String(value.id);
    option.selected = String(value.id) === String(selected);
    select.append(option);
  });
  label.append(select);
  form.append(label);
  return select;
}

function addAgreement(root, agreement, signerName) {
  const box = element("section", "reporter-agreement");
  box.append(element("strong", "", `Reporter agreement · Version ${agreement.version}`));
  const link = element("a", "", "Open the full agreement");
  link.href = agreement.document_url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  box.append(link);
  box.append(element("span", "", `Document SHA-256: ${agreement.sha256}`));
  const signer = addField(box, "Your full legal name (agreement signer)", "signer_name", "text", signerName);
  signer.autocomplete = "name";
  signer.minLength = 2;
  const acceptance = document.createElement("label");
  acceptance.className = "reporter-check";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "accepted";
  checkbox.required = true;
  acceptance.append(
    checkbox,
    element("span", "", "I have read this agreement, am eligible to apply, and accept its terms for this application.")
  );
  box.append(acceptance);
  return box;
}

function renderApplicationForm(existing) {
  applicationPanel.replaceChildren();
  applicationPanel.hidden = false;
  applicationPanel.append(
    element("h2", "", existing ? "Accept the current agreement" : "Apply to become a Chowk reporter"),
    element("p", "reporter-card-copy", existing
      ? "The published agreement has changed. Read and accept the current version to keep your pending application eligible for review."
      : "Your account remains a subscriber while the application is pending. Admin review and approval are required before reporter access is granted.")
  );
  if (!options?.agreement) {
    applicationPanel.append(element("p", "reporter-empty", "Reporter applications are temporarily closed because no agreement version is published. Please check back later."));
    return;
  }

  const form = element("form", "reporter-form-grid");
  if (!existing) {
    const states = (options.states || []).map((state) => ({ id: state.id, label: `${state.state_name} (${state.state_code})` }));
    const stateSelect = addSelect(form, "state_id", "State", states, "", "Choose a state");
    const rtoSelect = addSelect(form, "rto_office_id", "RTO / reporting area", [], "", "Choose a state first");
    const types = (options.types || []).map((type) => ({ id: type.id, label: `${type.name} (${type.type_code})` }));
    addSelect(form, "reporter_type_id", "Reporter type", types, "", "Choose reporter type");
    stateSelect.addEventListener("change", () => {
      const eligible = (options.rtos || []).filter((rto) =>
        String(rto.state_id) === stateSelect.value
      );
      rtoSelect.replaceChildren();
      const placeholder = element("option", "", eligible.length ? "Choose an RTO" : "No active RTOs for this state");
      placeholder.value = "";
      placeholder.disabled = true;
      placeholder.selected = true;
      rtoSelect.append(placeholder);
      eligible.forEach((rto) => {
        const option = element("option", "", `${rto.rto_code}${rto.city_name ? ` · ${rto.city_name}` : ""}`);
        option.value = String(rto.id);
        rtoSelect.append(option);
      });
    });
  }

  form.classList.add("reporter-form-grid");
  form.append(addAgreement(element("div"), options.agreement, identity.full_name || identity.name));
  const agreementBox = form.lastElementChild;
  agreementBox.classList.add("full-width");
  const submit = element("button", "reporter-button", existing ? "Accept current agreement" : "Submit reporter application");
  submit.type = "submit";
  form.append(submit);
  applicationPanel.append(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    submit.textContent = "Submitting…";
    const values = new FormData(form);
    const payload = {
      agreement_version: options.agreement.version,
      agreement_sha256: options.agreement.sha256,
      signer_name: String(values.get("signer_name") || "").trim(),
      acceptance_statement: "I have read and accept the Chowk reporter agreement."
    };
    try {
      if (existing) {
        await request("/api/reporter/agreement/accept", "POST", payload);
      } else {
        payload.state_id = values.get("state_id");
        payload.rto_office_id = values.get("rto_office_id");
        payload.reporter_type_id = values.get("reporter_type_id");
        await request("/api/reporter/applications", "POST", payload);
      }
      showMessage(existing ? "Your agreement acceptance was recorded." : "Your reporter application was submitted.", true);
      await loadReporterDesk();
    } catch (error) {
      showMessage(error.message);
    } finally {
      submit.disabled = false;
      submit.textContent = existing ? "Accept current agreement" : "Submit reporter application";
    }
  });
}

function dataItem(label, value, code = false) {
  const item = element("div", "reporter-data-item");
  item.append(element("span", "", label), element("strong", code ? "reporter-code" : "", value || "—"));
  return item;
}

function renderStatus() {
  statusPanel.replaceChildren();
  statusPanel.hidden = false;
  const application = reporterData.application;
  const reporter = reporterData.reporter;
  if (!application && !reporter) {
    if (identity.role === "subscriber") {
      statusPanel.hidden = true;
      renderApplicationForm(null);
    } else {
      statusPanel.append(
        element("h2", "", "Reporter access is not assigned"),
        element("p", "reporter-card-copy", "Reporter applications are available to subscriber accounts. Contact an administrator if you need newsroom access.")
      );
      applicationPanel.hidden = true;
    }
    return;
  }
  statusPanel.append(element("h2", "", reporter ? "Reporter profile" : "Application status"));
  if (application) {
    const status = element("span", `reporter-status-pill ${application.status}`, application.status);
    statusPanel.append(status);
    const details = element("div", "reporter-data-grid");
    details.append(
      dataItem("Submitted", formatDate(application.created_at)),
      dataItem("Requested state", `${application.state?.state_name || "—"} (${application.state?.state_code || ""})`),
      dataItem("RTO / reporting area", `${application.rto?.rto_code || "—"} ${application.rto?.city_name || ""}`),
      dataItem("Reporter type", `${application.reporter_type?.name || "—"} (${application.reporter_type?.type_code || ""})`),
      dataItem("Agreement", application.agreement_version || "—"),
      dataItem("Agreement accepted", formatDate(application.agreement_accepted_at)),
      dataItem("Review completed", formatDate(application.reviewed_at)),
      dataItem("Reviewed by", application.reviewer_name || "—"),
      dataItem("Company signer", application.company_signer_name || "—")
    );
    statusPanel.append(details);
    const acceptances = Array.isArray(application.acceptances) ? application.acceptances : [];
    if (acceptances.length) {
      statusPanel.append(element("h3", "", "Agreement acceptance history"));
      const history = element("div", "reporter-data-grid");
      acceptances.forEach((receipt) => {
        history.append(dataItem(
          `Version ${receipt.agreement_version} · ${formatDate(receipt.accepted_at)}`,
          `${receipt.signer_name} · ${receipt.acceptance_statement} · SHA-256 ${receipt.agreement_sha256}`
        ));
      });
      statusPanel.append(history);
    }
    if (application.review_note) {
      statusPanel.append(element("h3", "", application.status === "rejected" ? "Review reason" : "Review note"));
      statusPanel.append(element("p", "reporter-card-copy", application.review_note));
    }
  }
  if (reporter) {
    const details = element("div", "reporter-data-grid");
    details.append(dataItem("Reporter ID", reporter.reporter_code, true));
    statusPanel.append(details);
    if (Array.isArray(reporter.assignments) && reporter.assignments.length) {
      statusPanel.append(element("h3", "", "Reporter assignment history"));
      const history = element("div", "reporter-data-grid");
      reporter.assignments.forEach((assignment) => {
        history.append(dataItem(
          `${assignment.type_name} · ${assignment.effective_to ? "Past assignment" : "Current assignment"}`,
          `${assignment.state_name || ""} ${assignment.rto_code || ""} ${assignment.city_name || ""} · ${formatDate(assignment.effective_from)} – ${assignment.effective_to ? formatDate(assignment.effective_to) : "Current"}`
        ));
      });
      statusPanel.append(history);
    }
  }
  const needsAgreement = application?.status === "pending" &&
    options.agreement &&
    (application.agreement_version !== options.agreement.version ||
      application.agreement_sha256 !== options.agreement.sha256);
  if (needsAgreement) renderApplicationForm(application);
  else if (application?.status === "rejected") renderApplicationForm(null);
  else applicationPanel.hidden = true;
}

function renderCredentials() {
  credentialsPanel.replaceChildren(element("h2", "", "Staff credentials"));
  const credentials = Array.isArray(reporterData.credentials) ? reporterData.credentials : [];
  if (!credentials.length) {
    credentialsPanel.append(element("p", "reporter-empty", "No staff ID card or authority letter has been issued to this account."));
  }
  credentials.forEach((credential) => {
    const card = element("article", "reporter-credential");
    const header = element("div", "reporter-credential-header");
    header.append(
      element("h3", "", credential.credential_type === "id_card" ? "Staff ID card" : "Reporter authority letter"),
      element("span", `reporter-status-pill ${credential.status}`, credential.status.replace("_", " "))
    );
    card.append(header);
    const values = element("div", "reporter-data-grid");
    values.append(
      dataItem("Reference", credential.reference_code, true),
      dataItem("Valid from", formatDate(credential.valid_from)),
      dataItem("Valid until", formatDate(credential.valid_until)),
      dataItem("Reporter ID", credential.scope?.reporter_type
        ? reporterData.reporter?.reporter_code
        : reporterData.reporter?.reporter_code || "—"),
      dataItem("Scope", [
        credential.scope?.state_name,
        credential.scope?.rto_code,
        credential.scope?.city_name
      ].filter(Boolean).join(" · ") || "—")
    );
    card.append(values);
    const actions = element("div", "reporter-credential-actions");
    const verify = element("a", "", "Verify credential");
    verify.href = `/credential?token=${encodeURIComponent(credential.verification_token)}`;
    verify.target = "_blank";
    verify.rel = "noopener noreferrer";
    actions.append(verify);
    if (credential.credential_type === "authority_letter" && credential.status === "pending_acceptance") {
      const form = element("form", "reporter-credential-actions");
      const typedName = addField(form, "Type your account name to acknowledge", "typed_name", "text", "", true);
      typedName.autocomplete = "name";
      const acknowledge = element("button", "reporter-button", "Acknowledge");
      acknowledge.type = "submit";
      form.append(acknowledge);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        acknowledge.disabled = true;
        try {
          await request(`/api/reporter/credentials/${credential.id}/acknowledge`, "POST", {
            typed_name: typedName.value.trim()
          });
          showMessage("Authority letter acknowledged.", true);
          await loadReporterDesk();
        } catch (error) {
          showMessage(error.message);
        } finally {
          acknowledge.disabled = false;
        }
      });
      card.append(form);
    }
    actions.append(makeElement("span", "", `Issued ${formatDate(credential.issued_at)}`));
    card.append(actions);
    credentialsPanel.append(card);
  });
  credentialsPanel.hidden = false;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function loadReporterDesk() {
  try {
    const sessionResult = await request("/api/auth/session");
    identity = sessionResult.identity;
    sessionPanel.className = "reporter-card";
    sessionPanel.replaceChildren(
      element("h2", "", `Welcome, ${identity.name || identity.email}`),
      element("p", "reporter-card-copy", `Account role: ${identity.role}. Reporter applications are reviewed by Chowk administrators.`)
    );
    const [optionResult, statusResult] = await Promise.all([
      request("/api/reporter/options"),
      request("/api/reporter/status")
    ]);
    options = optionResult.data || {};
    reporterData = statusResult.data || {};
    renderStatus();
    renderCredentials();
  } catch (error) {
    sessionPanel.className = "reporter-card";
    sessionPanel.replaceChildren(
      element("h2", "", "Sign in to continue"),
      element("p", "reporter-card-copy", error.message),
      Object.assign(element("a", "reporter-button", "Sign in or create an account"), {
        href: "/auth?mode=login"
      })
    );
    if (error.message !== "Sign in to access your reporter account.") showMessage(error.message);
  }
}

loadReporterDesk();
