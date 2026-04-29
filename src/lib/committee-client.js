const { formatDateParts, mapWithConcurrency, normalizeSearchText } = require("./utils");

const ODATA_BASE_URL =
  "http://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_DocumentCommitteeSession";
const GROUP_TYPE_ID = 23;
const PAGE_SIZE = 100;
const CONCURRENCY = 6;

function normalizeFileUrl(fileUrl) {
  return String(fileUrl || "").replace("https://fs.knesset.gov.il//", "https://fs.knesset.gov.il/");
}

function createFiveYearsAgoStartDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 5);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatIsraelDateOnly(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function toODataDateTimeLiteral(date) {
  const [year, month, day] = formatIsraelDateOnly(date).split("-");
  return `datetime'${year}-${month}-${day}T00:00:00'`;
}

function normalizeCommitteeProtocolRecord(entry) {
  const session = entry.KNS_CommitteeSession || {};
  const committee = session.KNS_Committee || {};
  const dateParts = formatDateParts(session.StartDate);

  return {
    documentId: String(entry.DocumentCommitteeSessionID),
    committeeSessionId: String(session.CommitteeSessionID || entry.CommitteeSessionID || ""),
    committeeId: String(committee.CommitteeID || session.CommitteeID || ""),
    sessionNumber: session.Number ?? null,
    knessetNumber: session.KnessetNum ?? null,
    title: committee.Name
      ? `${committee.Name} - ${dateParts.shortDateLabel}`
      : `פרוטוקול ועדה - ${dateParts.shortDateLabel}`,
    startDate: session.StartDate || null,
    finishDate: session.FinishDate || null,
    fileUrl: normalizeFileUrl(entry.FilePath),
    applicationLabel: entry.ApplicationDesc || "DOC",
    groupTypeId: entry.GroupTypeID,
    groupTypeDescription: entry.GroupTypeDesc || "",
    lastUpdatedDate: entry.LastUpdatedDate || null,
    year: dateParts.year,
    dateKey: dateParts.dateKey,
    timeKey: dateParts.timeKey,
    shortDateLabel: dateParts.shortDateLabel,
    longDateLabel: dateParts.longDateLabel,
    timeLabel: dateParts.timeLabel,
    dateSortValue: session.StartDate ? new Date(session.StartDate).getTime() : 0,
    committeeName: committee.Name || "ועדה לא מזוהה",
    committeeCategory: committee.CategoryDesc || committee.Name || "",
    committeeTypeDescription: committee.CommitteeTypeDesc || "סוג ועדה לא זמין",
    committeeAdditionalTypeDescription: committee.AdditionalTypeDesc || "",
    sessionTypeDescription: session.TypeDesc || "",
    statusDescription: session.StatusDesc || "",
    location: session.Location || "",
    note: session.Note || "",
    searchText: normalizeSearchText(
      [
        dateParts.dateKey,
        dateParts.shortDateLabel,
        dateParts.longDateLabel,
        dateParts.timeLabel,
        committee.Name,
        committee.CategoryDesc,
        committee.CommitteeTypeDesc,
        committee.AdditionalTypeDesc,
        session.TypeDesc,
        session.Number,
        session.KnessetNum,
      ].join(" "),
    ),
  };
}

class CommitteeClient {
  constructor() {
    this.windowStart = createFiveYearsAgoStartDate();
    this.windowStartLiteral = toODataDateTimeLiteral(this.windowStart);
  }

  getWindowStartInfo() {
    return {
      isoDate: this.windowStart.toISOString(),
      dateOnly: formatIsraelDateOnly(this.windowStart),
    };
  }

  async fetchJson(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });

    if (!response.ok) {
      throw new Error(`Committee API request failed with ${response.status}`);
    }

    return response.json();
  }

  async fetchText(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });

    if (!response.ok) {
      throw new Error(`Committee API request failed with ${response.status}`);
    }

    return response.text();
  }

  buildFilter() {
    return `GroupTypeID eq ${GROUP_TYPE_ID} and KNS_CommitteeSession/StartDate ge ${this.windowStartLiteral}`;
  }

  async fetchProtocolCount() {
    const countUrl = `${ODATA_BASE_URL}/$count?$filter=${encodeURIComponent(this.buildFilter())}`;
    const rawCount = await this.fetchText(countUrl);
    const count = Number(rawCount);

    if (!Number.isFinite(count)) {
      throw new Error(`Unable to parse committee protocol count from "${rawCount}"`);
    }

    return count;
  }

  async fetchProtocolsMetadata() {
    const total = await this.fetchProtocolCount();
    const pageCount = Math.ceil(total / PAGE_SIZE);
    const pageIndexes = Array.from({ length: pageCount }, (_, index) => index);

    const pages = await mapWithConcurrency(pageIndexes, CONCURRENCY, async (pageIndex) => {
      const skip = pageIndex * PAGE_SIZE;
      const query = [
        `$filter=${this.buildFilter()}`,
        "$expand=KNS_CommitteeSession,KNS_CommitteeSession/KNS_Committee",
        `$top=${PAGE_SIZE}`,
        `$skip=${skip}`,
        "$format=json",
      ].join("&");
      const pageUrl = `${ODATA_BASE_URL}?${encodeURI(query)}`;
      const data = await this.fetchJson(pageUrl);

      return Array.isArray(data.value)
        ? data.value.map(normalizeCommitteeProtocolRecord)
        : [];
    });

    return pages.flat();
  }
}

module.exports = {
  CommitteeClient,
};
