# Obsidian MCP Server

A minimal [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes the `raw/`, `wiki/`, and `CLAUDE.md` files of the parent Obsidian vault
to any MCP-compatible Claude client, over Streamable HTTP.

The same codebase deploys as **two separate Render services** (see
`render.yaml`), differing only in one env var:

| Service | Access tiers | Use for |
| --- | --- | --- |
| `mcp-render-server` | Enforced — the 12 gated characters stay locked until unlocked via `UNLOCKED_CHARACTERS` | The connector you share around / use day to day |
| `mcp-render-server-full` | Disabled (`BYPASS_ACCESS_TIERS=true`) — everything readable, no gating at all | Your own private/admin connector with unrestricted access |

## Tools exposed

| Tool | Description |
| --- | --- |
| `get_server_status` | Health check — confirms the server is reachable. |
| `list_notes` | Lists every Markdown note in the vault. |
| `read_note` | Reads one note by its vault-relative path. |
| `search_notes` | Full-text search across every note in the vault. |

All file access is sandboxed to the vault root and restricted to `.md` files;
`.obsidian`, `node_modules`, and `.git` are skipped when walking the tree.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `OBSIDIAN_VAULT_PATH` | No | Absolute path to the vault. Defaults to the parent of this folder (`..`), which is correct when Render's Root Directory is set to `mcp-render-server`. |
| `MCP_ACCESS_TOKENS` | **Yes** | Comma-separated list of `label=token` pairs, e.g. `you=abc123,alice=def456`. Every request to `/mcp` must present one of these tokens, either as `Authorization: Bearer <token>` or a `?key=<token>` query parameter, or it's rejected with 401. There is no "unset means open" fallback — if this is empty, every request is rejected. See Access tokens below. |
| `UNLOCKED_CHARACTERS` | No | Comma-separated list of character names (matching their `wiki/entities/` page title), or `ALL`, that are currently allowed through the access-tier gate. Unset = everything gated stays locked. Ignored entirely if `BYPASS_ACCESS_TIERS` is true. See Access tiers below. |
| `BYPASS_ACCESS_TIERS` | No | If `"true"`, access tiers are disabled entirely — every character is readable regardless of frontmatter or `UNLOCKED_CHARACTERS`. This is what makes `mcp-render-server-full` behave differently from `mcp-render-server` despite being the same code. |
| `PORT` | No | Set automatically by Render. Defaults to `3000` locally. |

## OAuth

Both services also act as their own minimal OAuth 2.1 authorization server
(authorization code grant with PKCE, plus dynamic client registration), so
MCP clients that support OAuth discovery — including Claude.ai's custom
connector flow — get a real sign-in page instead of a token pasted into the
URL.

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
  code path.

This sits on top of the existing token list, not instead of it: adding or
revoking a person is still done by editing `MCP_ACCESS_TOKENS`, same as
below. All OAuth state (registered clients, issued tokens) lives in memory
only — an idle spin-down on Render's free tier restarts the process and
wipes it, forcing anyone connected via OAuth to sign in again. Clients that
skip OAuth and just send a static bearer/query token are unaffected by this.

## Access tokens

Every request to `/mcp` — from you or anyone else — needs a token from
`MCP_ACCESS_TOKENS`, either directly (as a static bearer/query token) or via
the OAuth login form above. This is a flat allowlist, not a real user
database: there's no per-person password, just a shared secret per person
that the server checks on every request or every login.

**Format**: `label=token` pairs separated by commas, e.g.

```
you=4rIoRy-EBufn7_N5C1c6kEv6c2R8Lqry,alice=<a different random token>
```

- **Adding someone**: generate a random token (`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
  works well), pick a label for them, and append `label=token` to
  `MCP_ACCESS_TOKENS` in the Render dashboard (Environment tab) for whichever
  service(s) they should reach. Saving triggers a redeploy (~1-2 min) before
  it takes effect.
- **Revoking someone**: delete their `label=token` entry from the same env
  var and save. Their token stops working immediately on redeploy; everyone
  else's tokens are unaffected.
- All tokens grant the same access — there's no per-token permission beyond
  "valid" or "not valid." A valid token on `mcp-render-server` still goes
  through the access-tier gate below; a valid token on
  `mcp-render-server-full` bypasses it entirely, same as before.
- Tokens are never committed to the repo — this env var only ever lives in
  the Render dashboard, set with `sync: false` in `render.yaml`.
- Every accepted request logs the label that authenticated it (Render's log
  stream), so you can see who's actually using the connector.

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
