/** TTL is a read-time visibility rule, independent of background cleanup. */
export function liveMemoryRowSql(opts: { includeExpired?: boolean } = {}): string {
  if (opts.includeExpired) return `(status = 'active' OR status IS NULL)`;
  return `(status = 'active' OR status IS NULL) AND (expires_at IS NULL OR expires_at > ${Date.now()})`;
}
