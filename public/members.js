const memberCountElement = document.getElementById("member-count");
const indexedCountElement = document.getElementById("indexed-count");
const indexedDateElement = document.getElementById("indexed-date");
const memberSearchInput = document.getElementById("member-search-input");

const partySummaryElement = document.getElementById("party-summary");
const partyListElement = document.getElementById("party-list");
const memberStatusHelper = window.KnessetMemberStatus || null;

const state = {
  payload: null,
  search: "",
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



async function loadMembers() {

  try {
    const response = await fetch("/api/members");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load members");
    }

    state.payload = payload;
    renderStats(payload);
    renderPartyList(payload);
  } catch (error) {
    const message = error.message || String(error);
    partySummaryElement.textContent = "שגיאה בטעינת חברי הכנסת";
    partyListElement.innerHTML = `<p class="error-message">${escapeHtml(message)}</p>`;
  }
}



memberSearchInput.addEventListener("input", () => {
  state.search = memberSearchInput.value;
  renderPartyList(state.payload);
});

void loadMembers();
