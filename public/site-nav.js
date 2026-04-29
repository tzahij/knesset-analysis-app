function normalizePathname(pathname) {
  const normalized = String(pathname || "").replace(/\/+$/u, "");
  return normalized || "/";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SITE_NAV_ITEMS = [
  {
    key: "home",
    label: "דף הבית",
    href: "/",
    isActive: (location) =>
      normalizePathname(location.pathname) === "/" &&
      !new URLSearchParams(location.search).get("source"),
  },
  {
    key: "protocols",
    label: "פרוטוקולים",
    href: "/plenum/",
    children: [
      {
        key: "plenum",
        label: "מליאת הכנסת",
        href: "/plenum/",
        isActive: (location) =>
          normalizePathname(location.pathname) === "/plenum" ||
          normalizePathname(location.pathname) === "/protocol" ||
          normalizePathname(location.pathname).startsWith("/protocol/"),
      },
      {
        key: "committees",
        label: "ועדות כנסת",
        href: "/committees/",
        isActive: (location) =>
          normalizePathname(location.pathname) === "/committees" ||
          normalizePathname(location.pathname) === "/committee-protocol" ||
          normalizePathname(location.pathname).startsWith("/committee-protocol/"),
      },
    ],
  },
  {
    key: "laws",
    label: "חוקים",
    href: "/laws/",
    children: [
      {
        key: "laws-all",
        label: "חוקים שהועברו בקריאה שלישית",
        href: "/laws/",
        isActive: (location) =>
          normalizePathname(location.pathname) === "/laws" ||
          normalizePathname(location.pathname) === "/law" ||
          (normalizePathname(location.pathname).startsWith("/law/") &&
            !normalizePathname(location.pathname).includes("/surprising-votes/")),
      },
      {
        key: "surprising-votes",
        label: "הצבעות מפתיעות",
        href: "/surprising-votes/",
        isActive: (location) =>
          normalizePathname(location.pathname) === "/surprising-votes" ||
          normalizePathname(location.pathname) === "/law-surprise-explanation" ||
          normalizePathname(location.pathname).startsWith("/law-surprise-explanation/") ||
          normalizePathname(location.pathname).includes("/surprising-votes/"),
      },
    ],
  },
  {
    key: "members-and-parties",
    label: "חברי כנסת ומפלגות",
    href: "/members",
    children: [
      {
        key: "members",
        label: "פרופילים אישיים",
        href: "/members",
        isActive: (location) =>
          normalizePathname(location.pathname) === "/members" ||
          normalizePathname(location.pathname).startsWith("/members/"),
      },
      {
        key: "talk-to-your-representatives",
        label: "דברו עם הנציגים שלכם!",
        href: "/talk-to-your-representatives",
        isActive: (location) =>
          normalizePathname(location.pathname) === "/talk-to-your-representatives",
      },
      {
        key: "know-your-mk",
        label: "מיפוי הכנסת",
        href: "/know-your-mk",
        isActive: (location) => normalizePathname(location.pathname) === "/know-your-mk",
      },
      {
        key: "comparisons",
        label: "השוואות בין מפלגות",
        href: "/comparisons",
        isActive: (location) => normalizePathname(location.pathname) === "/comparisons",
      },
    ],
  },
  {
    key: "methodology",
    label: "איך אנחנו יודעים",
    href: "/how-we-know",
    isActive: (location) => normalizePathname(location.pathname) === "/how-we-know",
  },
];

function isItemActive(item, location) {
  if (typeof item.isActive === "function" && item.isActive(location)) {
    return true;
  }

  if (Array.isArray(item.children)) {
    return item.children.some((child) => isItemActive(child, location));
  }

  return false;
}

function renderChildLink(item, location) {
  const isActive = isItemActive(item, location);
  return `
    <a class="site-nav__dropdown-link${isActive ? " is-active" : ""}" href="${escapeHtml(item.href)}">
      ${escapeHtml(item.label)}
    </a>
  `;
}

function renderItem(item, location) {
  const isActive = isItemActive(item, location);

  if (Array.isArray(item.children) && item.children.length) {
    return `
      <div class="site-nav__item site-nav__item--group${isActive ? " is-active" : ""}">
        <a class="site-nav__link${isActive ? " is-active" : ""}" href="${escapeHtml(item.href)}">
          <span>${escapeHtml(item.label)}</span>
          <span class="site-nav__caret" aria-hidden="true">▾</span>
        </a>
        <div class="site-nav__dropdown" aria-label="${escapeHtml(item.label)}">
          ${item.children.map((child) => renderChildLink(child, location)).join("")}
        </div>
      </div>
    `;
  }

  return `
    <a class="site-nav__link${isActive ? " is-active" : ""}" href="${escapeHtml(item.href)}">
      ${escapeHtml(item.label)}
    </a>
  `;
}

function renderNav() {
  const location = window.location;
  const header = document.createElement("header");
  header.className = "site-nav-shell";

  header.innerHTML = `
    <div class="site-nav">
      <a class="site-nav__brand" href="/">
        <span class="site-nav__brand-title">Knesset AI</span>
        <span class="site-nav__brand-subtitle">מפת הכנסת והחוקים</span>
      </a>
      <nav class="site-nav__links" aria-label="ניווט ראשי באתר">
        ${SITE_NAV_ITEMS.map((item) => renderItem(item, location)).join("")}
      </nav>
    </div>
  `;

  document.body.prepend(header);
  document.body.classList.add("has-site-nav");
}

renderNav();
