const DEFAULT_AXIS_KEY = "religiousSecular";

const state = {
  loading: false,
  data: null,
  error: null,
  activeView: "explicit",
  filters: {
    search: "",
    party: "",
  },
  selectedMemberSlug: "",
  selectedAxisKey: DEFAULT_AXIS_KEY,
};

const elements = {
  viewSwitch: document.getElementById("know-your-mk-view-switch"),
  searchInput: document.getElementById("know-your-mk-search"),
  partySelect: document.getElementById("know-your-mk-party"),
  summary: document.getElementById("know-your-mk-summary"),
  gaps: document.getElementById("know-your-mk-gaps"),
  axes: document.getElementById("know-your-mk-axes"),
  detail: document.getElementById("know-your-mk-detail"),
};

if (elements.detail) {
  document.body.appendChild(elements.detail);
}

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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  ["Based on Votes", "מבוסס הצבעות"],
  ["Expressed Views", "על סמך הטקסט"],
  ["Between The Lines", "בין השורות"],
  ["BETWEEN THE LINES", "בין השורות"],
  ["SUPPORT VOTES", "פרופיל הצבעות"],
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

function getAvailableViews() {
  const views = state.data?.views;
  return views && typeof views === "object" ? views : {};
}

function getActiveViewKey() {
  const views = getAvailableViews();

  if (views[state.activeView]) {
    return state.activeView;
  }

  const fallback = Object.keys(views)[0] || "explicit";
  state.activeView = fallback;
  return fallback;
}

function getActiveView() {
  const viewKey = getActiveViewKey();
  return getAvailableViews()?.[viewKey] || null;
}

function getVoteProfileMeta(entity) {
  if (entity?.voteProfile && typeof entity.voteProfile === "object") {
    return entity.voteProfile;
  }

  return entity && typeof entity === "object" ? entity : null;
}

function hasLowVoteProfileSubstantiation(entity) {
  const voteProfile = getVoteProfileMeta(entity);
  const countedLawCount = Number(voteProfile?.countedLawCount ?? voteProfile?.supportedLawCount ?? 0);
  const minimumCount = Number(voteProfile?.minimumSubstantiatedVoteCount || 5);
  return Boolean(voteProfile?.isLowSubstantiation) || (countedLawCount > 0 && countedLawCount < minimumCount);
}

function getVoteProfileSubstantiationWarning(entity) {
  const voteProfile = getVoteProfileMeta(entity);

  if (!hasLowVoteProfileSubstantiation(voteProfile)) {
    return "";
  }

  return String(voteProfile?.substantiationWarning || "").trim();
}

function renderVoteProfileFlag(entity, options = {}) {
  const warning = getVoteProfileSubstantiationWarning(entity);

  if (!warning) {
    return "";
  }

  return `<span class="status-chip status-chip--vote-caution vote-confidence-flag${
    options.className ? ` ${escapeHtml(options.className)}` : ""
  }" title="${escapeHtml(warning)}">${escapeHtml(options.label || "מעט הצבעות")}</span>`;
}

function renderVoteProfileCautionNote(entity, activeViewKey = getActiveViewKey()) {
  if (activeViewKey !== "votesBased") {
    return "";
  }

  const warning = getVoteProfileSubstantiationWarning(entity);

  if (!warning) {
    return "";
  }

  return `
    <div class="analysis-source-disclaimer vote-confidence-note">
      <p>${escapeHtml(warning)}</p>
    </div>
  `;
}

function getFilteredMembers() {
  const members = Array.isArray(state.data?.members) ? state.data.members : [];
  const search = normalizeSearchText(state.filters.search);
  const party = String(state.filters.party || "").trim();

  return members.filter((member) => {
    if (party && member.partyName !== party) {
      return false;
    }

    if (!search) {
      return true;
    }

    return normalizeSearchText(`${member.name} ${member.partyName}`).includes(search);
  });
}

function ensureSelection(filteredMembers, axes) {
  const hasSelectedMember = filteredMembers.some((member) => member.routeSlug === state.selectedMemberSlug);

  if (!filteredMembers.length) {
    state.selectedMemberSlug = "";
  } else if (!hasSelectedMember) {
    state.selectedMemberSlug = filteredMembers[0].routeSlug;
  }

  if (!Array.isArray(axes) || !axes.some((axis) => axis.key === state.selectedAxisKey)) {
    state.selectedAxisKey = axes?.[0]?.key || DEFAULT_AXIS_KEY;
  }
}

function getAxisRecord(member, axisKey, viewKey = getActiveViewKey()) {
  return member?.axes?.[viewKey]?.[axisKey] || null;
}

function buildAxisColumns(members, axisKey, viewKey = getActiveViewKey()) {
  const columns = Array.from({ length: 10 }, (_value, index) => ({
    score: index + 1,
    members: [],
  }));

  for (const member of members) {
    const axisRecord = getAxisRecord(member, axisKey, viewKey) || null;
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

function getSummaryChips(data, activeViewKey) {
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

function renderVoteBasedLawList(member, activeViewKey) {
  if (activeViewKey !== "votesBased") {
    return "";
  }

  const voteProfile = member?.voteProfile || null;
  const laws = Array.isArray(voteProfile?.countedLaws)
    ? voteProfile.countedLaws
    : Array.isArray(voteProfile?.supportedLaws)
      ? voteProfile.supportedLaws
      : [];

  if (!voteProfile || !laws.length) {
    return `
      <section class="know-detail-card__section">
        <h4>חוקים שנכללו בפרופיל</h4>
        <div class="landing-empty-card">
          <p class="muted">עדיין לא נמצאה לחבר הכנסת הזה רשימת חוקים שנכללו בפרופיל ההצבעות עם ניתוח צירים מלא.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="know-detail-card__section">
      <h4>החוקים שנכללו בפרופיל ההצבעות</h4>
      ${renderVoteProfileCautionNote(member, activeViewKey)}
      <p class="muted">${escapeHtml(voteProfile.summary || "")}</p>
      <div class="know-detail-law-list">
        ${laws
          .map(
            (law) => `
              <article class="know-detail-law-card">
                <div class="know-detail-law-card__header">
                  <a class="know-detail-law-card__link" href="${escapeHtml(law.href || "#")}">${escapeHtml(
                    law.title || "",
                  )}</a>
                  <div class="status-chip-row">
                    <span class="status-chip">${escapeHtml(law.voteDirectionLabel || "בעד")}</span>
                    <span class="status-chip">${escapeHtml(law.shortDateLabel || "")}</span>
                  </div>
                </div>
                <p class="muted">${escapeHtml(law.overallSummary || "")}</p>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderViewSwitch() {
  if (!elements.viewSwitch) {
    return;
  }

  if (state.loading) {
    elements.viewSwitch.innerHTML = '<p class="muted">טוען את סוגי התצוגה...</p>';
    return;
  }

  if (state.error) {
    elements.viewSwitch.innerHTML = `<p class="error-message">${escapeHtml(state.error)}</p>`;
    return;
  }

  const views = Object.values(getAvailableViews());
  const activeViewKey = getActiveViewKey();
  const activeView = getActiveView();

  elements.viewSwitch.innerHTML = `
    <div class="know-your-mk-view-switch__tabs" role="tablist" aria-label="תצוגות חברי הכנסת">
      ${views
        .map(
          (view) => `
            <button
              type="button"
              class="know-your-mk-view-tab ${view.key === activeViewKey ? "is-active" : ""}"
              data-know-view="${escapeHtml(view.key)}"
              aria-pressed="${view.key === activeViewKey ? "true" : "false"}"
            >
              ${escapeHtml(view.label)}
            </button>
          `,
        )
        .join("")}
    </div>
    <div class="know-your-mk-disclaimer">
      <strong>${escapeHtml(activeView?.eyebrow || "הכירו את חברי הכנסת")}</strong>
      <p>${escapeHtml(activeView?.disclaimer || "")}</p>
    </div>
  `;
}

function renderSummary() {
  if (!elements.summary) {
    return;
  }

  if (state.loading) {
    elements.summary.innerHTML = '<p class="muted">טוען את מפת חברי הכנסת ומכין את התצוגה...</p>';
    return;
  }

  if (state.error) {
    elements.summary.innerHTML = `<p class="error-message">${escapeHtml(state.error)}</p>`;
    return;
  }

  if (!state.data) {
    elements.summary.innerHTML = '<p class="muted">מפת חברי הכנסת עדיין לא נטענה.</p>';
    return;
  }

  const filteredMembers = getFilteredMembers();
  const activeView = getActiveView();
  const activeViewKey = getActiveViewKey();
  const methodology = Array.isArray(activeView?.methodology) ? activeView.methodology : [];
  const summaryChips = getSummaryChips(state.data, activeViewKey);

  elements.summary.innerHTML = `
    <div class="know-your-mk-summary-card">
      <div class="know-your-mk-summary-card__stats">
        <span class="status-chip">${formatInteger(filteredMembers.length)} מוצגים</span>
        ${summaryChips.map((chip) => `<span class="status-chip">${chip}</span>`).join("")}
      </div>
      <ul class="know-your-mk-summary-card__methodology">
        ${methodology.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderGapSection() {
  if (!elements.gaps) {
    return;
  }

  if (state.loading) {
    elements.gaps.innerHTML = '<div class="landing-empty-card"><p class="muted">טוען את פערי הדיבור וההצבעה...</p></div>';
    return;
  }

  if (state.error) {
    elements.gaps.innerHTML = `<div class="landing-empty-card"><p class="error-message">${escapeHtml(
      state.error,
    )}</p></div>`;
    return;
  }

  const gapPayload = state.data?.mouthHeartGap || null;
  const items = Array.isArray(gapPayload?.items) ? gapPayload.items.slice(0, 18) : [];
  const methodology = Array.isArray(gapPayload?.methodology) ? gapPayload.methodology : [];

  if (!items.length) {
    elements.gaps.innerHTML = `
      <div class="landing-empty-card">
        <p class="muted">עדיין אין מספיק חברי כנסת עם גם פרופיל מפורש וגם פרופיל מבוסס הצבעות כדי להציג את פערי הדיבור וההצבעה.</p>
      </div>
    `;
    return;
  }

  elements.gaps.innerHTML = `
    <section class="know-your-mk-gap-shell">
      <div class="landing-section__header landing-section__header--tight">
        <div>
          <p class="eyebrow">אחד בפה - אחד בלב</p>
          <h3>הפער בין מה שח"כ אומר לבין מה שהוא תומך בו בהצבעות</h3>
        </div>
        <p class="muted">כאן מדורגים חברי הכנסת שהמיקום שלהם על פני ארבעת הצירים רחוק במיוחד בין העמדות המפורשות לבין הפרופיל מבוסס ההצבעות.</p>
      </div>

      <div class="know-your-mk-summary-card__stats">
        <span class="status-chip">${formatInteger(gapPayload?.comparedMembers)} חברי כנסת הושוו</span>
        <span class="status-chip">מדד על בסיס פער מצטבר בארבעת הצירים</span>
      </div>

      <ul class="know-your-mk-summary-card__methodology">
        ${methodology.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>

      <div class="know-your-mk-gap-grid">
        ${items
          .map(
            (item) => `
              <article class="know-your-mk-gap-card">
                <div class="know-your-mk-gap-card__header">
                  <div>
                    <h4>${escapeHtml(item.name)}</h4>
                    <p class="muted">${escapeHtml(item.partyName)}</p>
                    ${renderVoteProfileFlag(item)}
                  </div>
                  <span class="status-chip">פער כולל ${escapeHtml(formatAxisScore(item.totalDifference))}</span>
                </div>
                ${renderVoteProfileCautionNote(item, "votesBased")}
                <p class="know-your-mk-gap-card__lead">
                  הפער הבולט ביותר אצל חבר הכנסת הזה מופיע בציר ${escapeHtml(
                    item.strongestAxis?.label || "הציר הבולט",
                  )}. הכרטיסים שמתחת מראים על אותו ספקטרום את המיקום בדיבור המפורש מול המיקום המבוסס על דפוס ההצבעות.
                </p>
                <div class="know-your-mk-gap-card__axis-list">
                  ${item.axisDifferences
                    .map((axis) => renderGapAxisDifference(axis, item.strongestAxis?.key))
                    .join("")}
                </div>
                <div class="member-protocol-actions">
                  <button
                    type="button"
                    class="secondary-button compact-button"
                    data-know-gap-member="${escapeHtml(item.routeSlug)}"
                    data-know-gap-axis="${escapeHtml(item.strongestAxis?.key || DEFAULT_AXIS_KEY)}"
                  >
                    הדגש במפה
                  </button>
                  <a class="secondary-button compact-button" href="${escapeHtml(item.href || "#")}">לעמוד הח"כ</a>
                </div>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderAxes() {
  if (!elements.axes) {
    return;
  }

  if (state.loading) {
    elements.axes.innerHTML = '<div class="landing-empty-card"><p class="muted">טוען את מפת ארבעת הצירים...</p></div>';
    return;
  }

  if (state.error) {
    elements.axes.innerHTML = `<div class="landing-empty-card"><p class="error-message">${escapeHtml(state.error)}</p></div>`;
    return;
  }

  const axes = Array.isArray(state.data?.axes) ? state.data.axes : [];
  const filteredMembers = getFilteredMembers();
  const activeView = getActiveView();
  const activeViewKey = getActiveViewKey();
  ensureSelection(filteredMembers, axes);

  if (!axes.length || !filteredMembers.length) {
    elements.axes.innerHTML = '<div class="landing-empty-card"><p class="muted">לא נמצאו חברי כנסת שמתאימים למסננים שבחרתם.</p></div>';
    return;
  }

  elements.axes.innerHTML = axes
    .map((axis) => {
      const columns = buildAxisColumns(filteredMembers, axis.key, activeViewKey);

      return `
        <article class="know-axis-card">
          <div class="know-axis-card__header">
                <div>
              <p class="eyebrow">${escapeHtml(activeView?.eyebrow || "הכירו את חברי הכנסת")}</p>
              <h3>${escapeHtml(axis.label)}</h3>
            </div>
            <p class="muted">1 = ${escapeHtml(axis.lowLabel)} / 10 = ${escapeHtml(axis.highLabel)}</p>
          </div>
          <div class="know-axis-card__legend">
            <span>${escapeHtml(axis.lowLabel)}</span>
            <span>${escapeHtml(axis.highLabel)}</span>
          </div>
          <div class="know-axis-card__board">
            ${columns
              .map(
                (column) => `
                  <section class="know-axis-column">
                    <header class="know-axis-column__header">
                      <span class="know-axis-column__score">${column.score}</span>
                      <span class="know-axis-column__count">${formatInteger(column.members.length)} ח"כים</span>
                    </header>
                    <div class="know-axis-column__stack">
                      ${
                        column.members.length
                          ? column.members
                              .map(
                                (member) => `
                                  <button
                                    type="button"
                                    class="know-axis-token ${
                                      member.routeSlug === state.selectedMemberSlug ? "is-selected" : ""
                                    } ${
                                      member.routeSlug === state.selectedMemberSlug &&
                                      axis.key === state.selectedAxisKey
                                        ? "is-active-axis"
                                        : ""
                                    }"
                                    data-know-member="${escapeHtml(member.routeSlug)}"
                                    data-know-axis="${escapeHtml(axis.key)}"
                                    title="${escapeHtml(
                                      `${member.name} / ${member.partyName} / ${formatAxisScore(
                                        member.axes?.[activeViewKey]?.[axis.key]?.score || column.score,
                                      )}/10${
                                        activeViewKey === "votesBased" && hasLowVoteProfileSubstantiation(member)
                                          ? " / מעט הצבעות"
                                          : ""
                                      }`,
                                    )}"
                                    style="${getKnowYourMkPartyStyle(member.partyName)}"
                                  >
                                    <strong>${escapeHtml(member.name)}</strong>
                                    ${activeViewKey === "votesBased" ? renderVoteProfileFlag(member) : ""}
                                    <span>${escapeHtml(member.partyName)}</span>
                                  </button>
                                `,
                              )
                              .join("")
                          : '<p class="know-axis-column__empty">אין חברי כנסת</p>'
                      }
                    </div>
                  </section>
                `,
              )
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderDetail() {
  if (!elements.detail) {
    return;
  }

  if (state.loading) {
    elements.detail.innerHTML = '<div class="landing-empty-card"><p class="muted">מכין את חלונית ההסבר...</p></div>';
    return;
  }

  if (state.error) {
    elements.detail.innerHTML = `<div class="landing-empty-card"><p class="error-message">${escapeHtml(state.error)}</p></div>`;
    return;
  }

  const axes = Array.isArray(state.data?.axes) ? state.data.axes : [];
  const filteredMembers = getFilteredMembers();
  const activeView = getActiveView();
  const activeViewKey = getActiveViewKey();
  ensureSelection(filteredMembers, axes);
  const member = filteredMembers.find((item) => item.routeSlug === state.selectedMemberSlug);
  const axis = axes.find((item) => item.key === state.selectedAxisKey) || axes[0];
  const axisRecord = getAxisRecord(member, axis?.key, activeViewKey);

  if (!member || !axis || !axisRecord) {
    elements.detail.innerHTML = '<div class="landing-empty-card"><p class="muted">בחרו חבר כנסת באחד הצירים כדי לראות את הנימוקים.</p></div>';
    elements.detail.classList.remove("is-open");
    return;
  }

  elements.detail.classList.add("is-open");

  const sourceLabel =
    activeViewKey === "votesBased"
      ? member.voteProfile?.sourceLabel || "פרופיל הצבעות"
      : member.sourceLabel || "לא זמין";

  elements.detail.innerHTML = `
    <article class="know-detail-card">
      <div style="position: sticky; top: 1.5rem; display: flex; justify-content: flex-end; z-index: 100; margin-bottom: -2rem; margin-top: -0.5rem; width: 100%;">
        <button type="button" class="know-detail-close-btn" aria-label="סגור את החלונית" title="סגור" style="background: #e53e3e; color: white; border: none; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; font-size: 1.8rem; cursor: pointer; border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">&times;</button>
      </div>
      <div class="know-detail-card__header">
        <div>
          <p class="eyebrow">חבר הכנסת שנבחר</p>
          <h3>${escapeHtml(member.name)}</h3>
          <p class="muted">${escapeHtml(member.partyName)}</p>
          ${activeViewKey === "votesBased" ? renderVoteProfileFlag(member) : ""}
        </div>
        <a class="secondary-button compact-button" href="${escapeHtml(member.href)}">לעמוד הפרופיל המלא</a>
      </div>

      <div class="know-detail-card__meta">
        <span class="status-chip">מקור: ${escapeHtml(sourceLabel)}</span>
        <span class="status-chip">תצוגה: ${escapeHtml(activeView?.label || "לא ידוע")}</span>
        <span class="status-chip">ציון על הציר: ${formatAxisScore(axisRecord.score || 0)}/10</span>
      </div>

      ${renderVoteProfileCautionNote(member, activeViewKey)}
      <p class="know-detail-card__summary">${escapeHtml(
        activeViewKey === "votesBased"
          ? member.voteProfile?.summary || member.overallSummary || ""
          : member.overallSummary || "",
      )}</p>

      <div class="know-detail-card__axis-chooser">
        ${axes
          .map((axisOption) => {
            const score = Number(getAxisRecord(member, axisOption.key, activeViewKey)?.score || 0);

            return `
              <button
                type="button"
                class="know-detail-axis-pill ${axisOption.key === axis.key ? "is-active" : ""}"
                data-know-detail-axis="${escapeHtml(axisOption.key)}"
              >
                <span class="know-detail-axis-pill__title">${escapeHtml(axisOption.label)}</span>
                ${renderAxisMeter(axisOption.lowLabel, axisOption.highLabel, score, {
                  className: "know-detail-axis-pill__meter",
                  valueLabel: "הציון",
                })}
              </button>
            `;
          })
          .join("")}
      </div>

      <div class="know-detail-card__axis-summary">
        <h4>${escapeHtml(axis.label)}</h4>
        ${renderAxisMeter(axis.lowLabel, axis.highLabel, axisRecord.score, {
          className: "know-detail-card__meter",
          valueLabel: "המיקום על הציר",
        })}
      </div>

      <section class="know-detail-card__section">
        <h4>למה ניתן הציון הזה?</h4>
        <ul class="know-detail-card__bullet-list">
          ${
            Array.isArray(axisRecord.explanationBullets) && axisRecord.explanationBullets.length
              ? axisRecord.explanationBullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")
              : `<li>עדיין אין נימוקי ציון זמינים עבור התצוגה ${escapeHtml(activeView?.shortLabel || "")} בציר הזה.</li>`
          }
        </ul>
      </section>

      <section class="know-detail-card__section">
        <h4>ראיות תומכות</h4>
        <div class="know-detail-card__evidence">
          ${
            Array.isArray(axisRecord.evidence) && axisRecord.evidence.length
              ? axisRecord.evidence
                  .map(
                    (item) => `
                      <article class="know-detail-evidence-card">
                        <p class="know-detail-evidence-card__protocol">${
                          item.href
                            ? `<a href="${escapeHtml(item.href)}">${escapeHtml(item.protocolHeading || "")}</a>`
                            : escapeHtml(item.protocolHeading || "")
                        }</p>
                        <blockquote>${escapeHtml(item.quote || "")}</blockquote>
                        <p class="muted">${escapeHtml(item.explanation || "")}</p>
                      </article>
                    `,
                  )
                  .join("")
              : '<div class="landing-empty-card"><p class="muted">עדיין לא נשמרו קטעי ראיות עבור הציר הזה.</p></div>'
          }
        </div>
      </section>
      ${renderVoteBasedLawList(member, activeViewKey)}
    </article>
  `;
}

function renderPage() {
  if (elements.partySelect) {
    const parties = Array.isArray(state.data?.filters?.parties) ? state.data.filters.parties : [];
    const optionsMarkup = parties
      .map(
        (partyName) =>
          `<option value="${escapeHtml(partyName)}"${partyName === state.filters.party ? " selected" : ""}>${escapeHtml(
            partyName,
          )}</option>`,
      )
      .join("");

    elements.partySelect.innerHTML = `<option value="">כל המפלגות</option>${optionsMarkup}`;
    elements.partySelect.disabled = state.loading || Boolean(state.error);
  }

  if (elements.searchInput) {
    elements.searchInput.disabled = state.loading || Boolean(state.error);
  }

  renderViewSwitch();
  renderSummary();
  renderGapSection();
  renderAxes();
  renderDetail();
}

async function loadKnowYourMk() {
  state.loading = true;
  state.error = null;
  renderPage();

  try {
    const { response, payload } = await fetchJson("/api/landing/know-your-mk");

    if (!response.ok) {
      throw new Error(payload.error || "טעינת מפת חברי הכנסת נכשלה.");
    }

    state.data = normalizeKnowYourMkPayload(payload);
  } catch (error) {
    console.error(error);
    state.error = error.message || String(error);
  } finally {
    state.loading = false;
    renderPage();
  }
}

if (elements.viewSwitch) {
  elements.viewSwitch.addEventListener("click", (event) => {
    const token = event.target.closest("[data-know-view]");

    if (!token) {
      return;
    }

    state.activeView = token.dataset.knowView || "explicit";
    renderPage();
  });
}

if (elements.searchInput) {
  elements.searchInput.addEventListener("input", () => {
    state.filters.search = elements.searchInput.value;
    renderPage();
  });
}

if (elements.partySelect) {
  elements.partySelect.addEventListener("change", () => {
    state.filters.party = elements.partySelect.value;
    renderPage();
  });
}

if (elements.gaps) {
  elements.gaps.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-know-gap-member]");

    if (!trigger) {
      return;
    }

    state.selectedMemberSlug = trigger.dataset.knowGapMember || "";
    state.selectedAxisKey = trigger.dataset.knowGapAxis || DEFAULT_AXIS_KEY;
    renderPage();
    elements.detail?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

if (elements.axes) {
  elements.axes.addEventListener("click", (event) => {
    const token = event.target.closest("[data-know-member][data-know-axis]");

    if (!token) {
      return;
    }

    state.selectedMemberSlug = token.dataset.knowMember || "";
    state.selectedAxisKey = token.dataset.knowAxis || DEFAULT_AXIS_KEY;
    renderPage();
  });
}

if (elements.detail) {
  elements.detail.addEventListener("click", (event) => {
    if (event.target.closest(".know-detail-close-btn")) {
      state.selectedMemberSlug = "";
      elements.detail.classList.remove("is-open");
      renderPage();
      return;
    }

    const token = event.target.closest("[data-know-detail-axis]");

    if (!token) {
      return;
    }

    state.selectedAxisKey = token.dataset.knowDetailAxis || DEFAULT_AXIS_KEY;
    renderPage();
  });
}

renderPage();
void loadKnowYourMk();
