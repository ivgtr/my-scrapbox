import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { validateProjectUrl } from './config.mjs';

export function initWorkspace(root, projectUrl) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (!projectUrl) throw new Error('プロジェクトURLが未指定です。\n利用者向けの次の操作: 対話でセットアップする場合は Codexで $workspace-setup、Claudeで /workspace-setup を明示呼び出しし、URLの質問に回答してください。workspace:init 自体にはプロジェクトURLの引数が必要です。');
  projectUrl = validateProjectUrl(projectUrl);
  if (git(['branch', '--show-current']) !== 'main') throw new Error('現在のブランチは main ではないため初期化できません。\n利用者向けの次の操作: 初回セットアップの条件をREADMEで確認してください。既存workspaceを再初期化する必要はありません。');
  if (git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('作業ツリーに変更があります。初期化には変更のない main が必要です。\n利用者向けの次の操作: Git状態を確認してください。');
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
  catch { throw new Error('Gitブランチを確認できません。\n利用者向けの次の操作: Gitリポジトリと workspace ブランチを確認してください。'); }
  if (branch !== 'workspace') throw new Error('同期は workspace ブランチでのみ実行できます。\n利用者向けの次の操作: 既存workspaceがあればその作業場所・ブランチを確認してください。未初期化でセットアップを希望する場合だけ、READMEの workspace-setup を明示呼び出ししてください。');
}
