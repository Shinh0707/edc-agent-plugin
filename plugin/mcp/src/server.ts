import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  EdcClient,
  API_ERROR_CODES,
  CLIENT_ERROR_CODES,
} from "@entertainment-design-catalog/design-tags";
// 信頼の起点(宛先)はコードの定数。ツールの引数・環境変数では変えない(docs/edc-account/design.md 2 節)
import { EDC } from "../edc-auth.mjs";
import { callWithRetry, describeError } from "./apiCall";

/** launcher.mjs が置く、EDC アカウントのトークンの取り出し口 */
type EdcAuth = { getAccessToken(options?: { force?: boolean }): Promise<string> };

function edcAuth(): EdcAuth {
  const auth = (globalThis as { __edcAuth?: EdcAuth }).__edcAuth;
  if (!auth) throw new Error("Start the server with: node mcp/launcher.mjs");
  return auth;
}

/**
 * EDC Web API を呼ぶ。トークンは EDC.apiBase にだけ送る(EdcClient はリダイレクトを追わない)。
 * 401・500 internal のやり直しは callWithRetry
 */
async function callEdc<T>(run: (client: EdcClient) => Promise<T>): Promise<T> {
  const auth = edcAuth();
  const client = new EdcClient({ baseUrl: EDC.apiBase, credential: () => auth.getAccessToken() });
  return callWithRetry(() => run(client), { refresh: () => auth.getAccessToken({ force: true }) });
}

function formatError(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: describeError(error) }],
  };
}

const server = new McpServer({
  name: "entertainment-design-catalog",
  version: "2.0.0",
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
  },
  async ({ text, store }) => {
    try {
      // やり直しでも同じ冪等キー(二重に数えない)
      const idempotencyKey = randomUUID();
      const result = await callEdc((client) => client.analyses.create({ text, store: store as any }, { idempotencyKey }));

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
  },
  async ({ id }) => {
    try {
      const result = await callEdc((client) => client.analyses.get(id));

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
  },
  async ({ id }) => {
    try {
      await callEdc((client) => client.analyses.delete(id));

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
