const crypto = require("crypto");
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
const {
  MEMBER_PROTOCOL_SINCE_DATE,
  MEMBER_PROTOCOL_SINCE_YEAR,
  getMemberRegistry,
  normalizeMemberLookupName,
} = require("./member-registry");

const CACHE_VERSION = 3;
const UTTERANCE_FILE_VERSION = 4;
const INDEX_CONCURRENCY = 4;
const UTTERANCE_BUILD_CONCURRENCY = 3;
const CHECKPOINT_INTERVAL = 100;
const MAX_SNIPPET_LENGTH = 220;
const MIN_MEMBER_UTTERANCE_WORDS = 50;
const SMALL_UTTERANCE_PROTOCOL_LIMIT = 10;
const MAX_SUMMARY_KEYWORDS = 4;
const MAX_MEETING_TOPICS = 2;
const LANDING_RECENT_PROTOCOL_SCAN_LIMIT = 28;
const LANDING_RECENT_QUOTES_PER_PROTOCOL = 4;
const LANDING_RECENT_QUOTE_MIN_WORDS = 18;
const LANDING_RECENT_QUOTE_MAX_LENGTH = 320;
const LANDING_RECENT_QUOTE_MIN_SCORE = 5;
const LANDING_RECENT_QUOTE_MAX_PER_MEMBER = 2;
const LANDING_RECENT_QUOTE_MAX_PER_PROTOCOL = 3;
const SPEAKER_ROLE_PREFIXES = [
  "ראש הממשלה",
  "ממלא מקום ראש הממשלה",
  "יושב ראש הכנסת",
  "יושבת ראש הכנסת",
  'יו"ר הכנסת',
  "יושב ראש",
  "יושבת ראש",
  'היו"ר',
  'יו"ר',
  "סגן יושב ראש הכנסת",
  "סגנית יושב ראש הכנסת",
  "חבר הכנסת",
  "חברת הכנסת",
  "חבר כנסת",
  "חברת כנסת",
  'ח"כ',
];
const SPEAKER_MEMBER_SIGNAL_PREFIXES = [
  ...SPEAKER_ROLE_PREFIXES,
  "שר",
  "השר",
  "שרה",
  "השרה",
  "סגן שר",
  "סגנית שר",
  "סגן השר",
  "סגנית השר",
];
const HISTORICAL_PARTY_LABELS = [
  "המחנה הממלכתי",
  "כחול לבן",
  "הרשימה המשותפת",
  "הרשימה הערבית המאוחדת",
  "רשימת האיחוד הערבי",
  "מרצ",
];
const COMPOUND_SURNAME_PREFIXES = new Set(["בן", "בר", "אל", "אבו", "אבן"]);

const LANDING_PROVOCATIVE_TERMS = [
  { term: "הפקרה", weight: 3.5 },
  { term: "מחדל", weight: 3.5 },
  { term: "כישלון", weight: 3 },
  { term: "בושה", weight: 2.5 },
  { term: "חרפה", weight: 3 },
  { term: "שערורייה", weight: 3 },
  { term: "שקר", weight: 2.5 },
  { term: "שקרים", weight: 2.5 },
  { term: "דיקטטורה", weight: 3.5 },
  { term: "סמכותנות", weight: 2.5 },
  { term: "הפיכה", weight: 3 },
  { term: "שחיתות", weight: 3 },
  { term: "מושחת", weight: 3 },
  { term: "מושחתת", weight: 3 },
  { term: "טרור", weight: 2.5 },
  { term: "דם", weight: 2 },
  { term: "מלחמה", weight: 2 },
  { term: "אסון", weight: 2.5 },
  { term: "קריסה", weight: 2.5 },
  { term: "כאוס", weight: 2.5 },
  { term: "איום", weight: 2 },
  { term: "חטופים", weight: 2.5 },
  { term: "חטוף", weight: 2.5 },
  { term: "אנטישמי", weight: 2.5 },
  { term: "גזענות", weight: 2.5 },
  { term: "הסתה", weight: 2.5 },
  { term: "אלימות", weight: 2.5 },
  { term: "רצח", weight: 2.5 },
  { term: "נרצח", weight: 2.5 },
  { term: "נרצחו", weight: 2.5 },
];

const LANDING_EMOTIONAL_TERMS = [
  { term: "כואב", weight: 2 },
  { term: "כאב", weight: 2 },
  { term: "קשה", weight: 1.5 },
  { term: "פחד", weight: 2 },
  { term: "מפחד", weight: 2 },
  { term: "חרדה", weight: 2 },
  { term: "בכיתי", weight: 2.5 },
  { term: "בוכה", weight: 2.5 },
  { term: "דמעות", weight: 2.5 },
  { term: "טראומה", weight: 2.5 },
  { term: "טראומטי", weight: 2.5 },
  { term: "זועם", weight: 2 },
  { term: "זעם", weight: 2 },
  { term: "מתבייש", weight: 2 },
  { term: "מתביישת", weight: 2 },
  { term: "התביישתי", weight: 2 },
  { term: "איבדתי", weight: 2.5 },
  { term: "איבדה", weight: 2.5 },
  { term: "איבדו", weight: 2.5 },
  { term: "אמא", weight: 1.5 },
  { term: "אימא", weight: 1.5 },
  { term: "אבא", weight: 1.5 },
  { term: "ילדים", weight: 1.5 },
  { term: "ילדיי", weight: 1.5 },
  { term: "בני", weight: 1.5 },
  { term: "בתי", weight: 1.5 },
  { term: "משפחה", weight: 1.5 },
];

const LANDING_ACCOUNTABILITY_TERMS = [
  { term: "ראש הממשלה", weight: 1.5 },
  { term: "הממשלה", weight: 1.2 },
  { term: "השר", weight: 1 },
  { term: "השרים", weight: 1 },
  { term: "האופוזיציה", weight: 1 },
  { term: "הקואליציה", weight: 1 },
  { term: "היועצת המשפטית", weight: 1.3 },
  { term: "בית המשפט", weight: 1.2 },
];

const LANDING_RHETORICAL_PATTERNS = [
  { regex: /איך ייתכן/gu, weight: 2.2, label: "rhetorical_question" },
  { regex: /לא יכול להיות/gu, weight: 2, label: "impossibility_claim" },
  { regex: /אי[- ]אפשר/gu, weight: 1.6, label: "impossibility_claim" },
  { regex: /אני שואל/gu, weight: 1.4, label: "direct_questioning" },
  { regex: /אני שואלת/gu, weight: 1.4, label: "direct_questioning" },
  { regex: /חבריי חברי הכנסת/gu, weight: 1, label: "plenum_address" },
  { regex: /אדוני היושב[- ]ראש/gu, weight: 0.9, label: "chair_address" },
  { regex: /אדוני השר/gu, weight: 1.1, label: "minister_address" },
  { regex: /אתם /gu, weight: 0.8, label: "direct_address_plural" },
  { regex: /אתה /gu, weight: 0.8, label: "direct_address_singular" },
  { regex: /אני מבקש/gu, weight: 0.8, label: "demand" },
  { regex: /אני דורש/gu, weight: 1.6, label: "demand" },
  { regex: /אני דורשת/gu, weight: 1.6, label: "demand" },
];

const UTTERANCE_FILE_VARIANTS = {
  full: {
    key: "full",
    label: "קובץ האמירות המלא",
    fileLabel: "אמירות-מלא",
    protocolLimit: null,
  },
  small: {
    key: "small",
    label: "קובץ האמירות הקטן",
    fileLabel: `אמירות-קטן-${SMALL_UTTERANCE_PROTOCOL_LIMIT}-אחרונים`,
    protocolLimit: SMALL_UTTERANCE_PROTOCOL_LIMIT,
  },
};

const INVALID_TOPIC_PATTERNS = [
  /^נכחו/u,
  /^חברי/u,
  /^מוזמנים/u,
  /^ייעוץ/u,
  /^מנהל/u,
  /^רישום/u,
  /^פרוטוקול/u,
  /^יום /u,
  /^מושב/u,
  /^הכנסת/u,
  /^הישיבה /u,
  /^הצבעה$/u,
  /^אושר\.?$/u,
];

const SUMMARY_STOPWORDS = new Set([
  "אחר",
  "אחרים",
  "אחרות",
  "אבל",
  "אמור",
  "אמר",
  "אמרנו",
  "אמרתי",
  "אמרו",
  "אומר",
  "אז",
  "אחד",
  "אחת",
  "אחרי",
  "אין",
  "אני",
  "אנחנו",
  "אם",
  "את",
  "אתה",
  "אתם",
  "אתן",
  "בגלל",
  "בוועדה",
  "ביותר",
  "במהלך",
  "בעניין",
  "בעד",
  "בעיקר",
  "גם",
  "דבר",
  "דברים",
  "דיון",
  "דיבר",
  "דיברה",
  "דיברו",
  "לדבר",
  "לכולם",
  "האם",
  "הדיון",
  "הוא",
  "הוועדה",
  "היום",
  "היו",
  "היושב",
  "הכנסת",
  "הם",
  "הן",
  "הצעה",
  "הצעת",
  "זה",
  "זאת",
  "זו",
  "חבר",
  "חברת",
  "חברי",
  "יותר",
  "יש",
  "ישיבה",
  "ישיבות",
  "כאן",
  "כך",
  "כל",
  "כולם",
  "כן",
  "כדי",
  "כולל",
  "לא",
  "לומר",
  "לגבי",
  "להם",
  "להן",
  "לנו",
  "לעשות",
  "לפני",
  "לפי",
  "מאוד",
  "מה",
  "מול",
  "ממש",
  "משרד",
  "מבחינת",
  "נעשה",
  "עד",
  "עוד",
  "עכשיו",
  "על",
  "עם",
  "פעם",
  "פה",
  "פרוטוקול",
  "פרוטוקולים",
  "צריך",
  "צריכה",
  "צריכים",
  "רבה",
  "ראש",
  "של",
  "שם",
  "שנה",
  "שנים",
  "שלום",
  "תודה",
  "זמן",
  "בבקשה",
]);

const memberFileDateFormatter = new Intl.DateTimeFormat("he-IL", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jerusalem",
});

function buildProtocolKey(source, documentId) {
  return `${source}:${documentId}`;
}

function computeMemberRegistrySignature(members) {
  const normalizedMembers = (Array.isArray(members) ? members : [])
    .map((member) => ({
      id: member.id || null,
      slug: member.slug || null,
      name: member.name || null,
      partyName: member.partyName || null,
      aliases: Array.isArray(member.aliases) ? [...member.aliases].sort() : [],
    }))
    .sort((left, right) => String(left.slug || "").localeCompare(String(right.slug || ""), "he"));

  return crypto.createHash("sha1").update(JSON.stringify(normalizedMembers)).digest("hex");
}

function normalizeProtocolText(value) {
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

function trimSnippet(value, maxLength = MAX_SNIPPET_LENGTH) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function buildAliasMatcher(alias) {
  const normalizedAlias = normalizeProtocolText(alias);

  if (!normalizedAlias) {
    return null;
  }

  return {
    alias,
    normalizedAlias,
    regex: new RegExp(`(?:^|\\s)${escapeRegExp(normalizedAlias)}(?:$|\\s)`, "u"),
  };
}

function registerUniqueMemberLookup(map, key, member) {
  if (!key) {
    return;
  }

  if (!map.has(key)) {
    map.set(key, member);
    return;
  }

  const existing = map.get(key);

  if (existing && existing.slug !== member.slug) {
    map.set(key, null);
  }
}

function tokenizeSpeakerLookupName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/<<[^>]+>>/gu, " ")
    .replace(/['"׳״`]/g, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[-‐‑‒–—―־/]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function normalizeSpeakerLooseToken(token) {
  return String(token || "")
    .toLowerCase()
    .replace(/יי+/g, "י")
    .replace(/וו+/g, "ו")
    .replace(/[יו](?=ה$)/g, "");
}

function tokenizeLooseSpeakerName(value) {
  return tokenizeSpeakerLookupName(value).map(normalizeSpeakerLooseToken).filter(Boolean);
}

function buildTokenKey(tokens) {
  return [...tokens].sort().join(" ");
}

function containsAllTokens(haystack, needles) {
  if (!needles.length) {
    return false;
  }

  const remaining = [...haystack];

  for (const needle of needles) {
    const index = remaining.indexOf(needle);

    if (index === -1) {
      return false;
    }

    remaining.splice(index, 1);
  }

  return true;
}

function guessSurnameTokens(tokens) {
  if (tokens.length >= 2 && COMPOUND_SURNAME_PREFIXES.has(tokens[tokens.length - 2])) {
    return tokens.slice(-2);
  }

  return tokens.length ? [tokens[tokens.length - 1]] : [];
}

function cleanSpeakerLabelCandidate(value) {
  return String(value || "")
    .replace(/<<[^>]+>>/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;:.\-–—)\]]+/gu, "")
    .replace(/[,;:.\-–—(\[]+$/gu, "")
    .trim();
}

function stripSpeakerRolePrefixes(value) {
  let cleaned = cleanSpeakerLabelCandidate(value);
  let changed = true;

  while (changed) {
    changed = false;

    for (const prefix of SPEAKER_MEMBER_SIGNAL_PREFIXES) {
      const pattern = new RegExp(`^${escapeRegExp(prefix)}\\s+`, "u");

      if (!pattern.test(cleaned)) {
        continue;
      }

      cleaned = cleanSpeakerLabelCandidate(cleaned.replace(pattern, ""));
      changed = true;
    }
  }

  return cleaned;
}

function mergeSingleLetterRuns(tokens) {
  const merged = [];
  let buffer = [];

  const flushBuffer = () => {
    if (!buffer.length) {
      return;
    }

    merged.push(buffer.join(""));
    buffer = [];
  };

  for (const token of tokens) {
    if (/^\p{L}$/u.test(token)) {
      buffer.push(token);
      continue;
    }

    flushBuffer();
    merged.push(token);
  }

  flushBuffer();
  return merged;
}

function isSafeSpeakerAlias(memberName, alias) {
  const memberTokens = tokenizeLooseSpeakerName(memberName);
  const aliasTokens = tokenizeLooseSpeakerName(alias);

  if (memberTokens.length < 2 || aliasTokens.length < 2) {
    return false;
  }

  const memberSurnameKey = guessSurnameTokens(memberTokens).join(" ");
  const aliasSurnameKey = guessSurnameTokens(aliasTokens).join(" ");

  if (aliasTokens[0] === memberTokens[0]) {
    if (memberSurnameKey && memberSurnameKey === aliasSurnameKey) {
      return true;
    }

    if (aliasTokens.length === memberTokens.length) {
      return true;
    }

    if (containsAllTokens(aliasTokens, memberTokens)) {
      return true;
    }
  }

  return Boolean(memberSurnameKey) && memberSurnameKey === aliasSurnameKey && aliasTokens.length === memberTokens.length;
}

function buildSpeakerLabelCandidates(label, options = {}) {
  const includeSignalVariants = Boolean(options.includeSignalVariants);
  const candidates = new Set();
  const addCandidate = (value) => {
    const cleaned = cleanSpeakerLabelCandidate(value);

    if (cleaned) {
      candidates.add(cleaned);
    }
  };

  addCandidate(label);

  if (includeSignalVariants) {
    addCandidate(String(label || "").replace(/\([^)]*\)/gu, " "));

    for (const candidate of Array.from(candidates)) {
      addCandidate(stripSpeakerRolePrefixes(candidate));
      addCandidate(candidate.replace(/\s+[–—-]\s+.+$/u, " "));
      addCandidate(stripSpeakerRolePrefixes(candidate.replace(/\s+[–—-]\s+.+$/u, " ")));
    }
  }

  for (const candidate of Array.from(candidates)) {
    const tokens = tokenizeSpeakerLookupName(candidate);

    if (!tokens.length) {
      continue;
    }

    const mergedTokens = mergeSingleLetterRuns(tokens);

    if (mergedTokens.join(" ") !== tokens.join(" ")) {
      addCandidate(mergedTokens.join(" "));
    }

    if (includeSignalVariants) {
      for (let size = 2; size <= Math.min(4, mergedTokens.length); size += 1) {
        addCandidate(mergedTokens.slice(-size).join(" "));
      }
    }
  }

  return Array.from(candidates);
}

function labelHasMemberSignal(label, knownPartySignals) {
  const raw = String(label || "").trim();
  const normalized = normalizeProtocolText(raw);

  if (!normalized) {
    return false;
  }

  if (
    SPEAKER_MEMBER_SIGNAL_PREFIXES.some((prefix) =>
      new RegExp(`^${escapeRegExp(normalizeProtocolText(prefix))}(?:$|\\s)`, "u").test(normalized),
    )
  ) {
    return true;
  }

  const fragments = [];

  for (const match of raw.matchAll(/\(([^)]+)\)/gu)) {
    fragments.push(match[1]);
  }

  const dashMatch = raw.match(/\s+[–—-]\s+(.+)$/u);

  if (dashMatch?.[1]) {
    fragments.push(dashMatch[1]);
  }

  return fragments.some((fragment) => {
    const normalizedFragment = normalizeProtocolText(fragment);

    return knownPartySignals.some((signal) => normalizedFragment.includes(signal));
  });
}

function parseSpeakerParagraph(paragraph) {
  const trimmed = String(paragraph || "").trim();
  const match = trimmed.match(/^<<\s*([^>]+?)\s*>>\s*(.+?)\s*:\s*<<\s*([^>]+?)\s*>>$/u);

  if (!match) {
    return null;
  }

  return {
    raw: trimmed,
    marker: match[1],
    speakerLabel: match[2].trim(),
    closingMarker: match[3],
    normalizedSpeakerLabel: normalizeProtocolText(match[2]),
  };
}

function isProtocolMarkerParagraph(paragraph) {
  return /^<<\s*[^>]+?\s*>>.*<<\s*[^>]+?\s*>>$/u.test(String(paragraph || "").trim());
}

function cleanParagraphForOutput(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function countWords(value) {
  const normalized = normalizeProtocolText(value);

  if (!normalized) {
    return 0;
  }

  return normalized.split(" ").filter(Boolean).length;
}

function formatHumanList(items) {
  const values = items.filter(Boolean);

  if (!values.length) {
    return "";
  }

  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} ו${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")} ו${values[values.length - 1]}`;
}

function normalizeUtteranceFileVariant(value) {
  return String(value || "").trim().toLowerCase() === "small" ? "small" : "full";
}

function getUtteranceFileVariantMeta(value) {
  return UTTERANCE_FILE_VARIANTS[normalizeUtteranceFileVariant(value)];
}

function buildMemberUtteranceRuntimeKey(slug, sourceType) {
  return `${slug}::${normalizeUtteranceFileVariant(sourceType)}`;
}

function cleanTopicText(value) {
  return String(value || "")
    .replace(/^סדר היום[:\s-]*/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,:;.\-–—]+/u, "")
    .replace(/[,:;.\-–—]+$/u, "")
    .trim();
}

function isTopicCandidate(value) {
  const normalized = cleanTopicText(value);

  if (!normalized || normalized.length < 8) {
    return false;
  }

  return !INVALID_TOPIC_PATTERNS.some((pattern) => pattern.test(normalized));
}

function collectMeetingTopics(paragraphs, reference) {
  const topics = [];
  const seen = new Set();

  function addTopic(value) {
    const candidate = cleanTopicText(value);
    const normalized = normalizeProtocolText(candidate);

    if (!normalized || seen.has(normalized) || !isTopicCandidate(candidate)) {
      return;
    }

    seen.add(normalized);
    topics.push(candidate);
  }

  for (let index = 0; index < Math.min(paragraphs.length, 60); index += 1) {
    const paragraph = cleanParagraphForOutput(paragraphs[index]);

    if (!paragraph) {
      continue;
    }

    for (const match of paragraph.matchAll(/<<\s*נושא\s*>>\s*(.+?)\s*<<\s*נושא\s*>>/gu)) {
      addTopic(match[1]);
    }

    if (/^סדר היום[:\s-]*/u.test(paragraph)) {
      addTopic(paragraph);

      for (let offset = 1; offset <= 4; offset += 1) {
        const nextParagraph = cleanParagraphForOutput(paragraphs[index + offset]);

        if (
          !nextParagraph ||
          parseSpeakerParagraph(nextParagraph) ||
          isProtocolMarkerParagraph(nextParagraph) ||
          /^[^:]{1,30}:$/u.test(nextParagraph)
        ) {
          break;
        }

        addTopic(nextParagraph);
      }
    }

    if (topics.length >= MAX_MEETING_TOPICS) {
      break;
    }
  }

  if (!topics.length) {
    addTopic(reference.source === "committee" ? reference.title : reference.title);
  }

  return topics.slice(0, MAX_MEETING_TOPICS);
}

function buildMemberKeywordStopwords(member, extraValues = []) {
  const stopwords = new Set(SUMMARY_STOPWORDS);
  const memberTokens = normalizeProtocolText(
    [member.name, member.partyName, ...(member.aliases || []), ...extraValues].join(" "),
  )
    .split(" ")
    .filter(Boolean);

  for (const token of memberTokens) {
    stopwords.add(token);
  }

  return stopwords;
}

function extractSummaryKeywords(member, utterances, extraValues = []) {
  const stopwords = buildMemberKeywordStopwords(member, extraValues);
  const counts = new Map();

  for (const utterance of utterances) {
    const tokens = normalizeProtocolText(utterance.text).split(" ").filter(Boolean);

    for (const token of tokens) {
      if (token.length < 3 || /^\d+$/u.test(token) || stopwords.has(token)) {
        continue;
      }

      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0], "he");
    })
    .filter(([, count]) => count >= 2)
    .slice(0, MAX_SUMMARY_KEYWORDS)
    .map(([token]) => token);
}

function buildProtocolSummary(reference, paragraphs, member, utterances) {
  const meetingTopics = collectMeetingTopics(paragraphs, reference);
  const keywords = extractSummaryKeywords(member, utterances, meetingTopics);
  const meetingSentence = meetingTopics.length
    ? `הישיבה עסקה ב${formatHumanList(meetingTopics)}.`
    : reference.source === "committee"
      ? `הישיבה עסקה בנושאים שעל סדר היום של ${reference.title}.`
      : "ישיבת המליאה עסקה בנושאים שעל סדר היום של הכנסת.";

  if (keywords.length >= 2) {
    return `${meetingSentence} בדברי ${member.name} בלטו במיוחד הנושאים ${formatHumanList(
      keywords,
    )}.`;
  }

  const leadUtterance = utterances[0]?.text ? trimSnippet(utterances[0].text, 180) : "";

  if (leadUtterance) {
    return `${meetingSentence} בדברי ${member.name} עלו הטענות והדגשים המופיעים בקטעים המלאים להלן, ובראשם: ${leadUtterance}`;
  }

  return `${meetingSentence} בדברי ${member.name} עלו הסוגיות המפורטות בקטעים המלאים להלן.`;
}

function buildProtocolHeading(reference) {
  if (reference.source === "committee") {
    const committeeLabel = reference.committeeTypeDescription
      ? `${reference.title} (${reference.committeeTypeDescription})`
      : reference.title;
    const timeLabel = reference.timeLabel ? `, שעה ${reference.timeLabel}` : "";

    return `${committeeLabel}: ${reference.shortDateLabel}${timeLabel}`;
  }

  const sessionLabel = reference.sessionNumber ? `, ישיבה ${reference.sessionNumber}` : "";
  const timeLabel = reference.timeLabel ? `, שעה ${reference.timeLabel}` : "";

  return `ישיבת מליאת הכנסת${sessionLabel}: ${reference.shortDateLabel}${timeLabel}`;
}

function buildLandingQuoteSnippet(value) {
  return trimSnippet(String(value || "").replace(/\s+/g, " ").trim(), LANDING_RECENT_QUOTE_MAX_LENGTH);
}

function countNormalizedTermOccurrences(normalizedText, term) {
  const normalizedTerm = normalizeProtocolText(term);

  if (!normalizedText || !normalizedTerm) {
    return 0;
  }

  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(normalizedTerm)}(?:$|\\s)`, "gu");
  const matches = normalizedText.match(pattern);
  return matches ? matches.length : 0;
}

function scoreKeywordTerms(normalizedText, definitions) {
  let score = 0;
  const signals = [];

  for (const definition of definitions) {
    const occurrences = countNormalizedTermOccurrences(normalizedText, definition.term);

    if (!occurrences) {
      continue;
    }

    const contribution = Math.min(occurrences, 2) * definition.weight;
    score += contribution;
    signals.push({
      type: "keyword",
      term: definition.term,
      contribution,
      occurrences,
    });
  }

  return {
    score,
    signals,
  };
}

function scorePatternSignals(rawText) {
  let score = 0;
  const signals = [];

  for (const definition of LANDING_RHETORICAL_PATTERNS) {
    const matches = rawText.match(definition.regex);

    if (!matches || !matches.length) {
      continue;
    }

    const contribution = Math.min(matches.length, 2) * definition.weight;
    score += contribution;
    signals.push({
      type: definition.label,
      contribution,
      occurrences: matches.length,
    });
  }

  const questionMarks = (rawText.match(/\?/gu) || []).length;
  if (questionMarks) {
    const contribution = Math.min(questionMarks, 2) * 1.1;
    score += contribution;
    signals.push({
      type: "question_marks",
      contribution,
      occurrences: questionMarks,
    });
  }

  const exclamationMarks = (rawText.match(/!/gu) || []).length;
  if (exclamationMarks) {
    const contribution = Math.min(exclamationMarks, 2) * 0.9;
    score += contribution;
    signals.push({
      type: "exclamation_marks",
      contribution,
      occurrences: exclamationMarks,
    });
  }

  return {
    score,
    signals,
  };
}

function scoreNarrativeSignals(rawText, normalizedText, wordCount) {
  let score = 0;
  const signals = [];

  if (wordCount >= 35 && wordCount <= 140) {
    score += 2.3;
    signals.push({ type: "tight_quote_length", contribution: 2.3 });
  } else if (wordCount > 140 && wordCount <= 220) {
    score += 1.2;
    signals.push({ type: "substantial_quote_length", contribution: 1.2 });
  } else if (wordCount > 260) {
    score -= 1.2;
    signals.push({ type: "too_long", contribution: -1.2 });
  }

  if (/\bאני\b/u.test(rawText) && /(אמא|אימא|אבא|ילד|ילדים|ילדיי|בני|בתי|משפחה|אשתי|בעלי)/u.test(rawText)) {
    score += 2.4;
    signals.push({ type: "personal_testimony", contribution: 2.4 });
  }

  if (/\d/u.test(rawText)) {
    score += 1.1;
    signals.push({ type: "specific_numbers", contribution: 1.1 });
  }

  if (/(היום|אתמול|מחר|בשבוע האחרון|ביום חמישי|ביום ראשון|בימים האחרונים)/u.test(rawText)) {
    score += 0.8;
    signals.push({ type: "time_anchor", contribution: 0.8 });
  }

  if (/(אבל|אלא|לעומת זאת|מצד אחד|מצד שני|האמת היא)/u.test(rawText)) {
    score += 0.9;
    signals.push({ type: "contrast_structure", contribution: 0.9 });
  }

  if (/(דמוקרטיה|ביטחון|תקציב|בריאות|חינוך|חטופים|מילואים|איראן|עזה|לבנון|יוקר המחיה|משטרה|שחיתות)/u.test(rawText)) {
    score += 1.2;
    signals.push({ type: "high_salience_topic", contribution: 1.2 });
  }

  if (/(אני הייתי|אני זוכר|אני זוכרת|גדלתי|בילדותי|נסעתי|ביקרתי|ראיתי|שמעתי)/u.test(rawText)) {
    score += 1.6;
    signals.push({ type: "storytelling", contribution: 1.6 });
  }

  if (normalizedText.startsWith("תודה ") || normalizedText.startsWith("תודה רבה")) {
    score -= 0.6;
    signals.push({ type: "ceremonial_opening", contribution: -0.6 });
  }

  return {
    score,
    signals,
  };
}

function analyzeLandingQuote(text, protocolReference) {
  const rawText = String(text || "").replace(/\s+/g, " ").trim();
  const normalizedText = normalizeProtocolText(rawText);
  const wordCount = countWords(rawText);
  const provocative = scoreKeywordTerms(normalizedText, LANDING_PROVOCATIVE_TERMS);
  const emotional = scoreKeywordTerms(normalizedText, LANDING_EMOTIONAL_TERMS);
  const accountability = scoreKeywordTerms(normalizedText, LANDING_ACCOUNTABILITY_TERMS);
  const rhetoric = scorePatternSignals(rawText);
  const narrative = scoreNarrativeSignals(rawText, normalizedText, wordCount);
  const recencyBoost = protocolReference.dateSortValue
    ? Math.max(0, protocolReference.dateSortValue / 1000 / 60 / 60 / 24 / 1000000)
    : 0;

  const score =
    provocative.score +
    emotional.score +
    accountability.score +
    rhetoric.score +
    narrative.score +
    recencyBoost;

  return {
    score,
    wordCount,
    signals: [
      ...provocative.signals,
      ...emotional.signals,
      ...accountability.signals,
      ...rhetoric.signals,
      ...narrative.signals,
    ],
  };
}

function splitLandingQuoteCandidates(text) {
  const rawText = String(text || "").replace(/\r/g, "").trim();

  if (!rawText) {
    return [];
  }

  const uniqueCandidates = new Set();
  const addCandidate = (value) => {
    const cleaned = cleanParagraphForOutput(value);

    if (!cleaned || countWords(cleaned) < 12) {
      return;
    }

    uniqueCandidates.add(cleaned);
  };
  const paragraphs = rawText
    .split(/\n{2,}|\n/u)
    .map((paragraph) => cleanParagraphForOutput(paragraph))
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    addCandidate(paragraph);

    const sentences = paragraph
      .split(/(?<=[.!?…]|[;:])\s+/u)
      .map((sentence) => cleanParagraphForOutput(sentence))
      .filter(Boolean);

    if (sentences.length < 2) {
      continue;
    }

    for (let index = 0; index < sentences.length; index += 1) {
      addCandidate(sentences[index]);

      if (index + 1 < sentences.length) {
        addCandidate(`${sentences[index]} ${sentences[index + 1]}`);
      }

      if (index + 2 < sentences.length) {
        addCandidate(`${sentences[index]} ${sentences[index + 1]} ${sentences[index + 2]}`);
      }
    }
  }

  addCandidate(rawText);
  return [...uniqueCandidates];
}

function pickLandingQuoteExcerpt(text, protocolReference) {
  const candidates = splitLandingQuoteCandidates(text)
    .map((candidateText) => {
      const analysis = analyzeLandingQuote(candidateText, protocolReference);
      let displayScore = analysis.score;

      if (analysis.wordCount >= LANDING_RECENT_QUOTE_MIN_WORDS && analysis.wordCount <= 85) {
        displayScore += 3.2;
      } else if (analysis.wordCount <= 160) {
        displayScore += 1.4;
      } else if (analysis.wordCount > 240) {
        displayScore -= 4.5;
      } else if (analysis.wordCount > 160) {
        displayScore -= 1;
      }

      return {
        text: candidateText,
        score: analysis.score,
        displayScore,
        wordCount: analysis.wordCount,
        signals: analysis.signals,
      };
    })
    .sort((left, right) => {
      if (right.displayScore !== left.displayScore) {
        return right.displayScore - left.displayScore;
      }

      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const idealWordCount = 52;
      const leftDistance = Math.abs(left.wordCount - idealWordCount);
      const rightDistance = Math.abs(right.wordCount - idealWordCount);

      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      return left.wordCount - right.wordCount;
    });

  const bestCandidate =
    candidates.find(
      (candidate) =>
        candidate.wordCount >= LANDING_RECENT_QUOTE_MIN_WORDS &&
        candidate.wordCount <= 140 &&
        candidate.displayScore >= LANDING_RECENT_QUOTE_MIN_SCORE - 1,
    ) ||
    candidates.find(
      (candidate) =>
        candidate.wordCount >= LANDING_RECENT_QUOTE_MIN_WORDS &&
        candidate.wordCount <= 220 &&
        candidate.displayScore >= LANDING_RECENT_QUOTE_MIN_SCORE,
    ) ||
    candidates.find(
      (candidate) =>
        candidate.wordCount >= LANDING_RECENT_QUOTE_MIN_WORDS &&
        candidate.displayScore >= LANDING_RECENT_QUOTE_MIN_SCORE,
    ) ||
    candidates[0] || {
      text: cleanParagraphForOutput(text),
      score: 0,
      displayScore: 0,
      wordCount: countWords(text),
      signals: [],
    };

  return {
    quote: buildLandingQuoteSnippet(bestCandidate.text),
    quoteSearchText: cleanParagraphForOutput(bestCandidate.text),
    score: bestCandidate.displayScore,
    wordCount: bestCandidate.wordCount,
    signals: bestCandidate.signals,
  };
}

function createProtocolReference(source, protocol) {
  if (source === "committee") {
    return {
      source,
      sourceLabel: "ישיבת ועדה",
      documentId: String(protocol.documentId),
      readerUrl: `/committee-protocol/${encodeURIComponent(protocol.documentId)}`,
      downloadUrl: `/api/committee-protocols/${encodeURIComponent(protocol.documentId)}/download`,
      title: protocol.committeeName || protocol.title,
      shortDateLabel: protocol.shortDateLabel,
      longDateLabel: protocol.longDateLabel,
      timeLabel: protocol.timeLabel || "",
      dateSortValue: Number(protocol.dateSortValue) || 0,
      committeeName: protocol.committeeName || "",
      committeeTypeDescription: protocol.committeeTypeDescription || "",
      sessionNumber: protocol.sessionNumber ?? null,
      knessetNumber: protocol.knessetNumber ?? null,
      description: [
        protocol.committeeTypeDescription || "",
        protocol.timeLabel ? `שעת פתיחה ${protocol.timeLabel}` : "",
        `ישיבה ${protocol.sessionNumber ?? "-"}`,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }

  return {
    source,
    sourceLabel: "ישיבת מליאה",
    documentId: String(protocol.documentId),
    readerUrl: `/protocol/${encodeURIComponent(protocol.documentId)}`,
    downloadUrl: `/api/protocols/${encodeURIComponent(protocol.documentId)}/download`,
    title: protocol.title || protocol.shortDateLabel,
    shortDateLabel: protocol.shortDateLabel,
    longDateLabel: protocol.longDateLabel,
    timeLabel: protocol.timeLabel || "",
    dateSortValue: Number(protocol.dateSortValue) || 0,
    sessionNumber: protocol.sessionNumber ?? null,
    knessetNumber: protocol.knessetNumber ?? null,
    description: [
      protocol.timeLabel ? `שעת פתיחה ${protocol.timeLabel}` : "",
      `ישיבה ${protocol.sessionNumber ?? "-"}`,
      `כנסת ${protocol.knessetNumber ?? "-"}`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function sortProtocolReferences(left, right) {
  if (right.dateSortValue !== left.dateSortValue) {
    return right.dateSortValue - left.dateSortValue;
  }

  if (left.source !== right.source) {
    return left.source.localeCompare(right.source, "he");
  }

  return String(right.documentId).localeCompare(String(left.documentId), "en");
}

class MemberProtocolService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname, "..", "..");
    this.dataDir = path.join(this.rootDir, "data");
    this.cacheFile = path.join(this.dataDir, "member-protocol-index.json");
    this.memberUtterancesDir = path.join(this.dataDir, "member-utterances");
    this.protocolStore = options.protocolStore;
    this.committeeProtocolStore = options.committeeProtocolStore;
    const registry = getMemberRegistry();
    this.parties = registry.parties;
    this.members = registry.members.map((member) => {
      const speakerAliases = Array.from(
        new Set([member.name, ...(member.aliases || [])].filter((alias) => isSafeSpeakerAlias(member.name, alias))),
      );

      return {
        ...member,
        aliasMatchers: speakerAliases.map(buildAliasMatcher).filter(Boolean),
        speakerAliases,
      };
    });
    this.memberRegistrySignature = computeMemberRegistrySignature(this.members);
    this.memberByNormalizedSpeakerName = new Map();
    this.memberBySpeakerTokenKey = new Map();
    this.memberSpeakerSubsetEntries = [];
    this.knownPartySignals = Array.from(
      new Set(
        [...this.parties.map((party) => party.name), ...HISTORICAL_PARTY_LABELS]
          .map((value) => normalizeProtocolText(value))
          .filter(Boolean),
      ),
    );

    for (const member of this.members) {
      const lookupCandidates = new Set(member.speakerAliases || [member.name]);

      for (const alias of lookupCandidates) {
        registerUniqueMemberLookup(
          this.memberByNormalizedSpeakerName,
          normalizeMemberLookupName(alias),
          member,
        );

        const looseTokens = tokenizeLooseSpeakerName(alias);

        if (looseTokens.length < 2) {
          continue;
        }

        registerUniqueMemberLookup(this.memberBySpeakerTokenKey, buildTokenKey(looseTokens), member);

        this.memberSpeakerSubsetEntries.push({
          member,
          alias,
          looseTokens,
          firstToken: looseTokens[0],
          surnameTokens: guessSurnameTokens(looseTokens),
        });
      }
    }

    this.memberBySlug = new Map(this.members.map((member) => [member.slug, member]));
    this.memberByLookup = new Map();
    for (const member of this.members) {
      this.memberByLookup.set(member.slug, member);
      this.memberByLookup.set(encodeURIComponent(member.slug), member);
      if (member.id) {
        this.memberByLookup.set(member.id, member);
      }
    }
    this.memberProtocols = new Map(this.members.map((member) => [member.slug, []]));
    this.cache = this.createEmptyCache();
    this.status = this.createIdleStatus();
    this.initialized = false;
    this.indexingPromise = null;
    this.persistPromise = Promise.resolve();
    this.memberUtterancePromises = new Map();
    this.memberUtteranceStatuses = new Map();
    this.promotionService = options.promotionService || null;
    this.memberUtteranceBulkPromise = null;
    this.memberUtteranceBulkStatus = this.createIdleUtteranceFileBulkStatus();
    this.adminSmallUtteranceRebuildPromise = null;
    this.adminSmallUtteranceRebuildStatus = this.createIdleAdminSmallUtteranceRebuildStatus();
  }

  createEmptyCache() {
    return {
      version: CACHE_VERSION,
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
      memberRegistrySignature: this.memberRegistrySignature,
      updatedAt: null,
      protocols: {},
    };
  }

  createIdleStatus() {
    return {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      totalProtocols: 0,
      processedProtocols: 0,
      pendingProtocols: 0,
      matchedProtocols: 0,
      failedProtocols: 0,
      current: null,
      recentErrors: [],
      lastIndexedAt: null,
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
    };
  }

  buildMemberUtteranceDownloadUrl(member, sourceType = "full") {
    const routeSlug = member.id || member.slug;
    const variant = getUtteranceFileVariantMeta(sourceType);

    return `/api/members/${encodeURIComponent(routeSlug)}/utterance-file/download?sourceType=${encodeURIComponent(
      variant.key,
    )}`;
  }

  createIdleUtteranceFileStatus(member, sourceType = "full") {
    const routeSlug = member.id || member.slug;
    const variant = getUtteranceFileVariantMeta(sourceType);

    return {
      status: "idle",
      sourceType: variant.key,
      sourceLabel: variant.label,
      protocolLimit: variant.protocolLimit,
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
      minWords: MIN_MEMBER_UTTERANCE_WORDS,
      startedAt: null,
      finishedAt: null,
      generatedAt: null,
      totalProtocols: 0,
      processedProtocols: 0,
      sectionCount: 0,
      utteranceCount: 0,
      current: null,
      error: null,
      downloadName: this.buildMemberUtteranceDownloadName(member, variant.key),
      downloadUrl: this.buildMemberUtteranceDownloadUrl(member, variant.key),
      isPartial: false,
      isStale: false,
    };
  }

  createIdleUtteranceFileBulkStatus() {
    return {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      totalMembers: this.members.length,
      processedMembers: 0,
      generatedMembers: 0,
      skippedMembers: 0,
      failedMembers: 0,
      current: null,
      recentErrors: [],
      lastCompletedAt: null,
    };
  }

  createIdleAdminSmallUtteranceRebuildStatus() {
    return {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      totalMembers: this.members.length,
      processedMembers: 0,
      generatedMembers: 0,
      failedMembers: 0,
      current: null,
      recentErrors: [],
      lastCompletedAt: null,
      sourceType: "small",
      destructive: true,
      confirmationKeyword: "yes",
      warning:
        "This rebuild will take a long time, may cost money, and will delete and recreate every existing small quotes file.",
    };
  }

  resolveMember(reference) {
    const rawReference = String(reference || "").trim();

    if (!rawReference) {
      return null;
    }

    const candidates = new Set([rawReference]);
    const latin1DecodedCandidates = [];

    try {
      const decoded = decodeURIComponent(rawReference);
      candidates.add(decoded);

      try {
        candidates.add(decodeURIComponent(decoded));
      } catch {
        // Ignore invalid second-pass decoding attempts.
      }
    } catch {
      // Ignore invalid URL-encoding sequences.
    }

    for (const candidate of candidates) {
      try {
        const repaired = Buffer.from(candidate, "latin1").toString("utf8").trim();

        if (repaired) {
          latin1DecodedCandidates.push(repaired);
        }
      } catch {
        // Ignore encoding repair attempts that fail.
      }
    }

    for (const repaired of latin1DecodedCandidates) {
      candidates.add(repaired);
    }

    for (const candidate of candidates) {
      const member = this.memberByLookup.get(candidate);

      if (member) {
        return member;
      }
    }

    return null;
  }

  findDirectAliasMatch(member, normalizedSpeakerLabel) {
    return member.aliasMatchers.find((aliasMatcher) => aliasMatcher.regex.test(normalizedSpeakerLabel)) || null;
  }

  lookupMemberBySpeakerCandidate(candidate, allowSignalAwareSubset = false) {
    const normalizedCandidate = normalizeMemberLookupName(candidate);
    const normalizedMatch = this.memberByNormalizedSpeakerName.get(normalizedCandidate);

    if (normalizedMatch) {
      return normalizedMatch;
    }

    const looseTokens = tokenizeLooseSpeakerName(candidate);

    if (looseTokens.length < 2) {
      return null;
    }

    const tokenKeyMatch = this.memberBySpeakerTokenKey.get(buildTokenKey(looseTokens));

    if (tokenKeyMatch) {
      return tokenKeyMatch;
    }

    if (!allowSignalAwareSubset) {
      return null;
    }

    const surnameTokens = guessSurnameTokens(looseTokens);
    const subsetCandidates = this.memberSpeakerSubsetEntries
      .filter((entry) => {
        if (entry.looseTokens.length < 3 || looseTokens.length <= entry.looseTokens.length) {
          return false;
        }

        if (entry.firstToken !== looseTokens[0]) {
          return false;
        }

        if (entry.surnameTokens.length !== surnameTokens.length) {
          return false;
        }

        for (let index = 0; index < surnameTokens.length; index += 1) {
          if (entry.surnameTokens[index] !== surnameTokens[index]) {
            return false;
          }
        }

        return containsAllTokens(looseTokens, entry.looseTokens);
      })
      .sort((left, right) => right.looseTokens.length - left.looseTokens.length);

    if (!subsetCandidates.length) {
      return null;
    }

    const bestLength = subsetCandidates[0].looseTokens.length;
    const bestCandidates = subsetCandidates.filter((entry) => entry.looseTokens.length === bestLength);
    const uniqueMembers = Array.from(new Set(bestCandidates.map((entry) => entry.member.slug)));

    if (uniqueMembers.length !== 1) {
      return null;
    }

    return bestCandidates[0].member;
  }

  findSpeakerMatch(speakerLabel, normalizedSpeakerLabel = normalizeProtocolText(speakerLabel)) {
    const allowSignalAwareSubset = labelHasMemberSignal(speakerLabel, this.knownPartySignals);

    for (const candidate of buildSpeakerLabelCandidates(speakerLabel, { includeSignalVariants: allowSignalAwareSubset })) {
      const member = this.lookupMemberBySpeakerCandidate(candidate, allowSignalAwareSubset);

      if (!member) {
        continue;
      }

      return {
        member,
        alias: member.name,
        speakerLabel,
        matchType: candidate === speakerLabel ? "speaker_candidate" : "speaker_candidate_normalized",
      };
    }

    for (const member of this.members) {
      const directAlias = this.findDirectAliasMatch(member, normalizedSpeakerLabel);

      if (directAlias) {
        return {
          member,
          alias: directAlias.alias,
          speakerLabel,
          matchType: "direct_alias",
        };
      }
    }

    return null;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    await Promise.all([
      ensureDirectory(this.dataDir),
      ensureDirectory(this.memberUtterancesDir),
    ]);
    this.cache = await this.loadCache();
    this.rebuildMemberProtocols();
    this.initialized = true;
  }

  async loadCache() {
    if (!(await fileExists(this.cacheFile))) {
      return this.createEmptyCache();
    }

    let cached;

    try {
      cached = await readJson(this.cacheFile);
    } catch {
      return this.createEmptyCache();
    }

    if (
      cached?.version !== CACHE_VERSION ||
      cached?.sinceDate !== MEMBER_PROTOCOL_SINCE_DATE ||
      cached?.memberRegistrySignature !== this.memberRegistrySignature ||
      typeof cached?.protocols !== "object"
    ) {
      return this.createEmptyCache();
    }

    return {
      version: CACHE_VERSION,
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
      memberRegistrySignature: this.memberRegistrySignature,
      updatedAt: cached.updatedAt || null,
      protocols: cached.protocols || {},
    };
  }

  rebuildMemberProtocols(validProtocolKeys = null) {
    const grouped = new Map(this.members.map((member) => [member.slug, []]));
    let processedProtocols = 0;
    let matchedProtocols = 0;
    let failedProtocols = 0;
    let removedCount = 0;

    for (const [protocolKey, record] of Object.entries(this.cache.protocols)) {
      if (validProtocolKeys && !validProtocolKeys.has(protocolKey)) {
        delete this.cache.protocols[protocolKey];
        removedCount += 1;
        continue;
      }

      processedProtocols += 1;

      if (record.state === "failed") {
        failedProtocols += 1;
      }

      if (Array.isArray(record.matches) && record.matches.length > 0) {
        matchedProtocols += 1;
      }

      for (const match of record.matches || []) {
        const bucket = grouped.get(match.memberSlug);

        if (!bucket) {
          continue;
        }

        bucket.push({
          ...record.reference,
          matchedAlias: match.alias,
          snippet: match.snippet || "",
        });
      }
    }

    this.memberProtocols = grouped;
    return {
      processedProtocols,
      matchedProtocols,
      failedProtocols,
      removedCount,
    };
  }

  queuePersist() {
    this.persistPromise = this.persistPromise
      .catch(() => {})
      .then(async () => {
        await writeJson(this.cacheFile, this.cache);
        this.promotionService?.requestPathPromotion(path.relative(this.rootDir, this.cacheFile));
      });

    return this.persistPromise;
  }

  async persistCheckpoint(contextLabel) {
    try {
      await this.queuePersist();
    } catch (error) {
      this.status.recentErrors = [
        `${contextLabel} - ${toErrorMessage(error)}`,
        ...this.status.recentErrors,
      ].slice(0, 10);
    }
  }

  async getRelevantProtocols() {
    const [plenumProtocols, committeeProtocols] = await Promise.all([
      this.protocolStore.getProtocols(),
      this.committeeProtocolStore.getProtocols(),
    ]);

    const workItems = [];

    for (const protocol of plenumProtocols) {
      if (Number(protocol.year) >= MEMBER_PROTOCOL_SINCE_YEAR) {
        workItems.push({
          key: buildProtocolKey("plenum", protocol.documentId),
          source: "plenum",
          protocol,
        });
      }
    }

    for (const protocol of committeeProtocols) {
      if (Number(protocol.year) >= MEMBER_PROTOCOL_SINCE_YEAR) {
        workItems.push({
          key: buildProtocolKey("committee", protocol.documentId),
          source: "committee",
          protocol,
        });
      }
    }

    workItems.sort((left, right) => {
      return sortProtocolReferences(
        createProtocolReference(left.source, left.protocol),
        createProtocolReference(right.source, right.protocol),
      );
    });

    return workItems;
  }

  async prepareWorkload() {
    await this.initialize();
    const relevantProtocols = await this.getRelevantProtocols();
    const validProtocolKeys = new Set(relevantProtocols.map((item) => item.key));
    const cacheStats = this.rebuildMemberProtocols(validProtocolKeys);

    if (cacheStats.removedCount > 0) {
      await this.persistCheckpoint("member-index-cleanup");
    }

    return {
      relevantProtocols,
      pendingProtocols: relevantProtocols.filter((item) => !this.cache.protocols[item.key]),
      cacheStats,
    };
  }

  getStatus() {
    return {
      ...this.status,
      current: this.status.current ? { ...this.status.current } : null,
      recentErrors: [...this.status.recentErrors],
    };
  }

  updateCompletedStatus(totalProtocols, matchedProtocols, failedProtocols) {
    this.status = {
      status: failedProtocols > 0 ? "completed_with_errors" : "completed",
      startedAt: this.status.startedAt,
      finishedAt: this.cache.updatedAt,
      totalProtocols,
      processedProtocols: totalProtocols,
      pendingProtocols: 0,
      matchedProtocols,
      failedProtocols,
      current: null,
      recentErrors: [],
      lastIndexedAt: this.cache.updatedAt,
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
    };
  }

  async startIndexing() {
    await this.initialize();

    if (this.indexingPromise) {
      return this.getStatus();
    }

    const { relevantProtocols, pendingProtocols, cacheStats } = await this.prepareWorkload();

    if (pendingProtocols.length === 0) {
      this.updateCompletedStatus(
        relevantProtocols.length,
        cacheStats.matchedProtocols,
        cacheStats.failedProtocols,
      );
      return this.getStatus();
    }

    this.status = {
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      totalProtocols: relevantProtocols.length,
      processedProtocols: cacheStats.processedProtocols,
      pendingProtocols: pendingProtocols.length,
      matchedProtocols: cacheStats.matchedProtocols,
      failedProtocols: cacheStats.failedProtocols,
      current: null,
      recentErrors: [],
      lastIndexedAt: this.cache.updatedAt,
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
    };

    this.indexingPromise = this.runIndexing(pendingProtocols, relevantProtocols.length)
      .catch((error) => {
        this.status.status = "failed";
        this.status.finishedAt = new Date().toISOString();
        this.status.current = null;
        this.status.recentErrors = [toErrorMessage(error)];
      })
      .finally(() => {
        this.indexingPromise = null;
      });

    return this.getStatus();
  }

  async runIndexing(pendingProtocols, totalProtocols) {
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= pendingProtocols.length) {
          return;
        }

        const workItem = pendingProtocols[currentIndex];
        this.status.current = {
          source: workItem.source,
          documentId: workItem.protocol.documentId,
          title:
            workItem.source === "committee"
              ? workItem.protocol.committeeName || workItem.protocol.title
              : workItem.protocol.title,
          shortDateLabel: workItem.protocol.shortDateLabel,
        };

        try {
          const record = await this.buildProtocolMatchRecord(workItem);
          this.cache.protocols[workItem.key] = record;
          this.cache.updatedAt = new Date().toISOString();
          this.addRecordToMemberBuckets(record);

          if (record.matches.length > 0) {
            this.status.matchedProtocols += 1;
          }
        } catch (error) {
          const processedAt = new Date().toISOString();
          this.status.failedProtocols += 1;
          this.cache.protocols[workItem.key] = {
            key: workItem.key,
            state: "failed",
            processedAt,
            error: toErrorMessage(error),
            reference: createProtocolReference(workItem.source, workItem.protocol),
            matches: [],
          };
          this.cache.updatedAt = processedAt;
          this.status.recentErrors = [
            `${workItem.source}:${workItem.protocol.documentId} - ${toErrorMessage(error)}`,
            ...this.status.recentErrors,
          ].slice(0, 10);
        } finally {
          this.status.processedProtocols += 1;
          this.status.pendingProtocols = Math.max(0, totalProtocols - this.status.processedProtocols);
          this.status.lastIndexedAt = this.cache.updatedAt;

          if (this.status.processedProtocols % CHECKPOINT_INTERVAL === 0) {
            await this.persistCheckpoint("member-index-checkpoint");
          }
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(INDEX_CONCURRENCY, pendingProtocols.length || 1) },
        () => worker(),
      ),
    );

    this.status.status = this.status.failedProtocols > 0 ? "completed_with_errors" : "completed";
    this.status.finishedAt = new Date().toISOString();
    this.status.current = null;
    this.status.pendingProtocols = 0;
    this.status.lastIndexedAt = this.cache.updatedAt;
    await this.persistCheckpoint("member-index-finalize");
  }

  addRecordToMemberBuckets(record) {
    for (const match of record.matches) {
      const bucket = this.memberProtocols.get(match.memberSlug);

      if (!bucket) {
        continue;
      }

      bucket.push({
        ...record.reference,
        matchedAlias: match.alias,
        snippet: match.snippet || "",
      });
    }
  }

  async buildProtocolMatchRecord(workItem) {
    const store =
      workItem.source === "committee" ? this.committeeProtocolStore : this.protocolStore;
    const content = await store.getProtocolContent(workItem.protocol.documentId);
    const paragraphs = Array.isArray(content?.paragraphs) ? content.paragraphs : [];
    const speakerParagraphs = paragraphs
      .map((paragraph) => parseSpeakerParagraph(paragraph))
      .filter(Boolean);
    const matches = [];
    const seenMembers = new Set();

    for (const speakerParagraph of speakerParagraphs) {
      const matchedSpeaker = this.findSpeakerMatch(
        speakerParagraph.speakerLabel,
        speakerParagraph.normalizedSpeakerLabel,
      );

      if (!matchedSpeaker || seenMembers.has(matchedSpeaker.member.slug)) {
        continue;
      }

      seenMembers.add(matchedSpeaker.member.slug);
      matches.push({
        memberSlug: matchedSpeaker.member.slug,
        alias: matchedSpeaker.alias,
        snippet: trimSnippet(speakerParagraph.raw),
      });
    }

    return {
      key: workItem.key,
      processedAt: new Date().toISOString(),
      reference: createProtocolReference(workItem.source, workItem.protocol),
      matches,
    };
  }

  extractMemberUtterancesWithMinWords(paragraphs, member, minimumWordCount = MIN_MEMBER_UTTERANCE_WORDS) {
    const utterances = [];
    let activeSpeaker = null;
    let activeParagraphs = [];

    const finalizeUtterance = () => {
      if (!activeSpeaker || !activeParagraphs.length) {
        activeSpeaker = null;
        activeParagraphs = [];
        return;
      }

      const text = activeParagraphs.join("\n\n").trim();
      const wordCount = countWords(text);

      if (wordCount >= minimumWordCount) {
        utterances.push({
          alias: activeSpeaker.alias,
          speakerLabel: activeSpeaker.speakerLabel,
          text,
          wordCount,
        });
      }

      activeSpeaker = null;
      activeParagraphs = [];
    };

    for (const paragraph of paragraphs) {
      const speakerParagraph = parseSpeakerParagraph(paragraph);

      if (speakerParagraph) {
        finalizeUtterance();
        const matchedSpeaker = this.findSpeakerMatch(
          speakerParagraph.speakerLabel,
          speakerParagraph.normalizedSpeakerLabel,
        );

        activeSpeaker =
          matchedSpeaker && matchedSpeaker.member.slug === member.slug
            ? {
                alias: matchedSpeaker.alias,
                speakerLabel: speakerParagraph.speakerLabel,
              }
            : null;
        continue;
      }

      if (isProtocolMarkerParagraph(paragraph)) {
        finalizeUtterance();
        continue;
      }

      if (!activeSpeaker) {
        continue;
      }

      const cleaned = cleanParagraphForOutput(paragraph);

      if (!cleaned) {
        continue;
      }

      activeParagraphs.push(cleaned);
    }

    finalizeUtterance();
    return utterances;
  }

  extractMemberUtterances(paragraphs, member) {
    return this.extractMemberUtterancesWithMinWords(paragraphs, member, MIN_MEMBER_UTTERANCE_WORDS);
  }

  resolveMemberFromSpeakerLabel(speakerLabel, normalizedSpeakerLabel = normalizeProtocolText(speakerLabel)) {
    if (!normalizedSpeakerLabel && !speakerLabel) {
      return null;
    }

    return this.findSpeakerMatch(speakerLabel, normalizedSpeakerLabel)?.member || null;
  }

  extractAttributedUtterances(paragraphs, options = {}) {
    const minimumWordCount = Math.max(0, Number(options.minimumWordCount) || 0);
    const utterances = [];
    let activeSpeaker = null;
    let activeParagraphs = [];

    const finalizeUtterance = () => {
      if (!activeSpeaker || !activeParagraphs.length) {
        activeSpeaker = null;
        activeParagraphs = [];
        return;
      }

      const text = activeParagraphs.join("\n\n").trim();
      const wordCount = countWords(text);

      if (wordCount >= minimumWordCount) {
        utterances.push({
          memberSlug: activeSpeaker.member.slug,
          routeSlug: activeSpeaker.member.id || activeSpeaker.member.slug,
          memberName: activeSpeaker.member.name,
          partyName: activeSpeaker.member.partyName,
          alias: activeSpeaker.alias,
          speakerLabel: activeSpeaker.speakerLabel,
          text,
          wordCount,
        });
      }

      activeSpeaker = null;
      activeParagraphs = [];
    };

    for (const paragraph of Array.isArray(paragraphs) ? paragraphs : []) {
      const speakerParagraph = parseSpeakerParagraph(paragraph);

      if (speakerParagraph) {
        finalizeUtterance();
        const matchedSpeaker = this.findSpeakerMatch(
          speakerParagraph.speakerLabel,
          speakerParagraph.normalizedSpeakerLabel,
        );
        const member = matchedSpeaker?.member || null;

        if (!member) {
          activeSpeaker = null;
          continue;
        }

        activeSpeaker = {
          member,
          alias: matchedSpeaker.alias,
          speakerLabel: speakerParagraph.speakerLabel,
        };
        continue;
      }

      if (isProtocolMarkerParagraph(paragraph)) {
        finalizeUtterance();
        continue;
      }

      if (!activeSpeaker) {
        continue;
      }

      const cleaned = cleanParagraphForOutput(paragraph);

      if (!cleaned) {
        continue;
      }

      activeParagraphs.push(cleaned);
    }

    finalizeUtterance();
    return utterances;
  }

  async buildMemberUtteranceSection(member, protocolReference) {
    const store =
      protocolReference.source === "committee" ? this.committeeProtocolStore : this.protocolStore;
    const content = await store.getProtocolContent(protocolReference.documentId);
    const paragraphs = Array.isArray(content?.paragraphs) ? content.paragraphs : [];
    const utterances = this.extractMemberUtterances(paragraphs, member);

    if (!utterances.length) {
      return null;
    }

    return {
      reference: protocolReference,
      heading: buildProtocolHeading(protocolReference),
      summary: buildProtocolSummary(protocolReference, paragraphs, member, utterances),
      utterances,
    };
  }

  buildMemberUtteranceBaseName(member, sourceType = "full") {
    const variant = getUtteranceFileVariantMeta(sourceType);

    return sanitizeFilename(
      `${member.name}__${member.partyName}__אמירות__מ-${MEMBER_PROTOCOL_SINCE_DATE}`,
    );
  }

  buildMemberUtteranceDownloadName(member) {
    return `${this.buildMemberUtteranceBaseName(member)}.txt`;
  }

  getMemberUtteranceManifestPath(member) {
    return path.join(this.memberUtterancesDir, `${this.buildMemberUtteranceBaseName(member)}.json`);
  }

  getMemberUtteranceTextPath(member) {
    return path.join(this.memberUtterancesDir, this.buildMemberUtteranceDownloadName(member));
  }

  async readMemberUtteranceManifest(member) {
    const manifestPath = this.getMemberUtteranceManifestPath(member);

    if (!(await fileExists(manifestPath))) {
      return null;
    }

    try {
      const manifest = await readJson(manifestPath);

      if (
        manifest?.version !== UTTERANCE_FILE_VERSION ||
        manifest?.sinceDate !== MEMBER_PROTOCOL_SINCE_DATE ||
        manifest?.memberSlug !== member.slug ||
        manifest?.memberRegistrySignature !== this.memberRegistrySignature ||
        !(await fileExists(manifest.filePath))
      ) {
        return null;
      }

      return manifest;
    } catch {
      return null;
    }
  }

  buildUtteranceFileText(member, manifest, sections) {
    const headerLines = [
      `חבר הכנסת: ${member.name}`,
      `סיעה: ${member.partyName}`,
      `טווח הסריקה: החל מ-${MEMBER_PROTOCOL_SINCE_DATE}`,
      `מספר פרוטוקולים שנכללו: ${manifest.protocolCount}`,
      `מספר קטעי הדיבור באורך של לפחות ${MIN_MEMBER_UTTERANCE_WORDS} מילים: ${manifest.utteranceCount}`,
      `הקובץ נוצר: ${memberFileDateFormatter.format(new Date(manifest.generatedAt))}`,
    ];

    if (manifest.isPartial) {
      headerLines.push("הערה: הקובץ נבנה כאשר אינדקס החברים לא הושלם לחלוטין או הסתיים עם שגיאות.");
    }

    if (!sections.length) {
      return [
        ...headerLines,
        "",
        `לא נמצאו קטעי דיבור באורך של לפחות ${MIN_MEMBER_UTTERANCE_WORDS} מילים עבור ${member.name} בטווח הסריקה.`,
      ].join("\n");
    }

    const sectionTexts = sections.map((section) =>
      [
        section.heading,
        `תקציר: ${section.summary}`,
        "",
        ...section.utterances.map((utterance) => utterance.text),
      ].join("\n\n"),
    );

    return `${headerLines.join("\n")}\n\n${sectionTexts.join(
      "\n\n----------------------------------------\n\n",
    )}`;
  }

  async getMemberUtteranceFileStatus(slug) {
    await this.initialize();
    const member = this.resolveMember(slug);

    if (!member) {
      return null;
    }

    const canonicalSlug = member.slug;
    const runtimeStatus = this.memberUtteranceStatuses.get(canonicalSlug);

    if (runtimeStatus) {
      return {
        ...runtimeStatus,
        current: runtimeStatus.current ? { ...runtimeStatus.current } : null,
      };
    }

    const manifest = await this.readMemberUtteranceManifest(member);

    if (!manifest) {
      return this.createIdleUtteranceFileStatus(member);
    }

    const isStale = this.isMemberUtteranceManifestStale(manifest);

    return {
      status: "completed",
      sinceDate: manifest.sinceDate,
      minWords: MIN_MEMBER_UTTERANCE_WORDS,
      startedAt: manifest.startedAt || null,
      finishedAt: manifest.generatedAt,
      generatedAt: manifest.generatedAt,
      totalProtocols: manifest.protocolCount,
      processedProtocols: manifest.protocolCount,
      sectionCount: manifest.sectionCount,
      utteranceCount: manifest.utteranceCount,
      current: null,
      error: null,
      downloadName: manifest.downloadName,
      downloadUrl: `/api/members/${encodeURIComponent(member.id || canonicalSlug)}/utterance-file/download`,
      isPartial: Boolean(manifest.isPartial),
      isStale,
    };
  }

  isMemberUtteranceManifestStale(manifest) {
    const currentIndexTime = this.cache.updatedAt ? Date.parse(this.cache.updatedAt) : null;
    const fileIndexTime = manifest?.sourceIndexUpdatedAt
      ? Date.parse(manifest.sourceIndexUpdatedAt)
      : null;

    return Boolean(
      currentIndexTime &&
      fileIndexTime &&
      Number.isFinite(currentIndexTime) &&
      Number.isFinite(fileIndexTime) &&
      fileIndexTime < currentIndexTime,
    );
  }

  getMemberUtteranceFilesBulkStatus() {
    return {
      ...this.memberUtteranceBulkStatus,
      current: this.memberUtteranceBulkStatus.current
        ? { ...this.memberUtteranceBulkStatus.current }
        : null,
      recentErrors: [...this.memberUtteranceBulkStatus.recentErrors],
    };
  }

  getAdminSmallUtteranceRebuildStatus() {
    return {
      ...this.adminSmallUtteranceRebuildStatus,
      current: this.adminSmallUtteranceRebuildStatus.current
        ? { ...this.adminSmallUtteranceRebuildStatus.current }
        : null,
      recentErrors: [...this.adminSmallUtteranceRebuildStatus.recentErrors],
    };
  }

  async deleteMemberUtteranceFiles(member, sourceType = "small") {
    const variant = getUtteranceFileVariantMeta(sourceType);
    const runtimeKey = buildMemberUtteranceRuntimeKey(member.slug, variant.key);
    await Promise.all([
      fs.rm(this.getMemberUtteranceManifestPath(member, variant.key), { force: true }),
      fs.rm(this.getMemberUtteranceTextPath(member, variant.key), { force: true }),
    ]);
    this.memberUtteranceStatuses.delete(runtimeKey);
  }

  async runAdminSmallUtteranceRebuild() {
    const rebuildStatus = this.adminSmallUtteranceRebuildStatus;

    if (this.indexingPromise) {
      rebuildStatus.status = "waiting_for_index";
      await this.indexingPromise;
    }

    rebuildStatus.status = "running";

    await mapWithConcurrency(this.members, 2, async (member) => {
      const runtimeKey = buildMemberUtteranceRuntimeKey(member.slug, "small");

      try {
        rebuildStatus.current = {
          slug: member.slug,
          name: member.name,
          partyName: member.partyName,
          sourceType: "small",
          sourceLabel: UTTERANCE_FILE_VARIANTS.small.label,
        };

        if (this.memberUtterancePromises.has(runtimeKey)) {
          await this.memberUtterancePromises.get(runtimeKey);
        }

        await this.deleteMemberUtteranceFiles(member, "small");
        const runtimeStatus = this.createIdleUtteranceFileStatus(member, "small");
        runtimeStatus.status = this.indexingPromise ? "waiting_for_index" : "running";
        runtimeStatus.startedAt = new Date().toISOString();
        this.memberUtteranceStatuses.set(runtimeKey, runtimeStatus);
        await this.runMemberUtteranceFileBuild(member, "small");
        rebuildStatus.generatedMembers += 1;
      } catch (error) {
        rebuildStatus.failedMembers += 1;
        rebuildStatus.recentErrors = [
          `${member.name}: ${toErrorMessage(error)}`,
          ...rebuildStatus.recentErrors,
        ].slice(0, 10);
        this.memberUtteranceStatuses.set(runtimeKey, {
          ...this.createIdleUtteranceFileStatus(member, "small"),
          status: "failed",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          error: toErrorMessage(error),
        });
      } finally {
        rebuildStatus.processedMembers += 1;
      }
    });

    rebuildStatus.status = rebuildStatus.failedMembers > 0 ? "completed_with_errors" : "completed";
    rebuildStatus.finishedAt = new Date().toISOString();
    rebuildStatus.lastCompletedAt = rebuildStatus.finishedAt;
    rebuildStatus.current = null;
  }

  async startAdminSmallUtteranceRebuild() {
    await this.initialize();

    if (this.adminSmallUtteranceRebuildPromise) {
      return this.getAdminSmallUtteranceRebuildStatus();
    }

    if (this.memberUtteranceBulkPromise) {
      throw new Error("Another member utterance bulk job is already running.");
    }

    await this.startIndexing();
    this.adminSmallUtteranceRebuildStatus = {
      ...this.createIdleAdminSmallUtteranceRebuildStatus(),
      status: this.indexingPromise ? "waiting_for_index" : "running",
      startedAt: new Date().toISOString(),
      lastCompletedAt: this.adminSmallUtteranceRebuildStatus.lastCompletedAt || null,
    };

    this.adminSmallUtteranceRebuildPromise = this.runAdminSmallUtteranceRebuild()
      .catch((error) => {
        this.adminSmallUtteranceRebuildStatus.status = "failed";
        this.adminSmallUtteranceRebuildStatus.finishedAt = new Date().toISOString();
        this.adminSmallUtteranceRebuildStatus.current = null;
        this.adminSmallUtteranceRebuildStatus.recentErrors = [toErrorMessage(error)];
      })
      .finally(() => {
        this.adminSmallUtteranceRebuildPromise = null;
      });

    return this.getAdminSmallUtteranceRebuildStatus();
  }

  async startMemberUtteranceFileBuild(slug) {
    await this.initialize();
    const member = this.resolveMember(slug);

    if (!member) {
      return null;
    }

    const canonicalSlug = member.slug;

    if (this.memberUtterancePromises.has(canonicalSlug)) {
      return this.getMemberUtteranceFileStatus(canonicalSlug);
    }

    await this.startIndexing();
    const runtimeStatus = this.createIdleUtteranceFileStatus(member);
    runtimeStatus.status = this.indexingPromise ? "waiting_for_index" : "running";
    runtimeStatus.startedAt = new Date().toISOString();
    this.memberUtteranceStatuses.set(canonicalSlug, runtimeStatus);

    const buildPromise = this.runMemberUtteranceFileBuild(member)
      .catch((error) => {
        const failedStatus = this.createIdleUtteranceFileStatus(member);
        failedStatus.status = "failed";
        failedStatus.startedAt = runtimeStatus.startedAt;
        failedStatus.finishedAt = new Date().toISOString();
        failedStatus.error = toErrorMessage(error);
        this.memberUtteranceStatuses.set(canonicalSlug, failedStatus);
      })
      .finally(() => {
        this.memberUtterancePromises.delete(canonicalSlug);
      });

    this.memberUtterancePromises.set(canonicalSlug, buildPromise);
    return this.getMemberUtteranceFileStatus(canonicalSlug);
  }

  async startAllMemberUtteranceFileBuilds() {
    await this.initialize();

    if (this.adminSmallUtteranceRebuildPromise) {
      throw new Error("The admin-only small quotes rebuild is already running.");
    }

    if (this.memberUtteranceBulkPromise) {
      return this.getMemberUtteranceFilesBulkStatus();
    }

    await this.startIndexing();
    this.memberUtteranceBulkStatus = {
      status: this.indexingPromise ? "waiting_for_index" : "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      totalMembers: this.members.length,
      processedMembers: 0,
      generatedMembers: 0,
      skippedMembers: 0,
      failedMembers: 0,
      current: null,
      recentErrors: [],
      lastCompletedAt: this.memberUtteranceBulkStatus.lastCompletedAt || null,
    };

    this.memberUtteranceBulkPromise = this.runAllMemberUtteranceFileBuilds()
      .catch((error) => {
        this.memberUtteranceBulkStatus.status = "failed";
        this.memberUtteranceBulkStatus.finishedAt = new Date().toISOString();
        this.memberUtteranceBulkStatus.current = null;
        this.memberUtteranceBulkStatus.recentErrors = [toErrorMessage(error)];
      })
      .finally(() => {
        this.memberUtteranceBulkPromise = null;
      });

    return this.getMemberUtteranceFilesBulkStatus();
  }

  async ensureAllMemberUtteranceFilesReady() {
    await this.startAllMemberUtteranceFileBuilds();

    if (this.memberUtteranceBulkPromise) {
      await this.memberUtteranceBulkPromise;
    }

    return this.getMemberUtteranceFilesBulkStatus();
  }

  async runMemberUtteranceFileBuild(member) {
    const slug = member.slug;
    const runtimeStatus =
      this.memberUtteranceStatuses.get(slug) || this.createIdleUtteranceFileStatus(member);

    if (this.indexingPromise) {
      runtimeStatus.status = "waiting_for_index";
      this.memberUtteranceStatuses.set(slug, runtimeStatus);
      await this.indexingPromise;
    }

    const indexStatus = this.getStatus();
    const protocolReferences = this.getSortedProtocolsForMember(slug);
    runtimeStatus.status = "running";
    runtimeStatus.totalProtocols = protocolReferences.length;
    runtimeStatus.processedProtocols = 0;
    runtimeStatus.sectionCount = 0;
    runtimeStatus.utteranceCount = 0;
    runtimeStatus.current = null;
    runtimeStatus.error = null;
    this.memberUtteranceStatuses.set(slug, runtimeStatus);

    const sections = (
      await mapWithConcurrency(protocolReferences, UTTERANCE_BUILD_CONCURRENCY, async (protocolReference) => {
        const liveStatus = this.memberUtteranceStatuses.get(slug);

        if (liveStatus) {
          liveStatus.current = {
            documentId: protocolReference.documentId,
            title: protocolReference.title,
            shortDateLabel: protocolReference.shortDateLabel,
          };
        }

        const section = await this.buildMemberUtteranceSection(member, protocolReference);

        if (liveStatus) {
          liveStatus.processedProtocols += 1;

          if (section) {
            liveStatus.sectionCount += 1;
            liveStatus.utteranceCount += section.utterances.length;
          }
        }

        return section;
      })
    ).filter(Boolean);

    const generatedAt = new Date().toISOString();
    const manifest = {
      version: UTTERANCE_FILE_VERSION,
      memberSlug: member.slug,
      memberName: member.name,
      partyName: member.partyName,
      memberRegistrySignature: this.memberRegistrySignature,
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
      startedAt: runtimeStatus.startedAt,
      generatedAt,
      protocolCount: sections.length,
      utteranceCount: sections.reduce((sum, section) => sum + section.utterances.length, 0),
      sectionCount: sections.length,
      sourceIndexUpdatedAt: this.cache.updatedAt,
      sourceIndexStatus: indexStatus.status,
      isPartial: indexStatus.status !== "completed",
      downloadName: this.buildMemberUtteranceDownloadName(member),
      filePath: this.getMemberUtteranceTextPath(member),
      sections: sections.map((section) => ({
        documentId: section.reference.documentId,
        source: section.reference.source,
        heading: section.heading,
        summary: section.summary,
        utteranceCount: section.utterances.length,
      })),
    };
    const fileText = this.buildUtteranceFileText(member, manifest, sections);

    await writeTextFile(manifest.filePath, fileText);
    await writeJson(this.getMemberUtteranceManifestPath(member), manifest);
    this.promotionService?.requestPromotion("memberUtterances");

    this.memberUtteranceStatuses.set(slug, {
      status: "completed",
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
      minWords: MIN_MEMBER_UTTERANCE_WORDS,
      startedAt: runtimeStatus.startedAt,
      finishedAt: generatedAt,
      generatedAt,
      totalProtocols: manifest.protocolCount,
      processedProtocols: manifest.protocolCount,
      sectionCount: manifest.sectionCount,
      utteranceCount: manifest.utteranceCount,
      current: null,
      error: null,
      downloadName: manifest.downloadName,
      downloadUrl: `/api/members/${encodeURIComponent(member.id || slug)}/utterance-file/download`,
      isPartial: manifest.isPartial,
      isStale: false,
    });
  }

  async runAllMemberUtteranceFileBuilds() {
    const bulkStatus = this.memberUtteranceBulkStatus;

    if (this.indexingPromise) {
      bulkStatus.status = "waiting_for_index";
      await this.indexingPromise;
    }

    bulkStatus.status = "running";

    await mapWithConcurrency(this.members, 2, async (member) => {
      bulkStatus.current = {
        slug: member.slug,
        name: member.name,
        partyName: member.partyName,
      };

      try {
        const existingManifest = await this.readMemberUtteranceManifest(member);

        if (existingManifest && !this.isMemberUtteranceManifestStale(existingManifest)) {
          bulkStatus.skippedMembers += 1;
          return;
        }

        if (this.memberUtterancePromises.has(member.slug)) {
          await this.memberUtterancePromises.get(member.slug);
        } else {
          await this.runMemberUtteranceFileBuild(member);
        }

        bulkStatus.generatedMembers += 1;
      } catch (error) {
        bulkStatus.failedMembers += 1;
        bulkStatus.recentErrors = [
          `${member.name}: ${toErrorMessage(error)}`,
          ...bulkStatus.recentErrors,
        ].slice(0, 10);
        this.memberUtteranceStatuses.set(member.slug, {
          ...this.createIdleUtteranceFileStatus(member),
          status: "failed",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          error: toErrorMessage(error),
        });
      } finally {
        bulkStatus.processedMembers += 1;
      }
    });

    bulkStatus.status = bulkStatus.failedMembers > 0 ? "completed_with_errors" : "completed";
    bulkStatus.finishedAt = new Date().toISOString();
    bulkStatus.lastCompletedAt = bulkStatus.finishedAt;
    bulkStatus.current = null;
  }

  async getMemberUtteranceFileDownload(slug) {
    await this.initialize();
    const member = this.resolveMember(slug);

    if (!member) {
      return null;
    }

    return this.readMemberUtteranceManifest(member);
  }

  getMemberMatchCount(slug) {
    return (this.memberProtocols.get(slug) || []).length;
  }

  getSortedProtocolsForMember(slug) {
    return [...(this.memberProtocols.get(slug) || [])].sort(sortProtocolReferences);
  }

  async getRecentQuotesFeed(limit = 12) {
    await this.initialize();
    await this.startIndexing();

    const [plenumProtocols, committeeProtocols] = await Promise.all([
      this.protocolStore.getProtocols(),
      this.committeeProtocolStore.getProtocols(),
    ]);
    const protocolReferences = [
      ...plenumProtocols.map((protocol) => createProtocolReference("plenum", protocol)),
      ...committeeProtocols.map((protocol) => createProtocolReference("committee", protocol)),
    ]
      .sort(sortProtocolReferences)
      .slice(0, LANDING_RECENT_PROTOCOL_SCAN_LIMIT);

    const candidatePool = [];
    const seen = new Set();

    for (const protocolReference of protocolReferences) {
      const protocolKey = buildProtocolKey(protocolReference.source, protocolReference.documentId);
      const record = this.cache.protocols[protocolKey];
      const memberSlugs = [...new Set((record?.matches || []).map((match) => match.memberSlug))];

      if (!memberSlugs.length) {
        continue;
      }

      const store =
        protocolReference.source === "committee" ? this.committeeProtocolStore : this.protocolStore;
      let content;

      try {
        content = await store.getProtocolContent(protocolReference.documentId);
      } catch (error) {
        console.warn(
          `Skipping landing quote source ${protocolReference.source}:${protocolReference.documentId}: ${toErrorMessage(error)}`,
        );
        continue;
      }

      const paragraphs = Array.isArray(content?.paragraphs) ? content.paragraphs : [];

      if (!paragraphs.length) {
        continue;
      }

      const candidates = [];

      for (const memberSlug of memberSlugs) {
        const member = this.memberBySlug.get(memberSlug);

        if (!member) {
          continue;
        }

        const utterances = this.extractMemberUtterancesWithMinWords(
          paragraphs,
          member,
          LANDING_RECENT_QUOTE_MIN_WORDS,
        );

        if (!utterances.length) {
          continue;
        }

        const scoredUtterances = utterances
          .map((utterance) => ({
            utterance,
            analysis: pickLandingQuoteExcerpt(utterance.text, protocolReference),
          }))
          .sort((left, right) => {
            if (right.analysis.score !== left.analysis.score) {
              return right.analysis.score - left.analysis.score;
            }

            return right.analysis.wordCount - left.analysis.wordCount;
          });

        const preferredUtterance =
          scoredUtterances.find((entry) => entry.analysis.score >= LANDING_RECENT_QUOTE_MIN_SCORE) ||
          scoredUtterances[0];

        if (!preferredUtterance) {
          continue;
        }

        const chosen = preferredUtterance.utterance;
        const analysis = preferredUtterance.analysis;
        const quoteKey = `${protocolReference.source}:${protocolReference.documentId}:${member.slug}:${chosen.text}`;

        if (seen.has(quoteKey)) {
          continue;
        }

        seen.add(quoteKey);
        candidates.push({
          memberSlug: member.slug,
          memberName: member.name,
          partyName: member.partyName,
          routeSlug: member.id || member.slug,
          protocolHeading: buildProtocolHeading(protocolReference),
          protocolUrl: protocolReference.readerUrl,
          shortDateLabel: protocolReference.shortDateLabel,
          dateSortValue: protocolReference.dateSortValue,
          quote: analysis.quote,
          quoteSearchText: analysis.quoteSearchText || analysis.quote,
          wordCount: analysis.wordCount,
          interestingScore: Number(analysis.score.toFixed(2)),
          signals: analysis.signals.map((signal) => signal.type),
          source: protocolReference.source,
        });
      }

      candidates
        .sort((left, right) => {
          if (right.interestingScore !== left.interestingScore) {
            return right.interestingScore - left.interestingScore;
          }

          if (right.wordCount !== left.wordCount) {
            return right.wordCount - left.wordCount;
          }

          return right.dateSortValue - left.dateSortValue;
        })
        .slice(0, LANDING_RECENT_QUOTES_PER_PROTOCOL)
        .forEach((item) => {
          candidatePool.push(item);
        });
    }

    const sortedCandidates = candidatePool.sort((left, right) => {
      if (right.interestingScore !== left.interestingScore) {
        return right.interestingScore - left.interestingScore;
      }

      if (right.dateSortValue !== left.dateSortValue) {
        return right.dateSortValue - left.dateSortValue;
      }

      return right.wordCount - left.wordCount;
    });
    const memberCounts = new Map();
    const protocolCounts = new Map();
    const selected = [];
    const fallback = [];

    for (const candidate of sortedCandidates) {
      const memberCount = memberCounts.get(candidate.memberSlug) || 0;
      const protocolKey = `${candidate.source}:${candidate.protocolUrl}`;
      const protocolCount = protocolCounts.get(protocolKey) || 0;

      if (memberCount >= LANDING_RECENT_QUOTE_MAX_PER_MEMBER) {
        continue;
      }

      if (protocolCount >= LANDING_RECENT_QUOTE_MAX_PER_PROTOCOL) {
        continue;
      }

      if (candidate.interestingScore >= LANDING_RECENT_QUOTE_MIN_SCORE) {
        selected.push(candidate);
        memberCounts.set(candidate.memberSlug, memberCount + 1);
        protocolCounts.set(protocolKey, protocolCount + 1);
      } else {
        fallback.push(candidate);
      }

      if (selected.length >= limit) {
        return selected.slice(0, limit);
      }
    }

    for (const candidate of fallback) {
      if (selected.length >= limit) {
        break;
      }

      const memberCount = memberCounts.get(candidate.memberSlug) || 0;
      const protocolKey = `${candidate.source}:${candidate.protocolUrl}`;
      const protocolCount = protocolCounts.get(protocolKey) || 0;

      if (memberCount >= LANDING_RECENT_QUOTE_MAX_PER_MEMBER) {
        continue;
      }

      if (protocolCount >= LANDING_RECENT_QUOTE_MAX_PER_PROTOCOL) {
        continue;
      }

      selected.push(candidate);
      memberCounts.set(candidate.memberSlug, memberCount + 1);
      protocolCounts.set(protocolKey, protocolCount + 1);
    }

    return selected.slice(0, limit);
  }

  async getMembersOverview() {
    const status = await this.startIndexing();

    return {
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
      memberCount: this.members.length,
      status,
      utteranceFilesBulkStatus: this.getMemberUtteranceFilesBulkStatus(),
      parties: this.parties.map((party) => ({
        name: party.name,
        slug: party.slug,
        memberCount: party.members.length,
        members: party.members.map((member) => ({
          slug: member.slug,
          routeSlug: member.id || member.slug,
          name: member.name,
          partyName: member.partyName,
          protocolCount: this.getMemberMatchCount(member.slug),
        })),
      })),
    };
  }

  async getMemberDetails(slug) {
    const member = this.resolveMember(slug);

    if (!member) {
      return null;
    }

    const canonicalSlug = member.slug;
    const status = await this.startIndexing();
    const protocols = this.getSortedProtocolsForMember(canonicalSlug);
    const utteranceFile = await this.getMemberUtteranceFileStatus(canonicalSlug);

    return {
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
      status,
      member: {
        slug: member.slug,
        routeSlug: member.id || member.slug,
        name: member.name,
        partyName: member.partyName,
        aliases: [...member.aliases],
      },
      stats: {
        totalProtocols: protocols.length,
        plenumProtocols: protocols.filter((protocol) => protocol.source === "plenum").length,
        committeeProtocols: protocols.filter((protocol) => protocol.source === "committee").length,
      },
      protocols,
      utteranceFile,
      isPartial: status.status !== "completed" && status.status !== "completed_with_errors",
    };
  }

  buildMemberUtteranceBaseName(member, sourceType = "full") {
    const variant = getUtteranceFileVariantMeta(sourceType);
    return sanitizeFilename(
      `${member.name}__${member.partyName}__${variant.fileLabel}__מ-${MEMBER_PROTOCOL_SINCE_DATE}`,
    );
  }

  buildMemberUtteranceDownloadName(member, sourceType = "full") {
    return `${this.buildMemberUtteranceBaseName(member, sourceType)}.txt`;
  }

  getMemberUtteranceManifestPath(member, sourceType = "full") {
    return path.join(
      this.memberUtterancesDir,
      `${this.buildMemberUtteranceBaseName(member, sourceType)}.json`,
    );
  }

  getMemberUtteranceTextPath(member, sourceType = "full") {
    return path.join(
      this.memberUtterancesDir,
      this.buildMemberUtteranceDownloadName(member, sourceType),
    );
  }

  async readMemberUtteranceManifest(member, sourceType = "full") {
    const variant = getUtteranceFileVariantMeta(sourceType);
    const manifestPath = this.getMemberUtteranceManifestPath(member, variant.key);

    if (!(await fileExists(manifestPath))) {
      return null;
    }

    try {
      const manifest = await readJson(manifestPath);
      const resolvedFilePath = await resolveStoredDataPath(this.dataDir, manifest?.filePath);

      if (
        manifest?.version !== UTTERANCE_FILE_VERSION ||
        manifest?.sinceDate !== MEMBER_PROTOCOL_SINCE_DATE ||
        manifest?.memberSlug !== member.slug ||
        manifest?.sourceType !== variant.key ||
        manifest?.memberRegistrySignature !== this.memberRegistrySignature ||
        !resolvedFilePath
      ) {
        return null;
      }

      return {
        ...manifest,
        filePath: resolvedFilePath,
      };
    } catch {
      return null;
    }
  }

  buildUtteranceFileText(member, manifest, sections) {
    const variant = getUtteranceFileVariantMeta(manifest.sourceType);
    const headerLines = [
      `חבר הכנסת: ${member.name}`,
      `סיעה: ${member.partyName}`,
      `סוג קובץ: ${variant.label}`,
      `טווח הסריקה: החל מ-${MEMBER_PROTOCOL_SINCE_DATE}`,
      `מספר פרוטוקולים שנכללו: ${manifest.protocolCount}`,
      `מספר קטעי הדיבור באורך של לפחות ${MIN_MEMBER_UTTERANCE_WORDS} מילים: ${manifest.utteranceCount}`,
      `הקובץ נוצר: ${memberFileDateFormatter.format(new Date(manifest.generatedAt))}`,
    ];

    if (variant.protocolLimit) {
      headerLines.push(
        `הקובץ כולל רק את ${variant.protocolLimit} הפרוטוקולים האחרונים, לפי תאריך, שבהם נשמר לפחות ציטוט אחד של ${MIN_MEMBER_UTTERANCE_WORDS} מילים ומעלה.`,
      );
    }

    if (manifest.isPartial) {
      headerLines.push("הערה: הקובץ נבנה כאשר אינדקס החברים לא הושלם לחלוטין או הסתיים עם שגיאות.");
    }

    if (!sections.length) {
      return [
        ...headerLines,
        "",
        variant.protocolLimit
          ? `לא נמצאו עבור ${member.name} פרוטוקולים רלוונטיים עם ציטוטים של לפחות ${MIN_MEMBER_UTTERANCE_WORDS} מילים במסגרת עשרת הפרוטוקולים האחרונים.`
          : `לא נמצאו קטעי דיבור באורך של לפחות ${MIN_MEMBER_UTTERANCE_WORDS} מילים עבור ${member.name} בטווח הסריקה.`,
      ].join("\n");
    }

    const sectionTexts = sections.map((section) =>
      [
        section.heading,
        `תקציר: ${section.summary}`,
        "",
        ...section.utterances.map((utterance) => utterance.text),
      ].join("\n\n"),
    );

    return `${headerLines.join("\n")}\n\n${sectionTexts.join(
      "\n\n----------------------------------------\n\n",
    )}`;
  }

  async collectMemberUtteranceSections(member, protocolReferences, runtimeStatus, sourceType = "full") {
    const variant = getUtteranceFileVariantMeta(sourceType);

    if (variant.protocolLimit) {
      const sections = [];

      for (const protocolReference of protocolReferences) {
        runtimeStatus.current = {
          documentId: protocolReference.documentId,
          title: protocolReference.title,
          shortDateLabel: protocolReference.shortDateLabel,
        };

        const section = await this.buildMemberUtteranceSection(member, protocolReference);
        runtimeStatus.processedProtocols += 1;

        if (section) {
          runtimeStatus.sectionCount += 1;
          runtimeStatus.utteranceCount += section.utterances.length;
          sections.push(section);
        }

        if (sections.length >= variant.protocolLimit) {
          break;
        }
      }

      return sections;
    }

    return (
      await mapWithConcurrency(protocolReferences, UTTERANCE_BUILD_CONCURRENCY, async (protocolReference) => {
        const liveStatus =
          this.memberUtteranceStatuses.get(
            buildMemberUtteranceRuntimeKey(member.slug, variant.key),
          ) || runtimeStatus;

        liveStatus.current = {
          documentId: protocolReference.documentId,
          title: protocolReference.title,
          shortDateLabel: protocolReference.shortDateLabel,
        };

        const section = await this.buildMemberUtteranceSection(member, protocolReference);
        liveStatus.processedProtocols += 1;

        if (section) {
          liveStatus.sectionCount += 1;
          liveStatus.utteranceCount += section.utterances.length;
        }

        return section;
      })
    ).filter(Boolean);
  }

  async getMemberUtteranceFileStatus(slug, sourceType = "full") {
    await this.initialize();
    const member = this.resolveMember(slug);

    if (!member) {
      return null;
    }

    const variant = getUtteranceFileVariantMeta(sourceType);
    const canonicalSlug = member.slug;
    const runtimeStatus = this.memberUtteranceStatuses.get(
      buildMemberUtteranceRuntimeKey(canonicalSlug, variant.key),
    );

    if (runtimeStatus) {
      return {
        ...runtimeStatus,
        current: runtimeStatus.current ? { ...runtimeStatus.current } : null,
      };
    }

    const manifest = await this.readMemberUtteranceManifest(member, variant.key);

    if (!manifest) {
      return this.createIdleUtteranceFileStatus(member, variant.key);
    }

    const isStale = this.isMemberUtteranceManifestStale(manifest);

    return {
      status: "completed",
      sourceType: variant.key,
      sourceLabel: variant.label,
      protocolLimit: variant.protocolLimit,
      sinceDate: manifest.sinceDate,
      minWords: MIN_MEMBER_UTTERANCE_WORDS,
      startedAt: manifest.startedAt || null,
      finishedAt: manifest.generatedAt,
      generatedAt: manifest.generatedAt,
      totalProtocols: manifest.scannedProtocolCount ?? manifest.protocolCount,
      processedProtocols: manifest.scannedProtocolCount ?? manifest.protocolCount,
      sectionCount: manifest.sectionCount,
      utteranceCount: manifest.utteranceCount,
      current: null,
      error: null,
      downloadName: manifest.downloadName,
      downloadUrl: this.buildMemberUtteranceDownloadUrl(member, variant.key),
      isPartial: Boolean(manifest.isPartial),
      isStale,
    };
  }

  async startMemberUtteranceFileBuild(slug, sourceType = "full") {
    await this.initialize();
    const member = this.resolveMember(slug);

    if (!member) {
      return null;
    }

    const variant = getUtteranceFileVariantMeta(sourceType);
    const canonicalSlug = member.slug;
    const runtimeKey = buildMemberUtteranceRuntimeKey(canonicalSlug, variant.key);

    if (this.memberUtterancePromises.has(runtimeKey)) {
      return this.getMemberUtteranceFileStatus(canonicalSlug, variant.key);
    }

    await this.startIndexing();
    const runtimeStatus = this.createIdleUtteranceFileStatus(member, variant.key);
    runtimeStatus.status = this.indexingPromise ? "waiting_for_index" : "running";
    runtimeStatus.startedAt = new Date().toISOString();
    this.memberUtteranceStatuses.set(runtimeKey, runtimeStatus);

    const buildPromise = this.runMemberUtteranceFileBuild(member, variant.key)
      .catch((error) => {
        const failedStatus = this.createIdleUtteranceFileStatus(member, variant.key);
        failedStatus.status = "failed";
        failedStatus.startedAt = runtimeStatus.startedAt;
        failedStatus.finishedAt = new Date().toISOString();
        failedStatus.error = toErrorMessage(error);
        this.memberUtteranceStatuses.set(runtimeKey, failedStatus);
      })
      .finally(() => {
        this.memberUtterancePromises.delete(runtimeKey);
      });

    this.memberUtterancePromises.set(runtimeKey, buildPromise);
    return this.getMemberUtteranceFileStatus(canonicalSlug, variant.key);
  }

  async ensureMemberUtteranceFileReady(slug, sourceType = "full") {
    const variant = getUtteranceFileVariantMeta(sourceType);
    let utteranceStatus = await this.getMemberUtteranceFileStatus(slug, variant.key);
    const needsBuild =
      !utteranceStatus ||
      utteranceStatus.status === "idle" ||
      utteranceStatus.status === "failed" ||
      utteranceStatus.isStale;

    if (needsBuild) {
      const started = await this.startMemberUtteranceFileBuild(slug, variant.key);

      if (!started) {
        throw new Error("Member utterance file is missing");
      }
    }

    while (true) {
      utteranceStatus = await this.getMemberUtteranceFileStatus(slug, variant.key);

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

    const manifest = await this.getMemberUtteranceFileDownload(slug, variant.key);

    if (!manifest) {
      throw new Error("Member utterance file is missing");
    }

    return manifest;
  }

  async ensureAllMemberUtteranceFilesReady(sourceType = "full") {
    const variant = getUtteranceFileVariantMeta(sourceType);

    await mapWithConcurrency(this.members, 2, async (member) => {
      await this.ensureMemberUtteranceFileReady(member.slug, variant.key);
    });

    return this.getMemberUtteranceFilesBulkStatus();
  }

  async runMemberUtteranceFileBuild(member, sourceType = "full") {
    const variant = getUtteranceFileVariantMeta(sourceType);
    const runtimeKey = buildMemberUtteranceRuntimeKey(member.slug, variant.key);
    const runtimeStatus =
      this.memberUtteranceStatuses.get(runtimeKey) ||
      this.createIdleUtteranceFileStatus(member, variant.key);

    if (this.indexingPromise) {
      runtimeStatus.status = "waiting_for_index";
      this.memberUtteranceStatuses.set(runtimeKey, runtimeStatus);
      await this.indexingPromise;
    }

    const indexStatus = this.getStatus();
    const protocolReferences = this.getSortedProtocolsForMember(member.slug);
    runtimeStatus.status = "running";
    runtimeStatus.totalProtocols = protocolReferences.length;
    runtimeStatus.processedProtocols = 0;
    runtimeStatus.sectionCount = 0;
    runtimeStatus.utteranceCount = 0;
    runtimeStatus.current = null;
    runtimeStatus.error = null;
    this.memberUtteranceStatuses.set(runtimeKey, runtimeStatus);

    const sections = await this.collectMemberUtteranceSections(
      member,
      protocolReferences,
      runtimeStatus,
      variant.key,
    );

    const generatedAt = new Date().toISOString();
    const manifest = {
      version: UTTERANCE_FILE_VERSION,
      sourceType: variant.key,
      sourceLabel: variant.label,
      protocolLimit: variant.protocolLimit,
      memberSlug: member.slug,
      memberName: member.name,
      partyName: member.partyName,
      memberRegistrySignature: this.memberRegistrySignature,
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
      startedAt: runtimeStatus.startedAt,
      generatedAt,
      protocolCount: sections.length,
      scannedProtocolCount: runtimeStatus.processedProtocols,
      utteranceCount: sections.reduce((sum, section) => sum + section.utterances.length, 0),
      sectionCount: sections.length,
      sourceIndexUpdatedAt: this.cache.updatedAt,
      sourceIndexStatus: indexStatus.status,
      isPartial: indexStatus.status !== "completed",
      downloadName: this.buildMemberUtteranceDownloadName(member, variant.key),
      filePath: this.getMemberUtteranceTextPath(member, variant.key),
      sections: sections.map((section) => ({
        documentId: section.reference.documentId,
        source: section.reference.source,
        heading: section.heading,
        summary: section.summary,
        utteranceCount: section.utterances.length,
      })),
    };
    const fileText = this.buildUtteranceFileText(member, manifest, sections);

    await writeTextFile(manifest.filePath, fileText);
    await writeJson(this.getMemberUtteranceManifestPath(member, variant.key), manifest);
    this.promotionService?.requestPromotion("memberUtterances");

    this.memberUtteranceStatuses.set(runtimeKey, {
      status: "completed",
      sourceType: variant.key,
      sourceLabel: variant.label,
      protocolLimit: variant.protocolLimit,
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
      minWords: MIN_MEMBER_UTTERANCE_WORDS,
      startedAt: runtimeStatus.startedAt,
      finishedAt: generatedAt,
      generatedAt,
      totalProtocols: manifest.scannedProtocolCount,
      processedProtocols: manifest.scannedProtocolCount,
      sectionCount: manifest.sectionCount,
      utteranceCount: manifest.utteranceCount,
      current: null,
      error: null,
      downloadName: manifest.downloadName,
      downloadUrl: this.buildMemberUtteranceDownloadUrl(member, variant.key),
      isPartial: manifest.isPartial,
      isStale: false,
    });
  }

  async runAllMemberUtteranceFileBuilds() {
    const bulkStatus = this.memberUtteranceBulkStatus;
    const variants = Object.values(UTTERANCE_FILE_VARIANTS);

    if (this.indexingPromise) {
      bulkStatus.status = "waiting_for_index";
      await this.indexingPromise;
    }

    bulkStatus.status = "running";

    await mapWithConcurrency(this.members, 2, async (member) => {
      let rebuiltAnyVariant = false;

      try {
        for (const variant of variants) {
          bulkStatus.current = {
            slug: member.slug,
            name: member.name,
            partyName: member.partyName,
            sourceType: variant.key,
            sourceLabel: variant.label,
          };

          const existingManifest = await this.readMemberUtteranceManifest(member, variant.key);

          if (existingManifest && !this.isMemberUtteranceManifestStale(existingManifest)) {
            continue;
          }

          const runtimeKey = buildMemberUtteranceRuntimeKey(member.slug, variant.key);

          if (this.memberUtterancePromises.has(runtimeKey)) {
            await this.memberUtterancePromises.get(runtimeKey);
          } else {
            await this.runMemberUtteranceFileBuild(member, variant.key);
          }

          rebuiltAnyVariant = true;
        }

        if (rebuiltAnyVariant) {
          bulkStatus.generatedMembers += 1;
        } else {
          bulkStatus.skippedMembers += 1;
        }
      } catch (error) {
        bulkStatus.failedMembers += 1;
        bulkStatus.recentErrors = [
          `${member.name}: ${toErrorMessage(error)}`,
          ...bulkStatus.recentErrors,
        ].slice(0, 10);
        if (bulkStatus.current?.sourceType) {
          this.memberUtteranceStatuses.set(
            buildMemberUtteranceRuntimeKey(member.slug, bulkStatus.current.sourceType),
            {
              ...this.createIdleUtteranceFileStatus(member, bulkStatus.current.sourceType),
              status: "failed",
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
              error: toErrorMessage(error),
            },
          );
        }
      } finally {
        bulkStatus.processedMembers += 1;
      }
    });

    bulkStatus.status = bulkStatus.failedMembers > 0 ? "completed_with_errors" : "completed";
    bulkStatus.finishedAt = new Date().toISOString();
    bulkStatus.lastCompletedAt = bulkStatus.finishedAt;
    bulkStatus.current = null;
  }

  async getMemberUtteranceFileDownload(slug, sourceType = "full") {
    await this.initialize();
    const member = this.resolveMember(slug);

    if (!member) {
      return null;
    }

    return this.readMemberUtteranceManifest(member, sourceType);
  }

  async getMemberUtteranceFileText(slug, sourceType = "full") {
    await this.initialize();
    const member = this.resolveMember(slug);

    if (!member) {
      return null;
    }

    const variant = getUtteranceFileVariantMeta(sourceType);
    const manifest = await this.readMemberUtteranceManifest(member, variant.key);

    if (!manifest?.filePath) {
      return null;
    }

    const text = await fs.readFile(manifest.filePath, "utf8");

    return {
      member: {
        slug: member.slug,
        routeSlug: member.id || member.slug,
        name: member.name,
        partyName: member.partyName,
      },
      sourceType: variant.key,
      sourceLabel: variant.label,
      generatedAt: manifest.generatedAt || null,
      downloadName: manifest.downloadName || this.buildMemberUtteranceDownloadName(member, variant.key),
      downloadUrl: this.buildMemberUtteranceDownloadUrl(member, variant.key),
      text,
    };
  }

  async listMemberUtteranceFilesCatalog() {
    await this.initialize();

    const rows = await mapWithConcurrency(this.members, 6, async (member) => {
      const [small, full] = await Promise.all([
        this.getMemberUtteranceFileStatus(member.slug, "small"),
        this.getMemberUtteranceFileStatus(member.slug, "full"),
      ]);

      return {
        member: {
          slug: member.slug,
          routeSlug: member.id || member.slug,
          name: member.name,
          partyName: member.partyName,
        },
        files: {
          small,
          full,
        },
      };
    });

    return rows.sort((left, right) =>
      String(left?.member?.name || "").localeCompare(String(right?.member?.name || ""), "he"),
    );
  }

  async getMemberDetails(slug) {
    const member = this.resolveMember(slug);

    if (!member) {
      return null;
    }

    const canonicalSlug = member.slug;
    const status = await this.startIndexing();
    const protocols = this.getSortedProtocolsForMember(canonicalSlug);
    const utteranceFiles = {
      full: await this.getMemberUtteranceFileStatus(canonicalSlug, "full"),
      small: await this.getMemberUtteranceFileStatus(canonicalSlug, "small"),
    };

    return {
      sinceDate: MEMBER_PROTOCOL_SINCE_DATE,
      status,
      member: {
        slug: member.slug,
        routeSlug: member.id || member.slug,
        name: member.name,
        partyName: member.partyName,
        aliases: [...member.aliases],
      },
      stats: {
        totalProtocols: protocols.length,
        plenumProtocols: protocols.filter((protocol) => protocol.source === "plenum").length,
        committeeProtocols: protocols.filter((protocol) => protocol.source === "committee").length,
      },
      protocols,
      utteranceFile: utteranceFiles.full,
      utteranceFiles,
      isPartial: status.status !== "completed" && status.status !== "completed_with_errors",
    };
  }
}

module.exports = {
  MIN_MEMBER_UTTERANCE_WORDS,
  MemberProtocolService,
  SMALL_UTTERANCE_PROTOCOL_LIMIT,
};
