const fs = require("fs");
const path = require("path");

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvFile(content) {
  const entries = new Map();

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());

    if (key) {
      entries.set(key, value);
    }
  }

  return entries;
}

function loadLocalEnv(rootDir) {
  for (const envPath of [path.join(rootDir, ".env.local"), path.join(rootDir, ".env")]) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const entries = parseEnvFile(fs.readFileSync(envPath, "utf8"));

    for (const [key, value] of entries.entries()) {
      if (typeof process.env[key] === "undefined" || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  }
}

module.exports = {
  loadLocalEnv,
};
