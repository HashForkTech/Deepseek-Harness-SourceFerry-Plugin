// Test-only package-manager / CLI fixture; all writes remain in the test DSH_HOME.
import { readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { loadOverlayPatches, renderConfigDump } from '@deepseek-ai/dsh-app-boot';

const [kind, ...args] = process.argv.slice(2);
const profileDir = join(process.env.DSH_HOME, 'profiles', 'web');
if (kind === 'npm') {
  if (args[0] !== 'ci') throw new Error('Unexpected npm fixture invocation.');
  await symlink(join(process.env.SOURCEFERRY_TEST_ROOT, 'node_modules'), join(process.cwd(), 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
} else if (kind === 'pnpm') {
  console.log('11.0.0');
} else if (args.includes('--version')) {
  console.log('0.2.0-rc.2');
} else if (args[0] === 'plugin') {
  await mkdir(profileDir, { recursive: true });
  if (args.includes('add')) {
    const manifestPath = join(profileDir, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const plugin = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
    manifest.dependencies[plugin.name] = process.cwd();
    await writeFile(manifestPath, JSON.stringify(manifest));
  }
} else if (args.includes('--dump-config')) {
  const manifest = JSON.parse(await readFile(join(profileDir,'package.json'),'utf8'));
  const base = loadOverlayPatches('fixture', join(process.env.DSH_HOME,'base.yml'));
  const pluginPatches = Object.entries(manifest.dependencies).filter(([name])=>name.startsWith('local-web-')).flatMap(([_name, path])=>loadOverlayPatches('fixture',join(path,'cordis.patch.yml')));
  const patch = loadOverlayPatches('fixture',join(profileDir,'cordis.patch.yml'));
  const override = process.env.SOURCEFERRY_TEST_OVERRIDE === 'true' ? [{id:'preset-standard',config:{id:'standard',plugins:[{id:'tool-web',name:'@deepseek-ai/dsh-tool-web',config:{search:true,fetch:true}}]}}] : [];
  const dump = renderConfigDump('fixture',join(process.env.DSH_HOME,'cordis.yml'),[
    {label:'base',patches:base},{label:'plugins',patches:pluginPatches},{label:'profile',patches:patch},{label:'override',patches:override}
  ]);
  console.log(dump);
} else {
  await writeFile(join(process.env.DSH_HOME,'launch-result.json'), JSON.stringify({
    args, tokenPresent: Boolean(process.env.LOCAL_WEB_API_TOKEN),
    fetchProvider:process.env.DSH_WEB_FETCH_PROVIDER, searchProvider:process.env.DSH_WEB_SEARCH_PROVIDER ?? null
  }));
}
