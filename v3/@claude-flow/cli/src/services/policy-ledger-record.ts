import { TextDecoder } from 'node:util';
const DEFAULT_LIMIT = 16 * 1024 * 1024;
const MAX_LIMIT = 64 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
export function policyLedgerRecordLimit(): number {
  const raw = process.env.CLAUDE_FLOW_POLICY_AUDIT_MAX_RECORD_BYTES;
  if (!raw) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1024 || value > MAX_LIMIT) throw new Error('policy-ledger-audit-invalid-record-limit');
  return value;
}
export function decodeLedgerRecord(bytes: Buffer): string {
  try { return decoder.decode(bytes); } catch { throw new Error('policy-ledger-archive-utf8-error'); }
}
