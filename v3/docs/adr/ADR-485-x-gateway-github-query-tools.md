# ADR 487: x.ruv.io GitHub query tools for Seraphina and RuvBrain

Status: Accepted

Date: 2026-10-09

Builds on: ADR-386 (swarm channels, public and private), ADR-388 (OAuth on x.ruv.io)

Numbering: ADR-484 is taken by an open change (external marketplace plugins); this is 485.

## 1. Context

`https://x.ruv.io/mcp` is the Ruflo open-swarm gateway (`plugins/ruflo-x-gateway`). It exposes federation tools over a Nostr relay and one advisory tool, `seraphina_guidance`. rUv asked for a way to query GitHub for ruvnet's tools and public repositories "as part of Seraphina and RuvBrain".

### 1.1 What those names mean in this repository (verified, not assumed)

| Name | What it is here |
|---|---|
| **Seraphina** | The swarm-queen persona. `plugins/ruflo-x-gateway/src/seraphina.mjs` is a **single meta-llm completion** (`askSeraphina`) over a snapshot of roster, claims and recent messages. It has **no tool-use loop**: she cannot call tools. The ruflo CLI exposes the same persona as `seraphina_guidance`. |
| **RuvBrain** | Three things share the name. (a) The Cloud Run service `ruvbrain` (pi.ruv.io, project `ruv-dev`): the ruvector shared-memory brain, untouched by this ADR. (b) The `ruvnet-brain` Claude Code plugin (`search_ruvnet`, `ruvnet_registry_latest`): an offline, source-grounded knowledge bundle. (c) local `.ruvnet-brain/` working directories. |

(b) is a third-party project: `github.com/stuinfla/ruvnet-brain`, author Stuart Kerr. Its `plugin.json` and README say MIT; GitHub's licence detection reports **"Other"** (`gh repo view stuinfla/ruvnet-brain --json licenseInfo`). The licence is therefore unresolved.

So the request is read as: give agents that already talk to the gateway (including those consulting Seraphina) a **live, authoritative** way to look at rUv's public GitHub, complementing the RuvBrain bundle's offline snapshot. It is **not** read as "Seraphina calls these tools": she cannot, and wiring GitHub context into her snapshot is listed under follow-ups.

## 2. Decision

Add four read-only tools to the **legacy `/mcp`** surface of the gateway:

| Tool | Does |
|---|---|
| `ruv_github_search` | Search repositories, issues, or (with a server token) code, of an allowlisted owner. |
| `ruv_github_repo` | Repository metadata, latest release (else latest tag), optional README excerpt, optional top-level file list. |
| `ruv_github_file` | One text file, 64 KiB cap, flagged when clipped. |
| `ruv_registry_latest` | Latest npm version of a package maintained by an allowlisted npm account. |

All four carry `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true` (third parties write the content). Reads stay public: no OAuth, consistent with the other read tools.

**Surfaces.** The tools are on `/mcp` only. `/chatgpt/mcp` and `/claude/mcp` stay at twelve tools: both were submitted to directories with a fixed tool list, and `tool_count` is asserted in the submission files and tests. Growing them is a directory re-review decision, not something to slip into a deploy. The annotation, secret-field, and description-wording tests already cover the new tools if that decision is later made. The proposed `ruv://github/ruvnet` resource is not added for the same reason (resource counts are asserted per profile) and because it would be an index of nothing the tools cannot already answer.

**Implementation.** `src/github-query.mjs` (a factory with an injectable `fetch`), wired in `src/server.mjs`. No new dependency.

**Configuration (all optional).** `RUFLO_GITHUB_OWNERS` (default `ruvnet`), `RUFLO_GITHUB_TOKEN`, `RUFLO_GITHUB_HOURLY_BUDGET`, `RUFLO_GITHUB_IP_HOURLY_CAP`, `RUFLO_NPM_MAINTAINERS` (default `ruvnet`). The default allowlist is `ruvnet` only; `cognitum-one` can be added by environment once someone confirms which of its repositories are public (the tools only ever serve repositories GitHub reports as public, so adding it cannot expose a private one, but the owner is not a decision for this ADR).

## 3. Threat model

| Threat | Control |
|---|---|
| **SSRF / arbitrary fetch** | No caller-supplied URL, host or header reaches `fetch`. Owner, repo, path segments, ref, query and npm name are each matched against narrow patterns; the URL is assembled from those, then re-checked to be `https` on `api.github.com` or `registry.npmjs.org`. `redirect: 'error'`: a 3xx is refused, so neither a request nor the token can be moved off the pinned host. The cost: a renamed repository (GitHub answers 301) is reported as `redirect_refused`; callers use the current name. |
| **Path traversal / smuggling** | Path segments allow `[A-Za-z0-9._@+=,~-]` only. `..`, `.`, empty segments, `%` (so `%2e%2e`, `%2f`), backslash, `:`, whitespace, control and non-ASCII characters are rejected rather than normalised. Segments are `encodeURIComponent`ed. Tested with each case. |
| **Scope widening through search** | Free text may not contain `:`; the gateway appends `user:<owner>` and `is:public` itself. GitHub ORs repeated `user:` qualifiers, so a caller-supplied one would otherwise reach other accounts. |
| **Private repository leakage** | Every repo and file call first reads repository metadata and requires `private === false`, `visibility` public and `owner.login` on the allowlist. The flag decides, not the credential, so even a token with private scope could not leak one. Search results with `private` set are dropped. |
| **Token leakage** | `RUFLO_GITHUB_TOKEN` is read once from the environment and used only as an `Authorization` header on `api.github.com`. It is not in any schema, result, error message or log line, and is not sent to the npm registry. Tests assert this with a recognisable token string. No token is configured today. |
| **Credential files in public repos** | `ruv_github_file` refuses by name: `.env*`, `*.pem`, `*.key`, `*.p12`, `id_rsa`/`id_ed25519`…, `.ssh`, `.git`, `.npmrc`, `.netrc`, `credentials*`, `secrets*`, `*.tfstate`, service-account JSON and similar, at any depth. Other file contents are not scanned. |
| **Prompt injection through README, issue or file text** | The same structural defence as relay content (`untrusted.mjs`), not detection: output is labelled `untrusted: true, source: github` and enclosed in a per-response nonce fence (`<<<UNTRUSTED_GITHUB_DATA …>>>`) that repository text cannot predict or forge. Gateway-authored guidance sits outside the fence. The content is kept verbatim. An allowlisted owner does not make the text trusted: issues and pull-request bodies are written by anyone. |
| **Rate-limit exhaustion** | The gateway's existing 60 requests/minute/IP limiter still applies to `/mcp`. On top: a per-client hourly cap (default 60), a shared per-instance upstream budget (default 45 unauthenticated), separate lock-outs per GitHub bucket (core, search) and npm so one limit cannot starve the others, and a `Retry`-aware fast fail once GitHub says no. |
| **Upstream abuse of the gateway** | 8 s timeout, 512 KiB JSON cap, 64 KiB file cap, declared `content-length` checked before reading, body read through a bounded stream. |
| **Cache poisoning** | The cache is keyed only by the validated URL and `Accept` type, stores only 2xx bodies from the two pinned origins, never stores errors or truncated bodies, and is bounded (300 entries, one hour). No caller-controlled header or value enters the key or the stored body. |

## 4. How it behaves without a token

Unauthenticated GitHub allows **60 core requests per hour and 10 searches per minute per IP**, and Cloud Run egress means every caller of the gateway shares that. Measures: a five-minute fresh cache, ETag revalidation (a `304` costs nothing against the limit), `ruv_github_repo` defaulting to the one extra call it needs (`release`; README and file list are opt-in), and the shared budget above. When the limit is reached the tool returns a structured `github_rate_limited` error with `resetAt` and the bucket, and keeps serving cached entries. Code search is unavailable without a token (GitHub answers 401) and says so. Adding `RUFLO_GITHUB_TOKEN` would lift this to authenticated limits; **creating that secret is a follow-up for rUv**, and it should be a fine-grained token with no repository permissions beyond public data.

## 5. Alternatives

- **Proxy to the local `ruvnet-brain` bundle** (`search_ruvnet`): richer ranked retrieval, but it is a third-party project with an unresolved licence (MIT in its README, "Other" on GitHub), a multi-hundred-megabyte knowledge bundle, and a stale-by-design snapshot. Not bundled or hosted here. A possible future integration if the licence is settled.
- **Expose the same tools on all three endpoints now:** rejected for the re-review reason in section 2.
- **Generic `fetch_url` with an allowlist:** rejected; the allowlist would be checked against a string the caller wrote, which is the SSRF shape this design avoids.
- **Give Seraphina the tools** (a tool-use loop in `askSeraphina`): larger change to a spend-bearing path; deferred.

## 6. Consequences

- Agents on `/mcp` get fresh repo, release, file and package facts instead of relying on training data or a stale bundle.
- Four tools added to `/mcp` (14 to 18); directory profiles unchanged at 12, so no directory re-review is triggered by this change.
- GitHub text now reaches model context through this gateway; it is fenced, but fencing is a mitigation, not a guarantee.
- Without a token the capacity is small and shared; the error is explicit rather than silent.
- Follow-ups: optional `RUFLO_GITHUB_TOKEN` secret; feed repository facts into Seraphina's snapshot (fenced); decide whether the directory profiles should carry the tools (re-review); confirm which `cognitum-one` repositories, if any, to allowlist.
