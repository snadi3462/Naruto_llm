-- Schema for syncing the secondbrain wiki filesystem into Postgres.
-- Applied automatically by watch.js on startup (CREATE TABLE IF NOT EXISTS),
-- kept here as the readable source of truth.

CREATE TABLE IF NOT EXISTS raw_files (
    path         TEXT PRIMARY KEY,      -- repo-relative path, e.g. raw/Some Clip.md
    filename     TEXT NOT NULL,
    extension    TEXT,
    content      TEXT,                  -- NULL for binary files (images, PDFs)
    size_bytes   BIGINT NOT NULL,
    file_mtime   TIMESTAMPTZ NOT NULL,  -- filesystem mtime
    synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wiki_pages (
    path         TEXT PRIMARY KEY,      -- repo-relative path, e.g. wiki/entities/Jiraiya.md
    filename     TEXT NOT NULL,
    category     TEXT,                  -- sources | entities | concepts | syntheses | (root)
    type         TEXT,                  -- frontmatter: type
    tags         TEXT[],                -- frontmatter: tags
    access_tier  TEXT,                  -- frontmatter: access_tier
    created      DATE,                  -- frontmatter: created
    updated      DATE,                  -- frontmatter: updated
    sources      TEXT[],                -- frontmatter: sources (wikilinks)
    frontmatter  JSONB,                 -- full parsed frontmatter, for anything not modeled above
    content      TEXT NOT NULL,         -- markdown body (without frontmatter)
    raw_content  TEXT NOT NULL,         -- full file including frontmatter
    file_mtime   TIMESTAMPTZ NOT NULL,
    synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_category ON wiki_pages (category);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_type ON wiki_pages (type);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_tags ON wiki_pages USING GIN (tags);

-- OAuth 2.1 state for mcp-render-server, applied automatically by that
-- service (ensureOAuthSchema() in src/index.ts) — kept here for the same
-- reason as above, not something db-sync itself reads or writes.
--
-- mcp-render-server is a single deployment with a single OAuth login page and
-- client_id; every row is scoped by service_name (set via the SERVICE_NAME
-- env var in render.yaml) purely so a second deployment could safely share
-- this same Postgres instance without its tokens/clients resolving here.
--
-- full_access on the auth-code/token/refresh-token tables carries the
-- per-login access level end to end: a login token in MCP_ACCESS_TOKENS can
-- be marked ":full" (e.g. "you=abc123:full"), and that flag rides along
-- through the auth code, the issued access token, and its refresh token, so
-- one login page can serve both restricted and unrestricted logins — the
-- password decides the access level, not which token/URL was used.

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
    label          TEXT NOT NULL,       -- which MCP_ACCESS_TOKENS entry logged in
    full_access    BOOLEAN NOT NULL DEFAULT false,
    client_id      TEXT NOT NULL,
    redirect_uri   TEXT NOT NULL,
    code_challenge TEXT NOT NULL,       -- PKCE S256 challenge
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
