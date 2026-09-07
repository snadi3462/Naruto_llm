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
const BYPASS_ACCESS_TIERS = process.env.BYPASS_ACCESS_TIERS === "true";

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

// Access tiers: a wiki/entities/*.md page with `access_tier: restricted` in its
// frontmatter gates that character's data. The wiki frontmatter is the single source of
// truth; this also covers the matching wiki/sources/ and raw/ files by character name,
// since those can't carry the same frontmatter (raw/ is immutable).
async function getRestrictedCharacterNames(): Promise<Set<string>> {
  const restricted = new Set<string>();
  if (BYPASS_ACCESS_TIERS) return restricted;

  const entitiesDir = path.join(VAULT_PATH, "wiki", "entities");

  let entries: string[];
  try {
    entries = await fs.readdir(entitiesDir);
  } catch {
    return restricted;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;

    try {
      const raw = await fs.readFile(path.join(entitiesDir, entry), "utf8");
      const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (frontmatter && /^access_tier:\s*restricted\s*$/m.test(frontmatter[1])) {
        restricted.add(entry.slice(0, -3));
      }
    } catch {
      // Ignore files that cannot be read
    }
  }

  return restricted;
}

function characterKeyForPath(relPath: string): string | null {
  const normalized = relPath.split(path.sep).join("/");
  const base = path.basename(normalized, ".md");

  if (normalized.startsWith("wiki/entities/")) return base;
  if (normalized.startsWith("wiki/sources/")) return base.replace(/ \(source\)$/, "");
  if (normalized.startsWith("raw/")) return base;
  return null;
}

function isUnlocked(characterName: string): boolean {
  const unlocked = process.env.UNLOCKED_CHARACTERS;
  if (!unlocked) return false;

  const list = unlocked.split(",").map((s) => s.trim().toLowerCase());
  return list.includes("all") || list.includes(characterName.toLowerCase());
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
      const restrictedNames = await getRestrictedCharacterNames();
      const notes: string[] = [];

      await scanDirectory(VAULT_PATH, (fullPath) => {
        notes.push(path.relative(VAULT_PATH, fullPath));
      });

      notes.sort();

      const lines = notes.map((notePath) => {
        const key = characterKeyForPath(notePath);
        const locked = key !== null && restrictedNames.has(key) && !isUnlocked(key);
        return locked ? `${notePath} [restricted]` : notePath;
      });

      return {
        content: [
          {
            type: "text",
            text: lines.length > 0 ? lines.join("\n") : "No Markdown notes found in the vault.",
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

      const key = characterKeyForPath(path.relative(vaultRoot, fullPath));
      if (key !== null) {
        const restrictedNames = await getRestrictedCharacterNames();
        if (restrictedNames.has(key) && !isUnlocked(key)) {
          return {
            content: [
              {
                type: "text",
                text: `Access restricted: "${key}" is behind an access tier and hasn't been unlocked. Ask the vault owner to add "${key}" (or "ALL") to the UNLOCKED_CHARACTERS environment variable on Render to grant access.`,
              },
            ],
            isError: true,
          };
        }
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
      const restrictedNames = await getRestrictedCharacterNames();
      const results: string[] = [];
      const searchQuery = query.toLowerCase();

      await scanDirectory(VAULT_PATH, async (fullPath) => {
        const relPath = path.relative(VAULT_PATH, fullPath);
        const key = characterKeyForPath(relPath);
        if (key !== null && restrictedNames.has(key) && !isUnlocked(key)) {
          return; // Skip restricted, locked content entirely
        }

        try {
          const content = await fs.readFile(fullPath, "utf8");
          if (content.toLowerCase().includes(searchQuery)) {
            results.push(relPath);
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

function isAuthorized(req: express.Request): boolean {
  if (!API_KEY) return true;
  if (req.header("authorization") === `Bearer ${API_KEY}`) return true;
  if (req.query.key === API_KEY) return true;
  return false;
}

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
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

app.get("/mcp", (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Some MCP clients probe with a plain GET before ever sending a POST. This server is
  // stateless (no server-initiated SSE stream to open), so there's nothing to stream back,
  // but answering 200 here — instead of 405 — lets that reachability probe succeed instead
  // of being mistaken for an auth or server-down failure.
  res.status(200).json({ name: "obsidian-mcp", transport: "streamable-http", note: "Use POST for MCP requests." });
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
  if (BYPASS_ACCESS_TIERS) {
    console.warn("Warning: BYPASS_ACCESS_TIERS is true. Access tiers are disabled — every character is readable.");
  }
});
