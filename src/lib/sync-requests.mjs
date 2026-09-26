import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { atomicWrite } from './archive.mjs';
import { HttpError } from '../integrations/cosense/client.mjs';

export const systemClock = { now: () => Date.now(), monotonic: () => performance.now(), sleep: ms => setTimeout(ms) };
const backoffs = [5000, 10000, 20000];
const waitBudget = 60000;
const invalidRetryAfter = () => new Error('HTTP 429: Retry-After が不正なため停止しました。次回試行時刻は不明です。連続実行を避け、繰り返す場合はCosense側の応答を確認してください。');

function retryDelay(value, now) {
  if (value === null) return 0;
  if (typeof value !== 'string') throw invalidRetryAfter();
  const text = value.trim();
  let delay;
  if (/^\d+$/.test(text)) delay = Number(text) * 1000;
  else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) {
    const date = Date.parse(text);
    if (Number.isFinite(date) && new Date(date).toUTCString() === text) delay = Math.max(0, date - now);
  }
  if (!Number.isSafeInteger(delay) || delay < 0 || !Number.isFinite(new Date(now + delay).getTime())) {
    throw invalidRetryAfter();
  }
  return delay;
}

// The persisted cooldown is separate from disposable article progress, so a
// rebuild cannot bypass the server's requested wait.
export function controlledGet(root, projectUrl, get, { clock = systemClock, onProgress = console.error } = {}) {
  const path = join(root, '.local/sync-rate-limit.json');
  let state = { version: 1, projectUrl, notBefore: null };
  if (existsSync(path)) {
    try {
      state = JSON.parse(readFileSync(path, 'utf8'));
      if (!state || Object.keys(state).sort().join(',') !== 'notBefore,projectUrl,version' ||
          state.version !== 1 || state.projectUrl !== projectUrl ||
          !(state.notBefore === null || (typeof state.notBefore === 'string' &&
            Number.isFinite(Date.parse(state.notBefore)) && new Date(state.notBefore).toISOString() === state.notBefore))) throw new Error();
    } catch { throw new Error('送信待機状態を読み取れません。.local/sync-rate-limit.json の形式・対象プロジェクト・ファイル権限を確認してください。待機時刻を保持して修復する必要があり、--rebuild では復旧できません。'); }
  }
  let waited = 0;
  let lastStart = -Infinity;
  let queue = Promise.resolve();
  const stop = reason => new Error(`HTTP 429: ${reason}のため停止しました。次回試行の目安: ${state.notBefore}。この時刻以降に npm run sync で再開してください。制限解除を保証する時刻ではありません。`);
  async function cooldown() {
    while (state.notBefore !== null && Date.parse(state.notBefore) > clock.now()) {
      const delay = Date.parse(state.notBefore) - clock.now();
      if (waited + delay > waitBudget) throw stop('累計待機の上限60秒を超えます');
      onProgress(`HTTP 429: ${Math.ceil(delay / 1000)}秒待機します。次回試行の目安: ${state.notBefore}`);
      const start = clock.monotonic();
      await clock.sleep(delay);
      waited += Math.max(delay, clock.monotonic() - start);
    }
  }
  async function request(url) {
    for (let attempt = 0; ; attempt++) {
      await cooldown();
      while (clock.monotonic() - lastStart < 1000) await clock.sleep(1000 - (clock.monotonic() - lastStart));
      lastStart = clock.monotonic();
      try { return await get(url); }
      catch (error) {
        if (!(error instanceof HttpError) || error.status !== 429) throw error;
        const delay = Math.max(backoffs[Math.min(attempt, 2)], retryDelay(error.retryAfter, clock.now()));
        state.notBefore = new Date(clock.now() + delay).toISOString();
        try { atomicWrite(path, JSON.stringify(state)); }
        catch (cause) { throw new Error(`HTTP 429: 送信待機状態の保存に失敗しました。.local/ の書き込み権限と空き容量を確認し、${state.notBefore} 以降に npm run sync で再開してください。制限解除を保証する時刻ではありません。詳細: ${cause.message}`); }
        if (attempt === 3) throw stop('再試行上限3回に達しました');
        onProgress(`HTTP 429: 再試行 ${attempt + 1}/3`);
      }
    }
  }
  return url => {
    const result = queue.then(() => request(url));
    queue = result.catch(() => {});
    return result;
  };
}
