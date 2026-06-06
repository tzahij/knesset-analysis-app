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
const { MEMBER_PROTOCOL_SINCE_DATE } = require("./member-registry");

const ANALYSIS_VERSION = 7;
const ANALYSIS_CONCURRENCY = 1;
const MAX_DIRECT_ANALYSIS_CHARS = Number(process.env.MEMBER_ANALYSIS_MAX_DIRECT_CHARS) || 120000;
const MAX_CHUNK_ANALYSIS_CHARS = Number(process.env.MEMBER_ANALYSIS_MAX_CHUNK_CHARS) || 70000;

const ANALYSIS_SOURCE_TYPES = {
  full: {
    key: "full",
    label: "הקובץ המלא",
    fileLabel: "analysis-full",
    sourceDescription: "קובץ האמירות המלא, המבוסס על כלל הפרוטוקולים הרלוונטיים",
  },
  small: {
    key: "small",
    label: "הקובץ הקטן",
    fileLabel: "analysis-small",
    sourceDescription: "קובץ האמירות הקטן, המבוסס רק על עשרת הפרוטוקולים האחרונים עם ציטוטים בני 50 מילים ומעלה",
  },
};

function normalizeAnalysisSourceType(value) {
  return String(value || "").trim().toLowerCase() === "small" ? "small" : "full";
}

function getAnalysisSourceMeta(value) {
  return ANALYSIS_SOURCE_TYPES[normalizeAnalysisSourceType(value)];
}

function buildAnalysisRuntimeKey(slug, sourceType) {
  return `${slug}::${normalizeAnalysisSourceType(sourceType)}`;
}

const AXIS_LABELS = {
  religiousSecular: "דתי מול חילוני",
  socialismCapitalism: "סוציאליזם מול קפיטליזם",
  doveHawk: "יוני מול נצי",
  liberalDemocracyAuthoritarianism: "דמוקרטיה ליברלית מול סמכותנות",
};

function buildEvidenceSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["quote", "protocolHeading", "explanation"],
    properties: {
      quote: {
        type: "string",
      },
      protocolHeading: {
        type: "string",
      },
      explanation: {
        type: "string",
      },
    },
  };
}

function buildInsightSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["point", "evidence"],
    properties: {
      point: {
        type: "string",
      },
      evidence: {
        type: "array",
        items: buildEvidenceSchema(),
      },
    },
  };
}

function buildBulletGroupSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["bullets"],
    properties: {
      bullets: {
        type: "array",
        items: buildInsightSchema(),
      },
    },
  };
}

function buildReadingLayerSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["coreStances", "psychologicalProfile", "clashesAndIncongruencies"],
    properties: {
      coreStances: buildBulletGroupSchema(),
      psychologicalProfile: buildBulletGroupSchema(),
      clashesAndIncongruencies: buildBulletGroupSchema(),
    },
  };
}

function buildAxisSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["score", "explanationBullets", "evidence"],
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
      evidence: {
        type: "array",
        items: buildEvidenceSchema(),
      },
    },
  };
}

function buildSummaryParagraphSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["paragraph", "evidence"],
    properties: {
      paragraph: {
        type: "string",
      },
      evidence: {
        type: "array",
        items: buildEvidenceSchema(),
      },
    },
  };
}

function buildHighlightedQuoteGroupSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["quotes"],
    properties: {
      quotes: {
        type: "array",
        items: buildEvidenceSchema(),
      },
    },
  };
}

const FINAL_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["analysisSections", "quantitativeAnalysis"],
  properties: {
    analysisSections: {
      type: "object",
      additionalProperties: false,
      required: ["textBased", "betweenTheLines"],
      properties: {
        textBased: buildReadingLayerSchema(),
        betweenTheLines: buildReadingLayerSchema(),
      },
    },
    quantitativeAnalysis: {
      type: "object",
      additionalProperties: false,
      required: ["textBased", "betweenTheLines"],
      properties: {
        textBased: {
          type: "object",
          additionalProperties: false,
          required: [
            "religiousSecular",
            "socialismCapitalism",
            "doveHawk",
            "liberalDemocracyAuthoritarianism",
          ],
          properties: {
            religiousSecular: buildAxisSchema(),
            socialismCapitalism: buildAxisSchema(),
            doveHawk: buildAxisSchema(),
            liberalDemocracyAuthoritarianism: buildAxisSchema(),
          },
        },
        betweenTheLines: {
          type: "object",
          additionalProperties: false,
          required: [
            "religiousSecular",
            "socialismCapitalism",
            "doveHawk",
            "liberalDemocracyAuthoritarianism",
          ],
          properties: {
            religiousSecular: buildAxisSchema(),
            socialismCapitalism: buildAxisSchema(),
            doveHawk: buildAxisSchema(),
            liberalDemocracyAuthoritarianism: buildAxisSchema(),
          },
        },
      },
    },
  },
};

const FINAL_ANALYSIS_SCHEMA_V2 = {
  type: "object",
  additionalProperties: false,
  required: ["overallProfile", "analysisSections", "quantitativeAnalysis", "highlightedQuotes"],
  properties: {
    overallProfile: {
      type: "object",
      additionalProperties: false,
      required: ["bluntProfile", "historicalContext"],
      properties: {
        bluntProfile: buildSummaryParagraphSchema(),
        historicalContext: buildSummaryParagraphSchema(),
      },
    },
    analysisSections: FINAL_ANALYSIS_SCHEMA.properties.analysisSections,
    quantitativeAnalysis: FINAL_ANALYSIS_SCHEMA.properties.quantitativeAnalysis,
    highlightedQuotes: {
      type: "object",
      additionalProperties: false,
      required: [
        "innermostEmotions",
        "surprisingInnerWorldOrHistory",
        "benevolentTowardOthers",
      ],
      properties: {
        innermostEmotions: buildHighlightedQuoteGroupSchema(),
        surprisingInnerWorldOrHistory: buildHighlightedQuoteGroupSchema(),
        benevolentTowardOthers: buildHighlightedQuoteGroupSchema(),
      },
    },
  },
};

function splitTextIntoChunks(text, maxChars = MAX_CHUNK_ANALYSIS_CHARS) {
  const sections = String(text || "").split(/\n\n----------------------------------------\n\n/u);
  const chunks = [];
  let currentChunk = "";

  for (const section of sections) {
    const candidate = currentChunk ? `${currentChunk}\n\n----------------------------------------\n\n${section}` : section;

    if (candidate.length <= maxChars) {
      currentChunk = candidate;
      continue;
    }

    if (currentChunk) {
      chunks.push(currentChunk);
      currentChunk = "";
    }

    if (section.length <= maxChars) {
      currentChunk = section;
      continue;
    }

    for (let index = 0; index < section.length; index += maxChars) {
      chunks.push(section.slice(index, index + maxChars));
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.filter(Boolean);
}

function stringifyForPrompt(value) {
  return JSON.stringify(value, null, 2);
}

function buildAnalysisInstructions(memberName, partyName) {
  return [
    "אתה פרשן פוליטי ישראלי חד, מתוחכם ושקול שכותב בעברית טבעית ורהוטה.",
    `אתה מנתח את חבר הכנסת ${memberName} מסיעת ${partyName}.`,
    "הישען רק על החומר שסופק לך.",
    "הצג את כל התובנות בנקודות קצרות, חדות, סריקות וקלות להבנה. אל תכתוב פסקאות ארוכות.",
    "חלק את הפלט בדיוק לשני אזורי ניתוח: 'על סמך הטקסט' ו'בין השורות'.",
    "בתוך כל אחד משני האזורים חייבים להופיע בדיוק שלושה תתי-מדורים: 'עמדות ליבה', 'פרופיל פסיכולוגי', 'עימותים ואי-הלימה'.",
    "בכל נקודה כתובה צריכה להיות עוגנת ראייתית ברורה מתוך הציטוטים.",
    "במדור 'בין השורות' מותר לפרש, אבל רק אם הפרשנות נשענת על דפוסים, בחירות לשון, הדגשים חוזרים או פערים עקביים בחומר.",
    "אל תמציא עובדות חיצוניות, אל תסתמך על ידע כללי, ואל תכתוב סיסמאות ריקות.",
    "הראיות חייבות להיות ציטוטים קצרים יחסית עם כותרת הפרוטוקול שממנה נלקחו.",
    "הניתוח הכמותי חייב להישאר נפרד משני אזורי הניתוח, ולכל ציון חייבים להיות 2 עד 4 נימוקים קצרים בבולטים שמסבירים למה הציון ניתן.",
    "כתוב בנוסח שמתאים להצגה בכרטיסיות ובפאנלים UI: בהיר, היררכי, חד וברור כבר במבט ראשון.",
    "בציר דתי מול חילוני: 1 = חילוני מאוד, 10 = דתי מאוד.",
    "בציר סוציאליזם מול קפיטליזם: 1 = סוציאליסטי מאוד, 10 = קפיטליסטי מאוד.",
    "בציר יוני מול נצי: 1 = יוני מאוד, 10 = נצי מאוד.",
    "בציר דמוקרטיה ליברלית מול סמכותנות: 1 = דמוקרטיה ליברלית מאוד, 10 = סמכותני מאוד.",
    "החזר JSON תקף בלבד לפי הסכמה הנתונה.",
  ].join(" ");
}

function buildAnalysisInstructions(memberName, partyName) {
  return [
    "אתה פרשן פוליטי ישראלי חד, מתוחכם, שקול וישיר שכותב בעברית טבעית ורהוטה.",
    `אתה מנתח את חבר הכנסת ${memberName} מסיעת ${partyName}.`,
    "הישען רק על החומר שסופק לך.",
    "החזר בתחילת הפלט סעיף overallProfile עם שני טקסטים בלבד: פסקה אחת של דיוקן כולל, בוטה, ישיר וחד שמאגד גם את העמדות המפורשות וגם את מה שמשתמע בין השורות; ופסקה שנייה שמסבירה כיצד הדמות הזו צפויה להיתפס בהקשר היסטורי.",
    "הפסקה הראשונה חייבת לחבר יחד בין מה שנאמר במפורש לבין מה שנרמז, ולהסביר בקול ברור איזה טיפוס פוליטי עומד כאן מול הקורא.",
    "הפסקה השנייה חייבת להסביר איך סביר שיזכרו את הפוליטיקאי הזה, באיזה מחנה תודעתי ימוקם, ומה יהיה מקור הכוח או המחלוקת סביבו בהקשר היסטורי.",
    "גם לשתי פסקאות הסיכום חייבות להיות ראיות מתוך הציטוטים.",
    "בנוסף לכל הסעיפים הקיימים, החזר גם סעיף highlightedQuotes.",
    "בסעיף highlightedQuotes חייבות להופיע שלוש קבוצות נפרדות: innermostEmotions, surprisingInnerWorldOrHistory, benevolentTowardOthers.",
    "בקבוצת innermostEmotions בחר ציטוטים שמשקפים רגשות, תחושות, פגיעות, כאב, גאווה, חרדה, תקווה, עלבון, חמלה או עולם רגשי פנימי של הדובר.",
    "בקבוצת surprisingInnerWorldOrHistory בחר ציטוטים שחושפים משהו מפתיע, בלתי צפוי או לא טריוויאלי על העולם הפנימי, הביוגרפיה, הזיכרון האישי, ההיסטוריה האישית או החוויה הפנימית של הדובר.",
    "בקבוצת benevolentTowardOthers בחר רק ציטוטים שמבטאים יחס מיטיב, מפרגן, נדיב, מגונן, אמפתי או טוב כלפי אחרים בכנסת. אל תכלול ציטוטים סרקסטיים, עוקצניים, דו-משמעיים או כאלה שיש ספק אם הם נאמרו בכנות.",
    "בכל אחת משלוש הקבוצות החזר 2 עד 6 פריטים אם החומר מאפשר זאת; אם אין די חומר, החזר פחות, אך אל תמציא.",
    "לכל פריט בשלוש הקבוצות חייבים להיות quote, protocolHeading ו-explanation, כאשר explanation מסביר בקצרה ובבהירות למה הציטוט שייך דווקא לקטגוריה הזאת.",
    "בשלוש הקבוצות הקפד לבחור ציטוטים שיש להם ערך אנושי ופרשני ממשי, ולא רק משפטים כלליים או טכניים.",
    "לאחר מכן חלק את הפלט בדיוק לשני אזורי ניתוח: 'על סמך הטקסט' ו'בין השורות'.",
    "בתוך כל אחד משני האזורים חייבים להופיע בדיוק שלושה תתי-מדורים: 'עמדות ליבה', 'פרופיל פסיכולוגי', 'עימותים ואי-הלימה'.",
    "בכל אחד משלושת תתי-המדורים החזר מערך bullets של תובנות קצרות, חדות, ברורות וקלות להבנה. אל תכתוב פסקאות ארוכות ואל תאחד כמה רעיונות לנקודה אחת.",
    "בכל תת-מדור רצוי 3 עד 6 נקודות, וכל נקודה צריכה לכלול טענה אחת ברורה בלבד.",
    "כל נקודה חייבת להיות מעוגנת ראייתית מתוך הציטוטים.",
    "במדור 'בין השורות' מותר לפרש, אבל רק אם הפרשנות נשענת על דפוסים, בחירות לשון, הדגשים חוזרים, הימנעויות או פערים עקביים בחומר.",
    "אל תמציא עובדות חיצוניות, אל תסתמך על ידע כללי, ואל תכתוב סיסמאות ריקות.",
    "הראיות חייבות להיות ציטוטים קצרים יחסית עם כותרת הפרוטוקול שממנה נלקחו.",
    "הניתוח הכמותי חייב להישאר נפרד משני אזורי הניתוח, ובכל ציר החזר ציון אחד, 2 עד 4 נימוקים קצרים בבולטים שמסבירים למה הציון ניתן, וראיות תומכות.",
    "כתוב בנוסח שמתאים להצגה בכרטיסיות ובפאנלים UI: בהיר, היררכי, חד וברור כבר במבט ראשון.",
    "בציר דתי מול חילוני: 1 = חילוני מאוד, 10 = דתי מאוד.",
    "בציר סוציאליזם מול קפיטליזם: 1 = סוציאליסטי מאוד, 10 = קפיטליסטי מאוד.",
    "בציר יוני מול נצי: 1 = יוני מאוד, 10 = נצי מאוד.",
    "בציר דמוקרטיה ליברלית מול סמכותנות: 1 = דמוקרטיה ליברלית מאוד, 10 = סמכותני מאוד.",
    "החזר JSON תקף בלבד לפי הסכמה הנתונה.",
  ].join(" ");
}

function buildDirectAnalysisInput(member, utteranceManifest, fileText) {
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            `חבר הכנסת: ${member.name}`,
            `סיעה: ${member.partyName}`,
            `טווח הציטוטים: ${MEMBER_PROTOCOL_SINCE_DATE} ואילך`,
            `קובץ המקור נוצר בתאריך: ${utteranceManifest.generatedAt || "לא ידוע"}`,
            "",
            "להלן קובץ הציטוטים המלא, כשהוא מאורגן לפי פרוטוקולים וסיכומי ישיבה:",
            "",
            fileText,
          ].join("\n"),
        },
      ],
    },
  ];
}

function buildChunkSynthesisInput(member, utteranceManifest, chunkDigests) {
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            `חבר הכנסת: ${member.name}`,
            `סיעה: ${member.partyName}`,
            `טווח הציטוטים: ${MEMBER_PROTOCOL_SINCE_DATE} ואילך`,
            `קובץ המקור נוצר בתאריך: ${utteranceManifest.generatedAt || "לא ידוע"}`,
            "",
            "החומר המקורי היה גדול ולכן נותח בכמה מקטעים.",
            "להלן ניתוחי הביניים המובנים של כל המקטעים. סנתז מהם ניתוח סופי אחד, עקבי, חד ומגובה ראיות:",
            "",
            stringifyForPrompt(chunkDigests),
          ].join("\n"),
        },
      ],
    },
  ];
}

function formatEvidenceBlock(evidence) {
  if (!Array.isArray(evidence) || !evidence.length) {
    return "אין כרגע ציטוטי ראיה זמינים.";
  }

  return evidence
    .map(
      (item) =>
        `- ${item.protocolHeading}\n  ציטוט: "${item.quote}"\n  למה זה חשוב: ${item.explanation}`,
    )
    .join("\n");
}

function formatBulletList(items) {
  if (!Array.isArray(items) || !items.length) {
    return "- אין כרגע נימוקים זמינים.";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function formatInsightGroupMarkdown(title, group) {
  const bullets = Array.isArray(group?.bullets) ? group.bullets : [];

  if (!bullets.length) {
    return [`### ${title}`, "- אין כרגע תובנות זמינות."].join("\n\n");
  }

  return [
    `### ${title}`,
    bullets
      .map((item) =>
        [`- ${item.point}`, formatEvidenceBlock(item.evidence)].join("\n"),
      )
      .join("\n\n"),
  ].join("\n\n");
}

function formatReadingLayerMarkdown(title, layer) {
  return [
    `## ${title}`,
    formatInsightGroupMarkdown("עמדות ליבה", layer.coreStances),
    formatInsightGroupMarkdown("פרופיל פסיכולוגי", layer.psychologicalProfile),
    formatInsightGroupMarkdown("עימותים ואי-הלימה", layer.clashesAndIncongruencies),
  ].join("\n\n");
}

function formatAxisMarkdown(title, axis) {
  return [
    `**${title}: ${axis.score}/10**`,
    "נימוקי הציון:",
    formatBulletList(axis.explanationBullets),
    formatEvidenceBlock(axis.evidence),
  ].join("\n\n");
}

function formatAnalysisMarkdown(member, manifest) {
  const analysis = manifest.analysis;

  return [
    `# ניתוח פוליטי: ${member.name}`,
    "",
    `סיעה: ${member.partyName}`,
    `מודל: ${manifest.model}`,
    `נוצר בתאריך: ${manifest.generatedAt}`,
    "",
    formatReadingLayerMarkdown("על סמך הטקסט", analysis.analysisSections.textBased),
    "",
    formatReadingLayerMarkdown("בין השורות", analysis.analysisSections.betweenTheLines),
    "",
    "## ניתוח כמותי - על סמך הטקסט",
    formatAxisMarkdown(AXIS_LABELS.religiousSecular, analysis.quantitativeAnalysis.textBased.religiousSecular),
    "",
    formatAxisMarkdown(AXIS_LABELS.socialismCapitalism, analysis.quantitativeAnalysis.textBased.socialismCapitalism),
    "",
    formatAxisMarkdown(AXIS_LABELS.doveHawk, analysis.quantitativeAnalysis.textBased.doveHawk),
    "",
    formatAxisMarkdown(
      AXIS_LABELS.liberalDemocracyAuthoritarianism,
      analysis.quantitativeAnalysis.textBased.liberalDemocracyAuthoritarianism,
    ),
    "",
    "## ניתוח כמותי - בין השורות",
    formatAxisMarkdown(AXIS_LABELS.religiousSecular, analysis.quantitativeAnalysis.betweenTheLines.religiousSecular),
    "",
    formatAxisMarkdown(AXIS_LABELS.socialismCapitalism, analysis.quantitativeAnalysis.betweenTheLines.socialismCapitalism),
    "",
    formatAxisMarkdown(AXIS_LABELS.doveHawk, analysis.quantitativeAnalysis.betweenTheLines.doveHawk),
    "",
    formatAxisMarkdown(
      AXIS_LABELS.liberalDemocracyAuthoritarianism,
      analysis.quantitativeAnalysis.betweenTheLines.liberalDemocracyAuthoritarianism,
    ),
  ].join("\n");
}

function formatOverallProfileMarkdown(profile) {
  return [
    "## פרופיל כולל",
    "### דיוקן חד",
    profile.bluntProfile.paragraph,
    formatEvidenceBlock(profile.bluntProfile.evidence),
    "### הקשר היסטורי צפוי",
    profile.historicalContext.paragraph,
    formatEvidenceBlock(profile.historicalContext.evidence),
  ].join("\n\n");
}

function formatAnalysisMarkdown(member, manifest) {
  const analysis = manifest.analysis;

  return [
    `# ניתוח פוליטי: ${member.name}`,
    "",
    `סיעה: ${member.partyName}`,
    `מודל: ${manifest.model}`,
    `נוצר בתאריך: ${manifest.generatedAt}`,
    "",
    formatOverallProfileMarkdown(analysis.overallProfile),
    "",
    formatReadingLayerMarkdown("על סמך הטקסט", analysis.analysisSections.textBased),
    "",
    formatReadingLayerMarkdown("בין השורות", analysis.analysisSections.betweenTheLines),
    "",
    "## ניתוח כמותי - על סמך הטקסט",
    formatAxisMarkdown(AXIS_LABELS.religiousSecular, analysis.quantitativeAnalysis.textBased.religiousSecular),
    "",
    formatAxisMarkdown(AXIS_LABELS.socialismCapitalism, analysis.quantitativeAnalysis.textBased.socialismCapitalism),
    "",
    formatAxisMarkdown(AXIS_LABELS.doveHawk, analysis.quantitativeAnalysis.textBased.doveHawk),
    "",
    formatAxisMarkdown(
      AXIS_LABELS.liberalDemocracyAuthoritarianism,
      analysis.quantitativeAnalysis.textBased.liberalDemocracyAuthoritarianism,
    ),
    "",
    "## ניתוח כמותי - בין השורות",
    formatAxisMarkdown(AXIS_LABELS.religiousSecular, analysis.quantitativeAnalysis.betweenTheLines.religiousSecular),
    "",
    formatAxisMarkdown(AXIS_LABELS.socialismCapitalism, analysis.quantitativeAnalysis.betweenTheLines.socialismCapitalism),
    "",
    formatAxisMarkdown(AXIS_LABELS.doveHawk, analysis.quantitativeAnalysis.betweenTheLines.doveHawk),
    "",
    formatAxisMarkdown(
      AXIS_LABELS.liberalDemocracyAuthoritarianism,
      analysis.quantitativeAnalysis.betweenTheLines.liberalDemocracyAuthoritarianism,
    ),
  ].join("\n");
}

function buildDirectAnalysisInput(member, utteranceManifest, fileText, sourceType = "full") {
  const sourceMeta = getAnalysisSourceMeta(sourceType);

  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            `חבר הכנסת: ${member.name}`,
            `סיעה: ${member.partyName}`,
            `טווח הציטוטים: ${MEMBER_PROTOCOL_SINCE_DATE} ואילך`,
            `סוג קובץ המקור: ${sourceMeta.sourceDescription}`,
            `קובץ המקור נוצר בתאריך: ${utteranceManifest.generatedAt || "לא ידוע"}`,
            "",
            "להלן קובץ הציטוטים המלא, כשהוא מאורגן לפי פרוטוקולים וסיכומי ישיבה:",
            "",
            fileText,
          ].join("\n"),
        },
      ],
    },
  ];
}

function buildChunkSynthesisInput(member, utteranceManifest, chunkDigests, sourceType = "full") {
  const sourceMeta = getAnalysisSourceMeta(sourceType);

  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            `חבר הכנסת: ${member.name}`,
            `סיעה: ${member.partyName}`,
            `טווח הציטוטים: ${MEMBER_PROTOCOL_SINCE_DATE} ואילך`,
            `סוג קובץ המקור: ${sourceMeta.sourceDescription}`,
            `קובץ המקור נוצר בתאריך: ${utteranceManifest.generatedAt || "לא ידוע"}`,
            "",
            "החומר המקורי היה גדול ולכן נותח בכמה מקטעים.",
            "להלן ניתוחי הביניים המובנים של כל המקטעים. סנתז מהם ניתוח סופי אחד, עקבי, חד ומגובה ראיות:",
            "",
            stringifyForPrompt(chunkDigests),
          ].join("\n"),
        },
      ],
    },
  ];
}

function formatOverallProfileMarkdown(profile) {
  return [
    "## פרופיל כולל",
    "### דיוקן חד",
    profile.bluntProfile.paragraph,
    formatEvidenceBlock(profile.bluntProfile.evidence),
    "### הקשר היסטורי צפוי",
    profile.historicalContext.paragraph,
    formatEvidenceBlock(profile.historicalContext.evidence),
  ].join("\n\n");
}

function formatHighlightedQuoteGroupMarkdown(title, group) {
  return [
    `### ${title}`,
    formatEvidenceBlock(group?.quotes),
  ].join("\n\n");
}

function formatHighlightedQuotesMarkdown(highlightedQuotes) {
  return [
    "## ציטוטים בולטים מתוך הניתוח",
    formatHighlightedQuoteGroupMarkdown("רגשות ותחושות פנימיים", highlightedQuotes?.innermostEmotions),
    formatHighlightedQuoteGroupMarkdown(
      "עולם פנימי או היסטוריה אישית מפתיעים",
      highlightedQuotes?.surprisingInnerWorldOrHistory,
    ),
    formatHighlightedQuoteGroupMarkdown("יחס מיטיב לאחרים בכנסת", highlightedQuotes?.benevolentTowardOthers),
  ].join("\n\n");
}

function formatAnalysisMarkdown(member, manifest) {
  const analysis = manifest.analysis;
  const sourceMeta = getAnalysisSourceMeta(manifest.sourceType);

  return [
    `# ניתוח פוליטי: ${member.name}`,
    "",
    `סיעה: ${member.partyName}`,
    `מקור הניתוח: ${sourceMeta.label}`,
    `מודל: ${manifest.model}`,
    `נוצר בתאריך: ${manifest.generatedAt}`,
    "",
    formatOverallProfileMarkdown(analysis.overallProfile),
    "",
    formatHighlightedQuotesMarkdown(analysis.highlightedQuotes),
    "",
    formatReadingLayerMarkdown("על סמך הטקסט", analysis.analysisSections.textBased),
    "",
    formatReadingLayerMarkdown("בין השורות", analysis.analysisSections.betweenTheLines),
    "",
    "## ניתוח כמותי - על סמך הטקסט",
    formatAxisMarkdown(AXIS_LABELS.religiousSecular, analysis.quantitativeAnalysis.textBased.religiousSecular),
    "",
    formatAxisMarkdown(AXIS_LABELS.socialismCapitalism, analysis.quantitativeAnalysis.textBased.socialismCapitalism),
    "",
    formatAxisMarkdown(AXIS_LABELS.doveHawk, analysis.quantitativeAnalysis.textBased.doveHawk),
    "",
    formatAxisMarkdown(
      AXIS_LABELS.liberalDemocracyAuthoritarianism,
      analysis.quantitativeAnalysis.textBased.liberalDemocracyAuthoritarianism,
    ),
    "",
    "## ניתוח כמותי - בין השורות",
    formatAxisMarkdown(AXIS_LABELS.religiousSecular, analysis.quantitativeAnalysis.betweenTheLines.religiousSecular),
    "",
    formatAxisMarkdown(AXIS_LABELS.socialismCapitalism, analysis.quantitativeAnalysis.betweenTheLines.socialismCapitalism),
    "",
    formatAxisMarkdown(AXIS_LABELS.doveHawk, analysis.quantitativeAnalysis.betweenTheLines.doveHawk),
    "",
    formatAxisMarkdown(
      AXIS_LABELS.liberalDemocracyAuthoritarianism,
      analysis.quantitativeAnalysis.betweenTheLines.liberalDemocracyAuthoritarianism,
    ),
  ].join("\n");
}

class MemberAnalysisService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname, "..", "..");
    this.dataDir = path.join(this.rootDir, "data");
    this.analysisDir = path.join(this.dataDir, "member-analyses");
    this.memberProtocolService = options.memberProtocolService;
    this.analysisClient = options.analysisClient || options.openAIClient;
    this.promotionService = options.promotionService || null;
    this.memberStatuses = new Map();
    this.memberPromises = new Map();
    this.bulkStatus = this.createIdleBulkStatus();
    this.bulkPromise = null;
    this.adminProfileRebuildStatus = this.createIdleAdminProfileRebuildStatus();
    this.adminProfileRebuildPromise = null;
    this.initialized = false;
  }

  createIdleBulkStatus() {
    return {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      totalMembers: this.memberProtocolService.members.length,
      processedMembers: 0,
      generatedMembers: 0,
      skippedMembers: 0,
      failedMembers: 0,
      current: null,
      recentErrors: [],
      lastCompletedAt: null,
      configured: this.analysisClient.isConfigured(),
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model,
    };
  }

  createIdleMemberStatus(member) {
    return {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      generatedAt: null,
      currentStage: null,
      processedChunks: 0,
      totalChunks: 0,
      error: null,
      isStale: false,
      configured: this.analysisClient.isConfigured(),
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model,
      hasAnalysis: false,
      memberSlug: member.slug,
    };
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    await ensureDirectory(this.analysisDir);
    this.initialized = true;
  }

  buildBaseName(member) {
    return sanitizeFilename(`${member.name}__${member.partyName}__analysis__from-${MEMBER_PROTOCOL_SINCE_DATE}`);
  }

  getAnalysisJsonPath(member) {
    return path.join(this.analysisDir, `${this.buildBaseName(member)}.json`);
  }

  getAnalysisMarkdownPath(member) {
    return path.join(this.analysisDir, `${this.buildBaseName(member)}.md`);
  }

  async readAnalysisManifest(member) {
    const jsonPath = this.getAnalysisJsonPath(member);

    if (!(await fileExists(jsonPath))) {
      return null;
    }

    try {
      const manifest = await readJson(jsonPath);

      if (
        manifest?.version !== ANALYSIS_VERSION ||
        manifest?.memberSlug !== member.slug ||
        !(await fileExists(manifest.markdownPath || ""))
      ) {
        return null;
      }

      return manifest;
    } catch {
      return null;
    }
  }

  isManifestStale(manifest, utteranceManifest) {
    const sourceTime = utteranceManifest?.generatedAt ? Date.parse(utteranceManifest.generatedAt) : null;
    const analysisTime = manifest?.sourceUtteranceGeneratedAt
      ? Date.parse(manifest.sourceUtteranceGeneratedAt)
      : null;
    const providerChanged =
      String(manifest?.provider || "").trim() !== String(this.analysisClient.provider || "").trim();
    const modelChanged =
      String(manifest?.model || "").trim() !== String(this.analysisClient.model || "").trim();

    return Boolean(
      providerChanged ||
      modelChanged ||
      sourceTime &&
      analysisTime &&
      Number.isFinite(sourceTime) &&
      Number.isFinite(analysisTime) &&
      analysisTime < sourceTime,
    );
  }

  getBulkStatus() {
    return {
      ...this.bulkStatus,
      current: this.bulkStatus.current ? { ...this.bulkStatus.current } : null,
      recentErrors: [...this.bulkStatus.recentErrors],
    };
  }

  async getMemberAnalysisRecord(slug) {
    await this.initialize();
    const member = this.memberProtocolService.resolveMember(slug);

    if (!member) {
      return null;
    }

    const canonicalSlug = member.slug;
    const runtimeStatus = this.memberStatuses.get(canonicalSlug);
    const utteranceManifest = await this.memberProtocolService.getMemberUtteranceFileDownload(
      canonicalSlug,
    );
    const manifest = await this.readAnalysisManifest(member);
    const isStale = manifest ? this.isManifestStale(manifest, utteranceManifest) : false;

    if (runtimeStatus) {
      return {
        status: {
          ...runtimeStatus,
          isStale,
        },
        analysis: manifest?.analysis || null,
      };
    }

    if (!manifest) {
      return {
        status: {
          ...this.createIdleMemberStatus(member),
          isStale: false,
        },
        analysis: null,
      };
    }

    return {
      status: {
        status: "completed",
        startedAt: manifest.startedAt || null,
        finishedAt: manifest.generatedAt,
        generatedAt: manifest.generatedAt,
        currentStage: null,
        processedChunks: manifest.chunkCount || 0,
        totalChunks: manifest.chunkCount || 0,
        error: null,
        isStale,
        configured: this.analysisClient.isConfigured(),
        provider: manifest.provider || this.analysisClient.provider || "unknown",
        model: manifest.model || this.analysisClient.model,
        hasAnalysis: true,
        memberSlug: member.slug,
      },
      analysis: manifest.analysis,
    };
  }

  async startMemberAnalysis(slug, options = {}) {
    await this.initialize();
    const member = this.memberProtocolService.resolveMember(slug);

    if (!member) {
      return null;
    }

    const canonicalSlug = member.slug;

    if (!this.analysisClient.isConfigured()) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    if (this.memberPromises.has(canonicalSlug)) {
      return this.getMemberAnalysisRecord(canonicalSlug);
    }

    const runtimeStatus = this.createIdleMemberStatus(member);
    runtimeStatus.status = "running";
    runtimeStatus.startedAt = new Date().toISOString();
    runtimeStatus.currentStage = "preparing_source_file";
    this.memberStatuses.set(canonicalSlug, runtimeStatus);

    const runPromise = this.runSingleMemberAnalysis(member, options)
      .catch((error) => {
        this.memberStatuses.set(canonicalSlug, {
          ...this.createIdleMemberStatus(member),
          status: "failed",
          startedAt: runtimeStatus.startedAt,
          finishedAt: new Date().toISOString(),
          error: toErrorMessage(error),
        });
      })
      .finally(() => {
        this.memberPromises.delete(canonicalSlug);
      });

    this.memberPromises.set(canonicalSlug, runPromise);
    return this.getMemberAnalysisRecord(canonicalSlug);
  }

  async startBulkAnalysis() {
    await this.initialize();

    if (!this.analysisClient.isConfigured()) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    if (this.bulkPromise) {
      return this.getBulkStatus();
    }

    this.bulkStatus = {
      status: "waiting_for_source_files",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      totalMembers: this.memberProtocolService.members.length,
      processedMembers: 0,
      generatedMembers: 0,
      skippedMembers: 0,
      failedMembers: 0,
      current: null,
      recentErrors: [],
      lastCompletedAt: this.bulkStatus.lastCompletedAt || null,
      configured: true,
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model,
    };

    this.bulkPromise = this.runBulkAnalysis()
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

  async ensureMemberUtteranceFileReady(member) {
    const slug = member.slug;
    let utteranceStatus = await this.memberProtocolService.getMemberUtteranceFileStatus(slug);
    const needsBuild =
      !utteranceStatus ||
      utteranceStatus.status === "idle" ||
      utteranceStatus.status === "failed" ||
      utteranceStatus.isStale;

    if (needsBuild) {
      const started = await this.memberProtocolService.startMemberUtteranceFileBuild(slug);

      if (!started) {
        throw new Error("Member utterance file is missing");
      }
    }

    while (true) {
      utteranceStatus = await this.memberProtocolService.getMemberUtteranceFileStatus(slug);
      const liveStatus = this.memberStatuses.get(slug);

      if (liveStatus && liveStatus.status === "running") {
        if (utteranceStatus?.status === "waiting_for_index") {
          liveStatus.currentStage = "waiting_for_member_quotes";
        } else if (utteranceStatus?.status === "running") {
          liveStatus.currentStage = "building_member_quote_file";
        }
      }

      if (utteranceStatus?.status === "completed" && !utteranceStatus.isStale) {
        break;
      }

      if (utteranceStatus?.status === "failed") {
        throw new Error(utteranceStatus.error || "Member utterance file build failed");
      }

      if (!utteranceStatus || utteranceStatus.status === "idle") {
        throw new Error("Member utterance file is missing");
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 1500);
      });
    }

    const manifest = await this.memberProtocolService.getMemberUtteranceFileDownload(slug);

    if (!manifest) {
      throw new Error("Member utterance file is missing");
    }

    return manifest;
  }

  async runBulkAnalysis() {
    await this.memberProtocolService.ensureAllMemberUtteranceFilesReady();
    this.bulkStatus.status = "running";

    await mapWithConcurrency(this.memberProtocolService.members, ANALYSIS_CONCURRENCY, async (member) => {
      this.bulkStatus.current = {
        slug: member.slug,
        name: member.name,
        partyName: member.partyName,
      };

      try {
        const utteranceManifest = await this.memberProtocolService.getMemberUtteranceFileDownload(member.slug);

        if (!utteranceManifest) {
          throw new Error("Member utterance file is missing");
        }

        const existingManifest = await this.readAnalysisManifest(member);

        if (existingManifest && !this.isManifestStale(existingManifest, utteranceManifest)) {
          this.bulkStatus.skippedMembers += 1;
          return;
        }

        await this.runMemberAnalysis(member, utteranceManifest);
        this.bulkStatus.generatedMembers += 1;
      } catch (error) {
        this.bulkStatus.failedMembers += 1;
        this.bulkStatus.recentErrors = [
          `${member.name}: ${toErrorMessage(error)}`,
          ...this.bulkStatus.recentErrors,
        ].slice(0, 10);
        this.memberStatuses.set(member.slug, {
          ...this.createIdleMemberStatus(member),
          status: "failed",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          error: toErrorMessage(error),
        });
      } finally {
        this.bulkStatus.processedMembers += 1;
      }
    });

    this.bulkStatus.status = this.bulkStatus.failedMembers > 0 ? "completed_with_errors" : "completed";
    this.bulkStatus.finishedAt = new Date().toISOString();
    this.bulkStatus.lastCompletedAt = this.bulkStatus.finishedAt;
    this.bulkStatus.current = null;
  }

  async runSingleMemberAnalysis(member, options = {}) {
    const utteranceManifest = await this.ensureMemberUtteranceFileReady(member);
    const existingManifest = await this.readAnalysisManifest(member);

    if (!options.force && existingManifest && !this.isManifestStale(existingManifest, utteranceManifest)) {
      this.memberStatuses.set(member.slug, {
        status: "completed",
        startedAt: existingManifest.startedAt || null,
        finishedAt: existingManifest.generatedAt,
        generatedAt: existingManifest.generatedAt,
        currentStage: null,
        processedChunks: existingManifest.chunkCount || 0,
        totalChunks: existingManifest.chunkCount || 0,
        error: null,
        isStale: false,
        configured: this.analysisClient.isConfigured(),
        provider: existingManifest.provider || this.analysisClient.provider || "unknown",
        model: existingManifest.model || this.analysisClient.model,
        hasAnalysis: true,
        memberSlug: member.slug,
      });
      return existingManifest;
    }

    return this.runMemberAnalysis(member, utteranceManifest);
  }

  async runMemberAnalysis(member, utteranceManifest) {
    const status = this.createIdleMemberStatus(member);
    status.status = "running";
    status.startedAt = new Date().toISOString();
    this.memberStatuses.set(member.slug, status);

    const fileText = await fs.readFile(utteranceManifest.filePath, "utf8");
    const chunks = fileText.length > MAX_DIRECT_ANALYSIS_CHARS
      ? splitTextIntoChunks(fileText)
      : [fileText];
    status.totalChunks = chunks.length;

    let analysis;

    if (chunks.length === 1) {
      status.currentStage = "analyzing";
      analysis = await this.executeAnalysisRequest({
        member,
        name: "member_political_analysis",
        input: buildDirectAnalysisInput(member, utteranceManifest, fileText),
      });
      status.processedChunks = 1;
    } else {
      const chunkDigests = [];

      for (const [index, chunk] of chunks.entries()) {
        status.currentStage = `chunk_${index + 1}_of_${chunks.length}`;
        const digest = await this.executeAnalysisRequest({
          member,
          name: "member_chunk_analysis",
          input: buildDirectAnalysisInput(member, utteranceManifest, chunk),
        });
        chunkDigests.push({
          chunkNumber: index + 1,
          analysis: digest,
        });
        status.processedChunks = index + 1;
      }

      status.currentStage = "synthesizing";
      analysis = await this.executeAnalysisRequest({
        member,
        name: "member_final_analysis",
        input: buildChunkSynthesisInput(member, utteranceManifest, chunkDigests),
      });
    }

    const generatedAt = new Date().toISOString();
    const manifest = {
      version: ANALYSIS_VERSION,
      memberSlug: member.slug,
      memberName: member.name,
      partyName: member.partyName,
      generatedAt,
      startedAt: status.startedAt,
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model,
      sourceUtterancePath: utteranceManifest.filePath,
      sourceUtteranceGeneratedAt: utteranceManifest.generatedAt,
      chunkCount: chunks.length,
      markdownPath: this.getAnalysisMarkdownPath(member),
      analysis,
    };

    await writeTextFile(manifest.markdownPath, formatAnalysisMarkdown(member, manifest));
    await writeJson(this.getAnalysisJsonPath(member), manifest);
    this.promotionService?.requestPromotion("memberAnalyses");

    this.memberStatuses.set(member.slug, {
      status: "completed",
      startedAt: status.startedAt,
      finishedAt: generatedAt,
      generatedAt,
      currentStage: null,
      processedChunks: chunks.length,
      totalChunks: chunks.length,
      error: null,
      isStale: false,
      configured: true,
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model,
      hasAnalysis: true,
      memberSlug: member.slug,
    });

    return manifest;
  }

  createIdleBulkStatus(sourceType = "full") {
    const sourceMeta = getAnalysisSourceMeta(sourceType);

    return {
      status: "idle",
      sourceType: sourceMeta.key,
      sourceLabel: sourceMeta.label,
      startedAt: null,
      finishedAt: null,
      totalMembers: this.memberProtocolService.members.length,
      processedMembers: 0,
      generatedMembers: 0,
      skippedMembers: 0,
      failedMembers: 0,
      current: null,
      recentErrors: [],
      lastCompletedAt: null,
      configured: this.analysisClient.isConfigured(),
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model,
    };
  }

  createIdleAdminProfileRebuildStatus() {
    return {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      totalProfiles: this.memberProtocolService.members.length,
      processedProfiles: 0,
      generatedProfiles: 0,
      failedProfiles: 0,
      current: null,
      recentErrors: [],
      lastCompletedAt: null,
      sourceTypes: ["small"],
      destructive: true,
      confirmationKeyword: "yes",
      warning:
        "This rebuild will take a long time, may cost money, and will delete and recreate every MK profile from the small quotes files.",
      configured: this.analysisClient.isConfigured(),
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model,
    };
  }

  createIdleMemberStatus(member, sourceType = "full") {
    const sourceMeta = getAnalysisSourceMeta(sourceType);

    return {
      status: "idle",
      sourceType: sourceMeta.key,
      sourceLabel: sourceMeta.label,
      startedAt: null,
      finishedAt: null,
      generatedAt: null,
      currentStage: null,
      processedChunks: 0,
      totalChunks: 0,
      error: null,
      isStale: false,
      configured: this.analysisClient.isConfigured(),
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model,
      hasAnalysis: false,
      memberSlug: member.slug,
    };
  }

  buildBaseName(member, sourceType = "full") {
    const sourceMeta = getAnalysisSourceMeta(sourceType);
    return sanitizeFilename(
      `${member.name}__${member.partyName}__${sourceMeta.fileLabel}__from-${MEMBER_PROTOCOL_SINCE_DATE}`,
    );
  }

  getAnalysisJsonPath(member, sourceType = "full") {
    return path.join(this.analysisDir, `${this.buildBaseName(member, sourceType)}.json`);
  }

  getAnalysisMarkdownPath(member, sourceType = "full") {
    return path.join(this.analysisDir, `${this.buildBaseName(member, sourceType)}.md`);
  }

  async readAnalysisManifest(member, sourceType = "full") {
    const sourceMeta = getAnalysisSourceMeta(sourceType);
    const jsonPath = this.getAnalysisJsonPath(member, sourceMeta.key);

    if (!(await fileExists(jsonPath))) {
      return null;
    }

    try {
      const manifest = await readJson(jsonPath);
      const resolvedMarkdownPath = await resolveStoredDataPath(this.dataDir, manifest?.markdownPath);
      const resolvedSourceUtterancePath = await resolveStoredDataPath(
        this.dataDir,
        manifest?.sourceUtterancePath,
      );

      if (
        manifest?.version !== ANALYSIS_VERSION ||
        manifest?.memberSlug !== member.slug ||
        manifest?.sourceType !== sourceMeta.key ||
        !resolvedMarkdownPath
      ) {
        return null;
      }

      return {
        ...manifest,
        markdownPath: resolvedMarkdownPath,
        sourceUtterancePath: resolvedSourceUtterancePath || manifest?.sourceUtterancePath || null,
      };
    } catch {
      return null;
    }
  }

  async getMemberAnalysisRecord(slug, sourceType = "full") {
    await this.initialize();
    const member = this.memberProtocolService.resolveMember(slug);

    if (!member) {
      return null;
    }

    const sourceMeta = getAnalysisSourceMeta(sourceType);
    const runtimeKey = buildAnalysisRuntimeKey(member.slug, sourceMeta.key);
    const runtimeStatus = this.memberStatuses.get(runtimeKey);
    const utteranceManifest = await this.memberProtocolService.getMemberUtteranceFileDownload(
      member.slug,
      sourceMeta.key,
    );
    const manifest = await this.readAnalysisManifest(member, sourceMeta.key);
    const isStale = manifest ? this.isManifestStale(manifest, utteranceManifest) : false;

    if (runtimeStatus) {
      return {
        status: {
          ...runtimeStatus,
          isStale,
        },
        analysis: manifest?.analysis || null,
      };
    }

    if (!manifest) {
      return {
        status: {
          ...this.createIdleMemberStatus(member, sourceMeta.key),
          isStale: false,
        },
        analysis: null,
      };
    }

    return {
      status: {
        status: "completed",
        sourceType: sourceMeta.key,
        sourceLabel: sourceMeta.label,
        startedAt: manifest.startedAt || null,
        finishedAt: manifest.generatedAt,
        generatedAt: manifest.generatedAt,
        currentStage: null,
        processedChunks: manifest.chunkCount || 0,
        totalChunks: manifest.chunkCount || 0,
        error: null,
        isStale,
        configured: this.analysisClient.isConfigured(),
        provider: manifest.provider || this.analysisClient.provider || "unknown",
        model: manifest.model || this.analysisClient.model,
        hasAnalysis: true,
        memberSlug: member.slug,
      },
      analysis: manifest.analysis,
    };
  }

  getAdminProfileRebuildStatus() {
    return {
      ...this.adminProfileRebuildStatus,
      current: this.adminProfileRebuildStatus.current ? { ...this.adminProfileRebuildStatus.current } : null,
      recentErrors: [...this.adminProfileRebuildStatus.recentErrors],
      sourceTypes: [...(this.adminProfileRebuildStatus.sourceTypes || [])],
    };
  }

  async getRandomSpotlightMember(sourceType = "small") {
    await this.initialize();
    const sourceMeta = getAnalysisSourceMeta(sourceType);
    const candidates = [...this.memberProtocolService.members];

    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const temporary = candidates[index];
      candidates[index] = candidates[swapIndex];
      candidates[swapIndex] = temporary;
    }

    for (const member of candidates) {
      const record = await this.getMemberAnalysisRecord(member.slug, sourceMeta.key);

      if (record?.status?.status === "completed" && record.analysis?.overallProfile) {
        return {
          member,
          analysis: record.analysis,
          status: record.status,
        };
      }
    }

    return null;
  }

  async startMemberAnalysis(slug, options = {}) {
    await this.initialize();
    const member = this.memberProtocolService.resolveMember(slug);

    if (!member) {
      return null;
    }

    if (!this.analysisClient.isConfigured()) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const sourceMeta = getAnalysisSourceMeta(options.sourceType);
    const runtimeKey = buildAnalysisRuntimeKey(member.slug, sourceMeta.key);

    if (this.memberPromises.has(runtimeKey)) {
      return this.getMemberAnalysisRecord(member.slug, sourceMeta.key);
    }

    const runtimeStatus = this.createIdleMemberStatus(member, sourceMeta.key);
    runtimeStatus.status = "running";
    runtimeStatus.startedAt = new Date().toISOString();
    runtimeStatus.currentStage = "preparing_source_file";
    this.memberStatuses.set(runtimeKey, runtimeStatus);

    const runPromise = this.runSingleMemberAnalysis(member, {
      ...options,
      sourceType: sourceMeta.key,
    })
      .catch((error) => {
        this.memberStatuses.set(runtimeKey, {
          ...this.createIdleMemberStatus(member, sourceMeta.key),
          status: "failed",
          startedAt: runtimeStatus.startedAt,
          finishedAt: new Date().toISOString(),
          error: toErrorMessage(error),
        });
      })
      .finally(() => {
        this.memberPromises.delete(runtimeKey);
      });

    this.memberPromises.set(runtimeKey, runPromise);
    return this.getMemberAnalysisRecord(member.slug, sourceMeta.key);
  }

  async startBulkAnalysis(options = {}) {
    await this.initialize();

    if (!this.analysisClient.isConfigured()) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    if (this.bulkPromise) {
      return this.getBulkStatus();
    }

    const sourceMeta = getAnalysisSourceMeta(options.sourceType);
    this.bulkStatus = {
      ...this.createIdleBulkStatus(sourceMeta.key),
      status: "waiting_for_source_files",
      startedAt: new Date().toISOString(),
      configured: true,
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model,
      lastCompletedAt: this.bulkStatus.lastCompletedAt || null,
    };

    this.bulkPromise = this.runBulkAnalysis(sourceMeta.key)
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

  async ensureMemberUtteranceFileReady(member, sourceType = "full") {
    return this.memberProtocolService.ensureMemberUtteranceFileReady(member.slug, sourceType);
  }

  async runBulkAnalysis(sourceType = "full") {
    const sourceMeta = getAnalysisSourceMeta(sourceType);

    await this.memberProtocolService.ensureAllMemberUtteranceFilesReady(sourceMeta.key);
    this.bulkStatus.status = "running";

    await mapWithConcurrency(this.memberProtocolService.members, ANALYSIS_CONCURRENCY, async (member) => {
      this.bulkStatus.current = {
        slug: member.slug,
        name: member.name,
        partyName: member.partyName,
        sourceType: sourceMeta.key,
        sourceLabel: sourceMeta.label,
      };

      try {
        const utteranceManifest = await this.memberProtocolService.getMemberUtteranceFileDownload(
          member.slug,
          sourceMeta.key,
        );

        if (!utteranceManifest) {
          throw new Error("Member utterance file is missing");
        }

        const existingManifest = await this.readAnalysisManifest(member, sourceMeta.key);

        if (existingManifest && !this.isManifestStale(existingManifest, utteranceManifest)) {
          this.bulkStatus.skippedMembers += 1;
          return;
        }

        await this.runMemberAnalysis(member, utteranceManifest, sourceMeta.key);
        this.bulkStatus.generatedMembers += 1;
      } catch (error) {
        this.bulkStatus.failedMembers += 1;
        this.bulkStatus.recentErrors = [
          `${member.name}: ${toErrorMessage(error)}`,
          ...this.bulkStatus.recentErrors,
        ].slice(0, 10);
        this.memberStatuses.set(buildAnalysisRuntimeKey(member.slug, sourceMeta.key), {
          ...this.createIdleMemberStatus(member, sourceMeta.key),
          status: "failed",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          error: toErrorMessage(error),
        });
      } finally {
        this.bulkStatus.processedMembers += 1;
      }
    });

    this.bulkStatus.status = this.bulkStatus.failedMembers > 0 ? "completed_with_errors" : "completed";
    this.bulkStatus.finishedAt = new Date().toISOString();
    this.bulkStatus.lastCompletedAt = this.bulkStatus.finishedAt;
    this.bulkStatus.current = null;
  }

  async runSingleMemberAnalysis(member, options = {}) {
    const sourceMeta = getAnalysisSourceMeta(options.sourceType);
    const utteranceManifest = await this.ensureMemberUtteranceFileReady(member, sourceMeta.key);
    const existingManifest = await this.readAnalysisManifest(member, sourceMeta.key);

    if (!options.force && existingManifest && !this.isManifestStale(existingManifest, utteranceManifest)) {
      this.memberStatuses.set(buildAnalysisRuntimeKey(member.slug, sourceMeta.key), {
        status: "completed",
        sourceType: sourceMeta.key,
        sourceLabel: sourceMeta.label,
        startedAt: existingManifest.startedAt || null,
        finishedAt: existingManifest.generatedAt,
        generatedAt: existingManifest.generatedAt,
        currentStage: null,
        processedChunks: existingManifest.chunkCount || 0,
        totalChunks: existingManifest.chunkCount || 0,
        error: null,
        isStale: false,
        configured: this.analysisClient.isConfigured(),
        provider: existingManifest.provider || this.analysisClient.provider || "unknown",
        model: existingManifest.model || this.analysisClient.model,
        hasAnalysis: true,
        memberSlug: member.slug,
      });
      return existingManifest;
    }

    return this.runMemberAnalysis(member, utteranceManifest, sourceMeta.key);
  }

  async runMemberAnalysis(member, utteranceManifest, sourceType = "full") {
    const sourceMeta = getAnalysisSourceMeta(sourceType);
    const runtimeKey = buildAnalysisRuntimeKey(member.slug, sourceMeta.key);
    const status = this.createIdleMemberStatus(member, sourceMeta.key);
    status.status = "running";
    status.startedAt = new Date().toISOString();
    this.memberStatuses.set(runtimeKey, status);

    const fileText = await fs.readFile(utteranceManifest.filePath, "utf8");
    const chunks = fileText.length > MAX_DIRECT_ANALYSIS_CHARS
      ? splitTextIntoChunks(fileText)
      : [fileText];
    status.totalChunks = chunks.length;

    let analysis;

    if (chunks.length === 1) {
      status.currentStage = "analyzing";
      analysis = await this.executeAnalysisRequest({
        member,
        name: `member_political_analysis_${sourceMeta.key}`,
        input: buildDirectAnalysisInput(member, utteranceManifest, fileText, sourceMeta.key),
      });
      status.processedChunks = 1;
    } else {
      const chunkDigests = [];

      for (const [index, chunk] of chunks.entries()) {
        status.currentStage = `chunk_${index + 1}_of_${chunks.length}`;
        const digest = await this.executeAnalysisRequest({
          member,
          name: `member_chunk_analysis_${sourceMeta.key}`,
          input: buildDirectAnalysisInput(member, utteranceManifest, chunk, sourceMeta.key),
        });
        chunkDigests.push({
          chunkNumber: index + 1,
          analysis: digest,
        });
        status.processedChunks = index + 1;
      }

      status.currentStage = "synthesizing";
      analysis = await this.executeAnalysisRequest({
        member,
        name: `member_final_analysis_${sourceMeta.key}`,
        input: buildChunkSynthesisInput(member, utteranceManifest, chunkDigests, sourceMeta.key),
      });
    }

    const generatedAt = new Date().toISOString();
    const manifest = {
      version: ANALYSIS_VERSION,
      sourceType: sourceMeta.key,
      sourceLabel: sourceMeta.label,
      memberSlug: member.slug,
      memberName: member.name,
      partyName: member.partyName,
      generatedAt,
      startedAt: status.startedAt,
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model,
      sourceUtterancePath: utteranceManifest.filePath,
      sourceUtteranceGeneratedAt: utteranceManifest.generatedAt,
      chunkCount: chunks.length,
      markdownPath: this.getAnalysisMarkdownPath(member, sourceMeta.key),
      analysis,
    };

    await writeTextFile(
      manifest.markdownPath,
      formatAnalysisMarkdown(member, manifest),
    );
    await writeJson(this.getAnalysisJsonPath(member, sourceMeta.key), manifest);
    this.promotionService?.requestPromotion("memberAnalyses");

    this.memberStatuses.set(runtimeKey, {
      status: "completed",
      sourceType: sourceMeta.key,
      sourceLabel: sourceMeta.label,
      startedAt: status.startedAt,
      finishedAt: generatedAt,
      generatedAt,
      currentStage: null,
      processedChunks: chunks.length,
      totalChunks: chunks.length,
      error: null,
      isStale: false,
      configured: true,
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model,
      hasAnalysis: true,
      memberSlug: member.slug,
    });

    return manifest;
  }

  async deleteMemberAnalysisFiles(member, sourceType = "full") {
    const sourceMeta = getAnalysisSourceMeta(sourceType);
    const runtimeKey = buildAnalysisRuntimeKey(member.slug, sourceMeta.key);
    await Promise.all([
      fs.rm(this.getAnalysisJsonPath(member, sourceMeta.key), { force: true }),
      fs.rm(this.getAnalysisMarkdownPath(member, sourceMeta.key), { force: true }),
    ]);
    this.memberStatuses.delete(runtimeKey);
  }

  async runAdminProfileRebuild() {
    const rebuildStatus = this.adminProfileRebuildStatus;
    const sourceTypes = ["small"];
    const resumePromotion =
      typeof this.promotionService?.suspendAutoPromotion === "function"
        ? this.promotionService.suspendAutoPromotion()
        : null;

    try {
      rebuildStatus.status = "waiting_for_source_files";

      for (const sourceType of sourceTypes) {
        await this.memberProtocolService.ensureAllMemberUtteranceFilesReady(sourceType);
      }

      rebuildStatus.status = "running";

      for (const sourceType of sourceTypes) {
        const sourceMeta = getAnalysisSourceMeta(sourceType);

        await mapWithConcurrency(this.memberProtocolService.members, ANALYSIS_CONCURRENCY, async (member) => {
          const runtimeKey = buildAnalysisRuntimeKey(member.slug, sourceMeta.key);

          try {
            rebuildStatus.current = {
              slug: member.slug,
              name: member.name,
              partyName: member.partyName,
              sourceType: sourceMeta.key,
              sourceLabel: sourceMeta.label,
            };

            if (this.memberPromises.has(runtimeKey)) {
              await this.memberPromises.get(runtimeKey);
            }

            const utteranceManifest = await this.memberProtocolService.getMemberUtteranceFileDownload(
              member.slug,
              sourceMeta.key,
            );

            if (!utteranceManifest) {
              throw new Error(`The ${sourceMeta.label} quotes file is missing.`);
            }

            await this.deleteMemberAnalysisFiles(member, sourceMeta.key);
            await this.runSingleMemberAnalysis(member, {
              force: true,
              sourceType: sourceMeta.key,
            });
            rebuildStatus.generatedProfiles += 1;
          } catch (error) {
            rebuildStatus.failedProfiles += 1;
            rebuildStatus.recentErrors = [
              `${member.name} (${sourceMeta.label}): ${toErrorMessage(error)}`,
              ...rebuildStatus.recentErrors,
            ].slice(0, 10);
            this.memberStatuses.set(runtimeKey, {
              ...this.createIdleMemberStatus(member, sourceMeta.key),
              status: "failed",
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
              error: toErrorMessage(error),
            });
          } finally {
            rebuildStatus.processedProfiles += 1;
          }
        });
      }

      rebuildStatus.status = rebuildStatus.failedProfiles > 0 ? "completed_with_errors" : "completed";
      rebuildStatus.finishedAt = new Date().toISOString();
      rebuildStatus.lastCompletedAt = rebuildStatus.finishedAt;
      rebuildStatus.current = null;
    } finally {
      if (resumePromotion) {
        await resumePromotion();
      }
    }
  }

  async startAdminProfileRebuild() {
    await this.initialize();

    if (!this.analysisClient.isConfigured()) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    if (this.adminProfileRebuildPromise) {
      return this.getAdminProfileRebuildStatus();
    }

    if (this.bulkPromise || this.memberPromises.size > 0) {
      throw new Error("Another MK profile analysis job is already running.");
    }

    this.adminProfileRebuildStatus = {
      ...this.createIdleAdminProfileRebuildStatus(),
      status: "waiting_for_source_files",
      startedAt: new Date().toISOString(),
      lastCompletedAt: this.adminProfileRebuildStatus.lastCompletedAt || null,
      configured: true,
      provider: this.analysisClient.provider || "unknown",
      model: this.analysisClient.model,
    };

    this.adminProfileRebuildPromise = this.runAdminProfileRebuild()
      .catch((error) => {
        this.adminProfileRebuildStatus.status = "failed";
        this.adminProfileRebuildStatus.finishedAt = new Date().toISOString();
        this.adminProfileRebuildStatus.current = null;
        this.adminProfileRebuildStatus.recentErrors = [toErrorMessage(error)];
      })
      .finally(() => {
        this.adminProfileRebuildPromise = null;
      });

    return this.getAdminProfileRebuildStatus();
  }

  normalizeQualitativeGroup(group) {
    if (!group) return { bullets: [] };

    let bulletsRaw = Array.isArray(group) ? group : (Array.isArray(group.bullets) ? group.bullets : []);
    let normalizedBullets = [];

    for (const b of bulletsRaw) {
      if (!b || typeof b !== "object") continue;
      const point = b.point || b.bullet || "";
      const evidenceRaw = b.evidence || [];
      let normalizedEvidence = [];

      if (Array.isArray(evidenceRaw)) {
        for (const e of evidenceRaw) {
          if (e && typeof e === "object") {
            normalizedEvidence.push(e);
          } else if (typeof e === "string" && e.trim()) {
            normalizedEvidence.push({ quote: e.trim(), explanation: "", protocolHeading: "" });
          }
        }
      } else if (typeof evidenceRaw === "string" && evidenceRaw.trim()) {
        normalizedEvidence.push({ quote: evidenceRaw.trim(), explanation: "", protocolHeading: "" });
      }

      normalizedBullets.push({
        point,
        evidence: normalizedEvidence,
      });
    }

    return { bullets: normalizedBullets };
  }

  normalizeQualitativeLayer(layer) {
    if (!layer || typeof layer !== "object") return {};
    return {
      coreStances: this.normalizeQualitativeGroup(layer.coreStances),
      psychologicalProfile: this.normalizeQualitativeGroup(layer.psychologicalProfile),
      clashesAndIncongruencies: this.normalizeQualitativeGroup(layer.clashesAndIncongruencies),
    };
  }

  normalizeAnalysisOutput(output) {
    if (!output || typeof output !== "object") return output;

    if (output.analysisSections) {
      if (output.analysisSections.textBased) {
        output.analysisSections.textBased = this.normalizeQualitativeLayer(output.analysisSections.textBased);
      }
      if (output.analysisSections.betweenTheLines) {
        output.analysisSections.betweenTheLines = this.normalizeQualitativeLayer(output.analysisSections.betweenTheLines);
      }
    }

    return output;
  }

  async executeAnalysisRequest(options) {
    const member = options.member;
    const created = await this.analysisClient.createStructuredResponse({
      instructions: buildAnalysisInstructions(member.name, member.partyName),
      input: options.input,
      schema: FINAL_ANALYSIS_SCHEMA_V2,
      name: options.name,
      metadata: {
        member_slug: member.slug,
        member_name: member.name,
      },
      background: true,
      store: true,
    });
    const completed = await this.analysisClient.waitForResponse(created.id, {
      pollIntervalMs: 5000,
      maxWaitMs: 30 * 60 * 1000,
    });

    const output = this.analysisClient.extractStructuredOutput(completed);
    return this.normalizeAnalysisOutput(output);
  }
}

module.exports = {
  AXIS_LABELS,
  buildAnalysisInstructions,
  MemberAnalysisService,
};

