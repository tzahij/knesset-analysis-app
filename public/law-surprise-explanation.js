const titleElement = document.getElementById("explanation-title");
const metaElement = document.getElementById("explanation-meta");
const statusElement = document.getElementById("explanation-status");
const contentElement = document.getElementById("explanation-content");
const backLinkElement = document.getElementById("explanation-back-link");

const state = {
  pollTimer: null,
  autostartAttempted: false,
  lastRecord: null,
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
        throw new Error("The public tunnel returned an HTML error page instead of JSON.");
      }

      throw new Error("The server returned an invalid response.");
    }
  }

  return { response, payload };
}

function getRouteContext() {
  const segments = window.location.pathname.split("/").filter(Boolean);

  return {
    billId: segments[1] || "",
    memberSlug: segments[3] || "",
  };
}

function getApiUrl() {
  const { billId, memberSlug } = getRouteContext();
  return `/api/laws/${encodeURIComponent(billId)}/surprising-votes/${encodeURIComponent(memberSlug)}/explanation`;
}

function getBackUrl() {
  const { billId } = getRouteContext();
  return `/law/${encodeURIComponent(billId)}#analysis`;
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

function formatStage(stage) {
  switch (stage) {
    case "preparing_sources":
      return "Preparing sources";
    case "reading_member_quotes":
      return "Reading the MK's short quotes";
    case "analyzing":
      return "Gemini is generating the explanation";
    default:
      return "Working";
  }
}

function renderMeta(record) {
  const law = record?.law || {};
  const member = record?.member || {};
  const status = record?.status || {};
  const rows = [
    ["חוק", law.title || "לא זמין"],
    ["מספר הצעת חוק", law.billId || "לא זמין"],
    ["חבר כנסת", member.name || "לא זמין"],
    ["מפלגה", member.partyName || "לא זמין"],
    ["סטטוס", status.status || "idle"],
    ["עודכן לאחרונה", formatIsoDate(status.generatedAt || status.finishedAt || status.startedAt)],
  ];

  metaElement.innerHTML = rows
    .map(
      ([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>
      `,
    )
    .join("");

  titleElement.textContent = member.name
    ? `${member.name} · הסבר להצבעה`
    : "הסבר להצבעה מפתיעה";
  document.title = law.title && member.name ? `${member.name} · ${law.title}` : "הסבר להצבעה מפתיעה";
  backLinkElement.href = getBackUrl();
}

function renderStatus(record) {
  const status = record?.status || {};

  if (status.status === "running") {
    statusElement.innerHTML = `
      <div class="surprise-explanation-status-card is-running">
        <div class="surprise-explanation-status-card__row">
          <span class="loading-spinner" aria-hidden="true"></span>
          <div>
            <p class="eyebrow">Gemini</p>
            <h2>ההסבר נבנה עכשיו</h2>
          </div>
        </div>
        <p class="muted">${escapeHtml(formatStage(status.currentStage))}</p>
        <p class="muted">העמוד יתעדכן אוטומטית ברגע שההסבר יהיה מוכן.</p>
      </div>
    `;
    return;
  }

  if (status.status === "failed") {
    statusElement.innerHTML = `
      <div class="surprise-explanation-status-card is-error">
        <p class="eyebrow">Gemini</p>
        <h2>יצירת ההסבר נכשלה</h2>
        <p class="error-message">${escapeHtml(status.error || "Failed to create the explanation.")}</p>
        <button class="secondary-button" type="button" data-retry="1">נסה שוב</button>
      </div>
    `;
    return;
  }

  if (status.status === "not_surprising") {
    statusElement.innerHTML = `
      <div class="surprise-explanation-status-card">
        <p class="eyebrow">Status</p>
        <h2>ההצבעה הזו אינה מסומנת כמפתיעה</h2>
        <p class="muted">לכן אין עבורה הסבר זמין כרגע.</p>
      </div>
    `;
    return;
  }

  if (status.status === "completed") {
    statusElement.innerHTML = `
      <div class="surprise-explanation-status-card is-success">
        <p class="eyebrow">Gemini</p>
        <h2>ההסבר מוכן</h2>
        <p class="muted">נוצר בתאריך ${escapeHtml(formatIsoDate(status.generatedAt || status.finishedAt))}</p>
      </div>
    `;
    return;
  }

  statusElement.innerHTML = `
    <div class="surprise-explanation-status-card">
      <p class="eyebrow">Gemini</p>
      <h2>ההסבר עדיין לא נוצר</h2>
      <p class="muted">לחצו על הכפתור כדי להתחיל לנתח את ההצבעה.</p>
      <button class="primary-button" type="button" data-retry="1">התחל ניתוח</button>
    </div>
  `;
}

function renderExplanation(record) {
  const explanation = record?.explanation || null;
  const status = record?.status || {};

  if (!explanation) {
    contentElement.innerHTML =
      status.status === "running"
        ? ""
        : `
          <section class="law-content-card">
            <div class="law-content-card__header">
              <p class="eyebrow">Explanation</p>
              <h2>ההסבר יוצג כאן</h2>
            </div>
          </section>
        `;
    return;
  }

  contentElement.innerHTML = `
    <section class="law-surprise-explanation-panel surprise-explanation-page__section">
      <div class="law-surprise-explanation-summary">
        <p class="eyebrow">Bottom Line</p>
        <p>${escapeHtml(explanation.bottomLine || "")}</p>
      </div>

      <div class="law-surprise-hypotheses">
        ${(Array.isArray(explanation.hypotheses) ? explanation.hypotheses : [])
          .map(
            (hypothesis) => `
              <article class="law-surprise-hypothesis-card">
                <h3>${escapeHtml(hypothesis.title || "")}</h3>
                <p>${escapeHtml(hypothesis.explanation || "")}</p>
                ${
                  Array.isArray(hypothesis.memberEvidence) && hypothesis.memberEvidence.length
                    ? `
                      <div class="law-surprise-evidence-block">
                        <strong>מתוך דברי הח"כ</strong>
                        <ul>
                          ${hypothesis.memberEvidence
                            .map((item) => `<li>${escapeHtml(item)}</li>`)
                            .join("")}
                        </ul>
                      </div>
                    `
                    : ""
                }
                ${
                  Array.isArray(hypothesis.lawEvidence) && hypothesis.lawEvidence.length
                    ? `
                      <div class="law-surprise-evidence-block">
                        <strong>מתוך החוק</strong>
                        <ul>
                          ${hypothesis.lawEvidence
                            .map((item) => `<li>${escapeHtml(item)}</li>`)
                            .join("")}
                        </ul>
                      </div>
                    `
                    : ""
                }
              </article>
            `,
          )
          .join("")}
      </div>

      ${
        explanation.caution
          ? `<p class="law-surprise-caution">${escapeHtml(explanation.caution)}</p>`
          : ""
      }
    </section>
  `;
}

function syncPolling() {
  const status = state.lastRecord?.status?.status;

  if (status === "running") {
    if (!state.pollTimer) {
      state.pollTimer = window.setInterval(() => {
        void loadRecord();
      }, 4000);
    }
    return;
  }

  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function startExplanation(force = false) {
  const { response, payload } = await fetchJson(`${getApiUrl()}${force ? "?force=1" : ""}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(payload.error || "Failed to start the explanation");
  }

  state.lastRecord = payload;
  renderMeta(payload);
  renderStatus(payload);
  renderExplanation(payload);
  syncPolling();
}

async function loadRecord() {
  const { response, payload } = await fetchJson(getApiUrl());

  if (!response.ok) {
    throw new Error(payload.error || "Failed to load the explanation");
  }

  state.lastRecord = payload;
  renderMeta(payload);
  renderStatus(payload);
  renderExplanation(payload);
  syncPolling();

  const params = new URLSearchParams(window.location.search);
  const shouldAutostart = params.get("autostart") === "1";
  const force = params.get("force") === "1";
  const status = payload?.status?.status || "idle";
  const isStale = Boolean(payload?.status?.isStale);

  if (
    shouldAutostart &&
    !state.autostartAttempted &&
    (status === "idle" || status === "failed" || isStale)
  ) {
    state.autostartAttempted = true;
    await startExplanation(force || isStale);
  }
}

statusElement.addEventListener("click", (event) => {
  const retryButton = event.target.closest("[data-retry]");

  if (!retryButton) {
    return;
  }

  state.autostartAttempted = true;
  statusElement.innerHTML = `
    <div class="surprise-explanation-status-card is-running">
      <div class="surprise-explanation-status-card__row">
        <span class="loading-spinner" aria-hidden="true"></span>
        <div>
          <p class="eyebrow">Gemini</p>
          <h2>ההסבר נבנה עכשיו</h2>
        </div>
      </div>
    </div>
  `;

  void startExplanation(true).catch((error) => {
    renderStatus({
      ...state.lastRecord,
      status: {
        ...(state.lastRecord?.status || {}),
        status: "failed",
        error: error.message || String(error),
      },
    });
  });
});

void loadRecord().catch((error) => {
  titleElement.textContent = "שגיאה בטעינת ההסבר";
  statusElement.innerHTML = `
    <div class="surprise-explanation-status-card is-error">
      <p class="eyebrow">Error</p>
      <h2>לא ניתן לטעון את ההסבר</h2>
      <p class="error-message">${escapeHtml(error.message || String(error))}</p>
    </div>
  `;
  contentElement.innerHTML = "";
});
