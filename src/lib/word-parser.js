const fs = require("fs/promises");
const path = require("path");
const { pathToFileURL } = require("url");
const mammoth = require("mammoth");
const WordExtractor = require("word-extractor");

const binaryDocSignature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const extractor = new WordExtractor();
let pdfJsPromise = null;

function sniffWordFormat(buffer) {
  if (buffer.subarray(0, 2).toString("ascii") === "PK") {
    return {
      format: "docx",
      extension: ".docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  if (buffer.subarray(0, binaryDocSignature.length).equals(binaryDocSignature)) {
    return {
      format: "doc",
      extension: ".doc",
      contentType: "application/msword",
    };
  }

  return {
    format: "doc",
    extension: ".doc",
    contentType: "application/msword",
  };
}

function cleanProtocolText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\u0007/g, " ")
    .replace(/\u000b/g, "\n")
    .replace(/\f/g, "\n")
    .replace(/\t+/g, " ")
    .replace(/PAGEREF\s+_Toc\d+\s+\\h/gi, " ")
    .replace(/[\u0000-\u0008\u000e-\u001f]/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitIntoParagraphs(text) {
  return cleanProtocolText(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function countHebrewCharacters(text) {
  const matches = String(text || "").match(/[\u0590-\u05FF]/g);
  return matches ? matches.length : 0;
}

function countLatinOrDigitCharacters(text) {
  const matches = String(text || "").match(/[A-Za-z0-9]/g);
  return matches ? matches.length : 0;
}

function isMostlyRtl(items) {
  let rtlWeight = 0;
  let ltrWeight = 0;

  for (const item of items) {
    const text = String(item.str || "");
    rtlWeight += countHebrewCharacters(text);
    ltrWeight += countLatinOrDigitCharacters(text);

    if (item.dir === "rtl") {
      rtlWeight += Math.max(1, text.trim().length);
    } else if (item.dir === "ltr") {
      ltrWeight += Math.max(1, text.trim().length);
    }
  }

  return rtlWeight >= ltrWeight;
}

function normalizeJoinedPdfLine(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?)\]}])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([־–—-])/g, " $1")
    .replace(/([־–—-])\s+/g, "$1 ")
    .trim();
}

function shouldSkipPdfLine(line) {
  const normalized = String(line || "").trim();

  if (!normalized) {
    return true;
  }

  if (/^-- \d+ of \d+ --$/i.test(normalized)) {
    return true;
  }

  if (
    normalized.includes("ספר החוקים") &&
    /\d{4}/.test(normalized) &&
    normalized.length <= 80
  ) {
    return true;
  }

  if (/^(רשומות|עמוד)$/u.test(normalized)) {
    return true;
  }

  return false;
}

function buildPdfLine(items) {
  const pieces = items
    .map((item, index) => ({
      index,
      x: Number(item.transform?.[4] || 0),
      dir: item.dir || "ltr",
      str: String(item.str || "").trim(),
    }))
    .filter((item) => item.str);

  if (!pieces.length) {
    return "";
  }

  const orderedPieces = isMostlyRtl(pieces)
    ? [...pieces].sort((left, right) => {
        if (Math.abs(right.x - left.x) > 0.5) {
          return right.x - left.x;
        }

        return left.index - right.index;
      })
    : pieces;

  return normalizeJoinedPdfLine(orderedPieces.map((item) => item.str).join(" "));
}

function shouldBreakPdfLine(previousItem, nextItem) {
  if (!previousItem || !nextItem) {
    return false;
  }

  const previousY = Number(previousItem.transform?.[5] || 0);
  const nextY = Number(nextItem.transform?.[5] || 0);
  const deltaY = Math.abs(nextY - previousY);
  const threshold = Math.max(
    2,
    Number(previousItem.height || 0) * 0.45,
    Number(nextItem.height || 0) * 0.45,
  );

  return deltaY > threshold;
}

async function loadPdfJs() {
  if (!pdfJsPromise) {
    const modulePath = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href;
    pdfJsPromise = import(modulePath);
  }

  return pdfJsPromise;
}

async function extractWordText(filePath, format) {
  if (format === "docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return cleanProtocolText(result.value);
  }

  const document = await extractor.extract(filePath);
  return cleanProtocolText(document.getBody());
}

async function extractPdfText(filePath) {
  const pdfJs = await loadPdfJs();
  const buffer = await fs.readFile(filePath);
  const loadingTask = pdfJs.getDocument({ data: new Uint8Array(buffer) });
  const document = await loadingTask.promise;

  try {
    const pageBlocks = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);

      try {
        const content = await page.getTextContent({
          disableNormalization: false,
          includeMarkedContent: false,
        });
        const lines = [];
        let currentLine = [];
        let previousItem = null;

        const flushLine = () => {
          if (!currentLine.length) {
            return;
          }

          const line = buildPdfLine(currentLine);

          if (line && !shouldSkipPdfLine(line)) {
            lines.push(line);
          }

          currentLine = [];
        };

        for (const item of content.items) {
          if (!("str" in item)) {
            continue;
          }

          if (shouldBreakPdfLine(previousItem, item)) {
            flushLine();
          }

          if (String(item.str || "").trim()) {
            currentLine.push(item);
          }

          if (item.hasEOL) {
            flushLine();
          }

          previousItem = item;
        }

        flushLine();

        if (lines.length) {
          pageBlocks.push(lines.join("\n\n"));
        }
      } finally {
        page.cleanup();
      }
    }

    return cleanProtocolText(pageBlocks.join("\n\n"));
  } finally {
    await document.destroy();
  }
}

module.exports = {
  extractPdfText,
  extractWordText,
  sniffWordFormat,
  splitIntoParagraphs,
};
