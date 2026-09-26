import { existsSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { hash, atomicWrite, validMeta, validateArticle, loadArchive, pageUrl, normalizeTitle } from './archive.mjs';

import { authenticatedGet, HttpError } from '../integrations/cosense/client.mjs';
import { requireWorkspace } from './workspace.mjs';
import { controlledGet, systemClock } from './sync-requests.mjs';
import { openProgress } from './sync-progress.mjs';

class SnapshotChanged extends Error {}
const signature = pages => JSON.stringify(pages.map(({ id, title, updated }) => ({ id, title, updated })));
export async function listAll(get, projectUrl, limit = 1000) {
  const pages = [];
  let count;
  for (;;) {
    const data = await get(`https://scrapbox.io/api/pages${new URL(projectUrl).pathname}/?sort=title&limit=${limit}&skip=${pages.length}`);
    if (!data || !Number.isSafeInteger(data.count) || data.count < 0 || !Array.isArray(data.pages) ||
      data.skip !== pages.length || !Number.isSafeInteger(data.limit) || data.limit <= 0 ||
      data.pages.length > data.limit || !data.pages.every(validMeta)) throw new Error('ページ一覧の応答が不正です。\n利用者向けの次の操作: 繰り返す場合はAPIの対応状況を確認してください。');
    if (count !== undefined && count !== data.count) throw new SnapshotChanged('一覧の件数が変化しました。');
    count = data.count;
    pages.push(...data.pages.map(({ id, title, updated }) => ({ id, title, updated })));
    if (pages.length > count || new Set(pages.map(p => p.id)).size !== pages.length) throw new SnapshotChanged('一覧のページが重複・変化しました。');
    if (pages.length === count) break;
    if (data.pages.length === 0) throw new Error('ページ一覧が途中で終了しました。\n利用者向けの次の操作: 時間を置いて npm run sync で再開し、繰り返す場合はAPIの対応状況を確認してください。');
  }
  if (new Set(pages.map(p => normalizeTitle(p.title))).size !== pages.length) throw new SnapshotChanged('一覧のタイトルが重複しています。');
  return pages.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export async function syncArchive(root, projectUrl, {
  rebuild = false, get, limit = 1000, now = () => new Date().toISOString(),
  clock = systemClock, onProgress = console.error
} = {}) {
  requireWorkspace(root);
  mkdirSync(join(root, '.local'), { recursive: true });
  const lock = join(root, '.local/sync.lock');
  try { mkdirSync(lock); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('同期ロックが存在します。\n利用者向けの次の操作: 実行中の同期があれば終了を待ってください。異常終了で残った場合だけ、同期が実行中でないことを確認して .local/sync.lock を削除し、npm run sync で再開してください。');
    throw error;
  }
  try {
    const path = join(root, 'archive/articles.json');
    const previous = !rebuild && existsSync(path) ? loadArchive(root, projectUrl).data : null;
    get ??= authenticatedGet(root, projectUrl);
    get = controlledGet(root, projectUrl, get, { clock, onProgress });
    const progress = openProgress(root, projectUrl, { rebuild });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const before = await listAll(get, projectUrl, limit);
        const old = new Map(previous?.articles.map(p => [p.id, p]) ?? []);
        const articles = [];
        let fetched = 0;
        let reused = 0;
        for (const meta of before) {
          const cached = [progress.articles.get(meta.id), old.get(meta.id)].find(article =>
            article && article.title === meta.title && article.updated === meta.updated);
          if (cached) {
            articles.push(cached); reused++;
            onProgress(`本文 ${articles.length}/${before.length}件: 取得${fetched}件、再利用${reused}件。`);
            continue;
          }
          let raw;
          try {
            raw = await get(pageUrl(`https://scrapbox.io/api/pages/v2${new URL(projectUrl).pathname}`, meta.title));
          } catch (error) {
            if (error instanceof HttpError && error.status === 404) throw new SnapshotChanged('取得中にページが移動・削除されました。');
            throw error;
          }
          if (raw?.persistent === false) throw new SnapshotChanged('取得中にページが変化しました。');
          if (!raw || raw.persistent !== true || !validMeta(raw)) throw new Error('ページ本文の応答が不正です。\n利用者向けの次の操作: 繰り返す場合はAPIの対応状況を確認してください。');
          if (raw.id !== meta.id || raw.title !== meta.title || raw.updated !== meta.updated) throw new SnapshotChanged('本文と一覧が一致しません。');
          const article = { ...meta, commitId: raw.commitId, fetchedAt: now(),
            lines: Array.isArray(raw.lines) ? raw.lines.map(line => ({ id: line?.id, text: line?.text })) : null,
            links: raw.links, projectLinks: raw.projectLinks, icons: raw.icons };
          if (!validateArticle(article)) throw new Error('ページ本文の応答が不正です。\n利用者向けの次の操作: 繰り返す場合はAPIの対応状況を確認してください。');
          progress.save(article);
          articles.push(article);
          fetched++;
          onProgress(`本文 ${articles.length}/${before.length}件: 取得${fetched}件、再利用${reused}件。`);
        }
        const after = await listAll(get, projectUrl, limit);
        if (signature(before) !== signature(after)) throw new SnapshotChanged('取得前後で一覧が変化しました。');
        const changed = !previous || JSON.stringify(previous.articles) !== JSON.stringify(articles);
        const checkedAt = now();
        if (changed) {
          try { atomicWrite(path, `${JSON.stringify({ version: 1, projectUrl, syncedAt: checkedAt, contentHash: hash(JSON.stringify(articles)), articles }, null, 2)}\n`, 0o444); }
          catch (error) { throw new Error(`アーカイブの保存に失敗しました。\n利用者向けの次の操作: archive/ の書き込み権限と空き容量を確認して npm run sync で再開してください。詳細: ${error.message}`); }
        }
        try {
          chmodSync(path, 0o444);
          atomicWrite(join(root, '.local/sync.json'), JSON.stringify({ projectUrl, checkedAt }));
        } catch (error) {
          error.message = `記事取得は成功しましたが同期状態の保存に失敗しました。\n利用者向けの次の操作: .local/ の書き込み権限と空き容量を確認して npm run sync を実行してください。詳細: ${error.message}`;
          error.syncResult = { changed, count: articles.length };
          throw error;
        }
        try { progress.clear(); }
        catch (error) {
          error.message = `記事同期は成功しましたが途中成果の削除に失敗しました。\n利用者向けの次の操作: .local/sync-progress/ の権限を確認して npm run sync を実行してください。詳細: ${error.message}`;
          error.syncResult = { changed, count: articles.length };
          throw error;
        }
        return { changed, count: articles.length };
      } catch (error) {
        if (!(error instanceof SnapshotChanged)) throw error;
        if (attempt === 2) throw new Error('3回確認しても一覧・本文が安定しません。\n利用者向けの次の操作: 更新が落ち着いてから npm run sync で再開してください。');
        onProgress(`一覧・本文が変化しました。5秒待機して再確認します (${attempt + 1}/2)。`);
        await clock.sleep(5000);
      }
    }
  } finally { rmSync(lock, { recursive: true, force: true }); }
}
