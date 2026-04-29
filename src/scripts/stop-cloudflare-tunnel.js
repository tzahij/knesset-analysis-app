const fs = require("fs/promises");
const path = require("path");

const rootDir = path.resolve(__dirname, "..", "..");
const dataDir = path.join(rootDir, "data");
const pidPath = path.join(dataDir, "cloudflared.pid");
const statusPath = path.join(dataDir, "public-url-status.txt");

async function main() {
  let pidText;

  try {
    pidText = await fs.readFile(pidPath, "utf8");
  } catch {
    await fs.writeFile(statusPath, "closed\n", "utf8").catch(() => {});
    process.stdout.write("No running Cloudflare tunnel was found.\n");
    return;
  }

  const pid = Number(String(pidText).trim());

  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error("The Cloudflare pid file is invalid.");
  }

  try {
    process.kill(pid);
  } catch (error) {
    if (error && error.code !== "ESRCH") {
      throw error;
    }
  }

  await fs.rm(pidPath, { force: true });
  await fs.writeFile(statusPath, "closed\n", "utf8").catch(() => {});
  process.stdout.write("Cloudflare tunnel stop signal sent.\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
