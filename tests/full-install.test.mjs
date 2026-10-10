import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, delimiter } from 'node:path';
import { run } from '../scripts/process.mjs';

test('complete installer, repeat install, verification, launcher inheritance and failed-profile rollback', {timeout:120000}, async () => {
  await mkdir('.tmp',{recursive:true});
  const root = resolve('.'), temp = await mkdtemp(join(resolve('.tmp'),'install-'));
  const dshHome = join(temp,'home'), bin = join(temp,'bin'), profileDir = join(dshHome,'profiles','SourceFerry');
  const webDir=join(dshHome,'profiles','web');
  await mkdir(webDir,{recursive:true}); await mkdir(bin,{recursive:true});
  const manifest = JSON.stringify({name:'fixture-profile',dependencies:{},dsh:{profile:{bundles:[]}}});
  await writeFile(join(webDir,'package.json'),manifest);
  const patch = '# Existing customization\n[]\n';
  await writeFile(join(webDir,'cordis.patch.yml'),patch);
  await writeFile(join(dshHome,'cordis.yml'),'[]\n');
  await writeFile(join(dshHome,'base.yml'), `- insert:
    - id: web
      name: '@deepseek-ai/dsh-web'
    - id: tools
      name: '@deepseek-ai/dsh-tools'
    - id: preset-standard
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: standard
        plugins:
          - id: untouched
            name: unrelated-plugin
          - id: tool-web
            name: '@deepseek-ai/dsh-tool-web'
            config: {search: true, fetch: true, searchTimeoutMs: 60000}
`);
  const fixture = join(root,'tests','fixtures','command.mjs');
  for (const name of ['dsh','npm','pnpm']) {
    if (process.platform === 'win32') await writeFile(join(bin,`${name}.cmd`),`@echo off\r\n"${process.execPath}" "${fixture}" ${name} %*\r\nexit /b %errorlevel%\r\n`);
    else await writeFile(join(bin,name),`#!/bin/sh\nexec '${process.execPath}' '${fixture}' ${name} "$@"\n`,{mode:0o755});
  }
  const server = createServer(async(request,response)=>{
    let result = {status:'ok'};
    if (request.url !== '/health') {
      if (request.headers.authorization !== 'Bearer fixture-only-token') { response.writeHead(401); response.end('{}'); return; }
      let body=''; for await (const chunk of request) body+=chunk;
      const args=JSON.parse(body);
      result=request.url==='/search' ? {sources:[{url:'https://example.com',title:'Fixture',snippet:'Test'}],truncated:false}
        : {url:args.url,content:{success:true,markdown:'# Fixture'},truncated:false};
    }
    response.setHeader('Content-Type','application/json'); response.end(JSON.stringify(result));
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const env={...process.env, PATH:`${bin}${delimiter}${process.env.PATH}`, DSH_HOME:dshHome, SOURCEFERRY_TEST_ROOT:root,
    LOCAL_WEB_GATEWAY_URL:`http://127.0.0.1:${server.address().port}`,LOCAL_WEB_API_TOKEN:'fixture-only-token',DSH_WEB_SEARCH_PROVIDER:'native-test'};
  const installer=join(root,'scripts','install.mjs');
  try {
    const installed=await run(process.execPath,[installer],{env,capture:true});
    assert.match(installed.stdout,/Installation complete/);
    assert.equal(await readFile(join(webDir,'package.json'),'utf8'),manifest);
    assert.equal(await readFile(join(webDir,'cordis.patch.yml'),'utf8'),patch);
    assert.ok(!installed.stdout.includes(env.LOCAL_WEB_API_TOKEN));
    const configPath=join(dshHome,'sourceferry','profiles','SourceFerry','config.json');
    const config=JSON.parse(await readFile(configPath,'utf8'));
    assert.equal(config.env.LOCAL_WEB_API_TOKEN,env.LOCAL_WEB_API_TOKEN);
    if(process.platform!=='win32') assert.equal((await stat(configPath)).mode & 0o777,0o600);
    const updated=await readFile(join(profileDir,'cordis.patch.yml'),'utf8');
    assert.match(updated,/search: false/); assert.match(updated,/fetch: false/); assert.match(updated,/unrelated-plugin/);
    await run(process.execPath,[installer,'--verify'],{env,capture:true});
    await run(process.execPath,[join(config.installDir,'scripts','launch.mjs'),configPath,'--no-open'],{env,capture:true});
    const launch=JSON.parse(await readFile(join(dshHome,'launch-result.json'),'utf8'));
    assert.deepEqual(launch,{args:['--profile','SourceFerry','--no-open'],tokenPresent:true,fetchProvider:'local-crawl4ai-fetch',searchProvider:null});
    await run(process.execPath,[installer],{env,capture:true});
    assert.equal(await readFile(join(profileDir,'cordis.patch.yml'),'utf8'),updated);
    const beforePackage=await readFile(join(profileDir,'package.json'),'utf8');
    await assert.rejects(run(process.execPath,[installer],{env:{...env,SOURCEFERRY_TEST_OVERRIDE:'true'},capture:true}));
    assert.equal(await readFile(join(profileDir,'package.json'),'utf8'),beforePackage);
    assert.equal(await readFile(join(profileDir,'cordis.patch.yml'),'utf8'),updated);
    assert.equal((await readdir(join(dshHome,'sourceferry','backups'))).length,3);
    const lateManifest=JSON.parse(await readFile(join(profileDir,'package.json'),'utf8'));
    lateManifest.dependencies['later-plugin']='^2.0.0'; lateManifest.custom={recent:'keep'};
    lateManifest.dsh.profile.bundles.push('later-plugin');
    await writeFile(join(profileDir,'package.json'),JSON.stringify(lateManifest));
    await writeFile(join(profileDir,'later-user-file.txt'),'keep this file');
    const uninstaller=join(root,'scripts','uninstall.mjs');
    await run(process.execPath,[uninstaller,'--dry-run'],{env,capture:true});
    assert.equal(await readFile(join(profileDir,'cordis.patch.yml'),'utf8'),updated);
    const removed=await run(process.execPath,[uninstaller],{env,capture:true});
    assert.match(removed.stdout,/selectively uninstalled/);
    const finalManifest=JSON.parse(await readFile(join(profileDir,'package.json'),'utf8'));
    assert.deepEqual(finalManifest.dependencies,{'later-plugin':'^2.0.0'});
    assert.equal(finalManifest.custom.recent,'keep');
    assert.equal(await readFile(join(profileDir,'later-user-file.txt'),'utf8'),'keep this file');
    const finalPatch=await readFile(join(profileDir,'cordis.patch.yml'),'utf8');
    assert.match(finalPatch, /\[\]/);
    await assert.rejects(readFile(configPath),{code:'ENOENT'});
    assert.ok(await readFile(join(config.installDir,'package.json')));
    const again=await run(process.execPath,[uninstaller],{env,capture:true}); assert.match(again.stdout,/already uninstalled/);
  } finally {server.closeAllConnections(); server.close();}
});
