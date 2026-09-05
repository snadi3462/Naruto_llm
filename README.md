# Second Brain — Naruto Wiki

A personal Obsidian knowledge base about the *Naruto* series, maintained by an LLM
agent (Claude) rather than typed by hand. The user drops in source material; the
agent reads it, summarizes it, and cross-references it into a structured wiki.

## Layout

```
raw/                      immutable source clips (web pages, fan-wiki pages, images)
wiki/
  index.md                catalog of every wiki page, by category — start here
  log.md                  append-only history of every ingest/query/lint
  sources/                one page per ingested source
  entities/               one page per character/person/org/place
  concepts/               one page per theme spanning multiple sources
  syntheses/              filed answers to substantive questions/comparisons
CLAUDE.md                 the schema/contract the agent follows every session
mcp-render-server/        remote MCP server exposing this vault to Claude over HTTP
render.yaml               Render Blueprint config for deploying the MCP server
```

See [`CLAUDE.md`](./CLAUDE.md) for the full schema — folder conventions, page
format, and the ingest/query/lint workflows the agent follows.

## Remote access via MCP

The vault is also readable remotely by any Claude client (Claude Code, Claude
Desktop, claude.ai) through a small Model Context Protocol server deployed on
Render. See [`mcp-render-server/README.md`](./mcp-render-server/README.md) for
setup, deployment, and how to connect it to Claude.
