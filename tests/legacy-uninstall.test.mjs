import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uninstall, planFor } from '../scripts/uninstall.mjs';
import { exists } from '../scripts/restore.mjs';
test('legacy DeepSeek install restores earliest recorded files without a gateway or credential prompt', async () => {
  const home=await mkdtemp(join(tmpdir(),'sourceferry-legacy-dsh-'));
  const plan=planFor(home), backup=join(plan.base,'backups','web-100');
  try {
    await mkdir(backup,{recursive:true});await mkdir(plan.profileDir,{recursive:true});await mkdir(plan.settingsDir,{recursive:true});await mkdir(join(plan.base,'bin'),{recursive:true});
    await writeFile(join(backup,'snapshot.json'),JSON.stringify({present:['cordis.patch.yml']}));
    await writeFile(join(backup,'cordis.patch.yml'),'# original\n[]\n');
    await writeFile(join(plan.profileDir,'package.json'),'installed package');await writeFile(join(plan.profileDir,'cordis.patch.yml'),'installed patch');
    await writeFile(join(plan.settingsDir,'config.json'),JSON.stringify({dsh:'unused'}));await writeFile(plan.launcher,'installed launcher');
    const before=await readdir(plan.base);
    await uninstall(home,{dryRun:true});assert.deepEqual(await readdir(plan.base),before);
    await uninstall(home);
    assert.equal(await readFile(join(plan.profileDir,'cordis.patch.yml'),'utf8'),'# original\n[]\n');
    assert.equal(await exists(join(plan.profileDir,'package.json')),false);assert.equal(await exists(plan.settingsDir),false);assert.equal(await exists(plan.launcher),false);
  } finally {await rm(home,{recursive:true,force:true});}
});
