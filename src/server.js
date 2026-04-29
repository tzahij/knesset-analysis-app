const fs = require("fs/promises");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const { loadLocalEnv } = require("./lib/load-local-env");

loadLocalEnv(rootDir);

const http = require("http");
const express = require("express");

const { AdminLawUpdateService } = require("./lib/admin-law-update-service");
const { AdminProtocolUpdateService } = require("./lib/admin-protocol-update-service");
const { AnalysisPromotionService } = require("./lib/analysis-promotion-service");
const { AuthService } = require("./lib/auth-service");
const { CommitteeProtocolStore } = require("./lib/committee-protocol-store");
const { GeminiAnalysisClient } = require("./lib/gemini-analysis-client");
const { GeminiFactCheckClient } = require("./lib/gemini-fact-check-client");
const { LandingPageService } = require("./lib/landing-page-service");
const { LawAnalysisService } = require("./lib/law-analysis-service");
const { LawSurpriseExplanationService } = require("./lib/law-surprise-explanation-service");
const { LawSurpriseVoteService } = require("./lib/law-surprise-vote-service");
const { LawStore } = require("./lib/law-store");
const { LawVoteStore } = require("./lib/law-vote-store");
const { MemberAnalysisService } = require("./lib/member-analysis-service");
const { MemberContactDirectoryService } = require("./lib/member-contact-directory-service");
const { MemberComparisonService } = require("./lib/member-comparison-service");
const { MemberProtocolService } = require("./lib/member-protocol-service");
const { MemberVoteProfileService } = require("./lib/member-vote-profile-service");
const { MethodologyService } = require("./lib/methodology-service");
const { ProtocolStore } = require("./lib/protocol-store");
const { ProtocolFactCheckService } = require("./lib/protocol-fact-check-service");
const { toErrorMessage } = require("./lib/utils");

const app = express();
const appId = "israeli-knesset-protocol-reader";
const requestedPort = Number(process.env.PORT || process.env.START_PORT || 3000);
const canAutoSelectPort = !process.env.PORT;
const maxPortAttempts = 20;
const publicDir = path.join(rootDir, "public");
const dataDir = path.join(rootDir, "data");
const serverInfoPath = path.join(dataDir, "server-info.json");
const isStagingApp = process.env.APP_ENV === "staging";
const isProductionLike =
  String(process.env.NODE_ENV || "").trim().toLowerCase() === "production" || isStagingApp;
let activeServerPort = null;

function parseTrustProxySetting(value) {
  const rawValue = String(value || "").trim().toLowerCase();

  if (!rawValue) {
    return false;
  }

  if (rawValue === "true" || rawValue === "yes") {
    return true;
  }

  if (rawValue === "false" || rawValue === "no") {
    return false;
  }

  const numericValue = Number(rawValue);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : false;
}

app.set("trust proxy", parseTrustProxySetting(process.env.TRUST_PROXY));
const authService = new AuthService({ rootDir });
const analysisPromotionService = new AnalysisPromotionService({
  rootDir,
  enabled:
    isStagingApp &&
    String(process.env.AUTO_PROMOTE_ANALYSES_TO_PRODUCTION || "").trim().toLowerCase() === "true",
  sshTarget: process.env.PRODUCTION_SSH_TARGET || "",
  remoteAppPath: process.env.PRODUCTION_APP_PATH || "/opt/knesset-site",
  debounceMs: Number(process.env.PRODUCTION_SYNC_DEBOUNCE_MS) || 15000,
});
const protocolStore = new ProtocolStore({
  rootDir,
  promotionService: analysisPromotionService,
});
const committeeProtocolStore = new CommitteeProtocolStore({
  rootDir,
  promotionService: analysisPromotionService,
});
const adminProtocolUpdateService = new AdminProtocolUpdateService({
  rootDir,
  protocolStore,
  committeeProtocolStore,
});
const lawStore = new LawStore({
  rootDir,
  promotionService: analysisPromotionService,
});
const lawVoteStore = new LawVoteStore({
  rootDir,
  lawStore,
  promotionService: analysisPromotionService,
});
const adminLawUpdateService = new AdminLawUpdateService({
  rootDir,
  lawStore,
  lawVoteStore,
});
const lawAnalysisService = new LawAnalysisService({
  rootDir,
  lawStore,
  analysisClient: new GeminiAnalysisClient(),
  promotionService: analysisPromotionService,
});
const memberProtocolService = new MemberProtocolService({
  rootDir,
  protocolStore,
  committeeProtocolStore,
  promotionService: analysisPromotionService,
});
const memberAnalysisService = new MemberAnalysisService({
  rootDir,
  memberProtocolService,
  analysisClient: new GeminiAnalysisClient(),
  promotionService: analysisPromotionService,
});
const memberContactDirectoryService = new MemberContactDirectoryService({ rootDir });
const protocolFactCheckService = new ProtocolFactCheckService({
  rootDir,
  protocolStore,
  committeeProtocolStore,
  memberProtocolService,
  extractionClient: new GeminiAnalysisClient({
    model: process.env.FACT_CHECK_EXTRACTION_MODEL || "gemini-2.5-flash-lite",
  }),
  verificationClient: new GeminiFactCheckClient(),
});
const memberComparisonService = new MemberComparisonService({
  rootDir,
  memberProtocolService,
  promotionService: analysisPromotionService,
});
const memberVoteProfileService = new MemberVoteProfileService({
  lawStore,
  lawVoteStore,
  lawAnalysisService,
  memberProtocolService,
  dataDir,
});
const lawSurpriseVoteService = new LawSurpriseVoteService({
  lawStore,
  lawVoteStore,
  lawAnalysisService,
  memberAnalysisService,
  memberVoteProfileService,
});
const lawSurpriseExplanationService = new LawSurpriseExplanationService({
  rootDir,
  lawStore,
  lawAnalysisService,
  lawSurpriseVoteService,
  memberProtocolService,
  analysisClient: new GeminiAnalysisClient(),
  promotionService: analysisPromotionService,
});
const landingPageService = new LandingPageService({
  protocolStore,
  committeeProtocolStore,
  lawStore,
  lawSurpriseVoteService,
  memberProtocolService,
  memberAnalysisService,
  memberContactDirectoryService,
  memberComparisonService,
  memberVoteProfileService,
  dataDir,
});
const methodologyService = new MethodologyService({
  rootDir,
  protocolStore,
  committeeProtocolStore,
  lawStore,
  lawVoteStore,
  memberProtocolService,
  memberAnalysisService,
  memberComparisonService,
  memberVoteProfileService,
  lawAnalysisService,
  lawSurpriseVoteService,
  lawSurpriseExplanationService,
});

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

function buildContentSecurityPolicy() {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "form-action 'self'",
  ].join("; ");
}

function isHttpsRequest(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  return Boolean(request.secure || forwardedProto === "https");
}

function applySecurityHeaders(request, response, next) {
  response.setHeader("Content-Security-Policy", buildContentSecurityPolicy());
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");

  if (isHttpsRequest(request)) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
}

function getRequestIp(request) {
  const forwardedFor = String(request.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();

  return forwardedFor || request.ip || request.socket?.remoteAddress || "unknown";
}

function createRateLimiter({ windowMs, max, message, keyBuilder }) {
  const hits = new Map();

  return (request, response, next) => {
    const key = keyBuilder(request);
    const now = Date.now();
    const windowStart = now - windowMs;
    const recentHits = (hits.get(key) || []).filter((timestamp) => timestamp > windowStart);

    if (recentHits.length >= max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((recentHits[0] + windowMs - now) / 1000),
      );

      response.setHeader("Retry-After", String(retryAfterSeconds));
      response.status(429).json({
        error: message,
        retryAfterSeconds,
      });
      return;
    }

    recentHits.push(now);
    hits.set(key, recentHits);

    if (hits.size > 5000) {
      for (const [entryKey, timestamps] of hits.entries()) {
        const activeTimestamps = timestamps.filter((timestamp) => timestamp > windowStart);

        if (activeTimestamps.length) {
          hits.set(entryKey, activeTimestamps);
        } else {
          hits.delete(entryKey);
        }
      }
    }

    next();
  };
}

const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts. Please wait and try again.",
  keyBuilder(request) {
    const username = String(request.body?.username || "").trim().toLowerCase();
    return `${getRequestIp(request)}::${username || "unknown-user"}`;
  },
});

app.use(applySecurityHeaders);
app.use(express.json({ limit: "64kb" }));
app.use((request, _response, next) => {
  authService
    .attachRequestAuth(request)
    .then(() => next())
    .catch(next);
});
app.use(
  express.static(publicDir, {
    etag: !isStagingApp,
    lastModified: !isStagingApp,
    setHeaders(response) {
      if (!isStagingApp) {
        return;
      }

      response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      response.setHeader("Pragma", "no-cache");
      response.setHeader("Expires", "0");
      response.setHeader("Surrogate-Control", "no-store");
    },
  }),
);

function buildPublicSession(request) {
  return authService.buildPublicSession(request?.auth?.session || null);
}

function sendForbidden(request, response, minimumRole) {
  response.status(403).json({
    error: authService.getAuthErrorMessage(minimumRole),
    requiredRole: minimumRole,
    session: buildPublicSession(request),
  });
}

function requireRole(minimumRole) {
  return (request, response, next) => {
    const currentRole = request?.auth?.role || "guest";

    if (!authService.hasRole(currentRole, minimumRole)) {
      sendForbidden(request, response, minimumRole);
      return;
    }

    next();
  };
}

function enforceRefreshRole(request, response, minimumRole) {
  if (request.query.refresh !== "1") {
    return true;
  }

  const currentRole = request?.auth?.role || "guest";

  if (authService.hasRole(currentRole, minimumRole)) {
    return true;
  }

  sendForbidden(request, response, minimumRole);
  return false;
}

app.get("/api/auth/session", (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({
    session: buildPublicSession(request),
  });
});

app.post("/api/auth/login", loginRateLimiter, async (request, response, next) => {
  try {
    const username = String(request.body?.username || "").trim();
    const password = String(request.body?.password || "");

    response.setHeader("Cache-Control", "no-store");

    if (!username || !password) {
      response.status(400).json({
        error: "Username and password are required.",
        session: buildPublicSession(request),
      });
      return;
    }

    const user = await authService.authenticate(username, password);

    if (!user) {
      response.status(401).json({
        error: "Invalid username or password.",
        session: buildPublicSession(request),
      });
      return;
    }

    authService.setSessionCookie(response, user, request);
    response.json({
      session: authService.buildPublicSession({
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      }),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  authService.clearSessionCookie(response, request);
  response.json({
    session: buildPublicSession(null),
  });
});

app.get("/api/admin/protocol-updates/pending", requireRole("admin"), async (_request, response, next) => {
  try {
    response.json(await adminProtocolUpdateService.getPendingPreview());
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/protocol-updates/check", requireRole("admin"), async (_request, response, next) => {
  try {
    response.status(202).json(await adminProtocolUpdateService.startCheckForNewProtocols());
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/protocol-updates/apply", requireRole("admin"), async (_request, response, next) => {
  try {
    const payload = await adminProtocolUpdateService.applyPendingPreview();

    if (!payload) {
      response.status(404).json({ error: "No pending protocol update review was found." });
      return;
    }

    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/law-updates/pending", requireRole("admin"), async (_request, response, next) => {
  try {
    response.json(await adminLawUpdateService.getPendingPreview());
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/law-updates/check", requireRole("admin"), async (_request, response, next) => {
  try {
    response.status(202).json(await adminLawUpdateService.startCheckForNewLaws());
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/law-updates/apply", requireRole("admin"), async (_request, response, next) => {
  try {
    const payload = await adminLawUpdateService.applyPendingPreview();

    if (!payload) {
      response.status(404).json({ error: "No pending law update review was found." });
      return;
    }

    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/law-analyses/missing/start", requireRole("admin"), async (_request, response, next) => {
  try {
    const payload = await lawAnalysisService.startMissingProfileAnalysis();
    response.status(payload.status === "running" ? 202 : 200).json(payload);
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/admin/surprising-vote-explanations/status",
  requireRole("admin"),
  async (_request, response, next) => {
    try {
      response.json(lawSurpriseExplanationService.getBulkStatus());
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/admin/surprising-vote-explanations/start",
  requireRole("admin"),
  async (_request, response, next) => {
    try {
      const payload = await lawSurpriseExplanationService.startBulkMissingExplanations();
      response.status(payload.status === "running" ? 202 : 200).json(payload);
    } catch (error) {
      next(error);
    }
  },
);

app.post("/api/admin/law-analyses/rebuild-all", requireRole("admin"), async (request, response, next) => {
  try {
    if (String(request.body?.confirmation || "").trim().toLowerCase() !== "yes") {
      response.status(400).json({
        error:
          "Type 'yes' to confirm recreating the axes analysis for all third-reading laws. This action is destructive.",
      });
      return;
    }

    const payload = await lawAnalysisService.startFullRebuildAnalysis();
    response.status(202).json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    appId,
    appName: "Israeli Knesset Analyzer",
    port: activeServerPort,
  });
});

app.get("/api/landing", async (_request, response, next) => {
  try {
    response.json(await landingPageService.getLandingPayload());
  } catch (error) {
    next(error);
  }
});

app.get("/api/landing/spotlight", async (_request, response, next) => {
  try {
    response.json(await landingPageService.getSpotlightPayload());
  } catch (error) {
    next(error);
  }
});

app.get("/api/landing/know-your-mk", async (_request, response, next) => {
  try {
    response.json(await landingPageService.buildKnowYourMkPayload());
  } catch (error) {
    next(error);
  }
});

app.get("/api/methodology", async (_request, response, next) => {
  try {
    response.json(await methodologyService.getPublicPayload());
  } catch (error) {
    next(error);
  }
});

app.get("/api/methodology/member-quote-files", requireRole("basic"), async (_request, response, next) => {
  try {
    const members = await memberProtocolService.listMemberUtteranceFilesCatalog();
    response.json({
      generatedAt: new Date().toISOString(),
      members,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/methodology/recreate", requireRole("admin"), async (_request, response, next) => {
  try {
    response.json(await methodologyService.recreatePublicPayload());
  } catch (error) {
    next(error);
  }
});

app.get("/api/protocols", async (request, response, next) => {
  try {
    if (!enforceRefreshRole(request, response, "advanced")) {
      return;
    }

    const forceRefresh = request.query.refresh === "1";
    const protocols = await protocolStore.getProtocols({ forceRefresh });

    response.json({
      metadata: protocolStore.getMetadataInfo(),
      years: protocolStore.getAvailableYears(),
      items: protocols,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/protocols/:documentId", async (request, response, next) => {
  try {
    const protocol = await protocolStore.getProtocolById(request.params.documentId);

    if (!protocol) {
      response.status(404).json({ error: "Protocol not found" });
      return;
    }

    response.json({ protocol });
  } catch (error) {
    next(error);
  }
});

app.get("/api/protocols/:documentId/content", async (request, response, next) => {
  try {
    const result = await protocolStore.getProtocolContent(request.params.documentId);

    if (!result) {
      response.status(404).json({ error: "Protocol not found" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/protocols/:documentId/fact-checks", requireRole("admin"), async (request, response, next) => {
  try {
    const source = request.query.source === "committee" ? "committee" : "plenum";
    const payload = await protocolFactCheckService.getProtocolFactChecks(
      source,
      request.params.documentId,
    );
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/protocols/:documentId/fact-checks/extract",
  requireRole("admin"),
  async (request, response, next) => {
  try {
    const source = request.query.source === "committee" ? "committee" : "plenum";
    const payload = await protocolFactCheckService.extractProtocolClaims(
      source,
      request.params.documentId,
      {
        force: request.query.force === "1",
      },
    );
    response.status(202).json(payload);
  } catch (error) {
    next(error);
  }
  },
);

app.post(
  "/api/protocols/:documentId/fact-checks/verify-all",
  requireRole("admin"),
  async (request, response, next) => {
  try {
    const source = request.query.source === "committee" ? "committee" : "plenum";
    const payload = await protocolFactCheckService.verifyProtocolClaims(
      source,
      request.params.documentId,
      {
        force: request.query.force === "1",
      },
    );
    response.status(202).json(payload);
  } catch (error) {
    next(error);
  }
  },
);

app.get("/api/protocols/:documentId/download", async (request, response, next) => {
  try {
    const file = await protocolStore.getDownloadableFile(request.params.documentId);

    if (!file) {
      response.status(404).json({ error: "Protocol not found" });
      return;
    }

    response.download(file.localFilePath, file.downloadName);
  } catch (error) {
    next(error);
  }
});

app.get("/api/download-all/status", (_request, response) => {
  response.json(protocolStore.getBulkStatus());
});

app.post("/api/download-all", async (_request, response, next) => {
  try {
    const status = await protocolStore.startBulkDownload();
    response.status(202).json(status);
  } catch (error) {
    next(error);
  }
});

app.get("/api/committee-protocols", async (request, response, next) => {
  try {
    if (!enforceRefreshRole(request, response, "advanced")) {
      return;
    }

    const forceRefresh = request.query.refresh === "1";
    const protocols = await committeeProtocolStore.getProtocols({ forceRefresh });

    response.json({
      metadata: committeeProtocolStore.getMetadataInfo(),
      years: committeeProtocolStore.getAvailableYears(),
      items: protocols,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/laws", async (request, response, next) => {
  try {
    if (!enforceRefreshRole(request, response, "advanced")) {
      return;
    }

    const forceRefresh = request.query.refresh === "1";
    const laws = await lawStore.getLaws({ forceRefresh });

    response.json({
      metadata: lawStore.getMetadataInfo(),
      years: lawStore.getAvailableYears(),
      items: laws,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/laws/refresh-status", async (_request, response, next) => {
  try {
    await lawVoteStore.ensureLoaded();
    response.json(lawVoteStore.getRefreshStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/laws/refresh-all", requireRole("advanced"), async (_request, response, next) => {
  try {
    const payload = await lawVoteStore.startRefreshAll({ forceLawRefresh: true });
    response.status(202).json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/laws/analysis/status", async (_request, response, next) => {
  try {
    response.json(lawAnalysisService.getBulkStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/laws/analysis/bulk", requireRole("admin"), async (_request, response, next) => {
  try {
    const payload = await lawAnalysisService.startBulkAnalysis();
    response.status(202).json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/laws/surprising-votes", async (_request, response, next) => {
  try {
    const payload = await lawSurpriseVoteService.getLawsWithSurprisingVotes();

    response.json({
      ...payload,
      metadata: lawStore.getMetadataInfo(),
      years: lawStore.getAvailableYears(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/laws/:billId", async (request, response, next) => {
  try {
    const law = await lawStore.getLawById(request.params.billId);

    if (!law) {
      response.status(404).json({ error: "Law not found" });
      return;
    }

    response.json({ law });
  } catch (error) {
    next(error);
  }
});

app.get("/api/laws/:billId/votes", async (request, response, next) => {
  try {
    if (!enforceRefreshRole(request, response, "advanced")) {
      return;
    }

    const law = await lawStore.getLawById(request.params.billId);

    if (!law) {
      response.status(404).json({ error: "Law not found" });
      return;
    }

    const votes = await lawVoteStore.getLawVotes(request.params.billId, {
      forceRefresh: request.query.refresh === "1",
    });

    response.json({
      law,
      votes,
      refreshStatus: lawVoteStore.getRefreshStatus(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/laws/:billId/analysis", async (request, response, next) => {
  try {
    const payload = await lawAnalysisService.getLawAnalysisRecord(request.params.billId);

    if (!payload) {
      response.status(404).json({ error: "Law not found" });
      return;
    }

    response.json({
      ...payload,
      bulkStatus: lawAnalysisService.getBulkStatus(),
      surprisingVotes: await lawSurpriseExplanationService.attachStatusesToSurprisingVotes(
        request.params.billId,
        await lawSurpriseVoteService.getLawSurprisingVotes(request.params.billId),
      ),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/laws/:billId/surprising-votes/:memberSlug/explanation", async (request, response, next) => {
  try {
    const payload = await lawSurpriseExplanationService.getExplanationRecord(
      request.params.billId,
      request.params.memberSlug,
    );

    if (!payload) {
      response.status(404).json({ error: "Law or member was not found" });
      return;
    }

    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/laws/:billId/surprising-votes/:memberSlug/explanation",
  requireRole("admin"),
  async (request, response, next) => {
  try {
    const payload = await lawSurpriseExplanationService.startExplanation(
      request.params.billId,
      request.params.memberSlug,
      {
        force: request.query.force === "1",
      },
    );

    if (!payload) {
      response.status(404).json({ error: "Law or member was not found" });
      return;
    }

    response.status(202).json(payload);
  } catch (error) {
    next(error);
  }
  },
);

app.get("/api/laws/:billId/content", async (request, response, next) => {
  try {
    const result = await lawStore.getLawContent(request.params.billId);

    if (!result) {
      response.status(404).json({ error: "Law not found" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/laws/:billId/download", async (request, response, next) => {
  try {
    const requestedKind = request.query.kind === "word" ? "word" : "pdf";
    const file = await lawStore.getDownloadableFile(request.params.billId, requestedKind);

    if (!file) {
      response.status(404).json({ error: "Law file not found" });
      return;
    }

    response.download(file.localFilePath, file.downloadName);
  } catch (error) {
    next(error);
  }
});

app.get("/api/committee-protocols/:documentId/content", async (request, response, next) => {
  try {
    const result = await committeeProtocolStore.getProtocolContent(request.params.documentId);

    if (!result) {
      response.status(404).json({ error: "Committee protocol not found" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/committee-protocols/:documentId/download", async (request, response, next) => {
  try {
    const file = await committeeProtocolStore.getDownloadableFile(request.params.documentId);

    if (!file) {
      response.status(404).json({ error: "Committee protocol not found" });
      return;
    }

    response.download(file.localFilePath, file.downloadName);
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/committee-protocols/:documentId/fact-checks",
  requireRole("admin"),
  async (request, response, next) => {
  try {
    const payload = await protocolFactCheckService.getProtocolFactChecks(
      "committee",
      request.params.documentId,
    );
    response.json(payload);
  } catch (error) {
    next(error);
  }
  },
);

app.get("/api/fact-checks/recent", requireRole("admin"), async (request, response, next) => {
  try {
    const payload = await protocolFactCheckService.getRecentClaims({
      limit: request.query.limit,
      verdict: request.query.verdict,
      member: request.query.member,
      source: request.query.source,
    });
    response.json({
      ...payload,
      methodology: protocolFactCheckService.getProtocolMethodology(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/fact-checks/protocol-catalog", requireRole("admin"), async (request, response, next) => {
  try {
    const payload = await protocolFactCheckService.getProtocolCatalog({
      source: request.query.source,
      query: request.query.query,
      year: request.query.year,
      page: request.query.page,
      pageSize: request.query.pageSize,
    });
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/fact-checks/status", requireRole("admin"), (_request, response, next) => {
  Promise.resolve(protocolFactCheckService.getStatus())
    .then((status) => response.json(status))
    .catch(next);
});

app.post("/api/fact-checks/process-new", requireRole("admin"), async (_request, response, next) => {
  try {
    const payload = await protocolFactCheckService.startProcessingNewProtocols();
    response.status(202).json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/fact-checks/claims/:claimId/retry", requireRole("admin"), async (request, response, next) => {
  try {
    const payload = await protocolFactCheckService.retryClaim(request.params.claimId);

    if (!payload) {
      response.status(404).json({ error: "Fact-check claim not found" });
      return;
    }

    response.status(202).json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/fact-checks/claims/:claimId/verify", requireRole("admin"), async (request, response, next) => {
  try {
    const payload = await protocolFactCheckService.verifySingleClaim(request.params.claimId, {
      force: request.query.force === "1",
    });

    if (!payload) {
      response.status(404).json({ error: "Fact-check claim not found" });
      return;
    }

    response.status(202).json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/committee-download-all/status", (_request, response) => {
  response.json(committeeProtocolStore.getBulkStatus());
});

app.post("/api/committee-download-all", async (_request, response, next) => {
  try {
    const status = await committeeProtocolStore.startBulkDownload();
    response.status(202).json(status);
  } catch (error) {
    next(error);
  }
});

app.post("/api/check-updates", requireRole("advanced"), async (_request, response) => {
  const results = await Promise.allSettled([
    protocolStore.checkForUpdates(),
    committeeProtocolStore.checkForUpdates(),
  ]);

  const [plenumResult, committeeResult] = results;

  const payload = {
    checkedAt: new Date().toISOString(),
    hasErrors: results.some((result) => result.status === "rejected"),
    totalAdded:
      (plenumResult.status === "fulfilled" ? plenumResult.value.addedItems.length : 0) +
      (committeeResult.status === "fulfilled" ? committeeResult.value.addedItems.length : 0),
    sources: {
      plenum:
        plenumResult.status === "fulfilled"
          ? {
              status: "ok",
              addedCount: plenumResult.value.addedItems.length,
              total: plenumResult.value.items.length,
              addedItems: plenumResult.value.addedItems.map((protocol) =>
                summarizeAddedProtocol("plenum", protocol),
              ),
            }
          : {
              status: "error",
              error: toErrorMessage(plenumResult.reason),
            },
      committee:
        committeeResult.status === "fulfilled"
          ? {
              status: "ok",
              addedCount: committeeResult.value.addedItems.length,
              total: committeeResult.value.items.length,
              windowStartDate: committeeResult.value.metadata.windowStartDate,
              addedItems: committeeResult.value.addedItems.map((protocol) =>
                summarizeAddedProtocol("committee", protocol),
              ),
            }
          : {
              status: "error",
              error: toErrorMessage(committeeResult.reason),
            },
    },
  };

  const newProtocols = [
    ...(plenumResult.status === "fulfilled"
      ? plenumResult.value.addedItems.map((protocol) => ({
          source: "plenum",
          documentId: String(protocol.documentId),
        }))
      : []),
    ...(committeeResult.status === "fulfilled"
      ? committeeResult.value.addedItems.map((protocol) => ({
          source: "committee",
          documentId: String(protocol.documentId),
        }))
      : []),
  ];

  response.json(payload);
});

app.get("/api/members", async (_request, response, next) => {
  try {
    const payload = await memberProtocolService.getMembersOverview();
    payload.analysisBulkStatus = memberAnalysisService.getBulkStatus();
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/member-contact-directory", async (_request, response, next) => {
  try {
    const payload = await memberContactDirectoryService.getDirectoryOverview({
      parties: memberProtocolService.parties,
    });
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/member-comparisons", async (request, response, next) => {
  try {
    if (!enforceRefreshRole(request, response, "advanced")) {
      return;
    }

    const payload = await memberComparisonService.getPublicPayload({
      forceRefresh: request.query.refresh === "1",
    });
    const statusCode = payload.data ? 200 : 202;
    response.status(statusCode).json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/members/:slug", async (request, response, next) => {
  try {
    const payload = await memberProtocolService.getMemberDetails(request.params.slug);

    if (!payload) {
      response.status(404).json({ error: "Member not found" });
      return;
    }

    const [fullAnalysis, smallAnalysis] = await Promise.all([
      memberAnalysisService.getMemberAnalysisRecord(request.params.slug, "full"),
      memberAnalysisService.getMemberAnalysisRecord(request.params.slug, "small"),
    ]);
    payload.analysis = fullAnalysis;
    payload.analyses = {
      full: fullAnalysis,
      small: smallAnalysis,
    };
    payload.voteProfile = await memberVoteProfileService.getMemberVoteProfile(request.params.slug);
    payload.contact = await memberContactDirectoryService.getMemberContactDetails(request.params.slug);

    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/members/:slug/contact-report", async (request, response, next) => {
  try {
    const payload = await memberProtocolService.getMemberDetails(request.params.slug);

    if (!payload) {
      response.status(404).json({ error: "Member not found" });
      return;
    }

    const report = await memberContactDirectoryService.recordBrokenLinkReport(request.params.slug, {
      contactId: request.body?.contactId,
      href: request.body?.href,
      label: request.body?.label,
      platform: request.body?.platform,
    });

    response.status(202).json({
      ok: true,
      reportId: report.id,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/members/:slug/analysis", requireRole("admin"), async (request, response, next) => {
  try {
    const payload = await memberAnalysisService.startMemberAnalysis(request.params.slug, {
      force: true,
      sourceType: request.query.sourceType,
    });

    if (!payload) {
      response.status(404).json({ error: "Member not found" });
      return;
    }

    response.status(202).json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/members/:slug/utterance-file", requireRole("advanced"), async (request, response, next) => {
  try {
    const payload = await memberProtocolService.startMemberUtteranceFileBuild(
      request.params.slug,
      request.query.sourceType,
    );

    if (!payload) {
      response.status(404).json({ error: "Member not found" });
      return;
    }

    response.status(202).json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/members/utterance-files/bulk", requireRole("advanced"), async (_request, response, next) => {
  try {
    const payload = await memberProtocolService.startAllMemberUtteranceFileBuilds();
    response.status(202).json(payload);
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/admin/members/small-quotes-rebuild/status",
  requireRole("admin"),
  async (_request, response, next) => {
    try {
      response.json(memberProtocolService.getAdminSmallUtteranceRebuildStatus());
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/admin/members/small-quotes-rebuild",
  requireRole("admin"),
  async (request, response, next) => {
    try {
      if (String(request.body?.confirmation || "").trim().toLowerCase() !== "yes") {
        response.status(400).json({
          error:
            "Type 'yes' to confirm recreating all small quotes files. This action is destructive.",
        });
        return;
      }

      const payload = await memberProtocolService.startAdminSmallUtteranceRebuild();
      response.status(202).json(payload);
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/members/profiles-rebuild/status",
  requireRole("admin"),
  async (_request, response, next) => {
    try {
      response.json(memberAnalysisService.getAdminProfileRebuildStatus());
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/admin/members/profiles-rebuild",
  requireRole("admin"),
  async (request, response, next) => {
    try {
      if (String(request.body?.confirmation || "").trim().toLowerCase() !== "yes") {
        response.status(400).json({
          error:
            "Type 'yes' to confirm recreating all MK profiles from the small quotes files. This action is destructive.",
        });
        return;
      }

      const payload = await memberAnalysisService.startAdminProfileRebuild();
      response.status(202).json(payload);
    } catch (error) {
      next(error);
    }
  },
);

app.post("/api/members/analyses/bulk", requireRole("admin"), async (request, response, next) => {
  try {
    const payload = await memberAnalysisService.startBulkAnalysis({
      sourceType: request.query.sourceType,
    });
    response.status(202).json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/members/:slug/utterance-file/download", requireRole("basic"), async (request, response, next) => {
  try {
    const manifest = await memberProtocolService.getMemberUtteranceFileDownload(
      request.params.slug,
      request.query.sourceType,
    );

    if (!manifest) {
      response.status(404).json({ error: "Member utterance file not found" });
      return;
    }

    response.download(manifest.filePath, manifest.downloadName);
  } catch (error) {
    next(error);
  }
});

app.get("/api/members/:slug/utterance-file/text", requireRole("basic"), async (request, response, next) => {
  try {
    const payload = await memberProtocolService.getMemberUtteranceFileText(
      request.params.slug,
      request.query.sourceType,
    );

    if (!payload) {
      response.status(404).json({ error: "Member utterance file text not found" });
      return;
    }

    response.type("text/plain; charset=utf-8").send(payload.text);
  } catch (error) {
    next(error);
  }
});

app.post("/api/members/index", requireRole("advanced"), async (_request, response, next) => {
  try {
    const status = await memberProtocolService.startIndexing();
    response.status(202).json(status);
  } catch (error) {
    next(error);
  }
});

app.get("/protocol/:documentId", (_request, response) => {
  response.sendFile(path.join(publicDir, "protocol.html"));
});

app.get("/committee-protocol/:documentId", (_request, response) => {
  response.sendFile(path.join(publicDir, "protocol.html"));
});

app.get("/members", (_request, response) => {
  response.sendFile(path.join(publicDir, "members.html"));
});

app.get("/talk-to-your-representatives", (_request, response) => {
  response.sendFile(path.join(publicDir, "talk-to-your-representatives.html"));
});

app.get("/plenum", (_request, response) => {
  response.sendFile(path.join(publicDir, "explorer.html"));
});

app.get("/committees", (_request, response) => {
  response.sendFile(path.join(publicDir, "explorer.html"));
});

app.get("/laws", (_request, response) => {
  response.sendFile(path.join(publicDir, "explorer.html"));
});

app.get("/surprising-votes", (_request, response) => {
  response.sendFile(path.join(publicDir, "explorer.html"));
});

app.get("/members/:slug", (_request, response) => {
  response.sendFile(path.join(publicDir, "member.html"));
});

app.get("/comparisons", (_request, response) => {
  response.sendFile(path.join(publicDir, "comparisons.html"));
});

app.get("/know-your-mk", (_request, response) => {
  response.sendFile(path.join(publicDir, "know-your-mk.html"));
});

app.get("/how-we-know", (_request, response) => {
  response.sendFile(path.join(publicDir, "how-we-know.html"));
});

app.get("/fact-checks", (_request, response) => {
  response.redirect("/");
});

app.get("/law/:billId", (_request, response) => {
  response.sendFile(path.join(publicDir, "law.html"));
});

app.get("/law/:billId/surprising-votes/:memberSlug/explanation/view", (_request, response) => {
  response.sendFile(path.join(publicDir, "law-surprise-explanation.html"));
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({
    error: isProductionLike ? "Internal server error." : toErrorMessage(error),
  });
});

function startInitialSyncs() {
  protocolStore.getProtocols().catch((error) => {
    console.error("Initial metadata sync failed:", toErrorMessage(error));
  });

  committeeProtocolStore.getProtocols().catch((error) => {
    console.error("Initial committee metadata sync failed:", toErrorMessage(error));
  });

  lawStore.getLaws().catch((error) => {
    console.error("Initial laws metadata sync failed:", toErrorMessage(error));
  });

  landingPageService.warmSpotlightCache().catch((error) => {
    console.error("Initial spotlight warmup failed:", toErrorMessage(error));
  });
}

async function writeServerInfo(port) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    serverInfoPath,
    JSON.stringify(
      {
        appId,
        appName: "Israeli Knesset Analyzer",
        port,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

function listenOnPort(port, attemptsRemaining = maxPortAttempts) {
  const server = http.createServer(app);

  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && canAutoSelectPort && attemptsRemaining > 0) {
      console.warn(
        `Port ${port} is already in use. Trying http://localhost:${port + 1} instead...`,
      );
      listenOnPort(port + 1, attemptsRemaining - 1);
      return;
    }

    console.error(`Unable to start server on port ${port}: ${toErrorMessage(error)}`);
    process.exit(1);
  });

  server.listen(port, () => {
    const address = server.address();
    activeServerPort =
      typeof address === "object" && address && "port" in address ? address.port : port;

    void writeServerInfo(activeServerPort).catch((error) => {
      console.error("Unable to write server info:", toErrorMessage(error));
    });

    console.log(`Knesset protocol reader is available at http://localhost:${activeServerPort}`);
    startInitialSyncs();
  });
}

listenOnPort(requestedPort);
