const articleContainer = document.querySelector("#article-detail");
const articleSlug = window.location.pathname.slice("/article/".length);

function addArticleMedia(article, content) {
  const imageUrl = !article.video_url && (article.thumbnail_url || article.image_url);
  if (imageUrl) {
    const image = document.createElement("img");
    image.className = "article-detail-image";
    image.src = imageUrl;
    image.alt = article.thumbnail_url
      ? article.thumbnail_alt_text || article.title || ""
      : article.image_alt || article.title || "";
    image.loading = "lazy";
    content.append(image);
  }
  if (article.video_url) {
    const video = document.createElement("video");
    video.className = "article-detail-media";
    video.src = article.video_url;
    if (article.thumbnail_url || article.image_url) video.poster = article.thumbnail_url || article.image_url;
    video.controls = true;
    video.preload = "metadata";
    content.append(video);
  }
  if (article.audio_url) {
    const audio = document.createElement("audio");
    audio.className = "article-detail-media";
    audio.src = article.audio_url;
    audio.controls = true;
    audio.preload = "metadata";
    content.append(audio);
  }
  const attribution = [];
  if (article.thumbnail_credit_line) attribution.push(`चित्र श्रेय: ${article.thumbnail_credit_line}`);
  if (article.thumbnail_license_name) attribution.push(`लाइसेंस: ${article.thumbnail_license_name}`);
  if (attribution.length) {
    content.append(makeArticleElement("p", "article-media-attribution", attribution.join(" · ")));
  }
}

function renderArticle(article) {
  document.title = `${article.title || "खबर"} — CHOWK NEWS`;
  const description = document.querySelector('meta[name="description"]');
  if (description && article.excerpt) description.content = article.excerpt;

  const content = document.createElement("div");
  content.className = "article-detail-content";
  const meta = document.createElement("div");
  meta.className = "article-meta";
  if (article.content_type === "opinion") {
    meta.append(makeArticleElement("span", "article-type-label", "Opinion"));
  }
  if (article.category_name) {
    meta.append(makeArticleElement("span", "eyebrow", article.category_name));
  }
  if (article.article_type?.name) {
    meta.append(makeArticleElement("span", "article-type-label", article.article_type.name));
  }
  if (article.news_priority === "breaking"
      && article.breaking_review_status === "approved"
      && article.breaking_expires_at
      && new Date(article.breaking_expires_at) > new Date()) {
    meta.append(makeArticleElement("span", "article-breaking-label", "ब्रेकिंग"));
  }
  if (article.published_at) {
    const date = new Date(article.published_at);
    if (!Number.isNaN(date.getTime())) {
      const time = document.createElement("time");
      time.dateTime = date.toISOString();
      time.textContent = new Intl.DateTimeFormat("hi-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(date);
      meta.append(time);
    }
  }

  content.append(meta, makeArticleElement("h1", "article-detail-title", article.title));
  if (article.content_type === "opinion") {
    const contributor = article.opinion_contributor;
    const byline = makeArticleElement("p", "article-opinion-byline");
    if (contributor?.display_name) {
      byline.append(document.createTextNode("Opinion by "));
      if (contributor.slug) {
        const link = document.createElement("a");
        link.href = `/contributor/${encodeURIComponent(contributor.slug)}`;
        link.textContent = contributor.display_name;
        byline.append(link);
      } else {
        byline.append(document.createTextNode(contributor.display_name));
      }
      byline.append(document.createTextNode(
        `${article.opinion_column_name ? ` · ${article.opinion_column_name}` : ""} — personal viewpoint`
      ));
    } else {
      byline.textContent = "Opinion — personal viewpoint";
    }
    content.append(byline);
    if (contributor?.institutional_affiliation) {
      content.append(makeArticleElement("p", "article-opinion-affiliation", `Affiliation: ${contributor.institutional_affiliation}`));
    }
    if (article.conflict_of_interest_disclosure) {
      content.append(makeArticleElement("p", "article-opinion-disclosure", `Conflict / disclosure: ${article.conflict_of_interest_disclosure}`));
    }
  }
  if (article.excerpt) content.append(makeArticleElement("p", "article-detail-excerpt", article.excerpt));
  addArticleMedia(article, content);
  const body = makeArticleElement("div", "article-detail-body", article.content || "");
  content.append(body);
  articleContainer.replaceChildren(content);
  articleContainer.setAttribute("aria-busy", "false");
}

function makeArticleElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text || "";
  return element;
}

async function loadArticle() {
  if (!articleSlug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(articleSlug)) {
    showArticleError("खबर का पता सही नहीं है।");
    return;
  }
  try {
    const response = await fetch(`/api/articles/${encodeURIComponent(articleSlug)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "खबर लोड नहीं हुई।");
    if (!result?.data || typeof result.data.content !== "string") {
      throw new Error("खबर की सामग्री उपलब्ध नहीं है।");
    }
    renderArticle(result.data);
  } catch (error) {
    showArticleError(error instanceof Error ? error.message : "खबर लोड नहीं हुई।");
  }
}

function showArticleError(message) {
  articleContainer.replaceChildren(makeArticleElement("p", "article-detail-error", message));
  articleContainer.setAttribute("aria-busy", "false");
}

void loadArticle();
