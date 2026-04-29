const path = require("path");

const { loadLocalEnv } = require("../lib/load-local-env");
const { AnalysisPromotionService } = require("../lib/analysis-promotion-service");

const rootDir = path.resolve(__dirname, "..", "..");
loadLocalEnv(rootDir);

async function main() {
  const service = new AnalysisPromotionService({
    rootDir,
    enabled: true,
    sshTarget: process.env.PRODUCTION_SSH_TARGET || "",
    remoteAppPath: process.env.PRODUCTION_APP_PATH || "/opt/knesset-site",
  });

  console.log("Promoting all staging analysis outputs to production...");
  await service.promoteAllTargets();
  console.log("All analysis targets were promoted to production.");
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
