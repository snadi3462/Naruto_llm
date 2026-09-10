import crypto from "node:crypto";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH
  ? path.resolve(process.env.OBSIDIAN_VAULT_PATH)
  : path.resolve(process.cwd(), "..");

const BYPASS_ACCESS_TIERS = process.env.BYPASS_ACCESS_TIERS === "true";

// Per-person access tokens: MCP_ACCESS_TOKENS is a comma-separated list of
// "label=token" pairs, e.g. "you=abc123,alice=def456". Every request must present
// one of these tokens (as `Authorization: Bearer <token>` or `?key=<token>`) — there
// is no "unset means open" fallback, since the whole point is that access always
// requires a token. Revoking one person means deleting their "label=token" entry from
// this env var on Render and saving (triggers a redeploy) — everyone else's tokens
// keep working.
function parseAccessTokens(): Map<string, string> {
  const tokens = new Map<string, string>();
  const raw = process.env.MCP_ACCESS_TOKENS;
  if (!raw) return tokens;

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const label = trimmed.slice(0, eq).trim();
    const token = trimmed.slice(eq + 1).trim();
    if (label && token) tokens.set(token, label);
  }

  return tokens;
}

const ACCESS_TOKENS = parseAccessTokens();

// --- OAuth 2.1 (authorization code + PKCE + dynamic client registration) ---
//
// This server is its own minimal authorization server, layered on top of the existing
// MCP_ACCESS_TOKENS list rather than replacing it: the /authorize login page asks for one
// of those same "label=token" values as the login credential, then issues a short-lived
// OAuth access token (plus a refresh token) bound to that label. The static tokens
// (Authorization: Bearer <token> / ?key=<token>) keep working unchanged for clients that
// don't do the OAuth dance (e.g. the Claude Code CLI's --header flag) — resolveAccessLabel
// below accepts either kind of token.
//
// All OAuth state (registered clients, in-flight auth codes, issued tokens) lives only in
// memory. On Render's free tier the process is killed and restarted from scratch after an
// idle spin-down, which wipes this state — any client mid-flow or holding an issued token
// at that point has to redo the browser login. That's an accepted tradeoff for staying
// dependency-free (no database); see ARCHITECTURE.md.

interface OAuthClient {
  redirectUris: string[];
}
const oauthClients = new Map<string, OAuthClient>();

interface AuthCode {
  label: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
}
const authCodes = new Map<string, AuthCode>();

interface IssuedAccessToken {
  label: string;
  expiresAt: number;
}
const issuedAccessTokens = new Map<string, IssuedAccessToken>();
const issuedRefreshTokens = new Map<string, string>(); // refresh token -> label

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function pruneExpiredAuthCodes() {
  const now = Date.now();
  for (const [code, entry] of authCodes) {
    if (entry.expiresAt < now) authCodes.delete(code);
  }
}

function issueTokenPair(label: string) {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  issuedAccessTokens.set(accessToken, { label, expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS });
  issuedRefreshTokens.set(refreshToken, label);
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
  };
}

function verifyPkce(codeChallenge: string, codeVerifier: string): boolean {
  const hash = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return hash === codeChallenge;
}

function getBaseUrl(req: express.Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function renderLoginPage(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  error: string | null;
}): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Sign in — Obsidian MCP</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; background: #111; color: #eee; display: flex;
         align-items: center; justify-content: center; height: 100vh; margin: 0; }
  form { background: #1b1b1b; padding: 2rem; border-radius: 8px; width: 320px; }
  h1 { font-size: 1.05rem; margin: 0 0 1rem; }
  input { width: 100%; padding: .5rem; margin-bottom: 1rem; box-sizing: border-box;
          border-radius: 4px; border: 1px solid #444; background: #222; color: #eee; }
  button { width: 100%; padding: .6rem; border-radius: 4px; border: none; background: #4a7dff;
           color: #fff; font-weight: 600; cursor: pointer; }
  .error { color: #ff6b6b; font-size: .85rem; margin: -.5rem 0 1rem; }
</style>
</head>
<body>
<form method="POST" action="/authorize">
  <h1>Sign in to the Obsidian MCP server</h1>
  ${opts.error ? `<div class="error">${escapeHtml(opts.error)}</div>` : ""}
  <input type="password" name="access_token" placeholder="Your access token" autofocus required>
  <input type="hidden" name="client_id" value="${escapeHtml(opts.clientId)}">
  <input type="hidden" name="redirect_uri" value="${escapeHtml(opts.redirectUri)}">
  <input type="hidden" name="state" value="${escapeHtml(opts.state)}">
  <input type="hidden" name="code_challenge" value="${escapeHtml(opts.codeChallenge)}">
  <button type="submit">Continue</button>
</form>
</body>
</html>`;
}

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

// Access tiers: a wiki/entities/*.md or wiki/concepts/*.md page with `access_tier:
// restricted` in its frontmatter gates that page. For entities, the wiki frontmatter is
// the single source of truth and also covers the matching wiki/sources/ and raw/ files by
// character name, since those can't carry the same frontmatter (raw/ is immutable).
// Concepts (e.g. a team page built entirely around restricted members) have no raw/sources
// counterpart, so gating the concept file itself is the whole gate.
async function getRestrictedCharacterNames(): Promise<Set<string>> {
  const restricted = new Set<string>();
  if (BYPASS_ACCESS_TIERS) return restricted;

  const dirs = [path.join(VAULT_PATH, "wiki", "entities"), path.join(VAULT_PATH, "wiki", "concepts")];

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;

      try {
        const raw = await fs.readFile(path.join(dir, entry), "utf8");
        const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
        const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (frontmatter && /^access_tier:\s*restricted\s*$/m.test(frontmatter[1])) {
          restricted.add(entry.slice(0, -3));
        }
      } catch {
        // Ignore files that cannot be read
      }
    }
  }

  return restricted;
}

// wiki/index.md and wiki/log.md are operational/meta pages (catalog + append-only history)
// rather than character lore, so unlike entity pages they aren't gated wholesale — their
// own conventions (index.md as the primary navigation aid, log.md as append-only) make
// blocking them outright too costly. Instead, individual lines that disclose a restricted
// character are filtered out at serve time, leaving the rest of the file intact.
const LINE_FILTERED_PATHS = new Set(["wiki/index.md", "wiki/log.md"]);

function restrictedNamePatterns(restrictedNames: Set<string>): RegExp[] {
  const patterns: RegExp[] = [];
  for (const name of restrictedNames) {
    if (isUnlocked(name)) continue;
    const words = name.split(" ");
    const tokens = new Set<string>([name, words[0], words[words.length - 1]]);
    for (const token of tokens) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      patterns.push(new RegExp(`\\b${escaped}\\b`, "i"));
    }
  }
  return patterns;
}

function redactRestrictedLines(content: string, restrictedNames: Set<string>): string {
  const patterns = restrictedNamePatterns(restrictedNames);
  if (patterns.length === 0) return content;
  return content
    .split("\n")
    .map((line) => (patterns.some((p) => p.test(line)) ? "[line omitted — references access-tier-restricted content]" : line))
    .join("\n");
}

function characterKeyForPath(relPath: string): string | null {
  const normalized = relPath.split(path.sep).join("/");
  const base = path.basename(normalized, ".md");

  if (normalized.startsWith("wiki/entities/")) return base;
  if (normalized.startsWith("wiki/concepts/")) return base;
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
        let content = await fs.readFile(fullPath, "utf8");
        const relPath = path.relative(vaultRoot, fullPath).split(path.sep).join("/");
        if (LINE_FILTERED_PATHS.has(relPath)) {
          const restrictedNames = await getRestrictedCharacterNames();
          content = redactRestrictedLines(content, restrictedNames);
        }
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
          let content = await fs.readFile(fullPath, "utf8");
          const normalizedRel = relPath.split(path.sep).join("/");
          if (LINE_FILTERED_PATHS.has(normalizedRel)) {
            content = redactRestrictedLines(content, restrictedNames);
          }
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

// Accepts either a static MCP_ACCESS_TOKENS entry or a token issued by the /token
// endpoint via the OAuth flow below — both are just bearer strings from this point on.
function resolveToken(candidate: string | undefined): string | null {
  if (!candidate) return null;

  const staticLabel = ACCESS_TOKENS.get(candidate);
  if (staticLabel) return staticLabel;

  const issued = issuedAccessTokens.get(candidate);
  if (issued) {
    if (issued.expiresAt > Date.now()) return issued.label;
    issuedAccessTokens.delete(candidate); // expired, clean up
  }

  return null;
}

function resolveAccessLabel(req: express.Request): string | null {
  const authHeader = req.header("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
  const label = resolveToken(bearer);
  if (label) return label;

  const queryToken = req.query.key;
  return resolveToken(typeof queryToken === "string" ? queryToken : undefined);
}

function sendUnauthorized(req: express.Request, res: express.Response) {
  const base = getBaseUrl(req);
  res
    .status(401)
    .set("WWW-Authenticate", `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`)
    .json({ error: "Unauthorized" });
}

const app = express();
app.set("trust proxy", true); // Render sits behind a proxy; needed for req.protocol/host to be correct
app.use(express.json());

// --- OAuth 2.1 discovery + authorization endpoints ---
// See the "OAuth 2.1" comment above ACCESS_TOKENS' declaration for the overall design.

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const base = getBaseUrl(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  });
});

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  const base = getBaseUrl(req);
  res.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
  });
});

app.post("/register", (req, res) => {
  const body = req.body ?? {};
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u: unknown): u is string => typeof u === "string")
    : [];

  if (redirectUris.length === 0) {
    res.status(400).json({ error: "invalid_client_metadata", error_description: "redirect_uris is required." });
    return;
  }

  const clientId = randomToken(16);
  oauthClients.set(clientId, { redirectUris });

  res.status(201).json({
    client_id: clientId,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
});

app.get("/authorize", (req, res) => {
  const { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.query;

  if (response_type !== "code") {
    res.status(400).send('Unsupported response_type; only "code" is supported.');
    return;
  }
  if (typeof client_id !== "string" || !oauthClients.has(client_id)) {
    res.status(400).send("Unknown client_id. Register the client via POST /register first.");
    return;
  }
  const client = oauthClients.get(client_id)!;
  if (typeof redirect_uri !== "string" || !client.redirectUris.includes(redirect_uri)) {
    res.status(400).send("redirect_uri does not match a registered redirect URI for this client.");
    return;
  }
  if (typeof code_challenge !== "string" || code_challenge_method !== "S256") {
    res.status(400).send("PKCE with code_challenge_method=S256 is required.");
    return;
  }

  res.status(200).type("html").send(
    renderLoginPage({
      clientId: client_id,
      redirectUri: redirect_uri,
      state: typeof state === "string" ? state : "",
      codeChallenge: code_challenge,
      error: null,
    })
  );
});

app.post("/authorize", express.urlencoded({ extended: false }), (req, res) => {
  const { access_token, client_id, redirect_uri, state, code_challenge } = req.body ?? {};

  if (typeof client_id !== "string" || !oauthClients.has(client_id)) {
    res.status(400).send("Unknown client_id.");
    return;
  }
  const client = oauthClients.get(client_id)!;
  if (typeof redirect_uri !== "string" || !client.redirectUris.includes(redirect_uri)) {
    res.status(400).send("Invalid redirect_uri.");
    return;
  }

  const label = typeof access_token === "string" ? ACCESS_TOKENS.get(access_token) : undefined;
  if (!label) {
    res
      .status(401)
      .type("html")
      .send(
        renderLoginPage({
          clientId: client_id,
          redirectUri: redirect_uri,
          state: typeof state === "string" ? state : "",
          codeChallenge: typeof code_challenge === "string" ? code_challenge : "",
          error: "That access token wasn't recognized. Ask the vault owner for a valid token.",
        })
      );
    return;
  }

  pruneExpiredAuthCodes();
  const code = randomToken();
  authCodes.set(code, {
    label,
    clientId: client_id,
    redirectUri: redirect_uri,
    codeChallenge: typeof code_challenge === "string" ? code_challenge : "",
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
  });

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (typeof state === "string" && state) redirectUrl.searchParams.set("state", state);
  res.redirect(redirectUrl.toString());
});

app.post("/token", express.urlencoded({ extended: false }), (req, res) => {
  const body = req.body ?? {};
  pruneExpiredAuthCodes();

  if (body.grant_type === "authorization_code") {
    const { code, redirect_uri, client_id, code_verifier } = body;
    const entry = typeof code === "string" ? authCodes.get(code) : undefined;

    if (!entry) {
      res.status(400).json({ error: "invalid_grant", error_description: "Authorization code is invalid or expired." });
      return;
    }
    authCodes.delete(code); // single use, regardless of what happens below

    if (entry.clientId !== client_id || entry.redirectUri !== redirect_uri) {
      res.status(400).json({ error: "invalid_grant", error_description: "client_id or redirect_uri mismatch." });
      return;
    }
    if (typeof code_verifier !== "string" || !verifyPkce(entry.codeChallenge, code_verifier)) {
      res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed." });
      return;
    }

    res.json(issueTokenPair(entry.label));
    return;
  }

  if (body.grant_type === "refresh_token") {
    const refreshToken = body.refresh_token;
    const label = typeof refreshToken === "string" ? issuedRefreshTokens.get(refreshToken) : undefined;
    if (!label) {
      res.status(400).json({ error: "invalid_grant", error_description: "Refresh token is invalid or revoked." });
      return;
    }
    issuedRefreshTokens.delete(refreshToken); // rotate on use
    res.json(issueTokenPair(label));
    return;
  }

  res.status(400).json({ error: "unsupported_grant_type" });
});

app.post("/mcp", async (req, res) => {
  const label = resolveAccessLabel(req);
  if (!label) {
    sendUnauthorized(req, res);
    return;
  }
  console.log(`MCP request from "${label}"`);

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
  if (!resolveAccessLabel(req)) {
    sendUnauthorized(req, res);
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
  if (ACCESS_TOKENS.size === 0) {
    console.warn(
      "Warning: MCP_ACCESS_TOKENS is not set or empty. No token will be accepted — the /mcp endpoint " +
        "is closed to everyone until at least one \"label=token\" entry is configured."
    );
  } else {
    console.log(`Access tokens configured for: ${[...ACCESS_TOKENS.values()].join(", ")}`);
  }
  if (BYPASS_ACCESS_TIERS) {
    console.warn("Warning: BYPASS_ACCESS_TIERS is true. Access tiers are disabled — every character is readable.");
  }
});
