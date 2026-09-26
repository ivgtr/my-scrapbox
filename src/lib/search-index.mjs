import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeTitle } from './archive.mjs';

const version = '1';
export function rebuildIndex(root, archive) {
  const path = join(root, '.local/search.sqlite');
  mkdirSync(join(root, '.local'), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let db;
  try {
    db = new DatabaseSync(temporary);
    db.exec(`BEGIN;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL);
      CREATE VIRTUAL TABLE fulltext USING fts5(id UNINDEXED, title, body, tokenize='trigram');
      CREATE TABLE links (source TEXT NOT NULL, target TEXT NOT NULL, title TEXT NOT NULL, external INTEGER NOT NULL);
      CREATE INDEX links_target ON links(target, external);
      CREATE INDEX links_source ON links(source);`);
    const pageInsert = db.prepare('INSERT INTO pages VALUES (?, ?, ?)');
    const textInsert = db.prepare('INSERT INTO fulltext VALUES (?, ?, ?)');
    const linkInsert = db.prepare('INSERT INTO links VALUES (?, ?, ?, ?)');
    for (const page of archive.data.articles) {
      const body = page.lines.map(line => line.text).join('\n');
      pageInsert.run(page.id, page.title, body);
      textInsert.run(page.id, page.title.toLowerCase(), body.toLowerCase());
      for (const title of new Set([...page.links, ...page.icons])) linkInsert.run(page.id, normalizeTitle(title), title, 0);
      for (const title of new Set(page.projectLinks)) linkInsert.run(page.id, normalizeTitle(title), title, 1);
    }
    const meta = db.prepare('INSERT INTO meta VALUES (?, ?)');
    meta.run('version', version);
    meta.run('archiveHash', archive.hash);
    db.exec('COMMIT');
    db.close(); db = null;
    renameSync(temporary, path);
  } finally { db?.close(); rmSync(temporary, { force: true }); }
}
export function indexState(root, archive) {
  const path = join(root, '.local/search.sqlite');
  if (!existsSync(path)) return 'missing';
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') return 'corrupt';
    if (db.prepare("SELECT value FROM meta WHERE key='version'").get()?.value !== version) return 'stale';
    if (db.prepare("SELECT value FROM meta WHERE key='archiveHash'").get()?.value !== archive.hash) return 'stale';
    db.prepare('SELECT id, title, body FROM fulltext LIMIT 1').all();
    db.prepare('SELECT source, target, title, external FROM links LIMIT 1').all();
    if (db.prepare('SELECT count(*) AS n FROM pages').get().n !== archive.data.articles.length) return 'corrupt';
    return 'ready';
  } catch { return 'corrupt'; } finally { db?.close(); }
}
export function openIndex(root, archive) {
  if (indexState(root, archive) !== 'ready') rebuildIndex(root, archive);
  return new DatabaseSync(join(root, '.local/search.sqlite'), { readOnly: true });
}
export function search(db, query) {
  const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (!terms.length) throw new Error('検索語を指定してください。');
  const long = terms.filter(term => [...term].length >= 3);
  const parameters = [];
  const clauses = [];
  if (long.length) {
    clauses.push('id IN (SELECT id FROM fulltext WHERE fulltext MATCH ?)');
    parameters.push(long.map(term => `"${term.replaceAll('"', '""')}"`).join(' AND '));
  }
  // Literal substring checks also protect punctuation, quotes and short terms.
  db.function('contains_literal', { deterministic: true }, (text, term) => Number(text.toLowerCase().includes(term)));
  for (const term of terms) {
    clauses.push('(contains_literal(title, ?) OR contains_literal(body, ?))');
    parameters.push(term, term);
  }
  return db.prepare(`SELECT id, title FROM pages WHERE ${clauses.join(' AND ')} ORDER BY title, id`).all(...parameters);
}
export function links(db, title) {
  const key = normalizeTitle(title);
  const page = db.prepare('SELECT id, title FROM pages').all().find(p => normalizeTitle(p.title) === key);
  return { title: page?.title ?? title, exists: Boolean(page),
    outgoing: page ? db.prepare('SELECT DISTINCT title, external FROM links WHERE source=? ORDER BY external, title').all(page.id) : [],
    incoming: db.prepare('SELECT DISTINCT p.title FROM links l JOIN pages p ON p.id=l.source WHERE l.target=? AND l.external=0 ORDER BY p.title').all(key) };
}
