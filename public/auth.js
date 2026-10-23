const tabs = [...document.querySelectorAll(".auth-tab")];
const accountTypeButtons = [...document.querySelectorAll("[data-account-type]")];
const form = document.querySelector("#auth-form");
const title = document.querySelector("#auth-title");
const description = document.querySelector("#auth-description");
const accountTypes = document.querySelector("#account-types");
const submitButton = document.querySelector("#auth-submit");
const message = document.querySelector("#auth-message");
const switchPrompt = document.querySelector("#switch-prompt");
const switchButton = document.querySelector("#switch-mode");
const reporterNote = document.querySelector("#reporter-note");
const reporterRegistration = document.querySelector("#reporter-registration");
const reporterAgreement = document.querySelector("#reporter-agreement");
const reporterAgreementLink = document.querySelector("#reporter-agreement-link");
const reporterSetupMessage = document.querySelector("#reporter-setup-message");
const reporterState = form.elements.state_id;
const reporterRto = form.elements.rto_office_id;
const reporterType = form.elements.reporter_type_id;
const reporterAgreementAccepted = form.elements.acceptedReporterAgreement;

let mode = new URLSearchParams(window.location.search).get("mode") === "register"
  ? "register"
  : "login";
let accountType = "subscriber";
let reporterOptions = null;
let reporterOptionsError = "";

function replaceOptions(select, placeholder, values, labelFor) {
  select.replaceChildren(new Option(placeholder, ""));
  values.forEach((value) => {
    select.append(new Option(labelFor(value), String(value.id)));
  });
}

function refreshReporterRtos() {
  if (!reporterOptions) return;
  const activeRtos = (reporterOptions.rtos || []).filter((rto) =>
    String(rto.state_id) === reporterState.value
  );
  replaceOptions(
    reporterRto,
    reporterState.value
      ? activeRtos.length ? "RTO / क्षेत्र चुनें" : "इस राज्य के लिए active RTO उपलब्ध नहीं है"
      : "पहले राज्य चुनें",
    activeRtos,
    (rto) => `${rto.rto_code}${rto.city_name ? ` · ${rto.city_name}` : ""}`
  );
}

function updateReporterFields() {
  const isReporterRegistration = mode === "register" && accountType === "reporter";
  const optionsLoaded = Boolean(reporterOptions);
  const configuredStates = (reporterOptions?.states || []).filter((state) =>
    (reporterOptions?.rtos || []).some((rto) => String(rto.state_id) === String(state.id))
  );
  const setupBlockers = [];
  if (optionsLoaded) {
    if (!reporterOptions.agreement) setupBlockers.push("Admin को current Reporter agreement publish करना होगा");
    if (!configuredStates.length) setupBlockers.push("Admin को state के साथ RTO / reporting area configure करना होगा");
    if (!reporterOptions.types?.length) setupBlockers.push("Admin को reporter type configure करना होगा");
  }
  reporterRegistration.hidden = !isReporterRegistration;
  reporterNote.hidden = !isReporterRegistration;
  [reporterState, reporterRto, reporterType].forEach((select) => {
    select.disabled = !isReporterRegistration || !optionsLoaded;
    select.required = isReporterRegistration;
  });
  reporterAgreement.hidden = !reporterOptions?.agreement;
  reporterAgreementAccepted.disabled = !isReporterRegistration || !reporterOptions?.agreement;
  reporterAgreementAccepted.required = isReporterRegistration;
  if (reporterOptions?.agreement) {
    reporterAgreementLink.href = reporterOptions.agreement.document_url;
    reporterAgreementLink.textContent = `Reporter agreement पढ़ें · v${reporterOptions.agreement.version}`;
  }

  if (isReporterRegistration && reporterOptionsError) {
    reporterSetupMessage.textContent = reporterOptionsError;
    reporterSetupMessage.hidden = false;
  } else if (isReporterRegistration && setupBlockers.length) {
    reporterSetupMessage.textContent = `Reporter application setup अधूरा है: ${setupBlockers.join("। ")}।`;
    reporterSetupMessage.hidden = false;
  } else {
    reporterSetupMessage.hidden = true;
    reporterSetupMessage.textContent = "";
  }

  submitButton.disabled = isReporterRegistration && (
    !optionsLoaded
    || !reporterOptions.agreement
    || !configuredStates.length
    || !reporterOptions.types?.length
    || !reporterOptions.rtos?.length
  );
}

async function loadReporterOptions() {
  try {
    const response = await fetch("/api/reporter/options", { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Reporter options could not be loaded.");
    reporterOptions = result.data || {};
    const configuredStates = (reporterOptions.states || []).filter((state) =>
      (reporterOptions.rtos || []).some((rto) => String(rto.state_id) === String(state.id))
    );
    replaceOptions(
      reporterState,
      "राज्य चुनें",
      configuredStates,
      (state) => `${state.state_name} (${state.state_code})`
    );
    replaceOptions(
      reporterType,
      "Reporter प्रकार चुनें",
      reporterOptions.types || [],
      (type) => `${type.name} (${type.type_code})`
    );
    refreshReporterRtos();
  } catch (error) {
    reporterOptionsError = error instanceof Error ? error.message : "Reporter options could not be loaded.";
  }
  updateReporterFields();
}

function setMode(nextMode) {
  mode = nextMode;
  const isRegister = mode === "register";

  tabs.forEach((tab) => {
    const selected = tab.dataset.mode === mode;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });

  document.querySelectorAll(".registration-field").forEach((field) => {
    field.hidden = !isRegister;
  });
  form.elements.name.required = isRegister;
  form.elements.phone.required = isRegister;
  form.elements.confirmPassword.required = isRegister;
  form.elements.acceptedPolicies.required = isRegister;
  form.elements.password.autocomplete = isRegister ? "new-password" : "current-password";
  form.elements.password.minLength = isRegister ? 8 : 1;

  accountTypes.hidden = !isRegister;
  title.textContent = isRegister ? "अपना अकाउंट बनाएं" : "अपने अकाउंट में लॉगिन करें";
  description.textContent = isRegister
    ? "Subscriber अकाउंट बनाएं या Reporter आवेदन के लिए अपना क्षेत्र चुनें।"
    : "जारी रखने के लिए अपना ईमेल और पासवर्ड दर्ज करें।";
  submitButton.textContent = isRegister ? "रजिस्टर करें" : "लॉगिन करें";
  switchPrompt.textContent = isRegister ? "पहले से अकाउंट है?" : "नया अकाउंट बनाना है?";
  switchButton.textContent = isRegister ? "लॉगिन करें" : "रजिस्टर करें";
  message.hidden = true;
  message.textContent = "";
  message.classList.remove("is-success");
  updateReporterFields();
  const params = new URLSearchParams(window.location.search);
  params.set("mode", mode);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

switchButton.addEventListener("click", () => {
  setMode(mode === "login" ? "register" : "login");
});

accountTypeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    accountType = button.dataset.accountType;
    accountTypeButtons.forEach((option) => {
      const selected = option === button;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-pressed", String(selected));
    });
    updateReporterFields();
  });
});

reporterState.addEventListener("change", refreshReporterRtos);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.hidden = true;
  message.textContent = "";
  message.classList.remove("is-success");

  if (!form.reportValidity()) return;
  if (mode === "register" && form.elements.password.value !== form.elements.confirmPassword.value) {
    message.textContent = "दोनों पासवर्ड एक जैसे होने चाहिए।";
    message.hidden = false;
    form.elements.confirmPassword.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = mode === "register" ? "अकाउंट बना रहे हैं…" : "लॉगिन हो रहा है…";
  try {
    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.elements.email.value.trim(),
        password: form.elements.password.value,
        ...(mode === "register"
          ? {
              name: form.elements.name.value.trim(),
              phone: form.elements.phone.value.trim(),
              account_type: accountType,
              accepted_policies: form.elements.acceptedPolicies.checked,
              ...(accountType === "reporter"
                ? {
                    state_id: reporterState.value,
                    rto_office_id: reporterRto.value,
                    reporter_type_id: reporterType.value,
                    accepted_reporter_agreement: reporterAgreementAccepted.checked,
                    agreement_version: reporterOptions.agreement.version,
                    agreement_sha256: reporterOptions.agreement.sha256
                  }
                : {})
            }
          : {})
      })
    });
    const result = await response.json();
    if (!response.ok) {
      const error = Array.isArray(result.message) ? result.message[0] : result.error || result.message;
      throw new Error(error || "खाता सेवा से संपर्क नहीं हो सका।");
    }

    if (result.confirmation_required) {
      message.textContent = accountType === "reporter"
        ? "आपका अकाउंट और Reporter आवेदन बन गया है। ईमेल की पुष्टि करें; आवेदन Admin की समीक्षा तक pending रहेगा।"
        : "आपका अकाउंट बन गया है। कृपया ईमेल में आए लिंक से पुष्टि करें, फिर लॉगिन करें।";
      message.classList.add("is-success");
      message.hidden = false;
      return;
    }

    message.textContent = mode === "register"
      ? accountType === "reporter"
        ? "आपका अकाउंट और Reporter आवेदन बन गया है। Admin की मंजूरी तक आपका role Subscriber रहेगा।"
        : "आपका अकाउंट बन गया है और आप लॉगिन हैं।"
      : `लॉगिन सफल${result.identity?.name ? `, ${result.identity.name}` : ""}।`;
    message.classList.add("is-success");
    message.hidden = false;
    const role = result.identity?.role;
    const staffRoles = ["reporter", "moderator", "editor", "publisher"];
    window.location.assign(
      mode === "register" && accountType === "reporter"
        ? "/reporter"
        : staffRoles.includes(role)
          ? "/workspace"
          : role === "admin" || role === "super_admin"
            ? "/admin/dashboard"
            : "/"
    );
  } catch (error) {
    message.textContent = error instanceof Error
      ? error.message
      : "खाता सेवा से संपर्क नहीं हो सका।";
    message.hidden = false;
  } finally {
    submitButton.textContent = mode === "register" ? "रजिस्टर करें" : "लॉगिन करें";
    updateReporterFields();
  }
});

setMode(mode);
void loadReporterOptions();
