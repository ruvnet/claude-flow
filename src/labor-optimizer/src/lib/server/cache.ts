/**
 * In-memory cache for API responses.
 * Vercel serverless functions share memory within the same instance,
 * so this cache persists across requests on a warm instance but
 * resets on cold starts — a safe default for short TTLs.
 */

const cache = new Map<string, { data: any; expires: number }>();

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache(key: string, data: any, ttlSeconds: number): void {
  cache.set(key, { data, expires: Date.now() + ttlSeconds * 1000 });
}

export function invalidateCache(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
