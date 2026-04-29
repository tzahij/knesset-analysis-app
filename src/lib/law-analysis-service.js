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

const ANALYSIS_VERSION = 1;
const ANALYSIS_CONCURRENCY = 1;
const MAX_ANALYSIS_CHARS = Number(process.env.LAW_ANALYSIS_MAX_CHARS) || 120000;

const LAW_AXIS_DEFINITIONS = [
  {
    key: "religiousSecular",
    label: "דתי מול חילוני",
    lowLabel: "חילוני",
    highLabel: "דתי",
  },
  {
    key: "socialismCapitalism",
    label: "סוציאליזם מול קפיטליזם",
    lowLabel: "סוציאליסטי",
    highLabel: "קפיטליסטי",
  },
  {
    key: "doveHawk",
    label: "יוני מול נצי",
    lowLabel: "יוני",
    highLabel: "נצי",
  },
  {
    key: "liberalDemocracyAuthoritarianism",
    label: "דמוקרטיה ליברלית מול סמכותנות",
    lowLabel: "דמוקרטיה ליברלית",
    highLabel: "סמכותנות",
  },
];

const LAW_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overallSummary", "axes"],
  properties: {
    overallSummary: {
      type: "string",
    },
    axes: {
      type: "object",
      additionalProperties: false,
      required: LAW_AXIS_DEFINITIONS.map((axis) => axis.key),
      properties: Object.fromEntries(
        LAW_AXIS_DEFINITIONS.map((axis) => [
          axis.key,
          {
            type: "object",
            additionalProperties: false,
            required: ["score", "explanationBullets", "supportingPassages"],
            properties: {
              score: {
                type: "integer",
                minimum: 1,
                maximum: 10,
              },
              explanationBullets: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              supportingPassages: {
                type: "array",
                items: {
                  type: "string",
                },
              },
            },
          },
        ]),
      ),
    },
  },
};

function buildAnalysisInstructions() {
  return [
    `אתה מנתח חוקים של הכנסת וכותב בעברית טבעית, בהירה ומדויקת.`,
    `הישען רק על החומר שסופק לך מתוך נוסח החוק, התקציר הרשמי והמטא-דאטה.`,
    `אל תשתמש בידע חיצוני ואל תנחש פרטים שלא עולים מהטקסט.`,
    `אם הקשר ביטחוני, מדיני או עוין אינו מופיע בטקסט שסופק לך, אל תוסיף אותו מבחוץ.`,
    `עליך לקבוע היכן החוק ממוקם על ארבעה צירים אידיאולוגיים.`,
    `בכל הצירים: 1 מייצג את הקוטב הראשון ו-10 מייצג את הקוטב השני.`,
    `כלל יסוד פרשני: יש להבחין בין מטרת החוק לבין האמצעים שהוא מפעיל.`,
    `מטרת החוק קובעת בעיקר את מיקומו על הציר יוני מול נצי.`,
    `האמצעים שהחוק מפעיל קובעים בעיקר את מיקומו על הציר דמוקרטיה ליברלית מול סמכותנות.`,
    `אל תבלבל בין השניים.`,
    `חוק יכול להיות נצי מאוד אך לא סמכותני מאוד, אם מרכז הכובד שלו הוא עימות ביטחוני או מדיני מול גורם עוין, גם כאשר הוא משתמש בכלי אכיפה קשים.`,
    `מנגד, חוק יכול להיות סמכותני מאוד גם בלי להיות נצי, אם הוא פוגע פגיעה עמוקה בזכויות, בהליך הוגן, באיזונים ובלמים או בביקורת על הכוח השלטוני.`,
    `דתי מול חילוני: 1 = חילוני מאוד רק אם החוק פועל באופן מובהק נגד הרחבת זכויות, סמכויות, תקציבים או הטבות לקבוצות דתיות, או אם הוא מקדם שוויון, הכלה, חופש דת וחופש מדת, ומונע צבירת זכויות יתר דתיות. אל תיתן ציון חילוני נמוך רק משום שהחוק עוסק בנושא מדינתי או אזרחי שאינו דתי. 10 = דתי מאוד אם החוק מחזק מוסדות דת, נורמות דתיות, זכויות, תקציבים, סמכויות או העדפה של קבוצות דתיות.`,
    `סוציאליזם מול קפיטליזם: 1 = סוציאליסטי מאוד, 10 = קפיטליסטי מאוד.`,
    `יוני מול נצי: 1 = יוני מאוד אם החוק מקדם פשרה, ריסון, דה-אסקלציה, שיתוף פעולה, צמצום שימוש בכוח, הקלה על אוכלוסייה או שחקן הנתפס בטקסט כיריב, או העדפת זכויות, דיפלומטיה ודו-קיום על פני כפייה, הרתעה ועימות.`,
    `10 = נצי מאוד אם החוק מחזק הרתעה, ענישה, סנקציות, שליטה ביטחונית, שימוש בכוח מדינה נגד טרור, אויב, לחימה, סגר, גבולות, שירות צבאי, גורם עוין, או ארגון זר או בינלאומי שהטקסט מציג אותו בהקשר ביטחוני, מדיני או עוין כלפי ישראל.`,
    `כאשר החוק עוסק במלחמה, טרור, "חרבות ברזל", 7 באוקטובר, לחימה, סגר, אויב, גבולות, גופי ביטחון, ועדת החוץ והביטחון, או שלילת פעילות מגורם חיצוני או עוין - זהו שיקול נצי מובהק, אם הדבר עולה מהטקסט עצמו.`,
    `דמוקרטיה ליברלית מול סמכותנות: 1 = דמוקרטיה ליברלית מאוד אם החוק מחזק זכויות פרט, הליך הוגן, שוויון בפני החוק, פרטיות, חופש ביטוי, חופש התאגדות, ביקורת שיפוטית, פיקוח פרלמנטרי, ביזור כוח, או מגביל את יכולת המדינה לפעול בכפייה.`,
    `10 = סמכותני מאוד רק אם החוק מרחיב באופן מובהק, עמוק או גורף את כוח הכפייה של המדינה, מחליש בלמים ואיזונים, מצמצם הליך הוגן, מחליש פיקוח שיפוטי או פרלמנטרי, פוגע בזכויות יסוד, או יוצר מנגנון רחב של שלילה, פיקוח או כפייה כלפי פרטים, תושבים, אזרחים או גופים בתוך המרחב האזרחי.`,
    `אל תיתן ציון סמכותני גבוה רק משום שהחוק תקיף, מעניש, שולל שירותים, אוסר פעילות, מפעיל אכיפה, תופס נכסים, או משתמש בכוח המדינה בהקשר ביטחוני או מדיני מול גורם עוין, זר או אויב.`,
    `במקרים כאלה, שאל מהו מרכז הכובד: אם עיקר החוק הוא עימות ביטחוני או מדיני מול אויב או גורם עוין - זה שייך קודם כל לציר יוני מול נצי.`,
    `העלה מאוד את ציון הסמכותנות רק אם הטקסט מראה גם פגיעה מהותית ולא רק אינסטרומנטלית בזכויות, בהליך הוגן או באיזונים ובלמים.`,
    `אם קיימים מנגנוני בקרה, אישור ועדה, ביקורת שיפוטית, תחולה צרה או מיקוד נקודתי - ציין זאת כשיקול שממתן את ציון הסמכותנות.`,
    `כללי הכרעה משלימים: הישען רק על הסימנים שמופיעים בטקסט.`,
    `מותר להסיק הקשר ביטחוני או עוין רק אם הוא נתמך בנוסח החוק, בתקציר או במטא-דאטה.`,
    `אם יש גם רכיב נצי וגם רכיב סמכותני, קבע מהו המרכז ומהו המשני. הציונים והנימוקים צריכים לשקף את מרכז הכובד, לא רק את עצם קיומם של אמצעי אכיפה.`,
    `אל תשתמש בשפה אוטומטית שלפיה "כוח מדינה = סמכותנות". נתח מה המדינה עושה, נגד מי, באיזה הקשר, ובאיזה היקף.`,
    `אם החוק ממוקד בגורם חיצוני, ארגון בינלאומי, טרור, לחימה או אויב, והטקסט מציג זאת כהקשר ביטחוני או מדיני, ברירת המחדל היא לראות בכך קודם כל ביטוי לנציות; רק לאחר מכן בחן אם יש גם מרכיב סמכותני ניכר.`,
    `לכל ציר החזר ציון אחד, 2 עד 4 בולטים שמסבירים את הציון, ו-1 עד 3 מובאות קצרות או תיאורי סעיפים כתמיכה.`,
    `אם הטקסט המלא אינו זמין וההכרעה נשענת בעיקר על התקציר, ציין זאת בבולטים הרלוונטיים.`,
    `אם בציר מסוים יש מתח בין שני כיוונים אך אחד מהם משני בלבד, הסבר זאת במפורש בבולטים.`,
    `overallSummary חייב להיות פסקה קצרה אחת שמסבירה מה החוק מנסה לקדם, מה מרכז הכובד האידיאולוגי שלו, ואם יש רכיב משני חשוב על ציר אחר - ציין אותו כמשני ולא כמרכזי.`,
    `החזר JSON תקף בלבד לפי הסכמה שניתנה לך.`,
  ].join(" ");
}

function buildAnalysisInput(law, contentPayload) {
  const paragraphs = Array.isArray(contentPayload?.paragraphs) ? contentPayload.paragraphs : [];
  const readableText = paragraphs.join("\n\n").trim();
  const truncatedText =
    readableText.length > MAX_ANALYSIS_CHARS
      ? `${readableText.slice(0, MAX_ANALYSIS_CHARS)}\n\n[TEXT TRUNCATED]`
      : readableText;

  return [
    `כותרת החוק: ${law.title}`,
    `מספר הצעת חוק: ${law.billId}`,
    `מספר חוק: ${law.lawId || "לא זמין"}`,
    `תאריך פרסום: ${law.longDateLabel || law.shortDateLabel || "לא זמין"}`,
    `סטטוס רשמי: ${law.statusDesc || "התקבלה בקריאה שלישית"}`,
    `סדרת פרסום: ${law.publicationSeriesDesc || "ספר החוקים"}`,
    "",
    "תקציר רשמי ומטא-דאטה:",
    ...(Array.isArray(contentPayload?.summaryParagraphs)
      ? contentPayload.summaryParagraphs
      : [law.summaryLaw || "לא זמין"]),
    "",
    contentPayload?.hasReadableText
      ? "נוסח קריא של החוק מתוך קובץ Word:"
      : "נוסח קריא מלא לא זמין. נתח בזהירות על בסיס התקציר והמטא-דאטה:",
    truncatedText || "אין נוסח קריא נוסף זמין.",
  ].join("\n");
}

function buildSourceSignature(law, contentPayload) {
  return JSON.stringify({
    title: law.title,
    lawId: law.lawId || null,
    billId: law.billId,
    statusDesc: law.statusDesc || null,
    summaryLaw: law.summaryLaw || null,
    hasReadableText: Boolean(contentPayload?.hasReadableText),
    extractedAt: contentPayload?.extractedAt || null,
    paragraphCount: Array.isArray(contentPayload?.paragraphs) ? contentPayload.paragraphs.length : 0,
  });
}

function formatAnalysisMarkdown(law, manifest) {
  const sections = [
    `# ${law.title}`,
    "",
    `- מספר הצעת חוק: ${law.billId}`,
    `- מספר חוק: ${law.lawId || "לא זמין"}`,
    `- תאריך: ${law.longDateLabel || law.shortDateLabel || "לא זמין"}`,
    `- נותח בתאריך: ${manifest.generatedAt}`,
    "",
    "## סיכום",
    "",
    manifest.analysis.overallSummary || "",
    "",
    "## ציונים אידיאולוגיים",
    "",
  ];

  for (const axis of LAW_AXIS_DEFINITIONS) {
    const axisAnalysis = manifest.analysis.axes?.[axis.key];

    if (!axisAnalysis) {
      continue;
    }

    sections.push(`### ${axis.label}`);
    sections.push("");
    sections.push(`- ציון: ${axisAnalysis.score}/10`);

    for (const bullet of axisAnalysis.explanationBullets || []) {
      sections.push(`- ${bullet}`);
    }

    if (Array.isArray(axisAnalysis.supportingPassages) && axisAnalysis.supportingPassages.length) {
      sections.push("");
      sections.push("מובאות / תימוכין:");
      for (const passage of axisAnalysis.supportingPassages) {
        sections.push(`- ${passage}`);
      }
    }

    sections.push("");
  }

  return sections.join("\n");
}

class LawAnalysisService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname, "..", "..");
    this.dataDir = options.dataDir || path.join(this.rootDir, "data");
    this.analysisDir = path.join(this.dataDir, "law-analyses");
    this.lawStore = options.lawStore;
    this.analysisClient = options.analysisClient;
    this.promotionService = options.promotionService || null;
    this.initialized = false;
    this.bulkPromise = null;
    this.bulkStatus = this.createIdleBulkStatus();
    this.lawStatuses = new Map();
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    await Promise.all([ensureDirectory(this.dataDir), ensureDirectory(this.analysisDir)]);
    this.initialized = true;
  }

  getAxisDefinitions() {
    return LAW_AXIS_DEFINITIONS.map((axis) => ({ ...axis }));
  }

  createIdleBulkStatus() {
    return {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      lastCompletedAt: null,
      totalLaws: 0,
      processedLaws: 0,
      generatedLaws: 0,
      skippedLaws: 0,
      failedLaws: 0,
      current: null,
      recentErrors: [],
      configured: this.analysisClient?.isConfigured?.() || false,
      provider: this.analysisClient?.provider || "unknown",
      model: this.analysisClient?.model || "unknown",
      mode: "all_missing_or_stale",
      message: null,
    };
  }

  createIdleLawStatus(law) {
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
      hasAnalysis: false,
      billId: String(law.billId),
      title: law.title,
    };
  }

  buildBaseName(law) {
    return sanitizeFilename(`${law.dateKey || "unknown-date"}__${law.billId}__law-analysis`);
  }

  getAnalysisJsonPath(law) {
    return path.join(this.analysisDir, `${this.buildBaseName(law)}.json`);
  }

  getAnalysisMarkdownPath(law) {
    return path.join(this.analysisDir, `${this.buildBaseName(law)}.md`);
  }

  async deleteAnalysisArtifacts(law) {
    await Promise.all([
      fs.rm(this.getAnalysisJsonPath(law), { force: true }),
      fs.rm(this.getAnalysisMarkdownPath(law), { force: true }),
    ]);
    this.lawStatuses.delete(String(law.billId));
  }

  async readAnalysisManifest(law) {
    const jsonPath = this.getAnalysisJsonPath(law);

    if (!(await fileExists(jsonPath))) {
      return null;
    }

    try {
      const manifest = await readJson(jsonPath);
      const resolvedMarkdownPath = await resolveStoredDataPath(this.dataDir, manifest?.markdownPath);

      if (
        manifest?.version !== ANALYSIS_VERSION ||
        String(manifest?.billId || "") !== String(law.billId) ||
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

  isManifestStale(manifest, sourceSignature) {
    return !manifest || manifest.version !== ANALYSIS_VERSION || manifest.sourceSignature !== sourceSignature;
  }

  getBulkStatus() {
    return {
      ...this.bulkStatus,
      axes: this.getAxisDefinitions(),
    };
  }

  hasUsableAxesAnalysis(manifest) {
    return Boolean(manifest?.analysis?.axes);
  }

  async getMissingProfileLaws() {
    await this.initialize();
    const laws = await this.lawStore.getLaws();
    const pendingLaws = [];

    for (const law of laws) {
      const manifest = await this.readAnalysisManifest(law);

      if (!this.hasUsableAxesAnalysis(manifest)) {
        pendingLaws.push(law);
      }
    }

    return {
      laws,
      pendingLaws,
    };
  }

  async getLawAnalysisRecord(billId) {
    await this.initialize();
    const law = await this.lawStore.getLawById(billId);

    if (!law) {
      return null;
    }

    const manifest = await this.readAnalysisManifest(law);
    const runtimeStatus = this.lawStatuses.get(String(law.billId));
    let isStale = false;

    if (manifest) {
      try {
        const contentPayload = await this.lawStore.getLawContent(law.billId);
        const sourceSignature = buildSourceSignature(law, contentPayload);
        isStale = this.isManifestStale(manifest, sourceSignature);
      } catch {
        isStale = false;
      }
    }

    if (runtimeStatus) {
      return {
        law,
        axes: this.getAxisDefinitions(),
        status: {
          ...runtimeStatus,
          isStale,
        },
        analysis: manifest?.analysis || null,
      };
    }

    if (!manifest) {
      return {
        law,
        axes: this.getAxisDefinitions(),
        status: {
          ...this.createIdleLawStatus(law),
          isStale: false,
        },
        analysis: null,
      };
    }

    return {
      law,
      axes: this.getAxisDefinitions(),
      status: {
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
        hasAnalysis: true,
        billId: String(law.billId),
        title: law.title,
      },
      analysis: manifest.analysis,
    };
  }

  async startBulkAnalysis() {
    await this.initialize();

    if (!this.analysisClient?.isConfigured?.()) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    if (this.bulkPromise) {
      return this.getBulkStatus();
    }

    const laws = await this.lawStore.getLaws();
    this.bulkStatus = {
      ...this.createIdleBulkStatus(),
      status: "running",
      startedAt: new Date().toISOString(),
      totalLaws: laws.length,
      configured: true,
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model || "unknown",
      lastCompletedAt: this.bulkStatus.lastCompletedAt || null,
    };

    this.bulkPromise = this.runBulkAnalysis(laws)
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

  async startMissingProfileAnalysis() {
    await this.initialize();

    if (!this.analysisClient?.isConfigured?.()) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    if (this.bulkPromise) {
      return this.getBulkStatus();
    }

    const { laws, pendingLaws } = await this.getMissingProfileLaws();

    if (!pendingLaws.length) {
      const finishedAt = new Date().toISOString();
      this.bulkStatus = {
        ...this.createIdleBulkStatus(),
        status: "nothing_to_do",
        startedAt: finishedAt,
        finishedAt,
        lastCompletedAt: finishedAt,
        totalLaws: 0,
        processedLaws: 0,
        generatedLaws: 0,
        skippedLaws: laws.length,
        failedLaws: 0,
        configured: true,
        provider: this.analysisClient.provider || "unknown",
        model: this.analysisClient.model || "unknown",
        mode: "missing_only",
        message: "No new third-reading laws without axes profiles were found.",
      };
      return this.getBulkStatus();
    }

    this.bulkStatus = {
      ...this.createIdleBulkStatus(),
      status: "running",
      startedAt: new Date().toISOString(),
      totalLaws: pendingLaws.length,
      configured: true,
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model || "unknown",
      lastCompletedAt: this.bulkStatus.lastCompletedAt || null,
      mode: "missing_only",
      message: `Analyzing ${pendingLaws.length} new laws that are still missing axes profiles.`,
    };

    this.bulkPromise = this.runBulkAnalysis(pendingLaws)
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

  async startFullRebuildAnalysis() {
    await this.initialize();

    if (!this.analysisClient?.isConfigured?.()) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    if (this.bulkPromise) {
      return this.getBulkStatus();
    }

    const laws = await this.lawStore.getLaws();

    this.bulkStatus = {
      ...this.createIdleBulkStatus(),
      status: "running",
      startedAt: new Date().toISOString(),
      totalLaws: laws.length,
      configured: true,
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model || "unknown",
      lastCompletedAt: this.bulkStatus.lastCompletedAt || null,
      mode: "rebuild_all",
      message: `Recreating axes profiles for all ${laws.length} third-reading laws.`,
    };

    this.bulkPromise = this.runBulkAnalysis(laws, { forceRebuild: true })
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

  async runBulkAnalysis(laws, options = {}) {
    const forceRebuild = Boolean(options.forceRebuild);
    const resumePromotion =
      typeof this.promotionService?.suspendAutoPromotion === "function"
        ? this.promotionService.suspendAutoPromotion()
        : null;

    try {
      await mapWithConcurrency(laws, ANALYSIS_CONCURRENCY, async (law) => {
        this.bulkStatus.current = {
          billId: String(law.billId),
          title: law.title,
          shortDateLabel: law.shortDateLabel || "",
        };

        try {
          const contentPayload = await this.lawStore.getLawContent(law.billId);
          const sourceSignature = buildSourceSignature(law, contentPayload);
          const existingManifest = await this.readAnalysisManifest(law);

          if (
            !forceRebuild &&
            this.hasUsableAxesAnalysis(existingManifest) &&
            !this.isManifestStale(existingManifest, sourceSignature)
          ) {
            this.bulkStatus.skippedLaws += 1;
            return;
          }

          if (forceRebuild) {
            await this.deleteAnalysisArtifacts(law);
          }

          await this.runLawAnalysis(law, contentPayload, sourceSignature);
          this.bulkStatus.generatedLaws += 1;
        } catch (error) {
          this.bulkStatus.failedLaws += 1;
          this.bulkStatus.recentErrors = [
            `${law.title}: ${toErrorMessage(error)}`,
            ...this.bulkStatus.recentErrors,
          ].slice(0, 10);
          this.lawStatuses.set(String(law.billId), {
            ...this.createIdleLawStatus(law),
            status: "failed",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            error: toErrorMessage(error),
          });
        } finally {
          this.bulkStatus.processedLaws += 1;
        }
      });

      this.bulkStatus.status = this.bulkStatus.failedLaws > 0 ? "completed_with_errors" : "completed";
      this.bulkStatus.finishedAt = new Date().toISOString();
      this.bulkStatus.lastCompletedAt = this.bulkStatus.finishedAt;
      this.bulkStatus.current = null;
    } finally {
      if (resumePromotion) {
        await resumePromotion();
      }
    }
  }

  async runLawAnalysis(law, contentPayload, sourceSignature) {
    const runtimeStatus = {
      ...this.createIdleLawStatus(law),
      status: "running",
      startedAt: new Date().toISOString(),
      currentStage: "analyzing",
    };
    this.lawStatuses.set(String(law.billId), runtimeStatus);

    const analysis = await this.executeAnalysisRequest(law, contentPayload);
    const generatedAt = new Date().toISOString();
    const manifest = {
      version: ANALYSIS_VERSION,
      billId: String(law.billId),
      lawId: law.lawId || null,
      title: law.title,
      generatedAt,
      startedAt: runtimeStatus.startedAt,
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model || "unknown",
      sourceSignature,
      markdownPath: this.getAnalysisMarkdownPath(law),
      analysis,
    };

    await writeTextFile(manifest.markdownPath, formatAnalysisMarkdown(law, manifest));
    await writeJson(this.getAnalysisJsonPath(law), manifest);
    this.promotionService?.requestPromotion("lawAnalyses");

    this.lawStatuses.set(String(law.billId), {
      ...this.createIdleLawStatus(law),
      status: "completed",
      startedAt: runtimeStatus.startedAt,
      finishedAt: generatedAt,
      generatedAt,
      hasAnalysis: true,
      configured: true,
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model || "unknown",
    });

    return manifest;
  }

  async executeAnalysisRequest(law, contentPayload) {
    const created = await this.analysisClient.createStructuredResponse({
      instructions: buildAnalysisInstructions(),
      input: buildAnalysisInput(law, contentPayload),
      schema: LAW_ANALYSIS_SCHEMA,
      name: "law_ideological_analysis",
      metadata: {
        bill_id: String(law.billId),
        law_title: law.title,
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
  buildAnalysisInstructions,
  LAW_AXIS_DEFINITIONS,
  LawAnalysisService,
};
