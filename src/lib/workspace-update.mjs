import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const marker = 'cosense-workspace-update:';
const git = (root, args, allowed = [0]) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw result.error;
  if (!allowed.includes(result.status)) throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args[0]} に失敗しました。`);
  return { output: result.stdout.trim(), status: result.status };
};
const run = (root, ...args) => git(root, args).output;
const stashes = root => run(root, 'stash', 'list', '--format=%H%x09%gs').split('\n').filter(Boolean)
  .map(line => { const [id, ...subject] = line.split('\t'); return { id, subject: subject.join('\t') }; });
const recovery = id => `利用者向けの次の操作: 退避分の復元: git stash apply --index ${id}\n復元を確認後、git stash list --format='%gd %H %gs' で ${id} に対応する stash@{n} を確認し、git stash drop 'stash@{n}' を実行してください。`;
const dependencyState = root => ['package.json', 'package-lock.json'].map(name => {
  try { return readFileSync(join(root, name)).toString('base64'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
});

export function updateWorkspace(root, { print = console.log } = {}) {
  const gitPath = name => resolve(root, run(root, 'rev-parse', '--git-path', name));
  for (const name of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer', 'BISECT_START', 'index.lock']) {
    if (existsSync(gitPath(name))) throw new Error(`Git操作中です (${name})。\n利用者向けの次の操作: 続行・中止してから更新してください。`);
  }
  if (run(root, 'branch', '--show-current') !== 'workspace') throw new Error('現在のブランチでは更新できません。\n利用者向けの次の操作: 更新は workspace ブランチで実行してください。');
  const pending = stashes(root).filter(stash => stash.subject.includes(marker));
  if (pending.length) throw new Error(`以前の更新用stashが残っています。\n利用者向けの次の操作: git status で状態を確認してください。既に復元済み・一部適用済みの場合は再適用しないでください。以下のapplyは未復元で、rebaseの続行・中止も完了している場合だけ実行し、復元確認後に削除してください。\n${pending.map(s => recovery(s.id)).join('\n')}`);
  // .local is never stashed, even if an ignore rule was removed locally.
  if (run(root, 'ls-files', '--', '.local').length) throw new Error('.local/ がGit管理されています。\n利用者向けの次の操作: 認証・索引領域をGit管理外にしてから更新してください。');
  const config = git(root, ['config', '--local', '--get', 'cosense.templateRemote'], [0, 1]);
  const remote = config.status === 1 ? 'origin' : config.output;
  if (!remote || !run(root, 'remote').split('\n').includes(remote)) throw new Error(`追従先リモート ${remote || '(空)'} は未登録です。\n利用者向けの次の操作: git remote と git config --local cosense.templateRemote を確認してください。`);
  mkdirSync(join(root, '.local'), { recursive: true });
  const lock = join(root, '.local/sync.lock');
  try { mkdirSync(lock); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('同期・更新ロックが存在します。\n利用者向けの次の操作: 実行中の処理の終了を待ってください。異常終了の場合だけ、処理が実行中でないことを確認して .local/sync.lock を削除してください。');
    throw error;
  }
  // Stashes and fetched refs are shared by linked worktrees.
  let sharedLock;
  let sharedLocked = false;
  try {
    sharedLock = resolve(root, run(root, 'rev-parse', '--git-common-dir'), 'cosense-workspace-update.lock');
    try { mkdirSync(sharedLock); sharedLocked = true; } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`別worktreeの更新ロックが存在します。\n利用者向けの次の操作: 処理終了を待ち、異常終了の場合だけ実行中でないことを確認して ${sharedLock} を削除してください。`);
      throw error;
    }
    const before = run(root, 'rev-parse', 'HEAD');
    const dependencies = dependencyState(root);
    try { run(root, 'fetch', '--no-tags', '--no-recurse-submodules', '--refmap=', '--', remote, 'refs/heads/main'); }
    catch (error) { throw new Error(`fetch失敗 (${remote}/main)。作業内容は変更していません。\n利用者向けの次の操作: 取得先・接続・Git認証を確認してください。\n${error.message}`); }
    const target = run(root, 'rev-parse', 'FETCH_HEAD^{commit}');
    if (git(root, ['merge-base', before, target], [0, 1]).status === 1) throw new Error(`${remote}/main に共通履歴がありません。\n利用者向けの次の操作: 取得先を確認してください。`);
    const paths = run(root, 'ls-tree', '-r', '-z', '--name-only', target).split('\0');
    const protectedPath = paths.find(path => /^(cosense\.config\.json|memory|archive|\.local|\.env)(\/|$)/.test(path) || (path.startsWith('.env.') && path !== '.env.example'));
    if (protectedPath) throw new Error(`取得先mainに個人・認証領域 (${protectedPath}) が含まれています。\n利用者向けの次の操作: 取得先を確認してください。`);
    print(`更新前: ${before}\n更新対象 (${remote}/main): ${target}`);
    if (git(root, ['merge-base', '--is-ancestor', target, before], [0, 1]).status === 0) {
      print(`更新なし。更新後: ${before}\n退避不要。`);
      return { before, after: before, target, changed: false };
    }
    let stash;
    const dirty = run(root, 'status', '--porcelain', '--untracked-files=all', '--', '.', ':(exclude).local');
    if (dirty) {
      const previous = git(root, ['rev-parse', '--verify', '--quiet', 'refs/stash'], [0, 1]).output;
      // With an ignored directory, standard stash already excludes .local.
      // An explicit exclusion of that ignored directory makes Git's stash cleanup fail.
      const localIgnored = git(root, ['check-ignore', '--quiet', '.local/'], [0, 1]).status === 0;
      const paths = localIgnored ? [] : ['--', '.', ':(exclude,glob).local/**'];
      try {
        run(root, 'stash', 'push', '--include-untracked', '--message', `${marker} ${before} -> ${target}`, ...paths);
      } catch (error) {
        const created = stashes(root).find(entry => entry.id !== previous && entry.subject.includes(marker));
        if (created) print(`更新用stash: ${created.id}`);
        throw new Error(`退避処理が完了しませんでした。rebaseは開始していません。\n利用者向けの次の操作: Git状態を確認してください。\n${created ? recovery(created.id) + '\n' : ''}${error.message}`);
      }
      stash = run(root, 'rev-parse', 'refs/stash');
      if (stash === previous) throw new Error('更新用stashを作成できませんでした。\n利用者向けの次の操作: Git状態を確認してください。');
      print(`更新用stash: ${stash}`);
    }
    try { run(root, '-c', 'rebase.autoStash=false', '-c', 'rebase.updateRefs=false', 'rebase', '--no-autostash', '--no-update-refs', target); }
    catch (error) {
      throw new Error(`rebase未完了。\n利用者向けの次の操作: Git状態を確認し、競合ファイルを修正して git add <ファイル>、git rebase --continue を実行してください。中止は git rebase --abort です。\n${stash ? `続行・中止の完了後に以下を実行してください。\n${recovery(stash)}` : '退避分はありません。'}\n完了後、依存定義が変わった場合は npm ci を実行してください。\n${error.message}`);
    }
    const after = run(root, 'rev-parse', 'HEAD');
    print(`rebase完了。更新後: ${after}`);
    if (stash) {
      try { run(root, 'stash', 'apply', '--index', stash); }
      catch (error) { throw new Error(`rebaseは完了しましたが退避分の復元は未完了です。stash ${stash} を保持しています。\n利用者向けの次の操作: Git状態と競合を確認し、既に適用された内容へ再適用しないでください。\n復元確認後の削除: git stash list --format='%gd %H %gs' でIDに対応する stash@{n} を確認して git stash drop 'stash@{n}'\n依存定義が変わった場合は npm ci を実行してください。\n${error.message}`); }
      // Locate by immutable ID immediately before dropping; existing stashes are untouched.
      const index = stashes(root).findIndex(entry => entry.id === stash);
      if (index < 0) throw new Error(`退避分は復元しましたがstash ${stash} を見つけられません。\n利用者向けの次の操作: git stash list を確認してください。`);
      try { run(root, 'stash', 'drop', `stash@{${index}}`); }
      catch (error) { throw new Error(`退避分は復元しましたがstash ${stash} の削除に失敗しました。\n利用者向けの次の操作: 復元済みのため再適用せず、git stash list を確認してください。\n${error.message}`); }
      print('退避分とステージ状態を復元しました。更新用stashを削除しました。');
    } else print('退避不要。');
    if (JSON.stringify(dependencies) !== JSON.stringify(dependencyState(root))) print('依存定義が変わりました。\n利用者向けの次の操作: npm ci を実行してください。');
    return { before, after, target, changed: true, stash };
  } finally {
    if (sharedLocked) rmSync(sharedLock, { recursive: true, force: true });
    rmSync(lock, { recursive: true, force: true });
  }
}
