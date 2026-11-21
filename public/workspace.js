const workspaceMessage = document.querySelector("#workspace-message");
const queue = document.querySelector("#workspace-queue");
const storyDialog = document.querySelector("#story-dialog");
const storyForm = document.querySelector("#story-form");
const storyError = document.querySelector("#story-form-error");
const mediaFile = document.querySelector("#story-media-file");
const mediaStatus = document.querySelector("#story-media-status");
const assetDialog = document.querySelector("#asset-library-dialog");
const assetGrid = document.querySelector("#asset-library-grid");
const assetStatus = document.querySelector("#asset-library-status");
const assetSearch = document.querySelector("#asset-library-search");
const assetTypeFilter = document.querySelector("#asset-library-type");
const assetStatusFilter = document.querySelector("#asset-library-status-filter");
const assetUpload = document.querySelector("#asset-library-upload");
const thumbnailCandidatesPanel = document.querySelector("#video-thumbnail-candidates");
const thumbnailOptions = document.querySelector("#video-thumbnail-options");
const thumbnailPreview = document.querySelector("#story-thumbnail-preview");
const thumbnailPreviewImage = document.querySelector("#story-thumbnail-preview-image");

let identity = null;
let workspaceData = { articles: [], categories: [], articleTypes: [] };
let editingArticle = null;
let assetPickerTarget = null;
let currentVideoAssetId = null;
let pendingThumbnailBlob = null;
let pendingThumbnailUploadPath = null;
let thumbnailCandidates = [];
let assetSearchTimer = null;
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
  },
  admin: {
    eyebrow: "ADMIN NEWSROOM",
    heading: "Newsroom administration",
    description: "Manage reusable newsroom media and review story workflow records.",
    queue: "Newsroom stories",
    queueDescription: "Recent story records across the newsroom."
  },
  super_admin: {
    eyebrow: "ADMIN NEWSROOM",
    heading: "Newsroom administration",
    description: "Manage reusable newsroom media and review story workflow records.",
    queue: "Newsroom stories",
    queueDescription: "Recent story records across the newsroom."
  }
};

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function mediaAssetType(mimeType) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  throw new Error("Choose a supported image, video, or audio file.");
}

function setThumbnailPreview(url, alt = "") {
  thumbnailPreview.hidden = !url;
  if (!url) {
    thumbnailPreviewImage.removeAttribute("src");
    thumbnailPreviewImage.alt = "";
    return;
  }
  thumbnailPreviewImage.src = url;
  thumbnailPreviewImage.alt = alt;
}

function updateThumbnailAltRequirement() {
  storyForm.elements.thumbnail_alt_text.required = Boolean(
    storyForm.elements.thumbnail_url.value || pendingThumbnailBlob
  );
}

async function uploadMediaBlob(blob, mimeType) {
  const response = await fetch("/api/workspace/media", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": mimeType },
    body: blob
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Media upload failed.");
  if (typeof result.data?.path !== "string") throw new Error("Media upload returned an invalid file path.");
  uploadedMediaPaths.add(result.data.path);
  return result.data;
}

async function registerUploadedAsset(upload, details) {
  const result = await request("/api/workspace/assets", "POST", {
    path: upload.path,
    asset_type: details.assetType,
    title: details.title.slice(0, 160),
    alt_text: details.altText || "",
    description: details.description || "",
    credit_line: details.creditLine || "",
    license_name: details.licenseName || "",
    mime_type: upload.mime_type,
    file_size: upload.size,
    source_video_asset_id: details.sourceVideoAssetId || null,
    image_width: details.width || null,
    image_height: details.height || null
  });
  if (!result.data?.id) throw new Error("Asset registration returned an invalid record.");
  uploadedMediaPaths.delete(upload.path);
  return result.data;
}

function waitForVideoEvent(video, eventName) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error("Video processing took too long.")), 15000);
    const finish = (error) => {
      window.clearTimeout(timer);
      video.removeEventListener(eventName, onSuccess);
      video.removeEventListener("error", onFailure);
      if (error) reject(error);
      else resolve();
    };
    const onSuccess = () => finish();
    const onFailure = () => finish(new Error("The video could not be decoded in this browser."));
    video.addEventListener(eventName, onSuccess, { once: true });
    video.addEventListener("error", onFailure, { once: true });
  });
}

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("A video thumbnail could not be created."));
      else resolve(blob);
    }, "image/jpeg", 0.86);
  });
}

async function createVideoThumbnailCandidates(file) {
  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  const candidates = [];
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  try {
    const metadataReady = waitForVideoEvent(video, "loadedmetadata");
    video.src = sourceUrl;
    await metadataReady;
    if (!Number.isFinite(video.duration) || video.duration <= 0
        || !video.videoWidth || !video.videoHeight) {
      throw new Error("This video does not contain usable frame information.");
    }
    const edgeMargin = Math.min(0.01, video.duration / 10);
    const earliestTime = edgeMargin;
    const latestTime = Math.max(earliestTime, video.duration - edgeMargin);
    const times = [...new Set(Array.from({ length: 8 }, (_, index) =>
      Math.max(earliestTime, Math.min(video.duration * (0.08 + index * 0.12), latestTime))
    ))];
    for (const time of times) {
      const seeked = waitForVideoEvent(video, "seeked");
      video.currentTime = time;
      await seeked;
      const scale = Math.min(1, 1280 / video.videoWidth, 720 / video.videoHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas is not available for thumbnail generation.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const blob = await canvasToJpeg(canvas);
      candidates.push({
        blob,
        previewUrl: URL.createObjectURL(blob),
        time,
        qualityScore: window.scoreVideoThumbnailFrame(pixels, canvas.width, canvas.height),
        width: canvas.width,
        height: canvas.height
      });
    }
    return candidates.sort((left, right) => right.qualityScore - left.qualityScore);
  } catch (error) {
    candidates.forEach((candidate) => URL.revokeObjectURL(candidate.previewUrl));
    throw error;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
}

async function createVideoThumbnailCandidatesFromAsset(asset) {
  const response = await fetch(`/api/workspace/assets/${encodeURIComponent(asset.id)}/video`, {
    cache: "no-store"
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "The selected library video could not be loaded.");
  }
  const blob = await response.blob();
  if (!blob.size || blob.size > 25 * 1024 * 1024) {
    throw new Error("The selected video is empty or exceeds the 25 MB processing limit.");
  }
  return createVideoThumbnailCandidates(new File([blob], asset.title || "newsroom-video", {
    type: asset.mime_type
  }));
}

function clearThumbnailCandidates() {
  thumbnailCandidates.forEach((candidate) => URL.revokeObjectURL(candidate.previewUrl));
  thumbnailCandidates = [];
  pendingThumbnailBlob = null;
  pendingThumbnailUploadPath = null;
  currentVideoAssetId = null;
  thumbnailOptions.replaceChildren();
  thumbnailCandidatesPanel.hidden = true;
  setThumbnailPreview("");
  updateThumbnailAltRequirement();
}

function renderThumbnailCandidates(candidates) {
  clearThumbnailCandidates();
  thumbnailCandidates = candidates;
  thumbnailCandidatesPanel.hidden = candidates.length === 0;
  candidates.forEach((candidate, index) => {
    const button = makeElement("button", "video-thumbnail-option");
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    const image = makeElement("img");
    image.src = candidate.previewUrl;
    image.alt = `Video frame near ${candidate.time.toFixed(1)} seconds`;
    const label = makeElement("span", "", `${candidate.time.toFixed(1)} seconds${index === 0 && candidate.qualityScore >= 0.35 ? " · Recommended" : ""}`);
    button.append(image, label);
    button.addEventListener("click", () => {
      if (pendingThumbnailUploadPath) pendingThumbnailUploadPath = null;
      pendingThumbnailBlob = candidate.blob;
      updateThumbnailAltRequirement();
      setThumbnailPreview(candidate.previewUrl, `Selected frame near ${candidate.time.toFixed(1)} seconds`);
      thumbnailOptions.querySelectorAll(".video-thumbnail-option").forEach((option) => {
        option.setAttribute("aria-pressed", String(option === button));
      });
      mediaStatus.hidden = false;
      mediaStatus.textContent = candidate.qualityScore < 0.25
        ? "No strong frame was detected. Review this selection carefully or choose a library image."
        : "Thumbnail frame selected. It will be saved to the Asset Library when you save the story.";
    });
    thumbnailOptions.append(button);
    if (index === 0) button.click();
  });
}

async function registerGeneratedThumbnailCandidates(candidates, sourceAsset) {
  let registeredCount = 0;
  for (const candidate of candidates) {
    const upload = await uploadMediaBlob(candidate.blob, "image/jpeg");
    try {
      await registerUploadedAsset(upload, {
        assetType: "video_thumbnail",
        title: `${sourceAsset.title} · ${candidate.time.toFixed(1)}s frame`,
        description: `Suggested frame at ${candidate.time.toFixed(1)} seconds.`,
        creditLine: sourceAsset.credit_line,
        licenseName: sourceAsset.license_name,
        sourceVideoAssetId: sourceAsset.id,
        width: candidate.width,
        height: candidate.height
      });
      registeredCount += 1;
    } catch (error) {
      try {
        await request("/api/workspace/media", "DELETE", { path: upload.path });
        uploadedMediaPaths.delete(upload.path);
      } catch (cleanupError) {
        console.error("Could not remove a generated thumbnail that failed Asset Library registration:", cleanupError);
      }
      throw new Error(
        `Saved ${registeredCount} of ${candidates.length} suggested frames before thumbnail registration failed: ${error.message}`
      );
    }
  }
  return registeredCount;
}

function setThumbnailMetadata(asset = {}) {
  storyForm.elements.thumbnail_alt_text.value = asset.alt_text || "";
  storyForm.elements.thumbnail_credit_line.value = asset.credit_line || "";
  storyForm.elements.thumbnail_license_name.value = asset.license_name || "";
  updateThumbnailAltRequirement();
}

function formatAssetType(type) {
  return type === "video_thumbnail" ? "Video thumbnail" : type.charAt(0).toUpperCase() + type.slice(1);
}

function isAssetCompatible(asset, target) {
  if (target === "video_url") return asset.asset_type === "video";
  if (target === "audio_url") return asset.asset_type === "audio";
  return ["image", "video_thumbnail"].includes(asset.asset_type);
}

function assetEditorField(labelText, name, value, isTextarea = false) {
  const label = makeElement("label", "workspace-field");
  label.append(makeElement("span", "", labelText));
  const control = makeElement(isTextarea ? "textarea" : "input");
  control.name = name;
  control.maxLength = name === "description" ? 1000 : name === "alt_text" ? 500 : 200;
  if (isTextarea) control.rows = 2;
  if (name === "tags") control.value = (value || []).join(", ");
  else control.value = value || "";
  label.append(control);
  return label;
}

function renderAssetLibrary(assets) {
  assetGrid.replaceChildren();
  if (!assets.length) {
    assetGrid.append(makeElement("p", "workspace-empty",
      `No ${assetStatusFilter.value} assets match your search.`));
    return;
  }
  assets.forEach((asset) => {
    const card = makeElement("article", "asset-library-card");
    const preview = makeElement("div", "asset-library-preview");
    if (["image", "video_thumbnail"].includes(asset.asset_type) && asset.preview_url) {
      const image = makeElement("img");
      image.src = asset.preview_url;
      image.alt = asset.alt_text || asset.title;
      image.loading = "lazy";
      preview.append(image);
    } else {
      preview.textContent = formatAssetType(asset.asset_type);
    }
    card.append(preview, makeElement("h3", "", asset.title));
    card.append(makeElement("p", "", formatAssetType(asset.asset_type)));
    if (asset.description) card.append(makeElement("p", "", asset.description));
    if (asset.tags?.length) card.append(makeElement("p", "", `Tags: ${asset.tags.join(", ")}`));
    if (asset.credit_line) card.append(makeElement("p", "", `Credit: ${asset.credit_line}`));
    if (asset.license_name) card.append(makeElement("p", "", `License: ${asset.license_name}`));

    const actions = makeElement("div", "asset-library-card-actions");
    if (assetPickerTarget && asset.status === "active" && isAssetCompatible(asset, assetPickerTarget)) {
      const useButton = makeElement("button", "workspace-button", "Use this asset");
      useButton.type = "button";
      useButton.addEventListener("click", async () => {
        storyForm.elements[assetPickerTarget].value = asset.storage_path;
        if (assetPickerTarget === "thumbnail_url") {
          pendingThumbnailBlob = null;
          pendingThumbnailUploadPath = null;
          setThumbnailMetadata(asset);
          setThumbnailPreview(asset.preview_url, asset.alt_text || asset.title);
        } else if (assetPickerTarget === "video_url") {
          clearThumbnailCandidates();
          storyForm.elements.thumbnail_url.value = "";
          setThumbnailMetadata({
            credit_line: asset.credit_line,
            license_name: asset.license_name
          });
          currentVideoAssetId = asset.id;
          mediaStatus.hidden = false;
          mediaStatus.textContent = "Generating thumbnail suggestions from the library video…";
          assetDialog.close();
          try {
            const candidates = await createVideoThumbnailCandidatesFromAsset(asset);
            renderThumbnailCandidates(candidates);
            currentVideoAssetId = asset.id;
            mediaStatus.textContent = candidates.some((candidate) => candidate.qualityScore >= 0.35)
              ? "Choose a suggested frame, or select a different image from the Asset Library."
              : "No strong frame was detected. Review the suggestions or choose a library image.";
          } catch (error) {
            mediaStatus.textContent = `Video selected, but thumbnail suggestions could not be generated: ${error.message}`;
          }
          return;
        }
        assetDialog.close();
      });
      actions.append(useButton);
    }
    const copyButton = makeElement("button", "workspace-button secondary", "Copy file path");
    copyButton.type = "button";
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(asset.storage_path);
        assetStatus.textContent = "Asset path copied.";
      } catch (error) {
        assetStatus.textContent = error instanceof Error
          ? `Could not copy the path: ${error.message}`
          : "Could not copy the asset path.";
      }
    });
    actions.append(copyButton);
    const archiveButton = makeElement("button", "workspace-button secondary",
      asset.status === "active" ? "Archive" : "Restore");
    archiveButton.type = "button";
    archiveButton.addEventListener("click", async () => {
      const nextStatus = asset.status === "active" ? "archived" : "active";
      if (nextStatus === "archived"
          && !window.confirm(`Archive “${asset.title}”? It will no longer be offered for reuse.`)) return;
      archiveButton.disabled = true;
      try {
        await request(`/api/workspace/assets/${asset.id}`, "PATCH", { status: nextStatus });
        await loadAssetLibrary();
      } catch (error) {
        assetStatus.textContent = error.message;
        archiveButton.disabled = false;
      }
    });
    actions.append(archiveButton);
    card.append(actions);

    const details = makeElement("details", "asset-library-edit");
    details.append(makeElement("summary", "", "Edit metadata"));
    const form = makeElement("form");
    form.append(
      assetEditorField("Asset title", "title", asset.title),
      assetEditorField("Alternative text", "alt_text", asset.alt_text),
      assetEditorField("Description", "description", asset.description, true),
      assetEditorField("Tags (comma-separated)", "tags", asset.tags),
      assetEditorField("Credit / source", "credit_line", asset.credit_line),
      assetEditorField("License", "license_name", asset.license_name)
    );
    const saveButton = makeElement("button", "workspace-button secondary", "Save metadata");
    saveButton.type = "submit";
    form.append(saveButton);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      saveButton.disabled = true;
      const values = new FormData(form);
      const tags = String(values.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean);
      try {
        await request(`/api/workspace/assets/${asset.id}`, "PATCH", {
          title: values.get("title"),
          alt_text: values.get("alt_text"),
          description: values.get("description"),
          tags,
          credit_line: values.get("credit_line"),
          license_name: values.get("license_name")
        });
        await loadAssetLibrary();
      } catch (error) {
        assetStatus.textContent = error.message;
        saveButton.disabled = false;
      }
    });
    details.append(form);
    card.append(details);
    assetGrid.append(card);
  });
}

async function loadAssetLibrary() {
  assetStatus.textContent = "Loading Asset Library…";
  const query = new URLSearchParams();
  const search = assetSearch.value.trim();
  const type = assetTypeFilter.value;
  const status = assetStatusFilter.value;
  if (search) query.set("q", search);
  if (type) query.set("type", type);
  if (status) query.set("status", status);
  try {
    const queryString = query.toString();
    const result = await request(`/api/workspace/assets${queryString ? `?${queryString}` : ""}`);
    renderAssetLibrary(result.data || []);
    assetStatus.textContent = `${result.data?.length || 0} assets`;
  } catch (error) {
    assetGrid.replaceChildren();
    assetStatus.textContent = error.message;
  }
}

async function openAssetLibrary(target = null) {
  assetPickerTarget = target;
  if (target === "video_url") assetTypeFilter.value = "video";
  else if (target === "audio_url") assetTypeFilter.value = "audio";
  else if (target) assetTypeFilter.value = "image";
  else assetTypeFilter.value = "";
  assetStatusFilter.value = "active";
  assetSearch.value = "";
  assetDialog.showModal();
  await loadAssetLibrary();
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
  if (!response.ok) {
    const error = new Error(result.error || "The newsroom request could not be completed.");
    error.status = response.status;
    throw error;
  }
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

function renderTerritoryDashboard(data) {
  const panel = document.querySelector("#workspace-territory");
  const scopeList = document.querySelector("#workspace-territory-scopes");
  const reporters = document.querySelector("#workspace-reporter-list");
  const applications = document.querySelector("#workspace-application-list");
  const counts = data.counts || {};
  const scopes = data.scopes || [];
  const reporterRows = data.reporters || [];
  const applicationRows = data.pending_applications || [];
  document.querySelector("#workspace-territory-nav").hidden = false;
  panel.hidden = false;
  document.querySelector("#workspace-reporter-count").textContent =
    `(${counts.active_reporters || 0})`;
  document.querySelector("#workspace-application-count").textContent =
    `(${(counts.pending_applications || 0) + (counts.needs_information || 0)})`;
  document.querySelector("#workspace-territory-summary").textContent = scopes.length
    ? `Showing reporters and review work across ${scopes.length} assigned location${scopes.length === 1 ? "" : "s"}, including all connected child locations.`
    : data.is_admin
      ? "Administrator access is not limited to assigned locations."
      : "No active geographic scope is assigned. Reporter data remains unavailable until an administrator assigns your locations.";
  scopeList.replaceChildren();
  scopes.forEach((scope) => scopeList.append(makeElement(
    "span",
    "workspace-territory-scope",
    `${scope.name} · ${statusName(scope.location_type)}`
  )));
  if (!scopes.length) {
    scopeList.append(makeElement(
      "span",
      "workspace-territory-scope",
      data.is_admin ? "All locations" : "No locations assigned"
    ));
  }
  reporters.replaceChildren();
  reporterRows.forEach((reporter) => {
    const row = makeElement("article", "workspace-territory-row");
    const identity = makeElement("div", "workspace-territory-identity");
    identity.append(
      makeElement("strong", "", reporter.full_name || "Reporter"),
      makeElement("span", "", [reporter.reporter_code, reporter.email].filter(Boolean).join(" · "))
    );
    row.append(
      identity,
      makeElement("span", "workspace-territory-meta", [
        reporter.designation,
        reporter.reporter_type,
        reporter.location_name
      ].filter(Boolean).join(" · "))
    );
    reporters.append(row);
  });
  if (!reporterRows.length) {
    reporters.append(makeElement("p", "workspace-empty", "No approved reporters are currently connected to these locations."));
  }
  applications.replaceChildren();
  applicationRows.forEach((application) => {
    const row = makeElement("article", "workspace-territory-row");
    const identity = makeElement("div", "workspace-territory-identity");
    identity.append(
      makeElement("strong", "", application.full_name || "Applicant"),
      makeElement("span", "", [application.email, application.location_name].filter(Boolean).join(" · "))
    );
    row.append(
      identity,
      makeElement("span", `workspace-status ${application.status}`, statusName(application.status))
    );
    applications.append(row);
  });
  if (!applicationRows.length) {
    applications.append(makeElement("p", "workspace-empty", "No reporter applications are awaiting review in these locations."));
  }
}

async function loadTerritoryDashboard() {
  const panel = document.querySelector("#workspace-territory");
  const nav = document.querySelector("#workspace-territory-nav");
  panel.hidden = true;
  nav.hidden = true;
  try {
    const result = await request("/api/workspace/reporters/territory");
    renderTerritoryDashboard(result.data || {});
  } catch (error) {
    if (error.status === 403) return;
    panel.hidden = false;
    document.querySelector("#workspace-application-list").replaceChildren();
    document.querySelector("#workspace-reporter-list").replaceChildren(
      makeElement("p", "workspace-empty", error.message)
    );
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
          ...((["opinion", "editorial"].includes(article.content_type)
            && article.opinion_review_status !== "approved")
            ? []
            : [["publish", "Publish now"], ["schedule", "Schedule"]]),
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

async function runOpinionReview(article, decision) {
  const note = decision === "approve"
    ? ""
    : window.prompt(decision === "reject"
      ? "Reason for rejecting this opinion"
      : "Changes requested for this opinion");
  if (decision !== "approve" && (!note || note.trim().length < 2)) return;
  try {
    await request(`/api/workspace/articles/${article.id}/opinion-review`, "POST", {
      decision,
      note: note || ""
    });
    showMessage(
      decision === "approve"
        ? "Opinion approved for publication."
        : decision === "reject"
          ? "Opinion rejected."
          : "Opinion returned for revisions.",
      true
    );
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
        revision.opinion_column_name
          ? makeElement("span", "", `Column: ${revision.opinion_column_name}`)
          : makeElement("span", "", ""),
        revision.conflict_of_interest_disclosure
          ? makeElement("span", "", `Conflict disclosure: ${revision.conflict_of_interest_disclosure}`)
          : makeElement("span", "", ""),
        revision.opinion_review_status
          ? makeElement("span", "", `Opinion review: ${statusName(revision.opinion_review_status)}`)
          : makeElement("span", "", ""),
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
    const articleType = (workspaceData.articleTypes || [])
      .find((item) => item.key === article.content_type);
    top.append(makeElement("span", "workspace-type-badge", articleType?.name || article.content_type || "News"));
    if (["opinion", "editorial"].includes(article.content_type)) {
      top.append(makeElement(
        "span",
        "workspace-type-badge",
        `${statusName(article.opinion_review_status || "pending review")}`
      ));
    }
    if (article.news_priority === "breaking") {
      const approvalStillActive = article.breaking_review_status === "approved"
        && article.breaking_expires_at
        && new Date(article.breaking_expires_at) > new Date();
      top.append(makeElement(
        "span",
        `workspace-type-badge ${approvalStillActive ? "breaking-approved" : "breaking-pending"}`,
        approvalStillActive ? "Breaking approved" : `Breaking · ${article.breaking_review_status === "rejected" ? "rejected" : "awaiting approval"}`
      ));
    }
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
    if (article.reporting_sources || article.reporting_evidence || article.contact_status) {
      card.append(makeElement(
        "p",
        "workspace-story-summary",
        `Private reporting checklist · Sources: ${article.reporting_sources || "—"} · Evidence: ${article.reporting_evidence || "—"} · Response: ${article.contact_status || "—"}${article.contact_notes ? ` · Notes: ${article.contact_notes}` : ""}`
      ));
    }
    if (article.author_disclosure) {
      card.append(makeElement("p", "workspace-story-summary", `Disclosure: ${article.author_disclosure}`));
    }
    if (article.review_note) card.append(makeElement("p", "workspace-story-summary", `Editorial note: ${article.review_note}`));
    if (article.breaking_review_note) {
      card.append(makeElement("p", "workspace-story-summary", `Breaking review: ${article.breaking_review_note}`));
    }
    const actions = makeElement("div", "workspace-story-actions");
    const capabilities = allowedActions(article);
    if (capabilities.edit) addAction(actions, "Edit story", () => openStoryDialog(article));
    if (["editor", "publisher"].includes(identity.role)
        && article.news_priority === "breaking"
        && article.breaking_review_status === "requested") {
      addAction(actions, "Review Breaking request", () => void reviewBreakingRequest(article));
    }
    if (["opinion", "editorial"].includes(article.content_type)
        && ["editor", "publisher", "admin", "super_admin"].includes(identity.role)
        && article.opinion_review_status !== "approved"
        && ["submitted", "moderator_review", "editor_review"].includes(article.workflow_status)) {
      addAction(actions, "Approve opinion", () => void runOpinionReview(article, "approve"));
      addAction(actions, "Request opinion revisions", () => void runOpinionReview(article, "request_changes"));
      addAction(actions, "Reject opinion", () => void runOpinionReview(article, "reject"), "danger");
    }
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
  select.replaceChildren(new Option("Choose a topic before submitting", ""));
  categories.forEach((category) => {
    const option = new Option(category.name, String(category.id));
    option.selected = String(category.id) === String(selected);
    select.append(option);
  });
}

function populateArticleTypes(types, selected = "") {
  const select = storyForm.elements.content_type;
  select.replaceChildren(new Option("Choose a type", ""));
  types.forEach((type) => {
    const option = new Option(type.name, type.key);
    option.disabled = !type.is_active && type.key !== selected;
    option.selected = type.key === selected;
    select.append(option);
  });
  if (!selected && types.some((type) => type.key === "news" && type.is_active)) {
    select.value = "news";
  }
  updateTypeGuidance();
}

function populateOpinionContributors(selected = "") {
  const select = storyForm.elements.opinion_contributor_id;
  if (!select) return;
  select.replaceChildren(new Option("Choose contributor", ""));
  (workspaceData.contributors || []).forEach((contributor) => {
    const option = new Option(
      `${contributor.display_name}${contributor.contributor_type !== "staff" ? ` · ${contributor.contributor_type}` : ""}`,
      String(contributor.id)
    );
    option.selected = String(contributor.id) === String(selected);
    select.append(option);
  });
  select.disabled = !(workspaceData.contributors || []).length;
}

function countStoryWords(content) {
  const trimmed = String(content || "").trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

function updateTypeGuidance() {
  const selected = (workspaceData.articleTypes || [])
    .find((type) => type.key === storyForm.elements.content_type.value);
  const wordCount = countStoryWords(storyForm.elements.content.value);
  const minimumWordCount = selected?.minimum_word_count;
  const wordCountHelp = document.querySelector("#content-word-count");
  if (!selected || !Number.isInteger(minimumWordCount) || minimumWordCount < 1) {
    wordCountHelp.textContent = `${wordCount} words. A minimum word count must be configured by an administrator before this type can be submitted.`;
    wordCountHelp.classList.add("below-minimum");
  } else {
    const meetsMinimum = wordCount >= minimumWordCount;
    wordCountHelp.textContent = `${wordCount} of ${minimumWordCount} words${meetsMinimum
      ? " · Minimum met."
      : ` · ${minimumWordCount - wordCount} more needed before submission.`}`;
    wordCountHelp.classList.toggle("below-minimum", !meetsMinimum);
  }
  [
    "#reporting-sources-field",
    "#reporting-evidence-field",
    "#contact-status-field",
    "#contact-notes-field"
  ].forEach((selector) => {
    document.querySelector(selector).hidden = !selected?.requires_reporting_checklist;
  });
  document.querySelector("#author-disclosure-field").hidden = !selected?.requires_author_disclosure;
  document.querySelector("#opinion-fields").hidden = selected?.key !== "opinion";
  document.querySelector("#content-type-guidance").textContent = selected
    ? [
      selected.description,
      selected.requires_reporting_checklist
        ? "Before submission, add source notes, evidence/verification notes, and response status."
        : "",
      selected.requires_author_disclosure
        ? "Before submission, add the author or institutional disclosure."
        : "",
      selected.editorial_only ? "This type is restricted to authorized editors." : ""
    ].filter(Boolean).join(" ")
    : "Choose the kind of story. Your primary topic is selected separately.";
}

function updateBreakingFields() {
  const isBreaking = storyForm.elements.news_priority.value === "breaking";
  const needsRequestReason = isBreaking && (
    !editingArticle
    || editingArticle.news_priority !== "breaking"
    || ["none", "rejected"].includes(editingArticle.breaking_review_status)
  );
  const noteField = storyForm.elements.breaking_review_note;
  document.querySelector("#breaking-request-note-field").hidden = !isBreaking;
  noteField.required = needsRequestReason;
  noteField.minLength = needsRequestReason ? 10 : 0;
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
  clearThumbnailCandidates();
  mediaStatus.hidden = true;
  mediaFile.value = "";
  storyForm.reset();
  updateThumbnailAltRequirement();
  storyError.hidden = true;
  document.querySelector("#story-dialog-title").textContent = article ? "Edit story" : "New story draft";
  document.querySelector("#story-dialog-help").textContent = article
    ? "A snapshot of the previous story version is saved to history when you save."
    : "Save a private draft. It will not appear in public news until editorial approval.";
  document.querySelector("#change-reason-field").hidden = identity.role !== "admin" && identity.role !== "super_admin";
  populateCategories(workspaceData.categories, article?.category_id);
  populateArticleTypes(workspaceData.articleTypes || [], article?.content_type || "news");
  populateLocations(workspaceData.locations, article?.reporting_location_id);
  populateOpinionContributors(article?.opinion_contributor_id);
  storyForm.elements.slug.dataset.touched = article ? "true" : "false";
  if (article) {
    for (const key of [
      "title", "slug", "excerpt", "content", "category_id", "image_url", "video_url",
      "audio_url", "thumbnail_url", "news_priority", "reporting_sources", "reporting_evidence",
      "thumbnail_alt_text", "thumbnail_credit_line", "thumbnail_license_name",
      "opinion_contributor_id", "opinion_column_name", "conflict_of_interest_disclosure",
      "fact_sources", "ai_use_disclosure",
      "contact_status", "contact_notes", "author_disclosure", "breaking_review_note"
    ]) {
      if (article[key] !== null && article[key] !== undefined) storyForm.elements[key].value = article[key];
    }
    if (article.thumbnail_url_display_url) {
      setThumbnailPreview(
        article.thumbnail_url_display_url,
        article.thumbnail_alt_text || article.title || "Story thumbnail"
      );
    }
    updateThumbnailAltRequirement();
  }
  updateTypeGuidance();
  updateBreakingFields();
  storyDialog.showModal();
}

storyForm.elements.title.addEventListener("input", () => {
  storyForm.elements.title.setCustomValidity(validateHeadline(storyForm.elements.title.value));
  if (!editingArticle || storyForm.elements.slug.dataset.touched !== "true") {
    storyForm.elements.slug.value = slugFromTitle(storyForm.elements.title.value);
  }
});
storyForm.elements.slug.addEventListener("input", () => {
  storyForm.elements.slug.dataset.touched = "true";
});
storyForm.elements.content_type.addEventListener("change", updateTypeGuidance);
storyForm.elements.content.addEventListener("input", updateTypeGuidance);
storyForm.elements.thumbnail_alt_text.addEventListener("input", () => {
  if (!thumbnailPreview.hidden) {
    thumbnailPreviewImage.alt = storyForm.elements.thumbnail_alt_text.value;
  }
});
document.querySelector("#workspace-create").addEventListener("click", () => openStoryDialog());
document.querySelector("#workspace-assets-nav").addEventListener("click", () => void openAssetLibrary());
document.querySelectorAll(".asset-picker-button").forEach((button) => {
  button.addEventListener("click", () => void openAssetLibrary(button.dataset.assetTarget));
});
document.querySelector("#asset-library-close").addEventListener("click", () => assetDialog.close());
assetSearch.addEventListener("input", () => {
  window.clearTimeout(assetSearchTimer);
  assetSearchTimer = window.setTimeout(() => void loadAssetLibrary(), 250);
});
assetTypeFilter.addEventListener("change", () => void loadAssetLibrary());
assetStatusFilter.addEventListener("change", () => void loadAssetLibrary());
assetUpload.addEventListener("change", async () => {
  const file = assetUpload.files?.[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    assetStatus.textContent = "Choose a file no larger than 25 MB.";
    assetUpload.value = "";
    return;
  }
  assetUpload.disabled = true;
  assetStatus.textContent = "Uploading asset securely…";
  let candidates = [];
  let candidateError = "";
  if (file.type.startsWith("video/")) {
    assetStatus.textContent = "Generating reusable video thumbnail suggestions…";
    try {
      candidates = await createVideoThumbnailCandidates(file);
    } catch (error) {
      candidateError = error instanceof Error ? error.message : "Automatic thumbnail generation failed.";
    }
  }
  try {
    const upload = await uploadMediaBlob(file, file.type);
    let asset;
    try {
      asset = await registerUploadedAsset(upload, {
        assetType: mediaAssetType(file.type),
        title: file.name
      });
    } catch (error) {
      try {
        await request("/api/workspace/media", "DELETE", { path: upload.path });
        uploadedMediaPaths.delete(upload.path);
      } catch (cleanupError) {
        console.error("Could not remove a media upload that failed Asset Library registration:", cleanupError);
      }
      throw error;
    }
    let generatedCount = 0;
    if (asset.asset_type === "video" && candidates.length) {
      try {
        generatedCount = await registerGeneratedThumbnailCandidates(candidates, asset);
      } catch (error) {
        candidateError = error.message;
      }
    }
    assetUpload.value = "";
    await loadAssetLibrary();
    if (asset.asset_type === "video") {
      assetStatus.textContent = candidateError
        ? `Video saved. ${candidateError}`
        : `Video and ${generatedCount} suggested thumbnails saved to the Asset Library.`;
    } else {
      assetStatus.textContent = "Asset uploaded and saved to the library.";
    }
  } catch (error) {
    assetStatus.textContent = error.message;
  } finally {
    candidates.forEach((candidate) => URL.revokeObjectURL(candidate.previewUrl));
    assetUpload.disabled = false;
    assetUpload.value = "";
  }
});
storyForm.elements.news_priority.addEventListener("change", updateBreakingFields);
storyForm.elements.news_priority.dispatchEvent(new Event("change"));
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

async function reviewBreakingRequest(article) {
  const approve = window.confirm("Approve this Breaking label for the next 6 hours?\nChoose Cancel to reject it with a reason.");
  const reviewNote = approve
    ? window.prompt("Reason for approving this Breaking request")
    : window.prompt("Reason for rejecting this Breaking request");
  if (!reviewNote || reviewNote.trim().length < 2) return;
  try {
    await request(`/api/workspace/articles/${article.id}/breaking-review`, "POST", {
      approve,
      validity_hours: 6,
      review_note: reviewNote || ""
    });
    showMessage(approve ? "Breaking label approved for six hours." : "Breaking request rejected.", true);
    await loadWorkspace();
  } catch (error) {
    showMessage(error.message);
  }
}

storyDialog.addEventListener("close", () => {
  clearThumbnailCandidates();
  mediaFile.value = "";
  mediaStatus.hidden = true;
  void discardUnattachedUploads();
});
mediaFile.addEventListener("change", async () => {
  const file = mediaFile.files?.[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    mediaStatus.hidden = false;
    mediaStatus.textContent = "Choose a file no larger than 25 MB.";
    mediaFile.value = "";
    return;
  }
  mediaStatus.hidden = false;
  mediaFile.disabled = true;
  let candidates = [];
  let candidatesRendered = false;
  try {
    const assetType = mediaAssetType(file.type);
    if (assetType === "video") {
      clearThumbnailCandidates();
      storyForm.elements.thumbnail_url.value = "";
      setThumbnailMetadata();
    }
    let thumbnailError = "";
    if (assetType === "video") {
      mediaStatus.textContent = "Creating video thumbnail suggestions…";
      try {
        candidates = await createVideoThumbnailCandidates(file);
      } catch (error) {
        thumbnailError = error instanceof Error ? error.message : "Automatic thumbnail generation failed.";
      }
    }
    mediaStatus.textContent = "Uploading media securely…";
    const upload = await uploadMediaBlob(file, file.type);
    const asset = await registerUploadedAsset(upload, { assetType, title: file.name });
    const urlField = file.type.startsWith("image/")
      ? storyForm.elements.image_url
      : file.type.startsWith("video/")
        ? storyForm.elements.video_url
        : storyForm.elements.audio_url;
    urlField.value = upload.path;
    if (assetType === "video") {
      storyForm.elements.thumbnail_url.value = "";
      setThumbnailPreview("");
      renderThumbnailCandidates(candidates);
      candidatesRendered = true;
      currentVideoAssetId = asset.id;
      setThumbnailMetadata(asset);
      mediaStatus.textContent = thumbnailError
        ? `Video saved to the Asset Library. ${thumbnailError} Choose a thumbnail from the library instead.`
        : candidates.length
          ? "Video saved to the Asset Library. Select a frame above for the story thumbnail."
          : "Video saved to the Asset Library. Choose a thumbnail from the library.";
    } else {
      mediaStatus.textContent = "Upload complete and saved to the Asset Library.";
    }
    mediaFile.value = "";
  } catch (error) {
    if (!candidatesRendered) candidates.forEach((candidate) => URL.revokeObjectURL(candidate.previewUrl));
    mediaStatus.textContent = error instanceof Error ? error.message : "Media upload failed.";
  } finally {
    mediaFile.disabled = false;
    mediaFile.value = "";
  }
});
document.querySelector("#workspace-notifications-read").addEventListener("click", async () => {
  try {
    await request("/api/workspace/notifications/read-all", "POST", {});
    await loadNotifications();
    await loadTerritoryDashboard();
  } catch (error) {
    showMessage(error.message);
  }
});

storyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  storyForm.elements.title.setCustomValidity(validateHeadline(storyForm.elements.title.value));
  if (!storyForm.reportValidity()) return;
  const values = new FormData(storyForm);
  const body = Object.fromEntries(values.entries());
  if (body.thumbnail_url && !String(body.thumbnail_alt_text || "").trim()) {
    storyError.textContent = "Add alternative text for the selected story thumbnail.";
    storyError.hidden = false;
    storyForm.elements.thumbnail_alt_text.focus();
    return;
  }
  body.category_id = body.category_id ? Number(body.category_id) : null;
  body.reporting_location_id = body.reporting_location_id ? Number(body.reporting_location_id) : null;
  storyError.hidden = true;
  const submit = storyForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    if (pendingThumbnailBlob) {
      const upload = pendingThumbnailUploadPath
        ? { path: pendingThumbnailUploadPath, mime_type: "image/jpeg", size: pendingThumbnailBlob.size }
        : await uploadMediaBlob(pendingThumbnailBlob, "image/jpeg");
      pendingThumbnailUploadPath = upload.path;
      await registerUploadedAsset(upload, {
        assetType: "video_thumbnail",
        title: `${storyForm.elements.title.value.trim()} thumbnail`,
        altText: body.thumbnail_alt_text,
        creditLine: body.thumbnail_credit_line,
        licenseName: body.thumbnail_license_name,
        sourceVideoAssetId: currentVideoAssetId,
        width: thumbnailCandidates.find((candidate) => candidate.blob === pendingThumbnailBlob)?.width,
        height: thumbnailCandidates.find((candidate) => candidate.blob === pendingThumbnailBlob)?.height
      });
      storyForm.elements.thumbnail_url.value = upload.path;
      body.thumbnail_url = upload.path;
      updateThumbnailAltRequirement();
      pendingThumbnailBlob = null;
      pendingThumbnailUploadPath = null;
    }
    if (editingArticle) {
      await request(`/api/workspace/articles/${editingArticle.id}`, "PATCH", body);
    } else {
      await request("/api/workspace/articles", "POST", body);
    }
    [...uploadedMediaPaths].forEach((path) => {
      if ([body.image_url, body.video_url, body.audio_url, body.thumbnail_url].includes(path)) {
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
  const notificationRequest = loadNotifications();
  const territoryRequest = loadTerritoryDashboard();
  try {
    const result = await request("/api/workspace/articles");
    workspaceData = result.data || { articles: [], categories: [], locations: [] };
    document.querySelector("#workspace-assets-nav").hidden = !workspaceData.canManageMedia;
    document.querySelectorAll(".asset-picker-button").forEach((button) => {
      button.hidden = !workspaceData.canManageMedia;
    });
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
  } catch (error) {
    queue.replaceChildren(makeElement("p", "workspace-empty", error.message));
  }
  await Promise.all([notificationRequest, territoryRequest]);
}

async function initializeWorkspace() {
  try {
    const result = await request("/api/workspace/session");
    identity = result.identity;
    const copy = roleContent[identity.role];
    if (!copy) {
      window.location.replace(identity.role === "subscriber" ? "/reporter" : "/admin/dashboard");
      return;
    }
    document.querySelector("#workspace-name").textContent = identity.name || identity.email;
    document.querySelector("#workspace-role").textContent = identity.role.replaceAll("_", " ");
    document.querySelector("#workspace-avatar").textContent = (identity.name || identity.email || "C").slice(0, 1).toUpperCase();
    if (["admin", "super_admin"].includes(identity.role)) {
      const backLink = document.querySelector(".workspace-public-link");
      backLink.href = "/admin/dashboard";
      backLink.textContent = "← Back to Admin Dashboard";
    }
    document.querySelector("#workspace-eyebrow").textContent = copy.eyebrow;
    document.querySelector("#workspace-heading").textContent = copy.heading;
    document.querySelector("#workspace-description").textContent = copy.description;
    document.querySelector("#queue-heading").textContent = copy.queue;
    document.querySelector("#queue-description").textContent = copy.queueDescription;
    document.querySelector("#workspace-create").hidden = !["reporter", "editor"].includes(identity.role);
    await loadWorkspace();
    if (new URLSearchParams(window.location.search).get("open") === "assets"
        && workspaceData.canManageMedia) {
      await openAssetLibrary();
    }
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
    const response = await fetch("/api/workspace/session", { method: "DELETE" });
    if (!response.ok) throw new Error("Could not sign out.");
    window.location.replace("/");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Could not sign out.");
  }
});

initializeWorkspace();
