import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import matter from 'gray-matter';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW_DIR = path.join(ROOT, 'raw');
const WIKI_DIR = path.join(ROOT, 'wiki');

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml']);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function ensureSchema() {
  const sql = fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[db-sync] schema ready');
}

function toRepoPath(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

async function upsertRawFile(absPath) {
  const repoPath = toRepoPath(absPath);
  const stat = fs.statSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const content = TEXT_EXTENSIONS.has(ext) ? fs.readFileSync(absPath, 'utf8') : null;

  await pool.query(
    `INSERT INTO raw_files (path, filename, extension, content, size_bytes, file_mtime, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (path) DO UPDATE SET
       filename = EXCLUDED.filename,
       extension = EXCLUDED.extension,
       content = EXCLUDED.content,
       size_bytes = EXCLUDED.size_bytes,
       file_mtime = EXCLUDED.file_mtime,
       synced_at = now()`,
    [repoPath, path.basename(absPath), ext, content, stat.size, stat.mtime]
  );
  console.log(`[db-sync] raw_files upserted: ${repoPath}`);
}

async function upsertWikiPage(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  if (ext !== '.md') return; // wiki pages are markdown per CLAUDE.md

  const repoPath = toRepoPath(absPath);
  const stat = fs.statSync(absPath);
  const raw = fs.readFileSync(absPath, 'utf8');
  const parsed = matter(raw);
  const fm = parsed.data || {};

  const relFromWiki = path.relative(WIKI_DIR, absPath).split(path.sep);
  const category = relFromWiki.length > 1 ? relFromWiki[0] : null; // sources|entities|concepts|syntheses, or null for index.md/log.md

  await pool.query(
    `INSERT INTO wiki_pages
       (path, filename, category, type, tags, access_tier, created, updated, sources, frontmatter, content, raw_content, file_mtime, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     ON CONFLICT (path) DO UPDATE SET
       filename = EXCLUDED.filename,
       category = EXCLUDED.category,
       type = EXCLUDED.type,
       tags = EXCLUDED.tags,
       access_tier = EXCLUDED.access_tier,
       created = EXCLUDED.created,
       updated = EXCLUDED.updated,
       sources = EXCLUDED.sources,
       frontmatter = EXCLUDED.frontmatter,
       content = EXCLUDED.content,
       raw_content = EXCLUDED.raw_content,
       file_mtime = EXCLUDED.file_mtime,
       synced_at = now()`,
    [
      repoPath,
      path.basename(absPath),
      category,
      fm.type ?? null,
      Array.isArray(fm.tags) ? fm.tags : null,
      fm.access_tier ?? null,
      fm.created ?? null,
      fm.updated ?? null,
      Array.isArray(fm.sources) ? fm.sources : null,
      JSON.stringify(fm),
      parsed.content,
      raw,
      stat.mtime,
    ]
  );
  console.log(`[db-sync] wiki_pages upserted: ${repoPath}`);
}

async function removeRawFile(absPath) {
  const repoPath = toRepoPath(absPath);
  await pool.query('DELETE FROM raw_files WHERE path = $1', [repoPath]);
  console.log(`[db-sync] raw_files removed: ${repoPath}`);
}

async function removeWikiPage(absPath) {
  const repoPath = toRepoPath(absPath);
  await pool.query('DELETE FROM wiki_pages WHERE path = $1', [repoPath]);
  console.log(`[db-sync] wiki_pages removed: ${repoPath}`);
}

async function handle(event, absPath) {
  const inRaw = absPath.startsWith(RAW_DIR + path.sep);
  const inWiki = absPath.startsWith(WIKI_DIR + path.sep) || absPath === path.join(WIKI_DIR, 'index.md');

  try {
    if (event === 'unlink') {
      if (inRaw) await removeRawFile(absPath);
      if (inWiki) await removeWikiPage(absPath);
      return;
    }
    if (inRaw) await upsertRawFile(absPath);
    if (inWiki) await upsertWikiPage(absPath);
  } catch (err) {
    console.error(`[db-sync] failed to sync ${absPath}:`, err.message);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[db-sync] DATABASE_URL is not set. Copy .env.example to .env and fill in your password.');
    process.exit(1);
  }

  await ensureSchema();

  const once = process.argv.includes('--once');
  const pending = [];

  const watcher = chokidar.watch([RAW_DIR, WIKI_DIR], {
    ignoreInitial: false,
    persistent: !once,
  });

  const track = (event, p) => {
    const promise = handle(event, p);
    if (once) pending.push(promise);
  };

  watcher
    .on('add', (p) => track('add', p))
    .on('change', (p) => track('change', p))
    .on('unlink', (p) => track('unlink', p))
    .on('ready', async () => {
      if (once) {
        await Promise.all(pending);
      }
      console.log('[db-sync] initial scan complete, watching for changes...');
      if (once) {
        await watcher.close();
        await pool.end();
      }
    });
}

main();
