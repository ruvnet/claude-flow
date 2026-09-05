# Give Your Coding Agent a Map of Ruflo

Most agent frameworks make you learn the framework before the agent can use
it well. You memorize tool names, remember which plugin owns what, and discover
too late that “installed” did not mean “configured” or “authorized.”

Ruflo v3.32.29 changes that. Its new MCP Capability Brain lets an agent inspect
the running Ruflo system, see every registered capability, understand the
authority and risk boundary, and choose a safe implementation workflow for the
task in front of it.

In a fully equipped local process, the old guidance catalog recognized only 61
of 353 MCP tools. The live brain now classifies all 353 observed tools exactly
once and also inventories CLI commands, agents, skills, packages, and plugins.

## The simplest way to use it

Tell your Codex or Claude Code agent:

> Before implementing this task, call Ruflo `guidance_brain` in `recommend`
> mode. Use only registered capabilities, verify configuration/health/authority
> separately, and follow the returned implementation loop.

The underlying MCP call is:

```json
{
  "name": "guidance_brain",
  "arguments": {
    "mode": "recommend",
    "task": "Add an authenticated API endpoint, test it, benchmark it, and prepare a release"
  }
}
```

The response gives the agent:

- relevant Ruflo capability domains;
- tools that are actually registered;
- agent and skill suggestions;
- authority and risk metadata;
- checks to perform before use;
- the full implementation loop and publication guardrails.

## Explore what Ruflo can do

Get a concise system view:

```json
{"name":"guidance_brain","arguments":{"mode":"overview"}}
```

Inspect a capability domain:

```json
{
  "name": "guidance_brain",
  "arguments": {
    "mode": "capabilities",
    "domain": "metaharness-flywheel"
  }
}
```

Audit tool coverage:

```json
{"name":"guidance_brain","arguments":{"mode":"coverage"}}
```

Discover installed agents, skills, plugins, packages, and all top-level CLI
commands:

```json
{"name":"guidance_brain","arguments":{"mode":"ecosystem"}}
```

Get the implementation contract by itself:

```json
{"name":"guidance_brain","arguments":{"mode":"implementation-loop"}}
```

## What this enables

### 1. Self-configuring agent workflows

An agent no longer needs a hard-coded list of Ruflo features. It can discover
the current MCP process and adapt when optional tools are present or absent.

### 2. Safer autonomous development

The brain routes work through:

```text
recall
  → inspect
  → route
  → plan
  → execute
  → test
  → validate
  → benchmark
  → optimize
  → receipt
  → handoff
  → authorized publish
```

Ruflo coordinates and records; the coding agent executes. Learning,
MetaHarness, Darwin, Flywheel, consensus, claims, and benchmarks can propose or
evaluate improvements, but cannot authorize their own promotion.

### 3. Honest optional integrations

The brain does not collapse capability state into one green badge:

- `registered`: present in this MCP process;
- `configured`: required settings/providers exist;
- `reachable`: dependencies answer a safe probe;
- `healthy`: dependencies meet their health contract;
- `authorized`: this subject may perform this exact action.

Only the first fact comes from the registry. The others stay `unknown` until
their dedicated checks run.

### 4. Better concurrent agent teams

Generated Codex guidance now combines the brain with isolated worktrees,
exclusive work claims, narrow capability envelopes, source-bound evidence, and
an integration owner. In-memory harness references let adapter authors test
fencing, inbox, and receipt semantics without pretending those references are
distributed release infrastructure.

### 5. Policy-governed federation foundations

Upgraded federation peers advertise JCS/Ed25519 signatures by default and
negotiate them when the join includes the peer's signature-verified manifest.
Endpoint-only joins remain untrusted. A legacy-only peer remains compatible
for heartbeat and status broadcasts, but consequential traffic fails closed
until that peer is upgraded and its signed manifest is supplied.

The Security SDK also supplies strict product-action envelopes for the
Cognitum dashboard, Meta-LLM, Comms, Cog Studio, RuView, and validated agent
learning.

## Install

```bash
npm install --global ruflo@3.32.29
ruflo doctor
```

Or:

```bash
npx ruflo@3.32.29 --help
```

## Compatibility

The Capability Brain is additive. Existing guidance tools remain available,
old projects keep their current policy mode, and optional dependencies still
degrade explicitly when absent. The old hand-written guidance catalog is
retained only as a labeled compatibility view; stale aliases are not returned
as live recommendations.

## Boundaries that matter

This release provides an opt-in foundation, not a claim that distributed
federation or autonomous release is production-ready. Production still needs
deployment-specific identity links, persistent fenced leases, durable
inbox/outbox storage, signed receipt ledgers, and release-decision composition.

A signature proves key control. A work claim coordinates ownership. A score or
benchmark supplies evidence. A policy decision grants authority. Ruflo keeps
those concepts separate.

## Further reading

- [ADR-325 — Claim Federation](https://github.com/ruvnet/ruflo/blob/main/v3/docs/adr/ADR-325-claim-federation-zero-trust-capability-plane.md)
- [ADR-326 — Cognitum Product Plane](https://github.com/ruvnet/ruflo/blob/main/v3/docs/adr/ADR-326-cognitum-product-plane-claim-federation.md)
- [ADR-327 — Concurrent Development Harness](https://github.com/ruvnet/ruflo/blob/main/v3/docs/adr/ADR-327-federated-concurrent-development-harness.md)
- [ADR-328 — Assisted Agent Learning](https://github.com/ruvnet/ruflo/blob/main/v3/docs/adr/ADR-328-cognitum-assisted-agent-learning.md)
- [ADR-329 — Capability Brain](https://github.com/ruvnet/ruflo/blob/main/v3/docs/adr/ADR-329-ruflo-capability-brain-mcp-guidance.md)
