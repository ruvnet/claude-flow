# Machine-readable doctor checks

Use `ruflo doctor --json` for CI and editor integrations. To select one component,
use `ruflo doctor --json --component node` (or `-c node`).

Standard output contains one JSON object, without banners, progress spinners,
ANSI styling, or startup update notifications:

```json
{"schemaVersion":1,"checks":[{"id":"node","status":"pass","name":"Node.js Version","detail":"v24.18.0 (>= 20 required)"}]}
```

`schemaVersion` identifies the output contract. Each check has a stable `id`,
`status` (`pass`, `warn`, or `fail`), a display `name`, and a human-readable
`detail`. Checks may include `fix` with a suggested command. Use IDs and statuses
for automation; display names and details can change. Component aliases share
IDs. Grouped components such as `memory` and `proxy` return multiple checks with
distinct IDs. Native AgentDB integrity IDs use `memory-native:<database path>`
with forward slashes to distinguish simultaneously present database files.

The exit code is 1 when any check fails, and 0 for passing or warning-only
results. An invalid component returns exit code 1 and a JSON object with
`schemaVersion: 1`, `checks: []`, and an `error` string.

JSON mode cannot be combined with `--fix`, `--install`, or `--fix-handles`.
These combinations return the same JSON error shape before performing repairs.
Run repairs separately, then repeat the JSON health check. Suggested `fix`
commands are included in JSON without requiring `--fix`.

Without `--json`, doctor retains its existing text output and repair behavior.
