const elements = {
  generatedAt: document.getElementById("methodology-generated-at"),
  snapshot: document.getElementById("methodology-snapshot"),
  nav: document.getElementById("methodology-nav"),
  content: document.getElementById("methodology-content"),
  adminControls: document.getElementById("methodology-admin-controls"),
  recreateButton: document.getElementById("methodology-recreate-button"),
  recreateStatus: document.getElementById("methodology-recreate-status"),
};

const state = {
  activeSectionId: "",
  payload: null,
  renderedSections: [],
  sectionObserver: null,
  recreating: false,
  recreateStatusKind: "",
  recreateStatusMessage: "",
  quoteFilesLoading: false,
  quoteFilesLoaded: false,
  quoteFilesError: "",
  quoteFilesMembers: [],
  quoteFilesSearch: "",
  quoteTextCache: {},
  openQuoteViewerKey: "",
};

const QUOTE_FILES_SECTION = {
  id: "member-quote-files",
  navLabel: "קבצי ציטוטים",
  eyebrow: "קבצים",
  title: "קובצי הציטוטים של חברי הכנסת",
  intro:
    "כאן אפשר לפתוח ולקרוא, עבור כל חבר כנסת, את קובץ הציטוטים הקטן ואת קובץ הציטוטים המלא, וגם להוריד כל אחד מהם בנפרד.",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isQuoteFilesAccessDenied(response) {
  return response.status === 401 || response.status === 403;
}

function renderList(items, className = "methodology-list") {
  if (!Array.isArray(items) || !items.length) {
    return "";
  }

  return `
    <ul class="${className}">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function renderFlow(flow) {
  if (!flow || !Array.isArray(flow.steps) || !flow.steps.length) {
    return "";
  }

  return `
    <section class="methodology-flow-card">
      <header class="methodology-flow-card__header">
        <h4>${escapeHtml(flow.title || "תרשים זרימה")}</h4>
      </header>
      <div class="methodology-flow">
        ${flow.steps
          .map(
            (step, index) => `
              <article class="methodology-flow__step">
                <span class="methodology-flow__index">${index + 1}</span>
                <strong>${escapeHtml(step.title || "")}</strong>
                <p>${escapeHtml(step.detail || "")}</p>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderPromptCard(card) {
  return `
    <article class="methodology-card methodology-card--prompt">
      <header class="methodology-card__header">
        <div>
          <h3>${escapeHtml(card.title || "")}</h3>
          <p class="muted">${escapeHtml(card.description || "")}</p>
        </div>
        <div class="methodology-prompt__badges">
          ${
            card.provider
              ? `<span class="methodology-badge">${escapeHtml(card.provider)}</span>`
              : ""
          }
          ${card.model ? `<span class="methodology-badge">${escapeHtml(card.model)}</span>` : ""}
        </div>
      </header>
      ${
        Array.isArray(card.inputs) && card.inputs.length
          ? `
            <div class="methodology-output-group">
              <strong>מה נכנס לקריאה הזאת</strong>
              ${renderList(card.inputs, "methodology-list")}
            </div>
          `
          : ""
      }
      ${
        Array.isArray(card.outputs) && card.outputs.length
          ? `
            <div class="methodology-output-group">
              <strong>מה יוצא ממנה</strong>
              ${renderList(card.outputs, "methodology-list methodology-list--outputs")}
            </div>
          `
          : ""
      }
      ${
        card.prompt
          ? `<pre class="methodology-prompt-block"><code>${escapeHtml(card.prompt)}</code></pre>`
          : ""
      }
      ${renderList(card.bullets, "methodology-list")}
    </article>
  `;
}

function renderCard(card) {
  if (card.prompt) {
    return renderPromptCard(card);
  }

  return `
    <article class="methodology-card">
      <header class="methodology-card__header">
        <div>
          <h3>${escapeHtml(card.title || "")}</h3>
          ${card.description ? `<p class="muted">${escapeHtml(card.description)}</p>` : ""}
        </div>
      </header>
      ${
        Array.isArray(card.sources) && card.sources.length
          ? `
            <div class="methodology-chip-group">
              ${card.sources
                .map((item) => `<span class="methodology-chip">${escapeHtml(item)}</span>`)
                .join("")}
            </div>
          `
          : ""
      }
      ${
        Array.isArray(card.outputs) && card.outputs.length
          ? `
            <div class="methodology-output-group">
              <strong>איפה זה מופיע באתר</strong>
              ${renderList(card.outputs, "methodology-list")}
            </div>
          `
          : ""
      }
      ${renderList(card.bullets, "methodology-list")}
      ${renderFlow(card.flow)}
    </article>
  `;
}

function renderSection(section) {
  return `
    <section id="methodology-section-${escapeHtml(section.id)}" class="panel methodology-section">
      <header class="methodology-section__header">
        <div>
          <p class="eyebrow">${escapeHtml(section.eyebrow || "")}</p>
          <h2>${escapeHtml(section.title || "")}</h2>
        </div>
        ${section.intro ? `<p class="muted">${escapeHtml(section.intro)}</p>` : ""}
      </header>
      ${renderList(section.bullets, "methodology-list methodology-list--lead")}
      <div class="methodology-card-grid">
        ${(section.cards || []).map((card) => renderCard(card)).join("")}
      </div>
    </section>
  `;
}

function buildQuoteFilesSectionShell() {
  return `
    <section id="methodology-section-${escapeHtml(QUOTE_FILES_SECTION.id)}" class="panel methodology-section">
      <header class="methodology-section__header">
        <div>
          <p class="eyebrow">${escapeHtml(QUOTE_FILES_SECTION.eyebrow)}</p>
          <h2>${escapeHtml(QUOTE_FILES_SECTION.title)}</h2>
        </div>
        <p class="muted">${escapeHtml(QUOTE_FILES_SECTION.intro)}</p>
      </header>
      <div id="methodology-quote-files-live" class="methodology-quote-files">
        <div class="landing-empty-card">
          <p class="muted">טוען את רשימת קובצי הציטוטים...</p>
        </div>
      </div>
    </section>
  `;
}

function renderSnapshot(cards) {
  if (!Array.isArray(cards) || !cards.length) {
    elements.snapshot.innerHTML = `
      <div class="landing-empty-card">
        <p class="muted">לא נמצאה כרגע תמונת מצב להצגה.</p>
      </div>
    `;
    return;
  }

  elements.snapshot.innerHTML = `
    <div class="methodology-snapshot__grid">
      ${cards
        .map(
          (card) => `
            <article class="stat-card methodology-stat-card">
              <span class="stat-label">${escapeHtml(card.label || "")}</span>
              <strong>${escapeHtml(card.value || "")}</strong>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderNav(sections) {
  elements.nav.innerHTML = (sections || [])
    .map(
      (section) => `
        <button
          class="source-tab methodology-nav__button${
            section.id === state.activeSectionId ? " is-active" : ""
          }"
          type="button"
          data-section-id="${escapeHtml(section.id)}"
        >
          ${escapeHtml(section.navLabel || section.title || "")}
        </button>
      `,
    )
    .join("");

  Array.from(elements.nav.querySelectorAll("[data-section-id]")).forEach((button) => {
    button.addEventListener("click", () => {
      const sectionId = button.getAttribute("data-section-id");
      const sectionElement = document.getElementById(`methodology-section-${sectionId}`);

      if (!sectionElement) {
        return;
      }

      sectionElement.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  });
}

function bindSectionObserver(sections) {
  if (state.sectionObserver) {
    state.sectionObserver.disconnect();
    state.sectionObserver = null;
  }

  const targets = (sections || [])
    .map((section) => document.getElementById(`methodology-section-${section.id}`))
    .filter(Boolean);

  if (!targets.length) {
    return;
  }

  state.sectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

      if (!visible?.target?.id) {
        return;
      }

      const sectionId = visible.target.id.replace("methodology-section-", "");

      if (sectionId && sectionId !== state.activeSectionId) {
        state.activeSectionId = sectionId;
        renderNav(sections);
      }
    },
    {
      rootMargin: "-20% 0px -60% 0px",
      threshold: [0.2, 0.35, 0.5],
    },
  );

  targets.forEach((target) => state.sectionObserver.observe(target));
}

function isAdminUser() {
  return Boolean(window.KnessetAuth?.canAccess("admin"));
}

function renderAdminControls() {
  if (!elements.adminControls || !elements.recreateButton || !elements.recreateStatus) {
    return;
  }

  const isAdmin = isAdminUser();
  elements.adminControls.hidden = !isAdmin;
  elements.recreateButton.disabled = !isAdmin || state.recreating;
  elements.recreateButton.textContent = state.recreating
    ? "יוצר מחדש את התיעוד..."
    : "יצירה מחדש של התיעוד";

  if (!isAdmin) {
    elements.recreateStatus.hidden = true;
    elements.recreateStatus.innerHTML = "";
    return;
  }

  elements.recreateStatus.hidden = false;

  if (state.recreating) {
    elements.recreateStatus.className = "updates-status is-running";
    elements.recreateStatus.innerHTML = "<p>המערכת בונה עכשיו סנאפשוט חדש של התיעוד.</p>";
    return;
  }

  if (state.recreateStatusMessage) {
    elements.recreateStatus.className = `updates-status ${state.recreateStatusKind || "is-neutral"}`;
    elements.recreateStatus.innerHTML = `<p>${escapeHtml(state.recreateStatusMessage)}</p>`;
    return;
  }

  elements.recreateStatus.className = "updates-status is-neutral";
  elements.recreateStatus.innerHTML = `<p>הסנאפשוט הפעיל נוצר ב-${escapeHtml(
    state.payload?.generatedDateLabel || "לא זמין",
  )}.</p>`;
}

function renderPayload(payload) {
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const renderedSections = [...sections, QUOTE_FILES_SECTION];
  state.payload = payload;
  state.renderedSections = renderedSections;
  state.activeSectionId = renderedSections[0]?.id || "";

  elements.generatedAt.textContent = payload.generatedDateLabel || "לא זמין";
  renderSnapshot(payload.snapshotCards || []);
  elements.content.innerHTML =
    sections.map((section) => renderSection(section)).join("") + buildQuoteFilesSectionShell();
  renderNav(renderedSections);
  bindSectionObserver(renderedSections);
  renderAdminControls();
  renderQuoteFilesSection();
}

function isQuoteFileAvailable(fileRecord) {
  return Boolean(fileRecord?.status === "completed" && fileRecord?.downloadUrl);
}

function formatDateLabel(value) {
  if (!value) {
    return "לא זמין";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "לא זמין";
  }

  try {
    return new Intl.DateTimeFormat("he-IL", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Jerusalem",
    }).format(date);
  } catch {
    return "לא זמין";
  }
}

function getQuoteFileKey(memberSlug, sourceType) {
  return `${memberSlug}::${sourceType}`;
}

function getFilteredQuoteFileMembers() {
  const searchValue = normalizeSearchText(state.quoteFilesSearch);

  if (!searchValue) {
    return state.quoteFilesMembers;
  }

  return state.quoteFilesMembers.filter((entry) =>
    normalizeSearchText(
      [entry?.member?.name, entry?.member?.partyName, entry?.member?.slug, entry?.member?.routeSlug]
        .filter(Boolean)
        .join(" "),
    ).includes(searchValue),
  );
}

function renderQuoteFileMeta(fileRecord) {
  const chips = [];

  if (typeof fileRecord?.sectionCount === "number") {
    chips.push(`${fileRecord.sectionCount.toLocaleString("he-IL")} פרוטוקולים`);
  }

  if (typeof fileRecord?.utteranceCount === "number") {
    chips.push(`${fileRecord.utteranceCount.toLocaleString("he-IL")} קטעי דיבור`);
  }

  if (fileRecord?.generatedAt) {
    chips.push(`נוצר: ${formatDateLabel(fileRecord.generatedAt)}`);
  }

  if (fileRecord?.isStale) {
    chips.push("הקובץ התיישן מול האינדקס העדכני");
  }

  if (fileRecord?.isPartial) {
    chips.push("נוצר כשהאינדקס היה חלקי");
  }

  if (!chips.length) {
    return `<p class="muted">אין כרגע מטא-דאטה נוסף להצגה עבור הקובץ הזה.</p>`;
  }

  return `
    <ul class="methodology-list methodology-list--compact">
      ${chips.map((chip) => `<li>${escapeHtml(chip)}</li>`).join("")}
    </ul>
  `;
}

function renderQuoteFileViewer(member, fileRecord, sourceType) {
  const memberReference = member.routeSlug || member.slug;
  const key = getQuoteFileKey(memberReference, sourceType);

  if (state.openQuoteViewerKey !== key) {
    return "";
  }

  const cached = state.quoteTextCache[key];

  if (!cached || cached.status === "loading") {
    return `
      <div class="methodology-quote-viewer">
        <div class="updates-status is-running">
          <p>טוען את תוכן הקובץ...</p>
        </div>
      </div>
    `;
  }

  if (cached.status === "error") {
    return `
      <div class="methodology-quote-viewer">
        <div class="updates-status is-error">
          <p>${escapeHtml(cached.message || "אירעה שגיאה בטעינת הקובץ.")}</p>
        </div>
        <button
          class="secondary-button compact-button"
          type="button"
          data-quote-close="${escapeHtml(key)}"
        >
          סגור
        </button>
      </div>
    `;
  }

  return `
    <div class="methodology-quote-viewer">
      <div class="methodology-quote-viewer__header">
        <div>
          <strong>${escapeHtml(fileRecord?.sourceLabel || "")}</strong>
          <p class="muted">${escapeHtml(member.name)} · ${escapeHtml(member.partyName || "ללא סיעה")}</p>
        </div>
        <div class="methodology-quote-viewer__actions">
          <a class="secondary-button compact-button" href="${escapeHtml(fileRecord.downloadUrl || "#")}">
            הורד קובץ
          </a>
          <button
            class="secondary-button compact-button"
            type="button"
            data-quote-close="${escapeHtml(key)}"
          >
            סגור
          </button>
        </div>
      </div>
      <pre class="methodology-quote-text"><code>${escapeHtml(cached.text || "")}</code></pre>
    </div>
  `;
}

function renderQuoteFileCard(entry, sourceType) {
  const fileRecord = entry?.files?.[sourceType] || null;
  const member = entry?.member || {};
  const available = isQuoteFileAvailable(fileRecord);
  const memberReference = member.routeSlug || member.slug;
  const key = getQuoteFileKey(memberReference, sourceType);

  return `
    <section class="methodology-quote-file-card methodology-quote-file-card--${escapeHtml(sourceType)}">
      <header class="methodology-quote-file-card__header">
        <div>
          <h4>${escapeHtml(fileRecord?.sourceLabel || (sourceType === "small" ? "קובץ קטן" : "קובץ מלא"))}</h4>
          <p class="muted">
            ${
              available
                ? "אפשר לקרוא את הקובץ כאן בעמוד, או להוריד אותו בנפרד."
                : "הקובץ הזה עדיין לא זמין לקריאה ולהורדה."
            }
          </p>
        </div>
        <span class="methodology-badge methodology-badge--status${
          available ? " is-available" : ""
        }">
          ${escapeHtml(
            available ? "זמין" : fileRecord?.status === "running" ? "נבנה עכשיו" : "לא זמין",
          )}
        </span>
      </header>
      ${renderQuoteFileMeta(fileRecord)}
      <div class="methodology-quote-file-actions">
        ${
          available
            ? `
              <button
                class="secondary-button compact-button"
                type="button"
                data-quote-read="${escapeHtml(key)}"
                data-member-slug="${escapeHtml(memberReference || "")}"
                data-source-type="${escapeHtml(sourceType)}"
              >
                ${
                  state.openQuoteViewerKey === key ? "רענן / פתח מחדש" : "קרא את הקובץ"
                }
              </button>
              <a class="secondary-button compact-button" href="${escapeHtml(fileRecord.downloadUrl || "#")}">
                הורד קובץ
              </a>
            `
            : `<span class="muted">הקובץ יופיע כאן לאחר יצירתו.</span>`
        }
      </div>
      ${renderQuoteFileViewer(member, fileRecord, sourceType)}
    </section>
  `;
}

function renderQuoteFilesSection() {
  const container = document.getElementById("methodology-quote-files-live");

  if (!container) {
    return;
  }

  if (state.quoteFilesLoading && !state.quoteFilesLoaded) {
    container.innerHTML = `
      <div class="landing-empty-card">
        <p class="muted">טוען את רשימת קובצי הציטוטים של חברי הכנסת...</p>
      </div>
    `;
    return;
  }

  if (state.quoteFilesError && !state.quoteFilesLoaded) {
    container.innerHTML = `
      <div class="landing-empty-card">
        <p class="error-text">${escapeHtml(state.quoteFilesError)}</p>
      </div>
    `;
    return;
  }

  const filteredMembers = getFilteredQuoteFileMembers();
  const availableSmallCount = state.quoteFilesMembers.filter((entry) =>
    isQuoteFileAvailable(entry?.files?.small),
  ).length;
  const availableFullCount = state.quoteFilesMembers.filter((entry) =>
    isQuoteFileAvailable(entry?.files?.full),
  ).length;

  container.innerHTML = `
    <div class="methodology-quote-toolbar">
      <label class="methodology-quote-search">
        <span>חיפוש חבר כנסת</span>
        <input
          type="search"
          value="${escapeHtml(state.quoteFilesSearch)}"
          placeholder="חיפוש לפי שם חבר הכנסת או סיעה"
          data-quote-search
        />
      </label>
      <div class="methodology-quote-summary">
        <span class="methodology-chip">ח"כים ברשימה: ${state.quoteFilesMembers.length.toLocaleString("he-IL")}</span>
        <span class="methodology-chip">קבצים קטנים זמינים: ${availableSmallCount.toLocaleString("he-IL")}</span>
        <span class="methodology-chip">קבצים מלאים זמינים: ${availableFullCount.toLocaleString("he-IL")}</span>
      </div>
    </div>
    ${
      state.quoteFilesError
        ? `
          <div class="updates-status is-error">
            <p>${escapeHtml(state.quoteFilesError)}</p>
          </div>
        `
        : ""
    }
    ${
      state.quoteFilesLoading && state.quoteFilesLoaded
        ? `
          <div class="updates-status is-running">
            <p>מרענן את סטטוס הקבצים...</p>
          </div>
        `
        : ""
    }
    ${
      filteredMembers.length
        ? `
          <div class="methodology-quote-member-grid">
            ${filteredMembers
              .map(
                (entry) => `
                  <article class="methodology-quote-member-card">
                    <header class="methodology-quote-member-card__header">
                      <div>
                        <h3>
                          <a href="/members/${encodeURIComponent(
                            entry?.member?.routeSlug || entry?.member?.slug || "",
                          )}">${escapeHtml(entry?.member?.name || "")}</a>
                        </h3>
                        <p class="muted">${escapeHtml(entry?.member?.partyName || "ללא סיעה")}</p>
                      </div>
                    </header>
                    <div class="methodology-quote-file-grid">
                      ${renderQuoteFileCard(entry, "small")}
                      ${renderQuoteFileCard(entry, "full")}
                    </div>
                  </article>
                `,
              )
              .join("")}
          </div>
        `
        : `
          <div class="landing-empty-card">
            <p class="muted">לא נמצאו חברי כנסת שתואמים לחיפוש.</p>
          </div>
        `
    }
  `;
}

async function loadQuoteFilesCatalog() {
  state.quoteFilesLoading = true;
  state.quoteFilesError = "";
  renderQuoteFilesSection();

  try {
    const response = await fetch("/api/methodology/member-quote-files");

    if (!response.ok) {
      if (isQuoteFilesAccessDenied(response)) {
        throw new Error(
          "יש להתחבר עם חשבון basic, advanced או admin כדי לצפות בקבצי הציטוטים.",
        );
      }

      if (response.status === 404) {
        throw new Error(
          "השרת שרץ כרגע עדיין לא כולל את מסלול קובצי הציטוטים. יש להפעיל מחדש את staging או production כדי שהחלק הזה ייטען.",
        );
      }
      throw new Error(`השרת החזיר תשובה לא תקינה (${response.status}).`);
    }

    const payload = await response.json();
    state.quoteFilesMembers = Array.isArray(payload?.members) ? payload.members : [];
    state.quoteFilesLoaded = true;
  } catch (error) {
    state.quoteFilesError = error.message || "אירעה שגיאה בטעינת קובצי הציטוטים.";
  } finally {
    state.quoteFilesLoading = false;
    renderQuoteFilesSection();
  }
}

async function openQuoteFile(memberSlug, sourceType) {
  const key = getQuoteFileKey(memberSlug, sourceType);
  state.openQuoteViewerKey = key;

  if (state.quoteTextCache[key]?.status === "loaded") {
    renderQuoteFilesSection();
    return;
  }

  state.quoteTextCache[key] = {
    status: "loading",
  };
  renderQuoteFilesSection();

  try {
    const response = await fetch(
      `/api/members/${encodeURIComponent(memberSlug)}/utterance-file/text?sourceType=${encodeURIComponent(sourceType)}`,
    );

    if (!response.ok) {
      if (isQuoteFilesAccessDenied(response)) {
        window.KnessetAuth?.openLogin?.("basic");
        throw new Error(
          "יש להתחבר עם חשבון basic, advanced או admin כדי לקרוא את תוכן הקובץ.",
        );
      }

      if (response.status === 404) {
        throw new Error(
          "השרת שרץ כרגע עדיין לא כולל את מסלול הקריאה של קובצי הציטוטים. יש להפעיל אותו מחדש ואז לנסות שוב.",
        );
      }
      throw new Error(`השרת החזיר תשובה לא תקינה (${response.status}).`);
    }

    const text = await response.text();
    state.quoteTextCache[key] = {
      status: "loaded",
      text,
    };
  } catch (error) {
    state.quoteTextCache[key] = {
      status: "error",
      message: error.message || "אירעה שגיאה בטעינת תוכן הקובץ.",
    };
  }

  renderQuoteFilesSection();
}

async function loadMethodology() {
  elements.content.innerHTML = `
    <div class="landing-empty-card">
      <p class="muted">טוען את פרקי ההסבר המלאים...</p>
    </div>
  `;

  try {
    const response = await fetch("/api/methodology");

    if (!response.ok) {
      throw new Error(`השרת החזיר תשובה לא תקינה (${response.status}).`);
    }

    const payload = await response.json();
    renderPayload(payload);
    void loadQuoteFilesCatalog();
  } catch (error) {
    elements.content.innerHTML = `
      <div class="landing-empty-card">
        <p class="error-text">${escapeHtml(error.message || "אירעה שגיאה בטעינת העמוד.")}</p>
      </div>
    `;
  }
}

async function recreateMethodology() {
  if (!isAdminUser()) {
    window.KnessetAuth?.openLogin?.("admin");
    return;
  }

  state.recreating = true;
  state.recreateStatusKind = "";
  state.recreateStatusMessage = "";
  renderAdminControls();

  try {
    const response = await fetch("/api/methodology/recreate", {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error || `השרת החזיר תשובה לא תקינה (${response.status}).`);
    }

    renderPayload(payload || {});
    state.recreateStatusKind = "is-success";
    state.recreateStatusMessage = `התיעוד נוצר מחדש ונשמר ב-${
      payload?.generatedDateLabel || "לא זמין"
    }.`;
    void loadQuoteFilesCatalog();
  } catch (error) {
    state.recreateStatusKind = "is-error";
    state.recreateStatusMessage = error.message || "אירעה שגיאה ביצירה מחדש של התיעוד.";
  } finally {
    state.recreating = false;
    renderAdminControls();
  }
}

if (elements.recreateButton) {
  elements.recreateButton.addEventListener("click", () => {
    void recreateMethodology();
  });
}

if (elements.content) {
  elements.content.addEventListener("input", (event) => {
    const searchInput = event.target.closest("[data-quote-search]");

    if (!searchInput) {
      return;
    }

    const selectionStart = searchInput.selectionStart ?? searchInput.value.length;
    state.quoteFilesSearch = searchInput.value || "";
    renderQuoteFilesSection();

    const nextSearchInput = document.querySelector("[data-quote-search]");

    if (nextSearchInput) {
      nextSearchInput.focus();
      nextSearchInput.setSelectionRange(selectionStart, selectionStart);
    }
  });

  elements.content.addEventListener("click", (event) => {
    const readButton = event.target.closest("[data-quote-read]");

    if (readButton) {
      void openQuoteFile(
        readButton.getAttribute("data-member-slug"),
        readButton.getAttribute("data-source-type"),
      );
      return;
    }

    const closeButton = event.target.closest("[data-quote-close]");

    if (closeButton) {
      state.openQuoteViewerKey = "";
      renderQuoteFilesSection();
    }
  });
}

window.addEventListener("knesset-auth-changed", () => {
  renderAdminControls();

  if (state.payload) {
    state.quoteTextCache = {};
    state.openQuoteViewerKey = "";
    void loadQuoteFilesCatalog();
  }
});

void loadMethodology();
