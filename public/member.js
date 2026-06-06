const memberNameElement = document.getElementById("member-name");
const memberPartyElement = document.getElementById("member-party");
const memberStatsElement = document.getElementById("member-stats");
const memberAliasesElement = document.getElementById("member-aliases");
const memberContactListElement = document.getElementById("member-contact-list");
const memberStatusElement = document.getElementById("member-status");
const memberFileFullStatusElement = document.getElementById("member-file-full-status");
const memberFileFullDownloadLink = document.getElementById("member-file-full-download-link");
const memberFileSmallStatusElement = document.getElementById("member-file-small-status");
const memberFileSmallDownloadLink = document.getElementById("member-file-small-download-link");
const memberSummaryElement = document.getElementById("member-summary");
const memberResultsSummaryElement = document.getElementById("member-results-summary");
const memberProtocolListElement = document.getElementById("member-protocol-list");
const memberAnalysisTabButton = document.getElementById("member-analysis-tab");
const memberHighlightsTabButton = document.getElementById("member-highlights-tab");
const memberProtocolsTabButton = document.getElementById("member-protocols-tab");
const memberVotesTabButton = document.getElementById("member-votes-tab");
const memberAnalysisSourceFullTabButton = document.getElementById("member-analysis-source-full-tab");
const memberAnalysisSourceSmallTabButton = document.getElementById("member-analysis-source-small-tab");
const memberHighlightsSourceFullTabButton = document.getElementById("member-highlights-source-full-tab");
const memberHighlightsSourceSmallTabButton = document.getElementById("member-highlights-source-small-tab");
const memberAnalysisPanelElement = document.getElementById("member-analysis-panel");
const memberHighlightsPanelElement = document.getElementById("member-highlights-panel");
const memberProtocolsPanelElement = document.getElementById("member-protocols-panel");
const memberVotesPanelElement = document.getElementById("member-votes-panel");
const memberAnalysisSummaryElement = document.getElementById("member-analysis-summary");
const memberAnalysisDisclaimerElement = document.getElementById("member-analysis-disclaimer");
const memberAnalysisStatusElement = document.getElementById("member-analysis-status");
const memberAnalysisBuildButton = document.getElementById("member-analysis-build-button");
const memberAnalysisGraphElement = document.getElementById("member-analysis-graph");
const memberAnalysisContentElement = document.getElementById("member-analysis-content");
const memberHighlightsSummaryElement = document.getElementById("member-highlights-summary");
const memberHighlightsDisclaimerElement = document.getElementById("member-highlights-disclaimer");
const memberHighlightsStatusElement = document.getElementById("member-highlights-status");
const memberHighlightsBuildButton = document.getElementById("member-highlights-build-button");
const memberHighlightsContentElement = document.getElementById("member-highlights-content");
const memberVotesSummaryElement = document.getElementById("member-votes-summary");
const memberVotesStatusElement = document.getElementById("member-votes-status");
const memberVotesContentElement = document.getElementById("member-votes-content");

const AXIS_META = {
  religiousVsSecular: {
    title: "דתי מול חילוני",
    lowLabel: "חילוני",
    highLabel: "דתי",
  },
  socialismVsCapitalism: {
    title: "סוציאליזם מול קפיטליזם",
    lowLabel: "סוציאליסטי",
    highLabel: "קפיטליסטי",
  },
  dovishVsHawkish: {
    title: "יוני מול נצי",
    lowLabel: "יוני",
    highLabel: "נצי",
  },
  liberalDemocracyVsAuthoritarianism: {
    title: "דמוקרטיה ליברלית מול סמכותנות",
    lowLabel: "דמוקרטיה ליברלית",
    highLabel: "סמכותנות",
  },
};

const ANALYSIS_SECTION_META = [
  {
    key: "coreStances",
    title: "עמדות ליבה",
    description: "מהו ציר העמדות המרכזי שעולה מן החומר, ואיך הוא מוצג כלפי הציבור והמערכת.",
    theme: "stances",
  },
  {
    key: "psychologicalProfile",
    title: "פרופיל פסיכולוגי",
    description: "איך הדובר נשמע, פועל וממקם את עצמו מול יריבים, בעלי ברית והקהל הרחב.",
    theme: "psychology",
  },
  {
    key: "clashesAndIncongruencies",
    title: "עימותים ואי-הלימה",
    description: "איפה ניכרים מתחים, סתירות, סטיות ופערים בין הרובד המוצהר לרובד המשתמע.",
    theme: "clashes",
  },
];

const HIGHLIGHT_SECTION_META = [
  {
    key: "innermostEmotions",
    title: "רגשות ותחושות פנימיים",
    description: "ציטוטים שבהם חבר הכנסת חושף כאב, פחד, גאווה, תקווה, פגיעות או רגש אישי עמוק.",
    theme: "emotions",
  },
  {
    key: "surprisingInnerWorldOrHistory",
    title: "עולם פנימי או היסטוריה אישית מפתיעים",
    description: "ציטוטים שחושפים ביוגרפיה, זיכרון, שכבת עומק או פרט לא צפוי על מי שעומד מאחורי הדמות הציבורית.",
    theme: "surprise",
  },
  {
    key: "benevolentTowardOthers",
    title: "מחשבות טובות על אחרים בכנסת",
    description: "ציטוטים לא סרקסטיים שבהם יש פרגון, נדיבות, חמלה, הגנה או יחס מיטיב כלפי אחרים במשכן.",
    theme: "benevolent",
  },
];

const state = {
  activeTab: null,
  activeAnalysisSourceType: "full",
  pollTimer: null,
  analysisRequestInFlight: false,
  analysisRequestSourceType: null,
  latestPayload: null,
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isLowVoteProfileSubstantiation(voteProfile) {
  const countedLawCount = Number(voteProfile?.countedLawCount ?? voteProfile?.supportedLawCount ?? 0);
  const minimumCount = Number(voteProfile?.minimumSubstantiatedVoteCount || 5);
  return Boolean(voteProfile?.isLowSubstantiation) || (countedLawCount > 0 && countedLawCount < minimumCount);
}

function getVoteProfileSubstantiationWarning(voteProfile) {
  if (!isLowVoteProfileSubstantiation(voteProfile)) {
    return "";
  }

  return String(voteProfile?.substantiationWarning || "").trim();
}

function renderVoteProfileCautionNote(voteProfile) {
  const warning = getVoteProfileSubstantiationWarning(voteProfile);

  if (!warning) {
    return "";
  }

  return `
    <div class="analysis-source-disclaimer vote-confidence-note">
      <p>${escapeHtml(warning)}</p>
    </div>
  `;
}

function renderStrokeIcon(paths) {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      ${paths}
    </svg>
  `;
}

function renderTextIcon(text, fontSize = 11) {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <text
        x="50%"
        y="58%"
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
  switch (platform) {
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
        iconMarkup: renderTextIcon("f", 16),
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
        iconMarkup: renderTextIcon("@", 14),
      };
    case "x":
      return {
        className: "is-x",
        title: "X / טוויטר",
        actionLabel: "עברו ל-X",
        iconMarkup: renderTextIcon("X", 12),
      };
    case "linkedin":
      return {
        className: "is-linkedin",
        title: "לינקדאין",
        actionLabel: "עברו ללינקדאין",
        iconMarkup: renderTextIcon("in", 10),
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

function getContactGroupKey(platform) {
  return ["email", "phone", "whatsapp"].includes(platform) ? "direct" : "social";
}

function getContactPlatformPriority(platform) {
  switch (platform) {
    case "phone":
      return 1;
    case "whatsapp":
      return 2;
    case "email":
      return 3;
    case "facebook":
      return 10;
    case "instagram":
      return 11;
    case "threads":
      return 12;
    case "x":
      return 13;
    case "linkedin":
      return 14;
    case "tiktok":
      return 15;
    case "youtube":
      return 16;
    case "website":
      return 17;
    default:
      return 99;
  }
}

function sortContactsForPresentation(contacts) {
  return [...contacts].sort((left, right) => {
    const leftGroupPriority = getContactGroupKey(left.platform) === "direct" ? 0 : 1;
    const rightGroupPriority = getContactGroupKey(right.platform) === "direct" ? 0 : 1;
    const groupComparison = leftGroupPriority - rightGroupPriority;

    if (groupComparison !== 0) {
      return groupComparison;
    }

    const platformComparison =
      getContactPlatformPriority(left.platform) - getContactPlatformPriority(right.platform);

    if (platformComparison !== 0) {
      return platformComparison;
    }

    return formatContactDisplayValue(left).localeCompare(formatContactDisplayValue(right), "he");
  });
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

function formatContactCompactDetail(contact) {
  if (!contact) {
    return "";
  }

  if (["email", "phone", "whatsapp"].includes(contact.platform)) {
    return String(contact.value || contact.label || "").trim();
  }

  try {
    const parsed = new URL(String(contact.href || ""));
    const host = parsed.hostname.replace(/^www\./, "");
    const segments = extractContactUrlSegments(contact);
    const firstSegment = segments[0] || "";
    const secondSegment = segments[1] || "";

    switch (contact.platform) {
      case "instagram":
      case "threads":
      case "x":
      case "tiktok":
        return firstSegment ? `@${firstSegment.replace(/^@/, "")}` : host;
      case "facebook":
        if (firstSegment.toLowerCase() === "profile.php") {
          const profileId = String(parsed.searchParams.get("id") || "").trim();
          return profileId ? `profile • ${profileId.slice(-4)}` : host;
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

function getContactTileLabel(platform, meta) {
  switch (platform) {
    case "email":
      return "מייל";
    case "phone":
      return "טלפון";
    case "whatsapp":
      return "WhatsApp";
    case "facebook":
      return "Facebook";
    case "instagram":
      return "Instagram";
    case "threads":
      return "Threads";
    case "x":
      return "X";
    case "linkedin":
      return "LinkedIn";
    case "tiktok":
      return "TikTok";
    case "youtube":
      return "YouTube";
    case "website":
      return "אתר";
    default:
      return meta?.title || "";
  }
}

function formatContactDisplayValue(contact) {
  if (!contact) {
    return "";
  }

  if (contact.platform === "email" || contact.platform === "phone" || contact.platform === "whatsapp") {
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

function buildContactAnchorAttributes(contact, meta, detail) {
  const accessibleLabel = [meta?.actionLabel || meta?.title || "", detail || ""]
    .filter(Boolean)
    .join(" · ");
  const sharedAttributes = ` aria-label="${escapeHtml(accessibleLabel)}" title="${escapeHtml(
    accessibleLabel,
  )}"`;

  if (contact.platform === "email" || contact.platform === "phone") {
    return sharedAttributes;
  }

  return `${sharedAttributes} target="_blank" rel="noreferrer noopener"`;
}

function formatAxisScore(value) {
  const numeric = Number(value || 0);

  if (!Number.isFinite(numeric)) {
    return "0";
  }

  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

function clampAxisScore(value) {
  const numeric = Number(value || 0);

  if (!Number.isFinite(numeric)) {
    return 1;
  }

  return Math.max(1, Math.min(10, numeric));
}

function getAxisMarkerPosition(score) {
  return ((clampAxisScore(score) - 1) / 9) * 100;
}

function renderAxisMeter(lowLabel, highLabel, score, options = {}) {
  const position = getAxisMarkerPosition(score);
  const scoreText = `${formatAxisScore(score)}/10`;
  const valueLabel = options.valueLabel || "המיקום על הציר";

  return `
    <div class="axis-meter ${escapeHtml(options.className || "")}">
      <div class="axis-meter__labels">
        <span>1 · ${escapeHtml(lowLabel)}</span>
        <span>10 · ${escapeHtml(highLabel)}</span>
      </div>
      <div class="axis-meter__track">
        <span class="axis-meter__marker" style="left: ${position}%"></span>
      </div>
      <p class="axis-meter__value">${escapeHtml(valueLabel)}: <strong>${escapeHtml(scoreText)}</strong></p>
    </div>
  `;
}

function renderAxisMeter(lowLabel, highLabel, score, options = {}) {
  const position = getAxisMarkerPosition(score);
  const scoreText = `${formatAxisScore(score)}/10`;
  const valueLabel = options.valueLabel || "המיקום על הציר";

  return `
    <div class="axis-meter${options.className ? ` ${options.className}` : ""}">
      <div class="axis-meter__labels">
        <span>1 - ${escapeHtml(lowLabel)}</span>
        <span>10 - ${escapeHtml(highLabel)}</span>
      </div>
      <div class="axis-meter__track">
        <span class="axis-meter__marker" style="left: ${position}%"></span>
      </div>
      <p class="axis-meter__value">${escapeHtml(valueLabel)}: <strong>${escapeHtml(scoreText)}</strong></p>
    </div>
  `;
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

function getMemberSlugFromPath() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  const rawSlug = segments[segments.length - 1] || "";

  try {
    return decodeURIComponent(rawSlug);
  } catch {
    return rawSlug;
  }
}

function buildFriendlyApiError(response, bodyText) {
  const text = String(bodyText || "").trim();
  const lowerText = text.toLowerCase();
  const isTunnelError =
    lowerText.includes("no tunnel") ||
    lowerText.includes("tunnel unavailable") ||
    lowerText.includes("localtunnel");

  if (isTunnelError) {
    return new Error(
      "קישור השיתוף הציבורי הזמני כבר לא פעיל. צריך לפתוח קישור ציבורי חדש כדי להמשיך.",
    );
  }

  if (response.status === 404) {
    return new Error("המשאב המבוקש לא נמצא.");
  }

  if (!response.ok) {
    return new Error(`השרת החזיר תשובה לא תקינה (${response.status}).`);
  }

  return new Error("השרת החזיר HTML במקום JSON. כנראה שקישור השיתוף הציבורי נשבר.");
}

async function readApiJson(response) {
  const contentType = String(response.headers.get("content-type") || "");
  const isJson = contentType.toLowerCase().includes("application/json");

  if (isJson) {
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error || `Request failed (${response.status})`);
    }

    return payload;
  }

  const bodyText = await response.text().catch(() => "");
  throw buildFriendlyApiError(response, bodyText);
}

async function fetchApiJson(url, options = {}) {
  // Add a cache buster query parameter to prevent aggressive browser/CDN caching of API data
  const separator = url.includes("?") ? "&" : "?";
  const urlWithCacheBuster = `${url}${separator}t=${Date.now()}`;
  
  const response = await fetch(urlWithCacheBuster, {
    ...options,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      ...(options.headers || {})
    }
  });
  return readApiJson(response);
}

function setActiveTab(tab) {
  state.activeTab = tab || null;
  const isAnalysisTab = tab === "analysis";
  const isHighlightsTab = tab === "highlights";
  const isProtocolsTab = tab === "protocols";
  const isVotesTab = tab === "votes";

  memberAnalysisTabButton.classList.toggle("is-active", isAnalysisTab);
  memberAnalysisTabButton.setAttribute("aria-selected", isAnalysisTab ? "true" : "false");
  memberAnalysisTabButton.setAttribute("aria-expanded", isAnalysisTab ? "true" : "false");
  memberHighlightsTabButton.classList.toggle("is-active", isHighlightsTab);
  memberHighlightsTabButton.setAttribute("aria-selected", isHighlightsTab ? "true" : "false");
  memberHighlightsTabButton.setAttribute("aria-expanded", isHighlightsTab ? "true" : "false");
  memberProtocolsTabButton.classList.toggle("is-active", isProtocolsTab);
  memberProtocolsTabButton.setAttribute("aria-selected", isProtocolsTab ? "true" : "false");
  memberProtocolsTabButton.setAttribute("aria-expanded", isProtocolsTab ? "true" : "false");
  memberVotesTabButton.classList.toggle("is-active", isVotesTab);
  memberVotesTabButton.setAttribute("aria-selected", isVotesTab ? "true" : "false");
  memberVotesTabButton.setAttribute("aria-expanded", isVotesTab ? "true" : "false");
  memberAnalysisPanelElement.hidden = !isAnalysisTab;
  memberHighlightsPanelElement.hidden = !isHighlightsTab;
  memberProtocolsPanelElement.hidden = !isProtocolsTab;
  memberVotesPanelElement.hidden = !isVotesTab;
}

function toggleTab(tab) {
  setActiveTab(state.activeTab === tab ? null : tab);
}

function getRequestedMemberSection() {
  const params = new URLSearchParams(window.location.search);
  const querySection = String(params.get("section") || "").trim().toLowerCase();
  const hashSection = String(window.location.hash || "")
    .replace(/^#/, "")
    .trim()
    .toLowerCase();

  if (querySection) {
    return querySection;
  }

  return hashSection;
}

function applyRequestedMemberSection(options = {}) {
  const requestedSection = getRequestedMemberSection();
  const shouldScroll = options.scroll !== false;

  if (["analysis", "highlights", "protocols", "votes"].includes(requestedSection)) {
    setActiveTab(requestedSection);
  } else {
    setActiveTab("analysis");
  }

  if (shouldScroll) {
    window.requestAnimationFrame(() => {
      const activePanel = [
        { id: "analysis", el: memberAnalysisPanelElement },
        { id: "highlights", el: memberHighlightsPanelElement },
        { id: "protocols", el: memberProtocolsPanelElement },
        { id: "votes", el: memberVotesPanelElement },
      ].find(p => p.id === (["analysis", "highlights", "protocols", "votes"].includes(requestedSection) ? requestedSection : "analysis"))?.el;
      
      activePanel?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }
}

function renderMemberStatus(payload) {
  const status = payload?.status || null;
  memberStatusElement.className = "updates-status";

  if (!status || status.status === "idle") {
    memberStatusElement.innerHTML =
      '<p class="muted">הסריקה תתחיל אוטומטית עם פתיחת הדף.</p>';
    return;
  }

  if (status.status === "running") {
    memberStatusElement.classList.add("is-running");
    memberStatusElement.innerHTML = `
      <p><span class="status-chip">האינדקס עדיין נבנה</span></p>
      <p>${status.processedProtocols.toLocaleString("he-IL")} מתוך ${status.totalProtocols.toLocaleString(
        "he-IL",
      )} פרוטוקולים נסרקו</p>
      <p class="muted">התוצאות בעמוד זה חלקיות בינתיים וימשיכו להתעדכן אוטומטית.</p>
    `;
    return;
  }

  if (status.status === "failed") {
    memberStatusElement.classList.add("is-error");
    memberStatusElement.innerHTML = `
      <p><span class="status-chip">בניית האינדקס נכשלה</span></p>
      <p class="error-message">${escapeHtml(
        (status.recentErrors || [])[0] || "אירעה שגיאה לא צפויה.",
      )}</p>
    `;
    return;
  }

  memberStatusElement.classList.add(
    status.status === "completed_with_errors" ? "is-warning" : "is-success",
  );
  memberStatusElement.innerHTML = `
    <p><span class="status-chip">האינדקס זמין</span></p>
    <p class="muted">סריקה מ-${escapeHtml(payload.sinceDate)} ואילך</p>
    <p class="muted">עודכן לאחרונה: ${escapeHtml(formatIsoDate(status.lastIndexedAt))}</p>
    ${
      status.status === "completed_with_errors"
        ? '<p class="error-message">הסריקה הסתיימה עם מעט שגיאות, אבל רוב התוצאות זמינות.</p>'
        : ""
    }
  `;
}

function renderMemberMeta(payload) {
  const { member, stats } = payload;
  const voteBasedLawCount = Number(payload.voteProfile?.countedLawCount ?? payload.voteProfile?.supportedLawCount ?? 0);
  memberNameElement.textContent = member.name;
  memberPartyElement.textContent = member.partyName;
  document.title = member.name;

  memberStatsElement.innerHTML = [
    ["סך הפרוטוקולים שנמצאו", Number(stats.totalProtocols || 0).toLocaleString("he-IL")],
    ["ישיבות מליאה", Number(stats.plenumProtocols || 0).toLocaleString("he-IL")],
    ["ישיבות ועדה", Number(stats.committeeProtocols || 0).toLocaleString("he-IL")],
    [
      "חוקים שנכללו בפרופיל ההצבעות",
      voteBasedLawCount.toLocaleString("he-IL"),
    ],
  ]
    .map(
      ([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>
      `,
    )
    .join("");

  const extraAliases = (member.aliases || []).filter((alias) => alias !== member.name).slice(0, 6);
  memberAliasesElement.innerHTML = extraAliases.length
    ? extraAliases.map((alias) => `<span class="pill">${escapeHtml(alias)}</span>`).join("")
    : '<span class="muted">לא הוגדרו שמות חלופיים נוספים.</span>';

  memberSummaryElement.textContent = payload.isPartial
    ? `האינדקס עדיין נבנה, ולכן זו רשימה חלקית של פרוטוקולים שבהם ${member.name} זוהה כדובר החל מ-${payload.sinceDate}.`
    : `רשימת הפרוטוקולים שבהם ${member.name} זוהה כדובר, החל מ-${payload.sinceDate}.`;
}

function renderContactSection(payload) {
  const contact = payload?.contact || null;
  const contacts = Array.isArray(contact?.contacts) ? contact.contacts : [];

  if (!contacts.length) {
    memberContactListElement.innerHTML =
      '<p class="muted">לא מצאנו כרגע דרכי קשר פומביות שנוכל להציג כאן עבור הפרופיל הזה.</p>';
    return;
  }

  const sortedContacts = sortContactsForPresentation(contacts);
  const directContacts = sortedContacts.filter(
    (contactItem) => getContactGroupKey(contactItem.platform) === "direct",
  );
  const socialContacts = sortedContacts.filter(
    (contactItem) => getContactGroupKey(contactItem.platform) === "social",
  );

  function renderContactCluster(clusterTitle, clusterEyebrow, clusterContacts, gridClassName) {
    if (!clusterContacts.length) {
      return "";
    }

    return `
      <section class="member-contact-cluster">
        <div class="member-contact-cluster__header">
          <div>
            <p class="member-contact-cluster__eyebrow">${escapeHtml(clusterEyebrow)}</p>
            <h3 class="member-contact-cluster__title">${escapeHtml(clusterTitle)}</h3>
          </div>
          <span class="member-contact-cluster__count">${escapeHtml(
            `${clusterContacts.length.toLocaleString("he-IL")} ערוצים`,
          )}</span>
        </div>
        <div class="member-contact-cluster__grid ${escapeHtml(gridClassName)}">
          ${clusterContacts
            .map((contactItem) => {
              const meta = getContactPlatformMeta(contactItem.platform);
              const displayValue = formatContactDisplayValue(contactItem);
              const compactDetail = formatContactCompactDetail(contactItem);

              return `
                <article class="member-contact-action ${escapeHtml(meta.className)}">
                  <a
                    class="member-contact-action__main ${escapeHtml(meta.className)}"
                    href="${escapeHtml(contactItem.href || "#")}"${buildContactAnchorAttributes(
                      contactItem,
                      meta,
                      compactDetail || displayValue || meta.title,
                    )}
                  >
                    <span class="member-contact-action__icon-shell">
                      <span class="member-contact-action__icon">${meta.iconMarkup}</span>
                    </span>
                    <span class="member-contact-action__label">${escapeHtml(
                      getContactTileLabel(contactItem.platform, meta),
                    )}</span>
                    <span class="member-contact-action__detail">${escapeHtml(
                      compactDetail || displayValue || meta.title,
                    )}</span>
                  </a>
                  <button
                    class="member-contact-action__report"
                    type="button"
                    data-contact-report="1"
                    data-contact-id="${escapeHtml(contactItem.id || "")}"
                    data-contact-platform="${escapeHtml(contactItem.platform || "")}"
                    data-contact-label="${escapeHtml(displayValue || compactDetail || meta.title)}"
                    data-contact-href="${escapeHtml(contactItem.href || "")}"
                  >
                    לא עובד? דווחו לנו!
                  </button>
                </article>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  memberContactListElement.innerHTML = `
    ${renderContactCluster(
      "קשר ישיר",
      "ישיר",
      directContacts,
      "member-contact-cluster__grid--direct",
    )}
    ${renderContactCluster(
      "פרופילים וערוצים",
      "ברשתות",
      socialContacts,
      "member-contact-cluster__grid--social",
    )}
  `;
}

async function submitContactReport(buttonElement) {
  if (!buttonElement || buttonElement.disabled) {
    return;
  }

  const slug = getMemberSlugFromPath();
  const requestBody = {
    contactId: buttonElement.dataset.contactId || "",
    platform: buttonElement.dataset.contactPlatform || "",
    label: buttonElement.dataset.contactLabel || "",
    href: buttonElement.dataset.contactHref || "",
  };

  buttonElement.disabled = true;

  try {
    await fetchApiJson(`/api/members/${encodeURIComponent(slug)}/contact-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    buttonElement.textContent = "תודה! קיבלנו את הדיווח.";
    buttonElement.classList.add("is-success");
  } catch {
    buttonElement.disabled = false;
    buttonElement.textContent = "לא הצלחנו כעת. נסו שוב.";
  }
}

function renderProtocols(payload) {
  const protocols = payload.protocols || [];
  memberResultsSummaryElement.textContent = `נמצאו ${protocols.length.toLocaleString(
    "he-IL",
  )} פרוטוקולים`;

  if (!protocols.length) {
    memberProtocolListElement.innerHTML = payload.isPartial
      ? '<p class="muted">הסריקה עדיין נמשכת. אם הפרוטוקולים של חבר הכנסת טרם הופיעו כאן, הדף יתעדכן אוטומטית.</p>'
      : '<p class="muted">לא נמצאו כרגע פרוטוקולים שבהם חבר הכנסת זוהה כדובר בטווח השנים שנבחר.</p>';
    return;
  }

  memberProtocolListElement.innerHTML = protocols
    .map(
      (protocol) => `
        <article class="member-protocol-item">
          <div class="member-protocol-item__header">
            <span class="source-badge source-badge--${escapeHtml(protocol.source)}">
              ${escapeHtml(protocol.sourceLabel)}
            </span>
            <span class="muted">${escapeHtml(protocol.shortDateLabel)}</span>
          </div>

          <h3>${escapeHtml(protocol.title)}</h3>
          <p class="muted">${escapeHtml(protocol.description || "")}</p>
          ${
            protocol.snippet
              ? `<blockquote class="match-snippet">${escapeHtml(protocol.snippet)}</blockquote>`
              : ""
          }

          <div class="member-protocol-actions">
            <a class="secondary-button compact-button" href="${protocol.readerUrl}">פתח לקריאה</a>
            <a class="secondary-button compact-button" href="${protocol.downloadUrl}">הורד קובץ</a>
          </div>
        </article>
      `,
    )
    .join("");
}



function renderEvidenceList(evidence, options = {}) {
  const compactClass = options.compact ? " analysis-evidence--compact" : "";

  if (!Array.isArray(evidence) || !evidence.length) {
    return '<p class="analysis-empty-note">לא צורפו ציטוטי ראיה נוספים.</p>';
  }

  return `
    <div class="analysis-evidence${compactClass}">
      ${evidence
        .map(
          (item) => `
            <article class="analysis-evidence-item">
              <p class="analysis-evidence-item__protocol">${
                item.href
                  ? `<a href="${escapeHtml(item.href)}">${escapeHtml(item.protocolHeading || "")}</a>`
                  : escapeHtml(item.protocolHeading || "")
              }</p>
              <blockquote>${escapeHtml(item.quote || "")}</blockquote>
              <p>${escapeHtml(item.explanation || "")}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderInsightList(group) {
  const bullets = Array.isArray(group?.bullets) ? group.bullets : [];

  if (!bullets.length) {
    return '<p class="analysis-empty-note">לא הופקו תובנות מספקות בחלק הזה.</p>';
  }

  return `
    <ul class="analysis-insights">
      ${bullets
        .map(
          (bullet) => `
            <li class="analysis-insight">
              <p class="analysis-insight__point">${escapeHtml(bullet.point || "")}</p>
              ${renderEvidenceList(bullet.evidence, { compact: true })}
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function renderOverallProfileCard(overallProfile) {
  if (!overallProfile) {
    return "";
  }

  return `
    <article class="analysis-summary-card">
      <div class="analysis-summary-card__header">
        <p class="analysis-summary-card__eyebrow">דיוקן כולל</p>
        <h3>פרופיל חד וישיר של חבר הכנסת</h3>
        <p>שתי פסקאות קצרות שמזקקות גם את העמדות הגלויות וגם את מה שמסתתר מתחת לפני השטח.</p>
      </div>
      <div class="analysis-summary-card__grid">
        <section class="analysis-summary-block analysis-summary-block--blunt">
          <h4>מה רואים כאן כשחותכים דרך הרעש</h4>
          <p>${escapeHtml(overallProfile.comprehensivePortrait || overallProfile.bluntProfile?.paragraph || "")}</p>
          ${renderEvidenceList(overallProfile.bluntProfile?.evidence || [], { compact: true })}
        </section>
        <section class="analysis-summary-block analysis-summary-block--historical">
          <h4>איך הוא או היא צפויים להיקרא היסטורית</h4>
          <p>${escapeHtml(overallProfile.historicalPerception || overallProfile.historicalContext?.paragraph || "")}</p>
          ${renderEvidenceList(overallProfile.historicalContext?.evidence || [], { compact: true })}
        </section>
      </div>
    </article>
  `;
}

function renderAnalysisComparisonCard(columnTitle, description, group, themeClass, columnClass) {
  return `
    <article class="analysis-cluster analysis-cluster--${escapeHtml(themeClass)} analysis-cluster--${escapeHtml(
      columnClass,
    )}">
      <div class="analysis-cluster__header">
        <p class="analysis-cluster__eyebrow">${escapeHtml(columnTitle)}</p>
        <p>${escapeHtml(description)}</p>
      </div>
      ${renderInsightList(group)}
    </article>
  `;
}

function renderAnalysisComparisonRow(sectionMeta, analysis) {
  const textLayer = analysis?.analysisByExplicitText?.[sectionMeta.key];
  const betweenLayer = analysis?.analysisBetweenTheLines?.[sectionMeta.key];

  return `
    <section class="analysis-row analysis-row--${escapeHtml(sectionMeta.theme)}">
      <div class="analysis-row__intro">
        <h3>${escapeHtml(sectionMeta.title)}</h3>
        <p>${escapeHtml(sectionMeta.description)}</p>
      </div>
      ${renderAnalysisComparisonCard("על סמך הטקסט", "מה עולה מהדברים כפי שנאמרו במפורש.", textLayer, sectionMeta.theme, "text")}
      ${renderAnalysisComparisonCard("בין השורות", "מה משתמע מן הטון, מן ההדגשים וממה שלא נאמר ישירות.", betweenLayer, sectionMeta.theme, "between")}
    </section>
  `;
}

function renderNarrativeComparisonLayout(analysis) {
  return `
    <section class="analysis-comparison">
      <div class="analysis-comparison__header" aria-hidden="true">
        <div class="analysis-comparison__spacer"></div>
        <div class="analysis-comparison__heading analysis-comparison__heading--text">על סמך הטקסט</div>
        <div class="analysis-comparison__heading analysis-comparison__heading--between">בין השורות</div>
      </div>
      ${ANALYSIS_SECTION_META.map((sectionMeta) => renderAnalysisComparisonRow(sectionMeta, analysis)).join("")}
    </section>
  `;
}

function renderAxisReasonList(items) {
  if (!Array.isArray(items) || !items.length) {
    return '<p class="analysis-empty-note">לא צורפו נימוקים מפורשים לציון.</p>';
  }

  return `
    <ul class="analysis-reason-list">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function renderAxisCard(axisKey, axisData) {
  const meta = AXIS_META[axisKey];
  const score = Number(axisData?.score || 0);

  return `
    <section class="analysis-axis-card">
      <div class="analysis-axis-card__top">
        <div>
          <h5>${escapeHtml(meta.title)}</h5>
          <p class="analysis-axis-card__scale-label">${escapeHtml(meta.lowLabel)} (1) עד ${escapeHtml(
            meta.highLabel,
          )} (10)</p>
        </div>
        <span class="analysis-score-pill">${escapeHtml(formatAxisScore(score))}/10</span>
      </div>
      ${renderAxisMeter(meta.lowLabel, meta.highLabel, score, {
        className: "analysis-axis-card__meter",
      })}
      <div class="analysis-axis-card__body">
        <div>
          <p class="analysis-axis-card__label">למה הציון הזה?</p>
          ${renderAxisReasonList(axisData?.explanationBullets)}
        </div>
        <div>
          <p class="analysis-axis-card__label">ראיות מהפרוטוקולים</p>
          ${renderEvidenceList(axisData?.evidence, { compact: true })}
        </div>
      </div>
    </section>
  `;
}

function renderQuantitativeLayer(title, description, layer, themeClass) {
  return `
    <section class="analysis-quant-panel analysis-quant-panel--${escapeHtml(themeClass)}">
      <div class="analysis-quant-panel__header">
        <h4>${escapeHtml(title)}</h4>
        <p>${escapeHtml(description)}</p>
      </div>
      <div class="analysis-axis-card-grid">
        ${Object.keys(AXIS_META)
          .map((axisKey) => renderAxisCard(axisKey, layer?.[axisKey]))
          .join("")}
      </div>
    </section>
  `;
}

function renderAnalysisAction(analysisStatus) {
  if (!analysisStatus?.configured) {
    memberAnalysisBuildButton.disabled = true;
    memberAnalysisBuildButton.textContent = "נדרש GEMINI_API_KEY כדי ליצור ניתוח";
    return;
  }

  if (analysisStatus?.status === "running" || state.analysisRequestInFlight) {
    memberAnalysisBuildButton.disabled = true;
    memberAnalysisBuildButton.textContent = "מנתח כעת את חבר הכנסת הזה...";
    return;
  }

  if (analysisStatus?.status === "failed") {
    memberAnalysisBuildButton.disabled = false;
    memberAnalysisBuildButton.textContent = "נסה שוב לנתח את חבר הכנסת הזה";
    return;
  }

  if (analysisStatus?.status === "completed") {
    memberAnalysisBuildButton.disabled = false;
    memberAnalysisBuildButton.textContent = analysisStatus.isStale
      ? "רענן את הניתוח של חבר הכנסת הזה"
      : "נתח מחדש את חבר הכנסת הזה";
    return;
  }

  memberAnalysisBuildButton.disabled = false;
  memberAnalysisBuildButton.textContent = "צור ניתוח לחבר הכנסת הזה";
}

function renderAnalysisGraph(analysis, voteProfile) {
  return renderAnalysisGraphV2(analysis, voteProfile);
}

function getVoteRankingLabel(axis, voteAxisRecord, voteScore) {
  const ranking = voteAxisRecord?.voteRanking || null;
  const numericScore = Number(voteScore || 0);

  if (!ranking || !Number.isFinite(Number(ranking.totalMembers)) || Number(ranking.totalMembers) < 1) {
    return "";
  }

  const totalMembers = Number(ranking.totalMembers);

  if (numericScore > 5) {
    return `מקום ${escapeHtml(ranking.towardHighRank)}/${escapeHtml(totalMembers)} לכיוון ${escapeHtml(
      axis.highLabel,
    )}`;
  }

  if (numericScore < 5) {
    return `מקום ${escapeHtml(ranking.towardLowRank)}/${escapeHtml(totalMembers)} לכיוון ${escapeHtml(
      axis.lowLabel,
    )}`;
  }

  return `מקום ${escapeHtml(ranking.overallRank)}/${escapeHtml(totalMembers)} בדירוג ההצבעות`;
}

function getAxisLeanLabel(axis, score) {
  const numericScore = Number(score || 0);

  if (!Number.isFinite(numericScore) || numericScore < 1 || numericScore > 10) {
    return "";
  }

  if (numericScore >= 8.5) {
    return `קרוב מאוד ל${axis.highLabel}`;
  }

  if (numericScore >= 6.2) {
    return `נוטה ל${axis.highLabel}`;
  }

  if (numericScore <= 2.5) {
    return `קרוב מאוד ל${axis.lowLabel}`;
  }

  if (numericScore <= 4.4) {
    return `נוטה ל${axis.lowLabel}`;
  }

  return "באזור האמצע";
}

function getAxisSpreadMeta(axis) {
  const scores = [axis.textBased, axis.betweenTheLines];

  if (axis.votesBased >= 1 && axis.votesBased <= 10) {
    scores.push(axis.votesBased);
  }

  const spread = Math.max(...scores) - Math.min(...scores);

  if (spread >= 3) {
    return {
      label: `פער בולט של ${formatAxisScore(spread)}/10`,
      toneClass: "is-wide",
    };
  }

  if (spread >= 1.5) {
    return {
      label: `פער מורגש של ${formatAxisScore(spread)}/10`,
      toneClass: "is-medium",
    };
  }

  return {
    label: "שלוש השכבות די עקביות",
    toneClass: "is-tight",
  };
}

function renderAnalysisAxisRow(axis, label, score, variantClass, detailText = "") {
  return `
    <div class="analysis-graph-axis-row analysis-graph-axis-row--${escapeHtml(variantClass)}">
      <div class="analysis-graph-axis-row__meta">
        <div class="analysis-graph-axis-row__label-wrap">
          <span class="analysis-graph-axis-row__swatch"></span>
          <span class="analysis-graph-axis-row__label">${escapeHtml(label)}</span>
        </div>
        <div class="analysis-graph-axis-row__readout">
          <strong class="analysis-graph-axis-row__score">${escapeHtml(formatAxisScore(score))}/10</strong>
          ${
            detailText
              ? `<small class="analysis-graph-axis-row__detail">${escapeHtml(detailText)}</small>`
              : ""
          }
        </div>
      </div>
      <div class="analysis-graph-axis-row__track">
        <div class="analysis-graph-axis-row__rail">
          <span class="analysis-graph-axis-row__midpoint"></span>
          <span
            class="analysis-graph-axis-row__marker"
            style="left: ${getAxisMarkerPosition(score)}%"
            aria-hidden="true"
          ></span>
        </div>
      </div>
    </div>
  `;
}

function renderAnalysisGraphV2(analysis, voteProfile) {
  if (!analysis?.quantitativeAnalysis) {
    memberAnalysisGraphElement.hidden = true;
    memberAnalysisGraphElement.innerHTML = "";
    return;
  }

  const textBased = analysis.quantitativeAnalysis.textBased || {};
  const betweenTheLines = analysis.quantitativeAnalysis.betweenTheLines || {};
  const votesBased = voteProfile?.axes || {};
  const axisEntries = Object.entries(AXIS_META).map(([key, meta]) => ({
    key,
    label: meta.title,
    lowLabel: meta.lowLabel,
    highLabel: meta.highLabel,
    textBased: Number(textBased[key]?.score || 0),
    betweenTheLines: Number(betweenTheLines[key]?.score || 0),
    votesRecord: votesBased[key] || null,
    votesBased: Number(votesBased[key]?.score || 0),
  }));
  const hasVotesLayer = axisEntries.some((axis) => axis.votesBased >= 1 && axis.votesBased <= 10);

  memberAnalysisGraphElement.hidden = false;
  memberAnalysisGraphElement.innerHTML = `
    <div class="analysis-graph__topbar">
      <div class="analysis-graph__intro">
        <p class="analysis-graph__eyebrow">מבט מהיר על הצירים</p>
        <h4>דיבור מפורש, קריאה משתמעת והצבעות על אותה מפה</h4>
        <p>כל ציר מוצג כאן ככרטיס עצמאי, כדי שיהיה קל לראות במבט אחד איפה יש עקביות ואיפה נפתח פער.</p>
      </div>
      <div class="analysis-graph__legend">
        <span><i class="analysis-graph__dot analysis-graph__dot--expressed"></i> ציטוטים ישירים</span>
        <span><i class="analysis-graph__dot analysis-graph__dot--implicit"></i> קריאה בין השורות</span>
        ${
          hasVotesLayer
            ? '<span><i class="analysis-graph__dot analysis-graph__dot--votes"></i> הצבעות</span>'
            : ""
        }
      </div>
    </div>
    ${renderVoteProfileCautionNote(voteProfile)}
    <div class="analysis-graph__axes">
      ${axisEntries
      .map(
        (axis) => {
          const spreadMeta = getAxisSpreadMeta(axis);

          return `
            <article class="analysis-graph-axis-card">
              <div class="analysis-graph-axis-card__header">
                <div class="analysis-graph-axis-card__title-group">
                  <h5 class="analysis-graph-axis-card__title">${escapeHtml(axis.label)}</h5>
                  <p class="analysis-graph-axis-card__subtitle">מ-${escapeHtml(axis.lowLabel)} ועד ${escapeHtml(
                    axis.highLabel,
                  )}</p>
                </div>
                <span class="analysis-graph-axis-card__spread ${escapeHtml(spreadMeta.toneClass)}">${escapeHtml(
                  spreadMeta.label,
                )}</span>
              </div>

              <div class="analysis-graph-axis-card__rows">
                ${renderAnalysisAxisRow(
                  axis,
                  "ציטוטים ישירים",
                  axis.textBased,
                  "expressed",
                  getAxisLeanLabel(axis, axis.textBased),
                )}
                ${renderAnalysisAxisRow(
                  axis,
                  "קריאה בין השורות",
                  axis.betweenTheLines,
                  "implicit",
                  getAxisLeanLabel(axis, axis.betweenTheLines),
                )}
                ${
                  axis.votesBased >= 1 && axis.votesBased <= 10
                    ? renderAnalysisAxisRow(
                        axis,
                        "הצבעות",
                        axis.votesBased,
                        "votes",
                        getVoteRankingLabel(axis, axis.votesRecord, axis.votesBased),
                      )
                    : ""
                }
              </div>

              <div class="analysis-graph-axis-card__scale" dir="ltr">
                <span class="analysis-graph-axis-card__scale-edge">${escapeHtml(axis.lowLabel)} (1)</span>
                <span class="analysis-graph-axis-card__scale-mid">5</span>
                <span class="analysis-graph-axis-card__scale-edge analysis-graph-axis-card__scale-edge--high">${escapeHtml(
                  axis.highLabel,
                )} (10)</span>
              </div>
            </article>
          `;
        },
      )
      .join("")}
    </div>
  `;
}

function renderAnalysis(payload) {
  const sourceType = state.activeAnalysisSourceType || "full";
  const analysisRecord = payload?.analyses?.[sourceType] || payload?.analysis || null;
  const analysisStatus = analysisRecord?.status || null;
  const analysis = analysisRecord?.analysis || null;
  memberAnalysisStatusElement.className = "updates-status is-neutral";
  memberAnalysisContentElement.innerHTML = "";
  if (memberAnalysisSummaryElement) memberAnalysisSummaryElement.textContent = "";
  renderAnalysisGraphV2(null, null);
  renderSourceDisclaimer(memberAnalysisDisclaimerElement, sourceType);
  renderSourceDisclaimer(memberHighlightsDisclaimerElement, sourceType);
  renderAnalysisAction(analysisStatus);

  if (!analysisStatus || analysisStatus.status === "idle") {
    memberAnalysisStatusElement.innerHTML = analysisStatus?.configured
      ? `
        <p><span class="status-chip">הניתוח עדיין לא נוצר</span></p>
        <p class="muted">אפשר ליצור מכאן ניתוח עבור חבר הכנסת הזה בלבד, או להריץ ניתוח כולל לכל החברים מעמוד חברי הכנסת.</p>
      `
      : `
        <p><span class="status-chip">הניתוח עדיין לא זמין</span></p>
        <p class="muted">כדי להפעיל את הניתוחים צריך להגדיר את משתנה הסביבה <code>GEMINI_API_KEY</code> ואז להריץ את כפתור הניתוח הכללי מעמוד חברי הכנסת.</p>
      `;
    return;
  }

  if (analysisStatus.status === "running") {
    memberAnalysisStatusElement.className = "updates-status is-running";
    memberAnalysisStatusElement.innerHTML = `
      <p><span class="status-chip">הניתוח נבנה עכשיו</span></p>
      <p class="muted">שלב נוכחי: ${escapeHtml(analysisStatus.currentStage || "מעבד את החומר")}</p>
      <p class="muted">המקטעים שעובדו: ${Number(
        analysisStatus.processedChunks || 0,
      ).toLocaleString("he-IL")} מתוך ${Number(analysisStatus.totalChunks || 0).toLocaleString(
        "he-IL",
      )}</p>
    `;
    return;
  }

  if (analysisStatus.status === "failed") {
    memberAnalysisStatusElement.className = "updates-status is-error";
    memberAnalysisStatusElement.innerHTML = `
      <p><span class="status-chip">יצירת הניתוח נכשלה</span></p>
      <p class="error-message">${escapeHtml(
        analysisStatus.error || "אירעה שגיאה בזמן יצירת הניתוח.",
      )}</p>
    `;
    return;
  }

  memberAnalysisStatusElement.className = `updates-status ${
    analysisStatus.isStale ? "is-warning" : "is-success"
  }`;
  memberAnalysisStatusElement.innerHTML = `
    <p><span class="status-chip">הניתוח מוכן</span></p>
    <p class="muted">המודל שבו נוצר: ${escapeHtml(analysisStatus.model || "")}</p>
    <p class="muted">נוצר בתאריך: ${escapeHtml(formatIsoDate(analysisStatus.generatedAt))}</p>
    ${
      analysisStatus.isStale
        ? '<p class="error-message">נוספו מאז ציטוטים חדשים. אפשר לרענן את הניתוח מכפתור העמוד הזה או דרך ההרצה הכללית מעמוד חברי הכנסת.</p>'
        : ""
    }
  `;

  if (!analysis) {
    return;
  }

  if (memberAnalysisSummaryElement) {
    memberAnalysisSummaryElement.textContent =
      "פרופיל חד בשלושה מוקדים: דיוקן כולל, השוואה בין המפורש למשתמע, ומיקום כמותי על ארבעה צירים.";
  }
  renderAnalysisGraphV2(analysis, payload?.voteProfile || null);
  memberAnalysisContentElement.innerHTML = `
    <div class="analysis-layout">
      ${renderOverallProfileCard(analysis.overallProfile)}
      ${renderNarrativeComparisonLayout(analysis)}
      <article class="analysis-quant-shell">
        <div class="analysis-quant-shell__header">
          <p class="analysis-pillar__eyebrow">ניתוח כמותי</p>
          <h3>מיקום על ארבעת הצירים</h3>
          <p>
            לכל ציון מצורפים גם נימוקים קצרים וגם ראיות מהפרוטוקולים, כדי שיהיה ברור למה הדירוג
            ניתן.
          </p>
        </div>
        <div class="analysis-quant-grid">
          ${renderQuantitativeLayer(
            "על סמך הטקסט",
            "הציונים כאן נשענים על מה שנאמר במפורש, בלי הרחבה פרשנית.",
            analysis.quantitativeAnalysis?.textBased,
            "text",
          )}
          ${renderQuantitativeLayer(
            "בין השורות",
            "הציונים כאן מבוססים על מה שמשתמע מן הטון, ההדגשים, בחירות הלשון והפערים.",
            analysis.quantitativeAnalysis?.betweenTheLines,
            "between",
          )}
        </div>
      </article>
    </div>
  `;
}

function renderHighlightedQuoteItems(quotes) {
  if (!Array.isArray(quotes) || !quotes.length) {
    return '<p class="analysis-empty-note">לא נמצאו כרגע ציטוטים מתאימים בקטגוריה הזאת.</p>';
  }

  return `
    <div class="analysis-highlight-list">
      ${quotes
        .map(
          (item) => `
            <article class="analysis-highlight-quote">
              <p class="analysis-highlight-quote__protocol">${escapeHtml(item.protocolHeading || "")}</p>
              <blockquote>${escapeHtml(item.quote || "")}</blockquote>
              <p class="analysis-highlight-quote__explanation">${escapeHtml(item.explanation || "")}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderHighlightedQuoteSection(meta, group) {
  return `
    <article class="analysis-highlight-card analysis-highlight-card--${escapeHtml(meta.theme)}">
      <div class="analysis-highlight-card__header">
        <p class="analysis-highlight-card__eyebrow">Quote Signals</p>
        <h3>${escapeHtml(meta.title)}</h3>
        <p>${escapeHtml(meta.description)}</p>
      </div>
      ${renderHighlightedQuoteItems(group?.quotes)}
    </article>
  `;
}

function renderHighlights(payload) {
  const sourceType = state.activeAnalysisSourceType;
  const sourceMeta = getAnalysisSourceUiMeta(sourceType);
  const analysisRecord = getAnalysisRecord(payload, sourceType);
  const analysisStatus = analysisRecord?.status || null;
  const highlightedQuotes = analysisRecord?.analysis?.highlightedQuotes || null;
  memberHighlightsStatusElement.className = "updates-status is-neutral";
  memberHighlightsContentElement.innerHTML = "";
  renderSourceDisclaimer(memberHighlightsDisclaimerElement, sourceType);
  memberHighlightsSummaryElement.textContent =
    sourceType === "small"
      ? "ציטוטים נבחרים מתוך הניתוח המהיר והעדכני יותר, המבוסס על הקובץ הקטן."
      : "ציטוטים נבחרים מתוך הניתוח הרחב, המבוסס על הקובץ המלא.";
  renderAnalysisAction(analysisStatus);

  if (!analysisStatus || analysisStatus.status === "idle") {
    memberHighlightsStatusElement.innerHTML = analysisStatus?.configured
      ? `
        <p><span class="status-chip">עדיין לא חולצו ציטוטים מתוך ${escapeHtml(sourceMeta.shortLabel)}</span></p>
        <p class="muted">הציטוטים נשלפים כחלק מאותו ניתוח פוליטי. אפשר ליצור מכאן ניתוח עבור ${escapeHtml(sourceMeta.shortLabel)}, ואז הכרטיסים יתמלאו אוטומטית.</p>
      `
      : `
        <p><span class="status-chip">הציטוטים עדיין לא זמינים</span></p>
        <p class="muted">כדי לחלץ ציטוטים נבחרים צריך להגדיר את משתנה הסביבה <code>GEMINI_API_KEY</code>.</p>
      `;
    return;
  }

  if (analysisStatus.status === "running") {
    memberHighlightsStatusElement.className = "updates-status is-running";
    memberHighlightsStatusElement.innerHTML = `
      <p><span class="status-chip">הציטוטים נשלפים כעת מתוך ${escapeHtml(sourceMeta.shortLabel)}</span></p>
      <p class="muted">שלב נוכחי: ${escapeHtml(analysisStatus.currentStage || "מעבד את החומר")}</p>
      <p class="muted">המקטעים שעובדו: ${Number(analysisStatus.processedChunks || 0).toLocaleString("he-IL")} מתוך ${Number(analysisStatus.totalChunks || 0).toLocaleString("he-IL")}</p>
    `;
    return;
  }

  if (analysisStatus.status === "failed") {
    memberHighlightsStatusElement.className = "updates-status is-error";
    memberHighlightsStatusElement.innerHTML = `
      <p><span class="status-chip">חילוץ הציטוטים נכשל</span></p>
      <p class="error-message">${escapeHtml(
        analysisStatus.error || "אירעה שגיאה בזמן חילוץ הציטוטים הנבחרים.",
      )}</p>
    `;
    return;
  }

  memberHighlightsStatusElement.className = `updates-status ${analysisStatus.isStale ? "is-warning" : "is-success"}`;
  memberHighlightsStatusElement.innerHTML = `
    <p><span class="status-chip">הציטוטים הנבחרים מוכנים</span></p>
    <p class="muted">המקור: ${escapeHtml(sourceMeta.analysisLabel)}</p>
    <p class="muted">עודכן לאחרונה: ${escapeHtml(formatIsoDate(analysisStatus.generatedAt))}</p>
    ${
      analysisStatus.isStale
        ? `<p class="error-message">נוספו מאז ציטוטים חדשים ל-${escapeHtml(sourceMeta.shortLabel)}. אפשר לרענן את הניתוח כדי לחלץ שוב את הציטוטים.</p>`
        : ""
    }
  `;

  if (!highlightedQuotes) {
    memberHighlightsContentElement.innerHTML =
      '<p class="analysis-empty-note">הניתוח הושלם, אבל עדיין לא התקבלו ממנו ציטוטים נבחרים להצגה.</p>';
    return;
  }

  memberHighlightsContentElement.innerHTML = `
    <div class="analysis-highlights">
      <section class="analysis-highlights__intro">
        <p class="analysis-pillar__eyebrow">Human Layer</p>
        <h3>שלוש דרכים לראות את האדם שמאחורי הנאום</h3>
        <p>
          הציטוטים כאן נשלפו אוטומטית מתוך ${escapeHtml(sourceMeta.shortLabel)} ומחולקים לשלוש זוויות:
          רגש פנימי, גילוי מפתיע על העולם האישי, ויחס מיטיב לאחרים במשכן.
        </p>
      </section>
      <div class="analysis-highlight-grid">
        ${HIGHLIGHT_SECTION_META.map((meta) => renderHighlightedQuoteSection(meta, highlightedQuotes?.[meta.key])).join("")}
      </div>
    </div>
  `;
}

function updatePolling(payload) {
  const isMemberIndexRunning = payload?.status?.status === "running";
  const isFileBuildRunning = ["waiting_for_index", "running"].includes(
    payload?.utteranceFile?.status || "",
  );
  const isAnalysisRunning = ["running"].includes(payload?.analysis?.status?.status || "");

  if (isMemberIndexRunning || isFileBuildRunning || isAnalysisRunning) {
    if (!state.pollTimer) {
      state.pollTimer = window.setInterval(() => {
        void loadMember({ preserveUiOnError: true });
      }, 5000);
    }

    return;
  }

  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function renderPollingErrorMessage(error) {
  const message = escapeHtml(error?.message || String(error));

  memberStatusElement.className = "updates-status is-warning";
  memberStatusElement.innerHTML = `
    <p><span class="status-chip">העדכון האוטומטי נעצר זמנית</span></p>
    <p class="error-message">${message}</p>
  `;

  memberAnalysisStatusElement.className = "updates-status is-warning";
  memberAnalysisStatusElement.innerHTML = `
    <p><span class="status-chip">לא הצלחנו לרענן את נתוני הניתוח</span></p>
    <p class="error-message">${message}</p>
  `;
  memberHighlightsStatusElement.className = "updates-status is-warning";
  memberHighlightsStatusElement.innerHTML = `
    <p><span class="status-chip">לא הצלחנו לרענן את הציטוטים הנבחרים</span></p>
    <p class="error-message">${message}</p>
  `;
}

function renderSurprisingVotes(payload) {
  const votes = payload?.surprisingVotes || [];
  memberVotesStatusElement.className = "updates-status is-neutral";
  memberVotesStatusElement.hidden = true;
  
  if (votes.length === 0) {
    memberVotesSummaryElement.textContent = "לא נמצאו הצבעות מפתיעות עבור חבר כנסת זה.";
    memberVotesContentElement.innerHTML = "";
    return;
  }

  memberVotesSummaryElement.textContent = `נמצאו ${votes.length} הצבעות מפתיעות`;
  
  let html = `<ul class="protocol-list">`;
  votes.forEach(vote => {
    const dateStr = vote.date ? new Date(vote.date).toLocaleDateString("he-IL") : "";
    html += `
      <li class="protocol-card">
        <div class="protocol-card__main">
          <p class="eyebrow">${escapeHtml(dateStr)}</p>
          <h3 class="protocol-card__title">
            <a href="${escapeHtml(vote.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(vote.title)}</a>
          </h3>
          <p class="protocol-card__description">${escapeHtml(vote.explanation?.bottomLine || "אין פירוט זמין.")}</p>
        </div>
      </li>
    `;
  });
  html += `</ul>`;
  
  memberVotesContentElement.innerHTML = html;
}

async function loadMember(options = {}) {
  const preserveUiOnError = Boolean(options.preserveUiOnError);
  const slug = getMemberSlugFromPath();

  try {
    const payload = await fetchApiJson(`/api/members/${encodeURIComponent(slug)}`);

    renderMemberMeta(payload);
    renderContactSection(payload);
    renderMemberStatus(payload);
    renderProtocols(payload);
    renderUtteranceFileStatuses(payload);
    renderAnalysis(payload);
    renderHighlights(payload);
    renderSurprisingVotes(payload);
    updatePolling(payload);
  } catch (error) {
    if (preserveUiOnError) {
      if (state.pollTimer) {
        window.clearInterval(state.pollTimer);
        state.pollTimer = null;
      }

      renderPollingErrorMessage(error);
      return;
    }
    if (memberNameElement) memberNameElement.textContent = "שגיאה בטעינת חבר הכנסת";
    if (memberPartyElement) memberPartyElement.textContent = "";
    if (memberStatusElement) {
      memberStatusElement.className = "updates-status is-error";
      memberStatusElement.innerHTML = `<p class="error-message">${escapeHtml(
        error.message || String(error),
      )}</p>`;
    }
    if (memberFileFullStatusElement) {
      memberFileFullStatusElement.className = "updates-status is-error";
      memberFileFullStatusElement.innerHTML = `<p class="error-message">${escapeHtml(
        error.message || String(error),
      )}</p>`;
    }
    if (memberFileSmallStatusElement) {
      memberFileSmallStatusElement.className = "updates-status is-error";
      memberFileSmallStatusElement.innerHTML = `<p class="error-message">${escapeHtml(
        error.message || String(error),
      )}</p>`;
    }
    if (memberAnalysisStatusElement) {
      memberAnalysisStatusElement.className = "updates-status is-error";
      memberAnalysisStatusElement.innerHTML = `<p class="error-message">${escapeHtml(
        error.message || String(error),
      )}</p>`;
    }
    if (memberProtocolListElement) {
      memberProtocolListElement.innerHTML = `<p class="error-message">${escapeHtml(
        error.message || String(error),
      )}</p>`;
    }
    if (memberResultsSummaryElement) memberResultsSummaryElement.textContent = "שגיאה";
  }
}

async function startMemberAnalysis() {
  if (state.analysisRequestInFlight) {
    return;
  }

  state.analysisRequestInFlight = true;
  renderAnalysisAction({ status: "running", configured: true });

  try {
    const slug = getMemberSlugFromPath();
    const payload = await fetchApiJson(`/api/members/${encodeURIComponent(slug)}/analysis`, {
      method: "POST",
    });

    renderAnalysis({ analysis: payload });
    state.analysisRequestInFlight = false;
    await loadMember();
  } catch (error) {
    if (memberAnalysisStatusElement) {
      memberAnalysisStatusElement.className = "updates-status is-error";
      memberAnalysisStatusElement.innerHTML = `<p class="error-message">${escapeHtml(
        error.message || String(error),
      )}</p>`;
    }
    state.analysisRequestInFlight = false;
    renderAnalysisAction({ status: "failed", configured: true });
  } finally {
    if (state.analysisRequestInFlight) {
      state.analysisRequestInFlight = false;
    }
  }
}

function getAnalysisSourceUiMeta(sourceType) {
  return sourceType === "small"
    ? {
        key: "small",
        shortLabel: "הקובץ הקטן",
        fileLabel: "קובץ האמירות הקטן",
        analysisLabel: "הניתוח מהקובץ הקטן",
        summary:
          "ניתוח מהיר ועדכני יותר, המבוסס רק על עשרת הפרוטוקולים האחרונים שבהם נשמרו ציטוטים של 50 מילים ומעלה.",
      }
    : {
        key: "full",
        shortLabel: "הקובץ המלא",
        fileLabel: "קובץ האמירות המלא",
        analysisLabel: "הניתוח מהקובץ המלא",
        summary:
          "ניתוח רחב יותר, המבוסס על כלל הציטוטים בני 50 מילים ומעלה מכל הפרוטוקולים הרלוונטיים.",
      };
}

function getSmallSourceDisclaimerText(sourceType) {
  if (sourceType !== "small") {
    return "";
  }

  return "תוצאות אלה מבוססות רק על הקובץ הקטן, שנבנה מעשרת הפרוטוקולים האחרונים שבהם נשמרו לחבר הכנסת ציטוטים בני 50 מילים ומעלה.";
}

function renderSourceDisclaimer(element, sourceType) {
  if (!element) {
    return;
  }

  const disclaimer = getSmallSourceDisclaimerText(sourceType);

  if (!disclaimer) {
    element.hidden = true;
    element.innerHTML = "";
    return;
  }

  element.hidden = false;
  element.innerHTML = `
    <p class="analysis-source-disclaimer__label">שים לב</p>
    <p>${escapeHtml(disclaimer)}</p>
  `;
}

function getUtteranceFileRecord(payload, sourceType) {
  return payload?.utteranceFiles?.[sourceType] || (sourceType === "full" ? payload?.utteranceFile : null) || null;
}

function getAnalysisRecord(payload, sourceType) {
  return payload?.analyses?.[sourceType] || (sourceType === "full" ? payload?.analysis : null) || null;
}

function setActiveAnalysisSourceType(sourceType) {
  state.activeAnalysisSourceType = "full";
  const isFull = state.activeAnalysisSourceType === "full";

  memberAnalysisSourceFullTabButton.classList.toggle("is-active", isFull);
  memberAnalysisSourceFullTabButton.setAttribute("aria-selected", isFull ? "true" : "false");
  memberAnalysisSourceSmallTabButton.classList.toggle("is-active", !isFull);
  memberAnalysisSourceSmallTabButton.setAttribute("aria-selected", isFull ? "false" : "true");
  memberHighlightsSourceFullTabButton.classList.toggle("is-active", isFull);
  memberHighlightsSourceFullTabButton.setAttribute("aria-selected", isFull ? "true" : "false");
  memberHighlightsSourceSmallTabButton.classList.toggle("is-active", !isFull);
  memberHighlightsSourceSmallTabButton.setAttribute("aria-selected", isFull ? "false" : "true");

  if (state.latestPayload) {
    renderAnalysis(state.latestPayload);
    renderHighlights(state.latestPayload);
  }
}

function renderSingleUtteranceFileStatus(statusElement, downloadLink, utteranceFile, sourceType) {
  if (!statusElement) return;
  const sourceMeta = getAnalysisSourceUiMeta(sourceType);
  statusElement.className = "updates-status is-neutral";
  if (downloadLink) {
    downloadLink.hidden = true;
    downloadLink.href = "#";
    downloadLink.removeAttribute("download");
  }

  if (!utteranceFile || utteranceFile.status === "idle") {
    statusElement.innerHTML = `
      <p><span class="status-chip">${escapeHtml(sourceMeta.fileLabel)} עדיין לא נוצר</span></p>
      <p class="muted">אפשר ליצור אותו מעמוד חברי הכנסת בלחיצה אחת לכל החברים, או לתת לניתוח של חבר הכנסת הזה ליצור אותו אוטומטית.</p>
    `;
    return;
  }

  if (utteranceFile.status === "waiting_for_index" || utteranceFile.status === "running") {
    statusElement.className = "updates-status is-running";
    statusElement.innerHTML = `
      <p><span class="status-chip">${escapeHtml(sourceMeta.fileLabel)} נבנה כעת</span></p>
      <p class="muted">הדף יתעדכן אוטומטית ברגע שהקובץ יהיה מוכן.</p>
    `;
    return;
  }

  if (utteranceFile.status === "failed") {
    statusElement.className = "updates-status is-error";
    statusElement.innerHTML = `
      <p><span class="status-chip">יצירת ${escapeHtml(sourceMeta.fileLabel)} נכשלה</span></p>
      <p class="error-message">${escapeHtml(
        utteranceFile.error || "אירעה שגיאה בזמן יצירת קובץ האמירות.",
      )}</p>
    `;
    return;
  }

  statusElement.className = `updates-status ${utteranceFile.isStale ? "is-warning" : "is-success"}`;
  statusElement.innerHTML = `
    <p><span class="status-chip">${escapeHtml(sourceMeta.fileLabel)} מוכן</span></p>
    <p class="muted">פרוטוקולים שנכללו: ${Number(utteranceFile.sectionCount || 0).toLocaleString("he-IL")}</p>
    <p class="muted">קטעי דיבור שנשמרו: ${Number(utteranceFile.utteranceCount || 0).toLocaleString("he-IL")}</p>
    <p class="muted">נוצר בתאריך: ${escapeHtml(formatIsoDate(utteranceFile.generatedAt))}</p>
    ${
      utteranceFile.protocolLimit
        ? `<p class="muted">הקובץ מוגבל ל-${Number(utteranceFile.protocolLimit).toLocaleString("he-IL")} פרוטוקולים אחרונים עם ציטוטים מתאימים.</p>`
        : ""
    }
    ${
      utteranceFile.isStale
        ? '<p class="error-message">נוספו מאז נתונים חדשים. רענון הקבצים נעשה מעמוד חברי הכנסת.</p>'
        : ""
    }
  `;

  if (downloadLink) {
    downloadLink.hidden = false;
    downloadLink.href = utteranceFile.downloadUrl;
    downloadLink.download = utteranceFile.downloadName || "";
  }
}

function renderUtteranceFileStatuses(payload) {
  renderSingleUtteranceFileStatus(
    memberFileFullStatusElement,
    memberFileFullDownloadLink,
    getUtteranceFileRecord(payload, "full"),
    "full",
  );
  renderSingleUtteranceFileStatus(
    memberFileSmallStatusElement,
    memberFileSmallDownloadLink,
    getUtteranceFileRecord(payload, "small"),
    "small",
  );
}

function setBuildButtonState(button, disabled, text) {
  button.disabled = disabled;
  button.textContent = text;
}

memberAnalysisTabButton.addEventListener("click", () => {
  setActiveTab("analysis");
  const url = new URL(window.location.href);
  url.searchParams.set("section", "analysis");
  window.history.replaceState({}, "", url.toString());
});

memberHighlightsTabButton.addEventListener("click", () => {
  setActiveTab("highlights");
  const url = new URL(window.location.href);
  url.searchParams.set("section", "highlights");
  window.history.replaceState({}, "", url.toString());
});

memberProtocolsTabButton.addEventListener("click", () => {
  setActiveTab("protocols");
  const url = new URL(window.location.href);
  url.searchParams.set("section", "protocols");
  window.history.replaceState({}, "", url.toString());
});

memberVotesTabButton.addEventListener("click", () => {
  setActiveTab("votes");
  const url = new URL(window.location.href);
  url.searchParams.set("section", "votes");
  window.history.replaceState({}, "", url.toString());
});

memberAnalysisBuildButton.addEventListener("click", () => {
  void startMemberAnalysis();
});

memberHighlightsBuildButton.addEventListener("click", () => {
  void startMemberAnalysis();
});

setActiveTab(null);
setActiveAnalysisSourceType("full");
if (getRequestedMemberSection()) {
  applyRequestedMemberSection({ scroll: false });
} else {
  setActiveTab("analysis");
}

void loadMember({ preserveUiOnError: true });
