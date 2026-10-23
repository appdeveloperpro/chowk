const feed = document.querySelector("#news-feed");
const searchToggle = document.querySelector("#search-toggle");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const chips = document.querySelector(".category-chips");
const retryButton = document.querySelector("#retry-button");

let selectedCategory = "";

searchToggle.addEventListener("click", () => {
  searchForm.hidden = !searchForm.hidden;
  if (!searchForm.hidden) searchInput.focus();
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

retryButton.addEventListener("click", () => void loadArticles());

function showFeedMessage(title, description, retryLabel) {
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
  button.addEventListener("click", () => void loadArticles());
  empty.append(mark, heading, detail, button);
  feed.replaceChildren(empty);
}

function renderArticle(article) {
  const item = document.createElement("article");
  item.className = "article-item";
  if (article.image_url) {
    const image = document.createElement("img");
    image.className = "article-image";
    image.src = article.image_url;
    image.alt = "";
    image.loading = "lazy";
    item.append(image);
  }
  if (article.video_url) {
    const video = document.createElement("video");
    video.className = "article-media-player";
    video.src = article.video_url;
    video.controls = true;
    video.preload = "metadata";
    item.append(video);
  }
  if (article.audio_url) {
    const audio = document.createElement("audio");
    audio.className = "article-media-player";
    audio.src = article.audio_url;
    audio.controls = true;
    audio.preload = "metadata";
    item.append(audio);
  }
  const category = document.createElement("span");
  category.className = "eyebrow";
  category.textContent = article.category || article.category_name || "खबर";
  const title = document.createElement("h3");
  title.textContent = article.title || "शीर्षक उपलब्ध नहीं";
  const summary = document.createElement("p");
  summary.textContent = article.description || article.excerpt || "";
  item.append(category, title, summary);
  return item;
}

async function loadArticles() {
  retryButton.disabled = true;
  retryButton.textContent = "खबरें जांच रहे हैं…";
  const params = new URLSearchParams({ page: "1", limit: "50" });
  if (selectedCategory) params.set("category", selectedCategory);
  if (searchInput.value.trim()) params.set("search", searchInput.value.trim());

  try {
    const response = await fetch(`/api/articles?${params}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `News API returned ${response.status}`);
    const articles = Array.isArray(result?.data)
      ? result.data
      : Array.isArray(result)
        ? result
        : null;
    if (!articles) throw new Error("News API returned an invalid response");

    if (articles.length === 0) {
      showFeedMessage(
        "अभी कोई प्रकाशित खबर उपलब्ध नहीं है",
        "नई खबरें Chowk API से प्रकाशित होने पर यहां दिखाई देंगी।",
        "फिर से जांचें"
      );
      return;
    }
    feed.replaceChildren(...articles.map(renderArticle));
  } catch (error) {
    console.error("Unable to load news:", error);
    showFeedMessage(
      "न्यूज़ फ़ीड लोड नहीं हुई",
      error instanceof Error ? error.message : "समाचार सेवा उपलब्ध नहीं है।",
      "फिर से कोशिश करें"
    );
  } finally {
    retryButton.disabled = false;
    retryButton.textContent = "फिर से कोशिश करें";
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
      button.textContent = category.name;
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
    actions.querySelector(".login-button")?.remove();
    actions.querySelector(".join-button")?.remove();
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

void loadAccountActions();
void loadCategories();
void loadArticles();
