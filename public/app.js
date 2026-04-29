const SOURCE_CONFIG = {
  plenum: {
    key: "plenum",
    label: "ישיבות מליאה",
    searchPlaceholder: "למשל 2026, מרץ, 377",
    listTitle: "בחרו פרוטוקול מליאה לפי תאריך",
    searchLabel: "חיפוש לפי תאריך, שעה או מספר ישיבה",
    sourceNote: "מציג את כל פרוטוקולי ישיבות מליאת הכנסת.",
    downloadButtonLabel: "הורד את כל פרוטוקולי המליאה",
    downloadCopy:
      "הכפתור מוריד את כל פרוטוקולי המליאה לתיקייה מקומית עם שמות קבצים שמבוססים על התאריך.",
    listEndpoint: "/api/protocols",
    downloadEndpoint: "/api/download-all",
    downloadStatusEndpoint: "/api/download-all/status",
    readerUrl: (documentId) => `/protocol/${encodeURIComponent(documentId)}`,
  },
  committee: {
    key: "committee",
    label: "ישיבות ועדות הכנסת",
    searchPlaceholder: "למשל כספים, ועדה ראשית, מרץ 2024",
    listTitle: "בחרו פרוטוקול ועדה לפי סוג ועדה ותאריך",
    searchLabel: "חיפוש לפי תאריך, שם ועדה, סוג ועדה או מספר ישיבה",
    sourceNote: "מציג את פרוטוקולי ועדות הכנסת מחמש השנים האחרונות בלבד.",
    downloadButtonLabel: "הורד את כל פרוטוקולי הוועדות",
    downloadCopy:
      "הכפתור מוריד את כל פרוטוקולי הוועדות מחמש השנים האחרונות, עם שמות קבצים שמכילים תאריך וסוג ועדה.",
    listEndpoint: "/api/committee-protocols",
    downloadEndpoint: "/api/committee-download-all",
    downloadStatusEndpoint: "/api/committee-download-all/status",
    readerUrl: (documentId) => `/committee-protocol/${encodeURIComponent(documentId)}`,
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

function createSourceState() {
  return {
    items: [],
    filteredItems: [],
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
  };
}

const state = {
  activeSource: "plenum",
  visibleCount: 180,
  isCheckingUpdates: false,
  updateCheck: {
    status: "idle",
    checkedAt: null,
  },
  sources: {
    plenum: createSourceState(),
    committee: createSourceState(),
    data: createSourceState(),
  },
};

const elements = {
  protocolCount: document.getElementById("protocol-count"),
  yearRange: document.getElementById("year-range"),
  syncDate: document.getElementById("sync-date"),
  filtersHeading: document.getElementById("filters-heading"),
  searchInput: document.getElementById("search-input"),
  yearSelect: document.getElementById("year-select"),
  committeeFilters: document.getElementById("committee-filters"),
  committeeTypeSelect: document.getElementById("committee-type-select"),
  committeeNameSelect: document.getElementById("committee-name-select"),
  refreshButton: document.getElementById("refresh-button"),
  checkUpdatesButton: document.getElementById("check-updates-button"),
  updatesStatus: document.getElementById("updates-status"),
  downloadHeading: document.getElementById("download-heading"),
  downloadCopy: document.getElementById("download-copy"),
  downloadAllButton: document.getElementById("download-all-button"),
  bulkStatus: document.getElementById("bulk-status"),
  listEyebrow: document.getElementById("list-eyebrow"),
  listTitle: document.getElementById("list-title"),
  sourceNote: document.getElementById("source-note"),
  resultsSummary: document.getElementById("results-summary"),
  protocolList: document.getElementById("protocol-list"),
  loadMoreButton: document.getElementById("load-more-button"),
  sourceTabs: Array.from(document.querySelectorAll(".source-tab")),
};

let bulkStatusTimer = null;
let dataStatusTimer = null;

function getSourceConfig(sourceKey = state.activeSource) {
  return SOURCE_CONFIG[sourceKey];
}

function getSourceState(sourceKey = state.activeSource) {
  return state.sources[sourceKey];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function updateActionButtons() {
  const activeSourceState = getSourceState();
  const isLoading = Boolean(activeSourceState.loading);

  elements.refreshButton.disabled = isLoading || state.isCheckingUpdates;
  elements.checkUpdatesButton.disabled = isLoading || state.isCheckingUpdates;
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
    const response = await fetch(`${sourceConfig.listEndpoint}${refresh ? "?refresh=1" : ""}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load protocols");
    }

    sourceState.items = payload.items;
    sourceState.filteredItems = payload.items;
    sourceState.years = payload.years;
    sourceState.metadata = payload.metadata;
    sourceState.loaded = true;

    if (sourceKey === "committee") {
      sourceState.committeeTypes = sortText(
        Array.from(
          new Set(
            payload.items
              .map((item) => item.committeeTypeDescription)
              .filter(Boolean),
          ),
        ),
      );
      sourceState.committeeNames = sortText(
        Array.from(
          new Set(
            payload.items
              .map((item) => item.committeeName)
              .filter(Boolean),
          ),
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

function populateYearSelect() {
  const sourceState = getSourceState();
  const currentValue = sourceState.filters.year;

  elements.yearSelect.innerHTML = [
    `<option value="">כל השנים</option>`,
    ...sourceState.years.map((year) => `<option value="${year}">${year}</option>`),
  ].join("");
  elements.yearSelect.value = currentValue;
}

function populateCommitteeFilters() {
  const sourceState = getSourceState("committee");

  elements.committeeTypeSelect.innerHTML = [
    `<option value="">כל הסוגים</option>`,
    ...sourceState.committeeTypes.map(
      (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
    ),
  ].join("");
  elements.committeeNameSelect.innerHTML = [
    `<option value="">כל הוועדות</option>`,
    ...sourceState.committeeNames.map(
      (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
    ),
  ].join("");

  elements.committeeTypeSelect.value = sourceState.filters.committeeType;
  elements.committeeNameSelect.value = sourceState.filters.committeeName;
}

function renderMetadata() {
  const sourceState = getSourceState();
  const total = sourceState.items.length;
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

  elements.searchInput.placeholder = sourceConfig.searchPlaceholder;
  elements.searchInput.value = sourceState.filters.search;
  elements.downloadAllButton.textContent = sourceConfig.downloadButtonLabel;
  elements.downloadCopy.textContent = sourceConfig.downloadCopy;
  elements.listEyebrow.textContent = sourceConfig.label;
  elements.listTitle.textContent = sourceConfig.listTitle;
  elements.sourceNote.textContent =
    sourceConfig.key === "committee" && sourceState.metadata?.windowStartDate
      ? `מציג פרוטוקולי ועדות מתאריך ${sourceState.metadata.windowStartDate} ואילך.`
      : sourceConfig.sourceNote;

  elements.committeeFilters.hidden = sourceConfig.key !== "committee";
}

function applyFilters() {
  const sourceState = getSourceState();
  const { search, year, committeeType, committeeName } = sourceState.filters;

  sourceState.filteredItems = sourceState.items.filter((item) => {
    const matchesYear = !year || String(item.year) === year;
    const matchesSearch = !search || item.searchText.includes(search.trim().toLowerCase());
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

function renderProtocolCard(item) {
  if (state.activeSource === "committee") {
    return `
      <a class="protocol-card" href="${getSourceConfig().readerUrl(item.documentId)}">
        <span class="protocol-card__date">${escapeHtml(item.shortDateLabel)}</span>
        <span class="protocol-card__tag">${escapeHtml(item.committeeTypeDescription)}</span>
        <span class="protocol-card__meta">${escapeHtml(item.committeeName)}</span>
        <span class="protocol-card__meta">
          ${item.timeLabel ? `שעת פתיחה: ${escapeHtml(item.timeLabel)} � ` : ""}ישיבה ${escapeHtml(
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
        ${item.timeLabel ? `שעת פתיחה: ${escapeHtml(item.timeLabel)}` : "שעת פתיחה לא זמינה"}
      </span>
      <span class="protocol-card__meta">
        ישיבה ${escapeHtml(item.sessionNumber ?? "-")} � כנסת ${escapeHtml(
          item.knessetNumber ?? "-",
        )}
      </span>
    </a>
  `;
}

function renderProtocolList() {
  const sourceState = getSourceState();
  const visibleItems = sourceState.filteredItems.slice(0, state.visibleCount);

  if (visibleItems.length === 0) {
    elements.protocolList.innerHTML =
      `<p class="muted">לא נמצאו פרוטוקולים שמתאימים למסננים שבחרתם.</p>`;
  } else {
    elements.protocolList.innerHTML = visibleItems.map(renderProtocolCard).join("");
  }

  elements.resultsSummary.textContent = `מציג ${visibleItems.length.toLocaleString(
    "he-IL",
  )} מתוך ${sourceState.filteredItems.length.toLocaleString("he-IL")} פרוטוקולים`;
  elements.loadMoreButton.hidden = state.visibleCount >= sourceState.filteredItems.length;
}

function renderBulkStatus() {
  const status = getSourceState().bulkStatus;

  if (!status || status.status === "idle") {
    elements.bulkStatus.innerHTML =
      `<p class="muted">עדיין לא הופעלה הורדה מלאה עבור המקור הנוכחי.</p>`;
    elements.downloadAllButton.disabled = false;
    return;
  }

  const percent =
    status.total > 0 ? Math.min(100, Math.round((status.processed / status.total) * 100)) : 0;
  const currentLine = status.current
    ? `<p>מעבד עכשיו: <strong>${escapeHtml(status.current.dateLabel)}</strong></p>`
    : "";
  const errors = status.recentErrors.length
    ? `<p class="error-message">שגיאות אחרונות: ${escapeHtml(
        status.recentErrors.join(" | "),
      )}</p>`
    : "";

  elements.bulkStatus.innerHTML = `
    <p><span class="status-chip">${escapeHtml(status.status)}</span></p>
    <p>${status.processed.toLocaleString("he-IL")} / ${status.total.toLocaleString(
      "he-IL",
    )} קבצים</p>
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
        <span class="updates-count">${Number(sourceStatus.addedCount || 0).toLocaleString(
          "he-IL",
        )}</span>
      </div>
      <p class="muted">${detailParts.join(" � ")}</p>
      ${itemsMarkup}
    </article>
  `;
}

function renderUpdateStatus() {
  const updateCheck = state.updateCheck;
  elements.updatesStatus.className = "updates-status";

  if (!updateCheck || updateCheck.status === "idle") {
    elements.updatesStatus.innerHTML =
      `<p class="muted">המערכת עדיין לא בדקה אם פורסמו פרוטוקולים חדשים.</p>`;
    return;
  }

  if (updateCheck.status === "running") {
    elements.updatesStatus.classList.add("is-running");
    elements.updatesStatus.innerHTML = `
      <p><span class="status-chip">בודק עדכונים</span></p>
      <p class="muted">האתר בודק עכשיו את פרוטוקולי המליאה ופרוטוקולי הוועדות.</p>
    `;
    return;
  }

  if (updateCheck.status === "error") {
    elements.updatesStatus.classList.add("is-error");
    elements.updatesStatus.innerHTML = `
      <p><span class="status-chip">הבדיקה נכשלה</span></p>
      <p class="error-message">${escapeHtml(updateCheck.error || "Update check failed")}</p>
      <p class="muted">ניסיון אחרון: ${escapeHtml(formatIsoDate(updateCheck.checkedAt))}</p>
    `;
    return;
  }

  const variantClass = updateCheck.hasErrors
    ? "is-warning"
    : updateCheck.totalAdded > 0
      ? "is-success"
      : "is-neutral";
  const summaryText =
    updateCheck.totalAdded > 0
      ? `נוספו ${updateCheck.totalAdded.toLocaleString("he-IL")} פרוטוקולים חדשים.`
      : "לא נמצאו פרוטוקולים חדשים מאז הסנכרון האחרון.";

  elements.updatesStatus.classList.add(variantClass);
  elements.updatesStatus.innerHTML = `
    <p><span class="status-chip">תוצאות הבדיקה</span></p>
    <p><strong>${summaryText}</strong></p>
    <p class="muted">נבדק ב-${escapeHtml(formatIsoDate(updateCheck.checkedAt))}</p>
    ${updateCheck.hasErrors ? `<p class="error-message">חלק מהמקורות החזירו שגיאה.</p>` : ""}
    <div class="updates-groups">
      ${renderSourceUpdateGroup("plenum", updateCheck.sources?.plenum)}
      ${renderSourceUpdateGroup("committee", updateCheck.sources?.committee)}
    </div>
  `;
}

async function refreshBulkStatus(sourceKey = state.activeSource) {
  const sourceConfig = getSourceConfig(sourceKey);

  try {
    const response = await fetch(sourceConfig.downloadStatusEndpoint);
    const payload = await response.json();
    getSourceState(sourceKey).bulkStatus = payload;

    if (sourceKey === state.activeSource) {
      renderBulkStatus();
    }

    if (payload.status === "running" && sourceKey === state.activeSource) {
      if (!bulkStatusTimer) {
        bulkStatusTimer = window.setInterval(() => refreshBulkStatus(state.activeSource), 2500);
      }
    } else if (sourceKey === state.activeSource && bulkStatusTimer) {
      window.clearInterval(bulkStatusTimer);
      bulkStatusTimer = null;
    }
  } catch (error) {
    console.error(error);
  }
}

async function startBulkDownload() {
  const sourceConfig = getSourceConfig();
  elements.downloadAllButton.disabled = true;

  try {
    const response = await fetch(sourceConfig.downloadEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const payload = await response.json();

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

async function refreshAllSources() {
  const orderedSources = [
    state.activeSource,
    ...Object.keys(SOURCE_CONFIG).filter((sourceKey) => sourceKey !== state.activeSource),
  ];

  for (const sourceKey of orderedSources) {
    await fetchSourceData(sourceKey);
  }

  renderActiveSource();
  await refreshBulkStatus(state.activeSource);
}

async function checkForUpdates() {
  if (state.isCheckingUpdates) {
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
    const response = await fetch("/api/check-updates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const payload = await response.json();

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

function renderActiveSource() {
  renderSourceSwitch();
  renderSourceSpecificUi();
  renderMetadata();
  populateYearSelect();

  if (state.activeSource === "committee") {
    populateCommitteeFilters();
  }

  applyFilters();
  renderBulkStatus();
  renderUpdateStatus();
  updateActionButtons();
}

async function switchSource(sourceKey) {
  if (state.activeSource === sourceKey) {
    return;
  }

  state.activeSource = sourceKey;
  state.visibleCount = 180;
  renderActiveSource();
  await ensureSourceLoaded(sourceKey);
  await refreshBulkStatus(sourceKey);
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
      (item) => `<span class="comparison-term-pill">${escapeHtml(item.term)} � ${Number(item.count).toLocaleString("he-IL")}</span>`,
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

async function fetchSourceData(sourceKey, refresh = false) {
  const sourceState = getSourceState(sourceKey);
  const sourceConfig = getSourceConfig(sourceKey);

  if (sourceKey === state.activeSource) {
    setLoadingState(true);
  }

  try {
    const response = await fetch(`${sourceConfig.listEndpoint}${refresh ? "?refresh=1" : ""}`);
    const payload = await response.json();

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

    sourceState.items = payload.items;
    sourceState.filteredItems = payload.items;
    sourceState.years = payload.years;
    sourceState.metadata = payload.metadata;
    sourceState.loaded = true;

    if (sourceKey === "committee") {
      sourceState.committeeTypes = sortText(
        Array.from(
          new Set(
            payload.items
              .map((item) => item.committeeTypeDescription)
              .filter(Boolean),
          ),
        ),
      );
      sourceState.committeeNames = sortText(
        Array.from(
          new Set(
            payload.items
              .map((item) => item.committeeName)
              .filter(Boolean),
          ),
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

function renderMetadata() {
  const sourceState = getSourceState();

  if (state.activeSource === "data") {
    const protocolCount =
      sourceState.comparisonData?.overview?.protocolCount || sourceState.comparisonStatus?.totalProtocols || 0;
    elements.protocolCount.textContent = Number(protocolCount).toLocaleString("he-IL");
    elements.yearRange.textContent = `${sourceState.metadata?.sinceDate || "2022-01-01"} ואילך`;
    elements.syncDate.textContent = sourceState.comparisonData?.generatedAt
      ? formatIsoDate(sourceState.comparisonData.generatedAt)
      : "בבנייה";
    return;
  }

  const total = sourceState.items.length;
  const minYear = sourceState.years[sourceState.years.length - 1];
  const maxYear = sourceState.years[0];

  elements.protocolCount.textContent = total.toLocaleString("he-IL");
  elements.yearRange.textContent =
    minYear && maxYear ? `${minYear} - ${maxYear}` : "לא זמין";
  elements.syncDate.textContent = sourceState.metadata?.syncedAt
    ? formatIsoDate(sourceState.metadata.syncedAt)
    : "לא זמין";
}

function renderSourceSpecificUi() {
  const sourceConfig = getSourceConfig();
  const sourceState = getSourceState();
  const searchField = elements.searchInput.closest(".field");
  const yearField = elements.yearSelect.closest(".field");
  const downloadDivider = elements.downloadHeading.previousElementSibling;

  elements.searchInput.placeholder = sourceConfig.searchPlaceholder || "";
  elements.searchInput.value = sourceState.filters.search;
  elements.downloadAllButton.textContent = sourceConfig.downloadButtonLabel || "";
  elements.downloadCopy.textContent = sourceConfig.downloadCopy || "";
  elements.refreshButton.textContent = sourceConfig.refreshButtonLabel || "רענון מטא-דאטה";
  elements.listEyebrow.textContent = sourceConfig.label;
  elements.listTitle.textContent = sourceConfig.listTitle;
  elements.sourceNote.textContent =
    sourceConfig.key === "committee" && sourceState.metadata?.windowStartDate
      ? `מציג פרוטוקולי ועדות מתאריך ${sourceState.metadata.windowStartDate} ואילך.`
      : sourceConfig.sourceNote;

  elements.filtersHeading.textContent = sourceConfig.key === "data" ? "ריענון המדדים" : "סינון וניווט";
  searchField.hidden = Boolean(sourceConfig.hideFilters);
  yearField.hidden = Boolean(sourceConfig.hideFilters);
  elements.committeeFilters.hidden = sourceConfig.key !== "committee";
  elements.checkUpdatesButton.hidden = Boolean(sourceConfig.hideUpdates);
  elements.updatesStatus.hidden = Boolean(sourceConfig.hideUpdates);
  elements.downloadHeading.hidden = Boolean(sourceConfig.hideDownloads);
  elements.downloadCopy.hidden = Boolean(sourceConfig.hideDownloads);
  elements.downloadAllButton.hidden = Boolean(sourceConfig.hideDownloads);
  elements.bulkStatus.hidden = Boolean(sourceConfig.hideDownloads);
  if (downloadDivider) {
    downloadDivider.hidden = Boolean(sourceConfig.hideDownloads);
  }
}

function applyFilters() {
  const sourceState = getSourceState();

  if (state.activeSource === "data") {
    renderDataComparisons();
    return;
  }

  const { search, year, committeeType, committeeName } = sourceState.filters;

  sourceState.filteredItems = sourceState.items.filter((item) => {
    const matchesYear = !year || String(item.year) === year;
    const matchesSearch = !search || item.searchText.includes(search.trim().toLowerCase());
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

  if (visibleItems.length === 0) {
    elements.protocolList.innerHTML =
      `<p class="muted">לא נמצאו פרוטוקולים שמתאימים למסננים שבחרתם.</p>`;
  } else {
    elements.protocolList.innerHTML = visibleItems.map(renderProtocolCard).join("");
  }

  elements.resultsSummary.textContent = `מציג ${visibleItems.length.toLocaleString(
    "he-IL",
  )} מתוך ${sourceState.filteredItems.length.toLocaleString("he-IL")} פרוטוקולים`;
  elements.loadMoreButton.hidden = state.visibleCount >= sourceState.filteredItems.length;
}

function renderBulkStatus() {
  if (state.activeSource === "data") {
    elements.bulkStatus.innerHTML = "";
    elements.downloadAllButton.disabled = false;
    return;
  }

  const status = getSourceState().bulkStatus;

  if (!status || status.status === "idle") {
    elements.bulkStatus.innerHTML =
      `<p class="muted">עדיין לא הופעלה הורדה מלאה עבור המקור הנוכחי.</p>`;
    elements.downloadAllButton.disabled = false;
    return;
  }

  const percent =
    status.total > 0 ? Math.min(100, Math.round((status.processed / status.total) * 100)) : 0;
  const currentLine = status.current
    ? `<p>מעבד עכשיו: <strong>${escapeHtml(status.current.dateLabel)}</strong></p>`
    : "";
  const errors = status.recentErrors.length
    ? `<p class="error-message">שגיאות אחרונות: ${escapeHtml(
        status.recentErrors.join(" | "),
      )}</p>`
    : "";

  elements.bulkStatus.innerHTML = `
    <p><span class="status-chip">${escapeHtml(status.status)}</span></p>
    <p>${status.processed.toLocaleString("he-IL")} / ${status.total.toLocaleString(
      "he-IL",
    )} קבצים</p>
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
    const response = await fetch(sourceConfig.downloadStatusEndpoint);
    const payload = await response.json();
    getSourceState(sourceKey).bulkStatus = payload;

    if (sourceKey === state.activeSource) {
      renderBulkStatus();
    }

    if (payload.status === "running" && sourceKey === state.activeSource) {
      if (!bulkStatusTimer) {
        bulkStatusTimer = window.setInterval(() => refreshBulkStatus(state.activeSource), 2500);
      }
    } else if (sourceKey === state.activeSource && bulkStatusTimer) {
      window.clearInterval(bulkStatusTimer);
      bulkStatusTimer = null;
    }
  } catch (error) {
    console.error(error);
  }
}

async function refreshAllSources() {
  for (const sourceKey of ["plenum", "committee"]) {
    await fetchSourceData(sourceKey);
  }

  renderActiveSource();

  if (state.activeSource !== "data") {
    await refreshBulkStatus(state.activeSource);
  }
}

function renderActiveSource() {
  renderSourceSwitch();
  renderSourceSpecificUi();
  renderMetadata();

  if (state.activeSource === "committee") {
    populateCommitteeFilters();
  }

  if (state.activeSource === "data") {
    renderDataComparisons();
    renderUpdateStatus();
    updateActionButtons();
    syncDataStatusTimer();
    return;
  }

  applyFilters();
  renderBulkStatus();
  renderUpdateStatus();
  updateActionButtons();
  syncDataStatusTimer();
}

elements.sourceTabs.forEach((button) => {
  button.addEventListener("click", async () => {
    await switchSource(button.dataset.source);
  });
});

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
  await fetchSourceData(state.activeSource, true);
  await refreshBulkStatus(state.activeSource);
});

elements.downloadAllButton.addEventListener("click", async () => {
  await startBulkDownload();
});

elements.checkUpdatesButton.addEventListener("click", async () => {
  await checkForUpdates();
});

(async () => {
  await ensureSourceLoaded("plenum");
  renderActiveSource();
  await refreshBulkStatus("plenum");
})();
