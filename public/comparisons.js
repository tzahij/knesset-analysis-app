const state = {
  data: null,
  status: null,
  metadata: null,
  loading: false,
  selectedComparisonKey: null,
  selectedView: "members",
  topCount: 5,
  selectedRowId: null,
};

const elements = {
  comparisonCount: document.getElementById("comparison-count"),
  comparisonProtocolCount: document.getElementById("comparison-protocol-count"),
  comparisonEligibleCount: document.getElementById("comparison-eligible-count"),
  comparisonSyncDate: document.getElementById("comparison-sync-date"),
  comparisonStatus: document.getElementById("comparison-page-status"),
  refreshButton: document.getElementById("comparison-refresh-button"),
  selector: document.getElementById("comparison-selector"),
  viewSwitch: document.getElementById("comparison-view-switch"),
  topSwitch: document.getElementById("comparison-top-switch"),
  sideSummary: document.getElementById("comparison-side-summary"),
  sideDetail: document.getElementById("comparison-side-detail"),
  resultsSummary: document.getElementById("comparison-results-summary"),
  explorer: document.getElementById("comparison-explorer"),
  leadersGrid: document.getElementById("comparison-leaders-grid"),
  sections: document.getElementById("comparison-sections"),
};

let pollTimer = null;

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

function formatInteger(value) {
  return Number(value || 0).toLocaleString("he-IL");
}

function formatScore(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "לא זמין";
  }

  return value.toFixed(2);
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
        throw new Error("שרת השיתוף הציבורי החזיר עמוד שגיאה במקום נתוני JSON. רעננו את הדף ונסו שוב.");
      }

      throw new Error("השרת החזיר תשובה לא תקינה.");
    }
  }

  return { response, payload };
}

function getComparisonKeyFromHash() {
  const hash = decodeURIComponent(window.location.hash.replace(/^#/, "").trim());

  if (!hash) {
    return null;
  }

  return hash.startsWith("comparison-") ? hash.replace(/^comparison-/, "") : hash;
}

function setComparisonHash(key) {
  const nextHash = `comparison-${key}`;

  if (window.location.hash !== `#${nextHash}`) {
    history.replaceState(null, "", `#${nextHash}`);
  }
}

function getComparisons() {
  return Array.isArray(state.data?.comparisons) ? state.data.comparisons : [];
}

function getSelectedComparison() {
  const comparisons = getComparisons();

  if (!comparisons.length) {
    return null;
  }

  if (!state.selectedComparisonKey) {
    state.selectedComparisonKey = getComparisonKeyFromHash() || comparisons[0].key;
  }

  const selected = comparisons.find((comparison) => comparison.key === state.selectedComparisonKey);

  if (selected) {
    return selected;
  }

  state.selectedComparisonKey = comparisons[0].key;
  return comparisons[0];
}

function getStatusAppearance(status) {
  switch (status) {
    case "running":
    case "waiting_for_member_index":
      return "is-running";
    case "completed":
      return "is-success";
    case "completed_with_errors":
    case "failed":
      return "is-error";
    default:
      return "";
  }
}

function getStatusTitle(status) {
  switch (status) {
    case "waiting_for_member_index":
      return "ממתין להשלמת אינדקס חברי הכנסת";
    case "running":
      return "בונה עכשיו את מאגר ההשוואות";
    case "completed":
      return "מאגר ההשוואות מוכן";
    case "completed_with_errors":
      return "המאגר מוכן, אבל היו גם שגיאות חלקיות";
    case "failed":
      return "בניית מאגר ההשוואות נכשלה";
    default:
      return "סטטוס השוואות";
  }
}

function getStatusCardMarkup(status) {
  if (!status || status.status === "idle") {
    return "";
  }

  const percent =
    status.totalProtocols > 0
      ? Math.min(100, Math.round((status.processedProtocols / status.totalProtocols) * 100))
      : 0;
  const errorsMarkup = Array.isArray(status.recentErrors) && status.recentErrors.length
    ? `<p class="error-message">${escapeHtml(status.recentErrors[0])}</p>`
    : "";
  const currentMarkup = status.current
    ? `<p class="muted">מעבד עכשיו: <strong>${escapeHtml(status.current.title || status.current.shortDateLabel || status.current.documentId)}</strong></p>`
    : "";

  return `
    <article class="data-status-card ${getStatusAppearance(status.status)}">
      <p class="eyebrow">Build Status</p>
      <h3>${escapeHtml(getStatusTitle(status.status))}</h3>
      <p class="muted">
        נסרקו ${formatInteger(status.processedProtocols)} מתוך ${formatInteger(status.totalProtocols)} פרוטוקולים
        מ־${escapeHtml(status.sinceDate || "2022-01-01")} ואילך.
      </p>
      <div class="progress-bar"><span style="width: ${percent}%"></span></div>
      ${currentMarkup}
      ${errorsMarkup}
    </article>
  `;
}

function renderHeroStats() {
  const overview = state.data?.overview || null;
  const comparisonCount = getComparisons().length;

  elements.comparisonCount.textContent = comparisonCount
    ? formatInteger(comparisonCount)
    : state.status?.status === "running" || state.status?.status === "waiting_for_member_index"
      ? "בבנייה"
      : "0";
  elements.comparisonProtocolCount.textContent = overview
    ? formatInteger(overview.protocolCount)
    : formatInteger(state.status?.totalProtocols || 0);
  elements.comparisonEligibleCount.textContent = overview
    ? formatInteger(overview.eligibleMemberCount)
    : "טוען...";
  elements.comparisonSyncDate.textContent = state.data?.generatedAt
    ? formatIsoDate(state.data.generatedAt)
    : state.status?.startedAt
      ? `בבנייה מאז ${formatIsoDate(state.status.startedAt)}`
      : "טוען...";
}

function renderStatusArea() {
  const shouldShowStatus =
    !state.data ||
    !state.data.comparisons ||
    ["running", "waiting_for_member_index", "completed_with_errors", "failed"].includes(
      state.status?.status,
    );

  elements.comparisonStatus.innerHTML = shouldShowStatus ? getStatusCardMarkup(state.status) : "";
}

function getLeaderSummary(comparison) {
  return {
    member: comparison?.topMember || null,
    party: comparison?.topParty || null,
  };
}

function renderSelector() {
  const comparisons = getComparisons();

  if (!comparisons.length) {
    elements.selector.innerHTML = `<p class="muted">המדדים יופיעו כאן לאחר שהמאגר יושלם.</p>`;
    return;
  }

  elements.selector.innerHTML = comparisons
    .map(
      (comparison) => `
        <button
          class="comparison-selector-chip ${comparison.key === state.selectedComparisonKey ? "is-active" : ""}"
          type="button"
          data-comparison-key="${escapeHtml(comparison.key)}"
        >
          ${escapeHtml(comparison.title)}
        </button>
      `,
    )
    .join("");
}

function syncToggleGroups() {
  elements.viewSwitch.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.selectedView);
  });

  elements.topSwitch.querySelectorAll("[data-top-count]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.topCount) === state.topCount);
  });
}

function getVisibleRows(comparison, view) {
  if (!comparison) {
    return [];
  }

  if (view === "parties") {
    return comparison.partyRows
      .filter((row) => typeof row.averageRatePerThousandWords === "number")
      .slice(0, state.topCount);
  }

  return comparison.memberRows
    .filter((row) => row.eligible && typeof row.ratePerThousandWords === "number")
    .slice(0, state.topCount);
}

function getRowId(row, view) {
  return view === "parties" ? row.partyName : row.routeSlug;
}

function ensureSelectedRow(rows, view) {
  if (!rows.length) {
    state.selectedRowId = null;
    return null;
  }

  const found = rows.find((row) => getRowId(row, view) === state.selectedRowId);

  if (found) {
    return found;
  }

  state.selectedRowId = getRowId(rows[0], view);
  return rows[0];
}

function renderChartRows(rows, view) {
  if (!rows.length) {
    return `<p class="muted">אין מספיק נתונים להצגת גרף עבור הבחירה הנוכחית.</p>`;
  }

  const maxScore = Math.max(
    ...rows.map((row) =>
      view === "parties" ? row.averageRatePerThousandWords || 0 : row.ratePerThousandWords || 0,
    ),
  );

  return `
    <div class="comparison-chart-list">
      ${rows
        .map((row, index) => {
          const score =
            view === "parties" ? row.averageRatePerThousandWords : row.ratePerThousandWords;
          const width = maxScore > 0 ? Math.max(8, (score / maxScore) * 100) : 0;
          const rowId = getRowId(row, view);
          const selected = rowId === state.selectedRowId;
          const meta =
            view === "parties"
              ? `ח"כים זכאים: ${formatInteger(row.eligibleMembers)} מתוך ${formatInteger(row.memberCount)}`
              : `${escapeHtml(row.partyName)} · ${formatInteger(row.protocolCount)} פרוטוקולים`;

          return `
            <button
              class="comparison-chart-row ${selected ? "is-selected" : ""}"
              type="button"
              data-row-id="${escapeHtml(rowId)}"
            >
              <span class="comparison-chart-row__rank">${index + 1}</span>
              <span class="comparison-chart-row__main">
                <strong>${escapeHtml(view === "parties" ? row.partyName : row.name)}</strong>
                <span>${meta}</span>
              </span>
              <span class="comparison-chart-row__bar">
                <span style="width: ${width}%"></span>
              </span>
              <span class="comparison-chart-row__value">${formatScore(score)}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSelectedRowDetail(row, comparison, view) {
  if (!row) {
    return `
      <article class="comparison-side-card">
        <p class="muted">בחרו שורה בגרף כדי לראות פירוט.</p>
      </article>
    `;
  }

  if (view === "parties") {
    return `
      <article class="comparison-side-card">
        <p class="eyebrow">Party Detail</p>
        <h3>${escapeHtml(row.partyName)}</h3>
        <p class="muted">${escapeHtml(comparison.title)}</p>
        <div class="comparison-side-stat-list">
          <div class="comparison-side-stat">
            <span>ציון ממוצע</span>
            <strong>${formatScore(row.averageRatePerThousandWords)}</strong>
          </div>
          <div class="comparison-side-stat">
            <span>ח"כים שנכללו</span>
            <strong>${formatInteger(row.eligibleMembers)} / ${formatInteger(row.memberCount)}</strong>
          </div>
          <div class="comparison-side-stat">
            <span>אזכורים גולמיים</span>
            <strong>${formatInteger(row.totalRawHits)}</strong>
          </div>
          <div class="comparison-side-stat">
            <span>מילים מדוברות</span>
            <strong>${formatInteger(row.totalWords)}</strong>
          </div>
        </div>
        ${
          row.topMember
            ? `
              <p class="muted">
                הח"כ הבולט במפלגה:
                <a href="/members/${encodeURIComponent(row.topMember.routeSlug)}">${escapeHtml(
                  row.topMember.name,
                )}</a>
              </p>
            `
            : ""
        }
      </article>
    `;
  }

  const termMarkup = Array.isArray(row.topTerms) && row.topTerms.length
    ? row.topTerms
        .map(
          (term) =>
            `<span class="comparison-term-pill">${escapeHtml(term.term)} · ${formatInteger(term.count)}</span>`,
        )
        .join("")
    : `<span class="muted">אין מונחים בולטים להצגה.</span>`;

  return `
    <article class="comparison-side-card">
      <p class="eyebrow">Member Detail</p>
      <h3>${escapeHtml(row.name)}</h3>
      <p class="muted">${escapeHtml(row.partyName)} · ${escapeHtml(comparison.title)}</p>
      <div class="comparison-side-stat-list">
        <div class="comparison-side-stat">
          <span>ציון</span>
          <strong>${formatScore(row.ratePerThousandWords)}</strong>
        </div>
        <div class="comparison-side-stat">
          <span>פרוטוקולים</span>
          <strong>${formatInteger(row.protocolCount)}</strong>
        </div>
        <div class="comparison-side-stat">
          <span>קטעי דיבור</span>
          <strong>${formatInteger(row.utteranceCount)}</strong>
        </div>
        <div class="comparison-side-stat">
          <span>מילים מדוברות</span>
          <strong>${formatInteger(row.totalWords)}</strong>
        </div>
      </div>
      <div class="comparison-side-terms">${termMarkup}</div>
      <a class="secondary-button" href="/members/${encodeURIComponent(row.routeSlug)}">
        לעמוד הח"כ
      </a>
    </article>
  `;
}

function renderSidePanels(comparison, selectedRow) {
  if (!comparison) {
    elements.sideSummary.innerHTML = `<article class="comparison-side-card"><p class="muted">המדד הנבחר יופיע כאן.</p></article>`;
    elements.sideDetail.innerHTML = "";
    return;
  }

  const leaders = getLeaderSummary(comparison);

  elements.sideSummary.innerHTML = `
    <article class="comparison-side-card">
      <p class="eyebrow">Selected Comparison</p>
      <h3>${escapeHtml(comparison.title)}</h3>
      <p class="muted">${escapeHtml(comparison.shortDescription)}</p>
      <div class="comparison-side-stat-list">
        <div class="comparison-side-stat">
          <span>ח"כ מוביל</span>
          <strong>${leaders.member ? escapeHtml(leaders.member.name) : "אין"}</strong>
        </div>
        <div class="comparison-side-stat">
          <span>מפלגה מובילה</span>
          <strong>${leaders.party ? escapeHtml(leaders.party.partyName) : "אין"}</strong>
        </div>
      </div>
      <p class="muted comparison-scale-note">${escapeHtml(comparison.scaleLabel)}</p>
    </article>
  `;

  elements.sideDetail.innerHTML = renderSelectedRowDetail(selectedRow, comparison, state.selectedView);
}

function renderExplorer() {
  const comparison = getSelectedComparison();

  if (!comparison) {
    elements.explorer.innerHTML = getStatusCardMarkup(state.status);
    return;
  }

  const rows = getVisibleRows(comparison, state.selectedView);
  const selectedRow = ensureSelectedRow(rows, state.selectedView);
  const viewLabel = state.selectedView === "parties" ? "מפלגות" : "חברי הכנסת";
  const leaderText =
    state.selectedView === "parties"
      ? comparison.topParty && comparison.topParty.averageRatePerThousandWords !== null
        ? `${comparison.topParty.partyName} · ${formatScore(comparison.topParty.averageRatePerThousandWords)}`
        : "אין מספיק נתונים"
      : comparison.topMember
        ? `${comparison.topMember.name} · ${formatScore(comparison.topMember.ratePerThousandWords)}`
        : "אין מספיק נתונים";

  elements.explorer.innerHTML = `
    <article class="comparison-explorer-card">
      <div class="comparison-explorer-card__header">
        <div>
          <p class="eyebrow">Interactive Chart</p>
          <h3>${escapeHtml(comparison.title)}</h3>
          <p class="muted">${escapeHtml(comparison.shortDescription)}</p>
        </div>
        <div class="comparison-highlight-stack">
          <div class="comparison-highlight">
            <span class="comparison-highlight__label">תצוגה נוכחית</span>
            <strong>${escapeHtml(viewLabel)} · טופ ${formatInteger(state.topCount)}</strong>
          </div>
          <div class="comparison-highlight">
            <span class="comparison-highlight__label">המוביל כרגע</span>
            <strong>${escapeHtml(leaderText)}</strong>
          </div>
        </div>
      </div>

      <div class="comparison-explorer-grid">
        <section class="comparison-chart-card">
          <div class="comparison-section__header">
            <h4>גרף דינמי</h4>
            <p class="muted">כל לחיצה על שורה תעדכן את כרטיס הפירוט שבצד.</p>
          </div>
          ${renderChartRows(rows, state.selectedView)}
        </section>

        <section class="comparison-methodology">
          <h4>מתודולוגיה של המדד</h4>
          <ul>
            ${comparison.methodology.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
          <p class="muted">מילון המונחים: ${comparison.terms.map((term) => escapeHtml(term)).join(" · ")}</p>
        </section>
      </div>
    </article>
  `;

  renderSidePanels(comparison, selectedRow);
}

function renderLeaderGrid() {
  const comparisons = getComparisons();

  if (!comparisons.length) {
    elements.leadersGrid.innerHTML = "";
    return;
  }

  elements.leadersGrid.innerHTML = comparisons
    .map((comparison) => {
      const isActive = comparison.key === state.selectedComparisonKey;
      const memberLeader = comparison.topMember
        ? `${comparison.topMember.name} · ${formatScore(comparison.topMember.ratePerThousandWords)}`
        : "אין מספיק נתונים";
      const partyLeader =
        comparison.topParty && comparison.topParty.averageRatePerThousandWords !== null
          ? `${comparison.topParty.partyName} · ${formatScore(comparison.topParty.averageRatePerThousandWords)}`
          : "אין מספיק נתונים";

      return `
        <button
          class="comparison-leader-card ${isActive ? "is-active" : ""}"
          type="button"
          data-comparison-key="${escapeHtml(comparison.key)}"
        >
          <p class="eyebrow">Leader Card</p>
          <h3>${escapeHtml(comparison.title)}</h3>
          <p class="muted">${escapeHtml(comparison.shortDescription)}</p>
          <div class="comparison-leader-card__grid">
            <div class="comparison-leader-card__slot">
              <span>ח"כ מוביל</span>
              <strong>${escapeHtml(memberLeader)}</strong>
            </div>
            <div class="comparison-leader-card__slot">
              <span>מפלגה מובילה</span>
              <strong>${escapeHtml(partyLeader)}</strong>
            </div>
          </div>
        </button>
      `;
    })
    .join("");
}

function renderMiniRows(rows, view) {
  if (!rows.length) {
    return `<p class="muted">אין מספיק נתונים.</p>`;
  }

  const maxScore = Math.max(
    ...rows.map((row) =>
      view === "parties" ? row.averageRatePerThousandWords || 0 : row.ratePerThousandWords || 0,
    ),
  );

  return `
    <div class="comparison-mini-list">
      ${rows
        .map((row, index) => {
          const score =
            view === "parties" ? row.averageRatePerThousandWords : row.ratePerThousandWords;
          const width = maxScore > 0 ? Math.max(10, (score / maxScore) * 100) : 0;
          return `
            <div class="comparison-mini-row">
              <span class="comparison-mini-row__rank">${index + 1}</span>
              <span class="comparison-mini-row__label">
                <strong>${escapeHtml(view === "parties" ? row.partyName : row.name)}</strong>
                <span>${escapeHtml(view === "parties" ? `ח"כים זכאים: ${formatInteger(row.eligibleMembers)}` : row.partyName)}</span>
              </span>
              <span class="comparison-mini-row__bar">
                <span style="width: ${width}%"></span>
              </span>
              <span class="comparison-mini-row__value">${formatScore(score)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderComparisonSections() {
  const comparisons = getComparisons();

  if (!comparisons.length) {
    elements.sections.innerHTML = "";
    return;
  }

  elements.sections.innerHTML = comparisons
    .map((comparison) => {
      const topMembers = comparison.memberRows
        .filter((row) => row.eligible && typeof row.ratePerThousandWords === "number")
        .slice(0, 5);
      const topParties = comparison.partyRows
        .filter((row) => typeof row.averageRatePerThousandWords === "number")
        .slice(0, 5);
      const active = comparison.key === state.selectedComparisonKey;

      return `
        <article
          id="comparison-${escapeHtml(comparison.key)}"
          class="comparison-showcase-card ${active ? "is-active" : ""}"
        >
          <div class="comparison-showcase-card__header">
            <div>
              <p class="eyebrow">Comparison Section</p>
              <h3>${escapeHtml(comparison.title)}</h3>
              <p class="muted">${escapeHtml(comparison.shortDescription)}</p>
            </div>
            <div class="comparison-showcase-card__actions">
              <button
                class="secondary-button compact-button"
                type="button"
                data-comparison-key="${escapeHtml(comparison.key)}"
              >
                פתח בסייר הדינמי
              </button>
            </div>
          </div>

          <div class="comparison-overview-stats">
            <span>ח"כ מוביל: ${
              comparison.topMember
                ? `${escapeHtml(comparison.topMember.name)} · ${formatScore(comparison.topMember.ratePerThousandWords)}`
                : "אין מספיק נתונים"
            }</span>
            <span>מפלגה מובילה: ${
              comparison.topParty && comparison.topParty.averageRatePerThousandWords !== null
                ? `${escapeHtml(comparison.topParty.partyName)} · ${formatScore(comparison.topParty.averageRatePerThousandWords)}`
                : "אין מספיק נתונים"
            }</span>
            <span>${escapeHtml(comparison.scaleLabel)}</span>
          </div>

          <div class="comparison-showcase-grid">
            <section class="comparison-mini-chart">
              <div class="comparison-section__header">
                <h4>חברי הכנסת המובילים</h4>
                <p class="muted">טופ 5 לפי אזכורים לכל 1,000 מילים מדוברות</p>
              </div>
              ${renderMiniRows(topMembers, "members")}
            </section>

            <section class="comparison-mini-chart">
              <div class="comparison-section__header">
                <h4>המפלגות המובילות</h4>
                <p class="muted">טופ 5 לפי ממוצע ציוני חברי הכנסת הזכאים בכל מפלגה</p>
              </div>
              ${renderMiniRows(topParties, "parties")}
            </section>
          </div>

          <div class="comparison-methodology">
            <h4>מתודולוגיה</h4>
            <ul>
              ${comparison.methodology.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
            </ul>
            <p class="muted">מילון המונחים: ${comparison.terms.map((term) => escapeHtml(term)).join(" · ")}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderResultsSummary() {
  const comparison = getSelectedComparison();

  if (!state.data) {
    elements.resultsSummary.textContent =
      state.status?.status === "running" || state.status?.status === "waiting_for_member_index"
        ? `מעבד ${formatInteger(state.status.processedProtocols)} מתוך ${formatInteger(state.status.totalProtocols)} פרוטוקולים`
        : "ממתין לנתוני ההשוואות";
    return;
  }

  elements.resultsSummary.textContent = comparison
    ? `מוצגות ${formatInteger(getComparisons().length)} השוואות. הסייר פתוח כעת על ${comparison.title}.`
    : `מוצגות ${formatInteger(getComparisons().length)} השוואות.`;
}

function renderPage() {
  renderHeroStats();
  renderStatusArea();
  renderSelector();
  syncToggleGroups();
  renderResultsSummary();
  renderExplorer();
  renderLeaderGrid();
  renderComparisonSections();
}

function syncPolling() {
  const shouldPoll = ["running", "waiting_for_member_index"].includes(state.status?.status);

  if (shouldPoll) {
    if (!pollTimer) {
      pollTimer = window.setInterval(() => {
        void loadComparisonPageData(false);
      }, 5000);
    }
    return;
  }

  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function updateRefreshButton() {
  elements.refreshButton.disabled = state.loading;
  elements.refreshButton.textContent = state.loading
    ? "מרענן את מדדי ההשוואות..."
    : "רענן את מדדי ההשוואות";
}

async function loadComparisonPageData(forceRefresh = false) {
  state.loading = true;
  updateRefreshButton();

  try {
    const suffix = forceRefresh ? "?refresh=1" : "";
    const { response, payload } = await fetchJson(`/api/member-comparisons${suffix}`);

    if (!response.ok && response.status !== 202) {
      throw new Error(payload.error || "טעינת נתוני ההשוואות נכשלה");
    }

    state.status = payload.status || null;
    state.metadata = payload.metadata || null;
    state.data = payload.data || state.data;

    if (!state.selectedComparisonKey) {
      state.selectedComparisonKey = getComparisonKeyFromHash();
    }

    const selectedComparison = getSelectedComparison();

    if (selectedComparison) {
      setComparisonHash(selectedComparison.key);
    }

    renderPage();
    syncPolling();
  } catch (error) {
    elements.comparisonStatus.innerHTML = `
      <article class="data-status-card is-error">
        <p class="eyebrow">Load Error</p>
        <h3>טעינת עמוד ההשוואות נכשלה</h3>
        <p class="error-message">${escapeHtml(error.message || String(error))}</p>
      </article>
    `;
    elements.resultsSummary.textContent = "שגיאה בטעינת ההשוואות";
  } finally {
    state.loading = false;
    updateRefreshButton();
  }
}

function focusExplorer() {
  elements.explorer.scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectComparison(key, options = {}) {
  const comparisons = getComparisons();

  if (!comparisons.some((comparison) => comparison.key === key)) {
    return;
  }

  state.selectedComparisonKey = key;
  state.selectedRowId = null;
  setComparisonHash(key);
  renderPage();

  if (options.focusExplorer) {
    focusExplorer();
  }
}

elements.refreshButton.addEventListener("click", async () => {
  await loadComparisonPageData(true);
});

elements.selector.addEventListener("click", (event) => {
  const button = event.target.closest("[data-comparison-key]");

  if (!button) {
    return;
  }

  selectComparison(button.dataset.comparisonKey);
});

elements.viewSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");

  if (!button || button.dataset.view === state.selectedView) {
    return;
  }

  state.selectedView = button.dataset.view;
  state.selectedRowId = null;
  renderPage();
});

elements.topSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("[data-top-count]");

  if (!button) {
    return;
  }

  const nextCount = Number(button.dataset.topCount);

  if (!Number.isFinite(nextCount) || nextCount === state.topCount) {
    return;
  }

  state.topCount = nextCount;
  state.selectedRowId = null;
  renderPage();
});

elements.explorer.addEventListener("click", (event) => {
  const row = event.target.closest("[data-row-id]");

  if (!row) {
    return;
  }

  state.selectedRowId = row.dataset.rowId;
  renderPage();
});

elements.leadersGrid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-comparison-key]");

  if (!card) {
    return;
  }

  selectComparison(card.dataset.comparisonKey, { focusExplorer: true });
});

elements.sections.addEventListener("click", (event) => {
  const button = event.target.closest("[data-comparison-key]");

  if (!button) {
    return;
  }

  selectComparison(button.dataset.comparisonKey, { focusExplorer: true });
});

window.addEventListener("hashchange", () => {
  const hashKey = getComparisonKeyFromHash();

  if (hashKey && hashKey !== state.selectedComparisonKey) {
    selectComparison(hashKey);
  }
});

void loadComparisonPageData(false);
