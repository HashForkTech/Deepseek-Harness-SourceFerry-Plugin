import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateFile } from '../scripts/install.mjs';
import { ensureCheckpoint, recordOwned, sealCheckpoint, restoreCheckpoint, loadCheckpoint, exists } from '../scripts/restore.mjs';
async function fixture() {
  const home = await mkdtemp(join(tmpdir(),'sourceferry-restore-'));
  const plan = { home, journalDir: join(home,'sourceferry/uninstall/test'), targets: [join(home,'config'),join(home,'profile'),join(home,'launcher')], allowedTargets: [join(home,'config'),join(home,'profile'),join(home,'launcher')], ownedRoots: [join(home,'sourceferry/installations')], ownedExact: [] };
  await writeFile(plan.targets[0],'original config'); await mkdir(plan.targets[1]); await writeFile(join(plan.targets[1],'existing'),'original dependency');
  const checkpoint = await ensureCheckpoint(plan,privateFile);
  await writeFile(plan.targets[0],'installed config'); await writeFile(join(plan.targets[1],'existing'),'installed dependency'); await writeFile(join(plan.targets[1],'new'),'plugin link'); await writeFile(plan.targets[2],'launcher',{mode:0o755});
  const runtime = join(plan.ownedRoots[0],'1.1.0-100-200'); await recordOwned(checkpoint,runtime,privateFile); await mkdir(runtime,{recursive:true}); await writeFile(join(runtime,'server'),'runtime');
  await sealCheckpoint(checkpoint,privateFile);
  return {home,plan,checkpoint,runtime};
}
test('dry-run is read-only; uninstall restores original files, dependency tree and absent paths', async () => {
  const f = await fixture();
  try {
    const before = await readFile(join(f.plan.journalDir,'state.json'),'utf8');
    const preview = await restoreCheckpoint(f.checkpoint,privateFile,{dryRun:true});
    assert.equal(preview.targets.length,3); assert.equal(await readFile(f.plan.targets[0],'utf8'),'installed config');
    assert.equal(await readFile(join(f.plan.journalDir,'state.json'),'utf8'),before);
    const result = await restoreCheckpoint(f.checkpoint,privateFile);
    assert.equal(await readFile(f.plan.targets[0],'utf8'),'original config');
    assert.equal(await readFile(join(f.plan.targets[1],'existing'),'utf8'),'original dependency');
    assert.deepEqual(await readdir(f.plan.targets[1]),['existing']);
    assert.equal(await exists(f.plan.targets[2]),false); assert.equal(await exists(f.runtime),false);
    assert.equal(await readFile(join(result.recovery,'runtime-0/server'),'utf8'),'runtime');
    assert.equal((await restoreCheckpoint(await loadCheckpoint(f.plan),privateFile)).alreadyRestored,true);
  } finally {await rm(f.home,{recursive:true,force:true});}
});
test('later edits stop uninstall; force keeps a recovery copy of those edits', async () => {
  const f = await fixture();
  try {
    await writeFile(f.plan.targets[0],'later user edit');
    await assert.rejects(restoreCheckpoint(f.checkpoint,privateFile),/Files changed after installation/);
    assert.equal(await readFile(f.plan.targets[0],'utf8'),'later user edit'); assert.equal(await exists(f.runtime),true);
    const result = await restoreCheckpoint(f.checkpoint,privateFile,{force:true});
    assert.equal(await readFile(join(result.recovery,'target-0'),'utf8'),'later user edit');
    assert.equal(await readFile(f.plan.targets[0],'utf8'),'original config');
  } finally {await rm(f.home,{recursive:true,force:true});}
});
test('reinstall preserves first snapshot and uninstall failure restores the active installation', async () => {
  const f = await fixture();
  try {
    const again = await ensureCheckpoint(f.plan,privateFile);
    assert.equal(await readFile(join(f.plan.journalDir,'target-0'),'utf8'),'original config');
    assert.equal(again.state.ownedDirs.length,1);
    await assert.rejects(restoreCheckpoint(again,privateFile,{reconcile:async()=>{throw new Error('fixture failure');}}),/active installation was restored/);
    assert.equal(await readFile(f.plan.targets[0],'utf8'),'installed config'); assert.equal(await exists(f.runtime),true);
    await restoreCheckpoint(await loadCheckpoint(f.plan),privateFile);
    await writeFile(f.plan.targets[0],'new baseline');
    const fresh = await ensureCheckpoint(f.plan,privateFile);
    assert.equal(await readFile(join(fresh.plan.journalDir,'target-0'),'utf8'),'new baseline');
  } finally {await rm(f.home,{recursive:true,force:true});}
});
test('damaged backups and unexpected target/runtime paths fail before mutation', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.plan.journalDir,'target-0'),'damaged');
    await assert.rejects(restoreCheckpoint(f.checkpoint,privateFile),/missing or damaged/);
    assert.equal(await readFile(f.plan.targets[0],'utf8'),'installed config');
    f.checkpoint.state.ownedDirs=[f.plan.ownedRoots[0]];
    await assert.rejects(restoreCheckpoint(f.checkpoint,privateFile),/unexpected runtime/);
    f.checkpoint.state.ownedDirs=[]; f.checkpoint.state.targets[0].path=join(tmpdir(),'outside');
    await assert.rejects(restoreCheckpoint(f.checkpoint,privateFile),/unexpected restore target/);
  } finally {await rm(f.home,{recursive:true,force:true});}
});
test('shared runtimes stay in place and restored executable files keep their Unix mode', async () => {
  const f = await fixture();
  try {
    const result=await restoreCheckpoint(f.checkpoint,privateFile,{keepOwned:async()=>true});
    assert.deepEqual(result.retained,[f.runtime]); assert.equal(await exists(f.runtime),true);
    await writeFile(f.plan.targets[2],'existing launcher',{mode:0o755});
    const fresh=await ensureCheckpoint(f.plan,privateFile); await writeFile(f.plan.targets[2],'changed'); await sealCheckpoint(fresh,privateFile);
    await restoreCheckpoint(fresh,privateFile);
    assert.equal(await readFile(f.plan.targets[2],'utf8'),'existing launcher');
    if(process.platform!=='win32')assert.equal((await stat(f.plan.targets[2])).mode&0o777,0o755);
  }finally{await rm(f.home,{recursive:true,force:true});}
});
