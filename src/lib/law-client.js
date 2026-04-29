const path = require("path");

const { formatDateParts, normalizeSearchText } = require("./utils");

const ODATA_BASE_URL = "http://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_Bill";
const FINAL_READING_STATUS_ID = 118;
const PAGE_SIZE = 50;
// Safety bound for pagination. The fetch now walks the full third-reading catalog
// instead of stopping at 100 laws, but we still keep a very high page ceiling.
const MAX_PAGES = 500;

function normalizeFileUrl(fileUrl) {
  return String(fileUrl || "")
    .replace("https://fs.knesset.gov.il//", "https://fs.knesset.gov.il/")
    .replace("http://fs.knesset.gov.il//", "https://fs.knesset.gov.il/");
}

function getFileExtension(fileUrl, applicationLabel) {
  const urlValue = String(fileUrl || "").split("?")[0];
  const fileExtension = path.extname(urlValue).toLowerCase();

  if ([".pdf", ".doc", ".docx"].includes(fileExtension)) {
    return fileExtension;
  }

  const normalizedLabel = String(applicationLabel || "").toLowerCase();

  if (normalizedLabel.includes("docx")) {
    return ".docx";
  }

  if (normalizedLabel.includes("doc")) {
    return ".doc";
  }

  if (normalizedLabel.includes("pdf")) {
    return ".pdf";
  }

  return "";
}

function getDocumentKind(extension, applicationLabel) {
  if (extension === ".pdf") {
    return "pdf";
  }

  if (extension === ".doc" || extension === ".docx") {
    return "word";
  }

  const normalizedLabel = String(applicationLabel || "").toLowerCase();

  if (normalizedLabel.includes("pdf")) {
    return "pdf";
  }

  if (normalizedLabel.includes("doc")) {
    return "word";
  }

  return "unknown";
}

function normalizeLawDocument(entry, index) {
  const nestedDocument = entry.KNS_Document || {};
  const fileUrl = normalizeFileUrl(entry.FilePath || nestedDocument.FilePath || "");

  if (!fileUrl) {
    return null;
  }

  const applicationLabel = entry.ApplicationDesc || nestedDocument.ApplicationDesc || "";
  const extension = getFileExtension(fileUrl, applicationLabel);
  const kind = getDocumentKind(extension, applicationLabel);
  const groupTypeId = Number(entry.GroupTypeID || nestedDocument.GroupTypeID || 0) || null;
  const groupTypeDescription = entry.GroupTypeDesc || nestedDocument.GroupTypeDesc || "";
  const documentId =
    entry.DocumentID ||
    entry.DocumentBillID ||
    nestedDocument.DocumentID ||
    nestedDocument.DocumentBillID ||
    null;

  return {
    storageKey: `${groupTypeId || "group"}-${documentId || index}-${kind}`,
    documentId: documentId ? String(documentId) : null,
    groupTypeId,
    groupTypeDescription,
    applicationLabel: applicationLabel || extension.replace(".", "").toUpperCase() || "FILE",
    fileUrl,
    extension,
    kind,
    isOfficialPdf:
      kind === "pdf" &&
      (groupTypeId === 9 || groupTypeDescription.includes("פרסום ברשומות")),
    isPreferredWord:
      kind === "word" &&
      (groupTypeId === 8 || groupTypeDescription.includes("נוסח לא רשמי")),
  };
}

function selectPreferredPdfDocument(documents) {
  return (
    documents.find((document) => document.kind === "pdf" && document.isOfficialPdf) ||
    documents.find(
      (document) =>
        document.kind === "pdf" &&
        document.groupTypeDescription.includes("פרסום ברשומות"),
    ) ||
    documents.find((document) => document.kind === "pdf") ||
    null
  );
}

function selectPreferredWordDocument(documents) {
  return (
    documents.find((document) => document.kind === "word" && document.isPreferredWord) ||
    documents.find(
      (document) =>
        document.kind === "word" &&
        document.groupTypeDescription.includes("נוסח לא רשמי"),
    ) ||
    documents.find((document) => document.kind === "word") ||
    null
  );
}

function normalizeLawRecord(entry) {
  const publicationDate = entry.PublicationDate || entry.LastUpdatedDate || null;
  const dateParts = formatDateParts(publicationDate);
  const documents = Array.isArray(entry.KNS_DocumentBills)
    ? entry.KNS_DocumentBills.map(normalizeLawDocument).filter(Boolean)
    : [];
  const officialPdf = selectPreferredPdfDocument(documents);
  const wordDocument = selectPreferredWordDocument(documents);

  return {
    billId: String(entry.BillID),
    lawId: entry.LawID ? String(entry.LawID) : null,
    title: entry.Name || "חוק הכנסת",
    publicationDate,
    publicationSeriesDesc: entry.PublicationSeriesDesc || "",
    statusId: Number(entry.StatusID || 0) || null,
    statusDesc: entry.KNS_Status?.Desc || "",
    summaryLaw: entry.SummaryLaw || "",
    dateSortValue: publicationDate ? new Date(publicationDate).getTime() : 0,
    year: dateParts.year,
    dateKey: dateParts.dateKey,
    shortDateLabel: dateParts.shortDateLabel,
    longDateLabel: dateParts.longDateLabel,
    documents,
    officialPdfDocument: officialPdf,
    wordDocument,
    hasOfficialPdf: Boolean(officialPdf && officialPdf.kind === "pdf"),
    hasWordDocument: Boolean(wordDocument),
    searchText: normalizeSearchText(
      [
        entry.BillID,
        entry.LawID,
        entry.Name,
        entry.PublicationSeriesDesc,
        entry.KNS_Status?.Desc,
        dateParts.shortDateLabel,
        dateParts.longDateLabel,
        dateParts.dateKey,
      ].join(" "),
    ),
  };
}

function buildQuery(skip) {
  return [
    `$filter=StatusID eq ${FINAL_READING_STATUS_ID}`,
    "$expand=KNS_Status,KNS_DocumentBills",
    "$orderby=PublicationDate desc",
    `$top=${PAGE_SIZE}`,
    `$skip=${skip}`,
    "$format=json",
  ].join("&");
}

class LawClient {
  async fetchJson(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });

    if (!response.ok) {
      throw new Error(`Knesset law API request failed with ${response.status}`);
    }

    return response.json();
  }

  async fetchRecentPassedLaws() {
    const allItems = [];
    const seenBillIds = new Set();

    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
      const skip = pageIndex * PAGE_SIZE;
      const pageUrl = `${ODATA_BASE_URL}?${encodeURI(buildQuery(skip))}`;
      const data = await this.fetchJson(pageUrl);
      const pageItems = Array.isArray(data.value) ? data.value.map(normalizeLawRecord) : [];

      if (!pageItems.length) {
        break;
      }

      for (const item of pageItems) {
        if (!item || item.statusId !== FINAL_READING_STATUS_ID || seenBillIds.has(item.billId)) {
          continue;
        }

        seenBillIds.add(item.billId);
        allItems.push(item);
      }

      if (pageItems.length < PAGE_SIZE) {
        break;
      }
    }

    allItems.sort((left, right) => {
      if (right.dateSortValue !== left.dateSortValue) {
        return right.dateSortValue - left.dateSortValue;
      }

      return Number(right.billId) - Number(left.billId);
    });

    return allItems;
  }
}

module.exports = {
  FINAL_READING_STATUS_ID,
  LawClient,
};
