# MCP governance audit storage

With `RUFLO_MCP_ENFORCE_POLICY=1` and `auditLog: true` in
`.harness/mcp-policy.json`, stdio tool calls require a successful audit write.
The default log is now `.claude-flow/logs/mcp-audit.jsonl` under the server's
working directory, alongside the project whose policy is loaded. Each record
also includes `projectPath` so records remain attributable if explicitly routed
to a shared destination.

Set `auditLogPath` in the policy to choose an explicit destination. It takes
precedence over `RUFLO_MCP_AUDIT_LOG_PATH` on the server process, which is the
fallback when the policy omits the path. If both are absent, the project default
applies. An explicit path must be a non-empty string; invalid values deny
mandatory audit writes instead of silently selecting another destination.
Absolute paths are used directly; relative paths resolve against the server's
working directory. Missing parent directories are created. New directories use
mode `0700`, and new logs use `0600` on systems that support POSIX permissions;
existing permissions are not rewritten.

For example, preserve up to five rotated 10 MiB segments plus the active log:

```json
{
  "auditLog": true,
  "auditLogMaxBytes": 10485760,
  "auditLogMaxFiles": 5
}
```

These values are the defaults. `auditLogMaxBytes` must be a positive safe integer;
`auditLogMaxFiles` must be an integer from 1 through 100 and counts backups in
addition to the active log. Rotation occurs before appending a record that would
exceed the byte limit. `.1` is the newest backup; the highest configured segment
expires on rotation. Invalid settings, an oversized single record, or a failed
write/rotation deny the tool call under the existing fail-closed policy.

Writers sharing a path use an exclusive `<log>.lock` file around rotation and
append. Contention denies that call instead of racing an audit-file rename; a
caller can retry. A process crash can leave a stale lock. Stop all writers for
that path, inspect the failure, and remove the lock only after verifying that no
writer owns it. The implementation does not guess lock ownership or delete a
lock held by another process.

This is bounded local retention, not permanent archival or a tamper-evident log.
There is no age-based rotation. Reducing retention settings does not retroactively
resize existing segments or delete higher-numbered segments from an earlier
configuration. Archive or prune those separately while writers are stopped.
The old machine-wide temporary log is not migrated or deleted. Update log readers
to the project path or set the environment variable to an explicitly managed
path (unless the policy already sets `auditLogPath`). Enforcement coverage is unchanged: this does not add governance enforcement
to HTTP/WebSocket dispatchers.
