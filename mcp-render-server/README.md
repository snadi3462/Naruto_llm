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
| `MCP_API_KEY` | Recommended | If set, every request to `/mcp` must include `Authorization: Bearer <key>`, or it's rejected with 401. If unset, the endpoint is open to anyone with the URL. |
| `PORT` | No | Set automatically by Render. Defaults to `3000` locally. |

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

**Claude.ai / Claude Desktop:** Settings → Connectors → Add custom connector,
paste `https://<your-service>.onrender.com/mcp`. If the dialog doesn't expose
a custom-header field, the bearer-token auth above won't work there — swap
the auth check in `src/index.ts` for a `?key=` query parameter instead.
