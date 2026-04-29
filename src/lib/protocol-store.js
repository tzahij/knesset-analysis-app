const fs = require("fs/promises");
const path = require("path");

const { KnessetClient } = require("./knesset-client");
const { extractWordText, sniffWordFormat, splitIntoParagraphs } = require("./word-parser");
const {
  ensureDirectory,
  fileExists,
  readJson,
  sanitizeFilename,
  toErrorMessage,
  writeJson,
} = require("./utils");

class ProtocolStore {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname, "..", "..");
    this.dataDir = options.dataDir || path.join(this.rootDir, "data");
    this.rawDir = path.join(this.dataDir, "raw");
    this.parsedDir = path.join(this.dataDir, "parsed");
    this.downloadDir = path.join(this.dataDir, "downloads", "all-protocols");
    this.protocolCacheFile = path.join(this.dataDir, "protocols.json");
    this.knessetClient = new KnessetClient();
    this.promotionService = options.promotionService || null;
    this.protocols = null;
    this.protocolById = new Map();
    this.protocolsPromise = null;
    this.bulkDownloadPromise = null;
    this.metadataInfo = {
      syncedAt: null,
      total: 0,
      cacheState: "empty",
    };
    this.parserVersion = 2;
    this.bulkStatus = this.createIdleBulkStatus();
    this.initialized = false;
    this.cacheFreshMs = 24 * 60 * 60 * 1000;
  }

  createIdleBulkStatus() {
    return {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      total: 0,
      processed: 0,
      saved: 0,
      skipped: 0,
      failed: 0,
      current: null,
      recentErrors: [],
      downloadDir: this.downloadDir,
    };
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    await Promise.all([
      ensureDirectory(this.dataDir),
      ensureDirectory(this.rawDir),
      ensureDirectory(this.parsedDir),
      ensureDirectory(this.downloadDir),
    ]);

    this.initialized = true;
  }

  setProtocols(items, metadataInfo) {
    this.protocols = items;
    this.protocolById = new Map(items.map((protocol) => [String(protocol.documentId), protocol]));
    this.metadataInfo = metadataInfo;
    return items;
  }

  async loadProtocolsFromCache() {
    if (!(await fileExists(this.protocolCacheFile))) {
      return null;
    }

    const cached = await readJson(this.protocolCacheFile);
    const syncedAt = cached.syncedAt || null;
    const ageMs = syncedAt ? Date.now() - Date.parse(syncedAt) : Number.POSITIVE_INFINITY;

    return {
      items: Array.isArray(cached.items) ? cached.items : [],
      metadataInfo: {
        syncedAt,
        total: Array.isArray(cached.items) ? cached.items.length : 0,
        cacheState: ageMs <= this.cacheFreshMs ? "fresh" : "stale",
      },
    };
  }

  sortProtocols(items) {
    items.sort((left, right) => {
      if (right.dateSortValue !== left.dateSortValue) {
        return right.dateSortValue - left.dateSortValue;
      }

      return Number(right.documentId) - Number(left.documentId);
    });
  }

  buildMetadataInfo(items, options = {}) {
    return {
      syncedAt: options.syncedAt || null,
      total: Array.isArray(items) ? items.length : 0,
      cacheState: options.cacheState || "fresh",
    };
  }

  async fetchLatestProtocolsMetadata() {
    const items = await this.knessetClient.fetchProtocolsMetadata();
    this.sortProtocols(items);
    return items;
  }

  async persistProtocolsMetadata(items, options = {}) {
    const normalizedItems = Array.isArray(items) ? [...items] : [];
    this.sortProtocols(normalizedItems);

    const syncedAt = options.syncedAt || new Date().toISOString();
    await writeJson(this.protocolCacheFile, {
      syncedAt,
      total: normalizedItems.length,
      items: normalizedItems,
    });
    this.promotionService?.requestPathPromotion(path.relative(this.rootDir, this.protocolCacheFile));

    return this.setProtocols(
      normalizedItems,
      this.buildMetadataInfo(normalizedItems, {
        syncedAt,
        cacheState: options.cacheState || "fresh",
      }),
    );
  }

  async syncProtocolsMetadata() {
    const items = await this.fetchLatestProtocolsMetadata();
    return this.persistProtocolsMetadata(items);
  }

  async previewUpdates() {
    await this.initialize();

    if (this.protocolsPromise) {
      await this.protocolsPromise;
    }

    const cached = await this.loadProtocolsFromCache();
    const previousItems = cached?.items || this.protocols || [];
    const previousIds = new Set(previousItems.map((protocol) => String(protocol.documentId)));
    const items = await this.fetchLatestProtocolsMetadata();
    const addedItems = items.filter((protocol) => !previousIds.has(String(protocol.documentId)));

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
    return this.persistProtocolsMetadata(items);
  }

  async checkForUpdates() {
    await this.initialize();

    if (this.protocolsPromise) {
      await this.protocolsPromise;
    }

    const cached = await this.loadProtocolsFromCache();
    const previousItems = this.protocols || cached?.items || [];
    const previousIds = new Set(previousItems.map((protocol) => String(protocol.documentId)));

    this.protocolsPromise = (async () => {
      const items = await this.syncProtocolsMetadata();
      const addedItems = items.filter((protocol) => !previousIds.has(String(protocol.documentId)));

      return {
        items,
        addedItems,
        metadata: this.getMetadataInfo(),
      };
    })();

    try {
      return await this.protocolsPromise;
    } finally {
      this.protocolsPromise = null;
    }
  }

  async getProtocols(options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);
    await this.initialize();

    if (this.protocols && !forceRefresh) {
      return this.protocols;
    }

    if (this.protocolsPromise) {
      return this.protocolsPromise;
    }

    this.protocolsPromise = (async () => {
      if (!forceRefresh) {
        const cached = await this.loadProtocolsFromCache();

        if (cached && cached.metadataInfo.cacheState === "fresh") {
          return this.setProtocols(cached.items, cached.metadataInfo);
        }
      }

      try {
        return await this.syncProtocolsMetadata();
      } catch (error) {
        const cached = await this.loadProtocolsFromCache();

        if (cached) {
          return this.setProtocols(cached.items, {
            ...cached.metadataInfo,
            cacheState: "stale",
          });
        }

        throw error;
      }
    })();

    try {
      return await this.protocolsPromise;
    } finally {
      this.protocolsPromise = null;
    }
  }

  getMetadataInfo() {
    return { ...this.metadataInfo };
  }

  getAvailableYears() {
    const years = new Set(
      (this.protocols || [])
        .map((protocol) => protocol.year)
        .filter((year) => Number.isFinite(year)),
    );

    return Array.from(years).sort((left, right) => right - left);
  }

  async getProtocolById(documentId) {
    await this.getProtocols();
    return this.protocolById.get(String(documentId)) || null;
  }

  buildDownloadBaseName(protocol) {
    const segments = [protocol.dateKey];

    if (protocol.timeKey) {
      segments.push(protocol.timeKey);
    }

    if (protocol.sessionNumber) {
      segments.push(`session-${protocol.sessionNumber}`);
    }

    segments.push(`protocol-${protocol.documentId}`);
    return sanitizeFilename(segments.join("__"));
  }

  getRawMetaPath(documentId) {
    return path.join(this.rawDir, `${documentId}.json`);
  }

  getParsedContentPath(documentId) {
    return path.join(this.parsedDir, `${documentId}.json`);
  }

  async ensureProtocolFile(protocol) {
    const metaPath = this.getRawMetaPath(protocol.documentId);

    if (await fileExists(metaPath)) {
      const existingMeta = await readJson(metaPath);

      if (existingMeta.localFilePath && (await fileExists(existingMeta.localFilePath))) {
        return existingMeta;
      }
    }

    const response = await fetch(protocol.fileUrl, { signal: AbortSignal.timeout(60000) });

    if (!response.ok) {
      throw new Error(`Protocol download failed with ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const formatInfo = sniffWordFormat(buffer);
    const localFilePath = path.join(this.rawDir, `${protocol.documentId}${formatInfo.extension}`);
    const downloadName = `${this.buildDownloadBaseName(protocol)}${formatInfo.extension}`;

    await fs.writeFile(localFilePath, buffer);

    const meta = {
      documentId: protocol.documentId,
      originalUrl: protocol.fileUrl,
      localFilePath,
      format: formatInfo.format,
      extension: formatInfo.extension,
      contentType: formatInfo.contentType,
      downloadName,
      savedAt: new Date().toISOString(),
    };

    await writeJson(metaPath, meta);
    this.promotionService?.requestPathPromotion([
      path.relative(this.rootDir, localFilePath),
      path.relative(this.rootDir, metaPath),
    ]);
    return meta;
  }

  async getProtocolContent(documentId) {
    const protocol = await this.getProtocolById(documentId);

    if (!protocol) {
      return null;
    }

    const parsedPath = this.getParsedContentPath(protocol.documentId);

    if (await fileExists(parsedPath)) {
      const parsed = await readJson(parsedPath);
      if (parsed.parserVersion === this.parserVersion) {
        return {
          protocol,
          ...parsed,
        };
      }
    }

    const fileMeta = await this.ensureProtocolFile(protocol);
    const text = await extractWordText(fileMeta.localFilePath, fileMeta.format);
    const paragraphs = splitIntoParagraphs(text);
    const parsed = {
      parserVersion: this.parserVersion,
      extractedAt: new Date().toISOString(),
      format: fileMeta.format,
      extension: fileMeta.extension,
      text,
      paragraphs,
    };

    await writeJson(parsedPath, parsed);
    this.promotionService?.requestPathPromotion(path.relative(this.rootDir, parsedPath));

    return {
      protocol,
      ...parsed,
    };
  }

  async getDownloadableFile(documentId) {
    const protocol = await this.getProtocolById(documentId);

    if (!protocol) {
      return null;
    }

    const fileMeta = await this.ensureProtocolFile(protocol);

    return {
      protocol,
      ...fileMeta,
    };
  }

  async copyProtocolToDownloadFolder(protocol) {
    const fileMeta = await this.ensureProtocolFile(protocol);
    const targetPath = path.join(this.downloadDir, fileMeta.downloadName);

    if (await fileExists(targetPath)) {
      return {
        skipped: true,
        saved: false,
        targetPath,
      };
    }

    await fs.copyFile(fileMeta.localFilePath, targetPath);

    return {
      skipped: false,
      saved: true,
      targetPath,
    };
  }

  getBulkStatus() {
    return {
      ...this.bulkStatus,
      current: this.bulkStatus.current ? { ...this.bulkStatus.current } : null,
      recentErrors: [...this.bulkStatus.recentErrors],
      downloadDir: this.downloadDir,
    };
  }

  async runBulkDownload(protocols) {
    const concurrency = 4;
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= protocols.length) {
          return;
        }

        const protocol = protocols[currentIndex];
        this.bulkStatus.current = {
          documentId: protocol.documentId,
          title: protocol.title,
          dateLabel: protocol.shortDateLabel,
        };

        try {
          const result = await this.copyProtocolToDownloadFolder(protocol);

          if (result.saved) {
            this.bulkStatus.saved += 1;
          }

          if (result.skipped) {
            this.bulkStatus.skipped += 1;
          }
        } catch (error) {
          this.bulkStatus.failed += 1;
          this.bulkStatus.recentErrors = [
            `${protocol.documentId}: ${toErrorMessage(error)}`,
            ...this.bulkStatus.recentErrors,
          ].slice(0, 10);
        } finally {
          this.bulkStatus.processed += 1;
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    this.bulkStatus.status = this.bulkStatus.failed > 0 ? "completed_with_errors" : "completed";
    this.bulkStatus.finishedAt = new Date().toISOString();
    this.bulkStatus.current = null;
  }

  async startBulkDownload() {
    await this.initialize();

    if (this.bulkDownloadPromise) {
      return this.getBulkStatus();
    }

    const protocols = await this.getProtocols();
    this.bulkStatus = {
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      total: protocols.length,
      processed: 0,
      saved: 0,
      skipped: 0,
      failed: 0,
      current: null,
      recentErrors: [],
      downloadDir: this.downloadDir,
    };

    this.bulkDownloadPromise = this.runBulkDownload(protocols)
      .catch((error) => {
        this.bulkStatus.status = "failed";
        this.bulkStatus.finishedAt = new Date().toISOString();
        this.bulkStatus.current = null;
        this.bulkStatus.recentErrors = [toErrorMessage(error)];
      })
      .finally(() => {
        this.bulkDownloadPromise = null;
      });

    return this.getBulkStatus();
  }
}

module.exports = {
  ProtocolStore,
};
