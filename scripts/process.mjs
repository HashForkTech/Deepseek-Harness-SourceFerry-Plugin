import { spawn } from 'node:child_process';

// PowerShell invokes .cmd/.ps1 shims on Windows without interpolating arguments into cmd.exe.
export function commandSpec(command, args, platform = process.platform) {
  if (platform !== 'win32' || !/\.(cmd|bat|ps1)$/i.test(command)) return { command, args };
  const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
  const script = `& ${quote(command)} ${args.map(quote).join(' ')}; exit $LASTEXITCODE`;
  return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
}

export async function run(command, args, { cwd, env = process.env, capture = false } = {}) {
  const spec = commandSpec(command, args);
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { cwd, env, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let stdout = '', stderr = '';
    if (capture) {
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
    }
    child.on('error', () => reject(new Error(`Cannot start ${command}. Check that it is installed and on PATH.`)));
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with status ${code}.`));
    });
  });
}

export async function findCommand(name) {
  const result = await run(process.platform === 'win32' ? 'where.exe' : 'which', [name], { capture: true });
  const candidates = result.stdout.trim().split(/\r?\n/);
  return candidates.find(path => process.platform !== 'win32' || /\.(exe|cmd|bat)$/i.test(path)) ?? candidates[0];
}
