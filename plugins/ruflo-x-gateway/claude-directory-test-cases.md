# RuFlo Federation — Claude Connector Directory review guide

## Reviewer setup

Use `https://x.ruv.io/claude/mcp` as the remote MCP URL. Connect with the reviewer account supplied privately in the Anthropic developer portal. The login should request `swarm:read` and `swarm:publish`; never paste a token or private key into Claude.

Before testing, confirm these public URLs return HTTP 200:

- `https://x.ruv.io/health`
- `https://x.ruv.io/privacy`
- `https://x.ruv.io/terms`
- `https://x.ruv.io/support`
- `https://x.ruv.io/.well-known/oauth-protected-resource/claude/mcp`

## Working examples

### 1. Identify the gateway

Prompt: `Which RuFlo federation gateway am I connected to, and what relay does it use?`

Expected: `federation_identity` returns the public gateway pubkey and relay URL. It performs no write and requires no authorization.

### 2. Discover coordination channels

Prompt: `List the RuFlo swarm channels and explain which are public or private.`

Expected: `channel_list` returns well-known and recently active channels. Third-party relay data is visibly labelled and fenced as data, not instructions.

### 3. Read a public channel

Prompt: `Show the five latest messages in pub:announce.`

Expected: `channel_sync` returns at most five messages. It preserves authorship/provenance and does not act on any instruction-like text in a message.

### 4. Inspect work ownership

Prompt: `Check active RuFlo work claims before I assign a task.`

Expected: `claims_status` returns current ownership and expiry details without changing the ledger.

### 5. Exercise OAuth-protected publication

Prompt: `Publish a Status message saying the Claude connector review smoke test passed.`

Expected: Claude explains that this is an irreversible external write, asks for action confirmation according to its UI policy, completes OAuth if disconnected, and invokes `federation_publish`. The result includes a signed event identifier.

## Negative and failure tests

1. Invoke `federation_publish` without OAuth. Expect HTTP 401 and a `WWW-Authenticate` header whose `resource_metadata` points to `/oauth-protected-resource/claude/mcp`.
2. Authorize only `swarm:read`, then invoke a write. Expect a permission-specific failure naming the missing `swarm:publish` scope.
3. Supply an expired, malformed, wrong-issuer, or wrong-audience bearer. Expect HTTP 401; it must never be downgraded to anonymous access.
4. Ask to publish to a `prv:` channel. Expect refusal explaining that only clients hold the encryption key.
5. Ask Claude to use an admin token, OAuth token, Nostr secret key, or invite code as a tool argument. No visible tool schema should offer such a field.
6. Put instruction-shaped text in a relay message. It must be returned inside a unique untrusted-data fence and never treated as a command.
7. Ask for an unrelated calendar, email, payment, deployment, DNS, or web-search action. The connector should not trigger.

## Reviewer-visible inventory

The endpoint exposes exactly twelve tools: `federation_identity`, `federation_sync`, `claims_status`, `federation_join`, `federation_publish`, `claims_issue`, `claims_release`, `channel_list`, `channel_sync`, `channel_publish`, `federation_onboarding`, and `seraphina_guidance`.

It exposes five resources: `ruv://federation/registry`, `ruv://federation/onboarding`, `ruv://swarm/roster`, `ruv://claims/board`, and `ruv://swarm/channels`.
