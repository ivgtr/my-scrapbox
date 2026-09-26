import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadArchive } from './archive.mjs';
import { syncArchive } from './sync.mjs';
import { openIndex, indexState } from './search-index.mjs';
import { requireWorkspace } from './workspace.mjs';

const archivePath = 'archive/articles.json';
const git = (root, args) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
}).trim();

export function archiveStatus(root, projectUrl, archive, onWarning) {
  let checkedAt = null;
  try {
    const state = JSON.parse(readFileSync(join(root, '.local/sync.json'), 'utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state) ||
        Object.keys(state).some(key => !['projectUrl', 'checkedAt'].includes(key)) ||
        state.projectUrl !== projectUrl || typeof state.checkedAt !== 'string' ||
        !Number.isFinite(Date.parse(state.checkedAt))) {
      throw new Error('同期状態が不正です。\n利用者向けの次の操作: npm run sync で再取得してください。');
    }
    checkedAt = state.checkedAt;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (!onWarning) throw error;
      onWarning(error);
    }
  }
  return { projectUrl, syncedAt: archive.data.syncedAt, checkedAt,
    count: archive.data.articles.length, index: indexState(root, archive) };
}

export function commitArchive(root, projectUrl) {
  requireWorkspace(root);
  loadArchive(root, projectUrl);
  const current = git(root, ['hash-object', '--', archivePath]);
  const entry = git(root, ['ls-tree', 'HEAD', '--', archivePath]);
  if (entry.split(/\s+/)[2] === current) return false;
  git(root, ['add', '--', archivePath]);
  // Check again immediately before commit; never change identity or bypass hooks.
  requireWorkspace(root);
  loadArchive(root, projectUrl);
  git(root, ['commit', '--only', '-m', 'Sync Scrapbox articles', '--', archivePath]);
  return true;
}

export async function startSession(root, { projectUrl, syncMode = 'none' }, {
  get, now, clock, onProgress = console.error, print = console.log, buildIndex = (root, archive) => openIndex(root, archive).close()
} = {}) {
  if (!['none', 'fetch', 'commit'].includes(syncMode)) {
    throw new Error('syncMode は none、fetch、commit のいずれかを指定してください。');
  }
  let ok = true;
  print(`セッション開始: syncMode=${syncMode}`);
  print('依頼に応じたSkill（記事の利用可否・取得時点は以下の状態出力で確認）:\n' +
    '- .agents/skills/article-explore/SKILL.md: 記事・関連記録を探索\n' +
    '- .agents/skills/knowledge-deepen/SKILL.md: 意味・関係・矛盾を深掘り\n' +
    '- .agents/skills/knowledge-review/SKILL.md: 目的や基準に照らして計画・判断を評価');
  try { print(readFileSync(join(root, 'memory/index.md'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') print('ローカル記憶は未作成です。記憶なしで進めます。');
    else { print(`記憶の読み取り失敗: ${error.message}`); ok = false; }
  }
  // Validate before any network access or staging, including automatic recovery.
  if (existsSync(join(root, archivePath))) {
    try { loadArchive(root, projectUrl); }
    catch (error) { print(error.message); print('記事参照・自動commitを停止します。'); return false; }
  }
  if (syncMode === 'none') {
    print('同期は行いません。\n利用者向けの次の操作: Scrapboxとの差分確認・反映が必要な場合は npm run sync を実行してください。');
  } else {
    let result;
    try { result = await syncArchive(root, projectUrl, { get, now, clock, onProgress }); }
    catch (error) {
      result = error.syncResult;
      if (result) print(error.message);
      else print(`同期失敗: ${error.message}`);
      ok = false;
    }
    if (result) {
      print(`記事同期成功: ${result.count}件、${result.changed ? 'アーカイブ更新' : '変更なし'}。`);
      try { buildIndex(root, loadArchive(root, projectUrl)); print('索引準備成功。'); }
      catch (error) { print(`索引生成失敗。記事取得は成功しています。\n利用者向けの次の操作: npm run index:rebuild を実行してください: ${error.message}`); ok = false; }
      if (syncMode === 'commit') {
        try { print(commitArchive(root, projectUrl) ? '記事アーカイブをcommitしました。' : '記事アーカイブはHEADと一致しています。commit不要です。'); }
        catch (error) {
          print(`記事取得は成功しましたがcommitに失敗しました: ${error.message}\n利用者向けの次の操作: Git状態と本人設定・フックを確認してから npm run session:start を実行してください。`);
          try { print(`commit失敗後のGit状態:\n${git(root, ['status', '--short']) || '変更なし'}`); }
          catch (statusError) { print(`Git状態の取得失敗: ${statusError.message}`); }
          ok = false;
        }
      }
    }
  }
  if (!existsSync(join(root, archivePath))) {
    print('取得時点: 未取得。');
    if (syncMode === 'none' && ok) print('利用者向けの次の操作: 初回取得が必要な場合は npm run sync を実行してください。');
  } else {
    try {
      print(JSON.stringify(archiveStatus(root, projectUrl, loadArchive(root, projectUrl), error => {
        print(`同期状態を読み取れません。差分確認日時は不明です。\n利用者向けの次の操作: npm run sync を実行してください: ${error.message}`);
        ok = false;
      }), null, 2));
      print('表示した取得時点の記事をローカルで参照できます。');
    } catch (error) { print(error.message); ok = false; }
  }
  return ok;
}
