import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const settingsUrl = new URL('../../node_modules/@helpfeel/cosense-cli/src/lib/settings.ts', import.meta.url).href;
const run = (args, env = {}) => spawnSync(process.execPath, args, {
  cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 15000
});

test('official settings code stores and resolves repository-compatible credentials with private permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-scrapbox-auth-test-'));
  const path = join(dir, 'cosense', 'settings.json');
  try {
    const result = run(['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { tsImport } from 'tsx/esm/api';
      const settings = await tsImport(${JSON.stringify(settingsUrl)}, import.meta.url);
      assert.equal(settings.settingsPath, process.env.COSENSE_SETTINGS_PATH);
      settings.writeUserToken('https://scrapbox.io', 'test-only-pat');
      settings.writeProjectServiceAccount('https://scrapbox.io', 'example', 'cs_test-only');
      assert.deepEqual(settings.resolveUserCredential('https://scrapbox.io'),
        { type: 'personalAccessToken', value: 'test-only-pat' });
      assert.deepEqual(settings.resolveCredential('https://scrapbox.io', 'EXAMPLE'),
        { type: 'serviceAccount', value: 'cs_test-only' });
      settings.writeUserToken('https://scrapbox.io', 'test-only-replacement');
      assert.equal(settings.resolveUserCredential('https://scrapbox.io').value, 'test-only-replacement');
    `], { COSENSE_SETTINGS_PATH: path, COSENSE_PAT: '' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).users.length, 1);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'cosense')).mode & 0o777, 0o700);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher forces the local settings path and forwards arguments from another directory', () => {
  const launcher = join(root, 'src/cli/cosense.mjs');
  const result = spawnSync(process.execPath, [launcher, 'login', '--help'], {
    cwd: tmpdir(), encoding: 'utf8', timeout: 15000,
    env: { ...process.env, COSENSE_SETTINGS_PATH: '/invalid/parent/settings.json' }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(join(root, '.local/cosense/settings.json')));
  assert.ok(!result.stdout.includes('/invalid/parent/settings.json'));
});

test('official settings refuse an unset path instead of reading home credentials', () => {
  const result = run(['--input-type=module', '--eval', `
    import { tsImport } from 'tsx/esm/api';
    await tsImport(${JSON.stringify(settingsUrl)}, import.meta.url);
  `], { COSENSE_SETTINGS_PATH: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /COSENSE_SETTINGS_PATH is required/);
});

test('launcher isolates inherited PAT and does not authenticate without local credentials', t => {
  // This test is for initial setup only; skip once the user has logged in.
  try {
    statSync(join(root, '.local/cosense/settings.json'));
    t.skip('Local credentials exist; isolation is also covered by the fork fixture.');
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const result = run(['src/cli/cosense.mjs', 'whoami', 'https://scrapbox.io'], {
    COSENSE_PAT: 'test-only-parent-token',
    COSENSE_SETTINGS_PATH: '/invalid/parent/settings.json'
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /No Personal Access Token found/);
  assert.ok(!result.stderr.includes('test-only-parent-token'));
});

test('install patch is idempotent', () => {
  const files = ['lib/settings.ts', 'commands/login.ts'].map(
    path => join(root, 'node_modules/@helpfeel/cosense-cli/src', path)
  );
  const before = files.map(path => readFileSync(path, 'utf8'));
  const result = run(['src/integrations/cosense/patch.mjs']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(files.map(path => readFileSync(path, 'utf8')), before);
});

test('compatibility patch validates all files before writing and refuses other versions', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cosense-patch-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = join(dir, 'node_modules/@helpfeel/cosense-cli');
  cpSync(new URL('../', import.meta.url), join(dir, 'src'), { recursive: true });
  mkdirSync(join(cli, 'src/lib'), { recursive: true });
  mkdirSync(join(cli, 'src/commands'), { recursive: true });
  writeFileSync(join(cli, 'package.json'), JSON.stringify({ version: '1.15.0' }));
  const settings = join(cli, 'src/lib/settings.ts');
  const original = "const SETTINGS_PATH = join(homedir(), '.cosense', 'settings.json');";
  writeFileSync(settings, original);
  writeFileSync(join(cli, 'src/commands/login.ts'), 'unexpected upstream source');
  const invoke = () => spawnSync(process.execPath, [join(dir, 'src/integrations/cosense/patch.mjs')], { encoding: 'utf8' });
  let result = invoke();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /login.ts changed/);
  assert.equal(readFileSync(settings, 'utf8'), original);
  writeFileSync(join(cli, 'package.json'), JSON.stringify({ version: '9.0.0' }));
  result = invoke();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /version changed/);
  assert.equal(readFileSync(settings, 'utf8'), original);
});
