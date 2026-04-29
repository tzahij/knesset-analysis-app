const fs = require("fs/promises");
const path = require("path");

const { FINAL_READING_STATUS_ID, LawClient } = require("./law-client");
const { extractPdfText, extractWordText, splitIntoParagraphs } = require("./word-parser");
const {
  ensureDirectory,
  fileExists,
  readJson,
  sanitizeFilename,
  toErrorMessage,
  writeJson,
} = require("./utils");

function trimNamePart(value, maxLength = 72) {
  const normalized = sanitizeFilename(value || "");
  return Array.from(normalized).slice(0, maxLength).join("") || "law";
}

function formatDocumentLabel(document) {
  if (!document) {
    return "";
  }

  if (document.isOfficialPdf) {
    return "PDF רשמי";
  }

  if (document.kind === "word") {
    return "קובץ Word";
  }

  if (document.kind === "pdf") {
    return "קובץ PDF";
  }

  return document.applicationLabel || "קובץ";
}

class LawStore {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname, "..", "..");
    this.dataDir = options.dataDir || path.join(this.rootDir, "data");
    this.rawDir = path.join(this.dataDir, "law-raw");
    this.parsedDir = path.join(this.dataDir, "law-parsed");
    this.cacheFile = path.join(this.dataDir, "laws.json");
    this.lawClient = new LawClient();
    this.promotionService = options.promotionService || null;
    this.laws = null;
    this.lawById = new Map();
    this.lawsPromise = null;
    this.metadataInfo = {
      syncedAt: null,
      total: 0,
      cacheState: "empty",
      statusId: FINAL_READING_STATUS_ID,
      statusLabel: "התקבלה בקריאה שלישית",
      limit: null,
    };
    this.initialized = false;
    this.cacheFreshMs = 24 * 60 * 60 * 1000;
    this.parserVersion = 2;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    await Promise.all([
      ensureDirectory(this.dataDir),
      ensureDirectory(this.rawDir),
      ensureDirectory(this.parsedDir),
    ]);

    this.initialized = true;
  }

  setLaws(items, metadataInfo) {
    this.laws = items;
    this.lawById = new Map(items.map((law) => [String(law.billId), law]));
    this.metadataInfo = metadataInfo;
    return items;
  }

  async loadLawsFromCache() {
    if (!(await fileExists(this.cacheFile))) {
      return null;
    }

    const cached = await readJson(this.cacheFile);
    const syncedAt = cached.syncedAt || null;
    const ageMs = syncedAt ? Date.now() - Date.parse(syncedAt) : Number.POSITIVE_INFINITY;
    const items = Array.isArray(cached.items) ? cached.items : [];

    return {
      items,
      metadataInfo: {
        syncedAt,
        total: items.length,
        cacheState: ageMs <= this.cacheFreshMs ? "fresh" : "stale",
        statusId: FINAL_READING_STATUS_ID,
        statusLabel: "התקבלה בקריאה שלישית",
        limit: null,
      },
    };
  }

  sortLaws(items) {
    items.sort((left, right) => {
      if (right.dateSortValue !== left.dateSortValue) {
        return right.dateSortValue - left.dateSortValue;
      }

      return Number(right.billId) - Number(left.billId);
    });
  }

  buildMetadataInfo(items, options = {}) {
    return {
      syncedAt: options.syncedAt || null,
      total: Array.isArray(items) ? items.length : 0,
      cacheState: options.cacheState || "fresh",
      statusId: FINAL_READING_STATUS_ID,
      statusLabel: "התקבלה בקריאה שלישית",
      limit: null,
    };
  }

  async fetchLatestLawsMetadata() {
    const items = await this.lawClient.fetchRecentPassedLaws();
    this.sortLaws(items);
    return items;
  }

  async persistLawsMetadata(items, options = {}) {
    const normalizedItems = Array.isArray(items) ? [...items] : [];
    this.sortLaws(normalizedItems);

    const syncedAt = options.syncedAt || new Date().toISOString();

    await writeJson(this.cacheFile, {
      syncedAt,
      total: normalizedItems.length,
      items: normalizedItems,
    });
    this.promotionService?.requestPathPromotion(path.relative(this.rootDir, this.cacheFile));

    return this.setLaws(
      normalizedItems,
      this.buildMetadataInfo(normalizedItems, {
        syncedAt,
        cacheState: options.cacheState || "fresh",
      }),
    );
  }

  async syncLawsMetadata() {
    const items = await this.fetchLatestLawsMetadata();
    const syncedAt = new Date().toISOString();

    await writeJson(this.cacheFile, {
      syncedAt,
      total: items.length,
      items,
    });
    this.promotionService?.requestPathPromotion(path.relative(this.rootDir, this.cacheFile));

    return this.setLaws(items, {
      syncedAt,
      total: items.length,
      cacheState: "fresh",
      statusId: FINAL_READING_STATUS_ID,
      statusLabel: "התקבלה בקריאה שלישית",
      limit: null,
    });
  }

  async previewUpdates() {
    await this.initialize();

    if (this.lawsPromise) {
      await this.lawsPromise;
    }

    const cached = await this.loadLawsFromCache();
    const previousItems = cached?.items || this.laws || [];
    const previousIds = new Set(previousItems.map((law) => String(law.billId)));
    const items = await this.fetchLatestLawsMetadata();
    const addedItems = items.filter((law) => !previousIds.has(String(law.billId)));

    return {
      items,
      addedItems,
      metadata: this.buildMetadataInfo(items, {
        syncedAt: new Date().toISOString(),
        cacheState: "preview",
      }),
    };
  }

  async applyMetadataSnapshot(items) {
    await this.initialize();
    return this.persistLawsMetadata(items);
  }

  async getLaws(options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);
    await this.initialize();

    if (this.laws && !forceRefresh) {
      return this.laws;
    }

    if (this.lawsPromise) {
      return this.lawsPromise;
    }

    this.lawsPromise = (async () => {
      if (!forceRefresh) {
        const cached = await this.loadLawsFromCache();

        if (cached && cached.metadataInfo.cacheState === "fresh") {
          return this.setLaws(cached.items, cached.metadataInfo);
        }
      }

      try {
        return await this.syncLawsMetadata();
      } catch (error) {
        const cached = await this.loadLawsFromCache();

        if (cached) {
          return this.setLaws(cached.items, {
            ...cached.metadataInfo,
            cacheState: "stale",
          });
        }

        throw error;
      }
    })();

    try {
      return await this.lawsPromise;
    } finally {
      this.lawsPromise = null;
    }
  }

  getMetadataInfo() {
    return { ...this.metadataInfo };
  }

  getAvailableYears() {
    const years = new Set(
      (this.laws || []).map((law) => law.year).filter((year) => Number.isFinite(year)),
    );

    return Array.from(years).sort((left, right) => right - left);
  }

  async getLawById(billId) {
    await this.getLaws();
    return this.lawById.get(String(billId)) || null;
  }

  buildDownloadBaseName(law, document) {
    return sanitizeFilename(
      [law.dateKey, trimNamePart(law.title), `bill-${law.billId}`, document.kind].join("__"),
    );
  }

  getRawMetaPath(billId, storageKey) {
    return path.join(this.rawDir, `${billId}__${storageKey}.json`);
  }

  getParsedContentPath(billId) {
    return path.join(this.parsedDir, `${billId}.json`);
  }

  getAvailableDownloads(law) {
    return {
      pdf: law.hasOfficialPdf,
      word: law.hasWordDocument,
    };
  }

  selectReadableDocument(law) {
    if (!law) {
      return null;
    }

    return (
      this.selectDocument(law, "word") ||
      this.selectDocument(law, "pdf") ||
      law.documents.find((document) => document.kind === "pdf") ||
      null
    );
  }

  selectDocument(law, requestedKind = "pdf") {
    if (requestedKind === "word") {
      return law.wordDocument || null;
    }

    if (requestedKind === "pdf") {
      return law.officialPdfDocument || null;
    }

    return law.officialPdfDocument || law.wordDocument || law.documents[0] || null;
  }

  async ensureLawDocumentFile(law, requestedKind = "pdf", preferredDocument = null) {
    const document = preferredDocument || this.selectDocument(law, requestedKind);

    if (!document) {
      return null;
    }

    const metaPath = this.getRawMetaPath(law.billId, document.storageKey);

    if (await fileExists(metaPath)) {
      const existingMeta = await readJson(metaPath);

      if (existingMeta.localFilePath && (await fileExists(existingMeta.localFilePath))) {
        return existingMeta;
      }
    }

    const response = await fetch(document.fileUrl, { signal: AbortSignal.timeout(60000) });

    if (!response.ok) {
      throw new Error(`Law download failed with ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const extension = document.extension || (document.kind === "pdf" ? ".pdf" : ".doc");
    const localFilePath = path.join(this.rawDir, `${law.billId}__${document.storageKey}${extension}`);
    const downloadName = `${this.buildDownloadBaseName(law, document)}${extension}`;

    await fs.writeFile(localFilePath, buffer);

    const meta = {
      billId: law.billId,
      title: law.title,
      kind: document.kind,
      storageKey: document.storageKey,
      originalUrl: document.fileUrl,
      localFilePath,
      extension,
      format: document.kind === "pdf" ? "pdf" : extension.replace(".", ""),
      contentType:
        document.kind === "pdf"
          ? "application/pdf"
          : extension === ".docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/msword",
      downloadName,
      groupTypeId: document.groupTypeId,
      groupTypeDescription: document.groupTypeDescription,
      applicationLabel: document.applicationLabel,
      savedAt: new Date().toISOString(),
    };

    await writeJson(metaPath, meta);
    this.promotionService?.requestPathPromotion([
      path.relative(this.rootDir, localFilePath),
      path.relative(this.rootDir, metaPath),
    ]);
    return meta;
  }

  buildSummaryParagraphs(law, options = {}) {
    const paragraphs = [
      `${law.title} פורסם בתאריך ${law.longDateLabel} ומסווג באתר הכנסת כפריט שהתקבל בקריאה שלישית.`,
      `הסטטוס הרשמי של הפריט הוא "${law.statusDesc || "התקבלה בקריאה שלישית"}", וברשומות הוא מופיע תחת "${law.publicationSeriesDesc || "ספר החוקים"}".`,
    ];

    const readableDocument = options.readableDocument || null;

    if (law.summaryLaw) {
      paragraphs.push(`תקציר רשמי: ${law.summaryLaw}`);
    }

    if (options.hasReadableText && readableDocument?.kind === "word") {
      paragraphs.push(
        "להלן מוצג הנוסח הקריא של החוק מתוך קובץ Word זמין באתר הכנסת. לקובץ ה-PDF הרשמי אפשר לעבור מכפתורי ההורדה שבצד.",
      );
    } else if (options.hasReadableText && readableDocument?.kind === "pdf") {
      paragraphs.push(
        readableDocument.isOfficialPdf
          ? "להלן מוצג נוסח קריא שחולץ מתוך ה-PDF הרשמי של החוק, משום שלפריט הזה לא סופק קובץ Word קריא במטא-דאטה של הכנסת."
          : "להלן מוצג נוסח קריא שחולץ מתוך קובץ PDF זמין באתר הכנסת, משום שלפריט הזה לא סופק קובץ Word קריא במטא-דאטה שנשמרה.",
      );
    } else if (law.hasOfficialPdf) {
      paragraphs.push(
        "בפריט הזה לא נמצא קובץ Word קריא במטמון המקומי, לכן מוצג כאן תקציר מטא-דאטה בלבד. את נוסח ה-PDF הרשמי אפשר להוריד ישירות.",
      );
    } else if (law.hasWordDocument) {
      paragraphs.push(
        "בפריט הזה זמין קובץ Word להורדה, אך לא קיים PDF רשמי נפרד במטא-דאטה שנשמר. אפשר להשתמש בכפתור ההורדה כדי לפתוח את נוסח החוק.",
      );
    } else {
      paragraphs.push("בפריט הזה לא נמצא כרגע קובץ PDF או Word זמין להורדה מתוך מטא-הדאטה שנשמרה.");
    }

    return paragraphs;
  }

  async getLawContent(billId) {
    const law = await this.getLawById(billId);

    if (!law) {
      return null;
    }

    const readableDocument = this.selectReadableDocument(law);
    const summaryParagraphs = this.buildSummaryParagraphs(law, {
      hasReadableText: Boolean(readableDocument),
      readableDocument,
    });

    if (!readableDocument) {
      return {
        law,
        summaryParagraphs,
        paragraphs: [],
        text: "",
        extractedAt: null,
        extension: null,
        format: null,
        hasReadableText: false,
        parseError: null,
        availableDownloads: this.getAvailableDownloads(law),
      };
    }

    const parsedPath = this.getParsedContentPath(law.billId);

    if (await fileExists(parsedPath)) {
      const parsed = await readJson(parsedPath);

      if (
        parsed.parserVersion === this.parserVersion &&
        parsed.sourceStorageKey === readableDocument.storageKey
      ) {
        return {
          law,
          summaryParagraphs,
          ...parsed,
          hasReadableText: true,
          parseError: null,
          availableDownloads: this.getAvailableDownloads(law),
        };
      }
    }

    try {
      const fileMeta = await this.ensureLawDocumentFile(
        law,
        readableDocument.kind,
        readableDocument,
      );
      const text =
        readableDocument.kind === "pdf"
          ? await extractPdfText(fileMeta.localFilePath)
          : await extractWordText(fileMeta.localFilePath, fileMeta.format);
      const paragraphs = splitIntoParagraphs(text);
      const parsed = {
        parserVersion: this.parserVersion,
        sourceStorageKey: readableDocument.storageKey,
        extractedAt: new Date().toISOString(),
        format: fileMeta.format,
        extension: fileMeta.extension,
        text,
        paragraphs,
      };

      await writeJson(parsedPath, parsed);
      this.promotionService?.requestPathPromotion(path.relative(this.rootDir, parsedPath));

      return {
        law,
        summaryParagraphs,
        ...parsed,
        hasReadableText: true,
        parseError: null,
        availableDownloads: this.getAvailableDownloads(law),
      };
    } catch (error) {
      return {
        law,
        summaryParagraphs: [
          ...summaryParagraphs,
          `המערכת לא הצליחה להמיר את קובץ ה-Word לנוסח קריא: ${toErrorMessage(error)}`,
        ],
        paragraphs: [],
        text: "",
        extractedAt: null,
        extension: readableDocument.extension || null,
        format: readableDocument.kind || null,
        hasReadableText: false,
        parseError: toErrorMessage(error),
        availableDownloads: this.getAvailableDownloads(law),
      };
    }
  }

  async getDownloadableFile(billId, requestedKind = "pdf") {
    const law = await this.getLawById(billId);

    if (!law) {
      return null;
    }

    const document = this.selectDocument(law, requestedKind);

    if (!document) {
      return null;
    }

    const fileMeta = await this.ensureLawDocumentFile(law, requestedKind);

    return {
      law,
      documentLabel: formatDocumentLabel(document),
      requestedKind,
      ...fileMeta,
    };
  }
}

module.exports = {
  LawStore,
};
