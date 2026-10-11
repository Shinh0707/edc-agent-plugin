import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GoogleAuth } from "google-auth-library";
import {
  EdcClient,
  EdcApiError,
  STORE_LEVELS,
  API_ERROR_CODES,
  CLIENT_ERROR_CODES,
} from "@entertainment-design-catalog/design-tags";

/**
 * Resolves authentication credential for EDC API using service account or API key.
 */
function createCredentialGetter(baseUrl: string, explicitSaKey?: string) {
  const saKey = explicitSaKey || process.env.EDC_SERVICE_ACCOUNT_KEY || process.env.EDC_SERVICE_ACCOUNT;
  const saJson = process.env.EDC_SERVICE_ACCOUNT_JSON;
  const gAppCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const apiKey = process.env.EDC_API_KEY;

  if (apiKey && !explicitSaKey) {
    return () => apiKey;
  }

  // Google login: the launcher supplies a function returning a fresh Google ID token (mcp/launcher.mjs)
  if (!apiKey && !saKey && !saJson && !gAppCreds && (globalThis as any).__edcCredential) {
    return (globalThis as any).__edcCredential as () => Promise<string>;
  }

  const authOptions: any = {};
  if (saKey) {
    const trimmed = saKey.trim();
    if (trimmed.startsWith("{")) {
      try {
        authOptions.credentials = JSON.parse(trimmed);
      } catch (e) {
        throw new Error(`Failed to parse Service Account JSON in EDC_SERVICE_ACCOUNT_KEY: ${e}`);
      }
    } else {
      authOptions.keyFilename = trimmed;
    }
  } else if (saJson) {
    try {
      authOptions.credentials = JSON.parse(saJson);
    } catch (e) {
      throw new Error(`Failed to parse Service Account JSON in EDC_SERVICE_ACCOUNT_JSON: ${e}`);
    }
  } else if (gAppCreds) {
    authOptions.keyFilename = gAppCreds;
  }

  const auth = new GoogleAuth(authOptions);

  return async (): Promise<string> => {
    // 1. Try ID token (preferred for Cloud Run / Identity-Aware Proxy)
    try {
      const client = await auth.getIdTokenClient(baseUrl);
      const headers = await client.getRequestHeaders();
      const authHeader = headers["Authorization"] || headers["authorization"] || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (token) return token;
    } catch (idErr) {
      // 2. Fallback to access token
      try {
        const token = await auth.getAccessToken();
        if (token) return token.trim();
      } catch (accessErr) {
        throw new Error(
          `Service account authentication failed. Ensure EDC_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS is set and valid.\nDetails: ${idErr}; access-token fallback: ${accessErr}`
        );
      }
    }
    throw new Error("Failed to produce authentication token from service account.");
  };
}

/**
 * Factory to build an EdcClient instance.
 */
function getEdcClient(options?: { baseUrl?: string; serviceAccountKey?: string }) {
  const baseUrl = options?.baseUrl || process.env.EDC_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "EDC API Base URL is missing. Set the EDC_BASE_URL environment variable or supply baseUrl parameter."
    );
  }

  const credential = createCredentialGetter(baseUrl, options?.serviceAccountKey);

  return new EdcClient({
    baseUrl,
    credential,
  });
}

function formatError(error: unknown) {
  if (error instanceof EdcApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `[EDC API Error] Code: ${error.code} (Status: ${error.status ?? "N/A"})\nMessage: ${error.message}${
            error.retryAt ? `\nRetry available at: ${error.retryAt}` : ""
          }${error.retryable ? "\nThis error is retryable." : ""}`,
        },
      ],
    };
  }
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
  };
}

const server = new McpServer({
  name: "entertainment-design-catalog",
  version: "1.0.0",
});

// Tool: edc_analyze_text
server.tool(
  "edc_analyze_text",
  "Analyze experience narratives, game scenes, or creative text to extract structured Entertainment Design Tags (EDC) using EDC Web API.",
  {
    text: z.string().describe("The experience text, scenario, or narrative to analyze."),
    store: z
      .enum(["none", "tags_without_sources", "tags", "content_and_tags"])
      .optional()
      .default("tags")
      .describe(
        "Storage level in EDC catalog: 'none' (do not store), 'tags_without_sources' (store tags without quoting original text), 'tags' (store design tags, default), 'content_and_tags' (store both full text and tags)."
      ),
    baseUrl: z
      .string()
      .optional()
      .describe("Optional override for EDC Web API Base URL (defaults to EDC_BASE_URL environment variable)."),
    serviceAccountKey: z
      .string()
      .optional()
      .describe("Optional override for Service Account key file path or JSON string."),
  },
  async ({ text, store, baseUrl, serviceAccountKey }) => {
    try {
      const client = getEdcClient({ baseUrl, serviceAccountKey });
      const result = await client.analyses.create({
        text,
        store: store as any,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return formatError(err);
    }
  }
);

// Tool: edc_get_analysis
server.tool(
  "edc_get_analysis",
  "Retrieve an existing stored analysis from the Entertainment Design Catalog (EDC) by ID.",
  {
    id: z.string().describe("The ID of the analysis to retrieve."),
    baseUrl: z
      .string()
      .optional()
      .describe("Optional override for EDC Web API Base URL."),
    serviceAccountKey: z
      .string()
      .optional()
      .describe("Optional override for Service Account key file path or JSON string."),
  },
  async ({ id, baseUrl, serviceAccountKey }) => {
    try {
      const client = getEdcClient({ baseUrl, serviceAccountKey });
      const result = await client.analyses.get(id);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return formatError(err);
    }
  }
);

// Tool: edc_delete_analysis
server.tool(
  "edc_delete_analysis",
  "Delete (withdraw) a stored analysis from the Entertainment Design Catalog (EDC) by ID.",
  {
    id: z.string().describe("The ID of the analysis to delete/withdraw."),
    baseUrl: z
      .string()
      .optional()
      .describe("Optional override for EDC Web API Base URL."),
    serviceAccountKey: z
      .string()
      .optional()
      .describe("Optional override for Service Account key file path or JSON string."),
  },
  async ({ id, baseUrl, serviceAccountKey }) => {
    try {
      const client = getEdcClient({ baseUrl, serviceAccountKey });
      await client.analyses.delete(id);

      return {
        content: [
          {
            type: "text",
            text: `Successfully deleted analysis with ID: ${id}`,
          },
        ],
      };
    } catch (err) {
      return formatError(err);
    }
  }
);

// Tool: edc_inspect_schema
server.tool(
  "edc_inspect_schema",
  "Inspect the schema, tag structure, sensory types, and error codes of the Entertainment Design Catalog (EDC).",
  {
    topic: z
      .enum(["all", "context", "effects", "store_levels", "error_codes"])
      .optional()
      .default("all")
      .describe("Topic to inspect: 'all', 'context', 'effects', 'store_levels', or 'error_codes'."),
  },
  async ({ topic }) => {
    const schemas: Record<string, any> = {
      store_levels: {
        description: "Permitted persistence levels in EDC catalog",
        levels: {
          none: "Analyze without persisting to catalog",
          tags_without_sources: "Persist design tags but strip source quotation substrings",
          tags: "Persist design tags including citations to input text (Default)",
          content_and_tags: "Persist full original text and extracted tags",
        },
      },
      context: {
        description: "Environment & Condition of the Design Tag",
        environment: {
          perception: "Sensory modality perceptions: sight, hearing, touch, taste, smell. Each contains perceive, method, sources.",
          cognition: "Cognitive interpretation of sensory inputs.",
          sources: "Exact text quotes anchoring the environment perception/cognition.",
        },
        condition: {
          emotion: "Emotional state in the context (e.g. anxiety, curiosity, tranquility).",
          motivation: "Motivational drive in the context (e.g. exploration, safety, victory).",
        },
        label: "Descriptive label identifying this context.",
      },
      effects: {
        description: "Passive & Internal Effects triggered by the context",
        passive: {
          perception: "Direct sensory feedback resulting from the experience.",
          cognition: "Direct cognitive shift or realization.",
          sources: "Quotes anchoring passive effects.",
        },
        internal_effects: {
          emotion: "Resulting emotional transition triggered by the interaction.",
          motivation: "Resulting motivational reinforcement or transformation.",
        },
        title: "Title summarizing the design effect.",
      },
      error_codes: {
        server_codes: API_ERROR_CODES,
        client_codes: CLIENT_ERROR_CODES,
      },
    };

    if (topic && topic !== "all" && schemas[topic]) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ [topic]: schemas[topic] }, null, 2),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(schemas, null, 2),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting EDC MCP server:", err);
  process.exit(1);
});
