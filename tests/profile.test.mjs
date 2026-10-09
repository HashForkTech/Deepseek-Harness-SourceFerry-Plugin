import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { composeEntries, loadOverlayPatches, renderConfigDump } from '@deepseek-ai/dsh-app-boot';
import { disableNativeTools, checkEffectiveTools, parseEntries } from '../scripts/profile.mjs';

const original = `
- id: web
  name: '@deepseek-ai/dsh-web'
- id: tools
  name: '@deepseek-ai/dsh-tools'
- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  disabled: true
  config: {fetch: true, searchTimeoutMs: 60000}
- id: local-web-search
  name: local-web-search
- id: local-web-fetch
  name: local-web-fetch
`;
const presets = ['standard','ptc','cordis'].map(preset => `
- id: preset-${preset}
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: ${preset}
    plugins:
      - id: sentinel
        name: unrelated-plugin
        disabled: !!js process.platform === 'win32'
        config: {custom: keep-me}
      - id: tool-web
        name: '@deepseek-ai/dsh-tool-web'
        config: {search: true, fetch: true, searchTimeoutMs: 60000}
`).join('');

test('preserves complete presets, existing patches, comments and !!js tags; repeats idempotently', () => {
  const patch = '# My customization\n- id: unrelated\n  config: {untouched: true}\n';
  const result = disableNativeTools(patch, original + presets);
  assert.equal(result.count, 4);
  assert.match(result.text, /My customization/); assert.match(result.text, /untouched: true/);
  assert.equal((result.text.match(/custom: keep-me/g) ?? []).length, 3);
  assert.equal((result.text.match(/!!js/g) ?? []).length, 3);
  const effective = parseEntries(original + presets).toJS();
  for (const row of effective.filter(row => row.id.startsWith('preset-'))) {
    const updated = parseEntries(result.text).toJS().find(item => item.id === row.id);
    assert.equal(updated.config.plugins.length, row.config.plugins.length);
    assert.deepEqual(updated.config.plugins[0], row.config.plugins[0]);
    assert.deepEqual(updated.config.plugins[1].config, {search:false, fetch:false, searchTimeoutMs:60000});
  }
  assert.equal(disableNativeTools(result.text, original + presets).text, result.text);
});

test('real Harness composition receives complete row overrides and retains expressions', async () => {
  await mkdir('.tmp', { recursive: true });
  const dir = await mkdtemp(join(resolve('.tmp'), 'composition-'));
  const insertFile = join(dir, 'base.yml'), patchFile = join(dir, 'patch.yml'), configFile = join(dir, 'cordis.yml');
  await writeFile(insertFile, '- insert:\n' + (original + presets).trim().split('\n').map(line => '    ' + line).join('\n') + '\n');
  await writeFile(patchFile, disableNativeTools('[]\n', original + presets).text);
  await writeFile(configFile, '[]\n');
  const base = loadOverlayPatches('test', insertFile), patch = loadOverlayPatches('test', patchFile);
  const composed = composeEntries([base, patch]);
  assert.equal(composed.length, parseEntries(original + presets).toJS().length);
  for (const preset of composed.filter(row => row.id.startsWith('preset-'))) {
    assert.deepEqual(preset.config.plugins[0].disabled, { __jsExpr: "process.platform === 'win32'" });
    assert.equal(preset.config.plugins[1].config.search, false);
    assert.equal(preset.config.plugins[1].config.fetch, false);
    assert.equal(preset.config.plugins[1].config.searchTimeoutMs, 60000);
  }
  const dump = renderConfigDump('test', configFile, [{ label: 'base', patches: base }, { label: 'profile', patches: patch }]);
  assert.equal(checkEffectiveTools(dump), true);
});

test('unsafe or overridden profile configurations fail before success is reported', () => {
  assert.throws(() => checkEffectiveTools(original + presets), /still enabled/);
  assert.equal(checkEffectiveTools(original + presets, {keepNative:true}), true);
  assert.throws(() => checkEffectiveTools(original.replace('name: local-web-fetch', 'name: absent')), /local-web-fetch/);
  assert.throws(() => disableNativeTools('[]', '- id: bad\n  name: "@deepseek-ai/dsh-tool-web"\n  config: !!js process.env.SECRET\n'), /dynamic/);
  assert.throws(() => disableNativeTools('{}', original), /sequence/);
});
