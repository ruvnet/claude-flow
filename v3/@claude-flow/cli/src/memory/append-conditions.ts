/** Native append predicates checked in the SAME write transaction as an immutable insert. */
import { createHash } from 'node:crypto';
export type AppendCondition = { namespace: string } & (
  | { key: string; sha256: string; latestPrefix?: string }
  | { absent: true; latestPrefix: string }
  | { keysSha256: string; count: number }
);
export class AppendConditionFailed extends Error {}
const text = (value: unknown, limit: number) => typeof value === 'string' && value.length > 0 && value.length <= limit;
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validateAppendConditions(input: unknown): AppendCondition[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) throw new TypeError('append conditions must contain 1-8 predicates');
  return input.map(condition => {
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) throw new TypeError('invalid append condition');
    const row = condition as Record<string, unknown>;
    const fields = Object.keys(row).sort().join(',');
    const validRecord = ['key,namespace,sha256', 'key,latestPrefix,namespace,sha256'].includes(fields)
      && text(row.key, 1024) && digest(row.sha256) && (row.latestPrefix === undefined || text(row.latestPrefix, 1024));
    const validAbsent = fields === 'absent,latestPrefix,namespace' && row.absent === true && text(row.latestPrefix, 1024);
    const validKeys = fields === 'count,keysSha256,namespace' && digest(row.keysSha256)
      && Number.isSafeInteger(row.count) && (row.count as number) >= 0 && (row.count as number) <= 100_000;
    if (!text(row.namespace, 256) || !(validRecord || validAbsent || validKeys)) throw new TypeError('invalid append condition');
    return row as AppendCondition;
  });
}
interface NativeReader {
  prepare(sql: string): { all(...parameters: string[]): Array<{ key: string; content: string; status: string | null }> };
}
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
export function assertAppendConditions(db: NativeReader, conditions: AppendCondition[]): void {
  for (const condition of conditions) {
    if ('keysSha256' in condition) {
      const rows = db.prepare("SELECT key FROM memory_entries WHERE namespace = ? AND (status = 'active' OR status IS NULL)")
        .all(condition.namespace);
      const keys = rows.map(row => row.key).sort();
      if (keys.length !== condition.count || sha(JSON.stringify(keys)) !== condition.keysSha256) {
        throw new AppendConditionFailed('immutable append rejected: namespace membership changed');
      }
      continue;
    }
    if ('key' in condition) {
      const rows = db.prepare('SELECT key, content, status FROM memory_entries WHERE namespace = ? AND key = ?')
        .all(condition.namespace, condition.key);
      if (rows.length !== 1 || !['active', null].includes(rows[0].status)
        || typeof rows[0].content !== 'string' || sha(rows[0].content) !== condition.sha256) {
        throw new AppendConditionFailed('immutable append rejected: expected parent/authority bytes changed or absent');
      }
    }
    if (condition.latestPrefix !== undefined) {
      // Include tombstones: deleting a new authority slot must never rewind to an older authority.
      const pattern = condition.latestPrefix.replace(/[\\%_]/g, character => `\\${character}`) + '%';
      const latest = db.prepare("SELECT key, content, status FROM memory_entries WHERE namespace = ? AND key LIKE ? ESCAPE '\\' ORDER BY key COLLATE BINARY DESC LIMIT 1")
        .all(condition.namespace, pattern);
      if ('absent' in condition ? latest.length !== 0 : latest.length !== 1 || latest[0].key !== condition.key) {
        throw new AppendConditionFailed('immutable append rejected: newer parent/authority slot exists');
      }
    }
  }
}
