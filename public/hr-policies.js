const statePanel = document.querySelector("#hr-policy-state");
const policyPanel = document.querySelector("#hr-policy-list");
const profileForm = document.querySelector("#hr-profile-form");
const profileMessage = document.querySelector("#hr-profile-message");

function request(path, method = "GET", body) {
  return fetch(path, {
    method,
    cache: "no-store",
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  }).then(async (response) => {
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace("/auth?mode=login&next=%2Femployee-policies");
      throw new Error("Sign in to review organization policies.");
    }
    if (!response.ok) throw new Error(result.error || "Organization policies could not be loaded.");
    return result;
  });
}

function renderPolicies(policies) {
  policyPanel.replaceChildren();
  policyPanel.hidden = false;
  if (!policies.length) {
    policyPanel.append(Object.assign(document.createElement("p"), {
      textContent: "There are no current policies assigned to your employee role."
    }));
    return;
  }
  const heading = document.createElement("h2");
  heading.textContent = "Current organization policies";
  policyPanel.append(heading);
  policies.forEach((item) => {
    const policy = Array.isArray(item.policy) ? item.policy[0] : item.policy;
    const card = document.createElement("article");
    card.className = "staff-policy-card";
    const title = document.createElement("h3");
    title.textContent = `${policy?.title || policy?.policy_key || "Organization policy"} · ${item.version}`;
    const content = document.createElement("pre");
    content.className = "staff-agreement-copy";
    content.textContent = item.content;
    card.append(title, content);
    if (!policy?.requires_acceptance) {
      const notice = document.createElement("p");
      notice.textContent = "For your information; no acceptance is required.";
      card.append(notice);
    } else if (item.accepted_at) {
      const accepted = document.createElement("p");
      accepted.textContent = `Accepted ${new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(item.accepted_at))}.`;
      card.append(accepted);
    } else {
      const label = document.createElement("label");
      label.className = "staff-agreement-accept";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      const text = document.createElement("span");
      text.textContent = "I have reviewed this exact version and agree to it.";
      label.append(checkbox, text);
      const button = document.createElement("button");
      button.className = "staff-submit-button";
      button.type = "button";
      button.disabled = true;
      button.textContent = "Accept policy";
      checkbox.addEventListener("change", () => { button.disabled = !checkbox.checked; });
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Recording acceptance…";
        try {
          await request("/api/employee/hr-policies/accept", "POST", { policy_version_id: item.id });
          item.accepted_at = new Date().toISOString();
          renderPolicies(policies);
        } catch (error) {
          button.disabled = false;
          button.textContent = "Accept policy";
          statePanel.classList.add("is-error");
          statePanel.textContent = error instanceof Error ? error.message : "Policy acceptance could not be recorded.";
          statePanel.hidden = false;
        }
      });
      card.append(label, button);
    }
    policyPanel.append(card);
  });
}

async function acceptInviteFromHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken && !refreshToken && !params.has("error")) return;
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  if (params.has("error")) throw new Error(params.get("error_description") || "The invitation could not be verified.");
  if (params.get("type") !== "invite" || !accessToken || !refreshToken) {
    throw new Error("This invitation link is incomplete or expired. Ask an administrator to send a new one.");
  }
  await request("/api/auth/employee-invite/accept", "POST", {
    access_token: accessToken,
    refresh_token: refreshToken
  });
}

async function loadPolicies() {
  try {
    await acceptInviteFromHash();
    const [profileResult, policyResult] = await Promise.all([
      request("/api/employee/hr-profile"),
      request("/api/employee/hr-policies")
    ]);
    profileForm.elements.full_name.value = profileResult.data?.full_name || "";
    profileForm.elements.email.value = profileResult.data?.email || "";
    profileForm.elements.phone.value = profileResult.data?.phone || "";
    profileForm.hidden = false;
    statePanel.hidden = true;
    renderPolicies(policyResult.data || []);
  } catch (error) {
    statePanel.classList.add("is-error");
    statePanel.textContent = error instanceof Error ? error.message : "Organization policies could not be loaded.";
  }
}

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  profileMessage.hidden = true;
  try {
    await request("/api/employee/hr-profile", "PATCH", {
      full_name: profileForm.elements.full_name.value.trim(),
      phone: profileForm.elements.phone.value.trim()
    });
    profileMessage.className = "staff-onboarding-message is-success";
    profileMessage.textContent = "Your employee profile was saved.";
  } catch (error) {
    profileMessage.className = "staff-onboarding-message is-error";
    profileMessage.textContent = error instanceof Error ? error.message : "Your profile could not be saved.";
  } finally {
    profileMessage.hidden = false;
  }
});

void loadPolicies();
