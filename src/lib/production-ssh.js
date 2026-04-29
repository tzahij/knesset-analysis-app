const fs = require("fs");
const path = require("path");

function normalizePort(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return "";
  }

  return String(parsed);
}

function resolveKeyPath(rootDir, value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "";
  }

  return path.isAbsolute(trimmed) ? trimmed : path.resolve(rootDir, trimmed);
}

function buildProductionSshConfig(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const sshTarget = String(options.sshTarget ?? process.env.PRODUCTION_SSH_TARGET ?? "").trim();
  const port = normalizePort(options.port ?? process.env.PRODUCTION_SSH_PORT ?? "");
  const keyPath = resolveKeyPath(rootDir, options.keyPath ?? process.env.PRODUCTION_SSH_KEY_PATH ?? "");

  return {
    rootDir,
    sshTarget,
    port,
    keyPath,
    usesExplicitKey: Boolean(keyPath),
  };
}

function validateProductionSshConfig(config, options = {}) {
  if (options.requireTarget && !config?.sshTarget) {
    throw new Error(
      "Missing PRODUCTION_SSH_TARGET. Set it in .env or .env.local, for example: PRODUCTION_SSH_TARGET=root@YOUR_SERVER_IP",
    );
  }

  if (config?.keyPath && !fs.existsSync(config.keyPath)) {
    throw new Error(`Configured PRODUCTION_SSH_KEY_PATH does not exist: ${config.keyPath}`);
  }
}

function buildCommonOptionArgs(config, options = {}) {
  const args = [];

  if (config?.port) {
    args.push(options.scp ? "-P" : "-p", String(config.port));
  }

  if (config?.keyPath) {
    args.push("-i", config.keyPath, "-o", "IdentitiesOnly=yes", "-o", "PreferredAuthentications=publickey");
  }

  args.push(
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=6",
    "-o",
    "TCPKeepAlive=yes",
    "-o",
    "ConnectTimeout=20",
  );

  if (options.batchMode) {
    args.push("-o", "BatchMode=yes");
  }

  return args;
}

function buildSshCommandArgs(config, remoteCommand, options = {}) {
  return [...buildCommonOptionArgs(config, options), config.sshTarget, remoteCommand];
}

function buildScpCopyArgs(config, localPath, remoteSpec, options = {}) {
  const args = buildCommonOptionArgs(config, {
    ...options,
    scp: true,
  });

  if (options.recursive) {
    args.push("-r");
  }

  args.push(localPath, remoteSpec);
  return args;
}

function describeProductionSsh(config) {
  const parts = [];

  if (config?.port) {
    parts.push(`port ${config.port}`);
  }

  if (config?.keyPath) {
    parts.push(`key ${config.keyPath}`);
  }

  return parts.length ? parts.join(", ") : "default SSH client settings";
}

module.exports = {
  buildProductionSshConfig,
  buildScpCopyArgs,
  buildSshCommandArgs,
  describeProductionSsh,
  validateProductionSshConfig,
};
