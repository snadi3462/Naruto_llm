import crypto from "node:crypto";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import pg from "pg";

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH
  ? path.resolve(process.env.OBSIDIAN_VAULT_PATH)
  : path.resolve(process.cwd(), "..");

// --- Scratchpad DB (scoped write access) ---
//
// The vault's wiki/ and raw/ content is served read-only above (Claude owns wiki/, the
// user owns raw/, and neither is ever written to over MCP). Separately, this server can
// optionally connect to the same Postgres database db-sync/ mirrors the vault into
// (DATABASE_URL) to expose a small, deliberately narrow write surface: a single
// `mcp_notes` table that isn't part of the vault schema at all. The four db_* tools below
// are the *only* SQL this server ever runs against that connection, every statement is
// parameterized (no table/column name is ever built from tool input), and none of them
// touch `wiki_pages` or `raw_files` — so a write tool existing at all can't be turned into
// a way to edit or delete wiki/raw content. If DATABASE_URL isn't set, the db_* tools
// report that clearly instead of the server failing to start.
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;

const ENSURE_NOTES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS mcp_notes (
    id         SERIAL PRIMARY KEY,
    title      TEXT,
    content    TEXT NOT NULL,
    author     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

let notesSchemaReady: Promise<void> | null = null;
function ensureNotesSchema(): Promise<void> {
  if (!pool) return Promise.reject(new Error("DATABASE_URL is not configured on this server."));
  if (!notesSchemaReady) {
    notesSchemaReady = pool.query(ENSURE_NOTES_TABLE_SQL).then(() => undefined);
  }
  return notesSchemaReady;
}

// Local-dev-only escape hatch: forces every request to bypass access tiers regardless
// of which token was used. Leave unset in production — the per-token ":full" suffix
// below is the real mechanism for granting full access to specific people.
const BYPASS_ACCESS_TIERS = process.env.BYPASS_ACCESS_TIERS === "true";

interface AccessTokenEntry {
  label: string;
  full: boolean; // true = this token's holder bypasses access tiers entirely
}

// Per-person access tokens: MCP_ACCESS_TOKENS is a comma-separated list of
// "label=token" pairs, e.g. "you=abc123,alice=def456". Every request must present
// one of these tokens (as `Authorization: Bearer <token>` or `?key=<token>`) — there
// is no "unset means open" fallback, since the whole point is that access always
// requires a token. Revoking one person means deleting their "label=token" entry from
// this env var on Render and saving (triggers a redeploy) — everyone else's tokens
// keep working.
//
// Appending ":full" to a token's value (e.g. "you=abc123:full") marks that specific
// token as bypassing the access-tier gate entirely, while every other token still
// goes through it normally. This is what lets one deployed server, one OAuth login
// page, and one client_id serve both a restricted and an unrestricted login — the
// password someone is given decides their access level, not which URL they connect to.
function parseAccessTokens(): Map<string, AccessTokenEntry> {
  const tokens = new Map<string, AccessTokenEntry>();
  const raw = process.env.MCP_ACCESS_TOKENS;
  if (!raw) return tokens;

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const label = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    let full = false;
    if (value.toLowerCase().endsWith(":full")) {
      full = true;
      value = value.slice(0, -":full".length);
    }
    const token = value;
    if (label && token) tokens.set(token, { label, full });
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
// A given login's access level (tiered vs. full) rides along with it through this whole
// flow — the auth code, the issued access token, and its refresh token all carry the
// same "full" flag the login token had, so one client_id / one login page can serve both
// restricted and unrestricted logins depending purely on which password was entered.
//
// State (registered clients, in-flight auth codes, issued tokens) is persisted in the same
// Postgres database db-sync/ mirrors the vault into and the mcp_notes scratchpad uses
// (DATABASE_URL), so it survives Render's free-tier idle spin-downs instead of being wiped
// on every restart. Falls back to in-memory storage — the original behavior — when
// DATABASE_URL isn't set, so local dev without Postgres still works unchanged. Every table
// is scoped by SERVICE_NAME (in case you ever do run more than one deployment against the
// same database) so tokens/clients from one never resolve on another.

const SERVICE_NAME = process.env.SERVICE_NAME || "default";

const ENSURE_OAUTH_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS oauth_clients (
    service_name  TEXT NOT NULL,
    client_id     TEXT NOT NULL,
    redirect_uris TEXT[] NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (service_name, client_id)
  );
  CREATE TABLE IF NOT EXISTS oauth_auth_codes (
    service_name   TEXT NOT NULL,
    code           TEXT NOT NULL,
    label          TEXT NOT NULL,
    full_access    BOOLEAN NOT NULL DEFAULT false,
    client_id      TEXT NOT NULL,
    redirect_uri   TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (service_name, code)
  );
  CREATE TABLE IF NOT EXISTS oauth_access_tokens (
    service_name TEXT NOT NULL,
    token        TEXT NOT NULL,
    label        TEXT NOT NULL,
    full_access  BOOLEAN NOT NULL DEFAULT false,
    expires_at   TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (service_name, token)
  );
  CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
    service_name TEXT NOT NULL,
    token        TEXT NOT NULL,
    label        TEXT NOT NULL,
    full_access  BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (service_name, token)
  );
  ALTER TABLE oauth_auth_codes ADD COLUMN IF NOT EXISTS full_access BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE oauth_access_tokens ADD COLUMN IF NOT EXISTS full_access BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS full_access BOOLEAN NOT NULL DEFAULT false;
`;

let oauthSchemaReady: Promise<void> | null = null;
function ensureOAuthSchema(): Promise<void> {
  if (!pool) return Promise.resolve();
  if (!oauthSchemaReady) {
    oauthSchemaReady = pool.query(ENSURE_OAUTH_SCHEMA_SQL).then(() => undefined);
  }
  return oauthSchemaReady;
}

interface OAuthClient {
  redirectUris: string[];
}
interface AuthCode {
  label: string;
  full: boolean;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
}
interface IssuedAccessToken {
  label: string;
  full: boolean;
  expiresAt: number;
}
interface IssuedRefreshToken {
  label: string;
  full: boolean;
}

// In-memory fallback, used only when DATABASE_URL isn't configured.
const memClients = new Map<string, OAuthClient>();
const memAuthCodes = new Map<string, AuthCode>();
const memAccessTokens = new Map<string, IssuedAccessToken>();
const memRefreshTokens = new Map<string, IssuedRefreshToken>();

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

async function registerOAuthClient(redirectUris: string[]): Promise<string> {
  const clientId = randomToken(16);
  if (pool) {
    await ensureOAuthSchema();
    await pool.query(`INSERT INTO oauth_clients (service_name, client_id, redirect_uris) VALUES ($1, $2, $3)`, [
      SERVICE_NAME,
      clientId,
      redirectUris,
    ]);
  } else {
    memClients.set(clientId, { redirectUris });
  }
  return clientId;
}

async function getOAuthClient(clientId: string): Promise<OAuthClient | null> {
  if (pool) {
    await ensureOAuthSchema();
    const result = await pool.query(`SELECT redirect_uris FROM oauth_clients WHERE service_name = $1 AND client_id = $2`, [
      SERVICE_NAME,
      clientId,
    ]);
    return result.rowCount ? { redirectUris: result.rows[0].redirect_uris } : null;
  }
  return memClients.get(clientId) ?? null;
}

async function createAuthCode(entry: Omit<AuthCode, "expiresAt">): Promise<string> {
  const code = randomToken();
  const expiresAt = Date.now() + AUTH_CODE_TTL_MS;
  if (pool) {
    await ensureOAuthSchema();
    await pool.query(
      `INSERT INTO oauth_auth_codes (service_name, code, label, full_access, client_id, redirect_uri, code_challenge, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [SERVICE_NAME, code, entry.label, entry.full, entry.clientId, entry.redirectUri, entry.codeChallenge, new Date(expiresAt)]
    );
  } else {
    memAuthCodes.set(code, { ...entry, expiresAt });
  }
  return code;
}

// Deletes the code as it reads it (single use), and treats an already-expired code as if
// it didn't exist.
async function consumeAuthCode(code: string): Promise<AuthCode | null> {
  if (pool) {
    await ensureOAuthSchema();
    const result = await pool.query(
      `DELETE FROM oauth_auth_codes WHERE service_name = $1 AND code = $2 AND expires_at > now()
       RETURNING label, full_access, client_id, redirect_uri, code_challenge`,
      [SERVICE_NAME, code]
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      label: row.label,
      full: row.full_access,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      codeChallenge: row.code_challenge,
      expiresAt: 0,
    };
  }
  const entry = memAuthCodes.get(code);
  memAuthCodes.delete(code);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry;
}

async function issueTokenPair(label: string, full: boolean) {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const expiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;
  if (pool) {
    await ensureOAuthSchema();
    await pool.query(
      `INSERT INTO oauth_access_tokens (service_name, token, label, full_access, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [SERVICE_NAME, accessToken, label, full, new Date(expiresAt)]
    );
    await pool.query(`INSERT INTO oauth_refresh_tokens (service_name, token, label, full_access) VALUES ($1, $2, $3, $4)`, [
      SERVICE_NAME,
      refreshToken,
      label,
      full,
    ]);
  } else {
    memAccessTokens.set(accessToken, { label, full, expiresAt });
    memRefreshTokens.set(refreshToken, { label, full });
  }
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
  };
}

// Deletes the refresh token as it reads it (rotated on every use).
async function consumeRefreshToken(token: string): Promise<IssuedRefreshToken | null> {
  if (pool) {
    await ensureOAuthSchema();
    const result = await pool.query(
      `DELETE FROM oauth_refresh_tokens WHERE service_name = $1 AND token = $2 RETURNING label, full_access`,
      [SERVICE_NAME, token]
    );
    return result.rowCount ? { label: result.rows[0].label, full: result.rows[0].full_access } : null;
  }
  const entry = memRefreshTokens.get(token);
  memRefreshTokens.delete(token);
  return entry ?? null;
}

async function resolveIssuedAccessToken(token: string): Promise<AccessTokenEntry | null> {
  if (pool) {
    await ensureOAuthSchema();
    const result = await pool.query(
      `SELECT label, full_access FROM oauth_access_tokens WHERE service_name = $1 AND token = $2 AND expires_at > now()`,
      [SERVICE_NAME, token]
    );
    return result.rowCount ? { label: result.rows[0].label, full: result.rows[0].full_access } : null;
  }
  const entry = memAccessTokens.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memAccessTokens.delete(token);
    return null;
  }
  return { label: entry.label, full: entry.full };
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
async function getRestrictedCharacterNames(bypass: boolean): Promise<Set<string>> {
  const restricted = new Set<string>();
  if (bypass) return restricted;

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

function buildServer(label: string, tokenFull: boolean): McpServer {
  const server = new McpServer({
    name: "obsidian-mcp",
    version: "1.0.0",
  });

  // BYPASS_ACCESS_TIERS (local dev only) forces bypass for everyone; tokenFull is the
  // per-token ":full" flag resolved for this specific request/session.
  const bypass = BYPASS_ACCESS_TIERS || tokenFull;

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
      const restrictedNames = await getRestrictedCharacterNames(bypass);
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
        const restrictedNames = await getRestrictedCharacterNames(bypass);
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
          const restrictedNames = await getRestrictedCharacterNames(bypass);
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
      const restrictedNames = await getRestrictedCharacterNames(bypass);
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

  server.registerTool(
    "db_add_note",
    {
      description:
        "Add a note to the scratchpad database. This writes only to the mcp_notes table — a " +
        "separate scratch area, not part of the wiki — and never touches wiki/ or raw/ content.",
      inputSchema: {
        content: z.string().min(1).describe("Note body"),
        title: z.string().optional().describe("Optional short title for the note"),
      },
    },
    async ({ content, title }) => {
      try {
        await ensureNotesSchema();
        const result = await pool!.query(
          `INSERT INTO mcp_notes (title, content, author) VALUES ($1, $2, $3)
           RETURNING id, title, content, author, created_at`,
          [title ?? null, content, label]
        );
        const row = result.rows[0];
        return { content: [{ type: "text", text: `Note added (id=${row.id}).\n${JSON.stringify(row, null, 2)}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error adding note: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "db_edit_note",
    {
      description:
        "Edit an existing note in the scratchpad database (mcp_notes table) by id. Only fields " +
        "you provide are changed. Cannot affect wiki/ or raw/ content.",
      inputSchema: {
        id: z.number().int().positive().describe("id of the note to edit"),
        content: z.string().min(1).optional().describe("New note body"),
        title: z.string().optional().describe("New title"),
      },
    },
    async ({ id, content, title }) => {
      try {
        await ensureNotesSchema();
        const result = await pool!.query(
          `UPDATE mcp_notes
             SET title = COALESCE($1, title),
                 content = COALESCE($2, content),
                 updated_at = now()
           WHERE id = $3
           RETURNING id, title, content, author, created_at, updated_at`,
          [title ?? null, content ?? null, id]
        );
        if (result.rowCount === 0) {
          return { content: [{ type: "text", text: `No note found with id=${id}.` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(result.rows[0], null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error editing note: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "db_delete_note",
    {
      description:
        "Delete a note from the scratchpad database (mcp_notes table) by id. Cannot affect " +
        "wiki/ or raw/ content.",
      inputSchema: {
        id: z.number().int().positive().describe("id of the note to delete"),
      },
    },
    async ({ id }) => {
      try {
        await ensureNotesSchema();
        const result = await pool!.query(`DELETE FROM mcp_notes WHERE id = $1`, [id]);
        if (result.rowCount === 0) {
          return { content: [{ type: "text", text: `No note found with id=${id}.` }], isError: true };
        }
        return { content: [{ type: "text", text: `Note ${id} deleted.` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error deleting note: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "db_list_notes",
    {
      description: "List notes from the scratchpad database (mcp_notes table), most recent first.",
      inputSchema: {},
    },
    async () => {
      try {
        await ensureNotesSchema();
        const result = await pool!.query(
          `SELECT id, title, content, author, created_at, updated_at FROM mcp_notes ORDER BY created_at DESC LIMIT 200`
        );
        return {
          content: [
            {
              type: "text",
              text: result.rows.length > 0 ? JSON.stringify(result.rows, null, 2) : "No notes yet.",
            },
          ],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Error listing notes: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  return server;
}

// Accepts either a static MCP_ACCESS_TOKENS entry or a token issued by the /token
// endpoint via the OAuth flow below — both are just bearer strings from this point on.
async function resolveToken(candidate: string | undefined): Promise<AccessTokenEntry | null> {
  if (!candidate) return null;

  const staticEntry = ACCESS_TOKENS.get(candidate);
  if (staticEntry) return staticEntry;

  return resolveIssuedAccessToken(candidate);
}

async function resolveAccessLabel(req: express.Request): Promise<AccessTokenEntry | null> {
  const authHeader = req.header("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
  const entry = await resolveToken(bearer);
  if (entry) return entry;

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

app.post("/register", async (req, res) => {
  const body = req.body ?? {};
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u: unknown): u is string => typeof u === "string")
    : [];

  if (redirectUris.length === 0) {
    res.status(400).json({ error: "invalid_client_metadata", error_description: "redirect_uris is required." });
    return;
  }

  const clientId = await registerOAuthClient(redirectUris);

  res.status(201).json({
    client_id: clientId,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
});

app.get("/authorize", async (req, res) => {
  const { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.query;

  if (response_type !== "code") {
    res.status(400).send('Unsupported response_type; only "code" is supported.');
    return;
  }
  const client = typeof client_id === "string" ? await getOAuthClient(client_id) : null;
  if (typeof client_id !== "string" || !client) {
    res.status(400).send("Unknown client_id. Register the client via POST /register first.");
    return;
  }
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

app.post("/authorize", express.urlencoded({ extended: false }), async (req, res) => {
  const { access_token, client_id, redirect_uri, state, code_challenge } = req.body ?? {};

  const client = typeof client_id === "string" ? await getOAuthClient(client_id) : null;
  if (typeof client_id !== "string" || !client) {
    res.status(400).send("Unknown client_id.");
    return;
  }
  if (typeof redirect_uri !== "string" || !client.redirectUris.includes(redirect_uri)) {
    res.status(400).send("Invalid redirect_uri.");
    return;
  }

  const loginEntry = typeof access_token === "string" ? ACCESS_TOKENS.get(access_token) : undefined;
  if (!loginEntry) {
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

  const code = await createAuthCode({
    label: loginEntry.label,
    full: loginEntry.full,
    clientId: client_id,
    redirectUri: redirect_uri,
    codeChallenge: typeof code_challenge === "string" ? code_challenge : "",
  });

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (typeof state === "string" && state) redirectUrl.searchParams.set("state", state);
  res.redirect(redirectUrl.toString());
});

app.post("/token", express.urlencoded({ extended: false }), async (req, res) => {
  const body = req.body ?? {};

  if (body.grant_type === "authorization_code") {
    const { code, redirect_uri, client_id, code_verifier } = body;
    const entry = typeof code === "string" ? await consumeAuthCode(code) : null; // single use, regardless of what happens below

    if (!entry) {
      res.status(400).json({ error: "invalid_grant", error_description: "Authorization code is invalid or expired." });
      return;
    }

    if (entry.clientId !== client_id || entry.redirectUri !== redirect_uri) {
      res.status(400).json({ error: "invalid_grant", error_description: "client_id or redirect_uri mismatch." });
      return;
    }
    if (typeof code_verifier !== "string" || !verifyPkce(entry.codeChallenge, code_verifier)) {
      res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed." });
      return;
    }

    res.json(await issueTokenPair(entry.label, entry.full));
    return;
  }

  if (body.grant_type === "refresh_token") {
    const refreshToken = body.refresh_token;
    const refreshEntry = typeof refreshToken === "string" ? await consumeRefreshToken(refreshToken) : null; // rotated on use
    if (!refreshEntry) {
      res.status(400).json({ error: "invalid_grant", error_description: "Refresh token is invalid or revoked." });
      return;
    }
    res.json(await issueTokenPair(refreshEntry.label, refreshEntry.full));
    return;
  }

  res.status(400).json({ error: "unsupported_grant_type" });
});

app.post("/mcp", async (req, res) => {
  const auth = await resolveAccessLabel(req);
  if (!auth) {
    sendUnauthorized(req, res);
    return;
  }
  console.log(`MCP request from "${auth.label}"${auth.full ? " (full access)" : ""}`);

  const server = buildServer(auth.label, auth.full);
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

app.get("/mcp", async (req, res) => {
  if (!(await resolveAccessLabel(req))) {
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
    console.log(
      `Access tokens configured for: ${[...ACCESS_TOKENS.values()].map((e) => (e.full ? `${e.label} (full)` : e.label)).join(", ")}`
    );
  }
  if (BYPASS_ACCESS_TIERS) {
    console.warn("Warning: BYPASS_ACCESS_TIERS is true. Access tiers are disabled — every character is readable.");
  }
  if (pool) {
    console.log(
      `DATABASE_URL configured (service_name="${SERVICE_NAME}") — db_add_note/db_edit_note/db_delete_note/db_list_notes ` +
        "are available (mcp_notes table only), and OAuth client registrations/tokens are persisted in Postgres " +
        "(survive restarts/spin-downs)."
    );
    // Best-effort periodic cleanup of expired rows that were never consumed (abandoned
    // auth flows, expired access tokens nobody bothered to refresh). consumeAuthCode and
    // resolveIssuedAccessToken already exclude expired rows from every read, so this is
    // just table hygiene, not a correctness requirement.
    setInterval(() => {
      void ensureOAuthSchema().then(() => {
        void pool!.query(`DELETE FROM oauth_auth_codes WHERE service_name = $1 AND expires_at < now()`, [SERVICE_NAME]);
        void pool!.query(`DELETE FROM oauth_access_tokens WHERE service_name = $1 AND expires_at < now()`, [SERVICE_NAME]);
      });
    }, 15 * 60 * 1000).unref();
  } else {
    console.log(
      "DATABASE_URL not set — db_add_note/db_edit_note/db_delete_note/db_list_notes will report an error if called, " +
        "and OAuth client registrations/tokens are in-memory only (lost on restart)."
    );
  }
});
