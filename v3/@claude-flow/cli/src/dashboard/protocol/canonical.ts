/** Deterministic JSON (sorted keys, no whitespace). Rejects values that cannot round-trip. */
export function canonicalize(value: unknown): string {
  return walk(value, 0);
}
function walk(v: unknown, depth: number): string {
  if (depth > 32) throw new Error('canonical: too deep');
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string': return JSON.stringify(v);
    case 'boolean': return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new Error('canonical: non-finite number');
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return '[' + v.map(x => walk(x, depth + 1)).join(',') + ']';
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).sort();
      const parts: string[] = [];
      for (const k of keys) {
        if (o[k] === undefined) throw new Error('canonical: undefined value at ' + k);
        parts.push(JSON.stringify(k) + ':' + walk(o[k], depth + 1));
      }
      return '{' + parts.join(',') + '}';
    }
    default: throw new Error('canonical: unsupported type ' + typeof v);
  }
}
