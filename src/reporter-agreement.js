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
  reporterAgreementTemplateFields: [...tokenValues]
    .filter((token) => token !== "reporter.type")
    .map((token) => `{{${token}}}`),
  reporterServiceAgreementTemplateFields: [...serviceTokenValues].map((token) => `{{${token}}}`),
  reporterServiceAgreementRenderTokens: serviceRenderTokenValues,
  renderReporterAgreementTemplate,
  unknownTemplateTokens,
  unknownServiceTemplateTokens: (template) => unknownTemplateTokens(template, serviceTokenValues),
  reporterServiceAgreementTokens: serviceTokenValues
};
