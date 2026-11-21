const root = document.querySelector("#contributor-profile");
const slug = window.location.pathname.slice("/contributor/".length);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

async function loadContributor() {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    root.replaceChildren(element("p", "", "Invalid contributor profile."));
    return;
  }
  try {
    const response = await fetch(`/api/contributors/${encodeURIComponent(slug)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Contributor could not be loaded.");
    const contributor = result.data.contributor;
    document.title = `${contributor.display_name} — CHOWK NEWS`;
    const header = element("header", "contributor-profile-header");
    header.append(
      element("a", "opinion-submit-back", "← Back to Chowk News"),
      element("span", "eyebrow", `${contributor.contributor_type} contributor`)
    );
    header.querySelector("a").href = "/";
    if (contributor.photo_url) {
      const photo = element("img", "contributor-profile-photo");
      photo.src = contributor.photo_url;
      photo.alt = contributor.display_name;
      header.append(photo);
    }
    header.append(
      element("h1", "", contributor.display_name),
      element("p", "contributor-profile-affiliation", contributor.institutional_affiliation || "")
    );
    if (contributor.public_bio) header.append(element("p", "contributor-profile-bio", contributor.public_bio));
    root.replaceChildren(header);
    const opinions = element("section", "contributor-profile-opinions");
    opinions.append(element("h2", "", "Published opinions"));
    if (!result.data.articles.length) {
      opinions.append(element("p", "", "No published opinions yet."));
    } else {
      result.data.articles.forEach((article) => {
        const card = element("article", "contributor-opinion-card");
        card.append(
          element("a", "", article.title),
          element("p", "", article.excerpt || "")
        );
        card.querySelector("a").href = `/article/${encodeURIComponent(article.slug)}`;
        opinions.append(card);
      });
    }
    root.append(opinions);
  } catch (error) {
    root.replaceChildren(element("p", "", error instanceof Error ? error.message : "Contributor could not be loaded."));
  }
}

void loadContributor();
