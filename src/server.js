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
  reporterServiceAgreementTemplateFields,
  reporterServiceAgreementTokens,
  reporterServiceAgreementRenderTokens,
  unknownTemplateTokens,
  unknownServiceTemplateTokens
} = require("./reporter-agreement");

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.resolve(__dirname, "..", "public");
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
const reporterServiceAgreementPreviews = new Map();
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png"
};

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

async function credentialPrintPage(credential, request) {
  const verificationUrl = new URL("/credential", requestOrigin(request));
  verificationUrl.searchParams.set("token", credential.verification_token);
  const qrImage = await QRCode.toDataURL(verificationUrl.toString(), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256
  });
  const scope = credential.scope || credential.scope_snapshot || {};
  const scopeText = [
    scope.state_name, scope.rto_code, scope.city_name,
    scope.coverage_name
  ].filter(Boolean).join(" · ") || "Newsroom";
  const isAuthorityLetter = credential.credential_type === "authority_letter";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CHOWK credential ${escapeHtml(credential.reference_code)}</title>
    <style>
      *{box-sizing:border-box}body{margin:0;padding:32px;background:#f4f5f7;color:#26334b;font:14px Arial,sans-serif}
      .card{width:min(760px,100%);min-height:420px;margin:24px auto;padding:32px;border:1px solid #e4e7ec;border-top:7px solid #ef6b2e;border-radius:16px;background:#fff;box-shadow:0 18px 48px #27334a18}
      header{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #e9ebef;padding-bottom:18px}
      h1{margin:0;font-size:22px;letter-spacing:.04em}header p,.muted{color:#778196;font-size:11px}
      .body{display:grid;grid-template-columns:1fr 190px;gap:28px;align-items:center;padding-top:24px}
      dl{display:grid;grid-template-columns:120px 1fr;gap:13px;margin:0}dt{color:#7b8494;font-size:11px}dd{margin:0;font-weight:700}
      .qr{width:180px;height:180px;padding:9px;border:1px solid #e7eaf0;border-radius:10px}
      .footer{margin-top:26px;padding-top:16px;border-top:1px solid #e9ebef;color:#778196;font-size:10px;line-height:1.6}
      .actions{display:flex;justify-content:center;margin:18px auto}.actions button{padding:12px 18px;border:0;border-radius:8px;background:#ed6b2e;color:#fff;font-weight:700;cursor:pointer}
      @media(max-width:560px){body{padding:10px}.card{padding:22px}.body{grid-template-columns:1fr}.qr{grid-row:1;width:150px;height:150px}dl{grid-template-columns:100px 1fr}}
      @media print{body{padding:0;background:#fff}.card{width:100%;margin:0;border:1px solid #ddd;border-top:6px solid #ed6b2e;border-radius:0;box-shadow:none}.actions{display:none}}
    </style></head><body><article class="card">
      <header><div><h1>CHOWK NEWSROOM</h1><p>OFFICIAL STAFF ${escapeHtml(credential.credential_type || "CREDENTIAL").replaceAll("_", " ").toUpperCase()}</p></div><strong>${escapeHtml(credential.reference_code)}</strong></header>
      <section class="body"><dl>
        <dt>Name</dt><dd>${escapeHtml(credential.name || credential.name_snapshot)}</dd>
        <dt>Role</dt><dd>${escapeHtml(String(credential.role || credential.role_snapshot).replaceAll("_", " "))}</dd>
        <dt>Reporter ID</dt><dd>${escapeHtml(credential.reporter_code || credential.reporter_code_snapshot || "—")}</dd>
        <dt>Coverage</dt><dd>${escapeHtml(scopeText)}</dd>
        <dt>Status</dt><dd>${escapeHtml(String(credential.status).replaceAll("_", " "))}</dd>
        <dt>Valid</dt><dd>${escapeHtml(credential.valid_from)} – ${escapeHtml(credential.valid_until)}</dd>
        ${isAuthorityLetter ? `<dt>Service terms</dt><dd>Version ${escapeHtml(credential.service_agreement_version || "—")}</dd><dt>Authorized by</dt><dd>${escapeHtml(credential.authorized_signer_name || "—")} · ${escapeHtml(credential.authorized_signer_designation || "—")}</dd><dt>Contact</dt><dd>${escapeHtml(credential.return_address || "—")}</dd>` : ""}
        <dt>Issued by</dt><dd>${escapeHtml(credential.issued_by_name || credential.issued_by_name_snapshot || "CHOWK NEWSROOM")}</dd>
      </dl><img class="qr" src="${qrImage}" alt="Credential verification QR code"></section>
      <p class="footer">Scan the QR code to check current credential status. This ${isAuthorityLetter ? "authority letter" : "ID card"} does not by itself establish the identity of its holder. Confirm identity through an independently verified newsroom contact channel.</p>
    </article><div class="actions"><button type="button" onclick="window.print()">Print / Save PDF</button></div></body></html>`;
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

async function requireAdmin(request, response) {
  try {
    const session = await getSession(request, response, adminCookie);
    if (!session || !["admin", "super_admin"].includes(session.identity.role)) {
      clearSessionCookies(response, adminCookie);
      sendJson(response, 401, { error: "Admin access required." });
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

async function reporterServiceAgreementContext(session) {
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
  if (!application || !["approved", "active"].includes(application.status)) {
    throw Object.assign(new Error("Only an approved reporter can review the service agreement."), { statusCode: 403 });
  }

  const [
    agreement, organization, profile, privateDetails, state, rto, reporterProfile, designationResult
  ] = await Promise.all([
    supabaseRequest("/rest/v1/reporter_service_agreement_versions?select=version,sha256,template_content&status=eq.published&limit=1", { token: session.token }),
    supabaseRequest("/rest/v1/reporter_organization_profile?select=legal_name,trade_name,entity_type,registered_address,registration_number,official_email,official_phone,website_url,is_verified&id=eq.true&limit=1", { token: session.token }),
    supabaseRequest(`/rest/v1/profiles?select=full_name,phone&id=eq.${encodeURIComponent(session.identity.id)}&limit=1`, { token: session.token }),
    supabaseRequest(`/rest/v1/reporter_application_private_details?select=coverage_area_id,father_first_name,father_last_name,permanent_address_line1,permanent_address_line2,permanent_address_city,permanent_address_district,permanent_address_state,permanent_address_postal_code,mobile_number,date_of_birth&application_id=eq.${encodeURIComponent(application.id)}&user_id=eq.${encodeURIComponent(session.identity.id)}&limit=1`, { token: session.token }),
    supabaseRequest(`/rest/v1/states?select=id,state_name,state_code&id=eq.${application.state?.id}&limit=1`, { token: session.token }),
    supabaseRequest(`/rest/v1/rto_offices?select=id,state_id,rto_code,city_name,location_id&id=eq.${application.rto?.id}&state_id=eq.${application.state?.id}&limit=1`, { token: session.token }),
    supabaseRequest(`/rest/v1/reporter_profiles?select=reporter_code&user_id=eq.${encodeURIComponent(session.identity.id)}&limit=1`, { token: session.token }),
    supabaseRequest(
      `/rest/v1/reporter_applications?select=reporter_designation:reporter_designations(name)&id=eq.${encodeURIComponent(application.id)}&user_id=eq.${encodeURIComponent(session.identity.id)}&limit=1`,
      { token: session.token }
    )
  ]);
  for (const result of [agreement, organization, profile, privateDetails, state, rto, reporterProfile, designationResult]) {
    if (!result.response.ok) {
      throw Object.assign(
        new Error(apiErrorMessage(result.payload, "Personalized reporter service agreement details could not be loaded.")),
        { statusCode: result.response.status }
      );
    }
  }
  const currentAgreement = agreement.payload?.[0];
  if (!currentAgreement) {
    throw Object.assign(new Error("No reporter service agreement is published yet."), { statusCode: 404 });
  }
  if (!currentAgreement.template_content) {
    return {
      agreement: currentAgreement,
      tokens: null,
      application,
      reporterName: profile.payload?.[0]?.full_name || session.identity.name || ""
    };
  }
  const company = organization.payload?.[0];
  const reporter = profile.payload?.[0];
  const details = privateDetails.payload?.[0];
  const selectedState = state.payload?.[0];
  const selectedRto = rto.payload?.[0];
  const assignedArea = await reporterAgreementCoverageArea(
    session,
    details?.coverage_area_id,
    selectedRto?.location_id
  );
  const designation = designationResult.payload?.[0]?.reporter_designation?.name;
  if (!designation) {
    throw Object.assign(new Error("An administrator must assign your reporter designation before the service agreement is prepared."), {
      statusCode: 409
    });
  }
  if (!company?.is_verified || !reporter || !details || !selectedState || !selectedRto) {
    throw Object.assign(
      new Error("Verified organization details and complete reporter application details are required to generate the service agreement."),
      { statusCode: 409 }
    );
  }
  const address = [
    details.permanent_address_line1,
    details.permanent_address_line2,
    details.permanent_address_city,
    details.permanent_address_district,
    details.permanent_address_state,
    details.permanent_address_postal_code
  ].filter(Boolean).join(", ");
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
    "reporter.coverage_area": assignedArea.coverageArea,
    "reporter.district": assignedArea.district,
    "reporter.email": session.identity.email || "Not provided",
    "reporter.full_name": reporter.full_name || session.identity.name || "Name not provided",
    "reporter.phone": reporter.phone || "Not provided",
    "reporter.reporter_code": reporterProfile.payload?.[0]?.reporter_code || "Assigned after onboarding",
    "reporter.rto": selectedRto.rto_code,
    "reporter.state": selectedState.state_name,
    "reporter.designation": designation,
    "reporter.type": "",
    "reporter.father_first_name": details.father_first_name || "Not provided",
    "reporter.father_last_name": details.father_last_name || "Not provided",
    "reporter.permanent_address": address || "Not provided",
    "reporter.permanent_address_line1": details.permanent_address_line1 || "Not provided",
    "reporter.permanent_address_line2": details.permanent_address_line2 || "Not provided",
    "reporter.permanent_address_city": details.permanent_address_city || "Not provided",
    "reporter.permanent_address_district": details.permanent_address_district || "Not provided",
    "reporter.permanent_address_state": details.permanent_address_state || "Not provided",
    "reporter.permanent_address_postal_code": details.permanent_address_postal_code || "Not provided",
    "reporter.date_of_birth": details.date_of_birth || "Not provided",
    "reporter.mobile_number": details.mobile_number || "Not provided"
  };
  return { agreement: currentAgreement, tokens, application, reporterName: tokens["reporter.full_name"] };
}

async function ensureReporterServiceAgreementTemplate(session) {
  const selectPath = "/rest/v1/reporter_service_agreement_versions?select=id,version,sha256,template_content,status,created_at&template_content=not.is.null&order=created_at.desc,id.desc&limit=1";
  const existing = await supabaseRequest(selectPath, { token: session.token });
  if (!existing.response.ok) {
    throw Object.assign(
      new Error(apiErrorMessage(existing.payload, "The service-agreement template could not be loaded from the database.")),
      { statusCode: existing.response.status }
    );
  }
  if (existing.payload?.[0]) return existing.payload[0];

  const templateContent = defaultReporterAgreementTemplate().trim();
  const version = `service-initial-${createHash("sha256").update(templateContent, "utf8").digest("hex").slice(0, 12)}`;
  const inserted = await supabaseRequest("/rest/v1/reporter_service_agreement_versions", {
    method: "POST",
    token: session.token,
    body: {
      version,
      sha256: createHash("sha256").update(templateContent, "utf8").digest("hex"),
      document_url: "/api/reporter/service-agreement-preview",
      template_content: templateContent,
      created_by: session.identity.id
    },
    prefer: "return=representation"
  });
  if (inserted.response.ok && inserted.payload?.[0]) return inserted.payload[0];

  const afterInsert = await supabaseRequest(selectPath, { token: session.token });
  if (afterInsert.response.ok && afterInsert.payload?.[0]) return afterInsert.payload[0];
  throw Object.assign(
    new Error(apiErrorMessage(
      inserted.payload,
      "The initial agreement template could not be saved to the database."
    )),
    { statusCode: inserted.response.status }
  );
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

async function reporterServiceAgreementAdminContext(session, applicationId, { requirePublished = false } = {}) {
  if (!Number.isSafeInteger(applicationId) || applicationId < 1) {
    throw Object.assign(new Error("The reporter application reference is invalid."), { statusCode: 400 });
  }
  const agreement = await ensureReporterServiceAgreementTemplate(session);
  const [applicationResult, organizationResult] = await Promise.all([
    supabaseRequest(
      `/rest/v1/reporter_applications?select=id,user_id,status,state_id,rto_office_id,reporter_designation_id,service_agreement_issue_id,reporter_designation:reporter_designations(id,name)&id=eq.${applicationId}&limit=1`,
      { token: session.token }
    ),
    supabaseRequest(
      "/rest/v1/reporter_organization_profile?select=legal_name,trade_name,entity_type,registered_address,registration_number,official_email,official_phone,website_url,is_verified&id=eq.true&limit=1",
      { token: session.token }
    )
  ]);
  for (const result of [applicationResult, organizationResult]) {
    if (!result.response.ok) {
      throw Object.assign(
        new Error(apiErrorMessage(result.payload, "Agreement preparation data could not be loaded.")),
        { statusCode: result.response.status }
      );
    }
  }
  const application = applicationResult.payload?.[0];
  if (!application || !["approved", "active"].includes(application.status)) {
    throw Object.assign(new Error("Only an approved reporter can receive a service agreement."), { statusCode: 409 });
  }
  if (!application.reporter_designation?.name) {
    throw Object.assign(
      new Error("Assign an active reporter designation before generating the service agreement."),
      { statusCode: 409 }
    );
  }
  if (!agreement.template_content) {
    throw Object.assign(
      new Error("The service-agreement template is empty. Open Admin → Service agreement setup and add the approved terms."),
      { statusCode: 409 }
    );
  }
  if (!agreement.sha256) {
    agreement.sha256 = createHash("sha256").update(agreement.template_content, "utf8").digest("hex");
  }
  if (!agreement.template_content.includes("{{reporter.designation}}")) {
    throw Object.assign(
      new Error("Add {{reporter.designation}} to the service-agreement template and publish it before preparing reporter agreements."),
      { statusCode: 409 }
    );
  }
  if (requirePublished && agreement.status !== "published") {
    throw Object.assign(
      new Error("This preview uses an unpublished template. Finalize and publish the template in Admin → Service agreement setup, then generate a fresh preview before issuing it."),
      { statusCode: 409 }
    );
  }
  const company = organizationResult.payload?.[0];
  if (!company?.is_verified) {
    throw Object.assign(
      new Error("Verify the company legal profile in Admin → Service agreement setup before preparing agreements."),
      { statusCode: 409 }
    );
  }
  const [profileResult, detailsResult, stateResult, rtoResult, reporterProfileResult] = await Promise.all([
    supabaseRequest(`/rest/v1/profiles?select=id,full_name,email,phone&id=eq.${encodeURIComponent(application.user_id)}&limit=1`, { token: session.token }),
    supabaseRequest(
      `/rest/v1/reporter_application_private_details?select=coverage_area_id,mobile_number,date_of_birth,father_first_name,father_last_name,permanent_address_line1,permanent_address_line2,permanent_address_city,permanent_address_district,permanent_address_state,permanent_address_postal_code&application_id=eq.${application.id}&user_id=eq.${encodeURIComponent(application.user_id)}&limit=1`,
      { token: session.token }
    ),
    supabaseRequest(`/rest/v1/states?select=id,state_name,state_code&id=eq.${application.state_id}&limit=1`, { token: session.token }),
    supabaseRequest(`/rest/v1/rto_offices?select=id,state_id,rto_code,city_name,location_id&id=eq.${application.rto_office_id}&state_id=eq.${application.state_id}&limit=1`, { token: session.token }),
    supabaseRequest(`/rest/v1/reporter_profiles?select=reporter_code&user_id=eq.${encodeURIComponent(application.user_id)}&limit=1`, { token: session.token })
  ]);
  for (const result of [profileResult, detailsResult, stateResult, rtoResult, reporterProfileResult]) {
    if (!result.response.ok) {
      throw Object.assign(
        new Error(apiErrorMessage(result.payload, "Approved reporter details could not be loaded for the agreement.")),
        { statusCode: result.response.status }
      );
    }
  }
  const profile = profileResult.payload?.[0];
  const details = detailsResult.payload?.[0];
  const state = stateResult.payload?.[0];
  const rto = rtoResult.payload?.[0];
  if (!profile || !details || !state || !rto) {
    throw Object.assign(
      new Error("The approved application is missing required reporter or location details. Review the application before issuing an agreement."),
      { statusCode: 409 }
    );
  }
  const assignedArea = await reporterAgreementCoverageArea(
    session,
    details.coverage_area_id,
    rto.location_id
  );
  const address = [
    details.permanent_address_line1,
    details.permanent_address_line2,
    details.permanent_address_city,
    details.permanent_address_district,
    details.permanent_address_state,
    details.permanent_address_postal_code
  ].filter(Boolean).join(", ");
  const tokens = {
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
    "reporter.city": rto.city_name || state.state_name,
    "reporter.coverage_area": assignedArea.coverageArea,
    "reporter.district": assignedArea.district,
    "reporter.email": profile.email || "Not provided",
    "reporter.full_name": profile.full_name || "Name not provided",
    "reporter.phone": profile.phone || details.mobile_number || "Not provided",
    "reporter.reporter_code": reporterProfileResult.payload?.[0]?.reporter_code || "Assigned after approval",
    "reporter.rto": rto.rto_code,
    "reporter.state": state.state_name,
    "reporter.designation": application.reporter_designation.name,
    "reporter.type": "",
    "reporter.father_first_name": details.father_first_name || "Not provided",
    "reporter.father_last_name": details.father_last_name || "Not provided",
    "reporter.permanent_address": address || "Not provided",
    "reporter.permanent_address_line1": details.permanent_address_line1 || "Not provided",
    "reporter.permanent_address_line2": details.permanent_address_line2 || "Not provided",
    "reporter.permanent_address_city": details.permanent_address_city || "Not provided",
    "reporter.permanent_address_district": details.permanent_address_district || "Not provided",
    "reporter.permanent_address_state": details.permanent_address_state || "Not provided",
    "reporter.permanent_address_postal_code": details.permanent_address_postal_code || "Not provided",
    "reporter.date_of_birth": details.date_of_birth || "Not provided",
    "reporter.mobile_number": details.mobile_number || "Not provided"
  };
  const requiredTemplateTokens = new Set(
    [...agreement.template_content.matchAll(/\{\{([^}]+)\}\}/g)]
      .map((match) => match[1].trim())
  );
  const optionalTemplateTokens = new Set([
    "company.registration_number",
    "company.website_url"
  ]);
  const missingFields = [...requiredTemplateTokens].filter((token) =>
    !Object.hasOwn(tokens, token)
    || !String(tokens[token] ?? "").trim()
    || (!optionalTemplateTokens.has(token)
      && ["Not provided", "Name not provided", "Assigned after approval", "Assigned after onboarding"]
        .includes(String(tokens[token]).trim()))
  );
  if (missingFields.length) {
    throw Object.assign(
      new Error(`Required reporter or company details are missing for this agreement: ${missingFields.join(", ")}. Update the verified company profile or correct the approved reporter application before previewing.`),
      { statusCode: 409 }
    );
  }
  return { application, agreement, tokens };
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
    const allowedForAdmin = ["admin", "super_admin"].includes(identity.role);
    if (request.url.startsWith("/api/admin/session") && !allowedForAdmin) {
      sendJson(response, 403, { error: "This account does not have admin access." });
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

async function adminRoute(request, response, requestUrl, session) {
  const { token } = session;
  const pathname = requestUrl.pathname;
  try {
    if (request.method !== "GET" && !isSameOrigin(request)) {
      sendJson(response, 403, { error: "Cross-origin request rejected." });
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
      "reporter-types": {
        table: "reporter_types",
        select: "id,name,type_code,description,is_active,created_at",
        order: "name.asc",
        fields: ["name", "type_code", "description", "is_active"]
      },
      "reporter-designations": {
        table: "reporter_designations",
        select: "id,name,designation_code,description,is_active,created_at",
        order: "name.asc",
        fields: ["name", "designation_code", "description", "is_active"]
      },
      "reporter-applications": {
        table: "reporter_applications",
        select: "id,user_id,location_id,state_id,rto_office_id,reporter_type_id,reporter_designation_id,service_agreement_issue_id,applicant_details_confirmed,status,review_note,review_requests,reviewed_by,reviewed_at,company_signer_name,company_signer_designation,company_signature_accepted,company_signed_at,company_signature_statement,created_at,user:profiles!reporter_applications_user_id_fkey(id,email,full_name,phone),state:states(state_name,state_code),rto:rto_offices(rto_code,city_name),reporter_designation:reporter_designations(id,name,designation_code)",
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
      const [reporters, assignments] = await Promise.all([
        supabaseRequest("/rest/v1/reporter_profiles?select=user_id,reporter_code,created_at,user:profiles!reporter_profiles_user_id_fkey(id,email,full_name,phone,role,created_at)&order=created_at.desc&limit=1000", { token }),
        supabaseRequest("/rest/v1/reporter_assignments?select=id,user_id,rto_office_id,reporter_type_id,reporter_designation_id,effective_from,effective_to,rto:rto_offices(rto_code,city_name,state:states(state_code,state_name)),reporter_type:reporter_types(name,type_code),reporter_designation:reporter_designations(id,name)&order=effective_from.desc&limit=2000", { token })
      ]);
      for (const result of [reporters, assignments]) {
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
      sendJson(response, 200, {
        success: true,
        data: (reporters.payload || []).map((reporter) => ({
          ...reporter,
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

    if (pathname === "/api/admin/reporter-service-agreement-template" && request.method === "GET") {
      const latestTemplate = await ensureReporterServiceAgreementTemplate(session);
      const published = await supabaseRequest(
        "/rest/v1/reporter_service_agreement_versions?select=version,published_at&template_content=not.is.null&status=eq.published&limit=1",
        { token }
      );
      if (!published.response.ok) {
        sendJson(response, published.response.status, {
          error: apiErrorMessage(published.payload, "Published agreement status could not be loaded.")
        });
        return;
      }
      const publishedTemplate = published.payload?.[0];
      sendJson(response, 200, {
        success: true,
        data: {
          template_content: normalizeReporterServiceAgreementTemplate(
            latestTemplate?.template_content || defaultReporterAgreementTemplate()
          ),
          based_on_version: latestTemplate?.version || null,
          latest_status: latestTemplate?.status || null,
          published_version: publishedTemplate?.version || null,
          published_at: publishedTemplate?.published_at || null,
          is_default: latestTemplate.version.startsWith("service-initial-"),
          supported_fields: reporterServiceAgreementTemplateFields
        }
      });
      return;
    }

    if (pathname === "/api/admin/reporter-service-agreement-template/preview" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (typeof body.template_content !== "string"
          || body.template_content.trim().length < 1000
          || body.template_content.length > 50000) {
        sendJson(response, 400, { error: "The service agreement template must contain between 1,000 and 50,000 characters." });
        return;
      }
      const unknownTokens = unknownServiceTemplateTokens(body.template_content);
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
      const sampleTokens = {
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
        "reporter.coverage_area": "Sample Coverage Area",
        "reporter.district": "Sample District",
        "reporter.email": "sample.reporter@example.invalid",
        "reporter.full_name": "Sample Reporter",
        "reporter.phone": "0000000000",
        "reporter.reporter_code": "Assigned after onboarding",
        "reporter.rto": "Sample reporting area",
        "reporter.state": "Sample State",
        "reporter.designation": "District Reporter",
        "reporter.type": "",
        "reporter.father_first_name": "Sample",
        "reporter.father_last_name": "Parent",
        "reporter.permanent_address": "12 Sample Road, Sample Locality, Sample City, Sample District, Sample State, 123456",
        "reporter.permanent_address_line1": "12 Sample Road",
        "reporter.permanent_address_line2": "Sample Locality",
        "reporter.permanent_address_city": "Sample City",
        "reporter.permanent_address_district": "Sample District",
        "reporter.permanent_address_state": "Sample State",
        "reporter.permanent_address_postal_code": "123456",
        "reporter.date_of_birth": "1990-01-01",
        "reporter.mobile_number": "0000000000"
      };
      const pdf = await createReporterAgreementPdf(
        normalizeReporterServiceAgreementTemplate(body.template_content),
        sampleTokens,
        {
          preview: true,
          allowedTokens: reporterServiceAgreementTokens
        }
      );
      sendPdf(response, pdf, "reporter-service-agreement-admin-preview.pdf");
      return;
    }

    if (pathname === "/api/admin/reporter-service-agreements/template" && request.method === "POST") {
      const body = await readJsonBody(request, 1024 * 1024);
      const version = typeof body.version === "string" ? body.version.trim() : "";
      if (!/^[a-zA-Z0-9._-]{1,40}$/.test(version)) {
        sendJson(response, 400, { error: "Enter a short version label using letters, numbers, dots, underscores, or hyphens." });
        return;
      }
      if (typeof body.template_content !== "string"
          || body.template_content.trim().length < 1000
          || body.template_content.length > 50000) {
        sendJson(response, 400, { error: "The service agreement template must contain between 1,000 and 50,000 characters." });
        return;
      }
      const unknownTokens = unknownServiceTemplateTokens(body.template_content);
      if (unknownTokens.length) {
        sendJson(response, 400, { error: `Unknown dynamic agreement fields: ${unknownTokens.join(", ")}` });
        return;
      }
      const template = normalizeReporterServiceAgreementTemplate(body.template_content).trim();
      const result = await supabaseRequest("/rest/v1/reporter_service_agreement_versions", {
        method: "POST",
        token,
        body: {
          version,
          sha256: createHash("sha256").update(template, "utf8").digest("hex"),
          document_url: "/api/reporter/service-agreement-preview",
          template_content: template,
          created_by: session.identity.id
        },
        prefer: "return=representation"
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload?.[0] }
        : { error: apiErrorMessage(result.payload, "Service agreement template version could not be saved.") });
      return;
    }

    if (pathname === "/api/admin/reporter-organization-profile" && request.method === "PATCH") {
      const body = await readJsonBody(request);
      if (typeof body.is_verified !== "boolean") {
        sendJson(response, 400, { error: "Choose whether the organization legal profile is verified." });
        return;
      }
      const stringField = (name) => typeof body[name] === "string" ? body[name].trim() : "";
      const profile = {
        legal_name: stringField("legal_name"),
        trade_name: stringField("trade_name"),
        entity_type: stringField("entity_type"),
        registered_address: stringField("registered_address"),
        registration_number: stringField("registration_number"),
        official_email: stringField("official_email").toLowerCase(),
        official_phone: stringField("official_phone"),
        website_url: stringField("website_url"),
        is_verified: body.is_verified === true,
        updated_by: session.identity.id
      };
      if (profile.legal_name.length < 2 || profile.legal_name.length > 160
          || profile.trade_name.length < 2 || profile.trade_name.length > 160
          || profile.entity_type.length < 2 || profile.entity_type.length > 100
          || profile.registered_address.length < 5 || profile.registered_address.length > 500
          || profile.registration_number.length > 100
          || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.official_email)
          || profile.official_email.length > 254
          || profile.official_phone.length < 7 || profile.official_phone.length > 40
          || profile.website_url.length > 500) {
        sendJson(response, 400, { error: "Complete the legal name, trading name, entity type, registered address, valid official email, and official phone." });
        return;
      }
      if (profile.website_url) {
        try {
          if (new URL(profile.website_url).protocol !== "https:") throw new Error("invalid");
        } catch {
          sendJson(response, 400, { error: "The organization website must be a valid HTTPS URL." });
          return;
        }
      }
      if (profile.is_verified && (body.confirm_legal_details !== true
          || /^DEMO ONLY/i.test(profile.legal_name)
          || /^DEMO ONLY/i.test(profile.trade_name)
          || /^DEMO ONLY/i.test(profile.entity_type)
          || /^DEMO ONLY/i.test(profile.registered_address)
          || profile.official_email.endsWith("@example.invalid")
          || profile.official_phone === "+910000000000")) {
        sendJson(response, 400, { error: "Replace the demo values and confirm that the legal details are verified before marking the profile verified." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/reporter_organization_profile?id=eq.true", {
        method: "PATCH", token, body: profile,
        prefer: "return=representation"
      });
      sendJson(response, result.response.status, result.response.ok && result.payload?.[0]
        ? { success: true, data: result.payload[0] }
        : { error: apiErrorMessage(result.payload, "Organization legal profile could not be saved.") });
      return;
    }

    if (pathname === "/api/admin/states" && request.method === "POST") {
      const body = await readJsonBody(request);
      const stateCode = typeof body.state_code === "string" ? body.state_code.trim().toUpperCase() : "";
      const stateName = typeof body.state_name === "string" ? body.state_name.trim() : "";
      if (!/^[A-Z0-9]{2}$/.test(stateCode) || stateName.length < 2 || stateName.length > 100) {
        sendJson(response, 400, { error: "State code must be 2 letters/numbers and state name 2-100 characters." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/states", {
        method: "POST", token, body: { state_code: stateCode, state_name: stateName },
        prefer: "return=representation"
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload?.[0] }
        : { error: apiErrorMessage(result.payload, "State could not be created.") });
      return;
    }

    const stateToggle = pathname.match(/^\/api\/admin\/states\/(\d+)$/);
    if (stateToggle && request.method === "PATCH") {
      const body = await readJsonBody(request);
      if (typeof body.is_active !== "boolean") {
        sendJson(response, 400, { error: "Choose whether this state is active." });
        return;
      }
      const result = await supabaseRequest(`/rest/v1/states?id=eq.${stateToggle[1]}`, {
        method: "PATCH", token, body: { is_active: body.is_active },
        prefer: "return=representation"
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload?.[0] }
        : { error: apiErrorMessage(result.payload, "State status could not be updated.") });
      return;
    }

    if (pathname === "/api/admin/rto-offices" && request.method === "POST") {
      const body = await readJsonBody(request);
      const stateId = Number(body.state_id);
      const rtoCode = typeof body.rto_code === "string" ? body.rto_code.trim().toUpperCase() : "";
      const cityName = typeof body.city_name === "string" ? body.city_name.trim() : "";
      if (!Number.isSafeInteger(stateId) || stateId < 1 || !/^[A-Z0-9]{2,8}$/.test(rtoCode) || cityName.length > 120) {
        sendJson(response, 400, { error: "Choose a state, an RTO code (2-8 alphanumeric characters), and a valid city name." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rto_offices", {
        method: "POST", token, body: { state_id: stateId, rto_code: rtoCode, city_name: cityName },
        prefer: "return=representation"
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload?.[0] }
        : { error: apiErrorMessage(result.payload, "RTO office could not be created.") });
      return;
    }

    const rtoToggle = pathname.match(/^\/api\/admin\/rto-offices\/(\d+)$/);
    if (rtoToggle && request.method === "PATCH") {
      const body = await readJsonBody(request);
      if (typeof body.is_active !== "boolean") {
        sendJson(response, 400, { error: "Choose whether this RTO is active." });
        return;
      }
      const result = await supabaseRequest(`/rest/v1/rto_offices?id=eq.${rtoToggle[1]}`, {
        method: "PATCH", token, body: { is_active: body.is_active },
        prefer: "return=representation"
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload?.[0] }
        : { error: apiErrorMessage(result.payload, "RTO status could not be updated.") });
      return;
    }

    const reporterAssignment = pathname.match(/^\/api\/admin\/reporter-directory\/([0-9a-f-]{36})\/assignment$/i);
    if (reporterAssignment && request.method === "POST") {
      const body = await readJsonBody(request);
      const rto = Number(body.rto_office_id);
      if (!Number.isSafeInteger(rto) || rto < 1) {
        sendJson(response, 400, { error: "Choose an active RTO / reporting area." });
        return;
      }
      const currentAssignment = await supabaseRequest(
        `/rest/v1/reporter_assignments?select=reporter_type_id&user_id=eq.${reporterAssignment[1]}&effective_to=is.null&limit=1`,
        { token }
      );
      if (!currentAssignment.response.ok) {
        sendJson(response, currentAssignment.response.status, {
          error: apiErrorMessage(currentAssignment.payload, "The reporter's current reporter-ID category could not be loaded.")
        });
        return;
      }
      const type = Number(currentAssignment.payload?.[0]?.reporter_type_id);
      if (!Number.isSafeInteger(type) || type < 1) {
        sendJson(response, 409, { error: "The reporter must have an active designation before their reporting area can be updated." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_assign_reporter", {
        method: "POST",
        token,
        body: { target_user: reporterAssignment[1], target_rto: rto, target_type: type }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Reporter assignment could not be changed.") });
      return;
    }

    const reporterDirectoryDesignation = pathname.match(/^\/api\/admin\/reporter-directory\/([0-9a-f-]{36})\/designation$/i);
    if (reporterDirectoryDesignation && request.method === "POST") {
      const body = await readJsonBody(request);
      const designation = Number(body.designation_id);
      if (!Number.isSafeInteger(designation) || designation < 1) {
        sendJson(response, 400, { error: "Choose an active reporter designation." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_set_reporter_designation_for_user", {
        method: "POST",
        token,
        body: {
          target_user: reporterDirectoryDesignation[1],
          target_designation: designation
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Reporter designation could not be updated.") });
      return;
    }

    if (pathname === "/api/admin/reporter-coverage" && request.method === "GET") {
      const [assignments, profiles, locations] = await Promise.all([
        supabaseRequest("/rest/v1/user_coverage_assignments?select=id,user_id,region_id,zone_id,district_id,city_id,coverage_area_id,include_descendants,valid_from,valid_to,assigned_by,created_at&order=valid_from.desc&limit=500", { token }),
        supabaseRequest("/rest/v1/profiles?select=id,email,full_name,role&role=in.(reporter,moderator,editor)&order=full_name.asc&limit=500", { token }),
        supabaseRequest("/rest/v1/locations?select=id,name,slug,location_type,parent_id,is_active&is_active=eq.true&order=location_type.asc,name.asc&limit=1000", { token })
      ]);
      for (const result of [assignments, profiles, locations]) {
        if (!result.response.ok) {
          sendJson(response, result.response.status, {
            error: apiErrorMessage(result.payload, "Reporter coverage data could not be loaded.")
          });
          return;
        }
      }
      sendJson(response, 200, { success: true, data: {
        assignments: assignments.payload || [],
        staff: profiles.payload || [],
        locations: locations.payload || []
      } });
      return;
    }

    if (pathname === "/api/admin/reporter-coverage" && request.method === "POST") {
      const body = await readJsonBody(request);
      const targetUser = typeof body.user_id === "string" ? body.user_id : "";
      const targetLocation = Number(body.location_id);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUser) ||
          !Number.isSafeInteger(targetLocation) || targetLocation < 1) {
        sendJson(response, 400, { error: "Choose a staff member and an active coverage location." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_assign_coverage", {
        method: "POST",
        token,
        body: {
          target_user: targetUser,
          target_location: targetLocation,
          include_children: body.include_descendants !== false
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, id: result.payload }
        : { error: apiErrorMessage(result.payload, "Coverage assignment failed.") });
      return;
    }

    if (pathname === "/api/admin/district-range-mappings" && request.method === "GET") {
      const result = await supabaseRequest(
        "/rest/v1/district_ranges?select=id,range_id,district_id,valid_from,valid_to,assigned_by,created_at&order=valid_from.desc&limit=1000",
        { token }
      );
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload || [] }
        : { error: apiErrorMessage(result.payload, "District/range mapping history could not be loaded.") });
      return;
    }

    if (pathname === "/api/admin/district-zone-mappings" && request.method === "GET") {
      const result = await supabaseRequest(
        "/rest/v1/zone_districts?select=id,zone_id,district_id,valid_from,valid_to&order=valid_from.desc,id.desc&limit=1000",
        { token }
      );
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload || [] }
        : { error: apiErrorMessage(result.payload, "District/zone mappings could not be loaded.") });
      return;
    }

    if (pathname === "/api/admin/district-range-mappings" && request.method === "POST") {
      const body = await readJsonBody(request);
      const rangeId = Number(body.range_id);
      const districtId = Number(body.district_id);
      if (!Number.isSafeInteger(rangeId) || rangeId < 1 || !Number.isSafeInteger(districtId) || districtId < 1) {
        sendJson(response, 400, { error: "Choose a range and district to map." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_assign_district_range", {
        method: "POST",
        token,
        body: {
          target_range: rangeId,
          target_district: districtId,
          allow_zone_transfer: body.allow_zone_transfer === true
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: { id: result.payload } }
        : { error: apiErrorMessage(result.payload, "District could not be mapped to the range.") });
      return;
    }

    const endDistrictRangeMapping = pathname.match(/^\/api\/admin\/district-range-mappings\/(\d+)\/end$/);
    if (endDistrictRangeMapping && request.method === "POST") {
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_end_district_range", {
        method: "POST",
        token,
        body: { target_mapping: Number(endDistrictRangeMapping[1]) }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "District/range mapping could not be ended.") });
      return;
    }

    const endCoverage = pathname.match(/^\/api\/admin\/reporter-coverage\/(\d+)\/end$/);
    if (endCoverage && request.method === "POST") {
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_end_coverage", {
        method: "POST",
        token,
        body: { target_assignment: Number(endCoverage[1]) }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Coverage assignment could not be ended.") });
      return;
    }

    if (pathname === "/api/admin/reporter-credentials" && request.method === "GET") {
      const [credentials, staff] = await Promise.all([
        supabaseRequest(
        "/rest/v1/staff_credentials?select=id,user_id,subject_user_id_snapshot,credential_type,reference_code,status,name_snapshot,role_snapshot,reporter_code_snapshot,scope_snapshot,issued_by_name_snapshot,issued_by_role_snapshot,issued_at,valid_from,valid_until,acknowledged_name,acknowledged_at,revoked_by,revoked_at,revoked_reason&order=issued_at.desc&limit=500",
        { token }
        ),
        supabaseRequest("/rest/v1/profiles?select=id,email,full_name,role&role=in.(reporter,moderator,editor)&order=full_name.asc&limit=500", { token })
      ]);
      for (const result of [credentials, staff]) {
        if (!result.response.ok) {
          sendJson(response, result.response.status, {
            error: apiErrorMessage(result.payload, "Staff credential data could not be loaded.")
          });
          return;
        }
      }
      const [approvedApplicants, currentServiceAgreement, reporterProfiles] = await Promise.all([
        supabaseRequest(
          "/rest/v1/reporter_applications?select=user_id,status,service_agreement_version,service_agreement_sha256,service_agreement_accepted_at,user:profiles!reporter_applications_user_id_fkey(id,email,full_name,role)&status=in.(approved,active)&order=created_at.asc&limit=500",
          { token }
        ),
        supabaseRequest("/rest/v1/reporter_service_agreement_versions?select=version,sha256&status=eq.published&limit=1", { token }),
        supabaseRequest("/rest/v1/reporter_profiles?select=user_id,reporter_code&limit=1000", { token })
      ]);
      if (!approvedApplicants.response.ok || !currentServiceAgreement.response.ok || !reporterProfiles.response.ok) {
        const failure = !approvedApplicants.response.ok
          ? approvedApplicants
          : !currentServiceAgreement.response.ok
            ? currentServiceAgreement
            : reporterProfiles;
        sendJson(response, failure.response.status, {
          error: apiErrorMessage(failure.payload, "Approved reporter applicants could not be loaded.")
        });
        return;
      }
      const serviceAgreement = currentServiceAgreement.payload?.[0];
      const reporterCodeByUser = new Map((reporterProfiles.payload || []).map((reporter) =>
        [reporter.user_id, reporter.reporter_code]
      ));
      const staffById = new Map((staff.payload || []).map((person) => [person.id, person]));
      (approvedApplicants.payload || []).forEach((application) => {
        const person = application.user;
        if (person?.id) {
          const hasCurrentServiceAgreement = Boolean(
            application.service_agreement_accepted_at
              && application.service_agreement_version === serviceAgreement?.version
              && application.service_agreement_sha256 === serviceAgreement?.sha256
          );
          staffById.set(person.id, {
            ...staffById.get(person.id),
            ...person,
            onboarding_status: application.status,
            can_issue_id_card: hasCurrentServiceAgreement,
            can_receive_authority_letter: hasCurrentServiceAgreement,
            reporter_code: reporterCodeByUser.get(application.user_id)
          });
        }
      });
      sendJson(response, 200, { success: true, data: {
        credentials: credentials.payload || [],
        staff: [...staffById.values()]
      } });
      return;
    }

    const printCredential = pathname.match(/^\/api\/admin\/reporter-credentials\/(\d+)\/print$/);
    if (printCredential && request.method === "GET") {
      const result = await supabaseRequest(
        `/rest/v1/staff_credentials?select=credential_type,reference_code,verification_token,status,name_snapshot,role_snapshot,reporter_code_snapshot,scope_snapshot,valid_from,valid_until,issued_by_name_snapshot,issued_at&id=eq.${printCredential[1]}&limit=1`,
        { token }
      );
      if (!result.response.ok || !result.payload?.[0]) {
        sendJson(response, result.response.ok ? 404 : result.response.status, {
          error: apiErrorMessage(result.payload, "Credential could not be loaded for printing.")
        });
        return;
      }
      const credential = result.payload[0];
      const requestOrigin = request.headers.origin
        || `${request.headers["x-forwarded-proto"]?.split(",")[0].trim() || (request.socket.encrypted ? "https" : "http")}://${request.headers["x-forwarded-host"]?.split(",")[0].trim() || request.headers.host}`;
      const verificationUrl = new URL("/credential", requestOrigin);
      verificationUrl.searchParams.set("token", credential.verification_token);
      const qrImage = await QRCode.toDataURL(verificationUrl.toString(), {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 256
      });
      const scope = credential.scope_snapshot || {};
      const scopeText = [
        scope.state_name, scope.rto_code, scope.city_name,
        scope.coverage_name
      ].filter(Boolean).join(" · ") || "Newsroom";
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CHOWK credential ${escapeHtml(credential.reference_code)}</title>
        <style>
          *{box-sizing:border-box}body{margin:0;padding:32px;background:#f4f5f7;color:#26334b;font:14px Arial,sans-serif}
          .card{width:min(760px,100%);min-height:420px;margin:24px auto;padding:32px;border:1px solid #e4e7ec;border-top:7px solid #ef6b2e;border-radius:16px;background:#fff;box-shadow:0 18px 48px #27334a18}
          header{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #e9ebef;padding-bottom:18px}
          h1{margin:0;font-size:22px;letter-spacing:.04em}header p,.muted{color:#778196;font-size:11px}
          .body{display:grid;grid-template-columns:1fr 190px;gap:28px;align-items:center;padding-top:24px}
          dl{display:grid;grid-template-columns:120px 1fr;gap:13px;margin:0}dt{color:#7b8494;font-size:11px}dd{margin:0;font-weight:700}
          .qr{width:180px;height:180px;padding:9px;border:1px solid #e7eaf0;border-radius:10px}
          .footer{margin-top:26px;padding-top:16px;border-top:1px solid #e9ebef;color:#778196;font-size:10px;line-height:1.6}
          .actions{display:flex;justify-content:center;margin:18px auto}.actions button{padding:12px 18px;border:0;border-radius:8px;background:#ed6b2e;color:#fff;font-weight:700;cursor:pointer}
          @media(max-width:560px){body{padding:10px}.card{padding:22px}.body{grid-template-columns:1fr}.qr{grid-row:1;width:150px;height:150px}dl{grid-template-columns:100px 1fr}}
          @media print{body{padding:0;background:#fff}.card{width:100%;margin:0;border:1px solid #ddd;border-top:6px solid #ed6b2e;border-radius:0;box-shadow:none}.actions{display:none}}
        </style></head><body><article class="card">
          <header><div><h1>CHOWK NEWSROOM</h1><p>OFFICIAL STAFF ${escapeHtml(credential.credential_type || "CREDENTIAL").replaceAll("_", " ").toUpperCase()}</p></div><strong>${escapeHtml(credential.reference_code)}</strong></header>
          <section class="body"><dl>
            <dt>Name</dt><dd>${escapeHtml(credential.name_snapshot)}</dd>
            <dt>Role</dt><dd>${escapeHtml(String(credential.role_snapshot).replaceAll("_", " "))}</dd>
            <dt>Reporter ID</dt><dd>${escapeHtml(credential.reporter_code_snapshot || "—")}</dd>
            <dt>Coverage</dt><dd>${escapeHtml(scopeText)}</dd>
            <dt>Status</dt><dd>${escapeHtml(String(credential.status).replaceAll("_", " "))}</dd>
            <dt>Valid</dt><dd>${escapeHtml(credential.valid_from)} – ${escapeHtml(credential.valid_until)}</dd>
            <dt>Issued by</dt><dd>${escapeHtml(credential.issued_by_name_snapshot || "CHOWK NEWSROOM")}</dd>
          </dl><img class="qr" src="${qrImage}" alt="Credential verification QR code"></section>
          <p class="footer">Scan the QR code to check current credential status. This card does not by itself establish the identity of its holder. Confirm identity through an independently verified newsroom contact channel.</p>
        </article><div class="actions"><button type="button" onclick="window.print()">Print / Save PDF</button></div></body></html>`;
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(html);
      return;
    }

    if (pathname === "/api/admin/reporter-credentials" && request.method === "POST") {
      const body = await readJsonBody(request);
      const targetUser = typeof body.user_id === "string" ? body.user_id : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUser) ||
          !["id_card", "authority_letter"].includes(body.credential_type)) {
        sendJson(response, 400, { error: "Choose an eligible staff member and credential type." });
        return;
      }
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      if (!datePattern.test(body.valid_from || "") || !datePattern.test(body.valid_until || "")) {
        sendJson(response, 400, { error: "Enter valid credential start and end dates." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_issue_credential", {
        method: "POST",
        token,
        body: {
          target_user: targetUser,
          credential_kind: body.credential_type,
          start_date: body.valid_from,
          end_date: body.valid_until,
          signer_name: body.signer_name || "",
          signer_designation: body.signer_designation || "",
          signer_address: body.return_address || ""
        }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, id: result.payload }
        : { error: apiErrorMessage(result.payload, "Credential could not be issued.") });
      return;
    }

    const credentialRevoke = pathname.match(/^\/api\/admin\/reporter-credentials\/(\d+)\/revoke$/);
    if (credentialRevoke && request.method === "POST") {
      const body = await readJsonBody(request);
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (reason.length < 2 || reason.length > 500) {
        sendJson(response, 400, { error: "Enter a revocation reason between 2 and 500 characters." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_revoke_credential", {
        method: "POST",
        token,
        body: { target_credential: Number(credentialRevoke[1]), reason }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Credential could not be revoked.") });
      return;
    }

    const agreementPreview = pathname.match(/^\/api\/admin\/reporter-(service-)?agreements\/(\d+)\/preview$/);
    if (agreementPreview && request.method === "GET") {
      const isService = Boolean(agreementPreview[1]);
      const table = isService ? "reporter_service_agreement_versions" : "reporter_agreement_versions";
      const result = await supabaseRequest(
        `/rest/v1/${table}?select=version,document_url,storage_object_path,template_content&id=eq.${agreementPreview[2]}&limit=1`,
        { token }
      );
      if (!result.response.ok || !result.payload?.[0]) {
        sendJson(response, result.response.ok ? 404 : result.response.status, {
          error: apiErrorMessage(result.payload, "Agreement version could not be loaded for preview.")
        });
        return;
      }
      const agreement = result.payload[0];
      if (agreement.template_content) {
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
          "reporter.coverage_area": "Sample Coverage Area",
          "reporter.district": "Sample District",
          "reporter.email": "sample.reporter@example.invalid",
          "reporter.full_name": "Sample Reporter",
          "reporter.phone": "0000000000",
          "reporter.reporter_code": "Assigned after approval",
          "reporter.rto": "Sample reporting area",
          "reporter.state": "Sample State",
          "reporter.designation": "District Reporter",
          "reporter.type": "",
          "reporter.father_first_name": "Sample",
          "reporter.father_last_name": "Parent",
          "reporter.permanent_address": "12 Sample Road, Sample Locality, Sample City, Sample District, Sample State, 123456",
          "reporter.permanent_address_line1": "12 Sample Road",
          "reporter.permanent_address_line2": "Sample Locality",
          "reporter.permanent_address_city": "Sample City",
          "reporter.permanent_address_district": "Sample District",
          "reporter.permanent_address_state": "Sample State",
          "reporter.permanent_address_postal_code": "123456",
          "reporter.date_of_birth": "1990-01-01",
          "reporter.mobile_number": "0000000000"
        };
        try {
          const pdf = await createReporterAgreementPdf(agreement.template_content, sampleData, {
            preview: true,
            allowedTokens: isService ? reporterServiceAgreementRenderTokens : undefined
          });
          sendPdf(
            response,
            pdf,
            `reporter-agreement-${agreement.version}-admin-preview.pdf`,
            requestUrl.searchParams.get("download") === "1"
          );
        } catch (error) {
          sendJson(response, 400, { error: error.message });
        }
        return;
      }
      let previewUrl;
      if (agreement.storage_object_path) {
        previewUrl = await signedReporterAgreementPdfUrl(agreement.storage_object_path, token);
      } else {
        try {
          previewUrl = new URL(agreement.document_url).toString();
          if (new URL(previewUrl).protocol !== "https:") throw new Error("invalid");
        } catch {
          sendJson(response, 400, { error: "This agreement does not contain a valid HTTPS document URL." });
          return;
        }
      }
      response.writeHead(302, { Location: previewUrl, "Cache-Control": "no-store" });
      response.end();
      return;
    }

    if (pathname === "/api/admin/reporter-agreements" && request.method === "GET") {
      const result = await supabaseRequest(
        "/rest/v1/reporter_agreement_versions?select=id,version,sha256,document_url,storage_object_path,template_content,status,created_by,published_by,published_at,created_at&order=created_at.desc",
        { token }
      );
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Reporter agreements could not be loaded.") });
      return;
    }

    if (pathname === "/api/admin/reporter-agreements" && request.method === "POST") {
      const body = await readJsonBody(request, 1024 * 1024);
      const version = typeof body.version === "string" ? body.version.trim() : "";
      if (!/^[a-zA-Z0-9._-]{1,40}$/.test(version)) {
        sendJson(response, 400, { error: "Enter a short version label using letters, numbers, dots, underscores, or hyphens." });
        return;
      }
      if (typeof body.template_content !== "string"
          || body.template_content.trim().length < 1000
          || body.template_content.length > 50000) {
        sendJson(response, 400, { error: "The agreement template must contain between 1,000 and 50,000 characters." });
        return;
      }
      const unknownTokens = unknownTemplateTokens(body.template_content);
      if (unknownTokens.length) {
        sendJson(response, 400, {
          error: `Unknown dynamic agreement fields: ${unknownTokens.join(", ")}`
        });
        return;
      }
      const template = body.template_content.trim();
      const result = await supabaseRequest("/rest/v1/reporter_agreement_versions", {
        method: "POST",
        token,
        body: {
          version,
          sha256: createHash("sha256").update(template, "utf8").digest("hex"),
          document_url: "/api/reporter/agreement-preview",
          template_content: template,
          created_by: session.identity.id
        },
        prefer: "return=representation"
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload?.[0] }
        : { error: apiErrorMessage(result.payload, "Agreement template version could not be saved.") });
      return;
    }

    if (pathname === "/api/admin/reporter-service-agreements" && request.method === "GET") {
      const result = await supabaseRequest(
        "/rest/v1/reporter_service_agreement_versions?select=id,version,sha256,document_url,storage_object_path,template_content,status,created_by,published_by,published_at,created_at&order=created_at.desc",
        { token }
      );
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Reporter service agreements could not be loaded.") });
      return;
    }

    if (pathname === "/api/admin/reporter-service-agreements" && request.method === "POST") {
      sendJson(response, 410, {
        error: "Static service-agreement uploads are no longer supported. Create a personalized service-agreement template."
      });
      return;
    }

    const archiveServiceAgreement = pathname.match(/^\/api\/admin\/reporter-service-agreements\/(\d+)\/archive$/);
    if (archiveServiceAgreement && request.method === "POST") {
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_archive_reporter_service_agreement", {
        method: "POST",
        token,
        body: { target_agreement: Number(archiveServiceAgreement[1]) }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Service agreement could not be archived.") });
      return;
    }

    const deleteServiceAgreement = pathname.match(/^\/api\/admin\/reporter-service-agreements\/(\d+)$/);
    if (deleteServiceAgreement && request.method === "DELETE") {
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_delete_reporter_service_agreement", {
        method: "POST",
        token,
        body: { target_agreement: Number(deleteServiceAgreement[1]) }
      });
      if (!result.response.ok) {
        sendJson(response, result.response.status, {
          error: apiErrorMessage(result.payload, "Service agreement could not be deleted.")
        });
        return;
      }
      try {
        await removeReporterAgreementPdf(result.payload, token);
        sendJson(response, 200, { success: true });
      } catch (error) {
        console.error(`Could not remove the private PDF for deleted service agreement ${deleteServiceAgreement[1]}:`, error.message);
        sendJson(response, 207, {
          success: true,
          cleanup_warning: "The agreement was deleted, but its private PDF could not be removed from storage. Contact support for cleanup."
        });
      }
      return;
    }

    const publishServiceAgreement = pathname.match(/^\/api\/admin\/reporter-service-agreements\/(\d+)\/publish$/);
    if (publishServiceAgreement && request.method === "POST") {
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_publish_reporter_service_agreement", {
        method: "POST",
        token,
        body: { target_agreement: Number(publishServiceAgreement[1]) }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Service agreement could not be published.") });
      return;
    }

    const archiveAgreement = pathname.match(/^\/api\/admin\/reporter-agreements\/(\d+)\/archive$/);
    if (archiveAgreement && request.method === "POST") {
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_archive_reporter_agreement", {
        method: "POST",
        token,
        body: { target_agreement: Number(archiveAgreement[1]) }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Agreement could not be archived.") });
      return;
    }

    const publishAgreement = pathname.match(/^\/api\/admin\/reporter-agreements\/(\d+)\/publish$/);
    if (publishAgreement && request.method === "POST") {
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_publish_reporter_agreement", {
        method: "POST",
        token,
        body: { target_agreement: Number(publishAgreement[1]) }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Agreement version could not be published.") });
      return;
    }

    if (pathname === "/api/admin/audit-logs" && request.method === "GET") {
      const pageSizeValue = Number(requestUrl.searchParams.get("page_size") || 25);
      const pageValue = Number(requestUrl.searchParams.get("page") || 1);
      const pageSize = [25, 50, 100].includes(pageSizeValue) ? pageSizeValue : 25;
      const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? Math.min(pageValue, 100000) : 1;
      const offset = (page - 1) * pageSize;
      const query = new URLSearchParams({
        select: "id,actor_id,actor_name,actor_email,actor_ip,request_id,user_agent,action,table_name,record_id,before_data,after_data,changed_fields,outcome,reason,created_at",
        order: "created_at.desc,id.desc",
        limit: String(pageSize),
        offset: String(offset)
      });
      const search = (requestUrl.searchParams.get("q") || "")
        .replace(/[^a-zA-Z0-9@._ -]/g, "")
        .trim()
        .slice(0, 100);
      const table = requestUrl.searchParams.get("table");
      const action = requestUrl.searchParams.get("action");
      const from = requestUrl.searchParams.get("from");
      const to = requestUrl.searchParams.get("to");
      const isValidAuditDate = (value) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
        const parsedDate = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === value;
      };
      const auditedTables = [
        "profiles", "articles", "categories", "locations", "reporter_types", "reporter_designations",
        "reporter_applications", "live_streams", "article_reports", "comments", "media_catalog",
        "states", "rto_offices", "reporter_agreement_versions", "reporter_agreement_acceptances",
        "reporter_service_agreement_versions", "reporter_service_agreement_acceptances",
        "reporter_profiles", "reporter_assignments", "user_coverage_assignments", "staff_credentials"
      ];
      if (table && !auditedTables.includes(table)) {
        sendJson(response, 400, { error: "Choose a valid audit table filter." });
        return;
      }
      if (action && !["INSERT", "UPDATE", "DELETE", "USER_CREATED", "PASSWORD_CHANGED"].includes(action)) {
        sendJson(response, 400, { error: "Choose a valid audit action filter." });
        return;
      }
      if (from && !isValidAuditDate(from)) {
        sendJson(response, 400, { error: "The start date is invalid." });
        return;
      }
      if (to && !isValidAuditDate(to)) {
        sendJson(response, 400, { error: "The end date is invalid." });
        return;
      }
      if (from && to && from > to) {
        sendJson(response, 400, { error: "The start date must not be later than the end date." });
        return;
      }
      if (table) query.set("table_name", `eq.${table}`);
      if (action) query.set("action", `eq.${action}`);
      const dateFilters = [];
      if (from) dateFilters.push(`created_at.gte.${from}T00:00:00.000Z`);
      if (to) dateFilters.push(`created_at.lte.${to}T23:59:59.999Z`);
      if (dateFilters.length) query.set("and", `(${dateFilters.join(",")})`);
      if (search) {
        const term = `*${search}*`;
        query.set("or", `(action.ilike.${term},table_name.ilike.${term},record_id.ilike.${term},actor_name.ilike.${term},actor_email.ilike.${term},actor_ip.ilike.${term},request_id.ilike.${term})`);
      }
      const result = await supabaseRequest(`/rest/v1/audit_logs?${query}`, {
        token,
        prefer: "count=exact"
      });
      if (!result.response.ok) {
        sendJson(response, result.response.status, {
          error: apiErrorMessage(result.payload, "Audit history could not be loaded.")
        });
        return;
      }
      const total = Number(result.response.headers.get("content-range")?.split("/")[1]) || 0;
      sendJson(response, 200, {
        success: true,
        data: result.payload || [],
        meta: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) }
      });
      return;
    }

    const collectionMatch = pathname.match(/^\/api\/admin\/(locations|reporter-types|reporter-designations|reporter-applications|live-streams|reports|comments|media|audit-logs)$/);
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
      if (collection.table === "reporter_types" &&
          (typeof record.type_code !== "string" || !/^\d{2}$/.test(record.type_code))) {
        sendJson(response, 400, { error: "Reporter type code must contain exactly two digits." });
        return;
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

    const collectionRecord = pathname.match(/^\/api\/admin\/(locations|reporter-types|reporter-designations|live-streams|reports|comments|media)\/(\d+)$/);
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
      if (config.table === "reporter_types" && record.type_code !== undefined &&
          (typeof record.type_code !== "string" || !/^\d{2}$/.test(record.type_code))) {
        sendJson(response, 400, { error: "Reporter type code must contain exactly two digits." });
        return;
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

    const serviceAgreementIssue = pathname.match(
      /^\/api\/admin\/reporter-applications\/(\d+)\/service-agreement\/(preview|publish)$/
    );
    if (serviceAgreementIssue && request.method === "GET" && serviceAgreementIssue[2] === "preview") {
      const context = await reporterServiceAgreementAdminContext(session, Number(serviceAgreementIssue[1]));
      const pdf = await createReporterAgreementPdf(
        normalizeReporterServiceAgreementTemplate(context.agreement.template_content),
        context.tokens,
        {
          preview: context.agreement.status !== "published",
          allowedTokens: reporterServiceAgreementRenderTokens
        }
      );
      const now = Date.now();
      for (const [key, cachedPreview] of reporterServiceAgreementPreviews) {
        if (cachedPreview.expires_at <= now) reporterServiceAgreementPreviews.delete(key);
      }
      while (reporterServiceAgreementPreviews.size >= 100) {
        const oldestKey = reporterServiceAgreementPreviews.keys().next().value;
        if (!oldestKey) break;
        reporterServiceAgreementPreviews.delete(oldestKey);
      }
      const previewToken = randomUUID();
      reporterServiceAgreementPreviews.set(previewToken, {
        actor_id: session.identity.id,
        application_id: context.application.id,
        user_id: context.application.user_id,
        agreement_version: context.agreement.version,
        agreement_sha256: context.agreement.sha256,
        is_published: context.agreement.status === "published",
        tokens_json: JSON.stringify(context.tokens),
        pdf,
        expires_at: now + 10 * 60 * 1000
      });
      sendPdf(
        response,
        pdf,
        `reporter-service-agreement-${context.agreement.version}-preview.pdf`,
        false,
        {
          "X-Preview-Token": previewToken,
          "X-Agreement-Published": String(context.agreement.status === "published"),
          "X-Agreement-Version": context.agreement.version
        }
      );
      return;
    }
    if (serviceAgreementIssue && request.method === "POST" && serviceAgreementIssue[2] === "publish") {
      const body = await readJsonBody(request);
      const previewToken = typeof body.preview_token === "string" ? body.preview_token : "";
      if (!/^[0-9a-f-]{36}$/.test(previewToken)) {
        sendJson(response, 400, { error: "Generate and review the agreement PDF before publishing it." });
        return;
      }
      const cachedPreview = reporterServiceAgreementPreviews.get(previewToken);
      if (!cachedPreview
          || cachedPreview.expires_at <= Date.now()
          || cachedPreview.actor_id !== session.identity.id
          || cachedPreview.application_id !== Number(serviceAgreementIssue[1])) {
        reporterServiceAgreementPreviews.delete(previewToken);
        sendJson(response, 409, { error: "This agreement preview expired or is no longer available. Generate a fresh preview before publishing." });
        return;
      }
      if (!cachedPreview.is_published) {
        reporterServiceAgreementPreviews.delete(previewToken);
        sendJson(response, 409, {
          error: "This is a draft preview only. Finalize and publish the service-agreement template before issuing an agreement to a reporter."
        });
        return;
      }
      reporterServiceAgreementPreviews.delete(previewToken);
      const context = await reporterServiceAgreementAdminContext(
        session,
        Number(serviceAgreementIssue[1]),
        { requirePublished: true }
      );
      if (cachedPreview.user_id !== context.application.user_id
          || cachedPreview.agreement_version !== context.agreement.version
          || cachedPreview.agreement_sha256 !== context.agreement.sha256
          || cachedPreview.tokens_json !== JSON.stringify(context.tokens)) {
        reporterServiceAgreementPreviews.delete(previewToken);
        sendJson(response, 409, {
          error: "The agreement template or reporter details changed after preview. Generate and review a fresh PDF before publishing."
        });
        return;
      }
      const pdf = cachedPreview.pdf;
      const document = await uploadReporterAgreementPdf(pdf.toString("base64"), "service", token);
      const result = await supabaseRequest(
        "/rest/v1/rpc/chowk_admin_publish_reporter_service_agreement_issue",
        {
          method: "POST",
          token,
          body: {
            target_application: context.application.id,
            target_version: context.agreement.version,
            target_sha256: context.agreement.sha256,
            target_document_path: document.object_path,
            target_document_sha256: document.sha256
          }
        }
      );
      if (!result.response.ok) {
        try {
          await removeReporterAgreementPdf(document.object_path, token);
        } catch (error) {
          console.error("Could not remove an unregistered reporter service agreement:", error.message);
        }
        sendJson(response, result.response.status, {
          error: apiErrorMessage(result.payload, "The personalized service agreement could not be published.")
        });
        return;
      }
      sendJson(response, 201, {
        success: true,
        issue_id: result.payload,
        agreement_version: context.agreement.version,
        document_sha256: document.sha256
      });
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
      const result = await supabaseRequest("/rest/v1/profiles?select=id,email,full_name,phone,role,created_at&order=created_at.desc&limit=100", { token });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Users could not be loaded.") });
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
        sendJson(response, 400, { error: "Choose an active RTO/reporting area belonging to the selected state. The current designation must also be assigned." });
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
      if (!["subscriber", "moderator", "editor", "publisher", "admin", "super_admin"].includes(role)) {
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

async function workspaceRoute(request, response, requestUrl, session) {
  const { token, identity } = session;
  try {
    if (request.method !== "GET" && !isSameOrigin(request)) {
      sendJson(response, 403, { error: "Cross-origin request rejected." });
      return;
    }
    const role = identity.role;
    if (!["reporter", "moderator", "editor", "publisher", "admin", "super_admin"].includes(role)) {
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

  if (requestUrl.pathname === "/api/admin/session" && request.method === "POST") {
    void handleAuth(request, response, false);
    return;
  }

  if (requestUrl.pathname === "/api/admin/session" && request.method === "GET") {
    void requireAdmin(request, response).then((session) => {
      if (session) sendJson(response, 200, { identity: session.identity });
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
            const html = await credentialPrintPage(credential, request);
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
          if (requestUrl.pathname === "/api/reporter/service-agreement-preview" && request.method === "GET") {
            const context = await reporterServiceAgreementContext(session);
            if (!context.tokens) {
              sendJson(response, 409, { error: "This legacy service agreement is not a personalized template." });
              return;
            }
            const pdf = await createReporterAgreementPdf(
              context.agreement.template_content,
              context.tokens,
              { allowedTokens: reporterServiceAgreementRenderTokens }
            );
            sendPdf(
              response,
              pdf,
              `reporter-service-agreement-${context.agreement.version}.pdf`,
              requestUrl.searchParams.get("download") === "1"
            );
            return;
          }
          if (requestUrl.pathname === "/api/reporter/service-agreement-issued-document"
              && request.method === "GET") {
            const issueId = requestUrl.searchParams.get("issue_id");
            if (!issueId || !/^\d+$/.test(issueId)) {
              sendJson(response, 400, { error: "The personalized service agreement reference is invalid." });
              return;
            }
            const query = new URLSearchParams({
              select: "document_storage_path",
              id: `eq.${issueId}`,
              user_id: `eq.${session.identity.id}`,
              status: "eq.published",
              limit: "1"
            });
            const issue = await supabaseRequest(
              `/rest/v1/reporter_service_agreement_issues?${query}`,
              { token: session.token }
            );
            if (!issue.response.ok) {
              sendJson(response, issue.response.status, {
                error: apiErrorMessage(issue.payload, "Your personalized service agreement could not be loaded.")
              });
              return;
            }
            const objectPath = issue.payload?.[0]?.document_storage_path;
            if (!objectPath) {
              sendJson(response, 404, { error: "No current personalized service agreement has been published for your account." });
              return;
            }
            const signedUrl = await signedReporterAgreementPdfUrl(
              objectPath,
              session.token,
              requestUrl.searchParams.get("download") === "1"
            );
            response.writeHead(302, { Location: signedUrl, "Cache-Control": "no-store" });
            response.end();
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
          if (requestUrl.pathname === "/api/reporter/service-agreement-accepted-document"
              && request.method === "GET") {
            const acceptanceId = requestUrl.searchParams.get("acceptance_id");
            if (!acceptanceId || !/^\d+$/.test(acceptanceId)) {
              sendJson(response, 400, { error: "The accepted service agreement reference is invalid." });
              return;
            }
            const query = new URLSearchParams({
              select: "document_storage_path",
              user_id: `eq.${session.identity.id}`,
              id: `eq.${acceptanceId}`,
              document_storage_path: "not.is.null",
              limit: "1"
            });
            const receipt = await supabaseRequest(
              `/rest/v1/reporter_service_agreement_acceptances?${query}`,
              { token: session.token }
            );
            if (!receipt.response.ok) {
              sendJson(response, receipt.response.status, {
                error: apiErrorMessage(receipt.payload, "Accepted service agreement document could not be loaded.")
              });
              return;
            }
            const documentPath = receipt.payload?.[0]?.document_storage_path;
            if (!documentPath) {
              sendJson(response, 404, { error: "No personalized accepted service agreement copy is recorded for this account." });
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
          if (requestUrl.pathname === "/api/reporter/applications" && request.method === "POST") {
            const body = await readJsonBody(request);
            const currentApplicationResult = await supabaseRequest(
              `/rest/v1/reporter_applications?select=id,status,review_requests,state_id,rto_office_id,reporter_type_id&user_id=eq.${encodeURIComponent(session.identity.id)}&limit=1`,
              { token: session.token }
            );
            if (!currentApplicationResult.response.ok) {
              sendJson(response, currentApplicationResult.response.status, {
                error: apiErrorMessage(currentApplicationResult.payload, "Your existing reporter application could not be checked.")
              });
              return;
            }
            const currentApplication = currentApplicationResult.payload?.[0] || null;
            let existingDocumentsPayload = [];
            let requestedDocumentReplacements = [];
            let requestedFieldNames = [];
            const isTargetedResubmission = currentApplication?.status === "needs_information"
              && Array.isArray(currentApplication.review_requests)
              && currentApplication.review_requests.length > 0;
            if (isTargetedResubmission) {
              const [privateDetailsResult, existingDocumentsResult] = await Promise.all([
                supabaseRequest(
                  `/rest/v1/reporter_application_private_details?select=*&application_id=eq.${encodeURIComponent(currentApplication.id)}&user_id=eq.${encodeURIComponent(session.identity.id)}&limit=1`,
                  { token: session.token }
                ),
                supabaseRequest(
                  `/rest/v1/reporter_application_documents?select=document_type,storage_path,mime_type,sha256&application_id=eq.${encodeURIComponent(currentApplication.id)}&user_id=eq.${encodeURIComponent(session.identity.id)}`,
                  { token: session.token }
                )
              ]);
              for (const result of [privateDetailsResult, existingDocumentsResult]) {
                if (!result.response.ok) {
                  sendJson(response, result.response.status, {
                    error: apiErrorMessage(result.payload, "Your existing reporter application details could not be loaded.")
                  });
                  return;
                }
              }
              const existingPrivateDetails = privateDetailsResult.payload?.[0];
              if (!existingPrivateDetails) {
                sendJson(response, 409, { error: "Your existing reporter application details are incomplete. Contact an administrator." });
                return;
              }
              const requestedFields = new Set(currentApplication.review_requests.map((request) => request.field));
              requestedFieldNames = [...requestedFields];
              const requestedPrivateFields = new Set([
                "mobile_number", "date_of_birth", "emergency_contact_name",
                "father_first_name", "father_last_name", "permanent_address_line1",
                "permanent_address_line2", "permanent_address_city", "permanent_address_district",
                "permanent_address_state", "permanent_address_postal_code",
                "emergency_contact_relationship", "emergency_contact_phone", "blood_group",
                "preferred_language", "coverage_area_id", "coverage_localities",
                "experience_years", "experience_summary", "availability",
                "bank_account_holder", "bank_name", "bank_account_number", "bank_ifsc"
              ]);
              const submittedPrivateDetails = body.private_details && typeof body.private_details === "object"
                && !Array.isArray(body.private_details) ? body.private_details : {};
              const updateFields = new Set([...requestedFields].filter((field) => requestedPrivateFields.has(field)));
              if (requestedFields.has("state_id") || requestedFields.has("rto_office_id")) {
                updateFields.add("coverage_area_id");
              }
              body.private_details = { ...existingPrivateDetails };
              updateFields.forEach((field) => {
                if (Object.hasOwn(submittedPrivateDetails, field)) {
                  body.private_details[field] = submittedPrivateDetails[field];
                }
              });
              body.state_id = requestedFields.has("state_id") ? body.state_id : currentApplication.state_id;
              body.rto_office_id = requestedFields.has("rto_office_id") || requestedFields.has("state_id")
                ? body.rto_office_id
                : currentApplication.rto_office_id;
              body.private_details.masked_aadhaar_confirmed = existingPrivateDetails.masked_aadhaar_confirmed;
              body.private_details.document_processing_consent = existingPrivateDetails.document_processing_consent;

              if (!Array.isArray(body.application_documents)) {
                sendJson(response, 400, { error: "Upload the specific document requested by the admin." });
                return;
              }
              const requestedReuploads = new Set(currentApplication.review_requests
                .filter((request) => request.kind === "reupload")
                .map((request) => request.field));
              if (body.application_documents.some((document) =>
                !requestedReuploads.has(document?.document_type)
              )) {
                sendJson(response, 400, { error: "Only documents explicitly requested for reupload can be replaced." });
                return;
              }
              requestedDocumentReplacements = body.application_documents;
              existingDocumentsPayload = existingDocumentsResult.payload || [];
              body.details_confirmed = true;
            }
            const submitTargetedResubmission = () => supabaseRequest(
              "/rest/v1/rpc/chowk_resubmit_reporter_application",
              {
                method: "POST",
                token: session.token,
                body: {
                  target_application: currentApplication.id,
                  target_state: Number(body.state_id || currentApplication.state_id),
                  target_rto: Number(body.rto_office_id || currentApplication.rto_office_id),
                  private_details: body.private_details,
                  application_documents: requestedDocumentReplacements
                }
              }
            );
            const locationRequest = requestedFieldNames.some((field) =>
              ["state_id", "rto_office_id", "coverage_area_id"].includes(field)
            );
            if (isTargetedResubmission && !locationRequest) {
              const result = await submitTargetedResubmission();
              sendJson(response, result.response.status, result.response.ok
                ? { success: true }
                : { error: apiErrorMessage(result.payload, "Requested reporter application updates could not be submitted.") });
              return;
            }
            if (currentApplication && !isTargetedResubmission) {
              const existingDocumentsResult = await supabaseRequest(
                `/rest/v1/reporter_application_documents?select=document_type,storage_path,mime_type,sha256&application_id=eq.${encodeURIComponent(currentApplication.id)}&user_id=eq.${encodeURIComponent(session.identity.id)}`,
                { token: session.token }
              );
              if (!existingDocumentsResult.response.ok) {
                sendJson(response, existingDocumentsResult.response.status, {
                  error: apiErrorMessage(existingDocumentsResult.payload, "Your existing reporter documents could not be loaded.")
                });
                return;
              }
              existingDocumentsPayload = existingDocumentsResult.payload || [];
            }
            if (body.details_confirmed !== true) {
              sendJson(response, 400, { error: "Confirm that your reporter application details are accurate." });
              return;
            }
            const privateDetails = body.private_details;
            if (!isTargetedResubmission && privateDetails && typeof privateDetails === "object" && !Array.isArray(privateDetails)
                && (typeof privateDetails.coverage_localities !== "string"
                  || (privateDetails.coverage_localities.trim().length > 0
                    && (privateDetails.coverage_localities.trim().length < 2
                      || privateDetails.coverage_localities.length > 1000)))) {
              sendJson(response, 400, { error: "Preferred locations must be empty or 2-1000 characters." });
              return;
            }
            if (!isTargetedResubmission && (!privateDetails || typeof privateDetails !== "object" || Array.isArray(privateDetails)
                || typeof privateDetails.mobile_number !== "string"
                || !/^\+?[0-9]{7,15}$/.test(privateDetails.mobile_number)
                || typeof privateDetails.date_of_birth !== "string"
                || !/^\d{4}-\d{2}-\d{2}$/.test(privateDetails.date_of_birth)
                || Number.isNaN(Date.parse(`${privateDetails.date_of_birth}T00:00:00Z`))
                || new Date(`${privateDetails.date_of_birth}T00:00:00Z`).toISOString().slice(0, 10) !== privateDetails.date_of_birth
                || privateDetails.date_of_birth > new Date().toISOString().slice(0, 10)
                || typeof privateDetails.emergency_contact_name !== "string"
                || privateDetails.emergency_contact_name.trim().length < 2
                || typeof privateDetails.emergency_contact_relationship !== "string"
                || privateDetails.emergency_contact_relationship.trim().length < 2
                || typeof privateDetails.emergency_contact_phone !== "string"
                || !/^[+0-9() .-]{7,30}$/.test(privateDetails.emergency_contact_phone)
                || typeof privateDetails.bank_account_holder !== "string"
                || privateDetails.bank_account_holder.trim().length < 2
                || typeof privateDetails.bank_name !== "string"
                || privateDetails.bank_name.trim().length < 2
                || typeof privateDetails.bank_account_number !== "string"
                || !/^[0-9]{6,24}$/.test(privateDetails.bank_account_number)
                || typeof privateDetails.bank_ifsc !== "string"
                || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(privateDetails.bank_ifsc)
                || typeof privateDetails.blood_group !== "string"
                || !["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Prefer not to say"].includes(privateDetails.blood_group)
                || privateDetails.masked_aadhaar_confirmed !== true
                || privateDetails.document_processing_consent !== true)) {
              sendJson(response, 400, { error: "Check the mobile number, date of birth, emergency-contact, bank-account, IFSC and blood-group details." });
              return;
            }
            const requiredDocuments = ["profile_photo", "aadhaar_front", "aadhaar_back", "pan_card", "bank_proof"];
            if (!Array.isArray(body.application_documents)
                || body.application_documents.length > requiredDocuments.length
                || body.application_documents.some((document) =>
                  !document || !requiredDocuments.includes(document.document_type)
                )
                || new Set(body.application_documents.map((document) => document.document_type)).size
                  !== body.application_documents.length) {
              sendJson(response, 400, { error: "The submitted document replacements are invalid or duplicated." });
              return;
            }
            const stateId = Number(body.state_id);
            const rtoId = Number(body.rto_office_id);
            if (![stateId, rtoId].every((id) => Number.isSafeInteger(id) && id > 0)) {
              sendJson(response, 400, { error: "Choose a valid State and District." });
              return;
            }
            const [locationOptions, coverageAreasResult] = await Promise.all([
              supabaseRequest("/rest/v1/rpc/chowk_reporter_options", { token: session.token }),
              supabaseRequest(
                "/rest/v1/locations?select=id,name,parent_id&location_type=eq.coverage_area&is_active=eq.true&order=name.asc&limit=5000",
                { token: session.token }
              )
            ]);
            for (const locationResult of [locationOptions, coverageAreasResult]) {
              if (!locationResult.response.ok) {
                sendJson(response, locationResult.response.status, {
                  error: apiErrorMessage(locationResult.payload, "Reporter location options could not be loaded.")
                });
                return;
              }
            }
            const selectedDistrict = (locationOptions.payload?.rtos || []).find((district) =>
              Number(district.id) === rtoId && Number(district.state_id) === stateId
            );
            if (!selectedDistrict?.region_id) {
              sendJson(response, 400, { error: "Choose an active District within the selected State." });
              return;
            }
            const coverageAreaId = Number(privateDetails?.coverage_area_id);
            const selectedCoverageArea = (coverageAreasResult.payload || []).find((coverageArea) =>
              Number(coverageArea.id) === coverageAreaId
                && Number(coverageArea.parent_id) === Number(selectedDistrict.district_id)
            );
            if (!Number.isSafeInteger(coverageAreaId) || !selectedCoverageArea) {
              sendJson(response, 400, { error: "Choose an active Coverage Area within the selected District." });
              return;
            }
            const documentsByType = new Map(
              existingDocumentsPayload.map((document) => [document.document_type, document])
            );
            for (const replacement of body.application_documents) {
              if (typeof replacement.storage_path !== "string"
                  || !replacement.storage_path.startsWith(`applications/${session.identity.id}/${replacement.document_type}/`)
                  || !/^[a-f0-9]{64}$/.test(replacement.sha256 || "")
                  || !["image/jpeg", "image/png", "application/pdf"].includes(replacement.mime_type)
                  || (replacement.document_type === "profile_photo" && replacement.mime_type === "application/pdf")) {
                sendJson(response, 400, { error: "A replacement document is invalid. Upload the requested document again." });
                return;
              }
              documentsByType.set(replacement.document_type, replacement);
            }
            const missingDocuments = requiredDocuments.filter((type) => !documentsByType.has(type));
            if (missingDocuments.length) {
              const labels = {
                profile_photo: "profile photo",
                aadhaar_front: "Aadhaar front",
                aadhaar_back: "Aadhaar back",
                pan_card: "PAN card",
                bank_proof: "bank proof"
              };
              sendJson(response, 400, {
                error: `Your application is missing ${missingDocuments.map((type) => labels[type]).join(", ")}. Upload only the missing document${missingDocuments.length === 1 ? "" : "s"} before resubmitting.`
              });
              return;
            }
            body.application_documents = [...documentsByType.values()];
            const typeResult = isTargetedResubmission ? null : await supabaseRequest(
              "/rest/v1/reporter_types?select=id,type_code&is_active=eq.true&order=type_code.asc&limit=500",
              { token: session.token }
            );
            if (typeResult && !typeResult.response.ok) {
              sendJson(response, typeResult.response.status, {
                error: apiErrorMessage(typeResult.payload, "Reporter type defaults could not be loaded.")
              });
              return;
            }
            const defaultType = isTargetedResubmission
              ? { id: currentApplication.reporter_type_id }
              : (typeResult.payload || []).find((type) => type.type_code === "01")
                || typeResult.payload?.[0];
            if (!defaultType) {
              sendJson(response, 409, { error: "No active reporter type is configured." });
              return;
            }
            const ids = [stateId, Number(selectedDistrict.region_id), rtoId, Number(defaultType.id)];
            const locationCheck = await supabaseRequest("/rest/v1/rpc/chowk_validate_reporter_location", {
              method: "POST",
              token: session.token,
              body: {
                target_state: ids[0],
                target_region: ids[1],
                target_rto: ids[2]
              }
            });
            if (!locationCheck.response.ok) {
              sendJson(response, locationCheck.response.status, {
                error: apiErrorMessage(locationCheck.payload, "Choose an active District within the selected Region and State.")
              });
              return;
            }
            if (isTargetedResubmission) {
              const result = await submitTargetedResubmission();
              sendJson(response, result.response.status, result.response.ok
                ? { success: true }
                : { error: apiErrorMessage(result.payload, "Requested reporter application updates could not be submitted.") });
              return;
            }
            const result = await supabaseRequest("/rest/v1/rpc/chowk_submit_reporter_application_with_private_details", {
              method: "POST",
              token: session.token,
              body: {
                target_state: ids[0],
                target_rto: ids[2],
                target_type: ids[3],
                accepted_version: null,
                accepted_sha256: null,
                signer_name: null,
                acceptance_statement: null,
                details_confirmed: body.details_confirmed,
                target_document_sha256: null,
                target_document_path: null,
                private_details: body.private_details,
                application_documents: body.application_documents
              }
            });
            sendJson(response, result.response.status, result.response.ok
              ? { success: true, application_id: result.payload }
              : { error: apiErrorMessage(result.payload, "Reporter application could not be submitted.") });
            return;
          }
          if (requestUrl.pathname === "/api/reporter/agreement/accept" && request.method === "POST") {
            const body = await readJsonBody(request);
            const context = await reporterAgreementContext(session);
            if (context.agreement.version !== body.agreement_version
                || context.agreement.sha256 !== body.agreement_sha256) {
              sendJson(response, 409, { error: "The agreement changed. Review and accept the current PDF." });
              return;
            }
            const signerName = typeof body.signer_name === "string" ? body.signer_name.trim() : "";
            if (signerName.length < 2
                || signerName.toLocaleLowerCase() !== context.tokens["reporter.full_name"].toLocaleLowerCase()) {
              sendJson(response, 400, { error: "Enter your account full name as the agreement signer." });
              return;
            }
            const pdf = await createReporterAgreementPdf(
              normalizeReporterServiceAgreementTemplate(context.agreement.template_content),
              context.tokens,
              { allowedTokens: reporterServiceAgreementRenderTokens }
            );
            const generatedDocument = await uploadReporterAgreementAcceptancePdf(
              pdf,
              session.identity.id,
              session.token
            );
            const result = await supabaseRequest("/rest/v1/rpc/chowk_accept_current_reporter_agreement_with_document", {
              method: "POST",
              token: session.token,
              body: {
                accepted_version: body.agreement_version,
                accepted_sha256: body.agreement_sha256,
                signer_name: body.signer_name,
                acceptance_statement: body.acceptance_statement,
                target_document_sha256: generatedDocument.sha256,
                target_document_path: generatedDocument.object_path
              }
            });
            if (!result.response.ok) {
              try {
                await removeReporterAgreementPdf(generatedDocument.object_path, session.token);
              } catch (error) {
                console.error("Could not remove an unrecorded generated reporter agreement:", error.message);
              }
            }
            sendJson(response, result.response.status, result.response.ok
              ? { success: true }
              : { error: apiErrorMessage(result.payload, "Agreement acceptance could not be recorded.") });
            return;
          }
          if (requestUrl.pathname === "/api/reporter/service-agreement/accept" && request.method === "POST") {
            const body = await readJsonBody(request);
            const context = await reporterServiceAgreementContext(session);
            if (!context.tokens) {
              sendJson(response, 409, {
                error: "Only an administrator-issued personalized service agreement can be accepted."
              });
              return;
            }
            if (context.agreement.version !== body.agreement_version
                || context.agreement.sha256 !== body.agreement_sha256) {
              sendJson(response, 409, { error: "The service agreement changed. Review and accept the current version." });
              return;
            }
            const signerName = typeof body.signer_name === "string" ? body.signer_name.trim() : "";
            if (signerName.length < 2
                || signerName.toLocaleLowerCase() !== context.reporterName.trim().toLocaleLowerCase()) {
              sendJson(response, 400, { error: "Enter your account full name as the agreement signer." });
              return;
            }
            const issueId = Number(body.issue_id);
            if (!Number.isSafeInteger(issueId) || issueId < 1) {
              sendJson(response, 409, {
                error: "Chowk has not issued your personalized agreement yet. Contact an administrator if this message continues."
              });
              return;
            }
            const result = await supabaseRequest(
              "/rest/v1/rpc/chowk_accept_reporter_service_agreement_issue",
              {
                method: "POST",
                token: session.token,
                body: {
                  target_issue: issueId,
                  signer_name: signerName,
                  acceptance_statement: body.acceptance_statement
                }
              }
            );
            sendJson(response, result.response.status, result.response.ok
              ? { success: true }
              : { error: apiErrorMessage(result.payload, "Service agreement acceptance could not be recorded.") });
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
    });
    return;
  }

  if (requestUrl.pathname.startsWith("/api/workspace/")) {
    void requireUser(request, response, userCookie).then((session) => {
      if (session) void workspaceRoute(request, response, requestUrl, session);
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
        }, () => void adminRoute(request, response, requestUrl, session));
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
    void getSession(request, response, adminCookie).then((session) => {
      if (!session || !["admin", "super_admin"].includes(session.identity.role)) {
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
    getSession(request, response, adminCookie).then((session) => {
      if (session && ["admin", "super_admin"].includes(session.identity.role)) {
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
