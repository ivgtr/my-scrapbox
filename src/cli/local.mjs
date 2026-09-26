import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, rootUrl } from '../paths.mjs';
import { readConfig } from '../lib/config.mjs';
import { loadArchive, normalizeTitle, pageUrl } from '../lib/archive.mjs';
import { syncArchive } from '../lib/sync.mjs';
import { rebuildIndex, openIndex, search, links } from '../lib/search-index.mjs';
import { updateWorkspace } from '../lib/workspace-update.mjs';
import { initWorkspace } from '../lib/workspace.mjs';
import { archiveStatus, startSession } from '../lib/session.mjs';

const printJson = value => console.log(JSON.stringify(value, null, 2));
const commands = {
  'session:start': {
    arguments: 'none', project: true,
    run: async (_, config) => { if (!await startSession(root, config)) process.exitCode = 1; }
  },
  'workspace:init': {
    arguments: 'title',
    run: async args => console.log(`workspace を初期化しました: ${initWorkspace(root, args[0])}\n利用者向けの次の操作: 本人が別ターミナルで npm run auth:login を実行し、完了をエージェントに伝えてください。PATは npm run auth:check で確認後、npm run sync と npm run status で初回取得を確認します。Service Accountは npm run cosense -- login @project を使い、認証確認は初回同期で行います。`)
  },
  'workspace:update': {
    arguments: 'none',
    run: async () => updateWorkspace(root)
  },
  memory: {
    arguments: 'none',
    run: async () => {
      try { process.stdout.write(readFileSync(join(root, 'memory/index.md'), 'utf8')); }
      catch (error) {
        if (error.code === 'ENOENT') throw new Error('ローカル記憶は未作成です。\n利用者向けの次の操作: 記憶なしで進められます。初回セットアップを希望する場合だけ、READMEの workspace-setup を明示呼び出ししてください。初期化済みなら再初期化は不要です。');
        throw error;
      }
    }
  },
  sync: {
    arguments: 'sync', project: true,
    run: async (args, { projectUrl }) => {
      const result = await syncArchive(root, projectUrl, { rebuild: args.includes('--rebuild') });
      console.log(`同期成功: ${result.count}件、${result.changed ? 'アーカイブ更新' : '変更なし'}。`);
      try { const db = openIndex(root, loadArchive(root, projectUrl)); db.close(); }
      catch (error) { throw new Error(`記事同期は成功しましたが索引生成に失敗しました。\n利用者向けの次の操作: npm run index:rebuild を実行してください。${error.message}`); }
    }
  },
  status: {
    arguments: 'none', project: true, archive: true,
    run: async (_, { projectUrl, archive }) => {
      printJson(archiveStatus(root, projectUrl, archive));
    }
  },
  'index:rebuild': {
    arguments: 'none', project: true, archive: true,
    run: async (_, { archive }) => { rebuildIndex(root, archive); console.log('索引を再生成しました。'); }
  },
  read: {
    arguments: 'title', project: true, archive: true,
    run: async ([title], { projectUrl, archive }) => {
      const page = archive.data.articles.find(p => normalizeTitle(p.title) === normalizeTitle(title));
      if (!page) throw new Error('このタイトルの本文はアーカイブにありません。\n利用者向けの次の操作: npm run links で被リンクを確認できます。');
      console.log(`${pageUrl(projectUrl, page.title)}\n取得時点: ${page.fetchedAt}\n更新日時: ${page.updated}\npageId: ${page.id}\ncommitId: ${page.commitId}\n\n${page.lines.map(l => l.text).join('\n')}`);
    }
  },
  search: {
    arguments: 'title', project: true, archive: true, index: true,
    run: async ([query], { projectUrl, db }) => printJson(search(db, query).map(p => ({ ...p, url: pageUrl(projectUrl, p.title) })))
  },
  links: {
    arguments: 'title', project: true, archive: true, index: true,
    run: async ([title], { db }) => printJson(links(db, title))
  }
};

function validateArguments(command, args) {
  if (command.arguments === 'none' && args.length) throw new Error('このコマンドに引数は不要です。');
  if (command.arguments === 'title' && (args.length !== 1 || !args[0].trim())) {
    throw new Error('検索語・タイトル・プロジェクトURLを1つ指定してください。空白を含む場合は引用符で囲んでください。');
  }
  if (command.arguments === 'sync' && (args.length > 1 || args.some(arg => arg !== '--rebuild'))) {
    throw new Error('sync のオプションは --rebuild のみです。');
  }
}

const [name, ...args] = process.argv.slice(2);
let db;
try {
  const command = Object.hasOwn(commands, name) ? commands[name] : null;
  if (!command) throw new Error('不明なローカルコマンドです。');
  validateArguments(command, args);
  const context = command.project ? readConfig(rootUrl) : {};
  if (command.archive) context.archive = loadArchive(root, context.projectUrl);
  if (command.index) context.db = db = openIndex(root, context.archive);
  await command.run(args, context);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { db?.close(); }
