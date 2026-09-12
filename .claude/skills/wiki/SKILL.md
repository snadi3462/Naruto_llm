---
name: wiki
description: Operate this repo's Naruto knowledge-base wiki (raw/ → wiki/) per CLAUDE.md — ingesting a new source, answering a question from the wiki, or linting the wiki for health. Use whenever the user drops in a new source to file, asks a question the wiki should answer, or asks for a lint/health-check pass.
---

# Wiki workflow

This repo is a personal knowledge base (Naruto-themed) maintained entirely by the LLM
agent, not hand-typed by the user. The full editorial contract lives in
[`CLAUDE.md`](../../../CLAUDE.md) at the repo root — **read it before acting if you haven't
already this session**; this skill is a quick-reference operational checklist, not a
replacement for it. If this skill and `CLAUDE.md` ever disagree, `CLAUDE.md` wins — update
this file to match rather than the other way around.

## Layers (never confuse these)

- `raw/` — immutable source documents. Never edit or delete. Ground truth: if wiki and raw
  disagree, raw wins and the wiki page gets corrected.
- `wiki/` — everything you write (`sources/`, `entities/`, `concepts/`, `syntheses/`,
  `index.md`, `log.md`). You own this layer entirely.
- `CLAUDE.md` — the schema itself, evolved only when you and the user agree on a new
  convention.

## Before touching anything

Read `wiki/index.md` first — it's the catalog of every existing page and the primary
navigation aid. Don't create a near-duplicate page without checking it first.

## Operation: Ingest (a new source lands in `raw/`)

Ingestion is automatic — a new file appearing in `raw/` is itself the trigger. Whenever you
notice a `raw/` file with no corresponding `wiki/sources/<Title>.md` page (check
`wiki/index.md` and the `raw/` listing), ingest it right away without waiting for the user
to ask or pausing to discuss takeaways first. There is no separate database — "ingesting to
the database" means writing/updating the `wiki/` markdown files per this workflow, same as
always.

1. Read the raw source fully. If it has inline images, read the text first, then view
   images from `raw/assets/` separately if they matter to the summary.
2. Write or update `wiki/sources/<Source Title>.md` (frontmatter `type: source`) — summary,
   key facts, link back to the `raw/` file.
3. Update every `wiki/entities/` and `wiki/concepts/` page this source touches: add new
   facts, cross-reference with `[[Page Name]]` wikilinks, flag contradictions with prior
   claims inline (don't silently resolve them), create new pages for entities/concepts that
   don't have one yet. Expect a single source to touch 10-15 pages — that's normal.
4. Update `wiki/index.md` (its own category section, one-line summary, last-updated date).
5. Append one line to `wiki/log.md`: `## [YYYY-MM-DD] ingest | <short description>`.
6. Surface a brief after-the-fact summary to the user of what was ingested and what it
   touched — automatic doesn't mean silent.

## Operation: Query (answering a question)

1. Read `wiki/index.md` first to find candidate pages — don't re-derive from `raw/` unless
   the wiki doesn't cover the question yet.
2. Read the relevant wiki pages; drill into `raw/` only if a page is thin or you need a
   direct quote.
3. Synthesize an answer with citations to the wiki pages (and raw sources where relevant).
4. If the answer is substantive (a comparison, analysis, non-trivial synthesis), offer to
   file it into `wiki/syntheses/` as a new page, cross-linked from the pages it touches and
   from `index.md`. Don't file trivial answers.
5. Append a `## [YYYY-MM-DD] query | <short description>` line to `wiki/log.md` if you filed
   a synthesis page.

## Operation: Lint (health check)

Check for, then report findings and propose fixes (apply only if the user agrees):

- Contradictions between pages
- Stale claims superseded by newer sources
- Orphan pages with no inbound links
- Concepts/entities mentioned repeatedly but lacking their own page
- Missing cross-references between pages that clearly relate
- Data gaps a web search or new source could fill

Append a `## [YYYY-MM-DD] lint | <short description>` line to `wiki/log.md` when done.

## Page format (every wiki page)

```yaml
---
type: source | entity | concept | synthesis
tags: []
access_tier: restricted   # optional, see below — omit for normal pages
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: []               # wikilinks to wiki/sources/ pages this page draws on
---
```

Body is plain markdown; use `[[Page Name]]` wikilinks for all cross-references. Entity and
concept pages end with a `## Sources` section listing the source pages used.

## Access tiers — handle with care

`access_tier: restricted` in an entity/concept page's frontmatter gates that page (and the
matching `wiki/sources/`/`raw/` files by character name) behind the MCP server's
`UNLOCKED_CHARACTERS` env var — see `mcp-render-server/README.md` / `ARCHITECTURE.md` for
enforcement details. This is a **deliberate, user-directed action only** — never add or
remove `access_tier: restricted` on your own initiative, only when the user explicitly asks
for a character to be gated or ungated. A prior session over-applied this to all 45 entity
pages by misreading intent and had to revert it same-day — when in doubt, ask rather than
gate.

## Working style reminders

- Ingestion is automatic and unsupervised by default: an unfiled `raw/` file is its own
  trigger, don't wait to be asked. Keep the user informed after the fact rather than before.
- Never modify `raw/`.
- Prefer editing existing wiki pages over creating near-duplicates.
- If a new convention emerges and the user agrees to it, update `CLAUDE.md` itself to keep
  the schema in sync with what the wiki actually does.
