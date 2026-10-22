/**
 * A tool caller may select task data, never the destination of operator secrets.
 * Retain URL arguments as compatibility assertions against trusted process config.
 * Exact base matching also prevents caller-selected paths on a trusted origin.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function configuredServiceUrl(configured: string, override: unknown, setting: string): string {
  const normalize = (value: unknown): string => {
    if (typeof value !== 'string' || !value || value !== value.trim()) {
      throw new Error(`${setting}: expected a configured HTTPS base URL`);
    }
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error(`${setting}: expected a configured HTTPS base URL`); }
    // Plain HTTP only for a loopback service (a local or self-hosted gateway or LLM). An argument
    // must equal the configured base exactly, so it can never pick a loopback port the operator did not.
    const isLocalHttp = url.protocol === 'http:' && LOOPBACK.has(url.hostname);
    if ((url.protocol !== 'https:' && !isLocalHttp) || url.username || url.password || url.search || url.hash) {
      throw new Error(`${setting}: configured base URL must use HTTPS (or HTTP on loopback) without credentials, query or fragment`);
    }
    return url.href.replace(/\/+$/, '');
  };
  const base = normalize(configured);
  // An absent, null or empty argument asserts nothing: use the configured base.
  if (override !== undefined && override !== null && override !== '' && normalize(override) !== base) {
    throw new Error(`${setting}: tool URL must match the configured service; configure the MCP server environment to change destinations`);
  }
  return base;
}
