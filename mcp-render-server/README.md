# Obsidian MCP Server

A minimal [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes the `raw/`, `wiki/`, and `CLAUDE.md` files of the parent Obsidian vault
to any MCP-compatible Claude client, over Streamable HTTP.

This deploys as a **single Render service** (see `render.yaml`) with one
OAuth login page and one `client_id` per person who connects. Whether a given
login sees the full vault or the access-tier-gated version is decided per
token, not per deployment: append `:full` to a token's value in
`MCP_ACCESS_TOKENS` (e.g. `you=abc123:full,alice=def456`) and that person's
logins bypass access tiers entirely, while everyone else's tokens still go
through the gate below. See "Access tokens" and "Access tiers" further down.

## Tools exposed

| Tool | Description |
| --- | --- |
| `get_server_status` | Health check — confirms the server is reachable. |
| `list_notes` | Lists every Markdown note in the vault. |
| `read_note` | Reads one note by its vault-relative path. |
| `search_notes` | Full-text search across every note in the vault. |
| `db_add_note` | Adds a row to the `mcp_notes` scratchpad table (see below). |
| `db_edit_note` | Edits a row in `mcp_notes` by id. |
| `db_delete_note` | Deletes a row from `mcp_notes` by id. |
| `db_list_notes` | Lists rows from `mcp_notes`, most recent first. |

All file access is sandboxed to the vault root and restricted to `.md` files;
`.obsidian`, `node_modules`, and `.git` are skipped when walking the tree.
The `wiki/` and `raw/` content itself is **read-only** over MCP — there is no
tool that can write, edit, or delete anything under those directories.

## Scratchpad database (write access, scoped)

`db_add_note` / `db_edit_note` / `db_delete_note` / `db_list_notes` give an MCP
client a small, genuinely writable surface, deliberately kept separate from
the vault: a single `mcp_notes` table (id, title, content, author,
created_at, updated_at) in the same Postgres database that `db-sync/` mirrors
the vault into (`wiki_pages`, `raw_files`). Every one of these tools runs a
single hardcoded, parameterized SQL statement against `mcp_notes` only —
no table or column name is ever built from tool input, and none of them can
reference `wiki_pages` or `raw_files`. There's no generic "run SQL" tool, so
there's no way for a client to reach outside that one table.

- Requires `DATABASE_URL` (see below). If unset, these four tools return a
  clear error instead of the server failing to start — everything else
  keeps working.
- The table is created automatically (`CREATE TABLE IF NOT EXISTS`) the
  first time one of these tools runs.
- `author` is filled in automatically from the caller's access-token label
  (see Access tokens below) — not something the client passes in.
- This is independent of `db-sync/`, which only mirrors `raw/`/`wiki/` into
  Postgres and never writes back to the filesystem; `mcp_notes` isn't synced
  to or from any file.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `OBSIDIAN_VAULT_PATH` | No | Absolute path to the vault. Defaults to the parent of this folder (`..`), which is correct when Render's Root Directory is set to `mcp-render-server`. |
| `MCP_ACCESS_TOKENS` | **Yes** | Comma-separated list of `label=token` pairs, e.g. `you=abc123:full,alice=def456`. Every request to `/mcp` must present one of these tokens, either as `Authorization: Bearer <token>` or a `?key=<token>` query parameter, or it's rejected with 401. There is no "unset means open" fallback — if this is empty, every request is rejected. Append `:full` to a token's value to make that specific login bypass access tiers entirely. See Access tokens below. |
| `UNLOCKED_CHARACTERS` | No | Comma-separated list of character names (matching their `wiki/entities/` page title), or `ALL`, that are currently allowed through the access-tier gate for everyone using a non-`:full` token. Unset = everything gated stays locked for them. See Access tiers below. |
| `BYPASS_ACCESS_TIERS` | No | Local-dev-only escape hatch: if `"true"`, access tiers are disabled for every request regardless of which token was used. Leave unset in production — the per-token `:full` suffix above is the real mechanism for granting specific people full access. |
| `DATABASE_URL` | No | Postgres connection string. If set, enables `db_add_note` / `db_edit_note` / `db_delete_note` / `db_list_notes`, scoped to the `mcp_notes` table only — see "Scratchpad database" above. If unset, those four tools return an error and everything else is unaffected. |
| `PORT` | No | Set automatically by Render. Defaults to `3000` locally. |

## OAuth

The server also acts as its own minimal OAuth 2.1 authorization server
(authorization code grant with PKCE, plus dynamic client registration), so
MCP clients that support OAuth discovery — including Claude.ai's custom
connector flow — get a real sign-in page instead of a token pasted into the
URL. Because there's one deployment and one authorization server, everyone
who connects registers against the same `/register` endpoint and gets a
`client_id` scoped to that one login flow — the same client_id is what
Claude.ai reuses for that connector every time it needs a fresh token
(re-authorizing, refreshing). What differs between people isn't the
client_id or the URL, it's the password (token) they're given on the login
form — see "Access tokens" below for how that determines their access level.

- Hitting `/mcp` without credentials returns `401` with a `WWW-Authenticate`
  header pointing at `/.well-known/oauth-protected-resource`, which in turn
  points at this server as the authorization server
  (`/.well-known/oauth-authorization-server`).
- The client registers itself via `POST /register` (no manual setup needed),
  then opens `/authorize` in a browser. The login page asks for one of the
  `MCP_ACCESS_TOKENS` values as the credential — same tokens as before, just
  entered on a form instead of pasted into a URL or header.
- On success it redirects back to the client with an authorization code,
  which the client exchanges at `POST /token` (PKCE-verified) for a
  short-lived access token (1 hour) and a refresh token.
- The resulting OAuth access token is used exactly like a static token —
  `Authorization: Bearer <token>` on `/mcp` — and is checked by the same
  code path. It also carries forward whichever access level (tiered or
  `:full`) the login token it came from had, including across a refresh.

This sits on top of the existing token list, not instead of it: adding or
revoking a person is still done by editing `MCP_ACCESS_TOKENS`, same as
below. When `DATABASE_URL` is set, all OAuth state (registered clients,
auth codes, access tokens, refresh tokens) is persisted to the same
Postgres database as the `mcp_notes` scratchpad — see `db-sync/schema.sql`
for the `oauth_*` tables — so an idle spin-down on Render's free tier no
longer forces anyone connected via OAuth to sign in again. Rows are scoped
by the `SERVICE_NAME` env var purely so a second deployment could safely
share the same database without its tokens/clients resolving here. Expired
auth codes and access tokens are swept every 15 minutes; refresh tokens are
consumed (deleted) on use. If `DATABASE_URL` is unset, OAuth state falls
back to in-memory only, with the original spin-down caveat. Clients that
skip OAuth and just send a static bearer/query token are unaffected either
way.

## Access tokens

Every request to `/mcp` — from you or anyone else — needs a token from
`MCP_ACCESS_TOKENS`, either directly (as a static bearer/query token) or via
the OAuth login form above. This is a flat allowlist, not a real user
database: there's no per-person password beyond this shared secret, which the
server checks on every request or every login.

**Format**: `label=token` pairs separated by commas, with an optional `:full`
suffix on the token to grant that person unrestricted access:

```
you=4rIoRy-EBufn7_N5C1c6kEv6c2R8Lqry:full,alice=<a different random token>
```

Here `you` bypasses the access-tier gate entirely (see Access tiers below);
`alice` still goes through it normally. Both log in on the exact same
`/authorize` page, against the exact same `client_id` — the `:full` suffix on
*your* token's value is what decides it, not a different URL or a different
service.

- **Adding someone**: generate a random token (`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
  works well — the output never contains a colon, so it's always safe to
  append `:full` to it), pick a label for them, and append `label=token` (or
  `label=token:full`) to `MCP_ACCESS_TOKENS` in the Render dashboard
  (Environment tab). Saving triggers a redeploy (~1-2 min) before it takes
  effect.
- **Revoking someone**: delete their `label=token` entry from the same env
  var and save. Their token (and any OAuth access/refresh tokens issued from
  logging in with it) stops working immediately on redeploy; everyone else's
  tokens are unaffected.
- **Changing someone's access level**: edit their entry in place — add or
  remove the `:full` suffix — and save. This only affects *new* logins; an
  OAuth access token already issued to them keeps the access level it was
  issued with until it expires (up to 1 hour) or they log in again.
- Tokens are never committed to the repo — this env var only ever lives in
  the Render dashboard, set with `sync: false` in `render.yaml`.
- Every accepted request logs the label that authenticated it, and whether it
  was a full-access login (Render's log stream), so you can see who's
  actually using the connector and at what level.

## Access tiers

Any `wiki/entities/<Name>.md` page can carry `access_tier: restricted` in its
frontmatter (see `CLAUDE.md`). The server reads that frontmatter on every
request — it's the single source of truth for who's gated, no server-side
list to keep in sync. For a restricted character, all three of their files
are gated by name: `wiki/entities/<Name>.md`, `wiki/sources/<Name>
(source).md`, and `raw/<Name>.md`.

- `read_note` on a locked file returns an `isError` result explaining it's
  restricted, instead of the content.
- `search_notes` skips locked files entirely — they never appear in results,
  matching or not.
- `list_notes` still lists locked files' paths (so their existence isn't a
  secret) but appends `[restricted]` to the line instead of hiding it.

Access is granted by adding the character's name (exactly matching their
entity page title) to `UNLOCKED_CHARACTERS` in the Render dashboard —
**never** as something Claude can set itself, since the whole point is that
only the vault owner controls the unlock. `ALL` unlocks every gated
character at once. This is deliberately not instant: changing an env var on
Render triggers a redeploy, so there's a short delay between granting access
and it taking effect — that's the tradeoff for the gate living somewhere
outside Claude's own tool surface.

`UNLOCKED_CHARACTERS` only matters for tokens *without* the `:full` suffix.
A `:full` token's holder bypasses this gate entirely regardless of what
`UNLOCKED_CHARACTERS` says — see Access tokens above.

## Local development

```bash
npm install
npm run dev      # tsx watch, no build step needed
```

The server listens on `http://localhost:3000`, with the MCP endpoint at
`POST /mcp`.

## Deploying to Render

This repo's root `render.yaml` is a Render Blueprint that builds this
subfolder as a free-tier web service. From the Render dashboard: **New →
Blueprint**, connect the repo. `MCP_ACCESS_TOKENS` is required — set at
least one `label=token` pair (Environment tab) before the `/mcp` endpoint
will accept any requests; it's never committed to the repo.

Render's free plan spins the service down after inactivity; the first
request after idle time takes ~30–50s to wake it back up.

## Connecting to Claude

**Claude.ai / Claude Desktop (recommended — OAuth):** Settings → Connectors →
Add custom connector → enter just the base MCP URL,
`https://<your-service>.onrender.com/mcp`, with no token in it. Claude
discovers that this server supports OAuth, registers itself automatically,
and opens the sign-in page — enter one of the tokens from
`MCP_ACCESS_TOKENS` there. Remember to also toggle the connector's tools on
for the specific chat you're using (bottom of the chat box, tools/search
menu) — a connector can be "linked" in Settings without being enabled for a
given conversation.

**Claude Code CLI (static token, no OAuth):**

```bash
claude mcp add --transport http naruto-wiki https://<your-service>.onrender.com/mcp --header "Authorization: Bearer <your-token>"
```

**Legacy query-token form**, for any client whose connector dialog has no
header field and doesn't support OAuth discovery:
`https://<your-service>.onrender.com/mcp?key=<your-token>`.

Give each person their own token rather than reusing yours, so you can
revoke one person's access later without affecting anyone else's. This
applies whether they connect via OAuth or a static token — both draw from
the same `MCP_ACCESS_TOKENS` list.
