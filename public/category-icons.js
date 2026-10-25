(() => {
  const icons = [
    { key: "newspaper", label: "सामान्य", paths: ["M4 4h13a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V4Z", "M8 8h7", "M8 12h7", "M8 16h3", "M2 7v11a2 2 0 0 0 2 2"] },
    { key: "siren", label: "अपराध", paths: ["M5 16h14", "M7 16v-4a5 5 0 0 1 10 0v4", "M4 20h16", "M12 2v2", "m4.9 5.1-1.4-1.4", "m19.1 5.1 1.4-1.4"] },
    { key: "sprout", label: "कृषि", paths: ["M12 21v-9", "M12 12C7 12 4 9 4 4c5 0 8 3 8 8Z", "M12 15c0-5 3-8 8-8 0 5-3 8-8 8Z"] },
    { key: "trophy", label: "खेल", paths: ["M8 21h8", "M12 17v4", "M7 4h10v5a5 5 0 0 1-10 0V4Z", "M7 6H4v2a4 4 0 0 0 4 4", "M17 6h3v2a4 4 0 0 1-4 4"] },
    { key: "cpu", label: "तकनीक", paths: ["M9 9h6v6H9z", "M9 2v3", "M15 2v3", "M9 19v3", "M15 19v3", "M2 9h3", "M2 15h3", "M19 9h3", "M19 15h3", "M5 5h14v14H5z"] },
    { key: "leaf", label: "पर्यावरण", paths: ["M20 4c-8 0-14 3-14 10a6 6 0 0 0 6 6c7 0 8-8 8-16Z", "M4 21c2-5 6-8 11-11"] },
    { key: "chart", label: "बिजनेस", paths: ["M3 3v18h18", "m7 14 4-4 4 3 6-7"] },
    { key: "clapperboard", paths: ["M3 8h18v12H3z", "m3 8 2-5h18l-2 5", "m8 3 3 5", "m15 3 3 5"] , label: "मनोरंजन" },
    { key: "landmark", label: "राजनीति", paths: ["m3 9 9-6 9 6", "M4 10h16", "M6 10v8", "M10 10v8", "M14 10v8", "M18 10v8", "M3 21h18", "M4 18h16"] },
    { key: "globe", label: "विदेश", paths: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M2 12h20", "M12 2a15 15 0 0 1 0 20", "M12 2a15 15 0 0 0 0 20"] },
    { key: "book", label: "शिक्षा", paths: ["M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z", "M4 17a2.5 2.5 0 0 1 2.5-2.5H20", "M8 7h8"] },
    { key: "heart", label: "स्वास्थ्य", paths: ["M20.8 8.6c0 5.4-8.8 11-8.8 11s-8.8-5.6-8.8-11A4.6 4.6 0 0 1 12 6.3a4.6 4.6 0 0 1 8.8 2.3Z", "M3 12h5l2-3 3 6 2-3h6"] },
    { key: "map-pin", label: "स्थानीय", paths: ["M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"], circles: [[12, 10, 2.5]] },
    { key: "cloud", label: "मौसम", paths: ["M20 16.2A4.8 4.8 0 0 0 17 7h-1.2A7 7 0 1 0 6 18h11a4 4 0 0 0 3-1.8Z", "M12 2v2", "M4.9 4.9l1.4 1.4", "M2 12h2", "M19.1 4.9l-1.4 1.4"] },
    { key: "briefcase", label: "रोजगार", paths: ["M3 7h18v13H3z", "M8 7V4h8v3", "M3 12h18", "M10 12v2h4v-2"] }
  ];
  const iconByKey = new Map(icons.map((icon) => [icon.key, icon]));

  function create(key, className = "") {
    const icon = iconByKey.get(key) || iconByKey.get("newspaper");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    if (className) svg.setAttribute("class", className);
    icon.paths.forEach((definition) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", definition);
      svg.append(path);
    });
    (icon.circles || []).forEach(([cx, cy, radius]) => {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(cx));
      circle.setAttribute("cy", String(cy));
      circle.setAttribute("r", String(radius));
      svg.append(circle);
    });
    return svg;
  }

  window.ChowkCategoryIcons = { icons, create, has: (key) => iconByKey.has(key) };
})();
