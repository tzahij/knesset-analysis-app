const PAGE_CONFIGS = {
  "/plenum": {
    key: "plenum",
    eyebrow: "מליאה",
    title: "ישיבות מליאת הכנסת",
    description:
      "עמוד ייעודי לכל פרוטוקולי ישיבות המליאה, עם חיפוש לפי תאריך, שעה ומספר ישיבה וקישור ישיר לעמוד הקריאה של כל פרוטוקול.",
    note: "הרשימה מציגה את כל פרוטוקולי מליאת הכנסת שנאספו במערכת.",
    listTitle: "פרוטוקולי מליאה לפי תאריך",
    listEndpoint: "/api/protocols",
    resultsLabel: "פרוטוקולים",
    searchLabel: "חיפוש לפי תאריך, שעה או מספר ישיבה",
    searchPlaceholder: "למשל 2026, מרץ, 377",
    emptyMessage: "לא נמצאו פרוטוקולי מליאה שמתאימים למסננים שבחרתם.",
    readerUrl: (item) => `/protocol/${encodeURIComponent(item.documentId)}`,
    buildStatCards(payload, items) {
      const years = deriveYears(items);
      return [
        { label: "פרוטוקולים", value: formatInteger(items.length) },
        { label: "טווח שנים", value: formatYearRange(years) },
        { label: "עדכון אחרון", value: formatIsoDate(payload.metadata?.syncedAt) },
      ];
    },
  },
  "/committees": {
    key: "committee",
    eyebrow: "ועדות",
    title: "ישיבות ועדות הכנסת",
    description:
      "עמוד ייעודי לפרוטוקולי הוועדות, עם סינון לפי סוג ועדה, שם ועדה, שנה ותאריך, וקישור ישיר לעמוד הקריאה של כל דיון.",
    note: "הרשימה מציגה את פרוטוקולי ועדות הכנסת מתוך חלון השנים שהמערכת שומרת.",
    listTitle: "פרוטוקולי ועדות לפי ועדה ותאריך",
    listEndpoint: "/api/committee-protocols",
    resultsLabel: "פרוטוקולים",
    searchLabel: "חיפוש לפי תאריך, שם ועדה, סוג ועדה או מספר ישיבה",
    searchPlaceholder: "למשל כספים, ועדה ראשית, מרץ 2024",
    emptyMessage: "לא נמצאו פרוטוקולי ועדות שמתאימים למסננים שבחרתם.",
    readerUrl: (item) => `/committee-protocol/${encodeURIComponent(item.documentId)}`,
    enableCommitteeFilters: true,
    buildStatCards(payload, items) {
      const years = deriveYears(items);
      return [
        { label: "פרוטוקולים", value: formatInteger(items.length) },
        { label: "טווח שנים", value: formatYearRange(years) },
        {
          label: "עדכון אחרון",
          value: payload.metadata?.windowStartDate
            ? `מ-${escapeHtml(payload.metadata.windowStartDate)}`
            : formatIsoDate(payload.metadata?.syncedAt),
        },
      ];
    },
  },
  "/laws": {
    key: "laws",
    eyebrow: "חוקים",
    title: "חוקים בקריאה שלישית",
    description:
      "עמוד ייעודי לכל החוקים שהתקבלו בקריאה שלישית ונשמרו במאגר האתר, עם חיפוש לפי שם חוק, תאריך ומספר חוק וקישור לעמוד החוק המלא.",
    note: "הרשימה כוללת רק חוקים שהכנסת מסווגת כהתקבלו בקריאה שלישית.",
    listTitle: "כל החוקים שהתקבלו בקריאה שלישית",
    listEndpoint: "/api/laws",
    resultsLabel: "חוקים",
    searchLabel: "חיפוש לפי שם החוק, תאריך או מספר חוק",
    searchPlaceholder: "למשל תקציב, בריאות, 2196772",
    emptyMessage: "לא נמצאו חוקים שמתאימים למסננים שבחרתם.",
    readerUrl: (item) => `/law/${encodeURIComponent(item.billId)}`,
    buildStatCards(payload, items) {
      const years = deriveYears(items);
      return [
        { label: "חוקים", value: formatInteger(items.length) },
        { label: "טווח שנים", value: formatYearRange(years) },
        { label: "עדכון אחרון", value: formatIsoDate(payload.metadata?.syncedAt) },
      ];
    },
  },
  "/surprising-votes": {
    key: "surprising-votes",
    eyebrow: "הצבעות מפתיעות",
    title: "חוקים עם הצבעות תמיכה מפתיעות",
    description:
      "עמוד ייעודי לחוקים שבהם נמצאו פערים חריגים בין דפוס ההצבעה בפועל לבין הפרופיל האידיאולוגי המחושב של חברי הכנסת שתמכו בהם.",
    note: "כל כרטיס מוביל לעמוד החוק, שבו אפשר לראות מי זוהו כבעלי הצבעת תמיכה מפתיעה ומה גודל הפער.",
    listTitle: "חוקים עם הצבעות תמיכה מפתיעות",
    listEndpoint: "/api/laws/surprising-votes",
    resultsLabel: "חוקים",
    searchLabel: "חיפוש לפי שם החוק, תאריך או שמות חברי הכנסת",
    searchPlaceholder: "למשל תקציב, קרעי, מרץ 2026",
    emptyMessage: "לא נמצאו חוקים עם הצבעות מפתיעות שמתאימים למסננים שבחרתם.",
    readerUrl: (item) => `/law/${encodeURIComponent(item.billId)}`,
    buildStatCards(payload, items) {
      return [
        {
          label: "חוקים עם הפתעות",
          value: formatInteger(payload.summary?.lawsWithSurprisingVotes || items.length),
        },
        {
          label: 'סה"כ הצבעות מפתיעות',
          value: formatInteger(payload.summary?.totalSurprisingVotes || 0),
        },
        {
          label: "סף הפתעה",
          value: `${formatInteger(payload.threshold || 0)} נקודות`,
        },
      ];
    },
    buildMethodology(payload) {
      return Array.isArray(payload.methodology) ? payload.methodology : [];
    },
  },
};

const state = {
  config: null,
  items: [],
  filteredItems: [],
  years: [],
  visibleCount: 60,
  payload: null,
  filters: {
    search: "",
    year: "",
    committeeType: "",
    committeeName: "",
  },
};

const elements = {
  eyebrow: document.getElementById("source-browser-eyebrow"),
  title: document.getElementById("source-browser-title"),
  description: document.getElementById("source-browser-description"),
  note: document.getElementById("source-browser-note"),
  totalLabel: document.getElementById("source-browser-total-label"),
  total: document.getElementById("source-browser-total"),
  secondaryLabel: document.getElementById("source-browser-secondary-label"),
  secondary: document.getElementById("source-browser-secondary"),
  tertiaryLabel: document.getElementById("source-browser-tertiary-label"),
  tertiary: document.getElementById("source-browser-tertiary"),
  methodology: document.getElementById("source-browser-methodology"),
  searchLabel: document.getElementById("source-browser-search-label"),
  searchInput: document.getElementById("source-browser-search"),
  yearField: document.getElementById("source-browser-year-field"),
  yearSelect: document.getElementById("source-browser-year"),
  committeeFilters: document.getElementById("source-browser-committee-filters"),
  committeeTypeSelect: document.getElementById("source-browser-committee-type"),
  committeeNameSelect: document.getElementById("source-browser-committee-name"),
  listEyebrow: document.getElementById("source-browser-list-eyebrow"),
  listTitle: document.getElementById("source-browser-list-title"),
  resultsSummary: document.getElementById("source-browser-results-summary"),
  list: document.getElementById("source-browser-list"),
  loadMore: document.getElementById("source-browser-load-more"),
};

function getPageConfig() {
  const normalizedPath = window.location.pathname.replace(/\/+$/u, "") || "/";
  return PAGE_CONFIGS[normalizedPath] || PAGE_CONFIGS["/plenum"];
}

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

  try {
    return new Intl.DateTimeFormat("he-IL", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Jerusalem",
    }).format(new Date(isoValue));
  } catch {
    return "לא זמין";
  }
}

function sortText(values) {
  return [...values].sort((left, right) => String(left).localeCompare(String(right), "he"));
}

function deriveYears(items) {
  const years = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    const explicitYear = Number(item.year || 0);
    if (Number.isFinite(explicitYear) && explicitYear > 0) {
      years.add(explicitYear);
      continue;
    }

    const dateValue = item.publicationDate || item.date || item.voteDate || "";
    const year = Number(String(dateValue).slice(0, 4));
    if (Number.isFinite(year) && year > 0) {
      years.add(year);
    }
  }

  return [...years].sort((left, right) => right - left);
}

function formatYearRange(years) {
  if (!Array.isArray(years) || !years.length) {
    return "לא זמין";
  }

  return years.length === 1 ? String(years[0]) : `${years[years.length - 1]} - ${years[0]}`;
}

function buildFallbackSearchText(item) {
  return [
    item.title,
    item.shortDateLabel,
    item.longDateLabel,
    item.publicationDate,
    item.committeeName,
    item.committeeTypeDescription,
    item.timeLabel,
    item.sessionNumber,
    item.knessetNumber,
    item.lawId,
    item.billId,
    item.publicationSeriesDesc,
    ...(Array.isArray(item.topSurprisingMembers)
      ? item.topSurprisingMembers.map((member) => member.memberName)
      : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    searchText: String(item.searchText || buildFallbackSearchText(item)).toLowerCase(),
  }));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function renderMethodology(methodology) {
  if (!Array.isArray(methodology) || !methodology.length) {
    elements.methodology.hidden = true;
    elements.methodology.innerHTML = "";
    return;
  }

  elements.methodology.hidden = false;
  elements.methodology.innerHTML = `
    <strong>איך הרשימה הזאת מחושבת</strong>
    <ul class="source-browser-methodology__list">
      ${methodology.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function renderHero() {
  const { config, payload, items } = state;
  const statCards = config.buildStatCards(payload, items);

  document.title = `${config.title} | Knesset AI`;
  elements.eyebrow.textContent = config.eyebrow;
  elements.title.textContent = config.title;
  elements.description.textContent = config.description;
  elements.note.textContent = config.note;
  elements.listEyebrow.textContent = config.eyebrow;
  elements.listTitle.textContent = config.listTitle;
  elements.searchLabel.textContent = config.searchLabel;
  elements.searchInput.placeholder = config.searchPlaceholder;

  elements.totalLabel.textContent = statCards[0]?.label || "פריטים";
  elements.total.textContent = statCards[0]?.value || "0";
  elements.secondaryLabel.textContent = statCards[1]?.label || "";
  elements.secondary.textContent = statCards[1]?.value || "";
  elements.tertiaryLabel.textContent = statCards[2]?.label || "";
  elements.tertiary.textContent = statCards[2]?.value || "";

  renderMethodology(
    typeof config.buildMethodology === "function" ? config.buildMethodology(payload) : [],
  );
}

function populateYearSelect() {
  const selected = state.filters.year;
  elements.yearSelect.innerHTML = [
    '<option value="">כל השנים</option>',
    ...state.years.map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`),
  ].join("");
  elements.yearSelect.value = selected;
}

function populateCommitteeFilters() {
  if (!state.config.enableCommitteeFilters) {
    elements.committeeFilters.hidden = true;
    return;
  }

  const committeeTypes = sortText(
    Array.from(new Set(state.items.map((item) => item.committeeTypeDescription).filter(Boolean))),
  );
  const committeeNames = sortText(
    Array.from(new Set(state.items.map((item) => item.committeeName).filter(Boolean))),
  );

  elements.committeeFilters.hidden = false;
  elements.committeeTypeSelect.innerHTML = [
    '<option value="">כל הסוגים</option>',
    ...committeeTypes.map(
      (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
    ),
  ].join("");
  elements.committeeNameSelect.innerHTML = [
    '<option value="">כל הוועדות</option>',
    ...committeeNames.map(
      (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
    ),
  ].join("");
  elements.committeeTypeSelect.value = state.filters.committeeType;
  elements.committeeNameSelect.value = state.filters.committeeName;
}

function renderProtocolCard(item) {
  if (state.config.key === "committee") {
    return `
      <a class="protocol-card" href="${state.config.readerUrl(item)}">
        <span class="protocol-card__date">${escapeHtml(item.shortDateLabel)}</span>
        <span class="protocol-card__tag">${escapeHtml(item.committeeTypeDescription)}</span>
        <span class="protocol-card__meta">${escapeHtml(item.committeeName)}</span>
        <span class="protocol-card__meta">
          ${item.timeLabel ? `שעת פתיחה: ${escapeHtml(item.timeLabel)} · ` : ""}ישיבה ${escapeHtml(
            item.sessionNumber ?? "-",
          )}
        </span>
      </a>
    `;
  }

  return `
    <a class="protocol-card" href="${state.config.readerUrl(item)}">
      <span class="protocol-card__date">${escapeHtml(item.shortDateLabel)}</span>
      <span class="protocol-card__meta">
        ${item.timeLabel ? `שעת פתיחה: ${escapeHtml(item.timeLabel)}` : "שעת פתיחה לא זמינה"}
      </span>
      <span class="protocol-card__meta">
        ישיבה ${escapeHtml(item.sessionNumber ?? "-")} · כנסת ${escapeHtml(item.knessetNumber ?? "-")}
      </span>
    </a>
  `;
}

function renderLawCard(item) {
  const downloadMeta = [item.hasOfficialPdf ? "PDF רשמי" : null, item.hasWordDocument ? "Word" : null]
    .filter(Boolean)
    .join(" · ");
  const surprisingMembers =
    Array.isArray(item.topSurprisingMembers) && item.topSurprisingMembers.length
      ? item.topSurprisingMembers.map((member) => member.memberName).join(", ")
      : "";
  const surprisingMeta = item.surprisingVoteCount
    ? `
      <span class="protocol-card__meta law-card__highlight">
        הצבעות מפתיעות: ${formatInteger(item.surprisingVoteCount)} · פער מרבי: ${formatInteger(
          item.maximumDifference || 0,
        )} · ${escapeHtml(surprisingMembers || "ללא פירוט")}
      </span>
    `
    : "";

  return `
    <a class="protocol-card law-card" href="${state.config.readerUrl(item)}">
      <span class="protocol-card__tag">${
        state.config.key === "surprising-votes" ? "הצבעות מפתיעות" : "התקבלה בקריאה שלישית"
      }</span>
      <strong class="protocol-card__title">${escapeHtml(item.title)}</strong>
      <span class="protocol-card__date">${escapeHtml(item.shortDateLabel)}</span>
      <span class="protocol-card__meta">
        חוק ${escapeHtml(item.lawId || item.billId)} · ${escapeHtml(
          item.publicationSeriesDesc || "ספר החוקים",
        )}
      </span>
      ${surprisingMeta}
      <span class="protocol-card__meta">${escapeHtml(downloadMeta || "פרטי קובץ לא זמינים")}</span>
    </a>
  `;
}

function renderCard(item) {
  if (state.config.key === "laws" || state.config.key === "surprising-votes") {
    return renderLawCard(item);
  }

  return renderProtocolCard(item);
}

function applyFilters() {
  const search = state.filters.search.trim().toLowerCase();
  const year = state.filters.year;
  const committeeType = state.filters.committeeType;
  const committeeName = state.filters.committeeName;

  state.filteredItems = state.items.filter((item) => {
    const itemYear = String(item.year || String(item.publicationDate || item.date || "").slice(0, 4) || "");
    const matchesSearch = !search || item.searchText.includes(search);
    const matchesYear = !year || itemYear === year;
    const matchesCommitteeType =
      !state.config.enableCommitteeFilters ||
      !committeeType ||
      item.committeeTypeDescription === committeeType;
    const matchesCommitteeName =
      !state.config.enableCommitteeFilters ||
      !committeeName ||
      item.committeeName === committeeName;

    return matchesSearch && matchesYear && matchesCommitteeType && matchesCommitteeName;
  });

  renderList();
}

function renderList() {
  const visibleItems = state.filteredItems.slice(0, state.visibleCount);

  if (!visibleItems.length) {
    elements.list.innerHTML = `<p class="muted">${escapeHtml(state.config.emptyMessage)}</p>`;
  } else {
    elements.list.innerHTML = visibleItems.map(renderCard).join("");
  }

  elements.resultsSummary.textContent = `מציג ${formatInteger(visibleItems.length)} מתוך ${formatInteger(
    state.filteredItems.length,
  )} ${state.config.resultsLabel}`;
  elements.loadMore.hidden = state.visibleCount >= state.filteredItems.length;
}

async function loadPage() {
  state.config = getPageConfig();
  renderHeroLoadingState();

  try {
    const { response, payload } = await fetchJson(state.config.listEndpoint);

    if (!response.ok) {
      throw new Error(payload.error || "טעינת הרשימה נכשלה.");
    }

    state.payload = payload;
    state.items = normalizeItems(payload.items);
    state.filteredItems = state.items;
    state.years = Array.isArray(payload.years) && payload.years.length ? payload.years : deriveYears(state.items);

    renderHero();
    elements.yearField.hidden = !state.years.length;
    populateYearSelect();
    populateCommitteeFilters();
    renderList();
  } catch (error) {
    console.error(error);
    elements.title.textContent = state.config.title;
    elements.description.textContent = error.message || String(error);
    elements.list.innerHTML = `<p class="error-message">${escapeHtml(error.message || String(error))}</p>`;
    elements.resultsSummary.textContent = "שגיאה בטעינת הרשימה";
    elements.loadMore.hidden = true;
  }
}

function renderHeroLoadingState() {
  document.title = "טוען... | Knesset AI";
  elements.eyebrow.textContent = state.config.eyebrow;
  elements.title.textContent = state.config.title;
  elements.description.textContent = "טוען את פרטי המדור ואת הרשימה...";
  elements.note.textContent = state.config.note;
  elements.listEyebrow.textContent = state.config.eyebrow;
  elements.listTitle.textContent = state.config.listTitle;
  elements.searchLabel.textContent = state.config.searchLabel;
  elements.searchInput.placeholder = state.config.searchPlaceholder;
  elements.resultsSummary.textContent = "טוען רשימה...";
  elements.list.innerHTML = '<p class="muted">טוען את הרשימה...</p>';
  elements.loadMore.hidden = true;
  elements.committeeFilters.hidden = !state.config.enableCommitteeFilters;
  elements.methodology.hidden = true;
}

elements.searchInput.addEventListener("input", (event) => {
  state.filters.search = event.target.value || "";
  state.visibleCount = 60;
  applyFilters();
});

elements.yearSelect.addEventListener("change", (event) => {
  state.filters.year = event.target.value || "";
  state.visibleCount = 60;
  applyFilters();
});

elements.committeeTypeSelect.addEventListener("change", (event) => {
  state.filters.committeeType = event.target.value || "";
  state.visibleCount = 60;
  applyFilters();
});

elements.committeeNameSelect.addEventListener("change", (event) => {
  state.filters.committeeName = event.target.value || "";
  state.visibleCount = 60;
  applyFilters();
});

elements.loadMore.addEventListener("click", () => {
  state.visibleCount += 60;
  renderList();
});

loadPage();
