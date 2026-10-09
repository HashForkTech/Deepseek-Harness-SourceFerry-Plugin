import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway, gatewaySettings } from '../shared/gateway.mjs';

const env = { LOCAL_WEB_GATEWAY_URL: 'http://127.0.0.1:8080', LOCAL_WEB_API_TOKEN: 'fixture-only-token' };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('search sends bearer auth and gateway contract and normalizes optional fields', async () => {
  const gateway = createGateway({ env, fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8080/search');
    assert.equal(options.headers.Authorization, 'Bearer fixture-only-token');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { queries: ['alpha', 'beta'], max_results: 1 });
    return response({ sources: [{ url: 'https://example.com', title: null, snippet: 'Hello', extra: 'ignored' }, { url: 'https://example.org' }], truncated: false });
  } });
  assert.deepEqual(await gateway.search([' alpha ', 'beta'], 1), { sources: [{ url: 'https://example.com', snippet: 'Hello' }], truncated: true });
});

test('fetch supports current nested and older direct Crawl4AI payloads', async () => {
  for (const data of [
    { url: 'https://example.com', content: { success: true, markdown: '# Page', status_code: 201 }, truncated: true },
    { success: true, markdown: '# Page' }
  ]) {
    const result = await createGateway({ env, fetchImpl: async () => response(data) }).fetch('https://example.com');
    assert.equal(result.body.kind, 'text'); assert.equal(result.body.content, '# Page');
    assert.equal(result.statusCode, data.content ? 201 : 200);
    assert.equal(result.truncated, Boolean(data.truncated));
  }
});

test('invalid requests fail before any network access', async () => {
  let requests = 0;
  const gateway = createGateway({ env, fetchImpl: async () => { requests++; return response({}); } });
  for (const queries of [[], [''], ['a','b','c','d','e'], 'hello']) await assert.rejects(gateway.search(queries), /1 to 4/);
  for (const limit of [0,21,1.5]) await assert.rejects(gateway.search(['a'], limit), /integer/);
  for (const url of ['file:///etc/passwd','https://user:secret@example.com','https://example.com/a b']) await assert.rejects(gateway.fetch(url), /HTTP/);
  assert.equal(requests, 0);
});

test('configuration rejects placeholders, credentials and malformed timeout', () => {
  for (const token of ['', 'REPLACE-WITH-TOKEN', '<token>', 'a\nb']) assert.throws(() => gatewaySettings({ ...env, LOCAL_WEB_API_TOKEN: token }));
  for (const url of ['http://user:pass@localhost', 'http://localhost?token=secret', 'http://localhost/#secret']) assert.throws(() => gatewaySettings({ ...env, LOCAL_WEB_GATEWAY_URL: url }));
  assert.throws(() => gatewaySettings({ ...env, LOCAL_WEB_TIMEOUT_MS: 'NaN' }));
  assert.equal(createGateway({ env: {} }).available(), false);
});

test('HTTP failures and network exceptions never leak tokens or server content', async () => {
  for (const status of [401,403,422,500,502,504]) {
    const gateway = createGateway({ env, fetchImpl: async () => response({ detail: 'fixture-only-token secret server data' }, status) });
    await assert.rejects(gateway.search(['a']), error => error.code === `SOURCEFERRY_HTTP_${status}` && !error.message.includes(env.LOCAL_WEB_API_TOKEN));
  }
  const gateway = createGateway({ env, fetchImpl: async () => { throw new Error(env.LOCAL_WEB_API_TOKEN); } });
  await assert.rejects(gateway.fetch('https://example.com'), error => error.code === 'SOURCEFERRY_NETWORK' && !error.message.includes(env.LOCAL_WEB_API_TOKEN));
});

test('malformed responses and unsuccessful or empty crawls fail clearly', async () => {
  for (const data of [{}, { sources: 'bad', truncated: false }, { sources: [], truncated: 'no' }]) {
    await assert.rejects(createGateway({ env, fetchImpl: async () => response(data) }).search(['a']), /response/);
  }
  for (const content of [{ success: false, markdown: 'x' }, { success: true, markdown: '' }]) {
    await assert.rejects(createGateway({ env, fetchImpl: async () => response({ content }) }).fetch('https://example.com'), /Markdown/);
  }
  await assert.rejects(createGateway({ env, fetchImpl: async () => new Response('not-json') }).search(['a']), /invalid JSON/);
});

test('cancellation and timeouts abort the request without another provider fallback', async () => {
  const fetchImpl = async (_url, { signal }) => new Promise((resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const controller = new AbortController();
  const promise = createGateway({ env, fetchImpl }).fetch('https://example.com', controller.signal);
  controller.abort();
  await assert.rejects(promise, error => error.code === 'SOURCEFERRY_CANCELLED');
  const timer = setInterval(() => {}, 20);
  try {
    await assert.rejects(createGateway({ env: { ...env, LOCAL_WEB_TIMEOUT_MS: '10' }, fetchImpl }).search(['a']), error => error.code === 'SOURCEFERRY_TIMEOUT');
  } finally { clearInterval(timer); }
});
