const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const {
  buildProductionSshConfig,
  buildScpCopyArgs,
  buildSshCommandArgs,
  validateProductionSshConfig,
} = require("./production-ssh");

const ANALYSIS_PROMOTION_TARGETS = {
  memberUtterances: {
    key: "memberUtterances",
    label: "Member quote files",
    kind: "directory",
    relativePath: ["data", "member-utterances"],
  },
  memberAnalyses: {
    key: "memberAnalyses",
    label: "Member analyses",
    kind: "directory",
    relativePath: ["data", "member-analyses"],
  },
  memberComparisons: {
    key: "memberComparisons",
    label: "Member comparisons",
    kind: "file",
    relativePath: ["data", "member-comparisons.json"],
  },
  memberProtocolIndex: {
    key: "memberProtocolIndex",
    label: "Member protocol index",
    kind: "file",
    relativePath: ["data", "member-protocol-index.json"],
  },
  lawAnalyses: {
    key: "lawAnalyses",
    label: "Law axes analyses",
    kind: "directory",
    relativePath: ["data", "law-analyses"],
  },
  lawSurpriseExplanations: {
    key: "lawSurpriseExplanations",
    label: "Surprising vote explanations",
    kind: "directory",
    relativePath: ["data", "law-surprise-explanations"],
  },
  lawsCatalog: {
    key: "lawsCatalog",
    label: "Law catalog",
    kind: "file",
    relativePath: ["data", "laws.json"],
  },
  lawVotes: {
    key: "lawVotes",
    label: "Law votes",
    kind: "file",
    relativePath: ["data", "law-votes.json"],
  },
  plenaryProtocolsCatalog: {
    key: "plenaryProtocolsCatalog",
    label: "Plenum protocols catalog",
    kind: "file",
    relativePath: ["data", "protocols.json"],
  },
  committeeProtocolsCatalog: {
    key: "committeeProtocolsCatalog",
    label: "Committee protocols catalog",
    kind: "file",
    relativePath: ["data", "committee-protocols.json"],
  },
};

const ALL_ANALYSIS_PROMOTION_TARGET_KEYS = Object.keys(ANALYSIS_PROMOTION_TARGETS);

function quoteForRemoteShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function toBoolean(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "true";
}

function runProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const details = stderr.trim() || stdout.trim() || `Exit code ${code}`;
      reject(new Error(`${command} failed: ${details}`));
    });
  });
}

class AnalysisPromotionService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname, "..", "..");
    this.dataDir = path.join(this.rootDir, "data");
    this.statusPath = path.join(this.dataDir, "analysis-promotion-status.json");
    this.sshConfig = buildProductionSshConfig({
      rootDir: this.rootDir,
      sshTarget: options.sshTarget || process.env.PRODUCTION_SSH_TARGET || "",
      keyPath: options.sshKeyPath || process.env.PRODUCTION_SSH_KEY_PATH || "",
      port: options.sshPort || process.env.PRODUCTION_SSH_PORT || "",
    });
    this.sshTarget = this.sshConfig.sshTarget;
    this.remoteAppPath = (options.remoteAppPath || process.env.PRODUCTION_APP_PATH || "/opt/knesset-site")
      .trim()
      .replace(/[\\/]+$/u, "");
    this.enabled =
      typeof options.enabled === "boolean"
        ? options.enabled
        : toBoolean(process.env.AUTO_PROMOTE_ANALYSES_TO_PRODUCTION);
    this.debounceMs = Number(options.debounceMs || process.env.PRODUCTION_SYNC_DEBOUNCE_MS) || 15000;
    this.pendingTargets = new Set();
    this.pendingRelativePaths = new Set();
    this.timer = null;
    this.runningPromise = null;
    this.suspensionCount = 0;
    this.status = {
      enabled: this.enabled,
      configured: Boolean(this.sshTarget),
      status: "idle",
      pendingTargets: [],
      pendingPaths: [],
      currentTargets: [],
      currentPaths: [],
      lastStartedAt: null,
      lastCompletedAt: null,
      lastError: null,
      productionTarget: this.sshTarget || null,
      remoteAppPath: this.remoteAppPath,
      autoPromotion: this.enabled,
      suspended: false,
    };
    this.persistStatus();
  }

  getStatus() {
    return {
      ...this.status,
      pendingTargets: [...this.status.pendingTargets],
      pendingPaths: [...this.status.pendingPaths],
      currentTargets: [...this.status.currentTargets],
      currentPaths: [...this.status.currentPaths],
    };
  }

  normalizeTargetKeys(targetKeys) {
    const requested = Array.isArray(targetKeys)
      ? targetKeys
      : typeof targetKeys === "string"
        ? [targetKeys]
        : ALL_ANALYSIS_PROMOTION_TARGET_KEYS;

    return requested.filter((key, index) => {
      return ANALYSIS_PROMOTION_TARGETS[key] && requested.indexOf(key) === index;
    });
  }

  async persistStatus() {
    try {
      await fsPromises.mkdir(this.dataDir, { recursive: true });
      await fsPromises.writeFile(this.statusPath, JSON.stringify(this.status, null, 2), "utf8");
    } catch (error) {
      console.warn(`Failed to persist analysis promotion status: ${error.message}`);
    }
  }

  normalizeRelativePaths(relativePaths) {
    const requested = Array.isArray(relativePaths)
      ? relativePaths
      : typeof relativePaths === "string"
        ? [relativePaths]
        : [];

    return requested
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => value.replace(/[\\/]+/gu, path.sep))
      .filter((value, index, items) => items.indexOf(value) === index);
  }

  requestPromotion(targetKeys) {
    if (!this.enabled) {
      return false;
    }

    const normalized = this.normalizeTargetKeys(targetKeys);

    if (!normalized.length) {
      return false;
    }

    for (const key of normalized) {
      this.pendingTargets.add(key);
    }

    this.status.status = this.runningPromise ? "running" : "scheduled";
    this.status.pendingTargets = [...this.pendingTargets];
    this.status.pendingPaths = [...this.pendingRelativePaths];
    this.status.lastError = null;
    this.persistStatus();

    if (!this.isSuspended()) {
      this.scheduleFlush();
    }
    return true;
  }

  requestPathPromotion(relativePaths) {
    if (!this.enabled) {
      return false;
    }

    const normalized = this.normalizeRelativePaths(relativePaths);

    if (!normalized.length) {
      return false;
    }

    for (const relativePath of normalized) {
      this.pendingRelativePaths.add(relativePath);
    }

    this.status.status = this.runningPromise ? "running" : "scheduled";
    this.status.pendingTargets = [...this.pendingTargets];
    this.status.pendingPaths = [...this.pendingRelativePaths];
    this.status.lastError = null;
    this.persistStatus();

    if (!this.isSuspended()) {
      this.scheduleFlush();
    }
    return true;
  }

  isSuspended() {
    return this.suspensionCount > 0;
  }

  suspendAutoPromotion() {
    this.suspensionCount += 1;
    this.status.suspended = this.isSuspended();
    this.persistStatus();

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    let resumed = false;
    return async () => {
      if (resumed) {
        return;
      }

      resumed = true;
      this.suspensionCount = Math.max(0, this.suspensionCount - 1);
      this.status.suspended = this.isSuspended();
      await this.persistStatus();

      if (!this.isSuspended() && (this.pendingTargets.size || this.pendingRelativePaths.size)) {
        this.scheduleFlush();
      }
    };
  }

  scheduleFlush() {
    if (this.isSuspended()) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushQueuedPromotions().catch((error) => {
        console.error(`Automatic analysis promotion failed: ${error.message}`);
      });
    }, this.debounceMs);
  }

  async flushQueuedPromotions() {
    if (this.runningPromise) {
      return this.runningPromise;
    }

    if (this.isSuspended()) {
      return null;
    }

    if (!this.pendingTargets.size && !this.pendingRelativePaths.size) {
      return null;
    }

    const targetKeys = [...this.pendingTargets];
    const relativePaths = [...this.pendingRelativePaths];
    this.pendingTargets.clear();
    this.pendingRelativePaths.clear();
    this.status.pendingTargets = [];
    this.status.pendingPaths = [];
    this.runningPromise = this.promoteQueuedItems(targetKeys, relativePaths)
      .catch((error) => {
        console.error(`Automatic analysis promotion failed: ${error.message}`);
        throw error;
      })
      .finally(() => {
        this.runningPromise = null;

        if (!this.isSuspended() && (this.pendingTargets.size || this.pendingRelativePaths.size)) {
          this.scheduleFlush();
        }
      });

    return this.runningPromise;
  }

  async promoteQueuedItems(targetKeys, relativePaths) {
    const normalized = this.normalizeTargetKeys(targetKeys);
    const normalizedPaths = this.normalizeRelativePaths(relativePaths);

    if (!normalized.length && !normalizedPaths.length) {
      return;
    }

    if (!this.sshTarget) {
      const error = "Missing PRODUCTION_SSH_TARGET for analysis promotion.";
      this.status.status = "failed";
      this.status.lastError = error;
      await this.persistStatus();
      throw new Error(error);
    }

    validateProductionSshConfig(this.sshConfig, {
      requireTarget: true,
    });

    this.status.status = "running";
    this.status.currentTargets = normalized;
    this.status.currentPaths = normalizedPaths;
    this.status.pendingTargets = [...this.pendingTargets];
    this.status.pendingPaths = [...this.pendingRelativePaths];
    this.status.lastStartedAt = new Date().toISOString();
    this.status.lastError = null;
    await this.persistStatus();

    try {
      for (const key of normalized) {
        await this.promoteSingleTarget(key);
      }

      for (const relativePath of normalizedPaths) {
        await this.promoteSingleRelativePath(relativePath);
      }

      this.status.status = "completed";
      this.status.currentTargets = [];
      this.status.currentPaths = [];
      this.status.lastCompletedAt = new Date().toISOString();
      this.status.lastError = null;
      await this.persistStatus();
    } catch (error) {
      this.status.status = "failed";
      this.status.currentTargets = [];
      this.status.currentPaths = [];
      this.status.lastError = error.message;
      await this.persistStatus();
      throw error;
    }
  }

  async promoteTargets(targetKeys) {
    return this.promoteQueuedItems(targetKeys, []);
  }

  async promoteAllTargets() {
    return this.promoteTargets(ALL_ANALYSIS_PROMOTION_TARGET_KEYS);
  }

  async promoteSingleTarget(targetKey) {
    const target = ANALYSIS_PROMOTION_TARGETS[targetKey];

    if (!target) {
      throw new Error(`Unknown analysis promotion target: ${targetKey}`);
    }

    const localPath = path.join(this.rootDir, ...target.relativePath);

    if (!fs.existsSync(localPath)) {
      console.log(`Skipping ${target.label}: local path does not exist (${localPath}).`);
      return;
    }

    const remotePath = path.posix.join(this.remoteAppPath, ...target.relativePath.map(String));
    const remoteParent = path.posix.dirname(remotePath);

    console.log(`Promoting ${target.label} to production...`);

    if (target.kind === "directory") {
      await runProcess(
        "ssh",
        buildSshCommandArgs(
          this.sshConfig,
          `mkdir -p ${quoteForRemoteShell(remoteParent)} && rm -rf ${quoteForRemoteShell(remotePath)}`,
        ),
        this.rootDir,
      );

      await runProcess(
        "scp",
        buildScpCopyArgs(this.sshConfig, localPath, `${this.sshTarget}:${remoteParent}/`, {
          recursive: true,
        }),
        this.rootDir,
      );
      return;
    }

    await runProcess(
      "ssh",
      buildSshCommandArgs(
        this.sshConfig,
        `mkdir -p ${quoteForRemoteShell(remoteParent)} && rm -f ${quoteForRemoteShell(remotePath)}`,
      ),
      this.rootDir,
    );

    await runProcess(
      "scp",
      buildScpCopyArgs(this.sshConfig, localPath, `${this.sshTarget}:${remotePath}`),
      this.rootDir,
    );
  }

  async promoteSingleRelativePath(relativePath) {
    const localPath = path.resolve(this.rootDir, relativePath);
    const resolvedRoot = path.resolve(this.rootDir);

    if (
      localPath !== resolvedRoot &&
      !localPath.startsWith(`${resolvedRoot}${path.sep}`)
    ) {
      throw new Error(`Refusing to promote a path outside the workspace: ${relativePath}`);
    }

    if (!fs.existsSync(localPath)) {
      console.log(`Skipping missing path during promotion: ${relativePath}`);
      return;
    }

    const stat = fs.statSync(localPath);
    const remotePath = path.posix.join(
      this.remoteAppPath,
      ...relativePath.split(/[\\/]+/u).filter(Boolean),
    );
    const remoteParent = path.posix.dirname(remotePath);

    console.log(`Promoting changed path to production: ${relativePath}`);

    if (stat.isDirectory()) {
      await runProcess(
        "ssh",
        buildSshCommandArgs(
          this.sshConfig,
          `mkdir -p ${quoteForRemoteShell(remoteParent)} && rm -rf ${quoteForRemoteShell(remotePath)}`,
        ),
        this.rootDir,
      );

      await runProcess(
        "scp",
        buildScpCopyArgs(this.sshConfig, localPath, `${this.sshTarget}:${remoteParent}/`, {
          recursive: true,
        }),
        this.rootDir,
      );
      return;
    }

    await runProcess(
      "ssh",
      buildSshCommandArgs(this.sshConfig, `mkdir -p ${quoteForRemoteShell(remoteParent)}`),
      this.rootDir,
    );

    await runProcess(
      "scp",
      buildScpCopyArgs(this.sshConfig, localPath, `${this.sshTarget}:${remotePath}`),
      this.rootDir,
    );
  }
}

module.exports = {
  AnalysisPromotionService,
  ANALYSIS_PROMOTION_TARGETS,
  ALL_ANALYSIS_PROMOTION_TARGET_KEYS,
};
