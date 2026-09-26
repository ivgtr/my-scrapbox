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
    exact(envelope, ['inputPath', 'outputPath', 'instructions']);
    text(envelope.inputPath); text(envelope.outputPath); text(envelope.instructions);
    if (envelope.inputPath !== resolve(path, 'input.txt') || envelope.outputPath !== resolve(path, 'runtime', 'final-output.json')) throw new Error('入力・原本の指定パスが不正です。');
  }
  exact(checks, runtimeChecks);
  const evidence = {};
  for (const key of runtimeChecks) {
    exact(checks[key], ['status', 'value', 'evidencePath', 'reason']);
    if (!['verified', 'unconfirmed'].includes(checks[key].status)) throw new Error('確認状態が不正です。');
    if (checks[key].status === 'unconfirmed') {
      if (checks[key].value !== null || checks[key].evidencePath !== null) throw new Error('未確認の値・根拠はnullです。');
      text(checks[key].reason);
      if (trial.method === 'cycle') throw new Error('実経路の成立条件が未確認です。');
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
export function failTrial(path, reason) {
  const trial = pending(path); text(reason);
let snapshotError = null;
  if (trial.fixture) {
  try {
    const after = memorySnapshot(trial.fixture);
    save(join(path, 'memory-after.json'), after);
    const input = json(join(path, 'input.txt'));
    if (['reuse', 'reuse-corrected'].includes(input.stage) && after.sha256 !== json(join(path, 'memory-before.json')).sha256) throw new Error('参照段階で記憶が変更されています。');
    const environment = { archive: readFileSync(join(trial.fixture, 'archive/articles.json'), 'utf8'), config: readFileSync(join(trial.fixture, 'cosense.config.json'), 'utf8') };
    save(join(path, 'environment-after.json'), environment);
    if (JSON.stringify(environment) !== JSON.stringify(json(join(path, 'environment-before.json')))) throw new Error('記事または設定が変更されています。');
  }
    catch (error) { snapshotError = error.message; }
  }
  save(join(path, 'result.json'), { trialId: trial.trialId, status: 'failed', reason, snapshotError });
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
export function captureCycle(path, { eventPath }) {
  const trial = pending(path);
  if (trial.method !== 'cycle') throw new Error('実経路ではありません。');
  let status = 'completed', reason = null;
  try {
    json(join(path, 'launch.json'));
    const input = JSON.parse(readFileSync(join(path, 'input.txt'), 'utf8'));
    if (lstatSync(join(trial.fixture, 'artifacts')).isSymbolicLink() || lstatSync(join(trial.fixture, input.output.answer)).isSymbolicLink()) throw new Error('成果物にsymlinkは不可です。');
    const answer = readFileSync(join(trial.fixture, input.output.answer), 'utf8');
    writeFileSync(join(path, 'answer.txt'), answer, { flag: 'wx', mode: 0o600 });
    if (lstatSync(join(trial.fixture, input.output.execution)).isSymbolicLink()) throw new Error('成果物にsymlinkは不可です。');
    const logBytes = readFileSync(join(trial.fixture, input.output.execution));
    writeFileSync(join(path, 'execution.json'), logBytes, { flag: 'wx', mode: 0o600 });
    text(answer);
    const log = JSON.parse(logBytes.toString('utf8'));
    exact(log, ['trialId', 'stage', 'status', 'usedRecords', 'operations', 'error']);
    if (log.trialId !== trial.trialId || log.stage !== input.stage || log.status !== 'completed' || log.error !== null) throw new Error('実行記録が未完了または試行不一致です。');
    if (!Array.isArray(log.usedRecords) || log.usedRecords.some(r => { exact(r, ['id', 'revision']); return typeof r.id !== 'string' || !Number.isInteger(r.revision) || r.revision < 1; })) throw new Error('記録ID・revisionが不正です。');
    if (!Array.isArray(log.operations) || log.operations.some(op => { exact(op, ['command', 'eventRef']); return typeof op.command !== 'string' || !(op.eventRef === null || typeof op.eventRef === 'string'); })) throw new Error('操作記録が不正です。');
    // Preserve artifact bytes, but operations remain self-reports until parent judgment matches runtime events.
    const events = readFileSync(eventPath);
    if (!events.length) throw new Error('ランタイムイベントが未取得です。');
    writeFileSync(join(path, 'runtime-events.bin'), events, { flag: 'wx', mode: 0o600 });
  } catch (error) { status = 'invalid'; reason = error.message; }
try {
    const after = memorySnapshot(trial.fixture);
    save(join(path, 'memory-after.json'), after);
    const input = json(join(path, 'input.txt'));
    if (['reuse', 'reuse-corrected'].includes(input.stage) && after.sha256 !== json(join(path, 'memory-before.json')).sha256) throw new Error('参照段階で記憶が変更されています。');
    const environment = { archive: readFileSync(join(trial.fixture, 'archive/articles.json'), 'utf8'), config: readFileSync(join(trial.fixture, 'cosense.config.json'), 'utf8') };
    save(join(path, 'environment-after.json'), environment);
    if (JSON.stringify(environment) !== JSON.stringify(json(join(path, 'environment-before.json')))) throw new Error('記事または設定が変更されています。');
  }
  catch (error) { status = 'invalid'; reason = [reason, `記憶回収失敗: ${error.message}`].filter(Boolean).join(' / '); }
  save(join(path, 'result.json'), { trialId: trial.trialId, status, reason, operations: 'self-reported-until-event-verification' });
  return { status, reason };
}
export function judgeTrial(path, judgment) {
  const trial = json(join(path, 'trial.json')), result = json(join(path, 'result.json'));
  exact(judgment, ['trialId', 'findings', 'unconfirmed', 'eventVerification']);
  if (judgment.trialId !== trial.trialId || result.status !== 'completed') throw new Error('判定対象が不正です。');
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
