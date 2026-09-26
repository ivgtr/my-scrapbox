import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepare, writeBundle } from '../../evaluation/prepare.mjs';
import { startTrial, bindLaunch, captureFixed, failTrial, runtimeChecks, captureCycle, judgeTrial } from '../../evaluation/trials.mjs';
import { createFixture, cycleInput } from '../../evaluation/fixture.mjs';
const cases = JSON.parse(readFileSync(new URL('../../evaluation/cases.json', import.meta.url), 'utf8'));
const source = new URL('../../', import.meta.url).pathname;
const options = { availableAt: '2026-09-26T12:00:00.000Z', targetHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim() };
const temp = t => { const root = mkdtempSync(join(tmpdir(), 'evaluation-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
function launch(root, path) {
  const event = join(root, 'runtime.txt');
  writeFileSync(event, 'MOCK runtime proof: synthetic test only');
  const checks = Object.fromEntries(runtimeChecks.map(key => [key, { status: 'verified', value: `MOCK ${key}`, evidencePath: event }]));
  const trialId = JSON.parse(readFileSync(join(path, 'trial.json'), 'utf8')).trialId;
  const order = readdirSync(root).filter(name => existsSync(join(root, name, 'launch.json'))).length + 1;
  const args = { childId: `mock-${trialId}`, order, runtime: 'mock-only', sentInput: readFileSync(join(path, 'input.txt'), 'utf8'), checks };
  bindLaunch(path, args);
  return { event, args };
}
function trial(root, id) { return startTrial(root, { trialId: id, method: 'fixed', run: prepare(cases, options)[0] }); }
test('fixed snapshots retain full request and one condition, never rubrics', t => {
  const root = temp(t), output = join(root, 'bundle');
  const runs = writeBundle(cases, output, options);
  assert.equal(runs.length, cases.length * 3);
  assert.throws(() => writeBundle(cases, output, options), /EEXIST/);
  for (const c of cases) {
    const [none, raw, understanding] = runs.filter(r => r.caseId === c.id);
    assert.equal(none.evidence.length, 0);
    assert.deepEqual(raw.evidence.map(e => e.value), c.raw);
    assert.deepEqual(understanding.evidence.map(e => e.value), [...c.raw, ...c.understanding]);
    for (const run of [none, raw, understanding]) {
      const path = startTrial(root, { trialId: `${c.id}-${run.condition}`, method: 'fixed', run });
      const input = JSON.parse(readFileSync(join(path, 'input.txt'), 'utf8'));
      assert.equal(input.request, c.request);
      assert.equal(input.targetHead, options.targetHead);
      assert.ok(!JSON.stringify(input).includes(JSON.stringify(c.must)));
      assert.ok(!JSON.stringify(input).includes(JSON.stringify(c.avoid)));
    }
  }
});
test('original JSON bytes and Japanese multiline answer survive; IDs and launch are immutable', t => {
  const root = temp(t), path = trial(root, 'one');
  const { event, args } = launch(root, path);
  assert.throws(() => bindLaunch(path, { ...args, childId: 'different', order: 2, sentInput: args.sentInput + ' ' }), /一致|同時/);
  const answer = '日本語\n"引用"\\そのまま 🧠\n';
  const original = JSON.stringify({ trialId: 'one', status: 'completed', answer, usedEvidenceIds: [], error: null }, null, 4) + '\n';
  const file = join(root, 'out.json'); writeFileSync(file, original);
  assert.equal(captureFixed(path, { sourcePath: file, sourceKind: 'runtime-final', eventPath: event }).status, 'completed');
  assert.equal(readFileSync(join(path, 'answer.txt'), 'utf8'), answer);
  assert.equal(readFileSync(join(path, 'final-output.json'), 'utf8'), original);
  assert.throws(() => failTrial(path, 'overwrite'), /終了済み/);
  assert.throws(() => trial(root, 'one'), /EEXIST/);
});
test('summary replacement, wrong ID, invalid schema, missing output, and incomplete execution remain failed trials', t => {
  const root = temp(t);
  for (const [id, kind, value] of [
    ['summary', 'agent-summary', { trialId: 'summary', status: 'completed', answer: '要約', usedEvidenceIds: [], error: null }],
    ['wrong', 'runtime-final', { trialId: 'other', status: 'completed', answer: '回答', usedEvidenceIds: [], error: null }],
    ['unknown', 'runtime-final', { trialId: 'unknown', status: 'completed', answer: '回答', usedEvidenceIds: [], error: null, extra: true }],
    ['incomplete', 'runtime-final', { trialId: 'incomplete', status: 'failed', answer: '', usedEvidenceIds: [], error: '中断' }],
    ['missing', 'runtime-final', null]
  ]) {
    const path = trial(root, id), { event } = launch(root, path), file = join(root, `${id}.json`);
    if (value) writeFileSync(file, JSON.stringify(value));
    assert.equal(captureFixed(path, { sourcePath: file, sourceKind: kind, eventPath: event }).status, 'invalid');
    assert.equal(existsSync(join(path, 'answer.txt')), false);
  }
  const first = trial(root, 'interrupted'); failTrial(first, 'runtime stopped');
  const retry = trial(root, 'retry');
  assert.equal(readFileSync(join(first, 'input.txt'), 'utf8').replaceAll('interrupted', 'retry'), readFileSync(join(retry, 'input.txt'), 'utf8'));
  const args = { childId: 'x', order: 99, runtime: 'x', sentInput: readFileSync(join(retry, 'input.txt'), 'utf8'), checks: {} };
  assert.throws(() => bindLaunch(retry, args), /契約/);
});
test('stage fixtures contain only synthetic articles and captured memory; artifacts and transcripts never propagate', t => {
  const root = temp(t);
  const fixture = createFixture(source, join(root, 'form-fixture'), { ...options, stage: 'form' });
  const path = startTrial(root, { trialId: 'cycle-form', method: 'cycle', input: cycleInput(fixture, 'cycle-form'), fixture: fixture.fixture });
  const { event } = launch(root, path);
  const cli = (...args) => execFileSync(process.execPath, [join(fixture.fixture, 'src/cli/local.mjs'), ...args], { cwd: fixture.fixture, encoding: 'utf8' });
  assert.match(cli('session:start'), /syncMode=none/);
  assert.match(cli('read', '通知試行', '--json'), /synthetic-v1/);
  assert.throws(() => createFixture(source, join(root, 'bad'), { ...options, stage: 'reuse', previousTrial: path }));
  assert.equal(captureCycle(path, { eventPath: event }).status, 'invalid');
  assert.ok(existsSync(join(path, 'memory-after.json')));
  assert.throws(() => judgeTrial(path, { trialId: 'cycle-form', findings: [], unconfirmed: [], eventVerification: [] }), /判定対象/);
});
test('successful artifact capture permits only verified next-stage memory, without previous answers', t => {
  const root = temp(t);
  const fixture = createFixture(source, join(root, 'first'), { ...options, stage: 'form' });
  const path = startTrial(root, { trialId: 'success-form', method: 'cycle', input: cycleInput(fixture, 'success-form'), fixture: fixture.fixture });
  const { event } = launch(root, path);
  const memoryInput = { metadata: { kind: 'understanding', title: '合成テスト', basis: 'inference', confirmation: 'unconfirmed', scope: { conditions: 'CLIテストのみ', exceptions: 'モデル評価ではない' }, targetTime: null, sources: [], state: 'current', replaces: [], changeReason: 'CLIテスト' }, body: 'テスト用記憶' };
  const inputPath = join(fixture.fixture, 'artifacts', 'test-input.json');
  writeFileSync(inputPath, JSON.stringify(memoryInput));
  const stdout = execFileSync(process.execPath, [join(fixture.fixture, 'src/cli/local.mjs'), 'memory:create', '--file', inputPath], { cwd: fixture.fixture, encoding: 'utf8' });
  const saved = JSON.parse(stdout);
  writeFileSync(event, `memory:create\n${stdout}`);
  writeFileSync(join(fixture.fixture, 'artifacts/answer.txt'), 'テスト回答原本\n');
  writeFileSync(join(fixture.fixture, 'artifacts/execution.json'), JSON.stringify({ trialId: 'success-form', stage: 'form', status: 'completed', usedRecords: [{ id: saved.id, revision: saved.revision }], operations: [{ command: 'memory:create', eventRef: 'mock-event' }], error: null }));
  assert.equal(captureCycle(path, { eventPath: event }).status, 'completed');
  assert.throws(() => judgeTrial(path, { trialId: 'success-form', findings: [{ criterion: 'mock', verdict: 'met', quote: '存在しない文' }], unconfirmed: [], eventVerification: [] }), /原本/);
  judgeTrial(path, { trialId: 'success-form', findings: [{ criterion: 'fixture only', verdict: 'met', quote: 'テスト回答原本' }], unconfirmed: ['モデル挙動は未検証'], eventVerification: [{ command: 'memory:create', status: 'verified', eventQuote: stdout }] });
  const next = createFixture(source, join(root, 'second'), { ...options, stage: 'reuse', previousTrial: path });
  assert.equal(readFileSync(join(next.fixture, 'memory/records', `${saved.id}.md`), 'utf8'), readFileSync(join(fixture.fixture, 'memory/records', `${saved.id}.md`), 'utf8'));
  assert.equal(existsSync(join(next.fixture, 'artifacts/answer.txt')), false);
  assert.equal(existsSync(join(next.fixture, 'artifacts/execution.json')), false);
  assert.equal(existsSync(join(next.fixture, 'artifacts/test-input.json')), false);
  assert.throws(() => createFixture(source, join(root, 'skip'), { ...options, stage: 'correct', previousTrial: path }), /前段階/);
});
test('missing execution log preserves answer; missing memory still records terminal failure', t => {
  const root = temp(t);
  const fixture = createFixture(source, join(root, 'partial'), { ...options, stage: 'form' });
  const path = startTrial(root, { trialId: 'partial-form', method: 'cycle', input: cycleInput(fixture, 'partial-form'), fixture: fixture.fixture });
  const { event } = launch(root, path);
  writeFileSync(join(fixture.fixture, 'artifacts/answer.txt'), '取得できた回答\n');
  rmSync(join(fixture.fixture, 'memory'), { recursive: true });
  assert.equal(captureCycle(path, { eventPath: event }).status, 'invalid');
  assert.equal(readFileSync(join(path, 'answer.txt'), 'utf8'), '取得できた回答\n');
  assert.match(JSON.parse(readFileSync(join(path, 'result.json'), 'utf8')).reason, /記憶回収失敗/);
});
