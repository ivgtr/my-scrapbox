import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const settingsUrl = new URL('../node_modules/@helpfeel/cosense-cli/src/lib/settings.ts', import.meta.url).href;
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
  const launcher = join(root, 'scripts/cosense.mjs');
  const result = spawnSync(process.execPath, [launcher, 'login', '--help'], {
    cwd: tmpdir(), encoding: 'utf8', timeout: 15000,
    env: { ...process.env, COSENSE_SETTINGS_PATH: '/invalid/parent/settings.json' }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(join(root, '.local/cosense/settings.json')));
  assert.ok(!result.stdout.includes('/invalid/parent/settings.json'));
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
  const result = run(['scripts/cosense.mjs', 'whoami', 'https://scrapbox.io'], {
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
  const result = run(['scripts/patch-cosense.mjs']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(files.map(path => readFileSync(path, 'utf8')), before);
});
