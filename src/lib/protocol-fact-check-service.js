const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const {
  ensureDirectory,
  fileExists,
  readJson,
  toErrorMessage,
  writeJson,
} = require("./utils");

const FACT_CHECK_VERSION = 2;
const MAX_CLAIMS_PER_PROTOCOL = Number(process.env.FACT_CHECK_MAX_CLAIMS_PER_PROTOCOL) || 30;
const MAX_CANDIDATE_SEGMENTS = Number(process.env.FACT_CHECK_MAX_CANDIDATE_SEGMENTS) || 48;
const EXTRACTION_BATCH_SIZE = Number(process.env.FACT_CHECK_EXTRACTION_BATCH_SIZE) || 12;
const EXTRACTION_MIN_SEGMENT_WORDS = Number(process.env.FACT_CHECK_MIN_SEGMENT_WORDS) || 10;
const CLAIM_CACHE_TTL_DAYS = Number(process.env.FACT_CHECK_CACHE_TTL_DAYS) || 30;

const CLAIM_TYPES = [
  "count",
  "percentage",
  "money",
  "date",
  "ranking",
  "institutional",
  "historical",
  "other_concrete",
];

const VERDICTS = [
  "supported",
  "contradicted",
  "mixed_or_needs_context",
  "outdated",
  "unverifiable",
];

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "segmentId",
          "claimText",
          "claimSummary",
          "normalizedClaim",
          "claimType",
          "numericValueText",
          "unit",
          "referenceDateText",
          "extractionConfidence",
          "whyCheckable",
        ],
        properties: {
          segmentId: { type: "string" },
          claimText: { type: "string" },
          claimSummary: { type: "string" },
          normalizedClaim: { type: "string" },
          claimType: { type: "string", enum: CLAIM_TYPES },
          numericValueText: { type: "string" },
          unit: { type: "string" },
          referenceDateText: { type: "string" },
          extractionConfidence: { type: "integer", minimum: 0, maximum: 100 },
          whyCheckable: { type: "string" },
        },
      },
    },
  },
};

const FACT_CHECK_SOURCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "url", "sourceType", "note"],
  properties: {
    title: { type: "string" },
    url: { type: "string" },
    sourceType: { type: "string" },
    note: { type: "string" },
  },
};

const VERIFICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "verdict",
    "shortRuling",
    "analysisBullets",
    "confidence",
    "timeSensitive",
    "searchQueries",
    "sources",
  ],
  properties: {
    verdict: { type: "string", enum: VERDICTS },
    shortRuling: { type: "string" },
    analysisBullets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "sources"],
        properties: {
          text: { type: "string" },
          sources: {
            type: "array",
            items: FACT_CHECK_SOURCE_SCHEMA,
          },
        },
      },
    },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    timeSensitive: { type: "boolean" },
    searchQueries: { type: "array", items: { type: "string" } },
    sources: {
      type: "array",
      items: FACT_CHECK_SOURCE_SCHEMA,
    },
  },
};

const NUMERIC_TERMS = [
  "אחוז",
  "אחוזים",
  "שיעור",
  "מיליון",
  "מיליארד",
  "אלף",
  "שח",
  'ש"ח',
  "שקל",
  "שקלים",
  "דולר",
  "אירו",
  "תקציב",
  "מספר",
  "דירוג",
  "מקום",
  "חודש",
  "שנה",
  "יום",
  "אינפלציה",
  "אבטלה",
  "עוני",
  "שכר",
];

const NON_DATE_NUMERIC_TERMS = NUMERIC_TERMS.filter(
  (term) => !["חודש", "שנה", "יום"].includes(term),
);

const DATE_MONTH_TERMS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

const INSTITUTIONAL_TERMS = [
  "לשכה מרכזית לסטטיסטיקה",
  "בנק ישראל",
  "ביטוח לאומי",
  "הממשלה",
  "הכנסת",
  "החוק",
  "סעיף",
  "תקנה",
  "החלטת ממשלה",
  "בית המשפט",
  'בג"ץ',
  "בגץ",
  "המשטרה",
];

const PREDICTION_TERMS = [
  "צריך",
  "צריכה",
  "חייב",
  "חייבת",
  "אמור",
  "אמורה",
  "בעתיד",
  "יהיה",
  "תהיה",
  "יהיו",
  "עלול",
  "עשוי",
];

const OPINION_TERMS = [
  "אני חושב",
  "אני חושבת",
  "אני מאמין",
  "אני מאמינה",
  "אני סבור",
  "אני סבורה",
  "לדעתי",
  "בעיניי",
];

const KNESSET_HAPPENING_TERMS = [
  "בכנסת",
  "במליאת הכנסת",
  "בוועדה",
  "בישיבה",
  "בדיון",
  "בהצבעה",
  "ההצבעה",
  "נכחו",
  "השתתפו",
  "דיברו בדיון",
  "נאמרו בדיון",
  "אושר במליאה",
  "אושרה במליאה",
  "נפל במליאה",
  "עבר בקריאה",
  "עברה בקריאה",
  "קריאה ראשונה",
  "קריאה שנייה",
  "קריאה שלישית",
  "מספר ההצבעות",
  "חברי הכנסת",
  "אופוזיציה",
  "קואליציה",
];

const LAW_RELATED_TERMS = [
  "חוק",
  "החוק",
  "הצעת חוק",
  "תזכיר חוק",
  "סעיף",
  "תיקון חוק",
  "קריאה ראשונה",
  "קריאה שנייה",
  "קריאה שלישית",
  "רשום",
  "תקנה",
  "צו",
  "מציע החוק",
  "הצעה לסדר היום",
];

const OFFICIAL_DOMAINS = {
  percentage: ["cbs.gov.il", "gov.il", "boi.org.il", "btl.gov.il", "knesset.gov.il"],
  count: ["cbs.gov.il", "gov.il", "knesset.gov.il", "btl.gov.il", "boi.org.il"],
  money: ["gov.il", "boi.org.il", "cbs.gov.il", "mof.gov.il", "knesset.gov.il"],
  date: ["knesset.gov.il", "gov.il", "justice.gov.il", "court.gov.il"],
  ranking: ["oecd.org", "worldbank.org", "imf.org", "cbs.gov.il", "gov.il"],
  institutional: ["knesset.gov.il", "gov.il", "justice.gov.il", "court.gov.il"],
  historical: ["knesset.gov.il", "gov.il", "cbs.gov.il", "archives.gov.il"],
  other_concrete: ["gov.il", "knesset.gov.il", "cbs.gov.il", "boi.org.il"],
};

const REPUTABLE_FALLBACK_DOMAINS = [
  "globes.co.il",
  "themarker.com",
  "calcalist.co.il",
  "ynet.co.il",
  "haaretz.co.il",
  "timesofisrael.com",
  "n12.co.il",
  "oecd.org",
  "worldbank.org",
  "imf.org",
  "un.org",
];

function buildProtocolKey(source, documentId) {
  return `${source}:${documentId}`;
}

function createProtocolSummary(source, protocol) {
  return {
    source,
    documentId: String(protocol.documentId),
    title: protocol.title || protocol.committeeName || protocol.shortDateLabel || "",
    shortDateLabel: protocol.shortDateLabel || "",
    longDateLabel: protocol.longDateLabel || protocol.shortDateLabel || "",
    dateSortValue: Number(protocol.dateSortValue) || 0,
    protocolUrl:
      source === "committee"
        ? `/committee-protocol/${encodeURIComponent(protocol.documentId)}`
        : `/protocol/${encodeURIComponent(protocol.documentId)}`,
    sourceLabel: source === "committee" ? "ועדה" : "מליאה",
    committeeName: protocol.committeeName || "",
    committeeTypeDescription: protocol.committeeTypeDescription || "",
    sessionNumber: protocol.sessionNumber ?? null,
  };
}

function normalizeHebrewText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/["'׳״`]/g, "")
    .replace(/[–—―‐-]/g, " ")
    .replace(/[^\p{L}\p{N}\s%₪$€/.:,]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function countWords(value) {
  const normalized = normalizeHebrewText(value);
  return normalized ? normalized.split(" ").filter(Boolean).length : 0;
}

function trimText(value, maxLength = 420) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function splitIntoSentences(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split(/(?<=[.!?…]|[;:])\s+|\n+/u)
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function buildSentenceWindows(text) {
  const sentences = splitIntoSentences(text);
  const windows = [];
  const seen = new Set();

  const addWindow = (candidate) => {
    const cleaned = candidate.replace(/\s+/g, " ").trim();

    if (!cleaned || seen.has(cleaned) || countWords(cleaned) < EXTRACTION_MIN_SEGMENT_WORDS) {
      return;
    }

    seen.add(cleaned);
    windows.push(cleaned);
  };

  for (let index = 0; index < sentences.length; index += 1) {
    addWindow(sentences[index]);

    if (index + 1 < sentences.length) {
      addWindow(`${sentences[index]} ${sentences[index + 1]}`);
    }
  }

  addWindow(text);
  return windows;
}

function inferClaimType(text) {
  const normalized = normalizeHebrewText(text);

  if (/%|אחוז/u.test(text) || normalized.includes("אחוז")) {
    return "percentage";
  }

  if (/₪|ש"ח|שח|דולר|אירו|מיליון|מיליארד/u.test(text) || normalized.includes("תקציב")) {
    return "money";
  }

  if (normalized.includes("מקום") || normalized.includes("דירוג")) {
    return "ranking";
  }

  if (INSTITUTIONAL_TERMS.some((term) => normalized.includes(normalizeHebrewText(term)))) {
    return "institutional";
  }

  if (/(בתקופת|בשנת|מאז|היסטורית|מיום)/u.test(normalized)) {
    return "historical";
  }

  if (hasDateLikeSignal(text) && !hasQualifyingNumericDataSignal(text)) {
    return "date";
  }

  return /\d/u.test(text) ? "count" : "other_concrete";
}

function inferNumericValueText(text) {
  const match = String(text || "").match(/-?\d[\d,.]*/u);
  return match ? match[0] : "";
}

function hasNumericDataSignal(text) {
  const normalized = normalizeHebrewText(text);

  return (
    /\d/u.test(text) ||
    /%|אחוז/u.test(text) ||
    NUMERIC_TERMS.some((term) => normalized.includes(normalizeHebrewText(term)))
  );
}

function hasDateLikeSignal(text) {
  const normalized = normalizeHebrewText(text);

  return (
    /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/u.test(text) ||
    /\b(?:19|20)\d{2}\b/u.test(text) ||
    DATE_MONTH_TERMS.some((term) => normalized.includes(normalizeHebrewText(term)))
  );
}

function stripDateLikeContent(text) {
  const monthPattern = DATE_MONTH_TERMS.join("|");

  return String(text || "")
    .replace(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/gu, " ")
    .replace(new RegExp(`\\b\\d{1,2}\\s*ב?(?:${monthPattern})(?:\\s+(?:19|20)\\d{2})?\\b`, "gu"), " ")
    .replace(new RegExp(`\\b(?:${monthPattern})\\s+(?:19|20)\\d{2}\\b`, "gu"), " ")
    .replace(/\b(?:19|20)\d{2}\b/gu, " ");
}

function hasQualifyingNumericDataSignal(text) {
  const normalized = normalizeHebrewText(text);

  if (/%|אחוז/u.test(text) || normalized.includes("אחוז")) {
    return true;
  }

  if (
    NON_DATE_NUMERIC_TERMS.some((term) =>
      normalized.includes(normalizeHebrewText(term)),
    )
  ) {
    return true;
  }

  return /\d/u.test(stripDateLikeContent(text));
}

function inferUnitText(text) {
  const normalized = normalizeHebrewText(text);

  if (/%|אחוז/u.test(text) || normalized.includes("אחוז")) {
    return "percent";
  }

  if (/₪|ש"ח|שח/u.test(text) || normalized.includes("שקל") || normalized.includes("שקלים")) {
    return "ils";
  }

  if (normalized.includes("דולר")) {
    return "usd";
  }

  if (normalized.includes("אירו")) {
    return "eur";
  }

  if (normalized.includes("מיליון")) {
    return "million";
  }

  if (normalized.includes("מיליארד")) {
    return "billion";
  }

  return "";
}

function extractSourceCue(text) {
  const sourcePatterns = [
    /(?:לפי|על פי|על-פי|מנתוני|על בסיס נתוני)\s+([^,.:\n]{3,90})/u,
    /(?:בדוח של|בדו["״]?ח של|בדוח)\s+([^,.:\n]{3,90})/u,
    /(?:לשכת|הלשכה המרכזית לסטטיסטיקה|האוצר|בנק ישראל|ביטוח לאומי|משרד הבריאות|משרד האוצר|משרד החינוך)/u,
  ];

  for (const pattern of sourcePatterns) {
    const match = String(text || "").match(pattern);

    if (!match) {
      continue;
    }

    const value = match[1] || match[0];
    const cleaned = String(value || "").replace(/\s+/g, " ").trim();

    if (cleaned) {
      return trimText(cleaned, 90);
    }
  }

  return "";
}

function buildDeterministicClaimSummary(segment, extractedClaim, claimText) {
  const actor = trimText(segment.memberName || "", 80);
  const candidateSentences = splitIntoSentences(claimText || segment.segmentText || "");
  const compactSentence =
    candidateSentences.find((sentence) => hasQualifyingNumericDataSignal(sentence)) ||
    candidateSentences[0] ||
    claimText ||
    segment.segmentText ||
    "";
  const claimBody = trimText(compactSentence, 140);
  const referenceDateText = String(extractedClaim.referenceDateText || "").trim();
  const sourceCue = extractSourceCue(segment.segmentText || segment.utteranceText || "");
  const parts = [];

  if (claimBody) {
    parts.push(claimBody);
  }

  if (referenceDateText) {
    parts.push(`מועד שמוזכר: ${referenceDateText}`);
  }

  if (sourceCue) {
    parts.push(`מקור מצוטט: ${sourceCue}`);
  }

  if (!parts.length && actor) {
    return `${actor} הציג טענה מספרית מתוך הפרוטוקול.`;
  }

  return trimText(parts.join(". "), 240);
}

function candidateScore(text) {
  const normalized = normalizeHebrewText(text);
  let score = 0;

  if (/\d/u.test(text)) {
    score += 3;
  }

  if (NUMERIC_TERMS.some((term) => normalized.includes(normalizeHebrewText(term)))) {
    score += 2;
  }

  if (INSTITUTIONAL_TERMS.some((term) => normalized.includes(normalizeHebrewText(term)))) {
    score += 1.5;
  }

  if (/(לפי|על פי|עומד על|הוא|היא|הם|נמצא|הגיע ל|ירד ל|עלה ל)/u.test(normalized)) {
    score += 1.2;
  }

  if (String(text).includes("?")) {
    score -= 2;
  }

  if (PREDICTION_TERMS.some((term) => normalized.includes(normalizeHebrewText(term)))) {
    score -= 1.2;
  }

  if (OPINION_TERMS.some((term) => normalized.includes(normalizeHebrewText(term)))) {
    score -= 1.5;
  }

  if (countWords(text) > 90) {
    score -= 0.8;
  }

  return score;
}

function containsExcludedTopic(text) {
  const normalized = normalizeHebrewText(text);
  return (
    KNESSET_HAPPENING_TERMS.some((term) =>
      normalized.includes(normalizeHebrewText(term)),
    ) ||
    LAW_RELATED_TERMS.some((term) => normalized.includes(normalizeHebrewText(term)))
  );
}

function isPotentialClaimSegment(text) {
  const normalized = normalizeHebrewText(text);

  if (!normalized || candidateScore(text) < 2.4) {
    return false;
  }

  if (!hasQualifyingNumericDataSignal(text)) {
    return false;
  }

  if (containsExcludedTopic(text)) {
    return false;
  }

  if (String(text).includes("?") && !/\d/u.test(text)) {
    return false;
  }

  return true;
}

function normalizeClaimText(value) {
  return normalizeHebrewText(value)
    .replace(/\b(הוא|היא|הם|הן|יש|אין|לפי|על פי)\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLegacyGeminiMimeTypeError(errorMessage) {
  const normalized = String(errorMessage || "").toLowerCase();

  return (
    normalized.includes("tool use with a response mime type") &&
    normalized.includes("application/json") &&
    normalized.includes("unsupported")
  );
}

function buildClaimFingerprint(normalizedClaim, claimType, referenceDateText) {
  const dateBucket = referenceDateText ? String(referenceDateText).slice(0, 10) : "no-date";
  return crypto
    .createHash("sha1")
    .update(`${normalizeClaimText(normalizedClaim)}|${claimType}|${dateBucket}`)
    .digest("hex");
}

function buildClaimId(protocolKey, memberSlug, claimText, index) {
  const hash = crypto
    .createHash("sha1")
    .update(`${protocolKey}|${memberSlug}|${claimText}|${index}`)
    .digest("hex")
    .slice(0, 12);

  return `${protocolKey}:${memberSlug}:${hash}`;
}

function buildClaimSelectionScore(claim, segment) {
  let score = Math.max(0, Number(claim.extractionConfidence) || 0);
  score += Number(segment?.segmentScore || 0) * 12;

  if (claim.numericValueText) {
    score += 6;
  }

  if (["percentage", "money", "count", "ranking"].includes(claim.claimType)) {
    score += 4;
  }

  score -= Math.min(8, countWords(claim.claimText || "") * 0.04);
  return score;
}

function compareSelectedClaims(left, right) {
  return (
    (right.selectionScore || 0) - (left.selectionScore || 0) ||
    (right.extractionConfidence || 0) - (left.extractionConfidence || 0) ||
    (right.rawQuoteWordCount || 0) - (left.rawQuoteWordCount || 0)
  );
}

function getCacheTtlDays(claimType) {
  return claimType === "historical" || claimType === "institutional"
    ? 180
    : CLAIM_CACHE_TTL_DAYS;
}

function buildAllowedDomains(claimType) {
  return [...new Set([...(OFFICIAL_DOMAINS[claimType] || []), ...REPUTABLE_FALLBACK_DOMAINS])];
}

function summarizeProtocolFactCheck(record) {
  const summary = {
    status: record.status || "completed",
    claimCount: Array.isArray(record.claims) ? record.claims.length : 0,
    verifiedCount: 0,
    pendingCount: 0,
    verdictCounts: {
      supported: 0,
      contradicted: 0,
      mixed_or_needs_context: 0,
      outdated: 0,
      unverifiable: 0,
    },
    updatedAt: record.updatedAt || record.processedAt || null,
  };

  for (const claim of record.claims || []) {
    if (claim.verificationStatus === "completed" && claim.verification?.verdict) {
      summary.verifiedCount += 1;
      summary.verdictCounts[claim.verification.verdict] =
        (summary.verdictCounts[claim.verification.verdict] || 0) + 1;
    } else {
      summary.pendingCount += 1;
    }
  }

  return summary;
}

class ProtocolFactCheckService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname, "..", "..");
    this.dataDir = path.join(this.rootDir, "data");
    this.factCheckDir = path.join(this.dataDir, "fact-checks");
    this.protocolRecordsDir = path.join(this.factCheckDir, "protocols");
    this.manifestPath = path.join(this.factCheckDir, "manifest.json");
    this.protocolStore = options.protocolStore;
    this.committeeProtocolStore = options.committeeProtocolStore;
    this.memberProtocolService = options.memberProtocolService;
    this.extractionClient = options.extractionClient;
    this.verificationClient = options.verificationClient;
    this.initialized = false;
    this.processingPromise = null;
    this.manifest = this.createEmptyManifest();
  }

  createEmptyManifest() {
    return {
      version: FACT_CHECK_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      pendingProtocols: [],
      protocols: {},
      verificationCache: {},
      queueStatus: {
        status: "idle",
        startedAt: null,
        finishedAt: null,
        totalProtocols: 0,
        processedProtocols: 0,
        current: null,
        recentErrors: [],
        lastCompletedAt: null,
      },
    };
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    await Promise.all([ensureDirectory(this.factCheckDir), ensureDirectory(this.protocolRecordsDir)]);

    if (await fileExists(this.manifestPath)) {
      try {
        const parsed = await readJson(this.manifestPath);

        if (parsed && parsed.version === FACT_CHECK_VERSION) {
          this.manifest = {
            ...this.createEmptyManifest(),
            ...parsed,
            pendingProtocols: Array.isArray(parsed.pendingProtocols) ? parsed.pendingProtocols : [],
            protocols: typeof parsed.protocols === "object" && parsed.protocols ? parsed.protocols : {},
            verificationCache:
              typeof parsed.verificationCache === "object" && parsed.verificationCache
                ? parsed.verificationCache
                : {},
            queueStatus: {
              ...this.createEmptyManifest().queueStatus,
              ...(parsed.queueStatus || {}),
            },
          };
        }
      } catch {
        this.manifest = this.createEmptyManifest();
      }
    }

    if (this.manifest.queueStatus.status === "running") {
      this.manifest.queueStatus.status = "idle";
      this.manifest.queueStatus.current = null;
      this.manifest.queueStatus.finishedAt = new Date().toISOString();
    }

    this.initialized = true;
    await this.persistManifest();
  }

  async persistManifest() {
    this.manifest.updatedAt = new Date().toISOString();
    await writeJson(this.manifestPath, this.manifest);
  }

  getProviderStatus() {
    return {
      extraction: this.extractionClient?.getConfiguration
        ? this.extractionClient.getConfiguration()
        : {
            configured: Boolean(this.extractionClient?.isConfigured?.()),
            provider: "unknown",
            model: null,
          },
      verification: this.verificationClient?.getConfiguration
        ? this.verificationClient.getConfiguration()
        : {
            configured: Boolean(this.verificationClient?.isConfigured?.()),
            provider: "unknown",
            model: null,
          },
    };
  }

  getStatus() {
    return {
      ...this.manifest.queueStatus,
      pendingProtocols: this.manifest.pendingProtocols.length,
      providerStatus: this.getProviderStatus(),
    };
  }

  buildProtocolRecordPath(source, documentId) {
    return path.join(this.protocolRecordsDir, `${source}__${documentId}.json`);
  }

  async readProtocolRecord(source, documentId) {
    const recordPath = this.buildProtocolRecordPath(source, documentId);

    if (!(await fileExists(recordPath))) {
      return null;
    }

    const record = await readJson(recordPath);
    const normalizedRecord = this.normalizeLegacyVerificationFailures(record);

    if (normalizedRecord.__changed) {
      delete normalizedRecord.__changed;
      await writeJson(recordPath, normalizedRecord);
      const protocolKey = buildProtocolKey(source, documentId);

      if (this.manifest.protocols[protocolKey]) {
        this.manifest.protocols[protocolKey] = {
          ...this.manifest.protocols[protocolKey],
          status: normalizedRecord.status,
          updatedAt: normalizedRecord.updatedAt || this.manifest.protocols[protocolKey].updatedAt,
          summary: summarizeProtocolFactCheck(normalizedRecord),
        };
        await this.persistManifest();
      }
    }

    return normalizedRecord;
  }

  normalizeLegacyVerificationFailures(record) {
    if (!record || !Array.isArray(record.claims)) {
      return record;
    }

    let changed = false;
    const claims = record.claims.map((claim) => {
      if (
        claim?.verificationStatus === "failed" &&
        isLegacyGeminiMimeTypeError(claim?.verificationError)
      ) {
        changed = true;
        return {
          ...claim,
          verificationStatus: "not_started",
          verification: null,
          verificationError: null,
          updatedAt: new Date().toISOString(),
        };
      }

      return claim;
    });

    if (!changed) {
      return record;
    }

    return {
      ...record,
      claims,
      status: this.deriveRecordStatus({
        ...record,
        claims,
      }),
      updatedAt: new Date().toISOString(),
      __changed: true,
    };
  }

  async writeProtocolRecord(source, documentId, record) {
    const protocolKey = buildProtocolKey(source, documentId);
    const recordPath = this.buildProtocolRecordPath(source, documentId);

    await writeJson(recordPath, record);

    this.manifest.protocols[protocolKey] = {
      protocol: record.protocol,
      status: record.status,
      processedAt: record.processedAt || null,
      updatedAt: record.updatedAt || record.processedAt || null,
      filePath: recordPath,
      summary: summarizeProtocolFactCheck(record),
    };
    await this.persistManifest();
  }

  async deleteProtocolRecord(source, documentId) {
    const protocolKey = buildProtocolKey(source, documentId);
    const recordPath = this.buildProtocolRecordPath(source, documentId);

    if (await fileExists(recordPath)) {
      await fs.unlink(recordPath).catch(() => {});
    }

    delete this.manifest.protocols[protocolKey];
    await this.persistManifest();
  }

  async getProtocolFactChecks(source, documentId) {
    await this.initialize();
    const protocolKey = buildProtocolKey(source, documentId);
    const record = await this.readProtocolRecord(source, documentId);

    if (record) {
      return {
        status: record.status,
        protocol: record.protocol,
        processedAt: record.processedAt || null,
        updatedAt: record.updatedAt || record.processedAt || null,
        claims: record.claims || [],
        methodology: Array.isArray(record.methodology)
          ? record.methodology
          : this.getProtocolMethodology(),
        providerStatus: this.getProviderStatus(),
      };
    }

    return {
      status: this.manifest.pendingProtocols.some((item) => item.key === protocolKey)
        ? "queued"
        : "not_processed",
      protocol: null,
      processedAt: null,
      updatedAt: null,
      claims: [],
      methodology: this.getProtocolMethodology(),
      providerStatus: this.getProviderStatus(),
    };
  }

  async getRecentClaims(options = {}) {
    await this.initialize();
    const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200));
    const verdict = String(options.verdict || "").trim();
    const member = String(options.member || "").trim();
    const normalizedMemberSearch = normalizeHebrewText(member);
    const source = String(options.source || "").trim();
    const protocols = Object.values(this.manifest.protocols || [])
      .filter((entry) => entry?.filePath)
      .sort(
        (left, right) =>
          (right.protocol?.dateSortValue || 0) - (left.protocol?.dateSortValue || 0),
      )
      .slice(0, 80);

    const items = [];

    for (const entry of protocols) {
      const record = await readJson(entry.filePath).catch(() => null);

      if (!record) {
        continue;
      }

      for (const claim of record.claims || []) {
        if (verdict && claim.verification?.verdict !== verdict) {
          continue;
        }

        if (member) {
          const searchableMemberFields = [
            claim.memberSlug,
            claim.routeSlug,
            claim.memberName,
            claim.partyName,
          ]
            .map((value) => normalizeHebrewText(value))
            .filter(Boolean);

          if (
            !searchableMemberFields.some(
              (value) => value === normalizedMemberSearch || value.includes(normalizedMemberSearch),
            )
          ) {
            continue;
          }
        }

        if (source && record.protocol?.source !== source) {
          continue;
        }

        items.push({
          claimId: claim.claimId,
          protocol: record.protocol,
          memberSlug: claim.memberSlug,
          memberName: claim.memberName,
          routeSlug: claim.routeSlug,
          partyName: claim.partyName,
          claimText: claim.claimText,
          claimSummary: claim.claimSummary,
          normalizedClaim: claim.normalizedClaim,
          claimType: claim.claimType,
          rawQuote: claim.rawQuote,
          verificationStatus: claim.verificationStatus,
          verification: claim.verification || null,
          updatedAt:
            claim.verification?.checkedAt ||
            claim.updatedAt ||
            record.updatedAt ||
            record.processedAt ||
            null,
        });
      }
    }

    items.sort(
      (left, right) =>
        new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime(),
    );

    return {
      items: items.slice(0, limit),
      status: this.getStatus(),
    };
  }

  async getProtocolCatalog(options = {}) {
    await this.initialize();
    const sourceFilter = String(options.source || "").trim();
    const query = normalizeHebrewText(options.query || "");
    const yearFilter = Number(options.year) || null;
    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.max(10, Math.min(Number(options.pageSize) || 60, 200));
    const [plenumProtocols, committeeProtocols] = await Promise.all([
      sourceFilter === "committee" ? [] : this.protocolStore.getProtocols(),
      sourceFilter === "plenum" ? [] : this.committeeProtocolStore.getProtocols(),
    ]);

    const items = [
      ...plenumProtocols.map((protocol) => createProtocolSummary("plenum", protocol)),
      ...committeeProtocols.map((protocol) => createProtocolSummary("committee", protocol)),
    ]
      .filter((protocol) => {
        if (yearFilter) {
          const year = Number(String(protocol.dateSortValue || "").slice(0, 4));

          if (year !== yearFilter) {
            return false;
          }
        }

        if (!query) {
          return true;
        }

        const haystack = normalizeHebrewText([
          protocol.title,
          protocol.shortDateLabel,
          protocol.longDateLabel,
          protocol.committeeName,
          protocol.committeeTypeDescription,
          protocol.sessionNumber,
          protocol.documentId,
        ].join(" "));

        return haystack.includes(query);
      })
      .map((protocol) => {
        const protocolKey = buildProtocolKey(protocol.source, protocol.documentId);
        const manifestEntry = this.manifest.protocols[protocolKey];
        const isQueued = this.manifest.pendingProtocols.some((item) => item.key === protocolKey);

        return {
          ...protocol,
          factCheckSummary: manifestEntry?.summary || null,
          factCheckStatus: manifestEntry?.status || (isQueued ? "queued" : "not_processed"),
        };
      })
      .sort((left, right) => right.dateSortValue - left.dateSortValue);

    const startIndex = (page - 1) * pageSize;

    return {
      page,
      pageSize,
      total: items.length,
      items: items.slice(startIndex, startIndex + pageSize),
      status: this.getStatus(),
    };
  }

  async enqueueProtocols(protocols) {
    await this.initialize();
    const currentKeys = new Set(this.manifest.pendingProtocols.map((item) => item.key));
    let addedCount = 0;

    for (const protocol of protocols || []) {
      const key = buildProtocolKey(protocol.source, protocol.documentId);

      if (currentKeys.has(key) || this.manifest.protocols[key]?.status === "completed") {
        continue;
      }

      this.manifest.pendingProtocols.push({
        key,
        source: protocol.source,
        documentId: String(protocol.documentId),
      });
      currentKeys.add(key);
      addedCount += 1;
    }

    if (addedCount > 0) {
      await this.persistManifest();
    }

    if (this.manifest.pendingProtocols.length > 0) {
      void this.startProcessingNewProtocols();
    }

    return {
      queuedProtocols: this.manifest.pendingProtocols.length,
      addedCount,
      status: this.getStatus(),
    };
  }

  async startProcessingNewProtocols() {
    await this.initialize();

    if (this.processingPromise) {
      return this.getStatus();
    }

    if (!this.manifest.pendingProtocols.length) {
      this.manifest.queueStatus = {
        ...this.manifest.queueStatus,
        status: "completed",
        startedAt: null,
        finishedAt: new Date().toISOString(),
        totalProtocols: 0,
        processedProtocols: 0,
        current: null,
      };
      await this.persistManifest();
      return this.getStatus();
    }

    this.manifest.queueStatus = {
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      totalProtocols: this.manifest.pendingProtocols.length,
      processedProtocols: 0,
      current: null,
      recentErrors: [],
      lastCompletedAt: this.manifest.queueStatus.lastCompletedAt || null,
    };
    await this.persistManifest();

    this.processingPromise = this.runQueue().finally(() => {
      this.processingPromise = null;
    });

    return this.getStatus();
  }

  async runQueue() {
    while (this.manifest.pendingProtocols.length > 0) {
      const nextProtocol = this.manifest.pendingProtocols[0];
      this.manifest.queueStatus.current = {
        source: nextProtocol.source,
        documentId: nextProtocol.documentId,
      };
      await this.persistManifest();

      try {
        await this.extractProtocolClaims(nextProtocol.source, nextProtocol.documentId);
      } catch (error) {
        this.manifest.queueStatus.recentErrors = [
          `${nextProtocol.source}:${nextProtocol.documentId} - ${toErrorMessage(error)}`,
          ...this.manifest.queueStatus.recentErrors,
        ].slice(0, 10);
      } finally {
        this.manifest.pendingProtocols.shift();
        this.manifest.queueStatus.processedProtocols += 1;
        this.manifest.queueStatus.current = null;
        await this.persistManifest();
      }
    }

    this.manifest.queueStatus.status =
      this.manifest.queueStatus.recentErrors.length > 0 ? "completed_with_errors" : "completed";
    this.manifest.queueStatus.finishedAt = new Date().toISOString();
    this.manifest.queueStatus.lastCompletedAt = this.manifest.queueStatus.finishedAt;
    await this.persistManifest();
  }

  async resolveProtocol(source, documentId) {
    const store = source === "committee" ? this.committeeProtocolStore : this.protocolStore;
    const protocol = await store.getProtocolById(documentId);

    if (!protocol) {
      throw new Error(`Protocol ${source}:${documentId} was not found`);
    }

    const content = await store.getProtocolContent(documentId);

    if (!content || !Array.isArray(content.paragraphs)) {
      throw new Error(`Protocol ${source}:${documentId} has no readable content`);
    }

    return {
      protocol,
      content,
      protocolSummary: createProtocolSummary(source, protocol),
    };
  }

  getProtocolMethodology() {
    return [
      "Only MK-attributed speaker turns are processed.",
      "Version 1 extracts only factual claims that include explicit quantitative data such as counts, percentages, money amounts, rates, or rankings.",
      "Dates alone are not enough. A statement that only gives a date is excluded from the final table.",
      "Only one final claim per MK is kept in each protocol; if several claims qualify, the strongest one is selected.",
      "Claims about Knesset proceedings, votes, laws, and law proposals are excluded.",
      "Duplicate claims within the same protocol are collapsed into a single entry.",
      "Hard-coded prefilters reduce candidate segments before any model call.",
      "Verification prefers official or primary sources and treats time-sensitive claims in relation to the protocol date.",
    ];
  }

  buildCandidateSegments(attributedUtterances) {
    const seen = new Set();
    const segments = [];

    for (const utterance of attributedUtterances || []) {
      const windows = buildSentenceWindows(utterance.text);
      const localSegments = [];

      for (const windowText of windows) {
        if (!isPotentialClaimSegment(windowText)) {
          continue;
        }

        const normalizedWindow = normalizeClaimText(windowText);

        if (!normalizedWindow) {
          continue;
        }

        const dedupeKey = `${utterance.memberSlug}|${normalizedWindow}`;

        if (seen.has(dedupeKey)) {
          continue;
        }

        seen.add(dedupeKey);
        localSegments.push({
          memberSlug: utterance.memberSlug,
          routeSlug: utterance.routeSlug,
          memberName: utterance.memberName,
          partyName: utterance.partyName,
          alias: utterance.alias,
          speakerLabel: utterance.speakerLabel,
          utteranceText: utterance.text,
          utteranceWordCount: utterance.wordCount,
          segmentText: windowText.replace(/\s+/g, " ").trim(),
          segmentScore: candidateScore(windowText),
        });
      }

      localSegments.sort(
        (left, right) =>
          right.segmentScore - left.segmentScore ||
          right.segmentText.length - left.segmentText.length,
      );
      segments.push(...localSegments.slice(0, 3));
    }

    return segments
      .sort(
        (left, right) =>
          right.segmentScore - left.segmentScore ||
          right.utteranceWordCount - left.utteranceWordCount,
      )
      .slice(0, MAX_CANDIDATE_SEGMENTS)
      .map((segment, index) => ({
        ...segment,
        segmentId: `segment-${index + 1}`,
      }));
  }

  buildExtractionInstructions(protocolSummary) {
    return [
      "Extract only factual claims that are concrete, verifiable, and explicitly contain data.",
      "A valid claim must include concrete quantitative data such as counts, percentages, money amounts, rates, rankings, or another clear numeric datum.",
      "Dates alone are not enough. If a statement only tells when something happened, do not extract it.",
      "Do not extract claims about what happened in the Knesset, in the plenum, in committees, during the meeting, or during any vote.",
      "Do not extract claims about laws, law proposals, bill readings, legal sections, or legal text.",
      "Do not extract opinions, predictions, insults, demands, vague accusations, rhetorical flourishes, or sarcasm.",
      "Do not return duplicates. If the same claim appears more than once in this protocol, return it only once.",
      "Only one final claim per MK should survive in the protocol. If the same MK makes several eligible claims, prefer the strongest and most checkable one.",
      "For each extracted claim, also write a concise Hebrew summary of the claim.",
      "The summary must clearly state the core claim and, when available in the text, include who performed the described act, when it happened, and which source or dataset the speaker cites.",
      "Keep the summary short, factual, and easy to scan. Do not add details that are not grounded in the segment or the surrounding utterance context.",
      `Protocol context: ${protocolSummary.sourceLabel} | ${protocolSummary.longDateLabel || protocolSummary.shortDateLabel || ""} | ${protocolSummary.title || ""}`,
    ].join("\n");
  }

  buildExtractionInput(protocolSummary, segments) {
    return {
      protocol: {
        source: protocolSummary.source,
        sourceLabel: protocolSummary.sourceLabel,
        title: protocolSummary.title,
        date: protocolSummary.longDateLabel || protocolSummary.shortDateLabel || "",
        committeeName: protocolSummary.committeeName || "",
        sessionNumber: protocolSummary.sessionNumber ?? null,
      },
      segments: segments.map((segment) => ({
        segmentId: segment.segmentId,
        memberName: segment.memberName,
        partyName: segment.partyName,
        speakerLabel: segment.speakerLabel,
        text: segment.segmentText,
        utteranceContext: trimText(segment.utteranceText, 1400),
      })),
    };
  }

  buildDeterministicExtractionClaims(segments) {
    return segments.map((segment) => ({
      segmentId: segment.segmentId,
      claimText: segment.segmentText,
      claimSummary: buildDeterministicClaimSummary(segment, {}, segment.segmentText),
      normalizedClaim: normalizeClaimText(segment.segmentText),
      claimType: inferClaimType(segment.segmentText),
      numericValueText: inferNumericValueText(segment.segmentText),
      unit: inferUnitText(segment.segmentText),
      referenceDateText: "",
      extractionConfidence: Math.max(55, Math.min(92, Math.round(58 + segment.segmentScore * 7))),
      whyCheckable:
        "Contains a concrete numeric or institutional claim selected by hard-coded prefilters.",
    }));
  }

  async extractClaimsFromSegments(segments, protocolSummary) {
    if (!segments.length) {
      return [];
    }

    if (!this.extractionClient?.isConfigured?.()) {
      return this.buildDeterministicExtractionClaims(segments);
    }

    const extractedClaims = [];

    for (let startIndex = 0; startIndex < segments.length; startIndex += EXTRACTION_BATCH_SIZE) {
      const batch = segments.slice(startIndex, startIndex + EXTRACTION_BATCH_SIZE);

      try {
        const responseHandle = await this.extractionClient.createStructuredResponse({
          instructions: this.buildExtractionInstructions(protocolSummary),
          input: this.buildExtractionInput(protocolSummary, batch),
          schema: EXTRACTION_SCHEMA,
        });
        const response = await this.extractionClient.waitForResponse(responseHandle.id);
        const output = this.extractionClient.extractStructuredOutput(response);

        if (Array.isArray(output?.claims)) {
          extractedClaims.push(...output.claims);
        }
      } catch {
        extractedClaims.push(...this.buildDeterministicExtractionClaims(batch));
      }
    }

    return extractedClaims.length > 0
      ? extractedClaims
      : this.buildDeterministicExtractionClaims(segments);
  }

  materializeClaims(protocolKey, segments, extractedClaims) {
    const segmentById = new Map(segments.map((segment) => [segment.segmentId, segment]));
    const seen = new Set();
    const claimsByMember = new Map();

    for (const extractedClaim of extractedClaims || []) {
      const segment = segmentById.get(extractedClaim?.segmentId);

      if (!segment) {
        continue;
      }

      const claimText = trimText(extractedClaim.claimText || segment.segmentText, 520);
      const claimSummary = trimText(
        extractedClaim.claimSummary ||
          buildDeterministicClaimSummary(segment, extractedClaim, claimText),
        240,
      );
      const normalizedClaim = normalizeClaimText(
        extractedClaim.normalizedClaim || extractedClaim.claimText || segment.segmentText,
      );

      if (!normalizedClaim) {
        continue;
      }

      const claimType = CLAIM_TYPES.includes(extractedClaim.claimType)
        ? extractedClaim.claimType
        : inferClaimType(claimText);
      const numericValueText = String(
        extractedClaim.numericValueText || inferNumericValueText(claimText) || "",
      ).trim();
      const unit = String(extractedClaim.unit || inferUnitText(claimText) || "").trim();
      const dedupeKey = `${claimType}|${normalizedClaim}`;

      if (!hasQualifyingNumericDataSignal(claimText)) {
        continue;
      }

      if (containsExcludedTopic(claimText)) {
        continue;
      }

      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);

      const referenceDateText = String(extractedClaim.referenceDateText || "").trim();
      const cacheFingerprint = buildClaimFingerprint(normalizedClaim, claimType, referenceDateText);
      const timestamp = new Date().toISOString();
      const candidateClaim = {
        segmentId: segment.segmentId,
        memberSlug: segment.memberSlug,
        routeSlug: segment.routeSlug,
        memberName: segment.memberName,
        partyName: segment.partyName,
        speakerLabel: segment.speakerLabel,
        claimText,
        claimSummary,
        normalizedClaim,
        claimType,
        numericValueText,
        unit,
        referenceDateText,
        extractionConfidence: Math.max(
          0,
          Math.min(100, Number(extractedClaim.extractionConfidence) || 0),
        ),
        whyCheckable: trimText(
          extractedClaim.whyCheckable ||
            "Structured extraction marked this as a concrete verifiable factual claim.",
          240,
        ),
        segmentText: segment.segmentText,
        rawQuote: trimText(segment.utteranceText, 1400),
        rawQuoteWordCount: segment.utteranceWordCount,
        verificationStatus: "pending",
        verification: null,
        verificationError: null,
        cacheFingerprint,
        extractedAt: timestamp,
        updatedAt: timestamp,
      };

      candidateClaim.selectionScore = buildClaimSelectionScore(candidateClaim, segment);

      const existingClaim = claimsByMember.get(segment.memberSlug);

      if (
        !existingClaim ||
        compareSelectedClaims(candidateClaim, existingClaim) < 0
      ) {
        claimsByMember.set(segment.memberSlug, candidateClaim);
      }
    }

    return Array.from(claimsByMember.values())
      .sort(compareSelectedClaims)
      .slice(0, MAX_CLAIMS_PER_PROTOCOL)
      .map((claim, index) => {
        const { selectionScore, ...claimWithoutSelectionScore } = claim;

        return {
          ...claimWithoutSelectionScore,
          claimId: buildClaimId(
            protocolKey,
            claim.memberSlug,
            claim.normalizedClaim,
            index + 1,
          ),
        };
      });
  }

  buildVerificationInstructions(protocolSummary, claim) {
    return [
      "You are verifying a factual claim made in an Israeli Knesset protocol.",
      "Use Google Search grounding and build your research around the claim summary and the original claim text.",
      "First derive 1 to 3 precise search queries from the claim summary and the original claim text, then use them as your search strategy and return them in searchQueries.",
      "Prefer official and primary sources. Use secondary sources only when primary material is unavailable, and note that clearly.",
      "If the claim is time-sensitive, verify it as of the protocol date when possible.",
      "Do not force a binary answer when evidence is incomplete or context-dependent.",
      "Return 2 to 5 concise bullet points in Hebrew. Each bullet may contain at most two sentences.",
      "Each bullet must cite the source or sources it relies on, and each bullet must include at least one source object.",
      "shortRuling must be a final verdict sentence in Hebrew that clearly states the level of truthfulness of the claim.",
      `Protocol date: ${protocolSummary.longDateLabel || protocolSummary.shortDateLabel || "unknown"}`,
      `Protocol source: ${protocolSummary.sourceLabel}`,
      `Speaker: ${claim.memberName}`,
    ].join("\n");
  }

  buildVerificationInput(protocolSummary, claim) {
    return {
      protocol: {
        source: protocolSummary.source,
        sourceLabel: protocolSummary.sourceLabel,
        title: protocolSummary.title,
        date: protocolSummary.longDateLabel || protocolSummary.shortDateLabel || "",
        committeeName: protocolSummary.committeeName || "",
      },
      claim: {
        claimId: claim.claimId,
        speaker: claim.memberName,
        partyName: claim.partyName,
        claimText: claim.claimText,
        claimSummary: claim.claimSummary,
        normalizedClaim: claim.normalizedClaim,
        claimType: claim.claimType,
        numericValueText: claim.numericValueText,
        unit: claim.unit,
        referenceDateText: claim.referenceDateText,
        rawQuote: claim.rawQuote,
        whyCheckable: claim.whyCheckable,
      },
      outputRequirements: {
        verdicts: VERDICTS,
        requiredSourceFields: ["title", "url", "sourceType", "note"],
      },
    };
  }

  getActiveVerificationIdentity() {
    return {
      provider: this.verificationClient?.provider || "unknown",
      model:
        this.verificationClient?.model ||
        this.verificationClient?.getConfiguration?.().model ||
        null,
    };
  }

  isCurrentVerificationResult(verification) {
    const current = this.getActiveVerificationIdentity();

    return (
      String(verification?.provider || "").trim() === String(current.provider || "").trim() &&
      String(verification?.model || "").trim() === String(current.model || "").trim()
    );
  }

  getCacheEntry(cacheFingerprint) {
    const entry = this.manifest.verificationCache?.[cacheFingerprint];

    if (!entry || !entry.verification || !entry.expiresAt) {
      return null;
    }

    const expiresAt = new Date(entry.expiresAt);

    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return entry;
  }

  async verifyClaim(protocolSummary, claim, options = {}) {
    const cacheFingerprint =
      claim.cacheFingerprint ||
      buildClaimFingerprint(claim.normalizedClaim, claim.claimType, claim.referenceDateText);

    if (!options.force) {
      const cachedEntry = this.getCacheEntry(cacheFingerprint);

      if (cachedEntry && this.isCurrentVerificationResult(cachedEntry.verification)) {
        return {
          status: "completed",
          verification: {
            ...cachedEntry.verification,
            cacheHit: true,
          },
        };
      }
    }

    if (!this.verificationClient?.isConfigured?.()) {
      return {
        status: "pending_configuration",
        verification: null,
        error: "GEMINI_API_KEY or GOOGLE_API_KEY is not configured for protocol fact verification.",
      };
    }

    try {
      const verificationPayload = await this.verificationClient.createStructuredResearchResponse({
        instructions: this.buildVerificationInstructions(protocolSummary, claim),
        input: this.buildVerificationInput(protocolSummary, claim),
        schema: VERIFICATION_SCHEMA,
      });
      const checkedAt = new Date().toISOString();
      const verification = {
        ...verificationPayload,
        checkedAt,
        provider: this.getActiveVerificationIdentity().provider,
        model: this.getActiveVerificationIdentity().model,
        allowedDomains: buildAllowedDomains(claim.claimType),
        cacheHit: false,
      };
      const ttlDays = getCacheTtlDays(claim.claimType);

      this.manifest.verificationCache[cacheFingerprint] = {
        checkedAt,
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
        verification,
      };
      await this.persistManifest();

      return {
        status: "completed",
        verification,
      };
    } catch (error) {
      return {
        status: "failed",
        verification: null,
        error: toErrorMessage(error),
      };
    }
  }

  deriveRecordStatus(record) {
    const claims = Array.isArray(record.claims) ? record.claims : [];

    if (!claims.length) {
      return "completed_no_claims";
    }

    if (claims.some((claim) => claim.verificationStatus === "not_started")) {
      return "extracted";
    }

    if (claims.some((claim) => claim.verificationStatus === "failed")) {
      return "completed_with_errors";
    }

    if (claims.some((claim) => claim.verificationStatus === "pending_configuration")) {
      return "completed_pending_verification";
    }

    return "completed";
  }

  buildExtractedRecord(protocolSummary, attributedUtterances, candidateSegments, claims) {
    const timestamp = new Date().toISOString();

    return {
      version: FACT_CHECK_VERSION,
      status: "extracted",
      protocol: protocolSummary,
      processedAt: timestamp,
      updatedAt: timestamp,
      methodology: this.getProtocolMethodology(),
      candidateSegmentCount: candidateSegments.length,
      utteranceCount: attributedUtterances.length,
      claims,
      recentErrors: [],
    };
  }

  async extractProtocolClaims(source, documentId, options = {}) {
    await this.initialize();
    const protocolKey = buildProtocolKey(source, documentId);
    const existingRecord = options.force ? null : await this.readProtocolRecord(source, documentId);

    if (options.force) {
      await this.deleteProtocolRecord(source, documentId);
    }

    if (existingRecord && Array.isArray(existingRecord.claims) && existingRecord.claims.length > 0) {
      return existingRecord;
    }

    const { content, protocolSummary } = await this.resolveProtocol(source, documentId);
    const attributedUtterances = this.memberProtocolService.extractAttributedUtterances(
      content.paragraphs,
      {
        minimumWordCount: EXTRACTION_MIN_SEGMENT_WORDS,
      },
    );
    const candidateSegments = this.buildCandidateSegments(attributedUtterances);
    const extractedClaims = await this.extractClaimsFromSegments(candidateSegments, protocolSummary);
    const claims = this.materializeClaims(protocolKey, candidateSegments, extractedClaims).map((claim) => ({
      ...claim,
      verificationStatus: "not_started",
      verification: null,
      verificationError: null,
    }));
    const record = this.buildExtractedRecord(
      protocolSummary,
      attributedUtterances,
      candidateSegments,
      claims,
    );
    record.status = this.deriveRecordStatus(record);
    await this.writeProtocolRecord(source, documentId, record);
    return record;
  }

  async verifyProtocolClaims(source, documentId, options = {}) {
    await this.initialize();
    const record =
      (await this.readProtocolRecord(source, documentId)) ||
      (await this.extractProtocolClaims(source, documentId));

    if (!record) {
      return null;
    }

    const processingErrors = [];

    for (const claim of record.claims || []) {
      if (
        !options.force &&
        claim.verificationStatus === "completed" &&
        claim.verification &&
        this.isCurrentVerificationResult(claim.verification)
      ) {
        continue;
      }

      const verificationResult = await this.verifyClaim(record.protocol, claim, {
        force: options.force,
      });

      claim.verificationStatus = verificationResult.status;
      claim.verification = verificationResult.verification || null;
      claim.verificationError = verificationResult.error || null;
      claim.updatedAt = new Date().toISOString();

      if (verificationResult.error) {
        processingErrors.push(`${claim.claimId} - ${verificationResult.error}`);
      }
    }

    record.updatedAt = new Date().toISOString();
    record.recentErrors = processingErrors.slice(0, 10);
    record.status = this.deriveRecordStatus(record);
    await this.writeProtocolRecord(source, documentId, record);
    return record;
  }

  async processProtocol(source, documentId) {
    const extractedRecord = await this.extractProtocolClaims(source, documentId);

    if (!extractedRecord || !Array.isArray(extractedRecord.claims) || !extractedRecord.claims.length) {
      return extractedRecord;
    }

    return this.verifyProtocolClaims(source, documentId);
  }

  async retryClaim(claimId) {
    await this.initialize();
    const parts = String(claimId || "").split(":");

    if (parts.length < 4) {
      return null;
    }

    const [source, documentId] = parts;
    const record = await this.readProtocolRecord(source, documentId);

    if (!record) {
      return null;
    }

    const claim = (record.claims || []).find((candidate) => candidate.claimId === claimId);

    if (!claim) {
      return null;
    }

    delete this.manifest.verificationCache[claim.cacheFingerprint];
    const verificationResult = await this.verifyClaim(record.protocol, claim, { force: true });

    claim.verificationStatus = verificationResult.status;
    claim.verification = verificationResult.verification || null;
    claim.verificationError = verificationResult.error || null;
    claim.updatedAt = new Date().toISOString();
    record.updatedAt = new Date().toISOString();
    record.status = this.deriveRecordStatus(record);
    await this.writeProtocolRecord(source, documentId, record);

    return {
      claim,
      protocol: record.protocol,
      status: record.status,
      queueStatus: this.getStatus(),
    };
  }

  async verifySingleClaim(claimId, options = {}) {
    return this.retryClaim(claimId, options);
  }
}

module.exports = {
  ProtocolFactCheckService,
  CLAIM_TYPES,
  VERDICTS,
};
