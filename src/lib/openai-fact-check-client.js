class OpenAIFactCheckClient {
  constructor(options = {}) {
    this.provider = "openai";
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || "";
    this.baseUrl = (
      options.baseUrl ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com/v1"
    ).replace(/\/+$/u, "");
    this.model = options.model || process.env.OPENAI_FACT_CHECK_MODEL || "gpt-5.4-mini";
    this.requestTimeoutMs =
      Number(options.requestTimeoutMs || process.env.OPENAI_REQUEST_TIMEOUT_MS) ||
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

  extractTextOutput(payload) {
    if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
      return payload.output_text.trim();
    }

    const outputs = Array.isArray(payload?.output) ? payload.output : [];
    const parts = [];

    for (const item of outputs) {
      const content = Array.isArray(item?.content) ? item.content : [];

      for (const part of content) {
        if (typeof part?.text === "string" && part.text.trim()) {
          parts.push(part.text.trim());
        } else if (typeof part?.output_text === "string" && part.output_text.trim()) {
          parts.push(part.output_text.trim());
        }
      }
    }

    return parts.join("\n").trim();
  }

  async createStructuredResearchResponse(options) {
    if (!this.isConfigured()) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const tool = {
      type: "web_search",
      user_location: {
        type: "approximate",
        country: options.countryCode || "IL",
      },
      search_context_size: options.searchContextSize || "medium",
    };

    if (Array.isArray(options.allowedDomains) && options.allowedDomains.length) {
      tool.filters = {
        allowed_domains: options.allowedDomains,
      };
    }

    const payload = await this.request("/responses", {
      method: "POST",
      body: {
        model: options.model || this.model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: String(options.instructions || "").trim(),
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: String(options.input || "").trim(),
              },
            ],
          },
        ],
        tools: [tool],
        text: {
          format: {
            type: "json_schema",
            name: options.schemaName || "fact_check_verdict",
            schema: options.schema,
            strict: true,
          },
        },
        max_output_tokens: options.maxOutputTokens || 2800,
      },
    });

    const text = this.extractTextOutput(payload);

    if (!text) {
      throw new Error("OpenAI returned no text output");
    }

    let structured;

    try {
      structured = JSON.parse(text);
    } catch (error) {
      throw new Error(`Failed to parse OpenAI JSON output: ${error.message}`);
    }

    return {
      provider: this.provider,
      model: options.model || this.model,
      structured,
      raw: payload,
    };
  }

  async request(path, options) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        payload?.error?.message || `OpenAI request failed with status ${response.status}`,
      );
    }

    return payload;
  }
}

module.exports = {
  OpenAIFactCheckClient,
};
