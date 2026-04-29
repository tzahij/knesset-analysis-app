const SOURCE_CONFIG = {
  plenum: {
    key: "plenum",
    label: "ישיבות מליאה",
    searchPlaceholder: "למשל 2026, מרץ, 377",
    listTitle: "בחרו פרוטוקול מליאה לפי תאריך",
    searchLabel: "חיפוש לפי תאריך, שעה או מספר ישיבה",
    sourceNote: "מציג את כל פרוטוקולי ישיבות מליאת הכנסת.",
    refreshButtonLabel: "רענון מטא-דאטה",
    downloadButtonLabel: "הורד את כל פרוטוקולי המליאה",
    downloadCopy:
      "הכפתור מוריד את כל פרוטוקולי המליאה לתיקייה מקומית עם שמות קבצים שמבוססים על התאריך.",
    listEndpoint: "/api/protocols",
    downloadEndpoint: "/api/download-all",
    downloadStatusEndpoint: "/api/download-all/status",
    readerUrl: (documentId) => `/protocol/${encodeURIComponent(documentId)}`,
    resultsLabel: "פרוטוקולים",
    emptyMessage: "לא נמצאו פרוטוקולים שמתאימים למסננים שבחרתם.",
  },
  committee: {
    key: "committee",
    label: "ישיבות ועדות הכנסת",
    searchPlaceholder: "למשל כספים, ועדה ראשית, מרץ 2024",
    listTitle: "בחרו פרוטוקול ועדה לפי סוג ועדה ותאריך",
    searchLabel: "חיפוש לפי תאריך, שם ועדה, סוג ועדה או מספר ישיבה",
    sourceNote: "מציג את פרוטוקולי ועדות הכנסת מחמש השנים האחרונות בלבד.",
    refreshButtonLabel: "רענון מטא-דאטה",
    downloadButtonLabel: "הורד את כל פרוטוקולי הוועדות",
    downloadCopy:
      "הכפתור מוריד את כל פרוטוקולי הוועדות מחמש השנים האחרונות, עם שמות קבצים שמכילים תאריך וסוג ועדה.",
    listEndpoint: "/api/committee-protocols",
    downloadEndpoint: "/api/committee-download-all",
    downloadStatusEndpoint: "/api/committee-download-all/status",
    readerUrl: (documentId) => `/committee-protocol/${encodeURIComponent(documentId)}`,
    resultsLabel: "פרוטוקולים",
    emptyMessage: "לא נמצאו פרוטוקולים שמתאימים למסננים שבחרתם.",
  },
  laws: {
    key: "laws",
    label: "חוקים בקריאה שלישית",
    searchPlaceholder: "למשל תקציב, בריאות, 2196772",
    listTitle: "כל החוקים שהתקבלו בקריאה שלישית",
    searchLabel: "חיפוש לפי שם החוק, תאריך או מספר חוק",
    sourceNote:
      "מציג רק חוקים שהתקבלו בקריאה שלישית, לפי הסטטוס הרשמי של הכנסת, מתוך כל הפריטים שנשמרו במאגר.",
    refreshButtonLabel: "רענון רשימת החוקים",
    listEndpoint: "/api/laws",
    readerUrl: (billId) => `/law/${encodeURIComponent(billId)}`,
    hideUpdates: true,
    hideDownloads: true,
    resultsLabel: "חוקים",
    emptyMessage: "לא נמצאו חוקים שמתאימים למסננים שבחרתם.",
  },
  data: {
    key: "data",
    label: "נתונים והשוואות",
    searchPlaceholder: "",
    listTitle: "השוואות מבוססות נתונים בין חברי הכנסת",
    searchLabel: "",
    sourceNote:
      "המדור משווה בין חברי הכנסת על בסיס ציטוטים מפרוטוקולים מ-2022 ואילך, עם מדדים שמחושבים רק בקוד קשיח וללא שימוש ב-LLM.",
    refreshButtonLabel: "רענן מדדים",
    listEndpoint: "/api/member-comparisons",
    hideFilters: true,
    hideUpdates: true,
    hideDownloads: true,
  },
};

SOURCE_CONFIG.laws.refreshButtonLabel = "רענן חוקים והצבעות";
SOURCE_CONFIG.laws.sourceNote = `${SOURCE_CONFIG.laws.sourceNote} רענון המדור יאסוף גם את נתוני ההצבעות עבור כל חוק.`;

function createSourceState() {
  return {
    items: [],
    filteredItems: [],
    lawListMode: "all",
    surprisingItems: [],
    surprisingSummary: null,
    surprisingMethodology: [],
    surprisingThreshold: null,
    surprisingLoaded: false,
    surprisingLoading: false,
    surprisingPromise: null,
    years: [],
    metadata: null,
    comparisonData: null,
    comparisonStatus: null,
    loaded: false,
    loading: false,
    filters: {
      search: "",
      year: "",
      committeeType: "",
      committeeName: "",
    },
    committeeTypes: [],
    committeeNames: [],
    bulkStatus: null,
    refreshStatus: null,
    analysisStatus: null,
  };
}

const state = {
  activeSource: "plenum",
  visibleCount: 180,
  isCheckingUpdates: false,
  landing: {
    loading: false,
    data: null,
    error: null,
    spotlight: {
      loading: true,
      data: null,
      error: null,
    },
    quoteDeck: [],
    visibleQuotes: [],
    quoteOffset: 0,
    knowYourMk: {
      loading: false,
      data: null,
      error: null,
      activeView: "explicit",
      filters: {
        search: "",
        party: "",
      },
      selectedMemberSlug: "",
      selectedAxisKey: "religiousSecular",
    },
  },
  updateCheck: {
    status: "idle",
    checkedAt: null,
  },
  adminProtocolUpdates: {
    loading: false,
    checking: false,
    applying: false,
    preview: null,
    error: "",
    pollTimer: null,
  },
  adminLawUpdates: {
    loading: false,
    checking: false,
    applying: false,
    preview: null,
    error: "",
    pollTimer: null,
  },
  adminMissingLawAnalysis: {
    loading: false,
    starting: false,
    error: "",
    pollTimer: null,
  },
  adminSurprisingVoteExplanations: {
    loading: false,
    starting: false,
    status: null,
    error: "",
    pollTimer: null,
  },
  adminLawAnalysisRebuild: {
    loading: false,
    starting: false,
    error: "",
    pollTimer: null,
  },
  adminSmallQuotesRebuild: {
    loading: false,
    starting: false,
    status: null,
    error: "",
    pollTimer: null,
  },
  adminMemberProfilesRebuild: {
    loading: false,
    starting: false,
    status: null,
    error: "",
    pollTimer: null,
  },
  sources: {
    plenum: createSourceState(),
    committee: createSourceState(),
    laws: createSourceState(),
    data: createSourceState(),
  },
};

const elements = {
  landingCategories: document.getElementById("landing-categories"),
  landingNewsline: document.getElementById("landing-newsline"),
  landingSpotlight: document.getElementById("landing-spotlight"),
  landingQuotes: document.getElementById("landing-quotes"),
  knowYourMkSummary: document.getElementById("know-your-mk-summary"),
  knowYourMkExtremes: document.getElementById("know-your-mk-extremes"),
  knowYourMkGaps: document.getElementById("know-your-mk-gaps"),
  protocolCount: document.getElementById("protocol-count"),
  countLabel: document.getElementById("count-label"),
  yearRange: document.getElementById("year-range"),
  syncDate: document.getElementById("sync-date"),
  filtersHeading: document.getElementById("filters-heading"),
  searchLabel: document.getElementById("search-label"),
  searchInput: document.getElementById("search-input"),
  yearSelect: document.getElementById("year-select"),
  committeeFilters: document.getElementById("committee-filters"),
  committeeTypeSelect: document.getElementById("committee-type-select"),
  committeeNameSelect: document.getElementById("committee-name-select"),
  refreshButton: document.getElementById("refresh-button"),
  checkUpdatesButton: document.getElementById("check-updates-button"),
  updatesStatus: document.getElementById("updates-status"),
  lawAnalysisTools: document.getElementById("law-analysis-tools"),
  analyzeLawsButton: document.getElementById("analyze-laws-button"),
  lawAnalysisStatus: document.getElementById("law-analysis-status"),
  downloadHeading: document.getElementById("download-heading"),
  downloadCopy: document.getElementById("download-copy"),
  downloadAllButton: document.getElementById("download-all-button"),
  bulkStatus: document.getElementById("bulk-status"),
  listEyebrow: document.getElementById("list-eyebrow"),
  listTitle: document.getElementById("list-title"),
  sourceNote: document.getElementById("source-note"),
  lawsSubtabs: document.getElementById("laws-subtabs"),
  lawsAllTab: document.getElementById("laws-all-tab"),
  lawsSurprisingTab: document.getElementById("laws-surprising-tab"),
  resultsSummary: document.getElementById("results-summary"),
  protocolList: document.getElementById("protocol-list"),
  loadMoreButton: document.getElementById("load-more-button"),
  sourceTabs: Array.from(document.querySelectorAll(".source-tab")),
  adminProtocolCheckButton: document.getElementById("admin-protocol-check-button"),
  adminProtocolApplyButton: document.getElementById("admin-protocol-apply-button"),
  adminProtocolStatus: document.getElementById("admin-protocol-status"),
  adminProtocolResults: document.getElementById("admin-protocol-results"),
  adminLawCheckButton: document.getElementById("admin-law-check-button"),
  adminLawApplyButton: document.getElementById("admin-law-apply-button"),
  adminLawStatus: document.getElementById("admin-law-status"),
  adminLawResults: document.getElementById("admin-law-results"),
  adminLawAnalysisCheckButton: document.getElementById("admin-law-analysis-check-button"),
  adminLawAnalysisStatus: document.getElementById("admin-law-analysis-status"),
  adminSurprisingVoteExplanationButton: document.getElementById(
    "admin-surprising-vote-explanations-button",
  ),
  adminSurprisingVoteExplanationStatus: document.getElementById(
    "admin-surprising-vote-explanations-status",
  ),
  adminLawAnalysisRebuildButton: document.getElementById("admin-law-analysis-rebuild-button"),
  adminLawAnalysisRebuildStatus: document.getElementById("admin-law-analysis-rebuild-status"),
  adminSmallQuotesRebuildButton: document.getElementById("admin-small-quotes-rebuild-button"),
  adminSmallQuotesStatus: document.getElementById("admin-small-quotes-status"),
  adminMemberProfilesRebuildButton: document.getElementById("admin-member-profiles-rebuild-button"),
  adminMemberProfilesRebuildStatus: document.getElementById("admin-member-profiles-rebuild-status"),
};

function removeLandingPageSections() {
  const newslinePanel = elements.landingNewsline?.closest(".landing-panel") || null;
  const signalGrid =
    newslinePanel?.parentElement || elements.landingSpotlight?.closest(".landing-signal-grid") || null;

  newslinePanel?.remove();

  if (signalGrid?.children?.length === 1) {
    signalGrid.classList.add("landing-signal-grid--solo");
  }

  elements.landingNewsline = null;
  document.getElementById("explorer")?.remove();
}

removeLandingPageSections();

let bulkStatusTimer = null;
let dataStatusTimer = null;
let lawRefreshTimer = null;
let lawAnalysisTimer = null;
let landingQuoteTimer = null;
const LANDING_QUOTE_ROTATION_MS = 150000;

function formatInteger(value) {
  return Number(value || 0).toLocaleString("he-IL");
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
  const valueLabel = options.valueLabel || "הציון על הציר";

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

function getSpotlightContactMeta(platform) {
  switch (String(platform || "").trim().toLowerCase()) {
    case "email":
      return {
        title: "אימייל",
        iconMarkup: renderStrokeIcon('<path d="M4 7.5h16v9H4z"></path><path d="m5 8 7 5 7-5"></path>'),
      };
    case "phone":
      return {
        title: "טלפון",
        iconMarkup: renderStrokeIcon(
          '<path d="M8.2 4.7c.5-.6 1.4-.8 2.1-.4l2 1.2c.7.4 1 1.2.7 2l-.7 1.9a1.5 1.5 0 0 0 .3 1.5l.5.5a10.6 10.6 0 0 0 2.7 2.1l.7.3a1.5 1.5 0 0 0 1.4-.1l1.7-.9c.8-.4 1.8-.3 2.4.4l1.5 1.7c.6.7.6 1.8 0 2.5l-.8.9c-.8.9-2 1.3-3.1 1.1-2.3-.5-4.8-1.9-7.5-4.6-2.7-2.7-4.1-5.2-4.6-7.5-.2-1.1.2-2.3 1.1-3.1z"></path>',
        ),
      };
    case "whatsapp":
      return {
        title: "וואטסאפ",
        iconMarkup: renderStrokeIcon(
          '<path d="M12 20a8 8 0 1 0-4-1.1L5 20l1.2-2.8A8 8 0 0 0 12 20z"></path><path d="M10 9.4c.2-.4.6-.4.8-.4h.5c.2 0 .4 0 .5.3l.6 1.4c.1.2.1.5-.1.7l-.4.5c-.1.1-.1.3 0 .4.4.8 1.2 1.6 2 2 .1.1.3.1.4 0l.5-.4c.2-.2.5-.2.7-.1l1.4.6c.3.1.3.3.3.5v.5c0 .2 0 .6-.4.8-.4.2-1.2.2-2.1-.1-1-.4-2.2-1.2-3.3-2.3s-1.9-2.3-2.3-3.3c-.3-.9-.3-1.7-.1-2.1z"></path>',
        ),
      };
    case "facebook":
      return {
        title: "פייסבוק",
        iconMarkup: renderTextIcon("f", 16),
      };
    case "instagram":
      return {
        title: "אינסטגרם",
        iconMarkup: renderStrokeIcon(
          '<rect x="5" y="5" width="14" height="14" rx="4"></rect><circle cx="12" cy="12" r="3.4"></circle><circle cx="16.6" cy="7.6" r="1"></circle>',
        ),
      };
    case "threads":
      return {
        title: "Threads",
        iconMarkup: renderTextIcon("@", 14),
      };
    case "x":
      return {
        title: "X",
        iconMarkup: renderTextIcon("X", 12),
      };
    case "linkedin":
      return {
        title: "לינקדאין",
        iconMarkup: renderTextIcon("in", 10),
      };
    case "tiktok":
      return {
        title: "טיקטוק",
        iconMarkup: renderStrokeIcon(
          '<path d="M14 5v8.3a3.3 3.3 0 1 1-2.1-3.1"></path><path d="M14 5c.7 1.6 1.8 2.7 3.5 3.2"></path>',
        ),
      };
    case "youtube":
      return {
        title: "יוטיוב",
        iconMarkup: renderStrokeIcon(
          '<path d="M20.2 8.1a2.3 2.3 0 0 0-1.6-1.6C17.1 6 12 6 12 6s-5.1 0-6.6.5A2.3 2.3 0 0 0 3.8 8 24.7 24.7 0 0 0 3.5 12c0 1.5.1 2.8.3 3.9a2.3 2.3 0 0 0 1.6 1.6C6.9 18 12 18 12 18s5.1 0 6.6-.5a2.3 2.3 0 0 0 1.6-1.6c.2-1.1.3-2.4.3-3.9s-.1-2.8-.3-3.9z"></path><path d="m10 9.5 4.5 2.5-4.5 2.5z"></path>',
        ),
      };
    default:
      return {
        title: "אתר",
        iconMarkup: renderStrokeIcon(
          '<circle cx="12" cy="12" r="8"></circle><path d="M4 12h16"></path><path d="M12 4a12 12 0 0 1 0 16"></path><path d="M12 4a12 12 0 0 0 0 16"></path>',
        ),
      };
  }
}

function renderLandingSpotlightContacts(contacts) {
  if (!Array.isArray(contacts) || !contacts.length) {
    return "";
  }

  return `
    <div class="landing-spotlight-card__contacts" aria-label="דרכי קשר">
      ${contacts
        .map((contact) => {
          const meta = getSpotlightContactMeta(contact.platform);
          return `
            <a
              class="landing-spotlight-contact-link"
              href="${escapeHtml(contact.href || "#")}"
              target="_blank"
              rel="noreferrer noopener"
              aria-label="${escapeHtml(`יצירת קשר דרך ${meta.title}`)}"
              title="${escapeHtml(meta.title)}"
            >
              ${meta.iconMarkup}
            </a>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSpotlightAxisCompare(axis) {
  const directScore = Number(axis.directScore || 0);
  const voteScore = Number(axis.voteScore || 0);
  const directPosition = `${getAxisMarkerPosition(directScore)}%`;
  const votePosition = `${getAxisMarkerPosition(voteScore)}%`;
  const hasVoteScore = Number.isFinite(voteScore) && voteScore >= 1 && voteScore <= 10;

  return `
    <section class="landing-spotlight-axis-row">
      <div class="landing-spotlight-axis-row__header">
        <h4>${escapeHtml(axis.label)}</h4>
        <div class="landing-spotlight-axis-row__scores">
          <span class="landing-spotlight-axis-row__score landing-spotlight-axis-row__score--direct">
            <span class="landing-spotlight-axis-row__score-dot" aria-hidden="true"></span>
            ציטוטים ישירים: ${escapeHtml(formatAxisScore(directScore))}
          </span>
          <span class="landing-spotlight-axis-row__score landing-spotlight-axis-row__score--votes">
            <span class="landing-spotlight-axis-row__score-dot" aria-hidden="true"></span>
            ${
              hasVoteScore
                ? `הצבעות: ${escapeHtml(formatAxisScore(voteScore))}`
                : "הצבעות: אין נתון"
            }
          </span>
        </div>
      </div>
      <div class="landing-spotlight-axis-row__labels" dir="ltr">
        <span>1 - ${escapeHtml(axis.lowLabel || "")}</span>
        <span>10 - ${escapeHtml(axis.highLabel || "")}</span>
      </div>
      <div class="landing-spotlight-axis-row__track">
        <span
          class="landing-spotlight-axis-row__point landing-spotlight-axis-row__point--direct"
          style="left: ${escapeHtml(directPosition)}"
        >
          <span class="landing-spotlight-axis-row__marker" aria-hidden="true"></span>
        </span>
        ${
          hasVoteScore
            ? `
              <span
                class="landing-spotlight-axis-row__point landing-spotlight-axis-row__point--votes"
                style="left: ${escapeHtml(votePosition)}"
              >
                <span class="landing-spotlight-axis-row__marker" aria-hidden="true"></span>
              </span>
            `
            : `
              <span class="landing-spotlight-axis-row__missing-votes">אין מספיק נתוני הצבעה לציר הזה</span>
            `
        }
      </div>
    </section>
  `;
}

function renderGapAxisDifference(axis, strongestAxisKey) {
  return `
    <article class="know-your-mk-gap-axis-card ${
      axis.key === strongestAxisKey ? "is-strongest" : ""
    }">
      <div class="know-your-mk-gap-axis-card__header">
        <strong>${escapeHtml(axis.label)}</strong>
        <span class="know-your-mk-gap-axis-card__gap">פער ${escapeHtml(formatAxisScore(axis.difference))}</span>
      </div>
      <div class="know-your-mk-gap-axis-card__row">
        <span class="know-your-mk-gap-axis-card__mode">בדיבור המפורש</span>
        ${renderAxisMeter(axis.lowLabel, axis.highLabel, axis.explicitScore, {
          className: "know-your-mk-gap-axis-card__meter",
          valueLabel: "מיקום מפורש",
        })}
      </div>
      <div class="know-your-mk-gap-axis-card__row">
        <span class="know-your-mk-gap-axis-card__mode">מבוסס הצבעות</span>
        ${renderAxisMeter(axis.lowLabel, axis.highLabel, axis.votesScore, {
          className: "know-your-mk-gap-axis-card__meter",
          valueLabel: "מיקום בהצבעות",
        })}
      </div>
    </article>
  `;
}

function getGapLeanLabel(score, lowLabel, highLabel) {
  const numericScore = Number(score || 0);

  if (!Number.isFinite(numericScore)) {
    return "אמצע";
  }

  if (numericScore >= 5.6) {
    return highLabel;
  }

  if (numericScore <= 4.4) {
    return lowLabel;
  }

  return "אמצע";
}

function buildGapContrastText(axis) {
  const explicitLabel = getGapLeanLabel(axis.explicitScore, axis.lowLabel, axis.highLabel);
  const votesLabel = getGapLeanLabel(axis.votesScore, axis.lowLabel, axis.highLabel);

  if (explicitLabel === "אמצע" && votesLabel === "אמצע") {
    return "בדיבור ובהצבעות: קרוב לאמצע";
  }

  if (explicitLabel === "אמצע") {
    return `בדיבור: קרוב לאמצע. בהצבעות: ${votesLabel}`;
  }

  if (votesLabel === "אמצע") {
    return `בדיבור: ${explicitLabel}. בהצבעות: קרוב לאמצע`;
  }

  return `בדיבור: ${explicitLabel}. בהצבעות: ${votesLabel}`;
}

function buildMemberVotesHref(baseHref) {
  const href = String(baseHref || "").trim();

  if (!href) {
    return "#";
  }

  const [pathWithoutHash] = href.split("#");
  const separator = pathWithoutHash.includes("?") ? "&" : "?";
  return `${pathWithoutHash}${separator}section=votes#votes`;
}

function renderGapComparisonMeter(axis) {
  const explicitPosition = `${((Number(axis.explicitScore || 0) - 1) / 9) * 100}%`;
  const votesPosition = `${((Number(axis.votesScore || 0) - 1) / 9) * 100}%`;

  return `
    <div class="know-your-mk-gap-compare" aria-label="${escapeHtml(axis.label)}">
      <div class="know-your-mk-gap-compare__labels" dir="ltr">
        <span>1 - ${escapeHtml(axis.lowLabel)}</span>
        <span>10 - ${escapeHtml(axis.highLabel)}</span>
      </div>
      <div class="know-your-mk-gap-compare__track">
        <span
          class="know-your-mk-gap-compare__point know-your-mk-gap-compare__point--explicit"
          style="left: ${escapeHtml(explicitPosition)}"
        >
          <span class="know-your-mk-gap-compare__value know-your-mk-gap-compare__value--above">
            בדיבור ${escapeHtml(formatAxisScore(axis.explicitScore))}
          </span>
          <span class="know-your-mk-gap-compare__marker" aria-hidden="true"></span>
        </span>
        <span
          class="know-your-mk-gap-compare__point know-your-mk-gap-compare__point--votes"
          style="left: ${escapeHtml(votesPosition)}"
        >
          <span class="know-your-mk-gap-compare__marker" aria-hidden="true"></span>
          <span class="know-your-mk-gap-compare__value know-your-mk-gap-compare__value--below">
            בהצבעות ${escapeHtml(formatAxisScore(axis.votesScore))}
          </span>
        </span>
      </div>
    </div>
  `;
}

function syncAdminProtocolUpdatePolling() {
  const shouldPoll =
    isAdminUser() && state.adminProtocolUpdates.preview?.status === "running";

  if (shouldPoll) {
    if (!state.adminProtocolUpdates.pollTimer) {
      state.adminProtocolUpdates.pollTimer = window.setInterval(() => {
        void loadAdminProtocolUpdatePreview();
      }, 4000);
    }
    return;
  }

  if (state.adminProtocolUpdates.pollTimer) {
    window.clearInterval(state.adminProtocolUpdates.pollTimer);
    state.adminProtocolUpdates.pollTimer = null;
  }
}

function syncAdminLawUpdatePolling() {
  const shouldPoll =
    isAdminUser() && state.adminLawUpdates.preview?.status === "running";

  if (shouldPoll) {
    if (!state.adminLawUpdates.pollTimer) {
      state.adminLawUpdates.pollTimer = window.setInterval(() => {
        void loadAdminLawUpdatePreview();
      }, 4000);
    }
    return;
  }

  if (state.adminLawUpdates.pollTimer) {
    window.clearInterval(state.adminLawUpdates.pollTimer);
    state.adminLawUpdates.pollTimer = null;
  }
}

function syncAdminMissingLawAnalysisPolling() {
  const shouldPoll =
    isAdminUser() && getSourceState("laws").analysisStatus?.status === "running";

  if (shouldPoll) {
    if (!state.adminMissingLawAnalysis.pollTimer) {
      state.adminMissingLawAnalysis.pollTimer = window.setInterval(() => {
        void loadAdminMissingLawAnalysisStatus();
      }, 4000);
    }
    return;
  }

  if (state.adminMissingLawAnalysis.pollTimer) {
    window.clearInterval(state.adminMissingLawAnalysis.pollTimer);
    state.adminMissingLawAnalysis.pollTimer = null;
  }
}

function syncAdminSurprisingVoteExplanationPolling() {
  const shouldPoll =
    isAdminUser() && state.adminSurprisingVoteExplanations.status?.status === "running";

  if (shouldPoll) {
    if (!state.adminSurprisingVoteExplanations.pollTimer) {
      state.adminSurprisingVoteExplanations.pollTimer = window.setInterval(() => {
        void loadAdminSurprisingVoteExplanationStatus();
      }, 4000);
    }
    return;
  }

  if (state.adminSurprisingVoteExplanations.pollTimer) {
    window.clearInterval(state.adminSurprisingVoteExplanations.pollTimer);
    state.adminSurprisingVoteExplanations.pollTimer = null;
  }
}

function syncAdminLawAnalysisRebuildPolling() {
  const status = getSourceState("laws").analysisStatus;
  const shouldPoll =
    isAdminUser() &&
    status?.status === "running" &&
    status?.mode === "rebuild_all";

  if (shouldPoll) {
    if (!state.adminLawAnalysisRebuild.pollTimer) {
      state.adminLawAnalysisRebuild.pollTimer = window.setInterval(() => {
        void loadAdminLawAnalysisRebuildStatus();
      }, 4000);
    }
    return;
  }

  if (state.adminLawAnalysisRebuild.pollTimer) {
    window.clearInterval(state.adminLawAnalysisRebuild.pollTimer);
    state.adminLawAnalysisRebuild.pollTimer = null;
  }
}

function syncAdminSmallQuotesRebuildPolling() {
  const status = state.adminSmallQuotesRebuild.status;
  const shouldPoll =
    isAdminUser() &&
    ["waiting_for_index", "running"].includes(status?.status || "");

  if (shouldPoll) {
    if (!state.adminSmallQuotesRebuild.pollTimer) {
      state.adminSmallQuotesRebuild.pollTimer = window.setInterval(() => {
        void loadAdminSmallQuotesRebuildStatus();
      }, 4000);
    }
    return;
  }

  if (state.adminSmallQuotesRebuild.pollTimer) {
    window.clearInterval(state.adminSmallQuotesRebuild.pollTimer);
    state.adminSmallQuotesRebuild.pollTimer = null;
  }
}

function syncAdminMemberProfilesRebuildPolling() {
  const status = state.adminMemberProfilesRebuild.status;
  const shouldPoll =
    isAdminUser() &&
    ["waiting_for_source_files", "running"].includes(status?.status || "");

  if (shouldPoll) {
    if (!state.adminMemberProfilesRebuild.pollTimer) {
      state.adminMemberProfilesRebuild.pollTimer = window.setInterval(() => {
        void loadAdminMemberProfilesRebuildStatus();
      }, 4000);
    }
    return;
  }

  if (state.adminMemberProfilesRebuild.pollTimer) {
    window.clearInterval(state.adminMemberProfilesRebuild.pollTimer);
    state.adminMemberProfilesRebuild.pollTimer = null;
  }
}

function isAdminUser() {
  return Boolean(window.KnessetAuth?.canAccess("admin"));
}

function formatAdminProtocolItems(items) {
  if (!Array.isArray(items) || !items.length) {
    return '<p class="muted">No new protocols were found in this source.</p>';
  }

  return `
    <ul>
      ${items
        .map(
          (item) => `
            <li>${escapeHtml(item.label || item.shortDateLabel || item.documentId || "")}</li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function formatAdminLawItems(items) {
  if (!Array.isArray(items) || !items.length) {
    return '<p class="muted">No new third-reading laws were found.</p>';
  }

  return `
    <ul>
      ${items
        .map((item) => {
          const documents = Array.isArray(item.availableDocuments) && item.availableDocuments.length
            ? ` � ${escapeHtml(item.availableDocuments.join(" + "))}`
            : "";

          return `<li>${escapeHtml(item.label || item.title || item.billId || "")}${documents}</li>`;
        })
        .join("")}
    </ul>
  `;
}

function renderAdminProtocolUpdatePanel() {
  if (!elements.adminProtocolStatus || !elements.adminProtocolResults) {
    return;
  }

  const panelState = state.adminProtocolUpdates;
  const preview = panelState.preview;
  const isBusy =
    panelState.loading ||
    panelState.checking ||
    panelState.applying ||
    preview?.status === "running";

  elements.adminProtocolCheckButton.disabled = !isAdminUser() || isBusy;
  elements.adminProtocolCheckButton.textContent = panelState.checking
    ? "Checking all protocol feeds..."
    : "Mass-check all protocols";

  const shouldShowApplyButton = Boolean(preview?.hasPendingApproval) && isAdminUser();
  elements.adminProtocolApplyButton.hidden = !shouldShowApplyButton;
  elements.adminProtocolApplyButton.disabled = !shouldShowApplyButton || isBusy;
  elements.adminProtocolApplyButton.textContent = panelState.applying
    ? "Adding approved protocols..."
    : "Add approved protocols to the website";

  elements.adminProtocolStatus.className = "updates-status is-neutral";

  if (!isAdminUser()) {
    elements.adminProtocolStatus.innerHTML =
      '<p class="muted">Admin access is required to use this console.</p>';
    elements.adminProtocolResults.innerHTML =
      '<p class="muted">Protocol review results will appear here for admins.</p>';
    return;
  }

  if (panelState.error) {
    elements.adminProtocolStatus.className = "updates-status is-error";
    elements.adminProtocolStatus.innerHTML = `<p class="error-message">${escapeHtml(panelState.error)}</p>`;
  } else if (panelState.checking) {
    elements.adminProtocolStatus.className = "updates-status is-running";
    elements.adminProtocolStatus.innerHTML =
      "<p>Checking all Knesset protocol feeds without importing them yet.</p>";
  } else if (preview?.status === "running") {
    elements.adminProtocolStatus.className = "updates-status is-running";
    elements.adminProtocolStatus.innerHTML = `
      <p><span class="status-chip">Mass-check in progress</span></p>
      <p class="muted">The protocol feeds are being checked in the background. This panel will update automatically when the review is ready.</p>
    `;
  } else if (panelState.applying) {
    elements.adminProtocolStatus.className = "updates-status is-running";
    elements.adminProtocolStatus.innerHTML =
      "<p>Applying the approved protocol snapshot to the website now.</p>";
  } else if (preview?.status === "failed") {
    elements.adminProtocolStatus.className = "updates-status is-error";
    elements.adminProtocolStatus.innerHTML = `<p class="error-message">${escapeHtml(
      preview.error || "The protocol intake check failed.",
    )}</p>`;
  } else if (!preview || preview.status === "idle") {
    elements.adminProtocolStatus.innerHTML =
      "<p class=\"muted\">No admin protocol review has been started yet.</p>";
  } else if (preview.status === "applied") {
    elements.adminProtocolStatus.className = "updates-status is-success";
    elements.adminProtocolStatus.innerHTML = `
      <p><span class="status-chip">Protocol import approved and applied</span></p>
      <p class="muted">Applied at ${escapeHtml(formatIsoDate(preview.approvedAt))}.</p>
    `;
  } else if (preview.hasPendingApproval) {
    elements.adminProtocolStatus.className = "updates-status is-warning";
    elements.adminProtocolStatus.innerHTML = `
      <p><span class="status-chip">Approval required</span></p>
      <p class="muted">
        ${formatInteger(preview.totalAdded)} new protocols were found on
        ${escapeHtml(formatIsoDate(preview.checkedAt))}. Review them below and approve the import if you want to add them.
      </p>
    `;
  } else {
    elements.adminProtocolStatus.className = "updates-status is-success";
    elements.adminProtocolStatus.innerHTML = `
      <p><span class="status-chip">No new protocols found</span></p>
      <p class="muted">Last checked at ${escapeHtml(formatIsoDate(preview.checkedAt))}.</p>
    `;
  }

  if (!preview) {
    elements.adminProtocolResults.innerHTML =
      '<p class="muted">New protocol candidates will appear here after a check.</p>';
    syncAdminProtocolUpdatePolling();
    return;
  }

  const plenum = preview.sources?.plenum || { addedCount: 0, total: 0, addedItems: [] };
  const committee = preview.sources?.committee || { addedCount: 0, total: 0, addedItems: [] };

  elements.adminProtocolResults.innerHTML = `
    <article class="admin-update-source-card">
      <h3>Plenum protocols</h3>
      <p class="admin-update-source-card__meta">
        ${formatInteger(plenum.addedCount)} new out of ${formatInteger(plenum.total)} tracked plenum protocols.
      </p>
      ${formatAdminProtocolItems(plenum.addedItems)}
    </article>
    <article class="admin-update-source-card">
      <h3>Committee protocols</h3>
      <p class="admin-update-source-card__meta">
        ${formatInteger(committee.addedCount)} new out of ${formatInteger(committee.total)} tracked committee protocols.
      </p>
      ${formatAdminProtocolItems(committee.addedItems)}
    </article>
  `;
  syncAdminProtocolUpdatePolling();
}

function renderAdminLawUpdatePanel() {
  if (!elements.adminLawStatus || !elements.adminLawResults) {
    return;
  }

  const panelState = state.adminLawUpdates;
  const preview = panelState.preview;
  const isBusy =
    panelState.loading ||
    panelState.checking ||
    panelState.applying ||
    preview?.status === "running";

  elements.adminLawCheckButton.disabled = !isAdminUser() || isBusy;
  elements.adminLawCheckButton.textContent = panelState.checking
    ? "Checking third-reading laws..."
    : "Mass-check all laws";

  const shouldShowApplyButton = Boolean(preview?.hasPendingApproval) && isAdminUser();
  elements.adminLawApplyButton.hidden = !shouldShowApplyButton;
  elements.adminLawApplyButton.disabled = !shouldShowApplyButton || isBusy;
  elements.adminLawApplyButton.textContent = panelState.applying
    ? "Downloading approved laws..."
    : "Download and add approved laws";

  elements.adminLawStatus.className = "updates-status is-neutral";

  if (!isAdminUser()) {
    elements.adminLawStatus.innerHTML =
      '<p class="muted">Admin access is required to use this console.</p>';
    elements.adminLawResults.innerHTML =
      '<p class="muted">Third-reading law review results will appear here for admins.</p>';
    return;
  }

  if (panelState.error) {
    elements.adminLawStatus.className = "updates-status is-error";
    elements.adminLawStatus.innerHTML = `<p class="error-message">${escapeHtml(panelState.error)}</p>`;
  } else if (panelState.checking) {
    elements.adminLawStatus.className = "updates-status is-running";
    elements.adminLawStatus.innerHTML =
      "<p>Checking the official third-reading laws feed without importing anything yet.</p>";
  } else if (preview?.status === "running") {
    elements.adminLawStatus.className = "updates-status is-running";
    elements.adminLawStatus.innerHTML = `
      <p><span class="status-chip">Mass-check in progress</span></p>
      <p class="muted">The laws feed is being checked in the background. This panel will update automatically when the review is ready.</p>
    `;
  } else if (panelState.applying) {
    elements.adminLawStatus.className = "updates-status is-running";
    elements.adminLawStatus.innerHTML =
      "<p>Downloading and applying the approved third-reading laws now.</p>";
  } else if (preview?.status === "failed") {
    elements.adminLawStatus.className = "updates-status is-error";
    elements.adminLawStatus.innerHTML = `<p class="error-message">${escapeHtml(
      preview.error || "The law intake check failed.",
    )}</p>`;
  } else if (!preview || preview.status === "idle") {
    elements.adminLawStatus.innerHTML =
      "<p class=\"muted\">No admin law review has been started yet.</p>";
  } else if (preview.status === "applied" || preview.status === "applied_with_warnings") {
    const downloadSummary = preview.downloadSummary || {
      addedLawCount: 0,
      downloadedFiles: 0,
      failedDownloads: 0,
    };
    elements.adminLawStatus.className =
      preview.status === "applied_with_warnings" ? "updates-status is-warning" : "updates-status is-success";
    elements.adminLawStatus.innerHTML = `
      <p><span class="status-chip">${
        preview.status === "applied_with_warnings"
          ? "Law import applied with download warnings"
          : "Law import approved and applied"
      }</span></p>
      <p class="muted">
        Applied at ${escapeHtml(formatIsoDate(preview.approvedAt))}.
        Added ${formatInteger(downloadSummary.addedLawCount)} new laws and prepared ${formatInteger(
          downloadSummary.downloadedFiles,
        )} downloadable files.
      </p>
      ${
        downloadSummary.failedDownloads
          ? `<p class="muted">${formatInteger(downloadSummary.failedDownloads)} document downloads still need attention.</p>`
          : ""
      }
    `;
  } else if (preview.hasPendingApproval) {
    elements.adminLawStatus.className = "updates-status is-warning";
    elements.adminLawStatus.innerHTML = `
      <p><span class="status-chip">Approval required</span></p>
      <p class="muted">
        ${formatInteger(preview.totalAdded)} new third-reading laws were found on
        ${escapeHtml(formatIsoDate(preview.checkedAt))}. Review them below and approve the import if you want to download and add them.
      </p>
    `;
  } else {
    elements.adminLawStatus.className = "updates-status is-success";
    elements.adminLawStatus.innerHTML = `
      <p><span class="status-chip">No new laws found</span></p>
      <p class="muted">Last checked at ${escapeHtml(formatIsoDate(preview.checkedAt))}.</p>
    `;
  }

  if (!preview) {
    elements.adminLawResults.innerHTML =
      '<p class="muted">New third-reading laws will appear here after a check.</p>';
    syncAdminLawUpdatePolling();
    return;
  }

  const laws = preview.laws || { addedCount: 0, total: 0, addedItems: [] };
  const failureMessages = preview.downloadSummary?.failureMessages || [];

  elements.adminLawResults.innerHTML = `
    <article class="admin-update-source-card">
      <h3>Third-reading laws</h3>
      <p class="admin-update-source-card__meta">
        ${formatInteger(laws.addedCount)} new out of ${formatInteger(laws.total)} tracked laws.
      </p>
      ${formatAdminLawItems(laws.addedItems)}
    </article>
    ${
      failureMessages.length
        ? `
          <article class="admin-update-source-card">
            <h3>Download warnings</h3>
            <ul>
              ${failureMessages.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}
            </ul>
          </article>
        `
        : ""
    }
  `;
  syncAdminLawUpdatePolling();
}

function renderAdminMissingLawAnalysisPanel() {
  if (!elements.adminLawAnalysisStatus || !elements.adminLawAnalysisCheckButton) {
    return;
  }

  const panelState = state.adminMissingLawAnalysis;
  const analysisStatus = getSourceState("laws").analysisStatus;
  const isBusy =
    panelState.loading ||
    panelState.starting ||
    analysisStatus?.status === "running";

  elements.adminLawAnalysisCheckButton.disabled = !isAdminUser() || isBusy;
  elements.adminLawAnalysisCheckButton.textContent = panelState.starting
    ? "Checking for missing axes profiles..."
    : analysisStatus?.status === "running"
      ? "Analyzing new laws..."
      : "Analyze new laws without axes profiles";

  elements.adminLawAnalysisStatus.className = "updates-status is-neutral";

  if (!isAdminUser()) {
    elements.adminLawAnalysisStatus.innerHTML =
      '<p class="muted">Admin access is required to use this console.</p>';
    syncAdminMissingLawAnalysisPolling();
    return;
  }

  if (panelState.error) {
    elements.adminLawAnalysisStatus.className = "updates-status is-error";
    elements.adminLawAnalysisStatus.innerHTML = `<p class="error-message">${escapeHtml(panelState.error)}</p>`;
    syncAdminMissingLawAnalysisPolling();
    return;
  }

  if (!analysisStatus || analysisStatus.status === "idle") {
    elements.adminLawAnalysisStatus.innerHTML =
      '<p class="muted">No admin-only missing-law analysis run has been started yet.</p>';
    syncAdminMissingLawAnalysisPolling();
    return;
  }

  if (analysisStatus.status === "nothing_to_do") {
    elements.adminLawAnalysisStatus.className = "updates-status is-success";
    elements.adminLawAnalysisStatus.innerHTML = `
      <p><span class="status-chip">Nothing to do</span></p>
      <p class="muted">${escapeHtml(
        analysisStatus.message || "No new third-reading laws without axes profiles were found.",
      )}</p>
    `;
    syncAdminMissingLawAnalysisPolling();
    return;
  }

  if (analysisStatus.status === "running") {
    elements.adminLawAnalysisStatus.className = "updates-status is-running";
    elements.adminLawAnalysisStatus.innerHTML = `
      <p><span class="status-chip">Law analysis in progress</span></p>
      <p>${Number(analysisStatus.processedLaws || 0).toLocaleString("he-IL")} out of ${Number(
        analysisStatus.totalLaws || 0,
      ).toLocaleString("he-IL")} laws processed</p>
      <p class="muted">Generated: ${Number(analysisStatus.generatedLaws || 0).toLocaleString(
        "he-IL",
      )} � Skipped: ${Number(analysisStatus.skippedLaws || 0).toLocaleString(
        "he-IL",
      )} � Failed: ${Number(analysisStatus.failedLaws || 0).toLocaleString("he-IL")}</p>
      ${
        analysisStatus.current
          ? `<p class="muted">Working now on: ${escapeHtml(analysisStatus.current.title || "")}</p>`
          : ""
      }
    `;
    syncAdminMissingLawAnalysisPolling();
    return;
  }

  if (analysisStatus.status === "failed") {
    elements.adminLawAnalysisStatus.className = "updates-status is-error";
    elements.adminLawAnalysisStatus.innerHTML = `
      <p><span class="status-chip">Analysis failed</span></p>
      <p class="error-message">${escapeHtml(
        analysisStatus.recentErrors?.[0] || "An unexpected law analysis error occurred.",
      )}</p>
    `;
    syncAdminMissingLawAnalysisPolling();
    return;
  }

  elements.adminLawAnalysisStatus.className = `updates-status ${
    Number(analysisStatus.failedLaws || 0) > 0 ? "is-warning" : "is-success"
  }`;
  elements.adminLawAnalysisStatus.innerHTML = `
    <p><span class="status-chip">Missing law profiles analyzed</span></p>
    <p class="muted">Completed at ${escapeHtml(
      formatIsoDate(analysisStatus.lastCompletedAt || analysisStatus.finishedAt),
    )}.</p>
    <p>${Number(analysisStatus.generatedLaws || 0).toLocaleString(
      "he-IL",
    )} new law profiles were created.</p>
    <p class="muted">Skipped: ${Number(analysisStatus.skippedLaws || 0).toLocaleString("he-IL")}</p>
    ${
      Number(analysisStatus.failedLaws || 0) > 0
        ? `<p class="muted">Failures: ${Number(analysisStatus.failedLaws || 0).toLocaleString(
            "he-IL",
          )}</p>`
        : ""
    }
  `;
  syncAdminMissingLawAnalysisPolling();
}

function renderAdminSurprisingVoteExplanationPanel() {
  if (!elements.adminSurprisingVoteExplanationStatus || !elements.adminSurprisingVoteExplanationButton) {
    return;
  }

  const panelState = state.adminSurprisingVoteExplanations;
  const status = panelState.status;
  const isBusy = panelState.loading || panelState.starting || status?.status === "running";

  elements.adminSurprisingVoteExplanationButton.disabled = !isAdminUser() || isBusy;
  elements.adminSurprisingVoteExplanationButton.textContent = panelState.starting
    ? "Starting bulk surprising-vote explanations..."
    : status?.status === "running"
      ? "Explaining surprising votes..."
      : "Explain all unexplained surprising votes";

  elements.adminSurprisingVoteExplanationStatus.className = "updates-status is-neutral";

  if (!isAdminUser()) {
    elements.adminSurprisingVoteExplanationStatus.innerHTML =
      '<p class="muted">Admin access is required to use this console.</p>';
    syncAdminSurprisingVoteExplanationPolling();
    return;
  }

  if (panelState.error) {
    elements.adminSurprisingVoteExplanationStatus.className = "updates-status is-error";
    elements.adminSurprisingVoteExplanationStatus.innerHTML = `<p class="error-message">${escapeHtml(panelState.error)}</p>`;
    syncAdminSurprisingVoteExplanationPolling();
    return;
  }

  if (!status || status.status === "idle") {
    elements.adminSurprisingVoteExplanationStatus.innerHTML =
      '<p class="muted">No bulk surprising-vote explanation run has been started yet.</p>';
    syncAdminSurprisingVoteExplanationPolling();
    return;
  }

  if (status.status === "nothing_to_do") {
    elements.adminSurprisingVoteExplanationStatus.className = "updates-status is-success";
    elements.adminSurprisingVoteExplanationStatus.innerHTML = `
      <p><span class="status-chip">Nothing to do</span></p>
      <p class="muted">${escapeHtml(
        status.message || "Every currently surprising vote already has an explanation.",
      )}</p>
      <p class="muted">Current surprising votes: ${Number(status.totalSurprisingVotes || 0).toLocaleString(
        "he-IL",
      )} / Already explained: ${Number(status.alreadyExplainedVotes || 0).toLocaleString(
        "he-IL",
      )} / Already running: ${Number(status.alreadyRunningVotes || 0).toLocaleString("he-IL")}</p>
    `;
    syncAdminSurprisingVoteExplanationPolling();
    return;
  }

  if (status.status === "running") {
    elements.adminSurprisingVoteExplanationStatus.className = "updates-status is-running";
    elements.adminSurprisingVoteExplanationStatus.innerHTML = `
      <p><span class="status-chip">Bulk surprising-vote explanations in progress</span></p>
      <p>${Number(status.processedVotes || 0).toLocaleString("he-IL")} out of ${Number(
        status.totalPendingVotes || 0,
      ).toLocaleString("he-IL")} unexplained surprising votes processed</p>
      <p class="muted">Created: ${Number(status.generatedExplanations || 0).toLocaleString(
        "he-IL",
      )} / Failures: ${Number(status.failedVotes || 0).toLocaleString(
        "he-IL",
      )} / Skipped: ${Number(status.skippedVotes || 0).toLocaleString("he-IL")}</p>
      <p class="muted">Already explained before this run: ${Number(
        status.alreadyExplainedVotes || 0,
      ).toLocaleString("he-IL")} / Already running elsewhere: ${Number(
        status.alreadyRunningVotes || 0,
      ).toLocaleString("he-IL")}</p>
      ${
        status.current
          ? `<p class="muted">Working now on: ${escapeHtml(status.current.memberName || "")} / ${escapeHtml(
              status.current.lawTitle || "",
            )}</p>`
          : ""
      }
    `;
    syncAdminSurprisingVoteExplanationPolling();
    return;
  }

  if (status.status === "failed") {
    elements.adminSurprisingVoteExplanationStatus.className = "updates-status is-error";
    elements.adminSurprisingVoteExplanationStatus.innerHTML = `
      <p><span class="status-chip">Bulk explanation run failed</span></p>
      <p class="error-message">${escapeHtml(
        (status.recentErrors || [])[0] || "An unexpected error occurred during the bulk run.",
      )}</p>
    `;
    syncAdminSurprisingVoteExplanationPolling();
    return;
  }

  elements.adminSurprisingVoteExplanationStatus.className = `updates-status ${
    status.status === "completed_with_errors" ? "is-warning" : "is-success"
  }`;
  elements.adminSurprisingVoteExplanationStatus.innerHTML = `
    <p><span class="status-chip">Bulk surprising-vote explanations finished</span></p>
    <p>${Number(status.generatedExplanations || 0).toLocaleString(
      "he-IL",
    )} new explanations were created.</p>
    <p class="muted">Finished at ${escapeHtml(formatIsoDate(status.lastCompletedAt || status.finishedAt))}.</p>
    <p class="muted">Already explained before this run: ${Number(
      status.alreadyExplainedVotes || 0,
    ).toLocaleString("he-IL")} / Already running elsewhere: ${Number(
      status.alreadyRunningVotes || 0,
    ).toLocaleString("he-IL")} / Skipped during run: ${Number(status.skippedVotes || 0).toLocaleString(
      "he-IL",
    )}</p>
    ${
      status.status === "completed_with_errors"
        ? `<p class="error-message">${Number(status.failedVotes || 0).toLocaleString(
            "he-IL",
          )} surprising votes still failed and may need another pass.</p>`
        : ""
    }
  `;
  syncAdminSurprisingVoteExplanationPolling();
}

function renderAdminLawAnalysisRebuildPanel() {
  if (!elements.adminLawAnalysisRebuildStatus || !elements.adminLawAnalysisRebuildButton) {
    return;
  }

  const panelState = state.adminLawAnalysisRebuild;
  const analysisStatus = getSourceState("laws").analysisStatus;
  const isRunningRebuild =
    analysisStatus?.status === "running" && analysisStatus?.mode === "rebuild_all";
  const isBusy = panelState.loading || panelState.starting || isRunningRebuild;

  elements.adminLawAnalysisRebuildButton.disabled = !isAdminUser() || isBusy;
  elements.adminLawAnalysisRebuildButton.textContent = panelState.starting
    ? "Starting destructive law rebuild..."
    : isRunningRebuild
      ? "Recreating all law axes profiles..."
      : "Recreate all law axes profiles";

  elements.adminLawAnalysisRebuildStatus.className = "updates-status is-neutral";

  if (!isAdminUser()) {
    elements.adminLawAnalysisRebuildStatus.innerHTML =
      '<p class="muted">Admin access is required to use this console.</p>';
    syncAdminLawAnalysisRebuildPolling();
    return;
  }

  if (panelState.error) {
    elements.adminLawAnalysisRebuildStatus.className = "updates-status is-error";
    elements.adminLawAnalysisRebuildStatus.innerHTML = `<p class="error-message">${escapeHtml(panelState.error)}</p>`;
    syncAdminLawAnalysisRebuildPolling();
    return;
  }

  if (!analysisStatus || analysisStatus.status === "idle" || analysisStatus.mode !== "rebuild_all") {
    elements.adminLawAnalysisRebuildStatus.innerHTML =
      '<p class="muted">No destructive full law-analysis rebuild has been started yet.</p>';
    syncAdminLawAnalysisRebuildPolling();
    return;
  }

  if (analysisStatus.status === "running") {
    elements.adminLawAnalysisRebuildStatus.className = "updates-status is-running";
    elements.adminLawAnalysisRebuildStatus.innerHTML = `
      <p><span class="status-chip">Destructive law rebuild in progress</span></p>
      <p>${Number(analysisStatus.processedLaws || 0).toLocaleString("he-IL")} out of ${Number(
        analysisStatus.totalLaws || 0,
      ).toLocaleString("he-IL")} laws processed</p>
      <p class="muted">Recreated: ${Number(analysisStatus.generatedLaws || 0).toLocaleString(
        "he-IL",
      )} � Failures: ${Number(analysisStatus.failedLaws || 0).toLocaleString("he-IL")}</p>
      ${
        analysisStatus.current
          ? `<p class="muted">Working now on: ${escapeHtml(analysisStatus.current.title || "")}</p>`
          : ""
      }
    `;
    syncAdminLawAnalysisRebuildPolling();
    return;
  }

  if (analysisStatus.status === "failed") {
    elements.adminLawAnalysisRebuildStatus.className = "updates-status is-error";
    elements.adminLawAnalysisRebuildStatus.innerHTML = `
      <p><span class="status-chip">Full rebuild failed</span></p>
      <p class="error-message">${escapeHtml(
        analysisStatus.recentErrors?.[0] || "An unexpected full law-analysis rebuild error occurred.",
      )}</p>
    `;
    syncAdminLawAnalysisRebuildPolling();
    return;
  }

  elements.adminLawAnalysisRebuildStatus.className = `updates-status ${
    Number(analysisStatus.failedLaws || 0) > 0 ? "is-warning" : "is-success"
  }`;
  elements.adminLawAnalysisRebuildStatus.innerHTML = `
    <p><span class="status-chip">All law axes profiles rebuilt</span></p>
    <p class="muted">Completed at ${escapeHtml(
      formatIsoDate(analysisStatus.lastCompletedAt || analysisStatus.finishedAt),
    )}.</p>
    <p>${Number(analysisStatus.generatedLaws || 0).toLocaleString(
      "he-IL",
    )} law axes profiles were recreated.</p>
    ${
      Number(analysisStatus.failedLaws || 0) > 0
        ? `<p class="muted">Failures: ${Number(analysisStatus.failedLaws || 0).toLocaleString(
            "he-IL",
          )}</p>`
        : ""
    }
  `;
  syncAdminLawAnalysisRebuildPolling();
}

function renderAdminSmallQuotesRebuildPanel() {
  if (!elements.adminSmallQuotesStatus || !elements.adminSmallQuotesRebuildButton) {
    return;
  }

  const panelState = state.adminSmallQuotesRebuild;
  const status = panelState.status;
  const isBusy =
    panelState.loading ||
    panelState.starting ||
    ["waiting_for_index", "running"].includes(status?.status || "");

  elements.adminSmallQuotesRebuildButton.disabled = !isAdminUser() || isBusy;
  elements.adminSmallQuotesRebuildButton.textContent = panelState.starting
    ? "Starting destructive rebuild..."
    : ["waiting_for_index", "running"].includes(status?.status || "")
      ? "Recreating all small quotes files..."
      : "Recreate all small quotes files";

  elements.adminSmallQuotesStatus.className = "updates-status is-neutral";

  if (!isAdminUser()) {
    elements.adminSmallQuotesStatus.innerHTML =
      '<p class="muted">Admin access is required to use this console.</p>';
    syncAdminSmallQuotesRebuildPolling();
    return;
  }

  if (panelState.error) {
    elements.adminSmallQuotesStatus.className = "updates-status is-error";
    elements.adminSmallQuotesStatus.innerHTML = `<p class="error-message">${escapeHtml(panelState.error)}</p>`;
    syncAdminSmallQuotesRebuildPolling();
    return;
  }

  if (!status || status.status === "idle") {
    elements.adminSmallQuotesStatus.innerHTML =
      '<p class="muted">No destructive small-quotes rebuild has been started yet.</p>';
    syncAdminSmallQuotesRebuildPolling();
    return;
  }

  if (status.status === "waiting_for_index") {
    elements.adminSmallQuotesStatus.className = "updates-status is-running";
    elements.adminSmallQuotesStatus.innerHTML = `
      <p><span class="status-chip">Waiting for the member index</span></p>
      <p class="muted">The site is preparing the member protocol index before deleting and rebuilding every small quotes file.</p>
    `;
    syncAdminSmallQuotesRebuildPolling();
    return;
  }

  if (status.status === "running") {
    elements.adminSmallQuotesStatus.className = "updates-status is-running";
    elements.adminSmallQuotesStatus.innerHTML = `
      <p><span class="status-chip">Destructive rebuild in progress</span></p>
      <p>${Number(status.processedMembers || 0).toLocaleString("he-IL")} out of ${Number(
        status.totalMembers || 0,
      ).toLocaleString("he-IL")} MKs processed</p>
      <p class="muted">Rebuilt files: ${Number(status.generatedMembers || 0).toLocaleString(
        "he-IL",
      )} � Failures: ${Number(status.failedMembers || 0).toLocaleString("he-IL")}</p>
      ${
        status.current
          ? `<p class="muted">Working now on: ${escapeHtml(status.current.name)} (${escapeHtml(
              status.current.partyName,
            )})</p>`
          : ""
      }
    `;
    syncAdminSmallQuotesRebuildPolling();
    return;
  }

  if (status.status === "failed") {
    elements.adminSmallQuotesStatus.className = "updates-status is-error";
    elements.adminSmallQuotesStatus.innerHTML = `
      <p><span class="status-chip">Rebuild failed</span></p>
      <p class="error-message">${escapeHtml(
        (status.recentErrors || [])[0] || "An unexpected error occurred during the destructive rebuild.",
      )}</p>
    `;
    syncAdminSmallQuotesRebuildPolling();
    return;
  }

  elements.adminSmallQuotesStatus.className = `updates-status ${
    status.status === "completed_with_errors" ? "is-warning" : "is-success"
  }`;
  elements.adminSmallQuotesStatus.innerHTML = `
    <p><span class="status-chip">Small quotes rebuild finished</span></p>
    <p>${Number(status.generatedMembers || 0).toLocaleString("he-IL")} MK files were recreated.</p>
    <p class="muted">Finished at ${escapeHtml(formatIsoDate(status.lastCompletedAt || status.finishedAt))}.</p>
    ${
      status.status === "completed_with_errors"
        ? `<p class="error-message">${Number(status.failedMembers || 0).toLocaleString(
            "he-IL",
          )} MKs still failed and may need another pass.</p>`
        : ""
    }
  `;
  syncAdminSmallQuotesRebuildPolling();
}

function renderAdminMemberProfilesRebuildPanel() {
  if (!elements.adminMemberProfilesRebuildStatus || !elements.adminMemberProfilesRebuildButton) {
    return;
  }

  const panelState = state.adminMemberProfilesRebuild;
  const status = panelState.status;
  const isBusy =
    panelState.loading ||
    panelState.starting ||
    ["waiting_for_source_files", "running"].includes(status?.status || "");

  elements.adminMemberProfilesRebuildButton.disabled = !isAdminUser() || isBusy;
  elements.adminMemberProfilesRebuildButton.textContent = panelState.starting
    ? "Starting destructive MK-profile rebuild..."
    : ["waiting_for_source_files", "running"].includes(status?.status || "")
      ? "Recreating all MK profiles..."
      : "Recreate all MK profiles";

  elements.adminMemberProfilesRebuildStatus.className = "updates-status is-neutral";

  if (!isAdminUser()) {
    elements.adminMemberProfilesRebuildStatus.innerHTML =
      '<p class="muted">Admin access is required to use this console.</p>';
    syncAdminMemberProfilesRebuildPolling();
    return;
  }

  if (panelState.error) {
    elements.adminMemberProfilesRebuildStatus.className = "updates-status is-error";
    elements.adminMemberProfilesRebuildStatus.innerHTML =
      `<p class="error-message">${escapeHtml(panelState.error)}</p>`;
    syncAdminMemberProfilesRebuildPolling();
    return;
  }

  if (!status || status.status === "idle") {
    elements.adminMemberProfilesRebuildStatus.innerHTML =
      '<p class="muted">No destructive MK-profile rebuild has been started yet.</p>';
    syncAdminMemberProfilesRebuildPolling();
    return;
  }

  if (status.status === "waiting_for_source_files") {
    elements.adminMemberProfilesRebuildStatus.className = "updates-status is-running";
    elements.adminMemberProfilesRebuildStatus.innerHTML = `
      <p><span class="status-chip">Preparing quote files</span></p>
      <p class="muted">The site is making sure the small MK quote files are ready before recreating every political profile.</p>
    `;
    syncAdminMemberProfilesRebuildPolling();
    return;
  }

  if (status.status === "running") {
    elements.adminMemberProfilesRebuildStatus.className = "updates-status is-running";
    elements.adminMemberProfilesRebuildStatus.innerHTML = `
      <p><span class="status-chip">Destructive MK-profile rebuild in progress</span></p>
      <p>${Number(status.processedProfiles || 0).toLocaleString("he-IL")} out of ${Number(
        status.totalProfiles || 0,
      ).toLocaleString("he-IL")} MK profiles processed</p>
      <p class="muted">Recreated: ${Number(status.generatedProfiles || 0).toLocaleString(
        "he-IL",
      )} � Failures: ${Number(status.failedProfiles || 0).toLocaleString("he-IL")}</p>
      ${
        status.current
          ? `<p class="muted">Working now on: ${escapeHtml(status.current.name)} (${escapeHtml(
              status.current.partyName,
            )}) � ${escapeHtml(status.current.sourceLabel || status.current.sourceType || "")}</p>`
          : ""
      }
    `;
    syncAdminMemberProfilesRebuildPolling();
    return;
  }

  if (status.status === "failed") {
    elements.adminMemberProfilesRebuildStatus.className = "updates-status is-error";
    elements.adminMemberProfilesRebuildStatus.innerHTML = `
      <p><span class="status-chip">MK-profile rebuild failed</span></p>
      <p class="error-message">${escapeHtml(
        (status.recentErrors || [])[0] || "An unexpected error occurred during the destructive MK-profile rebuild.",
      )}</p>
    `;
    syncAdminMemberProfilesRebuildPolling();
    return;
  }

  elements.adminMemberProfilesRebuildStatus.className = `updates-status ${
    status.status === "completed_with_errors" ? "is-warning" : "is-success"
  }`;
  elements.adminMemberProfilesRebuildStatus.innerHTML = `
    <p><span class="status-chip">MK profiles rebuild finished</span></p>
    <p>${Number(status.generatedProfiles || 0).toLocaleString("he-IL")} MK profiles were recreated.</p>
    <p class="muted">Finished at ${escapeHtml(formatIsoDate(status.lastCompletedAt || status.finishedAt))}.</p>
    ${
      status.status === "completed_with_errors"
        ? `<p class="error-message">${Number(status.failedProfiles || 0).toLocaleString(
            "he-IL",
          )} MK profiles still failed and may need another pass.</p>`
        : ""
    }
  `;
  syncAdminMemberProfilesRebuildPolling();
}

function shuffleArray(values) {
  const copy = [...values];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temporary = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = temporary;
  }

  return copy;
}

function rebuildLandingQuoteDeck() {
  const items = Array.isArray(state.landing.data?.quoteFeed?.items) ? state.landing.data.quoteFeed.items : [];
  state.landing.quoteDeck = shuffleArray(items);
  state.landing.quoteOffset = 0;
  state.landing.visibleQuotes = [];
}

function advanceLandingQuotes() {
  const deck = state.landing.quoteDeck;

  if (!Array.isArray(deck) || !deck.length) {
    state.landing.visibleQuotes = [];
    return;
  }

  const visibleCount = Math.min(4, deck.length);

  if (state.landing.quoteOffset + visibleCount > deck.length) {
    state.landing.quoteDeck = shuffleArray(deck);
    state.landing.quoteOffset = 0;
  }

  state.landing.visibleQuotes = state.landing.quoteDeck.slice(
    state.landing.quoteOffset,
    state.landing.quoteOffset + visibleCount,
  );
  state.landing.quoteOffset += visibleCount;
}

function syncLandingQuoteTimer() {
  const hasQuotes = Array.isArray(state.landing.visibleQuotes) && state.landing.visibleQuotes.length > 0;

  if (hasQuotes) {
    if (!landingQuoteTimer) {
      landingQuoteTimer = window.setInterval(() => {
        advanceLandingQuotes();
        renderLandingQuotes();
      }, LANDING_QUOTE_ROTATION_MS);
    }
    return;
  }

  if (landingQuoteTimer) {
    window.clearInterval(landingQuoteTimer);
    landingQuoteTimer = null;
  }
}

function getSourceConfig(sourceKey = state.activeSource) {
  return SOURCE_CONFIG[sourceKey];
}

function getSourceState(sourceKey = state.activeSource) {
  return state.sources[sourceKey];
}

function isShowingSurprisingLaws(sourceState = getSourceState()) {
  return state.activeSource === "laws" && sourceState.lawListMode === "surprising";
}

function getActiveItems(sourceState = getSourceState()) {
  if (state.activeSource === "laws" && sourceState.lawListMode === "surprising") {
    return sourceState.surprisingItems;
  }

  return sourceState.items;
}

function invalidateSurprisingLawData() {
  const sourceState = getSourceState("laws");
  sourceState.surprisingLoaded = false;
  sourceState.surprisingSummary = null;
  sourceState.surprisingMethodology = [];
  sourceState.surprisingThreshold = null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildLandingQuoteProtocolUrl(protocolUrl, quoteText, memberName = "") {
  const targetUrl = new URL(String(protocolUrl || "/"), window.location.origin);
  targetUrl.searchParams.set("highlightQuote", quoteText || "");

  if (memberName) {
    targetUrl.searchParams.set("highlightSpeaker", memberName);
  }

  return `${targetUrl.pathname}${targetUrl.search}`;
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_error) {
      if (text.trim().startsWith("<")) {
        throw new Error(
          "הקישור הציבורי או התהליך המקומי של האפליקציה כבר אינם עדכניים. הפעילו מחדש את האתר, צרו קישור Cloudflare חדש ונסו שוב.",
        );
      }

      throw new Error("השרת החזיר תשובה לא תקינה.");
    }
  }

  return { response, payload };
}

async function loadAdminProtocolUpdatePreview() {
  if (!elements.adminProtocolStatus || !isAdminUser()) {
    renderAdminProtocolUpdatePanel();
    return;
  }

  state.adminProtocolUpdates.loading = true;
  state.adminProtocolUpdates.error = "";
  renderAdminProtocolUpdatePanel();

  try {
    const { response, payload } = await fetchJson("/api/admin/protocol-updates/pending");

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load the admin protocol review state.");
    }

    state.adminProtocolUpdates.preview = payload;
  } catch (error) {
    state.adminProtocolUpdates.error = error.message || String(error);
  } finally {
    state.adminProtocolUpdates.loading = false;
    renderAdminProtocolUpdatePanel();
  }
}

async function startAdminProtocolCheck() {
  if (!isAdminUser() || state.adminProtocolUpdates.checking || state.adminProtocolUpdates.applying) {
    return;
  }

  state.adminProtocolUpdates.checking = true;
  state.adminProtocolUpdates.error = "";
  renderAdminProtocolUpdatePanel();

  try {
    const { response, payload } = await fetchJson("/api/admin/protocol-updates/check", {
      method: "POST",
    });

    if (!response.ok && response.status !== 202) {
      throw new Error(payload.error || "Failed to check the protocol feeds.");
    }

    state.adminProtocolUpdates.preview = payload;
  } catch (error) {
    state.adminProtocolUpdates.error = error.message || String(error);
  } finally {
    state.adminProtocolUpdates.checking = false;
    renderAdminProtocolUpdatePanel();
  }
}

async function applyAdminProtocolUpdates() {
  if (!isAdminUser() || state.adminProtocolUpdates.applying || !state.adminProtocolUpdates.preview?.hasPendingApproval) {
    return;
  }

  const confirmed = window.confirm(
    "Add the newly discovered protocols to the website now?",
  );

  if (!confirmed) {
    return;
  }

  state.adminProtocolUpdates.applying = true;
  state.adminProtocolUpdates.error = "";
  renderAdminProtocolUpdatePanel();

  try {
    const { response, payload } = await fetchJson("/api/admin/protocol-updates/apply", {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(payload.error || "Failed to apply the approved protocol updates.");
    }

    state.adminProtocolUpdates.preview = payload;
    await Promise.all([fetchSourceData("plenum"), fetchSourceData("committee")]);

    if (state.activeSource === "plenum" || state.activeSource === "committee") {
      renderActiveSource();
    }
  } catch (error) {
    state.adminProtocolUpdates.error = error.message || String(error);
  } finally {
    state.adminProtocolUpdates.applying = false;
    renderAdminProtocolUpdatePanel();
  }
}

async function loadAdminLawUpdatePreview() {
  if (!elements.adminLawStatus || !isAdminUser()) {
    renderAdminLawUpdatePanel();
    return;
  }

  state.adminLawUpdates.loading = true;
  state.adminLawUpdates.error = "";
  renderAdminLawUpdatePanel();

  try {
    const { response, payload } = await fetchJson("/api/admin/law-updates/pending");

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load the admin law review state.");
    }

    state.adminLawUpdates.preview = payload;
  } catch (error) {
    state.adminLawUpdates.error = error.message || String(error);
  } finally {
    state.adminLawUpdates.loading = false;
    renderAdminLawUpdatePanel();
  }
}

async function startAdminLawCheck() {
  if (!isAdminUser() || state.adminLawUpdates.checking || state.adminLawUpdates.applying) {
    return;
  }

  state.adminLawUpdates.checking = true;
  state.adminLawUpdates.error = "";
  renderAdminLawUpdatePanel();

  try {
    const { response, payload } = await fetchJson("/api/admin/law-updates/check", {
      method: "POST",
    });

    if (!response.ok && response.status !== 202) {
      throw new Error(payload.error || "Failed to check the third-reading laws feed.");
    }

    state.adminLawUpdates.preview = payload;
  } catch (error) {
    state.adminLawUpdates.error = error.message || String(error);
  } finally {
    state.adminLawUpdates.checking = false;
    renderAdminLawUpdatePanel();
  }
}

async function applyAdminLawUpdates() {
  if (!isAdminUser() || state.adminLawUpdates.applying || !state.adminLawUpdates.preview?.hasPendingApproval) {
    return;
  }

  const confirmed = window.confirm(
    "Download the newly discovered third-reading laws and add them to the website now?",
  );

  if (!confirmed) {
    return;
  }

  state.adminLawUpdates.applying = true;
  state.adminLawUpdates.error = "";
  renderAdminLawUpdatePanel();

  try {
    const { response, payload } = await fetchJson("/api/admin/law-updates/apply", {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(payload.error || "Failed to apply the approved law updates.");
    }

    state.adminLawUpdates.preview = payload;
    invalidateSurprisingLawData();
    await Promise.all([fetchSourceData("laws"), refreshLawSyncStatus()]);

    if (state.activeSource === "laws") {
      renderActiveSource();
    }
  } catch (error) {
    state.adminLawUpdates.error = error.message || String(error);
  } finally {
    state.adminLawUpdates.applying = false;
    renderAdminLawUpdatePanel();
  }
}

async function loadAdminMissingLawAnalysisStatus() {
  if (!elements.adminLawAnalysisStatus || !isAdminUser()) {
    renderAdminMissingLawAnalysisPanel();
    return;
  }

  state.adminMissingLawAnalysis.loading = true;
  state.adminMissingLawAnalysis.error = "";
  renderAdminMissingLawAnalysisPanel();

  try {
    const { payload } = await fetchJson("/api/laws/analysis/status");
    getSourceState("laws").analysisStatus = payload;
  } catch (error) {
    state.adminMissingLawAnalysis.error = error.message || String(error);
  } finally {
    state.adminMissingLawAnalysis.loading = false;
    renderAdminMissingLawAnalysisPanel();
    syncAdminMissingLawAnalysisPolling();
  }
}

async function startAdminMissingLawAnalysis() {
  if (!isAdminUser() || state.adminMissingLawAnalysis.starting) {
    return;
  }

  state.adminMissingLawAnalysis.starting = true;
  state.adminMissingLawAnalysis.error = "";
  renderAdminMissingLawAnalysisPanel();

  try {
    const { response, payload } = await fetchJson("/api/admin/law-analyses/missing/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok && response.status !== 202) {
      throw new Error(payload.error || "Failed to start the missing-law analysis.");
    }

    getSourceState("laws").analysisStatus = payload;
    invalidateSurprisingLawData();
  } catch (error) {
    state.adminMissingLawAnalysis.error = error.message || String(error);
  } finally {
    state.adminMissingLawAnalysis.starting = false;
    renderAdminMissingLawAnalysisPanel();
    syncAdminMissingLawAnalysisPolling();
  }
}

async function loadAdminSurprisingVoteExplanationStatus() {
  if (!elements.adminSurprisingVoteExplanationStatus || !isAdminUser()) {
    renderAdminSurprisingVoteExplanationPanel();
    return;
  }

  state.adminSurprisingVoteExplanations.loading = true;
  state.adminSurprisingVoteExplanations.error = "";
  renderAdminSurprisingVoteExplanationPanel();

  try {
    const { response, payload } = await fetchJson("/api/admin/surprising-vote-explanations/status");

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load the bulk surprising-vote explanation status.");
    }

    state.adminSurprisingVoteExplanations.status = payload;
  } catch (error) {
    state.adminSurprisingVoteExplanations.error = error.message || String(error);
  } finally {
    state.adminSurprisingVoteExplanations.loading = false;
    renderAdminSurprisingVoteExplanationPanel();
    syncAdminSurprisingVoteExplanationPolling();
  }
}

async function startAdminSurprisingVoteExplanations() {
  if (!isAdminUser() || state.adminSurprisingVoteExplanations.starting) {
    return;
  }

  state.adminSurprisingVoteExplanations.starting = true;
  state.adminSurprisingVoteExplanations.error = "";
  renderAdminSurprisingVoteExplanationPanel();

  try {
    const { response, payload } = await fetchJson("/api/admin/surprising-vote-explanations/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok && response.status !== 202) {
      throw new Error(payload.error || "Failed to start the bulk surprising-vote explanation run.");
    }

    state.adminSurprisingVoteExplanations.status = payload;
  } catch (error) {
    state.adminSurprisingVoteExplanations.error = error.message || String(error);
  } finally {
    state.adminSurprisingVoteExplanations.starting = false;
    renderAdminSurprisingVoteExplanationPanel();
    syncAdminSurprisingVoteExplanationPolling();
  }
}

async function loadAdminLawAnalysisRebuildStatus() {
  if (!elements.adminLawAnalysisRebuildStatus || !isAdminUser()) {
    renderAdminLawAnalysisRebuildPanel();
    return;
  }

  state.adminLawAnalysisRebuild.loading = true;
  state.adminLawAnalysisRebuild.error = "";
  renderAdminLawAnalysisRebuildPanel();

  try {
    const { payload } = await fetchJson("/api/laws/analysis/status");
    getSourceState("laws").analysisStatus = payload;
  } catch (error) {
    state.adminLawAnalysisRebuild.error = error.message || String(error);
  } finally {
    state.adminLawAnalysisRebuild.loading = false;
    renderAdminLawAnalysisRebuildPanel();
    syncAdminLawAnalysisRebuildPolling();
  }
}

async function startAdminLawAnalysisRebuild() {
  if (!isAdminUser() || state.adminLawAnalysisRebuild.starting) {
    return;
  }

  const confirmation = window.prompt(
    "WARNING: This will take a long time, may cost money, and will delete and recreate the existing axes analysis for ALL third-reading laws.\n\nType yes to continue.",
    "",
  );

  if (confirmation === null) {
    return;
  }

  if (String(confirmation).trim().toLowerCase() !== "yes") {
    state.adminLawAnalysisRebuild.error =
      "The destructive full law-analysis rebuild was cancelled because the confirmation keyword was not exactly 'yes'.";
    renderAdminLawAnalysisRebuildPanel();
    return;
  }

  state.adminLawAnalysisRebuild.starting = true;
  state.adminLawAnalysisRebuild.error = "";
  renderAdminLawAnalysisRebuildPanel();

  try {
    const { response, payload } = await fetchJson("/api/admin/law-analyses/rebuild-all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        confirmation: "yes",
      }),
    });

    if (!response.ok && response.status !== 202) {
      throw new Error(payload.error || "Failed to start the destructive full law-analysis rebuild.");
    }

    getSourceState("laws").analysisStatus = payload;
    invalidateSurprisingLawData();
  } catch (error) {
    state.adminLawAnalysisRebuild.error = error.message || String(error);
  } finally {
    state.adminLawAnalysisRebuild.starting = false;
    renderAdminLawAnalysisRebuildPanel();
    syncAdminLawAnalysisRebuildPolling();
  }
}

async function loadAdminSmallQuotesRebuildStatus() {
  if (!elements.adminSmallQuotesStatus || !isAdminUser()) {
    renderAdminSmallQuotesRebuildPanel();
    return;
  }

  state.adminSmallQuotesRebuild.loading = true;
  state.adminSmallQuotesRebuild.error = "";
  renderAdminSmallQuotesRebuildPanel();

  try {
    const { response, payload } = await fetchJson("/api/admin/members/small-quotes-rebuild/status");

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load the destructive rebuild status.");
    }

    state.adminSmallQuotesRebuild.status = payload;
  } catch (error) {
    state.adminSmallQuotesRebuild.error = error.message || String(error);
  } finally {
    state.adminSmallQuotesRebuild.loading = false;
    renderAdminSmallQuotesRebuildPanel();
  }
}

async function startAdminSmallQuotesRebuild() {
  if (!isAdminUser() || state.adminSmallQuotesRebuild.starting) {
    return;
  }

  const confirmation = window.prompt(
    "WARNING: This will take a long time, may cost money, and will delete and recreate every existing small quotes file for all MKs.\n\nType yes to continue.",
    "",
  );

  if (confirmation === null) {
    return;
  }

  if (String(confirmation).trim().toLowerCase() !== "yes") {
    state.adminSmallQuotesRebuild.error =
      "The destructive rebuild was cancelled because the confirmation keyword was not exactly 'yes'.";
    renderAdminSmallQuotesRebuildPanel();
    return;
  }

  state.adminSmallQuotesRebuild.starting = true;
  state.adminSmallQuotesRebuild.error = "";
  renderAdminSmallQuotesRebuildPanel();

  try {
    const { response, payload } = await fetchJson("/api/admin/members/small-quotes-rebuild", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        confirmation: "yes",
      }),
    });

    if (!response.ok && response.status !== 202) {
      throw new Error(payload.error || "Failed to start the destructive small-quotes rebuild.");
    }

    state.adminSmallQuotesRebuild.status = payload;
  } catch (error) {
    state.adminSmallQuotesRebuild.error = error.message || String(error);
  } finally {
    state.adminSmallQuotesRebuild.starting = false;
    renderAdminSmallQuotesRebuildPanel();
    syncAdminSmallQuotesRebuildPolling();
  }
}

async function loadAdminMemberProfilesRebuildStatus() {
  if (!elements.adminMemberProfilesRebuildStatus || !isAdminUser()) {
    renderAdminMemberProfilesRebuildPanel();
    return;
  }

  state.adminMemberProfilesRebuild.loading = true;
  state.adminMemberProfilesRebuild.error = "";
  renderAdminMemberProfilesRebuildPanel();

  try {
    const { response, payload } = await fetchJson("/api/admin/members/profiles-rebuild/status");

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load the destructive MK-profile rebuild status.");
    }

    state.adminMemberProfilesRebuild.status = payload;
  } catch (error) {
    state.adminMemberProfilesRebuild.error = error.message || String(error);
  } finally {
    state.adminMemberProfilesRebuild.loading = false;
    renderAdminMemberProfilesRebuildPanel();
    syncAdminMemberProfilesRebuildPolling();
  }
}

async function startAdminMemberProfilesRebuild() {
  if (!isAdminUser() || state.adminMemberProfilesRebuild.starting) {
    return;
  }

  const confirmation = window.prompt(
    "WARNING: This will take a long time, may cost money, and will delete and recreate every MK profile generated from the small quotes files.\n\nType yes to continue.",
    "",
  );

  if (confirmation === null) {
    return;
  }

  if (String(confirmation).trim().toLowerCase() !== "yes") {
    state.adminMemberProfilesRebuild.error =
      "The destructive MK-profile rebuild was cancelled because the confirmation keyword was not exactly 'yes'.";
    renderAdminMemberProfilesRebuildPanel();
    return;
  }

  state.adminMemberProfilesRebuild.starting = true;
  state.adminMemberProfilesRebuild.error = "";
  renderAdminMemberProfilesRebuildPanel();

  try {
    const { response, payload } = await fetchJson("/api/admin/members/profiles-rebuild", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        confirmation: "yes",
      }),
    });

    if (!response.ok && response.status !== 202) {
      throw new Error(payload.error || "Failed to start the destructive MK-profile rebuild.");
    }

    state.adminMemberProfilesRebuild.status = payload;
  } catch (error) {
    state.adminMemberProfilesRebuild.error = error.message || String(error);
  } finally {
    state.adminMemberProfilesRebuild.starting = false;
    renderAdminMemberProfilesRebuildPanel();
    syncAdminMemberProfilesRebuildPolling();
  }
}

function getAxisTone(score) {
  if (!Number.isFinite(score)) {
    return "neutral";
  }

  if (score >= 8) {
    return "high";
  }

  if (score <= 3) {
    return "low";
  }

  return "mid";
}

function hashString(value) {
  let hash = 0;

  for (const character of String(value || "")) {
    hash = (hash * 31 + character.charCodeAt(0)) % 360;
  }

  return hash;
}

function getKnowYourMkPartyStyle(partyName) {
  const hue = (hashString(partyName) + 22) % 360;
  const border = `hsl(${hue} 56% 34%)`;
  const background = `linear-gradient(180deg, hsl(${hue} 72% 97%), hsl(${hue} 72% 92%))`;
  const text = `hsl(${hue} 48% 24%)`;

  return `--mk-party-border:${border};--mk-party-background:${background};--mk-party-text:${text};`;
}

const KNOW_YOUR_MK_HEBREW_TEXT = new Map([
  ["Explicit Views", "עמדות מפורשות"],
  ["Implicit Views", "עמדות משתמעות"],
  ["Vote-Based Views", "מבוסס הצבעות"],
  ["Vote-Based", "מבוסס הצבעות"],
  ["Expressed Views", "על סמך הטקסט"],
  ["Between The Lines", "בין השורות"],
  ["Based on Votes", "מבוסס הצבעות"],
  ["BETWEEN THE LINES", "בין השורות"],
  [
    "This view maps MKs only by what they explicitly say in their analyzed quotes. It does not include any between-the-lines inference.",
    "התצוגה הזו מציגה את חברי הכנסת רק לפי מה שהם אומרים במפורש בציטוטים שנותחו. היא אינה כוללת קריאה בין השורות.",
  ],
  [
    "Only the MK's direct, stated positions in the analyzed quotes are counted here.",
    "כאן נספרות רק העמדות שחבר הכנסת מבטא ישירות ובאופן מוצהר בציטוטים שנותחו.",
  ],
  [
    "This view is best for seeing how MKs publicly present themselves and their positions.",
    "זו התצוגה המתאימה ביותר להבנת האופן שבו חברי הכנסת מציגים את עצמם ואת עמדותיהם בפומבי.",
  ],
  [
    "This view maps MKs by the inferred, between-the-lines assessment from their saved profile analysis. It reflects implicit positioning, not only what they say outright.",
    "התצוגה הזו מציגה את חברי הכנסת לפי ההערכה המשתמעת שנגזרה מן הניתוח השמור שלהם בין השורות. היא משקפת מיקום אידיאולוגי מוסק, לא רק את מה שנאמר במפורש.",
  ],
  [
    "This layer uses the existing profile analysis of what the MK implies, signals, avoids saying outright, or reveals indirectly.",
    "השכבה הזו נשענת על ניתוח הפרופיל הקיים של מה שחבר הכנסת מרמז, מסמן, נמנע מלומר במפורש או חושף בעקיפין.",
  ],
  [
    "This view is more interpretive than the explicit one and should be read as an inference layer, not as a direct quote layer.",
    "זו תצוגה פרשנית יותר מן התצוגה המפורשת, ולכן צריך לקרוא אותה כהערכת עומק ולא כאוסף ציטוטים ישירים בלבד.",
  ],
  [
    "This view positions MKs by the laws they voted for. Each score is an average of the laws' scores on that axis, using only laws the MK voted FOR.",
    "התצוגה הזו ממקמת את חברי הכנסת לפי החוקים שבהם הצביעו בעד. כל ציון הוא ממוצע ציוני החוקים על אותו ציר, ורק חוקים שנתמכו על ידי הח\"כ נכללים בחישוב.",
  ],
  [
    "Only laws with both named-vote data and saved axis analysis are counted here, and only when the MK voted FOR the law.",
    "כאן נספרים רק חוקים שיש להם גם נתוני הצבעה שמית וגם ניתוח צירים שמור, ורק במקרים שבהם חבר הכנסת הצביע בעד החוק.",
  ],
  [
    "Each axis score is the average of the laws the MK supported, so this is a map of voting behavior in practice rather than declared rhetoric.",
    "כל ציון מחושב כממוצע ציוני החוקים שבהם חבר הכנסת תמך, ולכן זו מפה של דפוס ההצבעה בפועל ולא של הרטוריקה המוצהרת.",
  ],
  [
    "This view positions MKs by the laws they voted on. Votes FOR keep the law's score, and votes AGAINST use 11 minus the law's score.",
    "התצוגה הזו ממקמת את חברי הכנסת לפי החוקים שבהם הצביעו בעד או נגד. בהצבעה בעד נספר ציון החוק כפי שהוא, ובהצבעה נגד נספר 11 פחות ציון החוק, חוץ ממקרה שבו ציון החוק הוא 5 ואז הוא נשאר 5.",
  ],
  [
    "Only laws with both named-vote data and saved axis analysis are counted here, whether the MK voted FOR or AGAINST the law.",
    "כאן נספרים רק חוקים שיש להם גם נתוני הצבעה שמית וגם ניתוח צירים שמור, בין אם חבר הכנסת הצביע בעד החוק ובין אם הצביע נגדו.",
  ],
  [
    "Each axis score is the average of the adjusted law scores in the MK's voting record, so this is a map of voting behavior in practice rather than declared rhetoric.",
    "כל ציון מחושב כממוצע ציוני החוקים לאחר התאמה לכיוון ההצבעה, ולכן זו מפה של דפוס ההצבעה בפועל ולא של הרטוריקה המוצהרת.",
  ],
  ["Small quotes", "הקובץ הקטן"],
  ["Full quotes", "הקובץ המלא"],
  ["Small quotes file", "הקובץ הקטן"],
  ["Full quotes file", "הקובץ המלא"],
]);

function localizeKnowYourMkText(value) {
  const normalizedValue = String(value || "").trim();
  return KNOW_YOUR_MK_HEBREW_TEXT.get(normalizedValue) || String(value || "");
}

function normalizeKnowYourMkPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const views = payload.views && typeof payload.views === "object" ? payload.views : {};
  const localizedViews = Object.fromEntries(
    Object.entries(views).map(([key, view]) => [
      key,
      {
        ...view,
        label: localizeKnowYourMkText(view?.label),
        shortLabel: localizeKnowYourMkText(view?.shortLabel),
        eyebrow: localizeKnowYourMkText(view?.eyebrow),
        disclaimer: localizeKnowYourMkText(view?.disclaimer),
        methodology: Array.isArray(view?.methodology)
          ? view.methodology.map(localizeKnowYourMkText)
          : [],
      },
    ]),
  );

  const localizedMembers = Array.isArray(payload.members)
    ? payload.members.map((member) => ({
        ...member,
        sourceLabel: localizeKnowYourMkText(member?.sourceLabel),
        voteProfile: member?.voteProfile
          ? {
              ...member.voteProfile,
              sourceLabel: localizeKnowYourMkText(member.voteProfile?.sourceLabel),
            }
          : member?.voteProfile,
      }))
    : payload.members;

  return {
    ...payload,
    views: localizedViews,
    members: localizedMembers,
  };
}

function getKnowYourMkPayload() {
  return state.landing.knowYourMk.data;
}

function getKnowYourMkAvailableViews() {
  const views = getKnowYourMkPayload()?.views;
  return views && typeof views === "object" ? views : {};
}

function getActiveKnowYourMkViewKey() {
  const views = getKnowYourMkAvailableViews();
  const activeView = state.landing.knowYourMk.activeView;

  if (views[activeView]) {
    return activeView;
  }

  const fallbackView = Object.keys(views)[0] || "explicit";
  state.landing.knowYourMk.activeView = fallbackView;
  return fallbackView;
}

function getActiveKnowYourMkView() {
  const viewKey = getActiveKnowYourMkViewKey();
  return getKnowYourMkAvailableViews()?.[viewKey] || null;
}

function getKnowYourMkVoteProfileMeta(entity) {
  if (entity?.voteProfile && typeof entity.voteProfile === "object") {
    return entity.voteProfile;
  }

  return entity && typeof entity === "object" ? entity : null;
}

function hasLowKnowYourMkVoteProfileSubstantiation(entity) {
  const voteProfile = getKnowYourMkVoteProfileMeta(entity);
  const countedLawCount = Number(voteProfile?.countedLawCount ?? voteProfile?.supportedLawCount ?? 0);
  const minimumCount = Number(voteProfile?.minimumSubstantiatedVoteCount || 5);
  return Boolean(voteProfile?.isLowSubstantiation) || (countedLawCount > 0 && countedLawCount < minimumCount);
}

function getKnowYourMkVoteProfileSubstantiationWarning(entity) {
  const voteProfile = getKnowYourMkVoteProfileMeta(entity);

  if (!hasLowKnowYourMkVoteProfileSubstantiation(voteProfile)) {
    return "";
  }

  return String(voteProfile?.substantiationWarning || "").trim();
}

function renderKnowYourMkVoteProfileFlag(entity, options = {}) {
  const warning = getKnowYourMkVoteProfileSubstantiationWarning(entity);

  if (!warning) {
    return "";
  }

  return `<span class="status-chip status-chip--vote-caution vote-confidence-flag${
    options.className ? ` ${escapeHtml(options.className)}` : ""
  }" title="${escapeHtml(warning)}">${escapeHtml(options.label || "מעט הצבעות")}</span>`;
}

function renderKnowYourMkVoteProfileCautionNote(entity, viewKey = getActiveKnowYourMkViewKey()) {
  if (viewKey !== "votesBased") {
    return "";
  }

  const warning = getKnowYourMkVoteProfileSubstantiationWarning(entity);

  if (!warning) {
    return "";
  }

  return `
    <div class="analysis-source-disclaimer vote-confidence-note">
      <p>${escapeHtml(warning)}</p>
    </div>
  `;
}

function getFilteredKnowYourMkMembers() {
  const data = getKnowYourMkPayload();
  const members = Array.isArray(data?.members) ? data.members : [];
  const search = normalizeSearchText(state.landing.knowYourMk.filters.search);
  const party = String(state.landing.knowYourMk.filters.party || "").trim();

  return members.filter((member) => {
    if (party && member.partyName !== party) {
      return false;
    }

    if (!search) {
      return true;
    }

    const haystack = normalizeSearchText(`${member.name} ${member.partyName}`);
    return haystack.includes(search);
  });
}

function ensureKnowYourMkSelection(filteredMembers, axes) {
  const currentMemberSlug = state.landing.knowYourMk.selectedMemberSlug;
  const currentAxisKey = state.landing.knowYourMk.selectedAxisKey;
  const hasSelectedMember = filteredMembers.some((member) => member.routeSlug === currentMemberSlug);

  if (!filteredMembers.length) {
    state.landing.knowYourMk.selectedMemberSlug = "";
  } else if (!hasSelectedMember) {
    state.landing.knowYourMk.selectedMemberSlug = filteredMembers[0].routeSlug;
  }

  if (!Array.isArray(axes) || !axes.some((axis) => axis.key === currentAxisKey)) {
    state.landing.knowYourMk.selectedAxisKey = axes?.[0]?.key || "religiousSecular";
  }
}

function buildKnowYourMkAxisColumns(members, axisKey, viewKey = getActiveKnowYourMkViewKey()) {
  const columns = Array.from({ length: 10 }, (_value, index) => ({
    score: index + 1,
    members: [],
  }));

  for (const member of members) {
    const axisRecord = member.axes?.[viewKey]?.[axisKey] || null;
    const score = Number(axisRecord?.score || 0);
    const bucketScore = Number(axisRecord?.bucketScore || Math.round(score));

    if (score >= 1 && score <= 10 && bucketScore >= 1 && bucketScore <= 10) {
      columns[bucketScore - 1].members.push(member);
    }
  }

  for (const column of columns) {
    column.members.sort((left, right) => {
      if ((left.partyName || "") !== (right.partyName || "")) {
        return String(left.partyName || "").localeCompare(String(right.partyName || ""), "he");
      }

      return String(left.name || "").localeCompare(String(right.name || ""), "he");
    });
  }

  return columns;
}

function getKnowYourMkSummaryChips(data, activeViewKey) {
  if (activeViewKey === "votesBased") {
    const chips = [
      `${formatInteger(data.summary?.voteBasedMembers)} עם פרופיל הצבעות`,
      `${formatInteger(data.summary?.voteBasedProfiledLaws)} חוקים עם ניתוח והצבעה`,
      `${formatInteger(data.summary?.voteBasedCountedVotes ?? data.summary?.voteBasedSupportVotes)} הצבעות שנכללו`,
      `עודכן ${escapeHtml(formatIsoDate(data.generatedAt))}`,
    ];

    if (Number(data.summary?.lowSubstantiationVoteBasedMembers || 0) > 0) {
      chips.splice(
        3,
        0,
        `${formatInteger(data.summary?.lowSubstantiationVoteBasedMembers)} פרופילים עם מעט הצבעות`,
      );
    }

    return chips;
  }

  return [
    `${formatInteger(data.summary?.availableMembers)} נותחו`,
    `${formatInteger(data.summary?.smallSourceMembers)} מהקובץ הקטן`,
    `${formatInteger(data.summary?.fullSourceMembers)} גיבוי מהקובץ המלא`,
    `עודכן ${escapeHtml(formatIsoDate(data.generatedAt))}`,
  ];
}

function renderKnowYourMkSummary() {
  if (!elements.knowYourMkSummary) {
    return;
  }

  const knowYourMkState = state.landing.knowYourMk;
  const data = knowYourMkState.data;

  if (knowYourMkState.loading) {
    elements.knowYourMkSummary.innerHTML = '<p class="muted">טוען את מפת חברי הכנסת ומכין את התצוגה...</p>';
    return;
  }

  if (knowYourMkState.error) {
    elements.knowYourMkSummary.innerHTML = `<p class="error-message">${escapeHtml(knowYourMkState.error)}</p>`;
    return;
  }

  if (!data) {
    elements.knowYourMkSummary.innerHTML = '<p class="muted">תקציר חברי הכנסת עדיין לא נטען.</p>';
    return;
  }

  const activeViewKey = getActiveKnowYourMkViewKey();
  const activeView = getActiveKnowYourMkView();
  const views = Object.values(getKnowYourMkAvailableViews());
  const disclaimer = activeView?.disclaimer || "";
  const methodology = Array.isArray(activeView?.methodology) ? activeView.methodology : [];
  const summaryChips = getKnowYourMkSummaryChips(data, activeViewKey);

  elements.knowYourMkSummary.innerHTML = `
    <div class="know-your-mk-summary-card">
      <div class="know-your-mk-view-switch" role="tablist" aria-label="תצוגות חברי הכנסת">
        ${views
          .map(
            (view) => `
              <button
                type="button"
                class="know-your-mk-view-tab ${view.key === activeViewKey ? "is-active" : ""}"
                data-know-your-mk-view="${escapeHtml(view.key)}"
                aria-pressed="${view.key === activeViewKey ? "true" : "false"}"
              >
                ${escapeHtml(view.label)}
              </button>
            `,
          )
          .join("")}
      </div>
      <div class="know-your-mk-summary-card__stats">
        ${summaryChips.map((chip) => `<span class="status-chip">${chip}</span>`).join("")}
      </div>
      <div class="know-your-mk-disclaimer">
        <strong>${escapeHtml(activeView?.eyebrow || "הכירו את חברי הכנסת")}</strong>
        <p>${escapeHtml(disclaimer)}</p>
      </div>
      <ul class="know-your-mk-summary-card__methodology">
        ${methodology.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
      <p class="muted">
        המפה המלאה מציגה כל חבר כנסת על פני ארבעת הצירים, ופותחת לכל מיקום את ההסבר לציון,
        את הראיות שעליהן הוא נשען, ובתצוגת ההצבעות גם את החוקים המרכזיים שנכללו בפרופיל.
      </p>
    </div>
  `;
}

function buildKnowYourMkExtremeGroups() {
  const data = getKnowYourMkPayload();
  const axes = Array.isArray(data?.axes) ? data.axes : [];
  const members = Array.isArray(data?.members) ? data.members : [];
  const activeViewKey = getActiveKnowYourMkViewKey();

  return axes.map((axis) => {
    const scoredMembers = members
      .filter((member) => {
        const score = Number(member.axes?.[activeViewKey]?.[axis.key]?.score || 0);
        return score >= 1 && score <= 10;
      })
      .sort((left, right) => {
        const leftScore = Number(left.axes?.[activeViewKey]?.[axis.key]?.score || 0);
        const rightScore = Number(right.axes?.[activeViewKey]?.[axis.key]?.score || 0);

        if (leftScore !== rightScore) {
          return leftScore - rightScore;
        }

        return String(left.name || "").localeCompare(String(right.name || ""), "he");
      });

    return {
      ...axis,
      lowMembers: scoredMembers.slice(0, 3),
      highMembers: [...scoredMembers].reverse().slice(0, 3),
    };
  });
}

function renderKnowYourMkExtremes() {
  if (!elements.knowYourMkExtremes) {
    return;
  }

  const knowYourMkState = state.landing.knowYourMk;
  const data = knowYourMkState.data;

  if (knowYourMkState.loading) {
    elements.knowYourMkExtremes.innerHTML = `
      <div class="landing-empty-card">
        <p class="muted">טוען את הקצוות האידיאולוגיים...</p>
      </div>
    `;
    return;
  }

  if (knowYourMkState.error) {
    elements.knowYourMkExtremes.innerHTML = `<div class="landing-empty-card"><p class="error-message">${escapeHtml(
      knowYourMkState.error,
    )}</p></div>`;
    return;
  }

  const groups = buildKnowYourMkExtremeGroups();
  const activeView = getActiveKnowYourMkView();
  const activeViewKey = getActiveKnowYourMkViewKey();

  if (!groups.length) {
    elements.knowYourMkExtremes.innerHTML = `
      <div class="landing-empty-card">
        <p class="muted">עדיין אין תקציר אידיאולוגי זמין.</p>
      </div>
    `;
    return;
  }

  elements.knowYourMkExtremes.innerHTML = `
    <div class="know-your-mk-extremes-grid">
      ${groups
        .map(
          (axis) => `
            <article class="know-your-mk-extreme-card">
              <div class="know-your-mk-extreme-card__header">
                <div>
                  <p class="eyebrow">${escapeHtml(activeView?.eyebrow || "מפת הציר")}</p>
                  <h3>${escapeHtml(axis.label)}</h3>
                </div>
                <p class="muted">1 = ${escapeHtml(axis.lowLabel)} / 10 = ${escapeHtml(axis.highLabel)}</p>
              </div>

              <div class="know-your-mk-extreme-card__columns">
                <section class="know-your-mk-extreme-column">
                  <h4>${escapeHtml(`הכי ${axis.lowLabel}`)}</h4>
                  <ol class="know-your-mk-extreme-list">
                    ${axis.lowMembers
                      .map(
                        (member) => `
                          <li>
                            <a href="${escapeHtml(member.href)}">
                              <strong>${escapeHtml(member.name)}</strong>
                              ${activeViewKey === "votesBased" ? renderKnowYourMkVoteProfileFlag(member) : ""}
                              <span>${escapeHtml(member.partyName)}</span>
                              <b>${formatAxisScore(
                                member.axes?.[activeViewKey]?.[axis.key]?.score || 0,
                              )}/10</b>
                            </a>
                          </li>
                        `,
                      )
                      .join("")}
                  </ol>
                </section>

                <section class="know-your-mk-extreme-column">
                  <h4>${escapeHtml(`הכי ${axis.highLabel}`)}</h4>
                  <ol class="know-your-mk-extreme-list">
                    ${axis.highMembers
                      .map(
                        (member) => `
                          <li>
                            <a href="${escapeHtml(member.href)}">
                              <strong>${escapeHtml(member.name)}</strong>
                              ${activeViewKey === "votesBased" ? renderKnowYourMkVoteProfileFlag(member) : ""}
                              <span>${escapeHtml(member.partyName)}</span>
                              <b>${formatAxisScore(
                                member.axes?.[activeViewKey]?.[axis.key]?.score || 0,
                              )}/10</b>
                            </a>
                          </li>
                        `,
                      )
                      .join("")}
                  </ol>
                </section>
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderKnowYourMkGaps() {
  if (!elements.knowYourMkGaps) {
    return;
  }

  const knowYourMkState = state.landing.knowYourMk;
  const data = knowYourMkState.data;

  if (knowYourMkState.loading) {
    elements.knowYourMkGaps.innerHTML = `
      <div class="landing-empty-card">
        <p class="muted">טוען את פערי הדיבור וההצבעה...</p>
      </div>
    `;
    return;
  }

  if (knowYourMkState.error) {
    elements.knowYourMkGaps.innerHTML = `<div class="landing-empty-card"><p class="error-message">${escapeHtml(
      knowYourMkState.error,
    )}</p></div>`;
    return;
  }

  const gapPayload = data?.mouthHeartGap || null;
  const items = Array.isArray(gapPayload?.items) ? gapPayload.items.slice(0, 4) : [];

  if (!items.length) {
    elements.knowYourMkGaps.innerHTML = `
      <div class="landing-empty-card">
        <p class="muted">עדיין אין מספיק חברי כנסת עם גם פרופיל מפורש וגם פרופיל מבוסס הצבעות כדי להציג את פערי הדיבור וההצבעה.</p>
      </div>
    `;
    return;
  }

  elements.knowYourMkGaps.innerHTML = `
    <section class="know-your-mk-gap-shell">
      <div class="landing-section__header landing-section__header--tight">
        <div>
          <p class="eyebrow">אחד בפה - אחד בלב</p>
          <h3>מי מדבר בכיוון אחד ומצביע בכיוון אחר</h3>
        </div>
        <p class="muted">רשימה קצרה של חברי הכנסת שבהם נרשם הפער הגדול ביותר בין מה שהם אומרים במפורש לבין מה שמשתקף מדפוס ההצבעות שלהם.</p>
      </div>

      <div class="know-your-mk-summary-card__stats">
        <span class="status-chip">${formatInteger(gapPayload?.comparedMembers)} חברי כנסת הושוו</span>
        <span class="status-chip">מוצג כאן רק הציר עם הפער הגדול ביותר לכל ח"כ</span>
      </div>

      <div class="know-your-mk-gap-grid">
        ${items
          .map(
            (item) => {
              const strongestAxis = item.strongestAxis || item.axisDifferences?.[0] || null;

              if (!strongestAxis) {
                return "";
              }

              const memberVotesHref = buildMemberVotesHref(item.href);

              return `
              <a class="know-your-mk-gap-card know-your-mk-gap-card--link" href="${escapeHtml(memberVotesHref)}">
                <div class="know-your-mk-gap-card__header">
                  <div>
                    <h4>${escapeHtml(item.name)}</h4>
                    <p class="muted">${escapeHtml(item.partyName)}</p>
                    ${renderKnowYourMkVoteProfileFlag(item)}
                  </div>
                </div>
                <div class="know-your-mk-gap-card__axis-meta">
                  <span class="know-your-mk-gap-pill is-strongest">
                    הציר הבולט: ${escapeHtml(strongestAxis.label)}
                  </span>
                  <span class="know-your-mk-gap-pill">פער ${escapeHtml(formatAxisScore(strongestAxis.difference))}</span>
                </div>
                ${renderKnowYourMkVoteProfileCautionNote(item, "votesBased")}
                <p class="know-your-mk-gap-card__lead">
                  ${escapeHtml(buildGapContrastText(strongestAxis))}
                </p>
                ${renderGapComparisonMeter(strongestAxis)}
              </a>
            `;
            },
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderKnowYourMkSection() {
  renderKnowYourMkSummary();
  renderKnowYourMkExtremes();
  renderKnowYourMkGaps();
}

if (elements.knowYourMkSummary) {
  elements.knowYourMkSummary.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-know-your-mk-view]");

    if (!tab) {
      return;
    }

    state.landing.knowYourMk.activeView = tab.dataset.knowYourMkView || "explicit";
    renderKnowYourMkSection();
  });
}

function renderLandingCategories() {
  if (!elements.landingCategories) {
    return;
  }

  elements.landingCategories.innerHTML = `
    <a class="landing-category-card landing-category-card--comparisons" href="/comparisons">
      <span class="landing-category-card__eyebrow">DATA COMPARISONS</span>
      <strong>נתונים והשוואות</strong>
      <p>השוואות קוד קשיח בין מפלגות וחברי כנסת על נושאים ציבוריים מרכזיים בישראל.</p>
      <div class="landing-category-card__meta">
        <span>פתחו</span>
        <span>עמוד ייעודי</span>
      </div>
    </a>
    <a class="landing-category-card landing-category-card--members" href="/members">
      <span class="landing-category-card__eyebrow">MK PROFILES</span>
      <strong>חברי הכנסת</strong>
      <p>עמודי פרופיל לכל חבר כנסת, עם פרוטוקולים, קובצי אמירות, ניתוחי פרופיל וראיות בולטות.</p>
      <div class="landing-category-card__meta">
        <span>פתחו</span>
        <span>עמוד ייעודי</span>
      </div>
    </a>
    <a class="landing-category-card landing-category-card--contact" href="/talk-to-your-representatives">
      <span class="landing-category-card__eyebrow">ACTION DIRECTORY</span>
      <strong>דברו עם הנציגים שלכם!</strong>
      <p>ספריית קשר מהירה שמרכזת את כל חברי הכנסת עם אייקונים לחיצים למייל, טלפון ורשתות חברתיות.</p>
      <div class="landing-category-card__meta">
        <span>פתחו</span>
        <span>עמוד ייעודי</span>
      </div>
    </a>
    <a class="landing-category-card landing-category-card--votes" href="/surprising-votes/">
      <span class="landing-category-card__eyebrow">SURPRISING VOTES</span>
      <strong>הצבעות מפתיעות</strong>
      <p>חוקים שבהם הצבעות התמיכה התנגשו באופן חד עם הפרופיל האידיאולוגי המחושב של חברי הכנסת.</p>
      <div class="landing-category-card__meta">
        <span>פתחו</span>
        <span>עמוד ייעודי</span>
      </div>
    </a>
    <a class="landing-category-card landing-category-card--laws" href="/laws/">
      <span class="landing-category-card__eyebrow">THIRD-READING LAWS</span>
      <strong>חוקים בקריאה שלישית</strong>
      <p>החוקים האחרונים שאושרו בקריאה שלישית, כולל נוסח קריא, הורדות, מפת הצבעות וניתוח אידיאולוגי.</p>
      <div class="landing-category-card__meta">
        <span>פתחו</span>
        <span>עמוד ייעודי</span>
      </div>
    </a>
    <a class="landing-category-card landing-category-card--committee" href="/committees/">
      <span class="landing-category-card__eyebrow">COMMITTEE PROTOCOLS</span>
      <strong>ישיבות ועדות הכנסת</strong>
      <p>דיוני ועדות מהשנים האחרונות, עם סינון לפי סוג ועדה ולפי שם הוועדה.</p>
      <div class="landing-category-card__meta">
        <span>פתחו</span>
        <span>עמוד ייעודי</span>
      </div>
    </a>
  `;
  return;

  if (state.landing.loading) {
    elements.landingCategories.innerHTML = `
      <div class="landing-empty-card">
        <p class="muted">טוען את מפת האתר ואת מוקדי העניין הבולטים...</p>
      </div>
    `;
    return;
  }

  if (state.landing.error) {
    elements.landingCategories.innerHTML = `
      <div class="landing-empty-card">
        <p class="error-message">${escapeHtml(state.landing.error)}</p>
      </div>
    `;
    return;
  }

  const categories = (Array.isArray(state.landing.data?.categories) ? state.landing.data.categories : []).filter(
    (category) => category?.key !== "plenum",
  );

  elements.landingCategories.innerHTML = categories
    .map(
      (category) => `
        <a
          class="landing-category-card landing-category-card--${escapeHtml(category.tone || "default")}"
          href="${escapeHtml(category.href || "#explorer")}"
          ${category.sourceKey ? `data-source-key="${escapeHtml(category.sourceKey)}"` : ""}
          ${category.lawMode ? `data-law-mode="${escapeHtml(category.lawMode)}"` : ""}
        >
          <span class="landing-category-card__eyebrow">${escapeHtml(category.title)}</span>
          <strong>${escapeHtml(category.hebrewTitle)}</strong>
          <p>${escapeHtml(category.description)}</p>
          <div class="landing-category-card__meta">
            <span>${formatInteger(category.count)}</span>
            <span>${escapeHtml(category.unitLabel || "items")}</span>
          </div>
        </a>
      `,
    )
    .join("");
}

function renderLandingNewsline() {
  if (!elements.landingNewsline) {
    return;
  }

  if (state.landing.loading) {
    elements.landingNewsline.innerHTML = '<p class="muted">אוסף את ההצבעות המפתיעות ביותר על חוקים...</p>';
    return;
  }

  if (state.landing.error) {
    elements.landingNewsline.innerHTML = `<p class="error-message">${escapeHtml(state.landing.error)}</p>`;
    return;
  }

  const newsline = state.landing.data?.newsline;
  const items = Array.isArray(newsline?.items) ? newsline.items : [];

  if (!items.length) {
    elements.landingNewsline.innerHTML = `
      <div class="landing-empty-card">
        <p class="muted">עדיין אין סיפורי הצבעה מפתיעים זמינים. רעננו את מדור החוקים אחרי שניתוחי החוקים יושלמו.</p>
      </div>
    `;
    return;
  }

  const methodologyNote = Number(newsline?.threshold)
    ? `כלל ההפתעה: הצבעת תמיכה מסומנת כאשר הפער בין חבר הכנסת לבין החוק מגיע ל-${Number(newsline.threshold)} נקודות או יותר לפחות באחד מהצירים האידיאולוגיים.`
    : "";

  elements.landingNewsline.innerHTML = `
    <div class="landing-newsline__meta">
      <span class="status-chip">${formatInteger(newsline?.summary?.lawsWithSurprisingVotes)} חוקים עם הצבעות תמיכה מפתיעות</span>
      <p class="muted">${escapeHtml(methodologyNote)}</p>
    </div>
    <div class="landing-newsline__list">
      ${items
        .map(
          (item) => `
            <a class="landing-newsline-card" href="/law/${encodeURIComponent(item.billId)}">
              <span class="landing-newsline-card__rank">#${formatInteger(item.rank)}</span>
              <div class="landing-newsline-card__body">
                <strong>${escapeHtml(item.title)}</strong>
                <p class="muted">${escapeHtml(item.longDateLabel || item.shortDateLabel || "")}</p>
                <div class="landing-newsline-card__stats">
                  <span>${formatInteger(item.surprisingVoteCount)} הצבעות מפתיעות</span>
                  <span>פער מרבי ${formatInteger(item.maximumDifference)}</span>
                </div>
                <p class="landing-newsline-card__names">
                  ${escapeHtml(
                    (item.topSurprisingMembers || [])
                      .map((member) => member.memberName)
                      .join(" • "),
                  )}
                </p>
              </div>
            </a>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderLandingSpotlight() {
  if (!elements.landingSpotlight) {
    return;
  }

  const spotlightState = state.landing.spotlight;

  if (spotlightState.loading) {
    elements.landingSpotlight.innerHTML = '<p class="muted">בוחר את הפוליטיקאי של השעה...</p>';
    return;
  }

  if (spotlightState.error) {
    elements.landingSpotlight.innerHTML = `<p class="error-message">${escapeHtml(spotlightState.error)}</p>`;
    return;
  }

  const spotlight = spotlightState.data;

  if (!spotlight || spotlight.status !== "ready") {
    elements.landingSpotlight.innerHTML = `
      <div class="landing-empty-card">
        <p class="muted">הספוטלייט יופיע כאן ברגע שלפחות ניתוח קצר אחד של חבר כנסת יהיה מוכן.</p>
      </div>
    `;
    return;
  }

  elements.landingSpotlight.innerHTML = `
    <article
      class="landing-spotlight-card landing-spotlight-card--interactive"
      data-spotlight-member-href="${escapeHtml(spotlight.member.href)}"
      tabindex="0"
      role="link"
      aria-label="${escapeHtml(`פתחו את עמוד חבר הכנסת של ${spotlight.member.name}`)}"
    >
      <div class="landing-spotlight-card__topline">
        <span class="landing-spotlight-card__open-hint">לפרופיל המלא</span>
      </div>

      <div class="landing-spotlight-card__layout">
        <div class="landing-spotlight-card__content">
          <div class="landing-spotlight-card__header">
            <div>
              <p class="eyebrow">Politician Of The Hour</p>
              <h3>${escapeHtml(spotlight.member.name)}</h3>
              <p class="muted">${escapeHtml(spotlight.member.partyName)}</p>
            </div>
          </div>

          <div class="landing-spotlight-card__stats-wrap">
            <div class="landing-spotlight-card__stats">
              <span>${formatInteger(spotlight.stats.protocolCount)} פרוטוקולים</span>
              <span>${formatInteger(spotlight.stats.plenumProtocols)} מליאה</span>
              <span>${formatInteger(spotlight.stats.committeeProtocols)} ועדות</span>
            </div>
            ${renderLandingSpotlightContacts(spotlight.contacts)}
          </div>

          <div class="landing-spotlight-card__summary">
            <p>${escapeHtml(spotlight.summary)}</p>
          </div>

          ${
            spotlight.highlightedQuote
              ? `
                <div class="landing-spotlight-quote">
                  <span class="landing-spotlight-quote__label">${escapeHtml(
                    spotlight.highlightedQuote.protocolHeading,
                  )}</span>
                  <blockquote>${escapeHtml(spotlight.highlightedQuote.quote)}</blockquote>
                </div>
              `
              : ""
          }
        </div>

        <div class="landing-spotlight-card__aside">
          <div class="landing-spotlight-card__axes-header">
            <span class="landing-axis-chip">ציטוטים ישירים מול הצבעות</span>
            <p class="muted">איך הפוליטיקאי מדבר בוועדות - ואיך הוא מצביע בפועל?</p>
          </div>
          <div class="landing-spotlight-axis-board">
            ${(spotlight.axes || []).map((axis) => renderSpotlightAxisCompare(axis)).join("")}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderLandingQuotes() {
  if (!elements.landingQuotes) {
    return;
  }

  if (state.landing.loading) {
    syncLandingQuoteTimer();
    elements.landingQuotes.innerHTML = '<p class="muted">בונה את זרם הציטוטים העדכני...</p>';
    return;
  }

  if (state.landing.error) {
    state.landing.visibleQuotes = [];
    syncLandingQuoteTimer();
    elements.landingQuotes.innerHTML = `<p class="error-message">${escapeHtml(state.landing.error)}</p>`;
    return;
  }

  const items = Array.isArray(state.landing.data?.quoteFeed?.items) ? state.landing.data.quoteFeed.items : [];

  if (!items.length) {
    state.landing.visibleQuotes = [];
    syncLandingQuoteTimer();
    elements.landingQuotes.innerHTML = `
      <div class="landing-empty-card">
        <p class="muted">כרטיסי הציטוטים יופיעו כאן אחרי עיבוד הפרוטוקולים העדכניים.</p>
      </div>
    `;
    return;
  }

  if (!Array.isArray(state.landing.visibleQuotes) || !state.landing.visibleQuotes.length) {
    rebuildLandingQuoteDeck();
    advanceLandingQuotes();
  }

  const visibleQuotes = state.landing.visibleQuotes;
  syncLandingQuoteTimer();

  const cardsMarkup = visibleQuotes
    .map(
      (item) => `
        <a
          class="landing-quote-card landing-quote-card--link"
          href="${escapeHtml(
            buildLandingQuoteProtocolUrl(
              item.protocolUrl,
              item.quoteSearchText || item.quote,
              item.memberName,
            ),
          )}"
          aria-label="${escapeHtml(`פתחו את הפרוטוקול המקורי של ${item.memberName}`)}"
        >
          <div class="landing-quote-card__header">
            <div class="landing-quote-card__speaker">
              <strong>${escapeHtml(item.memberName)}</strong>
              <span>${escapeHtml(item.partyName)}</span>
            </div>
            <span class="landing-quote-card__cta">לפרוטוקול המלא</span>
          </div>
          <blockquote>${escapeHtml(item.quote)}</blockquote>
          <div class="landing-quote-card__meta">
            <span>${escapeHtml(item.protocolHeading)}</span>
            <span>${escapeHtml(item.shortDateLabel || "")}</span>
          </div>
        </a>
      `,
    )
    .join("");

  elements.landingQuotes.innerHTML = `
    <div class="landing-quote-showcase">
      <div class="landing-quote-showcase__header">
        <div class="landing-quote-showcase__status">
          <span class="status-chip">מתחלף כל 2.5 דקות</span>
          <button
            type="button"
            class="secondary-button compact-button"
            data-landing-quotes-refresh
          >
            החלפת כל ארבעת הציטוטים
          </button>
        </div>
        <p class="muted">קבוצה חדשה של ארבעה ציטוטים מתחלפת כאן כל 2.5 דקות, ונבחרת מתוך הפרוטוקולים האחרונים לפי אינדיקטורים קשיחים של עימות, רגש, אחריות ציבורית וספציפיות. אפשר גם ללחוץ על כל כרטיס כדי לפתוח את הפרוטוקול בדיוק במקום של הציטוט.</p>
      </div>
      <div class="landing-quote-grid">
        ${cardsMarkup}
      </div>
    </div>
  `;
}

function renderLandingPage() {
  renderLandingCategories();
  renderLandingNewsline();
  renderLandingSpotlight();
  renderKnowYourMkSection();
  renderLandingQuotes();

}

async function loadLandingPage() {
  state.landing.loading = true;
  state.landing.error = null;
  state.landing.visibleQuotes = [];
  syncLandingQuoteTimer();
  renderLandingPage();

  try {
    const { response, payload } = await fetchJson("/api/landing");

    if (!response.ok) {
      throw new Error(payload.error || "טעינת נתוני עמוד הפתיחה נכשלה");
    }

    state.landing.data = payload;
    rebuildLandingQuoteDeck();
    advanceLandingQuotes();
  } catch (error) {
    console.error(error);
    state.landing.error = error.message || String(error);
  } finally {
    state.landing.loading = false;
    renderLandingPage();
  }
}

async function loadLandingSpotlight() {
  state.landing.spotlight.loading = true;
  state.landing.spotlight.error = null;
  renderLandingSpotlight();

  try {
    const { response, payload } = await fetchJson("/api/landing/spotlight");

    if (!response.ok) {
      throw new Error(payload.error || "טעינת הספוטלייט נכשלה.");
    }

    state.landing.spotlight.data = payload;
  } catch (error) {
    console.error(error);
    state.landing.spotlight.error = error.message || String(error);
  } finally {
    state.landing.spotlight.loading = false;
    renderLandingSpotlight();
  }
}

async function loadKnowYourMk() {
  state.landing.knowYourMk.loading = true;
  state.landing.knowYourMk.error = null;
  renderKnowYourMkSection();

  try {
    const { response, payload } = await fetchJson("/api/landing/know-your-mk");

    if (!response.ok) {
      throw new Error(payload.error || "טעינת מפת חברי הכנסת נכשלה.");
    }

    state.landing.knowYourMk.data = normalizeKnowYourMkPayload(payload);
  } catch (error) {
    console.error(error);
    state.landing.knowYourMk.error = error.message || String(error);
  } finally {
    state.landing.knowYourMk.loading = false;
    renderKnowYourMkSection();
  }
}

function updateActionButtons() {
  const sourceState = getSourceState();
  const sourceConfig = getSourceConfig();
  const isLoading = Boolean(sourceState.loading);
  const hideUpdates = Boolean(sourceConfig.hideUpdates);
  const isLawRefreshRunning =
    state.activeSource === "laws" && sourceState.refreshStatus?.status === "running";
  const isLawAnalysisRunning =
    state.activeSource === "laws" && sourceState.analysisStatus?.status === "running";

  elements.refreshButton.disabled =
    isLoading || state.isCheckingUpdates || isLawRefreshRunning || isLawAnalysisRunning;
  elements.checkUpdatesButton.disabled =
    hideUpdates || isLoading || state.isCheckingUpdates || isLawRefreshRunning;
  if (elements.analyzeLawsButton) {
    elements.analyzeLawsButton.disabled =
      state.activeSource !== "laws" || isLoading || isLawRefreshRunning || isLawAnalysisRunning;
  }
  elements.checkUpdatesButton.textContent = state.isCheckingUpdates
    ? "בודק עדכונים..."
    : "בדוק עדכונים";
}

function setLoadingState(isLoading) {
  getSourceState().loading = isLoading;
  updateActionButtons();

  if (isLoading) {
    elements.resultsSummary.textContent = `טוען את ${getSourceConfig().label}...`;
  }
}

function sortText(values) {
  return values.sort((left, right) => left.localeCompare(right, "he"));
}

async function fetchSourceData(sourceKey, refresh = false) {
  const sourceState = getSourceState(sourceKey);
  const sourceConfig = getSourceConfig(sourceKey);

  if (sourceKey === state.activeSource) {
    setLoadingState(true);
  }

  try {
    const suffix = refresh ? "?refresh=1" : "";
    const { response, payload } = await fetchJson(`${sourceConfig.listEndpoint}${suffix}`);

    if (!response.ok && response.status !== 202) {
      throw new Error(payload.error || "Failed to load source data");
    }

    if (sourceKey === "data") {
      sourceState.comparisonData = payload.data || sourceState.comparisonData;
      sourceState.comparisonStatus = payload.status || null;
      sourceState.metadata = payload.metadata || null;
      sourceState.loaded = true;

      if (sourceKey === state.activeSource) {
        renderActiveSource();
      }

      syncDataStatusTimer();
      return;
    }

    sourceState.items = Array.isArray(payload.items) ? payload.items : [];
    sourceState.filteredItems = sourceState.items;
    sourceState.years = Array.isArray(payload.years) ? payload.years : [];
    sourceState.metadata = payload.metadata || null;
    sourceState.loaded = true;

    if (sourceKey === "committee") {
      sourceState.committeeTypes = sortText(
        Array.from(
          new Set(
            sourceState.items.map((item) => item.committeeTypeDescription).filter(Boolean),
          ),
        ),
      );
      sourceState.committeeNames = sortText(
        Array.from(
          new Set(sourceState.items.map((item) => item.committeeName).filter(Boolean)),
        ),
      );
    }

    if (sourceKey === state.activeSource) {
      renderActiveSource();
    }
  } catch (error) {
    console.error(error);

    if (sourceKey === state.activeSource) {
      elements.protocolList.innerHTML = `<p class="error-message">${escapeHtml(
        error.message || String(error),
      )}</p>`;
      elements.resultsSummary.textContent = "שגיאה בטעינת הרשימה";
    }
  } finally {
    if (sourceKey === state.activeSource) {
      setLoadingState(false);
    }
  }
}

async function ensureSourceLoaded(sourceKey, refresh = false) {
  const sourceState = getSourceState(sourceKey);

  if (sourceState.loaded && !refresh) {
    return;
  }

  await fetchSourceData(sourceKey, refresh);
}

async function fetchSurprisingLawData(refresh = false) {
  const sourceState = getSourceState("laws");

  if (sourceState.surprisingPromise) {
    return sourceState.surprisingPromise;
  }

  if (state.activeSource === "laws" && sourceState.lawListMode === "surprising") {
    setLoadingState(true);
  }

  sourceState.surprisingLoading = true;
  sourceState.surprisingPromise = (async () => {
    try {
      const suffix = refresh ? "?refresh=1" : "";
      const { response, payload } = await fetchJson(`/api/laws/surprising-votes${suffix}`);

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load surprising votes");
      }

      sourceState.surprisingItems = Array.isArray(payload.items) ? payload.items : [];
      sourceState.surprisingSummary = payload.summary || null;
      sourceState.surprisingMethodology = Array.isArray(payload.methodology)
        ? payload.methodology
        : [];
      sourceState.surprisingThreshold = payload.threshold || null;
      sourceState.surprisingLoaded = true;

      if (state.activeSource === "laws" && sourceState.lawListMode === "surprising") {
        renderActiveSource();
      }
    } catch (error) {
      if (state.activeSource === "laws" && sourceState.lawListMode === "surprising") {
        elements.protocolList.innerHTML = `<p class="error-message">${escapeHtml(
          error.message || String(error),
        )}</p>`;
        elements.resultsSummary.textContent = "שגיאה בטעינת ההצבעות המפתיעות";
      }

      throw error;
    } finally {
      sourceState.surprisingLoading = false;
      sourceState.surprisingPromise = null;

      if (state.activeSource === "laws" && sourceState.lawListMode === "surprising") {
        setLoadingState(false);
      }
    }
  })();

  return sourceState.surprisingPromise;
}

async function ensureSurprisingLawDataLoaded(refresh = false) {
  const sourceState = getSourceState("laws");

  if (sourceState.surprisingLoaded && !refresh) {
    return;
  }

  await fetchSurprisingLawData(refresh);
}

function populateYearSelect() {
  const sourceState = getSourceState();
  const currentValue = sourceState.filters.year;

  elements.yearSelect.innerHTML = [
    '<option value="">כל השנים</option>',
    ...sourceState.years.map((year) => `<option value="${year}">${year}</option>`),
  ].join("");
  elements.yearSelect.value = currentValue;
}

function populateCommitteeFilters() {
  const sourceState = getSourceState("committee");

  elements.committeeTypeSelect.innerHTML = [
    '<option value="">כל הסוגים</option>',
    ...sourceState.committeeTypes.map(
      (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
    ),
  ].join("");
  elements.committeeNameSelect.innerHTML = [
    '<option value="">כל הוועדות</option>',
    ...sourceState.committeeNames.map(
      (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
    ),
  ].join("");

  elements.committeeTypeSelect.value = sourceState.filters.committeeType;
  elements.committeeNameSelect.value = sourceState.filters.committeeName;
}

function renderMetadata() {
  const sourceState = getSourceState();

  if (state.activeSource === "data") {
    const protocolCount =
      sourceState.comparisonData?.overview?.protocolCount || sourceState.comparisonStatus?.totalProtocols || 0;
    elements.protocolCount.textContent = Number(protocolCount).toLocaleString("he-IL");
    elements.yearRange.textContent = `${sourceState.metadata?.sinceDate || "2022-01-01"} ואילך`;
    elements.syncDate.textContent = sourceState.comparisonData?.generatedAt
      ? formatIsoDate(sourceState.comparisonData.generatedAt)
      : sourceState.comparisonStatus?.startedAt
        ? `בבנייה מאז ${formatIsoDate(sourceState.comparisonStatus.startedAt)}`
        : "לא זמין";
    return;
  }

  const total = getActiveItems(sourceState).length;
  const minYear = sourceState.years[sourceState.years.length - 1];
  const maxYear = sourceState.years[0];

  elements.protocolCount.textContent = total.toLocaleString("he-IL");
  elements.yearRange.textContent =
    minYear && maxYear ? `${minYear} - ${maxYear}` : "לא זמין";
  elements.syncDate.textContent = sourceState.metadata?.syncedAt
    ? formatIsoDate(sourceState.metadata.syncedAt)
    : "לא זמין";
}

function renderSourceSwitch() {
  elements.sourceTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.source === state.activeSource);
  });
}

function renderSourceSpecificUi() {
  const sourceConfig = getSourceConfig();
  const sourceState = getSourceState();
  const showingSurprisingLaws = isShowingSurprisingLaws(sourceState);
  const searchField = elements.searchInput.closest(".field");
  const yearField = elements.yearSelect.closest(".field");
  const downloadDivider = elements.downloadHeading.previousElementSibling;
  const showUpdatesStatus = sourceConfig.key === "laws" || !sourceConfig.hideUpdates;

  elements.searchLabel.textContent = sourceConfig.searchLabel || "";
  elements.searchInput.placeholder = sourceConfig.searchPlaceholder || "";
  elements.searchInput.value = sourceState.filters.search;
  elements.refreshButton.textContent = sourceConfig.refreshButtonLabel || "רענון מטא-דאטה";
  elements.countLabel.textContent =
    showingSurprisingLaws
      ? "חוקים מפתיעים"
      : state.activeSource === "data"
        ? "פרוטוקולים"
      : sourceConfig.resultsLabel || "פריטים";
  elements.listEyebrow.textContent = sourceConfig.label;
  elements.listTitle.textContent = showingSurprisingLaws
    ? "חוקים עם הצבעות מפתיעות"
    : sourceConfig.listTitle;
  elements.sourceNote.textContent = showingSurprisingLaws
    ? sourceState.surprisingSummary
      ? `מציג רק חוקים שבהם נמצאה לפחות הצבעת בעד מפתיעה אחת. לפי הכלל הנוכחי נדרש פער של ${
          sourceState.surprisingThreshold || 7
        } נקודות או יותר באחד מארבעת הצירים. כרגע זוהו ${Number(
          sourceState.surprisingSummary.lawsWithSurprisingVotes || 0,
        ).toLocaleString("he-IL")} חוקים ו-${Number(
          sourceState.surprisingSummary.totalSurprisingVotes || 0,
        ).toLocaleString("he-IL")} הצבעות מפתיעות.`
      : "מציג רק חוקים שבהם נמצאה לפחות הצבעת בעד מפתיעה אחת, על בסיס ההשוואה בין ציוני החוק לבין ציוני הח״כים."
    : sourceConfig.key === "committee" && sourceState.metadata?.windowStartDate
      ? `מציג פרוטוקולי ועדות מתאריך ${sourceState.metadata.windowStartDate} ואילך.`
      : sourceConfig.sourceNote || "";

  elements.filtersHeading.textContent =
    sourceConfig.key === "data" ? "רענון המדדים" : "סינון וניווט";

  searchField.hidden = Boolean(sourceConfig.hideFilters);
  yearField.hidden = Boolean(sourceConfig.hideFilters);
  elements.committeeFilters.hidden = sourceConfig.key !== "committee";
  if (elements.lawsSubtabs) {
    elements.lawsSubtabs.hidden = sourceConfig.key !== "laws";
  }
  if (elements.lawsAllTab) {
    elements.lawsAllTab.classList.toggle("is-active", !showingSurprisingLaws);
  }
  if (elements.lawsSurprisingTab) {
    elements.lawsSurprisingTab.classList.toggle("is-active", showingSurprisingLaws);
  }
  elements.checkUpdatesButton.hidden = sourceConfig.key === "laws" || Boolean(sourceConfig.hideUpdates);
  elements.updatesStatus.hidden = !showUpdatesStatus;
  elements.lawAnalysisTools.hidden = sourceConfig.key !== "laws";
  elements.downloadHeading.hidden = Boolean(sourceConfig.hideDownloads);
  elements.downloadCopy.hidden = Boolean(sourceConfig.hideDownloads);
  elements.downloadAllButton.hidden = Boolean(sourceConfig.hideDownloads);
  elements.bulkStatus.hidden = Boolean(sourceConfig.hideDownloads);

  if (downloadDivider) {
    downloadDivider.hidden = Boolean(sourceConfig.hideDownloads);
  }

  if (!sourceConfig.hideDownloads) {
    elements.downloadAllButton.textContent = sourceConfig.downloadButtonLabel || "";
    elements.downloadCopy.textContent = sourceConfig.downloadCopy || "";
  }
}

function renderLawCard(item) {
  const downloadMeta = [item.hasOfficialPdf ? "PDF רשמי" : null, item.hasWordDocument ? "Word" : null]
    .filter(Boolean)
    .join(" � ");
  const surprisingMembers =
    Array.isArray(item.topSurprisingMembers) && item.topSurprisingMembers.length
      ? item.topSurprisingMembers.map((member) => member.memberName).join(", ")
      : "";
  const surprisingMeta = item.surprisingVoteCount
    ? `
      <span class="protocol-card__meta law-card__highlight">
        הצבעות מפתיעות: ${Number(item.surprisingVoteCount).toLocaleString("he-IL")} � פער מרבי: ${Number(
          item.maximumDifference || 0,
        ).toLocaleString("he-IL")} � ${escapeHtml(surprisingMembers || "ללא פירוט")}
      </span>
    `
    : "";

  return `
    <a class="protocol-card law-card" href="${getSourceConfig().readerUrl(item.billId)}">
      <span class="protocol-card__tag">התקבלה בקריאה שלישית</span>
      <strong class="protocol-card__title">${escapeHtml(item.title)}</strong>
      <span class="protocol-card__date">${escapeHtml(item.shortDateLabel)}</span>
      <span class="protocol-card__meta">
        חוק ${escapeHtml(item.lawId || item.billId)} � ${escapeHtml(
          item.publicationSeriesDesc || "ספר החוקים",
        )}
      </span>
      ${surprisingMeta}
      <span class="protocol-card__meta">${escapeHtml(downloadMeta || "פרטי קובץ לא זמינים")}</span>
    </a>
  `;
}

function renderProtocolCard(item) {
  if (state.activeSource === "laws") {
    return renderLawCard(item);
  }

  if (state.activeSource === "committee") {
    return `
      <a class="protocol-card" href="${getSourceConfig().readerUrl(item.documentId)}">
        <span class="protocol-card__date">${escapeHtml(item.shortDateLabel)}</span>
        <span class="protocol-card__tag">${escapeHtml(item.committeeTypeDescription)}</span>
        <span class="protocol-card__meta">${escapeHtml(item.committeeName)}</span>
        <span class="protocol-card__meta">
          ${item.timeLabel ? `??? ?????: ${escapeHtml(item.timeLabel)} ? ` : ""}????? ${escapeHtml(
            item.sessionNumber ?? "-",
          )}
        </span>
      </a>
    `;
  }

  return `
    <a class="protocol-card" href="${getSourceConfig().readerUrl(item.documentId)}">
      <span class="protocol-card__date">${escapeHtml(item.shortDateLabel)}</span>
      <span class="protocol-card__meta">
        ${item.timeLabel ? `??? ?????: ${escapeHtml(item.timeLabel)}` : "??? ????? ?? ?????"}
      </span>
      <span class="protocol-card__meta">
        ????? ${escapeHtml(item.sessionNumber ?? "-")} ? ???? ${escapeHtml(item.knessetNumber ?? "-")}
      </span>
    </a>
  `;
}

function renderSourceUpdateGroup(sourceKey, sourceStatus) {
  const sourceConfig = getSourceConfig(sourceKey);

  if (!sourceStatus) {
    return "";
  }

  if (sourceStatus.status === "error") {
    return `
      <article class="updates-group">
        <div class="updates-group__header">
          <h3>${escapeHtml(sourceConfig.label)}</h3>
          <span class="status-chip">שגיאה</span>
        </div>
        <p class="error-message">${escapeHtml(sourceStatus.error || "Update check failed")}</p>
      </article>
    `;
  }

  const detailParts = [
    `${Number(sourceStatus.addedCount || 0).toLocaleString("he-IL")} חדשים`,
    `${Number(sourceStatus.total || 0).toLocaleString("he-IL")} בסך הכול`,
  ];

  if (sourceKey === "committee" && sourceStatus.windowStartDate) {
    detailParts.push(`מתאריך ${escapeHtml(sourceStatus.windowStartDate)} ואילך`);
  }

  const itemsMarkup =
    sourceStatus.addedItems && sourceStatus.addedItems.length
      ? `
        <ul class="updates-list">
          ${sourceStatus.addedItems
            .map(
              (item) => `
                <li>
                  <a href="${getSourceConfig(sourceKey).readerUrl(item.documentId)}">
                    ${escapeHtml(item.label)}
                  </a>
                </li>
              `,
            )
            .join("")}
        </ul>
      `
      : `<p class="muted">לא נוספו פרוטוקולים חדשים במקור הזה.</p>`;

  return `
    <article class="updates-group">
      <div class="updates-group__header">
        <h3>${escapeHtml(sourceConfig.label)}</h3>
        <span class="updates-count">${Number(sourceStatus.addedCount || 0).toLocaleString("he-IL")}</span>
      </div>
      <p class="muted">${detailParts.join(" � ")}</p>
      ${itemsMarkup}
    </article>
  `;
}

function renderLawRefreshStatus() {
  const refreshStatus = getSourceState("laws").refreshStatus;
  elements.updatesStatus.className = "updates-status";

  if (!refreshStatus || refreshStatus.status === "idle") {
    elements.updatesStatus.innerHTML =
      '<p class="muted">לחצו על כפתור הרענון כדי למשוך מחדש את החוקים בקריאה שלישית ואת נתוני ההצבעה שלהם.</p>';
    return;
  }

  if (refreshStatus.status === "running") {
    elements.updatesStatus.classList.add("is-running");
    elements.updatesStatus.innerHTML = `
      <p class="eyebrow">Law Refresh</p>
      <p>${Number(refreshStatus.processedLaws || 0).toLocaleString("he-IL")} / ${Number(
        refreshStatus.totalLaws || 0,
      ).toLocaleString("he-IL")} חוקים עובדו</p>
      <p>הצבעות שנמצאו: ${Number(refreshStatus.matchedLaws || 0).toLocaleString(
        "he-IL",
      )} � ללא התאמה: ${Number(refreshStatus.unmatchedLaws || 0).toLocaleString(
        "he-IL",
      )} � שגיאות: ${Number(refreshStatus.failedLaws || 0).toLocaleString("he-IL")}</p>
      ${
        refreshStatus.current
          ? `<p>מעבד כעת: <strong>${escapeHtml(refreshStatus.current.title || "")}</strong></p>`
          : ""
      }
    `;
    return;
  }

  if (refreshStatus.status === "failed") {
    elements.updatesStatus.classList.add("is-error");
    elements.updatesStatus.innerHTML = `
      <p class="eyebrow">Law Refresh</p>
      <p class="error-message">${
        refreshStatus.recentErrors?.[0]
          ? escapeHtml(refreshStatus.recentErrors[0])
          : "רענון החוקים וההצבעות נכשל."
      }</p>
    `;
    return;
  }

  const hasMatches = Number(refreshStatus.matchedLaws || 0) > 0;
  elements.updatesStatus.classList.add(hasMatches ? "is-success" : "is-neutral");
  elements.updatesStatus.innerHTML = `
    <p class="eyebrow">Law Refresh</p>
    <p>עודכן לאחרונה: <strong>${escapeHtml(formatIsoDate(refreshStatus.lastCompletedAt || refreshStatus.finishedAt))}</strong></p>
    <p>עובדו ${Number(refreshStatus.totalLaws || 0).toLocaleString("he-IL")} חוקים � נמצאו ${Number(
      refreshStatus.matchedLaws || 0,
    ).toLocaleString("he-IL")} הצבעות � ללא התאמה ${Number(
      refreshStatus.unmatchedLaws || 0,
    ).toLocaleString("he-IL")}</p>
  `;
}

function renderLawAnalysisStatus() {
  const analysisStatus = getSourceState("laws").analysisStatus;
  elements.lawAnalysisStatus.className = "updates-status";

  if (!analysisStatus || analysisStatus.status === "idle") {
    elements.lawAnalysisStatus.innerHTML =
      '<p class="muted">לחצו על כפתור הניתוח כדי להריץ ניתוח Gemini עבור כל החוקים שעדיין לא נותחו.</p>';
    return;
  }

  if (analysisStatus.status === "running") {
    elements.lawAnalysisStatus.classList.add("is-running");
    elements.lawAnalysisStatus.innerHTML = `
      <p class="eyebrow">Law Analysis</p>
      <p>${Number(analysisStatus.processedLaws || 0).toLocaleString("he-IL")} / ${Number(
        analysisStatus.totalLaws || 0,
      ).toLocaleString("he-IL")} חוקים נבדקו</p>
      <p>נותחו: ${Number(analysisStatus.generatedLaws || 0).toLocaleString(
        "he-IL",
      )} � דולגו: ${Number(analysisStatus.skippedLaws || 0).toLocaleString(
        "he-IL",
      )} � שגיאות: ${Number(analysisStatus.failedLaws || 0).toLocaleString("he-IL")}</p>
      ${
        analysisStatus.current
          ? `<p>מנתח כעת: <strong>${escapeHtml(analysisStatus.current.title || "")}</strong></p>`
          : ""
      }
    `;
    return;
  }

  if (analysisStatus.status === "failed") {
    elements.lawAnalysisStatus.classList.add("is-error");
    elements.lawAnalysisStatus.innerHTML = `
      <p class="eyebrow">Law Analysis</p>
      <p class="error-message">${
        analysisStatus.recentErrors?.[0]
          ? escapeHtml(analysisStatus.recentErrors[0])
          : "ניתוח החוקים נכשל."
      }</p>
    `;
    return;
  }

  if (analysisStatus.status === "nothing_to_do") {
    elements.lawAnalysisStatus.classList.add("is-success");
    elements.lawAnalysisStatus.innerHTML = `
      <p class="eyebrow">Law Analysis</p>
      <p class="muted">${escapeHtml(
        analysisStatus.message || "No new third-reading laws without axes profiles were found.",
      )}</p>
    `;
    return;
  }

  elements.lawAnalysisStatus.classList.add(
    Number(analysisStatus.failedLaws || 0) > 0 ? "is-neutral" : "is-success",
  );
  elements.lawAnalysisStatus.innerHTML = `
    <p class="eyebrow">Law Analysis</p>
    <p>עודכן לאחרונה: <strong>${escapeHtml(
      formatIsoDate(analysisStatus.lastCompletedAt || analysisStatus.finishedAt),
    )}</strong></p>
    <p>נותחו ${Number(analysisStatus.generatedLaws || 0).toLocaleString(
      "he-IL",
    )} חוקים חדשים � דולגו ${Number(analysisStatus.skippedLaws || 0).toLocaleString(
      "he-IL",
    )} חוקים כבר מנותחים</p>
    ${
      Number(analysisStatus.failedLaws || 0) > 0
        ? `<p class="muted">שגיאות: ${Number(analysisStatus.failedLaws || 0).toLocaleString(
            "he-IL",
          )}</p>`
        : ""
    }
  `;
}

function renderUpdateStatus() {
  if (state.activeSource === "laws") {
    renderLawRefreshStatus();
    return;
  }

  const updateCheck = state.updateCheck;
  elements.updatesStatus.className = "updates-status";

  if (!updateCheck || updateCheck.status === "idle") {
    elements.updatesStatus.innerHTML =
      '<p class="muted">המערכת עדיין לא בדקה אם פורסמו פרוטוקולים חדשים.</p>';
    return;
  }

  if (updateCheck.status === "running") {
    elements.updatesStatus.classList.add("is-running");
    elements.updatesStatus.innerHTML = `
      <p class="eyebrow">Update Check</p>
      <p>בודק עכשיו אם נוספו פרוטוקולים חדשים למליאה או לוועדות...</p>
    `;
    return;
  }

  if (updateCheck.status === "error") {
    elements.updatesStatus.classList.add("is-error");
    elements.updatesStatus.innerHTML = `
      <p class="eyebrow">Update Check</p>
      <p class="error-message">${escapeHtml(updateCheck.error || "בדיקת העדכונים נכשלה.")}</p>
    `;
    return;
  }

  const statusClass = updateCheck.totalAdded > 0 ? "is-success" : "is-neutral";
  elements.updatesStatus.classList.add(statusClass);
  elements.updatesStatus.innerHTML = `
    <p class="eyebrow">Update Check</p>
    <p>נבדק לאחרונה: <strong>${escapeHtml(formatIsoDate(updateCheck.checkedAt))}</strong></p>
    <p>נוספו ${Number(updateCheck.totalAdded || 0).toLocaleString("he-IL")} פרוטוקולים חדשים בסך הכול.</p>
    ${updateCheck.hasErrors ? '<p class="error-message">חלק מהמקורות החזירו שגיאה.</p>' : ""}
    <div class="updates-groups">
      ${renderSourceUpdateGroup("plenum", updateCheck.sources?.plenum)}
      ${renderSourceUpdateGroup("committee", updateCheck.sources?.committee)}
    </div>
  `;
}

function renderBulkStatus() {
  const sourceConfig = getSourceConfig();

  if (!sourceConfig.downloadStatusEndpoint) {
    elements.bulkStatus.innerHTML = "";
    elements.downloadAllButton.disabled = false;
    return;
  }

  const status = getSourceState().bulkStatus;

  if (!status || status.status === "idle") {
    elements.bulkStatus.innerHTML =
      '<p class="muted">עדיין לא הופעלה הורדה מלאה עבור המקור הנוכחי.</p>';
    elements.downloadAllButton.disabled = false;
    return;
  }

  const percent =
    status.total > 0 ? Math.min(100, Math.round((status.processed / status.total) * 100)) : 0;
  const currentLine = status.current
    ? `<p>מעבד עכשיו: <strong>${escapeHtml(status.current.dateLabel)}</strong></p>`
    : "";
  const errors = status.recentErrors.length
    ? `<p class="error-message">שגיאות אחרונות: ${escapeHtml(status.recentErrors.join(" | "))}</p>`
    : "";

  elements.bulkStatus.innerHTML = `
    <p><span class="status-chip">${escapeHtml(status.status)}</span></p>
    <p>${status.processed.toLocaleString("he-IL")} / ${status.total.toLocaleString("he-IL")} קבצים</p>
    <p>נשמרו: ${status.saved.toLocaleString("he-IL")} � דולגו: ${status.skipped.toLocaleString(
      "he-IL",
    )} � נכשלו: ${status.failed.toLocaleString("he-IL")}</p>
    <p>תיקיית יעד: <strong>${escapeHtml(status.downloadDir)}</strong></p>
    ${currentLine}
    <div class="progress-bar"><span style="width: ${percent}%"></span></div>
    ${errors}
  `;

  elements.downloadAllButton.disabled = status.status === "running";
}

async function refreshBulkStatus(sourceKey = state.activeSource) {
  const sourceConfig = getSourceConfig(sourceKey);

  if (!sourceConfig.downloadStatusEndpoint) {
    if (bulkStatusTimer) {
      window.clearInterval(bulkStatusTimer);
      bulkStatusTimer = null;
    }
    return;
  }

  try {
    const { payload } = await fetchJson(sourceConfig.downloadStatusEndpoint);
    getSourceState(sourceKey).bulkStatus = payload;

    if (sourceKey === state.activeSource) {
      renderBulkStatus();
    }

    if (payload.status === "running" && sourceKey === state.activeSource) {
      if (!bulkStatusTimer) {
        bulkStatusTimer = window.setInterval(() => {
          void refreshBulkStatus(state.activeSource);
        }, 2500);
      }
    } else if (sourceKey === state.activeSource && bulkStatusTimer) {
      window.clearInterval(bulkStatusTimer);
      bulkStatusTimer = null;
    }
  } catch (error) {
    console.error(error);
  }
}

function syncLawRefreshTimer() {
  const refreshStatus = getSourceState("laws").refreshStatus;
  const shouldPoll = state.activeSource === "laws" && refreshStatus?.status === "running";

  if (shouldPoll) {
    if (!lawRefreshTimer) {
      lawRefreshTimer = window.setInterval(() => {
        void refreshLawSyncStatus();
      }, 3000);
    }
    return;
  }

  if (lawRefreshTimer) {
    window.clearInterval(lawRefreshTimer);
    lawRefreshTimer = null;
  }
}

function syncLawAnalysisTimer() {
  const analysisStatus = getSourceState("laws").analysisStatus;
  const shouldPoll =
    analysisStatus?.status === "running" &&
    (state.activeSource === "laws" || isAdminUser());

  if (shouldPoll) {
    if (!lawAnalysisTimer) {
      lawAnalysisTimer = window.setInterval(() => {
        void refreshLawAnalysisStatus();
      }, 3000);
    }
    return;
  }

  if (lawAnalysisTimer) {
    window.clearInterval(lawAnalysisTimer);
    lawAnalysisTimer = null;
  }
}

async function refreshLawSyncStatus() {
  try {
    const previousStatus = getSourceState("laws").refreshStatus?.status;
    const { payload } = await fetchJson("/api/laws/refresh-status");
    getSourceState("laws").refreshStatus = payload;

    if (previousStatus === "running" && payload.status === "completed") {
      invalidateSurprisingLawData();
      await fetchSourceData("laws", true);

      if (isShowingSurprisingLaws(getSourceState("laws"))) {
        await ensureSurprisingLawDataLoaded(true);
      }
    }

    if (state.activeSource === "laws") {
      renderUpdateStatus();
      updateActionButtons();
    }

    syncLawRefreshTimer();
  } catch (error) {
    console.error(error);
  }
}

async function refreshLawAnalysisStatus() {
  try {
    const previousStatus = getSourceState("laws").analysisStatus?.status;
    const { payload } = await fetchJson("/api/laws/analysis/status");
    getSourceState("laws").analysisStatus = payload;

    if (previousStatus === "running" && payload.status === "completed") {
      invalidateSurprisingLawData();

      if (isShowingSurprisingLaws(getSourceState("laws"))) {
        await ensureSurprisingLawDataLoaded(true);
      }
    }

    if (state.activeSource === "laws") {
      renderLawAnalysisStatus();
      updateActionButtons();
    }

    renderAdminMissingLawAnalysisPanel();
    renderAdminLawAnalysisRebuildPanel();
    syncLawAnalysisTimer();
    syncAdminMissingLawAnalysisPolling();
    syncAdminLawAnalysisRebuildPolling();
  } catch (error) {
    console.error(error);
  }
}

async function startBulkDownload() {
  const sourceConfig = getSourceConfig();

  if (!sourceConfig.downloadEndpoint) {
    return;
  }

  elements.downloadAllButton.disabled = true;

  try {
    const { response, payload } = await fetchJson(sourceConfig.downloadEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(payload.error || "Bulk download failed to start");
    }

    getSourceState().bulkStatus = payload;
    renderBulkStatus();
    await refreshBulkStatus(state.activeSource);
  } catch (error) {
    elements.bulkStatus.innerHTML = `<p class="error-message">${escapeHtml(
      error.message || String(error),
    )}</p>`;
    elements.downloadAllButton.disabled = false;
  }
}

async function startLawRefresh() {
  elements.refreshButton.disabled = true;

  try {
    const { response, payload } = await fetchJson("/api/laws/refresh-all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(payload.error || "Failed to start the laws refresh");
    }

    invalidateSurprisingLawData();
    getSourceState("laws").refreshStatus = payload;
    renderUpdateStatus();
    updateActionButtons();
    syncLawRefreshTimer();
    await refreshLawSyncStatus();
  } catch (error) {
    getSourceState("laws").refreshStatus = {
      status: "failed",
      recentErrors: [error.message || String(error)],
    };
    renderUpdateStatus();
    updateActionButtons();
  }
}

async function startLawAnalysis() {
  if (state.activeSource !== "laws") {
    return;
  }

  elements.analyzeLawsButton.disabled = true;

  try {
    const { response, payload } = await fetchJson("/api/laws/analysis/bulk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(payload.error || "Failed to start the law analysis");
    }

    invalidateSurprisingLawData();
    getSourceState("laws").analysisStatus = payload;
    renderLawAnalysisStatus();
    updateActionButtons();
    syncLawAnalysisTimer();
    await refreshLawAnalysisStatus();
  } catch (error) {
    getSourceState("laws").analysisStatus = {
      status: "failed",
      recentErrors: [error.message || String(error)],
    };
    renderLawAnalysisStatus();
    updateActionButtons();
  }
}

async function refreshAllSources() {
  for (const sourceKey of ["plenum", "committee"]) {
    await fetchSourceData(sourceKey);
  }

  renderActiveSource();

  if (!getSourceConfig().hideDownloads) {
    await refreshBulkStatus(state.activeSource);
  }
}

async function checkForUpdates() {
  if (state.isCheckingUpdates || getSourceConfig().hideUpdates) {
    return;
  }

  state.isCheckingUpdates = true;
  state.updateCheck = {
    status: "running",
    checkedAt: new Date().toISOString(),
  };
  updateActionButtons();
  renderUpdateStatus();

  try {
    const { response, payload } = await fetchJson("/api/check-updates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(payload.error || "Update check failed");
    }

    state.updateCheck = {
      status: "done",
      ...payload,
    };

    await refreshAllSources();
    renderUpdateStatus();
  } catch (error) {
    console.error(error);
    state.updateCheck = {
      status: "error",
      checkedAt: new Date().toISOString(),
      error: error.message || String(error),
    };
    renderUpdateStatus();
  } finally {
    state.isCheckingUpdates = false;
    updateActionButtons();
  }
}

function getDataStatusPanelMarkup(status) {
  if (!status || status.status === "idle") {
    return `
      <div class="data-status-card">
        <p class="eyebrow">Data</p>
        <h3>ההשוואות עוד לא מוכנות</h3>
        <p class="muted">לחצו על "רענן מדדים" כדי להתחיל לחשב את ההשוואות המבוססות על ציטוטי חברי הכנסת.</p>
      </div>
    `;
  }

  if (status.status === "failed") {
    return `
      <div class="data-status-card is-error">
        <p class="eyebrow">Data</p>
        <h3>חישוב המדדים נכשל</h3>
        <p class="error-message">${escapeHtml((status.recentErrors || [])[0] || "אירעה שגיאה לא צפויה.")}</p>
      </div>
    `;
  }

  const isRunning = status.status === "running" || status.status === "waiting_for_member_index";
  const currentLabel = status.current
    ? `${escapeHtml(status.current.title || "")} � ${escapeHtml(status.current.shortDateLabel || "")}`
    : "מכין את החומר";

  return `
    <div class="data-status-card ${isRunning ? "is-running" : "is-success"}">
      <p class="eyebrow">Data</p>
      <h3>${isRunning ? "ההשוואות נבנות עכשיו" : "ההשוואות מעודכנות"}</h3>
      <p class="muted">
        ${
          isRunning
            ? `${Number(status.processedProtocols || 0).toLocaleString("he-IL")} מתוך ${Number(
                status.totalProtocols || 0,
              ).toLocaleString("he-IL")} פרוטוקולים עובדו`
            : `עודכן לאחרונה: ${escapeHtml(formatIsoDate(status.finishedAt || status.lastCompletedAt))}`
        }
      </p>
      ${isRunning ? `<p class="muted">מעבד כעת: ${currentLabel}</p>` : ""}
    </div>
  `;
}

function renderTopTerms(topTerms) {
  if (!Array.isArray(topTerms) || !topTerms.length) {
    return '<span class="muted">ללא מונחי מפתח בולטים</span>';
  }

  return topTerms
    .map(
      (item) =>
        `<span class="comparison-term-pill">${escapeHtml(item.term)} � ${Number(item.count).toLocaleString("he-IL")}</span>`,
    )
    .join("");
}

function renderMemberComparisonRows(memberRows, scaleLabel) {
  const eligibleRows = memberRows.filter(
    (row) => row.eligible && typeof row.ratePerThousandWords === "number",
  );
  const maxScore = eligibleRows.length
    ? Math.max(...eligibleRows.map((row) => row.ratePerThousandWords))
    : 1;

  return `
    <div class="comparison-member-chart">
      ${memberRows
        .map((row) => {
          const score = typeof row.ratePerThousandWords === "number" ? row.ratePerThousandWords : 0;
          const width = maxScore > 0 ? Math.max(2, (score / maxScore) * 100) : 0;

          return `
            <article class="comparison-member-row ${row.eligible ? "" : "is-muted"}">
              <div class="comparison-member-row__meta">
                <a href="/members/${encodeURIComponent(row.routeSlug)}"><strong>${escapeHtml(row.name)}</strong></a>
                <span>${escapeHtml(row.partyName)}</span>
              </div>
              <div class="comparison-member-row__bar">
                <span style="width: ${row.eligible ? width : 0}%"></span>
              </div>
              <div class="comparison-member-row__score">
                ${
                  row.eligible
                    ? `${score.toFixed(2)}`
                    : `<span class="muted">פחות מ-${Number(
                        state.sources.data.metadata?.minimumMemberWords || 200,
                      ).toLocaleString("he-IL")} מילים</span>`
                }
              </div>
              <div class="comparison-member-row__details">
                <span>${Number(row.totalWords || 0).toLocaleString("he-IL")} מילים</span>
                <span>${Number(row.protocolCount || 0).toLocaleString("he-IL")} פרוטוקולים</span>
                <span>${Number(row.rawHits || 0).toLocaleString("he-IL")} אזכורים</span>
              </div>
              <div class="comparison-member-row__terms">
                ${renderTopTerms(row.topTerms)}
              </div>
            </article>
          `;
        })
        .join("")}
      <p class="muted comparison-scale-note">${escapeHtml(scaleLabel)}</p>
    </div>
  `;
}

function renderPartyComparisonRows(partyRows) {
  return `
    <div class="comparison-party-grid">
      ${partyRows
        .map(
          (party) => `
            <article class="comparison-party-card ${party.averageRatePerThousandWords !== null ? "" : "is-muted"}">
              <h4>${escapeHtml(party.partyName)}</h4>
              <p class="comparison-party-card__score">
                ${
                  party.averageRatePerThousandWords !== null
                    ? `${party.averageRatePerThousandWords.toFixed(2)}`
                    : "לא מספיק נתונים"
                }
              </p>
              <p class="muted">חברי כנסת שנכללו: ${Number(party.eligibleMembers || 0).toLocaleString("he-IL")} מתוך ${Number(
                party.memberCount || 0,
              ).toLocaleString("he-IL")}</p>
              ${
                party.topMember
                  ? `<p class="muted">בולט/ת במפלגה: <a href="/members/${encodeURIComponent(
                      party.topMember.routeSlug,
                    )}">${escapeHtml(party.topMember.name)}</a></p>`
                  : ""
              }
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderComparisonCard(comparison) {
  return `
    <article class="comparison-card">
      <div class="comparison-card__header">
        <div>
          <p class="eyebrow">Comparison</p>
          <h3>${escapeHtml(comparison.title)}</h3>
          <p class="muted">${escapeHtml(comparison.shortDescription)}</p>
        </div>
        <div class="comparison-highlight-stack">
          <div class="comparison-highlight">
            <span class="comparison-highlight__label">חבר הכנסת המוביל</span>
            <strong>${
              comparison.topMember
                ? `${escapeHtml(comparison.topMember.name)} � ${comparison.topMember.ratePerThousandWords.toFixed(2)}`
                : "אין מספיק נתונים"
            }</strong>
          </div>
          <div class="comparison-highlight">
            <span class="comparison-highlight__label">המפלגה המובילה</span>
            <strong>${
              comparison.topParty && comparison.topParty.averageRatePerThousandWords !== null
                ? `${escapeHtml(comparison.topParty.partyName)} � ${comparison.topParty.averageRatePerThousandWords.toFixed(2)}`
                : "אין מספיק נתונים"
            }</strong>
          </div>
        </div>
      </div>

      <div class="comparison-methodology">
        <h4>מתודולוגיה</h4>
        <ul>
          ${comparison.methodology.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
        <p class="muted">מילון המונחים: ${comparison.terms.map((term) => escapeHtml(term)).join(" � ")}</p>
      </div>

      <section class="comparison-section">
        <div class="comparison-section__header">
          <h4>דירוג חברי הכנסת</h4>
          <p class="muted">כל השורות מוצגות. שורות אפורות מסמנות שאין מספיק מילים מדוברות לחישוב יציב.</p>
        </div>
        ${renderMemberComparisonRows(comparison.memberRows, comparison.scaleLabel)}
      </section>

      <section class="comparison-section">
        <div class="comparison-section__header">
          <h4>דירוג המפלגות</h4>
          <p class="muted">המפלגות מדורגות לפי ממוצע הציונים של חברי הכנסת הזכאים בכל מפלגה.</p>
        </div>
        ${renderPartyComparisonRows(comparison.partyRows)}
      </section>
    </article>
  `;
}

function syncDataStatusTimer() {
  const status = getSourceState("data").comparisonStatus;
  const shouldPoll =
    state.activeSource === "data" &&
    (status?.status === "running" || status?.status === "waiting_for_member_index");

  if (shouldPoll) {
    if (!dataStatusTimer) {
      dataStatusTimer = window.setInterval(() => {
        void fetchSourceData("data");
      }, 5000);
    }
    return;
  }

  if (dataStatusTimer) {
    window.clearInterval(dataStatusTimer);
    dataStatusTimer = null;
  }
}

function renderDataComparisons() {
  const sourceState = getSourceState("data");
  const data = sourceState.comparisonData;
  const status = sourceState.comparisonStatus;

  elements.loadMoreButton.hidden = true;

  if (!data) {
    elements.protocolList.innerHTML = getDataStatusPanelMarkup(status);
    elements.resultsSummary.textContent =
      status?.status === "running" || status?.status === "waiting_for_member_index"
        ? `מעבד ${Number(status?.processedProtocols || 0).toLocaleString("he-IL")} מתוך ${Number(
            status?.totalProtocols || 0,
          ).toLocaleString("he-IL")} פרוטוקולים`
        : "ההשוואות עדיין לא זמינות";
    return;
  }

  const statusMarkup =
    status && (status.status === "running" || status.status === "waiting_for_member_index")
      ? getDataStatusPanelMarkup(status)
      : "";

  elements.protocolList.innerHTML = `
    <section class="comparison-shell">
      ${statusMarkup}
      <article class="comparison-overview-card">
        <div>
          <p class="eyebrow">Overview</p>
          <h3>השוואות קשיחות בין חברי הכנסת</h3>
          <p class="muted">
            החישוב משתמש רק בפרוטוקולים מ-${escapeHtml(data.sinceDate)} ואילך, רק בדיבור שזוהה בפועל של חברי הכנסת, ורק במילונים קשיחים שמוגדרים בקוד.
          </p>
        </div>
        <div class="comparison-overview-stats">
          <span>${Number(data.overview.protocolCount || 0).toLocaleString("he-IL")} פרוטוקולים</span>
          <span>${Number(data.overview.memberCount || 0).toLocaleString("he-IL")} חברי כנסת</span>
          <span>${Number(data.overview.eligibleMemberCount || 0).toLocaleString("he-IL")} עם מספיק נתונים</span>
        </div>
      </article>
      ${data.comparisons.map(renderComparisonCard).join("")}
    </section>
  `;

  elements.resultsSummary.textContent = `מוצגות ${Number(data.comparisons.length || 0).toLocaleString(
    "he-IL",
  )} השוואות על בסיס ${Number(data.overview.protocolCount || 0).toLocaleString("he-IL")} פרוטוקולים`;
}

function applyFilters() {
  const sourceState = getSourceState();

  if (state.activeSource === "data") {
    renderDataComparisons();
    return;
  }

  const normalizedSearch = normalizeSearchText(sourceState.filters.search);
  const { year, committeeType, committeeName } = sourceState.filters;

  const baseItems = getActiveItems(sourceState);

  sourceState.filteredItems = baseItems.filter((item) => {
    const matchesYear = !year || String(item.year) === year;
    const matchesSearch = !normalizedSearch || item.searchText.includes(normalizedSearch);
    const matchesCommitteeType =
      state.activeSource !== "committee" ||
      !committeeType ||
      item.committeeTypeDescription === committeeType;
    const matchesCommitteeName =
      state.activeSource !== "committee" ||
      !committeeName ||
      item.committeeName === committeeName;

    return matchesYear && matchesSearch && matchesCommitteeType && matchesCommitteeName;
  });

  renderProtocolList();
}

function renderProtocolList() {
  if (state.activeSource === "data") {
    renderDataComparisons();
    return;
  }

  const sourceState = getSourceState();
  const visibleItems = sourceState.filteredItems.slice(0, state.visibleCount);
  const emptyMessage = isShowingSurprisingLaws(sourceState)
    ? "לא נמצאו חוקים עם הצבעות מפתיעות שמתאימים למסננים שבחרתם."
    : getSourceConfig().emptyMessage || "לא נמצאו תוצאות.";

  if (!visibleItems.length) {
    elements.protocolList.innerHTML = `<p class="muted">${escapeHtml(emptyMessage)}</p>`;
  } else {
    elements.protocolList.innerHTML = visibleItems.map(renderProtocolCard).join("");
  }

  elements.resultsSummary.textContent = isShowingSurprisingLaws(sourceState)
    ? `מציג ${visibleItems.length.toLocaleString("he-IL")} מתוך ${sourceState.filteredItems.length.toLocaleString("he-IL")} חוקים עם הצבעות מפתיעות`
    : `מציג ${visibleItems.length.toLocaleString("he-IL")} מתוך ${sourceState.filteredItems.length.toLocaleString("he-IL")} ${getSourceConfig().resultsLabel || "פריטים"}`;
  elements.loadMoreButton.hidden = state.visibleCount >= sourceState.filteredItems.length;
}

function renderActiveSource() {
  renderSourceSwitch();
  renderSourceSpecificUi();
  renderMetadata();
  populateYearSelect();

  if (state.activeSource === "committee") {
    populateCommitteeFilters();
  }

  if (state.activeSource === "data") {
    renderDataComparisons();
  } else {
    applyFilters();
  }

  renderBulkStatus();
  renderUpdateStatus();
  renderLawAnalysisStatus();
  renderAdminProtocolUpdatePanel();
  renderAdminLawUpdatePanel();
  renderAdminMissingLawAnalysisPanel();
  renderAdminSurprisingVoteExplanationPanel();
  renderAdminLawAnalysisRebuildPanel();
  renderAdminSmallQuotesRebuildPanel();
  updateActionButtons();
  syncDataStatusTimer();
  syncLawRefreshTimer();
  syncLawAnalysisTimer();
}

function getRequestedExplorerRoute() {
  const searchParams = new URLSearchParams(window.location.search);
  const requestedSource = searchParams.get("source");
  const sourceKey = SOURCE_CONFIG[requestedSource] ? requestedSource : "plenum";
  const lawListMode =
    sourceKey === "laws" && searchParams.get("lawListMode") === "surprising"
      ? "surprising"
      : "all";

  return {
    sourceKey,
    lawListMode,
  };
}

function updateExplorerUrlState() {
  if (window.location.pathname !== "/") {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("source", state.activeSource);

  if (state.activeSource === "laws" && getSourceState("laws").lawListMode === "surprising") {
    url.searchParams.set("lawListMode", "surprising");
  } else {
    url.searchParams.delete("lawListMode");
  }

  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

async function switchSource(sourceKey) {
  if (state.activeSource === sourceKey) {
    return;
  }

  state.activeSource = sourceKey;
  state.visibleCount = 180;
  renderActiveSource();
  await ensureSourceLoaded(sourceKey);
  if (sourceKey === "laws") {
    if (getSourceState("laws").lawListMode === "surprising") {
      try {
        await ensureSurprisingLawDataLoaded();
      } catch (error) {
        console.error(error);
      }
    }
    await refreshLawSyncStatus();
    await refreshLawAnalysisStatus();
  }
  await refreshBulkStatus(sourceKey);
  renderActiveSource();
  updateExplorerUrlState();
}

async function switchLawListMode(mode) {
  const sourceState = getSourceState("laws");

  if (sourceState.lawListMode === mode) {
    return;
  }

  sourceState.lawListMode = mode;
  state.visibleCount = 180;
  renderActiveSource();

  if (mode === "surprising") {
    try {
      await ensureSourceLoaded("laws");
      await ensureSurprisingLawDataLoaded();
    } catch (error) {
      console.error(error);
      return;
    }
  }

  renderActiveSource();
  updateExplorerUrlState();
}

elements.sourceTabs.forEach((button) => {
  button.addEventListener("click", async () => {
    await switchSource(button.dataset.source);
  });
});

document.addEventListener("click", (event) => {
  const spotlightCard = event.target.closest("[data-spotlight-member-href]");

  if (spotlightCard) {
    if (event.target.closest(".landing-spotlight-contact-link")) {
      return;
    }

    event.preventDefault();
    window.location.href = spotlightCard.dataset.spotlightMemberHref || "/members";
    return;
  }

  const refreshLandingQuotesButton = event.target.closest("[data-landing-quotes-refresh]");

  if (refreshLandingQuotesButton) {
    event.preventDefault();
    advanceLandingQuotes();
    renderLandingQuotes();
    return;
  }

  const shortcut = event.target.closest("[data-source-key]");

  if (!shortcut) {
    return;
  }

  event.preventDefault();

  void (async () => {
    const sourceKey = shortcut.dataset.sourceKey;
    const lawMode = shortcut.dataset.lawMode || "all";
    await switchSource(sourceKey);

    if (sourceKey === "laws") {
      await switchLawListMode(lawMode);
    }

    document.getElementById("explorer")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  })();
});

document.addEventListener("keydown", (event) => {
  const spotlightCard = event.target.closest?.("[data-spotlight-member-href]");

  if (!spotlightCard || event.target.closest(".landing-spotlight-contact-link")) {
    return;
  }

  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  window.location.href = spotlightCard.dataset.spotlightMemberHref || "/members";
});

if (elements.lawsAllTab) {
  elements.lawsAllTab.addEventListener("click", async () => {
    await switchLawListMode("all");
  });
}

if (elements.lawsSurprisingTab) {
  elements.lawsSurprisingTab.addEventListener("click", async () => {
    await switchLawListMode("surprising");
  });
}

elements.searchInput.addEventListener("input", () => {
  getSourceState().filters.search = elements.searchInput.value;
  state.visibleCount = 180;
  applyFilters();
});

elements.yearSelect.addEventListener("change", () => {
  getSourceState().filters.year = elements.yearSelect.value;
  state.visibleCount = 180;
  applyFilters();
});

elements.committeeTypeSelect.addEventListener("change", () => {
  getSourceState("committee").filters.committeeType = elements.committeeTypeSelect.value;
  state.visibleCount = 180;
  applyFilters();
});

elements.committeeNameSelect.addEventListener("change", () => {
  getSourceState("committee").filters.committeeName = elements.committeeNameSelect.value;
  state.visibleCount = 180;
  applyFilters();
});

elements.loadMoreButton.addEventListener("click", () => {
  state.visibleCount += 180;
  renderProtocolList();
});

elements.refreshButton.addEventListener("click", async () => {
  if (state.activeSource === "laws") {
    await startLawRefresh();
    return;
  }

  await fetchSourceData(state.activeSource, true);
  await refreshBulkStatus(state.activeSource);
});

elements.downloadAllButton.addEventListener("click", async () => {
  await startBulkDownload();
});

elements.checkUpdatesButton.addEventListener("click", async () => {
  await checkForUpdates();
});

elements.analyzeLawsButton.addEventListener("click", async () => {
  await startLawAnalysis();
});

if (elements.adminProtocolCheckButton) {
  elements.adminProtocolCheckButton.addEventListener("click", async () => {
    await startAdminProtocolCheck();
  });
}

if (elements.adminProtocolApplyButton) {
  elements.adminProtocolApplyButton.addEventListener("click", async () => {
    await applyAdminProtocolUpdates();
  });
}

if (elements.adminLawCheckButton) {
  elements.adminLawCheckButton.addEventListener("click", async () => {
    await startAdminLawCheck();
  });
}

if (elements.adminLawApplyButton) {
  elements.adminLawApplyButton.addEventListener("click", async () => {
    await applyAdminLawUpdates();
  });
}

if (elements.adminLawAnalysisCheckButton) {
  elements.adminLawAnalysisCheckButton.addEventListener("click", async () => {
    await startAdminMissingLawAnalysis();
  });
}

if (elements.adminSurprisingVoteExplanationButton) {
  elements.adminSurprisingVoteExplanationButton.addEventListener("click", async () => {
    await startAdminSurprisingVoteExplanations();
  });
}

if (elements.adminLawAnalysisRebuildButton) {
  elements.adminLawAnalysisRebuildButton.addEventListener("click", async () => {
    await startAdminLawAnalysisRebuild();
  });
}

if (elements.adminSmallQuotesRebuildButton) {
  elements.adminSmallQuotesRebuildButton.addEventListener("click", async () => {
    await startAdminSmallQuotesRebuild();
  });
}

if (elements.adminMemberProfilesRebuildButton) {
  elements.adminMemberProfilesRebuildButton.addEventListener("click", async () => {
    await startAdminMemberProfilesRebuild();
  });
}

window.addEventListener("knesset-auth-changed", () => {
  if (isAdminUser()) {
    void loadAdminProtocolUpdatePreview();
    void loadAdminLawUpdatePreview();
    void loadAdminMissingLawAnalysisStatus();
    void loadAdminSurprisingVoteExplanationStatus();
    void loadAdminLawAnalysisRebuildStatus();
    void loadAdminSmallQuotesRebuildStatus();
    void loadAdminMemberProfilesRebuildStatus();
  } else {
    syncAdminProtocolUpdatePolling();
    syncAdminLawUpdatePolling();
    syncAdminMissingLawAnalysisPolling();
    syncAdminSurprisingVoteExplanationPolling();
    syncAdminLawAnalysisRebuildPolling();
    syncAdminSmallQuotesRebuildPolling();
    syncAdminMemberProfilesRebuildPolling();
    state.adminProtocolUpdates.preview = null;
    state.adminProtocolUpdates.error = "";
    state.adminProtocolUpdates.loading = false;
    state.adminProtocolUpdates.checking = false;
    state.adminProtocolUpdates.applying = false;
    state.adminLawUpdates.preview = null;
    state.adminLawUpdates.error = "";
    state.adminLawUpdates.loading = false;
    state.adminLawUpdates.checking = false;
    state.adminLawUpdates.applying = false;
    state.adminMissingLawAnalysis.error = "";
    state.adminMissingLawAnalysis.loading = false;
    state.adminMissingLawAnalysis.starting = false;
    state.adminSurprisingVoteExplanations.status = null;
    state.adminSurprisingVoteExplanations.error = "";
    state.adminSurprisingVoteExplanations.loading = false;
    state.adminSurprisingVoteExplanations.starting = false;
    state.adminLawAnalysisRebuild.error = "";
    state.adminLawAnalysisRebuild.loading = false;
    state.adminLawAnalysisRebuild.starting = false;
    state.adminSmallQuotesRebuild.status = null;
    state.adminSmallQuotesRebuild.error = "";
    state.adminSmallQuotesRebuild.loading = false;
    state.adminSmallQuotesRebuild.starting = false;
    state.adminMemberProfilesRebuild.status = null;
    state.adminMemberProfilesRebuild.error = "";
    state.adminMemberProfilesRebuild.loading = false;
    state.adminMemberProfilesRebuild.starting = false;
    renderAdminProtocolUpdatePanel();
    renderAdminLawUpdatePanel();
    renderAdminMissingLawAnalysisPanel();
    renderAdminSurprisingVoteExplanationPanel();
    renderAdminLawAnalysisRebuildPanel();
    renderAdminSmallQuotesRebuildPanel();
    renderAdminMemberProfilesRebuildPanel();
  }
});

(async () => {
  const initialRoute = getRequestedExplorerRoute();
  renderLandingPage();
  renderAdminProtocolUpdatePanel();
  renderAdminLawUpdatePanel();
  renderAdminMissingLawAnalysisPanel();
  renderAdminSurprisingVoteExplanationPanel();
  renderAdminLawAnalysisRebuildPanel();
  renderAdminSmallQuotesRebuildPanel();
  renderAdminMemberProfilesRebuildPanel();
  void loadLandingPage();
  void loadLandingSpotlight();
  void loadKnowYourMk();
  await ensureSourceLoaded("plenum");
  renderActiveSource();
  await refreshBulkStatus("plenum");

  if (initialRoute.sourceKey !== "plenum") {
    await switchSource(initialRoute.sourceKey);
  }

  if (initialRoute.sourceKey === "laws" && initialRoute.lawListMode === "surprising") {
    await switchLawListMode("surprising");
  }

  if (window.location.hash === "#explorer") {
    document.getElementById("explorer")?.scrollIntoView({
      block: "start",
    });
  }

  if (isAdminUser()) {
    void loadAdminProtocolUpdatePreview();
    void loadAdminLawUpdatePreview();
    void loadAdminMissingLawAnalysisStatus();
    void loadAdminSurprisingVoteExplanationStatus();
    void loadAdminLawAnalysisRebuildStatus();
    void loadAdminSmallQuotesRebuildStatus();
    void loadAdminMemberProfilesRebuildStatus();
  } else {
    syncAdminProtocolUpdatePolling();
    syncAdminLawUpdatePolling();
    syncAdminMissingLawAnalysisPolling();
    syncAdminSurprisingVoteExplanationPolling();
    syncAdminLawAnalysisRebuildPolling();
    syncAdminSmallQuotesRebuildPolling();
    syncAdminMemberProfilesRebuildPolling();
  }
})();
