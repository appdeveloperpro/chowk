const feed = document.querySelector("#news-feed");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const chips = document.querySelector(".category-chips");

let selectedCategory = "";
let articleRequestId = 0;

feed.addEventListener("click", (event) => {
  if (event.target.closest("#retry-button")) void loadArticles();
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void loadArticles();
});

chips.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  chips.querySelectorAll("[data-category]").forEach((item) => {
    item.classList.toggle("active", item === button);
  });
  selectedCategory = button.dataset.category || "";
  void loadArticles();
});

function showFeedMessage(title, description, retryLabel) {
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
  if (article.image_url) {
    const image = document.createElement("img");
    image.className = "article-image";
    image.loading = "lazy";
    image.alt = article.image_alt || "";
    image.src = article.image_url;
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
  const category = document.createElement("span");
  category.className = "eyebrow";
  category.textContent = article.category || article.category_name || "खबर";
  meta.append(category);
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
  title.textContent = article.title || "शीर्षक उपलब्ध नहीं";
  const summary = document.createElement("p");
  summary.className = "article-summary";
  summary.textContent = article.description || article.excerpt || "";
  copy.append(meta, title, summary);
  if (article.video_url) {
    const video = document.createElement("video");
    video.className = "article-media-player";
    video.src = article.video_url;
    video.controls = true;
    video.preload = "metadata";
    copy.append(video);
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
    feed.replaceChildren(...articles.map(renderArticle));
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
  try {
    const response = await fetch("/api/categories", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Categories could not be loaded");
    const categories = Array.isArray(result?.data) ? result.data : [];
    if (!categories.length) return;

    const all = document.createElement("button");
    all.className = "chip active";
    all.type = "button";
    all.dataset.category = "";
    all.textContent = "सभी";
    chips.replaceChildren(all);
    categories.forEach((category) => {
      if (!category.slug || !category.name) return;
      const button = document.createElement("button");
      button.className = "chip";
      button.type = "button";
      button.dataset.category = category.slug;
      button.append(window.ChowkCategoryIcons.create(category.icon_key, "category-chip-icon"));
      button.append(document.createTextNode(category.name));
      chips.append(button);
    });
  } catch (error) {
    console.error("Unable to load news categories:", error);
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
        window.alert(error instanceof Error ? error.message : "लॉगआउट नहीं हो सका।");
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
