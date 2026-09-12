# Architecture

A complete technical reference for how this repo is put together: the vault's content
layers, the remote MCP server that exposes it, and the two independent gating systems
that control who can read what. See [`CLAUDE.md`](./CLAUDE.md) for the wiki's editorial
schema (folder conventions, page format, ingest workflow) — this file covers the
system that serves that content remotely.

## Repo layout

```
raw/                      immutable source clips (web pages, fan-wiki pages, images)
  assets/                 downloaded images referenced by raw clips
wiki/
  index.md                catalog of every wiki page, by category
  log.md                  append-only chronological record of ingests/queries/lints
  sources/                one page per ingested source: summary + key takeaways + link to raw/
  entities/               one page per person/character/org/place
  concepts/               one page per theme/team/org spanning multiple sources
  syntheses/              answers to substantive questions, filed back into the wiki
CLAUDE.md                 the wiki's editorial schema/contract
ARCHITECTURE.md           this file
README.md                 project overview
mcp-render-server/        the MCP server (Node/Express/TypeScript) exposing the vault
  src/index.ts            the entire server implementation
  README.md               MCP-server-specific setup/ops documentation
render.yaml               Render Blueprint: defines the deployed service
```

## The deployed service

One codebase (`mcp-render-server/`), one Render web service, one OAuth authorization
server, one `client_id` per person who connects. There used to be a second
`mcp-render-server-full` service that disabled access tiers wholesale
(`BYPASS_ACCESS_TIERS=true`); that's been retired in favor of a per-token flag so a
single deployment can serve both restricted and unrestricted logins — see "Layer 2:
access tokens" below for how `:full` on a token decides this per person instead of
per URL.

Defined in `render.yaml`, built with `npm install && npm run build` and started with
`npm start`. Render assigns it a URL at creation time (this has changed at least once
already — see "Current live URL" below — so always confirm from the Render dashboard
rather than trusting an old URL).

## MCP tools exposed

The service exposes eight tools (`mcp-render-server/src/index.ts`,
`buildServer()`):

| Tool | Behavior |
| --- | --- |
| `get_server_status` | Trivial health check. |
| `list_notes` | Lists every `.md` file under the vault root (walking `raw/` and `wiki/`, skipping `.obsidian`, `node_modules`, `.git`). Restricted files are still listed, tagged `[restricted]` — their existence isn't hidden, only their content. |
| `read_note` | Reads one file by vault-relative path. Sandboxed to the vault root; rejects anything outside it or non-`.md` files. |
| `search_notes` | Case-insensitive full-text search across every readable file. |
| `db_add_note` / `db_edit_note` / `db_delete_note` / `db_list_notes` | Write/edit/delete/list rows in a single Postgres table, `mcp_notes` — see "Layer 3" below. This is the *only* write access this server exposes; `wiki/` and `raw/` remain read-only over MCP with no exceptions. |

All four `list_notes`/`read_note`/`search_notes`-style tools above only ever read the
filesystem; none of them touch Postgres. `db_*` tools only ever touch Postgres, and only
the `mcp_notes` table within it — never the filesystem, and never `wiki_pages` or
`raw_files`.

## Layer 1: access-tier gating (per-character content control)

**Purpose**: let the vault owner permanently or temporarily hide specific characters'
content from the shared connector, independent of who's allowed to connect at all.

**How a page becomes gated**: any `wiki/entities/*.md` or `wiki/concepts/*.md` page
carries `access_tier: restricted` in its YAML frontmatter. The server has no hardcoded
list — it scans both directories on every request (`getRestrictedCharacterNames()`) and
treats whatever it finds as the current source of truth. This means gating or ungating a
character is a wiki-content edit (commit + push), not a server config change.

**What gating actually blocks**: for an *entity* page (a character), the gate covers
three files by name-matching (`characterKeyForPath()`): `wiki/entities/<Name>.md`,
`wiki/sources/<Name> (source).md`, and `raw/<Name>.md`. For a *concept* page (used when a
whole team/group page is inseparable from its restricted members — see "Team 7" below),
only the concept file itself is gated, since those have no raw/sources counterpart.

- `read_note` on a locked file returns an `isError` result instead of content.
- `search_notes` skips locked files entirely — never appears in results, matching or not.
- `list_notes` still lists locked paths (existence isn't secret) but appends
  `[restricted]`.

**Unlocking**: `UNLOCKED_CHARACTERS` (a Render env var, `sync: false`, never committed)
is a comma-separated list of character names matching their entity-page title, or the
literal `ALL`. It only matters for non-`:full` tokens — see Layer 2 below — since a
`:full` token bypasses this gate outright regardless of `UNLOCKED_CHARACTERS`. Changing
it requires a Render dashboard edit + redeploy (~1-2 min) — deliberately not something
Claude can do itself, since the entire point is that only the vault owner controls
unlocking.

**The cross-reference leak problem (fixed 2026-09-09/10, commits `c01a790`–`a63491d`)**:
gating a character's own 3 files does *not* stop their facts from being readable via
*other* unrestricted pages that mention them — the wiki's own convention of heavy
cross-referencing (a single source can touch 10-15 pages) meant a restricted character's
biography was often fully reconstructable from other characters' pages. Two fixes:
1. Every unrestricted page that discloses a restricted character's specific facts was
   redacted in place — the `[[wikilink]]` stays (existence of the relationship isn't
   secret) but the disclosed facts are replaced with a generic description plus
   `(see [[X]] — access restricted)`.
2. Pages that are *entirely* about a restricted character with no independent content
   (e.g. `wiki/concepts/Team 7.md` — all four members restricted; `wiki/entities/
   Kurama.md` and `Rin Nohara.md` — inseparable from Naruto's and Kakashi's stories
   respectively) were gated wholesale instead of redacted, since redaction would have
   left an empty shell.

**`wiki/index.md` and `wiki/log.md`** are a special case: as operational/navigation
pages (not character lore), gating them wholesale was judged too costly — `index.md` is
the primary nav aid, `log.md` is explicitly append-only per its own convention. Instead
the server does **line-level redaction** at serve time (`LINE_FILTERED_PATHS`,
`redactRestrictedLines()`): any line matching a restricted character's name (full name,
first word, or last word, word-boundary matched, skipping unlocked names) is replaced
with a placeholder before the content is returned — the file on disk is untouched.

## Layer 2: access tokens (who's allowed to connect at all)

**Purpose**: independent of what a connected client can see, control *who can connect in
the first place*. Replaced a single shared `MCP_API_KEY` (commit `73bed36`,
2026-09-10) because a single shared secret meant rotating it to revoke one person broke
everyone's access at once.

**Mechanism** (`mcp-render-server/src/index.ts`): `MCP_ACCESS_TOKENS` is a Render env
var (`sync: false`) holding a comma-separated `label=token` list, e.g.
`you=abc123:full,alice=def456`. Every request to `/mcp` (`resolveAccessLabel()`) must
present a token matching one of these entries — checked against either a static
credential or an OAuth-issued one (see "OAuth" below), via either:
- `Authorization: Bearer <token>` header, or
- `?key=<token>` query parameter (kept for clients whose connector dialog has no header
  field and don't support OAuth discovery).

There is **no "unset means open" fallback** — if `MCP_ACCESS_TOKENS` is empty, every
request is rejected (fail-closed), logged as a startup warning. This is a deliberate
change from the old `MCP_API_KEY` behavior, which defaulted to open when unset.

A token's value can carry an optional `:full` suffix (`abc123:full`) — parsed by
`parseAccessTokens()` into `{ label, full }` — which marks that specific person's
logins as bypassing Layer 1's access-tier gate entirely, while every other token still
goes through it. This is what replaced the old two-service split: one deployment, one
`MCP_ACCESS_TOKENS` list, per-token access level instead of per-URL.

**OAuth (added on `add-oauth`, extended to carry per-token access level)**: the service
is also its own minimal OAuth 2.1 authorization server — authorization code grant, PKCE
(S256) required, dynamic client registration (RFC 7591), plus the
resource/authorization-server metadata documents (RFC 9728 / RFC 8414) that let an MCP
client discover all of this from a 401 on `/mcp` alone. Concretely:

- `GET /.well-known/oauth-protected-resource` and `GET /.well-known/oauth-authorization-server`
  — discovery documents; `/mcp`'s `401` response carries a `WWW-Authenticate: Bearer
  resource_metadata="..."` header pointing at the former.
- `POST /register` — a client self-registers with a `redirect_uris` list and gets back a
  `client_id`; no client secret (public client, relies on PKCE instead).
- `GET /authorize` — validates `client_id`/`redirect_uri`/PKCE params, then serves an
  HTML login form asking for one of the `MCP_ACCESS_TOKENS` values as the credential.
  `POST /authorize` checks it against `ACCESS_TOKENS` and, on success, redirects back to
  the client with a single-use authorization code (5 min TTL).
- `POST /token` — `authorization_code` grant exchanges the code (PKCE-verified) for an
  access token (1 hour TTL) and refresh token; `refresh_token` grant rotates both.

The login step is deliberately just the existing token list wearing a form instead of a
header/query string — adding or revoking a person is unchanged (edit `MCP_ACCESS_TOKENS`
on Render). Because there's a single deployment, everyone registers against the same
`/register` endpoint and effectively shares one login surface and `client_id` per
connector — what changes per person is which password (token) they were given, not
which URL or client_id they use. The login token's `full` flag is carried forward
through the whole exchange: `POST /authorize` looks it up (`loginEntry.full`), stores it
on the auth code (`createAuthCode`), `POST /token` copies it onto the issued access token
and refresh token (`issueTokenPair(label, full)`), and a refresh-token grant preserves it
across rotation (`consumeRefreshToken` returns `{ label, full }`). OAuth-issued access
tokens are checked by the exact same code path as static ones (`resolveToken()`), so
Layer 1's access-tier gate applies based on that carried-forward flag regardless of
which login method produced the bearer token.

**Persistence**: when `DATABASE_URL` is set, all OAuth state (clients, auth codes, access
tokens, refresh tokens) is persisted to Postgres — the same database Layer 3 and
`db-sync/` use — in four tables (`oauth_clients`, `oauth_auth_codes`,
`oauth_access_tokens`, `oauth_refresh_tokens`, schema in `db-sync/schema.sql`,
auto-applied via `ensureOAuthSchema()`, including a `full_access BOOLEAN` column on the
latter three added when the per-token access level was introduced), so Render's
free-tier idle spin-down no longer forces anyone connected via OAuth to redo the browser
login. Every row carries a `service_name` column (from the `SERVICE_NAME` env var) as
part of its primary key — kept so a second deployment could safely share the same
`DATABASE_URL` without its tokens/clients resolving here, though today only one
deployment exists. Expired auth codes and access tokens are swept by a `setInterval`
every 15 minutes; refresh tokens are deleted on use (single-use rotation). If
`DATABASE_URL` is unset, OAuth state falls back to the original in-memory `Map`s
(`memClients`, `memAuthCodes`, `memAccessTokens`, `memRefreshTokens`), which do still
reset on every spin-down. Clients using a static bearer/query token are unaffected
either way, since those are re-validated against the env var on every request rather
than looked up in stored state.

**Adding a person**: generate a random token
(`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` —
base64url output never contains a colon, so `:full` is always safe to append), append
`label=token` (or `label=token:full` for someone who should bypass access tiers) to
`MCP_ACCESS_TOKENS`, save (triggers redeploy), give them their token.

**Revoking a person**: delete their `label=token` entry from the same env var, save.
Their static token, and any OAuth access/refresh tokens issued from logging in with it,
stop working on the very next request once the redeploy lands (~1-2 min) — the transport
is stateless (`sessionIdGenerator: undefined`), so there's no lingering session to
invalidate.

**Changing a person's access level**: add or remove `:full` on their existing entry and
save. This only takes effect for new logins — an OAuth access token already issued
keeps the access level it was issued with until it expires (up to 1 hour) or they log
in again.

**Auditing**: every accepted request logs `MCP request from "<label>"` (with `(full
access)` appended when applicable) to the service's console/log stream — a lightweight
way to see who's actually using the connector and at what level, with no separate
database.

Per-token scoping is now the whole mechanism for access level: a token without `:full`
still goes through the access-tier gate above; a token with `:full` bypasses it
entirely, regardless of which client or URL was used to connect.

## Layer 3: the scratchpad database (scoped write access)

**Purpose**: give an authenticated MCP client somewhere it can actually write, without
that becoming a way to write, edit, or delete anything in the vault. `wiki/` is owned by
Claude per `CLAUDE.md` and `raw/` is immutable by convention — neither should ever be
reachable by a write tool, no matter how that tool is invoked.

**How it's scoped**: `db_add_note` / `db_edit_note` / `db_delete_note` / `db_list_notes`
(`mcp-render-server/src/index.ts`) are the only tools that touch Postgres at all, and
every one of them runs exactly one hardcoded, parameterized SQL statement against a
single table, `mcp_notes` (columns: `id`, `title`, `content`, `author`, `created_at`,
`updated_at`). No tool input is ever interpolated into a table or column name — inputs
only ever fill `$1`/`$2`/... placeholders — so there is no code path, valid or malformed
input, by which these tools can reach `wiki_pages` or `raw_files`, the two tables
`db-sync/` mirrors the vault into. There is no generic "run arbitrary SQL" tool.

**Relationship to `db-sync/`**: `db-sync/` (a separate Node process, `watch.js`) is a
one-way filesystem → Postgres mirror for `raw/` and `wiki/` — it only reads the
filesystem and writes `raw_files`/`wiki_pages`, never the reverse, and has no notion of
`mcp_notes` at all. `mcp-render-server` connects to the same `DATABASE_URL` independently
and only for the `mcp_notes` table; the two processes don't call into each other.

**Auth**: same as Layer 2 below — a `db_*` tool call still has to pass
`resolveAccessLabel()` like every other tool, since it goes through the same `/mcp`
endpoint. The resolved label is recorded as `author` on `db_add_note`, but any
authenticated caller can currently edit or delete any row (no per-author ownership check)
— acceptable for a shared scratchpad, worth revisiting if this ever needs per-person
note isolation.

**Availability**: gated on the optional `DATABASE_URL` env var. Unset → the four `db_*`
tools return a clear error when called; every other tool is unaffected. Set → the
`mcp_notes` table is created automatically (`CREATE TABLE IF NOT EXISTS`) on first use.

## How the layers interact

```
Request → /mcp
   │
   ├─ Layer 2: resolveAccessLabel(req)
   │     no match → 401, stop here
   │     match → continue, log the label
   │
   ├─ Layer 1 (per tool call, not per-connection):
   │     list_notes   → mark restricted paths [restricted], don't hide them
   │     read_note    → restricted file → isError; else return content
   │                     (index.md/log.md get line-redacted first)
   │     search_notes → restricted files silently excluded from results
   │                     (index.md/log.md get line-redacted before the match check)
   │
   └─ Layer 3 (per tool call, filesystem tools untouched):
         db_add_note / db_edit_note / db_delete_note / db_list_notes
             → single parameterized statement against mcp_notes only
             → DATABASE_URL unset → isError, no crash
```

Layers 1 and 3 are orthogonal on purpose: Layer 2 answers "is this connection allowed to
talk to the server at all" (and, via a token's `:full` flag, at what access level),
Layer 1 answers "which characters can this *specific* login see" (read-only), and
Layer 3 is a completely separate, independent write surface that never intersects the
vault's own data at all — it behaves identically regardless of a request's Layer 1
access level.

## Deployment

- **Blueprint**: `render.yaml` at the repo root; Render dashboard → New → Blueprint →
  connect repo deploys the service from it.
- **Auto-deploy**: pushing to `main` triggers a redeploy automatically (confirmed
  working — pushes to this repo have redeployed the live service without manual
  intervention).
- **Free tier**: the service spins down after inactivity; first request after idle
  takes ~30-50s to wake back up. Redeploys triggered by an env var change or a git push
  take roughly 1-2 minutes to land.
- **Vault path**: `OBSIDIAN_VAULT_PATH` defaults to the parent of `mcp-render-server/`
  (correct as long as Render's Root Directory is set to `mcp-render-server`), so the
  server reads the vault directly out of the deployed repo checkout — no separate data
  sync step.
- **Current live URL** (confirmed 2026-09-09, but Render can reassign this — verify
  against the dashboard before trusting it in a new session): `mcp-render-server` →
  `https://mcp-render-server-3zn0.onrender.com`. (A second `mcp-render-server-full`
  service existed prior to the per-token `:full` flag being introduced and has since
  been retired from `render.yaml`; if it's still running in the Render dashboard it can
  be deleted.)
- **Scratchpad DB (Layer 3)**: `DATABASE_URL` (`sync: false`) is optional — omit it to
  deploy with the `db_*` tools disabled. When set, it should point at the same Postgres
  instance `db-sync/.env`'s `DATABASE_URL` uses, so `mcp_notes` lives alongside
  `wiki_pages`/`raw_files` rather than in a separate database.

## Known gaps / things to watch

- `MCP_ACCESS_TOKENS` values are plaintext in the Render dashboard and in this doc's
  examples only as placeholders — real tokens should never be committed to the repo or
  pasted into wiki content.
- Access-tier redaction is best-effort pattern matching (word-boundary name matching on
  `wiki/index.md`/`log.md`); a sufficiently indirect description of a restricted
  character elsewhere in prose could still leak facts that weren't caught by an explicit
  redaction pass. Any newly ingested source that touches a restricted character should
  be checked for this before being left unredacted.
- Token revocation and character unlocking both require a Render dashboard edit — there
  is no in-repo or in-chat mechanism for either, by design (keeps both controls outside
  Claude's own tool surface).
- OAuth state persists to Postgres when `DATABASE_URL` is set (see "OAuth" above), with a
  periodic sweep of expired auth codes/access tokens — but only if `DATABASE_URL` is
  actually configured; if it's left unset, OAuth silently falls back to the old
  in-memory-only behavior with no warning beyond the startup log line. There's still no
  size cap on the DB-backed tables, acceptable at the scale of a handful of personal
  connectors.
- The `:full` flag lives on the token's *value*, so it's visible to whoever holds that
  token (and to the OAuth login page's server-side lookup) but not distinguishable from
  a regular token at a glance in the Render dashboard unless you know to look for the
  suffix — worth a comment or a separator convention if the token list grows much
  larger than a handful of entries.
