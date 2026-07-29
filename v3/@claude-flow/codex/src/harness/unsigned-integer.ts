const CANONICAL_UNSIGNED = /^(?:0|[1-9][0-9]*)$/;
const MAX_UNSIGNED_64 = (1n << 64n) - 1n;

/** Parse a decimal unsigned integer without accepting aliases such as +1, 01, hex, or whitespace. */
export function parseCanonicalUnsigned(value: string, label: string): bigint {
  if (!CANONICAL_UNSIGNED.test(value)) {
    throw new Error(`${label} must be a canonical unsigned decimal integer`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UNSIGNED_64) {
    throw new Error(`${label} exceeds unsigned 64-bit range`);
  }
  return parsed;
}
