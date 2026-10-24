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
  box.append(element("strong", "", `Application agreement · Version ${agreement.version}`));
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
    element("span", "", "I have read and accept this published reporter application agreement.")
  );
  box.append(acceptance);
  return box;
}

function addDraftAgreementNotice(root) {
  const notice = element("section", "reporter-agreement reporter-agreement-draft full-width");
  notice.append(
    element("strong", "", "Reporter engagement agreement · Draft preview"),
    element("p", "reporter-card-copy", "This document is a draft for legal review and contains unfinished fields. It is provided for preview only; submitting your application does not accept or sign this draft.")
  );
  const link = element("a", "", "Open the draft agreement (PDF)");
  link.href = "/documents/reporter-engagement-agreement-draft.pdf";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  notice.append(link);
  root.append(notice);
}

function renderApplicationForm(action, existing = null) {
  const acceptingUpdatedAgreement = action === "updated-agreement";
  const resubmitting = action === "resubmit";
  applicationPanel.replaceChildren();
  applicationPanel.hidden = false;
  applicationPanel.append(
    element("h2", "", acceptingUpdatedAgreement
      ? "Review the updated application agreement"
      : resubmitting
        ? "Update and resubmit your application"
        : "Apply to become a Chowk reporter"),
    element("p", "reporter-card-copy", acceptingUpdatedAgreement
      ? "The agreement version changed. Accept the current version before your pending application can continue to review."
      : resubmitting
        ? "Update the requested details and resubmit for admin review. Your subscriber account remains available while the application is reviewed."
        : "Complete your reporter application below. An admin reviews the application—not your account—and your account remains a subscriber until reporter onboarding is complete.")
  );

  const form = element("form", "reporter-form-grid");
  if (!acceptingUpdatedAgreement) {
    const states = (options.states || []).map((state) => ({ id: state.id, label: `${state.state_name} (${state.state_code})` }));
    const stateSelect = addSelect(form, "state_id", "State", states, existing?.state?.id || "", "Choose a state");
    const rtoValues = (options.rtos || []).filter((rto) =>
      String(rto.state_id) === String(existing?.state?.id || "")
    ).map((rto) => ({
      id: rto.id,
      label: `${rto.rto_code}${rto.city_name ? ` · ${rto.city_name}` : ""}`
    }));
    const rtoSelect = addSelect(form, "rto_office_id", "RTO / reporting area", rtoValues, existing?.rto?.id || "", "Choose a state first");
    const types = (options.types || []).map((type) => ({ id: type.id, label: `${type.name} (${type.type_code})` }));
    addSelect(form, "reporter_type_id", "Reporter type", types, existing?.reporter_type?.id || "", "Choose reporter type");
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
    if (resubmitting && existing?.review_note) {
      const note = element("p", "reporter-review-note", `Admin requested an update: ${existing.review_note}`);
      form.prepend(note);
    }
  }

  form.classList.add("reporter-form-grid");
  if (options?.agreement) {
    form.append(addAgreement(element("div"), options.agreement, identity.full_name || identity.name));
    form.lastElementChild.classList.add("full-width");
  } else if (!acceptingUpdatedAgreement) {
    addDraftAgreementNotice(form);
  }
  if (!acceptingUpdatedAgreement) {
    const declaration = document.createElement("label");
    declaration.className = "reporter-check full-width";
    const confirmed = document.createElement("input");
    confirmed.type = "checkbox";
    confirmed.name = "details_confirmed";
    confirmed.required = true;
    declaration.append(
      confirmed,
      element("span", "", "I confirm that the information in this reporter application is accurate.")
    );
    form.append(declaration);
  }
  const submit = element("button", "reporter-button", acceptingUpdatedAgreement
    ? "Accept current agreement"
    : resubmitting
      ? "Resubmit application"
      : "Review and submit application");
  submit.type = "submit";
  const summary = element("section", "reporter-application-review");
  summary.hidden = true;
  form.append(summary);
  form.append(submit);
  applicationPanel.append(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!acceptingUpdatedAgreement && summary.hidden) {
      const values = new FormData(form);
      const selectedState = options.states.find((state) => String(state.id) === String(values.get("state_id")));
      const selectedRto = options.rtos.find((rto) => String(rto.id) === String(values.get("rto_office_id")));
      const selectedType = options.types.find((type) => String(type.id) === String(values.get("reporter_type_id")));
      summary.replaceChildren(
        element("strong", "", "Check your application before sending"),
        element("span", "", `Reporting area: ${selectedState?.state_name || "—"} · ${selectedRto?.rto_code || "—"} ${selectedRto?.city_name || ""}`),
        element("span", "", `Reporter type: ${selectedType?.name || "—"}`),
        element("span", "", options.agreement
          ? `Application agreement: version ${options.agreement.version} accepted`
          : "Application agreement: draft preview only; no legal agreement acceptance is recorded."),
        element("span", "", "An admin reviews this application. Your account stays a subscriber until onboarding is complete.")
      );
      summary.hidden = false;
      submit.textContent = "Confirm and submit";
      summary.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    submit.disabled = true;
    submit.textContent = "Submitting…";
    const values = new FormData(form);
    try {
      if (acceptingUpdatedAgreement) {
        const payload = {
          agreement_version: options.agreement.version,
          agreement_sha256: options.agreement.sha256,
          signer_name: String(values.get("signer_name") || "").trim(),
          acceptance_statement: "I have read and accept the Chowk reporter application agreement."
        };
        await request("/api/reporter/agreement/accept", "POST", payload);
      } else {
        const payload = {
          details_confirmed: values.get("details_confirmed") === "on",
          agreement_version: options.agreement?.version || null,
          agreement_sha256: options.agreement?.sha256 || null,
          signer_name: options.agreement ? String(values.get("signer_name") || "").trim() : null,
          acceptance_statement: options.agreement
            ? "I have read and accept the Chowk reporter application agreement."
            : null
        };
        payload.state_id = values.get("state_id");
        payload.rto_office_id = values.get("rto_office_id");
        payload.reporter_type_id = values.get("reporter_type_id");
        await request("/api/reporter/applications", "POST", payload);
      }
      showMessage(acceptingUpdatedAgreement ? "Your updated agreement acceptance was recorded." : "Your reporter application was submitted.", true);
      await loadReporterDesk();
    } catch (error) {
      showMessage(error.message);
    } finally {
      submit.disabled = false;
      submit.textContent = acceptingUpdatedAgreement
        ? "Accept current agreement"
        : resubmitting
          ? "Resubmit application"
          : "Review and submit application";
    }
  });
}

function dataItem(label, value, code = false) {
  const item = element("div", "reporter-data-item");
  item.append(element("span", "", label), element("strong", code ? "reporter-code" : "", value || "—"));
  return item;
}

function renderServiceAgreement(application) {
  if (!["approved", "active"].includes(application.status)) return;
  const activeReporter = application.status === "active";
  const current = options.service_agreement;
  const acceptedCurrent = current
    && application.service_agreement_version === current.version
    && application.service_agreement_sha256 === current.sha256
    && application.service_agreement_accepted_at;
  const panel = element("section", "reporter-onboarding-step");
  panel.append(element("h3", "", activeReporter
    ? "Service / appointment agreement"
    : "Step 1 · Service / appointment agreement"));
  if (acceptedCurrent) {
    panel.append(
      element("span", "reporter-status-pill active", `Accepted · v${current.version}`),
      element("p", "reporter-card-copy", `Accepted by ${application.service_agreement_signer_name || identity.full_name} on ${formatDate(application.service_agreement_accepted_at)}.`)
    );
    const link = element("a", "", "View the accepted service agreement");
    link.href = application.service_agreement_document_url || current.document_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    panel.append(link);
    (application.service_acceptances || []).forEach((receipt) => {
      panel.append(element(
        "p",
        "reporter-card-copy",
        `Acceptance record · v${receipt.agreement_version} · ${receipt.signer_name} · ${formatDate(receipt.accepted_at)} · SHA-256 ${receipt.agreement_sha256}`
      ));
    });
    panel.append(element("p", "reporter-card-copy", activeReporter
      ? "Your current service agreement is on file. Keep the issued authority letter current for your assigned area."
      : "Next: Chowk issues an authority letter for your assigned reporting area. Reporter access activates only after you acknowledge that letter."));
  } else if (!current) {
    panel.append(element("p", "reporter-review-note", "Onboarding is waiting for Chowk to publish the service / appointment agreement. No action is required from you."));
  } else {
    panel.append(element("p", "reporter-card-copy", activeReporter
      ? `Review the new service / appointment agreement, version ${current.version}. Accepting it records the current terms for any renewed authority.`
      : `Review the separate service / appointment agreement, version ${current.version}. This is not the application agreement.`));
    const link = element("a", "", "Open the full service agreement");
    link.href = current.document_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    panel.append(link, element("span", "reporter-card-copy", `Document SHA-256: ${current.sha256}`));
    const form = element("form", "reporter-service-agreement-form");
    const signer = addField(form, "Type your account full name", "signer_name", "text", identity.full_name || identity.name);
    signer.autocomplete = "name";
    signer.minLength = 2;
    const acceptance = document.createElement("label");
    acceptance.className = "reporter-check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.required = true;
    acceptance.append(
      checkbox,
      element("span", "", "I have reviewed and accept this service / appointment agreement.")
    );
    form.append(acceptance);
    const submit = element("button", "reporter-button", "Accept service agreement");
    submit.type = "submit";
    form.append(submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      submit.disabled = true;
      try {
        await request("/api/reporter/service-agreement/accept", "POST", {
          agreement_version: current.version,
          agreement_sha256: current.sha256,
          signer_name: signer.value.trim(),
          acceptance_statement: "I have reviewed and accept the Chowk reporter service agreement."
        });
        showMessage("Your service agreement acceptance was recorded. Chowk can now issue your authority letter.", true);
        await loadReporterDesk();
      } catch (error) {
        showMessage(error.message);
      } finally {
        submit.disabled = false;
      }
    });
    panel.append(form);
  }
  applicationPanel.hidden = false;
  applicationPanel.append(panel);
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
  statusPanel.append(element("h2", "", reporter ? "Reporter profile" : "Reporter application progress"));
  if (application) {
    const activeAuthority = reporterData.credentials?.some((credential) =>
      credential.credential_type === "authority_letter" && credential.status === "active"
        && credential.valid_from <= new Date().toISOString().slice(0, 10)
        && credential.valid_until >= new Date().toISOString().slice(0, 10)
    );
    const currentServiceAgreement = options.service_agreement;
    const acceptedCurrentServiceAgreement = currentServiceAgreement
      && application.service_agreement_version === currentServiceAgreement.version
      && application.service_agreement_sha256 === currentServiceAgreement.sha256
      && Boolean(application.service_agreement_accepted_at);
    const stages = [
      ["Account", true],
      ["Application", true],
      ["Review", application.status !== "pending"],
      ["Service terms", Boolean(acceptedCurrentServiceAgreement)],
      ["Authority letter", Boolean(activeAuthority)],
      ["Reporter access", identity.role === "reporter" && application.status === "active"]
    ];
    const timeline = element("ol", "reporter-timeline");
    stages.forEach(([label, complete], index) => {
      const item = element("li", complete ? "is-complete" : "", label);
      item.append(element("span", "", complete ? "Complete" : "Next"));
      if (index === 0) item.querySelector("span").textContent = "Complete";
      timeline.append(item);
    });
    statusPanel.append(timeline);
    const statusLabel = {
      pending: "Under review",
      needs_information: "Action needed",
      approved: "Approved · onboarding required",
      active: "Active reporter",
      rejected: "Not approved"
    }[application.status] || application.status;
    const status = element("span", `reporter-status-pill ${application.status}`, statusLabel);
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
      dataItem("Decision recorded", application.company_signer_name || "—")
    );
    statusPanel.append(details);
    const acceptances = Array.isArray(application.acceptances) ? application.acceptances : [];
    if (acceptances.length) {
      statusPanel.append(element("h3", "", "Application agreement acceptance history"));
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
      statusPanel.append(element("h3", "", application.status === "needs_information"
        ? "What you need to do"
        : application.status === "rejected"
          ? "Decision reason"
          : "Review note"));
      statusPanel.append(element("p", "reporter-card-copy", application.review_note));
    }
    if (application.status === "approved") {
      statusPanel.append(element("p", "reporter-next-step", "Approved does not mean field-authorized yet. Accept the service agreement, then review and acknowledge the authority letter Chowk issues for your assigned area."));
    } else if (application.status === "active") {
      statusPanel.append(element("p", "reporter-next-step success", "Your valid authority letter was acknowledged and reporter access is active."));
    } else if (application.status === "pending") {
      statusPanel.append(element("p", "reporter-next-step", "No action is needed now. Your account remains a subscriber while your application is reviewed."));
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
  const needsAgreement = ["pending", "needs_information"].includes(application?.status) &&
    options.agreement &&
    (application.agreement_version !== options.agreement.version ||
      application.agreement_sha256 !== options.agreement.sha256);
  if (needsAgreement) renderApplicationForm("updated-agreement", application);
  else if (application?.status === "needs_information" || application?.status === "rejected") {
    renderApplicationForm("resubmit", application);
  }
  else if (!application && identity.role === "subscriber") renderApplicationForm("new");
  else {
    applicationPanel.replaceChildren();
    applicationPanel.hidden = true;
  }
  if (["approved", "active"].includes(application?.status)) renderServiceAgreement(application);
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
      dataItem("Reporter ID", reporterData.reporter?.reporter_code || credential.reporter_code),
      dataItem("Scope", [
        credential.scope?.state_name,
        credential.scope?.rto_code,
        credential.scope?.city_name
      ].filter(Boolean).join(" · ") || "—")
    );
    if (credential.credential_type === "authority_letter") {
      values.append(
        dataItem("Service terms version", credential.service_agreement_version),
        dataItem("Authorized by", [
          credential.authorized_signer_name,
          credential.authorized_signer_designation
        ].filter(Boolean).join(" · "))
      );
    }
    card.append(values);
    const actions = element("div", "reporter-credential-actions");
    const verify = element("a", "", "Verify credential");
    verify.href = `/credential?token=${encodeURIComponent(credential.verification_token)}`;
    verify.target = "_blank";
    verify.rel = "noopener noreferrer";
    actions.append(verify);
    if (["active", "pending_acceptance"].includes(credential.status)) {
      const print = element("a", "", "Print / Save PDF");
      print.href = `/api/reporter/credentials/${encodeURIComponent(credential.id)}/print`;
      print.target = "_blank";
      print.rel = "noopener noreferrer";
      actions.append(print);
    }
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
      element("p", "reporter-card-copy", `Account role: ${identity.role}. Reporter access is activated only after application approval and required onboarding acknowledgements.`)
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
