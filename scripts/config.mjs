import { readFileSync } from 'node:fs';

export function readConfig(root) {
  let config;
  try {
    config = JSON.parse(readFileSync(new URL('cosense.config.json', root), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('cosense.config.example.json を cosense.config.json にコピーし、projectUrl を設定してください。');
    }
    throw new Error('cosense.config.json を読み取れません。JSON形式を確認してください。');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('cosense.config.json はオブジェクトで指定してください。');
  }
  let project;
  try { project = new URL(config.projectUrl); } catch {
    throw new Error('projectUrl に https://scrapbox.io/プロジェクト名 を指定してください。');
  }
  const parts = project.pathname.split('/').filter(Boolean);
  if (project.origin !== 'https://scrapbox.io' || project.username || project.password ||
      project.search || project.hash || parts.length !== 1 || parts[0] === 'YOUR_PROJECT') {
    throw new Error('projectUrl に https://scrapbox.io/プロジェクト名 を指定してください。');
  }
  if (typeof config.memoryTitle !== 'string' || !config.memoryTitle.trim()) {
    throw new Error('memoryTitle に記憶ページのタイトルを指定してください。');
  }
  const projectUrl = `${project.origin}/${parts[0]}`;
  const title = config.memoryTitle.trim();
  return { projectUrl, memoryTitle: title,
    memoryUrl: `${projectUrl}/${encodeURIComponent(title.replaceAll(' ', '_'))}` };
}

export function resolveArgs(args, root) {
  if (!args.some(arg => arg === '@project' || arg === '@memory')) return args;
  const config = readConfig(root);
  return args.map(arg => arg === '@project' ? config.projectUrl :
    arg === '@memory' ? config.memoryUrl : arg);
}
