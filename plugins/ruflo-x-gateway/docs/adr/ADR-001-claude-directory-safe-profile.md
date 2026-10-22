# ADR-001: Dedicated Claude directory-safe MCP profile

- Status: Accepted
- Date: 2026-09-28

## Context

The compatibility endpoint at `/mcp` has fourteen tools. Eight legacy schemas accept an optional `adminToken`, and two membership-administration tools can mint a bearer invite or grant relay membership. Those capabilities are needed by trusted service callers but are not appropriate for a public software directory. Anthropic requires accurate tool descriptions and annotations, secure OAuth for authenticated remote servers, graceful errors, support and privacy documentation, and representative review examples.

The existing `/chatgpt/mcp` endpoint already removes secret-bearing input fields and excludes the two membership-administration tools. Creating a second independent tool registry for Claude would invite security and annotation drift.

## Decision

Expose `/claude/mcp` as a dedicated Streamable HTTP endpoint backed by the same directory-safe profile as `/chatgpt/mcp`.

The profile:

- exposes twelve user-facing tools and five `ruv://` resources;
- excludes `federation_invite_mint` and `federation_admit`;
- never accepts credentials in a tool argument;
- allows anonymous read operations;
- challenges anonymous write attempts with HTTP 401 and an RFC 6750 `WWW-Authenticate` header;
- publishes RFC 9728 metadata at `/.well-known/oauth-protected-resource/claude/mcp`;
- requires a verified, audience-bound OAuth token with `swarm:publish` for state-changing tools;
- declares a title plus explicit boolean `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` annotations on every tool; and
- preserves the nonce-fenced, provenance-labelled envelope around third-party relay content.

The full `/mcp` surface remains unchanged for compatibility. Claude-specific listing copy and reviewer instructions live in `claude-directory-submission.json` and `claude-directory-test-cases.md`. Reviewer credentials are transmitted privately through Anthropic's portal and are never committed.

## Consequences

Claude users get the same secure remote connector on web, mobile, Desktop, Cowork, and Claude Code. Directory review cannot reach membership administration or model-visible secrets. A contract test requires the Claude and ChatGPT safe profiles to remain identical, preventing fixes from landing on only one public surface.

The extra route and discovery document must be deployed before directory submission. A release operator must validate production OAuth with a real reviewer account without recording tokens in logs or fixtures.

## Alternatives rejected

- Submit `/mcp`: rejected because its operator-only schemas expose secret-bearing arguments and membership administration.
- Fork the complete tool registry for Claude: rejected because duplicate definitions would drift.
- Make every operation require OAuth: rejected because public reads are useful, already supported, and do not access user-private account data.
- Allow private-channel publication: rejected because the gateway does not possess client encryption keys and must not become a key custodian.
