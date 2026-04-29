const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const { mapWithConcurrency, readJson, writeJson } = require("../lib/utils");

const execFileAsync = promisify(execFile);

const rootDir = path.resolve(__dirname, "..", "..");
const dataDir = path.join(rootDir, "data");
const directoryPath = path.join(dataDir, "member-contact-directory.json");
const reportPath = path.join(dataDir, "member-contact-validation-report.json");

const CURL_BIN = process.env.CURL_BIN || "curl.exe";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const ACCEPT_LANGUAGE = "en-US,en;q=0.9,he;q=0.8";
const CURL_MARKER = "__CODEX_CURL_META__";
const CURL_MAX_TIME_SECONDS = 25;
const CURL_MAX_BUFFER = 8 * 1024 * 1024;
const VALIDATION_CONCURRENCY = 4;
const INSTAGRAM_APP_ID = "936619743392459";
const TRANSIENT_STATUS_CODES = new Set([0, 408, 425, 429, 500, 502, 503, 504]);
const INVALID_WEBSITE_STATUS_CODES = new Set([404, 410, 451]);
const NON_PROFILE_X_SEGMENTS = new Set([
  "",
  "compose",
  "explore",
  "hashtag",
  "home",
  "i",
  "intent",
  "messages",
  "search",
  "settings",
  "share",
]);

function cleanString(value) {
  return String(value || "").trim();
}

function normalizeHref(value) {
  return cleanString(value).replace(/\/+$/, "");
}

function normalizeHost(hostname) {
  return cleanString(hostname).toLowerCase().replace(/^www\./, "");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function toPlainText(value) {
  return cleanString(value)
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/");
}

function extractHtmlAttributes(tagText) {
  const attributes = {};
  const attributePattern =
    /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match = attributePattern.exec(tagText);

  while (match) {
    const [, rawName, doubleQuotedValue, singleQuotedValue, bareValue] = match;
    attributes[rawName.toLowerCase()] = toPlainText(
      doubleQuotedValue ?? singleQuotedValue ?? bareValue ?? "",
    );
    match = attributePattern.exec(tagText);
  }

  return attributes;
}

function extractMetaContent(html, targetName) {
  const tagPattern = /<meta\b[^>]*>/gi;
  let match = tagPattern.exec(String(html || ""));
  const normalizedTarget = String(targetName || "").toLowerCase();

  while (match) {
    const attributes = extractHtmlAttributes(match[0]);
    const attributeName = cleanString(attributes.property || attributes.name).toLowerCase();

    if (attributeName === normalizedTarget) {
      return cleanString(attributes.content);
    }

    match = tagPattern.exec(String(html || ""));
  }

  return "";
}

function extractTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanString(toPlainText(match ? match[1] : ""));
}

function includesAny(haystack, needles) {
  const text = String(haystack || "").toLowerCase();
  return needles.some((needle) => text.includes(String(needle).toLowerCase()));
}

function buildResult(status, reason, extra = {}) {
  return {
    status,
    reason,
    ...extra,
  };
}

function buildValid(reason = "validated", extra = {}) {
  return buildResult("valid", reason, extra);
}

function buildInvalid(reason, extra = {}) {
  return buildResult("invalid", reason, extra);
}

function buildUnverified(reason, extra = {}) {
  return buildResult("unverified", reason, extra);
}

function parseCurlOutput(stdout, url) {
  const rawStdout = typeof stdout === "string" ? stdout : String(stdout || "");
  const markerIndex = rawStdout.lastIndexOf(CURL_MARKER);

  if (markerIndex < 0) {
    return {
      status: 0,
      finalUrl: url,
      contentType: "",
      text: rawStdout,
      error: "Missing curl metadata marker.",
    };
  }

  const text = rawStdout.slice(0, markerIndex).replace(/\s+$/, "");
  const metadataText = rawStdout.slice(markerIndex + CURL_MARKER.length).trim();
  const [statusText = "0", finalUrl = url, contentType = ""] = metadataText.split("|");
  const status = Number.parseInt(statusText, 10);

  return {
    status: Number.isFinite(status) ? status : 0,
    finalUrl: cleanString(finalUrl) || url,
    contentType: cleanString(contentType),
    text,
    error: "",
  };
}

async function requestUrl(url, options = {}) {
  const extraHeaderArgs = Object.entries(options.headers || {}).flatMap(([name, value]) =>
    cleanString(value) ? ["--header", `${name}: ${value}`] : [],
  );
  const args = [
    "-L",
    "--max-time",
    String(CURL_MAX_TIME_SECONDS),
    "--silent",
    "--show-error",
    "--compressed",
    "--user-agent",
    USER_AGENT,
    "--header",
    `Accept-Language: ${ACCEPT_LANGUAGE}`,
    "--header",
    "Cache-Control: no-cache",
    ...extraHeaderArgs,
    "--write-out",
    `\n${CURL_MARKER}%{http_code}|%{url_effective}|%{content_type}`,
    url,
  ];

  try {
    const { stdout } = await execFileAsync(CURL_BIN, args, {
      encoding: "utf8",
      maxBuffer: CURL_MAX_BUFFER,
      windowsHide: true,
    });

    return parseCurlOutput(stdout, url);
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const parsed = parseCurlOutput(stdout, url);
    return {
      ...parsed,
      error:
        cleanString(error?.stderr) ||
        cleanString(error?.message) ||
        parsed.error ||
        "Unknown curl error.",
    };
  }
}

function shouldRetryRequest(response) {
  return Boolean(response?.error) || TRANSIENT_STATUS_CODES.has(Number(response?.status || 0));
}

async function requestUrlWithRetries(url, attempts = 2, options = {}) {
  let response = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    response = await requestUrl(url, options);

    if (!shouldRetryRequest(response) || attempt === attempts - 1) {
      return response;
    }
  }

  return response;
}

function extractEmailAddress(contact) {
  const rawHref = cleanString(contact?.href);
  const rawValue = cleanString(contact?.value);
  const rawLabel = cleanString(contact?.label);
  const candidate = rawHref.startsWith("mailto:")
    ? rawHref.slice("mailto:".length)
    : rawValue || rawLabel;
  return decodeURIComponent(candidate.split("?")[0] || "").trim();
}

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanString(value));
}

function extractPhoneDigits(contact) {
  const rawHref = cleanString(contact?.href).replace(/^tel:/i, "");
  const rawValue = rawHref || cleanString(contact?.value) || cleanString(contact?.label);
  return rawValue.replace(/\D/g, "");
}

function extractCanonicalProfilePath(urlValue) {
  const parsed = parseUrl(urlValue);

  if (!parsed) {
    return "";
  }

  return cleanString(parsed.pathname.replace(/\/+$/, ""));
}

function isKnownNotFoundBody(text) {
  return includesAny(text, [
    "sorry, this page isn't available",
    "the link you followed may be broken",
    "this content isn't available",
    "page isn't available",
    "page not found",
    "404 not found",
    "content is unavailable",
    "doesn't exist",
    "couldn't find this page",
  ]);
}

async function validateFacebook(contact) {
  const response = await requestUrlWithRetries(contact.href);
  const html = response.text;
  const ogTitle = extractMetaContent(html, "og:title");
  const ogUrl = extractMetaContent(html, "og:url");
  const androidUrl = extractMetaContent(html, "al:android:url");

  if (response.status === 404 || response.status === 410) {
    return buildInvalid("facebook_http_not_found", { httpStatus: response.status });
  }

  if (
    isKnownNotFoundBody(html) ||
    includesAny(html, ["profile isn't available", "this page isn't available"])
  ) {
    return buildInvalid("facebook_page_missing", { httpStatus: response.status });
  }

  if (
    ogTitle &&
    ogUrl &&
    includesAny(ogUrl, ["facebook.com", "fb.com"]) &&
    (androidUrl ? includesAny(androidUrl, ["fb://", "facebook://"]) : true)
  ) {
    return buildValid("facebook_meta_validated", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
    });
  }

  if (response.error) {
    return buildUnverified("facebook_request_error", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
      error: response.error,
    });
  }

  return buildUnverified("facebook_inconclusive", {
    httpStatus: response.status,
    finalUrl: response.finalUrl,
  });
}

async function validateInstagram(contact) {
  const username = extractCanonicalProfilePath(contact.href).replace(/^\/+/, "");

  if (!username || includesAny(username, ["/", "accounts", "explore", "reel", "p/"])) {
    return buildInvalid("instagram_missing_profile_handle");
  }

  const apiResponse = await requestUrlWithRetries(
    `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(
      username.replace(/^@/, ""),
    )}`,
    2,
    {
      headers: {
        "X-IG-App-ID": INSTAGRAM_APP_ID,
      },
    },
  );

  if (apiResponse.status === 404) {
    return buildInvalid("instagram_api_not_found", { httpStatus: apiResponse.status });
  }

  if (apiResponse.status === 200) {
    try {
      const payload = JSON.parse(apiResponse.text);
      const returnedUsername = cleanString(payload?.data?.user?.username).toLowerCase();

      if (returnedUsername && returnedUsername === username.replace(/^@/, "").toLowerCase()) {
        return buildValid("instagram_api_validated", {
          httpStatus: apiResponse.status,
          finalUrl: contact.href,
        });
      }
    } catch (error) {
      if (includesAny(apiResponse.text, ["user not found", "not found"])) {
        return buildInvalid("instagram_api_not_found", { httpStatus: apiResponse.status });
      }

      return buildUnverified("instagram_api_parse_error", {
        httpStatus: apiResponse.status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (includesAny(apiResponse.text, ["user not found", "not found"])) {
    return buildInvalid("instagram_api_not_found", { httpStatus: apiResponse.status });
  }

  const response = await requestUrlWithRetries(contact.href);
  const html = response.text;
  const ogTitle = extractMetaContent(html, "og:title");
  const ogUrl = extractMetaContent(html, "og:url");
  const androidUrl = extractMetaContent(html, "al:android:url");

  if (response.status === 404 || response.status === 410) {
    return buildInvalid("instagram_http_not_found", { httpStatus: response.status });
  }

  if (isKnownNotFoundBody(html)) {
    return buildInvalid("instagram_page_missing", { httpStatus: response.status });
  }

  if (
    ogTitle &&
    ogUrl &&
    includesAny(ogUrl, ["instagram.com"]) &&
    !includesAny(ogUrl, ["/accounts/login"]) &&
    !includesAny(response.finalUrl, ["/accounts/login"]) &&
    (!androidUrl || includesAny(androidUrl, ["instagram://", "com.instagram.android"]))
  ) {
    return buildValid("instagram_meta_validated", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
    });
  }

  if (response.error) {
    return buildUnverified("instagram_request_error", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
      error: response.error,
    });
  }

  return buildUnverified("instagram_inconclusive", {
    httpStatus: response.status,
    finalUrl: response.finalUrl,
  });
}

async function validateThreads(contact) {
  const response = await requestUrlWithRetries(contact.href);
  const html = response.text;
  const ogTitle = extractMetaContent(html, "og:title");
  const ogUrl = extractMetaContent(html, "og:url");

  if (response.status === 404 || response.status === 410) {
    return buildInvalid("threads_http_not_found", { httpStatus: response.status });
  }

  if (
    includesAny(response.finalUrl, ["/login"]) ||
    includesAny(ogUrl, ["/login"]) ||
    includesAny(ogTitle, ["log in"]) ||
    includesAny(extractTitle(html), ["log in"])
  ) {
    return buildInvalid("threads_redirected_to_login", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
    });
  }

  if (
    ogTitle &&
    ogUrl &&
    (includesAny(ogUrl, ["threads.com/@", "threads.net/@"]) ||
      includesAny(response.finalUrl, ["threads.com/@", "threads.net/@"]))
  ) {
    return buildValid("threads_meta_validated", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
    });
  }

  if (response.error) {
    return buildUnverified("threads_request_error", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
      error: response.error,
    });
  }

  return buildUnverified("threads_inconclusive", {
    httpStatus: response.status,
    finalUrl: response.finalUrl,
  });
}

function extractXHandle(contact) {
  const parsed = parseUrl(contact.href);

  if (!parsed) {
    return "";
  }

  let candidatePath = cleanString(parsed.pathname);

  if ((!candidatePath || candidatePath === "/") && cleanString(parsed.hash).startsWith("#!/")) {
    candidatePath = parsed.hash.slice(2);
  }

  const firstSegment = cleanString(candidatePath.replace(/^\/+/, "").split("/")[0]);

  if (!firstSegment || NON_PROFILE_X_SEGMENTS.has(firstSegment.toLowerCase())) {
    return "";
  }

  return firstSegment.replace(/^@/, "");
}

async function validateX(contact) {
  let href = contact.href;
  const directHost = normalizeHost(parseUrl(href)?.hostname);

  if (!["twitter.com", "x.com", "mobile.twitter.com"].includes(directHost)) {
    const redirectResponse = await requestUrlWithRetries(href);
    const redirectedHost = normalizeHost(parseUrl(redirectResponse.finalUrl)?.hostname);

    if (["twitter.com", "x.com", "mobile.twitter.com"].includes(redirectedHost)) {
      href = redirectResponse.finalUrl;
    }
  }

  const handle = extractXHandle({ href });

  if (!handle) {
    return buildInvalid("x_missing_profile_handle");
  }

  const canonicalProfileUrl = `https://twitter.com/${encodeURIComponent(handle)}`;
  const response = await requestUrlWithRetries(
    `https://publish.twitter.com/oembed?url=${encodeURIComponent(canonicalProfileUrl)}`,
  );

  if (response.status === 404) {
    return buildInvalid("x_oembed_not_found", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
    });
  }

  if (response.status === 200) {
    try {
      const payload = JSON.parse(response.text);
      const providerName = cleanString(payload.provider_name);
      const authorUrl = cleanString(payload.author_url);
      const html = cleanString(payload.html);

      if (providerName.toLowerCase() === "twitter" && (authorUrl || html)) {
        return buildValid("x_oembed_validated", {
          httpStatus: response.status,
          finalUrl: authorUrl || response.finalUrl,
        });
      }
    } catch (error) {
      return buildUnverified("x_oembed_parse_error", {
        httpStatus: response.status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (response.error) {
    return buildUnverified("x_request_error", {
      httpStatus: response.status,
      error: response.error,
    });
  }

  return buildUnverified("x_inconclusive", {
    httpStatus: response.status,
    finalUrl: response.finalUrl,
  });
}

async function validateTikTok(contact) {
  const response = await requestUrlWithRetries(
    `https://www.tiktok.com/oembed?url=${encodeURIComponent(contact.href)}`,
  );

  if (response.status === 400 || response.status === 404) {
    return buildInvalid("tiktok_oembed_not_found", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
    });
  }

  if (response.status === 200) {
    try {
      const payload = JSON.parse(response.text);
      const authorUrl = cleanString(payload.author_url);
      const authorName = cleanString(payload.author_name);

      if (authorUrl || authorName) {
        return buildValid("tiktok_oembed_validated", {
          httpStatus: response.status,
          finalUrl: authorUrl || response.finalUrl,
        });
      }
    } catch (error) {
      return buildUnverified("tiktok_oembed_parse_error", {
        httpStatus: response.status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (response.error) {
    return buildUnverified("tiktok_request_error", {
      httpStatus: response.status,
      error: response.error,
    });
  }

  return buildUnverified("tiktok_inconclusive", {
    httpStatus: response.status,
    finalUrl: response.finalUrl,
  });
}

async function validateYouTube(contact) {
  const response = await requestUrlWithRetries(contact.href);
  const html = response.text;
  const ogTitle = extractMetaContent(html, "og:title");
  const ogUrl = extractMetaContent(html, "og:url");
  const appUrl = extractMetaContent(html, "twitter:app:url:iphone");

  if (response.status === 404 || response.status === 410) {
    return buildInvalid("youtube_http_not_found", { httpStatus: response.status });
  }

  if (isKnownNotFoundBody(html)) {
    return buildInvalid("youtube_page_missing", { httpStatus: response.status });
  }

  if (
    ogTitle &&
    ogUrl &&
    includesAny(ogUrl, ["youtube.com", "youtu.be"]) &&
    (appUrl ? includesAny(appUrl, ["youtube://"]) : true)
  ) {
    return buildValid("youtube_meta_validated", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
    });
  }

  if (response.error) {
    return buildUnverified("youtube_request_error", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
      error: response.error,
    });
  }

  return buildUnverified("youtube_inconclusive", {
    httpStatus: response.status,
    finalUrl: response.finalUrl,
  });
}

async function validateWebsite(contact) {
  const response = await requestUrlWithRetries(contact.href);
  const host = normalizeHost(parseUrl(contact.href)?.hostname);

  if (INVALID_WEBSITE_STATUS_CODES.has(response.status)) {
    return buildInvalid("website_http_not_found", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
    });
  }

  if (
    response.error &&
    includesAny(response.error, [
      "could not resolve host",
      "name or service not known",
      "no such host",
      "couldn't connect",
      "failed to connect",
      "connection refused",
      "ssl certificate problem",
      "schannel",
    ])
  ) {
    return buildInvalid("website_unreachable", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
      error: response.error,
    });
  }

  if (response.status >= 200 && response.status < 400) {
    return buildValid("website_http_ok", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
      host,
    });
  }

  if (response.error) {
    return buildUnverified("website_request_error", {
      httpStatus: response.status,
      finalUrl: response.finalUrl,
      error: response.error,
    });
  }

  return buildUnverified("website_inconclusive", {
    httpStatus: response.status,
    finalUrl: response.finalUrl,
    host,
  });
}

async function validateEmail(contact) {
  const emailAddress = extractEmailAddress(contact);

  if (!emailAddress) {
    return buildInvalid("email_missing_recipient");
  }

  if (!isValidEmailAddress(emailAddress)) {
    return buildInvalid("email_invalid_format");
  }

  return buildValid("email_format_valid", { recipient: emailAddress });
}

async function validatePhone(contact) {
  const digits = extractPhoneDigits(contact);

  if (!digits) {
    return buildInvalid("phone_missing_digits");
  }

  if (digits.length < 9) {
    return buildInvalid("phone_internal_extension_or_missing_area_code", {
      digits,
    });
  }

  if (digits.length > 15) {
    return buildInvalid("phone_too_many_digits", { digits });
  }

  return buildValid("phone_public_number_format_valid", { digits });
}

async function validateContact(contact) {
  switch (contact.platform) {
    case "email":
      return validateEmail(contact);
    case "phone":
      return validatePhone(contact);
    case "facebook":
      return validateFacebook(contact);
    case "instagram":
      return validateInstagram(contact);
    case "threads":
      return validateThreads(contact);
    case "x":
      return validateX(contact);
    case "tiktok":
      return validateTikTok(contact);
    case "youtube":
      return validateYouTube(contact);
    case "website":
      return validateWebsite(contact);
    default:
      return buildUnverified("platform_not_supported");
  }
}

function buildValidationKey(contact) {
  return `${cleanString(contact.platform).toLowerCase()}|${normalizeHref(contact.href)}`;
}

function summarizeBy(items, getKey) {
  return items.reduce((accumulator, item) => {
    const key = getKey(item);
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

async function main() {
  const directory = await readJson(directoryPath);
  const members = Object.values(directory.members || {});
  const contacts = members.flatMap((member) =>
    (Array.isArray(member.contacts) ? member.contacts : []).map((contact) => ({
      slug: member.slug,
      name: member.name,
      partyName: member.partyName,
      contact,
    })),
  );

  const uniqueContacts = [];
  const seenKeys = new Set();

  for (const entry of contacts) {
    const validationKey = buildValidationKey(entry.contact);

    if (seenKeys.has(validationKey)) {
      continue;
    }

    seenKeys.add(validationKey);
    uniqueContacts.push({
      platform: entry.contact.platform,
      href: entry.contact.href,
      contact: entry.contact,
    });
  }

  console.log(
    `Validating ${uniqueContacts.length} unique contact links across ${contacts.length} member contact entries...`,
  );

  const validationResults = await mapWithConcurrency(
    uniqueContacts,
    VALIDATION_CONCURRENCY,
    async (entry, index) => {
      const validation = await validateContact(entry.contact);
      console.log(
        `[${index + 1}/${uniqueContacts.length}] ${entry.platform} ${entry.href} -> ${validation.status} (${validation.reason})`,
      );
      return {
        key: buildValidationKey(entry.contact),
        platform: entry.platform,
        href: entry.href,
        validation,
      };
    },
  );

  const validationMap = new Map(
    validationResults.map((result) => [result.key, result.validation]),
  );
  const removedEntries = [];

  for (const member of members) {
    const keptContacts = [];

    for (const contact of Array.isArray(member.contacts) ? member.contacts : []) {
      const validation = validationMap.get(buildValidationKey(contact));

      if (validation?.status === "invalid") {
        removedEntries.push({
          slug: member.slug,
          name: member.name,
          partyName: member.partyName,
          platform: contact.platform,
          href: contact.href,
          label: contact.label,
          sourceField: contact.sourceField,
          reason: validation.reason,
          httpStatus: validation.httpStatus || null,
          finalUrl: validation.finalUrl || "",
          error: validation.error || "",
        });
        continue;
      }

      keptContacts.push(contact);
    }

    member.contacts = keptContacts;
  }

  const checkedAt = new Date().toISOString();
  const report = {
    checkedAt,
    directoryPath,
    uniqueLinksChecked: uniqueContacts.length,
    totalContactEntriesChecked: contacts.length,
    invalidEntriesRemoved: removedEntries.length,
    removedByPlatform: summarizeBy(removedEntries, (entry) => entry.platform),
    removedByReason: summarizeBy(removedEntries, (entry) => entry.reason),
    unverifiedUniqueLinks: validationResults
      .filter((result) => result.validation.status === "unverified")
      .map((result) => ({
        platform: result.platform,
        href: result.href,
        reason: result.validation.reason,
        httpStatus: result.validation.httpStatus || null,
        finalUrl: result.validation.finalUrl || "",
        error: result.validation.error || "",
      })),
    removedEntries,
  };

  directory.lastValidatedAt = checkedAt;
  directory.lastPrunedBrokenContactsAt = checkedAt;

  await writeJson(directoryPath, directory);
  await writeJson(reportPath, report);

  console.log(
    JSON.stringify(
      {
        checkedAt,
        uniqueLinksChecked: uniqueContacts.length,
        totalContactEntriesChecked: contacts.length,
        invalidEntriesRemoved: removedEntries.length,
        removedByPlatform: report.removedByPlatform,
        removedByReason: report.removedByReason,
        unverifiedUniqueLinks: report.unverifiedUniqueLinks.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
