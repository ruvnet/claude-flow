/** Shared on-disk shape for the CLI claim service and public MCP claim tools. */
import { readFileSync } from 'node:fs';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Read legacy CLI arrays and MCP dictionaries; never replace unreadable state. */
export function readClaimsStore(file: string): Record<string, unknown> {
  let text: string;
  try { text = readFileSync(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { claims: {}, stealable: {}, contests: {} };
    throw error;
  }
  const data: unknown = JSON.parse(text);
  if (!record(data) || (!Array.isArray(data.claims) && !record(data.claims))) {
    throw new Error('Invalid claims store: expected a claims array or object');
  }
  const entries = Array.isArray(data.claims)
    ? data.claims.map((claim: unknown) => [record(claim) ? claim.issueId : undefined, claim])
    : Object.entries(data.claims);
  const claims: Record<string, unknown> = Object.create(null);
  for (const [id, claim] of entries) {
    if (typeof id !== 'string' || !id || !record(claim) || claim.issueId !== id ||
        !record(claim.claimant) || typeof claim.status !== 'string' ||
        typeof claim.claimedAt !== 'string' || typeof claim.statusChangedAt !== 'string' ||
        Object.hasOwn(claims, id)) {
      throw new Error('Invalid claims store: malformed or duplicate claim');
    }
    claims[id] = claim;
  }
  for (const key of ['stealable', 'contests']) {
    if (data[key] !== undefined && !record(data[key])) throw new Error(`Invalid claims store: ${key} must be an object`);
  }
  return { ...data, claims, stealable: data.stealable ?? {}, contests: data.contests ?? {} };
}
