import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, cpSync, statSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from '../lib/archive.mjs';
import { saveMemory, readMemory, searchMemory, indexMemory, memorySummary } from '../lib/memory.mjs';
import { startSession } from '../lib/session.mjs';

const projectUrl = 'https://scrapbox.io/example';
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t, configured = true) {
  const root = mkdtempSync(join(tmpdir(), 'memory-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(new URL('../', import.meta.url), join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  git(root, 'init', '-b', configured ? 'workspace' : 'main');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'Test fixture');
  if (configured) {
    writeFileSync(join(root, 'cosense.config.json'), JSON.stringify({ projectUrl }));
    mkdirSync(join(root, 'memory'));
    writeFileSync(join(root, 'memory/index.md'), '# 自由記述\n\n[従来記憶](legacy.md)\n');
    writeFileSync(join(root, 'memory/legacy.md'), '自由形式は変更しない。');
  }
  return root;
}
const input = (extra = {}, body = '日本語 集中 "引用" 100% a_b 🧠') => ({ metadata: {
  kind: 'understanding', title: '集中の条件', basis: 'inference', confirmation: 'unconfirmed',
  scope: { conditions: '短い作業', exceptions: '状況不明' }, targetTime: null, sources: [],
  state: 'current', replaces: [], changeReason: '根拠なしの仮説として記録', ...extra
}, body });
const dialogue = { type: 'dialogue', confirmedAt: '2026-09-26T00:00:00.000Z', speaker: 'user', excerpt: '今は短い作業を選びたい', context: '今回の計画相談' };
const article = { type: 'article', projectUrl, pageId: 'p1', commitId: 'c1', lineIds: ['l1'] };
function archive(root, { commitId = 'c1', lines = [{ id: 'l1', text: '原文' }], deleted = false } = {}) {
  mkdirSync(join(root, 'archive'), { recursive: true });
  const articles = deleted ? [] : [{ id: 'p1', title: '記事', updated: 1, commitId, fetchedAt: '2026-09-26T00:00:00.000Z', lines, links: [], projectLinks: [], icons: [] }];
  writeFileSync(join(root, 'archive/articles.json'), JSON.stringify({ version: 1, projectUrl, syncedAt: '2026-09-26T00:00:00.000Z', articles, contentHash: hash(JSON.stringify(articles)) }));
}
function run(root, ...args) {
  const guard = join(root, 'no-network.mjs');
  writeFileSync(guard, 'globalThis.fetch = () => { throw new Error("NETWORK FORBIDDEN"); };');
  return spawnSync(process.execPath, ['--import', guard, join(root, 'src/cli/local.mjs'), ...args], { encoding: 'utf8' });
}
const recordPath = (root, id) => join(root, 'memory/records', `${id}.md`);

test('create, read, search and index retain legacy text; session loads counts, not bodies', async t => {
  const root = fixture(t);
  const legacy = readFileSync(join(root, 'memory/legacy.md'), 'utf8');
  const result = saveMemory(root, input({ sources: [dialogue] }, 'この本文はセッションへ自動投入しない 日本語 集中'));
  assert.equal(result.revision, 1);
  const read = readMemory(root, projectUrl, result.id);
  assert.equal(read.metadata.basis, 'inference');
  assert.equal(read.metadata.confirmation, 'unconfirmed');
  assert.equal(read.evidence.sources[0].externalFactVerified, false);
  assert.deepEqual(read.evidence.sources[0].source, dialogue);
  assert.ok(read.metadata.createdAt);
  assert.equal(readFileSync(join(root, 'memory/legacy.md'), 'utf8'), legacy);
  const index = readFileSync(join(root, 'memory/index.md'), 'utf8');
  assert.ok(index.startsWith('# 自由記述\n\n[従来記憶](legacy.md)\n'));
  indexMemory(root); assert.equal(readFileSync(join(root, 'memory/index.md'), 'utf8'), index);
  const output = [];
  await startSession(root, { projectUrl }, { print: s => output.push(s), get: () => { throw new Error('network'); } });
  assert.match(output.join('\n'), /"count":1/);
  assert.doesNotMatch(output.join('\n'), /この本文はセッションへ自動投入しない/);
  assert.equal(searchMemory(root, '日本語 集中').total, 1);
  assert.equal(run(root, 'memory').stdout, index);
});

test('literal Japanese and symbols, scope, AND and paging are stable', t => {
  const root = fixture(t);
  const results = Array.from({ length: 23 }, (_, i) => saveMemory(root, input({ title: `記録${String(22-i).padStart(2,'0')}` })));
  for (const query of ['日', '日本語 集中', '"引用"', '100%', 'a_b', '🧠', '短い 作業', '状況不明']) assert.equal(searchMemory(root, query).total, 23, query);
  const seen = [];
  for (let offset = 0; offset !== null;) {
    const page = searchMemory(root, '日本語', { limit: 7, offset });
    seen.push(...page.items.map(p => p.id)); offset = page.nextOffset;
  }
  assert.deepEqual(seen, results.map(r => r.id).reverse());
  assert.equal(searchMemory(root, 'none').nextOffset, null);
  assert.deepEqual(searchMemory(root, '日', { offset: Number.MAX_SAFE_INTEGER }).items, []);
  assert.equal(JSON.parse(run(root, 'memory:search', '日', '--limit', '2', '--offset', '22').stdout).items.length, 1);
});

test('revision CAS, correction, replacement, withdrawal and cycles preserve existing records', t => {
  const root = fixture(t);
  const a = saveMemory(root, input());
  const before = readFileSync(recordPath(root, a.id), 'utf8');
  assert.throws(() => saveMemory(root, input(), { id: a.id, expectRevision: 2 }), /revision競合/);
  assert.equal(readFileSync(recordPath(root, a.id), 'utf8'), before);
  const b = saveMemory(root, input({ sources: [{ type: 'memory', id: a.id, revision: 1 }] }));
  assert.throws(() => saveMemory(root, input({ sources: [{ type: 'memory', id: b.id, revision: 1 }] }), { id: a.id, expectRevision: 1 }), /循環/);
  assert.throws(() => saveMemory(root, input({ replaces: [b.id] }), { id: a.id, expectRevision: 1 }), /循環/);
  saveMemory(root, input({ state: 'replaced', changeReason: '解釈を訂正' }), { id: a.id, expectRevision: 1 });
  const c = saveMemory(root, input({ replaces: [a.id], sources: [dialogue], changeReason: '本人の訂正による置換' }));
  assert.equal(readMemory(root, projectUrl, c.id).metadata.replaces[0], a.id);
  assert.equal(readMemory(root, projectUrl, b.id).evidence.sources[0].status, 'changed-revision');
  saveMemory(root, input({ state: 'withdrawn', changeReason: '不適切な推論を撤回' }), { id: b.id, expectRevision: 1 });
  assert.equal(searchMemory(root, '集中').total, 1);
  assert.equal(searchMemory(root, '集中', { all: true }).total, 3);
  assert.equal(JSON.parse(run(root, 'memory:search', '集中', '--all').stdout).total, 3);
  assert.deepEqual(memorySummary(root).states, { current: 1, replaced: 1, withdrawn: 1 });
});

test('article JSON and recursive evidence expose exact lines and stale versions without network', t => {
  const root = fixture(t); archive(root);
  const a = saveMemory(root, input({ sources: [article, dialogue] }));
  const b = saveMemory(root, input({ sources: [{ type: 'memory', id: a.id, revision: 1 }] }));
  let result = run(root, 'memory:evidence', b.id);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).sources[0].current.sources[0].current.lines[0].id, 'l1');
  result = run(root, 'read', '記事', '--json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).lines[0].id, 'l1');
  assert.match(run(root, 'read', '記事').stdout, /commitId: c1\n\n原文/);
  const before = readFileSync(recordPath(root, a.id), 'utf8');
  archive(root, { commitId: 'c2' });
  assert.equal(readMemory(root, projectUrl, b.id).evidence.needsRecheck, true);
  assert.equal(readMemory(root, projectUrl, a.id).evidence.sources[0].status, 'changed-version');
  archive(root, { lines: [] });
  assert.equal(readMemory(root, projectUrl, a.id).evidence.sources[0].status, 'missing-lines');
  archive(root, { deleted: true });
  assert.equal(readMemory(root, projectUrl, a.id).evidence.sources[0].status, 'missing-page');
  rmSync(join(root, 'archive/articles.json'));
  assert.equal(readMemory(root, projectUrl, a.id).evidence.sources[0].status, 'archive-unavailable');
  assert.equal(readFileSync(recordPath(root, a.id), 'utf8'), before);
});

test('strict inputs, references, branches, locks and missing entry never initialize or corrupt', t => {
  const root = fixture(t); archive(root);
  const a = saveMemory(root, input());
  const before = readFileSync(recordPath(root, a.id), 'utf8');
  const invalid = [input({ unknown: true }), input({ targetTime: 12 }), input({ scope: 'anything' }), input({ confirmation: true }),
    input({ sources: [{ type: 'memory', id: 'missing', revision: 1 }] }), input({ replaces: ['missing'] }),
    input({ sources: [{ ...article, lineIds: ['missing'] }] }), input({ sources: [{ ...article, commitId: 'old' }] }),
    input({ sources: [{ ...article, projectUrl: 'https://scrapbox.io/other' }] }),
    input({ sources: [{ ...dialogue, confirmedAt: '2026-02-30T00:00:00.000Z' }] }),
    input({ sources: [{ ...dialogue, extra: true }] }), input({ sources: [{ type: 'other' }] }),
    input({ schemaVersion: 1 }), input({ revision: 2 }), input({ replaces: [a.id, a.id] })];
  for (const value of invalid) assert.throws(() => saveMemory(root, value, { id: a.id, expectRevision: 1 }));
  assert.equal(readFileSync(recordPath(root, a.id), 'utf8'), before);
  mkdirSync(join(root, 'memory/.write.lock'));
  assert.throws(() => saveMemory(root, input()), /ロック/);
  rmSync(join(root, 'memory/.write.lock'), { recursive: true });
  git(root, 'switch', '-c', 'main');
  assert.throws(() => saveMemory(root, input()), /workspace/);
  git(root, 'switch', 'workspace');
  rmSync(join(root, 'memory/index.md'));
  assert.throws(() => saveMemory(root, input()));
  assert.equal(existsSync(join(root, 'memory/index.md')), false);
  const unconfigured = fixture(t, false);
  for (const name of ['memory:create', 'memory:update', 'memory:search', 'memory:read', 'memory:evidence', 'memory:index']) {
    const args = name === 'memory:create' ? ['--file', join(root,'payload.json')] : name === 'memory:update' ? ['test', '--file', 'missing', '--expect-revision', '1'] : name === 'memory:search' ? ['日'] : ['memory:read', 'memory:evidence'].includes(name) ? ['test'] : [];
    assert.equal(run(unconfigured, name, ...args).status, 1);
    assert.equal(existsSync(join(unconfigured, 'memory')), false);
    assert.equal(existsSync(join(unconfigured, 'cosense.config.json')), false);
  }
});

test('record save failure preserves old data; index partial success is explicit and recoverable', t => {
  const root = fixture(t);
  const a = saveMemory(root, input());
  const indexBefore = readFileSync(join(root, 'memory/index.md'), 'utf8');
  const before = readFileSync(recordPath(root, a.id), 'utf8');
  // A non-file record target is rejected before any replacement.
  rmSync(recordPath(root, a.id)); mkdirSync(recordPath(root, a.id));
  assert.throws(() => saveMemory(root, input(), { id: a.id, expectRevision: 1 }));
  assert.equal(readFileSync(join(root, 'memory/index.md'), 'utf8'), indexBefore);
  rmSync(recordPath(root, a.id), { recursive: true }); writeFileSync(recordPath(root, a.id), before);
  writeFileSync(join(root, 'memory/index.md'), '# 自由記述\n<!-- memory:records:start -->\n');
  let partial;
  try { saveMemory(root, input({ changeReason: '訂正' }), { id: a.id, expectRevision: 1 }); }
  catch (error) { partial = error; }
  assert.deepEqual(partial.partialResult, { id: a.id, revision: 2, recordSaved: true, indexUpdated: false });
  assert.match(partial.message, /memory:index/);
  assert.equal(readMemory(root, projectUrl, a.id).metadata.revision, 2);
  writeFileSync(join(root, 'memory/index.md'), '# 自由記述\n');
  indexMemory(root);
  assert.match(readFileSync(join(root, 'memory/index.md'), 'utf8'), new RegExp(a.id));
  assert.equal(existsSync(join(root, 'memory/.write.lock')), false);
  assert.equal(statSync(recordPath(root, a.id)).mode & 0o777, 0o600);
});

test('CLI create/update use validated payloads and reject malformed options before config', t => {
  const root = fixture(t), file = join(root, 'payload.json');
  writeFileSync(file, JSON.stringify(input()));
  let result = run(root, 'memory:create', '--file', file);
  assert.equal(result.status, 0, result.stderr);
  const created = JSON.parse(result.stdout);
  result = run(root, 'memory:update', created.id, '--file', file, '--expect-revision', '1');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).revision, 2);
  assert.match(run(root, 'memory:update', created.id, '--file', file, '--expect-revision', '1').stderr, /競合/);
  writeFileSync(join(root, 'cosense.config.json'), '{bad');
  for (const args of [ ['memory:create'], ['memory:create', '--file', file, '--file', file], ['memory:create', '--other', file],
    ['memory:update', created.id, '--file', file], ['memory:update', created.id, '--file', file, '--expect-revision', '1.1'],
    ['memory:search', '日', '--all', '--all'], ['memory:search', '日', '--offset', '--all', '2'], ['memory:search', '日', '--limit', '0'], ['read', '記事', '--other'] ]) {
    const bad = run(root, ...args);
    assert.equal(bad.status, 1); assert.doesNotMatch(bad.stderr, /config/);
  }
});


test('stale provenance can be retained explicitly while withdrawing a record', t => {
  const root = fixture(t); archive(root);
  const a = saveMemory(root, input({ sources: [article] }));
  archive(root, { deleted: true });
  saveMemory(root, input({ sources: [article], state: 'withdrawn', changeReason: '原文消失のため撤回' }), { id: a.id, expectRevision: 1 });
  const record = readMemory(root, projectUrl, a.id);
  assert.equal(record.metadata.state, 'withdrawn');
  assert.equal(record.evidence.needsRecheck, true);
  assert.throws(() => saveMemory(root, input({ sources: [article] })), /根拠/);
});

test('filesystem write failure leaves the old record and index intact', { skip: process.getuid?.() === 0 }, t => {
  const root = fixture(t);
  const a = saveMemory(root, input());
  const before = readFileSync(recordPath(root, a.id), 'utf8');
  const index = readFileSync(join(root, 'memory/index.md'), 'utf8');
  // Temp lives outside records; deny the destination rename while permitting lock/temp creation.
  const directory = join(root, 'memory/records');
  chmodSync(directory, 0o500);
  try { assert.throws(() => saveMemory(root, input(), { id: a.id, expectRevision: 1 }), /EACCES/); }
  finally { chmodSync(directory, 0o700); }
  assert.equal(readFileSync(recordPath(root, a.id), 'utf8'), before);
  assert.equal(readFileSync(join(root, 'memory/index.md'), 'utf8'), index);
  assert.deepEqual(readdirSync(join(root, 'memory')).sort(), ['index.md', 'legacy.md', 'records']);
});

test('two concurrent CLI writers cannot both overwrite the same revision', async t => {
  const root = fixture(t), a = saveMemory(root, input()), file = join(root, 'payload.json');
  writeFileSync(file, JSON.stringify(input({ changeReason: '競合検証' })));
  const invoke = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'src/cli/local.mjs'), 'memory:update', a.id, '--file', file, '--expect-revision', '1']);
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', status => resolve({ status, stderr }));
  });
  const results = await Promise.all([invoke(), invoke()]);
  assert.deepEqual(results.map(r => r.status).sort(), [0, 1]);
  assert.match(results.find(r => r.status === 1).stderr, /競合|ロック/);
  assert.equal(readMemory(root, projectUrl, a.id).metadata.revision, 2);
});


test('malformed persisted metadata and missing memory evidence remain visible', t => {
  const root = fixture(t), a = saveMemory(root, input());
  const b = saveMemory(root, input({ sources: [{ type: 'memory', id: a.id, revision: 1 }] }));
  const before = readFileSync(recordPath(root, a.id), 'utf8');
  writeFileSync(recordPath(root, a.id), before.replace('"schemaVersion": 1', '"schemaVersion": 2'));
  assert.throws(() => readMemory(root, projectUrl, a.id), /不正/);
  writeFileSync(recordPath(root, a.id), before.replace('"revision": 1', '"unknown": true, "revision": 1'));
  assert.throws(() => searchMemory(root, '集中'), /項目/);
  rmSync(recordPath(root, a.id));
  const evidence = readMemory(root, projectUrl, b.id).evidence;
  assert.equal(evidence.needsRecheck, true);
  assert.equal(evidence.sources[0].status, 'missing-memory');
  assert.throws(() => saveMemory(root, input()), /参照先不明/);
});
