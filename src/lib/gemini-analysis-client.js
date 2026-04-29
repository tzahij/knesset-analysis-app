class GeminiAnalysisClient {
  constructor(options = {}) {
    this.provider = "gemini";
    this.apiKey =
      options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    this.baseUrl = (
      options.baseUrl ||
      process.env.GEMINI_BASE_URL ||
      "https://generativelanguage.googleapis.com/v1beta/models"
    ).replace(/\/+$/u, "");
    this.model = options.model || process.env.GEMINI_ANALYSIS_MODEL || "gemini-3-flash-preview";
    this.requestTimeoutMs =
      Number(options.requestTimeoutMs || process.env.GEMINI_REQUEST_TIMEOUT_MS) ||
      20 * 60 * 1000;
    this.responseCounter = 0;
    this.responses = new Map();
  }

  async sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  shouldRetryNetworkError(error) {
    const message = String(error?.message || error || "").toLowerCase();
    return (
      message.includes("fetch failed") ||
      message.includes("networkerror") ||
      message.includes("econnreset") ||
      message.includes("etimedout") ||
      message.includes("timeout")
    );
  }

  shouldRetryHttpStatus(status) {
    return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
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

  flattenInput(input) {
    if (typeof input === "string") {
      return input;
    }

    if (!Array.isArray(input)) {
      return JSON.stringify(input, null, 2);
    }

    return input
      .map((message) => {
        const role = String(message?.role || "user").toUpperCase();
        const parts = Array.isArray(message?.content)
          ? message.content
              .map((part) => {
                if (typeof part === "string") {
                  return part;
                }

                if (typeof part?.text === "string") {
                  return part.text;
                }

                return JSON.stringify(part, null, 2);
              })
              .join("\n\n")
          : typeof message?.content === "string"
            ? message.content
            : JSON.stringify(message?.content || "", null, 2);

        return `### ${role}\n${parts}`;
      })
      .join("\n\n");
  }

  buildPrompt(options) {
    return [
      "הנחיות:",
      options.instructions || "",
      "",
      "חומר לניתוח:",
      this.flattenInput(options.input),
    ].join("\n");
  }

  async createStructuredResponse(options) {
    const payload = await this.request(
      `/${encodeURIComponent(this.model)}:generateContent`,
      {
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
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: options.schema,
          },
        },
      },
    );

    const id = `gemini-local-${++this.responseCounter}`;
    this.responses.set(id, payload);
    return {
      id,
      status: "completed",
    };
  }

  async waitForResponse(responseId) {
    if (!this.responses.has(responseId)) {
      throw new Error(`Gemini response ${responseId} was not found`);
    }

    return this.responses.get(responseId);
  }

  extractStructuredOutput(response) {
    const text = this.extractTextOutput(response).trim();

    if (!text) {
      throw new Error("Gemini response did not contain text output");
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`Failed to parse Gemini JSON output: ${error.message}`);
    }
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

  extractErrorMessage(response) {
    return (
      response?.error?.message ||
      response?.promptFeedback?.blockReason ||
      response?.candidates?.[0]?.finishReason ||
      ""
    );
  }

  async request(path, options) {
    if (!this.isConfigured()) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    const maxAttempts = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
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
          const error = new Error(
            payload?.error?.message || `Gemini request failed with status ${response.status}`,
          );

          if (attempt < maxAttempts && this.shouldRetryHttpStatus(response.status)) {
            await this.sleep(1500 * attempt);
            continue;
          }

          throw error;
        }

        if (!this.extractTextOutput(payload)) {
          throw new Error(
            this.extractErrorMessage(payload) || "Gemini returned no structured output text",
          );
        }

        return payload;
      } catch (error) {
        lastError = error;

        if (attempt < maxAttempts && this.shouldRetryNetworkError(error)) {
          await this.sleep(1500 * attempt);
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error("Gemini request failed");
  }
}

module.exports = {
  GeminiAnalysisClient,
};
