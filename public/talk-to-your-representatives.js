const representativesTotalMembersElement = document.getElementById("representatives-total-members");
const representativesTotalContactsElement = document.getElementById("representatives-total-contacts");
const representativesDirectMembersElement = document.getElementById("representatives-direct-members");
const representativesSearchInput = document.getElementById("representatives-search-input");
const representativesPartySelect = document.getElementById("representatives-party-select");
const representativesSortSelect = document.getElementById("representatives-sort-select");
const representativesPlatformFiltersElement = document.getElementById(
  "representatives-platform-filters",
);
const representativesResultsSummaryElement = document.getElementById(
  "representatives-results-summary",
);
const representativesBuiltAtElement = document.getElementById("representatives-built-at");
const representativesDisclaimerElement = document.getElementById("representatives-disclaimer");
const representativesGridElement = document.getElementById("representatives-grid");
const memberStatusHelper = window.KnessetMemberStatus || null;

const DIRECT_CONTACT_PLATFORMS = new Set(["email", "phone", "whatsapp"]);

const state = {
  payload: null,
  search: "",
  party: "",
  sort: "party",
  platform: "",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString("he-IL");
}

function formatIsoDate(isoValue) {
  if (!isoValue) {
    return "לא זמין";
  }

  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(isoValue));
}

function getDirectoryMemberCounts() {
  const members = Array.isArray(state.payload?.members) ? state.payload.members : [];
  return memberStatusHelper?.getCounts(members) || {
    total: Number(state.payload?.summary?.totalMembers || 0),
    former: 0,
    current: Number(state.payload?.summary?.totalMembers || 0),
  };
}

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['"׳״`]/g, "")
    .replace(/[-‐‑‒–—―־/]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getStableHash(value) {
  let hash = 0;

  for (const character of String(value || "")) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function buildRepresentativePartyThemeStyle(member) {
  const partySeed = `${member?.partySlug || ""}|${member?.partyName || ""}`;
  const memberSeed = `${member?.routeSlug || ""}|${member?.slug || ""}|${member?.name || ""}`;
  const partyHash = getStableHash(partySeed);
  const memberHash = getStableHash(memberSeed);
  const baseHue = partyHash % 360;
  const hueShift = (memberHash % 28) - 14;
  const hue = (baseHue + hueShift + 360) % 360;
  const secondaryHue = (hue + 18 + (memberHash % 18)) % 360;

  return [
    `--representative-party-accent: hsl(${hue} 56% 37%)`,
    `--representative-party-accent-secondary: hsl(${secondaryHue} 68% 48%)`,
    `--representative-card-bg-start: hsl(${hue} 82% 97%)`,
    `--representative-card-bg-end: hsl(${secondaryHue} 74% 92%)`,
    `--representative-party-chip-bg: hsl(${hue} 82% 96% / 0.94)`,
    `--representative-party-chip-text: hsl(${hue} 52% 28%)`,
    `--representative-party-border: hsl(${hue} 42% 46% / 0.2)`,
    `--representative-party-shadow: hsl(${hue} 40% 34% / 0.11)`,
  ].join("; ");
}

function renderStrokeIcon(pathsMarkup) {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${pathsMarkup}
    </svg>
  `;
}

function renderFillIcon(pathsMarkup) {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
      ${pathsMarkup}
    </svg>
  `;
}

function renderTextIcon(text, fontSize, y = 15.25) {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="0" y="0" width="24" height="24" rx="12" fill="none"></rect>
      <text
        x="12"
        y="${y}"
        text-anchor="middle"
        font-size="${fontSize}"
        font-weight="800"
        fill="currentColor"
        font-family="Heebo, 'Segoe UI', sans-serif"
      >${escapeHtml(text)}</text>
    </svg>
  `;
}

function getContactPlatformMeta(platform) {
  switch (String(platform || "").trim().toLowerCase()) {
    case "email":
      return {
        className: "is-email",
        title: "אימייל",
        actionLabel: "שלחו מייל",
        iconMarkup: renderStrokeIcon(
          '<path d="M4 7.5h16v9H4z"></path><path d="m5 8 7 5 7-5"></path>',
        ),
      };
    case "phone":
      return {
        className: "is-phone",
        title: "טלפון",
        actionLabel: "התקשרו",
        iconMarkup: renderStrokeIcon(
          '<path d="M8.2 4.7c.5-.6 1.4-.8 2.1-.4l2 1.2c.7.4 1 1.2.7 2l-.7 1.9a1.5 1.5 0 0 0 .3 1.5l.5.5a10.6 10.6 0 0 0 2.7 2.1l.7.3a1.5 1.5 0 0 0 1.4-.1l1.7-.9c.8-.4 1.8-.3 2.4.4l1.5 1.7c.6.7.6 1.8 0 2.5l-.8.9c-.8.9-2 1.3-3.1 1.1-2.3-.5-4.8-1.9-7.5-4.6-2.7-2.7-4.1-5.2-4.6-7.5-.2-1.1.2-2.3 1.1-3.1z"></path>',
        ),
      };
    case "whatsapp":
      return {
        className: "is-whatsapp",
        title: "וואטסאפ",
        actionLabel: "פתחו בוואטסאפ",
        iconMarkup: renderStrokeIcon(
          '<path d="M12 20a8 8 0 1 0-4-1.1L5 20l1.2-2.8A8 8 0 0 0 12 20z"></path><path d="M10 9.4c.2-.4.6-.4.8-.4h.5c.2 0 .4 0 .5.3l.6 1.4c.1.2.1.5-.1.7l-.4.5c-.1.1-.1.3 0 .4.4.8 1.2 1.6 2 2 .1.1.3.1.4 0l.5-.4c.2-.2.5-.2.7-.1l1.4.6c.3.1.3.3.3.5v.5c0 .2 0 .6-.4.8-.4.2-1.2.2-2.1-.1-1-.4-2.2-1.2-3.3-2.3s-1.9-2.3-2.3-3.3c-.3-.9-.3-1.7-.1-2.1z"></path>',
        ),
      };
    case "facebook":
      return {
        className: "is-facebook",
        title: "פייסבוק",
        actionLabel: "עברו לפייסבוק",
        iconMarkup: renderFillIcon(
          '<path d="M14.2 20v-6.3h2.2l.4-2.7h-2.6V9.3c0-.8.2-1.4 1.3-1.4H17V5.4c-.7-.1-1.3-.1-2-.1-2 0-3.5 1.2-3.5 3.6V11H9.2v2.7h2.3V20z"></path>',
        ),
      };
    case "instagram":
      return {
        className: "is-instagram",
        title: "אינסטגרם",
        actionLabel: "עברו לאינסטגרם",
        iconMarkup: renderStrokeIcon(
          '<rect x="5" y="5" width="14" height="14" rx="4"></rect><circle cx="12" cy="12" r="3.4"></circle><circle cx="16.6" cy="7.6" r="1"></circle>',
        ),
      };
    case "threads":
      return {
        className: "is-threads",
        title: "Threads",
        actionLabel: "עברו ל-Threads",
        iconMarkup: renderTextIcon("@", 17, 15.7),
      };
    case "x":
      return {
        className: "is-x",
        title: "X",
        actionLabel: "עברו ל-X",
        iconMarkup: renderStrokeIcon(
          '<path d="M6.5 6h3.1l3.1 4.3L16 6h1.8l-4 4.8L18 18h-3.1l-3.3-4.6L7.8 18H6l4.2-5z"></path>',
        ),
      };
    case "linkedin":
      return {
        className: "is-linkedin",
        title: "לינקדאין",
        actionLabel: "עברו ללינקדאין",
        iconMarkup: renderStrokeIcon(
          '<circle cx="8" cy="8.2" r="1.2"></circle><path d="M8 10.8V17"></path><path d="M11.3 10.8V17"></path><path d="M11.3 13.9c0-1.9 1-3.1 2.8-3.1 1.6 0 2.6 1.1 2.6 3V17"></path>',
        ),
      };
    case "tiktok":
      return {
        className: "is-tiktok",
        title: "טיקטוק",
        actionLabel: "עברו לטיקטוק",
        iconMarkup: renderStrokeIcon(
          '<path d="M14 5v8.3a3.3 3.3 0 1 1-2.1-3.1"></path><path d="M14 5c.7 1.6 1.8 2.7 3.5 3.2"></path>',
        ),
      };
    case "youtube":
      return {
        className: "is-youtube",
        title: "יוטיוב",
        actionLabel: "עברו ליוטיוב",
        iconMarkup: renderStrokeIcon(
          '<path d="M20.2 8.1a2.3 2.3 0 0 0-1.6-1.6C17.1 6 12 6 12 6s-5.1 0-6.6.5A2.3 2.3 0 0 0 3.8 8 24.7 24.7 0 0 0 3.5 12c0 1.5.1 2.8.3 3.9a2.3 2.3 0 0 0 1.6 1.6C6.9 18 12 18 12 18s5.1 0 6.6-.5a2.3 2.3 0 0 0 1.6-1.6c.2-1.1.3-2.4.3-3.9s-.1-2.8-.3-3.9z"></path><path d="m10 9.5 4.5 2.5-4.5 2.5z"></path>',
        ),
      };
    default:
      return {
        className: "is-website",
        title: "אתר",
        actionLabel: "עברו לקישור",
        iconMarkup: renderStrokeIcon(
          '<circle cx="12" cy="12" r="8"></circle><path d="M4 12h16"></path><path d="M12 4a12 12 0 0 1 0 16"></path><path d="M12 4a12 12 0 0 0 0 16"></path>',
        ),
      };
  }
}

function decodeUrlComponentSafely(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function extractContactUrlSegments(contact) {
  try {
    const parsed = new URL(String(contact?.href || ""));
    const hashPath = parsed.hash.startsWith("#!/")
      ? parsed.hash.slice(2)
      : parsed.hash.startsWith("#/")
        ? parsed.hash.slice(1)
        : "";
    const rawPath = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : hashPath;

    return rawPath
      .split("/")
      .map((segment) => decodeUrlComponentSafely(segment).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function formatContactDisplayValue(contact) {
  if (!contact) {
    return "";
  }

  const platform = String(contact.platform || "").trim().toLowerCase();

  if (DIRECT_CONTACT_PLATFORMS.has(platform)) {
    return String(contact.value || "");
  }

  try {
    const parsed = new URL(String(contact.href || ""));
    const compactPath = parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname}${compactPath}` || parsed.hostname;
  } catch {
    return String(contact.value || contact.href || "");
  }
}

function formatContactCompactDetail(contact) {
  if (!contact) {
    return "";
  }

  const platform = String(contact.platform || "").trim().toLowerCase();

  if (DIRECT_CONTACT_PLATFORMS.has(platform)) {
    return String(contact.value || contact.label || "").trim();
  }

  try {
    const parsed = new URL(String(contact.href || ""));
    const host = parsed.hostname.replace(/^www\./, "");
    const segments = extractContactUrlSegments(contact);
    const firstSegment = segments[0] || "";
    const secondSegment = segments[1] || "";

    switch (platform) {
      case "instagram":
      case "threads":
      case "x":
      case "tiktok":
        return firstSegment ? `@${firstSegment.replace(/^@/, "")}` : host;
      case "facebook":
        if (firstSegment.toLowerCase() === "profile.php") {
          const profileId = String(parsed.searchParams.get("id") || "").trim();
          return profileId ? `profile ${profileId.slice(-4)}` : host;
        }
        return firstSegment || host;
      case "youtube":
        if (firstSegment.startsWith("@")) {
          return firstSegment;
        }

        if (["channel", "user", "c"].includes(firstSegment.toLowerCase()) && secondSegment) {
          return secondSegment;
        }

        return host;
      case "linkedin":
        return segments.slice(0, 2).join("/") || host;
      case "website":
      default:
        return host;
    }
  } catch {
    return formatContactDisplayValue(contact);
  }
}

function buildContactAnchorAttributes(contact, accessibleLabel) {
  const platform = String(contact.platform || "").trim().toLowerCase();
  const sharedAttributes = ` aria-label="${escapeHtml(accessibleLabel)}" title="${escapeHtml(
    accessibleLabel,
  )}"`;

  if (platform === "email" || platform === "phone") {
    return sharedAttributes;
  }

  return `${sharedAttributes} target="_blank" rel="noreferrer noopener"`;
}

function buildFilterIconMarkup(platform) {
  if (!platform) {
    return renderStrokeIcon(
      '<circle cx="12" cy="12" r="7"></circle><path d="M8 12h8"></path>',
    );
  }

  return getContactPlatformMeta(platform).iconMarkup;
}

function getFilteredMembers() {
  const searchNeedle = normalizeSearch(state.search);
  const members = Array.isArray(state.payload?.members) ? [...state.payload.members] : [];

  return members
    .filter((member) => {
      if (state.party && member.partySlug !== state.party) {
        return false;
      }

      if (state.platform && !member.availablePlatforms.includes(state.platform)) {
        return false;
      }

      if (!searchNeedle) {
        return true;
      }

      return normalizeSearch(`${member.name} ${member.partyName}`).includes(searchNeedle);
    })
    .sort((left, right) => {
      if (state.sort === "name") {
        return String(left.name || "").localeCompare(String(right.name || ""), "he");
      }

      if (state.sort === "contacts") {
        if ((right.contactCount || 0) !== (left.contactCount || 0)) {
          return (right.contactCount || 0) - (left.contactCount || 0);
        }

        return String(left.name || "").localeCompare(String(right.name || ""), "he");
      }

      if ((left.partyName || "") !== (right.partyName || "")) {
        return String(left.partyName || "").localeCompare(String(right.partyName || ""), "he");
      }

      return String(left.name || "").localeCompare(String(right.name || ""), "he");
    });
}

function renderStats() {
  const summary = state.payload?.summary || {};
  const counts = getDirectoryMemberCounts();
  representativesTotalMembersElement.textContent = counts.former
    ? `${formatInteger(counts.current)} כיום`
    : formatInteger(summary.totalMembers);
  representativesTotalContactsElement.textContent = formatInteger(summary.totalContacts);
  representativesDirectMembersElement.textContent = formatInteger(summary.membersWithDirectContact);
}

function renderPartyOptions() {
  const parties = Array.isArray(state.payload?.parties) ? state.payload.parties : [];

  representativesPartySelect.innerHTML = `
    <option value="">כל הסיעות</option>
    ${parties
      .map(
        (party) => `
          <option value="${escapeHtml(party.slug || "")}">
            ${escapeHtml(party.name || "")} (${formatInteger(party.memberCount)})
          </option>
        `,
      )
      .join("")}
  `;
  representativesPartySelect.value = state.party;
}

function renderPlatformFilters() {
  const summary = state.payload?.summary || {};
  const availablePlatforms = Array.isArray(state.payload?.availablePlatforms)
    ? state.payload.availablePlatforms
    : [];

  representativesPlatformFiltersElement.innerHTML = `
    <button
      class="representative-platform-filter${state.platform ? "" : " is-active"}"
      type="button"
      data-platform-filter=""
    >
      <span class="representative-platform-filter__icon">
        ${buildFilterIconMarkup("")}
      </span>
      <span class="representative-platform-filter__label">הכל</span>
      <span class="representative-platform-filter__count">${formatInteger(summary.totalMembers)}</span>
    </button>
    ${availablePlatforms
      .map((platform) => {
        const meta = getContactPlatformMeta(platform);
        const count = Number(summary.platformMemberCounts?.[platform] || 0);

        return `
          <button
            class="representative-platform-filter${state.platform === platform ? " is-active" : ""}"
            type="button"
            data-platform-filter="${escapeHtml(platform)}"
          >
            <span class="representative-platform-filter__icon">${meta.iconMarkup}</span>
            <span class="representative-platform-filter__label">${escapeHtml(meta.title)}</span>
            <span class="representative-platform-filter__count">${formatInteger(count)}</span>
          </button>
        `;
      })
      .join("")}
  `;
}

function renderRepresentativeContactButton(contact, isDirect) {
  const platform = String(contact.platform || "").trim().toLowerCase();
  const meta = getContactPlatformMeta(platform);
  const compactDetail = formatContactCompactDetail(contact);
  const displayValue = formatContactDisplayValue(contact);
  const accessibleLabel = [meta.actionLabel || meta.title, compactDetail || displayValue || meta.title]
    .filter(Boolean)
    .join(" · ");

  return `
    <a
      class="representative-contact-button ${escapeHtml(meta.className)}${isDirect ? " is-direct" : ""}"
      href="${escapeHtml(contact.href || "#")}"${buildContactAnchorAttributes(contact, accessibleLabel)}
    >
      <span class="representative-contact-button__icon">${meta.iconMarkup}</span>
      <span class="sr-only">${escapeHtml(accessibleLabel)}</span>
    </a>
  `;
}

function renderRepresentativeCard(member) {
  const directContacts = member.contacts.filter((contact) =>
    DIRECT_CONTACT_PLATFORMS.has(String(contact.platform || "").trim().toLowerCase()),
  );
  const socialContacts = member.contacts.filter(
    (contact) => !DIRECT_CONTACT_PLATFORMS.has(String(contact.platform || "").trim().toLowerCase()),
  );
  const profileHref = String(member.href || "").trim() || "#";
  const partyThemeStyle = buildRepresentativePartyThemeStyle(member);
  const cardLabel = `פתחו את הפרופיל של ${String(member.name || "").trim()}`;

  return `
    <article
      class="representative-card${member.contactCount ? "" : " is-empty"}"
      data-profile-href="${escapeHtml(profileHref)}"
      tabindex="0"
      role="link"
      aria-label="${escapeHtml(cardLabel)}"
      style="${escapeHtml(partyThemeStyle)}"
    >
      <div class="representative-card__header">
        <div>
          <span class="representative-card__party">${escapeHtml(member.partyName || "")}</span>
          <h3>${escapeHtml(member.name || "")}</h3>
        </div>
        <span class="representative-card__count">${escapeHtml(
          `${formatInteger(member.contactCount)} ערוצים`,
        )}</span>
      </div>
      ${
        member.contactCount
          ? `
              ${
                directContacts.length
                  ? `
                      <div class="representative-card__actions representative-card__actions--direct">
                        ${directContacts
                          .map((contact) => renderRepresentativeContactButton(contact, true))
                          .join("")}
                      </div>
                    `
                  : ""
              }
              ${
                socialContacts.length
                  ? `
                      <div class="representative-card__actions representative-card__actions--social">
                        ${socialContacts
                          .map((contact) => renderRepresentativeContactButton(contact, false))
                          .join("")}
                      </div>
                    `
                  : ""
              }
            `
          : `
              <p class="muted representative-card__empty-state">
                לא מצאנו כרגע ערוצי קשר ציבוריים זמינים בכרטיס הזה.
              </p>
            `
      }
    </article>
  `;
}

function renderGrid() {
  const filteredMembers = getFilteredMembers();
  const platformTitle = state.platform ? getContactPlatformMeta(state.platform).title : "כל הערוצים";
  const totalMembers = Number(state.payload?.summary?.totalMembers || 0);
  const filteredCounts = memberStatusHelper?.getCounts(filteredMembers) || {
    total: filteredMembers.length,
    former: 0,
    current: filteredMembers.length,
  };
  const allCounts = getDirectoryMemberCounts();

  representativesResultsSummaryElement.textContent = allCounts.former
    ? `מציג ${formatInteger(filteredCounts.total)} מתוך ${formatInteger(totalMembers)} פרופילים · ${formatInteger(
        filteredCounts.former,
      )} לא מכהנים כיום · ${platformTitle}`
    : `מציג ${formatInteger(filteredMembers.length)} מתוך ${formatInteger(totalMembers)} חברי כנסת · ${platformTitle}`;

  if (!filteredMembers.length) {
    representativesGridElement.innerHTML = `
      <article class="landing-empty-card representative-empty-card">
        <p class="muted">לא נמצאו חברי כנסת שמתאימים לסינון שבחרתם.</p>
      </article>
    `;
    return;
  }

  representativesGridElement.innerHTML = filteredMembers.map(renderRepresentativeCard).join("");
}

function renderPage() {
  renderStats();
  renderPartyOptions();
  renderPlatformFilters();
  renderGrid();
  const counts = getDirectoryMemberCounts();
  const baseDisclaimer = String(state.payload?.disclaimer || "").trim();

  representativesBuiltAtElement.textContent = `עודכן לאחרונה: ${formatIsoDate(
    state.payload?.builtAt,
  )}`;
  representativesDisclaimerElement.textContent = counts.former
    ? `${baseDisclaimer} כולל ${formatInteger(counts.former)} פרופילים ארכיוניים של מי שאינם חברי כנסת מכהנים כיום.`
    : baseDisclaimer;
}

async function readApiJson(response) {
  const contentType = String(response.headers.get("content-type") || "");

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("השרת החזיר תוכן לא צפוי במקום JSON.");
  }

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  return payload;
}

async function loadDirectory() {
  try {
    const response = await fetch("/api/member-contact-directory");
    const payload = await readApiJson(response);
    state.payload = payload;
    renderPage();
  } catch (error) {
    const message = error.message || String(error);
    representativesResultsSummaryElement.textContent = "שגיאה בטעינת הספרייה";
    representativesBuiltAtElement.textContent = "לא הצלחנו לטעון את זמן העדכון.";
    representativesDisclaimerElement.textContent = "לא הצלחנו לטעון כרגע את ספריית הקשר.";
    representativesGridElement.innerHTML = `
      <article class="landing-empty-card representative-empty-card">
        <p class="error-message">${escapeHtml(message)}</p>
      </article>
    `;
  }
}

function openRepresentativeProfile(cardElement, event = null) {
  const href = String(cardElement?.dataset?.profileHref || "").trim();

  if (!href || href === "#") {
    return;
  }

  if (event?.metaKey || event?.ctrlKey) {
    window.open(href, "_blank", "noopener");
    return;
  }

  window.location.href = href;
}

representativesSearchInput.addEventListener("input", () => {
  state.search = representativesSearchInput.value;
  renderGrid();
});

representativesPartySelect.addEventListener("change", () => {
  state.party = representativesPartySelect.value;
  renderGrid();
});

representativesSortSelect.addEventListener("change", () => {
  state.sort = representativesSortSelect.value;
  renderGrid();
});

representativesPlatformFiltersElement.addEventListener("click", (event) => {
  const button = event.target.closest("[data-platform-filter]");

  if (!button) {
    return;
  }

  state.platform = button.dataset.platformFilter || "";
  renderPlatformFilters();
  renderGrid();
});

representativesGridElement.addEventListener("click", (event) => {
  if (event.target.closest(".representative-contact-button")) {
    return;
  }

  const card = event.target.closest(".representative-card[data-profile-href]");

  if (!card) {
    return;
  }

  openRepresentativeProfile(card, event);
});

representativesGridElement.addEventListener("keydown", (event) => {
  const card = event.target.closest(".representative-card[data-profile-href]");

  if (!card || event.target !== card) {
    return;
  }

  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  openRepresentativeProfile(card);
});

void loadDirectory();
