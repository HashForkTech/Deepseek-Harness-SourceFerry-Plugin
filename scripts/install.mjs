import { cp, mkdir, readFile, writeFile, chmod, access, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { createGateway, gatewaySettings } from '../shared/gateway.mjs';
import { findCommand, run } from './process.mjs';
import { recordOwned, sealCheckpoint } from './restore.mjs';

export const HARNESS_VERSION = '0.2.0-rc.2';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profileFiles = ['package.json', 'cordis.patch.yml', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
const exists = async path => { try { await access(path, constants.F_OK); return true; } catch { return false; } };
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

export function parseArgs(args) {
  const options = { profile: 'SourceFerry', keepNative: false, verify: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument === '--profile' || argument === '--gateway-url') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      options[argument === '--profile' ? 'profile' : 'gatewayUrl'] = value;
    } else if (argument === '--keep-native') options.keepNative = true;
    else if (argument === '--verify') options.verify = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(options.profile)) throw new Error('Profile must use letters, numbers, hyphens or underscores.');
  return options;
}

export async function privateFile(path, contents) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  if (process.platform === 'win32') {
    const { stdout } = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { capture: true });
    const sid = stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
    if (!sid) throw new Error('Cannot determine the Windows user SID for private configuration.');
    // Remove inherited ACLs, grant access only to the current user, SYSTEM and administrators.
    await run('icacls.exe', [temporary, '/inheritance:r', '/grant:r', `*${sid}:F`, '*S-1-5-18:F', '*S-1-5-32-544:F'], { capture: true });
  } else await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function prompt(label, { secret = false } = {}) {
  if (!process.stdin.isTTY) throw new Error(`Set ${secret ? 'LOCAL_WEB_API_TOKEN' : 'LOCAL_WEB_GATEWAY_URL'} in the environment for unattended installation.`);
  if (!secret) {
    const reader = createInterface({ input: process.stdin, output: process.stdout });
    try { return (await reader.question(label)).trim(); } finally { reader.close(); }
  }
  process.stdout.write(label);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  try {
    return await new Promise((resolve, reject) => {
      let value = '';
      const onData = data => {
        for (const char of data.toString('utf8')) {
          if (char === '\u0003') { cleanup(); reject(new Error('Installation cancelled.')); return; }
          if (char === '\r' || char === '\n') { cleanup(); resolve(value.trim()); return; }
          if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
          else if (char.charCodeAt(0) >= 32) value += char;
        }
      };
      const cleanup = () => { process.stdin.off('data', onData); process.stdout.write('\n'); };
      process.stdin.on('data', onData);
    });
  } finally { process.stdin.setRawMode(wasRaw); process.stdin.pause(); }
}

async function backupProfile(profileDir, backupDir) {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const present = [];
  for (const file of profileFiles) if (await exists(join(profileDir, file))) {
    await privateFile(join(backupDir, file), await readFile(join(profileDir, file)));
    present.push(file);
  }
  await privateFile(join(backupDir, 'snapshot.json'), JSON.stringify({ present }, null, 2));
}

async function restoreProfile(profileDir, backupDir) {
  const { present } = await readJson(join(backupDir, 'snapshot.json'));
  for (const file of profileFiles) {
    if (present.includes(file)) await cp(join(backupDir, file), join(profileDir, file));
    else await rm(join(profileDir, file), { force: true });
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('SourceFerry plugin installer\nUsage: node scripts/install.mjs [--profile SourceFerry] [--gateway-url URL] [--keep-native] [--verify]\nCredentials: LOCAL_WEB_GATEWAY_URL and LOCAL_WEB_API_TOKEN; otherwise prompted (token hidden).\nRequires Node.js 24+ and npm. Installs pinned Harness if dsh is absent; an existing different version is rejected.');
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24+ is required.');
  const configuredHome = process.env.DSH_HOME?.trim();
  const dshHome = configuredHome ? resolve(configuredHome === '~' ? homedir() : configuredHome.replace(/^~[\\/]/, `${homedir()}/`)) : join(homedir(), '.dsh');
  const base = join(dshHome, 'sourceferry');
  const profileDir = join(dshHome, 'profiles', options.profile);
  const configPath = join(base, 'profiles', options.profile, 'config.json');
  const previous = await exists(configPath) ? await readJson(configPath) : undefined;
  if (options.verify) {
    if (!previous) throw new Error('Install this profile before running --verify.');
    const { verifyGateway, verifyPlugins } = await import(pathToFileURL(join(previous.installDir, 'scripts/verify.mjs')));
    const env = { ...process.env, ...previous.env, DSH_HOME: dshHome };
    if (previous.toolingBin) env.PATH = `${previous.toolingBin}${delimiter}${env.PATH ?? ''}`;
    console.log('Verifying authenticated gateway and both registered plugin tools...');
    await verifyGateway(env);
    await verifyPlugins(env);
    const { checkEffectiveTools } = await import(pathToFileURL(join(previous.installDir, 'scripts/profile.mjs')));
    const dump = await run(previous.dsh, ['--profile', options.profile, '--dump-config'], { env, capture: true });
    checkEffectiveTools(dump.stdout, { keepNative: previous.keepNative });
    console.log('Gateway, plugin dispatch and effective profile verified.');
    return;
  }
  const env = { ...process.env,
    LOCAL_WEB_GATEWAY_URL: options.gatewayUrl ?? process.env.LOCAL_WEB_GATEWAY_URL ?? previous?.env.LOCAL_WEB_GATEWAY_URL ?? await prompt('SourceFerry gateway URL (for example http://192.168.1.20:8080): '),
    LOCAL_WEB_API_TOKEN: process.env.LOCAL_WEB_API_TOKEN ?? previous?.env.LOCAL_WEB_API_TOKEN ?? await prompt('Existing gateway API token (hidden): ', { secret: true }),
    DSH_WEB_FETCH_PROVIDER: 'local-crawl4ai-fetch', DSH_HOME: dshHome
  };
  delete env.DSH_WEB_SEARCH_PROVIDER;
  gatewaySettings(env);
  console.log('Checking gateway health and authenticated search/fetch...');
  const gateway = createGateway({ env });
  await gateway.health();
  const search = await gateway.search(['DeepSeek Harness official site'], 3);
  if (!search.sources.length) throw new Error('Gateway search returned no results; fix the gateway first.');
  await gateway.fetch('https://example.com/');
  const { planFor, prepareCheckpoint } = await import('./uninstall.mjs');
  const checkpoint = await prepareCheckpoint(planFor(dshHome, options.profile));
  const npm = await findCommand('npm');
  let dsh;
  try { dsh = await findCommand('dsh'); } catch {
    if (previous?.dsh && await exists(previous.dsh)) dsh = previous.dsh;
  }
  const installDir = join(base, 'installations', `1.0.0-${Date.now()}-${process.pid}`);
  await recordOwned(checkpoint, installDir, privateFile);
  await mkdir(installDir, { recursive: true });
  console.log('Installing plugin dependencies into a permanent directory...');
  for (const path of ['package.json', 'package-lock.json', 'plugins', 'shared', 'scripts']) {
    await cp(join(root, path), join(installDir, path), { recursive: true });
  }
  await run(npm, ['ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], { cwd: installDir });
  if (!dsh) {
    if (options.profile === 'desktop') throw new Error('Initialize Harness Desktop and install its matching dsh CLI before targeting desktop.');
    console.log(`Installing managed DeepSeek Harness ${HARNESS_VERSION}...`);
    const harnessDir = join(base, 'harness');
    await recordOwned(checkpoint, harnessDir, privateFile);
    await run(npm, ['install', '--prefix', harnessDir, `@deepseek-ai/dsh@${HARNESS_VERSION}`, '--no-audit', '--no-fund']);
    dsh = join(harnessDir, 'node_modules', '.bin', process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
  }
  const version = await run(dsh, ['--version'], { env, capture: true });
  if (!new RegExp(`(?:^|\\s)${HARNESS_VERSION.replaceAll('.', '\\.')}\\s*$`).test(version.stdout.trim())) {
    throw new Error(`This package requires dsh ${HARNESS_VERSION}. Select that CLI version before installing.`);
  }
  let toolingBin;
  try { await findCommand('pnpm'); } catch {
    console.log('Installing managed pnpm 11.0.0 for Harness plugin management...');
    const toolingDir = join(base, 'tooling');
    await recordOwned(checkpoint, toolingDir, privateFile);
    await run(npm, ['install', '--prefix', toolingDir, 'pnpm@11.0.0', '--ignore-scripts', '--no-audit', '--no-fund']);
    toolingBin = join(toolingDir, 'node_modules', '.bin');
    env.PATH = `${toolingBin}${delimiter}${process.env.PATH ?? ''}`;
  }
  if (options.profile === 'desktop' && !await exists(join(profileDir, 'package.json'))) throw new Error('Open Harness Desktop once, then fully quit it before installation.');
  const { verifyPlugins } = await import(pathToFileURL(join(installDir, 'scripts/verify.mjs')));
  console.log('Verifying real plugin schemas, registration and gateway calls...');
  await verifyPlugins(env);
  const { disableNativeTools, checkEffectiveTools } = await import(pathToFileURL(join(installDir, 'scripts/profile.mjs')));
  // Initialize a new named profile from the shipped web template, never from a user's web profile.
  if (!await exists(profileDir) && options.profile !== 'web' && options.profile !== 'desktop') {
    await run(dsh, ['--profile', options.profile, '--from-default-profile', 'web', '--dump-default-config'], { env, capture: true });
  }
  const backupDir = join(base, 'backups', `${options.profile}-${Date.now()}`);
  await backupProfile(profileDir, backupDir);
  console.log(`Profile backup: ${backupDir}`);
  const ownershipPath = join(base, 'profiles', options.profile, 'uninstall-ownership.json');
  const previousOwnership = await exists(ownershipPath) ? await readFile(ownershipPath, 'utf8') : null;
  try {
    for (const plugin of ['local-web-search', 'local-web-fetch']) {
      await run(dsh, ['plugin', '--profile', options.profile, 'add', '.'], { cwd: join(installDir, 'plugins', plugin), env });
    }
    const before = await run(dsh, ['--profile', options.profile, '--dump-config'], { env, capture: true });
    if (!options.keepNative) {
      const patchFile = join(profileDir, 'cordis.patch.yml');
      const current = await exists(patchFile) ? await readFile(patchFile, 'utf8') : '[]\n';
      const ownershipPath = join(base, 'profiles', options.profile, 'uninstall-ownership.json');
      const ownership = await exists(ownershipPath) ? await readJson(ownershipPath) : { beforePatch: current, beforeEffective: before.stdout };
      const update = disableNativeTools(current, before.stdout);
      await privateFile(ownershipPath, JSON.stringify({ ...ownership, afterPatch: update.text }, null, 2));
      await privateFile(patchFile, update.text);
      console.log(`Disabled ${update.count} native web plugin instances, preserving complete preset configurations.`);
    }
    const after = await run(dsh, ['--profile', options.profile, '--dump-config'], { env, capture: true });
    checkEffectiveTools(after.stdout, options);
    await privateFile(join(base, 'profiles', options.profile, 'effective-config.yml'), after.stdout);
    const config = { profile: options.profile, dshHome, dsh, installDir, toolingBin, keepNative: options.keepNative,
      env: { LOCAL_WEB_GATEWAY_URL: env.LOCAL_WEB_GATEWAY_URL, LOCAL_WEB_API_TOKEN: env.LOCAL_WEB_API_TOKEN,
        DSH_WEB_FETCH_PROVIDER: env.DSH_WEB_FETCH_PROVIDER,
        ...(env.LOCAL_WEB_TIMEOUT_MS ? { LOCAL_WEB_TIMEOUT_MS: env.LOCAL_WEB_TIMEOUT_MS } : {}) } };
    const bin = join(base, 'bin');
    await mkdir(bin, { recursive: true });
    const launcher = join(bin, options.profile === 'SourceFerry' ? 'dsh-SourceFerry' : `dsh-sourceferry-${options.profile}`);
    const launchScript = join(installDir, 'scripts', 'launch.mjs');
    if (process.platform === 'win32') {
      const content = `@echo off\r\n"${process.execPath}" "${launchScript}" "${configPath}" %*\r\nexit /b %errorlevel%\r\n`;
      await writeFile(`${launcher}.cmd`, content);
    } else {
      const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
      await writeFile(launcher, `#!/usr/bin/env bash\nexec ${quote(process.execPath)} ${quote(launchScript)} ${quote(configPath)} "$@"\n`, { mode: 0o755 });
    }
    await privateFile(join(base, 'profiles', options.profile, 'installation-report.json'), JSON.stringify({
      installedAt: new Date().toISOString(), harnessVersion: HARNESS_VERSION, profile: options.profile,
      gateway: { health: true, search: true, fetch: true }, plugins: { schemas: true, dispatch: true }, effectiveProfile: true,
      backupDir, launcher: process.platform === 'win32' ? `${launcher}.cmd` : launcher
    }, null, 2));
    await privateFile(configPath, JSON.stringify(config, null, 2) + '\n');
    await sealCheckpoint(checkpoint, privateFile);
    console.log(`Installation complete. Restart Harness using:\n${process.platform === 'win32' ? launcher + '.cmd' : launcher} --no-open\nOpen a new conversation after restarting. Gateway credentials are stored privately and never printed.`);
  } catch (error) {
    if (previousOwnership === null) await rm(ownershipPath, { force: true });
    else await privateFile(ownershipPath, previousOwnership);
    await restoreProfile(profileDir, backupDir);
    if (await exists(join(profileDir, 'package.json'))) {
      try { await run(dsh, ['plugin', '--profile', options.profile, 'install'], { env }); }
      catch { console.error('Profile files restored; rerun dsh plugin install to reconcile its dependencies.'); }
    }
    await sealCheckpoint(checkpoint, privateFile);
    throw new Error(`${error.message}\nProfile files restored from ${backupDir}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`SourceFerry installation failed: ${error.message}`); process.exitCode = 1; });
}
