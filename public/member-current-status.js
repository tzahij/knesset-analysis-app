(function initKnessetMemberStatus(global) {
  const FORMER_MEMBER_INLINE_LABEL = "לא מכהנ/ת כיום";
  const FORMER_MEMBER_PROFILE_NOTE =
    "פרופיל ארכיוני מהכנסת ה-25. האדם שמופיע כאן אינו/ה חבר/ת כנסת מכהנ/ת כיום.";
  const TEXT_SELECTORS = "a, button, h1, h2, h3, h4, strong, p, span, td, li, dd";
  const FORMER_MEMBER_ROUTE_SLUGS = new Set([
    "member-003",
    "member-004",
    "member-006",
    "member-008",
    "member-009",
    "member-013",
    "member-014",
    "member-021",
    "member-065",
    "member-080",
    "member-101",
    "member-112",
    "member-125",
  ]);
  const FORMER_MEMBER_TEXT_VARIANTS = [
    "אלי אליהו כהן",
    "אלי כהן",
    "דוד אמסלם",
    "יואב קיש",
    "מירי מרים רגב",
    "מירי רגב",
    "מכלוף מיקי זוהר",
    "מיקי זוהר",
    "עמיחי שיקלי",
    "עידית סילמן",
    "חיים כץ",
    "בצלאל סמוטריץ'",
    "בצלאל סמוטריץ",
    "גדעון סער",
    "ישראל אייכלר",
    "יוסף עטאונה",
    "אלמוג כהן",
  ].sort((left, right) => right.length - left.length);

  let scanScheduled = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeMemberText(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/[\"'`´׳״]/g, " ")
      .replace(/[-–—/]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  const FORMER_MEMBER_NORMALIZED_NAMES = new Set(
    FORMER_MEMBER_TEXT_VARIANTS.map((name) => normalizeMemberText(name)),
  );

  function getDisplayName(memberLike) {
    if (typeof memberLike === "string") {
      return memberLike;
    }

    if (!memberLike || typeof memberLike !== "object") {
      return "";
    }

    return String(
      memberLike.name ||
        memberLike.memberName ||
        memberLike.displayName ||
        memberLike.fullName ||
        "",
    ).trim();
  }

  function extractRouteSlug(memberLike) {
    if (!memberLike) {
      return "";
    }

    if (typeof memberLike === "string") {
      const directSlug = String(memberLike).trim();
      if (FORMER_MEMBER_ROUTE_SLUGS.has(directSlug)) {
        return directSlug;
      }

      const pathMatch = directSlug.match(/\/members\/([^/?#]+)/i);
      return pathMatch ? decodeURIComponent(pathMatch[1]).trim() : "";
    }

    const directCandidates = [memberLike.routeSlug, memberLike.slug, memberLike.memberSlug];
    for (const candidate of directCandidates) {
      const slug = String(candidate || "").trim();
      if (slug) {
        return slug;
      }
    }

    const hrefCandidates = [memberLike.href, memberLike.memberHref, memberLike.profileHref];
    for (const candidate of hrefCandidates) {
      const href = String(candidate || "").trim();
      if (!href) {
        continue;
      }

      const pathMatch = href.match(/\/members\/([^/?#]+)/i);
      if (pathMatch) {
        return decodeURIComponent(pathMatch[1]).trim();
      }
    }

    return "";
  }

  function isFormerMember(memberLike) {
    const routeSlug = extractRouteSlug(memberLike);
    if (routeSlug && FORMER_MEMBER_ROUTE_SLUGS.has(routeSlug)) {
      return true;
    }

    const displayName = normalizeMemberText(getDisplayName(memberLike));
    return Boolean(displayName) && FORMER_MEMBER_NORMALIZED_NAMES.has(displayName);
  }

  function countFormerMembers(items) {
    return (Array.isArray(items) ? items : []).filter((item) => isFormerMember(item)).length;
  }

  function countCurrentMembers(items) {
    const list = Array.isArray(items) ? items : [];
    return Math.max(0, list.length - countFormerMembers(list));
  }

  function getCounts(items) {
    const list = Array.isArray(items) ? items : [];
    return {
      total: list.length,
      former: countFormerMembers(list),
      current: countCurrentMembers(list),
    };
  }

  function renderInlineName(memberLike, options = {}) {
    const displayName = getDisplayName(memberLike);
    if (!displayName) {
      return "";
    }

    const escapedName = escapeHtml(displayName);
    if (!isFormerMember(memberLike)) {
      return escapedName;
    }

    if (options.useBadge) {
      return `${escapedName} ${getInlineBadgeMarkup(memberLike)}`;
    }

    return `${escapedName} (${escapeHtml(FORMER_MEMBER_INLINE_LABEL)})`;
  }

  function getInlineBadgeMarkup(memberLike) {
    if (!isFormerMember(memberLike)) {
      return "";
    }

    return `<span class="status-chip status-chip--former-member">${escapeHtml(
      FORMER_MEMBER_INLINE_LABEL,
    )}</span>`;
  }

  function getProfileNoteMarkup(memberLike) {
    if (!isFormerMember(memberLike)) {
      return "";
    }

    return `<div class="former-member-note"><p>${escapeHtml(FORMER_MEMBER_PROFILE_NOTE)}</p></div>`;
  }

  function annotateTextElement(element) {
    if (!element || element.dataset.memberStatusAnnotated === "true") {
      return;
    }

    if (element.closest(".former-member-note")) {
      return;
    }

    if (element.children.length > 0) {
      return;
    }

    const originalText = String(element.textContent || "").trim();
    if (!originalText || originalText.length > 180) {
      return;
    }

    let annotatedHtml = escapeHtml(originalText);
    let changed = false;

    for (const name of FORMER_MEMBER_TEXT_VARIANTS) {
      const escapedName = escapeHtml(name);
      const annotatedName = `${escapedName} (${escapeHtml(FORMER_MEMBER_INLINE_LABEL)})`;
      if (annotatedHtml.includes(annotatedName)) {
        continue;
      }
      if (!annotatedHtml.includes(escapedName)) {
        continue;
      }

      annotatedHtml = annotatedHtml.split(escapedName).join(annotatedName);
      changed = true;
    }

    if (!changed) {
      return;
    }

    element.innerHTML = annotatedHtml;
    element.dataset.memberStatusAnnotated = "true";
  }

  function annotateTextMentions(root = document) {
    const elements = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(TEXT_SELECTORS)) {
      elements.push(root);
    }

    if (root.querySelectorAll) {
      elements.push(...root.querySelectorAll(TEXT_SELECTORS));
    }

    elements.forEach((element) => annotateTextElement(element));
  }

  function annotateAccessibleLabels(root = document) {
    const elements = root.querySelectorAll
      ? root.querySelectorAll("[aria-label], [data-profile-href], [data-spotlight-member-href], a[href]")
      : [];

    elements.forEach((element) => {
      if (element.dataset.memberStatusAriaAnnotated === "true") {
        return;
      }

      const memberLike = {
        href:
          element.getAttribute("href") ||
          element.dataset.profileHref ||
          element.dataset.spotlightMemberHref ||
          "",
        name: element.textContent || "",
      };

      if (!isFormerMember(memberLike)) {
        return;
      }

      const currentLabel = String(element.getAttribute("aria-label") || "").trim();
      if (currentLabel && !currentLabel.includes(FORMER_MEMBER_INLINE_LABEL)) {
        element.setAttribute("aria-label", `${currentLabel}, ${FORMER_MEMBER_INLINE_LABEL}`);
      }

      element.dataset.memberStatusAriaAnnotated = "true";
    });
  }

  function ensureFormerProfileNote() {
    const pathname = String(global.location?.pathname || "");
    const profileMatch = pathname.match(/^\/members\/([^/?#]+)/i);
    if (!profileMatch) {
      return;
    }

    const routeSlug = decodeURIComponent(profileMatch[1]).trim();
    if (!FORMER_MEMBER_ROUTE_SLUGS.has(routeSlug)) {
      return;
    }

    const memberPartyElement = document.getElementById("member-party");
    if (!memberPartyElement) {
      return;
    }

    let noteElement = document.getElementById("former-member-profile-note");
    if (!noteElement) {
      noteElement = document.createElement("div");
      noteElement.id = "former-member-profile-note";
      memberPartyElement.insertAdjacentElement("afterend", noteElement);
    }

    noteElement.innerHTML = getProfileNoteMarkup({ routeSlug });
  }

  function runMemberStatusScan(root = document) {
    annotateTextMentions(root);
    annotateAccessibleLabels(root);
    ensureFormerProfileNote();
  }

  function scheduleMemberStatusScan() {
    if (scanScheduled) {
      return;
    }

    scanScheduled = true;
    global.requestAnimationFrame(() => {
      scanScheduled = false;
      runMemberStatusScan(document);
    });
  }

  global.KnessetMemberStatus = {
    FORMER_MEMBER_INLINE_LABEL,
    FORMER_MEMBER_ROUTE_SLUGS,
    countFormerMembers,
    countCurrentMembers,
    getCounts,
    getDisplayName,
    getInlineBadgeMarkup,
    getProfileNoteMarkup,
    isFormerMember,
    normalizeMemberText,
    renderInlineName,
    runScan: runMemberStatusScan,
    scheduleScan: scheduleMemberStatusScan,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      runMemberStatusScan(document);
    });
  } else {
    runMemberStatusScan(document);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList" || mutation.type === "characterData") {
        scheduleMemberStatusScan();
        return;
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
  });
})(window);
