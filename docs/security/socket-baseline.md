# Socket.dev Alert Baseline — `claude-flow`

> Last revised: 2026-06-09 against `claude-flow@3.10.40`
> Source: <https://socket.dev/npm/package/claude-flow/alerts/3.10.40>
> Tracking issue: ruvnet/ruflo#2339

## TL;DR

Most of Socket's alerts on `claude-flow` describe **legitimate behaviour of a CLI agent platform** (network access, filesystem access, env-var reads, shell access, native modules, etc.) and cannot and should not be "fixed" — they are intrinsic to what the package does. This doc separates the inherent-and-expected categories from the small set that's actually actionable, so the next reviewer doesn't go down the same rabbit hole.

## What's protected today

| Layer | Mechanism | Status |
|---|---|---|
| Ruflo dev tree | `overrides` block in root `package.json` (lines 77-107) — pins `protobufjs >=8.2.0`, `uuid >=14.0.0`, plus 25+ other transitive forces | ✅ `npm audit` returns 0 vulnerabilities on the working tree |
| Ruflo dev tree | `supply-chain-audit` CI job in `.github/workflows/v3-ci.yml` (line 629) — runs `npm audit --audit-level=high`, lockfile integrity, top-level allowlist, typosquat reject, publisher trust snapshot | ✅ Gates every PR + push to main |
| Dependency review | `dependency-review` CI job (line 675) — GitHub's `dependency-review-action` checks new vulnerable deps in PRs | ⚠️ Gated on Pages-style Dependency Graph being enabled at repo level; currently `continue-on-error: true` |

## What's NOT fully fixable from inside `claude-flow`

`npm overrides` in our root `package.json` only apply when **we** are the root of the dep tree. When a consumer runs `npm install claude-flow@3.10.40`, *their* root `package.json` is the one whose overrides apply — ours are ignored. This is the same trap documented in CLAUDE.md for the `ruflo` wrapper (#2112).

A clean install of `claude-flow@3.10.40` therefore still pulls in:

| Severity | Package | CVE summary | Root cause |
|---|---|---|---|
| Critical | `protobufjs` | Arbitrary code execution via bytes-field defaults in generated `toObject` code | Transitive of `onnx-proto` → `onnxruntime-web` → `@xenova/transformers` |
| Moderate | `uuid` | Missing buffer bounds check in v3/v5/v6 when `buf` is provided | Transitive — multiple paths |
| High (cascade) | `onnx-proto`, `onnxruntime-web`, `@xenova/transformers`, `agentdb`, `agentic-flow`, `@claude-flow/memory`, `@claude-flow/neural`, `@claude-flow/plugin-gastown-bridge`, `claude-flow` itself | All downstream of the protobufjs + uuid root causes | — |

**Why this can't be fixed in this PR**: the upstream `@xenova/transformers@2.17.2` (latest) still pins `onnxruntime-web@1.14.0` which carries the bad `onnx-proto` → `protobufjs` chain. No clean upstream version exists today. Resolving consumer-side requires either:

1. A patched `@xenova/transformers` release (waiting on upstream), or migrating to `@huggingface/transformers` (the rebranded successor — needs evaluation), OR
2. Republishing the affected `@claude-flow/*` sub-packages with explicit transitive pins in *their* `dependencies` blocks (multi-PR coordinated effort), OR
3. Dropping the optional ML stack (`agentic-flow`, `@xenova/transformers`) — would lose ONNX-backed features

Tracked in #2339 as separate follow-up work.

## Inherent flags — what they mean, why we keep them

Socket fires these on every release. They describe normal CLI/agent behaviour and are not signals of a bug.

| Alert | Count | Why it's normal here |
|---|---|---|
| Network access | 68 pkgs | HTTP clients (Anthropic SDK, MCP transports, `fetch`-based tools) |
| Filesystem access | 82 pkgs | Universal — anything reading/writing files (memory backend, config, logs) |
| Environment variable access | 84 pkgs | `process.env.ANTHROPIC_API_KEY`, `CLAUDE_FLOW_*`, etc. — configuration |
| Shell access | 29 pkgs | `child_process` — used by every native-module installer, hook runners, `npx`-style spawning |
| Install scripts | 7 pkgs | Native modules: `better-sqlite3`, `hnswlib-node`, `onnxruntime-node`, `@ruvector/*` |
| Native code | 5 pkgs | Compiled binaries from the install-scripts row |
| URL strings | 108 pkgs | Every HTTP client embeds endpoint URLs as string literals |
| Debug access | 14 pkgs | The `debug` package and reflection-based helpers |
| Dynamic require | 16 pkgs | Plugin system (`mcp`, hooks, agents) + conditional optional-dep loading |
| Minified code | 10 pkgs | Some libraries ship pre-bundled (`undici`, `axios` internals, etc.) |
| Unpopular package | 29 pkgs | Long-tail transitives — popularity is not a security signal |
| Unmaintained | 64 pkgs | Long-tail transitives stale >5 years — checked against CVE/deprecation separately |
| New author | 20 pkgs | Maintainer changes — informational, not a vuln |

## False positives we've explicitly triaged

| Alert | What Socket said | Reality |
|---|---|---|
| AI-detected possible typosquat → "did you mean `z-schema`?" | Suggested `zod` is a typosquat of `z-schema` | `zod` is a 10M-weekly-download canonical TypeScript schema library, not a typosquat. Socket's AI guess is wrong. |
| AI-detected potential security risk | 15 instances in 7 packages | Heuristic-only; none corroborated by an actual CVE or code review |
| AI-detected potential code anomaly | 52 instances in 46 packages | Same — heuristic-only |
| Obfuscated code | 17 instances in 11 packages | All match the "pre-bundled / minified" pattern (`undici`, `axios` internals); none match the active-obfuscation-malware pattern |

## Operational policy

1. **Root tree must stay green.** The `supply-chain-audit` job in `v3-ci.yml` enforces `npm audit --audit-level=high` on every PR. Adding a new direct dep that introduces a HIGH/CRITICAL fails CI.
2. **Overrides are a first-line tool.** If a new transitive CVE lands, add an `overrides` entry pinning to a patched version. The current set (root `package.json` lines 77-107) is the precedent.
3. **Document gaps before merging.** When a CVE can't be cleanly overridden (e.g., the protobufjs cascade documented above), update this file with the rationale rather than silently ignoring it.
4. **Re-baseline this doc when claude-flow versions bump.** The alert counts here are tied to `3.10.40` — when the version moves, re-run the audit (`scripts/probe-nested-spawn-depth.mjs` style) and update the tables.

## When to revisit

- **Quarterly**: re-check upstream for `@xenova/transformers` / `onnxruntime-web` patched versions
- **On Socket alert change**: if Socket flags something new at *critical* severity for a direct dep, that's a real signal and warrants immediate triage
- **On new direct dep addition**: the `supply-chain-audit` job will catch this at PR time; no manual checklist needed

## Related

- ADR-097 — federation budget circuit-breaker (cost-side supply chain)
- ADR-145 — plugin supply-chain integrity (install-time)
- ADR-144 — authorization propagation (action-time, ADR-131 is content-time)
- Issue #2046 — original supply-chain hardening (the source of `supply-chain-audit` job)
- Issue #2339 — this baseline + Socket alert response
