const contentElement = document.getElementById("law-content");
const summaryElement = document.getElementById("law-summary");
const loadingElement = document.getElementById("reader-loading");
const titleElement = document.getElementById("law-title");
const metaElement = document.getElementById("law-meta");
const downloadPdfButton = document.getElementById("download-pdf-button");
const downloadWordButton = document.getElementById("download-word-button");
const lawTextTabButton = document.getElementById("law-text-tab");
const lawVotesTabButton = document.getElementById("law-votes-tab");
const lawAnalysisTabButton = document.getElementById("law-analysis-tab");
const lawTextPanelElement = document.getElementById("law-text-panel");
const lawVotesPanelElement = document.getElementById("law-votes-panel");
const lawAnalysisPanelElement = document.getElementById("law-analysis-panel");
const lawVotesContentElement = document.getElementById("law-votes-content");
const lawAnalysisContentElement = document.getElementById("law-analysis-content");

const FALLBACK_AXES = [
  {
    key: "religiousSecular",
    label: "דתי מול חילוני",
    lowLabel: "חילוני",
    highLabel: "דתי",
  },
  {
    key: "socialismCapitalism",
    label: "סוציאליזם מול קפיטליזם",
    lowLabel: "סוציאליסטי",
    highLabel: "קפיטליסטי",
  },
  {
    key: "doveHawk",
    label: "יוני מול נצי",
    lowLabel: "יוני",
    highLabel: "נצי",
  },
  {
    key: "liberalDemocracyAuthoritarianism",
    label: "דמוקרטיה ליברלית מול סמכותנות",
    lowLabel: "דמוקרטיה ליברלית",
    highLabel: "סמכותנות",
  },
];

const state = {
  activeTab: "text",
  lawContentLoaded: false,
  votesLoaded: false,
  votesLoading: false,
  analysisLoaded: false,
  analysisLoading: false,
  analysisRecord: null,
  analysisPollTimer: null,
  surpriseExplanationRecords: {},
  surpriseExplanationPollTimer: null,
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
        throw new Error(
          "The public tunnel returned an HTML error page instead of JSON. Refresh and try again.",
        );
      }

      throw new Error("The server returned an invalid response.");
    }
  }

  return { response, payload };
}

function getBillIdFromPath() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments[segments.length - 1];
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

function updateHash(tab) {
  const suffix = tab === "text" ? "" : `#${tab}`;
  window.history.replaceState(null, "", `${window.location.pathname}${suffix}`);
}

function syncAnalysisPolling() {
  const status = state.analysisRecord?.status;
  const bulkStatus = state.analysisRecord?.bulkStatus;
  const shouldPoll =
    state.activeTab === "analysis" &&
    (status?.status === "running" ||
      (!state.analysisRecord?.analysis && bulkStatus?.status === "running"));

  if (shouldPoll) {
    if (!state.analysisPollTimer) {
      state.analysisPollTimer = window.setInterval(() => {
        void loadAnalysis();
      }, 4000);
    }
    return;
  }

  if (state.analysisPollTimer) {
    window.clearInterval(state.analysisPollTimer);
    state.analysisPollTimer = null;
  }
}

function getCurrentSurprisingVotes() {
  return Array.isArray(state.analysisRecord?.surprisingVotes?.surprisingVotes)
    ? state.analysisRecord.surprisingVotes.surprisingVotes
    : [];
}

function mergeSurpriseExplanationRecordsFromPayload(payload) {
  const items = Array.isArray(payload?.surprisingVotes?.surprisingVotes)
    ? payload.surprisingVotes.surprisingVotes
    : [];

  for (const item of items) {
    if (item?.routeSlug && item.explanationRecord) {
      state.surpriseExplanationRecords[item.routeSlug] = item.explanationRecord;
    }
  }
}

function syncSurpriseExplanationPolling() {
  const shouldPoll =
    state.activeTab === "analysis" &&
    getCurrentSurprisingVotes().some(
      (item) => state.surpriseExplanationRecords[item.routeSlug]?.status?.status === "running",
    );

  if (shouldPoll) {
    if (!state.surpriseExplanationPollTimer) {
      state.surpriseExplanationPollTimer = window.setInterval(() => {
        void refreshRunningSurpriseExplanations();
      }, 4000);
    }
    return;
  }

  if (state.surpriseExplanationPollTimer) {
    window.clearInterval(state.surpriseExplanationPollTimer);
    state.surpriseExplanationPollTimer = null;
  }
}

function renderMetaRows(law, payload) {
  const rows = [
    ["תאריך פרסום", law.publicationDate ? new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date(law.publicationDate)) : "לא זמין"],
    ["מספר הצעת חוק", law.billId],
  ];

  metaElement.innerHTML = rows
    .map(
      ([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value ?? "-")}</dd>
        </div>
      `,
    )
    .join("");
}

function renderSummary(paragraphs) {
  summaryElement.innerHTML = `
    <section class="law-summary-card">
      <div class="law-summary-card__header">
        <p class="eyebrow">Overview</p>
        <h2>תיאור החוק</h2>
      </div>
      <div class="law-summary-card__body">
        ${paragraphs.length ? paragraphs.map((paragraph) => `<p class="formatted-paragraph">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("") : '<p class="muted">תקציר החוק לא זמין.</p>'}
      </div>
    </section>
  `;
}

function renderContent(paragraphs, parseError) {
  contentElement.innerHTML = "";
}

function configureButtons(billId, payload) {
  if (payload.availableDownloads?.pdf) {
    downloadPdfButton.hidden = false;
    downloadPdfButton.href = `/api/laws/${encodeURIComponent(billId)}/download?kind=pdf`;
  } else {
    downloadPdfButton.hidden = true;
  }

  if (payload.availableDownloads?.word) {
    downloadWordButton.hidden = false;
    downloadWordButton.href = `/api/laws/${encodeURIComponent(billId)}/download?kind=word`;
  } else {
    downloadWordButton.hidden = true;
  }
}

function setActiveTab(tab) {
  state.activeTab = tab;
  const isTextTab = tab === "text";
  const isVotesTab = tab === "votes";
  const isAnalysisTab = tab === "analysis";

  lawTextTabButton.classList.toggle("is-active", isTextTab);
  lawTextTabButton.setAttribute("aria-selected", isTextTab ? "true" : "false");
  lawVotesTabButton.classList.toggle("is-active", isVotesTab);
  lawVotesTabButton.setAttribute("aria-selected", isVotesTab ? "true" : "false");
  lawAnalysisTabButton.classList.toggle("is-active", isAnalysisTab);
  lawAnalysisTabButton.setAttribute("aria-selected", isAnalysisTab ? "true" : "false");
  lawTextPanelElement.hidden = !isTextTab;
  lawVotesPanelElement.hidden = !isVotesTab;
  lawAnalysisPanelElement.hidden = !isAnalysisTab;
  updateHash(tab);

  if (isVotesTab && !state.votesLoaded && !state.votesLoading) {
    void loadVotes();
  }

  if (isAnalysisTab && (!state.analysisLoaded || !state.analysisRecord?.analysis) && !state.analysisLoading) {
    void loadAnalysis();
  }

  syncAnalysisPolling();
  syncSurpriseExplanationPolling();
}

function renderVoteMembers(items) {
  if (!items.length) {
    return '<p class="muted">לא הופיעו שמות בקטגוריה הזאת.</p>';
  }

  return `
    <ul class="law-vote-member-list">
      ${items
        .map((item) => {
          const nameMarkup = item.routeSlug
            ? `<a class="law-vote-member-link" href="/members/${encodeURIComponent(item.routeSlug)}">${escapeHtml(item.displayName)}</a>`
            : `<span class="law-vote-member-name">${escapeHtml(item.displayName)}</span>`;

          return `
            <li class="law-vote-member-item">
              ${nameMarkup}
              <span class="law-vote-member-party">${escapeHtml(item.partyName || "ללא מפלגה")}</span>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

function renderVoteGroup(title, description, items, toneClass) {
  return `
    <section class="law-vote-group ${toneClass}">
      <div class="law-vote-group__header">
        <h3>${escapeHtml(title)}</h3>
        <span class="law-vote-group__count">${Number(items.length || 0).toLocaleString("he-IL")}</span>
      </div>
      <p class="muted">${escapeHtml(description)}</p>
      ${renderVoteMembers(items)}
    </section>
  `;
}

function renderVoteCounters(vote) {
  if (!Array.isArray(vote.counters) || !vote.counters.length) {
    return "";
  }

  return `
    <section class="law-vote-counters">
      ${vote.counters
        .map(
          (counter) => `
            <div class="law-vote-counter-row">
              <span>${escapeHtml(counter.title || "ללא כותרת")}</span>
              <strong>${Number(counter.count || 0).toLocaleString("he-IL")}</strong>
            </div>
          `,
        )
        .join("")}
    </section>
  `;
}

function renderVotes(payload) {
  const record = payload?.votes;

  if (!record) {
    lawVotesContentElement.innerHTML = `
      <section class="law-content-card">
        <div class="law-content-card__header">
          <p class="eyebrow">Voting</p>
          <h2>תוצאות ההצבעה</h2>
        </div>
        <p class="muted">עדיין לא נמצאו נתוני הצבעה לחוק הזה.</p>
      </section>
    `;
    return;
  }

  if (record.status === "error") {
    lawVotesContentElement.innerHTML = `
      <section class="law-content-card">
        <div class="law-content-card__header">
          <p class="eyebrow">Voting</p>
          <h2>תוצאות ההצבעה</h2>
        </div>
        <p class="error-message">${escapeHtml(record.reason || "טעינת ההצבעה נכשלה.")}</p>
      </section>
    `;
    return;
  }

  if (record.status !== "matched" || !record.vote) {
    lawVotesContentElement.innerHTML = `
      <section class="law-content-card">
        <div class="law-content-card__header">
          <p class="eyebrow">Voting</p>
          <h2>תוצאות ההצבעה</h2>
        </div>
        <p class="muted">${escapeHtml(record.reason || "לא נמצאה עדיין הצבעת קריאה שלישית תואמת לחוק הזה.")}</p>
      </section>
    `;
    return;
  }

  const vote = record.vote;
  const groups = vote.groups || {};
  const metaParts = [
    vote.voteDateStr || "תאריך לא זמין",
    vote.voteTimeStr ? `שעה ${vote.voteTimeStr}` : "",
    vote.voteType || "",
    vote.sessionNumber ? `ישיבה ${vote.sessionNumber}` : "",
  ].filter(Boolean);

  lawVotesContentElement.innerHTML = `
    <section class="law-vote-header-card">
      <div class="law-content-card__header">
        <p class="eyebrow">Voting</p>
        <h2>מי הצביעו בעד, נגד או נמנעו</h2>
      </div>

      <div class="law-vote-meta-grid">
        <div>
          <span class="law-vote-meta-grid__label">מועד ההצבעה</span>
          <strong>${escapeHtml(metaParts.join(" · "))}</strong>
        </div>
        <div>
          <span class="law-vote-meta-grid__label">יושב-ראש</span>
          <strong>${escapeHtml(vote.chairmanName || "לא זמין")}</strong>
        </div>
      </div>

      <p class="law-vote-decision">${escapeHtml(vote.decision || vote.acceptedText || "ההצעה התקבלה בקריאה שלישית.")}</p>
      ${vote.acceptedText ? `<p class="muted">${escapeHtml(vote.acceptedText)}</p>` : ""}
      ${renderVoteCounters(vote)}
      ${
        vote.pdfUrl
          ? `<a class="secondary-button inline-action law-vote-pdf-link" href="${escapeHtml(vote.pdfUrl)}" target="_blank" rel="noreferrer">פתח את PDF ההצבעה הרשמי</a>`
          : ""
      }
      <p class="muted">המערכת קישרה שמות של חברי כנסת לעמודי הפרופיל שלהם כאשר נמצאה התאמה ברישום חברי הכנסת שבאתר.</p>
    </section>

    <section class="law-vote-groups">
      ${renderVoteGroup("בעד", "חברי הכנסת שתמכו בהצעת החוק בקריאה השלישית.", groups.for || [], "is-for")}
      ${renderVoteGroup("נגד", "חברי הכנסת שהתנגדו להצעת החוק.", groups.against || [], "is-against")}
      ${renderVoteGroup("נמנעו", "חברי הכנסת שנמנעו בהצבעה.", groups.abstained || [], "is-abstained")}
      ${renderVoteGroup("נוכחים / אחרים", "נוכחים שלא הצביעו או תוצאות שאינן נופלות לאחת משלוש הקטגוריות המרכזיות.", [...(groups.present || []), ...(groups.other || [])], "is-present")}
    </section>

    <p class="muted law-vote-footnote">ההתאמה נשמרה במטמון המקומי ב-${escapeHtml(formatIsoDate(record.matchedAt))}.</p>
  `;
}

function renderAnalysisAxis(axis, axisAnalysis) {
  const score = Number(axisAnalysis?.score || 1);
  const markerPercent = Math.max(0, Math.min(100, ((score - 1) / 9) * 100));
  const explanationBullets = Array.isArray(axisAnalysis?.explanationBullets)
    ? axisAnalysis.explanationBullets
    : [];
  const supportingPassages = Array.isArray(axisAnalysis?.supportingPassages)
    ? axisAnalysis.supportingPassages
    : [];

  return `
    <article class="law-analysis-axis-card">
      <div class="law-analysis-axis-card__header">
        <div>
          <p class="eyebrow">Axis</p>
          <h3>${escapeHtml(axis.label)}</h3>
        </div>
        <div class="law-analysis-score-badge">${score}/10</div>
      </div>

      <div class="law-analysis-axis-scale">
        <div class="law-analysis-axis-labels">
          <span>1 · ${escapeHtml(axis.lowLabel)}</span>
          <span>10 · ${escapeHtml(axis.highLabel)}</span>
        </div>
        <div class="law-analysis-axis-track">
          <div class="law-analysis-axis-track__ticks">
            ${Array.from({ length: 10 }, (_, index) => `<span>${index + 1}</span>`).join("")}
          </div>
          <div class="law-analysis-axis-marker" style="left: calc(${markerPercent}% - 18px);">
            ${score}
          </div>
        </div>
      </div>

      <ul class="law-analysis-bullets">
        ${explanationBullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
      </ul>

      ${
        supportingPassages.length
          ? `
            <div class="law-analysis-evidence">
              <h4>תימוכין מתוך החוק</h4>
              ${supportingPassages
                .map((passage) => `<blockquote>${escapeHtml(passage)}</blockquote>`)
                .join("")}
            </div>
          `
          : ""
      }
    </article>
  `;
}

function getSurpriseExplanationRecord(item) {
  return state.surpriseExplanationRecords[item.routeSlug] || item.explanationRecord || null;
}

function formatSurpriseExplanationStage(stage) {
  switch (stage) {
    case "preparing_sources":
      return "Preparing sources";
    case "reading_member_quotes":
      return "Reading the MK's short quotes";
    case "analyzing":
      return "Gemini is writing the explanation";
    default:
      return "Working";
  }
}

function buildSurpriseExplanationViewUrl(memberSlug, options = {}) {
  const billId = getBillIdFromPath();
  const params = new URLSearchParams();

  if (options.autostart) {
    params.set("autostart", "1");
  }

  if (options.force) {
    params.set("force", "1");
  }

  const query = params.toString();
  return `/law/${encodeURIComponent(billId)}/surprising-votes/${encodeURIComponent(memberSlug)}/explanation/view${query ? `?${query}` : ""}`;
}

function getSurpriseExplanationButtonLabel(record) {
  const status = record?.status?.status || "idle";

  if (status === "running") {
    return "מנתח...";
  }

  if (status === "completed") {
    return record.status.isStale ? "רענן הסבר" : "הסבר מחדש";
  }

  if (status === "failed") {
    return "נסה שוב";
  }

  return "הסבר את ההצבעה";
}

function renderSurpriseExplanationPanel(record, item) {
  const status = record?.status || null;
  const explanation = record?.explanation || null;
  const explanationUrl = item?.routeSlug ? buildSurpriseExplanationViewUrl(item.routeSlug) : "";

  if (!status || status.status === "idle") {
    return "";
  }

  if (status.status === "running") {
    return `
      <div class="law-surprise-explanation-panel is-running">
        <div class="law-surprise-explanation-status-row">
          <span class="loading-spinner" aria-hidden="true"></span>
          <div>
            <p class="eyebrow">Explanation</p>
            <p>Gemini is working on the explanation in the background.</p>
          </div>
        </div>
        <p class="muted">${escapeHtml(formatSurpriseExplanationStage(status.currentStage))}</p>
        ${
          explanationUrl
            ? `<a class="secondary-button inline-action" href="${explanationUrl}" target="_blank" rel="noopener">פתח את עמוד ההסבר</a>`
            : ""
        }
      </div>
    `;
  }

  if (status.status === "failed") {
    return `
      <div class="law-surprise-explanation-panel is-error">
        <p class="eyebrow">Explanation</p>
        <p class="error-message">${escapeHtml(status.error || "יצירת ההסבר נכשלה.")}</p>
        ${
          explanationUrl
            ? `<a class="secondary-button inline-action" href="${buildSurpriseExplanationViewUrl(item.routeSlug, { autostart: true, force: true })}" target="_blank" rel="noopener">נסה שוב בעמוד ייעודי</a>`
            : ""
        }
      </div>
    `;
  }

  if (status.status === "not_surprising") {
    return `
      <div class="law-surprise-explanation-panel">
        <p class="muted">ההצבעה הזאת אינה מסומנת כרגע כהצבעה מפתיעה, ולכן אין עבורה הסבר זמין.</p>
      </div>
    `;
  }

  if (!explanation) {
    return explanationUrl
      ? `
        <div class="law-surprise-explanation-panel">
          <p class="muted">ההסבר נשמר וניתן לפתוח אותו בעמוד ייעודי.</p>
          <a class="secondary-button inline-action" href="${explanationUrl}" target="_blank" rel="noopener">פתח את עמוד ההסבר</a>
        </div>
      `
      : "";
  }

  return `
    <div class="law-surprise-explanation-panel">
      ${
        explanationUrl
          ? `<div class="law-surprise-explanation-actions"><a class="secondary-button inline-action" href="${explanationUrl}" target="_blank" rel="noopener">פתח את ההסבר המלא בלשונית חדשה</a></div>`
          : ""
      }
      <div class="law-surprise-explanation-summary">
        <p class="eyebrow">Bottom Line</p>
        <p>${escapeHtml(explanation.bottomLine || "")}</p>
      </div>

      <div class="law-surprise-hypotheses">
        ${(Array.isArray(explanation.hypotheses) ? explanation.hypotheses : [])
          .map(
            (hypothesis) => `
              <article class="law-surprise-hypothesis-card">
                <h5>${escapeHtml(hypothesis.title || "")}</h5>
                <p>${escapeHtml(hypothesis.explanation || "")}</p>
                ${
                  Array.isArray(hypothesis.memberEvidence) && hypothesis.memberEvidence.length
                    ? `
                      <div class="law-surprise-evidence-block">
                        <strong>מתוך דברי הח"כ</strong>
                        <ul>
                          ${hypothesis.memberEvidence
                            .map((evidenceItem) => `<li>${escapeHtml(evidenceItem)}</li>`)
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
                            .map((evidenceItem) => `<li>${escapeHtml(evidenceItem)}</li>`)
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
    </div>
  `;

  if (!status || status.status === "idle") {
    return "";
  }

  if (status.status === "running") {
    return `
      <div class="law-surprise-explanation-panel is-running">
        <p class="eyebrow">Explanation</p>
        <p>Gemini מנסה כעת להסביר איך חבר הכנסת יישב את הפער בין עמדותיו לבין ההצבעה בפועל.</p>
      </div>
    `;
  }

  if (status.status === "failed") {
    return `
      <div class="law-surprise-explanation-panel is-error">
        <p class="eyebrow">Explanation</p>
        <p class="error-message">${escapeHtml(status.error || "יצירת ההסבר נכשלה.")}</p>
      </div>
    `;
  }

  if (status.status === "not_surprising") {
    return `
      <div class="law-surprise-explanation-panel">
        <p class="muted">ההצבעה הזאת אינה מסומנת כרגע כהצבעה מפתיעה, ולכן אין עבורה הסבר זמין.</p>
      </div>
    `;
  }

  if (!explanation) {
    return "";
  }

  return `
    <div class="law-surprise-explanation-panel">
      <div class="law-surprise-explanation-summary">
        <p class="eyebrow">Bottom Line</p>
        <p>${escapeHtml(explanation.bottomLine || "")}</p>
      </div>

      <div class="law-surprise-hypotheses">
        ${(Array.isArray(explanation.hypotheses) ? explanation.hypotheses : [])
          .map(
            (hypothesis) => `
              <article class="law-surprise-hypothesis-card">
                <h5>${escapeHtml(hypothesis.title || "")}</h5>
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
    </div>
  `;
}

function renderSurprisingVoteItem(item) {
  const explanationRecord = getSurpriseExplanationRecord(item);
  const explanationStatus = explanationRecord?.status?.status || "idle";
  const isRunning = explanationStatus === "running";

  return `
    <article class="law-surprise-vote-card">
      <div class="law-surprise-vote-card__header">
        <div>
          <h4>
            ${
              item.routeSlug
                ? `<a href="/members/${encodeURIComponent(item.routeSlug)}">${escapeHtml(item.memberName)}</a>`
                : escapeHtml(item.memberName)
            }
          </h4>
          <p class="muted">${escapeHtml(item.partyName || "ללא מפלגה")} · ${escapeHtml(item.voteLabel || "בעד")}</p>
        </div>
        <div class="law-surprise-vote-card__actions">
          <span class="law-surprise-vote-card__badge">פער מקסימלי ${Number(item.maximumDifference || 0).toLocaleString("he-IL")}</span>
          <button
            class="secondary-button compact-button ${isRunning ? "is-loading" : ""}"
            type="button"
            data-surprise-explain="${escapeHtml(item.routeSlug || "")}"
            data-requires-role="admin"
            ${isRunning ? "disabled" : ""}
          >
            ${isRunning ? '<span class="loading-spinner" aria-hidden="true"></span>' : ""}
            ${escapeHtml(getSurpriseExplanationButtonLabel(explanationRecord))}
          </button>
        </div>
      </div>

      <div class="law-surprise-diff-list">
        ${(Array.isArray(item.allAxisDiffs) ? item.allAxisDiffs : [])
          .map((axis) => {
            const isSurprising = (Array.isArray(item.surpriseAxes) ? item.surpriseAxes : []).some(
              (candidate) => candidate.key === axis.key,
            );

            return `
              <div class="law-surprise-diff-row ${isSurprising ? "is-surprising" : ""}">
                <strong>${escapeHtml(axis.label)}</strong>
                <span>חוק ${axis.lawScore}/10 · ח"כ ${axis.memberScore}/10 · פער ${axis.difference}/10</span>
              </div>
            `;
          })
          .join("")}
      </div>

      ${renderSurpriseExplanationPanel(explanationRecord, item)}
    </article>
  `;
}

function renderSurprisingVotesSection(payload) {
  const surprisingVotes = payload?.surprisingVotes;

  if (!surprisingVotes) {
    return "";
  }

  if (surprisingVotes.status === "missing_law_analysis") {
    return `
      <section class="law-surprise-shell">
        <div class="law-content-card__header">
          <p class="eyebrow">Surprising Votes</p>
          <h3>Surprising Votes · הצבעות מפתיעות</h3>
        </div>
        <p class="muted">החלק הזה יופיע לאחר שייווצר ניתוח אידיאולוגי לחוק.</p>
      </section>
    `;
  }

  if (surprisingVotes.status === "missing_vote_breakdown") {
    return `
      <section class="law-surprise-shell">
        <div class="law-content-card__header">
          <p class="eyebrow">Surprising Votes</p>
          <h3>Surprising Votes · הצבעות מפתיעות</h3>
        </div>
        <p class="muted">לא ניתן לחשב הצבעות מפתיעות לפני שנמצאה התאמת הצבעה לחוק הזה.</p>
      </section>
    `;
  }

  return `
    <section class="law-surprise-shell">
      <div class="law-content-card__header">
        <p class="eyebrow">Surprising Votes</p>
        <h3>Surprising Votes · הצבעות מפתיעות</h3>
      </div>

      <div class="law-surprise-overview">
        <div class="law-surprise-stat">
          <span class="law-surprise-stat__label">קולות בעד שנבדקו</span>
          <strong>${Number(surprisingVotes.summary?.consideredSupportVotes || 0).toLocaleString("he-IL")}</strong>
        </div>
        <div class="law-surprise-stat">
          <span class="law-surprise-stat__label">הצבעות מפתיעות</span>
          <strong>${Number(surprisingVotes.summary?.surprisingSupportVotes || 0).toLocaleString("he-IL")}</strong>
        </div>
        <div class="law-surprise-stat">
          <span class="law-surprise-stat__label">דולגו בלי ניתוח ח"כ</span>
          <strong>${Number(surprisingVotes.summary?.skippedMissingMemberAnalysis || 0).toLocaleString("he-IL")}</strong>
        </div>
        <div class="law-surprise-stat">
          <span class="law-surprise-stat__label">דולגו בגלל מעט הצבעות</span>
          <strong>${Number(surprisingVotes.summary?.skippedLowVoteCoverage || 0).toLocaleString("he-IL")}</strong>
        </div>
      </div>

      <div class="law-surprise-methodology">
        <h4>המתודולוגיה</h4>
        <ul>
          ${(Array.isArray(surprisingVotes.methodology) ? surprisingVotes.methodology : [])
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join("")}
        </ul>
      </div>

      ${
        Array.isArray(surprisingVotes.surprisingVotes) && surprisingVotes.surprisingVotes.length
          ? `
            <div class="law-surprise-vote-list">
              ${surprisingVotes.surprisingVotes.map(renderSurprisingVoteItem).join("")}
            </div>
          `
          : `<p class="muted">לא נמצאו במקרה הזה קולות בעד שחורגים ב-${Number(
              surprisingVotes.threshold || 0,
            ).toLocaleString("he-IL")} נקודות או יותר לפחות באחד הצירים לעומת עמדות הח"כים כפי שעלו מהקובץ הקטן.</p>`
      }
    </section>
  `;
}

function renderAnalysisEmptyState(title, body, extraMarkup = "") {
  lawAnalysisContentElement.innerHTML = `
    <section class="law-content-card">
      <div class="law-content-card__header">
        <p class="eyebrow">Analysis</p>
        <h2>${escapeHtml(title)}</h2>
      </div>
      <p class="muted">${escapeHtml(body)}</p>
      ${extraMarkup}
    </section>
  `;
}

function renderAnalysis(payload) {
  mergeSurpriseExplanationRecordsFromPayload(payload);
  state.analysisRecord = payload;

  const record = payload?.analysis || null;
  const status = payload?.status || {};
  const bulkStatus = payload?.bulkStatus || {};
  const axes = Array.isArray(payload?.axes) && payload.axes.length ? payload.axes : FALLBACK_AXES;

  if (status.status === "failed") {
    renderAnalysisEmptyState(
      "ניתוח החוק נכשל",
      status.error || "אירעה שגיאה בזמן ניתוח החוק.",
    );
    syncAnalysisPolling();
    syncSurpriseExplanationPolling();
    return;
  }

  if (!record) {
    if (bulkStatus.status === "running") {
      renderAnalysisEmptyState(
        "החוק עדיין ממתין לניתוח",
        "כעת רצה בדיקת Gemini לכל החוקים שעדיין לא נותחו. הטאב יתעדכן אוטומטית כאשר הניתוח של החוק הזה יושלם.",
        `
          <div class="law-analysis-status-card">
            <p><strong>${Number(bulkStatus.processedLaws || 0).toLocaleString("he-IL")}</strong> מתוך <strong>${Number(
              bulkStatus.totalLaws || 0,
            ).toLocaleString("he-IL")}</strong> חוקים כבר נבדקו.</p>
            ${
              bulkStatus.current
                ? `<p class="muted">מטפל כעת ב: ${escapeHtml(bulkStatus.current.title || "")}</p>`
                : ""
            }
          </div>
        `,
      );
      syncAnalysisPolling();
      syncSurpriseExplanationPolling();
      return;
    }

    renderAnalysisEmptyState(
      "החוק עדיין לא נותח",
      "כדי לייצר ניתוח אידיאולוגי לחוק הזה, עברו לעמוד הראשי, ללשונית החוקים, ולחצו על כפתור הניתוח הקבוצתי.",
      '<a class="secondary-button inline-action" href="/">חזרה לעמוד הראשי</a>',
    );
    syncAnalysisPolling();
    syncSurpriseExplanationPolling();
    return;
  }

  lawAnalysisContentElement.innerHTML = `
    <section class="law-analysis-overview-card">
      <div class="law-content-card__header">
        <p class="eyebrow">Analysis</p>
        <h2>מפת הצירים האידיאולוגית של החוק</h2>
      </div>
      <p class="law-analysis-overview-card__summary">${escapeHtml(record.overallSummary || "")}</p>
      <div class="law-analysis-meta-row">
        <span>נותח ב-${escapeHtml(formatIsoDate(status.generatedAt || status.finishedAt))}</span>
        <span>${escapeHtml(status.model || bulkStatus.model || "Gemini")}</span>
        ${
          status.isStale
            ? '<span class="law-analysis-stale-pill">הניתוח מבוסס על גרסה ישנה יותר של החומר</span>'
            : ""
        }
      </div>
    </section>

    <section class="law-analysis-axis-grid">
      ${axes.map((axis) => renderAnalysisAxis(axis, record[axis.key])).join("")}
    </section>

    ${renderSurprisingVotesSection(payload)}
  `;

  syncAnalysisPolling();
  syncSurpriseExplanationPolling();
}

async function loadVotes(forceRefresh = false) {
  const billId = getBillIdFromPath();
  state.votesLoading = true;

  lawVotesContentElement.innerHTML = `
    <section class="law-content-card">
      <div class="law-content-card__header">
        <p class="eyebrow">Voting</p>
        <h2>תוצאות ההצבעה</h2>
      </div>
      <p class="muted">טוען את נתוני ההצבעה של החוק הזה...</p>
    </section>
  `;

  try {
    const suffix = forceRefresh ? "?refresh=1" : "";
    const { response, payload } = await fetchJson(
      `/api/laws/${encodeURIComponent(billId)}/votes${suffix}`,
    );

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load the vote breakdown");
    }

    state.votesLoaded = true;
    renderVotes(payload);
  } catch (error) {
    lawVotesContentElement.innerHTML = `
      <section class="law-content-card">
        <div class="law-content-card__header">
          <p class="eyebrow">Voting</p>
          <h2>תוצאות ההצבעה</h2>
        </div>
        <p class="error-message">${escapeHtml(error.message || String(error))}</p>
      </section>
    `;
  } finally {
    state.votesLoading = false;
  }
}

async function loadAnalysis() {
  const billId = getBillIdFromPath();
  state.analysisLoading = true;

  lawAnalysisContentElement.innerHTML = `
    <section class="law-content-card">
      <div class="law-content-card__header">
        <p class="eyebrow">Analysis</p>
        <h2>ניתוח אידיאולוגי של החוק</h2>
      </div>
      <p class="muted">טוען את ניתוח Gemini של החוק הזה...</p>
    </section>
  `;

  try {
    const { response, payload } = await fetchJson(
      `/api/laws/${encodeURIComponent(billId)}/analysis`,
    );

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load the law analysis");
    }

    state.analysisLoaded = true;
    renderAnalysis(payload);
  } catch (error) {
    renderAnalysisEmptyState("לא ניתן לטעון את ניתוח החוק", error.message || String(error));
  } finally {
    state.analysisLoading = false;
  }
}

async function fetchSurpriseExplanationRecord(memberSlug) {
  const billId = getBillIdFromPath();
  const { response, payload } = await fetchJson(
    `/api/laws/${encodeURIComponent(billId)}/surprising-votes/${encodeURIComponent(memberSlug)}/explanation`,
  );

  if (!response.ok) {
    throw new Error(payload.error || "Failed to load the vote explanation");
  }

  state.surpriseExplanationRecords[memberSlug] = payload;
  return payload;
}

async function refreshRunningSurpriseExplanations() {
  const runningSlugs = getCurrentSurprisingVotes()
    .map((item) => item.routeSlug)
    .filter((slug) => state.surpriseExplanationRecords[slug]?.status?.status === "running");

  if (!runningSlugs.length) {
    syncSurpriseExplanationPolling();
    return;
  }

  await Promise.all(
    runningSlugs.map(async (memberSlug) => {
      try {
        await fetchSurpriseExplanationRecord(memberSlug);
      } catch (error) {
        state.surpriseExplanationRecords[memberSlug] = {
          status: {
            status: "failed",
            error: error.message || String(error),
          },
          explanation: null,
        };
      }
    }),
  );

  if (state.analysisRecord) {
    renderAnalysis(state.analysisRecord);
  }
}

async function startSurpriseExplanation(memberSlug) {
  const billId = getBillIdFromPath();
  state.surpriseExplanationRecords[memberSlug] = {
    status: {
      status: "running",
      memberSlug,
    },
    explanation: null,
  };

  if (state.analysisRecord) {
    renderAnalysis(state.analysisRecord);
  }

  try {
    const { response, payload } = await fetchJson(
      `/api/laws/${encodeURIComponent(billId)}/surprising-votes/${encodeURIComponent(memberSlug)}/explanation`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(payload.error || "Failed to start the vote explanation");
    }

    state.surpriseExplanationRecords[memberSlug] = payload;
  } catch (error) {
    state.surpriseExplanationRecords[memberSlug] = {
      status: {
        status: "failed",
        error: error.message || String(error),
      },
      explanation: null,
    };
  }

  if (state.analysisRecord) {
    renderAnalysis(state.analysisRecord);
  }
}

function openSurpriseExplanationPage(memberSlug) {
  if (!memberSlug) {
    return;
  }

  const surprisingVote = getCurrentSurprisingVotes().find((item) => item.routeSlug === memberSlug);
  const record = surprisingVote ? getSurpriseExplanationRecord(surprisingVote) : null;
  const status = record?.status?.status || "idle";
  const shouldAutostart =
    status === "idle" || status === "failed" || Boolean(record?.status?.isStale);
  const shouldForce = status === "failed" || Boolean(record?.status?.isStale);
  const viewUrl = buildSurpriseExplanationViewUrl(memberSlug, {
    autostart: shouldAutostart,
    force: shouldForce,
  });

  if (shouldAutostart) {
    state.surpriseExplanationRecords[memberSlug] = {
      ...record,
      status: {
        ...(record?.status || {}),
        status: "running",
        currentStage: "preparing_sources",
      },
      explanation: record?.explanation || null,
    };

    if (state.analysisRecord) {
      renderAnalysis(state.analysisRecord);
    }

    syncSurpriseExplanationPolling();
  }

  const openedWindow = window.open(viewUrl, "_blank", "noopener");

  if (!openedWindow) {
    window.location.assign(viewUrl);
  }
}

async function loadLaw() {
  const billId = getBillIdFromPath();

  try {
    const { response, payload } = await fetchJson(`/api/laws/${encodeURIComponent(billId)}/content`);

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load law");
    }

    const law = payload.law;
    titleElement.textContent = law.title;
    document.title = law.title;
    renderMetaRows(law, payload);
    renderSummary(Array.isArray(payload.summaryParagraphs) ? payload.summaryParagraphs : []);
    renderContent(Array.isArray(payload.paragraphs) ? payload.paragraphs : [], payload.parseError);
    configureButtons(billId, payload);
    state.lawContentLoaded = true;
  } catch (error) {
    titleElement.textContent = "שגיאה בטעינת החוק";
    summaryElement.innerHTML = "";
    contentElement.innerHTML = `<p class="error-message">${escapeHtml(error.message || String(error))}</p>`;
    downloadPdfButton.hidden = true;
    downloadWordButton.hidden = true;
  } finally {
    if (loadingElement) {
      loadingElement.remove();
    }
  }
}

lawTextTabButton.addEventListener("click", () => {
  setActiveTab("text");
});

lawVotesTabButton.addEventListener("click", () => {
  setActiveTab("votes");
});

lawAnalysisTabButton.addEventListener("click", () => {
  setActiveTab("analysis");
});

lawAnalysisContentElement.addEventListener("click", (event) => {
  const button = event.target.closest("[data-surprise-explain]");

  if (!button) {
    return;
  }

  openSurpriseExplanationPage(button.dataset.surpriseExplain || "");
});

loadLaw().then(() => {
  if (window.location.hash === "#votes") {
    setActiveTab("votes");
    return;
  }

  if (window.location.hash === "#analysis") {
    setActiveTab("analysis");
  }
});
