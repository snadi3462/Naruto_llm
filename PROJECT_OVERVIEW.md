# Second Brain — Complete Project Reference

A single-file reference covering everything in this repository: the content layers
(`raw/`, `wiki/`), the schema that governs them (`CLAUDE.md`), and the remote MCP server
architecture (`mcp-render-server/`, `render.yaml`) that exposes the vault to Claude clients.
This file is descriptive documentation, not part of the wiki schema itself — see
[`CLAUDE.md`](./CLAUDE.md) for the editorial contract and [`ARCHITECTURE.md`](./ARCHITECTURE.md)
for the canonical, authoritative version of the server architecture section below.

---

## 1. What this repo is

An Obsidian vault that functions as a personal knowledge base about the *Naruto* series,
maintained entirely by an LLM agent (Claude) rather than hand-typed by the user. The user
drops in source material (web clips, fan-wiki pages); Claude reads it, summarizes it, and
cross-references it into a structured wiki. The same vault is also exposed remotely over
HTTP via a Model Context Protocol (MCP) server so any Claude client (Claude Code, Claude
Desktop, claude.ai) can read it outside of Obsidian.

## 2. Repo layout

```
raw/                      immutable source clips (web pages, fan-wiki pages, images) — 75 files
  assets/                 downloaded images referenced by raw clips
wiki/
  index.md                catalog of every wiki page, by category
  log.md                  append-only chronological record of ingests/queries/lints
  sources/                one page per ingested source — 75 files
  entities/               one page per person/character/org/place — 74 files
  concepts/               one page per theme/team/org spanning multiple sources — 8 files
  syntheses/              answers to substantive questions, filed back into the wiki — currently empty
CLAUDE.md                 the wiki's editorial schema/contract
ARCHITECTURE.md           technical reference for the MCP server + gating systems
README.md                 project overview / entry point
mcp-render-server/        the MCP server (Node/Express/TypeScript) exposing the vault
  src/index.ts            the entire server implementation (694 lines)
  dist/index.js           compiled output (build artifact, not hand-edited)
  package.json            dependencies/scripts
  tsconfig.json           TypeScript config
  README.md               MCP-server-specific setup/ops documentation
render.yaml               Render Blueprint: defines both deployed services
```

## 3. The three content layers (per `CLAUDE.md`)

1. **`raw/`** — source documents. Immutable. Never edited or deleted. Web clips, fan-wiki
   pages, images. Ground truth: if the wiki and a raw source disagree, the raw source wins
   and the wiki page gets corrected.
2. **`wiki/`** — everything Claude writes: summaries, entity pages, concept pages,
   syntheses, `index.md`, `log.md`. Claude owns this layer entirely; the user reads it.
3. **`CLAUDE.md`** — the schema itself. Updated by Claude when the user and Claude agree on
   a new convention.

### Page format

Every wiki page starts with YAML frontmatter:

```yaml
---
type: source | entity | concept | synthesis
tags: []
access_tier: restricted   # optional — gates the page behind the MCP server, see §6
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: []                # wikilinks to wiki/sources/ pages this page draws on
---
```

Body is plain markdown, using Obsidian `[[Page Name]]` wikilinks for cross-references.
Entity/concept pages end with a `## Sources` section. Contradictions between sources are
noted inline (e.g. "Per [[Source A]] X happened in 1998; [[Source B]] gives 2001 —
unresolved") rather than silently resolved.

### Operations

- **Ingest**: read a raw source fully → discuss key takeaways with the user → write/update
  its `wiki/sources/` page → update every touched `wiki/entities/`/`wiki/concepts/` page →
  update `wiki/index.md` → append a `wiki/log.md` entry. A single source can reasonably
  touch 10-15 pages.
- **Query**: read `wiki/index.md` first → read relevant wiki pages (drill into `raw/` only
  if thin or a direct quote is needed) → synthesize an answer with citations → offer to file
  substantive answers into `wiki/syntheses/`.
- **Lint**: periodic health check for contradictions, stale claims, orphan pages, missing
  pages for repeatedly-mentioned entities/concepts, missing cross-references, and data gaps.

## 4. Current wiki content snapshot

- **75 raw sources** ingested, **75 `wiki/sources/` pages**, **74 `wiki/entities/` pages**,
  **8 `wiki/concepts/` pages** (Team 7, Team 8, Team 10, Team Guy, Akatsuki, Three Sand
  Siblings, Tailed Beasts, Taka), **0 `wiki/syntheses/` pages** filed so far.
- Coverage spans: the Team 7 core and their senseis/mentors, Team 8, Team 10, Team Guy, the
  full Akatsuki roster (all four leadership eras), the Sand Siblings, all nine Tailed
  Beasts, Sasuke's team Taka, the other Great Villages' Kage-tier cast (Mizukage, Raikage
  lines), and major antagonists/supporting cast (Danzō, Kabuto, Kaguya, Zabuza, Haku, Killer
  B, Shizune, Anko, Chiyo).
- Deliberately **not yet covered**: Boruto-era characters (Boruto, Mitsuki, Konohamaru, the
  Boruto-generation genin) and the Ōtsutsuki antagonists (Momoshiki, Kinshiki, Urashiki,
  Isshiki), held out per the user's explicit request during the 2026-09-10 batch ingest.
- **Open threads tracked in `wiki/index.md`**: the entire surviving original Team 7 is
  mid-crisis in the most recently ingested *New Era: Part II* material — Naruto and Sasuke
  both incapacitated/missing, Boruto imprisoned as a suspected traitor; Shikamaru Nara is
  confirmed **provisional Eighth Hokage** (three-year appointment) and is secretly running a
  covert operation to clear Boruto after learning the village's belief in his guilt stems
  from a memory-altering antagonist technique ("Ada's Omnipotence"); Himawari Uzumaki is
  confirmed the new Nine-Tails jinchūriki because Kurama was reborn within her; Hidan is the
  one Akatsuki member left alive (buried, starving) with no follow-up source yet.
- As of the 2026-09-11 ingest log entry, **no raw sources remain unfiled**.

## 5. `wiki/index.md` and `wiki/log.md`

- **`wiki/index.md`** is the primary navigation aid: a catalog of every wiki page organized
  by category (Sources / Entities / Concepts / Syntheses), each entry a wikilink plus a
  one-line summary and last-updated date, followed by an "Open threads / unresolved"
  section tracking cross-cutting questions the wiki hasn't settled yet. It is read first for
  every query per the schema's Query workflow, and updated on every ingest.
- **`wiki/log.md`** is an append-only chronological record, one entry per operation, in the
  format `## [YYYY-MM-DD] <ingest|query|lint|schema> | <short description>`. The current log
  documents the full history of this vault: initial setup (2026-09-04), the first ingest
  wave (Team 7 core through Hokage-line sources), the access-tier schema additions and a
  since-corrected overreach (2026-09-07), the 2026-09-10 batch ingest of 32 sources, and the
  2026-09-11 gap-closing ingest that cleared the last five unfiled raw sources.

## 6. The MCP server — architecture

One codebase (`mcp-render-server/`, Node + Express + TypeScript, `src/index.ts`), deployed
as **one Render web service** with one OAuth login page and one `client_id` per person
who connects. A second `mcp-render-server-full` service used to exist, differing only by
`BYPASS_ACCESS_TIERS=true` to disable the access-tier gate wholesale — that's been
retired in favor of a per-token `:full` flag on `MCP_ACCESS_TOKENS` (see Layer 2 below),
so one deployment now serves both restricted and unrestricted logins depending purely on
which password someone was given.

Built with `npm install && npm run build` and started with `npm start`
(`render.yaml`'s `buildCommand`/`startCommand`); `rootDir: mcp-render-server`, so
`OBSIDIAN_VAULT_PATH` defaults to `..` (the repo root) and the server reads the vault
directly out of the deployed checkout — no separate data sync step.

### MCP tools exposed

| Tool | Behavior |
| --- | --- |
| `get_server_status` | Trivial health check. |
| `list_notes` | Lists every `.md` file under the vault root (`raw/` + `wiki/`), skipping `.obsidian`, `node_modules`, `.git`. Restricted files are still listed but tagged `[restricted]` — existence isn't hidden, only content. |
| `read_note` | Reads one file by vault-relative path. Sandboxed to the vault root; rejects paths outside it or non-`.md` files. |
| `search_notes` | Case-insensitive full-text search across every readable file. |
| `db_add_note` / `db_edit_note` / `db_delete_note` / `db_list_notes` | The server's only write tools. Scoped to a single Postgres table, `mcp_notes`, via hardcoded parameterized SQL — cannot reach `wiki/`, `raw/`, or the `wiki_pages`/`raw_files` tables `db-sync/` maintains. Requires the optional `DATABASE_URL` env var; see ARCHITECTURE.md's "Layer 3" for the full design. |

### Layer 1 — access-tier gating (per-character content control)

Purpose: let the vault owner hide specific characters' content from the shared connector,
independent of who can connect at all.

- Any `wiki/entities/*.md` or `wiki/concepts/*.md` page carries `access_tier: restricted` in
  its frontmatter. The server has **no hardcoded list** — it scans both directories on every
  request (`getRestrictedCharacterNames()`) and treats whatever it finds as current truth.
  Gating/ungating a character is therefore a wiki-content commit, not a server config change.
- For an entity page, gating covers three files by name-matching
  (`characterKeyForPath()`): `wiki/entities/<Name>.md`, `wiki/sources/<Name> (source).md`,
  and `raw/<Name>.md`. For a concept page (used when a whole team page is inseparable from
  restricted members, e.g. Team 7), only the concept file itself is gated.
- `read_note` on a locked file returns an `isError` result. `search_notes` skips locked
  files entirely — never appears in results. `list_notes` still lists locked paths, appended
  `[restricted]`.
- **Unlocking**: `UNLOCKED_CHARACTERS` (Render env var, `sync: false`, never committed) is a
  comma-separated list of character names matching their entity-page title, or the literal
  `ALL`. Only matters for non-`:full` tokens (see Layer 2) — a `:full` token bypasses this
  gate outright. Requires a Render dashboard edit + redeploy (~1-2 min) — deliberately not
  something Claude can do itself.
- **Currently gated (12 characters)**: Naruto Uzumaki, Sasuke Uchiha, Sakura Haruno, Kakashi
  Hatake, Jiraiya, Tsunade, Might Guy, Itachi Uchiha (Team 7 core + mentors), plus the full
  Hokage line — Hashirama Senju, Tobirama Senju, Hiruzen Sarutobi, Minato Namikaze. (A
  2026-09-07 attempt to extend this to all 45 entity pages was reverted the same day as a
  misread of the user's intent — only these 12 are meant to be gated.)
- **Cross-reference leak fix** (2026-09-09/10): gating a character's own 3 files didn't stop
  their facts leaking through other unrestricted pages' cross-references (a single source can
  touch 10-15 pages). Fixed by (1) redacting disclosed facts on unrestricted pages in place —
  the `[[wikilink]]` stays, the facts become a generic description plus
  `(see [[X]] — access restricted)` — and (2) gating wholesale any page that is *entirely*
  about a restricted character with no independent content (e.g. `Team 7.md`, `Kurama.md`,
  `Rin Nohara.md`).
- **`wiki/index.md`/`wiki/log.md` special case**: too costly to gate wholesale (they're
  navigation/append-only pages), so the server does **line-level redaction** at serve time
  (`LINE_FILTERED_PATHS`, `redactRestrictedLines()`) — any line matching a restricted
  character's name (word-boundary matched) is replaced with a placeholder before being
  returned; the file on disk is untouched.

### Layer 2 — access tokens (who's allowed to connect at all)

Purpose: independent of what a connected client can see, control who can connect at all.
Replaced a single shared `MCP_API_KEY` (commit `73bed36`) because rotating a shared secret
to revoke one person broke everyone's access.

- `MCP_ACCESS_TOKENS` (Render env var, `sync: false`) holds a comma-separated
  `label=token` list (e.g. `you=abc123:full,alice=def456`). Every request to `/mcp`
  (`resolveAccessLabel()`) must present a matching token via `Authorization: Bearer <token>`
  or `?key=<token>`. **Fail-closed**: no "unset means open" fallback — empty env var rejects
  every request, logged as a startup warning. A token's value can end in `:full`
  (`parseAccessTokens()` parses this into `{ label, full }`) to mark that person's logins
  as bypassing the Layer 1 gate entirely — this is the whole mechanism for per-person
  access level now that there's one deployment instead of two.
- **OAuth 2.1** (added on the `add-oauth` branch, extended to carry the per-token `full`
  flag): the service is its own minimal authorization server — authorization code grant,
  PKCE (S256) required, dynamic client registration (RFC 7591), plus RFC 9728/8414
  discovery documents so an MCP client can discover everything from a 401 on `/mcp`.
  Endpoints: `GET /.well-known/oauth-protected-resource`, `GET
  /.well-known/oauth-authorization-server`, `POST /register`, `GET`/`POST /authorize`
  (login form checks against `MCP_ACCESS_TOKENS`), `POST /token` (code exchange and
  refresh). OAuth-issued tokens are checked by the same `resolveToken()` path as static
  ones, so Layer 1 applies based on the `full` flag carried forward from the original
  login token — through the auth code, into the issued access token, and preserved across
  a refresh-token rotation — regardless of login method. When `DATABASE_URL` is set, this
  state (including the `full_access` column) persists to Postgres instead of the
  in-memory fallback, surviving Render's free-tier idle spin-down.
- **Adding a person**: generate a random token, append `label=token` (or
  `label=token:full` for full access) to `MCP_ACCESS_TOKENS`, save (redeploys), give them
  the token. **Revoking**: delete their entry, save — takes effect on the next request
  since the transport is stateless (`sessionIdGenerator: undefined`). **Changing access
  level**: add/remove `:full` on their entry and save — only affects new logins, not
  tokens already issued.
- **Auditing**: every accepted request logs `MCP request from "<label>"` (plus `(full
  access)` when applicable) to the service's log stream.
- Per-token scoping is the whole mechanism now: a token without `:full` still goes
  through the Layer 1 gate; a token with `:full` bypasses it entirely, regardless of
  which client or URL was used to connect.

### How the two layers interact

```
Request → /mcp
   ├─ Layer 2: resolveAccessLabel(req)
   │     no match → 401, stop
   │     match → continue, log the label
   └─ Layer 1 (per tool call, not per-connection):
         list_notes   → mark restricted paths [restricted], don't hide them
         read_note    → restricted file → isError; else return content
                         (index.md/log.md line-redacted first)
         search_notes → restricted files silently excluded
                         (index.md/log.md line-redacted before match check)
```

Orthogonal by design: Layer 2 answers "can this connection talk to the server at all, and
at what access level," Layer 1 answers "which characters can this specific login see."

## 7. `render.yaml` (Render Blueprint)

Defines the service declaratively at the repo root:

```yaml
services:
  - type: web
    name: mcp-render-server
    runtime: node
    plan: free
    rootDir: mcp-render-server
    buildCommand: npm install && npm run build
    startCommand: npm start
    healthCheckPath: /
    envVars:
      - key: NODE_VERSION
        value: 22.10.0
      - key: SERVICE_NAME
        value: tiered
      - key: MCP_ACCESS_TOKENS
        sync: false
      - key: DATABASE_URL
        sync: false
```

`MCP_ACCESS_TOKENS` is `sync: false` — never committed to the repo, only ever set
directly in the Render dashboard, with an optional `:full` suffix per token to grant that
person full access (see Layer 2 above).

### Deployment notes

- **Blueprint deploy**: Render dashboard → New → Blueprint → connect repo, deploys the
  service from `render.yaml`.
- **Auto-deploy**: pushing to `main` triggers a redeploy automatically.
- **Free tier**: spins down after inactivity — first request after idle takes ~30-50s to
  wake back up. Env var or git-push redeploys take ~1-2 minutes to land.
- **Vault path**: `OBSIDIAN_VAULT_PATH` defaults to the parent of `mcp-render-server/`,
  correct as long as Render's Root Directory is `mcp-render-server` — the server reads the
  vault straight out of the deployed repo checkout.
- **Current live URL** (confirmed 2026-09-09, but Render can reassign — verify against the
  dashboard before trusting in a new session): `mcp-render-server` →
  `https://mcp-render-server-3zn0.onrender.com`. A second `mcp-render-server-full` service
  predates the per-token `:full` flag and has been removed from `render.yaml`; delete it
  from the Render dashboard too if it's still running there.

## 8. `mcp-render-server/` package details

- **Runtime**: Node ≥18 (deployed with Node 22.10.0 per `render.yaml`), ESM (`"type":
  "module"`), TypeScript compiled via `tsc` to `dist/index.js`.
- **Dependencies**: `@modelcontextprotocol/sdk` (^1.30.0), `express` (^5.2.1), `zod`
  (^4.5.4).
- **Dev dependencies**: `@types/express`, `@types/node`, `typescript`, `tsx` (for
  `npm run dev` — watch mode, no build step).
- **Scripts**: `build` (`tsc`), `start` (`node dist/index.js`), `dev` (`tsx watch
  src/index.ts`).
- **`src/index.ts`** is the entire server implementation (694 lines): builds the MCP server
  (`buildServer()`), the four tools, the vault file-walking/sandboxing logic, both gating
  layers, and the full OAuth 2.1 authorization-server implementation, all in one file.
- Sandboxing: all file access is restricted to the vault root and `.md` files only.

## 9. Connecting to the server as a Claude client

- **Claude.ai / Claude Desktop (recommended, OAuth)**: Settings → Connectors → Add custom
  connector → enter the base URL `https://<service>.onrender.com/mcp` with no token. Claude
  discovers OAuth support, registers itself, opens the sign-in page — enter a token from
  `MCP_ACCESS_TOKENS`. Must also toggle the connector's tools on for the specific chat.
- **Claude Code CLI (static token)**:
  ```bash
  claude mcp add --transport http naruto-wiki https://<service>.onrender.com/mcp --header "Authorization: Bearer <token>"
  ```
- **Legacy query-token form** (clients without a header field or OAuth support):
  `https://<service>.onrender.com/mcp?key=<token>`.
- Give each person their own token so one person's access can be revoked without affecting
  anyone else's — applies whether they connect via OAuth or a static token, since both draw
  from the same `MCP_ACCESS_TOKENS` list.

## 10. Known gaps / things to watch

- `MCP_ACCESS_TOKENS` values are plaintext in the Render dashboard; real tokens should never
  be committed to the repo or pasted into wiki content.
- Access-tier redaction on `index.md`/`log.md` is best-effort word-boundary pattern
  matching — a sufficiently indirect description of a restricted character elsewhere in
  prose could still leak facts. Any newly ingested source touching a restricted character
  should be checked for this before being left unredacted.
- Token revocation and character unlocking both require a Render dashboard edit — no in-repo
  or in-chat mechanism for either, by design, to keep both controls outside Claude's own
  tool surface.
- OAuth client registrations, issued access tokens, and refresh tokens are in-memory `Map`s
  with no persistence and no size cap — acceptable at the current small scale, but would
  need a real store (and pruning) before handing the OAuth flow to a larger or untrusted set
  of clients. Auth codes are pruned lazily on each `/authorize`/`/token` call; the other maps
  are not.
- `wiki/syntheses/` is currently empty — no substantive query has yet been filed back into
  the wiki as a synthesis page.
- Boruto-era characters and the Ōtsutsuki antagonists remain entirely unfiled, held out
  deliberately pending a future ingest pass.

## 11. Source-of-truth notes for this file

This file is a snapshot compiled from `CLAUDE.md`, `ARCHITECTURE.md`, `README.md`,
`mcp-render-server/README.md`, `render.yaml`, `mcp-render-server/package.json`,
`wiki/index.md`, and `wiki/log.md` as of 2026-09-11. It is descriptive, not authoritative —
if it and any of those source files disagree, the source file wins. It is not itself part of
the wiki's `raw/`/`wiki/` schema and does not need to be kept in sync on every ingest; treat
it as a point-in-time onboarding document, regenerable on request.
