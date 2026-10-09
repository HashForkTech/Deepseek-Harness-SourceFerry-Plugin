import { parseDocument, isSeq, isMap, isScalar, visit } from 'yaml';

const options = { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] };

export function parseEntries(text) {
  const doc = parseDocument(text, options);
  if (doc.errors.length) throw new Error('Harness YAML is invalid; no profile changes were made.');
  if (!isSeq(doc.contents)) throw new Error('Harness profile must contain a YAML entry sequence.');
  return doc;
}

function nativeNodes(root) {
  const found = [];
  visit(root, (_key, node) => {
    if (isMap(node) && node.get('name') === '@deepseek-ai/dsh-tool-web') found.push(node);
  });
  return found;
}

function disable(row) {
  for (const node of nativeNodes(row)) {
    const config = node.get('config');
    if (config !== undefined && !isMap(config)) throw new Error('Native web configuration is dynamic or unsupported; use --keep-native and edit it manually.');
    if (!config) node.set('config', {});
    node.get('config').set('search', false);
    node.get('config').set('fetch', false);
  }
}

// Nested preset plugin IDs are not globally unique. Replace the entire enclosing
// preset config from the effective dump, preserving all siblings and !!js scalars.
export function disableNativeTools(patchText, effectiveText) {
  const patch = parseEntries(patchText);
  patch.contents.flow = false;
  const effective = parseEntries(effectiveText);
  let count = 0;
  for (const source of effective.contents.items) {
    if (!isMap(source) || !nativeNodes(source).length) continue;
    const id = source.get('id');
    if (typeof id !== 'string') throw new Error('Cannot safely patch a native web row without a stable enclosing ID.');
    const name = source.get('name');
    const row = source.clone();
    disable(row);
    const existing = patch.contents.items.findLast(item => isMap(item) && !item.has('insert') && item.get('id') === id &&
      (!item.has('name') || item.get('name') === name));
    if (existing) {
      // Preserve unrelated patch metadata and comments; config contains the complete composed preset.
      if (row.has('config')) existing.set('config', row.get('config').clone());
    } else {
      const override = patch.createNode({ id, ...(name ? { name } : {}) });
      if (row.has('config')) override.set('config', row.get('config').clone());
      patch.add(override);
    }
    count += nativeNodes(row).length;
  }
  return { text: String(patch), count };
}

export function checkEffectiveTools(text, { keepNative = false } = {}) {
  const doc = parseEntries(text);
  const entries = [];
  visit(doc.contents, (_key, node) => { if (isMap(node) && typeof node.get('name') === 'string') entries.push(node); });
  for (const name of ['local-web-search', 'local-web-fetch']) {
    const matches = entries.filter(row => row.get('name') === name);
    if (matches.length !== 1 || matches[0].get('disabled') === true ||
        (isScalar(matches[0].get('disabled', true)) && matches[0].get('disabled', true).tag)) {
      throw new Error(`${name} must have exactly one enabled, unconditional profile entry.`);
    }
  }
  if (!entries.some(row => row.get('name') === '@deepseek-ai/dsh-web')) {
    throw new Error('The target profile has no dsh-web service. Use the standard web profile.');
  }
  if (!keepNative) for (const row of entries.filter(row => row.get('name') === '@deepseek-ai/dsh-tool-web')) {
    if (row.get('disabled') === true) continue;
    const config = row.get('config');
    if (!isMap(config) || config.get('search') !== false || config.get('fetch') !== false) {
      throw new Error('An effective native web tool is still enabled; a home-level override may take precedence.');
    }
  }
  return true;
}
