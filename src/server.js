require("dotenv").config({ quiet: true });

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const QRCode = require("qrcode");

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.resolve(__dirname, "..", "public");
const maxRequestBodyBytes = 1024 * 1024;
const apiTimeoutMs = 20_000;
const userCookie = "chowk_user_session";
const adminCookie = "chowk_admin_session";
const sessionMaxAge = 60 * 60;
const requestContext = new AsyncLocalStorage();
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
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

async function readJsonBody(request) {
  try {
    const text = (await readRawBody(request)).toString("utf8");
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
    let reporterApplication = null;
    if (registration) {
      const accountType = body.account_type === undefined ? "subscriber" : body.account_type;
      if (!["subscriber", "reporter"].includes(accountType)) {
        sendJson(response, 400, { error: "Choose a valid account type." });
        return;
      }
      if (body.accepted_policies !== true) {
        sendJson(response, 400, { error: "Accept the site policies before creating an account." });
        return;
      }
      if (accountType === "reporter") {
        const stateId = Number(body.state_id);
        const rtoId = Number(body.rto_office_id);
        const reporterTypeId = Number(body.reporter_type_id);
        if (![stateId, rtoId, reporterTypeId].every((id) => Number.isSafeInteger(id) && id > 0)) {
          sendJson(response, 400, { error: "Choose a state, an RTO/reporting area, and a reporter type." });
          return;
        }
        if (body.accepted_reporter_agreement !== true) {
          sendJson(response, 400, { error: "Read and accept the current reporter agreement before applying." });
          return;
        }
        const { response: optionsResponse, payload: options } = await supabaseRequest(
          "/rest/v1/rpc/chowk_reporter_options"
        );
        if (!optionsResponse.ok) {
          sendJson(response, optionsResponse.status, {
            error: apiErrorMessage(options, "Reporter application setup could not be verified.")
          });
          return;
        }
        const state = (options.states || []).find((item) => Number(item.id) === stateId && item.is_active);
        const rto = (options.rtos || []).find((item) =>
          Number(item.id) === rtoId && Number(item.state_id) === stateId
        );
        const reporterType = (options.types || []).find((item) =>
          Number(item.id) === reporterTypeId
        );
        const agreement = options.agreement;
        if (!state || !rto || !reporterType) {
          sendJson(response, 400, { error: "The selected state, RTO/reporting area, or reporter type is no longer active. Refresh the registration form." });
          return;
        }
        if (!agreement
            || body.agreement_version !== agreement.version
            || body.agreement_sha256 !== agreement.sha256) {
          sendJson(response, 409, { error: "The reporter agreement changed or is not published. Refresh and review the current agreement." });
          return;
        }
        reporterApplication = {
          state_id: stateId,
          rto_office_id: rtoId,
          reporter_type_id: reporterTypeId,
          accepted_reporter_agreement: true,
          agreement_version: agreement.version,
          agreement_sha256: agreement.sha256,
          signer_name: body.name.trim(),
          acceptance_statement: "I have read and accept the Chowk reporter agreement."
        };
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
              account_type: reporterApplication ? "reporter" : "subscriber",
              accepted_policies: body.accepted_policies === true,
              full_name: body.name.trim(),
              phone: body.phone.trim(),
              ...(reporterApplication ? { reporter_application: reporterApplication } : {})
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

    const collections = {
      locations: {
        table: "locations",
        select: "id,name,slug,location_type,parent_id,is_active,created_at",
        order: "location_type.asc,name.asc",
        fields: ["name", "slug", "location_type", "parent_id", "is_active"]
      },
      "reporter-types": {
        table: "reporter_types",
        select: "id,name,type_code,description,is_active,created_at",
        order: "name.asc",
        fields: ["name", "type_code", "description", "is_active"]
      },
      "reporter-applications": {
        table: "reporter_applications",
        select: "id,user_id,reporter_type_id,location_id,state_id,rto_office_id,agreement_accepted,agreement_version,agreement_sha256,agreement_document_url,agreement_signer_name,agreement_acceptance_statement,agreement_accepted_at,status,review_note,reviewed_by,reviewed_at,company_signer_name,company_signer_designation,company_signature_accepted,company_signed_at,company_signature_statement,created_at,user:profiles!reporter_applications_user_id_fkey(id,email,full_name,phone),state:states(state_name,state_code),rto:rto_offices(rto_code,city_name),reporter_type:reporter_types(name,type_code),acceptances:reporter_agreement_acceptances(agreement_version,agreement_sha256,signer_name,acceptance_statement,accepted_at)",
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
        supabaseRequest("/rest/v1/reporter_assignments?select=id,user_id,rto_office_id,reporter_type_id,effective_from,effective_to,rto:rto_offices(rto_code,city_name,state:states(state_code,state_name)),reporter_type:reporter_types(name,type_code)&order=effective_from.desc&limit=2000", { token })
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
      const [states, rtos, types, agreements] = await Promise.all([
        supabaseRequest("/rest/v1/states?select=id,state_code,state_name,is_active&order=state_name.asc&limit=500", { token }),
        supabaseRequest("/rest/v1/rto_offices?select=id,state_id,rto_code,city_name,is_active&order=rto_code.asc&limit=1000", { token }),
        supabaseRequest("/rest/v1/reporter_types?select=id,name,type_code,description,is_active&order=name.asc&limit=500", { token }),
        supabaseRequest("/rest/v1/reporter_agreement_versions?select=id,version,sha256,document_url,status,published_at&order=created_at.desc&limit=100", { token })
      ]);
      for (const result of [states, rtos, types, agreements]) {
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
        reporter_types: types.payload || [],
        agreements: agreements.payload || []
      } });
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
      const type = Number(body.reporter_type_id);
      if (!Number.isSafeInteger(rto) || rto < 1 || !Number.isSafeInteger(type) || type < 1) {
        sendJson(response, 400, { error: "Choose an active RTO and reporter type." });
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

    if (pathname === "/api/admin/reporter-coverage" && request.method === "GET") {
      const [assignments, profiles, locations] = await Promise.all([
        supabaseRequest("/rest/v1/user_coverage_assignments?select=id,user_id,zone_id,district_id,city_id,coverage_area_id,include_descendants,valid_from,valid_to,assigned_by,created_at&order=valid_from.desc&limit=500", { token }),
        supabaseRequest("/rest/v1/profiles?select=id,email,full_name,role&role=in.(reporter,moderator,editor)&order=full_name.asc&limit=500", { token }),
        supabaseRequest("/rest/v1/locations?select=id,name,location_type,parent_id,is_active&is_active=eq.true&order=location_type.asc,name.asc&limit=1000", { token })
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

    if (pathname === "/api/admin/zone-district-mappings" && request.method === "GET") {
      const result = await supabaseRequest(
        "/rest/v1/zone_districts?select=id,zone_id,district_id,valid_from,valid_to,assigned_by,created_at&order=valid_from.desc&limit=1000",
        { token }
      );
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload || [] }
        : { error: apiErrorMessage(result.payload, "Zone/district mapping history could not be loaded.") });
      return;
    }

    if (pathname === "/api/admin/zone-district-mappings" && request.method === "POST") {
      const body = await readJsonBody(request);
      const zoneId = Number(body.zone_id);
      const districtId = Number(body.district_id);
      if (!Number.isSafeInteger(zoneId) || zoneId < 1 || !Number.isSafeInteger(districtId) || districtId < 1) {
        sendJson(response, 400, { error: "Choose a zone and district to map." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_assign_district_zone", {
        method: "POST",
        token,
        body: { target_zone: zoneId, target_district: districtId }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: { id: result.payload } }
        : { error: apiErrorMessage(result.payload, "District could not be mapped to the zone.") });
      return;
    }

    const endZoneDistrictMapping = pathname.match(/^\/api\/admin\/zone-district-mappings\/(\d+)\/end$/);
    if (endZoneDistrictMapping && request.method === "POST") {
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_end_district_zone", {
        method: "POST",
        token,
        body: { target_mapping: Number(endZoneDistrictMapping[1]) }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Zone/district mapping could not be ended.") });
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
      sendJson(response, 200, { success: true, data: {
        credentials: credentials.payload || [],
        staff: staff.payload || []
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
        scope.coverage_name, scope.reporter_type
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

    if (pathname === "/api/admin/reporter-agreements" && request.method === "GET") {
      const result = await supabaseRequest(
        "/rest/v1/reporter_agreement_versions?select=id,version,sha256,document_url,status,created_by,published_by,published_at,created_at&order=created_at.desc",
        { token }
      );
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Reporter agreements could not be loaded.") });
      return;
    }

    if (pathname === "/api/admin/reporter-agreements" && request.method === "POST") {
      const body = await readJsonBody(request);
      const version = typeof body.version === "string" ? body.version.trim() : "";
      const sha256 = typeof body.sha256 === "string" ? body.sha256.trim().toLowerCase() : "";
      const documentUrl = typeof body.document_url === "string" ? body.document_url.trim() : "";
      if (!/^[a-zA-Z0-9._-]{1,40}$/.test(version) || !/^[a-f0-9]{64}$/.test(sha256)) {
        sendJson(response, 400, { error: "Enter a short version label and a 64-character SHA-256 hash." });
        return;
      }
      try {
        const parsedUrl = new URL(documentUrl);
        if (parsedUrl.protocol !== "https:") throw new Error("invalid");
      } catch {
        sendJson(response, 400, { error: "Enter a valid agreement document URL." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/reporter_agreement_versions", {
        method: "POST",
        token,
        body: { version, sha256, document_url: documentUrl, created_by: session.identity.id },
        prefer: "return=representation"
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload?.[0] }
        : { error: apiErrorMessage(result.payload, "Agreement version could not be added.") });
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
        "profiles", "articles", "categories", "locations", "reporter_types",
        "reporter_applications", "live_streams", "article_reports", "comments", "media_catalog",
        "states", "rto_offices", "reporter_agreement_versions", "reporter_agreement_acceptances",
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

    const collectionMatch = pathname.match(/^\/api\/admin\/(locations|reporter-types|reporter-applications|live-streams|reports|comments|media|audit-logs)$/);
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
      if (collection.table === "reporter_types" &&
          (typeof record.type_code !== "string" || !/^\d{2}$/.test(record.type_code))) {
        sendJson(response, 400, { error: "Reporter type code must contain exactly two digits." });
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
        : { error: apiErrorMessage(result.payload, `The ${collection.table} record could not be created.`) });
      return;
    }

    const collectionRecord = pathname.match(/^\/api\/admin\/(locations|reporter-types|live-streams|reports|comments|media)\/(\d+)$/);
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
      if (config.table === "reporter_types" && record.type_code !== undefined &&
          (typeof record.type_code !== "string" || !/^\d{2}$/.test(record.type_code))) {
        sendJson(response, 400, { error: "Reporter type code must contain exactly two digits." });
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
        : { error: apiErrorMessage(result.payload, "The newsroom record could not be updated.") });
      return;
    }

    const applicationReview = pathname.match(/^\/api\/admin\/reporter-applications\/(\d+)\/review$/);
    if (applicationReview && request.method === "POST") {
      const body = await readJsonBody(request);
      const decision = body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : "";
      if (!decision) {
        sendJson(response, 400, { error: "Choose approve or reject." });
        return;
      }
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_review_reporter_application", {
        method: "POST",
        token,
        body: {
          target_application: Number(applicationReview[1]),
          decision,
          note: body.note || "",
          signer_name: body.signer_name || "",
          signer_designation: body.signer_designation || "",
          signature_accepted: body.signature_accepted === true
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
      const result = await supabaseRequest("/rest/v1/categories?select=id,name,slug,is_active,created_at&order=name.asc", { token });
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
      const allowed = ["name", "slug", "is_active"];
      const record = Object.fromEntries(allowed.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
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
    const reporterProvisionItem = pathname.match(/^\/api\/admin\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/reporter-provisioning$/i);
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
      const safeBody = body && Object.fromEntries(
        ["name", "slug", "is_active"].filter((key) => body[key] !== undefined).map((key) => [key, body[key]])
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
        sendJson(response, 400, { error: "Reporter roles require a state, RTO, reporter type, and reporter ID. Use the reporter provisioning workflow." });
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

    if (reporterProvisionItem && request.method === "POST") {
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: "Cross-origin request rejected." });
        return;
      }
      const body = await readJsonBody(request);
      const stateId = Number(body.state_id);
      const rtoId = Number(body.rto_office_id);
      const reporterTypeId = Number(body.reporter_type_id);
      if (![stateId, rtoId, reporterTypeId].every((value) => Number.isSafeInteger(value) && value > 0)) {
        sendJson(response, 400, { error: "Choose an active state, RTO/reporting area, and reporter type." });
        return;
      }
      const [profile, state, rto, reporterType] = await Promise.all([
        supabaseRequest(`/rest/v1/profiles?select=role&id=eq.${reporterProvisionItem[1]}&limit=1`, { token }),
        supabaseRequest(`/rest/v1/states?select=id&id=eq.${stateId}&is_active=eq.true&limit=1`, { token }),
        supabaseRequest(`/rest/v1/rto_offices?select=id,state_id&id=eq.${rtoId}&is_active=eq.true&limit=1`, { token }),
        supabaseRequest(`/rest/v1/reporter_types?select=id&id=eq.${reporterTypeId}&is_active=eq.true&limit=1`, { token })
      ]);
      for (const result of [profile, state, rto, reporterType]) {
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
      if (!state.payload?.[0] || !rto.payload?.[0] || !reporterType.payload?.[0]
          || Number(rto.payload[0].state_id) !== stateId) {
        sendJson(response, 400, { error: "Choose an active RTO/reporting area belonging to the selected state and an active reporter type." });
        return;
      }
      const previousRole = profile.payload[0].role;
      if (previousRole !== "reporter") {
        const promoted = await supabaseRequest("/rest/v1/rpc/chowk_admin_set_user_role", {
          method: "POST",
          token,
          body: { target_user: reporterProvisionItem[1], new_role: "reporter" }
        });
        if (!promoted.response.ok) {
          sendJson(response, promoted.response.status, {
            error: apiErrorMessage(promoted.payload, "User could not be promoted to reporter.")
          });
          return;
        }
      }
      const assigned = await supabaseRequest("/rest/v1/rpc/chowk_admin_assign_reporter", {
        method: "POST",
        token,
        body: { target_user: reporterProvisionItem[1], target_rto: rtoId, target_type: reporterTypeId }
      });
      if (!assigned.response.ok) {
        if (previousRole !== "reporter") {
          const restored = await supabaseRequest("/rest/v1/rpc/chowk_admin_set_user_role", {
            method: "POST",
            token,
            body: { target_user: reporterProvisionItem[1], new_role: previousRole }
          });
          sendJson(response, 502, {
            error: restored.response.ok
              ? `Reporter provisioning failed and the previous account role was restored: ${apiErrorMessage(assigned.payload, "reporter assignment failed.")}`
              : `Reporter provisioning failed, and the previous role could not be restored: ${apiErrorMessage(restored.payload, "role restoration failed.")}`,
            recovery_required: !restored.response.ok
          });
          return;
        }
        sendJson(response, 502, {
          error: `Reporter provisioning failed. The existing reporter role remains active; retry the assignment: ${apiErrorMessage(assigned.payload, "reporter assignment failed.")}`,
          recovery_required: true
        });
        return;
      }
      const reporterProfile = await supabaseRequest(
        `/rest/v1/reporter_profiles?select=reporter_code&user_id=eq.${reporterProvisionItem[1]}&limit=1`,
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
      if (!["subscriber", "reporter", "moderator", "editor", "publisher", "admin", "super_admin"].includes(role)) {
        sendJson(response, 400, { error: "Select a valid account role." });
        return;
      }
      if (role === "super_admin" && session.identity.role !== "super_admin") {
        sendJson(response, 403, { error: "Only a super admin can create another super admin." });
        return;
      }
      let reporterAssignment;
      if (role === "reporter") {
        const stateId = Number(body.state_id);
        const rtoId = Number(body.rto_office_id);
        const reporterTypeId = Number(body.reporter_type_id);
        if (![stateId, rtoId, reporterTypeId].every((value) => Number.isSafeInteger(value) && value > 0)) {
          sendJson(response, 400, { error: "Reporter accounts require an active state, RTO/reporting area, and reporter type." });
          return;
        }
        const [state, rto, reporterType] = await Promise.all([
          supabaseRequest(`/rest/v1/states?select=id&id=eq.${stateId}&is_active=eq.true&limit=1`, { token }),
          supabaseRequest(`/rest/v1/rto_offices?select=id,state_id&id=eq.${rtoId}&is_active=eq.true&limit=1`, { token }),
          supabaseRequest(`/rest/v1/reporter_types?select=id&id=eq.${reporterTypeId}&is_active=eq.true&limit=1`, { token })
        ]);
        for (const result of [state, rto, reporterType]) {
          if (!result.response.ok) {
            sendJson(response, result.response.status, {
              error: apiErrorMessage(result.payload, "Reporter account options could not be validated.")
            });
            return;
          }
        }
        if (!state.payload?.[0] || !rto.payload?.[0] || !reporterType.payload?.[0]
            || Number(rto.payload[0].state_id) !== stateId) {
          sendJson(response, 400, { error: "Choose an active RTO/reporting area belonging to the selected state and an active reporter type." });
          return;
        }
        reporterAssignment = { stateId, rtoId, reporterTypeId };
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
      let reporterCode = null;
      if (reporterAssignment) {
        const assigned = await supabaseRequest("/rest/v1/rpc/chowk_admin_assign_reporter", {
          method: "POST",
          token,
          body: {
            target_user: createdUser.id,
            target_rto: reporterAssignment.rtoId,
            target_type: reporterAssignment.reporterTypeId
          }
        });
        if (!assigned.response.ok) {
          sendJson(response, 502, {
            error: `The account was created and its reporter role was assigned, but reporter provisioning failed. Refresh Users, then use Reporter assignment on that account to retry: ${apiErrorMessage(assigned.payload, "reporter assignment failed.")}`,
            data: { user_id: createdUser.id },
            recovery_required: true
          });
          return;
        }
        const reporterProfile = await supabaseRequest(
          `/rest/v1/reporter_profiles?select=reporter_code&user_id=eq.${createdUser.id}&limit=1`,
          { token }
        );
        if (!reporterProfile.response.ok || !reporterProfile.payload?.[0]?.reporter_code) {
          sendJson(response, 502, {
            error: "The reporter was provisioned, but the generated reporter ID could not be loaded. Refresh the reporter directory.",
            data: { user_id: createdUser.id },
            recovery_required: true
          });
          return;
        }
        reporterCode = reporterProfile.payload[0].reporter_code;
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
            ...(reporterAssignment ? {
              state_id: reporterAssignment.stateId,
              rto_office_id: reporterAssignment.rtoId,
              reporter_type_id: reporterAssignment.reporterTypeId,
              reporter_code: reporterCode
            } : {}),
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
        data: { ...profile.payload[0], ...(reporterCode ? { reporter_code: reporterCode } : {}) }
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
        const result = await supabaseRequest("/rest/v1/categories?select=id,name,slug&is_active=eq.true&order=name.asc");
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

  if (requestUrl.pathname === "/api/reporter/options" && request.method === "GET") {
    void (async () => {
      try {
        const result = await supabaseRequest("/rest/v1/rpc/chowk_reporter_options");
        sendJson(response, result.response.status, result.response.ok
          ? { success: true, data: result.payload }
          : { error: apiErrorMessage(result.payload, "Reporter options could not be loaded.") });
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
      void (async () => {
        try {
          if (requestUrl.pathname === "/api/reporter/status" && request.method === "GET") {
            const result = await supabaseRequest("/rest/v1/rpc/chowk_reporter_status", {
              method: "POST",
              token: session.token
            });
            sendJson(response, result.response.status, result.response.ok
              ? { success: true, data: result.payload }
              : { error: apiErrorMessage(result.payload, "Reporter status could not be loaded.") });
            return;
          }
          if (requestUrl.pathname === "/api/reporter/applications" && request.method === "POST") {
            const body = await readJsonBody(request);
            const required = ["state_id", "rto_office_id", "reporter_type_id", "agreement_version", "agreement_sha256", "signer_name", "acceptance_statement"];
            if (required.some((key) => body[key] === undefined || body[key] === null || String(body[key]).trim() === "")) {
              sendJson(response, 400, { error: "Complete all reporter application and agreement fields." });
              return;
            }
            const ids = [body.state_id, body.rto_office_id, body.reporter_type_id].map(Number);
            if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
              sendJson(response, 400, { error: "Choose a valid state, RTO and reporter type." });
              return;
            }
            const result = await supabaseRequest("/rest/v1/rpc/chowk_submit_reporter_application", {
              method: "POST",
              token: session.token,
              body: {
                target_state: ids[0],
                target_rto: ids[1],
                target_type: ids[2],
                accepted_version: body.agreement_version,
                accepted_sha256: body.agreement_sha256,
                signer_name: body.signer_name,
                acceptance_statement: body.acceptance_statement
              }
            });
            sendJson(response, result.response.status, result.response.ok
              ? { success: true, application_id: result.payload }
              : { error: apiErrorMessage(result.payload, "Reporter application could not be submitted.") });
            return;
          }
          if (requestUrl.pathname === "/api/reporter/agreement/accept" && request.method === "POST") {
            const body = await readJsonBody(request);
            const result = await supabaseRequest("/rest/v1/rpc/chowk_accept_current_reporter_agreement", {
              method: "POST",
              token: session.token,
              body: {
                accepted_version: body.agreement_version,
                accepted_sha256: body.agreement_sha256,
                signer_name: body.signer_name,
                acceptance_statement: body.acceptance_statement
              }
            });
            sendJson(response, result.response.status, result.response.ok
              ? { success: true }
              : { error: apiErrorMessage(result.payload, "Agreement acceptance could not be recorded.") });
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
