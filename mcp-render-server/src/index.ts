import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH
  ? path.resolve(process.env.OBSIDIAN_VAULT_PATH)
  : path.resolve(process.cwd(), "..");

const API_KEY = process.env.MCP_API_KEY;

async function scanDirectory(directory: string, onFile: (fullPath: string) => Promise<void> | void) {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".obsidian" || entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await scanDirectory(fullPath, onFile);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      await onFile(fullPath);
    }
  }
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: "obsidian-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "get_server_status",
    {
      description: "Check whether the Obsidian MCP server is running",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: "Obsidian MCP server is online!" }],
    })
  );

  server.registerTool(
    "list_notes",
    {
      description: "List Markdown notes in the Obsidian vault",
      inputSchema: {},
    },
    async () => {
      const notes: string[] = [];

      await scanDirectory(VAULT_PATH, (fullPath) => {
        notes.push(path.relative(VAULT_PATH, fullPath));
      });

      notes.sort();

      return {
        content: [
          {
            type: "text",
            text: notes.length > 0 ? notes.join("\n") : "No Markdown notes found in the vault.",
          },
        ],
      };
    }
  );

  server.registerTool(
    "read_note",
    {
      description: "Read the contents of a Markdown note in the Obsidian vault",
      inputSchema: {
        notePath: z.string().describe("Relative path of the note inside the vault"),
      },
    },
    async ({ notePath }) => {
      const vaultRoot = path.resolve(VAULT_PATH);
      const fullPath = path.resolve(vaultRoot, notePath);

      if (fullPath !== vaultRoot && !fullPath.startsWith(vaultRoot + path.sep)) {
        return {
          content: [{ type: "text", text: "Error: Access outside the Obsidian vault is not allowed." }],
          isError: true,
        };
      }

      if (!fullPath.toLowerCase().endsWith(".md")) {
        return {
          content: [{ type: "text", text: "Error: Only Markdown (.md) notes can be read." }],
          isError: true,
        };
      }

      try {
        const content = await fs.readFile(fullPath, "utf8");
        return { content: [{ type: "text", text: content }] };
      } catch {
        return {
          content: [{ type: "text", text: `Error: Note not found: ${notePath}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "search_notes",
    {
      description: "Search for text inside Markdown notes in the Obsidian vault",
      inputSchema: {
        query: z.string().min(1).describe("Text or phrase to search for inside the notes"),
      },
    },
    async ({ query }) => {
      const results: string[] = [];
      const searchQuery = query.toLowerCase();

      await scanDirectory(VAULT_PATH, async (fullPath) => {
        try {
          const content = await fs.readFile(fullPath, "utf8");
          if (content.toLowerCase().includes(searchQuery)) {
            results.push(path.relative(VAULT_PATH, fullPath));
          }
        } catch {
          // Ignore files that cannot be read
        }
      });

      results.sort();

      return {
        content: [
          {
            type: "text",
            text: results.length > 0 ? results.join("\n") : `No notes found containing: ${query}`,
          },
        ],
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  if (API_KEY) {
    const auth = req.header("authorization");
    if (auth !== `Bearer ${API_KEY}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({ error: "Method not allowed. Use POST for MCP requests." });
});

app.get("/", (_req, res) => {
  res.status(200).send("Obsidian MCP server is running!");
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Obsidian MCP server running on port ${PORT}, serving vault at ${VAULT_PATH}`);
  if (!API_KEY) {
    console.warn("Warning: MCP_API_KEY is not set. The /mcp endpoint is unauthenticated.");
  }
});
