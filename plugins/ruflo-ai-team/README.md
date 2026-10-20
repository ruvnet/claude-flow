# RuFlo AI Team

Give Claude a tenant-isolated AI team that divides work, coordinates progress, recalls approved context, and returns evidence-backed results.

RuFlo AI Team is a hosted MCP service (`https://team.ruv.io/mcp`) plus a Claude plugin with six skills, four commands, and four agent roles. It turns a reviewed goal into explicit team, run, task, memory, and evidence records. It coordinates work: it does not run agents, send messages, deploy software, execute shell commands, make purchases, or approve consequential actions. Claude (in Claude Code, Cowork, or claude.ai) does the work with its own tools and the service keeps the shared record. You stay the authority for anything with an external effect.

## What you need

- The RuFlo AI Team connector. It is included in the plugin; on first use you are asked to sign in (OAuth 2.1). Without sign-in, the skills cannot read or write team data, and Claude should say so.
- Nothing to install locally for the hosted service. The plugin also contains a small local guard (see "As a mod", Claude Code only).

## Examples

Slash commands work where your surface supports plugin commands (Claude Code, Cowork). Plain-language prompts work everywhere the connector is available, including claude.ai.

1. Start a team. Claude Code or Cowork: `/team-start prepare the release checklist for v2.0`. claude.ai: "Use RuFlo AI Team to plan a release-readiness team for v2.0. Show me the roles, tasks and budget before creating anything."
2. Check progress. `/team-status` (it lists your teams if you give no ID), or "What is blocked on my AI team and who owns each task?"
3. Remember a decision. "Remember for my team that we only deploy on weekdays." Later: "What constraints did we record for the team?"
4. Review the result. `/team-review RUN_ID`, or "Check run RUN_ID against its acceptance criteria and tell me which claims have evidence."
5. Pause without losing anything. `/team-stop TEAM_ID`, or "Pause the team and export its evidence first."

## How auth works and what leaves your machine

- Sign-in is OAuth 2.1 with scopes `team:read`, `team:write` and `team:run`. The service derives your tenant from the verified token; no tool takes a tenant ID, and another tenant's IDs return the same not_found as an unknown ID.
- Sent to team.ruv.io when a skill uses a tool: the text Claude puts into team names, objectives, run goals, task descriptions and results, memory text and search queries. Keep secrets and unnecessary personal data out of them. Your files, conversation history and local environment are not uploaded by the plugin; only what Claude passes to these tools is.
- Stored in the service (Firestore), separated by tenant. Retention, access and deletion requests are covered by the privacy policy (https://team.ruv.io/privacy). Data is not sold or used to train general-purpose models.
- The local guard hook (Claude Code only) makes no network calls.

## Troubleshooting

- "Not signed in", 401, or the tools are missing: connect the RuFlo AI Team connector and sign in again (Claude Code: `/mcp`; claude.ai and Cowork: Settings, Connectors).
- 403 or `insufficient_scope`: the connection lacks `team:write` or `team:run`. Disconnect and reconnect, approving all three scopes.
- `not_found` for an ID you just created: the ID belongs to a different account or tenant than the one signed in. Check which account is connected.
- `unsafe_content` when remembering text: it matched a prompt-injection pattern. Rephrase it as a plain fact.
- `tasks_incomplete` when completing a run: finish or remove the open tasks first.
- Search says `lexical-degraded`: the service fell back to keyword search; results are still tenant-scoped.
- A write was refused with a message about a secret (Claude Code): the local guard caught a key, token or password. Remove it, or turn the `guard` option off.
- Support: https://team.ruv.io/support or https://github.com/ruvnet/ruflo/issues

## Architecture

- OAuth 2.1 resource server with RFC 9728 discovery and issuer/audience/scope verification.
- Tenant identity derived only from verified token claims; no tool accepts a tenant ID.
- Firestore is canonical storage; an in-memory store is used for tests and local development.
- The default vector backend is the bounded, tenant-scoped `lexical-degraded` fallback. Set `RUFLO_AI_TEAM_VECTOR=native` only after the exact `@ruvector/core` binary passes the startup self-test; an unavailable or incompatible binding falls back explicitly and never claims semantic search.
- Stored task, memory, and evidence content is provenance-labelled and nonce-fenced as untrusted data.
- Fourteen focused tools, two prompts, a template resource, and a ChatGPT MCP Apps board.

The read-only `team_board` tool opens one compact ruOS-style workspace in ChatGPT. Its Teams, Runs, Tasks, and Evidence rail navigates inside the same card; selecting a run or pressing Refresh calls the same scoped tool through the MCP Apps bridge without asking ChatGPT to render another board. Evidence shows a private run summary; `evidence_export` provides the full bundle in chat. Its public HTML resource contains no tenant data; the tool requires `team:read`. Other tools remain data-only. Historical chat cards are immutable, so open a fresh chat after refreshing tools to see the current UI. `run_complete` requires `team:run` and refuses to complete a run until it has at least one task and every task is complete.

## Public and protected surface

Discovery is deliberately public, so MCP clients and directory reviewers can list the service before a user signs in. Anything tenant-scoped requires OAuth.

| Anonymous (no token) | Requires OAuth (`401` challenge with RFC 9728 metadata otherwise) |
|---|---|
| `initialize`, `ping`, `tools/list`, `prompts/list`, `resources/list` | every `tools/call` |
| `resources/read` of the static board UI (`ui://ruflo-ai-team/board-v4.html`) | every other `resources/read`, including `ruv://team/templates` |
| `/health`, `/.well-known/oauth-protected-resource[/mcp]`, `/privacy`, `/terms`, `/support` | |

The anonymous methods return only static definitions: tool schemas, prompt text, and the two static resource descriptors. They never return team, run, task, memory or evidence data. A bearer token that fails verification is treated as anonymous for these discovery methods only; it never downgrades a protected call.

Cross-origin (browser) reads are limited to an explicit allowlist. By default it covers `https://chatgpt.com`, `https://chat.openai.com` and `https://claude.ai`; set `ALLOWED_ORIGINS` (comma-separated origins) to replace it. The request origin is echoed back only when it is on the list, with `Vary: Origin`. No `access-control-allow-origin` header is sent for any other origin. ChatGPT and Claude call the endpoint server-to-server and the board UI makes no network requests, so the allowlist governs browser-based MCP clients only. Requests without an `Origin` header are unaffected.

Memory search reports `lexical-degraded` unless a compatible native RuVector binding passes the startup probe. The pinned `@ruvector/core` 0.1.32 package with its 0.1.30 optional native binding fails that probe in local validation with a dimension mismatch. Do not set `RUFLO_AI_TEAM_VECTOR=native` in production until a compatible binary is verified.

## Local verification

```bash
npm install
npm test
npm run smoke
```

Run locally with `RUFLO_AI_TEAM_STORE=memory npm start`. Production requires the exact OAuth resource audience `https://team.ruv.io/mcp`, Firestore IAM, and the environment variables documented in `deploy/cloud-run.yaml`. ChatGPT connections registered before the `team:*` scope ceiling was added must be created again so dynamic client registration includes those scopes.

## Compatibility

The plugin targets Ruflo / `@claude-flow/cli` v3.48 and pins its remote MCP contract at service version 0.1.x. Claude discovers skills, commands, and agents from the canonical plugin directories; the manifest intentionally contains no component arrays.

## Namespace coordination

The plugin owns the `ruflo-ai-team-*` namespace. Tenant data is never separated by a user-supplied namespace: authorization derives the tenant and every repository operation requires it. This follows the `ruflo-agentdb` ADR-0001 namespace convention while treating namespaces as organization aids, not security boundaries.

## Verification

`bash plugins/ruflo-ai-team/scripts/smoke.sh` runs structural checks and the Node test suite. The tests assert the exact tool inventory, complete annotations, OAuth challenges, scope errors, cross-tenant denial, bounded vector indexes, fenced retrieval, and evidence export.

## Architecture decisions

- [ADR-0001: Multi-tenant service boundary](docs/adrs/0001-multitenant-service-boundary.md)
- [ADR-0002: Approval and external-action boundary](docs/adrs/0002-approval-and-external-action-boundary.md)
- [ADR-0003: Tenant-scoped RuVector memory](docs/adrs/0003-tenant-scoped-ruvector-memory.md)
- [ADR-0004: Metered unit budget](docs/adrs/0004-metered-unit-budget.md)

## As a mod

AI Team also ships as a function-hook mod (ADR-445 pattern; hooks in `hooks/`, loaded with the plugin). No network, no process, no model call.

- **Guard (default on)**: refuses a team write (`memory_remember`, `task_create`, `task_update`, `run_create` on the ruflo-ai-team server) that holds a key, token or password. It only tightens: it never allows anything the session would deny, and the refusal never repeats the secret. Turn it off with the `guard` option.
- **`/ai-team-mod`**: answered locally. `/ai-team-mod status`, `/ai-team-mod scan <text>`.
- **Status file**: `.claude-flow/ai-team-mod/status.json` (`version`, `updatedMs`, counters), written at session start and whenever a call is refused; the console reads it.
- **Options** (`userConfig`): `guard` (`on` by default).

Test: `claude plugin validate plugins/ruflo-ai-team`, `claude plugin test plugins/ruflo-ai-team`, and `bash plugins/ruflo-ai-team/scripts/smoke.sh`.
