// Manual runtime boundary. This module never launches an agent or guesses provenance.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { hash } from '../src/lib/archive.mjs';
import { fixedInput } from './prepare.mjs';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const idOK = id => typeof id === 'string' && /^[a-z0-9-]+$/.test(id);
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error('契約項目が不正です。');
}
function text(value) { if (typeof value !== 'string' || !value.trim()) throw new Error('空の文字列は不可です。'); }
export function memorySnapshot(root) {
  const files = {};
  function visit(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), key = prefix + name, stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('fixtureにsymlinkは不可です。');
      if (stat.isDirectory()) visit(path, `${key}/`);
      else if (stat.isFile()) files[key] = readFileSync(path, 'utf8');
      else throw new Error('通常ファイル以外は不可です。');
    }
  }
  const memoryRoot = join(root, 'memory');
  if (lstatSync(memoryRoot).isSymbolicLink()) throw new Error('fixtureにsymlinkは不可です。');
  visit(memoryRoot);
  return { files, sha256: hash(JSON.stringify(files)) };
}
export function startTrial(directory, { trialId, method, input, run = null, fixture = null }) {
  if (!idOK(trialId) || !['fixed', 'cycle'].includes(method)) throw new Error('試行ID・方式が不正です。');
  if (method === 'fixed') input = fixedInput(run, trialId);
  else {
    const contract = JSON.parse(input);
    if (contract.trialId !== trialId || contract.method !== method || contract.fixture !== fixture || !['form', 'reuse', 'correct', 'reuse-corrected'].includes(contract.stage) || contract.output?.answer !== 'artifacts/answer.txt' || contract.output?.execution !== 'artifacts/execution.json') throw new Error('実経路の入力対応が不正です。');
  }
  text(input);
  const path = join(directory, trialId);
  mkdirSync(path); // Retry must use a new ID.
  writeFileSync(join(path, 'input.txt'), input, { flag: 'wx', mode: 0o600 });
  save(join(path, 'trial.json'), { trialId, method, inputHash: hash(input), run, fixture });
  if (fixture) {
    save(join(path, 'memory-before.json'), memorySnapshot(fixture));
    save(join(path, 'environment-before.json'), {
      archive: readFileSync(join(fixture, 'archive/articles.json'), 'utf8'),
      config: readFileSync(join(fixture, 'cosense.config.json'), 'utf8')
    });
  }
  return path;
}
export const runtimeChecks = ['conversation', 'automaticContext', 'tools', 'referenceScope', 'modelSettings', 'rawOutput'];
export function bindLaunch(path, { childId, runtime, sentInput, checks, order, delivery }) {
  const trial = pending(path);
  text(childId); text(runtime);
  if (!Number.isInteger(order) || order < 1) throw new Error('実行順は正の整数です。');
  for (const entry of readdirSync(dirname(path), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const launchPath = join(dirname(path), entry.name, 'launch.json');
    if (!existsSync(launchPath)) continue;
    const previous = json(launchPath);
    if (!existsSync(join(dirname(path), entry.name, 'result.json'))) throw new Error('同時に起動できる子は1つです。');
    if (previous.childId === childId || previous.order === order) throw new Error('子の識別子・実行順は再利用できません。');
  }
  text(sentInput);
  if (!['inline', 'file'].includes(delivery)) throw new Error('入力の渡し方が不正です。');
  const input = readFileSync(join(path, 'input.txt'), 'utf8');
  if (hash(input) !== trial.inputHash) throw new Error('固定入力が変更されています。');
  if (delivery === 'inline') {
    if (sentInput !== input) throw new Error('送信入力が固定入力と一致しません。');
  } else {
    const envelope = JSON.parse(sentInput);
    text(envelope.instructions);
    if (trial.method === 'fixed') {
      exact(envelope, ['inputPath', 'outputPath', 'instructions']);
      if (envelope.outputPath !== resolve(path, 'runtime', 'final-output.json')) throw new Error('原本の指定パスが不正です。');
    } else {
      exact(envelope, ['inputPath', 'output', 'instructions']);
      exact(envelope.output, ['answer', 'execution']);
      const contract = JSON.parse(input);
      if (envelope.output.answer !== resolve(trial.fixture, contract.output.answer) || envelope.output.execution !== resolve(trial.fixture, contract.output.execution)) throw new Error('実経路の成果物指定パスが不正です。');
    }
    if (envelope.inputPath !== resolve(path, 'input.txt')) throw new Error('入力の指定パスが不正です。');
  }
  exact(checks, runtimeChecks);
  const evidence = {};
  for (const key of runtimeChecks) {
    exact(checks[key], ['status', 'value', 'evidencePath', 'reason']);
    if (!['verified', 'unconfirmed'].includes(checks[key].status)) throw new Error('確認状態が不正です。');
    if (checks[key].status === 'unconfirmed') {
      if (checks[key].value !== null || checks[key].evidencePath !== null) throw new Error('未確認の値・根拠はnullです。');
      text(checks[key].reason);
      evidence[key] = { status: 'unconfirmed', value: null, sha256: null, bytes: null, reason: checks[key].reason };
      continue;
    }
    if (checks[key].reason !== null) throw new Error('確認済みのreasonはnullです。');
    text(checks[key].value); text(checks[key].evidencePath);
    // Runtime docs/events supplied by the parent, never a child's assertion.
    const bytes = readFileSync(checks[key].evidencePath);
    if (!bytes.length) throw new Error('成立根拠が空です。');
    evidence[key] = { status: 'verified', value: checks[key].value, sha256: hash(bytes), bytes: bytes.toString('base64'), reason: null };
  }
  save(join(path, 'launch.json'), { trialId: trial.trialId, childId, runtime, order, launchedAt: new Date().toISOString(), delivery, sentInput, sentInputHash: hash(sentInput), inputHash: trial.inputHash, evidence });
}
function pending(path) {
  if (existsSync(join(path, 'result.json'))) throw new Error('終了済み試行は変更できません。');
  return json(join(path, 'trial.json'));
}
function collect(errors, label, action) {
  try { action(); } catch (error) { errors.push(`${label}: ${error.message}`); }
}
function captureSnapshots(path, trial, errors) {
  collect(errors, '記憶回収失敗', () => {
    const after = memorySnapshot(trial.fixture);
    save(join(path, 'memory-after.json'), after);
    const input = json(join(path, 'input.txt'));
    if (['reuse', 'reuse-corrected'].includes(input.stage) && after.sha256 !== json(join(path, 'memory-before.json')).sha256) throw new Error('参照段階で記憶が変更されています。');
  });
  collect(errors, '環境回収失敗', () => {
    const environment = { archive: readFileSync(join(trial.fixture, 'archive/articles.json'), 'utf8'), config: readFileSync(join(trial.fixture, 'cosense.config.json'), 'utf8') };
    save(join(path, 'environment-after.json'), environment);
    if (JSON.stringify(environment) !== JSON.stringify(json(join(path, 'environment-before.json')))) throw new Error('記事または設定が変更されています。');
  });
}
export function failTrial(path, reason) {
  const trial = pending(path); text(reason);
  const errors = [];
  if (trial.fixture) captureSnapshots(path, trial, errors);
  save(join(path, 'result.json'), { trialId: trial.trialId, status: 'failed', reason, snapshotError: errors.length ? errors.join(' / ') : null });
}
export function captureFixed(path, { sourcePath, sourceKind, eventPath, executionStatus }) {
  const trial = pending(path);
  if (trial.method !== 'fixed') throw new Error('固定比較ではありません。');
  if (!['completed', 'failed', 'interrupted', 'unconfirmed'].includes(executionStatus)) throw new Error('実行状態が不正です。');
  let answer = null, outputStatus = 'invalid';
  const errors = [];
  // Capture independently: missing launch/output must not discard acquired events or bytes.
  let bytes = null;
  try {
    if (!['runtime-final', 'designated-artifact'].includes(sourceKind)) throw new Error('要約・自己申告を回答原本にはできません。');
    if (sourceKind === 'designated-artifact' && resolve(sourcePath) !== resolve(path, 'runtime', 'final-output.json')) throw new Error('指定された回答原本ではありません。');
    bytes = readFileSync(sourcePath);
    writeFileSync(join(path, 'final-output.json'), bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) { errors.push(error.message); }
  try {
    const event = readFileSync(eventPath);
    if (!event.length) throw new Error('原本取得イベントがありません。');
    writeFileSync(join(path, 'output-event.bin'), event, { flag: 'wx', mode: 0o600 });
  } catch (error) { errors.push(error.message); }
  try {
    if (bytes === null) throw new Error('回答原本がありません。');
    const output = JSON.parse(bytes.toString('utf8'));
    exact(output, ['trialId', 'status', 'answer', 'usedEvidenceIds', 'error']);
    if (output.trialId !== trial.trialId) throw new Error('試行IDが一致しません。');
    if (output.status !== 'completed' || output.error !== null) throw new Error('正常完了ではありません。');
    text(output.answer);
    const allowed = new Set(trial.run.evidence.map(e => e.evidenceId));
    if (!Array.isArray(output.usedEvidenceIds) || output.usedEvidenceIds.some(id => !allowed.has(id)) || new Set(output.usedEvidenceIds).size !== output.usedEvidenceIds.length) throw new Error('使用根拠IDが不正です。');
    answer = output.answer;
    writeFileSync(join(path, 'answer.txt'), answer, { flag: 'wx', mode: 0o600 });
    outputStatus = 'completed';
  } catch (error) { errors.push(error.message); }
  let launchStatus = 'missing', unconfirmedChecks = runtimeChecks;
  try {
    const launch = json(join(path, 'launch.json'));
    launchStatus = 'bound';
    unconfirmedChecks = runtimeChecks.filter(key => launch.evidence[key].status === 'unconfirmed');
  } catch (error) { errors.push(`起動証跡不足: ${error.message}`); }
  if (executionStatus !== 'completed') errors.push(`実行状態: ${executionStatus}`);
  const status = errors.length ? 'invalid' : 'completed', reason = errors.length ? errors.join(' / ') : null;
  save(join(path, 'result.json'), { trialId: trial.trialId, status, reason, sourceKind, outputStatus, executionStatus, launchStatus, unconfirmedChecks, comparison: 'parent-unassessed', answerHash: answer === null ? null : hash(answer) });
  return { status, reason };
}
export function captureCycle(path, { eventPath, executionStatus }) {
  const trial = pending(path);
  if (trial.method !== 'cycle') throw new Error('実経路ではありません。');
  if (!['completed', 'failed', 'interrupted', 'unconfirmed'].includes(executionStatus)) throw new Error('実行状態が不正です。');
  const errors = [];
  let launchStatus = 'missing', unconfirmedChecks = runtimeChecks, outputStatus = 'invalid', answerStatus = 'invalid', recordStatus = 'invalid';
  collect(errors, '起動証跡不足', () => {
    const launch = json(join(path, 'launch.json'));
    unconfirmedChecks = runtimeChecks.filter(key => launch.evidence[key].status === 'unconfirmed');
    launchStatus = 'bound';
  });
  // Each artifact has its own capture boundary; invalid bytes are retained for diagnosis.
  function artifact(name, destination) {
    const source = join(trial.fixture, 'artifacts', name);
    if (lstatSync(join(trial.fixture, 'artifacts')).isSymbolicLink() || lstatSync(source).isSymbolicLink()) throw new Error('成果物にsymlinkは不可です。');
    const bytes = readFileSync(source);
    writeFileSync(join(path, destination), bytes, { flag: 'wx', mode: 0o600 });
    return bytes;
  }
  collect(errors, '回答回収失敗', () => {
    text(artifact('answer.txt', 'answer.txt').toString('utf8'));
    answerStatus = 'completed';
  });
  collect(errors, '実行記録回収失敗', () => {
    const log = JSON.parse(artifact('execution.json', 'execution.json').toString('utf8'));
    const input = json(join(path, 'input.txt'));
    exact(log, ['trialId', 'stage', 'status', 'usedRecords', 'operations', 'error']);
    if (log.trialId !== trial.trialId || log.stage !== input.stage || log.status !== 'completed' || log.error !== null) throw new Error('実行記録が未完了または試行不一致です。');
    if (!Array.isArray(log.usedRecords) || log.usedRecords.some(r => { exact(r, ['id', 'revision']); return typeof r.id !== 'string' || !Number.isInteger(r.revision) || r.revision < 1; })) throw new Error('記録ID・revisionが不正です。');
    if (!Array.isArray(log.operations) || log.operations.some(op => { exact(op, ['command', 'eventRef']); return typeof op.command !== 'string' || !(op.eventRef === null || typeof op.eventRef === 'string'); })) throw new Error('操作記録が不正です。');
    recordStatus = 'completed';
  });
  collect(errors, 'イベント回収失敗', () => {
    const events = readFileSync(eventPath);
    writeFileSync(join(path, 'runtime-events.bin'), events, { flag: 'wx', mode: 0o600 });
    if (!events.length) throw new Error('ランタイムイベントが未取得です。');
  });
  captureSnapshots(path, trial, errors);
  if (answerStatus === 'completed' && recordStatus === 'completed') outputStatus = 'completed';
  if (executionStatus !== 'completed') errors.push(`実行状態: ${executionStatus}`);
  const status = errors.length ? 'invalid' : 'completed', reason = errors.length ? errors.join(' / ') : null;
  save(join(path, 'result.json'), { trialId: trial.trialId, status, reason, executionStatus, outputStatus, launchStatus, unconfirmedChecks, comparison: 'parent-unassessed', operations: 'self-reported-until-event-verification' });
  return { status, reason };
}
export function judgeTrial(path, judgment) {
  const trial = json(join(path, 'trial.json')), result = json(join(path, 'result.json'));
  if (judgment.trialId !== trial.trialId || !['completed', 'invalid', 'failed'].includes(result.status)) throw new Error('判定対象が不正です。');
  if (!Array.isArray(judgment.unconfirmed) || judgment.unconfirmed.some(value => typeof value !== 'string' || !value.trim())) throw new Error('未確認事項の形式が不正です。');
  if (judgment.kind === 'diagnostic') {
    exact(judgment, ['trialId', 'kind', 'observations', 'unconfirmed']);
    if (!Array.isArray(judgment.observations) || !judgment.observations.length) throw new Error('診断の観察結果が必要です。');
    const artifacts = ['input.txt', 'trial.json', 'launch.json', 'result.json', 'answer.txt', 'execution.json', 'runtime-events.bin', 'final-output.json', 'output-event.bin', 'memory-before.json', 'memory-after.json', 'environment-before.json', 'environment-after.json'];
    for (const observation of judgment.observations) {
      exact(observation, ['observation', 'artifact', 'reason']);
      text(observation.observation); text(observation.reason);
      if (observation.artifact !== null && (!artifacts.includes(observation.artifact) || !lstatSync(join(path, observation.artifact)).isFile())) throw new Error('取得済み成果物の参照が必要です。');
    }
    save(join(path, 'judgment.json'), { ...judgment, assessment: 'diagnostic-only', usefulness: 'user-unrated', outcome: 'not-observed' });
    return;
  }
  exact(judgment, ['trialId', 'kind', 'findings', 'unconfirmed', 'eventVerification']);
  if (judgment.kind !== 'assessment' || result.status !== 'completed') throw new Error('判定対象が不正です。');
  const answer = readFileSync(join(path, 'answer.txt'), 'utf8');
  if (!Array.isArray(judgment.findings) || judgment.findings.some(f => { exact(f, ['criterion', 'verdict', 'quote']); return !['met', 'violated', 'unconfirmed'].includes(f.verdict) || typeof f.criterion !== 'string' || typeof f.quote !== 'string' || !f.quote || !answer.includes(f.quote); })) throw new Error('回答原本の引用が必要です。');
  if (!Array.isArray(judgment.unconfirmed) || !Array.isArray(judgment.eventVerification)) throw new Error('判定の形式が不正です。');
  if (trial.method === 'cycle') {
    const events = readFileSync(join(path, 'runtime-events.bin'), 'utf8');
    const log = json(join(path, 'execution.json'));
    if (judgment.eventVerification.length !== log.operations.length || judgment.eventVerification.some((e, i) => {
      exact(e, ['command', 'status', 'eventQuote']);
      return e.command !== log.operations[i].command || !['verified', 'unconfirmed'].includes(e.status) ||
        typeof e.eventQuote !== 'string' || (e.status === 'verified' && (!e.eventQuote || !events.includes(e.eventQuote)));
    })) throw new Error('操作ごとのイベント照合が必要です。');
  }
  save(join(path, 'judgment.json'), { ...judgment, assessment: 'parent-provisional', usefulness: 'user-unrated', outcome: 'not-observed' });
}
