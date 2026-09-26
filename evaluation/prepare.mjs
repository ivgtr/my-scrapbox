// Prepare offline evaluation inputs; this does not call a model or score usefulness.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function prepare(cases, { availableAt }) {
  if (!Array.isArray(cases) || !cases.length || typeof availableAt !== 'string' || !Number.isFinite(Date.parse(availableAt))) throw new Error('評価例と利用可能時点を指定してください。');
  const conditions = ['none', 'raw', 'raw-and-understanding'];
  return cases.flatMap(c => {
    if (!c.id || !c.request || !Array.isArray(c.raw) || !Array.isArray(c.understanding) || !Array.isArray(c.must) || !Array.isArray(c.avoid)) throw new Error('評価例の形式が不正です。');
    return conditions.map(condition => ({
      caseId: c.id, task: c.task, origin: c.origin, condition, availableAt, externalResearch: 'disabled',
      prompt: `現在の依頼に日本語で答えてください。根拠・推測・現在の意向を区別し、必要な不足を示しながら判断できる部分は進めてください。外部調査は使いません。利用可能時点: ${availableAt}\n依頼: ${c.request}\n利用できる原文検索結果: ${JSON.stringify(condition === 'none' ? [] : c.raw)}\n利用できる理解: ${JSON.stringify(condition === 'raw-and-understanding' ? c.understanding : [])}`,
      response: null, model: null, modelSettings: null, retrieval: 'unrated', interpretation: 'unrated', usefulness: 'user-unrated', outcome: 'not-observed'
    }));
  });
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const [input, output, availableAt, ...extra] = process.argv.slice(2);
  if (!input || !output || !availableAt || extra.length) throw new Error('node evaluation/prepare.mjs <cases.json> <出力ディレクトリ> <利用可能時点ISO>');
  const cases = JSON.parse(readFileSync(input, 'utf8'));
  const runs = prepare(cases, { availableAt });
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'runs.json'), JSON.stringify(runs, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(output, 'rubric.json'), JSON.stringify(cases.map(({ id, must, avoid }) => ({ id, must, avoid })), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`${runs.length}条件の入力を準備しました。モデル比較・有用性評価は未実施です。`);
}
