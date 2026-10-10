import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {uninstall,planFor} from '../scripts/uninstall.mjs';
test('Installation backup is never restored over later profile plugins or user settings',async()=>{
 const home=await mkdtemp(join(tmpdir(),'sf-old-dsh-')),p=planFor(home),backup=join(p.base,'backups','web-100');
 try{await mkdir(backup,{recursive:true});await mkdir(p.profileDir,{recursive:true});await mkdir(p.settingsDir,{recursive:true});
 await writeFile(join(backup,'snapshot.json'),JSON.stringify({present:['package.json','cordis.patch.yml']}));
 await writeFile(join(backup,'package.json'),'{}');await writeFile(join(backup,'cordis.patch.yml'),'[]\n');
 await writeFile(join(p.profileDir,'package.json'),JSON.stringify({dependencies:{later:'2'},custom:'recent'}));await writeFile(join(p.profileDir,'cordis.patch.yml'),'- id: later\n  name: later\n');await writeFile(join(p.settingsDir,'config.json'),'{}');
 await uninstall(home);const current=JSON.parse(await readFile(join(p.profileDir,'package.json'),'utf8'));assert.equal(current.dependencies.later,'2');assert.equal(current.custom,'recent');assert.match(await readFile(join(p.profileDir,'cordis.patch.yml'),'utf8'),/later/);}
 finally{await rm(home,{recursive:true,force:true});}
});
