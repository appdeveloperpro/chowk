require("dotenv").config({ quiet: true });

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const QRCode = require("qrcode");
const {
  createReporterAgreementPdf,
  defaultReporterAgreementTemplate,
  normalizeReporterServiceAgreementTemplate,
  reporterAgreementTemplateFields,
  unknownTemplateTokens
} = require("./reporter-agreement");

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.resolve(__dirname, "..", "public");
const credentialCardLogo = `data:image/png;base64,${fs.readFileSync(path.join(publicDirectory, "chowk-logo.png")).toString("base64")}`;
const maxRequestBodyBytes = 1024 * 1024;
const apiTimeoutMs = 20_000;
const categoryIconKeys = new Set([
  "newspaper", "siren", "sprout", "trophy", "cpu", "leaf", "chart", "clapperboard",
  "landmark", "globe", "book", "heart", "map-pin", "cloud", "briefcase"
]);
const userCookie = "chowk_user_session";
const adminCookie = "chowk_admin_session";
const sessionMaxAge = 60 * 60;
const requestContext = new AsyncLocalStorage();
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png"
};

function staffAgreementValues(profile, onboarding) {
  const address = [
    onboarding.permanent_address_line1,
    onboarding.permanent_address_line2,
    onboarding.permanent_address_city,
    onboarding.permanent_address_district,
    onboarding.permanent_address_state,
    onboarding.permanent_address_postal_code
  ].map((value) => String(value || "").trim()).filter(Boolean).join(", ");
  return {
    "staff.full_name": profile.full_name || "",
    "staff.email": profile.email || "",
    "staff.phone": profile.phone || "",
    "staff.role": onboarding.requested_role || "",
    "staff.address": address,
    "staff.address_line1": onboarding.permanent_address_line1 || "",
    "staff.address_line2": onboarding.permanent_address_line2 || "",
    "staff.city": onboarding.permanent_address_city || "",
    "staff.district": onboarding.permanent_address_district || "",
    "staff.state": onboarding.permanent_address_state || "",
    "staff.postal_code": onboarding.permanent_address_postal_code || "",
    "staff.date_of_birth": onboarding.date_of_birth || ""
  };
}

function renderStaffAgreement(template, terms, profile, onboarding) {
  const values = staffAgreementValues(profile, onboarding);
  const allowedTokens = new Set(Object.keys(values));
  const rendered = template.replace(/\{\{([^{}]+)\}\}/g, (token, key) => {
    if (key.startsWith("terms.")) {
      const termKey = key.slice("terms.".length);
      if (!/^[a-z][a-z0-9_]{0,49}$/.test(termKey)
          || !Object.hasOwn(terms, termKey)
          || typeof terms[termKey] !== "string"
          || !terms[termKey].trim()) {
        throw new Error(`Agreement contains an unknown or unresolved term placeholder: ${token}`);
      }
      return terms[termKey];
    }
    if (!allowedTokens.has(key)) {
      throw new Error(`Agreement contains an unknown placeholder: ${token}`);
    }
    return String(values[key] ?? "");
  });
  if (rendered.includes("{{") || rendered.includes("}}")) {
    throw new Error("Agreement contains an unresolved or malformed placeholder.");
  }
  if (rendered.length > 200000) {
    throw new Error("The personalized agreement exceeds the maximum supported size.");
  }
  return rendered;
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data));
}

function sendPdf(response, pdf, filename, download = false, extraHeaders = {}) {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  response.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Length": pdf.length,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeFilename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  response.end(pdf);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function requestOrigin(request) {
  return request.headers.origin
    || `${request.headers["x-forwarded-proto"]?.split(",")[0].trim() || (request.socket.encrypted ? "https" : "http")}://${request.headers["x-forwarded-host"]?.split(",")[0].trim() || request.headers.host}`;
}

async function credentialCardDetails(credential, token) {
  const userId = credential.subject_user_id_snapshot;
  if (typeof userId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return {
      coverageArea: "", district: "", state: "", emergencyContact: "", bloodGroup: "", memberSince: "—", photo: "",
      companyAddress: "", companyPhone: "", companyEmail: "", companyName: ""
    };
  }

  const [organizationResult, profileResult] = await Promise.all([
    supabaseRequest(
      "/rest/v1/reporter_organization_profile?select=legal_name,registered_address,official_email,official_phone,is_verified&id=eq.true&limit=1",
      { token }
    ),
    supabaseRequest(`/rest/v1/profiles?select=created_at&id=eq.${encodeURIComponent(userId)}&limit=1`, { token })
  ]);
  if (!organizationResult.response.ok || !profileResult.response.ok) {
    const failedResult = !organizationResult.response.ok ? organizationResult : profileResult;
    throw Object.assign(
      new Error(apiErrorMessage(failedResult.payload, "ID card details could not be loaded.")),
      { statusCode: failedResult.response.status }
    );
  }
  const organization = organizationResult.payload?.[0] || {};
  const memberSinceValue = credential.member_since_snapshot || profileResult.payload?.[0]?.created_at || "";
  const fields = {
    coverageArea: "", district: "", state: "", emergencyContact: "", bloodGroup: "", photo: "",
    memberSince: memberSinceValue && !Number.isNaN(Date.parse(memberSinceValue))
      ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(memberSinceValue))
      : "—",
    companyAddress: organization.is_verified ? organization.registered_address || "" : "",
    companyPhone: organization.is_verified ? organization.official_phone || "" : "",
    companyEmail: organization.is_verified ? organization.official_email || "" : "",
    companyName: organization.is_verified ? organization.legal_name || "" : ""
  };
  let photoPath = "";
  let coverageAreaId = "";
  let applicationCoverageAreaId = "";
  if (credential.role_snapshot === "reporter") {
    const application = await supabaseRequest(
      `/rest/v1/reporter_applications?select=id&user_id=eq.${encodeURIComponent(userId)}&status=in.(approved,active)&limit=1`,
      { token }
    );
    if (!application.response.ok) {
      throw Object.assign(
        new Error(apiErrorMessage(application.payload, "Reporter identity details could not be loaded for the ID card.")),
        { statusCode: application.response.status }
      );
    }
    const approvedApplication = application.payload?.[0];
    if (approvedApplication) {
      const [privateDetails, documents] = await Promise.all([
        supabaseRequest(
          `/rest/v1/reporter_application_private_details?select=emergency_contact_name,emergency_contact_relationship,emergency_contact_phone,blood_group,coverage_area_id&application_id=eq.${encodeURIComponent(approvedApplication.id)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
          { token }
        ),
        supabaseRequest(
          `/rest/v1/reporter_application_documents?select=storage_path&application_id=eq.${encodeURIComponent(approvedApplication.id)}&user_id=eq.${encodeURIComponent(userId)}&document_type=eq.profile_photo&limit=1`,
          { token }
        )
      ]);
      if (!privateDetails.response.ok || !documents.response.ok) {
        const failed = !privateDetails.response.ok ? privateDetails : documents;
        throw Object.assign(
          new Error(apiErrorMessage(failed.payload, "Reporter ID card details could not be loaded.")),
          { statusCode: failed.response.status }
        );
      }
      const details = privateDetails.payload?.[0] || {};
      fields.emergencyContact = details.emergency_contact_phone || "";
      fields.bloodGroup = details.blood_group || "";
      applicationCoverageAreaId = details.coverage_area_id || "";
      photoPath = documents.payload?.[0]?.storage_path || "";
    }
  } else {
    const onboarding = await supabaseRequest(
      `/rest/v1/staff_onboarding?select=emergency_contact_name,emergency_contact_relationship,emergency_contact_phone,profile_photo_path&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      { token }
    );
    if (!onboarding.response.ok) {
      throw Object.assign(
        new Error(apiErrorMessage(onboarding.payload, "Staff ID card details could not be loaded.")),
        { statusCode: onboarding.response.status }
      );
    }
    const details = onboarding.payload?.[0] || {};
    fields.emergencyContact = details.emergency_contact_phone || "";
    photoPath = details.profile_photo_path || "";
  }

  const assignment = await supabaseRequest(
    `/rest/v1/user_coverage_assignments?select=coverage_area_id,district_id,city_id,zone_id&user_id=eq.${encodeURIComponent(userId)}&valid_to=is.null&order=valid_from.desc&limit=1`,
    { token }
  );
  if (!assignment.response.ok) {
    throw Object.assign(
      new Error(apiErrorMessage(assignment.payload, "Assigned coverage could not be loaded for the ID card.")),
      { statusCode: assignment.response.status }
    );
  }
  const assignedLocation = assignment.payload?.[0];
  coverageAreaId = assignedLocation?.coverage_area_id
    || applicationCoverageAreaId
    || assignedLocation?.district_id
    || assignedLocation?.city_id
    || assignedLocation?.zone_id;

  let locationId = coverageAreaId;
  for (let depth = 0; locationId && depth < 8; depth += 1) {
    const location = await supabaseRequest(
      `/rest/v1/locations?select=id,name,location_type,parent_id&id=eq.${encodeURIComponent(locationId)}&limit=1`,
      { token }
    );
    if (!location.response.ok) {
      throw Object.assign(
        new Error(apiErrorMessage(location.payload, "Coverage location details could not be loaded for the ID card.")),
        { statusCode: location.response.status }
      );
    }
    const row = location.payload?.[0];
    if (!row) break;
    if (row.location_type === "coverage_area") fields.coverageArea = row.name || "";
    if (row.location_type === "district") fields.district = row.name || "";
    if (row.location_type === "state") fields.state = row.name || "";
    locationId = row.parent_id || "";
  }

  if (photoPath) {
    const imageUrl = credential.role_snapshot === "reporter"
      ? await signedReporterApplicationDocumentUrl(photoPath, token)
      : await signedStaffProfilePhotoUrl(photoPath, userId, token);
    const imageResponse = await fetch(imageUrl, {
      signal: AbortSignal.timeout(apiTimeoutMs),
      cache: "no-store"
    });
    const contentType = imageResponse.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!imageResponse.ok || !["image/jpeg", "image/png"].includes(contentType)) {
      throw new Error("The ID card photo could not be downloaded as a JPEG or PNG image.");
    }
    const image = Buffer.from(await imageResponse.arrayBuffer());
    if (image.length > 5 * 1024 * 1024) {
      throw new Error("The ID card photo is larger than the allowed 5 MB.");
    }
    fields.photo = `data:${contentType};base64,${image.toString("base64")}`;
  }

  return fields;
}

async function credentialPrintPage(credential, request, token) {
  const verificationUrl = new URL("/credential", requestOrigin(request));
  verificationUrl.searchParams.set("token", credential.verification_token);
  const qrImage = await QRCode.toDataURL(verificationUrl.toString(), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256
  });
  const scope = credential.scope || credential.scope_snapshot || {};
  const cardDetails = credential.credential_type === "id_card"
    ? await credentialCardDetails(credential, token)
    : {
      coverageArea: "", district: "", state: "", emergencyContact: "", bloodGroup: "", memberSince: "—", photo: "",
      companyAddress: "", companyPhone: "", companyEmail: "", companyName: ""
    };
  const isAuthorityLetter = credential.credential_type === "authority_letter";
  if (isAuthorityLetter) {
    const application = await supabaseRequest(
      `/rest/v1/reporter_applications?select=id&user_id=eq.${encodeURIComponent(credential.subject_user_id_snapshot)}&status=in.(approved,active)&limit=1`,
      { token }
    );
    if (!application.response.ok) {
      throw Object.assign(
        new Error(apiErrorMessage(application.payload, "Reporter assignment details could not be loaded for the authority letter.")),
        { statusCode: application.response.status }
      );
    }
    const applicationId = application.payload?.[0]?.id;
    if (applicationId) {
      const details = await supabaseRequest(
        `/rest/v1/reporter_application_private_details?select=coverage_area_id&application_id=eq.${encodeURIComponent(applicationId)}&user_id=eq.${encodeURIComponent(credential.subject_user_id_snapshot)}&limit=1`,
        { token }
      );
      if (!details.response.ok) {
        throw Object.assign(
          new Error(apiErrorMessage(details.payload, "Reporter coverage could not be loaded for the authority letter.")),
          { statusCode: details.response.status }
        );
      }
      let locationId = details.payload?.[0]?.coverage_area_id || "";
      for (let depth = 0; locationId && depth < 8; depth += 1) {
        const location = await supabaseRequest(
          `/rest/v1/locations?select=id,name,location_type,parent_id&id=eq.${encodeURIComponent(locationId)}&limit=1`,
          { token }
        );
        if (!location.response.ok) {
          throw Object.assign(
            new Error(apiErrorMessage(location.payload, "Reporter coverage hierarchy could not be loaded for the authority letter.")),
            { statusCode: location.response.status }
          );
        }
        const row = location.payload?.[0];
        if (!row) break;
        if (row.location_type === "coverage_area") cardDetails.coverageArea = row.name || "";
        if (row.location_type === "district") cardDetails.district = row.name || "";
        if (row.location_type === "state") cardDetails.state = row.name || "";
        locationId = row.parent_id || "";
      }
    }
  }
  const authorityPending = credential.status === "pending_acceptance";
  const authorityStatusLabel = authorityPending
    ? "PENDING REPORTER ACKNOWLEDGMENT — THIS AUTHORITY IS NOT YET EFFECTIVE"
    : credential.status === "active"
      ? "STATUS: ACTIVE"
      : `STATUS: ${String(credential.status || "UNKNOWN").replaceAll("_", " ").toUpperCase()}`;
  const authorityDescription = authorityPending
    ? "being issued this authority, subject to the reporter’s acknowledgment"
    : credential.status === "active"
      ? "authorized"
      : `issued this authority, but it is currently ${String(credential.status || "unknown").replaceAll("_", " ")}`;
  const validFrom = escapeHtml(credential.valid_from);
  const validUntil = escapeHtml(credential.valid_until);
  const issuer = escapeHtml(credential.issued_by_name || credential.issued_by_name_snapshot || "CHOWK NEWSROOM");
  const signatoryName = escapeHtml(credential.authorized_signer_name || credential.issued_by_name_snapshot || "Authorized signatory");
  const signatoryDesignation = escapeHtml(credential.authorized_signer_designation || "Authorized signatory");
  const issuedDate = credential.issued_at && !Number.isNaN(Date.parse(credential.issued_at))
    ? escapeHtml(new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(credential.issued_at)))
    : "—";
  const photo = cardDetails.photo
    ? `<img class="portrait" src="${cardDetails.photo}" alt="${escapeHtml(credential.name || credential.name_snapshot)}">`
    : `<div class="portrait portrait-empty" aria-label="Profile photo unavailable">CHOWK</div>`;
  const printStyles = isAuthorityLetter
    ? `@media print{body{padding:0;background:#fff}.card{width:100%;height:auto;min-height:0;margin:0;overflow:visible;border-radius:0;box-shadow:none}.actions{display:none}}`
    : `@page{size:54mm 85.6mm;margin:0}@media print{
      body{padding:0;background:#fff}
      .card{width:54mm;height:85.6mm;min-height:0;aspect-ratio:auto;margin:0;border:1mm solid #c9141d;border-radius:3mm;box-shadow:none;print-color-adjust:exact;-webkit-print-color-adjust:exact}
      .topline{height:1.5mm;flex-shrink:0;background:#c9141d}
      .card>header,.back-header{background:#c9141d;color:#fff}
      .card-front>header{position:relative;height:11.5mm;flex-shrink:0;padding:1mm 2.5mm;justify-content:flex-start;text-align:left}
      .card-front>header>div{display:flex;height:100%;flex-direction:column;justify-content:center;transform:translateY(-.75mm)}
      .card-front>header h1{font-size:8pt}
      .card-front>header p{font-size:3.5pt;margin-top:.4mm;letter-spacing:.1em}
      .card-front>header .reference{position:absolute;right:2.5mm}
      .card-brand{height:12.5mm;padding:1.5mm 2mm 0}
      .card-brand img{max-width:36mm;max-height:10mm}
      .reference{max-width:22mm;font-size:4pt;overflow-wrap:anywhere}
      .card-front>.body{height:51mm;grid-template-columns:18mm minmax(0,1fr);grid-template-areas:"photo details" "bottom bottom";grid-template-rows:auto auto;align-content:space-between;gap:1mm;padding:1.5mm 2.5mm}
      .body>.portrait{grid-area:photo;width:18mm;height:27mm;border-width:.5mm;border-radius:1mm}
      .portrait-empty{font-size:5pt}
      .details{grid-area:details}
      .staff-name{font-size:7.5pt;margin-bottom:.5mm}
      .staff-role{font-size:4.2pt;margin-bottom:1.2mm}
      dl{grid-template-columns:13mm minmax(0,1fr);gap:.8mm .5mm}
      dt{font-size:4.1pt}
      dd{font-size:4.2pt;line-height:1.2}
      .card-bottom{grid-area:bottom;display:grid;grid-template-columns:minmax(0,1fr) 15mm;align-items:start;gap:1.5mm;min-height:0;padding:1.5mm;border:1px solid #f0c4c6;border-radius:1.5mm;background:#fff}
      .card-meta{grid-template-columns:13mm minmax(0,1fr);align-content:start;align-self:start;gap:.8mm .5mm}
      .qr-wrap{justify-self:end;align-self:start}
      .qr{width:15mm;height:15mm;padding:.5mm;border-radius:1mm}
      .qr-label{font-size:3.5pt;margin-top:.5mm}
      .footer{margin:auto 2.5mm 2mm;padding-top:1mm;border-color:#f0c4c6;font-size:3.8pt;line-height:1.25}
      .back-header{height:13mm;min-height:0;padding:2mm 2.5mm}
      .back-header h1{font-size:8pt}
      .back-header p{font-size:3.8pt;margin-top:.7mm}
      .back-card{display:flex;flex-direction:column}
      .terms{height:53mm;flex:none;grid-template-columns:1fr;align-content:start;gap:1.5mm;padding:2.5mm}
      .terms p{font-size:5.2pt;line-height:1.25}
      .terms b{margin-right:.5mm}
      .back-contact{height:14mm;grid-template-columns:1fr 1fr;grid-template-rows:auto auto;gap:1mm;margin:0 2.5mm 1mm;padding-top:1mm;border-color:#f0c4c6}
      .contact-details,.signature-block,.issue-details{gap:.4mm;font-size:4pt;line-height:1.15}
      .contact-details strong,.signature-block strong{font-size:4pt}
      .signature-line{width:20mm;margin-bottom:.3mm;background:#c9141d}
      .issue-details{text-align:left}
      .issue-details strong{font-size:4pt}
      .actions{display:none}
    }`;
  const authorityContent = isAuthorityLetter
    ? `<article class="authority-letter">
        <header class="authority-header">
          <div><p class="authority-brand">CHOWK NEWSROOM</p><p class="authority-subtitle">OFFICIAL REPORTER AUTHORIZATION</p></div>
          <div class="authority-qr"><img src="${qrImage}" alt="Scan to verify authority letter"><span>SCAN TO VERIFY</span></div>
        </header>
        <section class="authority-title">
          <h1>LETTER OF AUTHORITY</h1>
          <p>Reference: <strong>${escapeHtml(credential.reference_code)}</strong></p>
        </section>
        <p class="authority-alert${credential.status === "active" ? " authority-active" : ""}">${escapeHtml(authorityStatusLabel)}</p>
        <p class="authority-date">Issued: <strong>${issuedDate}</strong></p>
        <p>To whom it may concern,</p>
        <p>CHOWK NEWSROOM confirms that <strong>${escapeHtml(credential.name || credential.name_snapshot)}</strong>${credential.reporter_code_snapshot ? ` (Reporter ID <strong>${escapeHtml(credential.reporter_code_snapshot)}</strong>)` : ""} is ${escapeHtml(authorityDescription)} to carry out reporting duties on behalf of CHOWK NEWSROOM, subject to the applicable service agreement and the limits below.</p>
        <section class="authority-scope">
          <h2>ASSIGNED COVERAGE</h2>
          <dl>
            <dt>Coverage area</dt><dd>${escapeHtml(cardDetails.coverageArea || "Not recorded")}</dd>
            <dt>District</dt><dd>${escapeHtml(cardDetails.district || "Not recorded")}</dd>
            <dt>State</dt><dd>${escapeHtml(cardDetails.state || scope.state_name || "Not recorded")}</dd>
            <dt>Designation</dt><dd>${escapeHtml(scope.reporter_type || "Reporter")}</dd>
            <dt>Service agreement</dt><dd>${escapeHtml(credential.service_agreement_version || "Not recorded")}</dd>
          </dl>
        </section>
        <p>This authority is valid from <strong>${validFrom}</strong> through <strong>${validUntil}</strong>, only while its status is active, and may be withdrawn or superseded by CHOWK NEWSROOM. It is not government accreditation, does not grant police, administrative or legal powers, and does not confer any special privilege.</p>
        <p>The holder must not seek or accept money, gifts or favours in exchange for coverage. Report any such request to the newsroom. Return this letter on request or when the engagement ends.</p>
        <p>Verify the current status by scanning the QR code. This letter is not proof of identity; confirm the holder’s identity using an independently verified newsroom contact channel.</p>
        <section class="authority-signature">
          <div><span class="authority-signature-line"></span><strong>${escapeHtml(credential.authorized_signer_name || "—")}</strong><span>${escapeHtml(credential.authorized_signer_designation || "Authorized signatory")}</span></div>
          <div class="authority-office"><strong>CHOWK NEWSROOM</strong><span>${escapeHtml(credential.return_address || "—")}</span></div>
        </section>
      </article>`
    : "";
  const backCard = isAuthorityLetter ? "" : `<article class="card back-card">
      <header class="back-header"><div><h1>Terms of this card</h1><p>${escapeHtml(cardDetails.companyName || "CHOWK NEWSROOM")}</p></div><strong class="reference">${escapeHtml(credential.reference_code)}</strong></header>
      <section class="terms">
        <p><b>1.</b> This card is issued to the person named on the front for news gathering only within the assigned area.</p>
        <p><b>2.</b> This is not government accreditation. It grants no police, administrative or legal powers, and no special privilege.</p>
        <p><b>3.</b> Chowk News does not sell coverage. Never ask for money, gifts or favours. Report such requests using the newsroom contact below.</p>
        <p><b>4.</b> The card is valid only while its status is Active. Scan the QR code on the front to check its current status.</p>
        <p><b>5.</b> Return the card on request or when the engagement ends. Misuse may lead to appropriate action.</p>
        <p><b>6.</b> If found, return it to the address or contact Chowk News using the details below.</p>
      </section>
      <section class="back-contact">
        <div class="contact-details">
          <strong>RETURN / NEWSROOM CONTACT</strong>
          <span>${escapeHtml(cardDetails.companyAddress || "Organization address not verified")}</span>
          <span>${escapeHtml(cardDetails.companyPhone || "Phone not available")}${cardDetails.companyEmail ? ` · ${escapeHtml(cardDetails.companyEmail)}` : ""}</span>
        </div>
        <div class="signature-block"><span class="signature-line"></span><strong>Authorised signatory</strong><span>${signatoryName} · ${signatoryDesignation}</span></div>
        <div class="issue-details"><strong>Card no. ${escapeHtml(credential.reference_code)}</strong><span>Issued ${issuedDate}</span></div>
      </section>
    </article>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CHOWK credential ${escapeHtml(credential.reference_code)}</title>
    <style>
      *{box-sizing:border-box}body{margin:0;padding:32px;background:#eef1f5;color:#18253d;font:14px Arial,sans-serif}
      .card{width:min(360px,100%);height:auto;min-height:0;aspect-ratio:54/85.6;margin:24px auto;overflow:hidden;border:2px solid #c9141d;border-radius:16px;background:#fff;box-shadow:0 18px 48px #14233b20}
      .topline{height:8px;background:#c9141d}
      header{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 16px;background:#12213a;color:#fff}
      .card>header,.back-header{background:#c9141d;color:#fff}
      h1{margin:0;font-size:18px;letter-spacing:.045em}header p{margin:5px 0 0;color:#d4dbe6;font-size:9px;font-weight:700;letter-spacing:.12em}
      .reference{max-width:145px;font-size:9px;font-weight:700;letter-spacing:.04em;text-align:right;overflow-wrap:anywhere}
      .card-front{display:flex;flex-direction:column}
      .card-front>header{position:relative;height:60px;flex-shrink:0;padding:8px 14px;justify-content:flex-start;text-align:left}
      .card-front>header>div{display:flex;height:100%;flex-direction:column;justify-content:center;transform:translateY(-4px)}
      .card-front>header .reference{position:absolute;right:14px}
      .card-front>header p{margin:3px 0 0;color:#fff;font-size:8px;letter-spacing:.1em}
      .card-brand{display:flex;justify-content:center;align-items:center;height:100px;padding:10px 12px 0;background:#fff}
      .card-brand img{display:block;width:260px;max-width:100%;height:auto;max-height:86px;object-fit:contain}
      .card-front>.body{display:grid;flex:1;grid-template-columns:110px minmax(0,1fr);grid-template-areas:"photo details" "bottom bottom";grid-template-rows:auto auto;align-content:start;align-items:stretch;gap:12px;padding:14px}
      .body>.portrait{grid-area:photo;display:block;width:110px;height:135px;object-fit:cover;border:3px solid #c9141d;border-radius:10px;background:#f4f5f7}
      .portrait-empty{display:grid;place-items:center;color:#8b96a8;font-size:13px;font-weight:800;letter-spacing:.08em}
      .details{grid-area:details;min-width:0}.staff-name{margin:0 0 4px;color:#17233a;font-size:18px;font-weight:800}
      .staff-role{margin:0 0 9px;color:#c9141d;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
      dl{display:grid;grid-template-columns:66px minmax(0,1fr);gap:6px 6px;margin:0}
      dt{color:#68758a;font-size:8px}dd{margin:0;overflow-wrap:anywhere;font-size:8px;line-height:1.25;font-weight:700}
      .card-bottom{grid-area:bottom;display:grid;grid-template-columns:minmax(0,1fr) 82px;align-items:start;gap:12px;min-height:160px;padding:14px;border:1px solid #f0c4c6;border-radius:10px;background:#fff}
      .card-meta{grid-template-columns:92px minmax(0,1fr);align-content:start;align-self:start;gap:8px}
      .qr-wrap{justify-self:end;align-self:start;text-align:center}.qr{width:82px;height:82px;padding:5px;border:1px solid #e1e6ed;border-radius:8px}
      .qr-label{margin:5px 0 0;color:#68758a;font-size:8px;font-weight:700;letter-spacing:.08em}
      .footer{margin:auto 14px 14px;padding-top:9px;border-top:1px solid #f0c4c6;color:#68758a;font-size:8px;line-height:1.4}
      .back-header{min-height:68px}.back-header h1{font-size:16px}.back-header p{margin-top:4px}
      .back-card{display:flex;flex-direction:column}
      .terms{display:grid;grid-template-columns:1fr;gap:9px;padding:16px 18px 10px}
      .back-card .terms{flex:1;align-content:space-evenly}
      .terms p{margin:0;color:#354258;font-size:10px;line-height:1.35}.terms b{color:#c9141d;margin-right:3px}
      .back-contact{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:end;margin:0 18px 14px;padding-top:10px;border-top:1px solid #f0c4c6}
      .contact-details,.signature-block,.issue-details{display:grid;gap:4px;min-width:0;color:#526078;font-size:9px;line-height:1.3}
      .contact-details{grid-column:1/-1}
      .contact-details strong,.signature-block strong{color:#18253d;font-size:8px;letter-spacing:.04em}
      .contact-details span,.signature-block span,.issue-details span{overflow-wrap:anywhere}
      .signature-line{width:125px;height:1px;margin-bottom:3px;background:#c9141d}
      .issue-details{text-align:right;white-space:normal}.issue-details strong{color:#18253d;font-size:9px}
      .authority-letter{width:min(820px,100%);min-height:920px;margin:24px auto;padding:52px 60px;background:#fff;border:1px solid #dfe4ec;border-top:8px solid #ef6b2e;box-shadow:0 18px 48px #14233b20;font-size:14px;line-height:1.7}
      .authority-header{display:flex;justify-content:space-between;align-items:center;padding:0 0 18px;border-bottom:2px solid #e8ebf0;background:#fff;color:#18253d}
      .authority-brand{margin:0;color:#12213a;font-size:22px;font-weight:800;letter-spacing:.04em}
      .authority-subtitle{margin:3px 0 0;color:#68758a;font-size:10px;font-weight:700;letter-spacing:.14em}
      .authority-qr{display:grid;justify-items:center;gap:4px}.authority-qr img{width:88px;height:88px;padding:4px;border:1px solid #e1e6ed;border-radius:6px}.authority-qr span{font-size:8px;font-weight:700;letter-spacing:.08em;color:#68758a}
      .authority-title{display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin-top:28px}
      .authority-title h1{color:#12213a;font-size:20px;letter-spacing:.06em}.authority-title p,.authority-date{color:#526078;font-size:11px}
      .authority-alert{margin:18px 0;padding:10px 12px;border-left:4px solid #df5f28;background:#fff3ec;color:#9a3914;font-size:11px;font-weight:800;letter-spacing:.04em}
      .authority-active{border-color:#238253;background:#eef8f1;color:#17633f}
      .authority-scope{margin:20px 0;padding:16px 18px;border:1px solid #dfe4ec;border-radius:8px;background:#f8f9fb}
      .authority-scope h2{margin:0 0 10px;color:#df5f28;font-size:11px;letter-spacing:.1em}
      .authority-scope dl{grid-template-columns:145px 1fr;gap:8px 14px}.authority-scope dt{font-size:12px}.authority-scope dd{font-size:12px}
      .authority-signature{display:grid;grid-template-columns:1fr 1fr;gap:36px;margin-top:44px}
      .authority-signature>div{display:grid;align-content:start;gap:3px;color:#526078;font-size:11px}
      .authority-signature strong{color:#18253d}.authority-signature-line{width:220px;max-width:100%;height:1px;margin:0 0 7px;background:#526078}
      .authority-office{padding-top:8px}
      .actions{display:flex;justify-content:center;margin:18px auto}.actions button{padding:12px 18px;border:0;border-radius:8px;background:#ed6b2e;color:#fff;font-weight:700;cursor:pointer}
      @media screen and (max-width:640px){body{padding:10px}.card{width:min(360px,calc(100vw - 20px));margin:10px auto}.card-front>.body{grid-template-columns:88px minmax(0,1fr);gap:10px;padding:12px}.body>.portrait{width:88px;height:108px}.card-bottom{min-height:145px;gap:8px;padding:10px}.card-meta{grid-template-columns:82px minmax(0,1fr);gap:8px 5px}.staff-name{font-size:16px}header{padding:13px 14px}.reference{max-width:125px}}
      ${isAuthorityLetter ? `@media screen and (max-width:640px){.authority-letter{min-height:0;margin:10px auto;padding:24px 20px}.authority-title{display:block}.authority-title p{margin-bottom:0}.authority-scope dl{grid-template-columns:110px 1fr}.authority-signature{grid-template-columns:1fr;gap:24px}}
      @page{size:A4;margin:16mm}@media print{body{padding:0;background:#fff}.authority-letter{width:100%;min-height:0;margin:0;padding:0;border:0;border-top:5px solid #ef6b2e;box-shadow:none;font-size:10pt;line-height:1.55;print-color-adjust:exact;-webkit-print-color-adjust:exact}.authority-header{padding-bottom:10px}.authority-brand{font-size:18pt}.authority-subtitle{font-size:8pt}.authority-qr img{width:22mm;height:22mm}.authority-title{margin-top:18px}.authority-title h1{font-size:15pt}.authority-title p,.authority-date{font-size:8pt}.authority-alert{margin:12px 0;padding:7px 9px;font-size:8pt}.authority-scope{margin:14px 0;padding:10px 12px}.authority-scope h2{font-size:8pt}.authority-scope dl{grid-template-columns:36mm 1fr;gap:5px 10px}.authority-scope dt,.authority-scope dd{font-size:9pt}.authority-signature{margin-top:34px}.authority-signature>div{font-size:8pt}.actions{display:none}}`
        : printStyles}
      ${isAuthorityLetter ? "" : `@media print{.card-front{break-after:page;page-break-after:always}.back-card{break-after:auto;page-break-after:auto}.back-header{height:13mm;min-height:0;padding:2mm 2.5mm}.back-header h1{font-size:8pt}.back-header p{font-size:3.8pt}.terms{height:53mm;grid-template-columns:1fr;gap:1.5mm;padding:2.5mm}.terms p{font-size:5.2pt;line-height:1.25}.terms b{margin-right:.5mm}.back-contact{height:14mm;grid-template-columns:1fr 1fr;grid-template-rows:auto auto;gap:1mm;margin:0 2.5mm 1mm;padding-top:1mm}.contact-details,.signature-block,.issue-details{gap:.4mm;font-size:4pt;line-height:1.15}.contact-details strong,.signature-block strong{font-size:4pt}.signature-line{width:20mm;margin-bottom:.3mm}.issue-details{text-align:left}.issue-details strong{font-size:4pt}}`}
    </style></head><body>${isAuthorityLetter ? authorityContent : `<article class="card card-front">
      <div class="topline"></div>
      <header><div><h1>PRESS</h1><p>OFFICIAL STAFF ID CARD</p></div><strong class="reference">${escapeHtml(credential.reference_code)}</strong></header>
      <div class="card-brand"><img src="${credentialCardLogo}" alt="CHOWK News logo"></div>
      <section class="body">${photo}<div class="details">
        <h2 class="staff-name">${escapeHtml(credential.name || credential.name_snapshot)}</h2>
        <p class="staff-role">${escapeHtml(String(credential.role || credential.role_snapshot).replaceAll("_", " "))}${scope.designation ? ` · ${escapeHtml(scope.designation)}` : ""}</p>
        <dl>
          <dt>Reporter ID</dt><dd>${escapeHtml(credential.reporter_code || credential.reporter_code_snapshot || "—")}</dd>
          <dt>Coverage area</dt><dd>${escapeHtml(cardDetails.coverageArea || "—")}</dd>
          <dt>District</dt><dd>${escapeHtml(cardDetails.district || "—")}</dd>
          <dt>State</dt><dd>${escapeHtml(cardDetails.state || scope.state_name || "—")}</dd>
        </dl></div><div class="card-bottom"><dl class="card-meta">
          <dt>Emergency contact</dt><dd>${escapeHtml(cardDetails.emergencyContact || "—")}</dd>
          <dt>Blood group</dt><dd>${escapeHtml(cardDetails.bloodGroup || "Not provided")}</dd>
          <dt>Member since</dt><dd>${escapeHtml(cardDetails.memberSince || "—")}</dd>
          <dt>Valid</dt><dd>${validFrom} – ${validUntil}</dd>
          <dt>Status</dt><dd>${escapeHtml(String(credential.status).replaceAll("_", " "))}</dd>
        </dl><div class="qr-wrap"><img class="qr" src="${qrImage}" alt="Credential verification QR code"><p class="qr-label">SCAN TO VERIFY</p></div></div></section>
      <p class="footer">Credential status: ${escapeHtml(String(credential.status).replaceAll("_", " "))} · Issued by ${issuer}. Scan the QR code to verify current status; this ID card does not by itself establish the holder’s identity.</p>
    </article>${backCard}`}<div class="actions"><button type="button" onclick="window.print()">Print / Save ${isAuthorityLetter ? "Authority Letter" : "Both Sides"}</button></div></body></html>`;
}

async function renderVerifiedCredentialPrintPage(credential, request, token) {
  const verification = await supabaseRequest("/rest/v1/rpc/chowk_verify_staff_credential", {
    method: "POST",
    body: { verification_code: credential.verification_token }
  });
  if (!verification.response.ok) {
    throw Object.assign(
      new Error(apiErrorMessage(verification.payload, "Credential status could not be verified for printing.")),
      { statusCode: verification.response.status }
    );
  }
  if (!verification.payload) {
    throw Object.assign(new Error("Credential verification record was not found."), { statusCode: 404 });
  }
  return credentialPrintPage({
    ...credential,
    status: verification.payload.status,
    scope: verification.payload.scope || credential.scope || credential.scope_snapshot
  }, request, token);
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ""
  ).trim();
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the local environment.");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("SUPABASE_URL must use HTTPS outside localhost.");
  }
  return { url, key };
}

async function supabaseRequest(endpoint, options = {}) {
  const { url, key } = supabaseConfig();
  const auditContext = requestContext.getStore();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${options.token || key}`,
    Accept: "application/json",
    ...(auditContext ? {
      "X-Chowk-Request-Id": auditContext.requestId,
      "X-Chowk-Client-IP": auditContext.ipAddress,
      "X-Chowk-User-Agent": auditContext.userAgent
    } : {}),
    ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(options.prefer ? { Prefer: options.prefer } : {})
  };
  const result = await fetch(`${url}${endpoint}`, {
    method: options.method || "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(apiTimeoutMs),
    cache: "no-store"
  });
  const text = await result.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Supabase returned an invalid response (HTTP ${result.status}).`);
    }
  }
  return { response: result, payload };
}

async function deleteSupabaseAuthUser(userId) {
  const { url } = supabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw Object.assign(
      new Error("User deletion is not configured. Set SUPABASE_SERVICE_ROLE_KEY in the server environment."),
      { statusCode: 503 }
    );
  }
  const result = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(apiTimeoutMs),
    cache: "no-store"
  });
  const text = await result.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw Object.assign(
        new Error(`Supabase Auth returned an invalid response (HTTP ${result.status}).`),
        { statusCode: result.status }
      );
    }
  }

  if (!result.ok) {
    throw Object.assign(
      new Error(apiErrorMessage(payload, "The Supabase login account could not be deleted.")),
      { statusCode: result.status }
    );
  }
}

async function inviteSupabaseUser(email, requestedRole, redirectTo, accountKind = "staff") {
    const { url } = supabaseConfig();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!serviceRoleKey) {
      throw Object.assign(
        new Error("Account invitations require SUPABASE_SERVICE_ROLE_KEY in the server environment."),
        { statusCode: 503 }
      );
    }
    const endpoint = new URL("/auth/v1/invite", url);
    endpoint.searchParams.set("redirect_to", redirectTo);
    const result = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        email,
        data: accountKind === "employee"
          ? { account_type: "employee_invitation", requested_employee_role: requestedRole }
          : { account_type: "staff_invitation", requested_staff_role: requestedRole }
      }),
      signal: AbortSignal.timeout(apiTimeoutMs),
      cache: "no-store"
    });
    const text = await result.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw Object.assign(
          new Error(`Supabase Auth returned an invalid response (HTTP ${result.status}).`),
          { statusCode: result.status }
        );
      }
    }
    if (!result.ok || typeof (payload?.user?.id || payload?.id) !== "string") {
      throw Object.assign(
        new Error(apiErrorMessage(payload, "The staff invitation could not be sent.")),
        { statusCode: result.status || 502 }
      );
    }
    return payload.user || payload;
  }

async function uploadStaffProfilePhoto(body, userId, token) {
    if (typeof body.mime_type !== "string"
        || !["image/jpeg", "image/png"].includes(body.mime_type)
        || typeof body.file_base64 !== "string"
        || body.file_base64.length > Math.ceil(5 * 1024 * 1024 / 3) * 4 + 4
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.file_base64)) {
      throw Object.assign(new Error("Choose a JPG or PNG profile photo no larger than 5 MB."), { statusCode: 400 });
    }
    const file = Buffer.from(body.file_base64, "base64");
    const isJpeg = file.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const isPng = file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!file.length || file.length > 5 * 1024 * 1024
        || (body.mime_type === "image/jpeg" && !isJpeg)
        || (body.mime_type === "image/png" && !isPng)) {
      throw Object.assign(new Error("The profile photo contents do not match its file type."), { statusCode: 400 });
    }
    const extension = body.mime_type === "image/jpeg" ? "jpg" : "png";
    const objectPath = `staff/${userId}/profile/${randomUUID()}.${extension}`;
    const { url, key } = supabaseConfig();
    const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
    const result = await fetch(`${url}/storage/v1/object/chowk-staff-profiles/${encodedPath}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `****** || key}`,
        "Content-Type": body.mime_type,
        "x-upsert": "false"
      },
      body: file,
      signal: AbortSignal.timeout(apiTimeoutMs),
      cache: "no-store"
    });
    const payload = await result.json().catch(() => ({}));
    if (!result.ok) {
      throw Object.assign(
        new Error(apiErrorMessage(payload, "The staff profile photo could not be uploaded.")),
        { statusCode: result.status }
      );
    }
    return objectPath;
  }

async function signedStaffProfilePhotoUrl(objectPath, userId, token) {
    if (typeof objectPath !== "string"
        || !objectPath.startsWith(`staff/${userId}/profile/`)
        || !/^staff\/[0-9a-f-]{36}\/profile\/[0-9a-f-]{36}\.(jpg|png)$/.test(objectPath)) {
      throw new Error("The staff profile photo reference is invalid.");
    }
    const { url, key } = supabaseConfig();
    const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
    const result = await fetch(`${url}/storage/v1/object/sign/chowk-staff-profiles/${encodedPath}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `****** || key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ expiresIn: 300 }),
      signal: AbortSignal.timeout(apiTimeoutMs),
      cache: "no-store"
    });
    const payload = await result.json().catch(() => ({}));
    if (!result.ok || typeof payload.signedURL !== "string") {
      throw new Error(apiErrorMessage(payload, "The staff profile photo could not be authorized for preview."));
    }
    return /^https?:\/\//i.test(payload.signedURL)
      ? payload.signedURL
      : `${url}/storage/v1${payload.signedURL.startsWith("/") ? "" : "/"}${payload.signedURL}`;
  }
async function signedMediaUrl(value, token) {
  if (typeof value !== "string"
      || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|png|webp|avif|mp4|webm|mp3|m4a|ogg|wav)$/.test(value)) {
    return value;
  }
  const { url, key } = supabaseConfig();
  const encodedPath = value.split("/").map(encodeURIComponent).join("/");
  const result = await fetch(`${url}/storage/v1/object/sign/chowk-newsroom/${encodedPath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ expiresIn: 3600 }),
    signal: AbortSignal.timeout(apiTimeoutMs),
    cache: "no-store"
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok || typeof payload.signedURL !== "string") {
    throw new Error(apiErrorMessage(payload, "A newsroom media file could not be authorized."));
  }
  if (/^https?:\/\//i.test(payload.signedURL)) return payload.signedURL;
  return `${url}/storage/v1${payload.signedURL.startsWith("/") ? "" : "/"}${payload.signedURL}`;
}

async function signArticleMedia(article, token, publicResponse = false) {
  const fields = ["image_url", "video_url", "audio_url"];
  const values = await Promise.all(fields.map((field) => signedMediaUrl(article[field], token)));
  fields.forEach((field, index) => {
    article[`${field}_display_url`] = values[index];
    if (publicResponse) article[field] = values[index];
  });
  return article;
}

async function signArticlesMedia(articles, token, publicResponse = false) {
  return Promise.all(articles.map((article) => signArticleMedia(article, token, publicResponse)));
}

function apiErrorMessage(payload, fallback) {
  return payload?.msg || payload?.message || payload?.error_description ||
    payload?.error || fallback;
}

function validateReporterDesignationRecord(record, isCreate) {
  if (isCreate || record.name !== undefined) {
    if (typeof record.name !== "string" || record.name.trim().length < 2 || record.name.trim().length > 80) {
      return "Reporter designation must contain between 2 and 80 characters.";
    }
    record.name = record.name.trim();
  }
  if (isCreate || record.designation_code !== undefined) {
    if (typeof record.designation_code !== "string" || !/^\d{2}$/.test(record.designation_code.trim())) {
      return "Reporter designation code must contain exactly 2 digits.";
    }
    record.designation_code = record.designation_code.trim();
  }
  if (record.description !== undefined) {
    if (typeof record.description !== "string" || record.description.trim().length > 300) {
      return "Designation description must be 300 characters or fewer.";
    }
    record.description = record.description.trim();
  }
  if (record.is_active !== undefined && typeof record.is_active !== "boolean") {
    return "Choose whether this reporter designation is active.";
  }
  return null;
}

function getCookie(request, name) {
  const cookieHeader = request.headers.cookie || "";
  const cookie = cookieHeader.split(";").map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));
  if (!cookie) return "";
  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return "";
  }
}

function setSessionCookies(response, name, token, refreshToken) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    [
      `${name}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionMaxAge}${secure}`,
      `${name}_refresh=${encodeURIComponent(refreshToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}`
    ]
  );
}

function clearSessionCookies(response, name) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    [
      `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
      `${name}_refresh=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`
    ]
  );
}

async function getIdentity(token) {
  const { response, payload } = await supabaseRequest("/auth/v1/user", { token });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error(apiErrorMessage(payload, `Supabase Auth returned HTTP ${response.status}.`));
  if (typeof payload?.id !== "string") return null;

  const query = new URLSearchParams({
    select: "id,full_name,phone,role,created_at",
    id: `eq.${payload.id}`,
    limit: "1"
  });
  const profile = await supabaseRequest(`/rest/v1/profiles?${query}`, { token });
  if (!profile.response.ok || !Array.isArray(profile.payload) || !profile.payload[0]) {
    throw new Error(apiErrorMessage(profile.payload, "The Supabase profile is missing. Apply the Chowk schema migration."));
  }
  return {
    ...profile.payload[0],
    email: payload.email,
    name: profile.payload[0].full_name || payload.user_metadata?.full_name || payload.email
  };
}

async function getSession(request, response, cookieName) {
  const token = getCookie(request, cookieName);
  if (token) {
    const identity = await getIdentity(token);
    if (identity) return { identity, token };
  }
  const refreshToken = getCookie(request, `${cookieName}_refresh`);
  if (!refreshToken) return null;
  const refreshed = await supabaseRequest("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: refreshToken }
  });
  if (!refreshed.response.ok || !refreshed.payload?.access_token || !refreshed.payload?.refresh_token) {
    clearSessionCookies(response, cookieName);
    return null;
  }
  const identity = await getIdentity(refreshed.payload.access_token);
  if (!identity) {
    clearSessionCookies(response, cookieName);
    return null;
  }
  setSessionCookies(response, cookieName, refreshed.payload.access_token, refreshed.payload.refresh_token);
  return { identity, token: refreshed.payload.access_token };
}

async function hasHrConsoleAccess(token) {
  const result = await supabaseRequest("/rest/v1/rpc/chowk_user_has_permission", {
    method: "POST",
    token,
    body: { target_permission: "hr.console.access" }
  });
  return result.response.ok && result.payload === true;
}

async function hasOrganizationAdminAccess(token) {
  const permissions = [
    "hr.console.access",
    "newsroom.articles.read",
    "newsroom.articles.create",
    "newsroom.articles.edit",
    "newsroom.articles.review",
    "newsroom.articles.publish",
    "newsroom.categories.manage",
    "newsroom.comments.moderate",
    "newsroom.reports.manage",
    "newsroom.media.manage",
    "newsroom.locations.manage",
    "newsroom.people.manage",
    "reporters.manage",
    "people.directory.read",
    "organization.workflows.approve"
  ];
  const result = await supabaseRequest("/rest/v1/rpc/chowk_org_my_permissions", {
    method: "POST", token, body: {}
  });
  return result.response.ok
    && Array.isArray(result.payload)
    && result.payload.some((permission) => permissions.includes(permission));
}

async function userHasOrganizationPermission(token, permission) {
  const result = await supabaseRequest("/rest/v1/rpc/chowk_org_user_has_permission", {
    method: "POST",
    token,
    body: { target_permission: permission }
  });
  return result.response.ok && result.payload === true;
}

async function organizationModuleEnabled(token, moduleKey) {
  const result = await supabaseRequest("/rest/v1/rpc/chowk_org_module_is_enabled", {
    method: "POST",
    token,
    body: { target_module: moduleKey }
  });
  if (!result.response.ok) {
    throw new Error(apiErrorMessage(result.payload, "Organization module configuration could not be verified."));
  }
  return result.payload === true;
}

async function userHasOrganizationCapability(token, permission) {
  const result = await supabaseRequest("/rest/v1/rpc/chowk_org_user_has_capability", {
    method: "POST",
    token,
    body: { target_permission: permission }
  });
  if (!result.response.ok) {
    throw new Error(apiErrorMessage(result.payload, "Organization permissions could not be verified."));
  }
  return result.payload === true;
}

async function requireAdmin(request, response) {
  try {
    const session = await getSession(request, response, adminCookie);
    if (!session) {
      clearSessionCookies(response, adminCookie);
      sendJson(response, 401, { error: "Admin access required." });
      return null;
    }
    if (!["admin", "super_admin"].includes(session.identity.role)
        && !await hasOrganizationAdminAccess(session.token)) {
      clearSessionCookies(response, adminCookie);
      sendJson(response, 401, { error: "An organization permission is required for admin access." });
      return null;
    }
    return session;
  } catch (error) {
    console.error("Could not verify admin session:", error.message);
    sendJson(response, 503, { error: "Admin service is temporarily unavailable." });
    return null;
  }
}

async function requireUser(request, response) {
  try {
    const session = await getSession(request, response, userCookie);
    if (!session) {
      clearSessionCookies(response, userCookie);
      sendJson(response, 401, { error: "Sign in to access your reporter account." });
      return null;
    }
    return session;
  } catch (error) {
    console.error("Could not verify account session:", error.message);
    sendJson(response, 503, { error: "Account service is temporarily unavailable." });
    return null;
  }
}

async function handleLogout(request, response, cookieName) {
  if (!isSameOrigin(request)) {
    sendJson(response, 403, { error: "Cross-origin request rejected." });
    return;
  }
  try {
    const session = await getSession(request, response, cookieName);
    if (session) {
      const result = await supabaseRequest("/auth/v1/logout", {
        method: "POST",
        token: session.token
      });
      if (!result.response.ok && result.response.status !== 401) {
        sendJson(response, result.response.status, {
          error: apiErrorMessage(result.payload, "Supabase could not revoke the session.")
        });
        return;
      }
    }
    clearSessionCookies(response, cookieName);
    sendJson(response, 200, { success: true });
  } catch (error) {
    console.error("Supabase logout failed:", error.message);
    sendJson(response, 503, { error: "Could not securely sign out. Please try again." });
  }
}

function readRawBody(request, maxBytes = maxRequestBodyBytes) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(request.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
      request.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    request.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

async function readJsonBody(request, maxBytes = maxRequestBodyBytes) {
  try {
    const text = (await readRawBody(request, maxBytes)).toString("utf8");
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Request body must be a JSON object.");
    }
    return body;
  } catch (error) {
    if (error.statusCode) throw error;
    throw Object.assign(new Error(error.message === "Request body must be a JSON object."
      ? error.message
      : "Request body must be valid JSON."), { statusCode: 400 });
  }
}

async function uploadReporterAgreementPdf(fileBase64, kind, token) {
  if (!["application", "service"].includes(kind)) {
    throw Object.assign(new Error("Choose a valid reporter agreement type."), { statusCode: 400 });
  }
  if (typeof fileBase64 !== "string"
      || fileBase64.length > Math.ceil(8 * 1024 * 1024 / 3) * 4 + 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(fileBase64)) {
    throw Object.assign(new Error("Choose a PDF file no larger than 8 MB."), { statusCode: 400 });
  }
  const file = Buffer.from(fileBase64, "base64");
  const pdfEnd = file.lastIndexOf(Buffer.from("%%EOF"));
  if (file.length < 10 || file.length > 8 * 1024 * 1024
      || file.subarray(0, 5).toString("ascii") !== "%PDF-"
      || pdfEnd < Math.max(5, file.length - 2048)) {
    throw Object.assign(new Error("The uploaded file is not a valid PDF document."), { statusCode: 400 });
  }

  const objectPath = `${kind}/${randomUUID()}.pdf`;
  const { url, key } = supabaseConfig();
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const result = await fetch(`${url}/storage/v1/object/chowk-reporter-agreements/${encodedPath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/pdf",
      "x-upsert": "false"
    },
    body: file,
    signal: AbortSignal.timeout(apiTimeoutMs),
    cache: "no-store"
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) {
    throw Object.assign(
      new Error(apiErrorMessage(payload, "The agreement PDF could not be uploaded to Supabase Storage.")),
      { statusCode: result.status }
    );
  }
  return {
    object_path: objectPath,
    document_url: `/api/reporter/agreement-documents/${kind}/${objectPath.split("/")[1]}`,
    sha256: createHash("sha256").update(file).digest("hex")
  };
}

async function uploadReporterAgreementAcceptancePdf(pdf, userId, token) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)
      || !Buffer.isBuffer(pdf)
      || pdf.length < 10
      || pdf.length > 8 * 1024 * 1024
      || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw Object.assign(new Error("The generated agreement PDF is invalid or too large."), { statusCode: 500 });
  }
  const objectPath = `acceptance/${userId}/${randomUUID()}.pdf`;
  const { url, key } = supabaseConfig();
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${url}/storage/v1/object/chowk-reporter-agreements/${encodedPath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/pdf",
      "x-upsert": "false"
    },
    body: pdf,
    signal: AbortSignal.timeout(apiTimeoutMs),
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(apiErrorMessage(payload, "The generated reporter agreement could not be saved.")),
      { statusCode: response.status }
    );
  }
  return {
    object_path: objectPath,
    sha256: createHash("sha256").update(pdf).digest("hex")
  };
}

async function uploadReporterApplicationDocument(body, userId, token) {
  const documentTypes = new Set(["profile_photo", "aadhaar_front", "aadhaar_back", "pan_card", "bank_proof"]);
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !documentTypes.has(body.document_type)) {
    throw Object.assign(new Error("Choose a valid reporter application document type."), { statusCode: 400 });
  }
  const allowedMimeTypes = body.document_type === "profile_photo"
    ? new Set(["image/jpeg", "image/png"])
    : new Set(["image/jpeg", "image/png", "application/pdf"]);
  if (typeof body.mime_type !== "string" || !allowedMimeTypes.has(body.mime_type)
      || typeof body.file_base64 !== "string"
      || body.file_base64.length > Math.ceil(5 * 1024 * 1024 / 3) * 4 + 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.file_base64)) {
    throw Object.assign(new Error("Choose a supported JPG, PNG or PDF file no larger than 5 MB."), { statusCode: 400 });
  }
  const file = Buffer.from(body.file_base64, "base64");
  if (!file.length || file.length > 5 * 1024 * 1024) {
    throw Object.assign(new Error("The document must be no larger than 5 MB."), { statusCode: 400 });
  }
  const isJpeg = file.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const isPng = file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isPdf = file.subarray(0, 5).toString("ascii") === "%PDF-";
  if ((body.mime_type === "image/jpeg" && !isJpeg)
      || (body.mime_type === "image/png" && !isPng)
      || (body.mime_type === "application/pdf" && !isPdf)
      || (body.document_type === "profile_photo" && !isJpeg && !isPng)) {
    throw Object.assign(new Error("The file contents do not match the selected document type."), { statusCode: 400 });
  }
  const extension = body.mime_type === "image/jpeg" ? "jpg"
    : body.mime_type === "image/png" ? "png" : "pdf";
  const objectPath = `applications/${userId}/${body.document_type}/${randomUUID()}.${extension}`;
  const { url, key } = supabaseConfig();
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const result = await fetch(`${url}/storage/v1/object/chowk-reporter-applications/${encodedPath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || key}`,
      "Content-Type": body.mime_type,
      "x-upsert": "false"
    },
    body: file,
    signal: AbortSignal.timeout(apiTimeoutMs),
    cache: "no-store"
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) {
    throw Object.assign(
      new Error(apiErrorMessage(payload, "The reporter application document could not be uploaded.")),
      { statusCode: result.status }
    );
  }
  return {
    document_type: body.document_type,
    storage_path: objectPath,
    mime_type: body.mime_type,
    sha256: createHash("sha256").update(file).digest("hex")
  };
}

async function reporterAgreementContext(session, requested = {}) {
  let stateId = requested.stateId;
  let rtoId = requested.rtoId;
  if (!stateId || !rtoId) {
    const status = await supabaseRequest("/rest/v1/rpc/chowk_reporter_status", {
      method: "POST",
      token: session.token
    });
    if (!status.response.ok) {
      throw Object.assign(
        new Error(apiErrorMessage(status.payload, "Reporter application details could not be loaded.")),
        { statusCode: status.response.status }
      );
    }
    const application = status.payload?.application;
    stateId ||= application?.state?.id;
    rtoId ||= application?.rto?.id;
  }
  const ids = [stateId, rtoId].map(Number);
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw Object.assign(new Error("Select a State and District before previewing the agreement."), {
      statusCode: 400
    });
  }
  const [agreement, organization, profile, state, rto, reporterProfile] = await Promise.all([
    supabaseRequest("/rest/v1/reporter_agreement_versions?select=version,sha256,template_content&status=eq.published&limit=1", { token: session.token }),
    supabaseRequest("/rest/v1/reporter_organization_profile?select=legal_name,trade_name,entity_type,registered_address,registration_number,official_email,official_phone,website_url,is_verified&id=eq.true&limit=1", { token: session.token }),
    supabaseRequest(`/rest/v1/profiles?select=full_name,phone&id=eq.${encodeURIComponent(session.identity.id)}&limit=1`, { token: session.token }),
    supabaseRequest(`/rest/v1/states?select=id,state_name,state_code&id=eq.${ids[0]}&is_active=eq.true&limit=1`, { token: session.token }),
    supabaseRequest(`/rest/v1/rto_offices?select=id,state_id,rto_code,city_name&id=eq.${ids[1]}&state_id=eq.${ids[0]}&is_active=eq.true&limit=1`, { token: session.token }),
    supabaseRequest(`/rest/v1/reporter_profiles?select=reporter_code&user_id=eq.${encodeURIComponent(session.identity.id)}&limit=1`, { token: session.token })
  ]);
  for (const result of [agreement, organization, profile, state, rto, reporterProfile]) {
    if (!result.response.ok) {
      throw Object.assign(
        new Error(apiErrorMessage(result.payload, "Reporter agreement details could not be loaded.")),
        { statusCode: result.response.status }
      );
    }
  }
  const currentAgreement = agreement.payload?.[0];
  if (!currentAgreement?.template_content) {
    throw Object.assign(new Error("No dynamic reporter agreement is published yet."), { statusCode: 404 });
  }
  const company = organization.payload?.[0];
  if (!company?.is_verified) {
    throw Object.assign(new Error("The organization legal profile has not been verified by an admin yet."), { statusCode: 409 });
  }
  if (!profile.payload?.[0] || !state.payload?.[0] || !rto.payload?.[0]) {
    throw Object.assign(new Error("The account or selected reporting details are incomplete or inactive."), { statusCode: 400 });
  }
  const reporter = profile.payload[0];
  const selectedState = state.payload[0];
  const selectedRto = rto.payload[0];
  const tokens = {
    "agreement.date": new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Kolkata"
    }).format(new Date()),
    "company.entity_type": company.entity_type,
    "company.legal_name": company.legal_name,
    "company.official_email": company.official_email,
    "company.official_phone": company.official_phone,
    "company.registered_address": company.registered_address,
    "company.registration_number": company.registration_number || "Not provided",
    "company.trade_name": company.trade_name,
    "company.website_url": company.website_url || "Not provided",
    "reporter.city": selectedRto.city_name || selectedState.state_name,
    "reporter.email": session.identity.email || "Not provided",
    "reporter.full_name": reporter.full_name || session.identity.name || "Name not provided",
    "reporter.phone": reporter.phone || "Not provided",
    "reporter.reporter_code": reporterProfile.payload?.[0]?.reporter_code || "Assigned after application approval",
    "reporter.rto": selectedRto.rto_code,
    "reporter.state": selectedState.state_name,
    "reporter.designation": "",
    "reporter.type": ""
  };
  return { agreement: currentAgreement, tokens };
}

async function reporterAgreementCoverageArea(session, coverageAreaId, districtId) {
  const ids = [coverageAreaId, districtId].map(Number);
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw Object.assign(
      new Error("The approved application is missing its assigned Coverage Area or District. Review the reporter's application before preparing the agreement."),
      { statusCode: 409 }
    );
  }
  const [coverageAreaResult, districtResult] = await Promise.all([
    supabaseRequest(
      `/rest/v1/locations?select=id,name,location_type,parent_id&id=eq.${ids[0]}&limit=1`,
      { token: session.token }
    ),
    supabaseRequest(
      `/rest/v1/locations?select=id,name,location_type&id=eq.${ids[1]}&limit=1`,
      { token: session.token }
    )
  ]);
  for (const result of [coverageAreaResult, districtResult]) {
    if (!result.response.ok) {
      throw Object.assign(
        new Error(apiErrorMessage(result.payload, "The reporter's assigned Coverage Area and District could not be loaded.")),
        { statusCode: result.response.status }
      );
    }
  }
  const coverageArea = coverageAreaResult.payload?.[0];
  const district = districtResult.payload?.[0];
  if (coverageArea?.location_type !== "coverage_area"
      || district?.location_type !== "district"
      || Number(coverageArea.parent_id) !== Number(district.id)) {
    throw Object.assign(
      new Error("The approved application's Coverage Area does not belong to its assigned District. Review the reporter's application before preparing the agreement."),
      { statusCode: 409 }
    );
  }
  return { coverageArea: coverageArea.name, district: district.name };
}

async function signedReporterAgreementPdfUrl(objectPath, token, download = false) {
  if (typeof objectPath !== "string"
      || !/^(?:(?:application|service)\/[0-9a-f-]{36}\.pdf|acceptance\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf)$/.test(objectPath)) {
    throw new Error("The agreement PDF reference is invalid.");
  }
  const { url, key } = supabaseConfig();
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const result = await fetch(`${url}/storage/v1/object/sign/chowk-reporter-agreements/${encodedPath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      expiresIn: 600,
      ...(download ? { download: "reporter-engagement-agreement.pdf" } : {})
    }),
    signal: AbortSignal.timeout(apiTimeoutMs),
    cache: "no-store"
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok || typeof payload.signedURL !== "string") {
    throw new Error(apiErrorMessage(payload, "The agreement PDF could not be authorized for preview."));
  }
  if (/^https?:\/\//i.test(payload.signedURL)) return payload.signedURL;
  return `${url}/storage/v1${payload.signedURL.startsWith("/") ? "" : "/"}${payload.signedURL}`;
}

async function signedReporterApplicationDocumentUrl(objectPath, token) {
  if (typeof objectPath !== "string"
      || !/^applications\/[0-9a-f-]{36}\/(profile_photo|masked_aadhaar|aadhaar_front|aadhaar_back|pan_card|bank_proof)\/[0-9a-f-]{36}\.(jpg|png|pdf)$/.test(objectPath)) {
    throw new Error("The reporter application document reference is invalid.");
  }
  const { url, key } = supabaseConfig();
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const result = await fetch(`${url}/storage/v1/object/sign/chowk-reporter-applications/${encodedPath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ expiresIn: 300 }),
    signal: AbortSignal.timeout(apiTimeoutMs),
    cache: "no-store"
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok || typeof payload.signedURL !== "string") {
    throw new Error(apiErrorMessage(payload, "The reporter application document could not be authorized."));
  }
  if (/^https?:\/\//i.test(payload.signedURL)) return payload.signedURL;
  return `${url}/storage/v1${payload.signedURL.startsWith("/") ? "" : "/"}${payload.signedURL}`;
}

async function removeReporterApplicationDocument(objectPath, userId, token, { allowMissing = false } = {}) {
  if (typeof objectPath !== "string"
      || !objectPath.startsWith(`applications/${userId}/`)
      || !/^applications\/[0-9a-f-]{36}\/(profile_photo|masked_aadhaar|aadhaar_front|aadhaar_back|pan_card|bank_proof)\/[0-9a-f-]{36}\.(jpg|png|pdf)$/.test(objectPath)) {
    throw Object.assign(new Error("The reporter application document reference is invalid."), { statusCode: 400 });
  }
  const { url, key } = supabaseConfig();
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const result = await fetch(`${url}/storage/v1/object/chowk-reporter-applications/${encodedPath}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${token || key}` },
    signal: AbortSignal.timeout(apiTimeoutMs),
    cache: "no-store"
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok && !(allowMissing && result.status === 404)) {
    throw Object.assign(
      new Error(apiErrorMessage(payload, "The unsubmitted reporter document could not be removed.")),
      { statusCode: result.status }
    );
  }
}

async function removeReporterAgreementPdf(objectPath, token) {
  if (typeof objectPath !== "string"
      || !/^(?:(?:application|service)\/[0-9a-f-]{36}\.pdf|acceptance\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf)$/.test(objectPath)) {
    return;
  }
  const { url, key } = supabaseConfig();
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const result = await fetch(`${url}/storage/v1/object/chowk-reporter-agreements/${encodedPath}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(apiTimeoutMs),
    cache: "no-store"
  });
  if (!result.ok && result.status !== 404) {
    const payload = await result.json().catch(() => ({}));
    throw new Error(apiErrorMessage(payload, "The uploaded agreement PDF could not be removed."));
  }
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const forwardedHost = request.headers["x-forwarded-host"]?.split(",")[0].trim();
    const forwardedProtocol = request.headers["x-forwarded-proto"]?.split(",")[0].trim();
    const requestHost = forwardedHost || request.headers.host || host;
    const requestProtocol = forwardedProtocol || (request.socket.encrypted ? "https" : "http");
    return origin === new URL(`${requestProtocol}://${requestHost}`).origin;
  } catch {
    return false;
  }
}

function matchesMediaSignature(mimeType, bytes) {
  const startsWith = (...values) => values.every((value, index) => bytes[index] === value);
  if (mimeType === "image/jpeg") return startsWith(0xff, 0xd8, 0xff);
  if (mimeType === "image/png") return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (mimeType === "image/webp") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (mimeType === "image/avif") return bytes.toString("ascii", 4, 8) === "ftyp" && /^(avif|avis)$/.test(bytes.toString("ascii", 8, 12));
  if (mimeType === "video/webm") return startsWith(0x1a, 0x45, 0xdf, 0xa3);
  if (mimeType === "video/mp4" || mimeType === "audio/mp4") return bytes.toString("ascii", 4, 8) === "ftyp";
  if (mimeType === "audio/ogg") return bytes.toString("ascii", 0, 4) === "OggS";
  if (mimeType === "audio/wav") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
  if (mimeType === "audio/mpeg") {
    return bytes.toString("ascii", 0, 3) === "ID3"
      || (bytes.length > 1 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  }
  return false;
}

async function handleAuth(request, response, registration) {
  if (!isSameOrigin(request)) {
    sendJson(response, 403, { error: "Cross-origin request rejected." });
    return;
  }
  try {
    const body = await readJsonBody(request);
    if (typeof body.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
      sendJson(response, 400, { error: "Enter a valid email address." });
      return;
    }
    if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 72) {
      sendJson(response, 400, { error: "Password must be between 8 and 72 characters." });
      return;
    }
    if (registration && (typeof body.name !== "string" || body.name.trim().length < 2)) {
      sendJson(response, 400, { error: "Enter your full name." });
      return;
    }
    if (registration && (typeof body.phone !== "string" || !/^\+?[1-9][0-9]{6,14}$/.test(body.phone.trim()))) {
      sendJson(response, 400, { error: "Enter a valid phone number." });
      return;
    }
    if (registration) {
      if (body.accepted_policies !== true) {
        sendJson(response, 400, { error: "Accept the site policies before creating an account." });
        return;
      }
    }

    const endpoint = registration
      ? "/auth/v1/signup"
      : "/auth/v1/token?grant_type=password";
    const { response: upstream, payload } = await supabaseRequest(endpoint, {
      method: "POST",
      body: registration
        ? {
            email: body.email.trim(),
            password: body.password,
            data: {
              account_type: "subscriber",
              accepted_policies: body.accepted_policies === true,
              full_name: body.name.trim(),
              phone: body.phone.trim()
            }
          }
        : { email: body.email.trim(), password: body.password }
    });
    if (!upstream.ok) {
      sendJson(response, upstream.status, {
        error: apiErrorMessage(payload, "Supabase could not complete the account request.")
      });
      return;
    }

    const token = payload?.access_token;
    if (typeof token !== "string" || !token) {
      sendJson(response, 200, {
        success: true,
        confirmation_required: true,
        message: "Check your email to confirm your account, then sign in."
      });
      return;
    }
    const identity = await getIdentity(token);
    if (!identity) {
      sendJson(response, 502, { error: "Supabase did not return a valid account profile." });
      return;
    }
    const allowedForAdmin = ["admin", "super_admin"].includes(identity.role)
      || (request.url.startsWith("/api/admin/session") && await hasOrganizationAdminAccess(token));
    if (request.url.startsWith("/api/admin/session") && !allowedForAdmin) {
      sendJson(response, 403, { error: "This account does not have an organization permission for admin access." });
      return;
    }
    const cookieName = registration ? userCookie : (
      request.url.startsWith("/api/admin/session") ? adminCookie : userCookie
    );
    setSessionCookies(response, cookieName, token, payload.refresh_token);
    if (!registration && allowedForAdmin && cookieName === userCookie) {
      const cookieHeader = response.getHeader("Set-Cookie");
      response.setHeader("Set-Cookie", [
        ...(Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader]),
        `${adminCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionMaxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        `${adminCookie}_refresh=${encodeURIComponent(payload.refresh_token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
      ]);
    }
    sendJson(response, 200, { success: true, identity });
  } catch (error) {
    if (error.statusCode) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }
    console.error("Supabase authentication request failed:", error.message);
    sendJson(response, 503, { error: "Supabase authentication is unavailable. Check local configuration." });
  }
}

async function publicArticles(response, requestUrl) {
  try {
    if (!await organizationModuleEnabled(null, "newsroom")) {
      sendJson(response, 404, { error: "The newsroom module is currently disabled." });
      return;
    }
    const query = new URLSearchParams({
      select: "id,title,slug,excerpt,content,category_id,category:categories(name,slug),image_url,video_url,audio_url,published_at,created_at",
      status: "eq.published",
      published_at: `lte.${new Date().toISOString()}`,
      order: "published_at.desc",
      limit: String(Math.max(1, Math.min(50, Math.trunc(Number(requestUrl.searchParams.get("limit")) || 20)))),
      offset: String((Math.max(1, Math.trunc(Number(requestUrl.searchParams.get("page")) || 1)) - 1) * Math.max(1, Math.min(50, Math.trunc(Number(requestUrl.searchParams.get("limit")) || 20))))
    });
    const category = requestUrl.searchParams.get("category")?.trim();
    if (category) {
      const categoryQuery = new URLSearchParams({ select: "id", slug: `eq.${category}`, is_active: "eq.true", limit: "1" });
      const categoryResult = await supabaseRequest(`/rest/v1/categories?${categoryQuery}`);
      if (!categoryResult.response.ok) {
        sendJson(response, categoryResult.response.status, { error: apiErrorMessage(categoryResult.payload, "Categories could not be loaded.") });
        return;
      }
      const categoryId = categoryResult.payload?.[0]?.id;
      if (!categoryId) {
        sendJson(response, 200, { success: true, data: [] });
        return;
      }
      query.set("category_id", `eq.${categoryId}`);
    }
    const search = requestUrl.searchParams.get("search")?.trim()
      .replace(/[(),.*%_]/g, " ").replace(/\s+/g, " ").slice(0, 100);
    if (search) query.set("or", `(title.ilike.*${search}*,excerpt.ilike.*${search}*)`);

    const result = await supabaseRequest(`/rest/v1/articles?${query}`);
    if (!result.response.ok) {
      sendJson(response, result.response.status, { error: apiErrorMessage(result.payload, "News could not be loaded.") });
      return;
    }
    const data = Array.isArray(result.payload) ? await signArticlesMedia(result.payload, null, true) : [];
    data.forEach((article) => {
      article.description = article.excerpt;
      article.category_name = article.category?.name || null;
    });
    sendJson(response, 200, { success: true, data });
  } catch (error) {
    console.error("Supabase news request failed:", error.message);
    sendJson(response, 503, { error: "News service is unavailable. Check Supabase configuration and schema." });
  }
}

async function publicMedia(response, requestUrl) {
  try {
    if (!await organizationModuleEnabled(null, "media")) {
      sendJson(response, 404, { error: "The media module is currently disabled." });
      return;
    }
  } catch (error) {
    console.error("Could not verify public media module availability:", error.message);
    sendJson(response, 503, { error: "Media configuration is temporarily unavailable." });
    return;
  }
  const mediaType = requestUrl.searchParams.get("type");
  if (!["podcast", "charcha", "patrika"].includes(mediaType)) {
    sendJson(response, 400, { error: "Choose a valid media type." });
    return;
  }

  try {
    const query = new URLSearchParams({
      select: "id,media_type,title,description,media_url,cover_url,episode_label,duration_seconds,issue_date,published_at,created_at",
      media_type: `eq.${mediaType}`,
      status: "eq.published",
      or: `(published_at.is.null,published_at.lte.${new Date().toISOString()})`,
      order: "published_at.desc.nullslast,created_at.desc",
      limit: "50"
    });
    const result = await supabaseRequest(`/rest/v1/media_catalog?${query}`);
    if (!result.response.ok) {
      sendJson(response, result.response.status, { error: apiErrorMessage(result.payload, "Media could not be loaded.") });
      return;
    }
    sendJson(response, 200, { success: true, data: Array.isArray(result.payload) ? result.payload : [] });
  } catch (error) {
    console.error("Supabase public media request failed:", error.message);
    sendJson(response, 503, { error: "Media service is unavailable. Check Supabase configuration and schema." });
  }
}

async function organizationWorkflowsRoute(request, response, requestUrl, session) {
  const { token } = session;
  const pathname = requestUrl.pathname;
  try {
    if (request.method !== "GET" && !isSameOrigin(request)) {
      sendJson(response, 403, { error: "Cross-origin request rejected." });
      return;
    }
    if (pathname === "/api/organization/workflows" && request.method === "GET") {
      const [workflows, permissions] = await Promise.all([
        supabaseRequest("/rest/v1/rpc/chowk_org_available_workflows", {
          method: "POST", token, body: {}
        }),
        supabaseRequest("/rest/v1/rpc/chowk_org_my_permissions", {
          method: "POST", token, body: {}
        })
      ]);
      const failed = [workflows, permissions].find((result) => !result.response.ok);
      if (failed) {
        sendJson(response, failed.response.status, {
          error: apiErrorMessage(failed.payload, "Organization workflows could not be loaded.")
        });
        return;
      }
      const approvals = (permissions.payload || []).includes("organization.workflows.approve")
        ? await supabaseRequest("/rest/v1/rpc/chowk_org_workflow_approval_inbox", {
            method: "POST", token, body: {}
          })
        : null;
      if (approvals && !approvals.response.ok) {
        sendJson(response, approvals.response.status, {
          error: apiErrorMessage(approvals.payload, "Workflow approvals could not be loaded.")
        });
        return;
      }
      sendJson(response, 200, { success: true, data: {
        workflows: workflows.payload || [],
        approvals: approvals?.payload || []
      } });
      return;
    }

    const instancesRoute = pathname.match(
      /^\/api\/organization\/workflows\/([0-9a-f-]{36})\/instances$/i
    );
    if (instancesRoute && request.method === "GET") {
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_workflow_instances", {
        method: "POST", token, body: { target_workflow: instancesRoute[1] }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload || [] }
        : { error: apiErrorMessage(result.payload, "Workflow instances could not be loaded.") });
      return;
    }

    const startRoute = pathname.match(
      /^\/api\/organization\/workflows\/([0-9a-f-]{36})\/start$/i
    );
    if (startRoute && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_start_workflow", {
        method: "POST", token,
        body: {
          target_workflow: startRoute[1],
          target_subject_type: body.subject_type,
          target_subject_id: body.subject_id
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Workflow could not be started.") });
      return;
    }

    const transitionRoute = pathname.match(
      /^\/api\/organization\/workflow-instances\/([0-9a-f-]{36})\/transitions$/i
    );
    if (transitionRoute && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_transition_workflow", {
        method: "POST", token,
        body: {
          target_instance: transitionRoute[1],
          target_transition: body.transition_id,
          expected_revision: body.expected_revision,
          transition_reason: body.reason || ""
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Workflow transition could not be completed.") });
      return;
    }

    const approvalRoute = pathname.match(
      /^\/api\/organization\/workflow-approvals\/([0-9a-f-]{36})\/decision$/i
    );
    if (approvalRoute && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_decide_workflow_approval", {
        method: "POST", token,
        body: {
          target_approval: approvalRoute[1],
          expected_revision: body.expected_revision,
          approve: body.approve === true,
          decision_reason: body.reason || ""
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Workflow decision could not be saved.") });
      return;
    }

    sendJson(response, 404, { error: "Organization workflow route not found." });
  } catch (error) {
    console.error("Organization workflow request failed:", error.message);
    sendJson(response, 503, { error: "Organization workflow service is temporarily unavailable." });
  }
}

function organizationModuleForAdminPath(pathname) {
  if (pathname.startsWith("/api/admin/hr/")) return "human-resources";
  if (pathname.startsWith("/api/admin/role-agreements")
      || pathname.startsWith("/api/admin/agreement-records")
      || pathname.startsWith("/api/admin/reporter-agreement")) return "agreements";
  if (pathname.startsWith("/api/admin/articles")
      || pathname.startsWith("/api/admin/categories")
      || pathname.startsWith("/api/admin/daily-submission-report")) return "newsroom";
  if (pathname.startsWith("/api/admin/media")
      || pathname.startsWith("/api/admin/live-streams")) return "media";
  if (pathname.startsWith("/api/admin/comments")
      || pathname.startsWith("/api/admin/reports")) return "moderation";
  if (pathname.startsWith("/api/admin/reporter")
      || pathname.startsWith("/api/admin/staff")
      || pathname.startsWith("/api/admin/credential")
      || pathname.startsWith("/api/admin/coverage")
      || pathname.startsWith("/api/admin/states")
      || pathname.startsWith("/api/admin/rto-offices")) return "reporters";
  if (pathname.startsWith("/api/admin/locations")
      || pathname.startsWith("/api/admin/district-range")
      || pathname.startsWith("/api/admin/district-zone")) return "locations";
  return null;
}

function organizationPermissionForAdminPath(pathname, method) {
  if (pathname.startsWith("/api/admin/organization/")) return null;
  if (pathname.startsWith("/api/admin/users")) return "organization.accounts.manage";
  if (pathname.startsWith("/api/admin/dashboard")
      || pathname.startsWith("/api/admin/audit")) return "organization.audit.read";
  if (pathname.startsWith("/api/admin/daily-submission-report")) return "newsroom.articles.read";
  if (pathname.startsWith("/api/admin/hr/")) return "hr.console.access";
  if (pathname.startsWith("/api/admin/articles")) {
    if (pathname.endsWith("/publish")) return "newsroom.articles.publish";
    if (pathname.endsWith("/transition")) return "newsroom.articles.review";
    if (method === "GET") return "newsroom.articles.read";
    if (method === "POST") return "newsroom.articles.create";
    if (method === "DELETE") return "newsroom.articles.delete";
    return "newsroom.articles.edit";
  }
  if (pathname.startsWith("/api/admin/categories")) return "newsroom.categories.manage";
  if (pathname.startsWith("/api/admin/comments")) return "newsroom.comments.moderate";
  if (pathname.startsWith("/api/admin/reports")) return "newsroom.reports.manage";
  if (pathname.startsWith("/api/admin/media")
      || pathname.startsWith("/api/admin/live-streams")) return "newsroom.media.manage";
  if (pathname.startsWith("/api/admin/locations")
      || pathname.startsWith("/api/admin/district-range")
      || pathname.startsWith("/api/admin/district-zone")) return "newsroom.locations.manage";
  if (pathname.startsWith("/api/admin/reporter-directory") && method === "GET") {
    return "people.directory.read";
  }
  if (pathname.startsWith("/api/admin/reporter")
      || pathname.startsWith("/api/admin/staff")
      || pathname.startsWith("/api/admin/credential")
      || pathname.startsWith("/api/admin/coverage")
      || pathname.startsWith("/api/admin/states")
      || pathname.startsWith("/api/admin/rto-offices")
      || pathname.startsWith("/api/admin/role-agreements")
      || pathname.startsWith("/api/admin/agreement-records")) return "reporters.manage";
  return null;
}

async function adminRoute(request, response, requestUrl, session) {
  const { token, identity } = session;
  const pathname = requestUrl.pathname;
  try {
    if (request.method !== "GET" && !isSameOrigin(request)) {
      sendJson(response, 403, { error: "Cross-origin request rejected." });
      return;
    }
    if (pathname.startsWith("/api/admin/organization/") && identity.role !== "super_admin") {
      sendJson(response, 403, { error: "Only a super admin can configure organization-wide settings." });
      return;
    }
    const moduleForAdminRoute = organizationModuleForAdminPath(pathname);
    if (moduleForAdminRoute
        && !await organizationModuleEnabled(token, moduleForAdminRoute)) {
      sendJson(response, 403, { error: "This organization module is disabled." });
      return;
    }
    const routePermission = organizationPermissionForAdminPath(pathname, request.method);
    const routePermissions = pathname.endsWith("/transition")
      ? ["newsroom.articles.create", "newsroom.articles.edit",
        "newsroom.articles.review", "newsroom.articles.publish",
        "newsroom.articles.reopen"]
      : routePermission ? [routePermission] : [];
    if (!["admin", "super_admin"].includes(identity.role)
        && routePermissions.length === 0
        && !pathname.startsWith("/api/admin/profile")
        && !pathname.startsWith("/api/admin/password")) {
      sendJson(response, 403, { error: "No organization permission is configured for this admin route." });
      return;
    }
    if (routePermissions.length && !["admin", "super_admin"].includes(identity.role)
        && !(await Promise.all(routePermissions.map((permission) =>
          userHasOrganizationCapability(token, permission)))).some(Boolean)) {
      sendJson(response, 403, { error: "Your organization access role does not grant this action." });
      return;
    }

    if (pathname === "/api/admin/organization/configuration" && request.method === "GET") {
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_configuration_snapshot", {
        method: "POST", token, body: {}
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Organization configuration could not be loaded.") });
      return;
    }

    if (pathname === "/api/admin/organization/identity" && request.method === "PUT") {
      const body = await readJsonBody(request);
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_save_identity", {
        method: "POST",
        token,
        body: {
          target_name: body.display_name,
          target_legal_name: body.legal_name || "",
          target_website_url: body.website_url || "",
          target_contact_email: body.contact_email || "",
          target_contact_phone: body.contact_phone || "",
          target_country_code: body.country_code,
          target_locale: body.locale,
          target_timezone: body.timezone,
          target_currency_code: body.currency_code
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Organization identity could not be saved.") });
      return;
    }

    const organizationPersonRoute = pathname.match(
      /^\/api\/admin\/organization\/people\/([0-9a-f-]{36})\/access$/i
    );
    if (organizationPersonRoute && request.method === "PUT") {
      const body = await readJsonBody(request);
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_set_person_access", {
        method: "POST",
        token,
        body: {
          target_relationship: organizationPersonRoute[1],
          target_access_role: body.access_role_id || null,
          target_department: body.department_id || null
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Organization member access could not be updated.") });
      return;
    }

    if (pathname === "/api/admin/organization/settings" && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_save_setting", {
        method: "POST",
        token,
        body: {
          target_key: body.setting_key,
          target_value: body.value,
          target_description: body.description || "",
          expected_revision: Number.isInteger(body.revision) ? body.revision : null
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Organization setting could not be saved.") });
      return;
    }

    const organizationSettingRoute = pathname.match(
      /^\/api\/admin\/organization\/settings\/([0-9a-f-]{36})$/i
    );
    if (organizationSettingRoute && request.method === "DELETE") {
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_archive_setting", {
        method: "POST", token, body: { target_id: organizationSettingRoute[1] }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Organization setting could not be archived.") });
      return;
    }

    const organizationModuleRoute = pathname.match(
      /^\/api\/admin\/organization\/modules\/([a-z][a-z0-9_-]{1,79})$/i
    );
    if (organizationModuleRoute && request.method === "PUT") {
      const body = await readJsonBody(request);
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_set_module", {
        method: "POST",
        token,
        body: {
          target_module: organizationModuleRoute[1],
          target_enabled: body.is_enabled,
          target_configuration: body.configuration || {},
          expected_revision: Number.isInteger(body.revision) ? body.revision : null
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Organization module configuration could not be saved.") });
      return;
    }

    if (pathname === "/api/admin/organization/workflows" && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_save_workflow", {
        method: "POST", token,
        body: {
          target_id: body.id || null,
          target_module: body.module_key,
          target_key: body.workflow_key,
          target_name: body.name,
          target_description: body.description || "",
          target_active: body.is_active !== false
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Organization workflow could not be saved.") });
      return;
    }

    const workflowStateRoute = pathname.match(
      /^\/api\/admin\/organization\/workflows\/([0-9a-f-]{36})\/states$/i
    );
    if (workflowStateRoute && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_save_workflow_state", {
        method: "POST", token,
        body: {
          target_workflow: workflowStateRoute[1],
          target_id: body.id || null,
          target_key: body.state_key,
          target_label: body.label,
          target_initial: body.is_initial === true,
          target_terminal: body.is_terminal === true,
          target_sort_order: Number.isInteger(body.sort_order) ? body.sort_order : 0
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Workflow state could not be saved.") });
      return;
    }

    const workflowStateDeleteRoute = pathname.match(
      /^\/api\/admin\/organization\/workflows\/([0-9a-f-]{36})\/states\/([0-9a-f-]{36})$/i
    );
    if (workflowStateDeleteRoute && request.method === "DELETE") {
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_delete_workflow_state", {
        method: "POST", token,
        body: {
          target_workflow: workflowStateDeleteRoute[1],
          target_id: workflowStateDeleteRoute[2]
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Workflow state could not be deleted.") });
      return;
    }

    const workflowTransitionRoute = pathname.match(
      /^\/api\/admin\/organization\/workflows\/([0-9a-f-]{36})\/transitions$/i
    );
    if (workflowTransitionRoute && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_save_workflow_transition", {
        method: "POST", token,
        body: {
          target_workflow: workflowTransitionRoute[1],
          target_id: body.id || null,
          target_from: body.from_state_id,
          target_to: body.to_state_id,
          target_key: body.transition_key,
          target_label: body.label,
          target_permission: body.required_permission,
          target_requires_reason: body.requires_reason === true,
          target_requires_approval: body.requires_approval === true,
          target_sort_order: Number.isInteger(body.sort_order) ? body.sort_order : 0,
          target_active: body.is_active !== false
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Workflow transition could not be saved.") });
      return;
    }

    const workflowTransitionDeleteRoute = pathname.match(
      /^\/api\/admin\/organization\/workflow-transitions\/([0-9a-f-]{36})$/i
    );
    if (workflowTransitionDeleteRoute && request.method === "DELETE") {
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_delete_workflow_transition", {
        method: "POST", token, body: { target_id: workflowTransitionDeleteRoute[1] }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Workflow transition could not be deleted.") });
      return;
    }

    const organizationWorkflowRoute = pathname.match(
      /^\/api\/admin\/organization\/workflows\/([0-9a-f-]{36})$/i
    );
    if (organizationWorkflowRoute && request.method === "DELETE") {
      const result = await supabaseRequest("/rest/v1/rpc/chowk_org_delete_workflow", {
        method: "POST", token, body: { target_id: organizationWorkflowRoute[1] }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Organization workflow could not be deleted.") });
      return;
    }

    if (pathname.startsWith("/api/admin/hr/") && identity.role !== "super_admin"
        && !await hasHrConsoleAccess(token)) {
      sendJson(response, 403, { error: "HR workspace access is required." });
      return;
    }
    if (pathname.startsWith("/api/admin/hr/")) {
      if (pathname === "/api/admin/hr/configuration" && request.method === "GET") {
        const [snapshot, models] = await Promise.all([
          supabaseRequest("/rest/v1/rpc/chowk_hr_configuration_snapshot", {
            method: "POST", token, body: {}
          }),
          supabaseRequest("/rest/v1/rpc/chowk_org_model_snapshot", {
            method: "POST", token, body: {}
          })
        ]);
        const failed = [snapshot, models].find((result) => !result.response.ok);
        sendJson(response, failed?.response.status || 200, failed
          ? { error: apiErrorMessage(failed.payload, "HR configuration could not be loaded.") }
          : { success: true, data: { ...snapshot.payload, ...models.payload } });
        return;
      }

      if (pathname === "/api/admin/hr/models" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await supabaseRequest("/rest/v1/rpc/chowk_org_save_model", {
          method: "POST",
          token,
          body: {
            target_id: body.id || null,
            target_key: body.model_key,
            target_name: body.name,
            target_description: body.description || "",
            target_initial_status: body.initial_status || "draft",
            target_workflow_enabled: body.workflow_enabled === true,
            target_is_active: body.is_active !== false
          }
        });
        sendJson(response, result.response.status, result.response.ok
          ? { success: true, data: result.payload }
          : { error: apiErrorMessage(result.payload, "The organization model could not be saved.") });
        return;
      }

      const modelFieldRoute = pathname.match(
        /^\/api\/admin\/hr\/models\/([0-9a-f-]{36})\/fields$/i
      );
      if (modelFieldRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await supabaseRequest("/rest/v1/rpc/chowk_org_save_model_field", {
          method: "POST",
          token,
          body: {
            target_model: modelFieldRoute[1],
            target_id: body.id || null,
            target_key: body.field_key,
            target_label: body.label,
            target_type: body.field_type,
            target_required: body.is_required === true,
            target_active: body.is_active !== false,
            target_sort_order: Number.isInteger(body.sort_order) ? body.sort_order : 0,
            target_options: Array.isArray(body.options) ? body.options : []
          }
        });
        sendJson(response, result.response.status, result.response.ok
          ? { success: true, data: result.payload }
          : { error: apiErrorMessage(result.payload, "The model field could not be saved.") });
        return;
      }

      const modelPermissionsRoute = pathname.match(
        /^\/api\/admin\/hr\/models\/([0-9a-f-]{36})\/roles\/([0-9a-f-]{36})$/i
      );
      if (modelPermissionsRoute && request.method === "PUT") {
        const body = await readJsonBody(request);
        const result = await supabaseRequest("/rest/v1/rpc/chowk_org_set_model_permissions", {
          method: "POST",
          token,
          body: {
            target_model: modelPermissionsRoute[1],
            target_role: modelPermissionsRoute[2],
            target_permissions: Array.isArray(body.permissions) ? body.permissions : null
          }
        });
        sendJson(response, result.response.status, result.response.ok
          ? { success: true }
          : { error: apiErrorMessage(result.payload, "Model permissions could not be saved.") });
        return;
      }

      const modelTransitionRoute = pathname.match(
        /^\/api\/admin\/hr\/models\/([0-9a-f-]{36})\/transitions$/i
      );
      if (modelTransitionRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await supabaseRequest("/rest/v1/rpc/chowk_org_save_model_transition", {
          method: "POST",
          token,
          body: {
            target_model: modelTransitionRoute[1],
            target_id: body.id || null,
            target_from: body.from_status,
            target_to: body.to_status,
            target_label: body.label,
            target_action: body.required_action,
            target_sort_order: Number.isInteger(body.sort_order) ? body.sort_order : 0
          }
        });
        sendJson(response, result.response.status, result.response.ok
          ? { success: true, data: result.payload }
          : { error: apiErrorMessage(result.payload, "The workflow transition could not be saved.") });
        return;
      }

      const modelTransitionDeleteRoute = pathname.match(
        /^\/api\/admin\/hr\/model-transitions\/([0-9a-f-]{36})$/i
      );
      if (modelTransitionDeleteRoute && request.method === "DELETE") {
        const result = await supabaseRequest("/rest/v1/rpc/chowk_org_delete_model_transition", {
          method: "POST", token, body: { target_id: modelTransitionDeleteRoute[1] }
        });
        sendJson(response, result.response.status, result.response.ok
          ? { success: true }
          : { error: apiErrorMessage(result.payload, "The workflow transition could not be deleted.") });
        return;
      }

      const modelDeleteRoute = pathname.match(/^\/api\/admin\/hr\/models\/([0-9a-f-]{36})$/i);
      if (modelDeleteRoute && request.method === "DELETE") {
        const result = await supabaseRequest("/rest/v1/rpc/chowk_org_delete_unused_model", {
          method: "POST", token, body: { target_id: modelDeleteRoute[1] }
        });
        sendJson(response, result.response.status, result.response.ok
          ? { success: true }
          : { error: apiErrorMessage(result.payload, "The unused model could not be deleted.") });
        return;
      }

      const saveRoutes = {
        departments: {
          functionName: "chowk_hr_save_department",
          body: (value) => ({
            target_id: value.id || null,
            target_key: value.department_key,
            target_name: value.name,
            target_description: value.description || "",
            target_parent_id: value.parent_id || null,
            target_is_active: value.is_active !== false
          })
        },
        positions: {
          functionName: "chowk_hr_save_position",
          body: (value) => ({
            target_id: value.id || null,
            target_key: value.position_key,
            target_title: value.title,
            target_description: value.description || "",
            target_department_id: value.department_id || null,
            target_is_active: value.is_active !== false
          })
        },
        "access-roles": {
          functionName: "chowk_hr_save_access_role",
          body: (value) => ({
            target_id: value.id || null,
            target_key: value.role_key,
            target_name: value.name,
            target_description: value.description || "",
            target_is_active: value.is_active !== false
          })
        },
        policies: {
          functionName: "chowk_hr_save_policy",
          body: (value) => ({
            target_id: value.id || null,
            target_key: value.policy_key,
            target_title: value.title,
            target_description: value.description || "",
            target_department_id: value.department_id || null,
            target_access_role_id: value.access_role_id || null,
            target_requires_acceptance: value.requires_acceptance !== false,
            target_is_active: value.is_active !== false
          })
        }
      };
      const collection = pathname.match(/^\/api\/admin\/hr\/(departments|positions|access-roles|policies)$/);
      if (collection && request.method === "POST") {
        const config = saveRoutes[collection[1]];
        const body = await readJsonBody(request);
        const result = await supabaseRequest(`/rest/v1/rpc/${config.functionName}`, {
          method: "POST",
          token,
          body: config.body(body)
        });
        sendJson(response, result.response.status, result.response.ok
          ? { success: true, data: result.payload }
          : { error: apiErrorMessage(result.payload, `The HR ${collection[1]} record could not be saved.`) });
        return;
      }

      const permissionsRoute = pathname.match(/^\/api\/admin\/hr\/access-roles\/([0-9a-f-]{36})\/permissions$/i);
      if (permissionsRoute && request.method === "PUT") {
        const body = await readJsonBody(request);
        const result = await supabaseRequest("/rest/v1/rpc/chowk_hr_set_role_permissions", {
          method: "POST",
          token,
          body: {
            target_role_id: permissionsRoute[1],
            target_permissions: Array.isArray(body.permissions) ? body.permissions : null
          }
        });
        sendJson(response, result.response.status, result.response.ok
          ? { success: true }
          : { error: apiErrorMessage(result.payload, "Role permissions could not be saved.") });
        return;
      }

      if (pathname === "/api/admin/hr/assignments" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await supabaseRequest("/rest/v1/rpc/chowk_hr_save_employee_assignment", {
          method: "POST",
          token,
          body: {
            target_id: body.id || null,
            target_employee_id: body.employee_id,
            target_department_id: body.department_id || null,
            target_position_id: body.position_id || null,
            target_access_role_id: body.access_role_id,
            target_manager_employee_id: body.manager_employee_id || null,
            target_status: body.status,
            target_is_primary: body.is_primary !== false,
            target_starts_at: body.starts_at || null,
            target_end_reason: body.end_reason || "",
            target_employment_type: body.employment_type || null
          }
        });
        sendJson(response, result.response.status, result.response.ok
          ? { success: true, data: result.payload }
          : { error: apiErrorMessage(result.payload, "The employee assignment could not be saved.") });
        return;
      }

      if (pathname === "/api/admin/hr/invitations" && request.method === "POST") {
        const body = await readJsonBody(request);
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const accessRoleId = typeof body.access_role_id === "string" && /^[0-9a-f-]{36}$/i.test(body.access_role_id)
          ? body.access_role_id
          : "";
        const employmentType = ["full_time", "part_time", "fixed_term", "temporary", "intern", "other"]
          .includes(body.employment_type) ? body.employment_type : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !accessRoleId || !employmentType) {
          sendJson(response, 400, { error: "Enter a valid email address, employment type, and access role." });
          return;
        }
        let invitedUser;
        try {
          invitedUser = await inviteSupabaseUser(
            email,
            "hr_employee",
            new URL("/employee-policies", requestOrigin(request)).toString(),
            "employee"
          );
        } catch (error) {
          sendJson(response, error.statusCode || 502, { error: error.message });
          return;
        }
        const result = await supabaseRequest("/rest/v1/rpc/chowk_hr_save_employee_assignment", {
          method: "POST",
          token,
          body: {
            target_id: null,
            target_employee_id: invitedUser.id,
            target_department_id: body.department_id || null,
            target_position_id: body.position_id || null,
            target_access_role_id: accessRoleId,
            target_manager_employee_id: body.manager_employee_id || null,
            target_status: "pending",
            target_is_primary: true,
            target_starts_at: null,
            target_end_reason: "",
            target_employment_type: employmentType
          }
        });
        if (!result.response.ok) {
          try {
            await deleteSupabaseAuthUser(invitedUser.id);
          } catch (cleanupError) {
            console.error("Could not clean up an incomplete HR invitation:", cleanupError.message);
            sendJson(response, 502, {
              error: `The invitation was sent but its HR assignment failed and the new account could not be removed. Contact support with account ${email}.`
            });
            return;
          }
          sendJson(response, result.response.status, {
            error: apiErrorMessage(result.payload, "The HR invitation could not be initialized. The incomplete account was removed.")
          });
          return;
        }
        sendJson(response, 201, { success: true, data: { employee_id: invitedUser.id, email } });
        return;
      }

      const draftRoute = pathname.match(/^\/api\/admin\/hr\/policies\/([0-9a-f-]{36})\/versions$/i);
      if (draftRoute && request.method === "POST") {
        const body = await readJsonBody(request);
        const content = typeof body.content === "string" ? body.content : "";
        const result = await supabaseRequest("/rest/v1/rpc/chowk_hr_save_policy_draft", {
          method: "POST",
          token,
          body: {
            target_policy_id: draftRoute[1],
            target_id: body.id || null,
            target_version: body.version,
            target_content: content,
            target_sha256: createHash("sha256").update(content, "utf8").digest("hex")
          }
        });
        sendJson(response, result.response.status, result.response.ok
          ? { success: true, data: result.payload }
          : { error: apiErrorMessage(result.payload, "The policy draft could not be saved.") });
        return;
      }

      const publishPolicyRoute = pathname.match(/^\/api\/admin\/hr\/policy-versions\/([0-9a-f-]{36})\/publish$/i);
      if (publishPolicyRoute && request.method === "POST") {
        const result = await supabaseRequest("/rest/v1/rpc/chowk_hr_publish_policy_version", {
          method: "POST",
          token,
          body: { target_id: publishPolicyRoute[1] }
        });
        sendJson(response, result.response.status, result.response.ok
          ? { success: true }
          : { error: apiErrorMessage(result.payload, "The policy version could not be published.") });
        return;
      }

      const deleteRoute = pathname.match(/^\/api\/admin\/hr\/(departments|positions|access-roles|policies|policy-versions)\/([0-9a-f-]{36})$/i);
      if (deleteRoute && request.method === "DELETE") {
        const tableName = {
          departments: "department",
          positions: "position",
          "access-roles": "access_role",
          policies: "policy",
          "policy-versions": "policy_version"
        }[deleteRoute[1]];
        const result = await supabaseRequest("/rest/v1/rpc/chowk_hr_delete_unused_draft", {
          method: "POST",
          token,
          body: { target_table: tableName, target_id: deleteRoute[2] }
        });
        sendJson(response, result.response.status, result.response.ok
          ? { success: true }
          : { error: apiErrorMessage(result.payload, "This HR record could not be deleted.") });
        return;
      }

      sendJson(response, 404, { error: "HR management route not found." });
      return;
    }
    if (!["admin", "super_admin"].includes(identity.role)) {
      sendJson(response, 403, { error: "Delegated HR access is limited to HR management endpoints." });
      return;
    }
    if (pathname === "/api/admin/role-agreements" && request.method === "GET") {
      const [rolesResult, termsResult, versionsResult] = await Promise.all([
        supabaseRequest("/rest/v1/staff_role_definitions?select=role_key,display_name,is_active&is_active=eq.true&order=display_name.asc", { token }),
        supabaseRequest("/rest/v1/staff_role_agreement_terms?select=role,terms,updated_at,updated_by", { token }),
        supabaseRequest("/rest/v1/staff_role_agreement_versions?select=id,role,version,status,sha256,created_at,published_at,template_content,terms_snapshot&order=created_at.desc&limit=100", { token })
      ]);
      for (const result of [rolesResult, termsResult, versionsResult]) {
        if (!result.response.ok) {
          sendJson(response, result.response.status, {
            error: apiErrorMessage(result.payload, "Role agreement setup could not be loaded.")
          });
          return;
        }
      }
      const roles = rolesResult.payload || [];
      const termsByRole = new Map((termsResult.payload || []).map((row) => [row.role, row]));
      const versionsByRole = new Map();
      for (const version of versionsResult.payload || []) {
        const versions = versionsByRole.get(version.role) || [];
        versions.push(version);
        versionsByRole.set(version.role, versions);
      }
      sendJson(response, 200, {
        success: true,
        data: {
          roles: roles.map((roleDefinition) => {
            const role = roleDefinition.role_key;
            return {
              role,
              label: roleDefinition.display_name,
              terms: termsByRole.get(role)?.terms || {},
              versions: versionsByRole.get(role) || []
            };
          }),
          can_edit_wording: identity.role === "super_admin"
        }
      });
      return;
    }

    if (pathname === "/api/admin/agreement-records" && request.method === "GET") {
      const requestedRole = requestUrl.searchParams.get("role") || "all";
      const roleDefinitions = await supabaseRequest(
        "/rest/v1/staff_role_definitions?select=id,role_key&is_active=eq.true",
        { token }
      );
      if (!roleDefinitions.response.ok) {
        sendJson(response, roleDefinitions.response.status, {
          error: apiErrorMessage(roleDefinitions.payload, "Staff roles could not be loaded.")
        });
        return;
      }
      const roleDefinitionsById = new Map((roleDefinitions.payload || []).map((role) => [role.id, role.role_key]));
      const supportedRoles = new Set(roleDefinitionsById.values());
      if (requestedRole !== "all" && !supportedRoles.has(requestedRole)) {
        sendJson(response, 400, { error: "Choose a supported agreement role." });
        return;
      }

      const requests = [];
      if (requestedRole === "all" || requestedRole === "reporter") {
        requests.push(
          supabaseRequest(
            "/rest/v1/reporter_service_agreement_issues?select=id,application_id,user_id,agreement_version,agreement_sha256,status,published_at,document_sha256&order=published_at.desc&limit=1000",
            { token }
          ).then((result) => ({ kind: "reporter-issues", result })),
          supabaseRequest(
            "/rest/v1/reporter_service_agreement_acceptances?select=id,issue_id,user_id,application_id,agreement_version,agreement_sha256,signer_name,accepted_at,generated_document_sha256&order=accepted_at.desc&limit=1000",
            { token }
          ).then((result) => ({ kind: "reporter-acceptances", result }))
        );
      }
      if (requestedRole === "all" || supportedRoles.has(requestedRole)) {
        requests.push(
          supabaseRequest(
            "/rest/v1/staff_role_agreement_acceptances?select=id,user_id,role,agreement_version_id,agreement_version,agreement_sha256,rendered_content,rendered_sha256,accepted_at&order=accepted_at.desc&limit=1000",
            { token }
          ).then((result) => ({ kind: "staff-acceptances", result })),
          supabaseRequest(
            "/rest/v1/staff_onboarding?select=*&limit=1000",
            { token }
          ).then((result) => ({ kind: "staff-onboarding", result })),
          supabaseRequest(
            "/rest/v1/staff_role_agreement_versions?select=id,role,version,status,published_at,template_content,terms_snapshot&order=created_at.desc&limit=1000",
            { token }
          ).then((result) => ({ kind: "staff-versions", result }))
        );
      }

      const results = await Promise.all(requests);
      const failed = results.find(({ result }) => !result.response.ok);
      if (failed) {
        sendJson(response, failed.result.response.status, {
          error: apiErrorMessage(failed.result.payload, "Agreement records could not be loaded.")
        });
        return;
      }
      const dataByKind = new Map(results.map(({ kind, result }) => [kind, result.payload || []]));
      const records = [];
      if (requestedRole === "all" || requestedRole === "reporter") {
        const issues = dataByKind.get("reporter-issues") || [];
        const acceptances = dataByKind.get("reporter-acceptances") || [];
        const acceptancesByIssue = new Map(
          acceptances.filter((item) => item.issue_id != null).map((item) => [String(item.issue_id), item])
        );
        issues.forEach((issue) => {
          const acceptance = acceptancesByIssue.get(String(issue.id));
          records.push({
            id: `reporter-issue-${issue.id}`,
            user_id: issue.user_id,
            role: "Reporter",
            version: issue.agreement_version,
            status: acceptance ? "Accepted" : issue.status === "published" ? "Awaiting acceptance" : "Superseded",
            issued_at: issue.published_at,
            accepted_at: acceptance?.accepted_at || null,
            signer_name: acceptance?.signer_name || null,
            rendered_content: null
          });
        });
        acceptances.filter((item) => item.issue_id == null).forEach((acceptance) => {
          records.push({
            id: `reporter-legacy-acceptance-${acceptance.id}`,
            user_id: acceptance.user_id,
            role: "Reporter",
            version: acceptance.agreement_version,
            status: "Accepted · historical record",
            issued_at: null,
            accepted_at: acceptance.accepted_at,
            signer_name: acceptance.signer_name,
            rendered_content: null
          });
        });
      }

      if (requestedRole === "all" || supportedRoles.has(requestedRole)) {
        const staffRoles = requestedRole === "all"
          ? [...supportedRoles]
          : [requestedRole];
        const versions = dataByKind.get("staff-versions") || [];
        const publishedVersions = versions.filter((version) => version.status === "published");
        const publishedByRole = new Map(publishedVersions.map((version) => [version.role, version]));
        const versionsById = new Map(versions.map((version) => [version.id, version]));
        const acceptances = (dataByKind.get("staff-acceptances") || []).filter((item) =>
          staffRoles.includes(item.role)
        );
        const onboarding = (dataByKind.get("staff-onboarding") || []).filter((item) =>
          staffRoles.includes(roleDefinitionsById.get(item.staff_role_id))
        );
        acceptances.forEach((acceptance) => {
          const acceptedVersion = versionsById.get(acceptance.agreement_version_id);
          records.push({
            id: `staff-acceptance-${acceptance.id}`,
            user_id: acceptance.user_id,
            role: acceptance.role,
            version: acceptance.agreement_version,
            status: "Accepted",
            issued_at: acceptedVersion?.published_at || null,
            accepted_at: acceptance.accepted_at,
            signer_name: null,
            rendered_content: acceptance.rendered_content,
            _agreement_version_id: acceptance.agreement_version_id,
            _rendered_sha256: acceptance.rendered_sha256
          });
        });
        onboarding.forEach((person) => {
          const staffRole = roleDefinitionsById.get(person.staff_role_id);
          const published = publishedByRole.get(staffRole);
          if (!staffRole) return;
          if (!published || !["submitted", "approved_pending_agreement"].includes(person.status)) return;
          records.push({
            id: `staff-pending-${person.user_id}`,
            user_id: person.user_id,
            role: staffRole,
            version: published.version,
            status: "Awaiting acceptance",
            issued_at: published.published_at,
            accepted_at: null,
            signer_name: null,
            rendered_content: null,
            _agreement_version_id: published.id,
            _onboarding: person,
            _published_agreement: published
          });
        });
      }

      const userIds = [...new Set(records.map((record) => record.user_id))]
        .filter((userId) => /^[0-9a-f-]{36}$/i.test(userId));
      const profiles = userIds.length
        ? await supabaseRequest(
          `/rest/v1/profiles?select=id,email,full_name,phone&id=in.(${userIds.join(",")})`,
          { token }
        )
        : { response: { ok: true }, payload: [] };
      if (!profiles.response.ok) {
        sendJson(response, profiles.response.status, {
          error: apiErrorMessage(profiles.payload, "Agreement record owners could not be loaded.")
        });
        return;
      }
      const profilesById = new Map((profiles.payload || []).map((profile) => [profile.id, profile]));
      records.forEach((record) => {
        const profile = profilesById.get(record.user_id);
        record.full_name = profile?.full_name || "—";
        record.email = profile?.email || "—";
      });
      const staffOnboardingByUser = new Map(
        (dataByKind.get("staff-onboarding") || []).map((person) => [person.user_id, person])
      );
      const staffPublishedByRole = new Map(
        (dataByKind.get("staff-versions") || [])
          .filter((version) => version.status === "published")
          .map((version) => [version.role, version])
      );
      try {
        records.forEach((record) => {
          if (!supportedRoles.has(record.role)) return;
          const onboarding = staffOnboardingByUser.get(record.user_id);
          const agreement = staffPublishedByRole.get(record.role);
          const profile = profilesById.get(record.user_id);
          if (!onboarding || !agreement || !profile) return;
          const matchingAcceptance = (dataByKind.get("staff-acceptances") || []).find((acceptance) => {
            if (acceptance.user_id !== record.user_id
                || acceptance.role !== record.role
                || acceptance.agreement_version_id !== agreement.id) return false;
            const resolved = renderStaffAgreement(
              agreement.template_content,
              agreement.terms_snapshot || {},
              profile,
              onboarding
            );
            const resolvedSha256 = createHash("sha256").update(resolved, "utf8").digest("hex");
            return acceptance.rendered_content === resolved
              && acceptance.rendered_sha256 === resolvedSha256;
          });
          if (record.id.startsWith("staff-pending-") && matchingAcceptance) {
            record._remove = true;
          } else if (record.id.startsWith("staff-acceptance-")) {
            record.status = matchingAcceptance && record.id === `staff-acceptance-${matchingAcceptance.id}`
              ? "Accepted current copy"
              : matchingAcceptance
                ? "Earlier copy · re-accepted"
              : record._agreement_version_id === agreement.id
                ? record.rendered_content
                  ? "Profile changed · re-acceptance needed"
                  : "Current copy not recorded"
                : "Historical acceptance";
          }
        });
      } catch (error) {
        sendJson(response, 409, { error: `Current staff agreement records could not be rendered: ${error.message}` });
        return;
      }
      const visibleRecords = records.filter((record) => !record._remove).map((record) => {
        delete record._remove;
        delete record._onboarding;
        delete record._published_agreement;
        delete record._agreement_version_id;
        delete record._rendered_sha256;
        return record;
      });
      visibleRecords.sort((left, right) =>
        String(right.accepted_at || right.issued_at || "").localeCompare(
          String(left.accepted_at || left.issued_at || "")
        )
      );
      sendJson(response, 200, { success: true, data: visibleRecords });
      return;
    }

    const roleAgreementTerms = pathname.match(/^\/api\/admin\/role-agreements\/([a-z][a-z0-9_-]*)\/terms$/);
    if (roleAgreementTerms && request.method === "PATCH") {
      const body = await readJsonBody(request);
      if (!body.terms || typeof body.terms !== "object" || Array.isArray(body.terms)
          || Object.keys(body.terms).length > 100
          || Object.entries(body.terms).some(([key, value]) =>
            !/^[a-z][a-z0-9_]{0,49}$/.test(key) || typeof value !== "string" || value.length > 5000)) {
        sendJson(response, 400, { error: "Terms must be a structured object of short keys and text values." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_set_staff_role_agreement_terms", {
        method: "POST",
        token,
        body: { target_role: roleAgreementTerms[1], target_terms: body.terms }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Structured agreement terms could not be saved.") });
      return;
    }

    const roleAgreementPreview = pathname.match(
      /^\/api\/admin\/role-agreements\/([a-z][a-z0-9_-]*)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/preview$/i
    );
    if (roleAgreementPreview && request.method === "GET") {
      if (identity.role !== "super_admin") {
        sendJson(response, 403, { error: "Only a super admin can preview agreement wording drafts." });
        return;
      }
      const result = await supabaseRequest(
        `/rest/v1/staff_role_agreement_versions?select=id,role,version,status,template_content,terms_snapshot&id=eq.${encodeURIComponent(roleAgreementPreview[2])}&role=eq.${encodeURIComponent(roleAgreementPreview[1])}&status=eq.draft&limit=1`,
        { token }
      );
      if (!result.response.ok || !result.payload?.[0]) {
        sendJson(response, result.response.ok ? 404 : result.response.status, {
          error: apiErrorMessage(result.payload, "The agreement draft could not be loaded for preview.")
        });
        return;
      }
      const draft = result.payload[0];
      try {
        const resolvedContent = renderStaffAgreement(
          draft.template_content,
          draft.terms_snapshot || {},
          {
            full_name: "Sample Staff Member",
            email: "sample.staff@example.invalid",
            phone: "+10000000000"
          },
          {
            requested_role: draft.role,
            permanent_address_line1: "100 Sample Road",
            permanent_address_line2: "Sample Locality",
            permanent_address_city: "Sample City",
            permanent_address_district: "Sample District",
            permanent_address_state: "Sample State",
            permanent_address_postal_code: "000000",
            date_of_birth: "1990-01-01"
          }
        );
        sendJson(response, 200, { success: true, data: { resolved_content: resolvedContent } });
      } catch (error) {
        sendJson(response, 409, { error: error.message });
      }
      return;
    }

    const roleAgreementDraft = pathname.match(/^\/api\/admin\/role-agreements\/([a-z][a-z0-9_-]*)\/drafts$/);
    if (roleAgreementDraft && request.method === "POST") {
      if (identity.role !== "super_admin") {
        sendJson(response, 403, { error: "Only a super admin can edit agreement wording." });
        return;
      }
      const body = await readJsonBody(request, 60 * 1024);
      const version = typeof body.version === "string" ? body.version.trim() : "";
      const template = typeof body.template_content === "string" ? body.template_content : "";
      if (!/^[A-Za-z0-9._-]{1,40}$/.test(version)
          || !template.trim() || template.length > 50000) {
        sendJson(response, 400, { error: "Provide a version label and non-empty agreement wording up to 50,000 characters." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_superadmin_save_staff_role_agreement_draft", {
        method: "POST",
        token,
        body: {
          target_role: roleAgreementDraft[1],
          target_version: version,
          target_template: template,
          target_sha256: createHash("sha256").update(template, "utf8").digest("hex")
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: { id: result.payload } }
        : { error: apiErrorMessage(result.payload, "Agreement wording draft could not be saved.") });
      return;
    }

    const roleAgreementPublish = pathname.match(/^\/api\/admin\/role-agreements\/([a-z][a-z0-9_-]*)\/([^/]+)\/publish$/);
    if (roleAgreementPublish && request.method === "POST") {
      if (identity.role !== "super_admin") {
        sendJson(response, 403, { error: "Only a super admin can publish agreement wording." });
        return;
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roleAgreementPublish[2])) {
        sendJson(response, 400, { error: "Choose a valid agreement draft to publish." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_superadmin_publish_staff_role_agreement", {
        method: "POST",
        token,
        body: { target_version: roleAgreementPublish[2] }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Agreement wording could not be published.") });
      return;
    }

    if (pathname === "/api/admin/staff-roles" && request.method === "GET") {
      const roles = await supabaseRequest(
        "/rest/v1/staff_role_definitions?select=id,role_key,display_name,description,duties,access_profile,is_builtin,is_active,created_at,updated_at&order=is_builtin.desc,display_name.asc",
        { token }
      );
      if (!roles.response.ok) {
        sendJson(response, roles.response.status, {
          error: apiErrorMessage(roles.payload, "Staff job roles could not be loaded.")
        });
        return;
      }
      sendJson(response, 200, { success: true, data: roles.payload || [] });
      return;
    }

    if (pathname === "/api/admin/staff-roles" && request.method === "POST") {
      const body = await readJsonBody(request);
      const roleId = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id)
        ? body.id
        : null;
      const saved = await supabaseRequest("/rest/v1/rpc/chowk_admin_save_staff_role_definition", {
        method: "POST",
        token,
        body: {
          target_role_id: roleId,
          target_role_key: typeof body.role_key === "string" ? body.role_key : "",
          target_display_name: typeof body.display_name === "string" ? body.display_name : "",
          target_description: typeof body.description === "string" ? body.description : "",
          target_duties: typeof body.duties === "string" ? body.duties : "",
          target_access_profile: typeof body.access_profile === "string" ? body.access_profile : "",
          target_is_active: body.is_active === true
        }
      });
      if (!saved.response.ok) {
        sendJson(response, saved.response.status, {
          error: apiErrorMessage(saved.payload, "Staff job role could not be saved.")
        });
        return;
      }
      const audit = await supabaseRequest("/rest/v1/rpc/chowk_record_admin_event", {
        method: "POST",
        token,
        body: {
          event_action: roleId ? "STAFF_JOB_ROLE_UPDATED" : "STAFF_JOB_ROLE_CREATED",
          target_table: "staff_role_definitions",
          target_record_id: saved.payload,
          event_data: {
            display_name: body.display_name,
            access_profile: body.access_profile,
            is_active: body.is_active === true
          }
        }
      });
      if (!audit.response.ok) {
        sendJson(response, 502, {
          error: `The staff job role was saved, but its audit event could not be recorded: ${apiErrorMessage(audit.payload, "audit logging failed.")}`
        });
        return;
      }
      sendJson(response, 200, { success: true, data: { id: saved.payload } });
      return;
    }

    if (pathname === "/api/admin/staff-onboarding" && request.method === "GET") {
      const onboarding = await supabaseRequest(
        "/rest/v1/staff_onboarding?select=*&order=submitted_at.desc.nullslast,invited_at.desc&limit=500",
        { token }
      );
      if (!onboarding.response.ok) {
        sendJson(response, onboarding.response.status, {
          error: apiErrorMessage(onboarding.payload, "Staff onboarding records could not be loaded.")
        });
        return;
      }
      const rows = onboarding.payload || [];
      const staffRoleIds = [...new Set(rows.map((row) => row.staff_role_id).filter(Boolean))];
      const roleDefinitions = staffRoleIds.length
        ? await supabaseRequest(
          `/rest/v1/staff_role_definitions?select=id,role_key,display_name,description,duties,access_profile,is_active&id=in.(${staffRoleIds.join(",")})`,
          { token }
        )
        : { response: { ok: true }, payload: [] };
      if (!roleDefinitions.response.ok) {
        sendJson(response, roleDefinitions.response.status, {
          error: apiErrorMessage(roleDefinitions.payload, "Staff job role details could not be loaded.")
        });
        return;
      }
      const staffRolesById = new Map((roleDefinitions.payload || []).map((role) => [role.id, role]));
      const userIds = rows.map((row) => row.user_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      const profiles = userIds.length
        ? await supabaseRequest(
          `/rest/v1/profiles?select=id,email,full_name,phone&id=in.(${userIds.join(",")})`,
          { token }
        )
        : { response: { ok: true }, payload: [] };
      if (!profiles.response.ok) {
        sendJson(response, profiles.response.status, {
          error: apiErrorMessage(profiles.payload, "Staff member profiles could not be loaded.")
        });
        return;
      }
      const assignments = userIds.length
        ? await supabaseRequest(
          `/rest/v1/staff_role_assignments?select=id,user_id,role_key_snapshot,display_name_snapshot,status,duties_snapshot,assigned_at,starts_at,ended_at,end_reason&user_id=in.(${userIds.join(",")})&order=assigned_at.desc`,
          { token }
        )
        : { response: { ok: true }, payload: [] };
      if (!assignments.response.ok) {
        sendJson(response, assignments.response.status, {
          error: apiErrorMessage(assignments.payload, "Staff job assignment history could not be loaded.")
        });
        return;
      }
      const profilesById = new Map((profiles.payload || []).map((profile) => [profile.id, profile]));
      const assignmentsByUserId = new Map();
      (assignments.payload || []).forEach((assignment) => {
        const history = assignmentsByUserId.get(assignment.user_id) || [];
        history.push(assignment);
        assignmentsByUserId.set(assignment.user_id, history);
      });
      const data = await Promise.all(rows.map(async (row) => ({
        ...row,
        staff_role: staffRolesById.get(row.staff_role_id) || null,
        role_assignment_history: assignmentsByUserId.get(row.user_id) || [],
        profile: profilesById.get(row.user_id) || null,
        profile_photo_url: row.profile_photo_path
          ? await signedStaffProfilePhotoUrl(row.profile_photo_path, row.user_id, token)
          : null
      })));
      sendJson(response, 200, { success: true, data });
      return;
    }

    const staffReview = pathname.match(
      /^\/api\/admin\/staff-onboarding\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/review$/i
    );
    if (staffReview && request.method === "POST") {
      const body = await readJsonBody(request);
      const decision = typeof body.decision === "string" ? body.decision : "";
      const reviewMessage = typeof body.review_message === "string" ? body.review_message.trim() : "";
      if (!["approve", "request_changes", "reject"].includes(decision)) {
        sendJson(response, 400, { error: "Choose approve, request changes, or reject." });
        return;
      }
      const reviewed = await supabaseRequest("/rest/v1/rpc/chowk_admin_review_staff_onboarding", {
        method: "POST",
        token,
        body: { target_user: staffReview[1], decision, review_message: reviewMessage }
      });
      if (!reviewed.response.ok) {
        sendJson(response, reviewed.response.status, {
          error: apiErrorMessage(reviewed.payload, "Staff profile review could not be saved.")
        });
        return;
      }
      const audit = await supabaseRequest("/rest/v1/rpc/chowk_record_admin_event", {
        method: "POST",
        token,
        body: {
          event_action: decision === "approve" ? "STAFF_ONBOARDING_APPROVED"
            : decision === "request_changes" ? "STAFF_ONBOARDING_CHANGES_REQUESTED"
              : "STAFF_ONBOARDING_REJECTED",
          target_table: "staff_onboarding",
          target_record_id: staffReview[1],
          event_data: { decision }
        }
      });
      if (!audit.response.ok) {
        sendJson(response, 502, {
          error: `The profile review was saved, but its audit event could not be recorded: ${apiErrorMessage(audit.payload, "audit logging failed.")}`
        });
        return;
      }
      const currentStatus = await supabaseRequest(
        `/rest/v1/staff_onboarding?select=status&user_id=eq.${encodeURIComponent(staffReview[1])}&limit=1`,
        { token }
      );
      sendJson(response, 200, {
        success: true,
        status: currentStatus.payload?.[0]?.status || null
      });
      return;
    }

    const staffJobRoleAssignment = pathname.match(
      /^\/api\/admin\/staff-onboarding\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/job-role$/i
    );
    if (staffJobRoleAssignment && request.method === "POST") {
      const body = await readJsonBody(request);
      const roleId = typeof body.staff_role_id === "string" && /^[0-9a-f-]{36}$/i.test(body.staff_role_id)
        ? body.staff_role_id
        : "";
      if (!roleId) {
        sendJson(response, 400, { error: "Choose an active staff job title." });
        return;
      }
      const assigned = await supabaseRequest("/rest/v1/rpc/chowk_admin_reassign_staff_job_role", {
        method: "POST",
        token,
        body: { target_user: staffJobRoleAssignment[1], target_role_id: roleId }
      });
      if (!assigned.response.ok) {
        sendJson(response, assigned.response.status, {
          error: apiErrorMessage(assigned.payload, "The staff job title could not be assigned.")
        });
        return;
      }
      const audit = await supabaseRequest("/rest/v1/rpc/chowk_record_admin_event", {
        method: "POST",
        token,
        body: {
          event_action: "STAFF_JOB_ROLE_REASSIGNED",
          target_table: "staff_role_assignments",
          target_record_id: assigned.payload,
          event_data: { user_id: staffJobRoleAssignment[1], staff_role_id: roleId }
        }
      });
      if (!audit.response.ok) {
        sendJson(response, 502, {
          error: `The staff job title was assigned, but its audit event could not be recorded: ${apiErrorMessage(audit.payload, "audit logging failed.")}`
        });
        return;
      }
      sendJson(response, 200, { success: true });
      return;
    }

    if (pathname === "/api/admin/staff-invitations" && request.method === "POST") {
      const body = await readJsonBody(request);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const staffRoleId = typeof body.staff_role_id === "string" && /^[0-9a-f-]{36}$/i.test(body.staff_role_id)
        ? body.staff_role_id
        : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        sendJson(response, 400, { error: "Enter a valid staff member email address." });
        return;
      }
      if (!staffRoleId) {
        sendJson(response, 400, { error: "Choose an active staff job title." });
        return;
      }
      const staffRoleResult = await supabaseRequest(
        `/rest/v1/staff_role_definitions?select=id,display_name,access_profile,is_active&id=eq.${encodeURIComponent(staffRoleId)}&is_active=eq.true&limit=1`,
        { token }
      );
      if (!staffRoleResult.response.ok) {
        sendJson(response, staffRoleResult.response.status, {
          error: apiErrorMessage(staffRoleResult.payload, "The selected staff job title could not be verified.")
        });
        return;
      }
      const staffRole = staffRoleResult.payload?.[0];
      if (!staffRole) {
        sendJson(response, 400, { error: "Choose an active staff job title." });
        return;
      }
      const requestedRole = staffRole.access_profile;
      let invitedUser;
      try {
        invitedUser = await inviteSupabaseUser(
          email,
          requestedRole,
          new URL("/staff-onboarding", requestOrigin(request)).toString()
        );
      } catch (error) {
        sendJson(response, error.statusCode || 502, { error: error.message });
        return;
      }
      const targetUser = invitedUser.id;
      const invitation = await supabaseRequest(
        "/rest/v1/rpc/chowk_admin_create_staff_role_invitation",
        {
          method: "POST",
          token,
          body: { target_user: targetUser, target_role_id: staffRole.id }
        }
      );
      if (!invitation.response.ok) {
        try {
          await deleteSupabaseAuthUser(targetUser);
        } catch (cleanupError) {
          console.error("Could not clean up an incomplete staff invitation:", cleanupError.message);
          sendJson(response, 502, {
            error: `The invitation email was sent, but onboarding setup failed and the new account could not be removed. Contact support with account ${email}.`
          });
          return;
        }
        sendJson(response, invitation.response.status, {
          error: apiErrorMessage(invitation.payload, "Staff onboarding could not be initialized. The incomplete invitation was removed.")
        });
        return;
      }
      const audit = await supabaseRequest("/rest/v1/rpc/chowk_record_admin_event", {
        method: "POST",
        token,
        body: {
          event_action: "STAFF_ONBOARDING_INVITED",
          target_table: "staff_onboarding",
          target_record_id: targetUser,
          event_data: {
            email,
            requested_role: requestedRole,
            staff_role_id: staffRole.id,
            staff_role_name: staffRole.display_name
          }
        }
      });
      if (!audit.response.ok) {
        sendJson(response, 502, {
          error: `The staff invitation was sent, but its audit event could not be recorded: ${apiErrorMessage(audit.payload, "audit logging failed.")}`
        });
        return;
      }
      sendJson(response, 201, {
        success: true,
        data: {
          id: targetUser,
          email,
          requested_role: requestedRole,
          staff_role_id: staffRole.id,
          staff_role_name: staffRole.display_name,
          status: "invited"
        }
      });
      return;
    }
    if (
      pathname === "/api/admin/reporter-agreement-template"
      || pathname.startsWith("/api/admin/reporter-agreement-template/")
      || pathname === "/api/admin/reporter-agreements"
      || pathname.startsWith("/api/admin/reporter-agreements/")
    ) {
      sendJson(response, 410, {
        error: "Application agreements are no longer used. Create and publish a personalized service agreement for approved reporters."
      });
      return;
    }

    const collections = {
      locations: {
        table: "locations",
        select: "id,name,slug,location_type,rto_code,parent_id,is_active,created_at",
        order: "location_type.asc,name.asc",
        fields: ["name", "slug", "location_type", "rto_code", "parent_id", "is_active"]
      },
      "reporter-designations": {
        table: "reporter_designations",
        select: "id,name,designation_code,description,is_active,created_at",
        order: "name.asc",
        fields: ["name", "designation_code", "description", "is_active"]
      },
      "reporter-applications": {
        table: "reporter_applications",
        select: "id,user_id,location_id,state_id,rto_office_id,reporter_designation_id,service_agreement_issue_id,applicant_details_confirmed,status,review_note,review_requests,reviewed_by,reviewed_at,company_signer_name,company_signer_designation,company_signature_accepted,company_signed_at,company_signature_statement,created_at,user:profiles!reporter_applications_user_id_fkey(id,email,full_name,phone),state:states(state_name,state_code),rto:rto_offices(rto_code,city_name),reporter_designation:reporter_designations(id,name,designation_code)",
        order: "created_at.desc"
      },
      "live-streams": {
        table: "live_streams",
        select: "id,title,description,youtube_video_id,youtube_url,status,scheduled_at,started_at,ended_at,created_by,created_at",
        order: "scheduled_at.desc.nullslast,created_at.desc",
        fields: ["title", "description", "youtube_video_id", "youtube_url", "status", "scheduled_at"]
      },
      reports: {
        table: "article_reports",
        select: "id,article_id,reporter_id,reason,details,status,reviewed_by,reviewed_at,created_at",
        order: "created_at.desc",
        fields: ["status"]
      },
      comments: {
        table: "comments",
        select: "id,article_id,user_id,content,is_approved,reviewed_by,reviewed_at,created_at",
        order: "created_at.desc",
        fields: ["is_approved"]
      },
      media: {
        table: "media_catalog",
        select: "id,media_type,title,description,media_url,cover_url,episode_label,duration_seconds,issue_date,status,published_at,created_by,created_at",
        order: "created_at.desc",
        fields: ["media_type", "title", "description", "media_url", "cover_url", "episode_label", "duration_seconds", "issue_date", "status", "published_at"]
      },
      "audit-logs": {
        table: "audit_logs",
        select: "id,actor_id,action,table_name,record_id,before_data,after_data,created_at",
        order: "created_at.desc"
      }
    };
    if (pathname === "/api/admin/reporter-directory" && request.method === "GET") {
      const [reporters, assignments, applications, applicationDetails] = await Promise.all([
        supabaseRequest("/rest/v1/reporter_profiles?select=user_id,reporter_code,created_at,user:profiles!reporter_profiles_user_id_fkey(id,email,full_name,phone,role,created_at)&order=created_at.desc&limit=1000", { token }),
        supabaseRequest("/rest/v1/reporter_assignments?select=id,user_id,rto_office_id,reporter_designation_id,effective_from,effective_to,rto:rto_offices(rto_code,city_name,state:states(state_code,state_name)),reporter_designation:reporter_designations(id,name)&order=effective_from.desc&limit=2000", { token }),
        supabaseRequest("/rest/v1/reporter_applications?select=id,user_id,status,created_at&status=in.(approved,active)&order=created_at.desc&limit=1000", { token }),
        supabaseRequest("/rest/v1/reporter_application_private_details?select=application_id,user_id,coverage_area:locations!reporter_application_private_details_coverage_area_id_fkey(name)&limit=1000", { token })
      ]);
      for (const result of [reporters, assignments, applications, applicationDetails]) {
        if (!result.response.ok) {
          sendJson(response, result.response.status, {
            error: apiErrorMessage(result.payload, "Reporter directory could not be loaded.")
          });
          return;
        }
      }
      const assignmentsByUser = new Map();
      (assignments.payload || []).forEach((assignment) => {
        const history = assignmentsByUser.get(assignment.user_id) || [];
        history.push(assignment);
        assignmentsByUser.set(assignment.user_id, history);
      });
      const detailsByApplication = new Map(
        (applicationDetails.payload || []).map((details) => [String(details.application_id), details])
      );
      const coverageAreaByUser = new Map();
      const usersWithLatestApplication = new Set();
      (applications.payload || []).forEach((application) => {
        if (usersWithLatestApplication.has(application.user_id)) return;
        usersWithLatestApplication.add(application.user_id);
        const details = detailsByApplication.get(String(application.id));
        coverageAreaByUser.set(application.user_id, details?.coverage_area?.name || "");
      });
      sendJson(response, 200, {
        success: true,
        data: (reporters.payload || []).map((reporter) => ({
          ...reporter,
          coverage_area_name: coverageAreaByUser.get(reporter.user_id) || null,
          assignments: assignmentsByUser.get(reporter.user_id) || []
        }))
      });
      return;
    }

    if (pathname === "/api/admin/reporter-options" && request.method === "GET") {
      const [states, rtos, designations, serviceAgreements, organizationProfile] = await Promise.all([
        supabaseRequest("/rest/v1/states?select=id,state_code,state_name,is_active&order=state_name.asc&limit=500", { token }),
        supabaseRequest("/rest/v1/rto_offices?select=id,state_id,rto_code,city_name,is_active&order=rto_code.asc&limit=1000", { token }),
        supabaseRequest("/rest/v1/reporter_designations?select=id,name,designation_code,description,is_active&order=name.asc&limit=500", { token }),
        supabaseRequest("/rest/v1/reporter_service_agreement_versions?select=id,version,sha256,document_url,status,published_at&template_content=not.is.null&order=created_at.desc&limit=100", { token }),
        supabaseRequest("/rest/v1/reporter_organization_profile?select=id,legal_name,trade_name,entity_type,registered_address,registration_number,official_email,official_phone,website_url,is_verified,updated_at&limit=1", { token })
      ]);
      for (const result of [states, rtos, designations, serviceAgreements, organizationProfile]) {
        if (!result.response.ok) {
          sendJson(response, result.response.status, {
            error: apiErrorMessage(result.payload, "Reporter configuration could not be loaded.")
          });
          return;
        }
      }
      sendJson(response, 200, { success: true, data: {
        states: states.payload || [],
        rtos: rtos.payload || [],
        reporter_designations: designations.payload || [],
        service_agreements: serviceAgreements.payload || [],
        organization_profile: organizationProfile.payload?.[0] || null
      } });
      return;
    }

    if (pathname === "/api/admin/reporter-agreement-template" && request.method === "GET") {
      const result = await supabaseRequest(
        "/rest/v1/reporter_agreement_versions?select=id,version,template_content,status&template_content=not.is.null&order=created_at.desc&limit=1",
        { token }
      );
      if (!result.response.ok) {
        sendJson(response, result.response.status, {
          error: apiErrorMessage(result.payload, "The application agreement template could not be loaded.")
        });
        return;
      }
      const latest = result.payload?.[0];
      sendJson(response, 200, {
        success: true,
        data: {
          template_content: latest?.template_content || defaultReporterAgreementTemplate(),
          based_on_version: latest?.version || null,
          is_default: !latest,
          supported_fields: [
            "{{agreement.date}}",
            "{{company.entity_type}}",
            "{{company.legal_name}}",
            "{{company.registered_address}}",
            "{{company.registration_number}}",
            "{{company.trade_name}}",
            "{{reporter.city}}",
            "{{reporter.email}}",
            "{{reporter.full_name}}",
            "{{reporter.phone}}",
            "{{reporter.reporter_code}}",
            "{{reporter.rto}}",
            "{{reporter.state}}"
          ]
        }
      });
      return;
    }

    if (pathname === "/api/admin/reporter-agreement-template/preview" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (typeof body.template_content !== "string"
          || body.template_content.trim().length < 1000
          || body.template_content.length > 50000) {
        sendJson(response, 400, { error: "The agreement template must contain between 1,000 and 50,000 characters." });
        return;
      }
      const unknownTokens = unknownTemplateTokens(body.template_content);
      if (unknownTokens.length) {
        sendJson(response, 400, { error: `Unknown dynamic agreement fields: ${unknownTokens.join(", ")}` });
        return;
      }
      const organizationResult = await supabaseRequest(
        "/rest/v1/reporter_organization_profile?select=legal_name,trade_name,entity_type,registered_address,registration_number,official_email,official_phone,website_url&id=eq.true&limit=1",
        { token }
      );
      if (!organizationResult.response.ok || !organizationResult.payload?.[0]) {
        sendJson(response, organizationResult.response.ok ? 404 : organizationResult.response.status, {
          error: apiErrorMessage(organizationResult.payload, "Organization legal details could not be loaded for preview.")
        });
        return;
      }
      const company = organizationResult.payload[0];
      const sampleData = {
        "agreement.date": new Intl.DateTimeFormat("en-IN", {
          day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Kolkata"
        }).format(new Date()),
        "company.entity_type": company.entity_type,
        "company.legal_name": company.legal_name,
        "company.official_email": company.official_email,
        "company.official_phone": company.official_phone,
        "company.registered_address": company.registered_address,
        "company.registration_number": company.registration_number || "Not provided",
        "company.trade_name": company.trade_name,
        "company.website_url": company.website_url || "Not provided",
        "reporter.city": "Sample City",
        "reporter.email": "sample.reporter@example.invalid",
        "reporter.full_name": "Sample Reporter",
        "reporter.phone": "0000000000",
        "reporter.reporter_code": "Assigned after approval",
        "reporter.rto": "Sample reporting area",
        "reporter.state": "Sample State",
        "reporter.designation": "District Reporter",
        "reporter.type": ""
      };
      const pdf = await createReporterAgreementPdf(body.template_content, sampleData, { preview: true });
      sendPdf(response, pdf, "reporter-agreement-admin-preview.pdf");
      return;
    }

    const collectionMatch = pathname.match(/^\/api\/admin\/(locations|reporter-designations|reporter-applications|live-streams|reports|comments|media|audit-logs)$/);
    const collection = collectionMatch && collections[collectionMatch[1]];
    if (collection && request.method === "GET") {
      const query = new URLSearchParams({
        select: collection.select,
        order: collection.order,
        limit: collection.table === "reporter_applications" ? "1000" : "200"
      });
      if (collection.table === "article_reports") query.set("status", "eq.open");
      if (collection.table === "comments") query.set("is_approved", "eq.false");
      const result = await supabaseRequest(`/rest/v1/${collection.table}?${query}`, { token });
      if (result.response.ok && collection.table === "reporter_applications") {
        const applications = Array.isArray(result.payload) ? result.payload : [];
        const applicationIds = applications
          .map((application) => Number(application.id))
          .filter((id) => Number.isSafeInteger(id) && id > 0);
        if (applicationIds.length) {
          const privateDetails = await supabaseRequest(
            `/rest/v1/reporter_application_private_details?select=application_id,coverage_area_id&application_id=in.(${applicationIds.join(",")})`,
            { token }
          );
          if (!privateDetails.response.ok) {
            sendJson(response, privateDetails.response.status, {
              error: apiErrorMessage(privateDetails.payload, "Reporter application coverage areas could not be loaded.")
            });
            return;
          }
          const coverageAreaIds = [...new Set((privateDetails.payload || [])
            .map((details) => Number(details.coverage_area_id))
            .filter((id) => Number.isSafeInteger(id) && id > 0))];
          let coverageAreasById = new Map();
          if (coverageAreaIds.length) {
            const coverageAreas = await supabaseRequest(
              `/rest/v1/locations?select=id,name&id=in.(${coverageAreaIds.join(",")})`,
              { token }
            );
            if (!coverageAreas.response.ok) {
              sendJson(response, coverageAreas.response.status, {
                error: apiErrorMessage(coverageAreas.payload, "Reporter application coverage areas could not be loaded.")
              });
              return;
            }
            coverageAreasById = new Map((coverageAreas.payload || [])
              .map((area) => [Number(area.id), area.name]));
          }
          const areaNameByApplicationId = new Map((privateDetails.payload || [])
            .map((details) => [
              Number(details.application_id),
              coverageAreasById.get(Number(details.coverage_area_id)) || null
            ]));
          result.payload = applications.map((application) => ({
            ...application,
            coverage_area_name: areaNameByApplicationId.get(Number(application.id)) || null
          }));
        }
      }
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, `${collection.table} could not be loaded.`) });
      return;
    }

    if (collection && request.method === "POST" && collection.fields) {
      const body = await readJsonBody(request);
      const record = Object.fromEntries(collection.fields
        .filter((field) => body[field] !== undefined)
        .map((field) => [field, body[field]]));
      if (collection.table === "reporter_designations") {
        const validationError = validateReporterDesignationRecord(record, true);
        if (validationError) {
          sendJson(response, 400, { error: validationError });
          return;
        }
      }
      if (collection.table === "locations" && (
        (record.location_type === "district" && (typeof record.rto_code !== "string" || !/^[A-Za-z0-9]{2,8}$/.test(record.rto_code))) ||
        (record.rto_code != null && (
          record.location_type !== "district" ||
          typeof record.rto_code !== "string" ||
          !/^[A-Za-z0-9]{2,8}$/.test(record.rto_code)
        ))
      )) {
        sendJson(response, 400, { error: "District RTO codes must contain 2-8 letters or numbers." });
        return;
      }
      if (collection.table === "live_streams") record.created_by = session.identity.id;
      if (collection.table === "media_catalog") {
        record.created_by = session.identity.id;
        if (record.status === "published" && !record.published_at) record.published_at = new Date().toISOString();
      }
      const result = await supabaseRequest(`/rest/v1/${collection.table}`, {
        method: "POST", token, body: record, prefer: "return=representation"
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload?.[0] }
        : { error: collection.table === "reporter_designations" && result.payload?.code === "23505"
          ? "That designation name or code is already in use."
          : apiErrorMessage(result.payload, `The ${collection.table} record could not be created.`) });
      return;
    }

    const applicationDelete = pathname.match(/^\/api\/admin\/reporter-applications\/(\d+)$/);
    if (applicationDelete && request.method === "DELETE") {
      const applicationId = Number(applicationDelete[1]);
      if (!Number.isSafeInteger(applicationId) || applicationId < 1) {
        sendJson(response, 400, { error: "Choose a valid reporter application." });
        return;
      }
      const deletion = await supabaseRequest("/rest/v1/rpc/chowk_admin_delete_reporter_application", {
        method: "POST",
        token,
        body: { target_application: applicationId }
      });
      if (!deletion.response.ok) {
        sendJson(response, deletion.response.status, {
          error: apiErrorMessage(deletion.payload, "Reporter application could not be deleted.")
        });
        return;
      }

      const deletedApplication = deletion.payload || {};
      const userId = deletedApplication.user_id;
      const applicationPaths = Array.isArray(deletedApplication.application_document_paths)
        ? deletedApplication.application_document_paths
        : [];
      const agreementPaths = Array.isArray(deletedApplication.agreement_document_paths)
        ? deletedApplication.agreement_document_paths
        : [];
      const cleanupErrors = [];
      for (const objectPath of applicationPaths) {
        try {
          await removeReporterApplicationDocument(objectPath, userId, token, { allowMissing: true });
        } catch (error) {
          console.error(`Could not remove a private document for deleted reporter application ${applicationId}:`, error.message);
          cleanupErrors.push(error);
        }
      }
      for (const objectPath of agreementPaths) {
        try {
          if (typeof objectPath !== "string"
              || !/^acceptance\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(objectPath)) {
            throw new Error("The stored agreement document reference is invalid.");
          }
          await removeReporterAgreementPdf(objectPath, token);
        } catch (error) {
          console.error(`Could not remove an accepted agreement for deleted reporter application ${applicationId}:`, error.message);
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length) {
        sendJson(response, 207, {
          success: false,
          application_deleted: true,
          cleanup_warning: "The application was deleted, but one or more private files could not be removed from storage. Contact support for cleanup."
        });
        return;
      }
      sendJson(response, 200, { success: true });
      return;
    }

    const collectionRecord = pathname.match(/^\/api\/admin\/(locations|reporter-designations|live-streams|reports|comments|media)\/(\d+)$/);
    if (collectionRecord && ["PATCH", "DELETE"].includes(request.method)) {
      const config = collections[collectionRecord[1]];
      if (!config.fields && request.method === "PATCH") {
        sendJson(response, 405, { error: "This record cannot be changed here." });
        return;
      }
      const body = request.method === "PATCH" ? await readJsonBody(request) : {};
      const record = Object.fromEntries((config.fields || [])
        .filter((field) => body[field] !== undefined)
        .map((field) => [field, body[field]]));
      if (config.table === "reporter_designations") {
        const validationError = validateReporterDesignationRecord(record, false);
        if (validationError) {
          sendJson(response, 400, { error: validationError });
          return;
        }
      }
      if (config.table === "locations" && record.location_type === "district" &&
          (typeof record.rto_code !== "string" || !/^[A-Za-z0-9]{2,8}$/.test(record.rto_code))) {
        sendJson(response, 400, { error: "Enter a District RTO code containing 2-8 letters or numbers." });
        return;
      }
      if (config.table === "locations" && record.rto_code !== undefined &&
          record.rto_code !== null &&
          (typeof record.rto_code !== "string" || !/^[A-Za-z0-9]{2,8}$/.test(record.rto_code))) {
        sendJson(response, 400, { error: "District RTO codes must contain 2-8 letters or numbers." });
        return;
      }
      if (config.table === "media_catalog" && record.status === "published" && !record.published_at) {
        record.published_at = new Date().toISOString();
      }
      if (config.table === "article_reports" || config.table === "comments") {
        record.reviewed_by = session.identity.id;
        record.reviewed_at = new Date().toISOString();
      }
      const result = await supabaseRequest(
        `/rest/v1/${config.table}?id=eq.${collectionRecord[2]}`,
        { method: request.method, token, ...(request.method === "PATCH" ? { body: record } : {}), prefer: "return=representation" }
      );
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: config.table === "reporter_designations" && result.payload?.code === "23505"
          ? "That designation name or code is already in use."
          : apiErrorMessage(result.payload, "The newsroom record could not be updated.") });
      return;
    }

    const applicationPrivateDetails = pathname.match(/^\/api\/admin\/reporter-applications\/(\d+)\/private-details$/);
    if (applicationPrivateDetails && request.method === "GET") {
      const applicationId = applicationPrivateDetails[1];
      const [details, documents] = await Promise.all([
        supabaseRequest(
          `/rest/v1/reporter_application_private_details?select=mobile_number,date_of_birth,age_at_application,emergency_contact_name,emergency_contact_relationship,emergency_contact_phone,father_first_name,father_last_name,permanent_address_line1,permanent_address_line2,permanent_address_city,permanent_address_district,permanent_address_state,permanent_address_postal_code,blood_group,masked_aadhaar_confirmed,document_processing_consent,preferred_language,coverage_localities,coverage_area_id,coverage_area:locations!reporter_application_private_details_coverage_area_id_fkey(name),experience_years,experience_summary,availability,bank_account_holder,bank_name,bank_account_number,bank_ifsc&application_id=eq.${applicationId}&limit=1`,
          { token }
        ),
        supabaseRequest(
          `/rest/v1/reporter_application_documents?select=document_type,storage_path,mime_type,sha256,created_at&application_id=eq.${applicationId}&order=document_type.asc`,
          { token }
        )
      ]);
      for (const result of [details, documents]) {
        if (!result.response.ok) {
          sendJson(response, result.response.status, {
            error: apiErrorMessage(result.payload, "Private reporter application details could not be loaded.")
          });
          return;
        }
      }
      const signedDocuments = await Promise.all((documents.payload || []).map(async (document) => ({
        ...document,
        preview_url: await signedReporterApplicationDocumentUrl(document.storage_path, token)
      })));
      sendJson(response, 200, {
        success: true,
        data: { details: details.payload?.[0] || null, documents: signedDocuments }
      });
      return;
    }

    const reporterDesignation = pathname.match(
      /^\/api\/admin\/reporter-applications\/(\d+)\/designation$/
    );
    if (reporterDesignation && request.method === "POST") {
      const body = await readJsonBody(request);
      const designationId = Number(body.designation_id);
      if (!Number.isSafeInteger(designationId) || designationId < 1) {
        sendJson(response, 400, { error: "Choose an active reporter designation." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_set_reporter_designation", {
        method: "POST",
        token,
        body: {
          target_application: Number(reporterDesignation[1]),
          target_designation: designationId
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Reporter designation could not be assigned.") });
      return;
    }

    const applicationReview = pathname.match(/^\/api\/admin\/reporter-applications\/(\d+)\/review$/);
    if (applicationReview && request.method === "POST") {
      const body = await readJsonBody(request);
      const decision = body.decision === "approve" ? "approved"
        : body.decision === "reject" ? "rejected"
          : body.decision === "needs_information" ? "needs_information"
            : "";
      const targetApplication = Number(applicationReview[1]);
      if (!decision) {
        sendJson(response, 400, { error: "Choose a valid review decision." });
        return;
      }
      if (!Number.isSafeInteger(targetApplication) || targetApplication < 1) {
        sendJson(response, 400, { error: "The reporter application reference is invalid." });
        return;
      }
      const reviewRequests = body.review_requests === undefined ? [] : body.review_requests;
      if (!Array.isArray(reviewRequests)) {
        sendJson(response, 400, { error: "Field requests must be provided as a list." });
        return;
      }
      if (reviewRequests.length > 40) {
        sendJson(response, 400, { error: "A review may contain no more than 40 field requests." });
        return;
      }
      const reviewerName = String(session.identity.full_name || session.identity.name || "").trim();
      const reviewerDesignation = session.identity.role === "super_admin"
        ? "Super Administrator"
        : "Administrator";
      const reviewableFields = new Set([
        "state_id", "rto_office_id",
        "mobile_number", "date_of_birth", "emergency_contact_name",
        "father_first_name", "father_last_name", "permanent_address_line1",
        "permanent_address_line2", "permanent_address_city", "permanent_address_district",
        "permanent_address_state", "permanent_address_postal_code",
        "emergency_contact_relationship", "emergency_contact_phone", "blood_group",
        "preferred_language", "coverage_area_id", "coverage_localities",
        "experience_years", "experience_summary", "availability",
        "bank_account_holder", "bank_name", "bank_account_number", "bank_ifsc",
        "profile_photo", "aadhaar_front", "aadhaar_back", "pan_card", "bank_proof"
      ]);
      const documentFields = new Set(["profile_photo", "aadhaar_front", "aadhaar_back", "pan_card", "bank_proof"]);
      const requestedFieldNames = new Set();
      const invalidRequest = reviewRequests.some((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)
            || !reviewableFields.has(item.field)
            || !["correction", "reupload", "other"].includes(item.kind)
            || typeof item.instruction !== "string"
            || item.instruction.trim().length < 2
            || item.instruction.trim().length > 500
            || (item.kind === "reupload" && !documentFields.has(item.field))
            || (item.kind === "correction" && documentFields.has(item.field))
            || requestedFieldNames.has(item.field)) {
          return true;
        }
        requestedFieldNames.add(item.field);
        return false;
      });
      if (invalidRequest) {
        sendJson(response, 400, { error: "Each field request needs a unique supported field, action and 2-500 character instruction." });
        return;
      }
      if (reviewRequests.length && decision !== "needs_information") {
        sendJson(response, 400, { error: "Field requests can only be sent with a request-for-information decision." });
        return;
      }
      if (decision === "needs_information" && reviewRequests.length === 0) {
        sendJson(response, 400, {
          error: "Select at least one field to request. If no changes are needed, choose Approve."
        });
        return;
      }
      const designationId = decision === "approved" ? Number(body.designation_id) : null;
      if (decision === "approved"
          && (!Number.isSafeInteger(designationId) || designationId < 1)) {
        sendJson(response, 400, { error: "Choose a reporter designation before approving the application." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_review_reporter_application_with_designation", {
        method: "POST",
        token,
        body: {
          target_application: targetApplication,
          decision,
          note: body.note || "",
          signer_name: reviewerName,
          signer_designation: reviewerDesignation,
          signature_accepted: body.signature_accepted === true,
          requested_fields: reviewRequests,
          target_designation: designationId
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Reporter application review failed.") });
      return;
    }

    if (pathname === "/api/admin/dashboard" && request.method === "GET") {
      const [articles, published, profiles, categories, recentArticles, recentUsers] = await Promise.all([
        supabaseRequest("/rest/v1/articles?select=id&limit=1", { token, prefer: "count=exact" }),
        supabaseRequest("/rest/v1/articles?select=id&status=eq.published&limit=1", { token, prefer: "count=exact" }),
        supabaseRequest("/rest/v1/profiles?select=id&limit=1", { token, prefer: "count=exact" }),
        supabaseRequest("/rest/v1/categories?select=id&limit=1", { token, prefer: "count=exact" }),
        supabaseRequest("/rest/v1/articles?select=id,title,slug,status,published_at,created_at&order=created_at.desc&limit=5", { token }),
        supabaseRequest("/rest/v1/profiles?select=id,full_name,role,created_at&order=created_at.desc&limit=5", { token })
      ]);
      for (const result of [articles, published, profiles, categories, recentArticles, recentUsers]) {
        if (!result.response.ok) {
          sendJson(response, result.response.status, { error: apiErrorMessage(result.payload, "Dashboard data could not be loaded.") });
          return;
        }
      }
      const total = (result) => Number(result.response.headers.get("content-range")?.split("/")[1]) || 0;
      sendJson(response, 200, { success: true, data: {
        total_articles: total(articles),
        published_articles: total(published),
        total_users: total(profiles),
        total_categories: total(categories),
        recent_articles: recentArticles.payload || [],
        recent_users: (recentUsers.payload || []).map((user) => ({ ...user, name: user.full_name }))
      } });
      return;
    }

    if (pathname === "/api/admin/articles" && request.method === "GET") {
      const query = new URLSearchParams({
        select: "id,title,slug,excerpt,content,category_id,image_url,video_url,audio_url,reporting_location_id,status,workflow_status,published_at,created_at",
        order: "created_at.desc",
        limit: "100"
      });
      const result = await supabaseRequest(`/rest/v1/articles?${query}`, { token });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: await signArticlesMedia(result.payload || [], token) }
        : { error: apiErrorMessage(result.payload, "Articles could not be loaded.") });
      return;
    }

    if (pathname === "/api/admin/daily-submission-report" && request.method === "GET") {
      const date = requestUrl.searchParams.get("date") || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        sendJson(response, 400, { error: "Choose a report date in YYYY-MM-DD format." });
        return;
      }
      const [year, month, day] = date.split("-").map(Number);
      const calendarDate = new Date(Date.UTC(year, month - 1, day));
      if (calendarDate.toISOString().slice(0, 10) !== date) {
        sendJson(response, 400, { error: "The report date is invalid." });
        return;
      }
      const startDate = new Date(`${date}T00:00:00+05:30`);
      const nextDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
      const query = new URLSearchParams({
        select: "id,title,slug,workflow_status,submitted_at,review_note,author:profiles!articles_author_id_fkey(full_name,email),reporting_location:locations!articles_reporting_location_id_fkey(name,location_type)",
        submitted_at: `gte.${startDate.toISOString()}`,
        order: "submitted_at.asc",
        limit: "1000"
      });
      query.set("and", `(submitted_at.lt.${nextDate.toISOString()})`);
      const result = await supabaseRequest(`/rest/v1/articles?${query}`, { token });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: { date, timezone: "Asia/Kolkata", submissions: result.payload || [] } }
        : { error: apiErrorMessage(result.payload, "The daily submission report could not be loaded.") });
      return;
    }

    const articleDetail = pathname.match(/^\/api\/admin\/articles\/(\d+)$/);
    if (articleDetail && request.method === "GET") {
      const result = await supabaseRequest(
        `/rest/v1/articles?select=id,title,slug,excerpt,content,category_id,image_url,video_url,audio_url,reporting_location_id,status,workflow_status,published_at,created_at&id=eq.${articleDetail[1]}&limit=1`,
        { token }
      );
      if (!result.response.ok) {
        sendJson(response, result.response.status, { error: apiErrorMessage(result.payload, "Article could not be loaded.") });
      } else if (!result.payload?.[0]) {
        sendJson(response, 404, { error: "Article not found." });
      } else {
        sendJson(response, 200, { success: true, data: result.payload[0] });
      }
      return;
    }

    if (pathname === "/api/admin/categories" && request.method === "GET") {
      const result = await supabaseRequest("/rest/v1/categories?select=id,name,slug,icon_key,is_active,created_at&order=name.asc", { token });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Categories could not be loaded.") });
      return;
    }

    if (pathname === "/api/admin/users" && request.method === "GET") {
      const [result, onboarding] = await Promise.all([
        supabaseRequest("/rest/v1/profiles?select=id,email,full_name,phone,role,created_at&order=created_at.desc&limit=100", { token }),
        supabaseRequest("/rest/v1/staff_onboarding?select=user_id,requested_role,status&limit=1000", { token })
      ]);
      for (const responseResult of [result, onboarding]) {
        if (!responseResult.response.ok) {
          sendJson(response, responseResult.response.status, {
            error: apiErrorMessage(responseResult.payload, "Users and staff onboarding states could not be loaded.")
          });
          return;
        }
      }
      const staffByUserId = new Map((onboarding.payload || []).map((item) => [item.user_id, item]));
      sendJson(response, 200, {
        success: true,
        data: (result.payload || []).map((profile) => {
          const staff = staffByUserId.get(profile.id);
          return {
            ...profile,
            requested_role: staff?.requested_role || "",
            staff_status: staff?.status || ""
          };
        })
      });
      return;
    }

    const userDelete = pathname.match(/^\/api\/admin\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (userDelete && request.method === "DELETE") {
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: "Cross-origin request rejected." });
        return;
      }

      const targetUser = userDelete[1];
      if (targetUser.toLowerCase() === session.identity.id.toLowerCase()) {
        sendJson(response, 400, { error: "You cannot delete your own account." });
        return;
      }

      const assets = await supabaseRequest("/rest/v1/rpc/chowk_admin_user_deletion_assets", {
        method: "POST",
        token,
        body: { target_user: targetUser }
      });
      if (!assets.response.ok) {
        sendJson(response, assets.response.status, {
          error: apiErrorMessage(assets.payload, "User account could not be prepared for deletion.")
        });
        return;
      }
      if (assets.payload?.role === "super_admin") {
        sendJson(response, 403, { error: "Super admin accounts cannot be deleted here." });
        return;
      }

      try {
        await deleteSupabaseAuthUser(targetUser);
      } catch (error) {
        sendJson(response, error.statusCode || 502, {
          error: error.message || "The Supabase login account could not be deleted."
        });
        return;
      }

      const applicationPaths = Array.isArray(assets.payload?.application_document_paths)
        ? assets.payload.application_document_paths
        : [];
      const agreementPaths = Array.isArray(assets.payload?.agreement_document_paths)
        ? assets.payload.agreement_document_paths
        : [];
      const cleanupErrors = [];
      for (const objectPath of applicationPaths) {
        try {
          await removeReporterApplicationDocument(objectPath, targetUser, token, { allowMissing: true });
        } catch (error) {
          console.error(`Could not remove a private document for deleted user ${targetUser}:`, error.message);
          cleanupErrors.push(error);
        }
      }
      for (const objectPath of agreementPaths) {
        try {
          if (typeof objectPath !== "string"
              || !/^(?:application|service)\/[0-9a-f-]{36}\.pdf$|^acceptance\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(objectPath)) {
            throw new Error("The stored agreement document reference is invalid.");
          }
          await removeReporterAgreementPdf(objectPath, token);
        } catch (error) {
          console.error(`Could not remove an agreement document for deleted user ${targetUser}:`, error.message);
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length) {
        sendJson(response, 207, {
          success: false,
          user_deleted: true,
          cleanup_warning: "The login and profile were deleted, but one or more private files could not be removed from storage. Contact support for cleanup."
        });
        return;
      }
      sendJson(response, 200, { success: true });
      return;
    }

    if (request.method === "POST" && ["/api/admin/articles", "/api/admin/categories"].includes(pathname)) {
      const body = await readJsonBody(request);
      const isArticle = pathname.endsWith("/articles");
      if (isArticle) {
        const result = await supabaseRequest("/rest/v1/rpc/chowk_workspace_create_article", {
          method: "POST",
          token,
          body: {
            article_title: body.title,
            article_slug: body.slug,
            article_excerpt: body.excerpt || "",
            article_content: body.content,
            article_category_id: body.category_id ? Number(body.category_id) : null,
            article_image_url: body.image_url || null,
            article_video_url: body.video_url || null,
            article_audio_url: body.audio_url || null,
            article_reporting_location_id: null
          }
        });
        sendJson(response, result.response.status, result.response.ok
          ? { success: true, data: { id: result.payload } }
          : { error: apiErrorMessage(result.payload, "Article draft could not be created.") });
        return;
      }
      const iconKey = body.icon_key === undefined ? "newspaper" : body.icon_key;
      if (!categoryIconKeys.has(iconKey)) {
        sendJson(response, 400, { error: "Choose a valid category icon." });
        return;
      }
      const allowed = ["name", "slug", "is_active"];
      const record = Object.fromEntries(allowed.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
      record.icon_key = iconKey;
      const result = await supabaseRequest("/rest/v1/categories", { method: "POST", token, body: record, prefer: "return=representation" });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload?.[0] }
        : { error: apiErrorMessage(result.payload, "Category could not be created.") });
      return;
    }

    const adminArticleTransition = pathname.match(/^\/api\/admin\/articles\/(\d+)\/transition$/);
    const articlePublish = pathname.match(/^\/api\/admin\/articles\/(\d+)\/publish$/);
    const articleItem = pathname.match(/^\/api\/admin\/articles\/(\d+)$/);
    const categoryItem = pathname.match(/^\/api\/admin\/categories\/(\d+)$/);
    const roleItem = pathname.match(/^\/api\/admin\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/role$/i);
    const reporterAssignmentItem = pathname.match(/^\/api\/admin\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/reporter-assignment$/i);
    if (adminArticleTransition && request.method === "POST") {
      const body = await readJsonBody(request);
      if (body.action !== "reopen_rejected" || typeof body.note !== "string") {
        sendJson(response, 400, { error: "Choose a valid admin article workflow action and provide an audit reason." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_workspace_transition_article", {
        method: "POST",
        token,
        body: {
          target_article: Number(adminArticleTransition[1]),
          requested_action: body.action,
          action_note: body.note,
          scheduled_for: null
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Article could not be returned to review.") });
      return;
    }
    if (articlePublish && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await supabaseRequest("/rest/v1/rpc/chowk_workspace_transition_article", {
        method: "POST",
        token,
        body: {
          target_article: Number(articlePublish[1]),
          requested_action: "publish",
          action_note: typeof body.reason === "string" ? body.reason : "",
          scheduled_for: null
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Article could not be published.") });
      return;
    }

    if (articleItem && ["PATCH", "DELETE"].includes(request.method)) {
      if (request.method === "PATCH") {
        const body = await readJsonBody(request);
        const existing = await supabaseRequest(
          `/rest/v1/articles?select=reporting_location_id&id=eq.${articleItem[1]}&limit=1`,
          { token }
        );
        if (!existing.response.ok || !existing.payload?.[0]) {
          sendJson(response, existing.response.ok ? 404 : existing.response.status, {
            error: apiErrorMessage(existing.payload, "Article could not be loaded for editing.")
          });
          return;
        }
        const result = await supabaseRequest("/rest/v1/rpc/chowk_workspace_update_article", {
          method: "POST",
          token,
          body: {
            target_article: Number(articleItem[1]),
            article_title: body.title,
            article_slug: body.slug,
            article_excerpt: body.excerpt || "",
            article_content: body.content,
            article_category_id: body.category_id ? Number(body.category_id) : null,
            article_image_url: body.image_url || null,
            article_video_url: body.video_url || null,
            article_audio_url: body.audio_url || null,
            article_reporting_location_id: existing.payload[0].reporting_location_id,
            change_reason: typeof body.change_reason === "string" ? body.change_reason : ""
          }
        });
        sendJson(response, result.response.status, result.response.ok
          ? { success: true }
          : { error: apiErrorMessage(result.payload, "Article could not be updated.") });
        return;
      }
      const endpoint = `/rest/v1/articles?id=eq.${articleItem[1]}`;
      const result = await supabaseRequest(endpoint, {
        method: "DELETE", token, prefer: "return=representation"
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Article could not be updated.") });
      return;
    }

    if (categoryItem && ["PATCH", "DELETE"].includes(request.method)) {
      const endpoint = `/rest/v1/categories?id=eq.${categoryItem[1]}`;
      const body = request.method === "PATCH" ? await readJsonBody(request) : undefined;
      if (body?.icon_key !== undefined && !categoryIconKeys.has(body.icon_key)) {
        sendJson(response, 400, { error: "Choose a valid category icon." });
        return;
      }
      const safeBody = body && Object.fromEntries(
        ["name", "slug", "icon_key", "is_active"].filter((key) => body[key] !== undefined).map((key) => [key, body[key]])
      );
      const result = await supabaseRequest(endpoint, {
        method: request.method, token, body: safeBody, prefer: "return=representation"
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Category could not be updated.") });
      return;
    }

    if (roleItem && request.method === "PATCH") {
      const body = await readJsonBody(request);
      if (body.role === "reporter") {
        sendJson(response, 400, { error: "Reporter access is granted only after the applicant completes the reporter onboarding steps." });
        return;
      }
      if (["moderator", "editor"].includes(body.role)) {
        const currentProfile = await supabaseRequest(
          `/rest/v1/profiles?select=role&id=eq.${roleItem[1]}&limit=1`,
          { token }
        );
        if (!currentProfile.response.ok) {
          sendJson(response, currentProfile.response.status, {
            error: apiErrorMessage(currentProfile.payload, "The current staff role could not be verified.")
          });
          return;
        }
        if (currentProfile.payload?.[0]?.role !== body.role) {
          sendJson(response, 400, {
            error: "Moderator and editor roles can only be assigned by approving a completed staff onboarding profile."
          });
          return;
        }
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_set_user_role", {
        method: "POST", token, body: { target_user: roleItem[1], new_role: body.role }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Role could not be updated.") });
      return;
    }

    if (reporterAssignmentItem && request.method === "POST") {
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: "Cross-origin request rejected." });
        return;
      }
      const body = await readJsonBody(request);
      const stateId = Number(body.state_id);
      const rtoId = Number(body.rto_office_id);
      if (![stateId, rtoId].every((value) => Number.isSafeInteger(value) && value > 0)) {
        sendJson(response, 400, { error: "Choose an active state and RTO/reporting area." });
        return;
      }
      const [profile, state, rto, currentAssignment] = await Promise.all([
        supabaseRequest(`/rest/v1/profiles?select=role&id=eq.${reporterAssignmentItem[1]}&limit=1`, { token }),
        supabaseRequest(`/rest/v1/states?select=id&id=eq.${stateId}&is_active=eq.true&limit=1`, { token }),
        supabaseRequest(`/rest/v1/rto_offices?select=id,state_id&id=eq.${rtoId}&is_active=eq.true&limit=1`, { token }),
        supabaseRequest(`/rest/v1/reporter_assignments?select=reporter_type_id&user_id=eq.${reporterAssignmentItem[1]}&effective_to=is.null&limit=1`, { token })
      ]);
      for (const result of [profile, state, rto, currentAssignment]) {
        if (!result.response.ok) {
          sendJson(response, result.response.status, {
            error: apiErrorMessage(result.payload, "Reporter account options could not be validated.")
          });
          return;
        }
      }
      if (!profile.payload?.[0]) {
        sendJson(response, 404, { error: "User account not found." });
        return;
      }
      const reporterTypeId = Number(currentAssignment.payload?.[0]?.reporter_type_id);
      if (!state.payload?.[0] || !rto.payload?.[0]
          || !Number.isSafeInteger(reporterTypeId) || reporterTypeId < 1
          || Number(rto.payload[0].state_id) !== stateId) {
        sendJson(response, 400, { error: "Choose an active RTO/reporting area belonging to the selected state. The reporter also needs a current designation assignment." });
        return;
      }
      if (profile.payload[0].role !== "reporter") {
        sendJson(response, 409, {
          error: "Reporter access is granted only after the applicant completes the reporter onboarding steps."
        });
        return;
      }
      const assigned = await supabaseRequest("/rest/v1/rpc/chowk_admin_assign_reporter", {
        method: "POST",
        token,
        body: { target_user: reporterAssignmentItem[1], target_rto: rtoId, target_type: reporterTypeId }
      });
      if (!assigned.response.ok) {
        sendJson(response, 502, {
          error: `Reporter assignment could not be updated. The existing reporter access remains active: ${apiErrorMessage(assigned.payload, "reporter assignment failed.")}`,
          recovery_required: true
        });
        return;
      }
      const reporterProfile = await supabaseRequest(
        `/rest/v1/reporter_profiles?select=reporter_code&user_id=eq.${reporterAssignmentItem[1]}&limit=1`,
        { token }
      );
      if (!reporterProfile.response.ok || !reporterProfile.payload?.[0]?.reporter_code) {
        sendJson(response, 502, {
          error: "Reporter assignment succeeded, but the generated reporter ID could not be loaded. Refresh the reporter directory.",
          recovery_required: true
        });
        return;
      }
      sendJson(response, 200, {
        success: true,
        data: { reporter_code: reporterProfile.payload[0].reporter_code }
      });
      return;
    }

    if (pathname === "/api/admin/users" && request.method === "POST") {
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: "Cross-origin request rejected." });
        return;
      }
      const body = await readJsonBody(request);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const role = typeof body.role === "string" ? body.role : "subscriber";
      if (role === "reporter") {
        sendJson(response, 400, {
          error: "Reporter accounts must apply from a subscriber account and complete the reporter onboarding steps."
        });
        return;
      }
      if (["moderator", "editor"].includes(role)) {
        sendJson(response, 400, {
          error: "Moderator and editor access is granted only after the invited staff member completes profile onboarding and Admin approves it."
        });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sendJson(response, 400, { error: "Enter a valid email address." });
        return;
      }
      if (fullName.length < 2 || fullName.length > 120) {
        sendJson(response, 400, { error: "Full name must be between 2 and 120 characters." });
        return;
      }
      if (phone && !/^\+?[1-9][0-9]{6,14}$/.test(phone)) {
        sendJson(response, 400, { error: "Enter a valid phone number." });
        return;
      }
      if (password.length < 8 || password.length > 72) {
        sendJson(response, 400, { error: "Temporary password must be between 8 and 72 characters." });
        return;
      }
      if (!["subscriber", "publisher", "admin", "super_admin"].includes(role)) {
        sendJson(response, 400, { error: "Select a valid account role." });
        return;
      }
      if (role === "super_admin" && session.identity.role !== "super_admin") {
        sendJson(response, 403, { error: "Only a super admin can create another super admin." });
        return;
      }
      const created = await supabaseRequest("/auth/v1/signup", {
        method: "POST",
        body: { email, password, data: { full_name: fullName, phone } }
      });
      const createdUser = created.payload?.user || created.payload;
      if (!created.response.ok || typeof createdUser?.id !== "string") {
        sendJson(response, created.response.status || 502, {
          error: apiErrorMessage(created.payload, "The account could not be created. The email may already be registered.")
        });
        return;
      }
      if (role !== "subscriber") {
        const assigned = await supabaseRequest("/rest/v1/rpc/chowk_admin_set_user_role", {
          method: "POST",
          token,
          body: { target_user: createdUser.id, new_role: role }
        });
        if (!assigned.response.ok) {
          sendJson(response, assigned.response.status, {
            error: `The account was created as a subscriber, but role assignment failed: ${apiErrorMessage(assigned.payload, "role assignment failed.")}`
          });
          return;
        }
      }
      const profile = await supabaseRequest(
        `/rest/v1/profiles?select=id,email,full_name,phone,role,created_at&id=eq.${createdUser.id}&limit=1`,
        { token }
      );
      if (!profile.response.ok || !profile.payload?.[0]) {
        sendJson(response, 502, { error: "The account was created, but its profile could not be loaded. Refresh the user list." });
        return;
      }
      const audit = await supabaseRequest("/rest/v1/rpc/chowk_record_admin_event", {
        method: "POST",
        token,
        body: {
          event_action: "USER_CREATED",
          target_table: "profiles",
          target_record_id: createdUser.id,
          event_data: {
            email,
            role: profile.payload[0].role,
            changed_fields: [
              { field: "email", before: null, after: email },
              { field: "role", before: null, after: profile.payload[0].role }
            ]
          }
        }
      });
      if (!audit.response.ok) {
        sendJson(response, 502, {
          error: `The account was created, but its audit event could not be recorded: ${apiErrorMessage(audit.payload, "audit logging failed.")}`
        });
        return;
      }
      sendJson(response, 201, {
        success: true,
        confirmation_required: !createdUser.email_confirmed_at,
        data: profile.payload[0]
      });
      return;
    }

    if (pathname === "/api/admin/profile" && request.method === "PATCH") {
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: "Cross-origin request rejected." });
        return;
      }
      const body = await readJsonBody(request);
      const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      if (fullName.length < 2 || fullName.length > 120) {
        sendJson(response, 400, { error: "Full name must be between 2 and 120 characters." });
        return;
      }
      if (phone && !/^\+?[1-9][0-9]{6,14}$/.test(phone)) {
        sendJson(response, 400, { error: "Enter a valid phone number." });
        return;
      }
      const result = await supabaseRequest(
        `/rest/v1/profiles?id=eq.${session.identity.id}&select=id,email,full_name,phone,role,created_at`,
        { method: "PATCH", token, body: { full_name: fullName, phone }, prefer: "return=representation" }
      );
      if (!result.response.ok || !result.payload?.[0]) {
        sendJson(response, result.response.status || 502, {
          error: apiErrorMessage(result.payload, "Profile could not be updated.")
        });
        return;
      }
      sendJson(response, 200, { success: true, identity: { ...session.identity, ...result.payload[0], name: fullName } });
      return;
    }

    if (pathname === "/api/admin/password" && request.method === "PATCH") {
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: "Cross-origin request rejected." });
        return;
      }
      const body = await readJsonBody(request);
      if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 72) {
        sendJson(response, 400, { error: "New password must be between 8 and 72 characters." });
        return;
      }
      if (body.password !== body.confirm_password) {
        sendJson(response, 400, { error: "The new password and confirmation do not match." });
        return;
      }
      const result = await supabaseRequest("/auth/v1/user", {
        method: "PATCH",
        token,
        body: { password: body.password }
      });
      if (!result.response.ok) {
        sendJson(response, result.response.status, {
          error: apiErrorMessage(result.payload, "Password could not be changed.")
        });
        return;
      }
      const audit = await supabaseRequest("/rest/v1/rpc/chowk_record_admin_event", {
        method: "POST",
        token,
        body: {
          event_action: "PASSWORD_CHANGED",
          target_table: "profiles",
          target_record_id: session.identity.id,
          event_data: {
            changed_fields: [
              { field: "password", before: "Not recorded", after: "Changed (secret omitted)" }
            ]
          }
        }
      });
      if (!audit.response.ok) {
        sendJson(response, 502, {
          error: `The password was changed, but its audit event could not be recorded: ${apiErrorMessage(audit.payload, "audit logging failed.")}`
        });
        return;
      }
      sendJson(response, 200, { success: true });
      return;
    }

    sendJson(response, 404, { error: "This admin feature is not implemented in the Supabase edition yet." });
  } catch (error) {
    if (error.statusCode) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }
    console.error("Supabase admin request failed:", error.message);
    sendJson(response, 503, { error: "Admin data service is unavailable. Check Supabase configuration and schema." });
  }
}

async function staffOnboardingRoute(request, response, requestUrl, session) {
  const { token, identity } = session;
  const profilePath = "/rest/v1/staff_onboarding?select=user_id,requested_role,staff_role_id,status,date_of_birth,emergency_contact_name,emergency_contact_relationship,emergency_contact_phone,permanent_address_line1,permanent_address_line2,permanent_address_city,permanent_address_district,permanent_address_state,permanent_address_postal_code,preferred_language,experience_years,experience_summary,profile_photo_path,review_note,submitted_at&user_id=eq.";
  try {
    if (request.method !== "GET" && !isSameOrigin(request)) {
      sendJson(response, 403, { error: "Cross-origin request rejected." });
      return;
    }

    if (requestUrl.pathname === "/api/staff/onboarding" && request.method === "GET") {
      const result = await supabaseRequest(
        `${profilePath}${encodeURIComponent(identity.id)}&limit=1`,
        { token }
      );
      if (!result.response.ok) {
        sendJson(response, result.response.status, {
          error: apiErrorMessage(result.payload, "Your staff invitation could not be loaded.")
        });
        return;
      }
      const onboarding = result.payload?.[0];
      if (!onboarding) {
        sendJson(response, 404, { error: "There is no staff invitation for this account." });
        return;
      }
      const staffRoleResult = onboarding.staff_role_id
        ? await supabaseRequest(
          `/rest/v1/staff_role_definitions?select=id,display_name,duties&id=eq.${encodeURIComponent(onboarding.staff_role_id)}&limit=1`,
          { token }
        )
        : { response: { ok: true }, payload: [] };
      if (!staffRoleResult.response.ok) {
        sendJson(response, staffRoleResult.response.status, {
          error: apiErrorMessage(staffRoleResult.payload, "Your assigned staff job title could not be loaded.")
        });
        return;
      }
      const staffRole = staffRoleResult.payload?.[0] || null;
      onboarding.staff_role_name = staffRole?.display_name || onboarding.requested_role;
      onboarding.staff_role_duties = staffRole?.duties || "";
      const agreementResult = await supabaseRequest(
        `/rest/v1/staff_role_agreement_versions?select=id,role,version,template_content,terms_snapshot,sha256,published_at&role=eq.${encodeURIComponent(onboarding.requested_role)}&status=eq.published&order=published_at.desc&limit=1`,
        { token }
      );
      if (!agreementResult.response.ok) {
        sendJson(response, agreementResult.response.status, {
          error: apiErrorMessage(agreementResult.payload, "The current staff agreement could not be loaded.")
        });
        return;
      }
      const publishedAgreement = agreementResult.payload?.[0] || null;
      const acceptanceResult = publishedAgreement
        ? await supabaseRequest(
          `/rest/v1/staff_role_agreement_acceptances?select=id,agreement_version,agreement_sha256,rendered_content,rendered_sha256,accepted_at&user_id=eq.${encodeURIComponent(identity.id)}&role=eq.${encodeURIComponent(onboarding.requested_role)}&agreement_version_id=eq.${encodeURIComponent(publishedAgreement.id)}&limit=1`,
          { token }
        )
        : { response: { ok: true }, payload: [] };
      if (!acceptanceResult.response.ok) {
        sendJson(response, acceptanceResult.response.status, {
          error: apiErrorMessage(acceptanceResult.payload, "Your agreement acceptance could not be checked.")
        });
        return;
      }
      const acceptance = acceptanceResult.payload?.[0];
      let accepted = false;
      let resolvedAgreement = null;
      if (publishedAgreement
          && ["submitted", "approved_pending_agreement"].includes(onboarding.status)) {
        const profileResult = await supabaseRequest(
          `/rest/v1/profiles?select=full_name,email,phone&id=eq.${encodeURIComponent(identity.id)}&limit=1`,
          { token }
        );
        if (!profileResult.response.ok || !profileResult.payload?.[0]) {
          sendJson(response, profileResult.response.status || 404, {
            error: apiErrorMessage(profileResult.payload, "Your staff profile details could not be loaded for the agreement.")
          });
          return;
        }
        try {
          const resolvedContent = renderStaffAgreement(
            publishedAgreement.template_content,
            publishedAgreement.terms_snapshot || {},
            profileResult.payload[0],
            onboarding
          );
          const renderedSha256 = createHash("sha256").update(resolvedContent, "utf8").digest("hex");
          accepted = Boolean(
            acceptance?.rendered_content === resolvedContent
            && acceptance?.rendered_sha256 === renderedSha256
          );
          resolvedAgreement = {
            ...publishedAgreement,
            template_content: undefined,
            resolved_content: resolvedContent,
            rendered_sha256: renderedSha256
          };
        } catch (error) {
          sendJson(response, 409, { error: error.message });
          return;
        }
      }
      const profilePhotoUrl = onboarding.profile_photo_path
        ? await signedStaffProfilePhotoUrl(onboarding.profile_photo_path, identity.id, token)
        : null;
      sendJson(response, 200, {
        success: true,
        data: {
          ...onboarding,
          email: identity.email,
          full_name: identity.full_name,
          phone: identity.phone,
          profile_photo_url: profilePhotoUrl,
          agreement: resolvedAgreement ? {
            ...resolvedAgreement,
            accepted
          } : null
        }
      });
      return;
    }

    if (requestUrl.pathname === "/api/staff/onboarding/agreement" && request.method === "POST") {
      const body = await readJsonBody(request, maxRequestBodyBytes);
      if (typeof body.agreement_version_id !== "string"
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.agreement_version_id)
          || typeof body.sha256 !== "string"
          || !/^[a-f0-9]{64}$/.test(body.sha256)
          || typeof body.rendered_content !== "string"
          || body.rendered_content.length > 200000
          || typeof body.rendered_sha256 !== "string"
          || !/^[a-f0-9]{64}$/.test(body.rendered_sha256)
          || createHash("sha256").update(body.rendered_content, "utf8").digest("hex") !== body.rendered_sha256) {
        sendJson(response, 400, { error: "Review the current published agreement before accepting it." });
        return;
      }
      const accepted = await supabaseRequest("/rest/v1/rpc/chowk_accept_current_staff_role_agreement", {
        method: "POST",
        token,
        body: {
          target_version: body.agreement_version_id,
          target_sha256: body.sha256,
          target_rendered_content: body.rendered_content,
          target_rendered_sha256: body.rendered_sha256
        }
      });
      sendJson(response, accepted.response.status, accepted.response.ok
        ? { success: true }
        : { error: apiErrorMessage(accepted.payload, "The staff agreement could not be accepted.") });
      return;
    }

    if (requestUrl.pathname === "/api/staff/onboarding/photo" && request.method === "POST") {
      const invitation = await supabaseRequest(
        `${profilePath}${encodeURIComponent(identity.id)}&limit=1`,
        { token }
      );
      const onboarding = invitation.payload?.[0];
      if (!invitation.response.ok || !onboarding
          || !["invited", "changes_requested"].includes(onboarding.status)) {
        sendJson(response, invitation.response.ok ? 409 : invitation.response.status, {
          error: "Your staff profile is not open for photo updates."
        });
        return;
      }
      const body = await readJsonBody(request, 7 * 1024 * 1024);
      const objectPath = await uploadStaffProfilePhoto(body, identity.id, token);
      const signedUrl = await signedStaffProfilePhotoUrl(objectPath, identity.id, token);
      sendJson(response, 201, { success: true, data: { profile_photo_path: objectPath, profile_photo_url: signedUrl } });
      return;
    }

    if (requestUrl.pathname === "/api/staff/onboarding/profile" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (body.profile_confirmed !== true) {
        sendJson(response, 400, { error: "Confirm that your staff profile information is accurate before submitting." });
        return;
      }
      if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 72) {
        sendJson(response, 400, { error: "Set a password between 8 and 72 characters." });
        return;
      }
      if (body.password !== body.confirm_password) {
        sendJson(response, 400, { error: "Password and confirmation do not match." });
        return;
      }
      const requiredProfileFields = [
        ["full_name", 2, 120],
        ["emergency_contact_name", 2, 120],
        ["emergency_contact_relationship", 2, 80],
        ["permanent_address_line1", 2, 160],
        ["permanent_address_city", 2, 100],
        ["permanent_address_district", 2, 100],
        ["permanent_address_state", 2, 100]
      ];
      const profileFieldIsValid = ([field, minimum, maximum]) =>
        typeof body[field] === "string"
        && body[field].trim().length >= minimum
        && body[field].trim().length <= maximum;
      if (!requiredProfileFields.every(profileFieldIsValid)
          || typeof body.phone !== "string"
          || !/^\+?[1-9][0-9]{6,14}$/.test(body.phone.trim())
          || typeof body.emergency_contact_phone !== "string"
          || !/^\+?[1-9][0-9]{6,14}$/.test(body.emergency_contact_phone.trim())
          || typeof body.permanent_address_postal_code !== "string"
          || !/^[0-9]{6}$/.test(body.permanent_address_postal_code.trim())
          || typeof body.permanent_address_line2 !== "string"
          || body.permanent_address_line2.trim().length > 160
          || typeof body.preferred_language !== "string"
          || body.preferred_language.trim().length > 80
          || typeof body.experience_summary !== "string"
          || body.experience_summary.trim().length > 2000
          || (body.experience_years !== "" && body.experience_years !== null
            && (!Number.isFinite(Number(body.experience_years))
              || Number(body.experience_years) < 0 || Number(body.experience_years) > 80))) {
        sendJson(response, 400, { error: "Complete the required staff profile fields with valid values." });
        return;
      }
      const expectedPhotoPath = new RegExp(
        `^staff/${identity.id}/profile/[0-9a-f-]{36}\\.(jpg|png)$`,
        "i"
      );
      if (typeof body.profile_photo_path !== "string"
          || !expectedPhotoPath.test(body.profile_photo_path)) {
        sendJson(response, 400, { error: "Upload a valid profile photo before submitting your profile." });
        return;
      }
      if (body.date_of_birth) {
        const birthDate = typeof body.date_of_birth === "string"
          && /^\d{4}-\d{2}-\d{2}$/.test(body.date_of_birth)
          ? new Date(`${body.date_of_birth}T00:00:00.000Z`)
          : null;
        const today = new Date();
        const earliestBirthDate = new Date(Date.UTC(
          today.getUTCFullYear() - 100, today.getUTCMonth(), today.getUTCDate()
        ));
        if (!birthDate || Number.isNaN(birthDate.getTime())
            || birthDate.toISOString().slice(0, 10) !== body.date_of_birth
            || birthDate > new Date()
            || birthDate < earliestBirthDate) {
          sendJson(response, 400, { error: "Enter a valid date of birth." });
          return;
        }
      }

      const invitation = await supabaseRequest(
        `${profilePath}${encodeURIComponent(identity.id)}&limit=1`,
        { token }
      );
      const onboarding = invitation.payload?.[0];
      if (!invitation.response.ok || !onboarding
          || !["invited", "changes_requested"].includes(onboarding.status)) {
        sendJson(response, invitation.response.ok ? 409 : invitation.response.status, {
          error: "Your staff profile is not open for submission."
        });
        return;
      }

      const passwordUpdate = await supabaseRequest("/auth/v1/user", {
        method: "PUT",
        token,
        body: { password: body.password }
      });
      if (!passwordUpdate.response.ok) {
        sendJson(response, passwordUpdate.response.status, {
          error: apiErrorMessage(passwordUpdate.payload, "Your account password could not be set.")
        });
        return;
      }

      const profileData = {
        full_name: body.full_name,
        phone: body.phone,
        date_of_birth: body.date_of_birth,
        emergency_contact_name: body.emergency_contact_name,
        emergency_contact_relationship: body.emergency_contact_relationship,
        emergency_contact_phone: body.emergency_contact_phone,
        permanent_address_line1: body.permanent_address_line1,
        permanent_address_line2: body.permanent_address_line2,
        permanent_address_city: body.permanent_address_city,
        permanent_address_district: body.permanent_address_district,
        permanent_address_state: body.permanent_address_state,
        permanent_address_postal_code: body.permanent_address_postal_code,
        preferred_language: body.preferred_language,
        experience_years: body.experience_years,
        experience_summary: body.experience_summary,
        profile_photo_path: body.profile_photo_path,
        profile_confirmed: body.profile_confirmed
      };
      const submitted = await supabaseRequest("/rest/v1/rpc/chowk_submit_staff_onboarding", {
        method: "POST",
        token,
        body: { profile_data: profileData }
      });
      if (!submitted.response.ok) {
        sendJson(response, submitted.response.status, {
          error: apiErrorMessage(submitted.payload, "Your staff profile could not be submitted.")
        });
        return;
      }

      let cleanupWarning = "";
      if (onboarding.profile_photo_path
          && onboarding.profile_photo_path !== body.profile_photo_path) {
        const { url, key } = supabaseConfig();
        const encodedPath = onboarding.profile_photo_path.split("/").map(encodeURIComponent).join("/");
        const removed = await fetch(`${url}/storage/v1/object/chowk-staff-profiles/${encodedPath}`, {
          method: "DELETE",
          headers: { apikey: key, Authorization: `****** || key}` },
          signal: AbortSignal.timeout(apiTimeoutMs),
          cache: "no-store"
        });
        if (!removed.ok && removed.status !== 404) {
          const payload = await removed.json().catch(() => ({}));
          cleanupWarning = apiErrorMessage(payload, "The previous profile photo could not be removed.");
          console.error(`Could not remove a replaced staff profile photo for ${identity.id}:`, cleanupWarning);
        }
      }
      sendJson(response, 200, {
        success: true,
        status: "submitted",
        ...(cleanupWarning ? { cleanup_warning: cleanupWarning } : {})
      });
      return;
    }

    sendJson(response, 404, { error: "Staff onboarding endpoint not found." });
  } catch (error) {
    if (error.statusCode) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }
    console.error("Staff onboarding request failed:", error.message);
    sendJson(response, 503, { error: "Staff onboarding is temporarily unavailable." });
  }
}

async function workspaceRoute(request, response, requestUrl, session) {
  const { token, identity } = session;
  try {
    if (request.method !== "GET" && !isSameOrigin(request)) {
      sendJson(response, 403, { error: "Cross-origin request rejected." });
      return;
    }
    const role = identity.role;
    const pathname = requestUrl.pathname;
    const requiredModule = pathname.startsWith("/api/workspace/media") ? "media"
      : pathname.startsWith("/api/workspace/articles") ? "newsroom" : null;
    if (requiredModule && !await organizationModuleEnabled(token, requiredModule)) {
      sendJson(response, 403, { error: "This organization module is disabled." });
      return;
    }
    const requiredPermissions = pathname.startsWith("/api/workspace/articles")
      ? pathname.endsWith("/transition")
        ? ["newsroom.articles.create", "newsroom.articles.edit",
          "newsroom.articles.review", "newsroom.articles.publish",
          "newsroom.articles.reopen"]
        : request.method === "GET" ? ["newsroom.articles.read"]
        : request.method === "POST" && !pathname.endsWith("/transition")
          ? ["newsroom.articles.create"]
          : ["newsroom.articles.edit"]
      : pathname.startsWith("/api/workspace/media") ? ["newsroom.media.manage"] : [];
    const hasOrganizationAdminRole = ["admin", "super_admin"].includes(role);
    if (requiredPermissions.length && !hasOrganizationAdminRole
        && !(await Promise.all(requiredPermissions.map((permission) =>
          userHasOrganizationCapability(token, permission)))).some(Boolean)) {
      sendJson(response, 403, { error: "Your organization access role does not grant this action." });
      return;
    }
    const hasNativeNewsroomRole = ["reporter", "moderator", "editor", "publisher", "admin", "super_admin"].includes(role);
    if (!hasNativeNewsroomRole && !requiredModule
        && !await hasOrganizationAdminAccess(token)) {
      sendJson(response, 403, { error: "A newsroom role is required to access this workspace." });
      return;
    }

    if (requestUrl.pathname === "/api/workspace/media" && request.method === "POST") {
      const mimeType = String(request.headers["content-type"] || "").split(";")[0].toLowerCase();
      const allowedTypes = new Set([
        "image/jpeg", "image/png", "image/webp", "image/avif",
        "video/mp4", "video/webm", "audio/mpeg", "audio/mp4",
        "audio/ogg", "audio/wav"
      ]);
      if (!allowedTypes.has(mimeType)) {
        sendJson(response, 415, { error: "Choose a supported image, video, or audio file." });
        request.resume();
        return;
      }
      const bytes = await readRawBody(request, 25 * 1024 * 1024);
      if (!bytes.length) {
        sendJson(response, 400, { error: "The selected media file is empty." });
        return;
      }
      if (!matchesMediaSignature(mimeType, bytes)) {
        sendJson(response, 415, { error: "The uploaded file content does not match its declared media type." });
        return;
      }
      const { url, key } = supabaseConfig();
      const extensionByType = {
        "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
        "image/avif": ".avif", "video/mp4": ".mp4", "video/webm": ".webm",
        "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/ogg": ".ogg",
        "audio/wav": ".wav"
      };
      const objectPath = `${identity.id}/${randomUUID()}${extensionByType[mimeType]}`;
      const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
      const upload = await fetch(`${url}/storage/v1/object/chowk-newsroom/${encodedPath}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${token}`,
          "Content-Type": mimeType,
          "x-upsert": "false"
        },
        body: bytes,
        signal: AbortSignal.timeout(apiTimeoutMs)
      });
      const payload = await upload.json().catch(() => ({}));
      if (!upload.ok) {
        sendJson(response, upload.status, {
          error: apiErrorMessage(payload, "Media upload failed. Confirm migration 0007 and storage permissions are active.")
        });
        return;
      }
      sendJson(response, 201, {
        success: true,
        data: {
          path: objectPath,
          mime_type: mimeType,
          size: bytes.length
        }
      });
      return;
    }

    if (requestUrl.pathname === "/api/workspace/media" && request.method === "DELETE") {
      const body = await readJsonBody(request);
      const objectPath = typeof body.path === "string" ? body.path : "";
      const ownerPrefix = `${identity.id}/`;
      if (!objectPath.startsWith(ownerPrefix)
          || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|png|webp|avif|mp4|webm|mp3|m4a|ogg|wav)$/.test(objectPath)) {
        sendJson(response, 400, { error: "Choose a media file uploaded by your own account." });
        return;
      }
      const { url, key } = supabaseConfig();
      const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
      const deletion = await fetch(`${url}/storage/v1/object/chowk-newsroom/${encodedPath}`, {
        method: "DELETE",
        headers: { apikey: key, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(apiTimeoutMs)
      });
      const payload = await deletion.json().catch(() => ({}));
      sendJson(response, deletion.ok ? 200 : deletion.status, deletion.ok
        ? { success: true }
        : { error: apiErrorMessage(payload, "Uploaded media could not be removed.") });
      return;
    }

    if (requestUrl.pathname === "/api/workspace/notifications" && request.method === "GET") {
      const result = await supabaseRequest(
        "/rest/v1/user_notifications?select=id,article_id,title,message,action,is_read,created_at&order=created_at.desc&limit=50",
        { token }
      );
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload || [] }
        : { error: apiErrorMessage(result.payload, "Notifications could not be loaded.") });
      return;
    }

    if (requestUrl.pathname === "/api/workspace/notifications/read-all" && request.method === "POST") {
      const result = await supabaseRequest("/rest/v1/user_notifications?is_read=eq.false", {
        method: "PATCH",
        token,
        body: { is_read: true },
        prefer: "return=minimal"
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Notifications could not be marked read.") });
      return;
    }

    const notificationMatch = requestUrl.pathname.match(/^\/api\/workspace\/notifications\/(\d+)\/read$/);
    if (notificationMatch && request.method === "POST") {
      const result = await supabaseRequest(`/rest/v1/user_notifications?id=eq.${notificationMatch[1]}`, {
        method: "PATCH",
        token,
        body: { is_read: true },
        prefer: "return=minimal"
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Notification could not be marked read.") });
      return;
    }

    if (requestUrl.pathname === "/api/workspace/articles" && request.method === "GET") {
      const query = new URLSearchParams({
        select: "id,title,slug,excerpt,content,category_id,image_url,video_url,audio_url,reporting_location_id,author_id,status,workflow_status,submitted_at,workflow_updated_at,review_note,published_at,created_at,updated_at,category:categories(name),author:profiles!articles_author_id_fkey(full_name,email),reporting_location:locations!articles_reporting_location_id_fkey(name,location_type)",
        order: "workflow_updated_at.desc,created_at.desc",
        limit: "200"
      });
      if (role === "reporter") query.set("author_id", `eq.${identity.id}`);
      if (role === "moderator") {
        query.set("workflow_status", "in.(submitted,moderator_review)");
        query.set("or", `(assigned_to.is.null,assigned_to.eq.${identity.id})`);
      }
      if (role === "editor" || role === "publisher") {
        query.set("or", `(author_id.eq.${identity.id},workflow_status.in.(editor_review,scheduled,published,archived))`);
      }
      const [articles, categories, locations] = await Promise.all([
        supabaseRequest(`/rest/v1/articles?${query}`, { token }),
        supabaseRequest("/rest/v1/categories?select=id,name&is_active=eq.true&order=name.asc", { token }),
        supabaseRequest("/rest/v1/rpc/chowk_workspace_locations", { method: "POST", token })
      ]);
      for (const result of [articles, categories, locations]) {
        if (!result.response.ok) {
          sendJson(response, result.response.status, {
            error: apiErrorMessage(result.payload, "Newsroom workspace data could not be loaded.")
          });
          return;
        }
      }
      sendJson(response, 200, { success: true, data: {
        articles: await signArticlesMedia(articles.payload || [], token),
        categories: categories.payload || [],
        locations: locations.payload || []
      } });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/workspace/articles") {
      const body = await readJsonBody(request);
      const result = await supabaseRequest("/rest/v1/rpc/chowk_workspace_create_article", {
        method: "POST",
        token,
        body: {
          article_title: body.title,
          article_slug: body.slug,
          article_excerpt: body.excerpt || "",
          article_content: body.content,
          article_category_id: body.category_id ? Number(body.category_id) : null,
          article_image_url: body.image_url || null,
          article_video_url: body.video_url || null,
          article_audio_url: body.audio_url || null,
          article_reporting_location_id: body.reporting_location_id ? Number(body.reporting_location_id) : null
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, id: result.payload }
        : { error: apiErrorMessage(result.payload, "Story draft could not be created.") });
      return;
    }

    const historyMatch = requestUrl.pathname.match(/^\/api\/workspace\/articles\/(\d+)\/history$/);
    if (historyMatch && request.method === "GET") {
      const articleId = Number(historyMatch[1]);
      const article = await supabaseRequest(
        `/rest/v1/articles?select=id&id=eq.${articleId}&limit=1`,
        { token }
      );
      if (!article.response.ok || !article.payload?.[0]) {
        sendJson(response, article.response.ok ? 404 : article.response.status, {
          error: apiErrorMessage(article.payload, "Story history could not be loaded.")
        });
        return;
      }
      const [events, revisions] = await Promise.all([
        supabaseRequest(`/rest/v1/article_workflow_events?select=id,actor_name,actor_role,action,from_status,to_status,note,created_at&article_id=eq.${articleId}&order=created_at.desc&limit=100`, { token }),
        supabaseRequest(`/rest/v1/article_revisions?select=id,changed_by,title,slug,excerpt,content,category_id,image_url,video_url,audio_url,reporting_location_id,workflow_status,change_reason,created_at&article_id=eq.${articleId}&order=created_at.desc&limit=50`, { token })
      ]);
      for (const result of [events, revisions]) {
        if (!result.response.ok) {
          sendJson(response, result.response.status, {
            error: apiErrorMessage(result.payload, "Story history could not be loaded.")
          });
          return;
        }
      }
      sendJson(response, 200, { success: true, data: {
        events: events.payload || [],
        revisions: revisions.payload || []
      } });
      return;
    }

    const articleMatch = requestUrl.pathname.match(/^\/api\/workspace\/articles\/(\d+)$/);
    if (articleMatch && request.method === "PATCH") {
      const body = await readJsonBody(request);
      const result = await supabaseRequest("/rest/v1/rpc/chowk_workspace_update_article", {
        method: "POST",
        token,
        body: {
          target_article: Number(articleMatch[1]),
          article_title: body.title,
          article_slug: body.slug,
          article_excerpt: body.excerpt || "",
          article_content: body.content,
          article_category_id: body.category_id ? Number(body.category_id) : null,
          article_image_url: body.image_url || null,
          article_video_url: body.video_url || null,
          article_audio_url: body.audio_url || null,
          article_reporting_location_id: body.reporting_location_id ? Number(body.reporting_location_id) : null,
          change_reason: typeof body.change_reason === "string" ? body.change_reason : ""
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Story could not be saved.") });
      return;
    }

    const transitionMatch = requestUrl.pathname.match(/^\/api\/workspace\/articles\/(\d+)\/transition$/);
    if (transitionMatch && request.method === "POST") {
      const body = await readJsonBody(request);
      const actions = ["submit", "withdraw", "restore_withdrawn", "delete_withdrawn",
        "start_review", "send_to_editor", "request_changes", "reject", "publish",
        "schedule", "unschedule", "reopen_rejected", "archive"];
      if (!actions.includes(body.action)) {
        sendJson(response, 400, { error: "Choose a valid newsroom workflow action." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_workspace_transition_article", {
        method: "POST",
        token,
        body: {
          target_article: Number(transitionMatch[1]),
          requested_action: body.action,
          action_note: typeof body.note === "string" ? body.note : "",
          scheduled_for: body.scheduled_for || null
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Story workflow action could not be completed.") });
      return;
    }

    sendJson(response, 404, { error: "Workspace route not found." });
  } catch (error) {
    if (error.statusCode) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }
    console.error("Newsroom workspace request failed:", error.message);
    sendJson(response, 503, { error: "Newsroom workspace service is temporarily unavailable." });
  }
}

function serveStatic(response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(publicDirectory, `.${requestedPath}`);
  if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      const statusCode = error.code === "ENOENT" ? 404 : 500;
      response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(statusCode === 404 ? "Not found" : "Unable to read file");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(content);
  });
}

const server = http.createServer((request, response) => {
  let requestUrl;
  try {
    requestUrl = new URL(request.url, `http://${request.headers.host || host}`);
  } catch {
    sendJson(response, 400, { error: "Invalid request URL." });
    return;
  }

  if (requestUrl.pathname === "/api/articles" && request.method === "GET") {
    void publicArticles(response, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/api/media" && request.method === "GET") {
    void publicMedia(response, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/healthz" && request.method === "GET") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (requestUrl.pathname === "/api/categories" && request.method === "GET") {
    void (async () => {
      try {
        if (!await organizationModuleEnabled(null, "newsroom")) {
          sendJson(response, 404, { error: "The newsroom module is currently disabled." });
          return;
        }
        const result = await supabaseRequest("/rest/v1/categories?select=id,name,slug,icon_key&is_active=eq.true&order=name.asc");
        sendJson(response, result.response.status, result.response.ok
          ? { success: true, data: result.payload }
          : { error: apiErrorMessage(result.payload, "Categories could not be loaded.") });
      } catch (error) {
        console.error("Supabase categories request failed:", error.message);
        sendJson(response, 503, { error: "News categories are unavailable. Check Supabase configuration and schema." });
      }
    })();
    return;
  }

  if ((requestUrl.pathname === "/api/auth/employee-invite/accept"
      || requestUrl.pathname === "/api/auth/staff-invite/accept") && request.method === "POST") {
    void (async () => {
      const invitationType = requestUrl.pathname === "/api/auth/employee-invite/accept"
        ? "employee" : "staff";
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: "Cross-origin request rejected." });
        return;
      }
      try {
        const body = await readJsonBody(request, 16 * 1024);
        if (typeof body.access_token !== "string" || body.access_token.length > 8192
            || typeof body.refresh_token !== "string" || body.refresh_token.length > 8192) {
          sendJson(response, 400, { error: `The ${invitationType} invitation link is invalid or incomplete.` });
          return;
        }
        const identity = await getIdentity(body.access_token);
        if (!identity || identity.role !== "subscriber") {
          sendJson(response, 401, { error: "The invitation could not be verified. Ask an admin to send a new invitation." });
          return;
        }
        const onboarding = await supabaseRequest(
          `/rest/v1/staff_onboarding?select=user_id,status&user_id=eq.${encodeURIComponent(identity.id)}&limit=1`,
          { token: body.access_token }
        );
        const isExistingInvitation = onboarding.response.ok && onboarding.payload?.[0]
          && ["invited", "changes_requested"].includes(onboarding.payload[0].status);
        const hrAssignment = isExistingInvitation ? null : await supabaseRequest(
          `/rest/v1/hr_employee_assignments?select=id,status&employee_id=eq.${encodeURIComponent(identity.id)}&status=eq.pending&limit=1`,
          { token: body.access_token }
        );
        if (!isExistingInvitation && (!hrAssignment?.response.ok || !hrAssignment.payload?.[0])) {
          sendJson(response, 403, { error: `This account does not have an active ${invitationType} invitation.` });
          return;
        }
        setSessionCookies(response, userCookie, body.access_token, body.refresh_token);
        sendJson(response, 200, { success: true });
      } catch (error) {
        if (error.statusCode) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        console.error(`Could not accept ${invitationType} invitation:`, error.message);
        sendJson(response, 503, { error: `The ${invitationType} invitation could not be verified right now.` });
      }
    })();
    return;
  }

  if (requestUrl.pathname === "/api/auth/register" && request.method === "POST") {
    void handleAuth(request, response, true);
    return;
  }

  if (requestUrl.pathname === "/api/auth/login" && request.method === "POST") {
    void handleAuth(request, response, false);
    return;
  }

  if (requestUrl.pathname === "/api/auth/session" && request.method === "GET") {
    getSession(request, response, userCookie).then((session) => {
      if (!session) {
        sendJson(response, 401, { error: "Your session has expired." });
        return;
      }
      sendJson(response, 200, { identity: session.identity });
    }).catch((error) => {
      console.error("Could not verify account session:", error.message);
      sendJson(response, 503, { error: "Account service is temporarily unavailable." });
    });
    return;
  }

  if (requestUrl.pathname === "/api/auth/session" && request.method === "DELETE") {
    void handleLogout(request, response, userCookie);
    return;
  }

  if (requestUrl.pathname.startsWith("/api/staff/onboarding")) {
    void requireUser(request, response).then((session) => {
      if (!session) return;
      void organizationModuleEnabled(session.token, "reporters").then((enabled) => {
        if (!enabled) {
          sendJson(response, 403, { error: "The reporter operations module is disabled." });
          return;
        }
        void staffOnboardingRoute(request, response, requestUrl, session);
      }).catch((error) => {
        console.error("Could not verify staff onboarding module availability:", error.message);
        sendJson(response, 503, { error: "Staff onboarding is temporarily unavailable." });
      });
    });
    return;
  }

  if (requestUrl.pathname === "/api/admin/session" && request.method === "POST") {
    void handleAuth(request, response, false);
    return;
  }

  if (requestUrl.pathname === "/api/admin/session" && request.method === "GET") {
    void requireAdmin(request, response).then((session) => {
      if (!session) return;
      void supabaseRequest("/rest/v1/rpc/chowk_org_my_permissions", {
        method: "POST", token: session.token, body: {}
      }).then((permissions) => {
        if (!permissions.response.ok) {
          sendJson(response, permissions.response.status, {
            error: apiErrorMessage(permissions.payload, "Organization permissions could not be loaded.")
          });
          return;
        }
        sendJson(response, 200, {
          identity: session.identity,
          permissions: Array.isArray(permissions.payload) ? permissions.payload : []
        });
      });
    });
    return;
  }

  if (requestUrl.pathname === "/api/admin/session" && request.method === "DELETE") {
    void handleLogout(request, response, adminCookie);
    return;
  }

  const publicAgreementDocument = requestUrl.pathname.match(
    /^\/api\/reporter\/agreement-documents\/(application|service)\/([0-9a-f-]{36}\.pdf)$/
  );
  if (publicAgreementDocument && request.method === "GET") {
    void (async () => {
      try {
        const kind = publicAgreementDocument[1];
        const objectPath = `${kind}/${publicAgreementDocument[2]}`;
        const agreementSession = await getSession(request, response, userCookie);
        const table = kind === "application"
          ? "reporter_agreement_versions"
          : "reporter_service_agreement_versions";
        const query = new URLSearchParams({
          select: "storage_object_path",
          storage_object_path: `eq.${objectPath}`,
          limit: "1"
        });
        const result = await supabaseRequest(`/rest/v1/${table}?${query}`, {
          token: agreementSession?.token
        });
        if (!result.response.ok) {
          sendJson(response, result.response.status, {
            error: apiErrorMessage(result.payload, "Agreement document could not be loaded.")
          });
          return;
        }
        if (result.payload?.[0]?.storage_object_path !== objectPath) {
          sendJson(response, 404, { error: "This agreement document is not published or linked to an acceptance." });
          return;
        }
        const signedUrl = await signedReporterAgreementPdfUrl(
          objectPath,
          agreementSession?.token,
          requestUrl.searchParams.get("download") === "1"
        );
        response.writeHead(302, { Location: signedUrl, "Cache-Control": "no-store" });
        response.end();
      } catch (error) {
        console.error("Reporter agreement document request failed:", error.message);
        sendJson(response, 503, { error: "The reporter agreement document is temporarily unavailable." });
      }
    })();
    return;
  }

  if (requestUrl.pathname === "/api/reporter/options" && request.method === "GET") {
    void (async () => {
      try {
        const [result, coverageAreas, serviceAgreement] = await Promise.all([
          supabaseRequest("/rest/v1/rpc/chowk_reporter_options"),
          supabaseRequest("/rest/v1/locations?select=id,name,parent_id&location_type=eq.coverage_area&is_active=eq.true&order=name.asc&limit=5000"),
          supabaseRequest("/rest/v1/reporter_service_agreement_versions?select=version,sha256,document_url,template_content&status=eq.published&limit=1")
        ]);
        for (const optionResult of [result, coverageAreas, serviceAgreement]) {
          if (!optionResult.response.ok) {
            sendJson(response, optionResult.response.status, {
              error: apiErrorMessage(optionResult.payload, "Reporter options could not be loaded.")
            });
            return;
          }
        }
        sendJson(response, 200, {
          success: true,
          data: {
            ...Object.fromEntries(Object.entries(result.payload || {})
              .filter(([key]) => key !== "agreement" && key !== "application_agreement")),
            coverage_areas: coverageAreas.payload || [],
            service_agreement: serviceAgreement.payload?.[0] || result.payload?.service_agreement
          }
        });
      } catch (error) {
        console.error("Reporter options request failed:", error.message);
        sendJson(response, 503, { error: "Reporter application options are unavailable." });
      }
    })();
    return;
  }

  const credentialVerification = requestUrl.pathname.match(/^\/api\/reporter\/verify\/([a-f0-9]{64})$/);
  if (credentialVerification && request.method === "GET") {
    void (async () => {
      try {
        const result = await supabaseRequest("/rest/v1/rpc/chowk_verify_staff_credential", {
          method: "POST",
          body: { verification_code: credentialVerification[1] }
        });
        if (!result.response.ok) {
          sendJson(response, result.response.status, {
            error: apiErrorMessage(result.payload, "Credential verification failed.")
          });
          return;
        }
        if (!result.payload) {
          sendJson(response, 404, { error: "No matching Chowk credential was found." });
          return;
        }
        sendJson(response, 200, { success: true, data: result.payload });
      } catch (error) {
        console.error("Credential verification request failed:", error.message);
        sendJson(response, 503, { error: "Credential verification is unavailable." });
      }
    })();
    return;
  }

  if (requestUrl.pathname.startsWith("/api/reporter/")) {
    void requireUser(request, response).then((session) => {
      if (!session) return;
      const requiredModule = requestUrl.pathname.includes("staff-agreement") ? "agreements" : "reporters";
      void organizationModuleEnabled(session.token, requiredModule).then((enabled) => {
        if (!enabled) {
          sendJson(response, 403, { error: "This organization module is disabled." });
          return;
        }
      if (request.method !== "GET" && !isSameOrigin(request)) {
        sendJson(response, 403, { error: "Cross-origin request rejected." });
        return;
      }
      if ([
        "/api/reporter/agreement-preview",
        "/api/reporter/agreement-accepted-document",
        "/api/reporter/agreement/accept"
      ].includes(requestUrl.pathname)) {
        sendJson(response, 410, {
          error: "Application agreements are no longer used. Your service agreement will be issued after application approval."
        });
        return;
      }
      void (async () => {
        try {
          const reporterPrint = requestUrl.pathname.match(/^\/api\/reporter\/credentials\/(\d+)\/print$/);
          if (reporterPrint && request.method === "GET") {
            const result = await supabaseRequest("/rest/v1/rpc/chowk_reporter_status", {
              method: "POST",
              token: session.token
            });
            if (!result.response.ok) {
              sendJson(response, result.response.status, {
                error: apiErrorMessage(result.payload, "Credential could not be loaded for printing.")
              });
              return;
            }
            const credential = (result.payload?.credentials || []).find((item) =>
              String(item.id) === reporterPrint[1]
                && ["active", "pending_acceptance"].includes(item.status)
            );
            if (!credential) {
              sendJson(response, 404, { error: "An active or pending credential for this account was not found." });
              return;
            }
            const html = await renderVerifiedCredentialPrintPage(credential, request);
            response.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
              "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
              "X-Content-Type-Options": "nosniff"
            });
            response.end(html);
            return;
          }
          if (requestUrl.pathname === "/api/reporter/status" && request.method === "GET") {
            const result = await supabaseRequest("/rest/v1/rpc/chowk_reporter_status", {
              method: "POST",
              token: session.token
            });
            if (!result.response.ok) {
              sendJson(response, result.response.status, {
                error: apiErrorMessage(result.payload, "Reporter status could not be loaded.")
              });
              return;
            }
            let data = result.payload;
            if (data?.application) {
              const application = { ...data.application };
              Object.keys(application).forEach((key) => {
                if (key.startsWith("agreement_") || key === "acceptances") delete application[key];
              });
              data = { ...data, application };
            }
            const applicationId = data?.application?.id;
            if (applicationId) {
              const [privateDetails, documents, reviewRequests, serviceAcceptances, serviceIssue] = await Promise.all([
                supabaseRequest(
                  `/rest/v1/reporter_application_private_details?select=mobile_number,date_of_birth,emergency_contact_name,emergency_contact_relationship,emergency_contact_phone,father_first_name,father_last_name,permanent_address_line1,permanent_address_line2,permanent_address_city,permanent_address_district,permanent_address_state,permanent_address_postal_code,blood_group,masked_aadhaar_confirmed,document_processing_consent,preferred_language,coverage_localities,coverage_area_id,experience_years,experience_summary,availability,bank_account_holder,bank_name,bank_account_number,bank_ifsc&application_id=eq.${encodeURIComponent(applicationId)}&limit=1`,
                  { token: session.token }
                ),
                supabaseRequest(
                  `/rest/v1/reporter_application_documents?select=document_type,storage_path,mime_type,sha256&application_id=eq.${encodeURIComponent(applicationId)}&user_id=eq.${encodeURIComponent(session.identity.id)}&order=document_type.asc`,
                  { token: session.token }
                ),
                supabaseRequest(
                  `/rest/v1/reporter_applications?select=review_requests&id=eq.${encodeURIComponent(applicationId)}&user_id=eq.${encodeURIComponent(session.identity.id)}&limit=1`,
                  { token: session.token }
                ),
                supabaseRequest(
                  `/rest/v1/reporter_service_agreement_acceptances?select=id,issue_id,agreement_version,agreement_sha256,generated_document_sha256,document_storage_path,signer_name,acceptance_statement,accepted_at&application_id=eq.${encodeURIComponent(applicationId)}&user_id=eq.${encodeURIComponent(session.identity.id)}&order=accepted_at.desc`,
                  { token: session.token }
                ),
                supabaseRequest(
                  `/rest/v1/reporter_service_agreement_issues?select=id,agreement_version,agreement_sha256,document_storage_path,document_sha256,status,published_at&application_id=eq.${encodeURIComponent(applicationId)}&user_id=eq.${encodeURIComponent(session.identity.id)}&status=eq.published&limit=1`,
                  { token: session.token }
                )
              ]);
              for (const result of [privateDetails, documents, reviewRequests, serviceAcceptances, serviceIssue]) {
                if (!result.response.ok) {
                  sendJson(response, result.response.status, {
                    error: apiErrorMessage(result.payload, "Reporter application details could not be loaded.")
                  });
                  return;
                }
              }
              if (!Array.isArray(reviewRequests.payload) || !reviewRequests.payload[0]
                  || !Array.isArray(reviewRequests.payload[0].review_requests)) {
                sendJson(response, 500, { error: "Reporter review requests could not be loaded." });
                return;
              }
              data = {
                ...data,
                application: {
                  ...data.application,
                  private_details: privateDetails.payload?.[0] || {},
                  documents: documents.payload || [],
                  review_requests: reviewRequests.payload[0].review_requests,
                  service_acceptances: serviceAcceptances.payload || [],
                  service_agreement_issue: serviceIssue.payload?.[0] || null
                }
              };
            }
            sendJson(response, 200, { success: true, data });
            return;
          }
          if (requestUrl.pathname === "/api/reporter/application-documents" && request.method === "POST") {
            const body = await readJsonBody(request, 7 * 1024 * 1024);
            const document = await uploadReporterApplicationDocument(
              body,
              session.identity.id,
              session.token
            );
            sendJson(response, 201, { success: true, data: document });
            return;
          }
          if (requestUrl.pathname === "/api/reporter/application-documents" && request.method === "DELETE") {
            const body = await readJsonBody(request);
            await removeReporterApplicationDocument(body.storage_path, session.identity.id, session.token);
            sendJson(response, 200, { success: true });
            return;
          }
          if (requestUrl.pathname === "/api/reporter/agreement-preview" && request.method === "GET") {
            const stateId = requestUrl.searchParams.get("state_id");
            const rtoId = requestUrl.searchParams.get("rto_office_id");
            const context = await reporterAgreementContext(session, {
              stateId: stateId ? Number(stateId) : undefined,
              rtoId: rtoId ? Number(rtoId) : undefined
            });
            const pdf = await createReporterAgreementPdf(
              context.agreement.template_content,
              context.tokens
            );
            sendPdf(
              response,
              pdf,
              `reporter-engagement-agreement-${context.agreement.version}.pdf`,
              requestUrl.searchParams.get("download") === "1"
            );
            return;
          }
          if (requestUrl.pathname === "/api/reporter/agreement-accepted-document" && request.method === "GET") {
            const acceptanceId = requestUrl.searchParams.get("acceptance_id");
            if (acceptanceId !== null && !/^\d+$/.test(acceptanceId)) {
              sendJson(response, 400, { error: "The accepted agreement reference is invalid." });
              return;
            }
            const query = new URLSearchParams({
              select: "document_storage_path",
              user_id: `eq.${session.identity.id}`,
              document_storage_path: "not.is.null",
              limit: "1"
            });
            if (acceptanceId === null) query.set("order", "accepted_at.desc,id.desc");
            else query.set("id", `eq.${acceptanceId}`);
            const receipt = await supabaseRequest(
              `/rest/v1/reporter_agreement_acceptances?${query}`,
              { token: session.token }
            );
            if (!receipt.response.ok) {
              sendJson(response, receipt.response.status, {
                error: apiErrorMessage(receipt.payload, "Accepted agreement document could not be loaded.")
              });
              return;
            }
            const documentPath = receipt.payload?.[0]?.document_storage_path;
            if (!documentPath) {
              sendJson(response, 404, { error: "No generated agreement copy is recorded for this account." });
              return;
            }
            const signedUrl = await signedReporterAgreementPdfUrl(
              documentPath,
              session.token,
              requestUrl.searchParams.get("download") === "1"
            );
            response.writeHead(302, { Location: signedUrl, "Cache-Control": "no-store" });
            response.end();
            return;
          }
          if (requestUrl.pathname === "/api/reporter/staff-agreement" && request.method === "GET") {
            const status = await supabaseRequest("/rest/v1/rpc/chowk_reporter_status", {
              method: "POST",
              token: session.token
            });
            if (!status.response.ok) {
              sendJson(response, status.response.status, {
                error: apiErrorMessage(status.payload, "Reporter status could not be loaded.")
              });
              return;
            }
            const application = status.payload?.application;
            if (!application || !["approved", "active"].includes(application.status)) {
              sendJson(response, 403, { error: "Only an approved reporter can review the staff agreement." });
              return;
            }
            const [agreementResult, profileResult, acceptanceResult] = await Promise.all([
              supabaseRequest("/rest/v1/staff_role_agreement_versions?select=id,role,version,template_content,terms_snapshot,sha256,published_at&role=eq.reporter&status=eq.published&order=published_at.desc&limit=1", { token: session.token }),
              supabaseRequest(`/rest/v1/profiles?select=full_name,email,phone&id=eq.${encodeURIComponent(session.identity.id)}&limit=1`, { token: session.token }),
              supabaseRequest(`/rest/v1/staff_role_agreement_acceptances?select=id,agreement_version_id,agreement_version,agreement_sha256,rendered_content,rendered_sha256,accepted_at&user_id=eq.${encodeURIComponent(session.identity.id)}&role=eq.reporter&order=accepted_at.desc&limit=1`, { token: session.token })
            ]);
            for (const result of [agreementResult, profileResult, acceptanceResult]) {
              if (!result.response.ok) {
                sendJson(response, result.response.status, {
                  error: apiErrorMessage(result.payload, "The Reporter staff agreement could not be loaded.")
                });
                return;
              }
            }
            const agreement = agreementResult.payload?.[0];
            if (!agreement) {
              sendJson(response, 404, { error: "No Reporter staff agreement is published yet." });
              return;
            }
            const profile = profileResult.payload?.[0];
            if (!profile) {
              sendJson(response, 404, { error: "Your reporter profile could not be loaded." });
              return;
            }
            try {
              const resolvedContent = renderStaffAgreement(
                agreement.template_content,
                agreement.terms_snapshot || {},
                profile,
                { requested_role: "reporter" }
              );
              const renderedSha256 = createHash("sha256").update(resolvedContent, "utf8").digest("hex");
              const acceptance = (acceptanceResult.payload || []).find((item) =>
                item.agreement_version_id === agreement.id
                && item.rendered_content === resolvedContent
                && item.rendered_sha256 === renderedSha256
              );
              sendJson(response, 200, {
                success: true,
                data: {
                  agreement: {
                    id: agreement.id,
                    version: agreement.version,
                    sha256: agreement.sha256,
                    published_at: agreement.published_at,
                    resolved_content: resolvedContent,
                    rendered_sha256: renderedSha256,
                    accepted: Boolean(acceptance),
                    accepted_at: acceptance?.accepted_at || null
                  }
                }
              });
            } catch (error) {
              sendJson(response, 409, { error: error.message });
            }
            return;
          }
          if (requestUrl.pathname === "/api/reporter/staff-agreement/accept" && request.method === "POST") {
            const body = await readJsonBody(request);
            if (typeof body.agreement_version_id !== "string"
                || typeof body.sha256 !== "string"
                || typeof body.rendered_content !== "string"
                || typeof body.rendered_sha256 !== "string"
                || createHash("sha256").update(body.rendered_content, "utf8").digest("hex") !== body.rendered_sha256) {
              sendJson(response, 400, { error: "Review the current Reporter agreement before accepting it." });
              return;
            }
            const accepted = await supabaseRequest("/rest/v1/rpc/chowk_accept_current_reporter_staff_role_agreement", {
              method: "POST",
              token: session.token,
              body: {
                target_version: body.agreement_version_id,
                target_sha256: body.sha256,
                target_rendered_content: body.rendered_content,
                target_rendered_sha256: body.rendered_sha256
              }
            });
            sendJson(response, accepted.response.status, accepted.response.ok
              ? { success: true }
              : { error: apiErrorMessage(accepted.payload, "The Reporter staff agreement could not be accepted.") });
            return;
          }
          const acknowledgement = requestUrl.pathname.match(/^\/api\/reporter\/credentials\/(\d+)\/acknowledge$/);
          if (acknowledgement && request.method === "POST") {
            const body = await readJsonBody(request);
            const result = await supabaseRequest("/rest/v1/rpc/chowk_reporter_acknowledge_credential", {
              method: "POST",
              token: session.token,
              body: { target_credential: Number(acknowledgement[1]), typed_name: body.typed_name }
            });
            sendJson(response, result.response.status, result.response.ok
              ? { success: true }
              : { error: apiErrorMessage(result.payload, "Credential acknowledgement failed.") });
            return;
          }
          sendJson(response, 404, { error: "Reporter route not found." });
        } catch (error) {
          if (error.statusCode) {
            sendJson(response, error.statusCode, { error: error.message });
            return;
          }
          console.error("Reporter API request failed:", error.message);
          sendJson(response, 503, { error: "Reporter service is temporarily unavailable." });
        }
      })();
      }).catch((error) => {
        console.error("Could not verify reporter module availability:", error.message);
        sendJson(response, 503, { error: "Reporter services are temporarily unavailable." });
      });
    });
    return;
  }

  if (requestUrl.pathname.startsWith("/api/workspace/")) {
    void requireUser(request, response, userCookie).then((session) => {
      if (session) void workspaceRoute(request, response, requestUrl, session);
    });
    return;
  }

  if (requestUrl.pathname.startsWith("/api/organization/workflows")) {
    void requireUser(request, response).then((session) => {
      if (session) void organizationWorkflowsRoute(request, response, requestUrl, session);
    });
    return;
  }

  const employeeModelPath = requestUrl.pathname.replace(/^\/api\/staff\//, "/api/employee/");
  if (employeeModelPath.startsWith("/api/employee/org-models")
      || employeeModelPath.startsWith("/api/employee/org-model-records/")) {
    void requireUser(request, response).then((session) => {
      if (!session) return;
      void (async () => {
        if (request.method !== "GET" && !isSameOrigin(request)) {
          sendJson(response, 403, { error: "Cross-origin request rejected." });
          return;
        }
        if (!await organizationModuleEnabled(session.token, "organization-models")) {
          sendJson(response, 403, { error: "Organization data models are disabled." });
          return;
        }
        if (employeeModelPath === "/api/employee/org-models" && request.method === "GET") {
          const result = await supabaseRequest("/rest/v1/rpc/chowk_org_model_snapshot", {
            method: "POST", token: session.token, body: {}
          });
          sendJson(response, result.response.status, result.response.ok
            ? { success: true, data: result.payload }
            : { error: apiErrorMessage(result.payload, "Organization models could not be loaded.") });
          return;
        }
        const recordsRoute = employeeModelPath.match(
          /^\/api\/employee\/org-models\/([0-9a-f-]{36})\/records$/i
        );
        if (recordsRoute && request.method === "GET") {
          const limit = Number(requestUrl.searchParams.get("limit") || 50);
          const offset = Number(requestUrl.searchParams.get("offset") || 0);
          if (!Number.isInteger(limit) || !Number.isInteger(offset)) {
            sendJson(response, 400, { error: "Use whole-number record page values." });
            return;
          }
          const result = await supabaseRequest("/rest/v1/rpc/chowk_org_model_list_records", {
            method: "POST",
            token: session.token,
            body: {
              target_model: recordsRoute[1],
              target_limit: limit,
              target_offset: offset
            }
          });
          sendJson(response, result.response.status, result.response.ok
            ? { success: true, data: result.payload || [] }
            : { error: apiErrorMessage(result.payload, "Model records could not be loaded.") });
          return;
        }
        if (recordsRoute && request.method === "POST") {
          const body = await readJsonBody(request);
          const result = await supabaseRequest("/rest/v1/rpc/chowk_org_model_save_record", {
            method: "POST",
            token: session.token,
            body: {
              target_model: recordsRoute[1],
              target_id: null,
              target_data: body.data,
              target_revision: null
            }
          });
          sendJson(response, result.response.status, result.response.ok
            ? { success: true, data: result.payload }
            : { error: apiErrorMessage(result.payload, "The model record could not be created.") });
          return;
        }
        const historyRoute = employeeModelPath.match(
          /^\/api\/employee\/org-model-records\/([0-9a-f-]{36})\/history$/i
        );
        if (historyRoute && request.method === "GET") {
          const result = await supabaseRequest("/rest/v1/rpc/chowk_org_model_record_history", {
            method: "POST",
            token: session.token,
            body: { target_record: historyRoute[1] }
          });
          sendJson(response, result.response.status, result.response.ok
            ? { success: true, data: result.payload || [] }
            : { error: apiErrorMessage(result.payload, "Record history could not be loaded.") });
          return;
        }
        const transitionRoute = employeeModelPath.match(
          /^\/api\/employee\/org-model-records\/([0-9a-f-]{36})\/transitions$/i
        );
        if (transitionRoute && request.method === "POST") {
          const body = await readJsonBody(request);
          const result = await supabaseRequest("/rest/v1/rpc/chowk_org_model_transition_record", {
            method: "POST",
            token: session.token,
            body: {
              target_record: transitionRoute[1],
              target_transition: body.transition_id,
              target_revision: body.revision
            }
          });
          sendJson(response, result.response.status, result.response.ok
            ? { success: true }
            : { error: apiErrorMessage(result.payload, "The workflow action could not be completed.") });
          return;
        }
        const recordRoute = employeeModelPath.match(
          /^\/api\/employee\/org-model-records\/([0-9a-f-]{36})$/i
        );
        if (recordRoute && request.method === "PATCH") {
          const body = await readJsonBody(request);
          const result = await supabaseRequest("/rest/v1/rpc/chowk_org_model_save_record", {
            method: "POST",
            token: session.token,
            body: {
              target_model: body.model_id,
              target_id: recordRoute[1],
              target_data: body.data,
              target_revision: body.revision
            }
          });
          sendJson(response, result.response.status, result.response.ok
            ? { success: true, data: result.payload }
            : { error: apiErrorMessage(result.payload, "The model record could not be saved.") });
          return;
        }
        if (recordRoute && request.method === "DELETE") {
          const result = await supabaseRequest("/rest/v1/rpc/chowk_org_model_delete_record", {
            method: "POST",
            token: session.token,
            body: { target_record: recordRoute[1] }
          });
          sendJson(response, result.response.status, result.response.ok
            ? { success: true }
            : { error: apiErrorMessage(result.payload, "The model record could not be deleted.") });
          return;
        }
        sendJson(response, 404, { error: "Organization model route not found." });
      })().catch((error) => {
        console.error("Organization model request failed:", error.message);
        sendJson(response, 503, { error: "Organization model service is temporarily unavailable." });
      });
    });
    return;
  }

  const employeePolicyPath = requestUrl.pathname.replace(
    "/api/staff/hr-policies", "/api/employee/hr-policies"
  );
  if (employeePolicyPath.startsWith("/api/employee/hr-policies")) {
    void requireUser(request, response).then((session) => {
      if (!session) return;
      void (async () => {
        if (request.method !== "GET" && !isSameOrigin(request)) {
          sendJson(response, 403, { error: "Cross-origin request rejected." });
          return;
        }
        if (!await organizationModuleEnabled(session.token, "human-resources")) {
          sendJson(response, 403, { error: "The human resources module is disabled." });
          return;
        }
        if (employeePolicyPath === "/api/employee/hr-policies" && request.method === "GET") {
          const policies = await supabaseRequest("/rest/v1/rpc/chowk_hr_current_policies", {
            method: "POST",
            token: session.token,
            body: {}
          });
          sendJson(response, policies.response.status, policies.response.ok
            ? { success: true, data: policies.payload || [] }
            : { error: apiErrorMessage(policies.payload, "Required HR policies could not be loaded.") });
          return;
        }
        if (employeePolicyPath === "/api/employee/hr-policies/accept" && request.method === "POST") {
          const body = await readJsonBody(request);
          if (typeof body.policy_version_id !== "string"
              || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.policy_version_id)) {
            sendJson(response, 400, { error: "Choose a valid published policy version." });
            return;
          }
          const result = await supabaseRequest("/rest/v1/rpc/chowk_hr_accept_current_policy", {
            method: "POST",
            token: session.token,
            body: { target_version_id: body.policy_version_id }
          });
          sendJson(response, result.response.status, result.response.ok
            ? { success: true }
            : { error: apiErrorMessage(result.payload, "Policy acceptance could not be recorded.") });
          return;
        }
        sendJson(response, 404, { error: "HR policy route not found." });
      })().catch((error) => {
        console.error("Employee HR policy request failed:", error.message);
        sendJson(response, 503, { error: "HR policies are temporarily unavailable." });
      });
    });
    return;
  }

  const employeeProfilePath = requestUrl.pathname.replace(
    "/api/staff/hr-profile", "/api/employee/hr-profile"
  );
  if (employeeProfilePath.startsWith("/api/employee/hr-profile")) {
    void requireUser(request, response).then((session) => {
      if (!session) return;
      void (async () => {
        if (request.method !== "GET" && !isSameOrigin(request)) {
          sendJson(response, 403, { error: "Cross-origin request rejected." });
          return;
        }
        if (!await organizationModuleEnabled(session.token, "human-resources")) {
          sendJson(response, 403, { error: "The human resources module is disabled." });
          return;
        }
        if (employeeProfilePath === "/api/employee/hr-profile" && request.method === "GET") {
          sendJson(response, 200, {
            success: true,
            data: {
              full_name: session.identity.full_name || "",
              email: session.identity.email || "",
              phone: session.identity.phone || ""
            }
          });
          return;
        }
        if (employeeProfilePath === "/api/employee/hr-profile" && request.method === "PATCH") {
          const body = await readJsonBody(request);
          const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
          const phone = typeof body.phone === "string" ? body.phone.trim() : "";
          if (fullName.length < 2 || fullName.length > 120
              || (phone && !/^\+?[1-9][0-9]{6,14}$/.test(phone))) {
            sendJson(response, 400, { error: "Enter a full name and a valid phone number." });
            return;
          }
          const updated = await supabaseRequest(
            `/rest/v1/profiles?id=eq.${encodeURIComponent(session.identity.id)}`,
            {
              method: "PATCH",
              token: session.token,
              body: { full_name: fullName, phone: phone || null },
              prefer: "return=representation"
            }
          );
          sendJson(response, updated.response.status, updated.response.ok
            ? { success: true, data: updated.payload?.[0] || null }
            : { error: apiErrorMessage(updated.payload, "Your HR profile could not be saved.") });
          return;
        }
        sendJson(response, 404, { error: "HR profile route not found." });
      })().catch((error) => {
        console.error("Employee HR profile request failed:", error.message);
        sendJson(response, 503, { error: "HR profile service is temporarily unavailable." });
      });
    });
    return;
  }

  if (requestUrl.pathname.startsWith("/api/admin/")) {
    void requireAdmin(request, response).then((session) => {
      if (session) {
        const forwardedAddress = request.headers["x-forwarded-for"]?.split(",")[0].trim();
        const clientAddress = request.headers["x-real-ip"] || forwardedAddress || request.socket.remoteAddress || "";
        requestContext.run({
          requestId: randomUUID(),
          ipAddress: String(clientAddress).slice(0, 64),
          userAgent: String(request.headers["user-agent"] || "").slice(0, 500)
        }, () => {
          void adminRoute(request, response, requestUrl, session).catch((error) => {
            console.error("Admin API request failed:", error.message);
            if (response.headersSent) {
              if (!response.writableEnded) response.destroy();
              return;
            }
            const statusCode = Number.isInteger(error.statusCode)
              && error.statusCode >= 400
              && error.statusCode <= 599
              ? error.statusCode
              : 503;
            sendJson(response, statusCode, {
              error: error.statusCode
                ? error.message
                : "The admin request failed unexpectedly. Please retry; contact support if it continues."
            });
          });
        });
      }
    });
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "API route not found." });
    return;
  }

  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" });
    response.end("Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400);
    response.end("Invalid path");
    return;
  }
  if (pathname === "/admin-dashboard.html") {
    response.writeHead(302, { Location: "/admin/dashboard", "Cache-Control": "no-store" });
    response.end();
    return;
  }
  if (pathname === "/admin/dashboard") {
    void getSession(request, response, adminCookie).then(async (session) => {
      if (!session || (!["admin", "super_admin"].includes(session.identity.role)
          && !await hasOrganizationAdminAccess(session.token))) {
        clearSessionCookies(response, adminCookie);
        response.writeHead(302, { Location: "/admin", "Cache-Control": "no-store" });
        response.end();
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      serveStatic(response, "/admin-dashboard.html");
    }).catch((error) => {
      console.error("Could not verify admin page access:", error.message);
      sendJson(response, 503, { error: "Admin service is temporarily unavailable." });
    });
    return;
  }
  if (pathname === "/admin") {
    getSession(request, response, adminCookie).then(async (session) => {
      if (session && (["admin", "super_admin"].includes(session.identity.role)
          || await hasOrganizationAdminAccess(session.token))) {
        response.writeHead(302, { Location: "/admin/dashboard", "Cache-Control": "no-store" });
        response.end();
      } else {
        clearSessionCookies(response, adminCookie);
        serveStatic(response, "/admin.html");
      }
    }).catch((error) => {
      console.error("Could not verify admin sign-in page access:", error.message);
      serveStatic(response, "/admin.html");
    }).catch((error) => {
      console.error("Could not verify admin page access:", error.message);
      serveStatic(response, "/admin.html");
    });
    return;
  }
  if (pathname === "/organization") {
    void getSession(request, response, userCookie).then((session) => {
      if (!session) {
        response.writeHead(302, {
          Location: "/auth?mode=login&next=%2Forganization",
          "Cache-Control": "no-store"
        });
        response.end();
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      serveStatic(response, "/organization-workspace.html");
    }).catch((error) => {
      console.error("Could not verify organization workspace access:", error.message);
      sendJson(response, 503, { error: "Organization workspace is temporarily unavailable." });
    });
    return;
  }
  if (pathname === "/organization-workflows") {
    void getSession(request, response, userCookie).then((session) => {
      if (!session) {
        response.writeHead(302, {
          Location: "/auth?mode=login&next=%2Forganization-workflows",
          "Cache-Control": "no-store"
        });
        response.end();
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      serveStatic(response, "/organization-workflows.html");
    }).catch((error) => {
      console.error("Could not verify organization workflow access:", error.message);
      sendJson(response, 503, { error: "Organization workflow service is temporarily unavailable." });
    });
    return;
  }
  if (pathname === "/employee-policies" || pathname === "/hr-policies") {
    void getSession(request, response, userCookie).then((session) => {
      if (!session) {
        response.writeHead(302, {
          Location: "/auth?mode=login&next=%2Femployee-policies",
          "Cache-Control": "no-store"
        });
        response.end();
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      serveStatic(response, "/hr-policies.html");
    }).catch((error) => {
      console.error("Could not verify employee policy access:", error.message);
      sendJson(response, 503, { error: "Organization policy service is temporarily unavailable." });
    });
    return;
  }
  if (pathname === "/workspace") {
    void getSession(request, response, userCookie).then((session) => {
      if (!session) {
        response.writeHead(302, { Location: "/auth?mode=login&next=%2Fworkspace", "Cache-Control": "no-store" });
        response.end();
        return;
      }
      if (["admin", "super_admin"].includes(session.identity.role)) {
        response.writeHead(302, { Location: "/admin/dashboard", "Cache-Control": "no-store" });
        response.end();
        return;
      }
      if (!["reporter", "moderator", "editor", "publisher"].includes(session.identity.role)) {
        response.writeHead(302, { Location: "/reporter", "Cache-Control": "no-store" });
        response.end();
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      serveStatic(response, "/workspace.html");
    }).catch((error) => {
      console.error("Could not verify newsroom workspace access:", error.message);
      sendJson(response, 503, { error: "Newsroom workspace is temporarily unavailable." });
    });
    return;
  }
  if (pathname === "/staff-onboarding") {
    response.setHeader("Cache-Control", "no-store");
    serveStatic(response, "/staff-onboarding.html");
    return;
  }
  const staticPath = {
    "/auth": "/auth.html",
    "/reporter": "/reporter.html",
    "/credential": "/credential.html",
    "/chowk-patrika": "/media.html",
    "/chowk-charcha": "/media.html",
    "/podcasts": "/media.html",
    "/legal": "/legal.html",
    "/legal/terms-of-use": "/legal.html",
    "/legal/privacy-policy": "/legal.html",
    "/legal/corrections-takedown-grievance": "/legal.html"
  }[pathname] || pathname;
  serveStatic(response, staticPath);
});

server.listen(port, host, () => {
  console.log(`Chowk News is running on ${host}:${port}`);
});
