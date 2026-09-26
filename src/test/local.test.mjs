import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, existsSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initWorkspace } from '../lib/workspace.mjs';
import { syncArchive as runSync } from '../lib/sync.mjs';
import { authenticatedGet } from '../integrations/cosense/client.mjs';
import { loadArchive } from '../lib/archive.mjs';
import { openIndex, indexState, rebuildIndex, search, links } from '../lib/search-index.mjs';
import { startSession, commitArchive, archiveStatus } from '../lib/session.mjs';
import { fakeClock } from './support/clock.mjs';

const syncArchive = (root, projectUrl, options) => runSync(root, projectUrl, { clock: fakeClock(), onProgress: () => {}, ...options });

const projectUrl = 'https://scrapbox.io/example';
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t, initialize = true) {
  const root = mkdtempSync(join(tmpdir(), 'local-knowledge-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(new URL('../', import.meta.url), join(root, 'src'), { recursive: true });
  cpSync(new URL('../../.gitignore', import.meta.url), join(root, '.gitignore'));
  cpSync(new URL('../../package.json', import.meta.url), join(root, 'package.json'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'Template');
  if (initialize) initWorkspace(root, projectUrl);
  return root;
}
const page = (id, title, text = '日本語の全文検索 ABC "quoted" 100% a_b', updated = 1, extra = {}) => ({
  id, title, updated, commitId: `commit-${updated}`, persistent: true,
  lines: [{ id: `line-${id}`, text: title, user: { email: 'secret@example.invalid' } }, { id: `body-${id}`, text }],
  links: ['本文なし', 'Target Name'], projectLinks: ['/other/External'], icons: [],
  user: { email: 'secret@example.invalid' }, ...extra
});
function server(pages, { hook = () => {}, limit = 1000 } = {}) {
  const calls = [];
  const get = async url => {
    calls.push(url);
    await hook(url, calls.length);
    const parsed = new URL(url);
    if (parsed.pathname.includes('/v2/')) {
      const title = decodeURIComponent(parsed.pathname.split('/').at(-1)).replaceAll('_', ' ');
      const found = pages.find(p => p.title.replaceAll('_', ' ') === title);
      return structuredClone(found ?? { persistent: false });
    }
    const skip = Number(parsed.searchParams.get('skip'));
    const size = Math.min(limit, Number(parsed.searchParams.get('limit')));
    return { count: pages.length, skip, limit: size, pages: structuredClone(pages.slice(skip, skip + size)) };
  };
  return { get, calls };
}
const archivePath = root => join(root, 'archive/articles.json');

test('first sync, unchanged, addition, update, rename and deletion are atomic and incremental', async t => {
  const root = fixture(t);
  const pages = [page('b', 'Beta'), page('a', 'Alpha')];
  let remote = server(pages, { limit: 1 });
  assert.deepEqual(await syncArchive(root, projectUrl, { get: remote.get, limit: 1 }), { changed: true, count: 2 });
  const archive = loadArchive(root, projectUrl);
  assert.deepEqual(archive.data.articles.map(p => p.id), ['a', 'b']);
  assert.ok(!archive.text.includes('secret@example.invalid'));
  assert.equal(statSync(archivePath(root)).mode & 0o777, 0o444);
  const before = statSync(archivePath(root));
  remote = server(pages);
  assert.deepEqual(await syncArchive(root, projectUrl, { get: remote.get }), { changed: false, count: 2 });
  assert.equal(remote.calls.filter(url => url.includes('/v2/')).length, 0);
  assert.equal(readFileSync(archivePath(root), 'utf8'), archive.text);
  assert.equal(statSync(archivePath(root)).mtimeMs, before.mtimeMs);
  pages.push(page('c', 'Added')); pages[0] = page('b', 'Beta', 'changed', 2); pages[1].title = 'Renamed';
  remote = server(pages);
  await syncArchive(root, projectUrl, { get: remote.get });
  assert.equal(remote.calls.filter(url => url.includes('/v2/')).length, 3);
  pages.splice(0, 1); remote = server(pages);
  await syncArchive(root, projectUrl, { get: remote.get });
  assert.deepEqual(loadArchive(root, projectUrl).data.articles.map(p => p.id), ['a', 'c']);
  assert.equal(remote.calls.filter(url => url.includes('/v2/')).length, 0);
});

test('pagination mutations retry; continuous changes never publish deletions', async t => {
  const root = fixture(t); const pages = [page('a', 'Alpha'), page('b', 'Beta')];
  await syncArchive(root, projectUrl, { get: server(pages).get });
  let changed = false;
  const remote = server(pages, { limit: 1, hook: url => {
    if (!changed && url.includes('skip=1')) { pages.push(page('c', 'New')); changed = true; }
  } });
  await syncArchive(root, projectUrl, { get: remote.get, limit: 1 });
  assert.equal(loadArchive(root, projectUrl).data.articles.length, 3);
  const before = readFileSync(archivePath(root), 'utf8');
  let scans = 0;
  const unstable = server(pages, { hook: url => {
    if (!url.includes('/v2/')) { scans++; pages[0].updated++; }
  } });
  await assert.rejects(syncArchive(root, projectUrl, { get: unstable.get }), /3回/);
  assert.ok(scans >= 3);
  assert.equal(readFileSync(archivePath(root), 'utf8'), before);
});

test('network, authentication, malformed lists and malformed bodies preserve the previous archive', async t => {
  const root = fixture(t); const pages = [page('a', 'Alpha'), page('b', 'Beta')];
  await syncArchive(root, projectUrl, { get: server(pages).get });
  const before = readFileSync(archivePath(root), 'utf8');
  for (const get of [
    async () => { throw new Error('network'); },
    async () => ({ count: 0, skip: 0, limit: 1000, pages: 'invalid' }),
    async () => ({ count: 2, skip: 0, limit: 1000, pages: [] }),
    async () => ({ count: 1, skip: 0, limit: 1000, pages: [{ id: 'a', title: 'Alpha', updated: 'converted date' }] })
  ]) {
    await assert.rejects(syncArchive(root, projectUrl, { get }));
    assert.equal(readFileSync(archivePath(root), 'utf8'), before);
  }
  for (const status of [401, 403, 500]) {
    mkdirSync(join(root, '.local/cosense'), { recursive: true });
    writeFileSync(join(root, '.local/cosense/settings.json'), JSON.stringify({ users: [{ url: 'https://scrapbox.io', token: 'test-only' }] }));
    const get = authenticatedGet(root, projectUrl, async () => ({ ok: false, status }));
    await assert.rejects(syncArchive(root, projectUrl, { get }), new RegExp(`HTTP ${status}`));
    assert.equal(readFileSync(archivePath(root), 'utf8'), before);
  }
  const malformed = [page('a', 'Alpha', 'new', 2, { lines: [{ text: 'no id' }] })];
  await assert.rejects(syncArchive(root, projectUrl, { get: server(malformed).get }), /不正/);
  assert.equal(readFileSync(archivePath(root), 'utf8'), before);
  const lateFailure = server([page('a', 'Alpha')], { hook: (_, n) => { if (n === 2) throw new Error('late network failure'); } });
  await assert.rejects(syncArchive(root, projectUrl, { get: lateFailure.get }));
  assert.equal(readFileSync(archivePath(root), 'utf8'), before);
});

test('archive corruption and hash mismatch require rebuild; index recovery and literal Japanese searches work', async t => {
  const root = fixture(t); const pages = [page('a', 'Alpha'), page('b', 'Target Name', 'other')];
  await syncArchive(root, projectUrl, { get: server(pages).get });
  let archive = loadArchive(root, projectUrl);
  let db = openIndex(root, archive);
  for (const query of ['日本語', '全文検索', '日', '日本', '日本語 ABC', '100%', 'a_b', '"quoted"', '"', '%', '_']) {
    assert.deepEqual(search(db, query).map(p => p.id), ['a'], query);
  }
  assert.deepEqual(search(db, '日本語 absent'), []);
  assert.deepEqual(search(db, 'OR'), []);
  assert.deepEqual(search(db, "x' OR 1=1 --"), []);
  assert.throws(() => search(db, ' '), /検索語/);
  assert.equal(links(db, '本文なし').exists, false);
  assert.equal(links(db, '本文なし').incoming.length, 2);
  assert.equal(links(db, 'target_name').incoming.length, 2);
  assert.equal(links(db, 'Alpha').outgoing.find(p => p.external).title, '/other/External');
  db.close();
  assert.equal(indexState(root, archive), 'ready');
  writeFileSync(join(root, '.local/search.sqlite'), 'corrupt');
  assert.equal(indexState(root, archive), 'corrupt');
  db = openIndex(root, archive); assert.equal(search(db, '全文').length, 1); db.close();
  rmSync(join(root, '.local/search.sqlite'));
  db = openIndex(root, archive); db.close();
  pages[0].updated++; await syncArchive(root, projectUrl, { get: server(pages).get });
  archive = loadArchive(root, projectUrl); assert.equal(indexState(root, archive), 'stale');
  rebuildIndex(root, archive); assert.equal(indexState(root, archive), 'ready');
  // Owner can override read-only permissions: detection, not OS enforcement.
  const { chmodSync } = await import('node:fs'); chmodSync(archivePath(root), 0o644);
  writeFileSync(archivePath(root), archive.text.replace('日本語', '改変語'));
  assert.throws(() => loadArchive(root, projectUrl), /破損・変更/);
  await assert.rejects(syncArchive(root, projectUrl, { get: server(pages).get }), /rebuild/);
  writeFileSync(archivePath(root), '{broken');
  await syncArchive(root, projectUrl, { rebuild: true, get: server(pages).get });
  archive = loadArchive(root, projectUrl); db = openIndex(root, archive);
  assert.equal(search(db, '日本語').length, 1); db.close();
});

test('offline CLI works with no credentials and no network; memory and personal files can be committed', async t => {
  const root = fixture(t);
  await syncArchive(root, projectUrl, { get: server([page('a', 'Alpha')]).get });
  writeFileSync(join(root, 'deny-network.mjs'), 'globalThis.fetch = () => { throw new Error("Network forbidden"); };');
  for (const [cmd, ...args] of [['search', '日本語'], ['read', 'Alpha'], ['links', '本文なし'], ['status'], ['memory'], ['index:rebuild'], ['session:start']]) {
    const result = spawnSync(process.execPath, ['--import', join(root, 'deny-network.mjs'), join(root, 'src/cli/local.mjs'), cmd, ...args], { cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, COSENSE_PAT: 'ignored-test-only' } });
    assert.equal(result.status, 0, `${cmd}: ${result.stderr}`);
  }
  assert.equal(existsSync(join(root, '.local/cosense/settings.json')), false);
  writeFileSync(join(root, 'memory/decision.md'), '# Decision\n\n確認日: 2026-09-26\n');
  writeFileSync(join(root, 'memory/index.md'), '# Agent記憶\n\n[Decision](decision.md)\n');
  mkdirSync(join(root, '.local/cosense'), { recursive: true });
  writeFileSync(join(root, '.local/cosense/settings.json'), 'test-only');
  writeFileSync(join(root, '.local/run.log'), 'test-only');
  rmSync(join(root, 'deny-network.mjs'));
  git(root, 'add', '.'); git(root, 'commit', '-m', 'Personal data');
  const tracked = git(root, 'ls-files');
  assert.ok(tracked.includes('archive/articles.json')); assert.ok(tracked.includes('memory/decision.md')); assert.ok(tracked.includes('cosense.config.json'));
  assert.ok(!tracked.includes('.local/'));
  const original = readFileSync(archivePath(root), 'utf8');
  git(root, 'switch', 'main');
  await assert.rejects(syncArchive(root, projectUrl, { get: () => { throw new Error('must not fetch'); } }), /workspace/);
  writeFileSync(join(root, 'template-update.md'), 'New template'); git(root, 'add', '.'); git(root, 'commit', '-m', 'Update template');
  git(root, 'switch', 'workspace'); git(root, 'merge', 'main', '--no-edit');
  assert.equal(readFileSync(archivePath(root), 'utf8'), original);
  assert.ok(readFileSync(join(root, 'memory/index.md'), 'utf8').includes('decision.md'));
  assert.ok(existsSync(join(root, 'template-update.md')));
});

test('workspace init rejects dirty trees, existing ignored files, invalid URLs and existing branches', t => {
  const root = fixture(t, false);
  assert.throws(() => initWorkspace(root, 'https://example.com/example'), /projectUrl/);
  writeFileSync(join(root, 'dirty.txt'), 'dirty');
  assert.throws(() => initWorkspace(root, projectUrl), /変更のない/); rmSync(join(root, 'dirty.txt'));
  git(root, 'config', 'core.excludesFile', join(root, '.local-ignore'));
  writeFileSync(join(root, '.local-ignore'), 'cosense.config.json\n.local-ignore\n');
  writeFileSync(join(root, 'cosense.config.json'), 'existing');
  assert.throws(() => initWorkspace(root, projectUrl), /既に存在/);
  assert.equal(readFileSync(join(root, 'cosense.config.json'), 'utf8'), 'existing');
  rmSync(join(root, 'cosense.config.json')); git(root, 'branch', 'workspace');
  assert.throws(() => initWorkspace(root, projectUrl), /既に存在/);
  assert.equal(git(root, 'branch', '--show-current'), 'main');
});

test('authentication is GET-only, local, service-account first, and redirections are disabled', async t => {
  const root = fixture(t); mkdirSync(join(root, '.local/cosense'), { recursive: true });
  assert.throws(() => authenticatedGet(root, projectUrl), /認証/);
  const settings = { projects: [{ url: projectUrl, serviceAccount: 'test-only-sa' }], users: [{ url: 'https://scrapbox.io', token: 'test-only-pat' }] };
  writeFileSync(join(root, '.local/cosense/settings.json'), JSON.stringify(settings));
  const get = authenticatedGet(root, projectUrl, async (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { 'x-service-account-access-key': 'test-only-sa' });
    return { ok: true, json: async () => ({ ok: true }) };
  });
  assert.deepEqual(await get('https://scrapbox.io/api/pages/example/'), { ok: true });
  await assert.rejects(get('https://other.example/'), /対象外/);
  await assert.rejects(get('https://scrapbox.io/api/pages/other/'), /対象外/);
});

test('before/after mutation retries, invalid duplicate titles do not publish, and a stable empty list deletes all', async t => {
  const root = fixture(t); const pages = [page('a', 'Alpha')];
  let mutated = false;
  const remote = server(pages, { hook: url => {
    if (!mutated && url.includes('/v2/')) { pages[0] = page('a', 'Renamed', 'new text', 2); mutated = true; }
  } });
  await syncArchive(root, projectUrl, { get: remote.get });
  assert.equal(loadArchive(root, projectUrl).data.articles[0].title, 'Renamed');
  const before = readFileSync(archivePath(root), 'utf8');
  await assert.rejects(syncArchive(root, projectUrl, { get: server([page('b', 'Duplicate'), page('c', 'duplicate')]).get }), /3回/);
  assert.equal(readFileSync(archivePath(root), 'utf8'), before);
  const { chmodSync } = await import('node:fs'); chmodSync(archivePath(root), 0o644);
  const mtime = statSync(archivePath(root)).mtimeMs;
  await syncArchive(root, projectUrl, { get: server(pages).get });
  assert.equal(statSync(archivePath(root)).mode & 0o777, 0o444);
  assert.equal(statSync(archivePath(root)).mtimeMs, mtime);
  await syncArchive(root, projectUrl, { get: server([]).get });
  const archive = loadArchive(root, projectUrl); assert.equal(archive.data.articles.length, 0);
  const db = openIndex(root, archive); assert.deepEqual(search(db, '日本語'), []); db.close();
});

test('CLI rejects unknown commands and bad arguments before loading settings or writing indexes', t => {
  const root = fixture(t, false);
  for (const [command, args, message] of [
    ['unknown', [], /不明/], ['search', [], /1つ指定/],
    ['sync', ['--unknown'], /オプション/], ['memory', ['extra'], /引数は不要/],
    ['constructor', [], /不明/]
  ]) {
    const result = spawnSync(process.execPath, [join(root, 'src/cli/local.mjs'), command, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
  }
  assert.equal(existsSync(join(root, '.local')), false);
  assert.equal(existsSync(join(root, 'archive')), false);
});

test('list 404 stops once, page 404 retries, and malformed page metadata does not retry', async t => {
  const root = fixture(t);
  mkdirSync(join(root, '.local/cosense'), { recursive: true });
  writeFileSync(join(root, '.local/cosense/settings.json'), JSON.stringify({ users: [{ url: 'https://scrapbox.io', token: 'test-only' }] }));
  const pages = [page('a', 'Alpha')];
  await syncArchive(root, projectUrl, { get: server(pages).get });
  const before = readFileSync(archivePath(root), 'utf8');
  let requests = 0;
  const list404 = authenticatedGet(root, projectUrl, async () => { requests++; return { ok: false, status: 404 }; });
  await assert.rejects(syncArchive(root, projectUrl, { get: list404 }), /HTTP 404/);
  assert.equal(requests, 1);
  pages[0] = page('a', 'Alpha', 'new', 2);
  const remote = server(pages);
  requests = 0;
  const page404 = authenticatedGet(root, projectUrl, async url => {
    if (url.includes('/v2/') && requests++ === 0) return { ok: false, status: 404 };
    return { ok: true, json: () => remote.get(url) };
  });
  await syncArchive(root, projectUrl, { get: page404 });
  assert.equal(requests, 2);
  assert.notEqual(readFileSync(archivePath(root), 'utf8'), before);
  const latest = readFileSync(archivePath(root), 'utf8');
  const malformed = server([page('a', 'Alpha', 'bad', 3, { persistent: null })]);
  await assert.rejects(syncArchive(root, projectUrl, { get: malformed.get }), /本文の応答が不正/);
  assert.equal(malformed.calls.filter(url => url.includes('/v2/')).length, 1);
  assert.equal(readFileSync(archivePath(root), 'utf8'), latest);
});

test('malformed authentication settings never fall back to a valid PAT', t => {
  const root = fixture(t);
  mkdirSync(join(root, '.local/cosense'), { recursive: true });
  const user = { url: 'https://scrapbox.io', token: 'test-only-pat' };
  for (const settings of [
    { projects: null, users: [user] },
    { projects: [{ url: projectUrl, serviceAccount: '' }], users: [user] },
    { projects: [{ url: 'invalid', serviceAccount: 'test-only-sa' }], users: [user] }
  ]) {
    writeFileSync(join(root, '.local/cosense/settings.json'), JSON.stringify(settings));
    assert.throws(() => authenticatedGet(root, projectUrl), /認証設定を読み取れません/);
  }
});

const session = (root, mode, options = {}) => {
  const messages = [];
  return startSession(root, { projectUrl, syncMode: mode }, { clock: fakeClock(), onProgress: () => {}, print: text => messages.push(text), ...options })
    .then(ok => ({ ok, output: messages.join('\n') }));
};

test('status does not substitute acquisition time for missing or malformed sync metadata', async t => {
  const root = fixture(t);
  await syncArchive(root, projectUrl, { get: server([page('a', 'Alpha')]).get });
  const archive = loadArchive(root, projectUrl);
  const path = join(root, '.local/sync.json');
  rmSync(path);
  assert.equal(archiveStatus(root, projectUrl, archive).checkedAt, null);
  for (const text of ['{broken', 'null', '{}', JSON.stringify({ projectUrl: 'https://scrapbox.io/other', checkedAt: archive.data.syncedAt }),
    JSON.stringify({ projectUrl, checkedAt: archive.data.syncedAt, legacy: true })]) {
    writeFileSync(path, text);
    assert.throws(() => archiveStatus(root, projectUrl, archive));
    const result = await session(root, 'none');
    assert.equal(result.ok, false); assert.match(result.output, /差分確認日時は不明/);
    assert.match(result.output, /"checkedAt": null/);
    assert.ok(result.output.includes(archive.data.syncedAt));
    assert.match(result.output, /ローカルで参照できます/);
  }
});

test('session none is offline with no archive; fetch creates and incrementally refreshes articles without commits', async t => {
  const root = fixture(t);
  const head = git(root, 'rev-parse', 'HEAD');
  const forbidden = async () => { throw new Error('network forbidden'); };
  let result = await session(root, 'none', { get: forbidden });
  assert.equal(result.ok, true); assert.match(result.output, /未取得/);
  assert.equal(existsSync(archivePath(root)), false);
  const pages = [page('a', 'Alpha')];
  let remote = server(pages);
  result = await session(root, 'fetch', { get: remote.get });
  assert.equal(result.ok, true); assert.match(result.output, /記事同期成功/);
  assert.equal(indexState(root, loadArchive(root, projectUrl)), 'ready');
  const text = readFileSync(archivePath(root), 'utf8');
  remote = server(pages);
  result = await session(root, 'fetch', { get: remote.get });
  assert.equal(result.ok, true); assert.match(result.output, /変更なし/);
  assert.equal(remote.calls.filter(url => url.includes('/v2/')).length, 0);
  assert.equal(readFileSync(archivePath(root), 'utf8'), text);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  result = await session(root, 'none', { get: forbidden });
  assert.equal(result.ok, true); assert.match(result.output, /syncedAt/); assert.match(result.output, /checkedAt/);
});

test('session commit saves only archive, preserves other staging, and commits previous fetch without remote changes', async t => {
  const root = fixture(t);
  // A push would fail against this deliberately unavailable destination.
  git(root, 'remote', 'add', 'origin', join(root, 'unavailable-remote'));
  const pages = [page('a', 'Alpha')];
  git(root, 'add', 'cosense.config.json', 'memory');
  writeFileSync(join(root, 'other.txt'), 'staged'); git(root, 'add', 'other.txt');
  writeFileSync(join(root, 'other.txt'), 'unstaged');
  const staged = git(root, 'diff', '--cached', '--binary');
  let result = await session(root, 'commit', { get: server(pages).get });
  assert.equal(result.ok, true);
  assert.equal(git(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'archive/articles.json');
  assert.equal(git(root, 'diff', '--cached', '--binary'), staged);
  assert.equal(readFileSync(join(root, 'other.txt'), 'utf8'), 'unstaged');
  const head = git(root, 'rev-parse', 'HEAD');
  result = await session(root, 'commit', { get: server(pages).get });
  assert.equal(result.ok, true); assert.match(result.output, /commit不要/);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  pages[0] = page('a', 'Alpha', 'changed', 2);
  await session(root, 'fetch', { get: server(pages).get });
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  const remote = server(pages);
  result = await session(root, 'commit', { get: remote.get });
  assert.equal(result.ok, true); assert.match(result.output, /変更なし/);
  assert.match(result.output, /commitしました/);
  assert.equal(remote.calls.filter(url => url.includes('/v2/')).length, 0);
  assert.notEqual(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(root, 'diff', '--cached', '--binary'), staged);
});

test('session fetch failures retain articles and dates; corruption stops network and commit in every mode', async t => {
  const root = fixture(t);
  let result = await session(root, 'fetch', { get: async () => { throw new Error('HTTP 401'); } });
  assert.equal(result.ok, false); assert.match(result.output, /未取得/);
  await syncArchive(root, projectUrl, { get: server([page('a', 'Alpha')]).get });
  const archive = loadArchive(root, projectUrl);
  const head = git(root, 'rev-parse', 'HEAD');
  for (const reason of ['network', 'HTTP 401', 'HTTP 403']) {
    result = await session(root, 'commit', { get: async () => { throw new Error(reason); } });
    assert.equal(result.ok, false); assert.match(result.output, /同期失敗/);
    assert.ok(result.output.includes(archive.data.syncedAt));
    assert.match(result.output, /ローカルで参照できます/);
    assert.equal(readFileSync(archivePath(root), 'utf8'), archive.text);
    assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  }
  const { chmodSync } = await import('node:fs'); chmodSync(archivePath(root), 0o644);
  writeFileSync(archivePath(root), '{broken');
  for (const mode of ['none', 'fetch', 'commit']) {
    let called = false;
    result = await session(root, mode, { get: async () => { called = true; } });
    assert.equal(result.ok, false); assert.equal(called, false);
    assert.match(result.output, /sync -- --rebuild/); assert.match(result.output, /停止/);
    assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  }
});

test('index and metadata failures report successful articles; commit hooks are respected and failed staging is reported', async t => {
  const root = fixture(t);
  const pages = [page('a', 'Alpha')];
  let result = await session(root, 'commit', { get: server(pages).get, buildIndex: () => { throw new Error('index test failure'); } });
  assert.equal(result.ok, false); assert.match(result.output, /索引生成失敗/);
  assert.match(result.output, /commitしました/); loadArchive(root, projectUrl);
  const head = git(root, 'rev-parse', 'HEAD');
  pages[0] = page('a', 'Alpha', 'changed', 2);
  writeFileSync(join(root, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  result = await session(root, 'commit', { get: server(pages).get });
  assert.equal(result.ok, false); assert.match(result.output, /commitに失敗/);
  assert.match(result.output, /commit失敗後のGit状態/); assert.match(result.output, /M {2}archive\/articles.json/);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(loadArchive(root, projectUrl).data.articles[0].updated, 2);
  rmSync(join(root, '.local/sync.json')); mkdirSync(join(root, '.local/sync.json'));
  pages[0] = page('a', 'Alpha', 'again', 3);
  result = await session(root, 'fetch', { get: server(pages).get });
  assert.equal(result.ok, false); assert.match(result.output, /同期状態の保存に失敗/);
  assert.equal(loadArchive(root, projectUrl).data.articles[0].updated, 3);
  assert.ok(result.output.includes(loadArchive(root, projectUrl).data.syncedAt));
  assert.match(result.output, /ローカルで参照できます/);
});

test('missing Git identity reports a commit failure without rolling back fetched articles', async t => {
  const root = fixture(t);
  // Empty local identity overrides any global developer identity.
  git(root, 'config', 'user.name', ''); git(root, 'config', 'user.email', '');
  const head = git(root, 'rev-parse', 'HEAD');
  const result = await session(root, 'commit', { get: server([page('a', 'Alpha')]).get });
  assert.equal(result.ok, false); assert.match(result.output, /commitに失敗/);
  assert.match(result.output, /commit失敗後のGit状態/);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(loadArchive(root, projectUrl).data.articles.length, 1);
});

test('commit rejects non-workspace branches both initially and after fetch', async t => {
  const root = fixture(t);
  await syncArchive(root, projectUrl, { get: server([page('a', 'Alpha')]).get });
  git(root, 'switch', '-c', 'other');
  assert.throws(() => commitArchive(root, projectUrl), /workspace/);
  git(root, 'switch', 'workspace');
  const remote = server([page('a', 'Alpha')]);
  let calls = 0;
  const result = await session(root, 'commit', { get: async url => {
    const response = await remote.get(url);
    if (++calls === 2) git(root, 'switch', 'other');
    return response;
  } });
  assert.equal(result.ok, false); assert.match(result.output, /commitに失敗/);
  assert.equal(git(root, 'log', '--format=%s', '-1'), 'Template');
});

test('CLI rejects invalid modes before networking; manual sync ignores commit mode', t => {
  const root = fixture(t);
  const config = value => writeFileSync(join(root, 'cosense.config.json'), JSON.stringify({ projectUrl, syncMode: value }));
  writeFileSync(join(root, 'mock-network.mjs'), `globalThis.fetch = async (url, init) => {
    if (init.method !== 'GET') throw new Error('Only GET allowed');
    return { ok: true, json: async () => ({ count: 0, skip: 0, limit: 1000, pages: [] }) };
  };`);
  const run = command => spawnSync(process.execPath, ['--import', join(root, 'mock-network.mjs'), join(root, 'src/cli/local.mjs'), command], { encoding: 'utf8' });
  config('invalid');
  assert.match(run('session:start').stderr, /syncMode/);
  assert.equal(existsSync(archivePath(root)), false);
  mkdirSync(join(root, '.local/cosense'), { recursive: true });
  writeFileSync(join(root, '.local/cosense/settings.json'), JSON.stringify({ users: [{ url: 'https://scrapbox.io', token: 'test-only' }] }));
  config('commit');
  const head = git(root, 'rev-parse', 'HEAD');
  let result = run('sync'); assert.equal(result.status, 0, result.stderr);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  result = run('session:start'); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.notEqual(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'archive/articles.json');
});
