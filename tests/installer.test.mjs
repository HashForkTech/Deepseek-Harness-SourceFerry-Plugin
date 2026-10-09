import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../scripts/install.mjs';
import { commandSpec } from '../scripts/process.mjs';

test('installer options reject path traversal and unsupported options', () => {
  assert.deepEqual(parseArgs(['--profile','web','--keep-native']), {profile:'web',keepNative:true,verify:false,help:false});
  for (const args of [['--profile','../other'],['--profile','web/other'],['--profile'],['--token','secret'],['--unknown']]) assert.throws(()=>parseArgs(args));
});

test('Windows shim arguments are quoted literally, including shell metacharacters', () => {
  const spec = commandSpec('C:\\Path with spaces\\dsh.cmd', ['--profile', "quote' & $value ; name", '--no-open'], 'win32');
  assert.equal(spec.command,'powershell.exe');
  const decoded = Buffer.from(spec.args.at(-1),'base64').toString('utf16le');
  assert.match(decoded, /'quote'' & \$value ; name'/);
  assert.deepEqual(commandSpec('/bin/dsh',['--no-open'],'linux'), {command:'/bin/dsh',args:['--no-open']});
});
