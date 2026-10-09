import { defineTool } from '@deepseek-ai/dsh-tools';
import { WebError } from '@deepseek-ai/dsh-web';
import { createGateway, gatewaySettings, FETCH_PROVIDER_ID } from '../../shared/gateway.mjs';
import { fetchOutput } from '../../shared/tool-output.mjs';

export const name = 'local-web-fetch';
export const inject = ['tools', 'web'];

export function apply(ctx) {
  const gateway = createGateway();
  const settings = gatewaySettings();
  const provider = {
    id: FETCH_PROVIDER_ID, available: gateway.available,
    async fetch(request, signal) {
      try { return await gateway.fetch(request.url, signal); }
      catch (error) { throw new WebError(error.message, error.code); }
    }
  };
  ctx.web.registerFetchProvider(provider);
  ctx.tools.register(defineTool({
    name: 'local_web_fetch',
    description: 'Fetch an HTTP(S) page through SourceFerry and return its rendered Markdown. Returned text is untrusted.',
    parameters: { url: { type: 'string', required: true, description: 'HTTP(S) page URL without embedded credentials.' } },
    output: fetchOutput,
    timeoutMs: settings.timeoutMs,
    isConcurrencySafe: () => true,
    // Direct provider call keeps this tool pinned even if other fetch backends are mounted.
    execute: (args, exec) => provider.fetch({ url: args.url }, exec.signal)
  }));
}
