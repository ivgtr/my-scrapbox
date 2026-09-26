import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveArgs } from './config.mjs';

const root = new URL('../', import.meta.url);
let args;
try {
  args = resolveArgs(process.argv.slice(2), root);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const settingsModule = new URL('node_modules/@helpfeel/cosense-cli/src/lib/settings.ts', root);
try {
  if (!readFileSync(settingsModule, 'utf8').includes('process.env.COSENSE_SETTINGS_PATH ||')) {
    throw new Error('保存先パッチが未適用です。npm rebuild を実行してください。');
  }
} catch (error) {
  console.error(error.code === 'ENOENT' ? 'npm ci を実行してください。' : error.message);
  process.exit(1);
}

const env = {
  ...process.env,
  COSENSE_SETTINGS_PATH: fileURLToPath(new URL('.local/cosense/settings.json', root))
};
// Always use this repository's credentials, even when the parent shell has a PAT.
delete env.COSENSE_PAT;
const child = spawn(process.execPath, [
  fileURLToPath(new URL('node_modules/@helpfeel/cosense-cli/bin/cosense', root)),
  ...args
], { cwd: fileURLToPath(root), env, stdio: 'inherit' });
child.on('error', error => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
