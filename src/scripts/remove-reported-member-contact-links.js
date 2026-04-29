const fs = require("fs/promises");
const path = require("path");

const { fileExists, readJson, writeJson, writeTextFile } = require("../lib/utils");

const rootDir = path.resolve(__dirname, "..", "..");
const dataDir = path.join(rootDir, "data");
const directoryPath = path.join(dataDir, "member-contact-directory.json");
const reportLogPath = path.join(dataDir, "member-contact-link-reports.jsonl");
const processedReportLogPath = path.join(dataDir, "member-contact-link-reports.processed.jsonl");

function cleanString(value) {
  return String(value || "").trim();
}

function normalizeHref(value) {
  const rawValue = cleanString(value).toLowerCase();

  if (!rawValue) {
    return "";
  }

  return rawValue.replace(/\/+$/, "");
}

function normalizeContactId(value) {
  return cleanString(value).toLowerCase();
}

function parseReportLog(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function buildReportedTargetSet(reports) {
  const targets = new Set();

  for (const report of reports) {
    const slug = cleanString(report.slug);
    const href = normalizeHref(report.href);
    const contactId = normalizeContactId(report.contactId);

    if (slug && href) {
      targets.add(`href:${slug}:${href}`);
    }

    if (slug && contactId) {
      targets.add(`id:${slug}:${contactId}`);
    }
  }

  return targets;
}

async function main() {
  if (!(await fileExists(directoryPath))) {
    throw new Error(`Contact directory not found: ${directoryPath}`);
  }

  if (!(await fileExists(reportLogPath))) {
    console.log("No broken-link report log found. Nothing to remove.");
    return;
  }

  const rawReportLog = await fs.readFile(reportLogPath, "utf8");
  const reports = parseReportLog(rawReportLog);

  if (!reports.length) {
    console.log("Broken-link report log is empty. Nothing to remove.");
    return;
  }

  const directory = await readJson(directoryPath);
  const reportedTargets = buildReportedTargetSet(reports);
  const removedEntries = [];
  let removedCount = 0;

  for (const member of Object.values(directory.members || {})) {
    const contacts = Array.isArray(member.contacts) ? member.contacts : [];
    const keptContacts = [];

    for (const contact of contacts) {
      const hrefKey = `href:${member.slug}:${normalizeHref(contact.href)}`;
      const idKey = `id:${member.slug}:${normalizeContactId(contact.id)}`;
      const shouldRemove =
        reportedTargets.has(hrefKey) ||
        (contact.id && reportedTargets.has(idKey));

      if (shouldRemove) {
        removedCount += 1;
        removedEntries.push({
          slug: member.slug,
          name: member.name,
          platform: contact.platform,
          href: contact.href,
          contactId: contact.id || "",
        });
        continue;
      }

      keptContacts.push(contact);
    }

    member.contacts = keptContacts;
  }

  if (!removedCount) {
    console.log(
      `Loaded ${reports.length} reports, but none matched current links in ${directoryPath}.`,
    );
    return;
  }

  directory.lastPrunedBrokenContactsAt = new Date().toISOString();
  await writeJson(directoryPath, directory);
  await fs.appendFile(processedReportLogPath, rawReportLog.endsWith("\n") ? rawReportLog : `${rawReportLog}\n`, "utf8");
  await writeTextFile(reportLogPath, "");

  const removedByMember = removedEntries.reduce((accumulator, entry) => {
    const key = `${entry.slug}::${entry.name}`;

    if (!accumulator[key]) {
      accumulator[key] = {
        slug: entry.slug,
        name: entry.name,
        removed: 0,
      };
    }

    accumulator[key].removed += 1;
    return accumulator;
  }, {});

  console.log(
    JSON.stringify(
      {
        processedReports: reports.length,
        removedLinks: removedCount,
        affectedMembers: Object.keys(removedByMember).length,
        removedByMember: Object.values(removedByMember).sort((left, right) => right.removed - left.removed),
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
