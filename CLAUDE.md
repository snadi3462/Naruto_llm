# LLM Wiki — Schema

This vault is a personal knowledge base maintained by you (the LLM agent), not by the user.
The user curates sources and asks questions. You do all reading, summarizing, filing, and
cross-referencing. Follow this schema every session — it is the contract that keeps the
wiki coherent across time.

## The three layers

1. **`raw/`** — source documents. Immutable. Never edit or delete files here. Web clips,
   PDFs, notes the user drops in, images. This is ground truth; if the wiki and a raw
   source ever disagree, the raw source wins and the wiki page must be corrected.
2. **`wiki/`** — everything you write: summaries, entity pages, concept pages, comparisons,
   syntheses, `index.md`, `log.md`. You own this layer entirely. The user reads it; you
   maintain it.
3. **`CLAUDE.md`** (this file) — the schema. Update it yourself when you and the user agree
   on a new convention, a new folder, or a new workflow. Keep it in sync with what the
   wiki actually does.

## Folder conventions

```
raw/                      immutable sources (web clips, PDFs, notes, images)
  assets/                 downloaded images referenced by raw clips
wiki/
  index.md                catalog of every wiki page, by category
  log.md                  append-only chronological record of ingests/queries/lints
  sources/                one page per ingested source: summary + key takeaways + link to raw/
  entities/                one page per person/character/org/place — anything with an identity
  concepts/               one page per theme, topic, or idea that spans multiple sources
  syntheses/              answers to substantive questions, comparisons, analyses — filed
                           back into the wiki instead of left in chat history
CLAUDE.md                 this schema file
```

Page filenames are the page title in Title Case, e.g. `wiki/entities/Naruto Uzumaki.md`.
Use Obsidian's `[[Page Name]]` wikilink syntax for all cross-references so the graph view
and backlinks work.

## Page format

Every wiki page starts with YAML frontmatter:

```yaml
---
type: source | entity | concept | synthesis
tags: []
access_tier: restricted   # optional — omit for normal pages, see Access tiers below
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: []            # wikilinks to wiki/sources/ pages this page draws on
---
```

Body is plain markdown. Entity and concept pages should end with a `## Sources` section
listing the `wiki/sources/` pages they were built or updated from. Note contradictions
inline where they occur (e.g. "Per [[Source A]] X happened in 1998; [[Source B]] gives 2001 —
unresolved") rather than silently picking one.

### Access tiers

An entity page can carry `access_tier: restricted` in its frontmatter to gate that
character's data behind the `mcp-render-server`'s `UNLOCKED_CHARACTERS` environment
variable — see `mcp-render-server/README.md` for how the server enforces this (it also
covers the matching `wiki/sources/` and `raw/` files for that character by name). Absence
of the field means the page is unrestricted; this is the default for all pages. Setting
this field is a deliberate, user-directed action — don't add `access_tier: restricted` to
a page unless the user asks for that character to be gated.

## Operations

### Ingest (adding a new source)

1. Read the raw source fully (and its images, if any — see Images below).
2. Discuss key takeaways with the user briefly before writing anything, unless they've
   asked for unsupervised batch ingestion.
3. Write (or update) `wiki/sources/<Source Title>.md` — a summary page with key facts and
   a link back to the `raw/` file.
4. Update every `wiki/entities/` and `wiki/concepts/` page this source touches: add new
   facts, add cross-references, flag contradictions with prior claims, create new pages
   for entities/concepts that don't have one yet.
5. Update `wiki/index.md` with the new/changed pages.
6. Append an entry to `wiki/log.md`.

A single source can reasonably touch 10-15 pages — that's expected, not a sign of scope
creep.

### Query (answering a question)

1. Read `wiki/index.md` first to find candidate pages — don't re-derive from `raw/` unless
   the wiki doesn't yet cover the question.
2. Read the relevant wiki pages (and drill into `raw/` sources only if the wiki page is
   thin or you need a direct quote).
3. Synthesize an answer with citations to the wiki pages (and raw sources where relevant).
4. If the answer is substantive (a comparison, an analysis, a non-trivial synthesis), offer
   to file it into `wiki/syntheses/` as a new page, cross-linked from the pages it touches
   and from `index.md`. Don't file trivial answers.

### Lint (periodic health check)

When asked to lint the wiki, check for:
- Contradictions between pages
- Stale claims superseded by newer sources
- Orphan pages with no inbound links
- Concepts/entities mentioned repeatedly but lacking their own page
- Missing cross-references between pages that clearly relate
- Data gaps a web search or new source could fill

Report findings and propose fixes; apply them if the user agrees.

## Images

Markdown with inline images can't be read in one pass. When a raw source has images: read
the text first, then view referenced images separately (via `raw/assets/`) if they matter
to the summary.

## index.md conventions

Organize by category (Sources / Entities / Concepts / Syntheses). Each entry: a wikilink,
a one-line summary, and the date last updated. Update on every ingest — this is the primary
navigation aid for queries, so keep it current and don't let it drift from what actually
exists in `wiki/`.

## log.md conventions

Append-only. One line per entry, most recent at the bottom, in this exact format so it
stays greppable:

```
## [YYYY-MM-DD] <ingest|query|lint> | <short description>
```

Optionally a sentence or two beneath the header noting what changed.

## Working style

- Default to ingesting one source at a time, staying in the loop with the user, unless they
  ask for batch/unsupervised processing.
- Never modify `raw/`.
- Prefer editing existing wiki pages over creating near-duplicates — check `index.md` before
  creating a new page.
- Keep this file (`CLAUDE.md`) updated as conventions evolve.
