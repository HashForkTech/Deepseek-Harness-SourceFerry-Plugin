import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {uninstall,main,planFor} from '../scripts/uninstall.mjs';
import {exists} from '../scripts/selective.mjs';
import {removeSourceFerryPatch} from '../scripts/remove-profile.mjs';
import {disableNativeTools} from '../scripts/profile.mjs';
import {parse} from 'yaml';
test('later plugins, profile settings, lockfile and node_modules survive selective uninstall without a snapshot',async()=>{
 const home=await mkdtemp(join(tmpdir(),'sf-selective-dsh-')),p=planFor(home);
 try {
  await mkdir(p.profileDir,{recursive:true});await mkdir(p.settingsDir,{recursive:true});await mkdir(join(p.base,'bin'),{recursive:true});
  const runtime=join(p.base,'installations','legacy');await mkdir(runtime,{recursive:true});await writeFile(join(runtime,'shared.txt'),'reused');
  await writeFile(join(p.settingsDir,'config.json'),JSON.stringify({installDir:runtime,keepNative:false}));
  await writeFile(join(p.settingsDir,'my-notes.txt'),'keep me');
  await writeFile(p.launcher,`node "${runtime}/scripts/launch.mjs"`);
  await writeFile(join(p.profileDir,'package.json'),JSON.stringify({dependencies:{'local-web-search':`link:${runtime}/plugins/local-web-search`,'local-web-fetch':`${runtime}/plugins/local-web-fetch`,'later-plugin':'^3.0'},dsh:{profile:{bundles:['local-web-search','later-plugin','local-web-fetch']}},custom:{recent:'keep'}}));
  const patch='# keep my later comment\n- id: later\n  name: later-plugin\n  config: {fresh: true}\n- id: local-web-search\n  name: local-web-search\n';await writeFile(join(p.profileDir,'cordis.patch.yml'),patch);
  await writeFile(join(p.profileDir,'pnpm-lock.yaml'),`lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      local-web-search: {version: link:old}\n      later-plugin: {version: 3.0.0}\npackages:\n  later-plugin@3.0.0: {resolution: {integrity: keep}}\n`);
  await mkdir(join(p.profileDir,'node_modules'),{recursive:true});await mkdir(join(p.profileDir,'node_modules','later-plugin'));await writeFile(join(p.profileDir,'node_modules','later-plugin','user.txt'),'later content');
  await symlink(runtime,join(p.profileDir,'node_modules','local-web-search'),process.platform==='win32'?'junction':'dir');
  await uninstall(home,{dryRun:true});assert.equal(await readFile(join(p.profileDir,'cordis.patch.yml'),'utf8'),patch);
  await uninstall(home);
  const manifest=JSON.parse(await readFile(join(p.profileDir,'package.json'),'utf8'));assert.deepEqual(manifest.dependencies,{'later-plugin':'^3.0'});assert.deepEqual(manifest.dsh.profile.bundles,['later-plugin']);assert.equal(manifest.custom.recent,'keep');
  const rows=parse(await readFile(join(p.profileDir,'cordis.patch.yml'),'utf8'));assert.deepEqual(rows,[{id:'later',name:'later-plugin',config:{fresh:true}}]);
  assert.match(await readFile(join(p.profileDir,'cordis.patch.yml'),'utf8'),/keep my later comment/);
  const lock=parse(await readFile(join(p.profileDir,'pnpm-lock.yaml'),'utf8'));assert.equal(lock.importers['.'].dependencies['later-plugin'].version,'3.0.0');assert.equal(lock.packages['later-plugin@3.0.0'].resolution.integrity,'keep');assert.equal(lock.importers['.'].dependencies['local-web-search'],undefined);
  assert.equal(await readFile(join(p.profileDir,'node_modules','later-plugin','user.txt'),'utf8'),'later content');assert.equal(await exists(join(p.profileDir,'node_modules','local-web-search')),false);
  assert.equal(await exists(p.launcher),false);assert.equal(await exists(join(p.settingsDir,'config.json')),false);assert.equal(await readFile(join(p.settingsDir,'my-notes.txt'),'utf8'),'keep me');assert.equal(await exists(runtime),true);
  await uninstall(home);await assert.rejects(main(['--force']),/Unknown/);await assert.rejects(uninstall(home,{force:true}),/Only selective/);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('undo only native switches still owned by installer and preserve later nested siblings',()=>{
 const before='# original\n[]\n',effective='- id: preset\n  name: preset\n  config:\n    plugins:\n      - id: native\n        name: "@deepseek-ai/dsh-tool-web"\n        config: {search: true, fetch: true, timeout: 12}\n      - id: sibling\n        name: other\n        config: {value: original}\n';
 const after=disableNativeTools(before,effective).text;
 const clean=removeSourceFerryPatch(after,{beforePatch:before,afterPatch:after,beforeEffective:effective});assert.deepEqual(parse(clean),[]);
 const edited=after.replace('value: original','value: user-edited').replace('search: false','search: custom');
 const output=parse(removeSourceFerryPatch(edited,{beforePatch:before,afterPatch:after,beforeEffective:effective}));
 assert.equal(output[0].config.plugins[0].config.search,'custom');assert.equal(output[0].config.plugins[0].config.fetch,true);assert.equal(output[0].config.plugins[1].config.value,'user-edited');
 assert.equal(removeSourceFerryPatch(after),after); // Missing legacy ownership never guesses preference values.
});
test('invalid current configuration and symlinked parent leave the environment untouched',async()=>{
 const home=await mkdtemp(join(tmpdir(),'sf-invalid-')),p=planFor(home);
 try {await mkdir(p.settingsDir,{recursive:true});await mkdir(p.profileDir,{recursive:true});await writeFile(join(p.settingsDir,'config.json'),'{}');await writeFile(join(p.profileDir,'package.json'),'{invalid');await assert.rejects(uninstall(home));assert.equal(await readFile(join(p.settingsDir,'config.json'),'utf8'),'{}');await writeFile(join(p.profileDir,'package.json'),'{}');await writeFile(join(p.profileDir,'cordis.patch.yml'),'[invalid');await assert.rejects(uninstall(home),/Invalid Harness/);assert.equal(await exists(join(p.settingsDir,'config.json')),true);}
 finally{await rm(home,{recursive:true,force:true});}
});
