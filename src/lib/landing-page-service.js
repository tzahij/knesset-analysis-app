const path = require("path");
const { LAW_AXIS_DEFINITIONS } = require("./law-analysis-service");
const {
  hasInsufficientVoteCoverage,
  MIN_SUBSTANTIATED_VOTE_COUNT,
} = require("./member-vote-profile-service");
const { fileExists, mapWithConcurrency, readJson, toErrorMessage, writeJson } = require("./utils");

const DEFAULT_SPOTLIGHT_CACHE_TTL_MS = 1000 * 60 * 30;

function sortSurprisingLawItems(left, right) {
  if ((right.surprisingVoteCount || 0) !== (left.surprisingVoteCount || 0)) {
    return (right.surprisingVoteCount || 0) - (left.surprisingVoteCount || 0);
  }

  if ((right.maximumDifference || 0) !== (left.maximumDifference || 0)) {
    return (right.maximumDifference || 0) - (left.maximumDifference || 0);
  }

  return (right.dateSortValue || 0) - (left.dateSortValue || 0);
}

function pickHighlightedQuote(analysis) {
  const groups = [
    analysis?.highlightedQuotes?.surprisingInnerWorldOrHistory?.quotes,
    analysis?.highlightedQuotes?.innermostEmotions?.quotes,
    analysis?.highlightedQuotes?.benevolentTowardOthers?.quotes,
  ];

  for (const group of groups) {
    if (Array.isArray(group) && group.length) {
      return group[0];
    }
  }

  return null;
}

function shuffleItems(items = []) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temporary = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = temporary;
  }

  return shuffled;
}

const KNOW_YOUR_MK_VIEW_CONFIG = {
  explicit: {
    key: "explicit",
    label: "עמדות מפורשות",
    shortLabel: "מפורש",
    eyebrow: "על סמך הטקסט",
    disclaimer:
      "התצוגה הזו מציגה את חברי הכנסת רק לפי מה שהם אומרים במפורש בציטוטים שנותחו. היא אינה כוללת קריאה בין השורות.",
    methodology: [
      "כאן נספרות רק העמדות שחבר הכנסת מבטא ישירות ובאופן מוצהר בציטוטים שנותחו.",
      "זו התצוגה המתאימה ביותר להבנת האופן שבו חברי הכנסת מציגים את עצמם ואת עמדותיהם בפומבי.",
    ],
    analysisPath: "textBased",
  },
  implicit: {
    key: "implicit",
    label: "עמדות משתמעות",
    shortLabel: "משתמע",
    eyebrow: "בין השורות",
    disclaimer:
      "התצוגה הזו מציגה את חברי הכנסת לפי ההערכה המשתמעת שנגזרה מן הניתוח השמור שלהם בין השורות. היא משקפת מיקום אידיאולוגי מוסק, לא רק את מה שנאמר במפורש.",
    methodology: [
      "השכבה הזו נשענת על ניתוח הפרופיל הקיים של מה שחבר הכנסת מרמז, מסמן, נמנע מלומר במפורש או חושף בעקיפין.",
      "זו תצוגה פרשנית יותר מן התצוגה המפורשת, ולכן צריך לקרוא אותה כהערכת עומק ולא כאוסף ציטוטים ישירים בלבד.",
    ],
    analysisPath: "betweenTheLines",
  },
  votesBased: {
    key: "votesBased",
    label: "מבוסס הצבעות",
    shortLabel: "הצבעות",
    eyebrow: "מבוסס הצבעות",
    disclaimer:
      "התצוגה הזו ממקמת את חברי הכנסת לפי החוקים שבהם הצביעו בעד או נגד. בהצבעה בעד נספר ציון החוק כפי שהוא, ובהצבעה נגד נספר 11 פחות ציון החוק, חוץ ממקרה שבו ציון החוק הוא 5 ואז הוא נשאר 5, ולכן התוצאה משקפת את דפוס ההצבעה בפועל ולא רק הצהרה מילולית.",
    methodology: [
      "כאן נספרים רק חוקים שיש להם גם מפת הצבעה שמית וגם ניתוח צירים שמור, במקרים שבהם חבר הכנסת הצביע בעד או נגד החוק.",
      "בהצבעה בעד נספר ציון החוק כפי שהוא, ובהצבעה נגד נספר 11 פחות ציון החוק, חוץ ממקרה שבו ציון החוק הוא 5 ואז הוא נשאר 5. לכן זו תצוגה של התנהגות הצבעה בפועל ולא של מסר גלוי או פרשנות בין השורות.",
    ],
  },
};

KNOW_YOUR_MK_VIEW_CONFIG.votesBased.disclaimer =
  "התצוגה הזו ממקמת את חברי הכנסת לפי החוקים שבהם הצביעו בעד או נגד. בכל ציר מחושב ממוצע רק מתוך החוקים הרלוונטיים לאותו ציר, ובהצבעה נגד ציון החוק מומר ל-11 פחות ציון החוק, חוץ ממקרה שבו ציון החוק הוא 5 ואז הוא נשאר 5. פרופילים שמבוססים על פחות מחמש הצבעות מסומנים בנפרד, כי הם עדיין לא מבוססים היטב וצריך לקרוא אותם בזהירות.";
KNOW_YOUR_MK_VIEW_CONFIG.votesBased.methodology = [
  "כאן נספרים רק חוקים שיש להם גם מפת הצבעה שמית וגם ניתוח צירים שמור, במקרים שבהם חבר הכנסת הצביע בעד או נגד החוק.",
  "בכל ציר מוציאים מהממוצע חוקים שקיבלו בדיוק 5/10 לאחר חישוב כיוון ההצבעה, אם קיימים באותו ציר גם חוקים שנוטים באופן ברור יותר לאחד הקטבים.",
  "לכן זו תצוגה של דפוס ההצבעה בפועל על חוקים רלוונטיים לכל ציר, ולא רק ממוצע גולמי של חוקים שנכללו בפרופיל ההצבעות.",
  `כשפרופיל ההצבעות נשען על פחות מ-${MIN_SUBSTANTIATED_VOTE_COUNT.toLocaleString("he-IL")} הצבעות, הוא מוצג עם אזהרה בולטת כי הממצאים עדיין חלקיים.`,
];

function hasCompletedKnowYourMkAxisAnalysis(record) {
  return Boolean(
    record?.status?.status === "completed" &&
      record?.analysis?.quantitativeAnalysis?.textBased &&
      record?.analysis?.quantitativeAnalysis?.betweenTheLines,
  );
}

function sortKnowYourMkMembers(left, right) {
  if ((left.partyName || "") !== (right.partyName || "")) {
    return String(left.partyName || "").localeCompare(String(right.partyName || ""), "he");
  }

  return String(left.name || "").localeCompare(String(right.name || ""), "he");
}

function buildKnowYourMkAxisEntry(axisRecord) {
  return {
    score: Number(axisRecord?.score || 0),
    bucketScore: Number(axisRecord?.bucketScore || Math.round(Number(axisRecord?.score || 0))),
    explanationBullets: Array.isArray(axisRecord?.explanationBullets)
      ? axisRecord.explanationBullets.slice(0, 3)
      : [],
    evidence: Array.isArray(axisRecord?.evidence)
      ? axisRecord.evidence.slice(0, 2).map((item) => ({
          quote: item.quote || "",
          protocolHeading: item.protocolHeading || "",
          explanation: item.explanation || "",
          href: item.href || "",
        }))
      : [],
  };
}

function hasCompleteKnowYourMkAxisSet(axisMap) {
  return LAW_AXIS_DEFINITIONS.every((axis) => {
    const score = Number(axisMap?.[axis.key]?.score || 0);
    return Number.isFinite(score) && score >= 1 && score <= 10;
  });
}

function buildMouthHeartGapPayload(records) {
  const items = records
    .map((member) => {
      const explicitAxes = member?.axes?.explicit;
      const votesBasedAxes = member?.axes?.votesBased;

      if (!hasCompleteKnowYourMkAxisSet(explicitAxes) || !hasCompleteKnowYourMkAxisSet(votesBasedAxes)) {
        return null;
      }

      const axisDifferences = LAW_AXIS_DEFINITIONS.map((axis) => {
        const explicitScore = Number(explicitAxes?.[axis.key]?.score || 0);
        const votesScore = Number(votesBasedAxes?.[axis.key]?.score || 0);
        const difference = Number(Math.abs(votesScore - explicitScore).toFixed(1));

        return {
          key: axis.key,
          label: axis.label,
          lowLabel: axis.lowLabel,
          highLabel: axis.highLabel,
          explicitScore,
          votesScore,
          difference,
        };
      }).sort((left, right) => {
        if ((right.difference || 0) !== (left.difference || 0)) {
          return (right.difference || 0) - (left.difference || 0);
        }

        return String(left.label || "").localeCompare(String(right.label || ""), "he");
      });

      const totalDifference = Number(
        axisDifferences.reduce((sum, axis) => sum + Number(axis.difference || 0), 0).toFixed(1),
      );
      const averageDifference = Number((totalDifference / LAW_AXIS_DEFINITIONS.length).toFixed(1));
      const maximumDifference = Number(axisDifferences[0]?.difference || 0);

      return {
        routeSlug: member.routeSlug,
        slug: member.slug,
        name: member.name,
        partyName: member.partyName || "",
        href: member.href,
        voteProfileCountedLawCount: Number(
          member?.voteProfile?.countedLawCount ?? member?.voteProfile?.supportedLawCount ?? 0,
        ),
        isLowSubstantiation: Boolean(member?.voteProfile?.isLowSubstantiation),
        substantiationWarning: member?.voteProfile?.substantiationWarning || "",
        totalDifference,
        averageDifference,
        maximumDifference,
        strongestAxis: axisDifferences[0] || null,
        axisDifferences,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if ((right.totalDifference || 0) !== (left.totalDifference || 0)) {
        return (right.totalDifference || 0) - (left.totalDifference || 0);
      }

      if ((right.maximumDifference || 0) !== (left.maximumDifference || 0)) {
        return (right.maximumDifference || 0) - (left.maximumDifference || 0);
      }

      return String(left.name || "").localeCompare(String(right.name || ""), "he");
    });

  return {
    comparedMembers: items.length,
    methodology: [
      "המדד הזה משווה בין ציוני העמדות המפורשות של חבר הכנסת לבין ציוני מבוסס ההצבעות שלו.",
      "לכל חבר כנסת נספר הפער המוחלט בכל אחד מארבעת הצירים, ואז מחושב פער כולל שהוא סכום הפערים בין הדיבור לבין דפוס ההצבעה בפועל.",
      "ככל שהפער הכולל גבוה יותר, כך חבר הכנסת מדורג גבוה יותר במדור אחד בפה - אחד בלב.",
    ],
    items,
  };
}

class LandingPageService {
  constructor(options = {}) {
    this.protocolStore = options.protocolStore;
    this.committeeProtocolStore = options.committeeProtocolStore;
    this.lawStore = options.lawStore;
    this.lawSurpriseVoteService = options.lawSurpriseVoteService;
    this.memberProtocolService = options.memberProtocolService;
    this.memberAnalysisService = options.memberAnalysisService;
    this.memberContactDirectoryService = options.memberContactDirectoryService || null;
    this.memberComparisonService = options.memberComparisonService;
    this.memberVoteProfileService = options.memberVoteProfileService;
    this.dataDir = options.dataDir || path.join(process.cwd(), "data");
    this.spotlightCachePath =
      options.spotlightCachePath || path.join(this.dataDir, "landing-spotlight.json");
    this.spotlightCacheTtlMs =
      Number.isFinite(Number(options.spotlightCacheTtlMs)) && Number(options.spotlightCacheTtlMs) > 0
        ? Number(options.spotlightCacheTtlMs)
        : DEFAULT_SPOTLIGHT_CACHE_TTL_MS;
    this.spotlightCache = null;
    this.spotlightBuildPromise = null;
    this.spotlightCacheLoaded = false;
  }

  async loadPersistedSpotlightCache() {
    if (this.spotlightCacheLoaded) {
      return this.spotlightCache;
    }

    this.spotlightCacheLoaded = true;

    if (!(await fileExists(this.spotlightCachePath))) {
      return null;
    }

    try {
      const payload = await readJson(this.spotlightCachePath);

      if (payload && typeof payload === "object") {
        this.spotlightCache = payload;
      }
    } catch (error) {
      console.warn("Unable to read spotlight cache:", error?.message || String(error));
    }

    return this.spotlightCache;
  }

  isSpotlightCacheFresh(payload = this.spotlightCache) {
    if (!payload?.generatedAt) {
      return false;
    }

    const generatedAt = Date.parse(payload.generatedAt);

    if (!Number.isFinite(generatedAt)) {
      return false;
    }

    if (Date.now() - generatedAt > this.spotlightCacheTtlMs) {
      return false;
    }

    if (payload?.status !== "ready") {
      return true;
    }

    return !hasInsufficientVoteCoverage(payload?.voteProfile);
  }

  async refreshSpotlightCache() {
    await this.loadPersistedSpotlightCache();

    if (this.spotlightBuildPromise) {
      return this.spotlightBuildPromise;
    }

    this.spotlightBuildPromise = (async () => {
      const payload = {
        ...(await this.buildSpotlightMember()),
        generatedAt: new Date().toISOString(),
      };

      this.spotlightCache = payload;
      await writeJson(this.spotlightCachePath, payload);
      return payload;
    })().finally(() => {
      this.spotlightBuildPromise = null;
    });

    return this.spotlightBuildPromise;
  }

  async getSpotlightPayload() {
    await this.loadPersistedSpotlightCache();

    if (this.isSpotlightCacheFresh()) {
      return this.spotlightCache;
    }

    if (this.spotlightCache?.status === "ready" && hasInsufficientVoteCoverage(this.spotlightCache?.voteProfile)) {
      return this.refreshSpotlightCache();
    }

    if (this.spotlightCache) {
      void this.refreshSpotlightCache().catch((error) => {
        console.warn("Unable to refresh spotlight cache:", error?.message || String(error));
      });
      return this.spotlightCache;
    }

    return this.refreshSpotlightCache();
  }

  async warmSpotlightCache() {
    await this.loadPersistedSpotlightCache();

    if (this.isSpotlightCacheFresh()) {
      return this.spotlightCache;
    }

    return this.refreshSpotlightCache();
  }

  buildCategoryCards(context) {
    return [
      {
        key: "plenum",
        title: "Plenum Protocols",
        hebrewTitle: "ישיבות מליאה",
        description: "פרוטוקולים רשמיים של מליאת הכנסת, עם עמוד קריאה ייעודי והורדת הקובץ המקורי.",
        count: context.plenumCount,
        unitLabel: "פרוטוקולים",
        href: "#source-tabs",
        sourceKey: "plenum",
        tone: "plenum",
      },
      {
        key: "committee",
        title: "Committee Protocols",
        hebrewTitle: "ישיבות ועדות הכנסת",
        description: "דיוני ועדות מהחמש השנים האחרונות, עם סינון לפי סוג ועדה ולפי שם הוועדה.",
        count: context.committeeCount,
        unitLabel: "פרוטוקולים",
        href: "#source-tabs",
        sourceKey: "committee",
        tone: "committee",
      },
      {
        key: "laws",
        title: "Third-Reading Laws",
        hebrewTitle: "חוקים בקריאה שלישית",
        description:
          "החוקים האחרונים שאושרו בקריאה שלישית, כולל נוסח קריא, הורדות, מפת הצבעות וניתוח אידיאולוגי.",
        count: context.lawCount,
        unitLabel: "חוקים",
        href: "#source-tabs",
        sourceKey: "laws",
        tone: "laws",
      },
      {
        key: "votes",
        title: "Surprising Votes",
        hebrewTitle: "הצבעות מפתיעות",
        description:
          "חוקים שבהם הצבעות התמיכה התנגשו באופן חד עם הפרופיל האידיאולוגי המחושב של חברי הכנסת.",
        count: context.surprisingLawCount,
        unitLabel: "חוקים",
        href: "#source-tabs",
        sourceKey: "laws",
        lawMode: "surprising",
        tone: "votes",
      },
      {
        key: "members",
        title: "MK Profiles",
        hebrewTitle: "חברי הכנסת",
        description:
          "עמודי פרופיל לכל חבר כנסת, עם פרוטוקולים, קובצי אמירות, ניתוחי פרופיל וראיות בולטות.",
        count: context.memberCount,
        unitLabel: "עמודים",
        href: "/members",
        tone: "members",
      },
      {
        key: "contact-directory",
        title: "Action Directory",
        hebrewTitle: "דברו עם הנציגים שלכם!",
        description:
          "ספריית קשר מהירה לכל חברי הכנסת, עם אייקונים לחיצים למייל, טלפון, וואטסאפ ורשתות חברתיות.",
        count: context.memberCount,
        unitLabel: "חברי כנסת",
        href: "/talk-to-your-representatives",
        tone: "contact",
      },
      {
        key: "comparisons",
        title: "Data Comparisons",
        hebrewTitle: "נתונים והשוואות",
        description:
          "השוואות קוד קשיח בין מפלגות וחברי כנסת על נושאים ציבוריים מרכזיים בישראל.",
        count: context.comparisonCount,
        unitLabel: "מדדים",
        href: "/comparisons",
        tone: "comparisons",
      },
    ];
  }

  buildNewsline(surprisingVotesPayload) {
    const items = [...(surprisingVotesPayload?.items || [])]
      .sort(sortSurprisingLawItems)
      .slice(0, 8)
      .map((law, index) => ({
        rank: index + 1,
        billId: law.billId,
        title: law.title,
        shortDateLabel: law.shortDateLabel,
        longDateLabel: law.longDateLabel,
        href: `/law/${encodeURIComponent(law.billId)}`,
        surprisingVoteCount: law.surprisingVoteCount,
        maximumDifference: law.maximumDifference,
        topSurprisingMembers: Array.isArray(law.topSurprisingMembers)
          ? law.topSurprisingMembers.slice(0, 3)
          : [],
      }));

    return {
      summary: surprisingVotesPayload?.summary || null,
      threshold: surprisingVotesPayload?.threshold || null,
      methodology: Array.isArray(surprisingVotesPayload?.methodology)
        ? surprisingVotesPayload.methodology
        : [],
      items,
    };
  }

  async buildSpotlightMember() {
    const candidates = shuffleItems(this.memberProtocolService.members || []);

    for (const candidate of candidates) {
      const [analysisRecord, voteProfile] = await Promise.all([
        this.memberAnalysisService.getMemberAnalysisRecord(candidate.slug, "small"),
        this.memberVoteProfileService.getStoredMemberVoteProfile(candidate.slug),
      ]);

      if (analysisRecord?.status?.status !== "completed" || !analysisRecord.analysis?.overallProfile) {
        continue;
      }

      if (hasInsufficientVoteCoverage(voteProfile)) {
        continue;
      }

      const protocols = this.memberProtocolService.getSortedProtocolsForMember(candidate.slug);
      const highlightedQuote = pickHighlightedQuote(analysisRecord.analysis);
      const [primaryContactRecord, fallbackContactRecord] = await Promise.all([
        this.memberContactDirectoryService?.getMemberContactDetails?.(candidate.id || candidate.slug) || null,
        this.memberContactDirectoryService?.getMemberContactDetails?.(candidate.slug) || null,
      ]);
      const contactRecord =
        primaryContactRecord?.hasContacts
          ? primaryContactRecord
          : fallbackContactRecord?.hasContacts
            ? fallbackContactRecord
            : null;
      const spotlightContacts = Array.isArray(contactRecord?.contacts)
        ? contactRecord.contacts
            .filter((contact) => String(contact?.href || "").trim())
            .slice(0, 6)
            .map((contact) => ({
              id: contact.id || "",
              platform: contact.platform || "",
              href: contact.href || "",
            }))
        : [];

      return {
        status: "ready",
        member: {
          slug: candidate.slug,
          routeSlug: candidate.id || candidate.slug,
          name: candidate.name,
          partyName: candidate.partyName,
          href: `/members/${encodeURIComponent(candidate.id || candidate.slug)}`,
        },
        summary: analysisRecord.analysis.overallProfile?.bluntProfile?.paragraph || "",
        historicalContext: analysisRecord.analysis.overallProfile?.historicalContext?.paragraph || "",
        highlightedQuote: highlightedQuote
          ? {
              quote: highlightedQuote.quote,
              protocolHeading: highlightedQuote.protocolHeading,
              explanation: highlightedQuote.explanation,
            }
          : null,
        stats: {
          protocolCount: protocols.length,
          plenumProtocols: protocols.filter((protocol) => protocol.source === "plenum").length,
          committeeProtocols: protocols.filter((protocol) => protocol.source === "committee").length,
        },
        contacts: spotlightContacts,
        voteProfile: {
          countedLawCount: Number(voteProfile?.countedLawCount ?? voteProfile?.supportedLawCount ?? 0),
          minimumSubstantiatedVoteCount: Number(
            voteProfile?.minimumSubstantiatedVoteCount || MIN_SUBSTANTIATED_VOTE_COUNT,
          ),
          hasInsufficientVoteCoverage: Boolean(voteProfile?.hasInsufficientVoteCoverage),
          isLowSubstantiation: Boolean(voteProfile?.isLowSubstantiation),
          substantiationWarning: voteProfile?.substantiationWarning || "",
        },
        axes: LAW_AXIS_DEFINITIONS.map((axis) => ({
          key: axis.key,
          label: axis.label,
          lowLabel: axis.lowLabel,
          highLabel: axis.highLabel,
          directScore: analysisRecord.analysis?.quantitativeAnalysis?.textBased?.[axis.key]?.score || null,
          voteScore: voteProfile?.status === "ready" ? voteProfile?.axes?.[axis.key]?.score || null : null,
        })),
      };
    }

    return {
      status: "missing",
    };
  }

  async buildKnowYourMkPayload() {
    const members = [...this.memberProtocolService.members];
    const [voteProfileSummary, voteProfilePayload] = await Promise.all([
      this.memberVoteProfileService.getSummary(),
      this.memberVoteProfileService.buildProfiles(),
    ]);
    const voteProfileData = {
      summary: voteProfileSummary,
      profilesBySlug: voteProfilePayload.profilesBySlug,
    };

    const records = (
      await mapWithConcurrency(members, 6, async (member) => {
        const preferredRecord = await this.memberAnalysisService.getMemberAnalysisRecord(member.slug, "small");
        const fallbackRecord = hasCompletedKnowYourMkAxisAnalysis(preferredRecord)
          ? null
          : await this.memberAnalysisService.getMemberAnalysisRecord(member.slug, "full");
        const record = hasCompletedKnowYourMkAxisAnalysis(preferredRecord)
          ? preferredRecord
          : hasCompletedKnowYourMkAxisAnalysis(fallbackRecord)
            ? fallbackRecord
            : null;

        const voteProfile = voteProfileData.profilesBySlug.get(member.slug) || null;

        if (!record && !voteProfile) {
          return null;
        }

        return {
          routeSlug: member.id || member.slug,
          slug: member.slug,
          name: member.name,
          partyName: member.partyName || "",
          href: `/members/${encodeURIComponent(member.id || member.slug)}`,
          sourceType: record?.status?.sourceType || "small",
          sourceLabel:
            (record?.status?.sourceType || "small") === "small" ? "הקובץ הקטן" : "הקובץ המלא",
          overallSummary: record?.analysis?.overallProfile?.bluntProfile?.paragraph || "",
          voteProfile: voteProfile
            ? {
                sourceLabel: voteProfile.sourceLabel,
                summary: voteProfile.summary,
                countedLawCount: Number(voteProfile.countedLawCount ?? voteProfile.supportedLawCount ?? 0),
                minimumSubstantiatedVoteCount: Number(
                  voteProfile.minimumSubstantiatedVoteCount || MIN_SUBSTANTIATED_VOTE_COUNT,
                ),
                hasInsufficientVoteCoverage: Boolean(voteProfile.hasInsufficientVoteCoverage),
                isLowSubstantiation: Boolean(voteProfile.isLowSubstantiation),
                substantiationWarning: voteProfile.substantiationWarning || "",
                countedLaws: Array.isArray(voteProfile.countedLaws)
                  ? voteProfile.countedLaws.slice(0, 8)
                  : voteProfile.supportedLaws.slice(0, 8),
                supportedLawCount: voteProfile.supportedLawCount,
                supportedLaws: voteProfile.supportedLaws.slice(0, 8),
              }
            : null,
          axes: Object.fromEntries(
            Object.values(KNOW_YOUR_MK_VIEW_CONFIG).map((view) => [
              view.key,
              Object.fromEntries(
                LAW_AXIS_DEFINITIONS.map((axis) => [
                  axis.key,
                  view.analysisPath
                    ? buildKnowYourMkAxisEntry(
                        record?.analysis?.quantitativeAnalysis?.[view.analysisPath]?.[axis.key],
                      )
                    : buildKnowYourMkAxisEntry(voteProfile?.axes?.[axis.key]),
                ]),
              ),
            ]),
          ),
        };
      })
    )
      .filter(Boolean)
      .sort(sortKnowYourMkMembers);
    const quoteReadyRecords = records.filter((member) =>
      LAW_AXIS_DEFINITIONS.every((axis) => Number(member.axes?.explicit?.[axis.key]?.score || 0) >= 1),
    );

    const partyOptions = Array.from(
      new Set(records.map((member) => member.partyName).filter(Boolean)),
    ).sort((left, right) => String(left).localeCompare(String(right), "he"));
    const sourceBreakdown = quoteReadyRecords.reduce(
      (accumulator, member) => {
        if (member.sourceType === "small") {
          accumulator.small += 1;
        } else {
          accumulator.full += 1;
        }

        return accumulator;
      },
      { small: 0, full: 0 },
    );

    return {
      generatedAt: new Date().toISOString(),
      methodology: [
        "מקור ברירת המחדל הוא הניתוח מהקובץ הקטן; אם הוא חסר, המערכת משתמשת בניתוח מהקובץ המלא.",
        "כל חבר כנסת ממופה בנפרד על פני ארבעת הצירים, והטוקן שלו ממוקם לפי ציון מספרי בין 1 ל-10.",
        "לחיצה על חבר כנסת פותחת חלונית הסבר לציר שנבחר, עם נימוקים קצרים וראיות תומכות.",
      ],
      views: Object.fromEntries(
        Object.values(KNOW_YOUR_MK_VIEW_CONFIG).map((view) => [
          view.key,
          {
            key: view.key,
            label: view.label,
            shortLabel: view.shortLabel,
            eyebrow: view.eyebrow,
            disclaimer: view.disclaimer,
            methodology: view.methodology,
          },
        ]),
      ),
      summary: {
        totalMembers: members.length,
        availableMembers: quoteReadyRecords.length,
        missingMembers: Math.max(0, members.length - quoteReadyRecords.length),
        smallSourceMembers: sourceBreakdown.small,
        fullSourceMembers: sourceBreakdown.full,
        voteBasedMembers: Number(voteProfileData.summary?.availableMembers || 0),
        voteBasedProfiledLaws: Number(voteProfileData.summary?.profiledLawCount || 0),
        voteBasedCountedVotes: Number(voteProfileData.summary?.countedVotesCount || 0),
        voteBasedSupportVotes: Number(voteProfileData.summary?.supportVotesCount || 0),
        lowSubstantiationVoteBasedMembers: records.filter((member) => member?.voteProfile?.isLowSubstantiation).length,
      },
      axes: LAW_AXIS_DEFINITIONS.map((axis) => ({
        key: axis.key,
        label: axis.label,
        lowLabel: axis.lowLabel,
        highLabel: axis.highLabel,
      })),
      filters: {
        parties: partyOptions,
      },
      mouthHeartGap: buildMouthHeartGapPayload(records),
      members: records,
    };
  }

  async getLandingPayload() {
    const [plenumProtocols, committeeProtocols, laws, surprisingVotesPayload] =
      await Promise.all([
        this.protocolStore.getProtocols(),
        this.committeeProtocolStore.getProtocols(),
        this.lawStore.getLaws(),
        this.lawSurpriseVoteService.getLawsWithSurprisingVotes(),
      ]);
    let quoteFeed = [];

    try {
      quoteFeed = await this.memberProtocolService.getRecentQuotesFeed(24);
    } catch (error) {
      console.warn("Unable to build landing quote feed:", toErrorMessage(error));
    }

    const context = {
      plenumCount: plenumProtocols.length,
      committeeCount: committeeProtocols.length,
      lawCount: laws.length,
      surprisingLawCount: surprisingVotesPayload?.summary?.lawsWithSurprisingVotes || 0,
      memberCount: this.memberProtocolService.members.length,
      comparisonCount: Array.isArray(this.memberComparisonService.comparisons)
        ? this.memberComparisonService.comparisons.length
        : 0,
    };

    return {
      generatedAt: new Date().toISOString(),
      categories: this.buildCategoryCards(context),
      overview: context,
      newsline: this.buildNewsline(surprisingVotesPayload),
      quoteFeed: {
        count: quoteFeed.length,
        items: quoteFeed,
      },
    };
  }
}

module.exports = {
  KNOW_YOUR_MK_VIEW_CONFIG,
  LandingPageService,
};
