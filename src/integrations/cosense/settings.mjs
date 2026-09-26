import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const cliVersion = '1.15.0';
export const settingsDeclaration = "const SETTINGS_PATH = process.env.COSENSE_SETTINGS_PATH;\nif (!SETTINGS_PATH) throw new Error('COSENSE_SETTINGS_PATH is required; use npm run cosense -- ...');";
export const settingsPath = root => join(root, '.local/cosense/settings.json');

export function cliEnvironment(root, inherited = process.env) {
  const env = { ...inherited, COSENSE_SETTINGS_PATH: settingsPath(root) };
  delete env.COSENSE_PAT;
  return env;
}

export function assertPatchedCli(root) {
  try {
    const cliRoot = join(root, 'node_modules/@helpfeel/cosense-cli');
    if (JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8')).version !== cliVersion) {
      throw new Error('Cosense CLIのバージョンが変更されています。\n利用者向けの次の操作: 保存先パッチの互換性を確認してください。');
    }
    if (!readFileSync(join(cliRoot, 'src/lib/settings.ts'), 'utf8').includes(settingsDeclaration)) {
      throw new Error('現行の保存先パッチが未適用です。\n利用者向けの次の操作: npm ci を実行してください。');
    }
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Cosense CLIまたは保存先パッチが見つかりません。\n利用者向けの次の操作: npm ci を実行してください。');
    throw error;
  }
}

// Adapter for the pinned official CLI settings schema. Do not use environment
// credentials or silently fall back when local settings are malformed.
export function credentialHeaders(root, projectUrl) {
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath(root), 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error();
    for (const [key, valueKey] of [['projects', 'serviceAccount'], ['users', 'token']]) {
      const entries = settings[key] === undefined ? [] : settings[key];
      if (!Array.isArray(entries)) throw new Error();
      for (const entry of entries) {
        if (!entry || typeof entry.url !== 'string' || typeof entry[valueKey] !== 'string' || !entry[valueKey].trim()) throw new Error();
        const url = new URL(entry.url);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
        if (key === 'projects' && !url.pathname.split('/').filter(Boolean)[0]) throw new Error();
      }
    }
  } catch {
    throw new Error('認証設定を読み取れません。\n利用者向けの次の操作: 本人が別ターミナルで npm run auth:login を実行し、設定を確認してください。');
  }
  const configured = new URL(projectUrl);
  const projectName = configured.pathname.split('/').filter(Boolean)[0].toLowerCase();
  const project = (settings.projects ?? []).find(entry => {
    const url = new URL(entry.url);
    return url.origin === configured.origin && url.pathname.split('/').filter(Boolean)[0].toLowerCase() === projectName;
  });
  if (project) return { 'x-service-account-access-key': project.serviceAccount };
  const user = (settings.users ?? []).find(entry => new URL(entry.url).origin === configured.origin);
  if (user) return { 'x-personal-access-token': user.token };
  throw new Error('未認証です。\n利用者向けの次の操作: 本人が別ターミナルで npm run auth:login を実行してください。');
}
