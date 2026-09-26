import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { updateWorkspace } from '../lib/workspace-update.mjs';
import { syncArchive } from '../lib/sync.mjs';

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' } }).trim();
const put = (root, name, text) => { const path = resolve(root, name); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };
const commit = (root, message = 'change') => { git(root, 'add', '.'); git(root, 'commit', '-m', message); };
function fixture(t, { worktree = false, upstream = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'workspace-update-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const remote = join(dir, 'template'); mkdirSync(remote);
  git(remote, 'init', '-b', 'main');
  git(remote, 'config', 'user.name', 'Test'); git(remote, 'config', 'user.email', 'test@example.invalid');
  put(remote, '.gitignore', '.local/\n'); put(remote, 'base.txt', 'base\n'); put(remote, 'package.json', '{}\n'); commit(remote, 'template');
  const clone = join(dir, 'clone'); git(dir, 'clone', remote, clone);
  git(clone, 'config', 'user.name', 'Test'); git(clone, 'config', 'user.email', 'test@example.invalid');
  const root = worktree ? join(dir, 'worktree') : clone;
  if (worktree) git(clone, 'worktree', 'add', '-b', 'workspace', root);
  else git(root, 'switch', '-c', 'workspace');
  if (upstream) {
    git(root, 'remote', 'rename', 'origin', 'upstream');
    git(root, 'remote', 'add', 'origin', join(dir, 'unavailable'));
    git(root, 'config', '--local', 'cosense.templateRemote', 'upstream');
  }
  put(root, 'archive/articles.json', 'personal articles'); put(root, 'memory/index.md', 'personal memory'); put(root, 'cosense.config.json', '{"projectUrl":"https://scrapbox.io/example"}'); commit(root, 'personal');
  const output = [];
  return { root, remote, clone, output, update: () => updateWorkspace(root, { print: line => output.push(line) }) };
}

for (const worktree of [false, true]) for (const upstream of [false, true]) {
  test(`updates ${worktree ? 'worktree' : 'clone'} from ${upstream ? 'upstream' : 'origin'} preserving staged, unstaged, untracked and existing stash`, t => {
    const { root, remote, clone, output, update } = fixture(t, { worktree, upstream });
    const main = git(clone, 'rev-parse', 'main');
    put(root, 'old.txt', 'old stash'); git(root, 'stash', 'push', '-u', '-m', 'existing');
    const old = git(root, 'rev-parse', 'refs/stash');
    put(root, 'base.txt', 'staged\n'); git(root, 'add', 'base.txt'); put(root, 'base.txt', 'unstaged\n');
    put(root, 'new.txt', 'untracked'); put(root, '.local/cosense/settings.json', 'test-only');
    const staged = git(root, 'diff', '--cached', '--binary');
    git(root, 'config', 'rebase.autoStash', 'true'); git(root, 'config', 'rebase.updateRefs', 'true');
    const personal = git(root, 'rev-parse', 'HEAD'); git(root, 'branch', 'other', personal);
    put(remote, 'new-template.txt', 'new template'); commit(remote);
    const result = update();
    assert.equal(result.target, git(remote, 'rev-parse', 'HEAD'));
    assert.notEqual(result.after, personal);
    assert.equal(git(root, 'diff', '--cached', '--binary'), staged);
    assert.equal(readFileSync(join(root, 'base.txt'), 'utf8'), 'unstaged\n');
    assert.equal(readFileSync(join(root, 'new.txt'), 'utf8'), 'untracked');
    assert.equal(readFileSync(join(root, 'memory/index.md'), 'utf8'), 'personal memory');
    assert.equal(readFileSync(join(root, 'archive/articles.json'), 'utf8'), 'personal articles');
    assert.equal(readFileSync(join(root, '.local/cosense/settings.json'), 'utf8'), 'test-only');
    assert.equal(git(root, 'rev-parse', 'refs/stash'), old);
    assert.equal(git(root, 'rev-parse', 'other'), personal);
    assert.equal(git(clone, 'rev-parse', 'main'), main);
    assert.ok(!output.join('\n').includes('npm ci'));
    assert.equal(update().changed, false);
    assert.equal(git(root, 'diff', '--cached', '--binary'), staged);
    assert.equal(existsSync(join(root, '.local/sync.lock')), false);
  });
}

test('only changes to dependency files after restoration prompt npm ci', t => {
  const { root, remote, output, update } = fixture(t);
  put(root, 'package.json', '{"local":true}\n'); // excluded from the remote edit, restored intact
  put(remote, 'package-lock.json', '{}\n'); commit(remote);
  update();
  assert.match(output.join('\n'), /npm ci/);
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), '{"local":true}\n');
});

test('fetch failure and unknown remote preserve dirty work and existing stash', t => {
  const { root, update } = fixture(t);
  put(root, 'base.txt', 'dirty'); git(root, 'add', 'base.txt'); put(root, 'new.txt', 'untracked');
  const status = git(root, 'status', '--porcelain'); const head = git(root, 'rev-parse', 'HEAD');
  git(root, 'config', 'cosense.templateRemote', 'missing'); assert.throws(update, /未登録/);
  git(root, 'config', 'cosense.templateRemote', 'origin'); git(root, 'remote', 'set-url', 'origin', join(root, 'missing'));
  assert.throws(update, /fetch失敗.*origin\/main/);
  assert.equal(git(root, 'status', '--porcelain'), status); assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(root, 'stash', 'list'), '');
});

for (const path of ['cosense.config.json', 'memory/index.md', 'archive/articles.json', '.local/cosense/settings.json', '.env']) {
  test(`rejects protected remote tree: ${path}`, t => {
    const { root, remote, update } = fixture(t); const head = git(root, 'rev-parse', 'HEAD');
    put(remote, path, 'forbidden'); git(remote, 'add', '-f', path); git(remote, 'commit', '-m', 'bad template');
    put(root, 'base.txt', 'dirty');
    assert.throws(update, /個人・認証領域/);
    assert.equal(git(root, 'rev-parse', 'HEAD'), head); assert.equal(git(root, 'stash', 'list'), '');
    assert.equal(readFileSync(join(root, 'base.txt'), 'utf8'), 'dirty');
  });
}

test('unrelated remote history is rejected before stashing', t => {
  const { root, remote, update } = fixture(t);
  git(remote, 'checkout', '--orphan', 'replacement'); git(remote, 'rm', '-rf', '.'); put(remote, 'other', 'unrelated'); commit(remote); git(remote, 'branch', '-M', 'main');
  put(root, 'new.txt', 'dirty'); assert.throws(update, /共通履歴/); assert.equal(git(root, 'stash', 'list'), '');
});

for (const action of ['continue', 'abort']) test(`rebase conflict preserves stash and permits ${action} then restoration`, t => {
  const { root, remote, output, update } = fixture(t);
  put(root, 'base.txt', 'personal\n'); commit(root);
  put(root, 'dirty.txt', 'dirty'); git(root, 'add', 'dirty.txt'); put(root, 'untracked.txt', 'untracked');
  put(remote, 'base.txt', 'template\n'); commit(remote);
  assert.throws(update, /rebase未完了/);
  const stash = git(root, 'rev-parse', 'refs/stash'); assert.ok(output.join('\n').includes(stash));
  assert.throws(update, /Git操作中/);
  if (action === 'continue') { put(root, 'base.txt', 'resolved\n'); git(root, 'add', 'base.txt'); }
  git(root, 'rebase', `--${action}`);
  assert.throws(update, /以前の更新用stash/);
  git(root, 'stash', 'apply', '--index', stash);
  assert.equal(readFileSync(join(root, 'dirty.txt'), 'utf8'), 'dirty');
  assert.match(git(root, 'diff', '--cached', '--name-only'), /dirty.txt/);
  assert.equal(readFileSync(join(root, 'untracked.txt'), 'utf8'), 'untracked');
  git(root, 'stash', 'drop', 'stash@{0}');
});

test('stash restoration conflict reports completed rebase and retains stash', t => {
  const { root, remote, update } = fixture(t);
  put(root, 'base.txt', 'dirty\n'); put(remote, 'base.txt', 'template\n'); commit(remote);
  assert.throws(update, /rebaseは完了.*復元は未完了/);
  assert.equal(git(root, 'merge-base', '--is-ancestor', git(remote, 'rev-parse', 'HEAD'), 'HEAD'), '');
  const stash = git(root, 'rev-parse', 'refs/stash'); assert.throws(update, /以前の更新用stash/);
  put(root, 'base.txt', 'resolved\n'); git(root, 'add', 'base.txt');
  assert.equal(git(root, 'rev-parse', 'refs/stash'), stash); git(root, 'stash', 'drop', 'stash@{0}');
});

test('main, Git operation, sync lock and shared update lock block updates', async t => {
  const { root, clone, update } = fixture(t, { worktree: true });
  assert.throws(() => updateWorkspace(clone), /workspace/);
  const gitPath = name => git(root, 'rev-parse', '--path-format=absolute', '--git-path', name);
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_START', 'index.lock']) {
    put(root, gitPath(name), 'test'); assert.throws(update, /Git操作中/); rmSync(gitPath(name));
  }
  mkdirSync(join(root, '.local/sync.lock'), { recursive: true }); assert.throws(update, /ロック/);
  await assert.rejects(syncArchive(root, 'https://scrapbox.io/example', { get: () => { throw new Error('must not fetch'); } }), /同期ロック/);
  rmSync(join(root, '.local/sync.lock'), { recursive: true });
  const shared = join(clone, '.git/cosense-workspace-update.lock'); mkdirSync(shared); assert.throws(update, /別worktree/);
  assert.equal(existsSync(join(root, '.local/sync.lock')), false);
});

test('rebase hook is respected and stash retained on hook failure', t => {
  const { root, remote, update } = fixture(t);
  put(remote, 'new-template', 'new'); commit(remote); put(root, 'dirty', 'dirty');
  writeFileSync(join(root, '.git/hooks/pre-rebase'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.throws(update, /rebase未完了/); assert.match(git(root, 'stash', 'list'), /cosense-workspace-update:/);
});

test('CLI update does not require Cosense config or archive', t => {
  const { root, remote } = fixture(t);
  cpSync(new URL('../', import.meta.url), join(root, 'src'), { recursive: true });
  git(root, 'rm', '-r', 'cosense.config.json', 'archive'); commit(root); put(remote, 'new-template', 'new'); commit(remote);
  const result = spawnSync(process.execPath, [join(root, 'src/cli/local.mjs'), 'workspace:update'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /rebase完了/);
  assert.equal(existsSync(join(root, 'archive')), false);
});


test('staged deletion and rename, unusual filenames and unignored .local are preserved', t => {
  const { root, remote, update } = fixture(t);
  put(root, 'delete-me', 'delete'); put(root, 'rename-me', 'rename'); commit(root);
  git(root, 'rm', 'delete-me'); git(root, 'mv', 'rename-me', 'renamed');
  put(root, ' leading space\nfile', 'untracked');
  put(root, '.gitignore', ''); put(root, '.local/cosense/settings.json', 'test-only');
  const staged = git(root, 'diff', '--cached', '--binary');
  put(remote, 'new-template', 'new'); commit(remote);
  update();
  assert.equal(git(root, 'diff', '--cached', '--binary'), staged);
  assert.equal(existsSync(join(root, 'delete-me')), false);
  assert.equal(readFileSync(join(root, 'renamed'), 'utf8'), 'rename');
  assert.equal(readFileSync(join(root, ' leading space\nfile'), 'utf8'), 'untracked');
  assert.equal(readFileSync(join(root, '.local/cosense/settings.json'), 'utf8'), 'test-only');
});

test('remote fetch mappings cannot update local main', t => {
  const { root, remote, update } = fixture(t);
  const main = git(root, 'rev-parse', 'main');
  git(root, 'config', '--replace-all', 'remote.origin.fetch', '+refs/heads/main:refs/heads/main');
  put(remote, 'new-template', 'new'); commit(remote); update();
  assert.equal(git(root, 'rev-parse', 'main'), main);
});
