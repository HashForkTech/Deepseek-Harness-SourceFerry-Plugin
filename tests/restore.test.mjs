import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,chmod,stat,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {applyRemoval,exists} from '../scripts/selective.mjs';
import {privateFile} from '../scripts/install.mjs';
test('preview does not create recovery files and normal removal preserves unrelated files',async()=>{
 const home=await mkdtemp(join(tmpdir(),'sf-transaction-')),base=join(home,'sourceferry'),path=join(home,'config.txt'),ours=join(base,'ours.txt');
 try{await mkdir(base);await writeFile(path,'current settings plus SourceFerry');await writeFile(ours,'owned');await writeFile(join(base,'user.txt'),'keep');
 const edits=[{path,before:'current settings plus SourceFerry',after:'current settings'}];await applyRemoval(home,base,edits,[ours],privateFile,{dryRun:true});assert.equal(await exists(join(base,'uninstall-recovery')),false);assert.equal(await readFile(path,'utf8'),edits[0].before);
 await applyRemoval(home,base,edits,[ours],privateFile);assert.equal(await readFile(path,'utf8'),'current settings');assert.equal(await exists(ours),false);assert.equal(await readFile(join(base,'user.txt'),'utf8'),'keep');}
 finally{await rm(home,{recursive:true,force:true});}
});
test('a failed selective uninstall rolls back only its own edits to the CURRENT environment',async()=>{
 const home=await mkdtemp(join(tmpdir(),'sf-rollback-')),base=join(home,'sourceferry'),path=join(home,'config.txt'),ours=join(base,'ours.txt');
 try {await mkdir(base);await writeFile(path,'weeks of later changes');await writeFile(ours,'owned');
 const failManifest=async(p,data)=>{if(p.endsWith('manifest.json'))throw new Error('fixture write failure');await privateFile(p,data);};
 await assert.rejects(applyRemoval(home,base,[{path,before:'weeks of later changes',after:'selective edit'}],[ours],failManifest),/changes were rolled back/);
 assert.equal(await readFile(path,'utf8'),'weeks of later changes');assert.equal(await readFile(ours,'utf8'),'owned');}
 finally{await rm(home,{recursive:true,force:true});}
});
test('configuration edited during planning blocks removal before any changes',async()=>{
 const home=await mkdtemp(join(tmpdir(),'sf-race-')),path=join(home,'config.txt');try{await writeFile(path,'new user edit');await assert.rejects(applyRemoval(home,join(home,'sourceferry'),[{path,before:'old read',after:'remove ours'}],[],privateFile),/changed during uninstall/);assert.equal(await readFile(path,'utf8'),'new user edit');}finally{await rm(home,{recursive:true,force:true});}
});
test('refuses paths outside the installation home and symlinked parents',async()=>{
 const home=await mkdtemp(join(tmpdir(),'sf-path-')),outside=await mkdtemp(join(tmpdir(),'sf-outside-'));
 try{const file=join(outside,'keep.txt');await writeFile(file,'keep');await assert.rejects(applyRemoval(home,join(home,'sourceferry'),[],[file],privateFile),/outside/);await symlink(outside,join(home,'redirect'),process.platform==='win32'?'junction':'dir');await assert.rejects(applyRemoval(home,join(home,'sourceferry'),[],[join(home,'redirect','keep.txt')],privateFile),/symbolic-link/);assert.equal(await readFile(file,'utf8'),'keep');}finally{await rm(home,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
test('shared configuration file permissions survive selective editing',async()=>{
 if(process.platform==='win32')return;
 const home=await mkdtemp(join(tmpdir(),'sf-mode-')),path=join(home,'config.txt');try{await writeFile(path,'before');await chmod(path,0o640);await applyRemoval(home,join(home,'sourceferry'),[{path,before:'before',after:'after'}],[],privateFile);assert.equal((await stat(path)).mode&0o777,0o640);}finally{await rm(home,{recursive:true,force:true});}
});
