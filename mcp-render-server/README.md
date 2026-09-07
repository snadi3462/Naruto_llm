# Obsidian MCP Server

A minimal [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes the `raw/`, `wiki/`, and `CLAUDE.md` files of the parent Obsidian vault
to any MCP-compatible Claude client, over Streamable HTTP.

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
| `MCP_API_KEY` | Recommended | If set, every request to `/mcp` must either send `Authorization: Bearer <key>` or a `?key=<key>` query parameter, or it's rejected with 401. If unset, the endpoint is open to anyone with the URL. |
| `UNLOCKED_CHARACTERS` | No | Comma-separated list of character names (matching their `wiki/entities/` page title), or `ALL`, that are currently allowed through the access-tier gate. Unset = everything gated stays locked. See Access tiers below. |
| `PORT` | No | Set automatically by Render. Defaults to `3000` locally. |

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
Blueprint**, connect the repo, and it will prompt for the `MCP_API_KEY`
secret (generate one yourself, e.g. `openssl rand -base64 24`, or ask Claude
to generate one — never commit it to the repo).

Render's free plan spins the service down after inactivity; the first
request after idle time takes ~30–50s to wake it back up.

## Connecting to Claude

**Claude Code CLI:**

```bash
claude mcp add --transport http naruto-wiki https://<your-service>.onrender.com/mcp \
  --header "Authorization: Bearer <your MCP_API_KEY>"
```

**Claude.ai / Claude Desktop:** Settings → Connectors → Add custom connector.
This dialog only takes a single URL field with no custom-header option, so
the bearer-token header from the CLI example above won't work here — the
setup flow will just show "Couldn't determine server settings" against a
bare 401. Instead, paste the key directly into the URL as a query parameter:

```
https://<your-service>.onrender.com/mcp?key=<your MCP_API_KEY>
```

Once added, remember to also toggle the connector's tools on for the
specific chat you're using (bottom of the chat box, tools/search menu) — a
connector can be "linked" in Settings without being enabled for a given
conversation.
