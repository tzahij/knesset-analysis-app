const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..", "..");
const dataDir = path.join(rootDir, "data");
const publicUrlPath = path.join(dataDir, "public-url.txt");
const statusPath = path.join(dataDir, "public-url-status.txt");
const pidPath = path.join(dataDir, "cloudflared.pid");
const outLogPath = path.join(dataDir, "cloudflared.log");
const errLogPath = path.join(dataDir, "cloudflared.err.log");
const serverInfoPath = path.join(dataDir, "server-info.json");
const expectedAppId = "israeli-knesset-protocol-reader";

async function getTunnelPort() {
  const explicitPort = Number(
    process.env.SHARE_PORT || process.env.PUBLIC_SHARE_PORT || process.env.PORT || 0,
  );

  if (explicitPort > 0) {
    return explicitPort;
  }

  try {
    const raw = await fsp.readFile(serverInfoPath, "utf8");
    const parsed = JSON.parse(raw);

    if (parsed && parsed.appId === expectedAppId && Number(parsed.port) > 0) {
      return Number(parsed.port);
    }
  } catch {
    // Fall back to the default if the server info file does not exist yet.
  }

  return 3001;
}

function getBinaryCandidates() {
  return [
    process.env.CLOUDFLARED_BIN,
    path.join(dataDir, "cloudflared.exe"),
    path.resolve(rootDir, "..", "Social-Dynamics-Analyzer-main", "data", "cloudflared.exe"),
    "cloudflared",
  ].filter(Boolean);
}

async function fileExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveCloudflaredBinary() {
  for (const candidate of getBinaryCandidates()) {
    const isPathLike = candidate.includes("\\") || candidate.includes("/") || candidate.endsWith(".exe");

    if (!isPathLike) {
      return candidate;
    }

    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Could not find cloudflared. Place cloudflared.exe in data\\ or set CLOUDFLARED_BIN.",
  );
}

async function ensureLocalServer(port) {
  const targetUrl = `http://127.0.0.1:${port}/api/health`;

  await new Promise((resolve, reject) => {
    const request = http.get(targetUrl, (response) => {
      const chunks = [];

      response.on("data", (chunk) => {
        chunks.push(chunk);
      });

      response.on("end", () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(
            new Error(
              `Local app is not healthy on port ${port} (status ${response.statusCode || "unknown"}).`,
            ),
          );
          return;
        }

        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));

          if (payload.appId !== expectedAppId) {
            reject(
              new Error(
                `Port ${port} is serving a different app (${payload.appId || "unknown app"}), not the Israeli Knesset Analyzer.`,
              ),
            );
            return;
          }

          resolve();
        } catch (error) {
          reject(
            new Error(
              `The health endpoint on port ${port} did not return the expected JSON identity: ${error.message}`,
            ),
          );
        }
      });
    });

    request.setTimeout(5000, () => {
      request.destroy(new Error(`Timed out while connecting to ${targetUrl}.`));
    });

    request.on("error", reject);
  });
}

async function writeStatus(text) {
  await fsp.writeFile(statusPath, `${text}\n`, "utf8");
}

async function main() {
  await fsp.mkdir(dataDir, { recursive: true });

  const port = await getTunnelPort();
  await ensureLocalServer(port);

  const cloudflaredBinary = await resolveCloudflaredBinary();
  const targetUrl = `http://127.0.0.1:${port}`;
  const outLog = fs.createWriteStream(outLogPath, { flags: "w" });
  const errLog = fs.createWriteStream(errLogPath, { flags: "w" });

  await writeStatus("starting");

  const child = spawn(cloudflaredBinary, ["tunnel", "--url", targetUrl], {
    cwd: rootDir,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (!child.pid) {
    throw new Error("cloudflared did not provide a process id.");
  }

  await fsp.writeFile(pidPath, `${child.pid}\n`, "utf8");

  let urlWritten = false;

  const consumeChunk = async (buffer) => {
    const text = buffer.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);

    if (match && !urlWritten) {
      urlWritten = true;
      await fsp.writeFile(publicUrlPath, `${match[0]}\n`, "utf8");
      await writeStatus("running");
      process.stdout.write(`${match[0]}\n`);
    }
  };

  child.stdout.on("data", (chunk) => {
    outLog.write(chunk);
    void consumeChunk(chunk);
  });

  child.stderr.on("data", (chunk) => {
    errLog.write(chunk);
    void consumeChunk(chunk);
  });

  const shutdown = async () => {
    try {
      child.kill();
    } catch {
      // Best effort shutdown for a temporary sharing helper.
    }
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });

  child.on("exit", async (code, signal) => {
    outLog.end();
    errLog.end();

    if (await fileExists(pidPath)) {
      await fsp.rm(pidPath, { force: true });
    }

    if (!urlWritten) {
      await writeStatus(`failed: cloudflared exited before publishing a URL (code=${code ?? "null"}, signal=${signal || "none"})`);
      process.exit(code || 1);
      return;
    }

    await writeStatus("closed");
    process.exit(code || 0);
  });
}

main().catch(async (error) => {
  try {
    await writeStatus(`failed: ${error.message}`);
  } catch {
    // Ignore status write failures on startup.
  }

  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
