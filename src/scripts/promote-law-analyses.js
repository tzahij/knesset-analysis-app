const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadLocalEnv } = require("../lib/load-local-env");
const {
  buildProductionSshConfig,
  buildScpCopyArgs,
  buildSshCommandArgs,
  describeProductionSsh,
  validateProductionSshConfig,
} = require("../lib/production-ssh");

const rootDir = path.resolve(__dirname, "..", "..");
loadLocalEnv(rootDir);

const remoteAppPath = (process.env.PRODUCTION_APP_PATH || "/opt/knesset-site").trim();
const localAnalysisDir = path.join(rootDir, "data", "law-analyses");
const sshConfig = buildProductionSshConfig({
  rootDir,
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

validateProductionSshConfig(sshConfig, {
  requireTarget: true,
});

if (!fs.existsSync(localAnalysisDir)) {
  fail(`Local law analysis folder does not exist: ${localAnalysisDir}`);
}

const localFiles = fs.readdirSync(localAnalysisDir);
const manifestCount = localFiles.filter((name) => name.endsWith(".json")).length;
const markdownCount = localFiles.filter((name) => name.endsWith(".md")).length;

if (!manifestCount) {
  fail(
    `No local law-analysis manifests were found in ${localAnalysisDir}. Run the staging analysis first.`,
  );
}

const normalizedRemoteAppPath = remoteAppPath.replace(/[\\/]+$/u, "");
const remoteDataDir = `${normalizedRemoteAppPath}/data`;
const remoteAnalysisDir = `${remoteDataDir}/law-analyses`;

console.log("Promoting staging law analyses to production...");
console.log(`Local folder: ${localAnalysisDir}`);
console.log(`Production target: ${sshConfig.sshTarget}:${remoteAnalysisDir}`);
console.log(`SSH settings: ${describeProductionSsh(sshConfig)}`);
console.log(`Found ${manifestCount} JSON manifests and ${markdownCount} Markdown files locally.`);
console.log("The production law-analysis folder will be replaced with these staging results.");

run(
  "ssh",
  buildSshCommandArgs(
    sshConfig,
    `mkdir -p ${shellQuote(remoteDataDir)} && rm -rf ${shellQuote(remoteAnalysisDir)}`,
  ),
);

run(
  "scp",
  buildScpCopyArgs(sshConfig, localAnalysisDir, `${sshConfig.sshTarget}:${remoteDataDir}/`, {
    recursive: true,
  }),
);

console.log("Promotion complete.");
console.log("Production will now use the staged law-axis analyses that were just copied.");
