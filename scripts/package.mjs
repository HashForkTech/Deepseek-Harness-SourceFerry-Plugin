import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const prefix = `deepseek-harness-sourceferry-plugin-${version}`;
const files = {};
async function add(relative) {
  const path = join(root, relative);
  const content = await readFile(path);
  files[`${prefix}/${relative.replaceAll('\\', '/')}`] = [new Uint8Array(content), {
    mtime: new Date('2026-10-09T00:00:00Z'), os: 3,
    attrs: ((relative.endsWith('.sh') ? 0o100755 : 0o100644) << 16) >>> 0
  }];
}
async function walk(relative) {
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) await add(path);
  }
}
for (const file of ['README.md', 'LICENSE', 'VALIDATION.md', 'package.json', 'package-lock.json', 'install.sh', 'install.ps1', 'uninstall.sh', 'uninstall.ps1', '.gitattributes', '.gitignore']) await add(file);
for (const directory of ['plugins', 'shared', 'scripts']) await walk(directory);
async function vendor(dir, relative='') {
  for (const entry of await readdir(join(root,'node_modules/yaml',dir,relative),{withFileTypes:true})) {
    const path=relative ? relative+'/'+entry.name : entry.name;
    if(entry.isDirectory()) await vendor(dir,path);
    else if(entry.name.endsWith('.js')) files[prefix+'/scripts/vendor/yaml/'+dir+'/'+path]=new Uint8Array(await readFile(join(root,'node_modules/yaml',dir,path)));
  }
}
for(const name of ['package.json','LICENSE']) files[prefix+'/scripts/vendor/yaml/'+name]=new Uint8Array(await readFile(join(root,'node_modules/yaml',name)));
await vendor('dist');
const archive = zipSync(files, { level: 9 });
const output = join(root, 'dist');
await mkdir(output, { recursive: true });
await writeFile(join(output, `${prefix}.zip`), archive);
await writeFile(join(output, `${prefix}.zip.sha256`), `${createHash('sha256').update(archive).digest('hex')}  ${prefix}.zip\n`);
console.log(join(output, `${prefix}.zip`));
