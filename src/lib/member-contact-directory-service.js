const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const { ensureDirectory, fileExists, readJson } = require("./utils");

const DEFAULT_MEMBER_CONTACT_DISCLAIMER =
  "פרטי הקשר והקישורים כאן נאספו ממקורות פומביים ברשת, כולל אתר הכנסת, ולכן ייתכן שחלקם התיישנו או אינם פעילים עוד.";

const DIRECT_CONTACT_PLATFORMS = new Set(["email", "phone", "whatsapp"]);
const CONTACT_PLATFORM_PRIORITIES = new Map([
  ["phone", 1],
  ["whatsapp", 2],
  ["email", 3],
  ["facebook", 10],
  ["instagram", 11],
  ["threads", 12],
  ["x", 13],
  ["linkedin", 14],
  ["tiktok", 15],
  ["youtube", 16],
  ["website", 17],
]);

function getContactGroupPriority(platform) {
  return DIRECT_CONTACT_PLATFORMS.has(String(platform || "").trim().toLowerCase()) ? 0 : 1;
}

function getContactPlatformPriority(platform) {
  return CONTACT_PLATFORM_PRIORITIES.get(String(platform || "").trim().toLowerCase()) || 99;
}

function sortContactsForPresentation(contacts) {
  return [...contacts].sort((left, right) => {
    const leftGroupPriority = getContactGroupPriority(left?.platform);
    const rightGroupPriority = getContactGroupPriority(right?.platform);

    if (leftGroupPriority !== rightGroupPriority) {
      return leftGroupPriority - rightGroupPriority;
    }

    const platformComparison =
      getContactPlatformPriority(left?.platform) - getContactPlatformPriority(right?.platform);

    if (platformComparison !== 0) {
      return platformComparison;
    }

    const leftValue = String(left?.value || left?.label || left?.href || "");
    const rightValue = String(right?.value || right?.label || right?.href || "");
    return leftValue.localeCompare(rightValue, "he");
  });
}

function buildRouteSlug(member) {
  return String(member?.id || member?.routeSlug || member?.slug || "").trim();
}

class MemberContactDirectoryService {
  constructor({ rootDir }) {
    this.dataDir = path.join(rootDir, "data");
    this.directoryPath = path.join(this.dataDir, "member-contact-directory.json");
    this.reportLogPath = path.join(this.dataDir, "member-contact-link-reports.jsonl");
  }

  async loadDirectory() {
    if (!(await fileExists(this.directoryPath))) {
      return {
        builtAt: null,
        sourceUrls: [],
        members: {},
      };
    }

    return readJson(this.directoryPath);
  }

  async getMemberContactDetails(slug) {
    const directory = await this.loadDirectory();
    const entry = directory?.members?.[slug] || null;
    const contacts = Array.isArray(entry?.contacts)
      ? sortContactsForPresentation(entry.contacts.map((contact) => ({ ...contact })))
      : [];

    return {
      slug,
      builtAt: directory?.builtAt || null,
      disclaimer: directory?.disclaimer || DEFAULT_MEMBER_CONTACT_DISCLAIMER,
      sourceUrls: Array.isArray(directory?.sourceUrls) ? [...directory.sourceUrls] : [],
      lookupStatus: String(entry?.lookupStatus || "not_found"),
      hasContacts: contacts.length > 0,
      name: entry?.name || null,
      partyName: entry?.partyName || null,
      contacts,
    };
  }

  async getDirectoryOverview({ parties = [] } = {}) {
    const directory = await this.loadDirectory();
    const entryMap = directory?.members || {};
    const platformContactCounts = new Map();
    const platformMemberCounts = new Map();
    let membersWithContacts = 0;
    let membersWithDirectContact = 0;
    let membersWithSocialContact = 0;
    let totalContacts = 0;

    const groupedParties = parties.map((party) => {
      const members = Array.isArray(party?.members)
        ? party.members.map((member) => {
            const routeSlug = buildRouteSlug(member);
            const entry = entryMap[routeSlug] || entryMap[member?.slug] || null;
            const contacts = Array.isArray(entry?.contacts)
              ? sortContactsForPresentation(entry.contacts.map((contact) => ({ ...contact })))
              : [];
            const availablePlatforms = Array.from(
              new Set(
                contacts
                  .map((contact) => String(contact?.platform || "").trim().toLowerCase())
                  .filter(Boolean),
              ),
            ).sort((left, right) => getContactPlatformPriority(left) - getContactPlatformPriority(right));
            const hasDirectContact = availablePlatforms.some((platform) =>
              DIRECT_CONTACT_PLATFORMS.has(platform),
            );
            const hasSocialContact = availablePlatforms.some(
              (platform) => !DIRECT_CONTACT_PLATFORMS.has(platform),
            );

            totalContacts += contacts.length;

            if (contacts.length) {
              membersWithContacts += 1;
            }

            if (hasDirectContact) {
              membersWithDirectContact += 1;
            }

            if (hasSocialContact) {
              membersWithSocialContact += 1;
            }

            for (const platform of availablePlatforms) {
              platformMemberCounts.set(platform, (platformMemberCounts.get(platform) || 0) + 1);
            }

            for (const contact of contacts) {
              const platform = String(contact?.platform || "").trim().toLowerCase();

              if (!platform) {
                continue;
              }

              platformContactCounts.set(platform, (platformContactCounts.get(platform) || 0) + 1);
            }

            return {
              slug: routeSlug,
              routeSlug,
              canonicalSlug: String(member?.slug || "").trim(),
              href: routeSlug ? `/members/${encodeURIComponent(routeSlug)}` : "",
              name: member?.name || entry?.name || "",
              partyName: member?.partyName || party?.name || entry?.partyName || "",
              partySlug: member?.partySlug || party?.slug || "",
              contactCount: contacts.length,
              availablePlatforms,
              hasDirectContact,
              hasSocialContact,
              contacts,
            };
          })
        : [];

      return {
        name: party?.name || "",
        slug: party?.slug || "",
        memberCount: members.length,
        contactMemberCount: members.filter((member) => member.contactCount > 0).length,
        members,
      };
    });

    const members = groupedParties.flatMap((party) => party.members);
    const availablePlatforms = Array.from(platformContactCounts.keys()).sort(
      (left, right) => getContactPlatformPriority(left) - getContactPlatformPriority(right),
    );

    return {
      builtAt: directory?.builtAt || null,
      disclaimer: directory?.disclaimer || DEFAULT_MEMBER_CONTACT_DISCLAIMER,
      sourceUrls: Array.isArray(directory?.sourceUrls) ? [...directory.sourceUrls] : [],
      summary: {
        totalMembers: members.length,
        totalParties: groupedParties.length,
        membersWithContacts,
        membersWithDirectContact,
        membersWithSocialContact,
        totalContacts,
        availablePlatformCount: availablePlatforms.length,
        platformContactCounts: Object.fromEntries(
          availablePlatforms.map((platform) => [platform, platformContactCounts.get(platform) || 0]),
        ),
        platformMemberCounts: Object.fromEntries(
          availablePlatforms.map((platform) => [platform, platformMemberCounts.get(platform) || 0]),
        ),
      },
      availablePlatforms,
      parties: groupedParties,
      members,
    };
  }

  async recordBrokenLinkReport(slug, details = {}) {
    const record = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      slug,
      contactId: String(details.contactId || "").trim(),
      href: String(details.href || "").trim(),
      label: String(details.label || "").trim(),
      platform: String(details.platform || "").trim(),
    };

    await ensureDirectory(path.dirname(this.reportLogPath));
    await fs.appendFile(this.reportLogPath, `${JSON.stringify(record)}\n`, "utf8");

    return record;
  }
}

module.exports = {
  DEFAULT_MEMBER_CONTACT_DISCLAIMER,
  MemberContactDirectoryService,
};
