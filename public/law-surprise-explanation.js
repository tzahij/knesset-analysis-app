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



function renderExplanation(record) {
  const explanation = record?.explanation || null;
  const status = record?.status || {};

  if (!explanation) {
    contentElement.innerHTML = `
      <section class="law-content-card">
        <div class="law-content-card__header">
          <p class="eyebrow">Explanation</p>
          <h2>ההסבר לא זמין</h2>
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



async function loadRecord() {
  const { response, payload } = await fetchJson(getApiUrl());

  if (!response.ok) {
    throw new Error(payload.error || "Failed to load the explanation");
  }

  state.lastRecord = payload;
  renderMeta(payload);
  renderExplanation(payload);
}



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
