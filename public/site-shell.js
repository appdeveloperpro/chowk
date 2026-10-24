(function () {
const siteHeaderMarkup = `
  <header class="site-header">
    <div class="masthead page-width">
      <a class="brand" href="/" aria-label="CHOWK NEWS होम">
        <img class="brand-logo" src="/chowk-logo.png" alt="CHOWK NEWS — बात सीधी, चोट तीखी">
      </a>
      <p class="location-note">खबर आपके शहर की <span aria-hidden="true">·</span> ज़मीनी नज़र, साफ़ बात</p>
      <div class="header-actions">
        <button class="icon-button" type="button" aria-label="खोजें" id="search-toggle" aria-expanded="false" aria-controls="search-form">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.4"></circle><path d="m16 16 4.2 4.2"></path></svg>
        </button>
        <a class="login-button reporter-entry" href="/reporter">रिपोर्टर</a>
        <a class="login-button" href="/auth?mode=login">लॉगिन</a>
        <a class="join-button" href="/auth?mode=register">जुड़ें <span aria-hidden="true">↗</span></a>
      </div>
    </div>
    <form class="search-panel page-width" id="search-form" action="/" method="get" hidden>
      <label class="visually-hidden" for="search-input">खबर खोजें</label>
      <input id="search-input" name="q" type="search" placeholder="खबर खोजें…">
      <button type="submit">खोजें</button>
    </form>
    <nav class="category-nav" aria-label="मुख्य नेविगेशन">
      <div class="page-width nav-items">
        <a class="nav-link" data-site-nav="home" href="/">होम</a>
        <a class="nav-link" data-site-nav="media" href="/chowk-patrika">चौक मीडिया</a>
        <a class="nav-link" data-site-nav="reporter" href="/reporter">रिपोर्टर पोर्टल</a>
        <a class="nav-link" data-site-nav="legal" href="/legal">नीतियां</a>
      </div>
    </nav>
  </header>
`;

const siteFooterMarkup = `
  <footer class="site-footer">
    <div class="page-width footer-main">
      <section class="footer-about" id="about">
        <a class="footer-brand" href="/" aria-label="CHOWK NEWS होम">
          <img class="brand-logo footer-brand-logo" src="/chowk-logo.png" alt="CHOWK NEWS — बात सीधी, चोट तीखी">
        </a>
        <h2>आपके शहर की आवाज़।</h2>
        <p>यह वेबसाइट और यहां की सामग्री विकास चरण में है; इसे वास्तविक समाचार न मानें।</p>
      </section>
      <nav class="footer-links" aria-label="चौक मीडिया">
        <h2>चौक मीडिया</h2>
        <a href="/chowk-patrika">चौक पत्रिका</a>
        <a href="/chowk-charcha">चौक चर्चा</a>
        <a href="/podcasts">पॉडकास्ट</a>
        <a href="/#latest">ताज़ा खबरें</a>
        <a href="/#live">चौक लाइव</a>
      </nav>
      <nav class="footer-links" id="policies" aria-label="जानकारी और नीतियां">
        <h2>जानकारी</h2>
        <a href="/legal">कानूनी नीतियां</a>
        <a href="/legal/corrections-takedown-grievance">सुधार और शिकायत नीति</a>
        <a href="/reporter">रिपोर्टर पोर्टल</a>
      </nav>
      <nav class="footer-links" aria-label="अकाउंट">
        <h2>अकाउंट</h2>
        <a href="/auth?mode=login">लॉगिन</a>
        <a href="/auth?mode=register">रजिस्टर</a>
        <a href="/admin">स्टाफ लॉगिन</a>
      </nav>
    </div>
    <div class="footer-bottom">
      <div class="page-width footer-bottom-inner">
        <span>© CHOWK NEWS · INDIA</span>
        <span>विकास चरण · खबरें वास्तविक समाचार नहीं हैं</span>
        <a href="/#top">वापस ऊपर ↑</a>
      </div>
    </div>
  </footer>
`;

function replaceSiteShellSlot(selector, markup) {
  const slot = document.querySelector(selector);
  if (!slot) return;
  const template = document.createElement("template");
  template.innerHTML = markup;
  slot.replaceWith(template.content);
}

replaceSiteShellSlot("[data-site-shell-header]", siteHeaderMarkup);
replaceSiteShellSlot("[data-site-shell-footer]", siteFooterMarkup);

const currentPath = window.location.pathname;
const activeNavigation = currentPath === "/"
  ? "home"
  : currentPath.startsWith("/legal")
    ? "legal"
    : currentPath === "/reporter" || currentPath === "/credential"
      ? "reporter"
      : ["/chowk-patrika", "/chowk-charcha", "/podcasts"].includes(currentPath)
        ? "media"
        : "";
if (activeNavigation) {
  const link = document.querySelector(`[data-site-nav="${activeNavigation}"]`);
  link?.classList.add("active");
  link?.setAttribute("aria-current", "page");
}

const searchToggle = document.querySelector("#search-toggle");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
if (searchToggle && searchForm) {
  searchToggle.addEventListener("click", () => {
    searchForm.hidden = !searchForm.hidden;
    searchToggle.setAttribute("aria-expanded", String(!searchForm.hidden));
    if (!searchForm.hidden) searchInput?.focus();
  });
  const query = new URLSearchParams(window.location.search).get("q");
  if (query && searchInput) {
    searchInput.value = query;
    searchForm.hidden = false;
    searchToggle.setAttribute("aria-expanded", "true");
  }
}
})();
