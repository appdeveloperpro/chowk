import Cropper from "/vendor/cropperjs/cropper.esm.min.js";

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

function reporterCityLabel(rto) {
  if (!rto) return "—";
  const city = rto.city_name || rto.rto_code || "Reporting area";
  return rto.rto_code && rto.city_name
    ? `${city} (${rto.rto_code})`
    : city;
}

function reporterDistrictLabel(district) {
  if (!district) return "—";
  return district.district_name;
}

function showMessage(text, success = false) {
  if (window.ChowkInlineFeedback?.show(success ? "success" : "error", text)) return;
  messagePanel.textContent = text;
  messagePanel.classList.toggle("success", success);
  messagePanel.hidden = false;
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

function addField(form, labelText, name, type, value = "", fieldOptions = true) {
  const label = element("label", "reporter-field");
  label.append(element("span", "", labelText));
  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  const config = typeof fieldOptions === "boolean" ? { required: fieldOptions } : fieldOptions;
  input.required = config.required !== false;
  ["minLength", "maxLength", "min", "max", "step", "pattern", "autocomplete", "inputMode"].forEach((key) => {
    if (config[key] !== undefined) input[key] = config[key];
  });
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

function addSelectField(form, labelText, name, values, selected = "", placeholder = "Choose an option", required = true) {
  const label = element("label", "reporter-field");
  label.append(element("span", "", labelText));
  const select = document.createElement("select");
  select.name = name;
  select.required = required;
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

function addTextareaField(form, labelText, name, { required = false, minLength = 0, maxLength = 1000, rows = 3, value = "", placeholder = "" } = {}) {
  const label = element("label", "reporter-field reporter-field-full");
  label.append(element("span", "", labelText));
  const textarea = document.createElement("textarea");
  textarea.name = name;
  textarea.required = required;
  textarea.minLength = minLength;
  textarea.maxLength = maxLength;
  textarea.rows = rows;
  textarea.value = value || "";
  textarea.placeholder = placeholder;
  label.append(textarea);
  form.append(label);
  return textarea;
}

function createReporterPhotoCropper(container) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png";
  input.required = true;
  input.setAttribute("aria-label", "Upload passport-size reporter photo");
  const label = element("label", "reporter-field reporter-field-full");
  label.append(element("span", "", "Passport-size photo (JPG or PNG)"));
  label.append(input);
  container.append(label);

  const cropPanel = element("div", "reporter-photo-crop");
  cropPanel.hidden = true;
  const viewport = element("div", "reporter-photo-crop-viewport");
  viewport.setAttribute("aria-label", "Square crop preview of reporter photo");
  cropPanel.append(viewport);
  const controls = element("div", "reporter-photo-crop-controls");
  const rotate = element("button", "reporter-photo-crop-button", "Rotate 90°");
  rotate.type = "button";
  rotate.disabled = true;
  const reset = element("button", "reporter-photo-crop-button", "Reset crop");
  reset.type = "button";
  reset.disabled = true;
  controls.append(rotate, reset);
  cropPanel.append(controls);
  cropPanel.append(element(
    "small",
    "reporter-field-help",
    "Drag the photo to reposition it. Use the mouse wheel or pinch to zoom; rotate or reset if needed. The saved photo is square."
  ));
  container.append(cropPanel);

  const template = '<cropper-canvas background>' +
    '<cropper-image rotatable scalable skewable translatable></cropper-image>' +
    '<cropper-shade hidden></cropper-shade>' +
    '<cropper-handle action="select" plain></cropper-handle>' +
    '<cropper-selection initial-coverage="0.8" initial-aspect-ratio="1" aspect-ratio="1" movable resizable>' +
    '<cropper-grid role="grid" bordered covered></cropper-grid>' +
    '<cropper-crosshair centered></cropper-crosshair>' +
    '<cropper-handle action="move"></cropper-handle>' +
    '<cropper-handle action="n-resize"></cropper-handle>' +
    '<cropper-handle action="e-resize"></cropper-handle>' +
    '<cropper-handle action="s-resize"></cropper-handle>' +
    '<cropper-handle action="w-resize"></cropper-handle>' +
    '<cropper-handle action="ne-resize"></cropper-handle>' +
    '<cropper-handle action="nw-resize"></cropper-handle>' +
    '<cropper-handle action="se-resize"></cropper-handle>' +
    '<cropper-handle action="sw-resize"></cropper-handle>' +
    '</cropper-selection>' +
    '</cropper-canvas>';
  let sourceImage = null;
  let cropper = null;
  let cropperReady = false;
  let sourceUrl = "";
  const cropperOptions = { container: viewport, template };
  const initializeCropper = async (image) => {
    cropperReady = false;
    cropper = new Cropper(image, cropperOptions);
    const cropperImage = cropper.getCropperImage();
    const selection = cropper.getCropperSelection();
    if (!cropperImage || !selection) {
      throw new Error("The photo crop tool could not be initialized.");
    }
    await cropperImage.$ready();
    if (sourceImage !== image) return;
    selection.aspectRatio = 1;
    selection.initialAspectRatio = 1;
    cropperReady = true;
    input.setCustomValidity("");
    rotate.disabled = false;
    reset.disabled = false;
  };
  const clearCropper = () => {
    cropper?.destroy();
    cropper = null;
    cropperReady = false;
    rotate.disabled = true;
    reset.disabled = true;
  };
  rotate.addEventListener("click", () => {
    cropper?.getCropperImage()?.$rotate("90deg");
  });
  reset.addEventListener("click", async () => {
    if (!sourceImage) return;
    clearCropper();
    try {
      await initializeCropper(sourceImage);
    } catch (error) {
      input.setCustomValidity(error.message);
      input.reportValidity();
    }
  });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    clearCropper();
    if (sourceImage?.parentElement === viewport) sourceImage.remove();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = "";
    sourceImage = null;
    if (!file) {
      cropPanel.hidden = true;
      return;
    }
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      input.setCustomValidity("Choose a JPG or PNG photo no larger than 5 MB.");
      input.reportValidity();
      input.value = "";
      cropPanel.hidden = true;
      return;
    }
    input.setCustomValidity("");
    sourceUrl = URL.createObjectURL(file);
    const selectedImage = new Image();
    sourceImage = selectedImage;
    selectedImage.onload = () => {
      if (sourceImage !== selectedImage) return;
      cropPanel.hidden = false;
      viewport.append(selectedImage);
      initializeCropper(selectedImage).catch((error) => {
        if (sourceImage !== selectedImage) return;
        clearCropper();
        input.setCustomValidity(error.message || "The selected photo could not be prepared for cropping.");
        input.reportValidity();
      });
    };
    selectedImage.onerror = () => {
      if (sourceImage !== selectedImage) return;
      input.setCustomValidity("The selected photo could not be read.");
      input.reportValidity();
      input.value = "";
      cropPanel.hidden = true;
      URL.revokeObjectURL(sourceUrl);
      sourceUrl = "";
      sourceImage = null;
    };
    selectedImage.src = sourceUrl;
  });
  return {
    input,
    async file() {
      if (!sourceImage || !cropperReady || !cropper) {
        throw new Error("Wait for the photo crop preview to finish loading, then submit again.");
      }
      const selection = cropper.getCropperSelection();
      if (!selection) throw new Error("The photo crop selection is unavailable. Select the photo again.");
      const exportCanvas = await selection.$toCanvas({ width: 512, height: 512 });
      return new Promise((resolve, reject) => {
        exportCanvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("The cropped photo could not be prepared."));
            return;
          }
          resolve(new File([blob], "reporter-photo.jpg", { type: "image/jpeg" }));
        }, "image/jpeg", 0.9);
      });
    },
    dispose() {
      clearCropper();
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      sourceUrl = "";
      if (sourceImage?.parentElement === viewport) sourceImage.remove();
      sourceImage = null;
    }
  };
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name || "the selected document"}.`));
    reader.onload = () => {
      const result = String(reader.result || "");
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new Error(`Could not encode ${file.name || "the selected document"}.`));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

function renderApplicationForm(action, existing = null) {
  const resubmitting = action === "resubmit";
  if (resubmitting && existing?.status === "needs_information") {
    renderTargetedReporterResubmission(existing);
    return;
  }
  applicationPanel.replaceChildren();
  applicationPanel.hidden = false;
  applicationPanel.append(
    element("h2", "", resubmitting
      ? "Update and resubmit your application"
      : "Apply to become a Chowk reporter"),
    element("p", "reporter-card-copy", resubmitting
      ? "Update the requested details and resubmit for admin review. Your subscriber account remains available while the application is reviewed."
      : "Complete your reporter application below. An admin reviews the application—not your account—and your account remains a subscriber until reporter onboarding is complete.")
  );

  const form = element("form", "reporter-form-grid");
  const applicationFiles = new Map();
  (existing?.documents || []).forEach((document) => {
    applicationFiles.set(document.document_type, document);
  });
  let cropper = null;
  let activeStep = 0;
  const steps = [];
  let updateSteps = () => {};
  const progress = element("ol", "reporter-form-progress");
  const stepContainers = element("div", "reporter-form-steps");
  const navigation = element("div", "reporter-form-navigation");
  const backButton = element("button", "reporter-button secondary", "Back");
  backButton.type = "button";
  const nextButton = element("button", "reporter-button", "Next");
  nextButton.type = "button";
  const submit = element("button", "reporter-button", "Review and submit application");
  submit.type = "submit";
  navigation.append(backButton, nextButton, submit);

  const addStep = (title, helpText) => {
    const index = steps.length;
    const step = document.createElement("fieldset");
    step.className = "reporter-form-step reporter-form-grid";
    step.hidden = true;
    const legend = element("legend", "", `${index + 1}. ${title}`);
    step.append(legend);
    if (helpText) step.append(element("p", "reporter-card-copy reporter-field-full", helpText));
    steps.push(step);
    stepContainers.append(step);
    const indicator = document.createElement("li");
    indicator.append(element("span", "", String(index + 1)), element("strong", "", title));
    progress.append(indicator);
    return step;
  };
  const requestedFields = new Map((existing?.review_requests || []).map((item) => [item.field, item]));
  const highlightRequestedField = (fieldName, control) => {
    const request = requestedFields.get(fieldName);
    if (!request || !control) return;
    const field = control.matches(".reporter-preferred-locations")
      ? control
      : control.closest(".reporter-field") || control.closest("label") || control.parentElement;
    if (!field) return;
    if ("required" in control && request.kind !== "other") control.required = true;
    field.classList.add("reporter-review-requested");
    const instruction = element(
      "small",
      "reporter-review-request-inline",
      `${request.kind === "reupload" ? "Reupload requested" : request.kind === "other" ? "Action requested" : "Correction requested"}: ${request.instruction}`
    );
    field.append(instruction);
  };

  {
    const profileStep = addStep("Your profile", "We use your verified account name, email and phone. Add the details needed to contact you safely.");
    const accountSummary = element("div", "reporter-account-summary reporter-field-full");
    accountSummary.append(
      dataItem("Account name", identity.full_name || identity.name || "—"),
      dataItem("Account email", identity.email || "—"),
      dataItem("Account phone", identity.phone || "Update your account profile if this is missing.")
    );
    profileStep.append(accountSummary);
    const mobileNumber = addField(profileStep, "Mobile number", "mobile_number", "tel", existing?.private_details?.mobile_number || identity.phone, { minLength: 7, maxLength: 16, autocomplete: "tel" });
    mobileNumber.pattern = "\\+?[0-9]{7,15}";
    highlightRequestedField("mobile_number", mobileNumber);
    const dateOfBirth = addField(profileStep, "Date of birth", "date_of_birth", "date", existing?.private_details?.date_of_birth || "", { max: new Date().toISOString().slice(0, 10), autocomplete: "bday" });
    highlightRequestedField("date_of_birth", dateOfBirth);
    const emergencyName = addField(profileStep, "Emergency contact full name", "emergency_contact_name", "text", existing?.private_details?.emergency_contact_name, { minLength: 2, maxLength: 120, autocomplete: "name" });
    highlightRequestedField("emergency_contact_name", emergencyName);
    const emergencyRelationship = addField(profileStep, "Relationship to you", "emergency_contact_relationship", "text", existing?.private_details?.emergency_contact_relationship, { minLength: 2, maxLength: 80 });
    highlightRequestedField("emergency_contact_relationship", emergencyRelationship);
    const emergencyPhone = addField(profileStep, "Emergency contact phone", "emergency_contact_phone", "tel", existing?.private_details?.emergency_contact_phone, { minLength: 7, maxLength: 30, autocomplete: "tel" });
    emergencyPhone.pattern = "[+0-9]{7,15}";
    highlightRequestedField("emergency_contact_phone", emergencyPhone);
    const fatherFirstName = addField(profileStep, "Father's first name", "father_first_name", "text", existing?.private_details?.father_first_name, { minLength: 1, maxLength: 80, autocomplete: "given-name" });
    highlightRequestedField("father_first_name", fatherFirstName);
    const fatherLastName = addField(profileStep, "Father's last name", "father_last_name", "text", existing?.private_details?.father_last_name, { minLength: 1, maxLength: 80, autocomplete: "family-name" });
    highlightRequestedField("father_last_name", fatherLastName);
    const permanentAddressLine1 = addField(profileStep, "Permanent address · House / building and street", "permanent_address_line1", "text", existing?.private_details?.permanent_address_line1, { minLength: 2, maxLength: 160, autocomplete: "address-line1" });
    highlightRequestedField("permanent_address_line1", permanentAddressLine1);
    const permanentAddressLine2 = addField(profileStep, "Permanent address · Area / locality (optional)", "permanent_address_line2", "text", existing?.private_details?.permanent_address_line2, { required: false, maxLength: 160, autocomplete: "address-line2" });
    highlightRequestedField("permanent_address_line2", permanentAddressLine2);
    const permanentAddressCity = addField(profileStep, "Permanent address · City / town / village", "permanent_address_city", "text", existing?.private_details?.permanent_address_city, { minLength: 2, maxLength: 100, autocomplete: "address-level2" });
    highlightRequestedField("permanent_address_city", permanentAddressCity);
    const permanentAddressDistrict = addField(profileStep, "Permanent address · District", "permanent_address_district", "text", existing?.private_details?.permanent_address_district, { minLength: 2, maxLength: 100 });
    highlightRequestedField("permanent_address_district", permanentAddressDistrict);
    const permanentAddressState = addField(profileStep, "Permanent address · State", "permanent_address_state", "text", existing?.private_details?.permanent_address_state, { minLength: 2, maxLength: 100, autocomplete: "address-level1" });
    highlightRequestedField("permanent_address_state", permanentAddressState);
    const permanentAddressPostalCode = addField(profileStep, "Permanent address · PIN / ZIP code", "permanent_address_postal_code", "text", existing?.private_details?.permanent_address_postal_code, { minLength: 6, maxLength: 6, autocomplete: "postal-code" });
    permanentAddressPostalCode.inputMode = "numeric";
    permanentAddressPostalCode.pattern = "[0-9]{6}";
    highlightRequestedField("permanent_address_postal_code", permanentAddressPostalCode);
    addSelectField(profileStep, "Blood group (optional to disclose)", "blood_group", [
      ...["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((value) => ({ id: value, label: value })),
      { id: "Prefer not to say", label: "Prefer not to say" }
    ], existing?.private_details?.blood_group || "Prefer not to say", "Choose blood group");
    highlightRequestedField("blood_group", profileStep.querySelector('[name="blood_group"]'));
    const preferredLanguage = addField(profileStep, "Preferred reporting language (optional)", "preferred_language", "text", existing?.private_details?.preferred_language, { required: false, maxLength: 80 });
    highlightRequestedField("preferred_language", preferredLanguage);
    const experienceYears = addField(profileStep, "Reporting experience in years (optional)", "experience_years", "number", existing?.private_details?.experience_years, { required: false, min: 0, max: 80, step: 0.5 });
    highlightRequestedField("experience_years", experienceYears);
    addTextareaField(profileStep, "Journalism / community reporting experience (optional)", "experience_summary", { maxLength: 2000, value: existing?.private_details?.experience_summary });
    highlightRequestedField("experience_summary", profileStep.querySelector('[name="experience_summary"]'));
    const availability = addField(profileStep, "Availability (optional)", "availability", "text", existing?.private_details?.availability, { required: false, maxLength: 120 });
    highlightRequestedField("availability", availability);

    const areaStep = addStep("Reporting location", "Choose an active State and District. The District RTO code is used when your reporter ID is issued after approval.");
    const states = (options.states || []).map((state) => ({ id: state.id, label: `${state.state_name} (${state.state_code})` }));
    const stateSelect = addSelectField(areaStep, "State", "state_id", states, existing?.state?.id || "", "Choose a state");
    highlightRequestedField("state_id", stateSelect);
    const existingRto = (options.rtos || []).find((rto) => String(rto.id) === String(existing?.rto?.id || ""));
    const rtoSelect = addSelectField(areaStep, "District", "rto_office_id", [], existing?.rto?.id || "", "Choose a state first");
    highlightRequestedField("rto_office_id", rtoSelect);
    rtoSelect.disabled = true;
    const existingCoverageAreaId = existing?.private_details?.coverage_area_id || "";
    const coverageAreaSelect = addSelectField(areaStep, "Coverage Area", "coverage_area_id", [], existingCoverageAreaId, "Choose a District first");
    highlightRequestedField("coverage_area_id", coverageAreaSelect);
    coverageAreaSelect.disabled = true;
    const preferredLocations = element("div", "reporter-preferred-locations reporter-field-full");
    preferredLocations.append(
      element("span", "", "Preferred locations (optional)"),
      element("small", "reporter-field-help", "Add any neighborhoods, towns, or other areas where you would prefer to work. These are a request for review.")
    );
    const preferredLocationFields = element("div", "reporter-preferred-location-fields");
    preferredLocations.append(preferredLocationFields);
    highlightRequestedField("coverage_localities", preferredLocations);
    const validatePreferredLocations = () => {
      const fields = [...preferredLocationFields.querySelectorAll("input")];
      const totalLength = fields.map((field) => field.value.trim()).filter(Boolean).join("\n").length;
      const valid = totalLength === 0 || (totalLength >= 2 && totalLength <= 1000);
      fields.forEach((field) => field.setCustomValidity(valid ? "" : "Enter at least two characters, and keep preferred locations within 1000 characters total."));
      return valid;
    };
    const addPreferredLocation = (value = "") => {
      const row = element("div", "reporter-preferred-location-row");
      const input = document.createElement("input");
      input.type = "text";
      input.name = "preferred_location";
      input.maxLength = 160;
      input.value = value;
      input.placeholder = "Enter a preferred location";
      input.setAttribute("aria-label", "Preferred location");
      input.required = ["correction", "reupload"].includes(requestedFields.get("coverage_localities")?.kind);
      input.addEventListener("input", validatePreferredLocations);
      const remove = element("button", "reporter-button secondary reporter-preferred-location-remove", "Remove");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove preferred location");
      remove.addEventListener("click", () => {
        if (preferredLocationFields.children.length === 1) input.value = "";
        else row.remove();
        validatePreferredLocations();
      });
      row.append(input, remove);
      preferredLocationFields.append(row);
      validatePreferredLocations();
    };
    (existing?.private_details?.coverage_localities || "")
      .split(/\r?\n/)
      .map((location) => location.trim())
      .filter(Boolean)
      .forEach(addPreferredLocation);
    if (!preferredLocationFields.children.length) addPreferredLocation();
    const addPreferredLocationButton = element("button", "reporter-button secondary reporter-preferred-location-add", "Add another location");
    addPreferredLocationButton.type = "button";
    addPreferredLocationButton.addEventListener("click", () => addPreferredLocation());
    preferredLocations.append(addPreferredLocationButton);
    areaStep.append(preferredLocations);
    const preferredLocationHint = element(
      "p",
      "reporter-card-copy reporter-field-full",
      "The selected Coverage Area is your requested administrative reporting location. Preferred locations are optional requests, not active assignments."
    );
    areaStep.append(preferredLocationHint);
    const refreshCoverageAreas = (rtoOfficeId = "", selectedCoverageAreaId = "") => {
      const selectedDistrict = (options.rtos || []).find((district) =>
        String(district.id) === String(rtoOfficeId)
      );
      const eligibleCoverageAreas = (options.coverage_areas || []).filter((coverageArea) =>
        String(coverageArea.parent_id) === String(selectedDistrict?.district_id)
      );
      coverageAreaSelect.replaceChildren();
      const placeholder = element(
        "option",
        "",
        eligibleCoverageAreas.length ? "Choose a Coverage Area" : "No active Coverage Areas for this District"
      );
      placeholder.value = "";
      placeholder.disabled = true;
      placeholder.selected = true;
      coverageAreaSelect.append(placeholder);
      eligibleCoverageAreas.forEach((coverageArea) => {
        const option = element("option", "", coverageArea.name);
        option.value = String(coverageArea.id);
        option.selected = String(coverageArea.id) === String(selectedCoverageAreaId);
        coverageAreaSelect.append(option);
      });
      coverageAreaSelect.disabled = !selectedDistrict;
    };
    const refreshDistricts = (selectedDistrictId = "") => {
      const eligibleDistricts = (options.rtos || []).filter((district) =>
        String(district.state_id) === stateSelect.value
      );
      rtoSelect.replaceChildren();
      const placeholder = element("option", "", eligibleDistricts.length ? "Choose a District" : "No active Districts for this State");
      placeholder.value = "";
      placeholder.disabled = true;
      placeholder.selected = true;
      rtoSelect.append(placeholder);
      eligibleDistricts.forEach((district) => {
        const option = element("option", "", reporterDistrictLabel(district));
        option.value = String(district.id);
        option.selected = String(district.id) === String(selectedDistrictId);
        rtoSelect.append(option);
      });
      rtoSelect.disabled = eligibleDistricts.length === 0;
      refreshCoverageAreas(rtoSelect.value, existingCoverageAreaId);
    };
    rtoSelect.addEventListener("change", () => refreshCoverageAreas(rtoSelect.value));
    stateSelect.addEventListener("change", () => refreshDistricts());
    if (stateSelect.value) refreshDistricts(existingRto?.id || "");

    const documentsStep = addStep("Identity & bank documents", "Upload clear, readable documents. These are stored privately and are visible only to authorized admins reviewing your application.");
    const privacyNote = element("p", "reporter-sensitive-data-note reporter-field-full",
      "Aadhaar: upload both sides of a MASKED Aadhaar only. Hide the first 8 digits so only the last 4 are visible on both sides. Never upload an unmasked Aadhaar copy. Avoid uploading unrelated personal documents.");
    documentsStep.append(privacyNote);
    const photoGroup = element("div", "reporter-field-full");
    cropper = createReporterPhotoCropper(photoGroup);
    cropper.    input.required = resubmitting
      ? requestedFields.get("profile_photo")?.kind === "reupload"
      : !applicationFiles.has("profile_photo");
    if (applicationFiles.has("profile_photo")
        && requestedFields.get("profile_photo")?.kind !== "reupload") {
      photoGroup.append(element("small", "reporter-field-help", "Your current profile photo is already on file; no new upload is needed."));
    }
    highlightRequestedField("profile_photo", cropper.input);
    documentsStep.append(photoGroup);
    const addDocumentInput = (type, labelText, helpText) => {
      const label = element("label", "reporter-field reporter-field-full");
      label.append(element("span", "", labelText));
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf";
      input.required = resubmitting
        ? requestedFields.get(type)?.kind === "reupload"
        : !applicationFiles.has(type);
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024
            || !["image/jpeg", "image/png", "application/pdf"].includes(file.type)) {
          input.setCustomValidity("Choose a JPG, PNG or PDF document no larger than 5 MB.");
          input.reportValidity();
          input.value = "";
          return;
        }
        input.setCustomValidity("");
        applicationFiles.set(type, file);
      });
      label.append(input, element("small", "reporter-field-help", helpText));
      if (applicationFiles.has(type) && requestedFields.get(type)?.kind !== "reupload") {
        label.append(element("small", "reporter-field-help", "This document is already on file; no new upload is needed."));
      }
      highlightRequestedField(type, input);
      documentsStep.append(label);
    };
    addDocumentInput("aadhaar_front", "Masked Aadhaar front", "Upload the front side with only the last four Aadhaar digits visible · JPG, PNG or PDF · maximum 5 MB");
    addDocumentInput("aadhaar_back", "Masked Aadhaar back", "Upload the back side; mask any Aadhaar number so only the last four digits are visible · JPG, PNG or PDF · maximum 5 MB");
    const maskedAadhaarCheck = document.createElement("label");
    maskedAadhaarCheck.className = "reporter-check reporter-field-full";
    const maskedAadhaarConfirmed = document.createElement("input");
    maskedAadhaarConfirmed.type = "checkbox";
    maskedAadhaarConfirmed.name = "masked_aadhaar_confirmed";
    maskedAadhaarConfirmed.required = true;
    maskedAadhaarConfirmed.checked = existing?.private_details?.masked_aadhaar_confirmed === true;
    maskedAadhaarCheck.append(maskedAadhaarConfirmed, element("span", "", "I confirm both Aadhaar sides are masked, with only the last four digits visible."));
    documentsStep.append(maskedAadhaarCheck);
    const privacyConsent = document.createElement("label");
    privacyConsent.className = "reporter-check reporter-field-full";
    const privacyConsentInput = document.createElement("input");
    privacyConsentInput.type = "checkbox";
    privacyConsentInput.name = "document_processing_consent";
    privacyConsentInput.required = true;
    privacyConsentInput.checked = existing?.private_details?.document_processing_consent === true;
    privacyConsent.append(
      privacyConsentInput,
      element("span", "", "I consent to Chowk securely storing and using these documents only for application review, identity verification and reporter onboarding. I understand that authorized admins can review them.")
    );
    documentsStep.append(privacyConsent);
    addDocumentInput("pan_card", "PAN card", "JPG, PNG or PDF · maximum 5 MB");
    const bankAccountHolder = addField(documentsStep, "Bank account holder name", "bank_account_holder", "text", existing?.private_details?.bank_account_holder || identity.full_name || identity.name, { minLength: 2, maxLength: 120, autocomplete: "name" });
    highlightRequestedField("bank_account_holder", bankAccountHolder);
    const bankName = addField(documentsStep, "Bank name", "bank_name", "text", existing?.private_details?.bank_name || "", { minLength: 2, maxLength: 160, autocomplete: "organization" });
    highlightRequestedField("bank_name", bankName);
    const accountNumber = addField(documentsStep, "Bank account number", "bank_account_number", "text", existing?.private_details?.bank_account_number || "", { minLength: 6, maxLength: 24, autocomplete: "off" });
    highlightRequestedField("bank_account_number", accountNumber);
    accountNumber.inputMode = "numeric";
    accountNumber.pattern = "[0-9 ]{6,29}";
    const accountNumberConfirm = addField(documentsStep, "Confirm bank account number", "bank_account_number_confirm", "text", existing?.private_details?.bank_account_number || "", { minLength: 6, maxLength: 24, autocomplete: "off" });
    accountNumberConfirm.inputMode = "numeric";
    accountNumberConfirm.pattern = "[0-9 ]{6,29}";
    const validateAccountNumber = () => {
      const matches = accountNumber.value.replace(/\s/g, "") === accountNumberConfirm.value.replace(/\s/g, "");
      accountNumberConfirm.setCustomValidity(matches ? "" : "Bank account numbers do not match.");
    };
    accountNumber.addEventListener("input", validateAccountNumber);
    accountNumberConfirm.addEventListener("input", validateAccountNumber);
    const ifsc = addField(documentsStep, "IFSC code", "bank_ifsc", "text", "", { minLength: 11, maxLength: 11, autocomplete: "off" });
    ifsc.value = existing?.private_details?.bank_ifsc || "";
    ifsc.pattern = "[A-Za-z]{4}0[A-Za-z0-9]{6}";
    highlightRequestedField("bank_ifsc", ifsc);
    ifsc.addEventListener("input", () => { ifsc.value = ifsc.value.toUpperCase(); });
    addDocumentInput("bank_proof", "Cancelled cheque / bank proof", "Upload a cancelled cheque or bank passbook first page showing the account holder, account number and IFSC · JPG, PNG or PDF · maximum 5 MB");

    const reviewStep = addStep("Review & submit", "Check your application details before sending them for admin review.");
    const declaration = document.createElement("label");
    declaration.className = "reporter-check reporter-field-full";
    const confirmed = document.createElement("input");
    confirmed.type = "checkbox";
    confirmed.name = "details_confirmed";
    confirmed.required = true;
    declaration.append(confirmed, element("span", "", "I confirm that my application details and submitted documents are accurate and belong to me."));
    reviewStep.append(declaration);

    if (resubmitting && existing?.review_note) {
      const note = element("p", "reporter-review-note reporter-field-full", `Admin requested an update: ${existing.review_note}`);
      profileStep.prepend(note);
    }
    if (resubmitting && requestedFields.size) {
      const requestedNames = new Set(requestedFields.keys());
      const visibleNames = new Set(requestedNames);
      if (requestedNames.has("state_id") || requestedNames.has("rto_office_id")) {
        visibleNames.add("state_id");
        visibleNames.add("rto_office_id");
        visibleNames.add("coverage_area_id");
      }

      steps.forEach((step) => {
        [...step.querySelectorAll("input[name], select[name], textarea[name]")].forEach((control) => {
          const name = control.name === "preferred_location" ? "coverage_localities" : control.name;
          const visible = name === "details_confirmed" || visibleNames.has(name);
          const field = control === cropper.input
            ? photoGroup
            : name === "coverage_localities"
              ? preferredLocations
              : control.closest(".reporter-field")
                || control.closest(".reporter-check")
                || control.closest("label")
                || control.parentElement;
          if (field && name !== "details_confirmed") field.hidden = !visible;
          if (!visible) {
            control.required = false;
            control.disabled = true;
          }
        });
      });

      profileStep.querySelector(".reporter-account-summary")?.setAttribute("hidden", "");
      documentsStep.querySelector(".reporter-sensitive-data-note")?.toggleAttribute(
        "hidden",
        !requestedNames.has("aadhaar_front") && !requestedNames.has("aadhaar_back")
      );
      const visibleSteps = steps.filter((step) =>
        step === reviewStep || [...step.querySelectorAll("input, select, textarea")]
          .some((control) => !control.disabled && control.name !== "details_confirmed")
      );
      steps.splice(0, steps.length, ...visibleSteps);
      progress.replaceChildren(...visibleSteps.map((step, index) => {
        const indicator = document.createElement("li");
        indicator.append(element("span", "", String(index + 1)), element("strong", "", step.querySelector("legend")?.textContent.replace(/^\d+\.\s*/, "") || "Update"));
        return indicator;
      }));
      activeStep = 0;
      nextButton.textContent = "Review update";
      submit.textContent = "Confirm and resubmit";
      reviewStep.querySelector(".reporter-card-copy")?.replaceWith(
        element("p", "reporter-card-copy reporter-field-full", "Review only the information requested by the admin. Your other details and documents will remain on file.")
      );
      if (!requestedNames.has("masked_aadhaar_confirmed")) maskedAadhaarCheck.hidden = true;
      if (!requestedNames.has("document_processing_consent")) privacyConsent.hidden = true;
    }
    updateSteps = () => {
      steps.forEach((step, index) => {
        step.hidden = index !== activeStep;
        progress.children[index].classList.toggle("is-active", index === activeStep);
        progress.children[index].classList.toggle("is-complete", index < activeStep);
      });
      backButton.hidden = activeStep === 0;
      nextButton.hidden = activeStep === steps.length - 1;
      submit.hidden = activeStep !== steps.length - 1;
    };
    const validateCurrentStep = () => {
      const invalidField = [...steps[activeStep].querySelectorAll("input, select, textarea")]
        .find((field) => !field.checkValidity());
      if (invalidField) invalidField.reportValidity();
      return !invalidField;
    };
    nextButton.addEventListener("click", () => {
      if (!validateCurrentStep()) return;
      activeStep = Math.min(activeStep + 1, steps.length - 1);
      updateSteps();
      applicationPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    backButton.addEventListener("click", () => {
      activeStep = Math.max(activeStep - 1, 0);
      updateSteps();
    });
    updateSteps();
    if (resubmitting && existing?.review_note) {
      form.dataset.resubmitting = "true";
    }
    form.append(progress, stepContainers);
  }
  const summary = element("section", "reporter-application-review");
  summary.hidden = true;
  form.append(summary);
  form.append(navigation);
  applicationPanel.append(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateLastStep()) return;
    if (summary.hidden) {
      const values = new FormData(form);
      const selectedState = options.states.find((state) => String(state.id) === String(values.get("state_id")));
      const selectedRto = options.rtos.find((rto) => String(rto.id) === String(values.get("rto_office_id")));
      const selectedCoverageArea = (options.coverage_areas || []).find((coverageArea) =>
        String(coverageArea.id) === String(values.get("coverage_area_id"))
      );
      const preferredLocationValues = values.getAll("preferred_location")
        .map((location) => String(location).trim())
        .filter(Boolean);
      summary.replaceChildren(
        element("strong", "", "Check your application before sending"),
        ...(resubmitting
          ? [
            ...[...requestedFields.values()].map((request) => {
              const label = request.field.replaceAll("_", " ");
              if (request.kind === "reupload") return element("span", "", `${label}: replacement uploaded`);
              if (request.field === "permanent_address_postal_code") {
                return element("span", "", `${label}: ${String(values.get(request.field) || "")}`);
              }
              if (request.field === "coverage_localities") {
                return element("span", "", `${label}: ${preferredLocationValues.join(", ") || "No locations entered"}`);
              }
              return element("span", "", `${label}: ${String(values.get(request.field) || "Updated as requested")}`);
            }),
            element("span", "", "Other application information and documents remain unchanged.")
          ]
          : [
            element("span", "", `State: ${selectedState?.state_name || "—"}`),
            element("span", "", `District and RTO code: ${selectedRto ? `${reporterDistrictLabel(selectedRto)} · RTO ${selectedRto.rto_code}` : "—"}`),
            element("span", "", `Coverage Area: ${selectedCoverageArea?.name || "—"}`),
            element("span", "", `Preferred locations: ${preferredLocationValues.join(", ") || "None provided"}`),
            element("span", "", `Emergency contact: ${String(values.get("emergency_contact_name") || "")} · ${String(values.get("emergency_contact_phone") || "")}`),
            element("span", "", `Documents attached: ${new Set([...applicationFiles.keys(), ...(cropper.input.files?.length ? ["profile_photo"] : [])]).size} of 5`),
            element("span", "", `Bank account ending: ${String(values.get("bank_account_number") || "").replace(/\s/g, "").slice(-4) || "—"}`),
            element("span", "", "An admin reviews this application. Your account stays a subscriber until onboarding is complete.")
          ])
      );
      const edit = element("button", "reporter-button secondary", "Edit application details");
      edit.type = "button";
      edit.addEventListener("click", () => {
        summary.hidden = true;
        updateSteps();
        applicationPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      summary.append(edit);
      summary.hidden = false;
      submit.textContent = "Confirm and submit";
      nextButton.hidden = true;
      backButton.hidden = true;
      summary.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    submit.disabled = true;
    submit.textContent = "Submitting…";
    const values = new FormData(form);
    const uploadedDocuments = [];
    const newlyUploadedDocuments = [];
    try {
      if (cropper.input.files?.length) {
        applicationFiles.set("profile_photo", await cropper.file());
      }
      for (const documentType of ["profile_photo", "aadhaar_front", "aadhaar_back", "pan_card", "bank_proof"]) {
        const file = applicationFiles.get(documentType);
        if (!file) {
          if (resubmitting) continue;
          throw new Error(`Upload the required ${documentType.replaceAll("_", " ")} document.`);
        }
        if (file instanceof File) {
          showMessage(`Uploading ${documentType.replaceAll("_", " ")}…`);
          const uploaded = (await request("/api/reporter/application-documents", "POST", {
            document_type: documentType,
            mime_type: file.type,
            file_base64: await readFileAsBase64(file)
          })).data;
          uploadedDocuments.push(uploaded);
          newlyUploadedDocuments.push(uploaded);
        }
      }
      const payload = {
        details_confirmed: values.get("details_confirmed") === "on",
        state_id: values.get("state_id"),
        rto_office_id: values.get("rto_office_id"),
        private_details: {
          emergency_contact_name: String(values.get("emergency_contact_name") || "").trim(),
          father_first_name: String(values.get("father_first_name") || "").trim(),
          father_last_name: String(values.get("father_last_name") || "").trim(),
          permanent_address_line1: String(values.get("permanent_address_line1") || "").trim(),
          permanent_address_line2: String(values.get("permanent_address_line2") || "").trim(),
          permanent_address_city: String(values.get("permanent_address_city") || "").trim(),
          permanent_address_district: String(values.get("permanent_address_district") || "").trim(),
          permanent_address_state: String(values.get("permanent_address_state") || "").trim(),
          permanent_address_postal_code: String(values.get("permanent_address_postal_code") || "").trim(),
          mobile_number: String(values.get("mobile_number") || "").trim(),
          date_of_birth: String(values.get("date_of_birth") || ""),
          emergency_contact_relationship: String(values.get("emergency_contact_relationship") || "").trim(),
          emergency_contact_phone: String(values.get("emergency_contact_phone") || "").trim(),
          blood_group: String(values.get("blood_group") || "Prefer not to say"),
          masked_aadhaar_confirmed: values.get("masked_aadhaar_confirmed") === "on",
          document_processing_consent: values.get("document_processing_consent") === "on",
          preferred_language: String(values.get("preferred_language") || "").trim(),
          coverage_area_id: String(values.get("coverage_area_id") || ""),
          coverage_localities: values.getAll("preferred_location")
            .map((location) => String(location).trim())
            .filter(Boolean)
            .join("\n"),
          experience_years: String(values.get("experience_years") || ""),
          experience_summary: String(values.get("experience_summary") || "").trim(),
          availability: String(values.get("availability") || "").trim(),
          bank_account_holder: String(values.get("bank_account_holder") || "").trim(),
          bank_name: String(values.get("bank_name") || "").trim(),
          bank_account_number: String(values.get("bank_account_number") || "").replace(/\s/g, ""),
          bank_ifsc: String(values.get("bank_ifsc") || "").trim().toUpperCase()
        }
      };
      payload.application_documents = uploadedDocuments;
      await request("/api/reporter/applications", "POST", payload);
      for (const oldDocument of existing?.documents || []) {
        const replacement = uploadedDocuments.find((item) => item.document_type === oldDocument.document_type);
        if (!replacement || replacement.storage_path === oldDocument.storage_path) continue;
        try {
          await request("/api/reporter/application-documents", "DELETE", {
            storage_path: oldDocument.storage_path
          });
        } catch (cleanupError) {
          console.error("Could not remove a replaced reporter document:", cleanupError.message);
        }
      }
      showMessage("Your reporter application was submitted.", true);
      cropper?.dispose();
      await loadReporterDesk();
    } catch (error) {
      for (const document of newlyUploadedDocuments) {
        try {
          await request("/api/reporter/application-documents", "DELETE", {
            storage_path: document.storage_path
          });
        } catch (cleanupError) {
          console.error("Could not remove an unsubmitted reporter document:", cleanupError.message);
        }
      }
      showMessage(error.message);
    } finally {
      submit.disabled = false;
      submit.textContent = resubmitting ? "Confirm and resubmit" : "Confirm and submit";
    }
  });

  function validateLastStep() {
    if (!steps.length) return form.reportValidity();
    const invalidField = [...steps[activeStep].querySelectorAll("input, select, textarea")]
      .find((field) => !field.checkValidity());
    if (invalidField) invalidField.reportValidity();
    return !invalidField;
  }
}

function renderTargetedReporterResubmission(application) {
  applicationPanel.replaceChildren();
  applicationPanel.hidden = false;
  applicationPanel.append(
    element("h2", "", "Update requested information"),
    element("p", "reporter-card-copy", "Only the fields the admin requested are shown. Your other application details and documents remain unchanged.")
  );

  const requests = Array.isArray(application?.review_requests) ? application.review_requests : [];
  if (!requests.length) {
    applicationPanel.append(element(
      "p",
      "reporter-review-note",
      "Your application needs more information, but no specific fields were included in the request. Contact an admin and ask them to send a field-specific request before resubmitting."
    ));
    return;
  }

  const form = element("form", "reporter-form-grid");
  const requestedFields = new Map(requests.map((request) => [request.field, request]));
  const requestedNames = new Set(requestedFields.keys());
  const supportedFields = new Set([
    "state_id", "rto_office_id", "mobile_number", "date_of_birth",
    "father_first_name", "father_last_name", "permanent_address_line1",
    "permanent_address_line2", "permanent_address_city", "permanent_address_district",
    "permanent_address_state", "permanent_address_postal_code",
    "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone",
    "blood_group", "preferred_language", "coverage_area_id", "coverage_localities",
    "experience_years", "experience_summary", "availability", "bank_account_holder",
    "bank_name", "bank_account_number", "bank_ifsc", "profile_photo", "aadhaar_front",
    "aadhaar_back", "pan_card", "bank_proof"
  ]);
  const unsupportedField = [...requestedNames].find((field) => !supportedFields.has(field));
  if (unsupportedField) {
    applicationPanel.append(element(
      "p",
      "reporter-review-note",
      `The admin requested an unsupported field (“${unsupportedField}”). Contact an administrator before resubmitting.`
    ));
    return;
  }
  const isLocationUpdate = ["state_id", "rto_office_id", "coverage_area_id"]
    .some((field) => requestedNames.has(field));
  const fieldNames = [...requestedNames];
  if (isLocationUpdate) {
    ["state_id", "rto_office_id", "coverage_area_id"].forEach((field) => {
      if (!fieldNames.includes(field)) fieldNames.push(field);
    });
  }

  const privateDetails = application?.private_details || {};
  const documentRecords = new Map((application?.documents || [])
    .map((document) => [document.document_type, document]));
  const fieldLabels = {
    state_id: "State",
    rto_office_id: "District",
    mobile_number: "Mobile number",
    date_of_birth: "Date of birth",
    emergency_contact_name: "Emergency contact name",
    emergency_contact_relationship: "Emergency relationship",
    emergency_contact_phone: "Emergency contact phone",
    father_first_name: "Father's first name",
    father_last_name: "Father's last name",
    permanent_address_line1: "Permanent address · House / building and street",
    permanent_address_line2: "Permanent address · Area / locality",
    permanent_address_city: "Permanent address · City / town / village",
    permanent_address_district: "Permanent address · District",
    permanent_address_state: "Permanent address · State",
    permanent_address_postal_code: "Permanent address · PIN / ZIP code",
    blood_group: "Blood group",
    preferred_language: "Preferred language",
    coverage_area_id: "Coverage Area",
    coverage_localities: "Preferred locations",
    experience_years: "Reporting experience",
    experience_summary: "Experience summary",
    availability: "Availability",
    bank_account_holder: "Bank account holder",
    bank_name: "Bank name",
    bank_account_number: "Bank account number",
    bank_ifsc: "IFSC",
    profile_photo: "Profile photo",
    aadhaar_front: "Masked Aadhaar front",
    aadhaar_back: "Masked Aadhaar back",
    pan_card: "PAN card",
    bank_proof: "Bank proof"
  };
  const controls = new Map();
  const addControl = (field, control, label) => {
    control.name = field;
    control.required = true;
    label.append(control);
    const request = requestedFields.get(field);
    if (request?.instruction) {
      label.append(element("small", "reporter-review-request-inline", request.instruction));
    }
    form.append(label);
    controls.set(field, control);
  };

  let stateSelect = null;
  let districtSelect = null;
  let coverageAreaSelect = null;
  if (isLocationUpdate) {
    const locationField = (field, labelText) => {
      const label = element("label", "reporter-field");
      label.append(element("span", "", labelText));
      const select = document.createElement("select");
      addControl(field, select, label);
      return select;
    };
    stateSelect = locationField("state_id", "State");
    districtSelect = locationField("rto_office_id", "District");
    coverageAreaSelect = locationField("coverage_area_id", "Coverage Area");
    const statePlaceholder = element("option", "", "Choose a State");
    statePlaceholder.value = "";
    statePlaceholder.disabled = true;
    statePlaceholder.selected = !(options.states || []).some((state) =>
      String(state.id) === String(application?.state?.id || "")
    );
    stateSelect.prepend(statePlaceholder);
    (options.states || []).forEach((state) => {
      const option = element("option", "", `${state.state_name} (${state.state_code})`);
      option.value = String(state.id);
      option.selected = String(state.id) === String(application?.state?.id || "");
      stateSelect.append(option);
    });
    const fillDistricts = (selectedId = "") => {
      districtSelect.replaceChildren();
      const districts = (options.rtos || []).filter((district) =>
        String(district.state_id) === stateSelect.value
      );
      const districtPlaceholder = element("option", "", "Choose a District");
      districtPlaceholder.value = "";
      districtPlaceholder.disabled = true;
      districtPlaceholder.selected = !districts.some((district) =>
        String(district.id) === String(selectedId)
      );
      districtSelect.append(districtPlaceholder);
      districts.forEach((district) => {
        const option = element("option", "", reporterDistrictLabel(district));
        option.value = String(district.id);
        option.selected = String(district.id) === String(selectedId);
        districtSelect.append(option);
      });
      fillCoverageAreas(application?.private_details?.coverage_area_id || "");
    };
    const fillCoverageAreas = (selectedId = "") => {
      const selectedDistrict = (options.rtos || []).find((district) =>
        String(district.id) === String(districtSelect.value)
      );
      coverageAreaSelect.replaceChildren();
      const coverageAreas = (options.coverage_areas || [])
        .filter((area) => String(area.parent_id) === String(selectedDistrict?.district_id));
      const coveragePlaceholder = element("option", "", "Choose a Coverage Area");
      coveragePlaceholder.value = "";
      coveragePlaceholder.disabled = true;
      coveragePlaceholder.selected = !coverageAreas.some((area) =>
        String(area.id) === String(selectedId)
      );
      coverageAreaSelect.append(coveragePlaceholder);
      coverageAreas.forEach((area) => {
        const option = element("option", "", area.name);
        option.value = String(area.id);
        option.selected = String(area.id) === String(selectedId);
        coverageAreaSelect.append(option);
      });
    };
    const currentDistrict = (options.rtos || []).find((district) =>
      String(district.id) === String(application?.rto?.id || "")
    );
    fillDistricts(currentDistrict?.id || "");
    stateSelect.addEventListener("change", () => fillDistricts());
    districtSelect.addEventListener("change", () => fillCoverageAreas());
  }

  const privateFieldTypes = {
    mobile_number: "tel",
    date_of_birth: "date",
    emergency_contact_name: "text",
    emergency_contact_relationship: "text",
    emergency_contact_phone: "tel",
    father_first_name: "text",
    father_last_name: "text",
    permanent_address_line1: "text",
    permanent_address_line2: "text",
    permanent_address_city: "text",
    permanent_address_district: "text",
    permanent_address_state: "text",
    permanent_address_postal_code: "text",
    preferred_language: "text",
    experience_years: "number",
    experience_summary: "textarea",
    availability: "text",
    bank_account_holder: "text",
    bank_name: "text",
    bank_account_number: "text",
    bank_ifsc: "text",
    coverage_localities: "textarea"
  };
  const documentInputs = new Map();
  fieldNames.forEach((field) => {
    if (["state_id", "rto_office_id", "coverage_area_id"].includes(field) && isLocationUpdate) return;
    const label = element("div", "reporter-field reporter-field-full");
    label.append(element("span", "", fieldLabels[field] || field.replaceAll("_", " ")));
    if (["profile_photo", "aadhaar_front", "aadhaar_back", "pan_card", "bank_proof"].includes(field)) {
      const reviewRequest = requestedFields.get(field);
      if (reviewRequest?.kind !== "reupload") {
        label.append(element("small", "reporter-review-request-inline", reviewRequest?.instruction || "Follow the admin's instruction; no replacement upload was requested."));
        form.append(label);
        return;
      }
      const fileContainer = element("div", "reporter-field-full");
      if (field === "profile_photo") {
        const cropper = createReporterPhotoCropper(fileContainer);
        cropper.input.required = true;
        documentInputs.set(field, { input: cropper.input, cropper });
      } else {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf";
        input.required = true;
        documentInputs.set(field, { input });
        fileContainer.append(input);
      }
      fileContainer.append(element("small", "reporter-field-help", "Only this requested document needs to be reuploaded. JPG, PNG or PDF · maximum 5 MB."));
      label.append(fileContainer);
      const request = requestedFields.get(field);
      if (request?.instruction) label.append(element("small", "reporter-review-request-inline", request.instruction));
      form.append(label);
      return;
    }

    if (field === "blood_group") return;
    const type = privateFieldTypes[field];
    if (!type) {
      form.append(element("p", "reporter-review-note", `The requested field “${field}” cannot be edited here. Contact an administrator.`));
      return;
    }
    const control = type === "textarea" ? document.createElement("textarea") : document.createElement("input");
    if (type !== "textarea") control.type = type;
    control.value = privateDetails[field] == null ? "" : String(privateDetails[field]);
    if (field === "date_of_birth") control.max = new Date().toISOString().slice(0, 10);
    if (field === "experience_years") {
      control.min = "0";
      control.max = "80";
      control.step = "0.5";
    }
    if ([
      "preferred_language", "coverage_localities", "experience_years",
      "experience_summary", "availability", "permanent_address_line2"
    ].includes(field)) {
      control.required = false;
    }
    if (field === "permanent_address_postal_code") {
      control.minLength = 6;
      control.maxLength = 6;
      control.inputMode = "numeric";
      control.pattern = "[0-9]{6}";
    }
    if (["father_first_name", "father_last_name"].includes(field)) {
      control.minLength = 1;
      control.maxLength = 80;
    }
    if (["permanent_address_line1", "permanent_address_line2"].includes(field)) {
      control.maxLength = 160;
      if (field === "permanent_address_line1") control.minLength = 2;
    }
    if (["permanent_address_city", "permanent_address_district", "permanent_address_state"].includes(field)) {
      control.minLength = 2;
      control.maxLength = 100;
    }
    if (field === "preferred_language") control.maxLength = 80;
    if (field === "coverage_localities") control.maxLength = 1000;
    if (field === "experience_summary") control.maxLength = 2000;
    if (field === "availability") control.maxLength = 120;
    if (field === "mobile_number") control.pattern = "\\+?[0-9]{7,15}";
    if (field === "emergency_contact_name") {
      control.minLength = 2;
      control.maxLength = 120;
    }
    if (field === "emergency_contact_relationship") {
      control.minLength = 2;
      control.maxLength = 80;
    }
    if (field === "emergency_contact_phone") {
      control.pattern = "[+0-9() .-]{7,30}";
      control.maxLength = 30;
    }
    if (field === "bank_account_holder") {
      control.minLength = 2;
      control.maxLength = 120;
    }
    if (field === "bank_name") {
      control.minLength = 2;
      control.maxLength = 160;
    }
    if (field === "bank_ifsc") {
      control.maxLength = 11;
      control.pattern = "[A-Za-z]{4}0[A-Za-z0-9]{6}";
      control.addEventListener("input", () => { control.value = control.value.toUpperCase(); });
    }
    if (field === "bank_account_number") {
      control.minLength = 6;
      control.maxLength = 24;
      control.pattern = "[0-9]{6,24}";
    }
    addControl(field, control, label);
  });

  if (requestedNames.has("blood_group")) {
    const label = element("label", "reporter-field");
    label.append(element("span", "", fieldLabels.blood_group));
    const select = document.createElement("select");
    ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Prefer not to say"].forEach((value) => {
      const option = element("option", "", value);
      option.value = value;
      option.selected = value === privateDetails.blood_group;
      select.append(option);
    });
    addControl("blood_group", select, label);
  }

  const submit = element("button", "reporter-button reporter-field-full", "Send requested update");
  submit.type = "submit";
  form.append(submit);
  applicationPanel.append(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    submit.textContent = "Submitting update…";
    const uploadedDocuments = [];
    try {
      for (const [field, { input, cropper }] of documentInputs) {
        let file = input.files?.[0];
        if (field === "profile_photo" && file) file = await cropper.file();
        if (!file) throw new Error(`Upload the requested ${fieldLabels[field] || field} document.`);
        if (file.size > 5 * 1024 * 1024
            || !["image/jpeg", "image/png", "application/pdf"].includes(file.type)
            || (field === "profile_photo" && file.type === "application/pdf")) {
          throw new Error("Choose a supported JPG, PNG or PDF file no larger than 5 MB.");
        }
        showMessage(`Uploading ${fieldLabels[field] || field}…`);
        const uploaded = (await request("/api/reporter/application-documents", "POST", {
          document_type: field,
          mime_type: file.type,
          file_base64: await readFileAsBase64(file)
        })).data;
        uploadedDocuments.push(uploaded);
      }

      const values = new FormData(form);
      const updatedPrivateDetails = {};
      for (const field of requestedNames) {
        if (controls.has(field) && !["state_id", "rto_office_id"].includes(field)) {
          updatedPrivateDetails[field] = values.get(field);
        }
      }
      if (isLocationUpdate) updatedPrivateDetails.coverage_area_id = values.get("coverage_area_id");
      const payload = {
        details_confirmed: true,
        state_id: isLocationUpdate ? values.get("state_id") : application.state?.id,
        rto_office_id: isLocationUpdate ? values.get("rto_office_id") : application.rto?.id,
        private_details: updatedPrivateDetails,
        application_documents: uploadedDocuments
      };
      await request("/api/reporter/applications", "POST", payload);

      for (const replacement of uploadedDocuments) {
        const oldDocument = documentRecords.get(replacement.document_type);
        if (!oldDocument || oldDocument.storage_path === replacement.storage_path) continue;
        try {
          await request("/api/reporter/application-documents", "DELETE", { storage_path: oldDocument.storage_path });
        } catch (cleanupError) {
          console.error("Could not remove a replaced reporter document:", cleanupError.message);
        }
      }
      showMessage("Your requested updates were sent to the admin for review.", true);
      await loadReporterDesk();
    } catch (error) {
      for (const document of uploadedDocuments) {
        try {
          await request("/api/reporter/application-documents", "DELETE", { storage_path: document.storage_path });
        } catch (cleanupError) {
          console.error("Could not remove an unsubmitted reporter document:", cleanupError.message);
        }
      }
      showMessage(error.message);
    } finally {
      submit.disabled = false;
      submit.textContent = "Send requested update";
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
  const publishedAgreement = options.service_agreement;
  const publishedIssue = application.service_agreement_issue;
  const personalizedIssueIsCurrent = publishedAgreement?.template_content
    && publishedIssue?.status === "published"
    && publishedIssue.agreement_version === publishedAgreement.version
    && publishedIssue.agreement_sha256 === publishedAgreement.sha256;
  const current = personalizedIssueIsCurrent
    ? {
        ...publishedIssue,
        issue_id: publishedIssue.id,
        version: publishedIssue.agreement_version,
        sha256: publishedIssue.agreement_sha256,
        document_url: `/api/reporter/service-agreement-issued-document?issue_id=${encodeURIComponent(publishedIssue.id)}`
      }
    : null;
  const acceptedCurrent = current
    && application.service_agreement_version === current.version
    && application.service_agreement_sha256 === current.sha256
    && application.service_agreement_accepted_at
    && (application.service_acceptances || []).some((receipt) =>
      String(receipt.issue_id) === String(current.issue_id));
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
    const download = element("a", "", "Download the accepted service agreement");
    download.href = `${link.href}${link.href.includes("?") ? "&" : "?"}download=1`;
    download.target = "_blank";
    download.rel = "noopener noreferrer";
    panel.append(link, download);
    panel.append(element("p", "reporter-card-copy", activeReporter
      ? "Your current service agreement is on file. Keep the issued authority letter current for your assigned area."
      : "Next: Chowk issues an authority letter for your assigned reporting area. Reporter access activates only after you acknowledge that letter."));
  } else if (!publishedAgreement?.template_content) {
    panel.append(element(
      "p",
      "reporter-review-note",
      "Chowk has not published a personalized service-agreement template yet. An administrator must publish finalized terms and issue your individualized PDF before you can review or accept it."
    ));
  } else if (publishedAgreement.template_content && !personalizedIssueIsCurrent) {
    panel.append(element(
      "p",
      "reporter-review-note",
      publishedIssue?.status === "published"
        ? "A newer service-agreement version is published. Chowk must review and issue your updated personalized PDF before you can accept it."
        : "Chowk is preparing your personalized service agreement using the verified company details and your approved application. It will appear here for PDF review and acceptance once an administrator issues it."
    ));
  } else {
    panel.append(element("p", "reporter-card-copy", activeReporter
      ? `Review the new service / appointment agreement, version ${current.version}. Accepting it records the current terms for any renewed authority.`
      : `Review your personalized service / appointment agreement, version ${current.version}.`));
    const link = element("a", "", "Open the full service agreement");
    link.href = current.document_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const download = element("a", "", "Download service agreement PDF");
    download.href = `${current.document_url}${current.document_url.includes("?") ? "&" : "?"}download=1`;
    download.target = "_blank";
    download.rel = "noopener noreferrer";
    const documentHash = current.document_sha256 || current.sha256;
    panel.append(
      link,
      download,
      element("span", "reporter-card-copy", `Document SHA-256: ${documentHash}`),
      ...(current.document_sha256
        ? [element("span", "reporter-card-copy", `Agreement terms SHA-256: ${current.sha256}`)]
        : [])
    );
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
          ...(current.issue_id ? { issue_id: current.issue_id } : {}),
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
  const acceptanceReceipts = application.service_acceptances || [];
  if (acceptanceReceipts.length) {
    panel.append(element("h4", "", "Service agreement acceptance history"));
    acceptanceReceipts.forEach((receipt) => {
      panel.append(element(
        "p",
        "reporter-card-copy",
        `Acceptance record · v${receipt.agreement_version} · ${receipt.signer_name} · ${formatDate(receipt.accepted_at)} · SHA-256 ${receipt.agreement_sha256}`
      ));
      if (receipt.document_storage_path && receipt.id) {
        const receiptLink = element("a", "", `View accepted copy · v${receipt.agreement_version}`);
        const receiptUrl = `/api/reporter/service-agreement-accepted-document?acceptance_id=${encodeURIComponent(receipt.id)}`;
        receiptLink.href = receiptUrl;
        receiptLink.target = "_blank";
        receiptLink.rel = "noopener noreferrer";
        const receiptDownload = element("a", "", `Download accepted copy · v${receipt.agreement_version}`);
        receiptDownload.href = `${receiptUrl}&download=1`;
        receiptDownload.target = "_blank";
        receiptDownload.rel = "noopener noreferrer";
        panel.append(receiptLink, receiptDownload);
      }
    });
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
      && Boolean(application.service_agreement_accepted_at)
      && Boolean(application.service_agreement_issue_id)
      && (application.service_acceptances || []).some((receipt) =>
        String(receipt.issue_id) === String(application.service_agreement_issue_id));
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
      dataItem("District / RTO code", reporterCityLabel(application.rto)),
      dataItem("Review completed", formatDate(application.reviewed_at)),
      dataItem("Reviewed by", application.reviewer_name || "—"),
      dataItem("Decision recorded", application.company_signer_name || "—")
    );
    statusPanel.append(details);
    if (application.review_note) {
      statusPanel.append(element("h3", "", application.status === "needs_information"
        ? "What you need to do"
        : application.status === "rejected"
          ? "Decision reason"
          : "Review note"));
      statusPanel.append(element("p", "reporter-card-copy", application.review_note));
    }
    if (application.status === "needs_information" && application.review_requests?.length) {
      const requestList = element("ul", "reporter-review-request-list");
      const fieldLabels = {
        state_id: "State",
        rto_office_id: "District",
        mobile_number: "Mobile number",
        date_of_birth: "Date of birth",
        father_first_name: "Father's first name",
        father_last_name: "Father's last name",
        permanent_address_line1: "Permanent address · House / building and street",
        permanent_address_line2: "Permanent address · Area / locality",
        permanent_address_city: "Permanent address · City / town / village",
        permanent_address_district: "Permanent address · District",
        permanent_address_state: "Permanent address · State",
        permanent_address_postal_code: "Permanent address · PIN / ZIP code",
        emergency_contact_name: "Emergency contact",
        emergency_contact_relationship: "Emergency relationship",
        emergency_contact_phone: "Emergency phone",
        blood_group: "Blood group",
        coverage_area_id: "Coverage Area",
        coverage_localities: "Preferred locations",
        preferred_language: "Preferred language",
        experience_years: "Reporting experience",
        experience_summary: "Experience summary",
        availability: "Availability",
        bank_account_holder: "Bank account holder",
        bank_name: "Bank name",
        bank_account_number: "Bank account number",
        bank_ifsc: "IFSC",
        profile_photo: "Profile photo",
        aadhaar_front: "Aadhaar front",
        aadhaar_back: "Aadhaar back",
        pan_card: "PAN card",
        bank_proof: "Bank proof"
      };
      application.review_requests.forEach((request) => {
        const label = fieldLabels[request.field] || request.field.replaceAll("_", " ");
        requestList.append(element(
          "li",
          "",
          `${request.kind === "reupload" ? "Reupload" : request.kind === "other" ? "Other action" : "Correction"} · ${label}: ${request.instruction}`
        ));
      });
      statusPanel.append(element("h3", "", "Requested field updates"), requestList);
    }
    if (application.status === "approved") {
      statusPanel.append(element(
        "p",
        "reporter-next-step",
        "Approved does not mean field-authorized yet. Accept the service agreement, then review and acknowledge the authority letter Chowk issues for your assigned area."
      ));
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
          assignment.effective_to ? "Past assignment" : "Current assignment",
          `${assignment.state_name || ""} ${assignment.rto_code || ""} ${assignment.city_name || ""} · ${formatDate(assignment.effective_from)} – ${assignment.effective_to ? formatDate(assignment.effective_to) : "Current"}`
        ));
      });
      statusPanel.append(history);
    }
  }
  if (application?.status === "needs_information" || application?.status === "rejected") {
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
    let displayStatus = currentCredentialStatus(credential);
    const onboardingPending = identity.role === "subscriber"
      && reporterData.application?.status === "approved"
      && credentials.some((item) =>
        item.credential_type === "authority_letter" && item.status === "pending_acceptance"
      );
    if (displayStatus === "active"
        && onboardingPending
        && credential.credential_type === "id_card"
        && credential.role === "reporter") {
      displayStatus = "pending_acceptance";
    }
    const card = element("article", "reporter-credential");
    const header = element("div", "reporter-credential-header");
    header.append(
      element("h3", "", credential.credential_type === "id_card" ? "Staff ID card" : "Reporter authority letter"),
      element("span", `reporter-status-pill ${displayStatus}`, displayStatus.replaceAll("_", " "))
    );
    card.append(header);
    const values = element("div", "reporter-data-grid");
    values.append(
      dataItem("Reference", credential.reference_code, true),
      dataItem("Valid from", formatDate(credential.valid_from)),
      dataItem("Valid until", formatDate(credential.valid_until)),
      dataItem("Reporter ID", reporterData.reporter?.reporter_code || credential.reporter_code),
      dataItem("Designation", credential.scope?.designation),
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
    if (credential.credential_type === "authority_letter" && displayStatus === "pending_acceptance") {
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

function currentCredentialStatus(credential) {
  if (!["active", "pending_acceptance"].includes(credential.status)) return credential.status;
  const today = new Date().toISOString().slice(0, 10);
  if (credential.valid_until < today) return "expired";
  if (credential.valid_from > today) return "not_yet_valid";
  return credential.status;
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
