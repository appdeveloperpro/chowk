const fs = require("node:fs");
const path = require("node:path");
const PDFDocument = require("pdfkit");

const tokenValues = new Set([
  "agreement.date",
  "company.entity_type",
  "company.legal_name",
  "company.registered_address",
  "company.registration_number",
  "company.trade_name",
  "reporter.city",
  "reporter.email",
  "reporter.full_name",
  "reporter.phone",
  "reporter.reporter_code",
  "reporter.rto",
  "reporter.state",
  "reporter.designation",
  "reporter.type",
  "reporter.father_first_name",
  "reporter.father_last_name",
  "reporter.permanent_address",
  "reporter.permanent_address_line1",
  "reporter.permanent_address_line2",
  "reporter.permanent_address_city",
  "reporter.permanent_address_district",
  "reporter.permanent_address_state",
  "reporter.permanent_address_postal_code",
  "reporter.date_of_birth",
  "reporter.mobile_number"
]);
const serviceTokenValues = new Set([
  ...[...tokenValues].filter((token) => token !== "reporter.type"),
  "reporter.coverage_area",
  "reporter.district",
  "company.official_email",
  "company.official_phone",
  "company.website_url",
  "reporter.father_first_name",
  "reporter.father_last_name",
  "reporter.permanent_address",
  "reporter.permanent_address_line1",
  "reporter.permanent_address_line2",
  "reporter.permanent_address_city",
  "reporter.permanent_address_district",
  "reporter.permanent_address_state",
  "reporter.permanent_address_postal_code",
  "reporter.date_of_birth",
  "reporter.mobile_number"
]);
const reporterServiceAgreementLegalTerms = [
  { column: "agreement_record_retention_period", token: "agreement.record_retention_period", label: "Records retention period" },
  { column: "agreement_record_production_deadline", token: "agreement.record_production_deadline", label: "Records production deadline" },
  { column: "agreement_payment_deadline", token: "agreement.payment_deadline", label: "Payment deadline" },
  { column: "agreement_payment_cycle", token: "agreement.payment_cycle", label: "Payment cycle" },
  { column: "agreement_legal_cost_reimbursement_deadline", token: "agreement.legal_cost_reimbursement_deadline", label: "Legal-cost reimbursement deadline" },
  { column: "agreement_reporter_liability_clause", token: "agreement.reporter_liability_clause", label: "Reporter liability clause" },
  { column: "agreement_reporter_liability_summary", token: "agreement.reporter_liability_summary", label: "Legacy liability reference" },
  { column: "agreement_story_exclusivity_period", token: "agreement.story_exclusivity_period", label: "Story exclusivity period" },
  { column: "agreement_term_period", token: "agreement.term_period", label: "Agreement term" },
  { column: "agreement_termination_notice_period", token: "agreement.termination_notice_period", label: "Termination notice period" },
  { column: "agreement_company_liability_lookback_period", token: "agreement.company_liability_lookback_period", label: "Company liability lookback period" },
  { column: "agreement_arbitrator_appointment_method", token: "agreement.arbitrator_appointment_method", label: "Arbitrator appointment method" },
  { column: "agreement_arbitration_language", token: "agreement.arbitration_language", label: "Arbitration language" },
  { column: "agreement_controlling_language", token: "agreement.controlling_language", label: "Controlling language" },
  { column: "agreement_fee_terms", token: "agreement.fee_terms", label: "Fees" },
  { column: "agreement_insurance_terms", token: "agreement.insurance_terms", label: "Insurance terms" }
];
const reporterServiceAgreementLiabilityReference = "See Section 11.7.";
reporterServiceAgreementLegalTerms
  .filter(({ token }) => token !== "agreement.reporter_liability_summary")
  .forEach(({ token }) => serviceTokenValues.add(token));
const serviceRenderTokenValues = new Set([...serviceTokenValues, "reporter.type"]);
const templatePath = path.join(__dirname, "reporter-agreement-template.txt");
const fontDirectory = path.resolve(__dirname, "../node_modules/@fontsource/noto-sans-devanagari/files");
const latinFont = path.join(fontDirectory, "noto-sans-devanagari-latin-400-normal.woff");
const devanagariFont = path.join(fontDirectory, "noto-sans-devanagari-devanagari-400-normal.woff");
const latinBoldFont = path.join(fontDirectory, "noto-sans-devanagari-latin-700-normal.woff");
const devanagariBoldFont = path.join(fontDirectory, "noto-sans-devanagari-devanagari-700-normal.woff");

function defaultReporterAgreementTemplate() {
  return fs.readFileSync(templatePath, "utf8");
}

function normalizeReporterServiceAgreementTemplate(template) {
  return template.replace(
    /^([ \t]*Assigned area:[ \t]*)\{\{reporter\.state\}\}[ \t]*\/[ \t]*\{\{reporter\.rto\}\}[ \t]*\/[ \t]*\{\{reporter\.city\}\}([ \t]*)\r?$/gim,
    "$1{{reporter.coverage_area}} / {{reporter.district}} / {{reporter.state}}$2"
  )
    .replace(/\[24\] months/g, "{{agreement.record_retention_period}}")
    .replace(/\[48\] hours/g, "{{agreement.record_production_deadline}}")
    .replace(/within \[30\] days of the end of each \[month \/ invoice\]/g, "within {{agreement.payment_deadline}} of the end of each {{agreement.payment_cycle}}")
    .replace(/within \[15\]\s*days of Chowk’s invoice/g, "within {{agreement.legal_cost_reimbursement_deadline}} of Chowk’s invoice")
    .replace(/11\.7 \[Optional: The Reporter’s total liability under this Section is limited to ₹ \[amount\],\s*except for fabrication, fraud or wilful misconduct, for which it is unlimited\.\]/g, "11.7 {{agreement.reporter_liability_clause}}")
    .replace(/\[72\] hours/g, "{{agreement.story_exclusivity_period}}")
    .replace(/\[12\] months/g, "{{agreement.term_period}}")
    .replace(/on \[15\] days’ written notice/g, "on {{agreement.termination_notice_period}} written notice")
    .replace(/preceding \[3\] months/g, "preceding {{agreement.company_liability_lookback_period}}")
    .replace(/by \[the High Court \/ an arbitral institution\]/g, "by {{agreement.arbitrator_appointment_method}}")
    .replace(/language is \[English \/ Hindi\]/g, "language is {{agreement.arbitration_language}}")
    .replace(/\[English \/ Hindi\] prevails/g, "{{agreement.controlling_language}} prevails")
    .replace(/\[Enter fees per accepted story or monthly retainer\]/g, "{{agreement.fee_terms}}")
    .replace(/\[Enter payment cycle\]/g, "{{agreement.payment_cycle}}")
    .replace(/\[Enter term\]/g, "{{agreement.term_period}}")
    .replace(/\[Enter notice period\]/g, "{{agreement.termination_notice_period}}")
    .replace(/\[Enter retention period\]/g, "{{agreement.record_retention_period}}")
    .replace(/\[Enter none or agreed amount\]/g, "{{agreement.reporter_liability_summary}}")
    .replace(/\[Enter none or details\]/g, "{{agreement.insurance_terms}}")
    .replace(/^[^\r\n]*\{\{agreement\.reporter_liability_summary\}\}[^\r\n]*(?:\r?\n|$)/gim, "");
}

function unknownTemplateTokens(template, allowedTokens = tokenValues) {
  return [...new Set([...template.matchAll(/\{\{([^}]+)\}\}/g)]
    .map((match) => match[1].trim())
    .filter((token) => !allowedTokens.has(token)))];
}

function renderReporterAgreementTemplate(template, data, allowedTokens = tokenValues) {
  const unknown = unknownTemplateTokens(template, allowedTokens);
  if (unknown.length) {
    throw new Error(`Unknown agreement template field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  }
  const rendered = template.replace(/\{\{([^}]+)\}\}/g, (match, token) =>
    String(data[token.trim()] ?? ""));
  const unresolved = rendered.match(/\{\{[^}]+\}\}/);
  if (unresolved) throw new Error(`Agreement field ${unresolved[0]} could not be filled.`);
  return rendered;
}

function normalizeAgreementLines(text) {
  const output = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      if (output.length && output[output.length - 1] !== "") output.push("");
      continue;
    }
    const startsNewParagraph = /^(Background|Schedule [A-Z]|Signatures|For |(?:\d+(?:\.\d+)*\.?)\s|[A-Z]\.\s)/.test(line);
    if (!output.length || output[output.length - 1] === "" || startsNewParagraph) {
      output.push(line);
      continue;
    }
    const previous = output[output.length - 1];
    if (/[.!?:)]$/.test(previous)) output.push(line);
    else output[output.length - 1] = `${previous} ${line}`;
  }
  return output;
}

function addMixedScriptText(document, text, bold = false, align = "left") {
  const runs = text.match(/[\u0900-\u097f₹]+|[^\u0900-\u097f₹]+/gu) || [""];
  runs.forEach((run, index) => {
    const devanagari = /[\u0900-\u097f₹]/u.test(run);
    const font = bold
      ? (devanagari ? "AgreementDevanagariBold" : "AgreementLatinBold")
      : (devanagari ? "AgreementDevanagari" : "AgreementLatin");
    document.font(font).text(run, { continued: index < runs.length - 1, align });
  });
}

function createReporterAgreementPdf(template, data, { preview = false, allowedTokens = tokenValues } = {}) {
  const rendered = renderReporterAgreementTemplate(template, data, allowedTokens);
  const document = new PDFDocument({
    size: "A4",
    margins: { top: 54, bottom: 54, left: 58, right: 58 },
    info: {
      Title: `${data["company.trade_name"] || "Chowk"} Reporter Engagement Agreement`,
      Author: data["company.legal_name"] || "CHOWK NEWS"
    }
  });
  const chunks = [];
  const output = new Promise((resolve, reject) => {
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  document.registerFont("AgreementLatin", latinFont);
  document.registerFont("AgreementDevanagari", devanagariFont);
  document.registerFont("AgreementLatinBold", latinBoldFont);
  document.registerFont("AgreementDevanagariBold", devanagariBoldFont);

  if (preview) {
    document.save();
    document.rotate(-32, { origin: [300, 400] })
      .font("AgreementLatinBold")
      .fontSize(40)
      .fillColor("#e7e7e7")
      .text("ADMIN PREVIEW", 70, 370, { align: "center", width: 450 });
    document.restore();
    document.y = document.page.margins.top;
  }

  const lines = normalizeAgreementLines(rendered);
  lines.forEach((line, index) => {
    if (!line) {
      document.moveDown(0.45);
      return;
    }
    const title = index === 0;
    const heading = title || /^(Background|Schedule [A-Z]|Signatures|(?:\d+(?:\.\d+)*\.?)\s+[A-Z])/.test(line);
    document.fontSize(title ? 17 : heading ? 11 : 9.5);
    document.fillColor("#172033");
    addMixedScriptText(document, line, heading, heading ? "left" : "justify");
    document.text("", { lineGap: heading ? 2 : 1 });
  });
  document.end();
  return output;
}

module.exports = {
  createReporterAgreementPdf,
  defaultReporterAgreementTemplate,
  normalizeReporterServiceAgreementTemplate,
  reporterAgreementTemplateFields: [...tokenValues]
    .filter((token) => token !== "reporter.type")
    .map((token) => `{{${token}}}`),
  reporterServiceAgreementTemplateFields: [...serviceTokenValues].map((token) => `{{${token}}}`),
  reporterServiceAgreementRenderTokens: serviceRenderTokenValues,
  reporterServiceAgreementLiabilityReference,
  reporterServiceAgreementLegalTerms,
  renderReporterAgreementTemplate,
  unknownTemplateTokens,
  unknownServiceTemplateTokens: (template) => unknownTemplateTokens(template, serviceTokenValues),
  reporterServiceAgreementTokens: serviceTokenValues
};
