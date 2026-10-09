import { createGateway } from '../shared/gateway.mjs';

export async function verifyGateway(env) {
  const gateway = createGateway({ env });
  await gateway.health();
  const search = await gateway.search(['DeepSeek Harness official site'], 3);
  if (!search.sources.length) throw new Error('Gateway search returned no results. Check SearXNG before installing.');
  await gateway.fetch('https://www.deepseek.com/harness/');
  return { health: true, search: true, fetch: true };
}

// Exercise the real published defineTool schema compiler, registered providers,
// canonical outputs, cancellation plumbing and actual gateway dispatch. No model/API key required.
export async function verifyPlugins(env, { live = true } = {}) {
  const previous = { ...process.env };
  const tools = new Map(), providers = new Map();
  try {
    Object.assign(process.env, env);
    const ctx = {
      tools: { register: tool => tools.set(tool.name, tool) },
      web: {
        registerSearchProvider: provider => providers.set(provider.id, provider),
        registerFetchProvider: provider => providers.set(provider.id, provider)
      }
    };
    const searchPlugin = await import('../plugins/local-web-search/index.js');
    const fetchPlugin = await import('../plugins/local-web-fetch/index.js');
    searchPlugin.apply(ctx);
    fetchPlugin.apply(ctx);
    if (tools.size !== 2 || providers.size !== 2) throw new Error('Both SourceFerry tools and providers must register.');
    if (live) {
      const exec = { signal: new AbortController().signal };
      const search = await tools.get('local_web_search').execute({ queries: ['DeepSeek Harness official site'], max_results: 3 }, exec);
      if (!search.sources.length) throw new Error('Plugin search returned no sources.');
      await tools.get('local_web_fetch').execute({ url: search.sources[0].url }, exec);
    }
    return { tools: [...tools.keys()], providers: [...providers.keys()], live };
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}
