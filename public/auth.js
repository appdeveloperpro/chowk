const tabs = [...document.querySelectorAll(".auth-tab")];
const form = document.querySelector("#auth-form");
const title = document.querySelector("#auth-title");
const description = document.querySelector("#auth-description");
const submitButton = document.querySelector("#auth-submit");
const message = document.querySelector("#auth-message");
const switchPrompt = document.querySelector("#switch-prompt");
const switchButton = document.querySelector("#switch-mode");

let mode = new URLSearchParams(window.location.search).get("mode") === "register"
  ? "register"
  : "login";

function showAuthMessage(text, success = false) {
  const kind = success ? "success" : "error";
  if (window.ChowkInlineFeedback?.show(kind, text)) {
    message.hidden = true;
    return;
  }
  message.textContent = text;
  message.classList.toggle("is-success", success);
  message.hidden = false;
}

function setMode(nextMode) {
  window.ChowkInlineFeedback?.clear(form);
  form.elements.confirmPassword.setCustomValidity("");
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

  title.textContent = isRegister ? "अपना अकाउंट बनाएं" : "अपने अकाउंट में लॉगिन करें";
  description.textContent = isRegister
    ? "अकाउंट बनाएं और ईमेल सत्यापित करने के बाद reporter आवेदन अलग से जमा करें।"
    : "जारी रखने के लिए अपना ईमेल और पासवर्ड दर्ज करें।";
  submitButton.textContent = isRegister ? "रजिस्टर करें" : "लॉगिन करें";
  switchPrompt.textContent = isRegister ? "पहले से अकाउंट है?" : "नया अकाउंट बनाना है?";
  switchButton.textContent = isRegister ? "लॉगिन करें" : "रजिस्टर करें";
  message.hidden = true;
  message.textContent = "";
  message.classList.remove("is-success");

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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.hidden = true;
  message.textContent = "";
  message.classList.remove("is-success");

  if (!form.reportValidity()) return;
  if (mode === "register" && form.elements.password.value !== form.elements.confirmPassword.value) {
    form.elements.confirmPassword.setCustomValidity("दोनों पासवर्ड एक जैसे होने चाहिए।");
    form.elements.confirmPassword.reportValidity();
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
              accepted_policies: form.elements.acceptedPolicies.checked
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
      showAuthMessage("आपका अकाउंट बन गया है। कृपया ईमेल में आए लिंक से पुष्टि करें, फिर लॉगिन करके reporter आवेदन जमा करें।", true);
      return;
    }

    const successMessage = mode === "register"
      ? "आपका subscriber अकाउंट बन गया है। अब reporter desk खोलकर अलग से आवेदन करें।"
      : `लॉगिन सफल${result.identity?.name ? `, ${result.identity.name}` : ""}।`;
    showAuthMessage(successMessage, true);
    const role = result.identity?.role;
    const staffRoles = ["reporter", "moderator", "editor", "publisher"];
    let destination = mode === "register"
      ? "/reporter"
      : staffRoles.includes(role)
        ? "/workspace"
        : role === "admin" || role === "super_admin"
          ? "/admin/dashboard"
          : "/reporter";
    if (mode === "login" && role === "subscriber") {
      const staffInvitation = await fetch("/api/staff/onboarding", { cache: "no-store" });
      if (staffInvitation.ok) {
        const onboarding = await staffInvitation.json();
        if (onboarding.data?.status !== "active") destination = "/staff-onboarding";
      } else if (staffInvitation.status !== 404) {
        throw new Error("You signed in, but your staff invitation could not be checked. Try again or contact an admin.");
      }
    }
    window.location.assign(
      destination
    );
  } catch (error) {
    showAuthMessage(
      error instanceof Error ? error.message : "खाता सेवा से संपर्क नहीं हो सका।"
    );
  } finally {
    submitButton.textContent = mode === "register" ? "रजिस्टर करें" : "लॉगिन करें";
    submitButton.disabled = false;
  }
});

form.elements.confirmPassword.addEventListener("input", () => {
  form.elements.confirmPassword.setCustomValidity("");
  window.ChowkInlineFeedback?.clearField(form.elements.confirmPassword);
});

setMode(mode);
