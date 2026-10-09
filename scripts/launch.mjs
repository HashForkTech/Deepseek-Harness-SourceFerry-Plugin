import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { commandSpec } from './process.mjs';
import { delimiter } from 'node:path';

const [configFile, ...args] = process.argv.slice(2);
try {
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  const env = { ...process.env, ...config.env, DSH_HOME: config.dshHome };
  if (config.toolingBin) env.PATH = `${config.toolingBin}${delimiter}${env.PATH ?? ''}`;
  delete env.DSH_WEB_SEARCH_PROVIDER;
  const spec = commandSpec(config.dsh, ['--profile', config.profile, ...args]);
  const child = spawn(spec.command, spec.args, { env, stdio: 'inherit', windowsHide: true });
  child.on('error', () => { console.error('Cannot start Harness. Rerun the SourceFerry installer to repair the launcher.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  // The child shares the foreground console and receives Ctrl+C itself.
  process.on('SIGINT', () => {});
} catch {
  console.error('Cannot read SourceFerry configuration. Rerun the installer.');
  process.exitCode = 1;
}
