# Log

Append-only. Most recent entry at the bottom.

## [2026-09-04] setup | Wiki initialized

Created `CLAUDE.md` schema, `wiki/index.md`, `wiki/log.md`, and folder conventions
(`wiki/sources/`, `wiki/entities/`, `wiki/concepts/`, `wiki/syntheses/`). Two sources
already present in `raw/` (Naruto character pages from aniSearch and Wikipedia) awaiting
first ingest.

## [2026-09-04] ingest | List of Naruto characters (Wikipedia) + Naruto Characters (aniSearch)

First ingest, demonstrating the workflow. Filed both raw sources as `wiki/sources/` pages,
created entity pages for the Team 7 core (Naruto Uzumaki, Sasuke Uchiha, Sakura Haruno,
Kakashi Hatake) and a concept page for Team 7 covering its formation/disband/reform arc.
Did not create pages for every named character (Team 8, Team 10, Team Guy, Boruto-era, and
antagonist characters) — logged as open threads in `wiki/index.md` for a future ingest pass.

## [2026-09-04] ingest | Naruto Uzumaki (source)

New raw source (`raw/Naruto Uzumaki.md`), a detailed fan-wiki biography. Substantially
expanded the [[Naruto Uzumaki]] entity page (background, personality, abilities, Part I/II
arcs, marriage/family, becoming Hokage). Created six new entity pages touched by this source:
[[Hinata Hyuga]], [[Kurama]], [[Jiraiya]], [[Minato Namikaze]], [[Kushina Uzumaki]],
[[Kawaki]]. Updated [[Sasuke Uchiha]] and [[Kakashi Hatake]] with post-war/Kawaki-arc
details, and updated [[Team 7]] with the Kaguya fight and Valley of the End rematch.

Flagged an important status update rather than silently overwriting: the previous wiki page
treated "Naruto becomes Hokage" as a settled ending, but this source's later chapters show
Naruto losing Kurama permanently and then being trapped with Hinata in another dimension via
Kawaki/Ada, with his ultimate fate unresolved as of the source's Flashforward section. Noted
in both [[Naruto Uzumaki]] and `wiki/index.md` as an open thread to re-check against future
Boruto-era sources.

## [2026-09-04] ingest | Sasuke Uchiha, Kakashi Hatake, Sakura Haruno (source)

Three new raw sources — the same exhaustive fan-wiki biography format as the Naruto
Uzumaki ingest, one each for Sasuke, Kakashi, and Sakura. Substantially expanded all three
existing entity pages ([[Sasuke Uchiha]], [[Kakashi Hatake]], [[Sakura Haruno]]) with
background, personality, and full arc history. Created five new entity pages touched by
these sources: [[Itachi Uchiha]], [[Obito Uchiha]], [[Rin Nohara]], [[Sarada Uchiha]], and
[[Himawari Uzumaki]].

Two important cross-cutting updates:

- **Team 7's current-era crisis**: Sasuke's source reveals he's independently incapacitated
  in the same *New Era: Part II* stretch where Naruto goes missing — branded a criminal
  again, drained by a Code-created parasite while protecting Boruto. Added a "Current
  crisis" section to [[Team 7]] tying this together with Naruto's disappearance, rather than
  treating either as an isolated fact.
- **Possible Kurama successor**: Sakura's source describes Himawari Uzumaki as "the new
  Nine-Tails' jinchūriki," which doesn't obviously reconcile with Kurama's death in the
  Naruto source. Flagged as unresolved on [[Kurama]], [[Himawari Uzumaki]], and
  `wiki/index.md` rather than silently resolved either way.

Did not deep-read every chapter-by-chapter Boruto-era arc in these sources (Chūnin
Re-Examination onward) — skimmed for major plot beats only; still logged as an open thread.

## [2026-09-04] ingest | Might Guy, Sai, Yamato, Orochimaru, Tsunade, Team 8, Team 10 (source)

Seven new raw sources, all previously flagged as "named but no page yet" in `wiki/index.md`'s
open threads. Five are full fan-wiki character biographies (same exhaustive format as the
earlier Naruto/Sasuke/Kakashi/Sakura ingest); two ([[Team 8]], [[Team 10]]) are short
team-roster overview pages rather than individual biographies.

Created five new entity pages — [[Might Guy]], [[Sai]], [[Yamato]], [[Orochimaru]],
[[Tsunade]] — plus a stub [[Shikamaru Nara]] page (his role kept surfacing incidentally
across other characters' bios even though no dedicated source for him has been ingested
yet). Created two new concept pages, [[Team 8]] and [[Team 10]], for the team rosters; their
individual unnamed-page members (Kiba, Akamaru, Shino, Kurenai, Choji, Ino, Asuma) remain
open threads pending dedicated sources.

**Most significant find**: [[Sai (source)]] is the first ingested source to actually
reach the *New Era: Part II* crisis chapters (Boruto's Return Arc, Mamushi Arc) that
[[Naruto Uzumaki (source)]], [[Sasuke Uchiha (source)]], and
[[Sakura Haruno (source)]] had already flagged as the current unresolved frontier. It
fills in a real gap: **Shikamaru Nara is serving as acting/interim Hokage** while Naruto is
missing, with Sai as his security chief, and there's active political pressure (from the Fire
Daimyō's advisor Kobu) to have Shikamaru removed over suspected complicity with the
criminalized Boruto. Updated [[Team 7]]'s "Current crisis" section with this and added an
explicit note that Might Guy, Yamato, Orochimaru, and Tsunade's sources all stop earlier in
the *New Era* and do **not** confirm those characters' status during the crisis — their
absence from the crisis chapters should not be read as them being unaffected by it.

Also corroborated several existing facts from multiple independent angles: [[Tsunade
(source)]] and [[Team 10 (Asuma) (source)]] both describe the same Hidan-revenge
mission from different sides; [[Yamato (source)]] and [[Sai (source)]] both cover
the Tenchi Bridge mission from their respective character's viewpoint; [[Sai (source)]]
and [[Team 10 (Asuma) (source)]] both confirm Sai and Ino's marriage independently.

Did not create individual entity pages for every named Team 8/Team 10 member (Kiba, Akamaru,
Shino, Kurenai, Choji, Ino, Asuma) since the only source for them is a team-roster overview,
not a dedicated biography — logged as an open thread in `wiki/index.md`.

## [2026-09-04] ingest | Kiba Inuzuka, Akamaru, Shino Aburame, Kurenai Yūhi, Chōji Akimichi, Ino Yamanaka, Asuma Sarutobi, Rock Lee, Tenten, Neji Hyūga (source)

Ten new raw sources — full fan-wiki biographies for every remaining named-but-unpaged
[[Team 8]], [[Team 10]], and Team Guy member flagged as an open thread in the previous
ingest. Created ten new entity pages: [[Kiba Inuzuka]], [[Akamaru]], [[Shino Aburame]],
[[Kurenai Yūhi]], [[Chōji Akimichi]], [[Ino Yamanaka]], [[Asuma Sarutobi]], [[Rock Lee]],
[[Tenten]], and [[Neji Hyūga]] (deceased — the only Konoha 11 combat death in Part II).
Substantially expanded the previously stub-only [[Shikamaru Nara]] page using cross-
references from [[Chōji Akimichi (source)]], [[Asuma Sarutobi (source)]], and
[[Neji Hyūga (source)]] — still flagged as a stub pending a dedicated Shikamaru source.
Filled in the [[Team 8]] and [[Team 10]] concept pages' rosters with the new entity links and
created a new [[Team Guy]] concept page (previously only referenced in passing on [[Team
7]]).

**Most significant find**: [[Ino Yamanaka (source)]] reaches deep into the *New Era:
Part II* crisis chapters — deeper than any source ingested previously (including last
ingest's [[Sai (source)]]) — because Ino serves as [[Shikamaru Nara]]'s private
telepathic communications officer throughout. It:

- Independently corroborates [[Sai (source)]]'s finding that Shikamaru is acting Hokage.
- Has Boruto tell Shikamaru directly that **[[Naruto Uzumaki]] and [[Hinata Hyuga]] are
  alive** — the clearest statement yet on their status (previously only "unresolved").
- Independently corroborates [[Sakura Haruno (source)]]'s claim that **[[Himawari
  Uzumaki]] is the new Nine-Tails jinchūriki**, showing her healing an injured Boruto with
  it — the mechanism connecting this to [[Kurama]]'s death is still unexplained, but the fact
  itself is no longer resting on a single source.
- Reveals a major new plot thread not previously in the wiki: **Boruto has been captured and
  interrogated (escalating to physical force) by Konoha as a suspected traitor** after his
  return, despite being the source of the good news above. Shikamaru privately believes him
  but can't act on it openly; Ino, asked to help him secretly reconnect with Boruto, refuses.

Updated [[Team 7]]'s "Current crisis" section, [[Kurama]], [[Himawari Uzumaki]], and
[[Naruto Uzumaki]] to reflect all of this — framed as corroboration and a clearer picture of
the same ongoing crisis, not a resolution of it. Also corroborated several older facts
independently: [[Asuma Sarutobi (source)]] and [[Kurenai Yūhi (source)]] both
describe the same relationship and Asuma's death from each side; [[Neji Hyūga (source)]]
and [[Naruto Uzumaki (source)]] both cover Neji's death consistently.

Did not deep-read every chapter-by-chapter Boruto-era arc in full (skimmed for major plot
beats, as with prior ingests) and did not create entity pages for next-generation characters
named only in passing (Shikadai, Inojin, Chōchō, Metal Lee, Temari) — logged as open threads
in `wiki/index.md`.

## [2026-09-04] ingest | Akatsuki, Itachi Uchiha (source)

Two new raw sources. [[Itachi Uchiha (source)]] is the first dedicated source for
[[Itachi Uchiha]], who previously only had a short page built from mentions inside [[Sasuke
Uchiha (source)]]; [[Akatsuki (source)]] is the first source for the organization
itself, which was previously only referenced in passing (e.g. on [[Orochimaru]]'s and [[Asuma
Sarutobi]]'s pages) without its own page.

Substantially rewrote and expanded [[Itachi Uchiha]] from a four-paragraph stub into a full
entity page: his pacifist upbringing, the impossible choice Danzō gave him before the
massacre, his double-agent mission inside Akatsuki, the mechanics of his death (a planned
loss, not a real defeat), and his reincarnation-era reconciliation with Sasuke during the
Fourth Shinobi World War. Created a new [[Akatsuki]] concept page covering the organization's
four leadership eras (Yahiko → Nagato/Pain → Tobi/Obito → Shin Uchiha) and its true origin as
a tool of Black Zetsu's plan to revive Kaguya Ōtsutsuki — a piece of backstory not previously
in the wiki at all.

Updated [[Sasuke Uchiha]] with corroborating detail now available from Itachi's own side
(Danzō's role in forcing the massacre, the crow/Kotoamatsukami failsafe, the forehead-poke
habit Sasuke inherited) and cross-linked [[Orochimaru]] and [[Asuma Sarutobi]] to the new
[[Akatsuki]] page, since both were already described as intersecting with the organization
but the wiki had nowhere to point that link before now.

Did not create individual entity pages for the many other named Akatsuki members (Nagato,
Konan, Yahiko, Kisame, Deidara, Sasori, Kakuzu, Hidan, Zetsu, Madara Uchiha, Pain) since the
only source covering them is the organizational overview, not dedicated biographies —
logged as an open thread in `wiki/index.md`.

## [2026-09-04] ingest | Nagato, Konan, Yahiko, Kisame Hoshigaki, Deidara, Sasori, Kakuzu, Hidan, Zetsu, Madara Uchiha (source)

Ten new raw sources — every core [[Akatsuki]] member flagged as an open thread in the
previous ingest, completing the organization's roster. (Note: `raw/Nagato 1.md` is a
byte-identical duplicate of `raw/Nagato.md`; only ingested once, flagged on the [[Nagato
(source)]] source page so it isn't mistaken for a missed file in a future pass.)

Created ten new entity pages: [[Nagato]], [[Konan]], [[Yahiko]], [[Kisame Hoshigaki]],
[[Deidara]], [[Sasori]], [[Kakuzu]], [[Hidan]], [[Zetsu]], and [[Madara Uchiha]]. Rewrote the
[[Akatsuki]] concept page substantially — added a full membership/status roster table, an
"eras" section, and a new section on Madara and Zetsu as the organization's true, secret
architects. Enriched [[Obito Uchiha]]'s existing page with the Madara/Zetsu backstory behind
his manipulation (previously only covered from Kakashi's side) and added cross-links from
[[Orochimaru]] and [[Asuma Sarutobi]] to the newly-detailed [[Akatsuki]] roster.

**Most significant find**: [[Madara Uchiha (source)]] is the master key connecting
threads that were previously siloed across separate pages — [[Obito Uchiha]]'s fall,
[[Nagato]]'s Rinnegan, and [[Zetsu]]'s origin all trace back to Madara's decades-long secret
manipulation, which was itself unknowingly steered by Black Zetsu toward reviving Kaguya
Ōtsutsuki. This resolves what was previously scattered, partial context (e.g. "Obito revealed
as the masked mastermind behind Akatsuki" on his old page) into a coherent causal chain.

Also flagged one loose end rather than letting it slip: **[[Hidan]] does not die** — unlike
every other Akatsuki member covered this ingest, he survives Shikamaru Nara's revenge attack,
dismembered and buried alive underground, confirmed still alive but starving as of the most
recent chapter referencing him. No source has followed up on his eventual fate; logged as an
open thread in case a future source resolves it.

Did not create entity pages for minor Akatsuki-adjacent figures who still lack their own
dedicated sources (Hashirama Senju, Hanzō, Danzō Shimura, Kabuto Yakushi, Pain as distinct
from Nagato) despite their repeated pivotal role in these ten sources — logged as an open
thread in `wiki/index.md`.

## [2026-09-04] ingest | Hashirama Senju, Tobirama Senju, Hiruzen Sarutobi, Iruka Umino (source)

Four new raw sources, closing out the "First/Second/Third Hokage" thread flagged open since
the earlier Akatsuki ingest, plus a first dedicated source for Iruka Umino. Created four new
entity pages: [[Hashirama Senju]], [[Tobirama Senju]], [[Hiruzen Sarutobi]], and
[[Iruka Umino]].

These sources are almost entirely connective tissue rather than new isolated facts — each one
closes a gap that was previously implicit on an existing page:

- [[Hashirama Senju]] and [[Tobirama Senju]] fill out [[Madara Uchiha]]'s founding-of-Konoha
  backstory from the Senju side, and confirm the direct genetic chain from Hashirama's cells to
  [[Yamato]]'s Wood Release (via [[Orochimaru]]'s experiments) already described on both of
  those pages.
- [[Tobirama Senju]]'s creation of the Konoha Military Police Force is a newly-identified root
  cause of the Uchiha clan's marginalization and eventual downfall — added as a cross-reference
  on [[Sasuke Uchiha]] and [[Itachi Uchiha]]'s existing massacre backstory rather than
  duplicating it.
- [[Hiruzen Sarutobi]] is the shared teacher figure already referenced by name (but not
  wikilinked or sourced) on [[Orochimaru]] and [[Tsunade]]; his source independently
  corroborates the Uchiha massacre's chain of command from the Third Hokage's own side, adding
  a cross-reference to [[Sasuke Uchiha]].
- [[Iruka Umino]] fills in the "who is the Naruto's-wedding father-figure" detail already
  mentioned but not previously sourced on [[Naruto Uzumaki]].

Updated `sources:`/`## Sources` cross-references on [[Madara Uchiha]], [[Orochimaru]],
[[Tsunade]], [[Naruto Uzumaki]], [[Sasuke Uchiha]], and [[Asuma Sarutobi]] (Hiruzen's son) to
link the new pages rather than leaving them as plain-text mentions.

Removed Hashirama Senju and Tobirama Senju from `wiki/index.md`'s open-threads list (now
paged) and added Konohamaru Sarutobi (Hiruzen's grandson, still unpaged) in their place.

## [2026-09-07] schema | Access tiers added to 12 characters

Added `access_tier: restricted` to the frontmatter of 12 entity pages, at the user's
request, to gate their data behind the `mcp-render-server`'s access-tier enforcement:
[[Naruto Uzumaki]], [[Sasuke Uchiha]], [[Sakura Haruno]], [[Kakashi Hatake]], [[Jiraiya]],
[[Tsunade]], [[Might Guy]], [[Itachi Uchiha]] (Team 7 core + their mentors), plus the full
Hokage line not already covered — [[Hashirama Senju]], [[Tobirama Senju]], [[Hiruzen
Sarutobi]], [[Minato Namikaze]].

Documented the new `access_tier` frontmatter field in `CLAUDE.md`'s Page format section.
Implemented enforcement in `mcp-render-server/src/index.ts`: the server reads
`wiki/entities/*.md` frontmatter at request time (the single source of truth), and gates
the matching `wiki/sources/` and `raw/` files by character name too, since those can't
carry the same frontmatter. `read_note` returns an error on a locked file, `search_notes`
skips locked files entirely, and `list_notes` still shows their path with a `[restricted]`
marker. Access is granted per-character via the `UNLOCKED_CHARACTERS` environment variable
on Render — deliberately not something Claude itself can set, so the gate can't be
self-bypassed.

Caught and fixed a bug during testing: several of the earlier-session entity pages (Naruto,
Sasuke, Sakura, Kakashi, Jiraiya, Tsunade, Might Guy, Itachi, Minato) carry a UTF-8 BOM at
the very start of the file, which silently broke the server's frontmatter regex on exactly
those files. Fixed by stripping a leading BOM before parsing. Verified against all 12
characters post-fix: locked by default, and `UNLOCKED_CHARACTERS` grants access
per-character across wiki and raw copies alike.

## [2026-09-07] schema | Access tiers extended to all 45 entity pages

At the user's request, extended `access_tier: restricted` from the original 12 characters
to every remaining `wiki/entities/*.md` page (33 more — the full non-Hokage cast: Akamaru,
Asuma Sarutobi, Chōji Akimichi, Deidara, Hidan, Himawari Uzumaki, Hinata Hyuga, Ino
Yamanaka, Iruka Umino, Kakuzu, Kawaki, Kiba Inuzuka, Kisame Hoshigaki, Konan, Kurama,
Kurenai Yūhi, Kushina Uzumaki, Madara Uchiha, Nagato, Neji Hyūga, Obito Uchiha, Orochimaru,
Rin Nohara, Rock Lee, Sai, Sarada Uchiha, Sasori, Shikamaru Nara, Shino Aburame, Tenten,
Yahiko, Yamato, Zetsu). No code changes were needed — the server already derives the
restricted set dynamically from frontmatter rather than a hardcoded list, so tagging the
remaining pages was sufficient on its own. Concept pages ([[Team 7]], [[Team 8]], [[Team
10]], [[Team Guy]], [[Akatsuki]]) and source-summary/index/log pages were deliberately left
untagged — the access-tier system only applies to per-character identity pages, not
pages that merely discuss multiple characters.

## [2026-09-07] schema | Correction: reverted access tiers back to the original 12

The previous entry misread the user's intent — the goal was always to restrict *only* the
original 12 characters (Team 7 core + mentors + full Hokage line) and leave everyone else
readable by default, not to lock the entire cast. Removed `access_tier: restricted` from
the 33 pages tagged in the prior entry, restoring them to unrestricted and reverting their
`updated` date back to 2026-09-04 since no real content changed. The 12 original pages
([[Naruto Uzumaki]], [[Sasuke Uchiha]], [[Sakura Haruno]], [[Kakashi Hatake]], [[Jiraiya]],
[[Tsunade]], [[Might Guy]], [[Itachi Uchiha]], [[Hashirama Senju]], [[Tobirama Senju]],
[[Hiruzen Sarutobi]], [[Minato Namikaze]]) are untouched and remain the only gated
characters. No server code changes needed, same as before — the restricted set is derived
from frontmatter, so removing the tag from a page is sufficient on its own.

## [2026-09-10] ingest | Batch ingest of 32 raw sources (Sand Siblings, Tailed Beasts, Taka, other villages, major antagonists/supporting cast)

Unsupervised batch ingest at the user's request, covering nearly the entire non-Boruto
character gap flagged in earlier lint passes. Boruto-era characters (Boruto, Mitsuki,
Konohamaru, the Boruto-generation genin, Momoshiki/Kinshiki/Urashiki/Isshiki Ōtsutsuki)
were deliberately excluded per the user's instruction to hold them for later.

New `wiki/sources/` + `wiki/entities/` page pairs created for: [[Gaara]], [[Temari]],
[[Kankurō]] (the [[Three Sand Siblings]]); [[Gyūki]], [[Shukaku]], [[Saiken]], [[Kokuō]],
[[Son Gokū]], [[Isobu]], [[Matatabi]] (all remaining [[Tailed Beasts]] except Chōmei, whose
raw file was empty — flagged as a data gap, not ingested); [[Suigetsu Hōzuki]], [[Karin]],
[[Jūgo]] ([[Taka]]); [[Mei Terumī]], [[Chōjūrō]], [[Ao]], [[Darui]], [[A (Third
Raikage)]], [[Karui]] (Kiri/Kumo/Iwa Kage-tier cast); [[Zabuza Momochi]], [[Haku]],
[[Killer B]], [[Shizune]], [[Anko Mitarashi]], [[Chiyo]], [[Danzō Shimura]], [[Kabuto
Yakushi]], [[Kaguya Ōtsutsuki]].

Also ingested dedicated raw sources for two characters that previously only had
synthesized stub-adjacent pages: [[Kurama]] (resolved the wiki's long-standing open
question — the mechanism connecting Kurama's death to [[Himawari Uzumaki]]'s new
jinchūriki status, now explained as a rebirth) and [[Hinata Hyuga]] (added her own
backstory — Hyūga heiress disinheritance — previously covered only through Naruto's page).

Created three new concept pages: [[Three Sand Siblings]], [[Tailed Beasts]] (shared
origin/history, avoiding repeating near-identical lore across all nine individual beast
pages), and [[Taka]]. Lightly cross-referenced [[Shikamaru Nara]]'s stub page with new
detail on his marriage to Temari.

All new content was written as original summaries from the raw fan-wiki source material,
not reproduced verbatim, consistent with the wiki's existing style. `wiki/index.md`
updated with all new pages; open threads list revised to remove resolved items.

## [2026-09-10] ingest | Chōmei (source) — closing the Tailed Beasts gap

`raw/Chōmei.md` was empty at the time of the batch ingest above; the user re-clipped it
and it now has content. Filed [[Chōmei (source)]] and [[Chōmei]] (Seven-Tails, formerly
sealed within Fū) following the same pattern as the other eight tailed beasts. Updated
[[Tailed Beasts]]'s roster table and sources to include it — the tailed beast roster is
now complete, all nine filed.
