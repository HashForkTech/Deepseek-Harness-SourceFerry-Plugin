export const SEARCH_PROVIDER_ID = 'local-crawl4ai-search';
export const FETCH_PROVIDER_ID = 'local-crawl4ai-fetch';
export const DEFAULT_TIMEOUT_MS = 600_000;

export class GatewayError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
  }
}

export function httpUrl(value, label = 'URL') {
  if (typeof value !== 'string' || /[\s\x00-\x1f]/.test(value)) {
    throw new GatewayError(`${label} must be an HTTP(S) URL without credentials.`, 'SOURCEFERRY_INVALID_URL');
  }
  let url;
  try { url = new URL(value); } catch { /* handled below */ }
  if (!url || !['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new GatewayError(`${label} must be an HTTP(S) URL without credentials.`, 'SOURCEFERRY_INVALID_URL');
  }
  return url;
}

export function gatewaySettings(env = process.env) {
  const url = httpUrl(env.LOCAL_WEB_GATEWAY_URL, 'LOCAL_WEB_GATEWAY_URL');
  if (url.search || url.hash) throw new GatewayError('Gateway URL cannot contain a query or fragment.', 'SOURCEFERRY_CONFIGURATION');
  const token = env.LOCAL_WEB_API_TOKEN?.trim();
  if (!token || /[\r\n]/.test(token) || /^(?:REPLACE[-_]|CHANGE_ME|<)/i.test(token)) {
    throw new GatewayError('Set LOCAL_WEB_API_TOKEN to your existing gateway token.', 'SOURCEFERRY_CONFIGURATION');
  }
  const timeoutMs = Number(env.LOCAL_WEB_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new GatewayError('LOCAL_WEB_TIMEOUT_MS must be a positive integer below 2147483648.', 'SOURCEFERRY_CONFIGURATION');
  }
  return { baseUrl: url.href.replace(/\/$/, ''), token, timeoutMs };
}

export function createGateway({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const available = () => { try { gatewaySettings(env); return true; } catch { return false; } };
  async function request(endpoint, body, signal) {
    const settings = gatewaySettings(env);
    const deadline = AbortSignal.timeout(settings.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      const response = await fetchImpl(`${settings.baseUrl}${endpoint}`, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: body === undefined ? {} : {
          Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json'
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: combined
      });
      if (!response.ok) {
        const detail = response.status === 401 || response.status === 403
          ? 'Authentication failed; check LOCAL_WEB_API_TOKEN.'
          : `Gateway request failed (HTTP ${response.status}).`;
        // Never include a server response body or underlying exception: either may contain credentials.
        throw new GatewayError(detail, `SOURCEFERRY_HTTP_${response.status}`);
      }
      try { return await response.json(); }
      catch { throw new GatewayError('Gateway returned invalid JSON.', 'SOURCEFERRY_INVALID_RESPONSE'); }
    } catch (error) {
      if (signal?.aborted) throw new GatewayError('Gateway request cancelled.', 'SOURCEFERRY_CANCELLED');
      if (deadline.aborted) throw new GatewayError('Gateway request timed out.', 'SOURCEFERRY_TIMEOUT');
      if (error instanceof GatewayError) throw error;
      throw new GatewayError('Cannot reach the SourceFerry gateway; check its URL and network connection.', 'SOURCEFERRY_NETWORK');
    }
  }
  return {
    available,
    async health(signal) {
      const data = await request('/health', undefined, signal);
      if (data?.status !== 'ok') throw new GatewayError('Gateway is not healthy.', 'SOURCEFERRY_HEALTH');
      return data;
    },
    async search(queries, maxResults = 8, signal) {
      if (!Array.isArray(queries) || queries.length < 1 || queries.length > 4 ||
          queries.some(q => typeof q !== 'string' || !q.trim())) {
        throw new GatewayError('Provide 1 to 4 non-empty search queries.', 'SOURCEFERRY_INVALID_ARGUMENT');
      }
      if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 20) {
        throw new GatewayError('max_results must be an integer from 1 to 20.', 'SOURCEFERRY_INVALID_ARGUMENT');
      }
      const data = await request('/search', { queries: queries.map(q => q.trim()), max_results: maxResults }, signal);
      if (!Array.isArray(data?.sources) || typeof data.truncated !== 'boolean') {
        throw new GatewayError('Gateway search response has no valid sources list.', 'SOURCEFERRY_INVALID_RESPONSE');
      }
      const sources = data.sources.slice(0, maxResults).map(source => {
        httpUrl(source?.url, 'Source URL');
        return { url: source.url,
          ...(typeof source.title === 'string' ? { title: source.title } : {}),
          ...(typeof source.snippet === 'string' ? { snippet: source.snippet } : {}) };
      });
      return { sources, truncated: data.truncated || data.sources.length > maxResults };
    },
    async fetch(url, signal) {
      httpUrl(url);
      const data = await request('/fetch', { url }, signal);
      const content = data?.content ?? data;
      if (content?.success !== true || typeof content.markdown !== 'string' || !content.markdown.trim()) {
        throw new GatewayError('Gateway fetch response contains no successful Markdown crawl.', 'SOURCEFERRY_INVALID_RESPONSE');
      }
      const finalUrl = data.url ?? url;
      httpUrl(finalUrl, 'Fetched URL');
      // SourceFerry does not expose the origin status in every version. Its successful crawl is normalized to 200.
      const statusCode = Number.isInteger(content.status_code) ? content.status_code : 200;
      return { url: finalUrl, statusCode, body: { kind: 'text', content: content.markdown }, truncated: data.truncated === true };
    }
  };
}
