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
import { searchMemory, readMemory, saveMemory, indexMemory } from '../lib/memory.mjs';

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
  'memory:search': {
    arguments: 'memory-search', project: true,
    run: async options => printJson(searchMemory(root, options.query, options))
  },
  'memory:read': {
    arguments: 'title', project: true,
    run: async ([id], { projectUrl }) => printJson(readMemory(root, projectUrl, id))
  },
  'memory:evidence': {
    arguments: 'title', project: true,
    run: async ([id], { projectUrl }) => printJson(readMemory(root, projectUrl, id, true))
  },
  'memory:create': {
    arguments: 'memory-create', project: true,
    run: async ({ file }) => printJson(saveMemory(root, JSON.parse(readFileSync(file, 'utf8'))))
  },
  'memory:update': {
    arguments: 'memory-update', project: true,
    run: async ({ file, id, expectRevision }) => printJson(saveMemory(root, JSON.parse(readFileSync(file, 'utf8')), { id, expectRevision }))
  },
  'memory:index': {
    arguments: 'none', project: true,
    run: async () => printJson(indexMemory(root))
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
    arguments: 'read', project: true, archive: true,
    run: async ({ title, json }, { projectUrl, archive }) => {
      const page = archive.data.articles.find(p => normalizeTitle(p.title) === normalizeTitle(title));
      if (!page) throw new Error('このタイトルの本文はアーカイブにありません。\n利用者向けの次の操作: npm run links で被リンクを確認できます。');
      if (json) { printJson({ projectUrl, url: pageUrl(projectUrl, page.title), title: page.title, pageId: page.id, commitId: page.commitId, fetchedAt: page.fetchedAt, syncedAt: archive.data.syncedAt, updated: page.updated, lines: page.lines }); return; }
      console.log(`${pageUrl(projectUrl, page.title)}\n取得時点: ${page.fetchedAt}\n更新日時: ${page.updated}\npageId: ${page.id}\ncommitId: ${page.commitId}\n\n${page.lines.map(l => l.text).join('\n')}`);
    }
  },
  search: {
    arguments: 'search', project: true, archive: true, index: true,
    run: async ({ query, limit, offset }, { projectUrl, db }) => {
      const result = search(db, query, { limit, offset });
      printJson({ ...result, items: result.items.map(p => ({ ...p, url: pageUrl(projectUrl, p.title) })) });
    }
  },
  links: {
    arguments: 'title', project: true, archive: true, index: true,
    run: async ([title], { db }) => printJson(links(db, title))
  }
};

function validateArguments(command, args) {
  if (command.arguments === 'read') {
    if (!args[0]?.trim() || args[0].startsWith('--') || args.length > 2 || (args.length === 2 && args[1] !== '--json')) throw new Error('read はタイトルと省略可能な --json を指定してください。');
    return { title: args[0], json: args.length === 2 };
  }
  if (['memory-create', 'memory-update'].includes(command.arguments)) {
    const update = command.arguments === 'memory-update';
    const id = update ? args[0] : undefined;
    const options = args.slice(update ? 1 : 0), seen = new Set(), result = { id };
    if (update && !id?.match(/^[a-z0-9][a-z0-9-]{0,79}$/u)) throw new Error('memory:update のIDが不正です。');
    for (let i = 0; i < options.length; i += 2) {
      const key = options[i], value = options[i + 1];
      if (!['--file', ...(update ? ['--expect-revision'] : [])].includes(key) || seen.has(key) || !value?.trim() || value.startsWith('--')) throw new Error('記憶保存のオプションが不正です。');
      seen.add(key);
      if (key === '--file') result.file = value;
      else {
        if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error('--expect-revision は正の安全な整数です。');
        result.expectRevision = Number(value);
      }
    }
    if (!result.file || (update && !result.expectRevision)) throw new Error('--file と、更新時は --expect-revision が必要です。');
    return result;
  }
  if (command.arguments === 'search' || command.arguments === 'memory-search') {
    if (!args.length || !args[0].trim() || args[0].startsWith('--')) {
      throw new Error('検索語を1つ指定してください。空白を含む場合は引用符で囲んでください。');
    }
    const result = { query: args[0], limit: 20, offset: 0 };
    if (command.arguments === 'memory-search') result.all = false;
    const seen = new Set();
    for (let i = 1; i < args.length; i++) {
      const option = args[i];
      if (option === '--all' && command.arguments === 'memory-search' && !seen.has(option)) {
        seen.add(option); result.all = true; continue;
      }
      if (!['--limit', '--offset'].includes(option) || seen.has(option)) {
        throw new Error('search のオプションは --limit と --offset のみで、それぞれ1回指定できます。');
      }
      seen.add(option);
      const value = args[++i];
      const number = Number(value);
      if (!value || !/^\d+$/u.test(value) || !Number.isSafeInteger(number) ||
          (option === '--limit' && (number < 1 || number > 100))) {
        throw new Error(`${option} は ${option === '--limit' ? '1〜100' : '非負の安全な整数'} の値を指定してください。`);
      }
      result[option.slice(2)] = number;
    }
    return result;
  }
  if (command.arguments === 'none' && args.length) throw new Error('このコマンドに引数は不要です。');
  if (command.arguments === 'title' && (args.length !== 1 || !args[0].trim())) {
    if (command === commands['workspace:init'] && args.length === 0) {
      throw new Error('workspace:init にはプロジェクトURLの引数が必要です。\n利用者向けの次の操作: 対話でセットアップする場合は Codexで $workspace-setup、Claudeで /workspace-setup を明示呼び出しし、URLの質問に回答してください。');
    }
    throw new Error('検索語・タイトル・プロジェクトURLを1つ指定してください。空白を含む場合は引用符で囲んでください。');
  }
  if (command.arguments === 'sync' && (args.length > 1 || args.some(arg => arg !== '--rebuild'))) {
    throw new Error('sync のオプションは --rebuild のみです。');
  }
  return args;
}

const [name, ...args] = process.argv.slice(2);
let db;
try {
  const command = Object.hasOwn(commands, name) ? commands[name] : null;
  if (!command) throw new Error('不明なローカルコマンドです。');
  const validatedArgs = validateArguments(command, args);
  const context = command.project ? readConfig(rootUrl) : {};
  if (command.archive) context.archive = loadArchive(root, context.projectUrl);
  if (command.index) context.db = db = openIndex(root, context.archive);
  await command.run(validatedArgs, context);
} catch (error) { if (error.partialResult) printJson(error.partialResult); console.error(error.message); process.exitCode = 1; }
finally { db?.close(); }
