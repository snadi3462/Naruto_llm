# Architecture

A complete technical reference for how this repo is put together: the vault's content
layers, the remote MCP servers that expose it, and the two independent gating systems
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
render.yaml               Render Blueprint: defines both deployed services
```

## The two deployed services

One codebase (`mcp-render-server/`), two independent Render web services, differing
only by environment variables:

| Service | Env vars that differ | Behavior |
| --- | --- | --- |
| `mcp-render-server` | (none beyond the shared ones) | Access-tier gate **enforced** — the 12 restricted characters (plus any concept pages marked `access_tier: restricted`) stay locked unless unlocked. This is the connector shared around day to day. |
| `mcp-render-server-full` | `BYPASS_ACCESS_TIERS=true` | Access-tier gate **disabled** entirely — everything in the vault is readable. This is the private/admin connector. |

Both are defined in `render.yaml` and built with the same `buildCommand`
(`npm install && npm run build`) and `startCommand` (`npm start`). Render assigns each
its own URL at creation time (these have changed at least once already — see
"Current live URLs" below — so always confirm from the Render dashboard rather than
trusting an old URL).

## MCP tools exposed

Both services expose the same four tools (`mcp-render-server/src/index.ts`,
`buildServer()`):

| Tool | Behavior |
| --- | --- |
| `get_server_status` | Trivial health check. |
| `list_notes` | Lists every `.md` file under the vault root (walking `raw/` and `wiki/`, skipping `.obsidian`, `node_modules`, `.git`). Restricted files are still listed, tagged `[restricted]` — their existence isn't hidden, only their content. |
| `read_note` | Reads one file by vault-relative path. Sandboxed to the vault root; rejects anything outside it or non-`.md` files. |
| `search_notes` | Case-insensitive full-text search across every readable file. |

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
literal `ALL`. Ignored entirely when `BYPASS_ACCESS_TIERS=true`. Changing it requires a
Render dashboard edit + redeploy (~1-2 min) — deliberately not something Claude can do
itself, since the entire point is that only the vault owner controls unlocking.

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
var (`sync: false`, per-service) holding a comma-separated `label=token` list, e.g.
`you=abc123,alice=def456`. Every request to `/mcp` (`resolveAccessLabel()`) must present
a token matching one of these entries — checked against either a static credential or an
OAuth-issued one (see "OAuth" below), via either:
- `Authorization: Bearer <token>` header, or
- `?key=<token>` query parameter (kept for clients whose connector dialog has no header
  field and don't support OAuth discovery).

There is **no "unset means open" fallback** — if `MCP_ACCESS_TOKENS` is empty, every
request is rejected (fail-closed), logged as a startup warning. This is a deliberate
change from the old `MCP_API_KEY` behavior, which defaulted to open when unset.

**OAuth (added on `add-oauth`)**: both services are also their own minimal OAuth 2.1
authorization server — authorization code grant, PKCE (S256) required, dynamic client
registration (RFC 7591), plus the resource/authorization-server metadata documents
(RFC 9728 / RFC 8414) that let an MCP client discover all of this from a 401 on `/mcp`
alone. Concretely, per service:

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
on Render). OAuth-issued access tokens are checked by the exact same code path as static
ones (`resolveToken()`), so Layer 1's access-tier gate applies identically regardless of
which login method produced the bearer token.

All OAuth state (`oauthClients`, `authCodes`, `issuedAccessTokens`,
`issuedRefreshTokens`) is in-memory only, by design — no database. The tradeoff: Render's
free-tier idle spin-down kills and restarts the process, wiping this state, so anyone
connected via OAuth has to redo the browser login after a spin-down. Clients using a
static bearer/query token are unaffected, since those are re-validated against the env
var on every request rather than looked up in memory.

**Adding a person**: generate a random token
(`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`),
append `label=token` to `MCP_ACCESS_TOKENS` on whichever service(s) they should reach,
save (triggers redeploy), give them their token.

**Revoking a person**: delete their `label=token` entry from the same env var, save.
Their token stops working on the very next request once the redeploy lands (~1-2 min)
— the transport is stateless (`sessionIdGenerator: undefined`), so there's no lingering
session to invalidate. Must be done per-service if they had access to both.

**Auditing**: every accepted request logs `MCP request from "<label>"` to the service's
console/log stream — a lightweight way to see who's actually using a connector, with no
separate database.

All tokens are equally privileged (no per-token scoping) — a valid token on
`mcp-render-server` still goes through the access-tier gate above; a valid token on
`mcp-render-server-full` bypasses it entirely.

## How the two layers interact

```
Request → /mcp
   │
   ├─ Layer 2: resolveAccessLabel(req)
   │     no match → 401, stop here
   │     match → continue, log the label
   │
   └─ Layer 1 (per tool call, not per-connection):
         list_notes   → mark restricted paths [restricted], don't hide them
         read_note    → restricted file → isError; else return content
                         (index.md/log.md get line-redacted first)
         search_notes → restricted files silently excluded from results
                         (index.md/log.md get line-redacted before the match check)
```

They're orthogonal on purpose: Layer 2 answers "is this connection allowed to talk to
the server at all," Layer 1 answers "which characters can this *specific* connector see"
— `mcp-render-server-full` and `mcp-render-server` can share the exact same
`MCP_ACCESS_TOKENS` list while still differing entirely on Layer 1.

## Deployment

- **Blueprint**: `render.yaml` at the repo root; Render dashboard → New → Blueprint →
  connect repo deploys both services from it.
- **Auto-deploy**: pushing to `main` triggers a redeploy of both services automatically
  (confirmed working — pushes to this repo have redeployed live services without manual
  intervention).
- **Free tier**: both services spin down after inactivity; first request after idle
  takes ~30-50s to wake back up. Redeploys triggered by an env var change or a git push
  take roughly 1-2 minutes to land.
- **Vault path**: `OBSIDIAN_VAULT_PATH` defaults to the parent of `mcp-render-server/`
  (correct as long as Render's Root Directory is set to `mcp-render-server`), so the
  server reads the vault directly out of the deployed repo checkout — no separate data
  sync step.
- **Current live URLs** (confirmed 2026-09-09, but Render can reassign these — verify
  against the dashboard before trusting them in a new session):
  - `mcp-render-server` → `https://mcp-render-server-3zn0.onrender.com`
  - `mcp-render-server-full` → `https://mcp-render-server-full.onrender.com`

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
- OAuth client registrations (`oauthClients`), issued access tokens, and refresh tokens
  are all in-memory `Map`s with no persistence and no size cap — acceptable at the scale
  of a handful of personal connectors, but would need a real store (and pruning) before
  handing this server's OAuth flow to a larger or untrusted set of clients. Auth codes are
  pruned lazily on each `/authorize`/`/token` call; the other maps are not.
