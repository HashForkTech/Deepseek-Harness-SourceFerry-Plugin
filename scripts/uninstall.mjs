import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { privateFile } from './install.mjs';
import { run } from './process.mjs';
import { exists, ensureCheckpoint, loadCheckpoint, restoreCheckpoint } from './restore.mjs';
export function planFor(home, profile = 'web') {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(profile)) throw new Error('Invalid profile name.');
  home = resolve(home); const base = join(home, 'sourceferry');
  const profileDir = join(home, 'profiles', profile), settingsDir = join(base, 'profiles', profile);
  const launcher = join(base, 'bin', (profile === 'web' ? 'dsh-web' : `dsh-sourceferry-${profile}`) + (process.platform === 'win32' ? '.cmd' : ''));
  return { home, profile, base, profileDir, settingsDir, launcher, journalDir: join(base, 'uninstall', profile),
    targets: [profileDir, settingsDir, launcher],
    allowedTargets: [profileDir, settingsDir, launcher, ...['package.json','cordis.patch.yml','pnpm-lock.yaml','pnpm-workspace.yaml'].map(name => join(profileDir,name))],
    ownedRoots: [join(base,'installations')], ownedExact: [join(base,'harness'),join(base,'tooling')] };
}
export async function legacyBaseline(plan) {
  const backups = join(plan.base, 'backups');
  if (!await exists(backups)) return undefined;
  for (const name of (await readdir(backups)).sort()) {
    if (!name.startsWith(`${plan.profile}-`)) continue;
    const directory = join(backups,name), path = join(directory,'snapshot.json');
    if (!await exists(path)) continue;
    const snapshot = JSON.parse(await readFile(path,'utf8'));
    if (!Array.isArray(snapshot.present)) continue;
    const files = ['package.json','cordis.patch.yml','pnpm-lock.yaml','pnpm-workspace.yaml'];
    if (snapshot.present.some(file => !files.includes(file))) throw new Error('Legacy backup has unexpected filenames.');
    return [...files.map(file => ({ path: join(plan.profileDir,file), source: snapshot.present.includes(file) ? join(directory,file) : null })), { path: plan.settingsDir, source: null }, { path: plan.launcher, source: null }];
  }
}
export async function prepareCheckpoint(plan) {
  const current = await loadCheckpoint(plan);
  return current && !current.state.restoredAt ? current : ensureCheckpoint(plan, privateFile, current ? undefined : await legacyBaseline(plan));
}
export async function uninstall(home, { profile = 'web', dryRun = false, force = false } = {}) {
  const plan = planFor(home,profile);
  let checkpoint = await loadCheckpoint(plan);
  const configPath = join(plan.settingsDir,'config.json');
  const config = await exists(configPath) ? JSON.parse(await readFile(configPath,'utf8')) : undefined;
  if (!checkpoint) {
    const baseline = await legacyBaseline(plan);
    if (!baseline || !config) { console.log('No SourceFerry installation found for this profile.'); return; }
    if (dryRun) { console.log(JSON.stringify({ legacy: true, targets: baseline.map(t => ({ path: t.path, action: t.source === null ? 'remove' : 'restore' })), note: 'Unsnapshotted legacy dependency/runtime directories are retained.' },null,2)); return; }
    checkpoint = await ensureCheckpoint(plan,privateFile,baseline);
  }
  const references = [];
  const profiles = join(plan.base,'profiles');
  if (await exists(profiles)) for (const other of await readdir(profiles)) {
    if (other === profile) continue;
    const path = join(profiles,other,'config.json');
    if (await exists(path)) {
      const saved = JSON.parse(await readFile(path,'utf8'));
      references.push(saved.installDir, saved.dsh, saved.toolingBin);
    }
  }
  const result = await restoreCheckpoint(checkpoint, privateFile, { dryRun, force,
    keepOwned: async path => references.some(reference => reference && (resolve(reference) === resolve(path) || resolve(reference).startsWith(resolve(path) + '/'))) || references.some(reference => reference && resolve(reference).startsWith(resolve(path) + '\\')),
    reconcile: async () => {
      if (checkpoint.state.legacy && config?.dsh && await exists(join(plan.profileDir,'package.json'))) {
        const env = { ...process.env, DSH_HOME: plan.home };
        if (config.toolingBin) env.PATH = `${config.toolingBin}${process.platform === 'win32' ? ';' : ':'}${env.PATH}`;
        await run(config.dsh,['plugin','--profile',profile,'install'],{env,capture:true});
      }
    }
  });
  console.log(dryRun ? JSON.stringify(result,null,2) : result.alreadyRestored ? 'This installation is already uninstalled.' : `SourceFerry uninstalled; pre-installation profile restored. Restart Harness. Recovery: ${result.recovery}`);
  if (result.legacy) console.log('Legacy v1.0 backups restore recorded profile files; unsnapshotted dependency/runtime directories are retained.');
}
export async function main(args = process.argv.slice(2)) {
  let profile = 'web', dryRun = false, force = false;
  for (let i=0;i<args.length;i++) {
    if (args[i] === '--profile') { profile=args[++i]; if(!profile) throw new Error('Missing profile.'); }
    else if(args[i] === '--dry-run') dryRun=true;
    else if(args[i] === '--force') force=true;
    else if(['--help','-h'].includes(args[i])) { console.log('Uninstall SourceFerry and restore the original snapshot. Stop Harness first.\nUsage: node scripts/uninstall.mjs [--profile web] [--dry-run] [--force]\nDSH_HOME selects the installation home. --force replaces files edited after installation; a recovery copy is retained.'); return; }
    else throw new Error('Unknown uninstall option.');
  }
  const configured = process.env.DSH_HOME?.trim();
  const home = configured ? resolve(configured === '~' ? homedir() : configured.replace(/^~[\\/]/,`${homedir()}/`)) : join(homedir(),'.dsh');
  await uninstall(home,{profile,dryRun,force});
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode=1; });
