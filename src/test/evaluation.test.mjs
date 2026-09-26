import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepare, writeBundle } from '../../evaluation/prepare.mjs';
import { startTrial, bindLaunch, captureFixed, failTrial, runtimeChecks, captureCycle, judgeTrial } from '../../evaluation/trials.mjs';
import { createFixture, cycleInput, stages } from '../../evaluation/fixture.mjs';
const cases = JSON.parse(readFileSync(new URL('../../evaluation/cases.json', import.meta.url), 'utf8'));
const source = new URL('../../', import.meta.url).pathname;
const options = { availableAt: '2026-09-26T12:00:00.000Z', targetHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim() };
const temp = t => { const root = mkdtempSync(join(tmpdir(), 'evaluation-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
function launch(root, path) {
  const event = join(root, 'runtime.txt');
  writeFileSync(event, 'MOCK runtime proof: synthetic test only');
  const checks = Object.fromEntries(runtimeChecks.map(key => [key, { status: 'verified', value: `MOCK ${key}`, evidencePath: event, reason: null }]));
  const trialId = JSON.parse(readFileSync(join(path, 'trial.json'), 'utf8')).trialId;
  const order = readdirSync(root).filter(name => existsSync(join(root, name, 'launch.json'))).length + 1;
  const args = { childId: `mock-${trialId}`, order, runtime: 'mock-only', delivery: 'inline', sentInput: readFileSync(join(path, 'input.txt'), 'utf8'), checks };
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
  assert.equal(captureFixed(path, { sourcePath: file, sourceKind: 'runtime-final', eventPath: event, executionStatus: 'completed' }).status, 'completed');
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
    assert.equal(captureFixed(path, { sourcePath: file, sourceKind: kind, eventPath: event, executionStatus: 'completed' }).status, 'invalid');
    assert.equal(existsSync(join(path, 'answer.txt')), false);
  }
  const first = trial(root, 'interrupted'); failTrial(first, 'runtime stopped');
  const retry = trial(root, 'retry');
  assert.equal(readFileSync(join(first, 'input.txt'), 'utf8').replaceAll('interrupted', 'retry'), readFileSync(join(retry, 'input.txt'), 'utf8'));
  const args = { childId: 'x', order: 99, runtime: 'x', delivery: 'inline', sentInput: readFileSync(join(retry, 'input.txt'), 'utf8'), checks: {} };
  assert.throws(() => bindLaunch(retry, args), /契約/);
});
test('launch records unknown settings without claiming comparison validity for both methods', t => {
  const root = temp(t), path = trial(root, 'observed');
  const event = join(root, 'events.txt'); writeFileSync(event, 'MOCK final event');
  const checks = Object.fromEntries(runtimeChecks.map(key => [key, { status: 'verified', value: `MOCK ${key}`, evidencePath: event, reason: null }]));
  checks.modelSettings = { status: 'unconfirmed', value: null, evidencePath: null, reason: '実効設定を取得できない' };
  const args = { childId: 'mock-observed', runtime: 'mock-only', delivery: 'inline', order: 1, sentInput: readFileSync(join(path, 'input.txt'), 'utf8'), checks };
  assert.throws(() => bindLaunch(path, { ...args, sentInput: args.sentInput + ' ' }), /一致/);
  for (const change of [{ status: 'unknown' }, { value: '推測値' }, { evidencePath: event }, { reason: '' }, { extra: true }]) {
    assert.throws(() => bindLaunch(path, { ...args, checks: { ...checks, modelSettings: { ...checks.modelSettings, ...change } } }));
  }
  bindLaunch(path, args);
  assert.throws(() => bindLaunch(path, args), /同時|再利用/);
  const file = join(root, 'output.json');
  writeFileSync(file, JSON.stringify({ trialId: 'observed', status: 'completed', answer: '回答原本', usedEvidenceIds: [], error: null }));
  captureFixed(path, { sourcePath: file, sourceKind: 'runtime-final', eventPath: event, executionStatus: 'completed' });
  const result = JSON.parse(readFileSync(join(path, 'result.json')));
  assert.equal(result.status, 'completed'); assert.equal(result.comparison, 'parent-unassessed');
  assert.deepEqual(result.unconfirmedChecks, ['modelSettings']);
  const recorded = JSON.parse(readFileSync(join(path, 'launch.json'))).evidence;
  assert.equal(recorded.modelSettings.bytes, null); assert.equal(recorded.tools.status, 'verified');
  assert.equal(Buffer.from(recorded.tools.bytes, 'base64').toString(), readFileSync(event, 'utf8'));
  const fixture = createFixture(source, join(root, 'cycle-fixture'), { ...options, stage: 'form' });
  const cycle = startTrial(root, { trialId: 'strict-cycle', method: 'cycle', input: cycleInput(fixture, 'strict-cycle'), fixture: fixture.fixture });
  bindLaunch(cycle, { ...args, childId: 'mock-cycle', order: 2, sentInput: readFileSync(join(cycle, 'input.txt'), 'utf8') });
  assert.equal(JSON.parse(readFileSync(join(cycle, 'launch.json'))).evidence.modelSettings.status, 'unconfirmed');
});
test('capture retains original and events when launch or execution evidence is incomplete', t => {
  const root = temp(t), event = join(root, 'event.txt'); writeFileSync(event, 'MOCK raw event\n');
  for (const executionStatus of ['completed', 'interrupted', 'unconfirmed']) {
    const path = trial(root, executionStatus), file = join(root, `${executionStatus}.json`);
    const original = JSON.stringify({ trialId: executionStatus, status: 'completed', answer: '取得済み回答\n', usedEvidenceIds: [], error: null }) + '\n';
    writeFileSync(file, original);
    if (executionStatus !== 'completed') launch(root, path);
    assert.throws(() => captureFixed(path, { sourcePath: file, sourceKind: 'runtime-final', eventPath: event, executionStatus: 'unknown' }), /実行状態/);
    captureFixed(path, { sourcePath: file, sourceKind: 'runtime-final', eventPath: event, executionStatus });
    assert.equal(readFileSync(join(path, 'final-output.json'), 'utf8'), original);
    assert.equal(readFileSync(join(path, 'answer.txt'), 'utf8'), '取得済み回答\n');
    assert.equal(readFileSync(join(path, 'output-event.bin'), 'utf8'), 'MOCK raw event\n');
    const result = JSON.parse(readFileSync(join(path, 'result.json')));
    assert.equal(result.status, 'invalid'); assert.equal(result.outputStatus, 'completed');
    assert.equal(result.executionStatus, executionStatus);
    assert.equal(result.launchStatus, executionStatus === 'completed' ? 'missing' : 'bound');
    assert.throws(() => judgeTrial(path, { kind: 'assessment', trialId: executionStatus, findings: [], unconfirmed: [], eventVerification: [] }), /判定対象/);
  }
  const missing = trial(root, 'missing-raw');
  captureFixed(missing, { sourcePath: join(root, 'absent'), sourceKind: 'runtime-final', eventPath: event, executionStatus: 'failed' });
  assert.equal(readFileSync(join(missing, 'output-event.bin'), 'utf8'), 'MOCK raw event\n');
});
test('file delivery retains sent envelope and fixed input separately and captures the designated original', t => {
  const root = temp(t), path = trial(root, 'file-delivery');
  mkdirSync(join(path, 'runtime'));
  const event = join(root, 'event.txt'); writeFileSync(event, 'MOCK child completion');
  const envelope = { inputPath: join(path, 'input.txt'), outputPath: join(path, 'runtime', 'final-output.json'), instructions: '指定入力を読み、回答全文を指定先へ保存する' };
  const checks = Object.fromEntries(runtimeChecks.map(key => [key, { status: 'unconfirmed', value: null, evidencePath: null, reason: 'MOCK 未確認' }]));
  const args = { childId: 'mock-file', runtime: 'mock-only', delivery: 'file', order: 1, sentInput: JSON.stringify(envelope), checks };
  assert.throws(() => bindLaunch(path, { ...args, delivery: 'unknown' }), /渡し方/);
  for (const change of [{ inputPath: join(root, 'other') }, { outputPath: join(root, 'other') }, { extra: true }]) {
    assert.throws(() => bindLaunch(path, { ...args, sentInput: JSON.stringify({ ...envelope, ...change }) }));
  }
  const originalInput = readFileSync(envelope.inputPath, 'utf8');
  writeFileSync(envelope.inputPath, originalInput + ' ');
  assert.throws(() => bindLaunch(path, args), /固定入力が変更/);
  writeFileSync(envelope.inputPath, originalInput);
  bindLaunch(path, args);
  const launchRecord = JSON.parse(readFileSync(join(path, 'launch.json')));
  assert.equal(launchRecord.sentInput, args.sentInput);
  assert.equal(launchRecord.inputHash, JSON.parse(readFileSync(join(path, 'trial.json'))).inputHash);
  assert.notEqual(launchRecord.sentInputHash, launchRecord.inputHash);
  const original = JSON.stringify({ trialId: 'file-delivery', status: 'completed', answer: '原本\n"引用"', usedEvidenceIds: [], error: null }, null, 2) + '\n';
  writeFileSync(envelope.outputPath, original);
  assert.equal(captureFixed(path, { sourcePath: envelope.outputPath, sourceKind: 'designated-artifact', eventPath: event, executionStatus: 'completed' }).status, 'completed');
  assert.equal(readFileSync(join(path, 'final-output.json'), 'utf8'), original);
  assert.deepEqual(JSON.parse(readFileSync(join(path, 'result.json'))).unconfirmedChecks, runtimeChecks);
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
  assert.equal(captureCycle(path, { eventPath: event, executionStatus: 'completed' }).status, 'invalid');
  assert.ok(existsSync(join(path, 'memory-after.json')));
  assert.throws(() => judgeTrial(path, { kind: 'assessment', trialId: 'cycle-form', findings: [], unconfirmed: [], eventVerification: [] }), /判定対象/);
});
test('completed capture permits next-stage memory with unconfirmed operations, without previous answers', t => {
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
  assert.equal(captureCycle(path, { eventPath: event, executionStatus: 'completed' }).status, 'completed');
  assert.throws(() => judgeTrial(path, { kind: 'assessment', trialId: 'success-form', findings: [{ criterion: 'mock', verdict: 'met', quote: '存在しない文' }], unconfirmed: [], eventVerification: [] }), /原本/);
  assert.throws(() => judgeTrial(path, { kind: 'assessment', trialId: 'success-form', findings: [], unconfirmed: [], eventVerification: [{ command: 'memory:create', status: 'verified', eventQuote: '存在しないイベント' }] }), /イベント照合/);
  judgeTrial(path, { kind: 'assessment', trialId: 'success-form', findings: [{ criterion: 'fixture only', verdict: 'met', quote: 'テスト回答原本' }], unconfirmed: ['モデル挙動は未検証'], eventVerification: [{ command: 'memory:create', status: 'unconfirmed', eventQuote: '' }] });
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
  assert.equal(captureCycle(path, { eventPath: event, executionStatus: 'completed' }).status, 'invalid');
  assert.equal(readFileSync(join(path, 'answer.txt'), 'utf8'), '取得できた回答\n');
  assert.match(JSON.parse(readFileSync(join(path, 'result.json'), 'utf8')).reason, /記憶回収失敗/);
});

function cycleTrial(root, id, stage = 'form', previousTrial = null) {
  const fixture = createFixture(source, join(root, `${id}-fixture`), { ...options, stage, previousTrial });
  const path = startTrial(root, { trialId: id, method: 'cycle', input: cycleInput(fixture, id), fixture: fixture.fixture });
  return { path, fixture };
}
function cycleArtifacts(fixture, id, stage = 'form') {
  writeFileSync(join(fixture.fixture, 'artifacts/answer.txt'), '取得済み回答\n');
  writeFileSync(join(fixture.fixture, 'artifacts/execution.json'), JSON.stringify({ trialId: id, stage, status: 'completed', usedRecords: [], operations: [], error: null }));
}
test('cycle requires parent completion and retains artifacts on interrupted, failed, or unconfirmed execution', t => {
  const root = temp(t);
  for (const executionStatus of ['interrupted', 'failed', 'unconfirmed']) {
    const { path, fixture } = cycleTrial(root, executionStatus), { event } = launch(root, path);
    cycleArtifacts(fixture, executionStatus);
    for (const value of [undefined, 'unknown']) assert.throws(() => captureCycle(path, { eventPath: event, executionStatus: value }), /実行状態/);
    assert.equal(existsSync(join(path, 'result.json')), false);
    assert.equal(captureCycle(path, { eventPath: event, executionStatus }).status, 'invalid');
    const result = JSON.parse(readFileSync(join(path, 'result.json')));
    assert.equal(result.executionStatus, executionStatus);
    assert.equal(result.outputStatus, 'completed');
    for (const file of ['answer.txt', 'execution.json', 'runtime-events.bin', 'memory-after.json', 'environment-after.json']) assert.ok(existsSync(join(path, file)));
    assert.throws(() => createFixture(source, join(root, `${executionStatus}-next`), { ...options, stage: 'reuse', previousTrial: path }));
  }
});
test('cycle captures remaining artifacts independently when launch, answer, log, events, memory, or environment fail', t => {
  const root = temp(t);
  for (const failure of ['launch', 'answer', 'missing-log', 'malformed-log', 'events', 'memory', 'environment']) {
    const { path, fixture } = cycleTrial(root, failure), { event } = launch(root, path);
    cycleArtifacts(fixture, failure);
    const missing = { launch: join(path, 'launch.json'), answer: join(fixture.fixture, 'artifacts/answer.txt'), 'missing-log': join(fixture.fixture, 'artifacts/execution.json'), events: event, memory: join(fixture.fixture, 'memory'), environment: join(fixture.fixture, 'archive/articles.json') };
    if (failure === 'malformed-log') writeFileSync(join(fixture.fixture, 'artifacts/execution.json'), '{bad json');
    else rmSync(missing[failure], { recursive: true });
    assert.equal(captureCycle(path, { eventPath: event, executionStatus: 'completed' }).status, 'invalid');
    const skipped = { answer: 'answer.txt', 'missing-log': 'execution.json', events: 'runtime-events.bin', memory: 'memory-after.json', environment: 'environment-after.json' }[failure];
    for (const file of ['answer.txt', 'execution.json', 'runtime-events.bin', 'memory-after.json', 'environment-after.json']) if (file !== skipped) assert.ok(existsSync(join(path, file)), `${failure}: ${file}`);
    if (failure === 'malformed-log') assert.equal(readFileSync(join(path, 'execution.json'), 'utf8'), '{bad json');
    assert.ok(JSON.parse(readFileSync(join(path, 'result.json'))).reason);
  }
});
test('diagnosis preserves invalid trial state and bytes, accepts absent evidence, and rejects invalid references', t => {
  const root = temp(t), { path, fixture } = cycleTrial(root, 'diagnose'), { event } = launch(root, path);
  writeFileSync(join(fixture.fixture, 'artifacts/answer.txt'), '保存後に失敗した回答');
  captureCycle(path, { eventPath: event, executionStatus: 'failed' });
  const before = Object.fromEntries(readdirSync(path).map(file => [file, readFileSync(join(path, file))]));
  const observation = { observation: '実行記録が保存されていない', artifact: 'result.json', reason: '回収時の欠落理由を確認した' };
  const judgment = { trialId: 'diagnose', kind: 'diagnostic', observations: [observation, { observation: '原因は未特定', artifact: null, reason: '実行記録が存在しないため' }], unconfirmed: ['保存失敗の原因'] };
  for (const artifact of ['../result.json', '/tmp/other', 'execution.json', 'unknown']) assert.throws(() => judgeTrial(path, { ...judgment, observations: [{ ...observation, artifact }] }));
  assert.throws(() => judgeTrial(path, { ...judgment, observations: [{ ...observation, reason: '' }] }));
  assert.throws(() => judgeTrial(path, { ...judgment, kind: 'unknown' }));
  judgeTrial(path, judgment);
  assert.equal(JSON.parse(readFileSync(join(path, 'judgment.json'))).assessment, 'diagnostic-only');
  for (const [file, bytes] of Object.entries(before)) assert.deepEqual(readFileSync(join(path, file)), bytes);
  assert.throws(() => judgeTrial(path, judgment), /EEXIST/);
  assert.throws(() => createFixture(source, join(root, 'diagnose-next'), { ...options, stage: 'reuse', previousTrial: path }));
  const failed = trial(root, 'failed-diagnosis'); failTrial(failed, '起動できなかった');
  judgeTrial(failed, { ...judgment, trialId: 'failed-diagnosis' });
  assert.equal(JSON.parse(readFileSync(join(failed, 'result.json'))).status, 'failed');
});
test('cycle file delivery validates its two artifact paths and preserves unconfirmed checks', t => {
  const root = temp(t), { path, fixture } = cycleTrial(root, 'file-cycle');
  const checks = Object.fromEntries(runtimeChecks.map(key => [key, { status: 'unconfirmed', value: null, evidencePath: null, reason: '取得できない' }]));
  const envelope = { inputPath: join(path, 'input.txt'), output: { answer: join(fixture.fixture, 'artifacts/answer.txt'), execution: join(fixture.fixture, 'artifacts/execution.json') }, instructions: '指定入力を読み指定された二つの成果物を保存する' };
  const args = { childId: 'file-cycle-child', order: 1, runtime: 'mock', delivery: 'file', checks };
  for (const invalid of [
    { ...envelope, inputPath: join(root, 'other') },
    { inputPath: envelope.inputPath, outputPath: join(path, 'runtime/final-output.json'), instructions: envelope.instructions },
    { ...envelope, output: { ...envelope.output, answer: join(path, 'runtime/final-output.json') } },
    { ...envelope, output: { ...envelope.output, execution: join(root, 'other') } },
    { ...envelope, output: { ...envelope.output, extra: true } }
  ]) assert.throws(() => bindLaunch(path, { ...args, sentInput: JSON.stringify(invalid) }));
  const input = readFileSync(envelope.inputPath, 'utf8');
  writeFileSync(envelope.inputPath, input + ' ');
  assert.throws(() => bindLaunch(path, { ...args, sentInput: JSON.stringify(envelope) }), /固定入力/);
  writeFileSync(envelope.inputPath, input);
  bindLaunch(path, { ...args, sentInput: JSON.stringify(envelope) });
  const record = JSON.parse(readFileSync(join(path, 'launch.json')));
  assert.notEqual(record.inputHash, record.sentInputHash);
  cycleArtifacts(fixture, 'file-cycle');
  const event = join(root, 'event'); writeFileSync(event, 'MOCK completion');
  assert.equal(captureCycle(path, { eventPath: event, executionStatus: 'completed' }).status, 'completed');
  assert.deepEqual(JSON.parse(readFileSync(join(path, 'result.json'))).unconfirmedChecks, runtimeChecks);
});
test('stage transitions keep completion, head, order and snapshot checks; final request does not reveal correction', t => {
  const root = temp(t);
  let previousTrial = null;
  for (const stage of stages) {
    const { path, fixture } = cycleTrial(root, `sequence-${stage}`, stage, previousTrial), { event } = launch(root, path);
    if (stage === 'reuse-corrected') {
      assert.match(fixture.request, /現在は何が分かっていますか/);
      assert.ok(!/通知は全員読め|対応担当は決まっていません|必要な人は通知を読め/.test(fixture.request));
    }
    cycleArtifacts(fixture, `sequence-${stage}`, stage);
    if (stage === 'form') {
      const logPath = join(fixture.fixture, 'artifacts/execution.json');
      const log = JSON.parse(readFileSync(logPath));
      log.operations = [{ command: 'session:start', eventRef: null }];
      writeFileSync(logPath, JSON.stringify(log));
      writeFileSync(event, 'MOCK session:start completion');
    }
    captureCycle(path, { eventPath: event, executionStatus: 'completed' });
    assert.throws(() => judgeTrial(path, { trialId: `sequence-${stage}`, findings: [], unconfirmed: [], eventVerification: [] }), /契約/);
    judgeTrial(path, { trialId: `sequence-${stage}`, kind: 'assessment', findings: [], unconfirmed: ['操作の観測不足'], eventVerification: stage === 'form' ? [{ command: 'session:start', status: 'verified', eventQuote: 'MOCK session:start completion' }] : [] });
    if (stage === 'form') {
      assert.throws(() => createFixture(source, join(root, 'wrong-head'), { targetHead: 'a'.repeat(40), stage: 'reuse', previousTrial: path }), /前段階/);
      const judgmentPath = join(path, 'judgment.json'), judgment = readFileSync(judgmentPath, 'utf8');
      writeFileSync(judgmentPath, JSON.stringify({ ...JSON.parse(judgment), kind: 'diagnostic', assessment: 'diagnostic-only' }));
      assert.throws(() => createFixture(source, join(root, 'diagnostic-completed'), { ...options, stage: 'reuse', previousTrial: path }), /前段階/);
      writeFileSync(judgmentPath, judgment);
      const resultPath = join(path, 'result.json'), result = readFileSync(resultPath, 'utf8');
      writeFileSync(resultPath, JSON.stringify({ ...JSON.parse(result), executionStatus: 'unconfirmed' }));
      assert.throws(() => createFixture(source, join(root, 'unknown-end'), { ...options, stage: 'reuse', previousTrial: path }), /前段階/);
      writeFileSync(resultPath, result);
      const snapshotPath = join(path, 'memory-after.json'), snapshot = readFileSync(snapshotPath, 'utf8');
      writeFileSync(snapshotPath, JSON.stringify({ ...JSON.parse(snapshot), sha256: 'invalid' }));
      assert.throws(() => createFixture(source, join(root, 'bad-snapshot'), { ...options, stage: 'reuse', previousTrial: path }), /snapshot/);
      writeFileSync(snapshotPath, snapshot);
    }
    previousTrial = path;
  }
});
test('reuse memory changes invalidate capture but preserve environment; failTrial also collects environment independently', t => {
  const root = temp(t), first = cycleTrial(root, 'initial'), { event } = launch(root, first.path);
  cycleArtifacts(first.fixture, 'initial');
  captureCycle(first.path, { eventPath: event, executionStatus: 'completed' });
  judgeTrial(first.path, { trialId: 'initial', kind: 'assessment', findings: [], unconfirmed: [], eventVerification: [] });
  const next = cycleTrial(root, 'changed', 'reuse', first.path), nextLaunch = launch(root, next.path);
  cycleArtifacts(next.fixture, 'changed', 'reuse');
  writeFileSync(join(next.fixture.fixture, 'memory/index.md'), '変更禁止の段階で変更');
  assert.equal(captureCycle(next.path, { eventPath: nextLaunch.event, executionStatus: 'completed' }).status, 'invalid');
  assert.match(JSON.parse(readFileSync(join(next.path, 'result.json'))).reason, /参照段階/);
  assert.ok(existsSync(join(next.path, 'environment-after.json')));
  const failed = cycleTrial(root, 'snapshot-failure');
  rmSync(join(failed.fixture.fixture, 'memory'), { recursive: true });
  failTrial(failed.path, '中断');
  assert.ok(existsSync(join(failed.path, 'environment-after.json')));
  assert.match(JSON.parse(readFileSync(join(failed.path, 'result.json'))).snapshotError, /記憶回収失敗/);
});
