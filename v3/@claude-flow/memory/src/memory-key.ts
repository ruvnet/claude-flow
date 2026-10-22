/** Encode a memory's namespace/key tuple without delimiter collisions. */
export function encodeMemoryKey(namespace: string, key: string, defaultNamespace = 'default'): string {
  return JSON.stringify([namespace || defaultNamespace, key]);
}
