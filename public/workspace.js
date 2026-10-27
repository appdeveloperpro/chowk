const workspaceMessage = document.querySelector("#workspace-message");
const queue = document.querySelector("#workspace-queue");
const storyDialog = document.querySelector("#story-dialog");
const storyForm = document.querySelector("#story-form");
const storyError = document.querySelector("#story-form-error");
const mediaFile = document.querySelector("#story-media-file");
const mediaStatus = document.querySelector("#story-media-status");

let identity = null;
let workspaceData = { articles: [], categories: [] };
let editingArticle = null;
const uploadedMediaPaths = new Set();

const roleContent = {
  reporter: {
    eyebrow: "REPORTER DESK",
    heading: "Your story submissions",
    description: "Write drafts, submit stories for review, restore withdrawn drafts, and follow editorial feedback.",
    queue: "My stories",
    queueDescription: "Only your own stories are listed here."
  },
  moderator: {
    eyebrow: "MODERATION DESK",
    heading: "Moderator review queue",
    description: "Start review, preserve revisions, and route stories to the editor or back to reporters.",
    queue: "Stories requiring moderation",
    queueDescription: "Submitted and active moderator review items."
  },
  editor: {
    eyebrow: "EDITORIAL DESK",
    heading: "Editor workspace",
    description: "Review moderator-approved stories, request changes, schedule, and publish.",
    queue: "Editorial queue",
    queueDescription: "Editor review, scheduled, published, and your own drafts."
  },
  publisher: {
    eyebrow: "PUBLISHING DESK",
    heading: "Publishing workspace",
    description: "Manage stories cleared for editorial publication and scheduling.",
    queue: "Ready to publish",
    queueDescription: "Editor review and publication records available to your role."
  }
};

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function showMessage(text, success = false) {
  if (window.ChowkInlineFeedback?.show(success ? "success" : "error", text)) return;
  workspaceMessage.textContent = text;
  workspaceMessage.classList.toggle("success", success);
  workspaceMessage.hidden = false;
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
    window.location.replace("/auth?mode=login&next=%2Fworkspace");
    throw new Error("Sign in to access the newsroom workspace.");
  }
  if (!response.ok) throw new Error(result.error || "The newsroom request could not be completed.");
  return result;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusName(value) {
  return String(value || "draft").replaceAll("_", " ");
}

function addMetric(label, value) {
  const metric = makeElement("article", "workspace-metric");
  metric.append(makeElement("span", "", label), makeElement("strong", "", value));
  document.querySelector("#workspace-metrics").append(metric);
}

function renderMetrics(articles) {
  const metrics = document.querySelector("#workspace-metrics");
  metrics.replaceChildren();
  const counts = new Map();
  articles.forEach((article) => {
    const status = article.workflow_status || article.status || "draft";
    counts.set(status, (counts.get(status) || 0) + 1);
  });
  const preferred = identity.role === "reporter"
    ? [["Drafts", "draft"], ["In review", "submitted"], ["Changes requested", "changes_requested"], ["Published", "published"]]
    : identity.role === "moderator"
      ? [["New", "submitted"], ["In review", "moderator_review"], ["Sent to editor", "editor_review"], ["Returned", "changes_requested"]]
      : [["Editor review", "editor_review"], ["Scheduled", "scheduled"], ["Published", "published"], ["Total visible", "total"]];
  preferred.forEach(([label, status]) =>
    addMetric(label, status === "total" ? String(articles.length) : String(counts.get(status) || 0))
  );
}

async function loadNotifications() {
  const panel = document.querySelector("#workspace-notifications");
  const list = document.querySelector("#workspace-notification-list");
  const summary = document.querySelector("#workspace-notification-summary");
  try {
    const result = await request("/api/workspace/notifications");
    const notifications = result.data || [];
    list.replaceChildren();
    const unreadCount = notifications.filter((item) => !item.is_read).length;
    summary.textContent = unreadCount
      ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"}`
      : "Workflow changes and assignments for your account.";
    panel.hidden = false;
    document.querySelector("#workspace-notifications-read").disabled = unreadCount === 0;
    notifications.forEach((notification) => {
      const row = makeElement("article", `workspace-notification${notification.is_read ? "" : " unread"}`);
      const content = makeElement("div", "workspace-notification-copy");
      content.append(
        makeElement("strong", "", notification.title),
        makeElement("span", "", notification.message || statusName(notification.action)),
        makeElement("small", "", formatDate(notification.created_at))
      );
      row.append(content);
      if (!notification.is_read) {
        addAction(row, "Mark read", async () => {
          try {
            await request(`/api/workspace/notifications/${notification.id}/read`, "POST", {});
            await loadNotifications();
          } catch (error) {
            showMessage(error.message);
          }
        });
      }
      if (notification.article_id) {
        addAction(row, "View story", () => {
          document.querySelector(`#story-${CSS.escape(String(notification.article_id))}`)?.scrollIntoView({ behavior: "smooth" });
        });
      }
      list.append(row);
    });
    if (!notifications.length) list.append(makeElement("p", "workspace-empty", "No newsroom updates yet."));
  } catch (error) {
    panel.hidden = false;
    list.replaceChildren(makeElement("p", "workspace-empty", error.message));
  }
}

function addAction(container, label, action, style = "") {
  const button = makeElement("button", `workspace-action${style ? ` ${style}` : ""}`, label);
  button.type = "button";
  button.addEventListener("click", action);
  container.append(button);
}

function allowedActions(article) {
  const status = article.workflow_status;
  if (identity.role === "reporter" && article.author_id === identity.id) {
    return {
      edit: ["draft", "changes_requested"].includes(status),
      transitions: status === "draft" || status === "changes_requested"
        ? [["submit", "Submit for review"]]
        : ["submitted", "moderator_review"].includes(status)
          ? [["withdraw", "Withdraw submission"]]
          : status === "withdrawn"
            ? [["restore_withdrawn", "Restore to drafts"], ["delete_withdrawn", "Archive withdrawn story"]]
          : []
    };
  }
  if (identity.role === "moderator") {
    return {
      edit: status === "moderator_review",
      transitions: status === "submitted"
        ? [["start_review", "Start review"]]
        : status === "moderator_review"
          ? [["send_to_editor", "Send to editor"], ["request_changes", "Request changes"], ["reject", "Reject"]]
          : []
    };
  }
  if (identity.role === "editor" || identity.role === "publisher") {
    const ownDraft = identity.role === "editor"
      && article.author_id === identity.id
      && status === "draft";
    return {
      edit: ownDraft || (identity.role === "editor"
        ? ["editor_review", "scheduled", "published"].includes(status)
        : status === "editor_review"),
      transitions: status === "editor_review"
        ? [
          ["publish", "Publish now"],
          ["schedule", "Schedule"],
          ...(identity.role === "editor"
            ? [["request_changes", "Request changes"], ["reject", "Reject"]]
            : [])
        ]
        : status === "scheduled"
          ? [["publish", "Publish now"], ["schedule", "Reschedule"], ["unschedule", "Return to editor review"], ["archive", "Archive"]]
          : status === "published"
            ? [["archive", "Archive"]]
            : ownDraft ? [["submit", "Submit for review"]] : []
    };
  }
  return { edit: false, transitions: [] };
}

async function runTransition(article, action) {
  const noteActions = ["request_changes", "reject", "reopen_rejected"];
  const note = noteActions.includes(action)
    ? window.prompt(action === "reject"
      ? "Reason for rejecting this story"
      : action === "reopen_rejected"
        ? "Reason for returning this rejected story to review"
        : "Changes requested from the reporter")
    : "";
  if (noteActions.includes(action) && (!note || note.trim().length < 2)) return;
  let scheduledFor = null;
  if (action === "schedule") {
    const date = window.prompt("Schedule for (local date/time, e.g. 2026-10-24T09:00)");
    if (!date) return;
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime()) || parsed <= new Date()) {
      showMessage("Choose a future publication date and time.");
      return;
    }
    scheduledFor = parsed.toISOString();
  }
  try {
    await request(`/api/workspace/articles/${article.id}/transition`, "POST", {
      action,
      note: note || "",
      scheduled_for: scheduledFor
    });
    showMessage("Story workflow updated.", true);
    await loadWorkspace();
  } catch (error) {
    showMessage(error.message);
  }
}

async function loadHistory(article, details) {
  const list = makeElement("div", "workspace-history-list");
  list.append(makeElement("p", "", "Loading story history…"));
  details.append(list);
  try {
    const result = await request(`/api/workspace/articles/${article.id}/history`);
    const data = result.data || {};
    list.replaceChildren();
    (data.events || []).forEach((event) => {
      const entry = makeElement("article", "workspace-history-entry");
      entry.append(
        makeElement("strong", "", `${statusName(event.from_status || "new")} → ${statusName(event.to_status)} · ${event.action.replaceAll("_", " ")}`),
        makeElement("span", "", `${event.actor_name || "Newsroom"} · ${event.actor_role || "staff"} · ${formatDate(event.created_at)}`)
      );
      if (event.note) entry.append(makeElement("span", "", event.note));
      list.append(entry);
    });
    (data.revisions || []).forEach((revision, index) => {
      const entry = makeElement("details", "workspace-history-entry");
      entry.append(makeElement("summary", "", `Revision ${data.revisions.length - index} · ${formatDate(revision.created_at)}`));
      entry.append(
        makeElement("strong", "", revision.title),
        makeElement("span", "", revision.change_reason || "Previous saved version"),
        makeElement("p", "", revision.content)
      );
      list.append(entry);
    });
    if (!list.childElementCount) list.append(makeElement("p", "", "No workflow changes or saved revisions yet."));
  } catch (error) {
    list.replaceChildren(makeElement("p", "", error.message));
  }
}

function renderQueue(articles) {
  queue.replaceChildren();
  const searchTerm = document.querySelector("#workspace-search").value.trim().toLocaleLowerCase();
  const statusFilter = document.querySelector("#workspace-status-filter").value;
  const filteredArticles = articles.filter((article) => {
    const status = article.workflow_status || article.status || "draft";
    if (statusFilter && status !== statusFilter) return false;
    if (!searchTerm) return true;
    const searchableText = [
      article.title,
      article.excerpt,
      article.content,
      article.author?.full_name,
      article.category?.name,
      article.reporting_location?.name,
      statusName(status)
    ].filter(Boolean).join(" ").toLocaleLowerCase();
    return searchableText.includes(searchTerm);
  });
  const count = document.querySelector("#workspace-story-count");
  count.textContent = filteredArticles.length === articles.length
    ? `${articles.length} ${articles.length === 1 ? "story" : "stories"}`
    : `${filteredArticles.length} of ${articles.length} stories`;
  if (!filteredArticles.length) {
    const hasFilters = searchTerm || statusFilter;
    queue.append(makeElement(
      "p",
      "workspace-empty",
      hasFilters ? "No stories match these filters. Try another search or status." : "There are no stories in this view right now."
    ));
    return;
  }
  filteredArticles.forEach((article) => {
    const card = makeElement("article", "workspace-story");
    card.id = `story-${article.id}`;
    const top = makeElement("div", "workspace-story-top");
    top.append(
      makeElement("h3", "", article.title || "Untitled story"),
      makeElement("span", `workspace-status ${article.workflow_status}`, statusName(article.workflow_status))
    );
    card.append(top);
    const imageUrl = article.image_url_display_url || article.image_url;
    if (imageUrl) {
      const image = makeElement("img", "workspace-story-image");
      image.src = imageUrl;
      image.alt = "";
      image.loading = "lazy";
      card.append(image);
    }
    const videoUrl = article.video_url_display_url || article.video_url;
    const audioUrl = article.audio_url_display_url || article.audio_url;
    if (videoUrl || audioUrl) {
      const mediaLinks = makeElement("p", "workspace-story-media");
      if (videoUrl) {
        const link = makeElement("a", "", "Open attached video");
        link.href = videoUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        mediaLinks.append(link);
      }
      if (audioUrl) {
        const link = makeElement("a", "", "Open attached audio");
        link.href = audioUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        mediaLinks.append(link);
      }
      card.append(mediaLinks);
    }
    card.append(makeElement("p", "workspace-story-summary", article.excerpt || String(article.content || "").slice(0, 240)));
    const meta = makeElement("p", "workspace-story-meta");
    meta.append(
      makeElement("span", "", `By ${article.author?.full_name || "Newsroom staff"}`),
      makeElement("span", "", article.category?.name || "Uncategorized"),
      makeElement("span", "", article.reporting_location?.name || "Location not set"),
      makeElement("span", "", `Updated ${formatDate(article.workflow_updated_at || article.updated_at)}`),
      ...(article.submitted_at ? [makeElement("span", "", `Submitted ${formatDate(article.submitted_at)}`)] : [])
    );
    card.append(meta);
    if (article.review_note) card.append(makeElement("p", "workspace-story-summary", `Editorial note: ${article.review_note}`));
    const actions = makeElement("div", "workspace-story-actions");
    const capabilities = allowedActions(article);
    if (capabilities.edit) addAction(actions, "Edit story", () => openStoryDialog(article));
    capabilities.transitions.forEach(([action, label]) => addAction(
      actions, label, () => void runTransition(article, action),
      ["reject", "withdraw", "archive"].includes(action) ? "danger" : ""
    ));
    const history = makeElement("details", "workspace-history");
    history.append(makeElement("summary", "", "Workflow & revision history"));
    history.addEventListener("toggle", () => {
      if (history.open && history.childElementCount === 1) void loadHistory(article, history);
    });
    card.append(actions, history);
    queue.append(card);
  });
}

function updateStatusFilter(articles) {
  const filter = document.querySelector("#workspace-status-filter");
  const selected = filter.value;
  const statuses = [...new Set(articles.map((article) =>
    article.workflow_status || article.status || "draft"
  ))].sort();
  filter.replaceChildren(new Option("All statuses", ""));
  statuses.forEach((status) => filter.append(new Option(statusName(status), status)));
  filter.value = statuses.includes(selected) ? selected : "";
}

function populateCategories(categories, selected = "") {
  const select = storyForm.elements.category_id;
  select.replaceChildren(new Option("No category", ""));
  categories.forEach((category) => {
    const option = new Option(category.name, String(category.id));
    option.selected = String(category.id) === String(selected);
    select.append(option);
  });
}

function populateLocations(locations, selected = "") {
  const select = storyForm.elements.reporting_location_id;
  select.replaceChildren(new Option("Choose a reporting location", ""));
  locations.forEach((location) => {
    const option = new Option(`${location.name} · ${location.location_type}`, String(location.id));
    option.selected = String(location.id) === String(selected);
    select.append(option);
  });
  select.disabled = locations.length === 0;
}

function slugFromTitle(title) {
  return title.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function openStoryDialog(article = null) {
  editingArticle = article;
  storyForm.reset();
  storyError.hidden = true;
  document.querySelector("#story-dialog-title").textContent = article ? "Edit story" : "New story draft";
  document.querySelector("#story-dialog-help").textContent = article
    ? "A snapshot of the previous story version is saved to history when you save."
    : "Save a private draft. It will not appear in public news until editorial approval.";
  document.querySelector("#change-reason-field").hidden = identity.role !== "admin" && identity.role !== "super_admin";
  populateCategories(workspaceData.categories, article?.category_id);
  populateLocations(workspaceData.locations, article?.reporting_location_id);
  storyForm.elements.slug.dataset.touched = article ? "true" : "false";
  if (article) {
    for (const key of ["title", "slug", "excerpt", "content", "category_id", "image_url", "video_url", "audio_url"]) {
      if (article[key] !== null && article[key] !== undefined) storyForm.elements[key].value = article[key];
    }
  }
  storyDialog.showModal();
}

storyForm.elements.title.addEventListener("input", () => {
  if (!editingArticle || storyForm.elements.slug.dataset.touched !== "true") {
    storyForm.elements.slug.value = slugFromTitle(storyForm.elements.title.value);
  }
});
storyForm.elements.slug.addEventListener("input", () => {
  storyForm.elements.slug.dataset.touched = "true";
});
document.querySelector("#workspace-create").addEventListener("click", () => openStoryDialog());
document.querySelector("#workspace-create").addEventListener("click", () => openStoryDialog());
document.querySelector("#story-cancel").addEventListener("click", () => storyDialog.close());
async function discardUnattachedUploads() {
  const paths = [...uploadedMediaPaths];
  uploadedMediaPaths.clear();
  await Promise.all(paths.map(async (path) => {
    try {
      await request("/api/workspace/media", "DELETE", { path });
    } catch (error) {
      console.error("Could not remove an unattached newsroom media upload:", error);
    }
  }));
}
storyDialog.addEventListener("close", () => void discardUnattachedUploads());
mediaFile.addEventListener("change", async () => {
  const file = mediaFile.files?.[0];
  if (!file) return;
  mediaStatus.hidden = false;
  mediaStatus.textContent = "Uploading media securely…";
  mediaFile.disabled = true;
  try {
    const response = await fetch("/api/workspace/media", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": file.type },
      body: file
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Media upload failed.");
    const urlField = file.type.startsWith("image/")
      ? storyForm.elements.image_url
      : file.type.startsWith("video/")
        ? storyForm.elements.video_url
        : storyForm.elements.audio_url;
    urlField.value = result.data.path;
    uploadedMediaPaths.add(result.data.path);
    mediaStatus.textContent = "Upload complete. Save the story to attach this private newsroom media file.";
  } catch (error) {
    mediaStatus.textContent = error instanceof Error ? error.message : "Media upload failed.";
  } finally {
    mediaFile.disabled = false;
  }
});
document.querySelector("#workspace-notifications-read").addEventListener("click", async () => {
  try {
    await request("/api/workspace/notifications/read-all", "POST", {});
    await loadNotifications();
  } catch (error) {
    showMessage(error.message);
  }
});

storyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!storyForm.reportValidity()) return;
  const values = new FormData(storyForm);
  const body = Object.fromEntries(values.entries());
  body.category_id = body.category_id ? Number(body.category_id) : null;
  body.reporting_location_id = body.reporting_location_id ? Number(body.reporting_location_id) : null;
  storyError.hidden = true;
  const submit = storyForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    if (editingArticle) {
      await request(`/api/workspace/articles/${editingArticle.id}`, "PATCH", body);
    } else {
      await request("/api/workspace/articles", "POST", body);
    }
    [...uploadedMediaPaths].forEach((path) => {
      if ([body.image_url, body.video_url, body.audio_url].includes(path)) {
        uploadedMediaPaths.delete(path);
      }
    });
    storyDialog.close();
    showMessage(editingArticle ? "Story saved and previous version retained." : "Draft created.", true);
    await loadWorkspace();
  } catch (error) {
    storyError.textContent = error.message;
    storyError.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

async function loadWorkspace() {
  queue.replaceChildren(makeElement("p", "workspace-loading", "Loading newsroom stories…"));
  try {
    const result = await request("/api/workspace/articles");
    workspaceData = result.data || { articles: [], categories: [], locations: [] };
    updateStatusFilter(workspaceData.articles || []);
    renderQueue(workspaceData.articles || []);
    renderMetrics(workspaceData.articles || []);
    const coveragePanel = document.querySelector("#workspace-coverage");
    const coverageList = document.querySelector("#workspace-coverage-list");
    coverageList.replaceChildren();
    coveragePanel.hidden = !["reporter", "moderator"].includes(identity.role);
    if (!coveragePanel.hidden) {
      (workspaceData.locations || []).forEach((location) => {
        coverageList.append(makeElement(
          "span",
          "workspace-coverage-chip",
          `${location.name} · ${location.location_type}`
        ));
      });
      if (!coverageList.childElementCount) {
        coverageList.append(makeElement("p", "workspace-empty", "No active coverage is assigned. Ask an administrator to assign the correct locations."));
      }
    }
    await loadNotifications();
  } catch (error) {
    queue.replaceChildren(makeElement("p", "workspace-empty", error.message));
  }
}

async function initializeWorkspace() {
  try {
    const result = await request("/api/auth/session");
    identity = result.identity;
    const copy = roleContent[identity.role];
    if (!copy) {
      window.location.replace(identity.role === "subscriber" ? "/reporter" : "/admin/dashboard");
      return;
    }
    document.querySelector("#workspace-name").textContent = identity.name || identity.email;
    document.querySelector("#workspace-role").textContent = identity.role.replaceAll("_", " ");
    document.querySelector("#workspace-avatar").textContent = (identity.name || identity.email || "C").slice(0, 1).toUpperCase();
    document.querySelector("#workspace-eyebrow").textContent = copy.eyebrow;
    document.querySelector("#workspace-heading").textContent = copy.heading;
    document.querySelector("#workspace-description").textContent = copy.description;
    document.querySelector("#queue-heading").textContent = copy.queue;
    document.querySelector("#queue-description").textContent = copy.queueDescription;
    document.querySelector("#workspace-create").hidden = !["reporter", "editor"].includes(identity.role);
    await loadWorkspace();
  } catch (error) {
    queue.replaceChildren(makeElement("p", "workspace-empty", error.message));
  }
}

document.querySelector("#workspace-refresh").addEventListener("click", () => void loadWorkspace());
document.querySelector("#workspace-search").addEventListener("input", () => {
  renderQueue(workspaceData.articles || []);
});
document.querySelector("#workspace-status-filter").addEventListener("change", () => {
  renderQueue(workspaceData.articles || []);
});
document.querySelectorAll(".workspace-nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".workspace-nav-link").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});
document.querySelector("#workspace-sign-out").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/session", { method: "DELETE" });
    if (!response.ok) throw new Error("Could not sign out.");
    window.location.replace("/");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Could not sign out.");
  }
});

initializeWorkspace();
