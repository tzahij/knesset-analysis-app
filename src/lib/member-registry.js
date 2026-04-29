const MEMBER_PROTOCOL_SINCE_YEAR = 2022;
const MEMBER_PROTOCOL_SINCE_DATE = `${MEMBER_PROTOCOL_SINCE_YEAR}-01-01`;

const PARTY_NAMES = new Set([
  "הליכוד",
  "יש עתיד",
  "הציונות הדתית",
  "כחול לבן המחנה הממלכתי",
  "הימין הממלכתי",
  'ש"ס',
  "יהדות התורה",
  "ישראל ביתנו",
  'חד"ש - תע"ל',
  'רע"מ',
  "העבודה",
  "עוצמה יהודית",
  "נעם",
]);

const RAW_MEMBER_LIST = `
הליכוד
בנימין נתניהו
יריב לוין
אלי אליהו כהן
דוד אמסלם
אמיר אוחנה
יואב קיש
ניר ברקת
מירי מרים רגב
מכלוף מיקי זוהר
אבי דיכטר
ישראל כ"ץ
שלמה קרעי
עמיחי שיקלי
עידית סילמן
דוד ביטן
יולי (יואל) אדלשטיין
אליהו רביבו
גלית דיסטל אטבריאן
ניסים ואטורי
שלום דנינו
חיים כץ
טלי גוטליב
חנוך דב מלביצקי
בועז ביסמוט
משה סעדה
אלי דלל
גילה גמליאל
אופיר כץ
מאי גולן
חוה אתי עטיה
דן אליהו יעקב אילוז
עמית הלוי
אריאל קלנר
אושר שקלים
צגה צגנש מלקו
ששון ששי גואטה
קטי קטרין שטרית
משה פסל
אביחי אברהם בוארון
עפיף עבד

יש עתיד
יאיר לפיד
מאיר כהן
קארין אלהרר
מירב כהן
אלעזר שטרן
מיקי לוי
מירב בן-ארי
רם בן ברק
יואב סגלוביץ'
בועז טופורובסקי
שיר מיכל סגמן
יוראי להב הרצנו
ולדימיר בליאק
רון כץ
מטי צרפתי הרכבי
טטיאנה מזרסקי
יסמין סאקס פרידמן
דבורה דבי ביטון
משה טור פז
סימון דוידסון
נאור שירי
שלי טל מירון
ירון לוי
עדי עזוז

הציונות הדתית
בצלאל סמוטריץ'
אופיר סופר
אורית סטרוק
שמחה רוטמן
מיכל מרים וולדיגר
אוהד טל
משה סולומון

כחול לבן המחנה הממלכתי
בני גנץ
פנינה תמנו
חילי טרופר
מיכאל מרדכי ביטון
אורית פרקש הכהן
אלון שוסטר
איתן גינזבורג
יעל רון בן משה

הימין הממלכתי
גדעון סער
זאב אלקין
שרן השכל
מישל בוסקילה

ש"ס
אריה מכלוף דרעי
יעקב מרגי
יואב בן צור
מיכאל מלכיאלי
חיים ביטון
משה ארבל
ינון אזולאי
משה אבוטבול
אוריאל בוסו
יוסף טייב
יונתן מישריקי

יהדות התורה
יצחק גולדקנופף
משה גפני
מאיר פרוש
אורי מקלב
יעקב טסלר
יעקב אשר
ישראל אייכלר

ישראל ביתנו
אביגדור ליברמן
עודד פורר
יבגני סובה
שרון ניר
יוליה מלינובסקי
חמד עמאר

חד"ש - תע"ל
איימן עודה
אחמד טיבי
עאידה תומא סלימאן
עופר כסיף
יוסף עטאונה
סמיר בן סעיד

רע"מ
מנסור עבאס
ווליד טאהא
ואליד אלהואשלה
אימאן ח'טיב יאסין
יאסר חג'יראת

העבודה
מרב מיכאלי
נעמה לזימי
גלעד קריב
אפרת רייטן מרום

עוצמה יהודית
איתמר בן גביר
יצחק שמעון וסרלאוף
אלמוג כהן
עמיחי אליהו
צביקה פוגל
לימור סון הר מלך
יצחק קרויזר

נעם
אבי מעוז
`;

const EXTRA_ALIASES = {
  "אלי אליהו כהן": ["אלי כהן"],
  "מירי מרים רגב": ["מירי רגב"],
  "מכלוף מיקי זוהר": ["מיקי זוהר"],
  'ישראל כ"ץ': ["ישראל כץ"],
  "יולי (יואל) אדלשטיין": ["יולי אדלשטיין", "יואל אדלשטיין", "יולי יואל אדלשטיין"],
  "חוה אתי עטיה": ["חוה עטייה", "אתי עטיה", "אתי עטייה", "חוה אתי עטייה", "עטייה חוה אתי", "עטיה חוה אתי"],
  "דן אליהו יעקב אילוז": ["דן אילוז"],
  "קטי קטרין שטרית": ["קטי שטרית", "קתי שטרית", "קטי קתרין שטרית"],
  "שיר מיכל סגמן": ["מיכל שיר", "מיכל שיר סגמן"],
  "יוראי להב הרצנו": ["יוראי להב-הרצנו", "יוראי הרצנו"],
  "יסמין סאקס פרידמן": ["יסמין פרידמן", "יסמין סאקס-פרידמן"],
  "דבורה דבי ביטון": ["דבי ביטון"],
  "משה טור פז": ["משה טור-פז", "משה קינלי טור פז", "משה קינלי טור-פז", "קינלי טור פז", "טור פז משה"],
  "שלי טל מירון": ["שלי מירון", "שלי טל-מירון", "שלי ט ל מירון"],
  "אורית סטרוק": ["אורית מלכה סטרוק"],
  "גלית דיסטל אטבריאן": ["דיסטל אטבריאן גלית"],
  "פנינה תמנו": ["פנינה תמנו שטה", "פנינה תמנו-שטה"],
  "אורית פרקש הכהן": ["אורית פרקש-הכהן", "אורית פרקשה הכהן", "אורית פרקייש הכהן"],
  "שרן השכל": ["השכל שרן מרים", "שרן מרים השכל"],
  "יעל רון בן משה": ["יעל בן משה", "יעל רון-בן משה", "רון בן משה יעל"],
  "אריה מכלוף דרעי": ["אריה דרעי"],
  "יונתן מישריקי": ["יונתן מישרקי", "מישרקי יונתן"],
  "עאידה תומא סלימאן": ["עאידה תומא-סלימאן"],
  "אימאן ח'טיב יאסין": ["אימאן חטיב יאסין", "אימאן ח'טיב-יאסין", "ח'טיב יאסין אימאן"],
  "יאסר חג'יראת": ["יאסר חוג'יראת"],
  "יצחק שמעון וסרלאוף": ["יצחק וסרלאוף"],
  "לימור סון הר מלך": ["סון הר מלך לימור"],
  "אפרת רייטן מרום": ["אפרת רייטן", "אפרת רייטן-מרום"],
  "ירון לוי": ["ירון עמוס לוי"],
  "שרון ניר": ["שרון ביתנו ניר"],
  "סמיר בן סעיד": ["סמיר אל סעיד"],
  "אלעזר שטרן": ["אלעזר שטרן-יועמ\"ש"],
};

const EXTRA_MEMBERS = [
  {
    id: "member-131",
    name: "צבי ידידיה סוכות",
    partyName: "הציונות הדתית",
    aliases: ["סוכות צבי ידידיה", "צבי סוכות", "ידידיה סוכות"],
  },
  {
    id: "member-132",
    name: "אכרם חסון",
    partyName: "הימין הממלכתי",
    aliases: ["חסון אכרם"],
  },
  {
    id: "member-133",
    name: "יצחק זאב פינדרוס",
    partyName: "יהדות התורה",
    aliases: ["פינדרוס יצחק זאב", "יצחק פינדרוס"],
  },
];

function slugifyText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function normalizeNameSpacing(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeName(value) {
  return normalizeNameSpacing(
    String(value || "")
      .normalize("NFKC")
      .replace(/['"״׳`]/g, "")
      .replace(/[()]/g, " ")
      .replace(/[-‐‑‒–—―־/]+/g, " ")
      .replace(/[^\p{L}\p{N}\s]+/gu, " "),
  )
    .split(" ")
    .filter(Boolean);
}

function normalizeLooseHebrewToken(token) {
  return String(token || "")
    .toLowerCase()
    .replace(/יי+/g, "י")
    .replace(/וו+/g, "ו")
    .replace(/[יו](?=ה$)/g, "");
}

function tokenizeLooseMemberName(value) {
  return tokenizeName(value).map(normalizeLooseHebrewToken).filter(Boolean);
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
  const compoundSurnamePrefixes = new Set(["בן", "בר", "אל", "אבו", "אבן"]);

  if (tokens.length >= 2 && compoundSurnamePrefixes.has(tokens[tokens.length - 2])) {
    return tokens.slice(-2);
  }

  return tokens.length ? [tokens[tokens.length - 1]] : [];
}

function buildDerivedAliases(baseName) {
  const aliases = new Set();
  const tokens = tokenizeName(baseName);

  if (tokens.length >= 2) {
    aliases.add(tokens.join(" "));
  }

  if (tokens.length >= 3) {
    const surnameTokens = guessSurnameTokens(tokens);
    const surname = surnameTokens.join(" ");
    const givenTokens = tokens.slice(0, tokens.length - surnameTokens.length);

    for (const givenName of givenTokens) {
      if (givenName && surname) {
        aliases.add(`${givenName} ${surname}`);
      }
    }

    if (givenTokens.length >= 2 && surname) {
      aliases.add(`${givenTokens.slice(0, 2).join(" ")} ${surname}`);
    }
  }

  return aliases;
}

function buildSurnameFirstAliases(baseName) {
  const aliases = new Set();
  const tokens = tokenizeName(baseName);

  if (tokens.length < 2) {
    return aliases;
  }

  for (let splitIndex = 1; splitIndex < tokens.length; splitIndex += 1) {
    const givenTokens = tokens.slice(0, splitIndex);
    const surnameTokens = tokens.slice(splitIndex);
    const surname = surnameTokens.join(" ");

    if (!surname || !givenTokens.length) {
      continue;
    }

    aliases.add(`${surname} ${givenTokens.join(" ")}`);
    aliases.add(`${surname} ${givenTokens[0]}`);

    if (givenTokens.length > 1) {
      aliases.add(`${surname} ${givenTokens[givenTokens.length - 1]}`);
    }
  }

  return aliases;
}

function buildAliases(displayName) {
  const aliases = new Set([normalizeNameSpacing(displayName)]);
  const parentheticalMatch = displayName.match(/^(.*)\(([^)]+)\)(.*)$/);

  if (parentheticalMatch) {
    const before = normalizeNameSpacing(parentheticalMatch[1]);
    const inside = normalizeNameSpacing(parentheticalMatch[2]);
    const after = normalizeNameSpacing(parentheticalMatch[3]);
    const withoutParentheses = normalizeNameSpacing(`${before} ${after}`);
    const insideVariant = normalizeNameSpacing(`${inside} ${after}`);
    const combinedVariant = normalizeNameSpacing(`${before} ${inside} ${after}`);

    if (withoutParentheses) {
      aliases.add(withoutParentheses);
    }

    if (insideVariant) {
      aliases.add(insideVariant);
    }

    if (combinedVariant) {
      aliases.add(combinedVariant);
    }
  }

  for (const alias of Array.from(aliases)) {
    for (const derivedAlias of buildDerivedAliases(alias)) {
      aliases.add(derivedAlias);
    }

    for (const surnameFirstAlias of buildSurnameFirstAliases(alias)) {
      aliases.add(surnameFirstAlias);
    }
  }

  for (const extraAlias of EXTRA_ALIASES[displayName] || []) {
    aliases.add(normalizeNameSpacing(extraAlias));
  }

  return Array.from(aliases)
    .map(normalizeNameSpacing)
    .filter((value, index, array) => value.split(" ").length >= 2 && array.indexOf(value) === index);
}

function parseMemberRegistry() {
  const parties = [];
  let currentParty = null;
  let memberIndex = 0;

  for (const line of RAW_MEMBER_LIST.split(/\r?\n/)) {
    const value = line.trim();

    if (!value) {
      continue;
    }

    if (PARTY_NAMES.has(value)) {
      currentParty = {
        name: value,
        slug: slugifyText(value),
        members: [],
      };
      parties.push(currentParty);
      continue;
    }

    if (!currentParty) {
      throw new Error(`Member "${value}" appeared before a party heading`);
    }

    memberIndex += 1;
    currentParty.members.push({
      id: `member-${String(memberIndex).padStart(3, "0")}`,
      slug: `${currentParty.slug}--${slugifyText(value)}`,
      name: value,
      partyName: currentParty.name,
      partySlug: currentParty.slug,
      aliases: buildAliases(value),
    });
  }

  return parties;
}

function appendExtraMembers(parties) {
  const partiesWithExtras = parties.map((party) => ({
    ...party,
    members: party.members.map((member) => ({ ...member })),
  }));
  const partyMap = new Map(partiesWithExtras.map((party) => [party.name, party]));

  for (const extraMember of EXTRA_MEMBERS) {
    const party = partyMap.get(extraMember.partyName);

    if (!party) {
      throw new Error(`Extra member "${extraMember.name}" references unknown party "${extraMember.partyName}"`);
    }

    const aliases = Array.from(
      new Set([
        ...buildAliases(extraMember.name),
        ...(extraMember.aliases || []).map(normalizeNameSpacing),
      ]),
    );

    party.members.push({
      id: extraMember.id,
      slug: `${party.slug}--${slugifyText(extraMember.name)}`,
      name: extraMember.name,
      partyName: party.name,
      partySlug: party.slug,
      aliases,
    });
  }

  return partiesWithExtras;
}

const parties = appendExtraMembers(parseMemberRegistry());
const members = parties.flatMap((party) =>
  party.members.map((member) => ({
    ...member,
    routeSlug: member.id || member.slug,
  })),
);

for (const member of members) {
  if (member.id !== "member-072") {
    continue;
  }

  member.aliases = Array.from(
    new Set([
      ...(member.aliases || []),
      "\u05d1\u05e0\u05d9\u05de\u05d9\u05df \u05d2\u05e0\u05e5",
      "\u05d2\u05e0\u05e5 \u05d1\u05e0\u05d9\u05de\u05d9\u05df",
    ]),
  );
}

function normalizeMemberLookupName(value) {
  return tokenizeName(value)
    .map((token) => token.toLowerCase())
    .join(" ");
}

const memberLookupMap = new Map();
const memberAliasEntries = [];
for (const member of members) {
  const lookupCandidates = new Set([member.name, ...(member.aliases || [])]);

  for (const alias of lookupCandidates) {
    const normalizedAlias = normalizeMemberLookupName(alias);

    if (!normalizedAlias || memberLookupMap.has(normalizedAlias)) {
      continue;
    }

    memberLookupMap.set(normalizedAlias, member);
  }

  for (const alias of lookupCandidates) {
    const looseTokens = tokenizeLooseMemberName(alias);

    if (looseTokens.length < 2) {
      continue;
    }

    memberAliasEntries.push({
      member,
      looseTokens,
      looseTokenKey: buildTokenKey(looseTokens),
    });
  }
}

function getMemberRegistry() {
  return {
    parties: parties.map((party) => ({
      ...party,
      members: party.members.map((member) => ({ ...member })),
    })),
    members: members.map((member) => ({ ...member })),
  };
}

function resolveMemberByName(name) {
  const normalizedName = normalizeMemberLookupName(name);

  if (!normalizedName) {
    return null;
  }

  const member = memberLookupMap.get(normalizedName);

  if (member) {
    return { ...member };
  }

  const looseTokens = tokenizeLooseMemberName(name);

  if (looseTokens.length < 2) {
    return null;
  }

  const looseTokenKey = buildTokenKey(looseTokens);
  const exactTokenCandidates = memberAliasEntries.filter((entry) => entry.looseTokenKey === looseTokenKey);
  const uniqueExactMembers = Array.from(new Set(exactTokenCandidates.map((entry) => entry.member.slug)));

  if (uniqueExactMembers.length === 1) {
    return { ...exactTokenCandidates[0].member };
  }

  const subsetCandidates = memberAliasEntries
    .filter((entry) => entry.looseTokens.length >= 2 && containsAllTokens(looseTokens, entry.looseTokens))
    .sort((left, right) => {
      if (right.looseTokens.length !== left.looseTokens.length) {
        return right.looseTokens.length - left.looseTokens.length;
      }

      return String(left.member.name || "").localeCompare(String(right.member.name || ""), "he");
    });

  if (!subsetCandidates.length) {
    return null;
  }

  const bestLength = subsetCandidates[0].looseTokens.length;
  const bestCandidates = subsetCandidates.filter((entry) => entry.looseTokens.length === bestLength);
  const uniqueSubsetMembers = Array.from(new Set(bestCandidates.map((entry) => entry.member.slug)));

  if (uniqueSubsetMembers.length === 1) {
    return { ...bestCandidates[0].member };
  }

  return null;
}

module.exports = {
  MEMBER_PROTOCOL_SINCE_DATE,
  MEMBER_PROTOCOL_SINCE_YEAR,
  getMemberRegistry,
  normalizeMemberLookupName,
  resolveMemberByName,
};
