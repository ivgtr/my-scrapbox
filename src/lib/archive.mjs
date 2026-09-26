import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const hash = text => createHash('sha256').update(text).digest('hex');
export const normalizeTitle = title => title.replaceAll(' ', '_').toLowerCase();
export const pageUrl = (projectUrl, title) => `${projectUrl}/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
export function atomicWrite(path, text, mode = 0o600, temporaryDirectory = dirname(path)) {
  mkdirSync(dirname(path), { recursive: true });
  // Keep the existing names used by sync recovery; memory puts its temp outside records.
  const temporary = temporaryDirectory === dirname(path)
    ? `${path}.${randomUUID()}.tmp`
    : join(temporaryDirectory, `.atomic-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, text, { flag: 'wx', mode });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}
export function validMeta(page) {
  return page && typeof page.id === 'string' && page.id.length > 0 &&
    typeof page.title === 'string' && page.title.length > 0 &&
    Number.isFinite(page.updated) && page.updated >= 0;
}
export function validateArticle(page) {
  return validMeta(page) && typeof page.commitId === 'string' && page.commitId.length > 0 &&
    typeof page.fetchedAt === 'string' && Number.isFinite(Date.parse(page.fetchedAt)) &&
    Array.isArray(page.lines) && page.lines.every(line => line && typeof line.id === 'string' && line.id && typeof line.text === 'string') &&
    ['links', 'projectLinks', 'icons'].every(key => Array.isArray(page[key]) && page[key].every(x => typeof x === 'string'));
}
export function loadArchive(root, projectUrl) {
  const path = join(root, 'archive/articles.json');
  if (!existsSync(path)) throw new Error('アーカイブがありません。\n利用者向けの次の操作: 記事の取得が必要な場合は npm run sync を実行してください。');
  const text = readFileSync(path, 'utf8');
  try {
    const data = JSON.parse(text);
    if (data.version !== 1 || data.projectUrl !== projectUrl || !Number.isFinite(Date.parse(data.syncedAt)) ||
      !Array.isArray(data.articles) || !data.articles.every(validateArticle) ||
      new Set(data.articles.map(p => p.id)).size !== data.articles.length ||
      new Set(data.articles.map(p => normalizeTitle(p.title))).size !== data.articles.length ||
      data.contentHash !== hash(JSON.stringify(data.articles))) throw new Error();
    return { data, text, hash: hash(text) };
  } catch { throw new Error('アーカイブが破損・変更されたか、対象プロジェクトが異なります。\n利用者向けの次の操作: 直接編集せず npm run sync -- --rebuild で再取得してください。'); }
}
