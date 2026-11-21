const feed = document.querySelector("#news-feed");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const chips = document.querySelector(".category-chips");
const videoDialog = document.querySelector("#video-player-dialog");
const dialogVideo = document.querySelector("#video-player");
const dialogVideoTitle = document.querySelector("#video-player-title");
const dialogVideoStatus = document.querySelector("#video-player-status");
const videoAutoplayToggle = document.querySelector("#video-autoplay-toggle");
const reducedMotionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

let selectedCategory = "";
let articleRequestId = 0;
let pendingPreviewSeek = null;
let videoAutoplayEnabled = true;
let fallbackRefreshRequest = 0;
const videoPreviewController = window.createVideoPreviewController({
  activate(video) {
    if (!video.hasAttribute("src") && video.dataset.src) video.src = video.dataset.src;
    const playback = video.play();
    if (playback) {
      playback.catch((error) => {
        if (error.name !== "NotAllowedError" && error.name !== "AbortError") {
          console.warn("Video preview could not autoplay:", error);
        }
      });
    }
  },
  deactivate(video, unload) {
    video.pause();
    if (unload && video.hasAttribute("src")) {
      video.removeAttribute("src");
      video.load();
    }
  }
});
const videoPreviewObserver = typeof window.IntersectionObserver === "function"
  ? new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (target.isConnected && isIntersecting
          && target.dataset.poster && !target.hasAttribute("poster")) {
        target.poster = target.dataset.poster;
      }
    });
    refreshVisibleVideoPreviews();
  }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] })
  : null;

function updateVideoPreviewBlocking() {
  videoPreviewController.setBlocked(
    document.hidden || videoDialog.open || reducedMotionPreference.matches
  );
}

function setVideoAutoplayEnabled(enabled) {
  videoAutoplayEnabled = enabled;
  videoPreviewController.setAutoplayEnabled(enabled);
  videoAutoplayToggle.setAttribute("aria-pressed", String(enabled));
  videoAutoplayToggle.textContent = `वीडियो ऑटोप्ले: ${enabled ? "चालू" : "बंद"}`;
}

function releaseVideoPreviews() {
  const previews = feed.querySelectorAll(".article-video-preview video");
  if (videoPreviewObserver) {
    previews.forEach((video) => videoPreviewObserver.unobserve(video));
  }
  videoPreviewController.clear();
}

function refreshVisibleVideoPreviews() {
  const entries = [];
  feed.querySelectorAll(".article-video-preview video").forEach((video) => {
    const bounds = video.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(bounds.right, window.innerWidth) - Math.max(bounds.left, 0));
    const visibleHeight = Math.max(0, Math.min(bounds.bottom, window.innerHeight) - Math.max(bounds.top, 0));
    const intersectionRatio = bounds.width && bounds.height
      ? (visibleWidth * visibleHeight) / (bounds.width * bounds.height)
      : 0;
    const isIntersecting = intersectionRatio > 0;
    if (isIntersecting && video.dataset.poster && !video.hasAttribute("poster")) {
      video.poster = video.dataset.poster;
    }
    entries.push({ target: video, isIntersecting, intersectionRatio });
  });
  videoPreviewController.update(entries);
}

function scheduleVideoPreviewRefresh() {
  if (fallbackRefreshRequest) return;
  fallbackRefreshRequest = window.requestAnimationFrame(() => {
    fallbackRefreshRequest = 0;
    refreshVisibleVideoPreviews();
  });
}

function openVideoPlayer(article, startTime) {
  videoPreviewController.setBlocked(true);
  if (pendingPreviewSeek) {
    dialogVideo.removeEventListener("loadedmetadata", pendingPreviewSeek);
    pendingPreviewSeek = null;
  }
  dialogVideoTitle.textContent = article.title || "Video";
  dialogVideoStatus.hidden = true;
  dialogVideo.src = article.video_url;
  if (article.thumbnail_url || article.image_url) dialogVideo.poster = article.thumbnail_url || article.image_url;
  else dialogVideo.removeAttribute("poster");
  dialogVideo.muted = false;
  videoDialog.showModal();
  if (startTime > 0) {
    pendingPreviewSeek = () => {
      if (Number.isFinite(dialogVideo.duration) && startTime < dialogVideo.duration) {
        dialogVideo.currentTime = startTime;
      }
      pendingPreviewSeek = null;
    };
    dialogVideo.addEventListener("loadedmetadata", pendingPreviewSeek, { once: true });
  }
  const playback = dialogVideo.play();
  if (playback) {
    playback.catch((error) => {
      if (!videoDialog.open || error.name === "AbortError") return;
      dialogVideoStatus.textContent = "Playback could not start automatically. Press Play to start the video.";
      dialogVideoStatus.hidden = false;
    });
  }
}

document.querySelector("#video-player-close").addEventListener("click", () => videoDialog.close());
videoDialog.addEventListener("click", (event) => {
  if (event.target === videoDialog) videoDialog.close();
});
videoDialog.addEventListener("close", () => {
  if (pendingPreviewSeek) {
    dialogVideo.removeEventListener("loadedmetadata", pendingPreviewSeek);
    pendingPreviewSeek = null;
  }
  dialogVideo.pause();
  dialogVideo.removeAttribute("src");
  dialogVideo.removeAttribute("poster");
  dialogVideo.load();
  dialogVideoStatus.hidden = true;
  refreshVisibleVideoPreviews();
  updateVideoPreviewBlocking();
});
document.addEventListener("visibilitychange", () => {
  updateVideoPreviewBlocking();
  if (!document.hidden) refreshVisibleVideoPreviews();
});
if (typeof reducedMotionPreference.addEventListener === "function") {
  reducedMotionPreference.addEventListener("change", updateVideoPreviewBlocking);
} else if (typeof reducedMotionPreference.addListener === "function") {
  reducedMotionPreference.addListener(updateVideoPreviewBlocking);
}
videoAutoplayToggle.addEventListener("click", () => {
  setVideoAutoplayEnabled(!videoAutoplayEnabled);
});
updateVideoPreviewBlocking();
if (!videoPreviewObserver) {
  window.addEventListener("scroll", scheduleVideoPreviewRefresh, { passive: true });
  window.addEventListener("resize", scheduleVideoPreviewRefresh);
}

feed.addEventListener("click", (event) => {
  if (event.target.closest("#retry-button")) void loadArticles();
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void loadArticles();
});

chips.addEventListener("click", (event) => {
  if (event.target.closest("[data-retry-categories]")) {
    void loadCategories();
    return;
  }
  const button = event.target.closest("[data-category]");
  if (!button) return;
  chips.querySelectorAll("[data-category]").forEach((item) => {
    item.classList.toggle("active", item === button);
  });
  selectedCategory = button.dataset.category || "";
  void loadArticles();
});

function showFeedMessage(title, description, retryLabel) {
  releaseVideoPreviews();
  videoAutoplayToggle.hidden = true;
  feed.classList.remove("has-articles");
  const empty = document.createElement("div");
  empty.className = "empty-state";
  const mark = document.createElement("span");
  mark.className = "empty-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "चौ";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const detail = document.createElement("p");
  detail.textContent = description;
  const button = document.createElement("button");
  button.className = "retry-button";
  button.type = "button";
  button.textContent = retryLabel;
  empty.append(mark, heading, detail, button);
  feed.replaceChildren(empty);
}

function renderArticle(article, index) {
  const item = document.createElement("article");
  item.className = `article-item${index === 0 ? " is-featured" : ""}`;
  const visual = document.createElement("div");
  visual.className = "article-visual";
  let previewVideo = null;
  if (article.video_url) {
    const previewButton = document.createElement("button");
    previewButton.className = "article-video-preview";
    previewButton.type = "button";
    previewButton.setAttribute("aria-label", `Play video with sound: ${article.title || "Video"}`);
    previewVideo = document.createElement("video");
    previewVideo.muted = true;
    previewVideo.defaultMuted = true;
    previewVideo.loop = true;
    previewVideo.playsInline = true;
    previewVideo.preload = "none";
    previewVideo.dataset.src = article.video_url;
    if (article.thumbnail_url || article.image_url) previewVideo.dataset.poster = article.thumbnail_url || article.image_url;
    const previewLabel = document.createElement("span");
    previewLabel.className = "article-video-preview-label";
    previewLabel.textContent = "आवाज़ के साथ देखें";
    previewButton.append(previewVideo, previewLabel);
    previewButton.addEventListener("click", () => openVideoPlayer(article, previewVideo.currentTime));
    visual.append(previewButton);
  } else if (article.thumbnail_url || article.image_url) {
    const image = document.createElement("img");
    image.className = "article-image";
    image.loading = "lazy";
    image.alt = article.thumbnail_url
      ? article.thumbnail_alt_text || article.title || ""
      : article.image_alt || article.title || "";
    image.src = article.thumbnail_url || article.image_url;
    image.addEventListener("error", () => {
      visual.classList.add("is-placeholder");
      image.remove();
      const mark = document.createElement("span");
      mark.className = "article-placeholder-mark";
      mark.textContent = "चौक";
      visual.append(mark);
    }, { once: true });
    visual.append(image);
  } else {
    visual.classList.add("is-placeholder");
    const mark = document.createElement("span");
    mark.className = "article-placeholder-mark";
    mark.textContent = "चौक";
    visual.append(mark);
  }
  const copy = document.createElement("div");
  copy.className = "article-copy";
  const meta = document.createElement("div");
  meta.className = "article-meta";
  if (article.content_type === "opinion") {
    const opinionLabel = document.createElement("span");
    opinionLabel.className = "article-type-label";
    opinionLabel.textContent = "Opinion";
    meta.append(opinionLabel);
  }
  const category = document.createElement("span");
  category.className = "eyebrow";
  category.textContent = article.category || article.category_name || "खबर";
  meta.append(category);
  const contentTypeName = article.article_type?.name;
  if (contentTypeName) {
    const type = document.createElement("span");
    type.className = "article-type-label";
    type.textContent = contentTypeName;
    meta.append(type);
  }
  if (article.news_priority === "breaking"
      && article.breaking_review_status === "approved"
      && article.breaking_expires_at
      && new Date(article.breaking_expires_at) > new Date()) {
    const breaking = document.createElement("span");
    breaking.className = "article-breaking-label";
    breaking.textContent = "ब्रेकिंग";
    meta.append(breaking);
  }
  const dateValue = article.published_at || article.created_at;
  if (dateValue) {
    const date = new Date(dateValue);
    if (!Number.isNaN(date.getTime())) {
      const time = document.createElement("time");
      time.dateTime = date.toISOString();
      time.textContent = new Intl.DateTimeFormat("hi-IN", {
        day: "numeric",
        month: "short",
        year: "numeric"
      }).format(date);
      meta.append(time);
    }
  }
  const title = document.createElement("h3");
  if (typeof article.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)) {
    const link = document.createElement("a");
    link.className = "article-title-link";
    link.href = `/article/${encodeURIComponent(article.slug)}`;
    link.textContent = article.title || "शीर्षक उपलब्ध नहीं";
    title.append(link);
  } else {
    title.textContent = article.title || "शीर्षक उपलब्ध नहीं";
  }
  const summary = document.createElement("p");
  summary.className = "article-summary";
  summary.textContent = article.description || article.excerpt || "";
  copy.append(meta, title, summary);
  if (article.content_type === "opinion") {
    const byline = document.createElement("p");
    byline.className = "article-opinion-byline";
    const contributor = article.opinion_contributor;
    if (contributor?.display_name) {
      const label = document.createTextNode("Opinion by ");
      if (contributor.slug) {
        const link = document.createElement("a");
        link.href = `/contributor/${encodeURIComponent(contributor.slug)}`;
        link.textContent = contributor.display_name;
        byline.append(label, link);
      } else {
        byline.append(label, document.createTextNode(contributor.display_name));
      }
      byline.append(document.createTextNode(
        `${article.opinion_column_name ? ` · ${article.opinion_column_name}` : ""} — personal viewpoint`
      ));
    } else {
      byline.textContent = "Opinion · personal viewpoint";
    }
    copy.append(byline);
  }
  const attribution = [];
  if (article.thumbnail_credit_line) attribution.push(`चित्र श्रेय: ${article.thumbnail_credit_line}`);
  if (article.thumbnail_license_name) attribution.push(`लाइसेंस: ${article.thumbnail_license_name}`);
  if (attribution.length) {
    const credit = document.createElement("p");
    credit.className = "article-media-attribution";
    credit.textContent = attribution.join(" · ");
    copy.append(credit);
  }
  if (article.audio_url) {
    const audio = document.createElement("audio");
    audio.className = "article-media-player";
    audio.src = article.audio_url;
    audio.controls = true;
    audio.preload = "metadata";
    copy.append(audio);
  }
  item.append(visual, copy);
  if (previewVideo) videoPreviewController.register(previewVideo);
  return item;
}

async function loadArticles() {
  const requestId = ++articleRequestId;
  const retryButton = feed.querySelector("#retry-button");
  if (retryButton) {
    retryButton.disabled = true;
    retryButton.textContent = "खबरें जांच रहे हैं…";
  }
  feed.setAttribute("aria-busy", "true");
  const params = new URLSearchParams({ page: "1", limit: "50" });
  if (selectedCategory) params.set("category", selectedCategory);
  if (searchInput.value.trim()) params.set("search", searchInput.value.trim());

  try {
    const response = await fetch(`/api/articles?${params}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `News API returned ${response.status}`);
    if (requestId !== articleRequestId) return;
    const articles = Array.isArray(result?.data)
      ? result.data
      : Array.isArray(result)
        ? result
        : null;
    if (!articles) throw new Error("News API returned an invalid response");

    if (articles.length === 0) {
      feed.classList.remove("has-articles");
      showFeedMessage(
        "अभी कोई प्रकाशित खबर उपलब्ध नहीं है",
        "नई खबरें Chowk API से प्रकाशित होने पर यहां दिखाई देंगी।",
        "फिर से जांचें"
      );
      return;
    }
    feed.classList.add("has-articles");
    releaseVideoPreviews();
    feed.replaceChildren(...articles.map(renderArticle));
    const videoPreviews = feed.querySelectorAll(".article-video-preview video");
    videoAutoplayToggle.hidden = videoPreviews.length === 0;
    videoAutoplayToggle.setAttribute("aria-pressed", String(videoAutoplayEnabled));
    videoAutoplayToggle.textContent = `वीडियो ऑटोप्ले: ${videoAutoplayEnabled ? "चालू" : "बंद"}`;
    if (videoPreviewObserver) videoPreviews.forEach((video) => videoPreviewObserver.observe(video));
    refreshVisibleVideoPreviews();
  } catch (error) {
    if (requestId !== articleRequestId) return;
    console.error("Unable to load news:", error);
    feed.classList.remove("has-articles");
    showFeedMessage(
      "न्यूज़ फ़ीड लोड नहीं हुई",
      error instanceof Error ? error.message : "समाचार सेवा उपलब्ध नहीं है।",
      "फिर से कोशिश करें"
    );
  } finally {
    if (requestId === articleRequestId) {
      feed.setAttribute("aria-busy", "false");
      const currentRetryButton = feed.querySelector("#retry-button");
      if (currentRetryButton) {
        currentRetryButton.disabled = false;
        currentRetryButton.textContent = "फिर से कोशिश करें";
      }
    }
  }
}

async function loadCategories() {
  chips.setAttribute("aria-busy", "true");
  try {
    const response = await fetch("/api/categories", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Categories could not be loaded");
    if (!Array.isArray(result?.data)) throw new Error("Categories API returned an invalid response");

    const all = document.createElement("button");
    all.className = "chip active";
    all.type = "button";
    all.dataset.category = "";
    all.textContent = "सभी खबरें";
    const categoryButtons = result.data
      .filter((category) => category && typeof category.slug === "string" && category.slug
        && typeof category.name === "string" && category.name)
      .map((category) => {
        const button = document.createElement("button");
        button.className = "chip";
        button.type = "button";
        button.dataset.category = category.slug;
        button.append(window.ChowkCategoryIcons.create(category.icon_key, "category-chip-icon"));
        button.append(document.createTextNode(category.name));
        return button;
      });
    chips.replaceChildren(all, ...categoryButtons);
  } catch (error) {
    console.error("Unable to load news categories:", error);
    const all = document.createElement("button");
    all.className = "chip active";
    all.type = "button";
    all.dataset.category = "";
    all.textContent = "सभी खबरें";
    const status = document.createElement("span");
    status.className = "category-chip-status";
    status.setAttribute("role", "status");
    status.textContent = "श्रेणियां लोड नहीं हुईं";
    const retry = document.createElement("button");
    retry.className = "chip";
    retry.type = "button";
    retry.dataset.retryCategories = "";
    retry.textContent = "फिर से कोशिश करें";
    chips.replaceChildren(all, status, retry);
  } finally {
    chips.setAttribute("aria-busy", "false");
  }
}

async function loadAccountActions() {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (response.status === 401) return;
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Account session could not be checked.");
    const actions = document.querySelector(".header-actions");
    actions.querySelectorAll(".login-button, .join-button").forEach((item) => item.remove());
    const account = document.createElement("a");
    account.className = "login-button";
    account.href = ["reporter", "moderator", "editor", "publisher"].includes(result.identity?.role)
      ? "/workspace"
      : "/reporter";
    account.textContent = result.identity?.name || "मेरा अकाउंट";
    const signOut = document.createElement("button");
    signOut.className = "join-button";
    signOut.type = "button";
    signOut.textContent = "लॉगआउट";
    signOut.addEventListener("click", async () => {
      signOut.disabled = true;
      try {
        const logout = await fetch("/api/auth/session", { method: "DELETE" });
        const payload = await logout.json();
        if (!logout.ok) throw new Error(payload.error || "लॉगआउट नहीं हो सका।");
        window.location.reload();
      } catch (error) {
        window.ChowkInlineFeedback?.show(
          "error",
          error instanceof Error ? error.message : "लॉगआउट नहीं हो सका।",
          signOut
        );
        signOut.disabled = false;
      }
    });
    actions.append(account, signOut);
  } catch (error) {
    console.error("Unable to load account session:", error);
  }
}

searchInput.value ||= new URLSearchParams(window.location.search).get("q") || "";
void loadAccountActions();
void loadCategories();
void loadArticles();
