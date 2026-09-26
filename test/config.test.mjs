import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { readConfig, resolveArgs } from '../scripts/config.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cosense-template-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, root: pathToFileURL(`${dir}/`),
    write: value => writeFileSync(join(dir, 'cosense.config.json'), JSON.stringify(value)) };
}

test('unset personal configuration permits help but blocks project shortcuts', t => {
  const f = fixture(t);
  assert.deepEqual(resolveArgs(['--help'], f.root), ['--help']);
  assert.throws(() => resolveArgs(['listPages', '@project'], f.root), /コピー/);
  assert.deepEqual(resolveArgs(['readPage', 'https://scrapbox.io/example/page'], f.root),
    ['readPage', 'https://scrapbox.io/example/page']);
});

test('personal project and memory titles resolve to canonical URLs', t => {
  const f = fixture(t);
  f.write({ projectUrl: 'https://scrapbox.io/example/', memoryTitle: '記憶 & Decisions' });
  const config = readConfig(f.root);
  assert.equal(config.projectUrl, 'https://scrapbox.io/example');
  assert.equal(config.memoryUrl, 'https://scrapbox.io/example/' + encodeURIComponent('記憶_&_Decisions'));
  assert.deepEqual(resolveArgs(['browsePage', '@memory'], f.root), ['browsePage', config.memoryUrl]);
});

test('invalid configuration fails before the CLI can contact an account', t => {
  const f = fixture(t);
  for (const projectUrl of ['https://scrapbox.io/YOUR_PROJECT', 'https://example.com/wiki',
    'https://scrapbox.io/a/page', 'https://scrapbox.io/a?token=example',
    'https://user:password@scrapbox.io/a', 'not-a-url']) {
    f.write({ projectUrl, memoryTitle: 'Agent Memory' });
    assert.throws(() => readConfig(f.root), /projectUrl/);
  }
  f.write({ projectUrl: 'https://scrapbox.io/example', memoryTitle: ' ' });
  assert.throws(() => readConfig(f.root), /memoryTitle/);
  writeFileSync(join(f.dir, 'cosense.config.json'), '{');
  assert.throws(() => readConfig(f.root), /JSON/);
});

test('a fork launcher uses its own configuration and credentials from any working directory', t => {
  const f = fixture(t);
  cpSync(new URL('../scripts', import.meta.url), join(f.dir, 'scripts'), { recursive: true });
  writeFileSync(join(f.dir, 'package.json'), '{"type":"module"}');
  f.write({ projectUrl: 'https://scrapbox.io/example', memoryTitle: 'Agent Memory' });
  const cli = join(f.dir, 'node_modules/@helpfeel/cosense-cli');
  mkdirSync(join(cli, 'src/lib'), { recursive: true });
  mkdirSync(join(cli, 'bin'), { recursive: true });
  writeFileSync(join(cli, 'src/lib/settings.ts'), 'process.env.COSENSE_SETTINGS_PATH ||');
  writeFileSync(join(cli, 'bin/cosense'), `
    console.log(JSON.stringify({ args: process.argv.slice(2),
      settings: process.env.COSENSE_SETTINGS_PATH, hasPat: 'COSENSE_PAT' in process.env }));
  `);
  for (const [args, expected] of [
    [['listPages', '@project', '--limit', '1'], ['listPages', 'https://scrapbox.io/example', '--limit', '1']],
    [['browsePage', '@memory'], ['browsePage', 'https://scrapbox.io/example/Agent_Memory']]
  ]) {
    const result = spawnSync(process.execPath, [join(f.dir, 'scripts/cosense.mjs'), ...args], {
      cwd: tmpdir(), encoding: 'utf8', timeout: 10000,
      env: { ...process.env, COSENSE_PAT: 'test-only-parent-token', COSENSE_SETTINGS_PATH: '/invalid' }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { args: expected,
      settings: join(f.dir, '.local/cosense/settings.json'), hasPat: false });
  }
});
