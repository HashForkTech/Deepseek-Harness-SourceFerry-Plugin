import { lstat, readFile, writeFile, readdir, mkdir, rename, rm, rmdir, chmod } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { run } from './process.mjs';
export const exists = async path => { try { await lstat(path); return true; } catch(e) { if(e.code === 'ENOENT') return false; throw e; } };
export async function safePath(home, path, { link = false } = {}) {
  const root = resolve(home), target = resolve(path), rel = relative(root,target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Uninstall target is outside the installation home.');
  for(let current = link ? dirname(target) : target; current !== root; current = dirname(current)) {
    if(await exists(current) && (await lstat(current)).isSymbolicLink()) throw new Error('Refusing to modify a symbolic-link path.');
  }
}
export async function readOptional(home,path) { await safePath(home,path); return await exists(path) ? await readFile(path,'utf8') : null; }
export async function emptyDirectory(home,path) {
  await safePath(home,path); if(await exists(path) && !(await readdir(path)).length) await rmdir(path);
}
// Plan all edits first. Recovery contains the CURRENT files, never an old install snapshot.
// Removed paths are moved, and only the individual files changed by this operation roll back.
export async function applyRemoval(home, base, edits, removals, privateFile, {dryRun=false}={}) {
  edits = edits.filter(e=>e.before !== e.after);
  for(const e of edits) { await safePath(home,e.path); if(await readOptional(home,e.path) !== e.before) throw new Error('Configuration changed during uninstall; no files were changed.'); }
  const paths=[];
  for(const path of [...new Set(removals)]) { await safePath(home,path,{link:true}); if(await exists(path)) paths.push(path); }
  const result={edited:edits.map(e=>e.path),removed:paths,retained:'Other plugins, shared runtimes, dependency stores and installation backups.'};
  if(dryRun || (!edits.length && !paths.length)) return result;
  const recovery=join(base,'uninstall-recovery',`${Date.now()}-${process.pid}`);
  await safePath(home,recovery); await mkdir(recovery,{recursive:true,mode:0o700});
  if(process.platform==='win32') {
    const {stdout}=await run('whoami.exe',['/user','/fo','csv','/nh'],{capture:true}); const sid=stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
    if(!sid) throw new Error('Cannot protect uninstall recovery.');
    await run('icacls.exe',[recovery,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F'],{capture:true});
  } else await chmod(recovery,0o700);
  for(const [i,e] of edits.entries()) if(e.before !== null) await privateFile(join(recovery,`file-${i}`),e.before);
  const changed=[],moved=[];
  const writeEdit=async(edit,value)=>edit.before===null ? privateFile(edit.path,value) : writeFile(edit.path,value);
  try {
    for(const e of edits) { if(await readOptional(home,e.path)!==e.before) throw new Error('Concurrent configuration edit.'); changed.push(e); await writeEdit(e,e.after); }
    for(const [i,path] of paths.entries()) { await safePath(home,path,{link:true}); const destination=join(recovery,`removed-${i}`); await rename(path,destination); moved.push({path,destination}); }
    await privateFile(join(recovery,'manifest.json'),JSON.stringify({edited:edits.map((e,i)=>({path:e.path,backup:`file-${i}`})),removed:moved},null,2));
  } catch(e) {
    for(const m of moved.reverse()) await rename(m.destination,m.path);
    for(const edit of changed.reverse()) if(edit.before===null) await rm(edit.path,{force:true}); else await writeEdit(edit,edit.before);
    throw new Error(`Selective uninstall failed; its changes were rolled back. Recovery: ${recovery}. ${e.message}`);
  }
  return {...result,recovery};
}
