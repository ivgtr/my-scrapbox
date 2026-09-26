// Offline only. No model invocation or usefulness scoring.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { hash } from '../src/lib/archive.mjs';
export const rules = '現在の依頼に日本語で答えてください。根拠・推測・現在の意向を区別し、必要な不足を示しながら判断できる部分は進めてください。ツールは利用できますが、依頼の根拠として参照する情報はこの条件の合成入力に限ります。他条件の入力・回答、親の判定、個人データ、外部情報は参照しないでください。記憶の保存と子Agentの起動は禁止です。';
export function prepare(cases, { availableAt, targetHead }) {
  if (!Array.isArray(cases) || !cases.length || typeof availableAt !== 'string' || !Number.isFinite(Date.parse(availableAt)) || !/^[a-f0-9]{40}$/.test(targetHead ?? '')) throw new Error('評価例・利用可能時点・対象HEADを指定してください。');
  const conditions = ['none', 'raw', 'raw-and-understanding'];
  const ids = new Set();
  return cases.flatMap(c => {
    if (!c || typeof c.id !== 'string' || !/^[a-z0-9-]+$/.test(c.id) || ids.has(c.id) || Object.keys(c).sort().join() !== ['id', 'task', 'origin', 'request', 'raw', 'understanding', 'must', 'avoid'].sort().join() || !['task', 'origin', 'request'].every(key => typeof c[key] === 'string' && c[key].trim()) || !Array.isArray(c.raw) || !Array.isArray(c.understanding) || !['must', 'avoid'].every(key => Array.isArray(c[key]) && c[key].every(value => typeof value === 'string' && value.trim()))) throw new Error('評価例の形式が不正です。');
    ids.add(c.id);
    return conditions.map(condition => {
      const evidence = [
        ...(condition === 'none' ? [] : c.raw.map((value, i) => ({ evidenceId: `raw-${i}`, value }))),
        ...(condition !== 'raw-and-understanding' ? [] : c.understanding.map((value, i) => ({ evidenceId: `understanding-${i}`, value })))
      ];
      return { caseId: c.id, condition, availableAt, targetHead, request: c.request, evidence, rules };
    });
  });
}
export function fixedInput(run, trialId) {
  return JSON.stringify({ trialId, method: 'fixed', caseId: run.caseId, condition: run.condition,
    targetHead: run.targetHead, availableAt: run.availableAt, instructions: run.rules,
    request: run.request, evidence: run.evidence,
    output: { destination: 'final-output.json', format: { trialId, status: 'completed', answer: '利用者への回答全文（要約・報告ではない）', usedEvidenceIds: [], error: null } }
  }, null, 2) + '\n';
}
export function writeBundle(cases, output, options) {
  const runs = prepare(cases, options);
  mkdirSync(output); // A bundle is new or rejected, never partially overwritten.
  for (const [name, value] of Object.entries({ 'runs.json': runs, 'rubric.json': cases.map(({ id, must, avoid }) => ({ id, must, avoid })), 'snapshot.json': { ...options, cases, rules, casesHash: hash(JSON.stringify(cases)) } })) {
    writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  return runs;
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const [input, output, availableAt, ...extra] = process.argv.slice(2);
  if (!input || !output || !availableAt || extra.length) throw new Error('node evaluation/prepare.mjs <cases.json> <新規出力ディレクトリ> <利用可能時点ISO>');
  const targetHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const runs = writeBundle(JSON.parse(readFileSync(input, 'utf8')), output, { availableAt, targetHead });
  console.log(`${runs.length}条件のスナップショットを準備しました。モデル比較は未実施です。`);
}
