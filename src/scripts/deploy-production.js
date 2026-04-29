const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadLocalEnv } = require("../lib/load-local-env");
const {
  PRODUCTION_CODE_SYNC_TARGETS,
  PRODUCTION_ESSENTIAL_DATA_SYNC_TARGETS,
  PRODUCTION_LARGE_CACHE_SYNC_TARGETS,
} = require("../lib/production-deploy-config");
const {
  buildProductionSshConfig,
  buildScpCopyArgs,
  buildSshCommandArgs,
  describeProductionSsh,
  validateProductionSshConfig,
} = require("../lib/production-ssh");

const rootDir = path.resolve(__dirname, "..", "..");
loadLocalEnv(rootDir);

const APP_CONTAINER_NAME = "knesset-protocol-reader";
const HEALTH_CHECK_TIMEOUT_MS = 180000;
const HEALTH_CHECK_INTERVAL_MS = 5000;
const NETWORK_RETRY_BASE_DELAY_MS = 5000;
const NETWORK_RETRYABLE_PATTERNS = [
  "connection reset",
  "broken pipe",
  "connection timed out",
  "operation timed out",
  "connection closed",
  "connection unexpectedly closed",
  "network error",
  "software caused connection abort",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function delaySync(ms) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < ms) {
    // Busy wait is fine here because this script is already sync and short-lived.
  }
}

function getNetworkRetryDelayMs(attempt) {
  return NETWORK_RETRY_BASE_DELAY_MS * Math.max(1, attempt);
}

function quoteForRemoteShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function normalizeRemoteAppPath(value) {
  return String(value || "/opt/knesset-site")
    .trim()
    .replace(/[\\/]+$/u, "") || "/opt/knesset-site";
}

function parseArgs(argv) {
  const args = new Set(argv);

  return {
    dryRun: args.has("--dry-run"),
    skipRestart: args.has("--skip-restart"),
    codeOnly: args.has("--code-only"),
    dataOnly: args.has("--data-only"),
    checkAuth: args.has("--check-auth"),
    fullData:
      args.has("--full-data") ||
      args.has("--full-data-sync") ||
      args.has("--include-large-caches"),
  };
}

function shouldRetryNetworkCommand(command, result) {
  if (!["ssh", "scp"].includes(String(command || "").toLowerCase())) {
    return false;
  }

  if (Number(result?.status) !== 255) {
    return false;
  }

  const combinedOutput = [result?.stderr, result?.stdout]
    .map((value) => String(value || "").toLowerCase())
    .join("\n");

  if (!combinedOutput.trim()) {
    return true;
  }

  return NETWORK_RETRYABLE_PATTERNS.some((pattern) => combinedOutput.includes(pattern));
}

function run(command, args, options = {}) {
  const captureOutput = Boolean(options.captureOutput);
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 1);
  let attempt = 0;
  let lastResult = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    const result = spawnSync(command, args, {
      cwd: rootDir,
      shell: false,
      encoding: "utf8",
      stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    lastResult = result;

    if (result.error) {
      fail(`Failed to run ${command}: ${result.error.message}`);
    }

    if (result.status === 0 || options.allowFailure) {
      return result;
    }

    if (attempt < maxAttempts && shouldRetryNetworkCommand(command, result)) {
      const retryDelayMs = getNetworkRetryDelayMs(attempt);
      const details = [result.stderr, result.stdout]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join("\n");
      console.warn(
        `${command} lost the connection on attempt ${attempt}/${maxAttempts}. Retrying in ${Math.round(
          retryDelayMs / 1000,
        )}s...${details ? `\n${details}` : ""}`,
      );
      delaySync(retryDelayMs);
      continue;
    }

    const details = [result.stderr, result.stdout]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join("\n");
    fail(details ? `${command} failed: ${details}` : `${command} failed with exit code ${result.status || 1}`);
  }

  return lastResult;
}

function buildTargetPath(target) {
  return path.join(rootDir, ...target.relativePath);
}

function buildRemotePath(remoteAppPath, target) {
  return path.posix.join(remoteAppPath, ...target.relativePath.map(String));
}

function describeTarget(target) {
  return `${target.label} (${target.relativePath.join("/")})`;
}

function quotePathList(paths) {
  return paths.map((item) => quoteForRemoteShell(item)).join(" ");
}

function listActiveTargets(options) {
  const includeCode = !options.dataOnly;
  const includeData = !options.codeOnly;
  const essentialDataTargets = includeData ? PRODUCTION_ESSENTIAL_DATA_SYNC_TARGETS : [];
  const largeCacheTargets =
    includeData && options.fullData ? PRODUCTION_LARGE_CACHE_SYNC_TARGETS : [];

  return {
    codeTargets: includeCode ? PRODUCTION_CODE_SYNC_TARGETS : [],
    essentialDataTargets,
    largeCacheTargets,
    dataTargets: [...essentialDataTargets, ...largeCacheTargets],
  };
}

function collectRequiredRemoteParents(remoteAppPath, targets) {
  return Array.from(
    new Set(
      targets
        .map((target) => path.posix.dirname(buildRemotePath(remoteAppPath, target)))
        .filter(Boolean),
    ),
  ).sort();
}

function syncTarget(sshConfig, remoteAppPath, target, options) {
  const localPath = buildTargetPath(target);
  const remotePath = buildRemotePath(remoteAppPath, target);
  const remoteParent = path.posix.dirname(remotePath);

  if (!fs.existsSync(localPath)) {
    console.log(`Skipping missing ${describeTarget(target)}.`);
    return false;
  }

  if (options.dryRun) {
    console.log(`[dry-run] Sync ${describeTarget(target)} -> ${sshConfig.sshTarget}:${remotePath}`);
    return true;
  }

  console.log(`Syncing ${describeTarget(target)}...`);

  if (target.kind === "directory") {
    run(
      "ssh",
      buildSshCommandArgs(
        sshConfig,
        `mkdir -p ${quoteForRemoteShell(remoteParent)} && rm -rf ${quoteForRemoteShell(remotePath)}`,
      ),
      {
        maxAttempts: 3,
      },
    );
    run(
      "scp",
      buildScpCopyArgs(sshConfig, localPath, `${sshConfig.sshTarget}:${remoteParent}/`, {
        recursive: true,
      }),
      {
        maxAttempts: 3,
      },
    );
    return true;
  }

  run("scp", buildScpCopyArgs(sshConfig, localPath, `${sshConfig.sshTarget}:${remotePath}`), {
    maxAttempts: 3,
  });
  return true;
}

function ensureRemoteWorkspace(sshConfig, remoteAppPath, options) {
  if (options.dryRun) {
    console.log(`[dry-run] Ensure remote workspace exists at ${sshConfig.sshTarget}:${remoteAppPath}`);
    return;
  }

  run("ssh", buildSshCommandArgs(sshConfig, `mkdir -p ${quoteForRemoteShell(remoteAppPath)}`), {
    maxAttempts: 3,
  });
}

function ensureRemoteParents(sshConfig, remotePaths, options) {
  if (!Array.isArray(remotePaths) || !remotePaths.length) {
    return;
  }

  if (options.dryRun) {
    console.log(`[dry-run] Ensure remote parent directories exist on ${sshConfig.sshTarget}`);
    return;
  }

  run(
    "ssh",
    buildSshCommandArgs(sshConfig, `mkdir -p ${quotePathList(remotePaths)}`),
    {
      maxAttempts: 3,
    },
  );
}

function ensureRemoteEnvFile(sshConfig, remoteAppPath, options) {
  const remoteEnvPath = path.posix.join(remoteAppPath, ".env");

  if (options.dryRun) {
    console.log(`[dry-run] Verify remote .env exists at ${sshConfig.sshTarget}:${remoteEnvPath}`);
    return;
  }

  const result = run(
    "ssh",
    buildSshCommandArgs(sshConfig, `test -f ${quoteForRemoteShell(remoteEnvPath)}`),
    { allowFailure: true, captureOutput: true, maxAttempts: 3 },
  );

  if (result.status === 0) {
    return;
  }

  fail(
    `Remote .env was not found at ${remoteEnvPath}. Create it on the server first so this deploy does not overwrite secrets.`,
  );
}

function verifyRemoteAccess(sshConfig, options = {}) {
  if (options.dryRun) {
    console.log(`[dry-run] Verify SSH access to ${sshConfig.sshTarget} using ${describeProductionSsh(sshConfig)}`);
    return;
  }

  const result = run(
    "ssh",
    buildSshCommandArgs(sshConfig, "exit 0", {
      batchMode: sshConfig.usesExplicitKey,
    }),
    {
      allowFailure: true,
      captureOutput: true,
      maxAttempts: 3,
    },
  );

  if (result.status === 0) {
    console.log(
      `SSH access verified for ${sshConfig.sshTarget} using ${sshConfig.usesExplicitKey ? "key-based auth" : "the default SSH auth flow"}.`,
    );
    return;
  }

  if (sshConfig.usesExplicitKey) {
    fail(
      `SSH key auth failed for ${sshConfig.sshTarget}. Check PRODUCTION_SSH_KEY_PATH, make sure the public key is in ~/.ssh/authorized_keys on the server, and if the key has a passphrase make sure ssh-agent is loaded first.`,
    );
  }

  fail(`Unable to connect to ${sshConfig.sshTarget} over SSH.`);
}

function restartProductionStack(sshConfig, remoteAppPath, options) {
  const command = `cd ${quoteForRemoteShell(remoteAppPath)} && docker compose -f docker-compose.prod.yml up -d --build`;

  if (options.dryRun) {
    console.log(`[dry-run] Restart production stack: ssh ${sshConfig.sshTarget} "${command}"`);
    return;
  }

  console.log("Rebuilding and restarting the production stack...");
  run("ssh", buildSshCommandArgs(sshConfig, command), {
    maxAttempts: 3,
  });
}

function readRemoteHealthStatus(sshConfig) {
  const inspectCommand =
    "docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' " +
    APP_CONTAINER_NAME;
  const result = run("ssh", buildSshCommandArgs(sshConfig, inspectCommand), {
    allowFailure: true,
    captureOutput: true,
    maxAttempts: 3,
  });

  if (result.status !== 0) {
    return "";
  }

  return String(result.stdout || "").trim().toLowerCase();
}

async function waitForHealthyContainer(sshConfig, options) {
  if (options.dryRun || options.skipRestart) {
    return;
  }

  console.log("Waiting for the production container health check...");
  const startedAt = Date.now();

  while (Date.now() - startedAt < HEALTH_CHECK_TIMEOUT_MS) {
    const status = readRemoteHealthStatus(sshConfig);

    if (status === "healthy" || status === "running") {
      console.log(`Production container is ${status}.`);
      return;
    }

    if (status === "unhealthy" || status === "exited" || status === "dead") {
      fail(
        `Production container reported status '${status}'. Check remote logs with: ssh ${sshConfig.sshTarget} "cd ${remoteAppPathForMessage} && docker compose -f docker-compose.prod.yml logs --tail 100"`,
      );
    }

    await delay(HEALTH_CHECK_INTERVAL_MS);
  }

  fail(
    `Timed out while waiting for ${APP_CONTAINER_NAME} to become healthy. Check remote status with: ssh ${sshConfig.sshTarget} "cd ${remoteAppPathForMessage} && docker compose -f docker-compose.prod.yml ps"`,
  );
}

let remoteAppPathForMessage = "";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const remoteAppPath = normalizeRemoteAppPath(process.env.PRODUCTION_APP_PATH || "/opt/knesset-site");
  const sshConfig = buildProductionSshConfig({
    rootDir,
  });
  remoteAppPathForMessage = quoteForRemoteShell(remoteAppPath);

  if (options.codeOnly && options.dataOnly) {
    fail("Choose either --code-only or --data-only, not both.");
  }

  validateProductionSshConfig(sshConfig, {
    requireTarget: true,
  });

  const { codeTargets, dataTargets, largeCacheTargets } = listActiveTargets(options);
  const activeTargetCount = codeTargets.length + dataTargets.length;

  if (!activeTargetCount) {
    fail("No deployment targets were selected.");
  }

  console.log(`Production target: ${sshConfig.sshTarget}:${remoteAppPath}`);
  console.log(`SSH settings: ${describeProductionSsh(sshConfig)}`);
  console.log(
    `Mode: ${options.dryRun ? "dry-run" : "live deploy"}${options.fullData ? " (full data sync)" : " (standard data sync)"}`,
  );

  if (!options.codeOnly && !options.fullData) {
    console.log("Large cache folders are skipped by default. Use --full-data to include them.");
    for (const target of PRODUCTION_LARGE_CACHE_SYNC_TARGETS) {
      console.log(`  - ${target.relativePath.join("/")}`);
    }
  }

  if (options.checkAuth) {
    verifyRemoteAccess(sshConfig, options);
    console.log("SSH auth check complete.");
    return;
  }

  verifyRemoteAccess(sshConfig, options);
  ensureRemoteWorkspace(sshConfig, remoteAppPath, options);
  ensureRemoteParents(
    sshConfig,
    collectRequiredRemoteParents(remoteAppPath, [...codeTargets, ...dataTargets]),
    options,
  );

  if (!options.skipRestart) {
    ensureRemoteEnvFile(sshConfig, remoteAppPath, options);
  }

  if (codeTargets.length) {
    console.log("");
    console.log("Syncing code targets...");
    for (const target of codeTargets) {
      syncTarget(sshConfig, remoteAppPath, target, options);
    }
  }

  if (dataTargets.length) {
    console.log("");
    console.log("Syncing persistent data targets...");
    for (const target of dataTargets) {
      syncTarget(sshConfig, remoteAppPath, target, options);
    }
  }

  if (!options.codeOnly && options.fullData && largeCacheTargets.length) {
    console.log("");
    console.log(`Included ${largeCacheTargets.length} large cache target(s) because --full-data was requested.`);
  }

  if (options.skipRestart) {
    console.log("");
    console.log("Sync finished without restarting production because --skip-restart was requested.");
    return;
  }

  console.log("");
  restartProductionStack(sshConfig, remoteAppPath, options);
  await waitForHealthyContainer(sshConfig, options);

  console.log("");
  console.log(options.dryRun ? "Dry-run complete." : "Production deploy complete.");
}

main().catch((error) => {
  fail(error.message || String(error));
});
