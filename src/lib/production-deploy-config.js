const PRODUCTION_CODE_SYNC_TARGETS = [
  {
    key: "dockerignore",
    label: "Docker ignore rules",
    kind: "file",
    relativePath: [".dockerignore"],
  },
  {
    key: "caddyfile",
    label: "Caddy reverse-proxy config",
    kind: "file",
    relativePath: ["Caddyfile"],
  },
  {
    key: "dockerfile",
    label: "Dockerfile",
    kind: "file",
    relativePath: ["Dockerfile"],
  },
  {
    key: "dockerCompose",
    label: "Docker Compose config",
    kind: "file",
    relativePath: ["docker-compose.yml"],
  },
  {
    key: "dockerComposeProd",
    label: "Production Docker Compose config",
    kind: "file",
    relativePath: ["docker-compose.prod.yml"],
  },
  {
    key: "packageJson",
    label: "package.json",
    kind: "file",
    relativePath: ["package.json"],
  },
  {
    key: "packageLock",
    label: "package-lock.json",
    kind: "file",
    relativePath: ["package-lock.json"],
  },
  {
    key: "publicDir",
    label: "Public site assets",
    kind: "directory",
    relativePath: ["public"],
  },
  {
    key: "srcDir",
    label: "Application source",
    kind: "directory",
    relativePath: ["src"],
  },
];

const PRODUCTION_ESSENTIAL_DATA_SYNC_TARGETS = [
  {
    key: "plenumCatalog",
    label: "Plenum protocol catalog",
    kind: "file",
    relativePath: ["data", "protocols.json"],
  },
  {
    key: "committeeCatalog",
    label: "Committee protocol catalog",
    kind: "file",
    relativePath: ["data", "committee-protocols.json"],
  },
  {
    key: "lawsCatalog",
    label: "Laws catalog",
    kind: "file",
    relativePath: ["data", "laws.json"],
  },
  {
    key: "lawVotes",
    label: "Law vote cache",
    kind: "file",
    relativePath: ["data", "law-votes.json"],
  },
  {
    key: "lawRaw",
    label: "Law raw files",
    kind: "directory",
    relativePath: ["data", "law-raw"],
  },
  {
    key: "lawParsed",
    label: "Law parsed files",
    kind: "directory",
    relativePath: ["data", "law-parsed"],
  },
  {
    key: "memberProtocolIndex",
    label: "Member protocol index",
    kind: "file",
    relativePath: ["data", "member-protocol-index.json"],
  },
  {
    key: "memberUtterances",
    label: "Member utterance files",
    kind: "directory",
    relativePath: ["data", "member-utterances"],
  },
  {
    key: "memberAnalyses",
    label: "Member analyses",
    kind: "directory",
    relativePath: ["data", "member-analyses"],
  },
  {
    key: "memberComparisons",
    label: "Member comparisons",
    kind: "file",
    relativePath: ["data", "member-comparisons.json"],
  },
  {
    key: "memberContacts",
    label: "Member contact directory",
    kind: "file",
    relativePath: ["data", "member-contact-directory.json"],
  },
  {
    key: "memberContactReports",
    label: "Member contact reports",
    kind: "file",
    relativePath: ["data", "member-contact-link-reports.jsonl"],
  },
  {
    key: "memberContactProcessedReports",
    label: "Processed member contact reports",
    kind: "file",
    relativePath: ["data", "member-contact-link-reports.processed.jsonl"],
  },
  {
    key: "memberContactValidationReport",
    label: "Member contact validation report",
    kind: "file",
    relativePath: ["data", "member-contact-validation-report.json"],
  },
  {
    key: "lawAnalyses",
    label: "Law analyses",
    kind: "directory",
    relativePath: ["data", "law-analyses"],
  },
  {
    key: "lawSurpriseExplanations",
    label: "Surprising vote explanations",
    kind: "directory",
    relativePath: ["data", "law-surprise-explanations"],
  },
  {
    key: "factChecks",
    label: "Protocol fact-check records",
    kind: "directory",
    relativePath: ["data", "fact-checks"],
  },
  {
    key: "methodologySnapshot",
    label: "Methodology snapshot",
    kind: "file",
    relativePath: ["data", "methodology-documentation.json"],
  },
];

const PRODUCTION_LARGE_CACHE_SYNC_TARGETS = [
  {
    key: "downloads",
    label: "Bulk-downloaded source documents",
    kind: "directory",
    relativePath: ["data", "downloads"],
  },
  {
    key: "plenumRaw",
    label: "Plenum raw files",
    kind: "directory",
    relativePath: ["data", "raw"],
  },
  {
    key: "plenumParsed",
    label: "Plenum parsed files",
    kind: "directory",
    relativePath: ["data", "parsed"],
  },
  {
    key: "committeeRaw",
    label: "Committee raw files",
    kind: "directory",
    relativePath: ["data", "committee-raw"],
  },
  {
    key: "committeeParsed",
    label: "Committee parsed files",
    kind: "directory",
    relativePath: ["data", "committee-parsed"],
  },
];

const PRODUCTION_DATA_SYNC_TARGETS = [
  ...PRODUCTION_ESSENTIAL_DATA_SYNC_TARGETS,
  ...PRODUCTION_LARGE_CACHE_SYNC_TARGETS,
];

const PRODUCTION_DATA_EXCLUDE_NOTES = [
  "Authentication secrets and account credentials are now configured through the server-side .env file only",
  "Large plenum and committee raw/parsed caches are skipped unless a full data sync is requested",
  "Browser profiles and anti-bot session folders under data/chrome-*",
  "Tunnel files, logs, pids, and temporary server runtime files",
  "Temporary admin preview files such as admin-law-update-preview.json",
  "Analysis promotion status and other local-only operational metadata",
];

module.exports = {
  PRODUCTION_CODE_SYNC_TARGETS,
  PRODUCTION_ESSENTIAL_DATA_SYNC_TARGETS,
  PRODUCTION_LARGE_CACHE_SYNC_TARGETS,
  PRODUCTION_DATA_SYNC_TARGETS,
  PRODUCTION_DATA_EXCLUDE_NOTES,
};
