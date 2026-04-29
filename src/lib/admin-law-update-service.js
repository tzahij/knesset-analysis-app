const fs = require("fs/promises");
const path = require("path");

const { ensureDirectory, fileExists, readJson, toErrorMessage, writeJson } = require("./utils");

function summarizeAddedLaw(law) {
  const availableDocuments = [];

  if (law.hasOfficialPdf) {
    availableDocuments.push("PDF");
  }

  if (law.hasWordDocument) {
    availableDocuments.push("Word");
  }

  return {
    billId: law.billId,
    lawId: law.lawId || null,
    title: law.title,
    shortDateLabel: law.shortDateLabel,
    publicationSeriesDesc: law.publicationSeriesDesc || "",
    availableDocuments,
    label: `${law.shortDateLabel} - ${law.title}`,
  };
}

class AdminLawUpdateService {
  constructor(options = {}) {
    this.rootDir = options.rootDir;
    this.dataDir = path.join(this.rootDir, "data");
    this.previewPath = path.join(this.dataDir, "admin-law-update-preview.json");
    this.lawStore = options.lawStore;
    this.lawVoteStore = options.lawVoteStore || null;
    this.currentCheckPromise = null;
  }

  async initialize() {
    await ensureDirectory(this.dataDir);
  }

  buildLawPayload(result) {
    return {
      status: "ok",
      addedCount: result.addedItems.length,
      total: result.items.length,
      metadata: result.metadata,
      addedItems: result.addedItems.map(summarizeAddedLaw),
      addedBillIds: result.addedItems.map((law) => String(law.billId)),
      snapshotItems: result.items,
    };
  }

  toPublicPayload(preview) {
    if (!preview) {
      return {
        status: "idle",
        startedAt: null,
        checkedAt: null,
        approvedAt: null,
        error: null,
        hasPendingApproval: false,
        totalAdded: 0,
        downloadSummary: null,
        laws: {
          status: "idle",
          addedCount: 0,
          total: 0,
          metadata: null,
          addedItems: [],
        },
      };
    }

    const laws = preview.laws || {};

    return {
      status: preview.status || "ready_for_review",
      startedAt: preview.startedAt || null,
      checkedAt: preview.checkedAt || null,
      approvedAt: preview.approvedAt || null,
      error: preview.error || null,
      hasPendingApproval: preview.status === "ready_for_review" && Number(preview.totalAdded || 0) > 0,
      totalAdded: Number(preview.totalAdded || 0),
      downloadSummary: preview.downloadSummary || null,
      laws: {
        status: laws.status || "idle",
        addedCount: Number(laws.addedCount || 0),
        total: Number(laws.total || 0),
        metadata: laws.metadata || null,
        addedItems: Array.isArray(laws.addedItems) ? laws.addedItems : [],
      },
    };
  }

  async readPreview() {
    await this.initialize();

    if (!(await fileExists(this.previewPath))) {
      return null;
    }

    try {
      return await readJson(this.previewPath);
    } catch {
      return null;
    }
  }

  async writePreview(preview) {
    await this.initialize();
    await writeJson(this.previewPath, preview);
    return preview;
  }

  async clearPreview() {
    await this.initialize();
    await fs.rm(this.previewPath, { force: true });
  }

  async getPendingPreview() {
    return this.toPublicPayload(await this.readPreview());
  }

  createRunningPreview() {
    return {
      version: 1,
      status: "running",
      startedAt: new Date().toISOString(),
      checkedAt: null,
      approvedAt: null,
      error: null,
      totalAdded: 0,
      downloadSummary: null,
      laws: {
        status: "running",
        addedCount: 0,
        total: 0,
        metadata: null,
        addedItems: [],
        addedBillIds: [],
        snapshotItems: [],
      },
    };
  }

  async performCheck() {
    await this.initialize();

    const lawResult = await this.lawStore.previewUpdates();
    const preview = {
      version: 1,
      status: "ready_for_review",
      checkedAt: new Date().toISOString(),
      totalAdded: lawResult.addedItems.length,
      downloadSummary: null,
      laws: this.buildLawPayload(lawResult),
    };

    await this.writePreview(preview);
    return this.toPublicPayload(preview);
  }

  async startCheckForNewLaws() {
    await this.initialize();

    if (this.currentCheckPromise) {
      return this.getPendingPreview();
    }

    const runningPreview = this.createRunningPreview();
    await this.writePreview(runningPreview);

    this.currentCheckPromise = (async () => {
      try {
        await this.performCheck();
      } catch (error) {
        await this.writePreview({
          ...runningPreview,
          status: "failed",
          checkedAt: new Date().toISOString(),
          error: toErrorMessage(error),
          laws: {
            ...runningPreview.laws,
            status: "error",
          },
        });
      } finally {
        this.currentCheckPromise = null;
      }
    })();

    return this.toPublicPayload(runningPreview);
  }

  async applyPendingPreview() {
    const preview = await this.readPreview();

    if (!preview) {
      return null;
    }

    if (preview.status === "running") {
      return {
        ...this.toPublicPayload(preview),
        status: "running",
      };
    }

    const snapshotItems = preview.laws?.snapshotItems || [];
    const addedBillIds = new Set(preview.laws?.addedBillIds || []);

    try {
      await this.lawStore.applyMetadataSnapshot(snapshotItems);
    } catch (error) {
      return {
        ...this.toPublicPayload(preview),
        status: "failed",
        error: `Law metadata import failed: ${toErrorMessage(error)}`,
      };
    }

    const addedLaws = snapshotItems.filter((law) => addedBillIds.has(String(law.billId)));
    const failureMessages = [];
    let downloadedFiles = 0;
    let voteRefreshSummary = null;

    for (const law of addedLaws) {
      const requestedKinds = [];

      if (law.hasOfficialPdf) {
        requestedKinds.push("pdf");
      }

      if (law.hasWordDocument) {
        requestedKinds.push("word");
      }

      for (const requestedKind of requestedKinds) {
        try {
          const meta = await this.lawStore.ensureLawDocumentFile(law, requestedKind);

          if (meta?.localFilePath) {
            downloadedFiles += 1;
          }
        } catch (error) {
          failureMessages.push(`${law.title} (${requestedKind.toUpperCase()}): ${toErrorMessage(error)}`);
        }
      }
    }

    if (this.lawVoteStore && addedLaws.length) {
      try {
        voteRefreshSummary = await this.lawVoteStore.ensureCoverageForLaws(addedLaws, {
          retryErrors: true,
          retryUnmatched: true,
        });
      } catch (error) {
        failureMessages.push(`Vote refresh for newly added laws failed: ${toErrorMessage(error)}`);
      }
    }

    const applied = {
      ...preview,
      status: failureMessages.length ? "applied_with_warnings" : "applied",
      approvedAt: new Date().toISOString(),
      error: failureMessages.length ? failureMessages.join(" | ") : null,
      downloadSummary: {
        addedLawCount: addedLaws.length,
        downloadedFiles,
        voteRefreshSummary,
        failedDownloads: failureMessages.length,
        failureMessages,
      },
    };

    await this.clearPreview();
    return this.toPublicPayload(applied);
  }
}

module.exports = {
  AdminLawUpdateService,
};
