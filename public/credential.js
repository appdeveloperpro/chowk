const resultPanel = document.querySelector("#credential-result");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

function displayError(message) {
  resultPanel.replaceChildren(
    element("span", "reporter-status-pill revoked", "Not verified"),
    element("h2", "", "Credential could not be verified"),
    element("p", "reporter-card-copy", message)
  );
}

async function loadCredential() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  if (!/^[a-f0-9]{64}$/.test(token)) {
    displayError("This verification link is invalid or incomplete.");
    return;
  }

  try {
    const response = await fetch(`/api/reporter/verify/${encodeURIComponent(token)}`, {
      cache: "no-store"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Verification service is unavailable.");
    const credential = result.data;
    const status = element(
      "span",
      `reporter-status-pill ${credential.status}`,
      credential.status.replaceAll("_", " ")
    );
    const details = element("div", "reporter-data-grid");
    [
      ["Credential type", credential.credential_type.replaceAll("_", " ")],
      ["Reference", credential.reference_code],
      ["Name", credential.name],
      ["Role", credential.role.replaceAll("_", " ")],
      ["Reporter ID", credential.reporter_code || "Not applicable"],
      ["Coverage", [
        credential.scope?.state_name,
        credential.scope?.rto_code,
        credential.scope?.city_name
      ].filter(Boolean).join(" · ") || "Not specified"],
      ["Valid from", formatDate(credential.valid_from)],
      ["Valid until", formatDate(credential.valid_until)]
    ].forEach(([label, value]) => {
      const item = element("div", "reporter-data-item");
      item.append(element("span", "", label), element("strong", "", value || "—"));
      details.append(item);
    });
    resultPanel.replaceChildren(
      element("span", "reporter-eyebrow", "VERIFICATION RESULT"),
      status,
      element("h2", "", credential.status === "active" ? "Credential is active" : "Credential record found"),
      details,
      element("p", "reporter-card-copy", "This lookup shows the status currently recorded in Chowk's development system. Contact Chowk through an independently verified channel if you need additional confirmation.")
    );
  } catch (error) {
    displayError(error instanceof Error ? error.message : "Verification service is unavailable.");
  }
}

loadCredential();
