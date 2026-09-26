import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { syncArchive } from '../lib/sync.mjs';
import { controlledGet } from '../lib/sync-requests.mjs';
import { hash, loadArchive } from '../lib/archive.mjs';
import { authenticatedGet, HttpError } from '../integrations/cosense/client.mjs';
import { startSession } from '../lib/session.mjs';
import { fakeClock } from './support/clock.mjs';

const projectUrl = 'https://scrapbox.io/example';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sync-recovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'workspace'], { cwd: root });
  return root;
}
const page = (id, title, updated = 1) => ({ id, title, updated, commitId: `commit-${updated}`, persistent: true,
  lines: [{ id: `line-${id}`, text: title }], links: [], projectLinks: [], icons: [] });
function server(pages, hook = () => {}) {
  const calls = [];
  return { calls, get: async url => {
    calls.push(url); await hook(url, calls.length);
    const parsed = new URL(url);
    if (parsed.pathname.includes('/v2/')) {
      const title = decodeURIComponent(parsed.pathname.split('/').at(-1)).replaceAll('_', ' ');
      return structuredClone(pages.find(p => p.title === title) ?? { persistent: false });
    }
    return { count: pages.length, skip: 0, limit: 1000, pages: structuredClone(pages) };
  } };
}
const options = clock => ({ clock, onProgress: () => {} });
const progressDir = root => join(root, '.local/sync-progress');
const cooldownPath = root => join(root, '.local/sync-rate-limit.json');
const bodies = remote => remote.calls.filter(url => url.includes('/v2/'));

test('all requests are serialized and spaced, including concurrent callers', async t => {
  const root = fixture(t); const clock = fakeClock(); const starts = [];
  let active = 0; let maxActive = 0;
  const get = controlledGet(root, projectUrl, async url => {
    starts.push(clock.monotonic()); active++; maxActive = Math.max(maxActive, active);
    await Promise.resolve(); active--; return url;
  }, options(clock));
  assert.deepEqual(await Promise.all(['a', 'b', 'c'].map(get)), ['a', 'b', 'c']);
  assert.equal(maxActive, 1); assert.deepEqual(starts.map(time => time - starts[0]), [0, 1000, 2000]);
});

test('429 has exactly three retries and persists the next wait across runs', async t => {
  const root = fixture(t); const clock = fakeClock(); let calls = 0;
  const get = controlledGet(root, projectUrl, async () => { calls++; throw new HttpError(429); }, options(clock));
  await assert.rejects(get('same-url'), /上限3回/);
  assert.equal(calls, 4); assert.deepEqual(clock.sleeps, [5000, 10000, 20000]);
  const state = JSON.parse(readFileSync(cooldownPath(root), 'utf8'));
  assert.equal(Date.parse(state.notBefore) - clock.now(), 20000);
  assert.equal(statSync(cooldownPath(root)).mode & 0o777, 0o600);
  const next = controlledGet(root, projectUrl, async () => 'ok', options(clock));
  assert.equal(await next('same-url'), 'ok'); assert.equal(clock.sleeps.at(-1), 20000);
});

test('Retry-After seconds and dates are respected; malformed values stop without retry', async t => {
  for (const kind of ['seconds', 'date', 'past', 'invalid', 'overflow', 'negative', 'empty', 'bad-date']) {
    const root = fixture(t); const clock = fakeClock(); let calls = 0;
    const values = { seconds: '12', date: new Date(clock.now() + 12000).toUTCString(),
      past: new Date(clock.now() - 1000).toUTCString(), invalid: 'tomorrow', overflow: '999999999999999999',
      negative: '-1', empty: '', 'bad-date': 'Sat, 31 Feb 2026 10:00:00 GMT' };
    const get = controlledGet(root, projectUrl, async () => {
      if (++calls === 1) throw new HttpError(429, values[kind]); return 'ok';
    }, options(clock));
    if (['seconds', 'date', 'past'].includes(kind)) {
      assert.equal(await get('url'), 'ok'); assert.deepEqual(clock.sleeps, [kind === 'past' ? 5000 : 12000]);
    } else {
      await assert.rejects(get('url'), /Retry-After が不正/); assert.equal(calls, 1); assert.deepEqual(clock.sleeps, []);
    }
  }
});

test('the 60-second wait budget spans URLs and persisted waits; rebuild retains cooldown', async t => {
  const root = fixture(t); const clock = fakeClock(); const tries = new Map();
  const get = controlledGet(root, projectUrl, async url => {
    const n = (tries.get(url) ?? 0) + 1; tries.set(url, n);
    if (n === 1) throw new HttpError(429, '40'); return 'ok';
  }, options(clock));
  assert.equal(await get('a'), 'ok'); await assert.rejects(get('b'), /上限60秒/);
  assert.equal(tries.get('b'), 1);
  const state = JSON.parse(readFileSync(cooldownPath(root), 'utf8'));
  state.notBefore = new Date(clock.now() + 61000).toISOString(); writeFileSync(cooldownPath(root), JSON.stringify(state));
  const remote = server([]);
  await assert.rejects(syncArchive(root, projectUrl, { rebuild: true, get: remote.get, ...options(clock) }), /上限60秒/);
  assert.equal(remote.calls.length, 0);
  assert.deepEqual(JSON.parse(readFileSync(cooldownPath(root), 'utf8')), state);
});

test('non-429 errors and cooldown write failures stop without further requests', async t => {
  for (const status of [401, 403, 404, 500, 'network']) {
    const root = fixture(t); let calls = 0;
    const get = controlledGet(root, projectUrl, async () => {calls++; throw status === 'network' ? new Error('network') : new HttpError(status);}, options(fakeClock()));
    await assert.rejects(get('url')); assert.equal(calls, 1);
  }
  const root = fixture(t); let calls = 0;
  const get = controlledGet(root, projectUrl, async () => {
    calls++; mkdirSync(cooldownPath(root), { recursive: true }); throw new HttpError(429);
  }, options(fakeClock()));
  await assert.rejects(get('url'), /待機状態の保存に失敗/); assert.equal(calls, 1);
});

test('HTTP adapter preserves Retry-After and cancels the error body', async t => {
  const root = fixture(t); mkdirSync(join(root, '.local/cosense'), { recursive: true });
  writeFileSync(join(root, '.local/cosense/settings.json'), JSON.stringify({ users: [{ url: 'https://scrapbox.io', token: 'test-only' }] }));
  let cancelled = false;
  const get = authenticatedGet(root, projectUrl, async () => ({ ok: false, status: 429,
    headers: new Headers({ 'Retry-After': '12' }), body: { cancel: async () => { cancelled = true; } } }));
  await assert.rejects(get('https://scrapbox.io/api/pages/example/'), error => error instanceof HttpError && error.retryAfter === '12');
  assert.equal(cancelled, true);
});

test('interrupted first sync resumes saved bodies without publishing a partial archive', async t => {
  const root = fixture(t); const clock = fakeClock(); const pages = [page('a', 'Alpha'), page('b', 'Beta')];
  const first = server(pages, (_, n) => { if (n === 3) throw new Error('interrupted'); });
  await assert.rejects(syncArchive(root, projectUrl, {get: first.get, ...options(clock)}), /interrupted/);
  assert.equal(existsSync(join(root, 'archive/articles.json')), false);
  const path = join(progressDir(root), `${hash('a')}.json`);
  assert.equal(statSync(progressDir(root)).mode & 0o777, 0o700); assert.equal(statSync(path).mode & 0o777, 0o600);
  const saved = JSON.parse(readFileSync(path, 'utf8')).article;
  const resumed = server(pages);
  await syncArchive(root, projectUrl, {get: resumed.get, ...options(clock)});
  assert.equal(bodies(resumed).length, 1); assert.ok(bodies(resumed)[0].endsWith('/Beta'));
  assert.deepEqual(loadArchive(root, projectUrl).data.articles[0], saved);
  assert.equal(existsSync(progressDir(root)), false);
});

test('snapshot retries reuse unchanged saved bodies and retain the atomic archive', async t => {
  const root = fixture(t); const clock = fakeClock(); const pages = [page('a', 'Alpha')];
  const remote = server(pages, (_, n) => { if (n === 3) pages.push(page('b', 'Beta')); });
  await syncArchive(root, projectUrl, {get: remote.get, ...options(clock)});
  assert.equal(bodies(remote).length, 2); assert.ok(clock.sleeps.includes(5000));
  const before = loadArchive(root, projectUrl).text;
  pages[0] = page('a', 'Alpha', 2);
  const broken = server(pages, (_, n) => { if (n === 3) throw new Error('stop'); });
  // Body is followed by the final list, where publication must still be withheld.
  await assert.rejects(syncArchive(root, projectUrl, {get: broken.get, ...options(clock)}), /stop/);
  assert.equal(loadArchive(root, projectUrl).text, before);
});

test('resume refetches updates and renames, omits deletions, and rebuild refetches all', async t => {
  for (const kind of ['updated', 'renamed', 'deleted', 'rebuild']) {
    const root = fixture(t); const clock = fakeClock(); const pages = [page('a', 'Alpha'), page('b', 'Beta')];
    const failed = server(pages, (_, n) => { if (n === 4) throw new Error('stop'); });
    await assert.rejects(syncArchive(root, projectUrl, {get: failed.get, ...options(clock)}), /stop/);
    if (kind === 'updated') pages[0] = page('a', 'Alpha', 2);
    if (kind === 'renamed') pages[0].title = 'Renamed';
    if (kind === 'deleted') pages.shift();
    const resumed = server(pages);
    await syncArchive(root, projectUrl, {get: resumed.get, rebuild: kind === 'rebuild', ...options(clock)});
    assert.equal(bodies(resumed).length, kind === 'rebuild' ? 2 : kind === 'deleted' ? 0 : 1);
    assert.deepEqual(loadArchive(root, projectUrl).data.articles.map(p => p.title), pages.map(p => p.title));
  }
});

test('corrupt progress rejects before network; rebuild recovers it, but not malformed cooldown', async t => {
  for (const kind of ['hash', 'unknown', 'project', 'version', 'filename', 'line']) {
    const root = fixture(t); const clock = fakeClock(); const pages = [page('a', 'Alpha')];
    const failed = server(pages, (_, n) => { if (n === 3) throw new Error('stop'); });
    await assert.rejects(syncArchive(root, projectUrl, {get: failed.get, ...options(clock)}));
    const path = join(progressDir(root), `${hash('a')}.json`); const record = JSON.parse(readFileSync(path, 'utf8'));
    if (kind === 'hash') record.contentHash = 'wrong';
    if (kind === 'unknown') record.extra = true;
    if (kind === 'line') {record.article.lines[0].extra = true; record.contentHash = hash(JSON.stringify(record.article));}
    if (kind === 'version') record.version = 2;
    writeFileSync(path, JSON.stringify(record));
    if (kind === 'project') writeFileSync(join(progressDir(root), 'state.json'), JSON.stringify({version: 1, projectUrl: 'https://scrapbox.io/other'}));
    if (kind === 'filename') writeFileSync(join(progressDir(root), 'unknown.json'), '{}');
    const remote = server(pages);
    await assert.rejects(syncArchive(root, projectUrl, {get: remote.get, ...options(clock)}), /--rebuild/);
    assert.equal(remote.calls.length, 0);
    await syncArchive(root, projectUrl, {rebuild: true, get: remote.get, ...options(clock)});
    assert.equal(bodies(remote).length, 1);
  }
  const root = fixture(t); mkdirSync(join(root, '.local'));
  for (const content of ['{broken', JSON.stringify({version: 1, projectUrl: 'https://scrapbox.io/other', notBefore: null}), JSON.stringify({version: 1, projectUrl, notBefore: null, extra: true})]) {
    writeFileSync(cooldownPath(root), content);
    const remote = server([]);
    await assert.rejects(syncArchive(root, projectUrl, {rebuild: true, get: remote.get, ...options(fakeClock())}), /送信待機状態/);
    assert.equal(remote.calls.length, 0);
  }
});

test('known atomic-write remnants recover and publication followed by interruption can resume', async t => {
  const root = fixture(t); const clock = fakeClock(); const pages = [page('a', 'Alpha')];
  const first = server(pages, (_, n) => { if (n === 3) throw new Error('stop'); });
  await assert.rejects(syncArchive(root, projectUrl, {get: first.get, ...options(clock)}));
  writeFileSync(join(progressDir(root), `${hash('a')}.json.00000000-0000-0000-0000-000000000000.tmp`), 'partial');
  // A metadata failure occurs after the archive was published but before cleanup.
  mkdirSync(join(root, '.local/sync.json'));
  const next = server(pages);
  await assert.rejects(syncArchive(root, projectUrl, {get: next.get, ...options(clock)}), /同期状態の保存/);
  assert.equal(bodies(next).length, 0); assert.equal(loadArchive(root, projectUrl).data.articles.length, 1);
  assert.equal(readdirSync(progressDir(root)).some(name => name.endsWith('.tmp')), false);
  rmSync(join(root, '.local/sync.json'), {recursive: true});
  const resumed = server(pages);
  await syncArchive(root, projectUrl, {get: resumed.get, ...options(clock)});
  assert.equal(bodies(resumed).length, 0); assert.equal(existsSync(progressDir(root)), false);
});

test('article save failures withhold publication and session fetch uses the same retry control', async t => {
  const root = fixture(t); const clock = fakeClock(); const pages = [page('a', 'Alpha')];
  const broken = server(pages, url => {
    if (url.includes('/v2/')) mkdirSync(join(progressDir(root), `${hash('a')}.json`));
  });
  await assert.rejects(syncArchive(root, projectUrl, {get: broken.get, ...options(clock)}), /途中成果の保存/);
  assert.equal(existsSync(join(root, 'archive/articles.json')), false);
  rmSync(progressDir(root), {recursive: true});
  const remote = server(pages); let attempts = 0; const messages = [];
  assert.equal(await startSession(root, {projectUrl, syncMode: 'fetch'}, {
    clock, print: text => messages.push(text), onProgress: text => messages.push(text),
    get: async url => { if (++attempts === 1) throw new HttpError(429); return remote.get(url); }
  }), true);
  assert.ok(messages.some(text => text.includes('再試行 1/3'))); assert.ok(clock.sleeps.includes(5000));
});

test('first-sync failures give the appropriate next step without an unrelated login hint', async t => {
  for (const [status, nextStep] of [[401, /npm run auth:login/], [403, /アクセス権/], [404, /projectUrl/], [500, /時間を置いて npm run sync/], [429, /次回試行の目安:.*npm run sync/], ['network', /接続を確認して npm run sync/]]) {
    const root = fixture(t); const clock = fakeClock(); const messages = [];
    mkdirSync(join(root, '.local/cosense'), {recursive: true});
    writeFileSync(join(root, '.local/cosense/settings.json'), JSON.stringify({users: [{url: 'https://scrapbox.io', token: 'test-only'}]}));
    const get = authenticatedGet(root, projectUrl, async () => {
      if (status === 'network') throw new Error('offline');
      return {ok: false, status, headers: new Headers({'retry-after': '120'})};
    });
    const ok = await startSession(root, {projectUrl, syncMode: 'fetch'}, {
      clock, get, print: text => messages.push(text), onProgress: text => messages.push(text)
    });
    const output = messages.join('\n');
    assert.equal(ok, false); assert.match(output, /同期失敗/); assert.match(output, nextStep);
    assert.match(output, /取得時点: 未取得/); assert.doesNotMatch(output, /既存記事を保持|取得済み本文は保存|再実行可能時刻/);
    if (status !== 401) assert.doesNotMatch(output, /ログイン|auth:login/);
    if (status === 429) assert.match(output, /制限解除を保証する時刻ではありません/);
  }
});

test('malformed Retry-After and progress storage errors include a recovery action', async t => {
  const root = fixture(t); const clock = fakeClock();
  const get = controlledGet(root, projectUrl, async () => {throw new HttpError(429, 'invalid');}, options(clock));
  await assert.rejects(get('url'), error => /次回試行時刻は不明/.test(error.message) && /連続実行を避け/.test(error.message));
  const remote = server([page('a', 'Alpha')], url => {
    if (url.includes('/v2/')) mkdirSync(join(progressDir(root), `${hash('a')}.json`));
  });
  await assert.rejects(syncArchive(root, projectUrl, {get: remote.get, ...options(clock)}), error =>
    /書き込み権限と空き容量/.test(error.message) && /npm run sync で再開/.test(error.message));
});
