const path = require("path");

const {
  ensureDirectory,
  fileExists,
  mapWithConcurrency,
  readJson,
  toErrorMessage,
  writeJson,
} = require("./utils");
const { MEMBER_PROTOCOL_SINCE_DATE } = require("./member-registry");

const COMPARISON_CACHE_VERSION = 2;
const PROTOCOL_SCAN_CONCURRENCY = 4;
const MIN_COMPARISON_UTTERANCE_WORDS = 5;
const MIN_MEMBER_WORDS_FOR_COMPARISON = 200;

const COMPARISON_DEFINITIONS = [
  {
    key: "religiosity",
    title: "מדד שפה דתית",
    shortDescription:
      "מודד עד כמה חברי הכנסת משתמשים באוצר מילים דתי, אמוני ומקראי בתוך הדיבור הפרלמנטרי שלהם.",
    methodology: [
      "נספרו רק קטעי דיבור שבהם חבר הכנסת זוהה כדובר בפרוטוקול, ורק אם הקטע כלל לפחות 5 מילים.",
      "נספרו הופעות של מילון דתי-מקראי קשיח, ולא נעשה כל שימוש ב-LLM או בפרשנות חיצונית.",
      "הציון מחושב כהופעות לכל 1,000 מילים מדוברות, כדי לנטרל יתרון לדוברים שמדברים הרבה יותר.",
      "דירוג המפלגות מחושב כממוצע של ציוני חברי הכנסת הזכאים במפלגה, ולא כסכום גולמי.",
    ],
    terms: [
      "יהוה",
      "ה'",
      "אלוהים",
      "אלוקים",
      "תורה",
      "הלכה",
      "מצווה",
      "מצוות",
      "אמונה",
      "תפילה",
      "קדוש",
      "קודש",
      "רבנים",
      "שבת",
      "גאולה",
      "בית מדרש",
    ],
  },
  {
    key: "security",
    title: "מדד שפה ביטחונית-ניצית",
    shortDescription:
      "מודד את עוצמת השימוש של כל חבר כנסת במילון של ביטחון, טרור, אויב, צבא והכרעה.",
    methodology: [
      "נספרו רק מילים מתוך מילון ביטחוני-ניצי קשיח שנקבע מראש בקוד.",
      "גם כאן הציון מנורמל להופעות לכל 1,000 מילים מדוברות, ולא לפי מספר האזכורים הגולמי בלבד.",
      "המדד מלמד על אינטנסיביות של שפה ביטחונית בדיבור, לא על מכלול העמדה המדינית של האדם.",
      "מפלגה מדורגת גבוה יותר כאשר יותר מחבריה משתמשים בשפה כזו בתדירות גבוהה יחסית.",
    ],
    terms: [
      "ביטחון",
      "בטחוני",
      "צהל",
      "צבא",
      "חייל",
      "חיילים",
      "טרור",
      "מחבל",
      "מחבלים",
      "אויב",
      "חמאס",
      "איראן",
      "הרתעה",
      "מלחמה",
      "ניצחון",
      "פיגוע",
      "גבול",
      "חטופים",
    ],
  },
  {
    key: "socialEconomy",
    title: "מדד שפה חברתית-כלכלית",
    shortDescription:
      "מודד עד כמה חברי הכנסת מדברים בשפה של יוקר מחיה, עבודה, שכר, רווחה, דיור ושירותים ציבוריים.",
    methodology: [
      "נספרו הופעות של מילון חברתי-כלכלי קשיח, עם דגש על יוקר מחיה, עבודה, רווחה ודיור.",
      "הציון מחושב כהופעות לכל 1,000 מילים מדוברות, כדי להבדיל בין נפח דיבור לבין תוכן דיבור.",
      "המדד אינו אומר שחבר הכנסת 'שמאלי' או 'סוציאלי' בהכרח, אלא שהוא משתמש יותר במונחים מהעולם הזה.",
      "דירוג המפלגות מבוסס על ממוצע חברי הכנסת במפלגה שעברו את סף המילים המינימלי.",
    ],
    terms: [
      "יוקר",
      "מחיה",
      "דיור",
      "שכר",
      "משכורת",
      "עובדים",
      "עובדות",
      "עצמאים",
      "רווחה",
      "עוני",
      "בריאות",
      "חינוך",
      "משפחות",
      "קצבאות",
      "פנסיה",
      "מחירים",
      "שכירות",
    ],
  },
  {
    key: "judicialLegal",
    title: "מדד שפה משפטית-משטרית",
    shortDescription:
      "מודד עד כמה חברי הכנסת מרבים לדבר בשפה של מערכת המשפט, בג\"ץ, שלטון החוק, חוקה, ייעוץ משפטי והפרדת רשויות.",
    methodology: [
      "נספרו רק הופעות של מילון משפטי-משטרי קשיח שהוגדר מראש בקוד, בלי כל ניתוח שפה חיצוני.",
      "הציון מחושב כהופעות לכל 1,000 מילים מדוברות, כדי להשוות בין חברי כנסת גם אם היקף הדיבור שלהם שונה מאוד.",
      "המדד בודק בולטות של שפה משפטית ומשטרית בדיבור, לא עמדה נורמטיבית בעד או נגד מערכת המשפט.",
      "דירוג המפלגות מבוסס על ממוצע חברי הכנסת במפלגה שעברו את סף המילים המינימלי.",
    ],
    terms: [
      "בגץ",
      "שלטון החוק",
      "רפורמה משפטית",
      "בית משפט",
      "בתי המשפט",
      "שופטים",
      "שופט",
      "יועמש",
      "יועצת משפטית",
      "יועץ משפטי",
      "חוק יסוד",
      "חוקה",
      "סבירות",
      "הפרדת רשויות",
      "פרקליטות",
      "שומרי הסף",
      "נבצרות",
    ],
  },
  {
    key: "healthCare",
    title: "מדד שפה בריאותית",
    shortDescription:
      "מודד עד כמה חברי הכנסת מדברים בשפה של מערכת הבריאות, בתי חולים, רופאים, אשפוז, טיפולים ותרופות.",
    methodology: [
      "נספרו הופעות של מילון בריאות קשיח בלבד, מתוך קטעי דיבור של חברי הכנסת כפי שהופיעו בפרוטוקול.",
      "הנירמול הוא לכל 1,000 מילים מדוברות, כדי להפריד בין עיסוק בנושא לבין אורך הדיבור הכללי.",
      "המדד משקף נוכחות של שיח בריאותי בדיבור, ולא בהכרח מומחיות אישית או תפקיד פורמלי של הדובר.",
      "מפלגה מדורגת גבוה יותר כאשר יותר מחבריה משתמשים בתדירות גבוהה יחסית במונחים מהעולם הזה.",
    ],
    terms: [
      "בריאות",
      "בית חולים",
      "בתי חולים",
      "רפואה",
      "רופאים",
      "רופאות",
      "אחיות",
      "חולים",
      "אשפוז",
      "תרופות",
      "קופת חולים",
      "רפואה ציבורית",
      "בריאות הנפש",
      "מיון",
      "טיפול רפואי",
      "ניתוח",
      "שיקום",
    ],
  },
  {
    key: "education",
    title: "מדד שפה חינוכית",
    shortDescription:
      "מודד עד כמה חברי הכנסת משתמשים בשפה של חינוך, תלמידים, מורים, גנים, השכלה גבוהה ומסגרות חינוכיות.",
    methodology: [
      "נספרו רק הופעות של מילון חינוך קשיח שהוגדר מראש בקוד.",
      "הציון מנורמל להופעות לכל 1,000 מילים מדוברות, כדי לאזן בין דוברים קצרים לדוברים ארוכים.",
      "המדד מלמד על מרכזיות של שפה חינוכית בדיבור הפרלמנטרי, ולא על איכות המדיניות המוצעת.",
      "גם כאן דירוג המפלגות מחושב כממוצע חברי הכנסת הזכאים בכל מפלגה.",
    ],
    terms: [
      "חינוך",
      "מורים",
      "מורות",
      "תלמידים",
      "תלמידות",
      "בתי ספר",
      "בית ספר",
      "גנים",
      "גן ילדים",
      "בגרות",
      "כיתה",
      "כיתות",
      "אוניברסיטה",
      "סטודנטים",
      "סטודנטיות",
      "השכלה גבוהה",
      "מעונות סטודנטים",
    ],
  },
  {
    key: "transport",
    title: "מדד שפה תחבורתית",
    shortDescription:
      "מודד עד כמה חברי הכנסת מדברים בשפה של תחבורה ציבורית, כבישים, רכבות, מטרו, פקקים ותשתיות תנועה.",
    methodology: [
      "נספרו הופעות של מילון תחבורה קשיח, כולל גם תחבורה ציבורית וגם תשתיות כביש ומסילה.",
      "הציון מחושב כאזכורים לכל 1,000 מילים מדוברות, כדי למדוד צפיפות נושאית ולא נפח דיבור בלבד.",
      "המדד אינו בודק האם הדובר תומך בפרויקט מסוים, אלא עד כמה תחבורה ותשתיות תופסות מקום בדיבור שלו.",
      "מפלגות מדורגות לפי ממוצע החברים במפלגה שעברו את סף המילים המינימלי.",
    ],
    terms: [
      "תחבורה",
      "תחבורה ציבורית",
      "אוטובוס",
      "אוטובוסים",
      "רכבת",
      "רכבות",
      "מטרו",
      "כביש",
      "כבישים",
      "פקקים",
      "נהגים",
      "מסילה",
      "מסילות",
      "רישוי",
      "נתיבי תחבורה",
      "רמזור",
      "תחנה מרכזית",
    ],
  },
  {
    key: "crimeAndPolicing",
    title: "מדד שפה של פשיעה ואכיפה",
    shortDescription:
      "מודד עד כמה חברי הכנסת מדברים בשפה של פשיעה, אלימות, משטרה, אכיפה, נשק, רצח ופרוטקשן.",
    methodology: [
      "נספרו רק הופעות של מילון פשיעה ואכיפה קשיח שנקבע מראש בקוד.",
      "הנירמול לכל 1,000 מילים מדוברות נועד להראות אינטנסיביות נושאית, לא רק כמה זמן דיבר כל חבר כנסת.",
      "המדד משקף עד כמה נושא הפשיעה והאכיפה נמצא בלב השיח של הדובר, ולא בהכרח את פתרונותיו.",
      "דירוג המפלגות מחושב כממוצע של חברי הכנסת הזכאים בכל מפלגה.",
    ],
    terms: [
      "משטרה",
      "שוטרים",
      "אכיפה",
      "פשיעה",
      "אלימות",
      "ירי",
      "רצח",
      "נשק",
      "הגנה עצמית",
      "עבריינים",
      "סחיטה",
      "פרוטקשן",
      "ביטחון פנים",
      "כתב אישום",
      "חוק וסדר",
      "מעצר",
      "פשיעה מאורגנת",
    ],
  },
  {
    key: "environment",
    title: "מדד שפה סביבתית",
    shortDescription:
      "מודד עד כמה חברי הכנסת מרבים לדבר בשפה של סביבה, אקלים, זיהום, פסולת, מים, חופים ואנרגיה נקייה.",
    methodology: [
      "נספרו הופעות של מילון סביבתי-אקלימי קשיח, ללא פרשנות סמנטית חיצונית.",
      "הציון מנורמל להופעות לכל 1,000 מילים מדוברות, כדי לאזן בין חברי כנסת שמדברים מעט לבין כאלה שמדברים הרבה.",
      "המדד בוחן נוכחות של שיח סביבתי בדיבור, ולא האם הדובר מחזיק בתפיסה ירוקה מקיפה.",
      "המפלגות מדורגות לפי ממוצע חברי הכנסת הזכאים בכל מפלגה.",
    ],
    terms: [
      "סביבה",
      "אקלים",
      "זיהום",
      "אוויר",
      "מים",
      "פסולת",
      "מחזור",
      "חופים",
      "אנרגיה מתחדשת",
      "תחנת כוח",
      "תחנות כוח",
      "פליטות",
      "התחממות",
      "שמירת טבע",
      "טבע",
      "מפרץ חיפה",
      "זיהום אוויר",
    ],
  },
];

function normalizeComparisonText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/['"׳״`]/g, "")
    .replace(/[-‐‑‒–—―־/]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countWords(value) {
  const normalized = normalizeComparisonText(value);

  if (!normalized) {
    return 0;
  }

  return normalized.split(" ").filter(Boolean).length;
}

function parseSpeakerParagraph(paragraph) {
  const trimmed = String(paragraph || "").trim();
  const match = trimmed.match(/^<<\s*([^>]+?)\s*>>\s*(.+?)\s*:\s*<<\s*([^>]+?)\s*>>$/u);

  if (!match) {
    return null;
  }

  return {
    speakerLabel: match[2].trim(),
    normalizedSpeakerLabel: normalizeComparisonText(match[2]),
  };
}

function isProtocolMarkerParagraph(paragraph) {
  return /^<<\s*[^>]+?\s*>>.*<<\s*[^>]+?\s*>>$/u.test(String(paragraph || "").trim());
}

function cleanParagraph(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildComparisonDefinitions() {
  return COMPARISON_DEFINITIONS.map((definition) => ({
    ...definition,
    compiledTerms: definition.terms
      .map((term) => {
        const normalized = normalizeComparisonText(term);

        if (!normalized) {
          return null;
        }

        return {
          term,
          normalized,
          regex: new RegExp(`(^|\\s)${escapeRegExp(normalized)}(?=\\s|$)`, "gu"),
        };
      })
      .filter(Boolean),
  }));
}

class MemberComparisonService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname, "..", "..");
    this.dataDir = path.join(this.rootDir, "data");
    this.cacheFile = path.join(this.dataDir, "member-comparisons.json");
    this.memberProtocolService = options.memberProtocolService;
    this.promotionService = options.promotionService || null;
    this.comparisons = buildComparisonDefinitions();
    this.status = this.createIdleStatus();
    this.buildPromise = null;
    this.cachedData = null;
    this.initialized = false;
  }

  createIdleStatus() {
    return {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      totalProtocols: 0,
      processedProtocols: 0,
      current: null,
      recentErrors: [],
      lastCompletedAt: null,
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
    };
  }

  getStatus() {
    return {
      ...this.status,
      current: this.status.current ? { ...this.status.current } : null,
      recentErrors: [...this.status.recentErrors],
    };
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    await ensureDirectory(this.dataDir);
    this.cachedData = await this.readCache();
    this.initialized = true;
  }

  async readCache() {
    if (!(await fileExists(this.cacheFile))) {
      return null;
    }

    try {
      const cache = await readJson(this.cacheFile);

      if (
        cache?.version !== COMPARISON_CACHE_VERSION ||
        cache?.sinceDate !== MEMBER_PROTOCOL_SINCE_DATE ||
        !cache?.generatedAt ||
        !cache?.comparisons
      ) {
        return null;
      }

      return cache;
    } catch {
      return null;
    }
  }

  isCacheFresh(cache) {
    if (!cache) {
      return false;
    }

    const sourceUpdatedAt = this.memberProtocolService.cache?.updatedAt || null;
    return cache.sourceIndexUpdatedAt && sourceUpdatedAt && cache.sourceIndexUpdatedAt === sourceUpdatedAt;
  }

  async getPublicPayload(options = {}) {
    await this.initialize();
    await this.memberProtocolService.startIndexing();

    if (!options.forceRefresh && this.isCacheFresh(this.cachedData) && !this.buildPromise) {
      this.status = {
        ...this.createIdleStatus(),
        status: "completed",
        finishedAt: this.cachedData.generatedAt,
        lastCompletedAt: this.cachedData.generatedAt,
      };
    }

    if (options.forceRefresh || !this.isCacheFresh(this.cachedData)) {
      this.startBuild(options.forceRefresh);
    }

    return {
      status: this.getStatus(),
      metadata: {
        sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
        minimumUtteranceWords: MIN_COMPARISON_UTTERANCE_WORDS,
        minimumMemberWords: MIN_MEMBER_WORDS_FOR_COMPARISON,
      },
      data: this.cachedData,
    };
  }

  startBuild(forceRefresh = false) {
    if (this.buildPromise) {
      return this.getStatus();
    }

    if (!forceRefresh && this.isCacheFresh(this.cachedData)) {
      this.status = {
        ...this.createIdleStatus(),
        status: "completed",
        finishedAt: this.cachedData.generatedAt,
        lastCompletedAt: this.cachedData.generatedAt,
      };
      return this.getStatus();
    }

    this.status = {
      ...this.createIdleStatus(),
      status: this.memberProtocolService.indexingPromise ? "waiting_for_member_index" : "running",
      startedAt: new Date().toISOString(),
      lastCompletedAt: this.status.lastCompletedAt || this.cachedData?.generatedAt || null,
    };

    this.buildPromise = this.runBuild()
      .catch((error) => {
        this.status.status = "failed";
        this.status.finishedAt = new Date().toISOString();
        this.status.current = null;
        this.status.recentErrors = [toErrorMessage(error)];
      })
      .finally(() => {
        this.buildPromise = null;
      });

    return this.getStatus();
  }

  findMemberBySpeakerLabel(normalizedSpeakerLabel) {
    return this.memberProtocolService.members.find((member) =>
      member.aliasMatchers.some((aliasMatcher) => aliasMatcher.regex.test(normalizedSpeakerLabel)),
    );
  }

  countTermMatches(normalizedText, comparison) {
    const termCounts = {};
    let totalHits = 0;

    for (const compiledTerm of comparison.compiledTerms) {
      let count = 0;
      compiledTerm.regex.lastIndex = 0;

      while (compiledTerm.regex.exec(normalizedText)) {
        count += 1;
      }

      if (count > 0) {
        termCounts[compiledTerm.term] = count;
        totalHits += count;
      }
    }

    return {
      totalHits,
      termCounts,
    };
  }

  buildEmptyAggregate(member) {
    return {
      slug: member.slug,
      routeSlug: member.id || member.slug,
      name: member.name,
      partyName: member.partyName,
      totalWords: 0,
      utteranceCount: 0,
      protocolCount: 0,
      comparisonHits: Object.fromEntries(
        this.comparisons.map((comparison) => [comparison.key, { totalHits: 0, termCounts: {} }]),
      ),
    };
  }

  async extractProtocolMemberStats(record) {
    const reference = record.reference;
    const store =
      reference.source === "committee"
        ? this.memberProtocolService.committeeProtocolStore
        : this.memberProtocolService.protocolStore;
    const content = await store.getProtocolContent(reference.documentId);
    const paragraphs = Array.isArray(content?.paragraphs) ? content.paragraphs : [];
    const memberStats = new Map();
    let activeMember = null;
    let activeParagraphs = [];

    const finalizeUtterance = () => {
      if (!activeMember || !activeParagraphs.length) {
        activeMember = null;
        activeParagraphs = [];
        return;
      }

      const text = activeParagraphs.join("\n\n").trim();
      const wordCount = countWords(text);

      if (wordCount < MIN_COMPARISON_UTTERANCE_WORDS) {
        activeMember = null;
        activeParagraphs = [];
        return;
      }

      const normalizedText = normalizeComparisonText(text);
      const current =
        memberStats.get(activeMember.slug) || {
          totalWords: 0,
          utteranceCount: 0,
          comparisonHits: Object.fromEntries(
            this.comparisons.map((comparison) => [
              comparison.key,
              { totalHits: 0, termCounts: {} },
            ]),
          ),
        };

      current.totalWords += wordCount;
      current.utteranceCount += 1;

      for (const comparison of this.comparisons) {
        const counted = this.countTermMatches(normalizedText, comparison);
        current.comparisonHits[comparison.key].totalHits += counted.totalHits;

        for (const [term, count] of Object.entries(counted.termCounts)) {
          current.comparisonHits[comparison.key].termCounts[term] =
            (current.comparisonHits[comparison.key].termCounts[term] || 0) + count;
        }
      }

      memberStats.set(activeMember.slug, current);
      activeMember = null;
      activeParagraphs = [];
    };

    for (const paragraph of paragraphs) {
      const speakerParagraph = parseSpeakerParagraph(paragraph);

      if (speakerParagraph) {
        finalizeUtterance();
        activeMember = this.findMemberBySpeakerLabel(speakerParagraph.normalizedSpeakerLabel);
        continue;
      }

      if (isProtocolMarkerParagraph(paragraph)) {
        finalizeUtterance();
        continue;
      }

      if (!activeMember) {
        continue;
      }

      const cleaned = cleanParagraph(paragraph);

      if (!cleaned) {
        continue;
      }

      activeParagraphs.push(cleaned);
    }

    finalizeUtterance();
    return memberStats;
  }

  buildMemberComparisonRows(aggregates, comparison) {
    return this.memberProtocolService.members
      .map((member) => {
        const aggregate = aggregates.get(member.slug) || this.buildEmptyAggregate(member);
        const comparisonHits = aggregate.comparisonHits[comparison.key];
        const eligible = aggregate.totalWords >= MIN_MEMBER_WORDS_FOR_COMPARISON;
        const ratePerThousandWords = eligible && aggregate.totalWords > 0
          ? Number(((comparisonHits.totalHits / aggregate.totalWords) * 1000).toFixed(2))
          : null;
        const topTerms = Object.entries(comparisonHits.termCounts)
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "he"))
          .slice(0, 5)
          .map(([term, count]) => ({ term, count }));

        return {
          slug: member.slug,
          routeSlug: member.id || member.slug,
          name: member.name,
          partyName: member.partyName,
          eligible,
          totalWords: aggregate.totalWords,
          utteranceCount: aggregate.utteranceCount,
          protocolCount: aggregate.protocolCount,
          rawHits: comparisonHits.totalHits,
          ratePerThousandWords,
          topTerms,
        };
      })
      .sort((left, right) => {
        if (left.eligible !== right.eligible) {
          return left.eligible ? -1 : 1;
        }

        const leftScore = left.ratePerThousandWords ?? -1;
        const rightScore = right.ratePerThousandWords ?? -1;

        if (rightScore !== leftScore) {
          return rightScore - leftScore;
        }

        return left.name.localeCompare(right.name, "he");
      });
  }

  buildPartyComparisonRows(memberRows) {
    const grouped = new Map();

    for (const row of memberRows) {
      if (!grouped.has(row.partyName)) {
        grouped.set(row.partyName, []);
      }

      grouped.get(row.partyName).push(row);
    }

    return [...grouped.entries()]
      .map(([partyName, rows]) => {
        const eligibleRows = rows.filter((row) => row.eligible && typeof row.ratePerThousandWords === "number");
        const averageRatePerThousandWords = eligibleRows.length
          ? Number(
              (
                eligibleRows.reduce((sum, row) => sum + row.ratePerThousandWords, 0) / eligibleRows.length
              ).toFixed(2),
            )
          : null;
        const topMember = eligibleRows[0] || rows[0] || null;

        return {
          partyName,
          memberCount: rows.length,
          eligibleMembers: eligibleRows.length,
          averageRatePerThousandWords,
          totalWords: eligibleRows.reduce((sum, row) => sum + row.totalWords, 0),
          totalRawHits: eligibleRows.reduce((sum, row) => sum + row.rawHits, 0),
          topMember: topMember
            ? {
                name: topMember.name,
                routeSlug: topMember.routeSlug,
                ratePerThousandWords: topMember.ratePerThousandWords,
              }
            : null,
        };
      })
      .sort((left, right) => {
        const leftScore = left.averageRatePerThousandWords ?? -1;
        const rightScore = right.averageRatePerThousandWords ?? -1;

        if (rightScore !== leftScore) {
          return rightScore - leftScore;
        }

        return left.partyName.localeCompare(right.partyName, "he");
      });
  }

  async runBuild() {
    await this.memberProtocolService.startIndexing();

    if (this.memberProtocolService.indexingPromise) {
      this.status.status = "waiting_for_member_index";
      await this.memberProtocolService.indexingPromise;
    }

    const protocolRecords = Object.values(this.memberProtocolService.cache?.protocols || {}).filter(
      (record) => record && record.reference && Array.isArray(record.matches) && record.matches.length > 0,
    );

    this.status.status = "running";
    this.status.totalProtocols = protocolRecords.length;
    this.status.processedProtocols = 0;
    this.status.current = null;
    this.status.recentErrors = [];

    const aggregates = new Map(
      this.memberProtocolService.members.map((member) => [member.slug, this.buildEmptyAggregate(member)]),
    );

    await mapWithConcurrency(protocolRecords, PROTOCOL_SCAN_CONCURRENCY, async (record) => {
      this.status.current = {
        documentId: record.reference.documentId,
        title: record.reference.title,
        source: record.reference.source,
        shortDateLabel: record.reference.shortDateLabel,
      };

      try {
        const protocolStats = await this.extractProtocolMemberStats(record);

        for (const [memberSlug, stats] of protocolStats.entries()) {
          const aggregate = aggregates.get(memberSlug);

          if (!aggregate) {
            continue;
          }

          aggregate.totalWords += stats.totalWords;
          aggregate.utteranceCount += stats.utteranceCount;
          aggregate.protocolCount += 1;

          for (const comparison of this.comparisons) {
            const targetHits = aggregate.comparisonHits[comparison.key];
            const sourceHits = stats.comparisonHits[comparison.key];
            targetHits.totalHits += sourceHits.totalHits;

            for (const [term, count] of Object.entries(sourceHits.termCounts)) {
              targetHits.termCounts[term] = (targetHits.termCounts[term] || 0) + count;
            }
          }
        }
      } catch (error) {
        this.status.recentErrors = [
          `${record.reference.documentId}: ${toErrorMessage(error)}`,
          ...this.status.recentErrors,
        ].slice(0, 10);
      } finally {
        this.status.processedProtocols += 1;
      }
    });

    const comparisonPayloads = this.comparisons.map((comparison) => {
      const memberRows = this.buildMemberComparisonRows(aggregates, comparison);
      const partyRows = this.buildPartyComparisonRows(memberRows);

      return {
        key: comparison.key,
        title: comparison.title,
        shortDescription: comparison.shortDescription,
        methodology: comparison.methodology,
        terms: comparison.terms,
        scaleLabel: "אזכורים לכל 1,000 מילים מדוברות",
        topMember: memberRows.find((row) => row.eligible) || null,
        topParty: partyRows.find((row) => row.averageRatePerThousandWords !== null) || null,
        memberRows,
        partyRows,
      };
    });

    const generatedAt = new Date().toISOString();
    const payload = {
      version: COMPARISON_CACHE_VERSION,
      generatedAt,
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
      minimumUtteranceWords: MIN_COMPARISON_UTTERANCE_WORDS,
      minimumMemberWords: MIN_MEMBER_WORDS_FOR_COMPARISON,
      sourceIndexUpdatedAt: this.memberProtocolService.cache?.updatedAt || null,
      overview: {
        protocolCount: protocolRecords.length,
        memberCount: this.memberProtocolService.members.length,
        eligibleMemberCount: this.memberProtocolService.members.filter(
          (member) => (aggregates.get(member.slug)?.totalWords || 0) >= MIN_MEMBER_WORDS_FOR_COMPARISON,
        ).length,
      },
      comparisons: comparisonPayloads,
    };

    await writeJson(this.cacheFile, payload);
    this.promotionService?.requestPromotion("memberComparisons");
    this.cachedData = payload;
    this.status.status = this.status.recentErrors.length ? "completed_with_errors" : "completed";
    this.status.finishedAt = generatedAt;
    this.status.lastCompletedAt = generatedAt;
    this.status.current = null;
  }
}

module.exports = {
  COMPARISON_DEFINITIONS,
  MIN_COMPARISON_UTTERANCE_WORDS,
  MIN_MEMBER_WORDS_FOR_COMPARISON,
  MemberComparisonService,
};
