import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { validateProjectUrl } from './config.mjs';

export function initWorkspace(root, projectUrl) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (!projectUrl) throw new Error('npm run workspace:init -- https://scrapbox.io/プロジェクト名 を実行してください。');
  projectUrl = validateProjectUrl(projectUrl);
  if (git(['branch', '--show-current']) !== 'main') throw new Error('main ブランチから初期化してください。');
  if (git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('変更のない作業ツリーから初期化してください。');
  if (git(['branch', '--list', 'workspace'])) throw new Error('workspace ブランチが既に存在します。上書きしません。');
  for (const name of ['cosense.config.json', 'memory', 'archive']) {
    if (existsSync(join(root, name))) throw new Error(`${name} が既に存在します。上書きしません。`);
  }
  git(['switch', '-c', 'workspace']);
  let configCreated = false;
  let memoryCreated = false;
  try {
    writeFileSync(join(root, 'cosense.config.json'), JSON.stringify({ projectUrl }, null, 2) + '\n', { flag: 'wx' });
    configCreated = true;
    mkdirSync(join(root, 'memory'));
    memoryCreated = true;
    writeFileSync(join(root, 'memory/index.md'), '# Agent記憶\n\n今回の依頼に関係する詳細だけを参照してください。\n', { flag: 'wx' });
  } catch (error) {
    if (configCreated) rmSync(join(root, 'cosense.config.json'), { force: true });
    if (memoryCreated) rmSync(join(root, 'memory'), { recursive: true, force: true });
    git(['switch', 'main']);
    git(['branch', '-D', 'workspace']);
    throw error;
  }
  return projectUrl;
}

export function requireWorkspace(root) {
  let branch;
  try { branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(); }
  catch { throw new Error('Gitリポジトリの workspace ブランチで実行してください。'); }
  if (branch !== 'workspace') throw new Error('同期は workspace ブランチでのみ実行できます。npm run workspace:init -- <projectUrl> を実行してください。');
}
