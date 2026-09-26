import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveArgs } from '../lib/config.mjs';
import { rootUrl, root } from '../paths.mjs';
import { assertPatchedCli, cliEnvironment } from '../integrations/cosense/settings.mjs';

let args;
let env;
try {
  args = resolveArgs(process.argv.slice(2), rootUrl);
  assertPatchedCli(root);
  env = cliEnvironment(root);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const child = spawn(process.execPath, [
  fileURLToPath(new URL('node_modules/@helpfeel/cosense-cli/bin/cosense', rootUrl)),
  ...args
], { cwd: root, env, stdio: 'inherit' });
child.on('error', error => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
