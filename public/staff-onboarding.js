const form = document.querySelector("#staff-onboarding-form");
const statePanel = document.querySelector("#staff-onboarding-state");
const messagePanel = document.querySelector("#staff-onboarding-message");
const submitButton = document.querySelector("#staff-onboarding-submit");
const agreementPanel = document.querySelector("#staff-agreement-panel");
const photoInput = document.querySelector("#staff-profile-photo");
const photoPreview = document.querySelector("#staff-photo-image");
const photoPlaceholder = document.querySelector("#staff-photo-placeholder");
const today = new Date().toISOString().slice(0, 10);

let onboarding = null;
let profilePhotoPath = "";
let previewUrl = "";

function showState(message, kind = "info") {
  statePanel.classList.toggle("is-error", kind === "error");
  statePanel.replaceChildren(document.createTextNode(message));
  statePanel.hidden = false;
  form.hidden = true;
}

function showFormMessage(message) {
  messagePanel.textContent = message;
  messagePanel.hidden = false;
}

function renderAgreement(agreement, role, onboardingStatus) {
  agreementPanel.replaceChildren();
  agreementPanel.hidden = false;
  agreementPanel.append(
    document.createElement("h2"),
    document.createElement("p")
  );
  const heading = agreementPanel.children[0];
  const description = agreementPanel.children[1];
  heading.textContent = `${role.charAt(0).toUpperCase()}${role.slice(1)} agreement`;

  if (!["submitted", "approved_pending_agreement"].includes(onboardingStatus)) {
    description.textContent =
      "Complete and submit your profile first. You can then review the agreement personalized with your details.";
    return;
  }

  if (!agreement) {
    description.textContent =
      `No agreement is currently published for the ${role} role. Account activation is unavailable until a super admin publishes one.`;
    return;
  }

  heading.textContent = `${role.charAt(0).toUpperCase()}${role.slice(1)} agreement · ${agreement.version}`;
  description.textContent = `Published ${new Intl.DateTimeFormat("en", {
    dateStyle: "medium"
  }).format(new Date(agreement.published_at))}. Review the exact personalized wording below.`;
  const wordingHeading = document.createElement("h3");
  wordingHeading.textContent = "Published wording";
  const wording = document.createElement("pre");
  wording.className = "staff-agreement-copy";
  wording.textContent = agreement.resolved_content;
  agreementPanel.append(wordingHeading, wording);

  if (agreement.accepted) {
    const accepted = document.createElement("p");
    accepted.setAttribute("role", "status");
    accepted.textContent = `You accepted the currently published version ${agreement.version}.`;
    agreementPanel.append(accepted);
    return;
  }

  const acceptLabel = document.createElement("label");
  acceptLabel.className = "staff-agreement-accept";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.required = true;
  const confirmation = document.createElement("span");
  confirmation.textContent = "I have reviewed and accept this published agreement version.";
  acceptLabel.append(checkbox, confirmation);
  const acceptButton = document.createElement("button");
  acceptButton.className = "staff-submit-button";
  acceptButton.type = "button";
  acceptButton.disabled = true;
  acceptButton.textContent = "Accept published agreement";
  checkbox.addEventListener("change", () => {
    acceptButton.disabled = !checkbox.checked;
  });
  acceptButton.addEventListener("click", async () => {
    if (!checkbox.checked) return;
    acceptButton.disabled = true;
    acceptButton.textContent = "Recording acceptance…";
    try {
      await request("/api/staff/onboarding/agreement", "POST", {
        agreement_version_id: agreement.id,
        sha256: agreement.sha256,
        rendered_content: agreement.resolved_content,
        rendered_sha256: agreement.rendered_sha256
      });
      if (onboardingStatus === "approved_pending_agreement") {
        window.location.replace("/workspace");
        return;
      }
      renderAgreement({ ...agreement, accepted: true }, role, onboardingStatus);
    } catch (error) {
      showFormMessage(error instanceof Error ? error.message : "The agreement could not be accepted.");
      acceptButton.disabled = false;
      acceptButton.textContent = "Accept published agreement";
    }
  });
  agreementPanel.append(acceptLabel, acceptButton);
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
    window.location.replace("/auth?mode=login&next=%2Fstaff-onboarding");
    throw new Error("Your invitation session expired. Sign in again to continue.");
  }
  if (!response.ok) throw new Error(result.error || "Staff onboarding could not be completed.");
  return result;
}

function setProfilePhoto(url) {
  if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  previewUrl = url || "";
  photoPreview.hidden = !previewUrl;
  photoPlaceholder.hidden = Boolean(previewUrl);
  if (previewUrl) photoPreview.src = previewUrl;
  else photoPreview.removeAttribute("src");
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected profile photo could not be read."));
    reader.onload = () => {
      const value = String(reader.result || "");
      const comma = value.indexOf(",");
      if (comma < 0) {
        reject(new Error("The selected profile photo could not be prepared for upload."));
        return;
      }
      resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function populateProfile(data) {
  onboarding = data;
  profilePhotoPath = data.profile_photo_path || "";
  form.elements.full_name.value = data.full_name || "";
  form.elements.email.value = data.email || "";
  form.elements.phone.value = data.phone || "";
  form.elements.date_of_birth.value = data.date_of_birth || "";
  form.elements.emergency_contact_name.value = data.emergency_contact_name || "";
  form.elements.emergency_contact_relationship.value = data.emergency_contact_relationship || "";
  form.elements.emergency_contact_phone.value = data.emergency_contact_phone || "";
  form.elements.permanent_address_line1.value = data.permanent_address_line1 || "";
  form.elements.permanent_address_line2.value = data.permanent_address_line2 || "";
  form.elements.permanent_address_city.value = data.permanent_address_city || "";
  form.elements.permanent_address_district.value = data.permanent_address_district || "";
  form.elements.permanent_address_state.value = data.permanent_address_state || "";
  form.elements.permanent_address_postal_code.value = data.permanent_address_postal_code || "";
  form.elements.preferred_language.value = data.preferred_language || "";
  form.elements.experience_years.value = data.experience_years ?? "";
  form.elements.experience_summary.value = data.experience_summary || "";
  form.elements.profile_photo_path.value = profilePhotoPath;
  photoInput.required = !profilePhotoPath;
  photoInput.setCustomValidity("");
  form.elements.date_of_birth.max = today;
  if (data.profile_photo_url) setProfilePhoto(data.profile_photo_url);
  if (data.status === "changes_requested" && data.review_note) {
    const note = document.createElement("p");
    note.className = "staff-onboarding-review-note";
    note.setAttribute("role", "status");
    note.textContent = `An admin requested changes: ${data.review_note}`;
    form.prepend(note);
  }
  statePanel.hidden = true;
  form.hidden = false;
}

async function acceptInviteFromHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const type = params.get("type");
  if (!accessToken && !refreshToken && !params.has("error")) return;
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  const errorDescription = params.get("error_description");
  if (params.has("error")) {
    throw new Error(errorDescription || "The invitation link could not be verified. Ask an admin to resend it.");
  }
  if (type !== "invite" || !accessToken || !refreshToken) {
    throw new Error("This invitation link is incomplete or expired. Ask an admin to send a new one.");
  }
  await request("/api/auth/staff-invite/accept", "POST", {
    access_token: accessToken,
    refresh_token: refreshToken
  });
}

async function loadOnboarding() {
  try {
    await acceptInviteFromHash();
    const result = await request("/api/staff/onboarding");
    const data = result.data;
    if (data.status === "active") {
      window.location.replace("/workspace");
      return;
    }
    if (data.status === "rejected") {
      agreementPanel.hidden = true;
      showState(`This staff invitation was not approved. ${data.review_note || "Contact the administrator who invited you if you need more information."}`, "error");
      return;
    }
    renderAgreement(data.agreement, data.requested_role, data.status);
    if (data.status === "submitted") {
      showState("Your profile has been submitted for review. Your account will remain limited until an administrator approves it.");
      return;
    }
    if (data.status === "approved_pending_agreement") {
      showState("Your profile is approved. Accept the currently published agreement above to activate your newsroom access.");
      return;
    }
    if (!["invited", "changes_requested"].includes(data.status)) {
      showState("This staff invitation is no longer available. Contact an administrator for assistance.", "error");
      return;
    }
    populateProfile(data);
  } catch (error) {
    showState(error instanceof Error ? error.message : "The staff invitation could not be verified.", "error");
  }
}

photoInput.addEventListener("change", () => {
  messagePanel.hidden = true;
  const file = photoInput.files?.[0];
  if (!file) {
    photoInput.setCustomValidity("");
    setProfilePhoto(onboarding?.profile_photo_url || "");
    photoInput.required = !profilePhotoPath;
    return;
  }
  if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 5 * 1024 * 1024) {
    photoInput.setCustomValidity("Choose a JPG or PNG photo no larger than 5 MB.");
    photoInput.reportValidity();
    photoInput.value = "";
    return;
  }
  photoInput.setCustomValidity("");
  photoInput.required = true;
  setProfilePhoto(URL.createObjectURL(file));
});

form.elements.confirm_password.addEventListener("input", () => {
  form.elements.confirm_password.setCustomValidity("");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  messagePanel.hidden = true;
  if (!form.reportValidity()) return;
  if (form.elements.password.value !== form.elements.confirm_password.value) {
    form.elements.confirm_password.setCustomValidity("Passwords do not match.");
    form.elements.confirm_password.reportValidity();
    form.elements.confirm_password.focus();
    return;
  }
  if (form.elements.profile_confirmed.checked !== true) return;

  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = "Submitting securely…";
  try {
    const photo = photoInput.files?.[0];
    if (photo) {
      const uploaded = await request(
        "/api/staff/onboarding/photo",
        "POST",
        { mime_type: photo.type, file_base64: await readFileAsBase64(photo) }
      );
      profilePhotoPath = uploaded.data.profile_photo_path;
      form.elements.profile_photo_path.value = profilePhotoPath;
    }
    if (!profilePhotoPath) throw new Error("Upload a profile photo before submitting your profile.");

    await request("/api/staff/onboarding/profile", "POST", {
      full_name: form.elements.full_name.value.trim(),
      phone: form.elements.phone.value.trim(),
      date_of_birth: form.elements.date_of_birth.value,
      emergency_contact_name: form.elements.emergency_contact_name.value.trim(),
      emergency_contact_relationship: form.elements.emergency_contact_relationship.value.trim(),
      emergency_contact_phone: form.elements.emergency_contact_phone.value.trim(),
      permanent_address_line1: form.elements.permanent_address_line1.value.trim(),
      permanent_address_line2: form.elements.permanent_address_line2.value.trim(),
      permanent_address_city: form.elements.permanent_address_city.value.trim(),
      permanent_address_district: form.elements.permanent_address_district.value.trim(),
      permanent_address_state: form.elements.permanent_address_state.value.trim(),
      permanent_address_postal_code: form.elements.permanent_address_postal_code.value.trim(),
      preferred_language: form.elements.preferred_language.value.trim(),
      experience_years: form.elements.experience_years.value,
      experience_summary: form.elements.experience_summary.value.trim(),
      profile_photo_path: profilePhotoPath,
      profile_confirmed: form.elements.profile_confirmed.checked,
      password: form.elements.password.value,
      confirm_password: form.elements.confirm_password.value
    });
    form.reset();
    await loadOnboarding();
  } catch (error) {
    window.ChowkInlineFeedback?.clear(form);
    showFormMessage(error instanceof Error ? error.message : "The staff profile could not be submitted.");
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
    submitButton.innerHTML = 'Submit profile for review <span aria-hidden="true">→</span>';
  }
});

window.addEventListener("beforeunload", () => {
  if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
});

void loadOnboarding();
