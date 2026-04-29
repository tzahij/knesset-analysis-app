const state = {
  catalogPayload: null,
  statusPayload: null,
  selectedProtocol: null,
  selectedRecord: null,
  page: 1,
  pageSize: 50,
  isBusy: false,
};

const elements = {
  processButton: document.getElementById("fact-check-process-button"),
  statusCard: document.getElementById("fact-check-status-card"),
  searchInput: document.getElementById("protocol-search-input"),
  sourceFilter: document.getElementById("protocol-source-filter"),
  refreshButton: document.getElementById("protocol-refresh-button"),
  catalogSummary: document.getElementById("protocol-catalog-summary"),
  catalogList: document.getElementById("protocol-catalog-list"),
  prevPageButton: document.getElementById("protocol-prev-page"),
  nextPageButton: document.getElementById("protocol-next-page"),
  pageLabel: document.getElementById("protocol-page-label"),
  workspace: document.getElementById("selected-protocol-workspace"),
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value) {
  if (!value) {
    return "לא זמין";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "לא זמין";
  }

  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatVerdict(verdict) {
  if (verdict === "pending_configuration") {
    return "נדרש מפתח Gemini";
  }

  switch (verdict) {
    case "supported":
      return "נתמך";
    case "contradicted":
      return "נסתר";
    case "mixed_or_needs_context":
      return "מעורב / דורש הקשר";
    case "outdated":
      return "מיושן";
    case "unverifiable":
      return "לא ניתן לאימות";
    case "pending_configuration":
      return "נדרש מפתח OpenAI";
    case "failed":
      return "הבדיקה נכשלה";
    case "not_started":
      return "טרם נבדק";
    default:
      return "בהמתנה";
  }
}

function getVerdictClass(verdict) {
  switch (verdict) {
    case "supported":
      return "is-supported";
    case "contradicted":
      return "is-contradicted";
    case "mixed_or_needs_context":
      return "is-mixed";
    case "outdated":
      return "is-outdated";
    case "unverifiable":
      return "is-unverifiable";
    default:
      return "is-pending";
  }
}

function getClaimSummaryText(claim) {
  const summary = String(claim?.claimSummary || "").trim();

  if (summary) {
    return summary;
  }

  return String(claim?.claimText || "").trim();
}

function getVerificationBullets(claim) {
  if (Array.isArray(claim?.verification?.analysisBullets)) {
    const bullets = claim.verification.analysisBullets
      .map((bullet) => ({
        text: String(bullet?.text || "").trim(),
        sources: Array.isArray(bullet?.sources) ? bullet.sources : [],
      }))
      .filter((bullet) => bullet.text);

    if (bullets.length) {
      return bullets;
    }
  }

  if (Array.isArray(claim?.verification?.summaryParagraphs)) {
    return claim.verification.summaryParagraphs
      .map((paragraph) => ({
        text: String(paragraph || "").trim(),
        sources: [],
      }))
      .filter((bullet) => bullet.text);
  }

  return [];
}

function formatVerificationBulletText(bullet) {
  const sourceText = Array.isArray(bullet?.sources)
    ? bullet.sources
        .slice(0, 3)
        .map((source) => String(source?.title || source?.url || "").trim())
        .filter(Boolean)
        .join(" · ")
    : "";
  const bulletText = String(bullet?.text || "").trim();

  if (!bulletText) {
    return "";
  }

  return sourceText ? `• ${bulletText} (מקורות: ${sourceText})` : `• ${bulletText}`;
}

async function fetchJson(url, options = undefined) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

function buildCatalogUrl() {
  const params = new URLSearchParams({
    page: String(state.page),
    pageSize: String(state.pageSize),
  });

  if (elements.searchInput.value.trim()) {
    params.set("query", elements.searchInput.value.trim());
  }

  if (elements.sourceFilter.value) {
    params.set("source", elements.sourceFilter.value);
  }

  return `/api/fact-checks/protocol-catalog?${params.toString()}`;
}

function buildFactCheckUrl(protocol) {
  return `/api/protocols/${encodeURIComponent(protocol.documentId)}/fact-checks?source=${encodeURIComponent(
    protocol.source,
  )}`;
}

function buildExtractUrl(protocol, force = false) {
  return `/api/protocols/${encodeURIComponent(protocol.documentId)}/fact-checks/extract?source=${encodeURIComponent(
    protocol.source,
  )}${force ? "&force=1" : ""}`;
}

function buildVerifyAllUrl(protocol) {
  return `/api/protocols/${encodeURIComponent(protocol.documentId)}/fact-checks/verify-all?source=${encodeURIComponent(
    protocol.source,
  )}`;
}

function renderStatus() {
  const status = state.statusPayload;

  if (!status) {
    elements.statusCard.innerHTML = '<p class="muted">טוען את מצב התור...</p>';
    return;
  }

  elements.statusCard.innerHTML = `
    <div class="fact-check-status-grid">
      <div>
        <span class="stat-label">מצב</span>
        <strong>${escapeHtml(status.status || "idle")}</strong>
      </div>
      <div>
        <span class="stat-label">ממתינים לחילוץ</span>
        <strong>${Number(status.pendingProtocols || 0).toLocaleString("he-IL")}</strong>
      </div>
      <div>
        <span class="stat-label">עובדו בריצה</span>
        <strong>${Number(status.processedProtocols || 0).toLocaleString("he-IL")}</strong>
      </div>
      <div>
        <span class="stat-label">הושלם לאחרונה</span>
        <strong>${escapeHtml(formatDateTime(status.lastCompletedAt))}</strong>
      </div>
    </div>
  `;
}

function renderCatalog() {
  const payload = state.catalogPayload;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const total = Number(payload?.total || 0);
  const start = total ? (payload.page - 1) * payload.pageSize + 1 : 0;
  const end = total ? Math.min(total, payload.page * payload.pageSize) : 0;

  elements.catalogSummary.textContent = total
    ? `מציג ${start.toLocaleString("he-IL")}–${end.toLocaleString("he-IL")} מתוך ${total.toLocaleString("he-IL")} פרוטוקולים`
    : "לא נמצאו פרוטוקולים";
  elements.pageLabel.textContent = `עמוד ${Number(payload?.page || 1).toLocaleString("he-IL")}`;
  elements.prevPageButton.disabled = !payload || payload.page <= 1;
  elements.nextPageButton.disabled = !payload || end >= total;

  if (!items.length) {
    elements.catalogList.innerHTML = `
      <div class="fact-check-empty">
        <h3>לא נמצאו פרוטוקולים</h3>
        <p class="muted">נסו לשנות את החיפוש או את הסינון.</p>
      </div>
    `;
    return;
  }

  elements.catalogList.innerHTML = items
    .map((item) => {
      const isSelected =
        state.selectedProtocol &&
        state.selectedProtocol.source === item.source &&
        String(state.selectedProtocol.documentId) === String(item.documentId);
      const statusText = item.factCheckSummary
        ? `${Number(item.factCheckSummary.claimCount || 0).toLocaleString("he-IL")} טענות · ${Number(item.factCheckSummary.verifiedCount || 0).toLocaleString("he-IL")} נבדקו`
        : "טרם חולצו טענות";

      return `
        <button
          type="button"
          class="fact-check-catalog-item ${isSelected ? "is-selected" : ""}"
          data-source="${escapeHtml(item.source)}"
          data-document-id="${escapeHtml(item.documentId)}"
        >
          <div class="fact-check-catalog-item__header">
            <span class="eyebrow">${escapeHtml(item.sourceLabel || "")}</span>
            <span class="fact-check-verdict ${getVerdictClass(item.factCheckStatus)}">
              ${escapeHtml(item.factCheckStatus || "not_processed")}
            </span>
          </div>
          <strong>${escapeHtml(item.title || item.shortDateLabel || item.documentId)}</strong>
          <p class="muted">${escapeHtml(item.longDateLabel || item.shortDateLabel || "")}</p>
          ${
            item.committeeName
              ? `<p class="muted">${escapeHtml(item.committeeName)} · ${escapeHtml(
                  item.committeeTypeDescription || "",
                )}</p>`
              : item.sessionNumber
                ? `<p class="muted">ישיבה ${escapeHtml(item.sessionNumber)}</p>`
                : ""
          }
          <p class="muted">${escapeHtml(statusText)}</p>
        </button>
      `;
    })
    .join("");

  Array.from(elements.catalogList.querySelectorAll(".fact-check-catalog-item")).forEach((button) => {
    button.addEventListener("click", () => {
      const protocol = items.find(
        (item) =>
          item.source === button.dataset.source &&
          String(item.documentId) === String(button.dataset.documentId),
      );

      if (!protocol) {
        return;
      }

      state.selectedProtocol = protocol;
      state.selectedRecord = null;
      renderCatalog();
      void loadSelectedProtocol();
    });
  });
}

function renderClaimRow(claim) {
  const verdict = claim.verification?.verdict || claim.verificationStatus || "not_started";
  const memberHref = `/members/${encodeURIComponent(claim.routeSlug || claim.memberSlug)}`;
  const explanation = getVerificationBullets(claim).map(formatVerificationBulletText).filter(Boolean);
  const finalVerdictText = String(claim?.verification?.shortRuling || "").trim();
  const statusLabel =
    claim.verificationStatus === "pending_configuration"
      ? "נדרש מפתח Gemini"
      : formatVerdict(verdict);

  if (finalVerdictText) {
    explanation.push(`פסק הדין: ${finalVerdictText}`);
  }

  return `
    <tr>
      <td>
        <a class="fact-check-member-link" href="${memberHref}">${escapeHtml(claim.memberName)}</a>
        <div class="muted">${escapeHtml(claim.partyName || "")}</div>
      </td>
      <td>
        <strong>${escapeHtml(claim.claimText)}</strong>
        <div class="fact-check-raw-quote">${escapeHtml(claim.rawQuote || "")}</div>
      </td>
      <td>${escapeHtml(getClaimSummaryText(claim))}</td>
      <td>
        <span class="fact-check-verdict ${getVerdictClass(claim.verification?.verdict || claim.verificationStatus)}">
          ${escapeHtml(statusLabel)}
        </span>
      </td>
      <td>
        ${
          explanation.length
            ? explanation.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")
            : `<p class="muted">${escapeHtml(claim.verificationError || "הטענה עדיין לא נבדקה.")}</p>`
        }
      </td>
      <td>
        <button
          type="button"
          class="secondary-button compact-button fact-check-verify-button"
          data-claim-id="${escapeHtml(claim.claimId)}"
        >
          ${claim.verificationStatus === "completed" ? "בדוק מחדש" : "אמת / הפרך"}
        </button>
      </td>
    </tr>
  `;
}

function bindVerifyButtons() {
  Array.from(document.querySelectorAll(".fact-check-verify-button")).forEach((button) => {
    button.addEventListener("click", async () => {
      const claimId = button.dataset.claimId;

      if (!claimId || state.isBusy) {
        return;
      }

      state.isBusy = true;
      button.disabled = true;
      button.textContent = "בודק...";

      try {
        await fetchJson(`/api/fact-checks/claims/${encodeURIComponent(claimId)}/verify`, {
          method: "POST",
        });
        await loadSelectedProtocol();
        await loadCatalog();
      } catch (error) {
        button.disabled = false;
        button.textContent = "שגיאה";
      } finally {
        state.isBusy = false;
      }
    });
  });
}

function renderWorkspace() {
  const protocol = state.selectedProtocol;
  const record = state.selectedRecord;

  if (!protocol) {
    elements.workspace.innerHTML = `
      <div class="fact-check-selected-empty">
        <h2>בחרו פרוטוקול מהרשימה</h2>
        <p class="muted">
          לאחר הבחירה תוכלו לחלץ את הטענות העובדתיות, לעיין בהן, ואז לאמת או להפריך כל טענה
          בנפרד או את כולן יחד.
        </p>
      </div>
    `;
    return;
  }

  const claims = Array.isArray(record?.claims) ? record.claims : [];
  const verifiedCount = claims.filter((claim) => claim.verificationStatus === "completed").length;
  const canVerifyAll = claims.length > 0;

  elements.workspace.innerHTML = `
    <div class="fact-check-workspace-card">
      <div class="fact-check-workspace-card__header">
        <div>
          <p class="eyebrow">${escapeHtml(protocol.sourceLabel || "")}</p>
          <h2>${escapeHtml(protocol.title || protocol.shortDateLabel || protocol.documentId)}</h2>
          <p class="muted">
            ${escapeHtml(protocol.longDateLabel || protocol.shortDateLabel || "")}
            ${
              protocol.committeeName
                ? ` · ${escapeHtml(protocol.committeeName)}`
                : protocol.sessionNumber
                  ? ` · ישיבה ${escapeHtml(protocol.sessionNumber)}`
                  : ""
            }
          </p>
        </div>
        <div class="landing-hero__actions">
          <a class="secondary-button compact-button" href="${escapeHtml(protocol.protocolUrl)}">
            פתח את הפרוטוקול
          </a>
          <button id="extract-facts-button" class="primary-button compact-button" type="button">
            חלץ טענות מהפרוטוקול
          </button>
          <button
            id="reextract-facts-button"
            class="secondary-button compact-button"
            type="button"
            ${claims.length ? "" : "disabled"}
          >
            חלץ טענות מחדש
          </button>
          <button
            id="verify-all-facts-button"
            class="secondary-button compact-button"
            type="button"
            ${canVerifyAll ? "" : "disabled"}
          >
            אמת / הפרך את כל הטענות
          </button>
        </div>
      </div>

      <div class="fact-check-summary-grid">
        <article class="fact-check-summary-card">
          <span class="fact-check-summary-card__label">סטטוס</span>
          <strong>${escapeHtml(record?.status || protocol.factCheckStatus || "not_processed")}</strong>
        </article>
        <article class="fact-check-summary-card">
          <span class="fact-check-summary-card__label">טענות שחולצו</span>
          <strong>${claims.length.toLocaleString("he-IL")}</strong>
        </article>
        <article class="fact-check-summary-card">
          <span class="fact-check-summary-card__label">טענות שנבדקו</span>
          <strong>${verifiedCount.toLocaleString("he-IL")}</strong>
        </article>
      </div>

      ${
        Array.isArray(record?.methodology) && record.methodology.length
          ? `
            <div class="fact-check-methodology">
              <h3>מתודולוגיה</h3>
              <ul>
                ${record.methodology.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
              </ul>
            </div>
          `
          : ""
      }

      ${
        !claims.length
          ? `
            <div class="fact-check-empty">
              <h3>עדיין לא חולצו טענות</h3>
              <p class="muted">
                לחצו על "חלץ טענות מהפרוטוקול" כדי לזהות את הטענות העובדתיות שנאמרו בידי חברי הכנסת.
              </p>
            </div>
          `
          : `
            <div class="fact-check-table-wrap">
              <table class="fact-check-table">
                <thead>
                  <tr>
                    <th>חבר כנסת</th>
                    <th>הטענה</th>
                    <th>סיכום הטענה</th>
                    <th>סטטוס</th>
                    <th>בדיקת המערכת</th>
                    <th>פעולה</th>
                  </tr>
                </thead>
                <tbody>
                  ${claims.map((claim) => renderClaimRow(claim)).join("")}
                </tbody>
              </table>
            </div>
          `
      }
    </div>
  `;

  const extractButton = document.getElementById("extract-facts-button");
  const reextractButton = document.getElementById("reextract-facts-button");
  const verifyAllButton = document.getElementById("verify-all-facts-button");

  extractButton?.addEventListener("click", async () => {
    if (state.isBusy) {
      return;
    }

    state.isBusy = true;
    extractButton.disabled = true;
    extractButton.textContent = "מחלץ...";

    try {
      state.selectedRecord = await fetchJson(buildExtractUrl(protocol), { method: "POST" });
      renderWorkspace();
      await loadCatalog();
    } finally {
      state.isBusy = false;
    }
  });

  reextractButton?.addEventListener("click", async () => {
    if (state.isBusy || !claims.length) {
      return;
    }

    state.isBusy = true;
    reextractButton.disabled = true;
    reextractButton.textContent = "מחלץ מחדש...";

    try {
      state.selectedRecord = await fetchJson(buildExtractUrl(protocol, true), { method: "POST" });
      renderWorkspace();
      await loadCatalog();
    } finally {
      state.isBusy = false;
    }
  });

  verifyAllButton?.addEventListener("click", async () => {
    if (state.isBusy || !canVerifyAll) {
      return;
    }

    state.isBusy = true;
    verifyAllButton.disabled = true;
    verifyAllButton.textContent = "בודק...";

    try {
      state.selectedRecord = await fetchJson(buildVerifyAllUrl(protocol), { method: "POST" });
      renderWorkspace();
      await loadCatalog();
    } finally {
      state.isBusy = false;
    }
  });

  bindVerifyButtons();
}

async function loadStatus() {
  state.statusPayload = await fetchJson("/api/fact-checks/status");
  renderStatus();
}

async function loadCatalog() {
  state.catalogPayload = await fetchJson(buildCatalogUrl());
  renderCatalog();
}

async function loadSelectedProtocol() {
  if (!state.selectedProtocol) {
    renderWorkspace();
    return;
  }

  elements.workspace.innerHTML = '<p class="muted">טוען את מצב הפרוטוקול...</p>';
  state.selectedRecord = await fetchJson(buildFactCheckUrl(state.selectedProtocol));
  renderWorkspace();
}

async function refreshAll() {
  await Promise.all([loadStatus(), loadCatalog()]);
}

async function processQueuedProtocols() {
  elements.processButton.disabled = true;

  try {
    state.statusPayload = await fetchJson("/api/fact-checks/process-new", { method: "POST" });
    renderStatus();
    await loadCatalog();
  } finally {
    elements.processButton.disabled = false;
  }
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => {
    void refreshAll();
  });
  elements.processButton.addEventListener("click", () => {
    void processQueuedProtocols();
  });
  elements.prevPageButton.addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    void loadCatalog();
  });
  elements.nextPageButton.addEventListener("click", () => {
    state.page += 1;
    void loadCatalog();
  });
  elements.sourceFilter.addEventListener("change", () => {
    state.page = 1;
    void loadCatalog();
  });
  elements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      state.page = 1;
      void loadCatalog();
    }
  });
}

bindEvents();
refreshAll();
