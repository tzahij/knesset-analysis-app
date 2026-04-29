const elements = {
  contentElement: document.getElementById("protocol-content"),
  contentLoadingElement: document.getElementById("reader-loading"),
  titleElement: document.getElementById("protocol-title"),
  metaElement: document.getElementById("protocol-meta"),
  downloadButton: document.getElementById("download-single-button"),
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeProtocolMatchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[.!?;,:()[\]{}"“”'׳״`…]+/g, " ")
    .replace(/[-‐‑‒–—―]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getHighlightRequest() {
  const params = new URLSearchParams(window.location.search);
  return {
    quote: String(params.get("highlightQuote") || "").trim(),
    speaker: String(params.get("highlightSpeaker") || "").trim(),
  };
}

function buildMatchChunks(normalizedQuote) {
  const tokens = normalizedQuote.split(" ").filter(Boolean);
  const chunks = [];

  for (let size = Math.min(8, tokens.length); size >= 4; size -= 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      chunks.push(tokens.slice(index, index + size).join(" "));
    }
  }

  return chunks;
}

function findBestParagraphIndex(paragraphs, highlightRequest) {
  if (!highlightRequest.quote) {
    return -1;
  }

  const normalizedQuote = normalizeProtocolMatchText(highlightRequest.quote.replace(/\.\.\.$/, ""));

  if (!normalizedQuote) {
    return -1;
  }

  const quoteTokens = normalizedQuote.split(" ").filter((token) => token.length >= 2);
  const quoteTokenSet = new Set(quoteTokens);
  const quoteChunks = buildMatchChunks(normalizedQuote);
  const normalizedSpeaker = normalizeProtocolMatchText(highlightRequest.speaker);
  let bestIndex = -1;
  let bestScore = -1;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = String(paragraphs[index] || "");
    const normalizedParagraph = normalizeProtocolMatchText(paragraph);

    if (!normalizedParagraph) {
      continue;
    }

    let score = 0;

    if (normalizedParagraph.includes(normalizedQuote)) {
      score += 1000 + normalizedQuote.length;
    }

    for (const chunk of quoteChunks) {
      if (normalizedParagraph.includes(chunk)) {
        score += chunk.length * 3;
        break;
      }
    }

    const paragraphTokens = new Set(normalizedParagraph.split(" ").filter(Boolean));
    let overlapCount = 0;

    for (const token of quoteTokenSet) {
      if (paragraphTokens.has(token)) {
        overlapCount += 1;
      }
    }

    score += overlapCount * 4;

    if (normalizedSpeaker && normalizedParagraph.includes(normalizedSpeaker)) {
      score += 25;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore >= 16 ? bestIndex : -1;
}

function getSourceConfig() {
  if (window.location.pathname.startsWith("/committee-protocol/")) {
    return {
      apiBase: "/api/committee-protocols",
      titleBuilder: (protocol) => protocol.committeeName || protocol.title,
      metaRows: (protocol, content) => [
        ["תאריך", protocol.longDateLabel],
        ["שעת פתיחה", protocol.timeLabel || "לא זמינה"],
        ["שם הוועדה", protocol.committeeName],
        ["סוג ועדה", protocol.committeeTypeDescription],
        ["סוג ישיבה", protocol.sessionTypeDescription || "לא זמין"],
        ["מספר ישיבה", protocol.sessionNumber ?? "-"],
        ["כנסת", protocol.knessetNumber ?? "-"],
        ["פורמט מסמך", (content.extension || "").replace(".", "").toUpperCase()],
        ["פסקאות", content.paragraphs.length.toLocaleString("he-IL")],
      ],
    };
  }

  return {
    apiBase: "/api/protocols",
    titleBuilder: (protocol) => protocol.title || protocol.shortDateLabel,
    metaRows: (protocol, content) => [
      ["תאריך", protocol.longDateLabel],
      ["שעת פתיחה", protocol.timeLabel || "לא זמינה"],
      ["מספר ישיבה", protocol.sessionNumber ?? "-"],
      ["כנסת", protocol.knessetNumber ?? "-"],
      ["פורמט מסמך", (content.extension || "").replace(".", "").toUpperCase()],
      ["פסקאות", content.paragraphs.length.toLocaleString("he-IL")],
    ],
  };
}

function getDocumentIdFromPath() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments[segments.length - 1];
}

function renderMeta(protocol, content, config) {
  elements.metaElement.innerHTML = config
    .metaRows(protocol, content)
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

function renderParagraphs(paragraphs, highlightIndex) {
  if (!paragraphs.length) {
    elements.contentElement.innerHTML = `<p class="muted">לא נמצא טקסט קריא במסמך.</p>`;
    return;
  }

  elements.contentElement.innerHTML = paragraphs
    .map(
      (paragraph, index) => `
        <p
          id="protocol-paragraph-${index + 1}"
          class="protocol-content__paragraph${index === highlightIndex ? " is-highlighted" : ""}"
          data-paragraph-index="${index}"
        >${escapeHtml(paragraph)}</p>
      `,
    )
    .join("");
}

function scrollToHighlightedParagraph(highlightIndex) {
  if (highlightIndex < 0) {
    return;
  }

  const paragraph = document.getElementById(`protocol-paragraph-${highlightIndex + 1}`);

  if (!paragraph) {
    return;
  }

  window.requestAnimationFrame(() => {
    paragraph.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
}

async function fetchJson(url, options = undefined) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

async function loadProtocol() {
  const documentId = getDocumentIdFromPath();
  const sourceConfig = getSourceConfig();
  const highlightRequest = getHighlightRequest();

  try {
    const contentPayload = await fetchJson(
      `${sourceConfig.apiBase}/${encodeURIComponent(documentId)}/content`,
    );
    const paragraphs = Array.isArray(contentPayload.paragraphs) ? contentPayload.paragraphs : [];
    const highlightIndex = findBestParagraphIndex(paragraphs, highlightRequest);

    elements.titleElement.textContent = sourceConfig.titleBuilder(contentPayload.protocol);
    document.title = elements.titleElement.textContent;
    elements.downloadButton.href = `${sourceConfig.apiBase}/${encodeURIComponent(documentId)}/download`;
    renderMeta(contentPayload.protocol, contentPayload, sourceConfig);
    renderParagraphs(paragraphs, highlightIndex);
    scrollToHighlightedParagraph(highlightIndex);
  } catch (error) {
    elements.titleElement.textContent = "שגיאה בטעינת הפרוטוקול";
    elements.contentElement.innerHTML = `<p class="error-message">${escapeHtml(
      error.message || String(error),
    )}</p>`;
  } finally {
    elements.contentLoadingElement?.remove();
  }
}

loadProtocol();
