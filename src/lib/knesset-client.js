const { formatDateParts, mapWithConcurrency, normalizeSearchText } = require("./utils");

const ODATA_BASE_URL =
  "http://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_DocumentPlenumSession";
const GROUP_TYPE_ID = 28;
const PAGE_SIZE = 100;
const CONCURRENCY = 6;

function normalizeFileUrl(fileUrl) {
  return String(fileUrl || "").replace("https://fs.knesset.gov.il//", "https://fs.knesset.gov.il/");
}

function normalizeProtocolRecord(entry) {
  const session = entry.KNS_PlenumSession || {};
  const dateParts = formatDateParts(session.StartDate);

  return {
    documentId: String(entry.DocumentPlenumSessionID),
    plenumSessionId: String(session.PlenumSessionID || entry.PlenumSessionID || ""),
    sessionNumber: session.Number ?? null,
    knessetNumber: session.KnessetNum ?? null,
    title: session.Name || "ישיבת מליאה",
    startDate: session.StartDate || null,
    finishDate: session.FinishDate || null,
    isSpecialMeeting: Boolean(session.IsSpecialMeeting),
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
    searchText: normalizeSearchText(
      [
        dateParts.dateKey,
        dateParts.shortDateLabel,
        dateParts.longDateLabel,
        dateParts.timeLabel,
        session.Name,
        session.Number,
        session.KnessetNum,
      ].join(" "),
    ),
  };
}

class KnessetClient {
  async fetchJson(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });

    if (!response.ok) {
      throw new Error(`Knesset API request failed with ${response.status}`);
    }

    return response.json();
  }

  async fetchText(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });

    if (!response.ok) {
      throw new Error(`Knesset API request failed with ${response.status}`);
    }

    return response.text();
  }

  async fetchProtocolCount() {
    const countUrl = `${ODATA_BASE_URL}/$count?$filter=GroupTypeID%20eq%20${GROUP_TYPE_ID}`;
    const rawCount = await this.fetchText(countUrl);
    const count = Number(rawCount);

    if (!Number.isFinite(count)) {
      throw new Error(`Unable to parse protocol count from "${rawCount}"`);
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
        `$filter=GroupTypeID eq ${GROUP_TYPE_ID}`,
        "$expand=KNS_PlenumSession",
        `$top=${PAGE_SIZE}`,
        `$skip=${skip}`,
        "$format=json",
      ].join("&");
      const pageUrl = `${ODATA_BASE_URL}?${encodeURI(query)}`;
      const data = await this.fetchJson(pageUrl);

      return Array.isArray(data.value)
        ? data.value.map(normalizeProtocolRecord)
        : [];
    });

    return pages.flat();
  }
}

module.exports = {
  KnessetClient,
};
