const mediaPages = {
  "/chowk-patrika": {
    type: "patrika",
    title: "चौक पत्रिका",
    description: "चौक पत्रिका के प्रकाशित अंकों को पढ़ें। हर अंक एक नए टैब में खुलेगा।",
    action: "पत्रिका पढ़ें"
  },
  "/chowk-charcha": {
    type: "charcha",
    title: "चौक चर्चा",
    description: "चौक चर्चा की प्रकाशित बातचीत और वीडियो यहां देखें।",
    action: "देखें / सुनें"
  },
  "/podcasts": {
    type: "podcast",
    title: "पॉडकास्ट",
    description: "चौक न्यूज़ के प्रकाशित पॉडकास्ट एपिसोड यहां सुनें।",
    action: "एपिसोड खोलें"
  }
};

const page = mediaPages[window.location.pathname] || mediaPages["/chowk-patrika"];
const feed = document.querySelector("#media-feed");
document.title = `${page.title} — CHOWK NEWS`;
document.querySelector("#catalogue-title").textContent = page.title;
document.querySelector("#catalogue-description").textContent = page.description;

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function formatDate(value) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("hi-IN", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatDuration(seconds) {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration <= 0) return "";
  const minutes = Math.floor(duration / 60);
  const remainingSeconds = Math.floor(duration % 60);
  return minutes ? `${minutes} मिनट ${remainingSeconds} सेकंड` : `${remainingSeconds} सेकंड`;
}

function renderItem(item) {
  const card = document.createElement("article");
  card.className = "catalogue-card";
  const cover = document.createElement("div");
  cover.className = "catalogue-cover";
  const imageUrl = safeHttpsUrl(item.cover_url);
  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => {
      image.remove();
      cover.classList.add("is-placeholder");
    }, { once: true });
    cover.append(image);
  } else {
    cover.classList.add("is-placeholder");
  }
  if (cover.classList.contains("is-placeholder")) {
    const mark = document.createElement("span");
    mark.className = "catalogue-cover-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = page.type === "patrika" ? "पत्रिका" : "चौक";
    cover.append(mark);
  }

  const body = document.createElement("div");
  body.className = "catalogue-card-body";
  const metadata = document.createElement("p");
  metadata.className = "catalogue-meta";
  const label = item.episode_label || (page.type === "patrika" ? "प्रकाशित अंक" : "");
  const date = formatDate(item.issue_date || item.published_at || item.created_at);
  const duration = formatDuration(item.duration_seconds);
  metadata.textContent = [label, date, duration].filter(Boolean).join(" · ");
  const title = document.createElement("h2");
  title.textContent = item.title || "शीर्षक उपलब्ध नहीं";
  const description = document.createElement("p");
  description.className = "catalogue-description";
  description.textContent = item.description || "";
  body.append(metadata, title, description);

  const mediaUrl = safeHttpsUrl(item.media_url);
  if (mediaUrl) {
    if (page.type !== "patrika") {
      const audioUrl = /\.(mp3|m4a|aac|ogg|opus|wav)(?:$|[?#])/i.test(mediaUrl);
      const videoUrl = /\.(mp4|webm|m4v)(?:$|[?#])/i.test(mediaUrl);
      if (audioUrl || videoUrl) {
        const player = document.createElement(audioUrl ? "audio" : "video");
        player.className = "catalogue-player";
        player.controls = true;
        player.preload = "metadata";
        if (videoUrl) player.playsInline = true;
        player.src = mediaUrl;
        body.append(player);
      }
    }
    const action = document.createElement("a");
    action.className = "catalogue-action";
    action.href = mediaUrl;
    action.target = "_blank";
    action.rel = "noopener noreferrer";
    action.textContent = `${page.action} ↗`;
    body.append(action);
  } else {
    const unavailable = document.createElement("p");
    unavailable.className = "catalogue-unavailable";
    unavailable.textContent = "इस सामग्री का लिंक अभी उपलब्ध नहीं है।";
    body.append(unavailable);
  }

  card.append(cover, body);
  return card;
}

function renderMessage(title, description, retry = false) {
  const state = document.createElement("div");
  state.className = "catalogue-state";
  const mark = document.createElement("span");
  mark.className = "catalogue-state-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "चौ";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const detail = document.createElement("p");
  detail.textContent = description;
  state.append(mark, heading, detail);
  if (retry) {
    const button = document.createElement("button");
    button.className = "retry-button";
    button.type = "button";
    button.textContent = "फिर से कोशिश करें";
    button.addEventListener("click", () => void loadMedia());
    state.append(button);
  }
  feed.replaceChildren(state);
}

async function loadMedia() {
  feed.setAttribute("aria-busy", "true");
  try {
    const response = await fetch(`/api/media?type=${encodeURIComponent(page.type)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Media API returned ${response.status}`);
    if (!Array.isArray(result?.data)) throw new Error("Media API returned an invalid response");
    if (result.data.length === 0) {
      renderMessage("अभी कोई प्रकाशित सामग्री उपलब्ध नहीं है", "नई सामग्री प्रकाशित होने पर वह यहां दिखाई देगी।");
      return;
    }
    feed.replaceChildren(...result.data.map(renderItem));
  } catch (error) {
    console.error("Unable to load published media:", error);
    renderMessage("सामग्री लोड नहीं हुई", error instanceof Error ? error.message : "मीडिया सेवा उपलब्ध नहीं है।", true);
  } finally {
    feed.setAttribute("aria-busy", "false");
  }
}

void loadMedia();
