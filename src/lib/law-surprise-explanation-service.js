const fs = require("fs/promises");
const path = require("path");

const {
  ensureDirectory,
  fileExists,
  mapWithConcurrency,
  readJson,
  resolveStoredDataPath,
  sanitizeFilename,
  toErrorMessage,
  writeTextFile,
  writeJson,
} = require("./utils");
const { SURPRISE_THRESHOLD } = require("./law-surprise-vote-service");

const EXPLANATION_VERSION = 1;
const MAX_MEMBER_TEXT_CHARS = Number(process.env.SURPRISE_VOTE_MEMBER_MAX_CHARS) || 90000;
const MAX_LAW_TEXT_CHARS = Number(process.env.SURPRISE_VOTE_LAW_MAX_CHARS) || 45000;
const MEMBER_SOURCE_TYPE = "small";
const BULK_EXPLANATION_CONCURRENCY = Number(process.env.SURPRISE_VOTE_BULK_CONCURRENCY) || 1;

const EXPLANATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bottomLine", "hypotheses", "caution"],
  properties: {
    bottomLine: {
      type: "string",
    },
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "explanation", "memberEvidence", "lawEvidence"],
        properties: {
          title: {
            type: "string",
          },
          explanation: {
            type: "string",
          },
          memberEvidence: {
            type: "array",
            items: {
              type: "string",
            },
          },
          lawEvidence: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
      },
    },
    caution: {
      type: "string",
    },
  },
};

function buildRuntimeKey(billId, memberSlug) {
  return `${billId}::${memberSlug}`;
}

function getPublicMemberSlug(member) {
  return member?.routeSlug || member?.slug || "";
}

function truncateText(text, maxChars) {
  const normalized = String(text || "").trim();

  if (!normalized || normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars)}\n\n[TEXT TRUNCATED]`;
}

function buildSourceSignature(context) {
  return JSON.stringify({
    version: EXPLANATION_VERSION,
    threshold: SURPRISE_THRESHOLD,
    billId: String(context.law.billId),
    memberSlug: context.member.slug,
    lawAnalysisGeneratedAt:
      context.lawAnalysisRecord?.status?.generatedAt ||
      context.lawAnalysisRecord?.status?.finishedAt ||
      null,
    lawExtractedAt: context.lawContent?.extractedAt || null,
    memberUtteranceGeneratedAt: context.utteranceManifest?.generatedAt || null,
    surpriseAxes: (context.surpriseVoteItem?.surpriseAxes || []).map((axis) => ({
      key: axis.key,
      lawScore: axis.lawScore,
      memberScore: axis.memberScore,
      difference: axis.difference,
    })),
  });
}

function formatExplanationMarkdown(context, manifest) {
  const sections = [
    `# ${context.member.name} · ${context.law.title}`,
    "",
    `- חוק: ${context.law.title}`,
    `- מספר הצעת חוק: ${context.law.billId}`,
    `- חבר כנסת: ${context.member.name}`,
    `- מפלגה: ${context.member.partyName}`,
    `- הצבעה: ${context.surpriseVoteItem.voteLabel || "בעד"}`,
    `- נוצר בתאריך: ${manifest.generatedAt}`,
    "",
    "## שורה תחתונה",
    "",
    manifest.explanation.bottomLine || "",
    "",
    "## השערות מסבירות",
    "",
  ];

  for (const hypothesis of manifest.explanation.hypotheses || []) {
    sections.push(`### ${hypothesis.title}`);
    sections.push("");
    sections.push(hypothesis.explanation || "");
    sections.push("");

    if (Array.isArray(hypothesis.memberEvidence) && hypothesis.memberEvidence.length) {
      sections.push("ראיות מתוך דברי חבר הכנסת:");
      for (const item of hypothesis.memberEvidence) {
        sections.push(`- ${item}`);
      }
      sections.push("");
    }

    if (Array.isArray(hypothesis.lawEvidence) && hypothesis.lawEvidence.length) {
      sections.push("ראיות מתוך החוק:");
      for (const item of hypothesis.lawEvidence) {
        sections.push(`- ${item}`);
      }
      sections.push("");
    }
  }

  sections.push("## הסתייגות");
  sections.push("");
  sections.push(manifest.explanation.caution || "");
  sections.push("");

  return sections.join("\n");
}

function buildInstructions() {
  return [
    "אתה פרשן פוליטי זהיר וחד, הכותב בעברית טבעית, ברורה ותמציתית.",
    "המטרה שלך היא להסביר הצבעת בעד שנראית מפתיעה ביחס לעמדות הליבה של חבר הכנסת.",
    "הישען רק על שני מקורות: קובץ האמירות הקטן של חבר הכנסת ונוסח/תקציר החוק שסופקו לך כאן.",
    "אל תשתמש בידע חיצוני, אל תספר סיפורים, ואל תטען לוודאות שאין לך.",
    "עליך להציע השערות סבירות שמיישבות את הפער בין עמדות החבר לבין ההצבעה בפועל.",
    "ההשערות יכולות לכלול, רק אם החומר תומך בכך, הבחנה בין עיקרון רחב לבין נוסח ספציפי, פרגמטיות, פשרה נקודתית, דגש סקטוריאלי, היבט מנהלי-טכני, מסגור אסטרטגי, או סדר עדיפויות מתחרה.",
    "bottomLine צריך להיות פסקה קצרה אחת שמסבירה בקול ישר מה הפתרון הסביר ביותר לפער.",
    "hypotheses צריכות לכלול 2 עד 4 השערות קצרות ומובחנות, וכל אחת חייבת לכלול ראיות מתוך דברי חבר הכנסת וראיות מתוך החוק.",
    "caution צריך להיות משפט קצר שמבהיר שמדובר בפרשנות מושכלת אך לא בוודאות מוחלטת.",
    "החזר JSON תקף בלבד לפי הסכמה שניתנה.",
  ].join(" ");
}

function buildInput(context, memberFileText) {
  const lawAxes = context.surpriseVoteItem.allAxisDiffs
    .map(
      (axis) =>
        `${axis.label}: חוק ${axis.lawScore}/10, חבר הכנסת ${axis.memberScore}/10, פער ${axis.difference}/10`,
    )
    .join("\n");
  const surpriseAxes = context.surpriseVoteItem.surpriseAxes
    .map(
      (axis) =>
        `${axis.label}: חוק ${axis.lawScore}/10, חבר הכנסת ${axis.memberScore}/10, פער ${axis.difference}/10`,
    )
    .join("\n");
  const lawSummary = Array.isArray(context.lawContent?.summaryParagraphs)
    ? context.lawContent.summaryParagraphs.join("\n")
    : "";
  const lawText = truncateText((context.lawContent?.paragraphs || []).join("\n\n"), MAX_LAW_TEXT_CHARS);

  return [
    `חבר הכנסת: ${context.member.name}`,
    `מפלגה: ${context.member.partyName}`,
    `החוק: ${context.law.title}`,
    `מספר הצעת חוק: ${context.law.billId}`,
    `הצבעה בפועל: ${context.surpriseVoteItem.voteLabel || "בעד"}`,
    `סף הפתעה: ${SURPRISE_THRESHOLD} נקודות`,
    "",
    "כל הפערים בין ציוני החוק לציוני חבר הכנסת:",
    lawAxes || "לא זמין",
    "",
    "הצירים שיצרו את סימון ההצבעה כמפתיעה:",
    surpriseAxes || "לא זמין",
    "",
    "סיכום אידיאולוגי של החוק כפי שנותח קודם:",
    context.lawAnalysisRecord?.analysis?.overallSummary || "לא זמין",
    "",
    "תקציר ומטא-דאטה של החוק:",
    lawSummary || "לא זמין",
    "",
    "נוסח החוק:",
    lawText || "לא זמין",
    "",
    "קובץ האמירות הקטן של חבר הכנסת:",
    truncateText(memberFileText, MAX_MEMBER_TEXT_CHARS) || "לא זמין",
  ].join("\n");
}

class LawSurpriseExplanationService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname, "..", "..");
    this.dataDir = options.dataDir || path.join(this.rootDir, "data");
    this.explanationsDir = path.join(this.dataDir, "law-surprise-explanations");
    this.lawStore = options.lawStore;
    this.lawAnalysisService = options.lawAnalysisService;
    this.lawSurpriseVoteService = options.lawSurpriseVoteService;
    this.memberProtocolService = options.memberProtocolService;
    this.analysisClient = options.analysisClient;
    this.promotionService = options.promotionService || null;
    this.initialized = false;
    this.runtimeStatuses = new Map();
    this.runtimePromises = new Map();
    this.bulkPromise = null;
    this.bulkStatus = this.createIdleBulkStatus();
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    await Promise.all([ensureDirectory(this.dataDir), ensureDirectory(this.explanationsDir)]);
    this.initialized = true;
  }

  createIdleStatus(law, member) {
    return {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      generatedAt: null,
      currentStage: null,
      error: null,
      isStale: false,
      configured: this.analysisClient?.isConfigured?.() || false,
      provider: this.analysisClient?.provider || "unknown",
      model: this.analysisClient?.model || "unknown",
      hasExplanation: false,
      billId: String(law.billId),
      memberSlug: getPublicMemberSlug(member),
      memberName: member.name,
    };
  }

  createIdleBulkStatus() {
    return {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      lastCompletedAt: null,
      totalSurprisingVotes: 0,
      totalPendingVotes: 0,
      alreadyExplainedVotes: 0,
      alreadyRunningVotes: 0,
      processedVotes: 0,
      generatedExplanations: 0,
      skippedVotes: 0,
      failedVotes: 0,
      current: null,
      recentErrors: [],
      configured: this.analysisClient?.isConfigured?.() || false,
      provider: this.analysisClient?.provider || "unknown",
      model: this.analysisClient?.model || "unknown",
      message: null,
    };
  }

  getBulkStatus() {
    return {
      ...this.bulkStatus,
    };
  }

  buildBaseName(law, member) {
    return sanitizeFilename(`${law.billId}__${member.slug}__surprising-vote-explanation`);
  }

  getJsonPath(law, member) {
    return path.join(this.explanationsDir, `${this.buildBaseName(law, member)}.json`);
  }

  getMarkdownPath(law, member) {
    return path.join(this.explanationsDir, `${this.buildBaseName(law, member)}.md`);
  }

  async readManifest(law, member) {
    const jsonPath = this.getJsonPath(law, member);

    if (!(await fileExists(jsonPath))) {
      return null;
    }

    try {
      const manifest = await readJson(jsonPath);
      const resolvedMarkdownPath = await resolveStoredDataPath(this.dataDir, manifest?.markdownPath);

      if (
        manifest?.version !== EXPLANATION_VERSION ||
        String(manifest?.billId || "") !== String(law.billId) ||
        manifest?.memberSlug !== member.slug ||
        !resolvedMarkdownPath
      ) {
        return null;
      }

      return {
        ...manifest,
        markdownPath: resolvedMarkdownPath,
      };
    } catch {
      return null;
    }
  }

  async resolveContext(billId, memberSlug, surpriseVoteItem = null) {
    const [law, member] = await Promise.all([
      this.lawStore.getLawById(billId),
      Promise.resolve(this.memberProtocolService.resolveMember(memberSlug)),
    ]);

    if (!law || !member) {
      return null;
    }

    if (!surpriseVoteItem) {
      const surprisingVotesPayload = await this.lawSurpriseVoteService.getLawSurprisingVotes(billId);
      const publicMemberSlug = getPublicMemberSlug(member) || memberSlug;

      if (surprisingVotesPayload?.status === "ready") {
        surpriseVoteItem =
          surprisingVotesPayload.surprisingVotes.find((item) => item.routeSlug === publicMemberSlug) ||
          null;
      }
    }

    return {
      law,
      member,
      surpriseVoteItem,
    };
  }

  async buildFullContext(billId, memberSlug, surpriseVoteItem = null, utteranceManifest = null) {
    const baseContext = await this.resolveContext(billId, memberSlug, surpriseVoteItem);

    if (!baseContext) {
      return null;
    }

    const [lawAnalysisRecord, lawContent, resolvedUtteranceManifest] = await Promise.all([
      this.lawAnalysisService.getLawAnalysisRecord(billId),
      this.lawStore.getLawContent(billId),
      utteranceManifest
        ? Promise.resolve(utteranceManifest)
        : this.memberProtocolService.getMemberUtteranceFileDownload(memberSlug, MEMBER_SOURCE_TYPE),
    ]);

    return {
      ...baseContext,
      lawAnalysisRecord,
      lawContent,
      utteranceManifest: resolvedUtteranceManifest,
    };
  }

  isManifestStale(manifest, sourceSignature) {
    return manifest?.sourceSignature !== sourceSignature;
  }

  buildCompletedStatus(law, member, manifest, isStale) {
    return {
      status: "completed",
      startedAt: manifest.startedAt || null,
      finishedAt: manifest.generatedAt,
      generatedAt: manifest.generatedAt,
      currentStage: null,
      error: null,
      isStale,
      configured: this.analysisClient?.isConfigured?.() || false,
      provider: manifest.provider || this.analysisClient?.provider || "unknown",
      model: manifest.model || this.analysisClient?.model || "unknown",
      hasExplanation: true,
      billId: String(law.billId),
      memberSlug: getPublicMemberSlug(member),
      memberName: member.name,
    };
  }

  buildPublicRecord(law, member, status, explanation, manifest = null) {
    return {
      law: {
        billId: String(law.billId),
        title: law.title,
        lawId: law.lawId || null,
        shortDateLabel: law.shortDateLabel || "",
        publicationSeriesDesc: law.publicationSeriesDesc || "",
      },
      member: {
        slug: getPublicMemberSlug(member),
        name: member.name,
        partyName: member.partyName || "",
      },
      status,
      explanation,
      markdownPath: manifest?.markdownPath || null,
    };
  }

  async getExplanationRecord(billId, memberSlug, options = {}) {
    await this.initialize();
    const context = await this.buildFullContext(billId, memberSlug, options.surpriseVoteItem || null);

    if (!context) {
      return null;
    }

    const { law, member, surpriseVoteItem } = context;

    if (!surpriseVoteItem) {
      return this.buildPublicRecord(
        law,
        member,
        {
          ...this.createIdleStatus(law, member),
          status: "not_surprising",
        },
        null,
      );
    }

    const runtimeKey = buildRuntimeKey(law.billId, member.slug);
    const runtimeStatus = this.runtimeStatuses.get(runtimeKey);
    const manifest = await this.readManifest(law, member);
    const sourceSignature = buildSourceSignature(context);
    const isStale = manifest ? this.isManifestStale(manifest, sourceSignature) : false;

    if (runtimeStatus) {
      return this.buildPublicRecord(
        law,
        member,
        {
          ...runtimeStatus,
          isStale,
        },
        manifest?.explanation || null,
        manifest,
      );
    }

    if (!manifest) {
      return this.buildPublicRecord(
        law,
        member,
        {
          ...this.createIdleStatus(law, member),
          isStale: false,
        },
        null,
      );
    }

    return this.buildPublicRecord(
      law,
      member,
      this.buildCompletedStatus(law, member, manifest, isStale),
      manifest.explanation,
      manifest,
    );
  }

  async attachStatusesToSurprisingVotes(billId, surprisingVotesPayload) {
    if (
      !surprisingVotesPayload ||
      surprisingVotesPayload.status !== "ready" ||
      !Array.isArray(surprisingVotesPayload.surprisingVotes)
    ) {
      return surprisingVotesPayload;
    }

    const enrichedVotes = await Promise.all(
      surprisingVotesPayload.surprisingVotes.map(async (item) => {
        const explanationRecord = await this.getExplanationRecord(billId, item.routeSlug, {
          surpriseVoteItem: item,
        });

        return {
          ...item,
          explanationRecord,
        };
      }),
    );

    return {
      ...surprisingVotesPayload,
      surprisingVotes: enrichedVotes,
    };
  }

  async collectBulkCandidates() {
    await this.initialize();

    const lawsPayload = await this.lawSurpriseVoteService.getLawsWithSurprisingVotes();
    const candidates = [];
    let totalSurprisingVotes = 0;
    let alreadyExplainedVotes = 0;
    let alreadyRunningVotes = 0;

    if (lawsPayload?.status !== "ready" || !Array.isArray(lawsPayload.items)) {
      return {
        candidates,
        totalSurprisingVotes,
        alreadyExplainedVotes,
        alreadyRunningVotes,
      };
    }

    for (const law of lawsPayload.items) {
      const votePayload = await this.lawSurpriseVoteService.getLawSurprisingVotes(law.billId);

      if (votePayload?.status !== "ready" || !Array.isArray(votePayload.surprisingVotes)) {
        continue;
      }

      for (const surpriseVoteItem of votePayload.surprisingVotes) {
        totalSurprisingVotes += 1;

        const context = await this.resolveContext(law.billId, surpriseVoteItem.routeSlug, surpriseVoteItem);

        if (!context) {
          continue;
        }

        const runtimeKey = buildRuntimeKey(context.law.billId, context.member.slug);
        const runtimeStatus = this.runtimeStatuses.get(runtimeKey);

        if (runtimeStatus?.status === "running") {
          alreadyRunningVotes += 1;
          continue;
        }

        const existingManifest = await this.readManifest(context.law, context.member);

        if (existingManifest) {
          alreadyExplainedVotes += 1;
          continue;
        }

        candidates.push({
          law: context.law,
          member: context.member,
          surpriseVoteItem,
        });
      }
    }

    return {
      candidates,
      totalSurprisingVotes,
      alreadyExplainedVotes,
      alreadyRunningVotes,
    };
  }

  async startBulkMissingExplanations() {
    await this.initialize();

    if (!this.analysisClient?.isConfigured?.()) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    if (this.bulkPromise) {
      return this.getBulkStatus();
    }

    const {
      candidates,
      totalSurprisingVotes,
      alreadyExplainedVotes,
      alreadyRunningVotes,
    } = await this.collectBulkCandidates();

    if (!candidates.length) {
      const finishedAt = new Date().toISOString();
      const nothingToDoMessage = totalSurprisingVotes
        ? "Every currently surprising vote already has an explanation or is already being analyzed."
        : "No surprising votes are currently available for explanation.";

      this.bulkStatus = {
        ...this.createIdleBulkStatus(),
        status: "nothing_to_do",
        startedAt: finishedAt,
        finishedAt,
        lastCompletedAt: finishedAt,
        totalSurprisingVotes,
        totalPendingVotes: 0,
        alreadyExplainedVotes,
        alreadyRunningVotes,
        configured: true,
        provider: this.analysisClient.provider || "unknown",
        model: this.analysisClient.model || "unknown",
        message: nothingToDoMessage,
      };

      return this.getBulkStatus();
    }

    this.bulkStatus = {
      ...this.createIdleBulkStatus(),
      status: "running",
      startedAt: new Date().toISOString(),
      totalSurprisingVotes,
      totalPendingVotes: candidates.length,
      alreadyExplainedVotes,
      alreadyRunningVotes,
      configured: true,
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model || "unknown",
      lastCompletedAt: this.bulkStatus.lastCompletedAt || null,
      message: `Analyzing ${candidates.length} surprising votes that do not yet have explanations.`,
    };

    this.bulkPromise = this.runBulkMissingExplanations(candidates)
      .catch((error) => {
        this.bulkStatus.status = "failed";
        this.bulkStatus.finishedAt = new Date().toISOString();
        this.bulkStatus.current = null;
        this.bulkStatus.recentErrors = [toErrorMessage(error)];
      })
      .finally(() => {
        this.bulkPromise = null;
      });

    return this.getBulkStatus();
  }

  async startExplanation(billId, memberSlug, options = {}) {
    await this.initialize();

    if (!this.analysisClient?.isConfigured?.()) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const initialRecord = await this.getExplanationRecord(billId, memberSlug, options);

    if (!initialRecord) {
      return null;
    }

    if (initialRecord.status.status === "not_surprising") {
      throw new Error("This vote is not currently marked as a surprising vote.");
    }

    const runtimeKey = buildRuntimeKey(billId, memberSlug);

    if (this.runtimePromises.has(runtimeKey)) {
      return this.getExplanationRecord(billId, memberSlug, options);
    }

    const context = await this.resolveContext(billId, memberSlug, options.surpriseVoteItem || null);

    if (!context?.surpriseVoteItem) {
      throw new Error("This vote is not currently marked as a surprising vote.");
    }

    const runtimeStatus = {
      ...this.createIdleStatus(context.law, context.member),
      status: "running",
      startedAt: new Date().toISOString(),
      currentStage: "preparing_sources",
    };
    this.runtimeStatuses.set(runtimeKey, runtimeStatus);

    const runPromise = this.runExplanation(context, Boolean(options.force))
      .catch((error) => {
        this.runtimeStatuses.set(runtimeKey, {
          ...this.createIdleStatus(context.law, context.member),
          status: "failed",
          startedAt: runtimeStatus.startedAt,
          finishedAt: new Date().toISOString(),
          error: toErrorMessage(error),
        });
      })
      .finally(() => {
        this.runtimePromises.delete(runtimeKey);
      });

    this.runtimePromises.set(runtimeKey, runPromise);
    return this.getExplanationRecord(billId, memberSlug, options);
  }

  async runBulkMissingExplanations(candidates) {
    await mapWithConcurrency(candidates, BULK_EXPLANATION_CONCURRENCY, async (candidate) => {
      const publicMemberSlug = getPublicMemberSlug(candidate.member);

      this.bulkStatus.current = {
        billId: String(candidate.law.billId),
        lawTitle: candidate.law.title,
        memberSlug: publicMemberSlug,
        memberName: candidate.member.name,
        partyName: candidate.member.partyName || "",
      };

      try {
        await this.startExplanation(candidate.law.billId, publicMemberSlug, {
          surpriseVoteItem: candidate.surpriseVoteItem,
        });

        const runtimeKey = buildRuntimeKey(candidate.law.billId, candidate.member.slug);
        const runtimePromise = this.runtimePromises.get(runtimeKey);

        if (runtimePromise) {
          await runtimePromise;
        }

        const finalRecord = await this.getExplanationRecord(candidate.law.billId, publicMemberSlug, {
          surpriseVoteItem: candidate.surpriseVoteItem,
        });
        const finalStatus = finalRecord?.status?.status || "failed";

        if (finalStatus === "completed") {
          this.bulkStatus.generatedExplanations += 1;
          return;
        }

        if (finalStatus === "not_surprising") {
          this.bulkStatus.skippedVotes += 1;
          return;
        }

        this.bulkStatus.failedVotes += 1;
        this.bulkStatus.recentErrors = [
          `${candidate.law.title} · ${candidate.member.name}: ${
            finalRecord?.status?.error || "The explanation did not finish successfully."
          }`,
          ...this.bulkStatus.recentErrors,
        ].slice(0, 10);
      } catch (error) {
        const message = toErrorMessage(error);

        if (message.includes("not currently marked as a surprising vote")) {
          this.bulkStatus.skippedVotes += 1;
        } else {
          this.bulkStatus.failedVotes += 1;
          this.bulkStatus.recentErrors = [
            `${candidate.law.title} · ${candidate.member.name}: ${message}`,
            ...this.bulkStatus.recentErrors,
          ].slice(0, 10);
        }
      } finally {
        this.bulkStatus.processedVotes += 1;
      }
    });

    this.bulkStatus.status = this.bulkStatus.failedVotes > 0 ? "completed_with_errors" : "completed";
    this.bulkStatus.finishedAt = new Date().toISOString();
    this.bulkStatus.lastCompletedAt = this.bulkStatus.finishedAt;
    this.bulkStatus.current = null;
  }

  async runExplanation(context, force) {
    const runtimeKey = buildRuntimeKey(context.law.billId, context.member.slug);
    const utteranceManifest = await this.memberProtocolService.ensureMemberUtteranceFileReady(
      context.member.slug,
      MEMBER_SOURCE_TYPE,
    );
    const fullContext = await this.buildFullContext(
      context.law.billId,
      context.member.slug,
      context.surpriseVoteItem,
      utteranceManifest,
    );

    if (!fullContext?.surpriseVoteItem) {
      throw new Error("This vote is no longer marked as surprising.");
    }

    const existingManifest = await this.readManifest(fullContext.law, fullContext.member);
    const sourceSignature = buildSourceSignature(fullContext);

    if (!force && existingManifest && !this.isManifestStale(existingManifest, sourceSignature)) {
      this.runtimeStatuses.set(
        runtimeKey,
        this.buildCompletedStatus(fullContext.law, fullContext.member, existingManifest, false),
      );
      return existingManifest;
    }

    const runtimeStatus = this.runtimeStatuses.get(runtimeKey);

    if (runtimeStatus) {
      runtimeStatus.currentStage = "reading_member_quotes";
    }

    const memberFileText = await fs.readFile(utteranceManifest.filePath, "utf8");

    if (runtimeStatus) {
      runtimeStatus.currentStage = "analyzing";
    }

    const explanation = await this.executeAnalysisRequest(fullContext, memberFileText);
    const generatedAt = new Date().toISOString();
    const manifest = {
      version: EXPLANATION_VERSION,
      billId: String(fullContext.law.billId),
      lawTitle: fullContext.law.title,
      memberSlug: fullContext.member.slug,
      memberName: fullContext.member.name,
      partyName: fullContext.member.partyName,
      sourceType: MEMBER_SOURCE_TYPE,
      sourceLabel: "קובץ קטן",
      generatedAt,
      startedAt: runtimeStatus?.startedAt || new Date().toISOString(),
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model || "unknown",
      sourceSignature,
      markdownPath: this.getMarkdownPath(fullContext.law, fullContext.member),
      explanation,
    };

    await writeTextFile(
      manifest.markdownPath,
      formatExplanationMarkdown(fullContext, manifest),
    );
    await writeJson(this.getJsonPath(fullContext.law, fullContext.member), manifest);
    this.promotionService?.requestPromotion("lawSurpriseExplanations");

    this.runtimeStatuses.set(
      runtimeKey,
      this.buildCompletedStatus(fullContext.law, fullContext.member, manifest, false),
    );

    return manifest;
  }

  async executeAnalysisRequest(context, memberFileText) {
    const created = await this.analysisClient.createStructuredResponse({
      instructions: buildInstructions(),
      input: buildInput(context, memberFileText),
      schema: EXPLANATION_SCHEMA,
      name: "surprising_vote_explanation",
      metadata: {
        bill_id: String(context.law.billId),
        member_slug: context.member.slug,
      },
      background: true,
      store: true,
    });
    const completed = await this.analysisClient.waitForResponse(created.id, {
      pollIntervalMs: 5000,
      maxWaitMs: 20 * 60 * 1000,
    });

    return this.analysisClient.extractStructuredOutput(completed);
  }
}

module.exports = {
  buildInstructions,
  LawSurpriseExplanationService,
};
