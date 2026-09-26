import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, chmodSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite, hash, validateArticle } from './archive.mjs';

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const articleKeys = ['id', 'title', 'updated', 'commitId', 'fetchedAt', 'lines', 'links', 'projectLinks', 'icons'];
const validSavedArticle = article => exactKeys(article, articleKeys) && validateArticle(article) &&
  article.lines.every(line => exactKeys(line, ['id', 'text']));
const temporaryName = /^(state|[a-f0-9]{64})\.json\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/;

export function openProgress(root, projectUrl, { rebuild = false } = {}) {
  const directory = join(root, '.local/sync-progress');
  const statePath = join(directory, 'state.json');
  const articles = new Map();
  if (rebuild) {
    try { rmSync(directory, { recursive: true, force: true }); }
    catch (error) { throw new Error(`途中成果を破棄できません。\n利用者向けの次の操作: .local/sync-progress/ の権限を確認して npm run sync -- --rebuild を実行してください。詳細: ${error.message}`); }
  }
  try {
    if (existsSync(directory)) {
      if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error();
      // Only recognizable remnants of interrupted atomic writes are recoverable.
      for (const name of readdirSync(directory)) {
        if (temporaryName.test(name)) {
          if (!lstatSync(join(directory, name)).isFile()) throw new Error();
          rmSync(join(directory, name));
        }
      }
      const names = readdirSync(directory);
      if (names.length) {
        if (!lstatSync(statePath).isFile() || lstatSync(statePath).isSymbolicLink()) throw new Error();
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        if (!exactKeys(state, ['version', 'projectUrl']) || state.version !== 1 || state.projectUrl !== projectUrl) throw new Error();
        chmodSync(statePath, 0o600);
        for (const name of names.filter(name => name !== 'state.json')) {
          const path = join(directory, name);
          if (!/^[a-f0-9]{64}\.json$/.test(name) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error();
          const record = JSON.parse(readFileSync(path, 'utf8'));
          if (!exactKeys(record, ['version', 'article', 'contentHash']) || record.version !== 1 ||
              !validSavedArticle(record.article) || record.contentHash !== hash(JSON.stringify(record.article)) ||
              name !== `${hash(record.article.id)}.json`) throw new Error();
          chmodSync(path, 0o600);
          articles.set(record.article.id, record.article);
        }
      }
    }
  } catch (error) {
    if (error.code && error.code !== 'ENOENT') {
      throw new Error(`途中成果を読み取れません。\n利用者向けの次の操作: .local/sync-progress/ のファイルと権限を確認して npm run sync で再開してください。詳細: ${error.message}`);
    }
    throw new Error('途中成果が破損しているか、形式・対象プロジェクトが異なります。\n利用者向けの次の操作: npm run sync -- --rebuild で再取得してください。');
  }
  const saveFailure = error => new Error(`途中成果の保存に失敗しました。\n利用者向けの次の操作: .local/ の書き込み権限と空き容量を確認して npm run sync で再開してください。詳細: ${error.message}`);
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    if (!existsSync(statePath)) atomicWrite(statePath, JSON.stringify({ version: 1, projectUrl }));
  } catch (error) { throw saveFailure(error); }
  return {
    articles,
    save(article) {
      const record = { version: 1, article, contentHash: hash(JSON.stringify(article)) };
      try { atomicWrite(join(directory, `${hash(article.id)}.json`), JSON.stringify(record)); }
      catch (error) { throw saveFailure(error); }
      articles.set(article.id, article);
    },
    clear() { rmSync(directory, { recursive: true, force: true }); }
  };
}
