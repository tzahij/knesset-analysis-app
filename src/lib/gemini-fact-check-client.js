class GeminiFactCheckClient {
  constructor(options = {}) {
    this.provider = "gemini";
    this.apiKey =
      options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    this.baseUrl = (
      options.baseUrl ||
      process.env.GEMINI_BASE_URL ||
      "https://generativelanguage.googleapis.com/v1beta/models"
    ).replace(/\/+$/u, "");
    this.model = options.model || process.env.GEMINI_FACT_CHECK_MODEL || "gemini-2.5-flash-lite";
    this.requestTimeoutMs =
      Number(options.requestTimeoutMs || process.env.GEMINI_FACT_CHECK_TIMEOUT_MS) ||
      4 * 60 * 1000;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  getConfiguration() {
    return {
      configured: this.isConfigured(),
      provider: this.provider,
      model: this.model,
      baseUrl: this.baseUrl,
    };
  }

  stringifyInput(input) {
    if (typeof input === "string") {
      return input;
    }

    return JSON.stringify(input, null, 2);
  }

  buildPrompt(options) {
    const sections = [
      "Instructions:",
      String(options.instructions || "").trim(),
      "",
      "Output requirements:",
      "Return valid JSON only.",
      "Do not wrap the JSON in markdown or code fences.",
    ];

    if (options.schema) {
      sections.push("", "JSON schema:", JSON.stringify(options.schema, null, 2));
    }

    sections.push(
      "",
      "Material:",
      this.stringifyInput(options.input),
    );

    return sections.join("\n");
  }

  extractTextOutput(response) {
    const parts = response?.candidates?.[0]?.content?.parts;

    if (!Array.isArray(parts)) {
      return "";
    }

    return parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  extractGroundingQueries(response) {
    const queries = response?.candidates?.[0]?.groundingMetadata?.webSearchQueries;

    return Array.isArray(queries)
      ? queries.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
  }

  extractGroundingSources(response) {
    const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;

    if (!Array.isArray(chunks)) {
      return [];
    }

    return chunks
      .map((chunk) => ({
        title: String(chunk?.web?.title || "").trim(),
        url: String(chunk?.web?.uri || "").trim(),
        sourceType: "google_search",
        note: "Returned via Gemini Google Search grounding.",
      }))
      .filter((source) => source.title || source.url);
  }

  dedupeSources(sources) {
    const seen = new Set();
    const deduped = [];

    for (const source of Array.isArray(sources) ? sources : []) {
      const url = String(source?.url || "").trim();
      const title = String(source?.title || "").trim();
      const key = `${url}|${title}`;

      if ((!url && !title) || seen.has(key)) {
        continue;
      }

      seen.add(key);
      deduped.push({
        title: title || url,
        url,
        sourceType: String(source?.sourceType || "web").trim() || "web",
        note: String(source?.note || "").trim(),
      });
    }

    return deduped;
  }

  dedupeQueries(queries) {
    return Array.from(
      new Set(
        (Array.isArray(queries) ? queries : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    );
  }

  extractJsonText(text) {
    const fencedMatch = String(text || "").match(/```(?:json)?\s*([\s\S]*?)```/iu);

    if (fencedMatch?.[1]) {
      return fencedMatch[1].trim();
    }

    const trimmed = String(text || "").trim();

    if (!trimmed) {
      return "";
    }

    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      return trimmed;
    }

    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");

    if (objectStart >= 0 && objectEnd > objectStart) {
      return trimmed.slice(objectStart, objectEnd + 1).trim();
    }

    const arrayStart = trimmed.indexOf("[");
    const arrayEnd = trimmed.lastIndexOf("]");

    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return trimmed.slice(arrayStart, arrayEnd + 1).trim();
    }

    return trimmed;
  }

  async createStructuredResearchResponse(options) {
    if (!this.isConfigured()) {
      throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is not configured");
    }

    const payload = await this.request(`/${encodeURIComponent(options.model || this.model)}:generateContent`, {
      method: "POST",
      body: {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: this.buildPrompt(options),
              },
            ],
          },
        ],
        tools: [
          {
            google_search: {},
          },
        ],
      },
    });

    const text = this.extractTextOutput(payload);

    if (!text) {
      throw new Error("Gemini fact-checking returned no text output");
    }

    let structured;

    try {
      structured = JSON.parse(this.extractJsonText(text));
    } catch (error) {
      throw new Error(`Failed to parse Gemini fact-check JSON output: ${error.message}`);
    }

    const searchQueries = this.dedupeQueries([
      ...(structured?.searchQueries || []),
      ...this.extractGroundingQueries(payload),
    ]);
    const sources = this.dedupeSources([
      ...(structured?.sources || []),
      ...this.extractGroundingSources(payload),
    ]);

    return {
      ...structured,
      searchQueries,
      sources,
      provider: this.provider,
      model: options.model || this.model,
      raw: payload,
    };
  }

  async request(path, options) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        payload?.error?.message || `Gemini fact-check request failed with status ${response.status}`,
      );
    }

    return payload;
  }
}

module.exports = {
  GeminiFactCheckClient,
};
