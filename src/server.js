require("dotenv").config({ quiet: true });

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.resolve(__dirname, "..", "public");
const maxRequestBodyBytes = 1024 * 1024;
const apiTimeoutMs = 20_000;
const userCookie = "chowk_user_session";
const adminCookie = "chowk_admin_session";
const sessionMaxAge = 60 * 60;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data));
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
  const headers = {
    apikey: key,
    Authorization: `Bearer ${options.token || key}`,
    Accept: "application/json",
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

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(request.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > maxRequestBodyBytes) {
      reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
      request.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxRequestBodyBytes) {
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

    const endpoint = registration
      ? "/auth/v1/signup"
      : "/auth/v1/token?grant_type=password";
    const { response: upstream, payload } = await supabaseRequest(endpoint, {
      method: "POST",
      body: registration
        ? {
            email: body.email.trim(),
            password: body.password,
            data: { full_name: body.name.trim(), phone: body.phone.trim() }
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
    setSessionCookies(response, registration ? userCookie : (
      request.url.startsWith("/api/admin/session") ? adminCookie : userCookie
    ), token, payload.refresh_token);
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
      select: "id,title,slug,excerpt,content,category_id,category:categories(name,slug),image_url,published_at,created_at",
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
    const data = Array.isArray(result.payload) ? result.payload.map((article) => ({
      ...article,
      description: article.excerpt,
      category_name: article.category?.name || null
    })) : [];
    sendJson(response, 200, { success: true, data });
  } catch (error) {
    console.error("Supabase news request failed:", error.message);
    sendJson(response, 503, { error: "News service is unavailable. Check Supabase configuration and schema." });
  }
}

async function adminRoute(request, response, requestUrl, session) {
  const { token } = session;
  const pathname = requestUrl.pathname;
  try {
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
        select: "id,title,slug,excerpt,content,category_id,image_url,status,published_at,created_at",
        order: "created_at.desc",
        limit: "100"
      });
      const result = await supabaseRequest(`/rest/v1/articles?${query}`, { token });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Articles could not be loaded.") });
      return;
    }

    const articleDetail = pathname.match(/^\/api\/admin\/articles\/(\d+)$/);
    if (articleDetail && request.method === "GET") {
      const result = await supabaseRequest(
        `/rest/v1/articles?select=id,title,slug,excerpt,content,category_id,image_url,status,published_at,created_at&id=eq.${articleDetail[1]}&limit=1`,
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
      const result = await supabaseRequest("/rest/v1/profiles?select=id,full_name,phone,role,created_at&order=created_at.desc&limit=100", { token });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload }
        : { error: apiErrorMessage(result.payload, "Users could not be loaded.") });
      return;
    }

    if (request.method === "POST" && ["/api/admin/articles", "/api/admin/categories"].includes(pathname)) {
      const body = await readJsonBody(request);
      const isArticle = pathname.endsWith("/articles");
      const table = isArticle ? "articles" : "categories";
      const allowed = isArticle
        ? ["title", "slug", "excerpt", "content", "category_id", "image_url", "status"]
        : ["name", "slug", "is_active"];
      const record = Object.fromEntries(allowed.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
      if (isArticle) {
        record.author_id = session.identity.id;
        if (record.status === "published") record.published_at = new Date().toISOString();
      }
      const result = await supabaseRequest(`/rest/v1/${table}`, { method: "POST", token, body: record, prefer: "return=representation" });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload?.[0] }
        : { error: apiErrorMessage(result.payload, "The record could not be created.") });
      return;
    }

    const articlePublish = pathname.match(/^\/api\/admin\/articles\/(\d+)\/publish$/);
    const articleItem = pathname.match(/^\/api\/admin\/articles\/(\d+)$/);
    const categoryItem = pathname.match(/^\/api\/admin\/categories\/(\d+)$/);
    const roleItem = pathname.match(/^\/api\/admin\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/role$/i);
    if (articlePublish && request.method === "POST") {
      const result = await supabaseRequest(`/rest/v1/articles?id=eq.${articlePublish[1]}`, {
        method: "PATCH", token, body: { status: "published", published_at: new Date().toISOString() }, prefer: "return=representation"
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true, data: result.payload?.[0] }
        : { error: apiErrorMessage(result.payload, "Article could not be published.") });
      return;
    }

    if (articleItem && ["PATCH", "DELETE"].includes(request.method)) {
      const endpoint = `/rest/v1/articles?id=eq.${articleItem[1]}`;
      const body = request.method === "PATCH" ? await readJsonBody(request) : undefined;
      const safeBody = body && Object.fromEntries(
        ["title", "slug", "excerpt", "content", "category_id", "image_url", "status", "published_at"]
          .filter((key) => body[key] !== undefined).map((key) => [key, body[key]])
      );
      const result = await supabaseRequest(endpoint, {
        method: request.method, token, body: safeBody, prefer: "return=representation"
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
      const result = await supabaseRequest("/rest/v1/rpc/chowk_admin_set_user_role", {
        method: "POST", token, body: { target_user: roleItem[1], new_role: body.role }
      });
      sendJson(response, result.response.status, result.response.ok
        ? { success: true }
        : { error: apiErrorMessage(result.payload, "Role could not be updated.") });
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

  if (requestUrl.pathname.startsWith("/api/admin/")) {
    void requireAdmin(request, response).then((session) => {
      if (session) void adminRoute(request, response, requestUrl, session);
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
  serveStatic(response, pathname === "/auth" ? "/auth.html" : pathname);
});

server.listen(port, host, () => {
  console.log(`Chowk News is running on ${host}:${port}`);
});
