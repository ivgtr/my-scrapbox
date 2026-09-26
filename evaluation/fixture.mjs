import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { hash } from '../src/lib/archive.mjs';
export const stages = ['form', 'reuse', 'correct', 'reuse-corrected'];
const requests = [
  '通知試行の記事から、処理の成功と仕事の成果の関係を考えたい。再利用できる理解があれば、根拠付きの仮説として記憶に保存して。',
  '在庫確認の漏れを減らしたい。今は時間をかけず小さく試したい。過去の学びが使えるなら、今回への適用条件を確かめて第一候補まで示して。',
  '通知の試行について訂正します。必要な人は通知を読めていました。漏れの原因は、読んだ後に誰が対応するか決まっていなかったことです。前の理解と関連記憶を確認し、訂正して保存してください。',
  '引継ぎの対応漏れを減らしたい。通知は全員読めていますが、対応担当は決まっていません。過去の理解を参照し、小さく試せる第一候補を示して。'
];
export function createFixture(source, destination, { targetHead, stage, previousTrial = null }) {
  if (!/^[a-f0-9]{40}$/.test(targetHead ?? '') || !stages.includes(stage)) throw new Error('HEAD・段階が不正です。');
  let memory = { 'index.md': '# Agent記憶\n' };
  if (stage === 'form') {
    if (previousTrial !== null) throw new Error('初期fixtureから開始してください。');
  } else {
    if (!previousTrial) throw new Error('前段階の実行証拠が必要です。途中再開はできません。');
    const previous = JSON.parse(readFileSync(join(previousTrial, 'input.txt'), 'utf8'));
    const result = JSON.parse(readFileSync(join(previousTrial, 'result.json'), 'utf8'));
    const judgment = JSON.parse(readFileSync(join(previousTrial, 'judgment.json'), 'utf8'));
    if (previous.stage !== stages[stages.indexOf(stage) - 1] || previous.targetHead !== targetHead || result.status !== 'completed' || !judgment.eventVerification.length || judgment.eventVerification.some(e => e.status !== 'verified')) throw new Error('前段階の完了・イベント照合を確認できません。');
    const snapshot = JSON.parse(readFileSync(join(previousTrial, 'memory-after.json'), 'utf8'));
    if (snapshot.sha256 !== hash(JSON.stringify(snapshot.files))) throw new Error('記憶snapshotが不正です。');
    memory = snapshot.files;
  }
  mkdirSync(destination);
  const tar = execFileSync('git', ['archive', targetHead, 'src', 'package.json', 'package-lock.json', 'README.md', 'AGENTS.md', 'CLAUDE.md', '.agents', '.gitignore'], { cwd: source });
  execFileSync('tar', ['-x', '-C', destination], { input: tar });
  execFileSync('git', ['init', '-b', 'workspace'], { cwd: destination, stdio: 'pipe' });
  // No credentials, user identity settings, commits or network.
  writeFileSync(join(destination, 'cosense.config.json'), JSON.stringify({ projectUrl: 'https://scrapbox.io/evaluation-synthetic', syncMode: 'none' }) + '\n', { flag: 'wx' });
  mkdirSync(join(destination, 'memory'));
  for (const [name, body] of Object.entries(memory)) {
    if (!/^(index\.md|records\/[a-f0-9-]+\.md)$/.test(name)) throw new Error('fixture記憶のファイル名が不正です。');
    if (name.startsWith('records/')) mkdirSync(join(destination, 'memory/records'), { recursive: true });
    writeFileSync(join(destination, 'memory', name), body, { flag: 'wx' });
  }
  const articles = [{ id: 'synthetic-notification', title: '通知試行', updated: 1, commitId: 'synthetic-v1', fetchedAt: '2026-09-26T12:00:00.000Z',
    lines: [{ id: 'title', text: '通知試行' }, { id: 'observation', text: '合成利用者の記録：通知処理は動いたが、確認漏れは減らなかった。当時は必要な人が通知を読めていないと考えた。原因は未確認。' }], links: [], projectLinks: [], icons: [] }];
  mkdirSync(join(destination, 'archive'));
  writeFileSync(join(destination, 'archive/articles.json'), JSON.stringify({ version: 1, projectUrl: 'https://scrapbox.io/evaluation-synthetic', syncedAt: '2026-09-26T12:00:00.000Z', articles, contentHash: hash(JSON.stringify(articles)) }), { flag: 'wx' });
  mkdirSync(join(destination, 'artifacts'));
  return { fixture: resolve(destination), targetHead, stage, request: requests[stages.indexOf(stage)], sourceHash: hash(tar) };
}
export function cycleInput(fixture, trialId) {
  return JSON.stringify({ trialId, method: 'cycle', ...fixture,
    instructions: '通常のAGENTS.md・READMEと必要なSkillから始め、npm run session:startを実行してください。記事・記憶のローカル参照と索引生成、指定成果物への保存を許可します。form/correctのみ通常CLIによる記憶作成・更新を許可します。ネットワーク、同期、記事編集、認証、依存導入、git設定変更、子Agent、他のディレクトリの参照は禁止です。親や過去段階の会話は参照しません。回答原本をanswer.txtへ保存し、execution.jsonはtrialId, stage, status(completed/failed), usedRecords([{id,revision}]), operations([{command,eventRef}]), error(nullまたは失敗理由)を記載してください。取得できないイベント参照はnullとし創作しません。最終返却は試行ID・段階・状態・成果物参照・失敗理由だけです。',
    output: { answer: 'artifacts/answer.txt', execution: 'artifacts/execution.json' }
  }, null, 2) + '\n';
}
