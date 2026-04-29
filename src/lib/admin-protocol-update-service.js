const fs = require("fs/promises");
const path = require("path");

const { ensureDirectory, fileExists, readJson, toErrorMessage, writeJson } = require("./utils");

function summarizeAddedProtocol(source, protocol) {
  if (source === "committee") {
    return {
      documentId: protocol.documentId,
      label: `${protocol.shortDateLabel} - ${protocol.committeeName} (${protocol.committeeTypeDescription})`,
      shortDateLabel: protocol.shortDateLabel,
      committeeName: protocol.committeeName,
      committeeTypeDescription: protocol.committeeTypeDescription,
    };
  }

  return {
    documentId: protocol.documentId,
    label: `${protocol.shortDateLabel}${protocol.timeLabel ? `, ${protocol.timeLabel}` : ""} - ישיבה ${protocol.sessionNumber ?? "-"}`,
    shortDateLabel: protocol.shortDateLabel,
    sessionNumber: protocol.sessionNumber,
    timeLabel: protocol.timeLabel,
  };
}

class AdminProtocolUpdateService {
  constructor(options = {}) {
    this.rootDir = options.rootDir;
    this.dataDir = path.join(this.rootDir, "data");
    this.previewPath = path.join(this.dataDir, "admin-protocol-update-preview.json");
    this.protocolStore = options.protocolStore;
    this.committeeProtocolStore = options.committeeProtocolStore;
    this.currentCheckPromise = null;
  }

  async initialize() {
    await ensureDirectory(this.dataDir);
  }

  buildSourcePayload(source, result) {
    return {
      status: "ok",
      addedCount: result.addedItems.length,
      total: result.items.length,
      metadata: result.metadata,
      addedItems: result.addedItems.map((protocol) => summarizeAddedProtocol(source, protocol)),
      snapshotItems: result.items,
    };
  }

  toPublicPayload(preview) {
    if (!preview) {
      return {
        status: "idle",
        startedAt: null,
        checkedAt: null,
        error: null,
        hasPendingApproval: false,
        totalAdded: 0,
        sources: {
          plenum: { status: "idle", addedCount: 0, total: 0, addedItems: [] },
          committee: { status: "idle", addedCount: 0, total: 0, addedItems: [] },
        },
      };
    }

    const plenum = preview.sources?.plenum || {};
    const committee = preview.sources?.committee || {};

    return {
      status: preview.status || "ready_for_review",
      startedAt: preview.startedAt || null,
      checkedAt: preview.checkedAt || null,
      approvedAt: preview.approvedAt || null,
      error: preview.error || null,
      hasPendingApproval: preview.status === "ready_for_review" && Number(preview.totalAdded || 0) > 0,
      totalAdded: Number(preview.totalAdded || 0),
      sources: {
        plenum: {
          status: plenum.status || "idle",
          addedCount: Number(plenum.addedCount || 0),
          total: Number(plenum.total || 0),
          metadata: plenum.metadata || null,
          addedItems: Array.isArray(plenum.addedItems) ? plenum.addedItems : [],
        },
        committee: {
          status: committee.status || "idle",
          addedCount: Number(committee.addedCount || 0),
          total: Number(committee.total || 0),
          metadata: committee.metadata || null,
          addedItems: Array.isArray(committee.addedItems) ? committee.addedItems : [],
        },
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
      sources: {
        plenum: {
          status: "running",
          addedCount: 0,
          total: 0,
          metadata: null,
          addedItems: [],
          snapshotItems: [],
        },
        committee: {
          status: "running",
          addedCount: 0,
          total: 0,
          metadata: null,
          addedItems: [],
          snapshotItems: [],
        },
      },
    };
  }

  async writePreview(preview) {
    await this.initialize();
    await writeJson(this.previewPath, preview);
    return preview;
  }

  async performCheck() {
    await this.initialize();

    const [plenumResult, committeeResult] = await Promise.all([
      this.protocolStore.previewUpdates(),
      this.committeeProtocolStore.previewUpdates(),
    ]);

    const preview = {
      version: 1,
      status: "ready_for_review",
      checkedAt: new Date().toISOString(),
      totalAdded: plenumResult.addedItems.length + committeeResult.addedItems.length,
      sources: {
        plenum: this.buildSourcePayload("plenum", plenumResult),
        committee: this.buildSourcePayload("committee", committeeResult),
      },
    };

    await this.writePreview(preview);
    return this.toPublicPayload(preview);
  }

  async startCheckForNewProtocols() {
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
          sources: {
            ...runningPreview.sources,
            plenum: {
              ...runningPreview.sources.plenum,
              status: "error",
            },
            committee: {
              ...runningPreview.sources.committee,
              status: "error",
            },
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

    const failures = [];
    const plenumItems = preview.sources?.plenum?.snapshotItems || [];
    const committeeItems = preview.sources?.committee?.snapshotItems || [];

    try {
      await this.protocolStore.applyMetadataSnapshot(plenumItems);
    } catch (error) {
      failures.push(`Plenum: ${toErrorMessage(error)}`);
    }

    try {
      await this.committeeProtocolStore.applyMetadataSnapshot(committeeItems);
    } catch (error) {
      failures.push(`Committee: ${toErrorMessage(error)}`);
    }

    if (failures.length) {
      return {
        ...this.toPublicPayload(preview),
        status: "failed",
        error: failures.join(" | "),
      };
    }

    const applied = {
      ...preview,
      status: "applied",
      approvedAt: new Date().toISOString(),
    };

    await this.clearPreview();
    return this.toPublicPayload(applied);
  }
}

module.exports = {
  AdminProtocolUpdateService,
};
