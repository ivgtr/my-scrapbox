import { readFileSync, writeFileSync } from 'node:fs';

// Upstream 1.15.0 has no settings-path option. Keep the patch narrow and fail
// explicitly when an upgrade changes the implementation.
const file = new URL('../node_modules/@helpfeel/cosense-cli/src/lib/settings.ts', import.meta.url);
const original = "const SETTINGS_PATH = join(homedir(), '.cosense', 'settings.json');";
const replacement = "const SETTINGS_PATH = process.env.COSENSE_SETTINGS_PATH || join(homedir(), '.cosense', 'settings.json');";
const source = readFileSync(file, 'utf8');
if (!source.includes(replacement)) {
  if (source.split(original).length !== 2) {
    throw new Error('Cosense settings implementation changed; review the local path patch.');
  }
  writeFileSync(file, source.replace(original, replacement));
}

const loginFile = new URL('../node_modules/@helpfeel/cosense-cli/src/commands/login.ts', import.meta.url);
const loginSource = readFileSync(loginFile, 'utf8');
const oldHelp = '~/.cosense/settings.json（dir 0700, file 0600）';
const newHelp = '${settingsPath}（dir 0700, file 0600）';
if (!loginSource.includes(newHelp)) {
  if (loginSource.split(oldHelp).length !== 2) {
    throw new Error('Cosense login help changed; review the local path patch.');
  }
  writeFileSync(loginFile, loginSource.replace(oldHelp, newHelp));
}
