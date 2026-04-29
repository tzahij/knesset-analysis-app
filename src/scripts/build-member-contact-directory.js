const path = require("path");
const { execFileSync } = require("child_process");

const { getMemberRegistry, resolveMemberByName } = require("../lib/member-registry");
const { mapWithConcurrency, writeJson } = require("../lib/utils");
const { DEFAULT_MEMBER_CONTACT_DISCLAIMER } = require("../lib/member-contact-directory-service");

const rootDir = path.resolve(__dirname, "..", "..");
const outputPath = path.join(rootDir, "data", "member-contact-directory.json");

const SOURCE_URL = "https://www.knesset.gov.il/WebSiteApi/knessetapi/MkLobby/GetMkLobbyData?lang=he";
const WIKIDATA_SEARCH_URL =
  "https://www.wikidata.org/w/api.php?action=wbsearchentities&language=he&format=json&limit=5";
const WIKIDATA_ENTITY_URL_PREFIX = "https://www.wikidata.org/wiki/Special:EntityData/";
const ZMANKNESSET_SITEMAP_URL = "https://zmanknesset.co.il/sitemap.xml";
const KSHARE_SITEMAP_URL = "https://www.kshare.co.il/sitemap.xml";
const ZMANKNESSET_FETCH_CONCURRENCY = 8;
const KSHARE_MEMBER_ROUTE_PREFIX =
  "https://www.kshare.co.il/%D7%97%D7%91%D7%A8%D7%99-%D7%9B%D7%A0%D7%A1%D7%AA-%D7%95%D7%A9%D7%A8%D7%99%D7%9D/";
const KSHARE_FETCH_CONCURRENCY = 6;
const CURL_BIN = process.platform === "win32" ? "curl.exe" : "curl";
const MANUAL_NAME_TO_ROUTE_SLUG = new Map([["יצחק גולדקנופ", "member-095"]]);
const MANUAL_WEB_FALLBACKS = {
  "member-101": {
    sourceUrls: [
      "https://www.kshare.co.il/%D7%97%D7%91%D7%A8%D7%99-%D7%9B%D7%A0%D7%A1%D7%AA-%D7%95%D7%A9%D7%A8%D7%99%D7%9D/%D7%99%D7%A9%D7%A8%D7%90%D7%9C-%D7%90%D7%99%D7%99%D7%9B%D7%9C%D7%A8",
    ],
    contacts: [
      {
        platform: "email",
        type: "email",
        value: "ieichler@knesset.gov.il",
        href: "mailto:ieichler@knesset.gov.il",
        sourceField: "WebFallback:Kshare",
      },
      {
        platform: "phone",
        type: "phone",
        value: "02-6408475",
        href: "tel:026408475",
        sourceField: "WebFallback:Kshare",
      },
      {
        platform: "x",
        type: "social",
        value: "https://twitter.com/YisraelEichler",
        href: "https://twitter.com/YisraelEichler",
        sourceField: "WebFallback:Kshare",
      },
    ],
  },
  "member-112": {
    sourceUrls: [
      "https://www.kshare.co.il/%D7%97%D7%91%D7%A8%D7%99-%D7%9B%D7%A0%D7%A1%D7%AA-%D7%95%D7%A9%D7%A8%D7%99%D7%9D/%D7%99%D7%95%D7%A1%D7%A3-%D7%A2%D7%98%D7%90%D7%95%D7%A0%D7%94",
      "https://zmanknesset.co.il/member/20219",
    ],
    contacts: [
      {
        platform: "email",
        type: "email",
        value: "ayosef@knesset.gov.il",
        href: "mailto:ayosef@knesset.gov.il",
        sourceField: "WebFallback:Kshare",
      },
      {
        platform: "phone",
        type: "phone",
        value: "02-6408637",
        href: "tel:026408637",
        sourceField: "WebFallback:Kshare",
      },
      {
        platform: "x",
        type: "social",
        value: "https://twitter.com/yousefataw",
        href: "https://twitter.com/yousefataw",
        sourceField: "WebFallback:Kshare",
      },
    ],
  },
};
const DISPLAY_ORDER = ["email", "phone", "whatsapp", "facebook", "instagram", "threads", "x", "tiktok", "linkedin", "youtube", "website"];

function cleanString(value) {
  return String(value || "").trim();
}

function getRouteSlug(member) {
  return member?.id || member?.slug || "";
}

function normalizeUrl(value) {
  const rawValue = cleanString(value);

  if (!rawValue) {
    return "";
  }

  if (/^https?:\/\//i.test(rawValue)) {
    return rawValue;
  }

  return `https://${rawValue.replace(/^\/+/, "")}`;
}

function splitPublicValues(value) {
  return cleanString(value)
    .split(/[;,]/)
    .map((entry) => cleanString(entry))
    .filter(Boolean);
}

function buildTelHref(phoneNumber) {
  const sanitized = cleanString(phoneNumber).replace(/[^\d+#*]/g, "");
  return sanitized ? `tel:${sanitized}` : "";
}

function buildWhatsAppHref(phoneNumber) {
  const digits = cleanString(phoneNumber).replace(/\D+/g, "");

  if (!digits) {
    return "";
  }

  let normalized = digits;

  if (normalized.startsWith("00")) {
    normalized = normalized.slice(2);
  } else if (normalized.startsWith("0")) {
    normalized = `972${normalized.slice(1)}`;
  }

  if (!/^9725\d{8}$/.test(normalized)) {
    return "";
  }

  return `https://wa.me/${normalized}`;
}

function detectPlatformFromUrl(url) {
  const lowerUrl = String(url || "").toLowerCase();

  if (!lowerUrl) {
    return "website";
  }

  if (lowerUrl.includes("facebook.com")) {
    return "facebook";
  }

  if (lowerUrl.includes("instagram.com")) {
    return "instagram";
  }

  if (lowerUrl.includes("threads.net")) {
    return "threads";
  }

  if (lowerUrl.includes("tiktok.com")) {
    return "tiktok";
  }

  if (lowerUrl.includes("linkedin.com")) {
    return "linkedin";
  }

  if (lowerUrl.includes("twitter.com") || lowerUrl.includes("x.com")) {
    return "x";
  }

  if (lowerUrl.includes("youtube.com") || lowerUrl.includes("youtu.be")) {
    return "youtube";
  }

  if (lowerUrl.includes("wa.me") || lowerUrl.includes("whatsapp.com")) {
    return "whatsapp";
  }

  return "website";
}

function normalizeSocialUrl(url) {
  const rawValue = cleanString(url);

  if (!rawValue) {
    return "";
  }

  try {
    const parsed = new URL(rawValue);

    if (parsed.hostname.includes("twitter.com") || parsed.hostname.includes("x.com")) {
      parsed.searchParams.delete("ref_src");
      parsed.searchParams.delete("lang");
      parsed.searchParams.delete("t");
      parsed.searchParams.delete("s");
    }

    if (parsed.hostname.includes("instagram.com")) {
      parsed.searchParams.delete("hl");
      parsed.searchParams.delete("igsh");
    }

    if (parsed.hostname.includes("tiktok.com")) {
      parsed.searchParams.delete("_t");
      parsed.searchParams.delete("_r");
      parsed.searchParams.delete("lang");
    }

    const normalized = parsed.toString();
    return normalized.replace(/\/$/, (parsed.pathname === "/" ? "/" : ""));
  } catch {
    return rawValue;
  }
}

function isPlaceholderProfileValue(value) {
  return /(^|[\/@._-])no[a-z]+profile([/?#._-]|$)/i.test(String(value || ""));
}

function sortContacts(contacts) {
  return contacts.sort((left, right) => {
    const leftIndex = DISPLAY_ORDER.indexOf(left.platform);
    const rightIndex = DISPLAY_ORDER.indexOf(right.platform);

    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
}

function buildContactEntry({
  id,
  type,
  platform,
  value,
  href,
  sourceField,
}) {
  const trimmedValue = cleanString(value);
  const trimmedHref = cleanString(href);

  if (!trimmedValue || !trimmedHref) {
    return null;
  }

  return {
    id,
    type,
    platform,
    label: trimmedValue,
    value: trimmedValue,
    href: trimmedHref,
    sourceField,
  };
}

function pushUniqueContact(contacts, entry) {
  if (!entry) {
    return;
  }

  const entryHrefKey = normalizeSocialUrl(String(entry.href || "").toLowerCase());
  const entryValueKey = cleanString(entry.value).toLowerCase();
  const duplicate = contacts.some(
    (contact) =>
      normalizeSocialUrl(String(contact.href || "").toLowerCase()) === entryHrefKey ||
      (contact.type === entry.type &&
        contact.platform === entry.platform &&
        cleanString(contact.value).toLowerCase() === entryValueKey),
  );

  if (!duplicate) {
    contacts.push(entry);
  }
}

function buildContactsFromManualFallback(entries) {
  const contacts = [];

  for (const entry of entries || []) {
    pushUniqueContact(
      contacts,
      buildContactEntry({
        id: `${entry.platform}-${contacts.length + 1}`,
        type: entry.type,
        platform: entry.platform,
        value: entry.value,
        href: entry.href,
        sourceField: entry.sourceField,
      }),
    );
  }

  return sortContacts(contacts);
}

function normalizeSlugCandidate(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/["'׳״`]/g, "")
    .replace(/[()]/g, " ")
    .replace(/[\u2010-\u2015\u05BE/]+/g, " ")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "-");
}

async function fetchTextWithRetries(url, retries = 2) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 Codex",
        },
      });

      if (!response.ok) {
        return "";
      }

      return await response.text();
    } catch (error) {
      lastError = error;
    }
  }

  if (String(url || "").includes("kshare.co.il")) {
    try {
      return execFileSync(CURL_BIN, ["-L", "--max-time", "60", String(url)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 25 * 1024 * 1024,
      });
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return "";
}

function extractSocialLinksFromHtml(html) {
  const contacts = [];
  const matches = String(html || "").match(
    /https?:\/\/(?:www\.)?(?:facebook\.com|twitter\.com|x\.com|instagram\.com|threads\.net|tiktok\.com|linkedin\.com|youtube\.com|youtu\.be)[^"'<)\s]+/gi,
  );

  for (const href of matches || []) {
    const normalizedHref = normalizeSocialUrl(normalizeUrl(href));

    if (isPlaceholderProfileValue(normalizedHref)) {
      continue;
    }

    const platform = detectPlatformFromUrl(normalizedHref);

    pushUniqueContact(
      contacts,
      buildContactEntry({
        id: `${platform}-${contacts.length + 1}`,
        type: "social",
        platform,
        value: normalizedHref,
        href: normalizedHref,
        sourceField: "Kshare:html_code",
      }),
    );
  }

  return contacts;
}

function buildContactsFromKshareRecord(record) {
  const contacts = [];
  const kshareEmail = cleanString(record?.email);
  const ksharePhone = cleanString(record?.טלפון);

  if (kshareEmail) {
    pushUniqueContact(
      contacts,
      buildContactEntry({
        id: `email-${contacts.length + 1}`,
        type: "email",
        platform: "email",
        value: kshareEmail,
        href: `mailto:${kshareEmail}`,
        sourceField: "Kshare:email",
      }),
    );
  }

  if (ksharePhone) {
    pushUniqueContact(
      contacts,
      buildContactEntry({
        id: `phone-${contacts.length + 1}`,
        type: "phone",
        platform: "phone",
        value: ksharePhone,
        href: buildTelHref(ksharePhone),
        sourceField: "Kshare:טלפון",
      }),
    );

    const whatsappHref = buildWhatsAppHref(ksharePhone);

    if (whatsappHref) {
      pushUniqueContact(
        contacts,
        buildContactEntry({
          id: `whatsapp-${contacts.length + 1}`,
          type: "social",
          platform: "whatsapp",
          value: ksharePhone,
          href: whatsappHref,
          sourceField: "Kshare:טלפון",
        }),
      );
    }
  }

  const explicitFields = [
    { field: "facebook", platform: "facebook" },
    { field: "instagram", platform: "instagram" },
    { field: "twitter", platform: "x" },
    { field: "threads", platform: "threads" },
    { field: "tiktok", platform: "tiktok" },
    { field: "linkedin", platform: "linkedin" },
    { field: "youtube", platform: "youtube" },
    { field: "website", platform: "website" },
  ];

  for (const explicitField of explicitFields) {
    const rawValue = cleanString(record?.[explicitField.field]);

    if (!rawValue || isPlaceholderProfileValue(rawValue)) {
      continue;
    }

    const href = normalizeSocialUrl(normalizeUrl(rawValue));
    const platform = detectPlatformFromUrl(href);

    pushUniqueContact(
      contacts,
      buildContactEntry({
        id: `${platform}-${contacts.length + 1}`,
        type: "social",
        platform,
        value: href,
        href,
        sourceField: `Kshare:${explicitField.field}`,
      }),
    );
  }

  const tiktokHandle = cleanString(record?.["משתמש טיקטוק"]);

  if (tiktokHandle && !/^@?no/i.test(tiktokHandle)) {
    pushUniqueContact(
      contacts,
      buildContactEntry({
        id: `tiktok-${contacts.length + 1}`,
        type: "social",
        platform: "tiktok",
        value: normalizeSocialUrl(
          `https://www.tiktok.com/${tiktokHandle.startsWith("@") ? tiktokHandle : `@${tiktokHandle}`}`,
        ),
        href: normalizeSocialUrl(
          `https://www.tiktok.com/${tiktokHandle.startsWith("@") ? tiktokHandle : `@${tiktokHandle}`}`,
        ),
        sourceField: "Kshare:משתמש טיקטוק",
      }),
    );
  }

  for (const contact of extractSocialLinksFromHtml(record?.html_code)) {
    pushUniqueContact(contacts, contact);
  }

  return sortContacts(contacts);
}

function buildKshareMemberLookup(membersByRouteSlug) {
  const lookup = new Map();

  for (const member of membersByRouteSlug.values()) {
    for (const candidate of Array.from(new Set([member.name, ...(member.aliases || [])])).filter(Boolean)) {
      const slugCandidate = normalizeSlugCandidate(candidate);

      if (slugCandidate && !lookup.has(slugCandidate)) {
        lookup.set(slugCandidate, member);
      }
    }
  }

  return lookup;
}

function extractKshareSitemapUrls(sitemapText) {
  return Array.from(
    new Set(
      [...String(sitemapText || "").matchAll(/<loc>(https:\/\/www\.kshare\.co\.il\/[^<]+)<\/loc>/g)].map((match) =>
        cleanString(match[1]),
      ),
    ),
  );
}

function extractKshareSitemapSlug(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return decodeURIComponent(segments[segments.length - 1] || "");
  } catch {
    return "";
  }
}

async function fetchKshareProfiles(membersByRouteSlug) {
  const memberLookup = buildKshareMemberLookup(membersByRouteSlug);
  const sitemapText = await fetchTextWithRetries(KSHARE_SITEMAP_URL).catch(() => "");
  const sitemapUrls = extractKshareSitemapUrls(sitemapText);

  const memberUrls = sitemapUrls.filter((url) => {
    const slugCandidate = normalizeSlugCandidate(extractKshareSitemapSlug(url));
    return slugCandidate && memberLookup.has(slugCandidate);
  });

  const rows = await mapWithConcurrency(memberUrls, KSHARE_FETCH_CONCURRENCY, async (url) => {
    const slugCandidate = normalizeSlugCandidate(extractKshareSitemapSlug(url));
    const member = memberLookup.get(slugCandidate);

    if (!member) {
      return null;
    }

    const text = await fetchTextWithRetries(encodeURI(url)).catch(() => "");
    const base64Match = text.match(/base64JsonRowData:\s*'([^']+)'/);

    if (!base64Match || base64Match[1] === "null") {
      return null;
    }

    let record = null;

    try {
      record = JSON.parse(Buffer.from(base64Match[1], "base64").toString("utf8"));
    } catch {
      return null;
    }

    const contacts = buildContactsFromKshareRecord(record);

    if (!contacts.length) {
      return null;
    }

    return {
      slug: getRouteSlug(member),
      contacts,
      url,
      sourceName: cleanString(record?.שם),
    };
  });

  return rows.filter(Boolean);
}

function buildContactsFromSocialUrls(urls, sourceField) {
  const contacts = [];

  for (const rawUrl of urls || []) {
    const href = normalizeSocialUrl(normalizeUrl(rawUrl));
    const platform = detectPlatformFromUrl(href);

    pushUniqueContact(
      contacts,
      buildContactEntry({
        id: `${platform}-${contacts.length + 1}`,
        type: "social",
        platform,
        value: href,
        href,
        sourceField,
      }),
    );
  }

  return sortContacts(contacts);
}

function countSocialContacts(entry) {
  return (entry?.contacts || []).filter((contact) => !["email", "phone", "whatsapp"].includes(contact.platform))
    .length;
}

async function fetchZmanKnessetProfiles(membersByRouteSlug) {
  const sitemapText = await fetchTextWithRetries(ZMANKNESSET_SITEMAP_URL);
  const memberUrls = Array.from(
    new Set(
      [...sitemapText.matchAll(/https:\/\/zmanknesset\.co\.il(?::443)?\/member\/\d+/g)].map((match) =>
        match[0].replace(":443", ""),
      ),
    ),
  );

  const rows = await mapWithConcurrency(memberUrls, ZMANKNESSET_FETCH_CONCURRENCY, async (url) => {
    const html = await fetchTextWithRetries(url).catch(() => "");

    if (!html) {
      return null;
    }

    const rawTitle = (html.match(/<title>(.*?)<\/title>/i) || [])[1] || "";
    const displayName = rawTitle.split("|")[0].trim();
    const member = resolveLocalMember(displayName, membersByRouteSlug);

    if (!member) {
      return null;
    }

    const socialUrls = Array.from(
      new Set(
        [...html.matchAll(/https?:\/\/(?:www\.)?(?:facebook\.com|twitter\.com|x\.com|instagram\.com|tiktok\.com|linkedin\.com|threads\.net|youtube\.com|youtu\.be)[^"'\s<)]+/gi)].map(
          (match) => match[0],
        ),
      ),
    );
    const contacts = buildContactsFromSocialUrls(socialUrls, "ZmanKnesset:page");

    if (!contacts.length) {
      return null;
    }

    return {
      slug: getRouteSlug(member),
      url,
      contacts,
    };
  });

  return rows.filter(Boolean);
}

function buildContactsFromMkRecord(mkRecord) {
  const contacts = [];

  for (const email of splitPublicValues(mkRecord.Email)) {
    pushUniqueContact(
      contacts,
      buildContactEntry({
        id: `email-${contacts.length + 1}`,
        type: "email",
        platform: "email",
        value: email,
        href: `mailto:${email}`,
        sourceField: "Email",
      }),
    );
  }

  for (const phone of splitPublicValues(mkRecord.Phone)) {
    pushUniqueContact(
      contacts,
      buildContactEntry({
        id: `phone-${contacts.length + 1}`,
        type: "phone",
        platform: "phone",
        value: phone,
        href: buildTelHref(phone),
        sourceField: "Phone",
      }),
    );

    const whatsappHref = buildWhatsAppHref(phone);

    if (whatsappHref) {
      pushUniqueContact(
        contacts,
        buildContactEntry({
          id: `whatsapp-${contacts.length + 1}`,
          type: "social",
          platform: "whatsapp",
          value: phone,
          href: whatsappHref,
          sourceField: "Phone",
        }),
      );
    }
  }

  const socialFields = [
    { field: "Facebook", platform: "facebook" },
    { field: "Twitter", platform: "x" },
    { field: "Instegram", platform: "instagram" },
    { field: "Youtube", platform: "youtube" },
    { field: "WebsiteUrl", platform: null },
  ];

  for (const socialField of socialFields) {
    const rawValue = cleanString(mkRecord[socialField.field]);

    if (!rawValue) {
      continue;
    }

    const href = normalizeUrl(rawValue);
    const platform = socialField.platform || detectPlatformFromUrl(href);

    pushUniqueContact(
      contacts,
      buildContactEntry({
        id: `${platform}-${contacts.length + 1}`,
        type: "social",
        platform,
        value: href,
        href,
        sourceField: socialField.field,
      }),
    );
  }

  return sortContacts(contacts);
}

function buildWikidataUrl(platform, rawValue) {
  const value = cleanString(rawValue);

  if (!value) {
    return "";
  }

  if (platform === "facebook") {
    return `https://www.facebook.com/${value.replace(/^\/+/, "")}`;
  }

  if (platform === "x") {
    return `https://x.com/${value.replace(/^@/, "")}`;
  }

  if (platform === "instagram") {
    return `https://www.instagram.com/${value.replace(/^@/, "")}/`;
  }

  if (platform === "tiktok") {
    return `https://www.tiktok.com/@${value.replace(/^@/, "")}`;
  }

  if (platform === "youtube") {
    return value.startsWith("@") ? `https://www.youtube.com/${value}` : `https://www.youtube.com/channel/${value}`;
  }

  if (platform === "linkedin") {
    return /^https?:\/\//i.test(value)
      ? value
      : `https://www.linkedin.com/in/${value.replace(/^\/+/, "").replace(/\/+$/, "")}/`;
  }

  if (platform === "website") {
    return normalizeUrl(value);
  }

  return "";
}

async function searchWikidataEntities(term) {
  const response = await fetch(`${WIKIDATA_SEARCH_URL}&search=${encodeURIComponent(term)}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 Codex",
    },
  });

  if (!response.ok) {
    return [];
  }

  const payload = await response.json().catch(() => null);
  return Array.isArray(payload?.search) ? payload.search : [];
}

async function fetchWikidataClaims(entityId) {
  const response = await fetch(`${WIKIDATA_ENTITY_URL_PREFIX}${entityId}.json`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 Codex",
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  return payload?.entities?.[entityId]?.claims || null;
}

function readFirstClaimValue(claims, propertyId) {
  return claims?.[propertyId]?.[0]?.mainsnak?.datavalue?.value || null;
}

function buildContactsFromWikidataClaims(claims) {
  const contacts = [];
  const wikidataMappings = [
    { propertyId: "P2013", platform: "facebook" },
    { propertyId: "P2003", platform: "instagram" },
    { propertyId: "P2002", platform: "x" },
    { propertyId: "P7085", platform: "tiktok" },
    { propertyId: "P6634", platform: "linkedin" },
    { propertyId: "P2397", platform: "youtube" },
    { propertyId: "P856", platform: "website" },
  ];

  for (const mapping of wikidataMappings) {
    const rawValue = readFirstClaimValue(claims, mapping.propertyId);
    const href = buildWikidataUrl(mapping.platform, rawValue);

    pushUniqueContact(
      contacts,
      buildContactEntry({
        id: `${mapping.platform}-${contacts.length + 1}`,
        type: "social",
        platform: mapping.platform,
        value: href || rawValue,
        href,
        sourceField: `Wikidata:${mapping.propertyId}`,
      }),
    );
  }

  return sortContacts(contacts);
}

async function findWikidataProfile(member) {
  const searchTerms = [member.name, ...(member.aliases || [])].filter(Boolean);

  for (const term of searchTerms) {
    const results = await searchWikidataEntities(term);
    const preferredResults = results.filter((entry) =>
      /politician|knesset|minister|political/i.test(`${entry.description || ""}`),
    );
    const candidates = preferredResults.length ? preferredResults : results;

    for (const candidate of candidates) {
      const claims = await fetchWikidataClaims(candidate.id);

      if (!claims) {
        continue;
      }

      const contacts = buildContactsFromWikidataClaims(claims);

      if (contacts.length) {
        return {
          entityId: candidate.id,
          label: candidate.label || "",
          description: candidate.description || "",
          contacts,
        };
      }
    }
  }

  return null;
}

function resolveLocalMember(officialName, membersByRouteSlug) {
  const manualRouteSlug = MANUAL_NAME_TO_ROUTE_SLUG.get(officialName);

  if (manualRouteSlug) {
    return membersByRouteSlug.get(manualRouteSlug) || null;
  }

  return resolveMemberByName(officialName);
}

async function fetchOfficialDirectory() {
  const response = await fetch(SOURCE_URL);

  if (!response.ok) {
    throw new Error(`Failed to fetch member lobby data (${response.status})`);
  }

  const payload = await response.json();

  if (!Array.isArray(payload?.mks)) {
    throw new Error("Unexpected Knesset contact payload");
  }

  return payload.mks;
}

async function main() {
  const registry = getMemberRegistry().members;
  const membersByRouteSlug = new Map(registry.map((member) => [getRouteSlug(member), member]));
  const officialMks = await fetchOfficialDirectory();
  const members = {};
  const unmatchedOfficialMembers = [];
  const zmanKnessetMatchedMembers = [];
  const kshareMatchedMembers = [];
  const wikidataEnrichedMembers = [];

  for (const member of registry) {
    const routeSlug = getRouteSlug(member);
    members[routeSlug] = {
      slug: routeSlug,
      name: member.name,
      partyName: member.partyName,
      aliases: [...(member.aliases || [])],
      lookupStatus: "not_found_in_current_knesset_api",
      contacts: [],
    };
  }

  for (const mkRecord of officialMks) {
    const officialName = `${cleanString(mkRecord.Firstname)} ${cleanString(mkRecord.Lastname)}`.trim();
    const localMember = resolveLocalMember(officialName, membersByRouteSlug);

    if (!localMember) {
      unmatchedOfficialMembers.push(officialName);
      continue;
    }

    const routeSlug = getRouteSlug(localMember);
    const contacts = buildContactsFromMkRecord(mkRecord);

    members[routeSlug] = {
      slug: routeSlug,
      name: localMember.name,
      partyName: localMember.partyName,
      aliases: [...(localMember.aliases || [])],
      lookupStatus: contacts.length ? "official_current_knesset_api" : "official_current_knesset_api_without_contacts",
      contacts,
      updatedFromSourceAt: new Date().toISOString(),
    };
  }

  const zmanKnessetResults = await fetchZmanKnessetProfiles(membersByRouteSlug).catch(() => []);

  for (const result of zmanKnessetResults) {
    const entry = members[result.slug];

    if (!entry) {
      continue;
    }

    const previousCount = entry.contacts.length;

    for (const contact of result.contacts) {
      pushUniqueContact(entry.contacts, contact);
    }

    entry.contacts = sortContacts(entry.contacts);

    if (entry.contacts.length > previousCount) {
      entry.updatedFromSourceAt = new Date().toISOString();
    }

    entry.zmanKnessetUrl = result.url;
    zmanKnessetMatchedMembers.push({
      slug: result.slug,
      name: entry.name,
      addedContacts: Math.max(0, entry.contacts.length - previousCount),
    });
  }

  const unusedKshareResults = []; /*
    const routeSlug = getRouteSlug(member);
    const kshareProfile = await fetchKshareProfile(member).catch(() => null);

    if (!kshareProfile) {
      return null;
    }

    return {
      slug: routeSlug,
      contacts: kshareProfile.contacts,
      url: kshareProfile.url,
      sourceName: cleanString(kshareProfile.record?.שם),
    };
  }); */

  const kshareResults = await fetchKshareProfiles(membersByRouteSlug).catch(() => []);

  for (const result of kshareResults.filter(Boolean)) {
    const entry = members[result.slug];

    if (!entry) {
      continue;
    }

    const previousCount = entry.contacts.length;

    for (const contact of result.contacts) {
      pushUniqueContact(entry.contacts, contact);
    }

    entry.contacts = sortContacts(entry.contacts);

    if (entry.contacts.length > previousCount) {
      entry.updatedFromSourceAt = new Date().toISOString();
    }

    entry.kshareUrl = result.url;
    entry.kshareName = result.sourceName || entry.kshareName || "";
    kshareMatchedMembers.push({
      slug: result.slug,
      name: entry.name,
      addedContacts: Math.max(0, entry.contacts.length - previousCount),
    });
  }

  const wikidataTargets = Object.values(members).filter((member) => countSocialContacts(member) < 2);

  for (const member of wikidataTargets) {
    const previousCount = member.contacts.length;
    const wikidataProfile = await findWikidataProfile(member);

    if (!wikidataProfile) {
      continue;
    }

    for (const contact of wikidataProfile.contacts) {
      pushUniqueContact(member.contacts, contact);
    }

    member.contacts = sortContacts(member.contacts);

    if (member.contacts.length === previousCount) {
      continue;
    }

    if (member.lookupStatus === "not_found_in_current_knesset_api" && previousCount === 0) {
      member.lookupStatus = "wikidata_social_fallback";
    }

    member.wikidataEntityId = wikidataProfile.entityId;
    member.wikidataLabel = wikidataProfile.label;
    member.wikidataDescription = wikidataProfile.description;
    member.updatedFromSourceAt = new Date().toISOString();
    wikidataEnrichedMembers.push({
      slug: member.slug,
      name: member.name,
      entityId: wikidataProfile.entityId,
      addedContacts: member.contacts.length - previousCount,
    });
  }

  for (const member of Object.values(members)) {
    const manualFallback = MANUAL_WEB_FALLBACKS[member.slug];

    if (!manualFallback) {
      continue;
    }

    const previousCount = member.contacts.length;

    for (const contact of buildContactsFromManualFallback(manualFallback.contacts)) {
      pushUniqueContact(member.contacts, contact);
    }

    member.contacts = sortContacts(member.contacts);

    if (manualFallback.sourceUrls?.length) {
      member.sourceUrls = Array.from(new Set([...(member.sourceUrls || []), ...manualFallback.sourceUrls]));
    }

    if (member.contacts.length > previousCount) {
      member.updatedFromSourceAt = new Date().toISOString();
    }

    if (previousCount === 0 && member.contacts.length) {
      member.lookupStatus = "manual_web_fallback";
    }
  }

  const membersWithoutPublicContacts = Object.values(members)
    .filter((member) => !member.contacts.length)
    .map((member) => ({
      slug: member.slug,
      name: member.name,
      partyName: member.partyName,
    }));

  for (const member of Object.values(members)) {
    delete member.aliases;
  }

  const payload = {
    builtAt: new Date().toISOString(),
    disclaimer: DEFAULT_MEMBER_CONTACT_DISCLAIMER,
    sourceUrls: [
      SOURCE_URL,
      ZMANKNESSET_SITEMAP_URL,
      KSHARE_SITEMAP_URL,
      KSHARE_MEMBER_ROUTE_PREFIX,
      WIKIDATA_SEARCH_URL,
      `${WIKIDATA_ENTITY_URL_PREFIX}{id}.json`,
    ],
    stats: {
      registryMemberCount: registry.length,
      officialCurrentMemberCount: officialMks.length,
      matchedLocalMembers: officialMks.length - unmatchedOfficialMembers.length,
      unmatchedOfficialMembers,
      zmanKnessetMatchedMembers,
      kshareMatchedMembers,
      wikidataEnrichedMembers,
      membersWithoutPublicContacts,
    },
    members,
  };

  await writeJson(outputPath, payload);

  console.log(
    `Wrote ${outputPath} with ${Object.values(members).filter((member) => member.contacts.length).length} members that have at least one public contact method.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
