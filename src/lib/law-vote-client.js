const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const puppeteer = require("puppeteer-core");

const { ensureDirectory, fileExists, toErrorMessage } = require("./utils");

const VOTES_PAGE_URL = "https://main.knesset.gov.il/Activity/plenum/Votes/Pages/default.aspx";
const VOTES_API_BASE_URL = "https://knesset.gov.il/WebSiteApi/knessetapi/Votes";
const PRINT_API_BASE_URL = "https://knesset.gov.il/WebSiteApi/knessetapi/PrintPdf";
const DEBUGGER_POLL_INTERVAL_MS = 500;
const DEBUGGER_TIMEOUT_MS = 60000;
const NAVIGATION_TIMEOUT_MS = 120000;
const WARMUP_ATTEMPTS = 4;
const LAUNCH_ATTEMPTS = 3;
const DEFAULT_HEADERS = {
  Accept: "application/json, text/plain, */*",
};

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildDebugPort() {
  return 9400 + Math.floor(Math.random() * 200);
}

async function waitForDebugger(port) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < DEBUGGER_TIMEOUT_MS) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        return response.json();
      }
    } catch {
      // Keep polling until Chrome exposes the debugger endpoint.
    }

    await delay(DEBUGGER_POLL_INTERVAL_MS);
  }

  throw new Error("Timed out while waiting for the local Chrome debugging endpoint.");
}

async function killProcessTree(pid) {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });

      killer.once("error", () => {
        try {
          process.kill(pid);
        } catch {}
        resolve();
      });
      killer.once("exit", () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}

class LawVoteClient {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname, "..", "..");
    this.dataDir = options.dataDir || path.join(this.rootDir, "data");
    this.browserUserDataDir = options.browserUserDataDir || path.join(this.dataDir, "chrome-law-votes");
  }

  async findBrowserExecutable() {
    const envCandidates = [
      process.env.CHROME_PATH,
      process.env.GOOGLE_CHROME_BIN,
      process.env.CHROMIUM_PATH,
      process.env.EDGE_PATH,
    ].filter(Boolean);

    const windowsCandidates = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ];

    for (const candidate of [...envCandidates, ...windowsCandidates]) {
      if (await fileExists(candidate)) {
        return candidate;
      }
    }

    if (process.platform !== "win32") {
      return envCandidates[0] || "google-chrome";
    }

    throw new Error(
      "A local Chrome or Edge installation is required to load Knesset vote data through the anti-bot challenge.",
    );
  }

  async launchBrowser() {
    const executablePath = await this.findBrowserExecutable();
    let lastError = null;

    for (let attempt = 1; attempt <= LAUNCH_ATTEMPTS; attempt += 1) {
      const port = buildDebugPort();
      const sessionUserDataDir = path.join(
        this.browserUserDataDir,
        `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      await ensureDirectory(sessionUserDataDir);

      const browserProcess = spawn(
        executablePath,
        [
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${sessionUserDataDir}`,
          "--no-first-run",
          "--no-default-browser-check",
          "--start-minimized",
          VOTES_PAGE_URL,
        ],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );

      try {
        const versionInfo = await waitForDebugger(port);
        const browser = await puppeteer.connect({
          browserWSEndpoint: versionInfo.webSocketDebuggerUrl,
          defaultViewport: null,
        });
        const pages = await browser.pages();
        const page = pages[0] || (await browser.newPage());
        page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
        page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);

        return {
          browser,
          page,
          browserProcess,
          sessionUserDataDir,
        };
      } catch (error) {
        lastError = error;
        await killProcessTree(browserProcess?.pid);

        try {
          await fs.rm(sessionUserDataDir, { recursive: true, force: true });
        } catch {}

        await delay(1000);
      }
    }

    throw lastError || new Error("Unable to launch a local browser session for Knesset vote data.");
  }

  async closeBrowser(session) {
    if (!session) {
      return;
    }

    try {
      await session.browser.close();
    } catch {
      try {
        await session.browser.disconnect();
      } catch {}
    }

    await killProcessTree(session.browserProcess?.pid);

    if (session.sessionUserDataDir) {
      try {
        await fs.rm(session.sessionUserDataDir, { recursive: true, force: true });
      } catch {}
    }
  }

  async fetchJsonInPage(page, url, init = {}) {
    const requestInit = {
      method: init.method || "GET",
      headers: {
        ...DEFAULT_HEADERS,
        ...(init.headers || {}),
      },
      body: init.body || null,
    };

    const payload = await page.evaluate(
      async ({ targetUrl, requestOptions }) => {
        const response = await fetch(targetUrl, requestOptions);
        const text = await response.text();

        return {
          ok: response.ok,
          status: response.status,
          contentType: response.headers.get("content-type") || "",
          text,
        };
      },
      {
        targetUrl: url,
        requestOptions: requestInit,
      },
    );

    if (!payload.ok) {
      throw new Error(`Vote API request failed with ${payload.status}`);
    }

    const trimmedText = String(payload.text || "").trim();

    if (!trimmedText) {
      return null;
    }

    if (!payload.contentType.toLowerCase().includes("json")) {
      throw new Error(`Vote API returned non-JSON content: ${trimmedText.slice(0, 120)}`);
    }

    try {
      return JSON.parse(trimmedText);
    } catch (error) {
      throw new Error(`Vote API returned invalid JSON: ${toErrorMessage(error)}`);
    }
  }

  async warmUpVotesPage(page) {
    let lastError = null;

    for (let attempt = 1; attempt <= WARMUP_ATTEMPTS; attempt += 1) {
      try {
        await page.goto(VOTES_PAGE_URL, {
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        });
        await delay(4000 + attempt * 1500);
        await this.fetchJsonInPage(page, `${VOTES_API_BASE_URL}/GetAllVotesDates`);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      `The Knesset votes site did not finish the anti-bot warmup successfully: ${toErrorMessage(lastError)}`,
    );
  }

  createSessionApi(page) {
    return {
      fetchVotesHeaders: async (options = {}) => {
        const body = {
          SearchType: options.searchType || (options.fromDate || options.toDate ? 2 : 1),
        };

        if (options.fromDate) {
          body.FromDate = options.fromDate;
        }

        if (options.toDate) {
          body.ToDate = options.toDate;
        }

        if (Number.isFinite(options.knessetNum)) {
          body.KnessetNum = options.knessetNum;
        }

        return this.fetchJsonInPage(page, `${VOTES_API_BASE_URL}/GetVotesHeaders`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json;charset=UTF-8",
          },
          body: JSON.stringify(body),
        });
      },

      fetchVoteDetails: async (voteId) =>
        this.fetchJsonInPage(page, `${VOTES_API_BASE_URL}/GetVoteDetails/${encodeURIComponent(voteId)}`),

      fetchVotesComboData: async () =>
        this.fetchJsonInPage(page, `${VOTES_API_BASE_URL}/GetVotesCmbData`),

      fetchAllVoteDates: async () =>
        this.fetchJsonInPage(page, `${VOTES_API_BASE_URL}/GetAllVotesDates`),

      fetchVotePdfUrl: async (voteId) =>
        this.fetchJsonInPage(
          page,
          `${PRINT_API_BASE_URL}/PrintVote?voteId=${encodeURIComponent(voteId)}`,
        ),
    };
  }

  async withSession(worker) {
    const session = await this.launchBrowser();

    try {
      await this.warmUpVotesPage(session.page);
      const api = this.createSessionApi(session.page);
      return await worker(api);
    } finally {
      await this.closeBrowser(session);
    }
  }

  async fetchVotesHeaders(options = {}) {
    return this.withSession((api) => api.fetchVotesHeaders(options));
  }

  async fetchVoteDetails(voteId) {
    return this.withSession((api) => api.fetchVoteDetails(voteId));
  }

  async fetchVotePdfUrl(voteId) {
    return this.withSession((api) => api.fetchVotePdfUrl(voteId));
  }
}

module.exports = {
  LawVoteClient,
  VOTES_PAGE_URL,
  VOTES_API_BASE_URL,
};
