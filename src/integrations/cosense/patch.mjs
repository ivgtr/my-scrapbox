import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../../paths.mjs';
import { cliVersion, settingsDeclaration } from './settings.mjs';

// The pinned CLI has no configurable settings path. Keep this compatibility
// change separate from application behavior and reject unexpected upstream code.
const cliRoot = join(root, 'node_modules/@helpfeel/cosense-cli');
if (JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8')).version !== cliVersion) {
  throw new Error('Cosense CLI version changed; review the local settings patch.');
}
const patches = [
  { path: 'src/lib/settings.ts',
    before: "const SETTINGS_PATH = join(homedir(), '.cosense', 'settings.json');",
    after: settingsDeclaration },
  { path: 'src/commands/login.ts',
    before: '~/.cosense/settings.json（dir 0700, file 0600）',
    after: '${settingsPath}（dir 0700, file 0600）' }
];
// Validate every target before modifying any file.
const changes = patches.map(({ path, before, after }) => {
  const file = join(cliRoot, path);
  const source = readFileSync(file, 'utf8');
  if (source.includes(after)) return null;
  if (source.split(before).length !== 2) throw new Error(`Cosense ${path} changed; review the local settings patch.`);
  return { file, source: source.replace(before, after) };
});
for (const change of changes) if (change) writeFileSync(change.file, change.source);
