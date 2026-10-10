import { readdir, readFile, lstat, readlink } from 'node:fs/promises';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { privateFile } from './install.mjs';
import { readOptional, safePath, applyRemoval } from './selective.mjs';
import { exists, ensureCheckpoint, loadCheckpoint } from './restore.mjs';
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
export async function uninstall(home, {profile='web',dryRun=false, ...unsupported}={}) {
  if(Object.keys(unsupported).length) throw new Error('Only selective uninstall is supported; --force and full restore are not available.');
  const plan=planFor(home,profile), configPath=join(plan.settingsDir,'config.json');
  const configText=await readOptional(home,configPath);
  const checkpoint=await loadCheckpoint(plan);
  const config=configText===null ? {} : JSON.parse(configText);
  const metadataPath=join(plan.settingsDir,'uninstall-ownership.json');
  const metadataText=await readOptional(home,metadataPath), metadata=metadataText ? JSON.parse(metadataText) : {};
  const edits=[],removals=[],removedNames=[];
  const manifestPath=join(plan.profileDir,'package.json'), manifestText=await readOptional(home,manifestPath);
  if(manifestText!==null) {
    const manifest=JSON.parse(manifestText), original=JSON.stringify(manifest);
    for(const name of ['local-web-search','local-web-fetch']) {
      const spec=manifest.dependencies?.[name];
      const normalized=typeof spec==='string' ? spec.replace(/^(link:|file:)/,'').replaceAll('\\','/') : '';
      // Same-name packages redirected elsewhere are no longer ours.
      const candidate=resolve(plan.profileDir,normalized), rel=relative(join(plan.base,'installations'),candidate);
      if(spec===undefined || rel && !rel.startsWith('..')&&!isAbsolute(rel) && normalized.endsWith('/plugins/'+name)) {
        if(spec!==undefined) delete manifest.dependencies[name];
        if(Array.isArray(manifest.dsh?.profile?.bundles)) manifest.dsh.profile.bundles=manifest.dsh.profile.bundles.filter(value=>value!==name);
        removedNames.push(name);
      }
    }
    if(JSON.stringify(manifest)!==original) edits.push({path:manifestPath,before:manifestText,after:JSON.stringify(manifest,null,2)+'\n'});
  }
  const {removeSourceFerryPatch,removeLockReferences}=await import('./remove-profile.mjs');
  const patchPath=join(plan.profileDir,'cordis.patch.yml'), patchText=await readOptional(home,patchPath);
  if(patchText!==null) {
    let beforePatch=metadata.beforePatch;
    if(beforePatch===undefined && configText!==null) {
      const target=checkpoint?.state.targets.find(t=>resolve(t.path)===resolve(plan.profileDir));
      const baseline=target?.present ? join(plan.journalDir,target.slot,'cordis.patch.yml') : (await legacyBaseline(plan))?.find(t=>resolve(t.path)===resolve(patchPath))?.source;
      beforePatch=baseline ? await readOptional(home,baseline) : null;
    }
    const after=removeSourceFerryPatch(patchText,{beforePatch:beforePatch??'[]\n',afterPatch:metadata.afterPatch??null,beforeEffective:metadata.beforeEffective??null});
    edits.push({path:patchPath,before:patchText,after});
  }
  const lockPath=join(plan.profileDir,'pnpm-lock.yaml'), lockText=await readOptional(home,lockPath);
  if(lockText!==null) edits.push({path:lockPath,before:lockText,after:removeLockReferences(lockText,removedNames)});
  for(const name of removedNames) {
    const path=join(plan.profileDir,'node_modules',name); await safePath(home,path,{link:true});
    if(await exists(path) && (await lstat(path)).isSymbolicLink()) {
      const target=resolve(dirname(path),await readlink(path)), rel=relative(join(plan.base,'installations'),target);
      if(rel && !rel.startsWith('..')&&!isAbsolute(rel)) removals.push(path);
    }
  }
  for(const path of [configPath,metadataPath,join(plan.settingsDir,'installation-report.json'),join(plan.settingsDir,'effective-config.yml')]) if(await readOptional(home,path)!==null) removals.push(path);
  const launcher=await readOptional(home,plan.launcher);
  if(launcher!==null && launcher.includes('launch.mjs') && launcher.replaceAll('\\','/').includes(plan.base.replaceAll('\\','/')+'/installations/')) removals.push(plan.launcher);
  if(checkpoint&&!checkpoint.state.restoredAt) {
    const statePath=join(plan.journalDir,'state.json'), before=await readOptional(home,statePath);
    edits.push({path:statePath,before,after:JSON.stringify({...checkpoint.state,restoredAt:new Date().toISOString(),selectiveUninstall:true},null,2)});
  }
  const result=await applyRemoval(home,plan.base,edits,removals,privateFile,{dryRun});
  console.log(dryRun ? JSON.stringify(result,null,2) : !result.edited.length&&!result.removed.length ? 'SourceFerry is already uninstalled.' : 'SourceFerry selectively uninstalled; other plugins and settings preserved. Restart Harness.');
  return result;
}
export async function main(args=process.argv.slice(2)) {
  let profile='web',dryRun=false;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--profile') {profile=args[++i];if(!profile) throw new Error('Missing profile.');}
    else if(args[i]==='--dry-run') dryRun=true;
    else if(['--help','-h'].includes(args[i])) { console.log('Remove only SourceFerry. Stop Harness first.\nUsage: node scripts/uninstall.mjs [--profile web] [--dry-run]\nOther plugins and settings are preserved. No full restore or force option. DSH_HOME selects the installation home.');return;}
    else throw new Error('Unknown uninstall option. Only selective removal is supported.');
  }
  const configured=process.env.DSH_HOME?.trim();
  const home=configured ? resolve(configured==='~'?homedir():configured.replace(/^~[\\/]/,`${homedir()}/`)) : join(homedir(),'.dsh');
  await uninstall(home,{profile,dryRun});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
