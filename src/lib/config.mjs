import { readFileSync } from 'node:fs';

export function readConfig(root) {
  let config;
  try {
    config = JSON.parse(readFileSync(new URL('cosense.config.json', root), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('npm run workspace:init -- <projectUrl> で初期化するか、cosense.config.example.json をコピーして projectUrl を設定してください。');
    }
    throw new Error('cosense.config.json を読み取れません。JSON形式を確認してください。');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('cosense.config.json はオブジェクトで指定してください。');
  }
  if (Object.keys(config).some(key => !['projectUrl', 'syncMode'].includes(key))) {
    throw new Error('cosense.config.json で指定できる項目は projectUrl と syncMode のみです。未知の項目を削除してください。');
  }
  const syncMode = config.syncMode === undefined ? 'none' : config.syncMode;
  if (!['none', 'fetch', 'commit'].includes(syncMode)) {
    throw new Error('syncMode は none、fetch、commit のいずれかを指定してください。');
  }
  return { projectUrl: validateProjectUrl(config.projectUrl), syncMode };
}

export function validateProjectUrl(projectUrl) {
  let project;
  try { project = new URL(projectUrl); } catch {
    throw new Error('projectUrl に https://scrapbox.io/プロジェクト名 を指定してください。');
  }
  const parts = project.pathname.split('/').filter(Boolean);
  if (project.origin !== 'https://scrapbox.io' || project.username || project.password ||
      project.search || project.hash || parts.length !== 1 || parts[0] === 'YOUR_PROJECT') {
    throw new Error('projectUrl に https://scrapbox.io/プロジェクト名 を指定してください。');
  }
  return `${project.origin}/${parts[0]}`;
}

export function resolveArgs(args, root) {
  if (args.includes('@memory')) throw new Error('@memory は廃止しました。npm run memory を使用してください。');
  if (!args.includes('@project')) return args;
  const config = readConfig(root);
  return args.map(arg => arg === '@project' ? config.projectUrl : arg);
}
