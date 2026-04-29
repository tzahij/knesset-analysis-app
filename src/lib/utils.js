const fs = require("fs/promises");
const path = require("path");

const DATE_TIME_ZONE = "Asia/Jerusalem";

const shortDateFormatter = new Intl.DateTimeFormat("he-IL", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: DATE_TIME_ZONE,
});

const longDateFormatter = new Intl.DateTimeFormat("he-IL", {
  dateStyle: "full",
  timeZone: DATE_TIME_ZONE,
});

const timeFormatter = new Intl.DateTimeFormat("he-IL", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: DATE_TIME_ZONE,
});

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await ensureDirectory(path.dirname(filePath));
  const tempFilePath = `${filePath}.tmp`;
  await fs.writeFile(tempFilePath, JSON.stringify(data, null, 2), "utf8");

  try {
    await fs.rename(tempFilePath, filePath);
  } catch (error) {
    if (error && (error.code === "EEXIST" || error.code === "EPERM")) {
      await fs.rm(filePath, { force: true });
      await fs.rename(tempFilePath, filePath);
      return;
    }

    throw error;
  }
}

async function writeTextFile(filePath, text) {
  await ensureDirectory(path.dirname(filePath));
  const tempFilePath = `${filePath}.tmp`;
  await fs.writeFile(tempFilePath, String(text), "utf8");

  try {
    await fs.rename(tempFilePath, filePath);
  } catch (error) {
    if (error && (error.code === "EEXIST" || error.code === "EPERM")) {
      await fs.rm(filePath, { force: true });
      await fs.rename(tempFilePath, filePath);
      return;
    }

    throw error;
  }
}

function extractRelativeDataPath(storedPath) {
  const rawValue = String(storedPath || "").trim();

  if (!rawValue) {
    return null;
  }

  const normalized = rawValue.replace(/\\/g, "/");
  const lowerNormalized = normalized.toLowerCase();
  const dataMarker = "/data/";
  const markerIndex = lowerNormalized.lastIndexOf(dataMarker);

  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + dataMarker.length);
  }

  if (lowerNormalized.startsWith("data/")) {
    return normalized.slice("data/".length);
  }

  return null;
}

async function resolveStoredDataPath(dataDir, storedPath) {
  const rawValue = String(storedPath || "").trim();

  if (!rawValue) {
    return null;
  }

  if (await fileExists(rawValue)) {
    return rawValue;
  }

  const relativeDataPath = extractRelativeDataPath(rawValue);

  if (!relativeDataPath) {
    return null;
  }

  const candidatePath = path.join(
    dataDir,
    ...relativeDataPath.split("/").filter(Boolean),
  );

  if (await fileExists(candidatePath)) {
    return candidatePath;
  }

  return null;
}

function sanitizeFilename(value) {
  return String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "_");
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDateParts(isoValue) {
  if (!isoValue) {
    return {
      year: null,
      dateKey: "unknown-date",
      timeKey: null,
      shortDateLabel: "תאריך לא זמין",
      longDateLabel: "תאריך לא זמין",
      timeLabel: "",
    };
  }

  const date = new Date(isoValue);

  if (Number.isNaN(date.getTime())) {
    return {
      year: null,
      dateKey: "unknown-date",
      timeKey: null,
      shortDateLabel: "תאריך לא זמין",
      longDateLabel: "תאריך לא זמין",
      timeLabel: "",
    };
  }

  const localDateValue = date.toLocaleString("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: DATE_TIME_ZONE,
  });
  const timeLabel = timeFormatter.format(date);

  return {
    year: Number(
      date.toLocaleString("en-CA", {
        year: "numeric",
        timeZone: DATE_TIME_ZONE,
      }),
    ),
    dateKey: localDateValue,
    timeKey: timeLabel ? timeLabel.replace(":", "-") : null,
    shortDateLabel: shortDateFormatter.format(date),
    longDateLabel: longDateFormatter.format(date),
    timeLabel,
  };
}

function toErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results;
}

module.exports = {
  ensureDirectory,
  fileExists,
  formatDateParts,
  mapWithConcurrency,
  normalizeSearchText,
  readJson,
  resolveStoredDataPath,
  sanitizeFilename,
  toErrorMessage,
  writeTextFile,
  writeJson,
};
