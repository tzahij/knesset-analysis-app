const memberCountElement = document.getElementById("member-count");
const indexedCountElement = document.getElementById("indexed-count");
const indexedDateElement = document.getElementById("indexed-date");
const memberSearchInput = document.getElementById("member-search-input");
const membersRefreshButton = document.getElementById("members-refresh-button");
const membersStatusElement = document.getElementById("members-status");
const memberFilesBuildAllButton = document.getElementById("member-files-build-all-button");
const memberFilesBulkStatusElement = document.getElementById("member-files-bulk-status");
const memberAnalysesBuildSmallButton = document.getElementById("member-analyses-build-small-button");
const memberAnalysesBuildLargeButton = document.getElementById("member-analyses-build-large-button");
const memberAnalysesBulkStatusElement = document.getElementById("member-analyses-bulk-status");
const partySummaryElement = document.getElementById("party-summary");
const partyListElement = document.getElementById("party-list");
const memberStatusHelper = window.KnessetMemberStatus || null;

const state = {
  payload: null,
  search: "",
  pollTimer: null,
  buildAllFilesInFlight: false,
  buildAllAnalysesInFlight: false,
  buildAllAnalysesSourceType: null,
};

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

function getPayloadMembers(payload) {
  return Array.isArray(payload?.parties)
    ? payload.parties.flatMap((party) => (Array.isArray(party.members) ? party.members : []))
    : [];
}

function getMemberCounts(payload) {
  const members = getPayloadMembers(payload);
  return memberStatusHelper?.getCounts(members) || {
    total: Number(payload?.memberCount || 0),
    former: 0,
    current: Number(payload?.memberCount || 0),
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

function getAnalysisSourceUiLabel(sourceType) {
  return String(sourceType || "").trim().toLowerCase() === "small" ? "הקובץ הקטן" : "הקובץ הגדול";
}

function updateAnalysisButtons(status = null) {
  const isConfigured = Boolean(status?.configured);
  const isBusy =
    state.buildAllAnalysesInFlight ||
    ["waiting_for_source_files", "running"].includes(status?.status || "");
  const activeSourceType =
    status?.status === "waiting_for_source_files" || status?.status === "running"
      ? status?.sourceType || state.buildAllAnalysesSourceType
      : null;

  memberAnalysesBuildSmallButton.disabled = !isConfigured || isBusy;
  memberAnalysesBuildLargeButton.disabled = !isConfigured || isBusy;
  memberAnalysesBuildSmallButton.textContent =
    activeSourceType === "small"
      ? "מנתח את כל חברי הכנסת מהקובץ הקטן..."
      : "נתח את כל חברי הכנסת מהקובץ הקטן";
  memberAnalysesBuildLargeButton.textContent =
    activeSourceType === "full"
      ? "מנתח את כל חברי הכנסת מהקובץ הגדול..."
      : "נתח את כל חברי הכנסת מהקובץ הגדול";
}

function renderStatus(status) {
  membersStatusElement.className = "updates-status";

  if (!status || status.status === "idle") {
    membersStatusElement.innerHTML = `
      <p><span class="status-chip">מוכן להתחלה</span></p>
      <p class="muted">הסריקה תתחיל אוטומטית עם טעינת הנתונים.</p>
    `;
    return;
  }

  if (status.status === "running") {
    membersStatusElement.classList.add("is-running");
    membersStatusElement.innerHTML = `
      <p><span class="status-chip">בונה אינדקס</span></p>
      <p>${status.processedProtocols.toLocaleString("he-IL")} מתוך ${status.totalProtocols.toLocaleString(
        "he-IL",
      )} פרוטוקולים נסרקו</p>
      <p class="muted">החיפוש כולל פרוטוקולי מליאה ופרוטוקולי ועדות שבהם חבר הכנסת זוהה כדובר, החל מ-${escapeHtml(
        status.sinceDate,
      )}.</p>
      ${
        status.current
          ? `<p class="muted">מעבד עכשיו: ${escapeHtml(
              status.current.title || status.current.shortDateLabel || status.current.documentId,
            )}</p>`
          : ""
      }
    `;
    return;
  }

  if (status.status === "failed") {
    membersStatusElement.classList.add("is-error");
    membersStatusElement.innerHTML = `
      <p><span class="status-chip">הסריקה נכשלה</span></p>
      <p class="error-message">${escapeHtml(
        (status.recentErrors || [])[0] || "אירעה שגיאה בבניית האינדקס.",
      )}</p>
    `;
    return;
  }

  membersStatusElement.classList.add(
    status.status === "completed_with_errors" ? "is-warning" : "is-success",
  );
  membersStatusElement.innerHTML = `
    <p><span class="status-chip">האינדקס מוכן</span></p>
    <p>${status.processedProtocols.toLocaleString("he-IL")} פרוטוקולים נסרקו</p>
    <p class="muted">פרוטוקולים עם התאמות: ${status.matchedProtocols.toLocaleString("he-IL")}</p>
    <p class="muted">עודכן לאחרונה: ${escapeHtml(formatIsoDate(status.lastIndexedAt))}</p>
    ${
      status.status === "completed_with_errors"
        ? '<p class="error-message">הסריקה הסתיימה עם חלק קטן של שגיאות. אפשר לרענן בהמשך.</p>'
        : ""
    }
  `;
}

function renderBulkFileStatus(status) {
  memberFilesBulkStatusElement.className = "updates-status is-neutral";

  if (!status || status.status === "idle") {
    memberFilesBulkStatusElement.innerHTML = `
      <p><span class="status-chip">קבצי האמירות טרם נוצרו</span></p>
      <p class="muted">לחצו על הכפתור כדי ליצור לכל חבר וחברת כנסת גם קובץ גדול וגם קובץ קטן ועדכני.</p>
    `;
    memberFilesBuildAllButton.disabled = state.buildAllFilesInFlight;
    memberFilesBuildAllButton.textContent = "צור קובצי אמירות גדולים וקטנים לכל חברי הכנסת";
    return;
  }

  if (status.status === "waiting_for_index") {
    memberFilesBulkStatusElement.className = "updates-status is-running";
    memberFilesBulkStatusElement.innerHTML = `
      <p><span class="status-chip">ממתין לסיום בניית האינדקס</span></p>
      <p class="muted">מיד לאחר סיום סריקת הפרוטוקולים נתחיל ליצור את כל הקבצים, הגדולים והקטנים.</p>
    `;
    memberFilesBuildAllButton.disabled = true;
    memberFilesBuildAllButton.textContent = "ממתין לאינדקס";
    return;
  }

  if (status.status === "running") {
    memberFilesBulkStatusElement.className = "updates-status is-running";
    memberFilesBulkStatusElement.innerHTML = `
      <p><span class="status-chip">יוצר קבצים גדולים וקטנים לכל חברי הכנסת</span></p>
      <p>${Number(status.processedMembers || 0).toLocaleString("he-IL")} מתוך ${Number(
        status.totalMembers || 0,
      ).toLocaleString("he-IL")} חברי כנסת עובדו</p>
      <p class="muted">קבצים חדשים/מעודכנים: ${Number(
        status.generatedMembers || 0,
      ).toLocaleString("he-IL")} · דולגו כי היו עדכניים: ${Number(
        status.skippedMembers || 0,
      ).toLocaleString("he-IL")}</p>
      ${
        status.current
          ? `<p class="muted">מעבד כעת: ${escapeHtml(status.current.name)} (${escapeHtml(
              status.current.partyName,
            )})</p>`
          : ""
      }
    `;
    memberFilesBuildAllButton.disabled = true;
    memberFilesBuildAllButton.textContent = "יוצר קובצי אמירות גדולים וקטנים...";
    return;
  }

  if (status.status === "failed") {
    memberFilesBulkStatusElement.className = "updates-status is-error";
    memberFilesBulkStatusElement.innerHTML = `
      <p><span class="status-chip">יצירת הקבצים נכשלה</span></p>
      <p class="error-message">${escapeHtml(
        (status.recentErrors || [])[0] || "אירעה שגיאה בזמן יצירת הקבצים.",
      )}</p>
    `;
    memberFilesBuildAllButton.disabled = false;
    memberFilesBuildAllButton.textContent = "נסה שוב ליצור קובצי אמירות גדולים וקטנים";
    return;
  }

  memberFilesBulkStatusElement.className = `updates-status ${
    status.status === "completed_with_errors" ? "is-warning" : "is-success"
  }`;
  memberFilesBulkStatusElement.innerHTML = `
    <p><span class="status-chip">קבצי האמירות מוכנים</span></p>
    <p>${Number(status.processedMembers || 0).toLocaleString("he-IL")} חברי כנסת עובדו</p>
    <p class="muted">קבצים חדשים/מעודכנים: ${Number(
      status.generatedMembers || 0,
    ).toLocaleString("he-IL")} · קבצים שכבר היו עדכניים: ${Number(
      status.skippedMembers || 0,
    ).toLocaleString("he-IL")}</p>
    <p class="muted">עודכן לאחרונה: ${escapeHtml(formatIsoDate(status.lastCompletedAt))}</p>
    ${
      status.status === "completed_with_errors"
        ? `<p class="error-message">היו ${Number(status.failedMembers || 0).toLocaleString(
            "he-IL",
          )} שגיאות. אפשר להריץ שוב כדי להשלים את החסרים.</p>`
        : ""
    }
  `;
  memberFilesBuildAllButton.disabled = state.buildAllFilesInFlight;
  memberFilesBuildAllButton.textContent = "רענן את כל קובצי האמירות הגדולים והקטנים";
}

function renderBulkAnalysisStatus(status) {
  memberAnalysesBulkStatusElement.className = "updates-status is-neutral";
  updateAnalysisButtons(status);

  if (!status || status.status === "idle") {
    const isConfigured = Boolean(status?.configured);
    memberAnalysesBulkStatusElement.innerHTML = isConfigured
      ? `
        <p><span class="status-chip">הניתוחים טרם נוצרו</span></p>
        <p class="muted">בחרו אם להריץ ניתוח לכל חברי הכנסת על בסיס הקובץ הקטן או על בסיס הקובץ הגדול.</p>
        <p class="muted">המודל שיופעל: ${escapeHtml(status?.model || "לא זמין")}.</p>
      `
      : `
        <p><span class="status-chip">הניתוחים עדיין לא זמינים</span></p>
        <p class="muted">כדי להפעיל את הניתוחים צריך להגדיר את משתנה הסביבה <code>GEMINI_API_KEY</code>.</p>
      `;
    updateAnalysisButtons(status);
    return;
  }

  if (status.status === "waiting_for_source_files") {
    const sourceLabel = getAnalysisSourceUiLabel(status.sourceType);
    memberAnalysesBulkStatusElement.className = "updates-status is-running";
    memberAnalysesBulkStatusElement.innerHTML = `
      <p><span class="status-chip">מכין חומרי מקור לניתוח</span></p>
      <p class="muted">המערכת מוודאת שקבצי האמירות של כל חברי הכנסת מעודכנים לפני הרצת הניתוחים מ־${escapeHtml(
        sourceLabel,
      )}.</p>
      <p class="muted">המודל שיופעל: ${escapeHtml(status.model || "לא זמין")}.</p>
    `;
    updateAnalysisButtons(status);
    return;
  }

  if (status.status === "running") {
    const sourceLabel = getAnalysisSourceUiLabel(status.sourceType);
    memberAnalysesBulkStatusElement.className = "updates-status is-running";
    memberAnalysesBulkStatusElement.innerHTML = `
      <p><span class="status-chip">מנתח את כל חברי הכנסת על בסיס ${escapeHtml(sourceLabel)}</span></p>
      <p>${Number(status.processedMembers || 0).toLocaleString("he-IL")} מתוך ${Number(
        status.totalMembers || 0,
      ).toLocaleString("he-IL")} חברי כנסת עובדו</p>
      <p class="muted">ניתוחים חדשים/מעודכנים: ${Number(
        status.generatedMembers || 0,
      ).toLocaleString("he-IL")} · דולגו כי היו עדכניים: ${Number(
        status.skippedMembers || 0,
      ).toLocaleString("he-IL")}</p>
      <p class="muted">המודל: ${escapeHtml(status.model || "לא זמין")}</p>
      ${
        status.current
          ? `<p class="muted">מנתח כעת: ${escapeHtml(status.current.name)} (${escapeHtml(
              status.current.partyName,
            )})</p>`
          : ""
      }
    `;
    updateAnalysisButtons(status);
    return;
  }

  if (status.status === "failed") {
    const sourceLabel = getAnalysisSourceUiLabel(status.sourceType);
    memberAnalysesBulkStatusElement.className = "updates-status is-error";
    memberAnalysesBulkStatusElement.innerHTML = `
      <p><span class="status-chip">בניית הניתוחים מ־${escapeHtml(sourceLabel)} נכשלה</span></p>
      <p class="error-message">${escapeHtml(
        (status.recentErrors || [])[0] || "אירעה שגיאה בזמן בניית הניתוחים.",
      )}</p>
    `;
    updateAnalysisButtons(status);
    return;
  }

  const sourceLabel = getAnalysisSourceUiLabel(status.sourceType);
  memberAnalysesBulkStatusElement.className = `updates-status ${
    status.status === "completed_with_errors" ? "is-warning" : "is-success"
  }`;
  memberAnalysesBulkStatusElement.innerHTML = `
    <p><span class="status-chip">הניתוחים מ־${escapeHtml(sourceLabel)} מוכנים</span></p>
    <p>${Number(status.processedMembers || 0).toLocaleString("he-IL")} חברי כנסת עובדו</p>
    <p class="muted">ניתוחים חדשים/מעודכנים: ${Number(
      status.generatedMembers || 0,
    ).toLocaleString("he-IL")} · ניתוחים שכבר היו עדכניים: ${Number(
      status.skippedMembers || 0,
    ).toLocaleString("he-IL")}</p>
    <p class="muted">המודל: ${escapeHtml(status.model || "לא זמין")}</p>
    <p class="muted">עודכן לאחרונה: ${escapeHtml(formatIsoDate(status.lastCompletedAt))}</p>
    ${
      status.status === "completed_with_errors"
        ? `<p class="error-message">היו ${Number(status.failedMembers || 0).toLocaleString(
            "he-IL",
          )} שגיאות. אפשר להריץ שוב כדי להשלים את החסרים.</p>`
        : ""
    }
  `;
  updateAnalysisButtons(status);
}

function renderStats(payload) {
  const status = payload?.status || null;
  const counts = getMemberCounts(payload);
  memberCountElement.textContent = counts.former
    ? `${counts.current.toLocaleString("he-IL")} כיום`
    : counts.total.toLocaleString("he-IL");
  indexedCountElement.textContent = status
    ? `${Number(status.processedProtocols || 0).toLocaleString("he-IL")} / ${Number(
        status.totalProtocols || 0,
      ).toLocaleString("he-IL")}`
    : "לא זמין";
  indexedDateElement.textContent = formatIsoDate(status?.lastIndexedAt);
}

function renderPartyList(payload) {
  const searchNeedle = normalizeSearch(state.search);
  const visibleParties = (payload?.parties || [])
    .map((party) => {
      const members = party.members.filter((member) => {
        if (!searchNeedle) {
          return true;
        }

        return normalizeSearch(`${member.name} ${party.name}`).includes(searchNeedle);
      });

      return {
        ...party,
        members,
      };
    })
    .filter((party) => party.members.length > 0);

  const totalVisibleMembers = visibleParties.reduce(
    (sum, party) => sum + party.members.length,
    0,
  );
  const allCounts = getMemberCounts(payload);
  const visibleCounts = memberStatusHelper?.getCounts(
    visibleParties.flatMap((party) => party.members),
  ) || {
    total: totalVisibleMembers,
    former: 0,
    current: totalVisibleMembers,
  };

  partySummaryElement.textContent = allCounts.former
    ? `מציג ${visibleCounts.total.toLocaleString("he-IL")} פרופילים, מהם ${visibleCounts.current.toLocaleString(
        "he-IL",
      )} מכהנים כיום ו-${visibleCounts.former.toLocaleString("he-IL")} ארכיוניים, מתוך ${allCounts.total.toLocaleString(
        "he-IL",
      )}`
    : `מציג ${totalVisibleMembers.toLocaleString("he-IL")} חברי כנסת מתוך ${Number(
        payload?.memberCount || 0,
      ).toLocaleString("he-IL")}`;

  if (!visibleParties.length) {
    partyListElement.innerHTML =
      '<p class="muted">לא נמצאו חברי כנסת שמתאימים לחיפוש שבחרתם.</p>';
    return;
  }

  partyListElement.innerHTML = visibleParties
    .map(
      (party) => {
        const partyCounts = memberStatusHelper?.getCounts(party.members) || {
          total: party.members.length,
          former: 0,
          current: party.members.length,
        };

        return `
        <section class="party-section">
          <div class="party-section__header">
            <div>
              <p class="eyebrow">Party</p>
              <h2>${escapeHtml(party.name)}</h2>
            </div>
            <p class="muted">${partyCounts.total.toLocaleString("he-IL")} פרופילים${
              partyCounts.former
                ? ` · ${partyCounts.current.toLocaleString("he-IL")} מכהנים כיום`
                : ""
            }</p>
          </div>

          <div class="member-grid">
            ${party.members
              .map(
                (member) => `
                  <a class="member-card" href="/members/${encodeURIComponent(member.routeSlug || member.slug)}">
                    <span class="member-card__party">${escapeHtml(member.partyName)}</span>
                    <strong>${escapeHtml(member.name)}</strong>
                    <span class="member-card__count">
                      ${Number(member.protocolCount || 0).toLocaleString("he-IL")} פרוטוקולים
                    </span>
                  </a>
                `,
              )
              .join("")}
          </div>
        </section>
      `;
      },
    )
    .join("");
}

function updatePolling(payload) {
  const isIndexRunning = payload?.status?.status === "running";
  const isBulkFilesRunning = ["waiting_for_index", "running"].includes(
    payload?.utteranceFilesBulkStatus?.status || "",
  );
  const isBulkAnalysisRunning = ["waiting_for_source_files", "running"].includes(
    payload?.analysisBulkStatus?.status || "",
  );

  if (isIndexRunning || isBulkFilesRunning || isBulkAnalysisRunning) {
    if (!state.pollTimer) {
      state.pollTimer = window.setInterval(() => {
        void loadMembers();
      }, 5000);
    }

    return;
  }

  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function loadMembers() {
  membersRefreshButton.disabled = true;

  try {
    const response = await fetch("/api/members");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load members");
    }

    state.payload = payload;
    renderStats(payload);
    renderStatus(payload.status);
    renderBulkFileStatus(payload.utteranceFilesBulkStatus);
    renderBulkAnalysisStatus(payload.analysisBulkStatus);
    renderPartyList(payload);
    updatePolling(payload);
  } catch (error) {
    const message = error.message || String(error);
    partySummaryElement.textContent = "שגיאה בטעינת חברי הכנסת";
    membersStatusElement.className = "updates-status is-error";
    membersStatusElement.innerHTML = `<p class="error-message">${escapeHtml(message)}</p>`;
    memberFilesBulkStatusElement.className = "updates-status is-error";
    memberFilesBulkStatusElement.innerHTML = `<p class="error-message">${escapeHtml(
      message,
    )}</p>`;
    memberAnalysesBulkStatusElement.className = "updates-status is-error";
    memberAnalysesBulkStatusElement.innerHTML = `<p class="error-message">${escapeHtml(
      message,
    )}</p>`;
    partyListElement.innerHTML = `<p class="error-message">${escapeHtml(message)}</p>`;
  } finally {
    membersRefreshButton.disabled = false;
  }
}

async function startBuildAllMemberFiles() {
  if (state.buildAllFilesInFlight) {
    return;
  }

  state.buildAllFilesInFlight = true;
  memberFilesBuildAllButton.disabled = true;

  try {
    const response = await fetch("/api/members/utterance-files/bulk", {
      method: "POST",
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Failed to start member file generation");
    }

    renderBulkFileStatus(payload);
    await loadMembers();
  } catch (error) {
    memberFilesBulkStatusElement.className = "updates-status is-error";
    memberFilesBulkStatusElement.innerHTML = `<p class="error-message">${escapeHtml(
      error.message || String(error),
    )}</p>`;
    memberFilesBuildAllButton.disabled = false;
    memberFilesBuildAllButton.textContent = "נסה שוב ליצור את כל הקבצים";
  } finally {
    state.buildAllFilesInFlight = false;
  }
}

async function startBuildAllMemberAnalyses(sourceType) {
  if (state.buildAllAnalysesInFlight) {
    return;
  }

  state.buildAllAnalysesInFlight = true;
  state.buildAllAnalysesSourceType = sourceType;
  updateAnalysisButtons({
    configured: true,
    status: "running",
    sourceType,
  });

  try {
    const response = await fetch(
      `/api/members/analyses/bulk?sourceType=${encodeURIComponent(sourceType)}`,
      {
      method: "POST",
      },
    );
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Failed to start member analysis generation");
    }

    renderBulkAnalysisStatus(payload);
    await loadMembers();
  } catch (error) {
    memberAnalysesBulkStatusElement.className = "updates-status is-error";
    memberAnalysesBulkStatusElement.innerHTML = `<p class="error-message">${escapeHtml(
      error.message || String(error),
    )}</p>`;
    updateAnalysisButtons({
      configured: true,
      status: "failed",
      sourceType,
    });
  } finally {
    state.buildAllAnalysesInFlight = false;
  }
}

memberSearchInput.addEventListener("input", () => {
  state.search = memberSearchInput.value;
  renderPartyList(state.payload);
});

membersRefreshButton.addEventListener("click", async () => {
  await loadMembers();
});

memberFilesBuildAllButton.addEventListener("click", () => {
  void startBuildAllMemberFiles();
});

memberAnalysesBuildSmallButton.addEventListener("click", () => {
  void startBuildAllMemberAnalyses("small");
});

memberAnalysesBuildLargeButton.addEventListener("click", () => {
  void startBuildAllMemberAnalyses("full");
});

void loadMembers();
