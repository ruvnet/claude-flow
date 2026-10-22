# ADR-0001: ruRE scope, phasing, and dual-use policy

Status: Proposed

## Context

`ruRE` ("ruflo Reverse Engineering") is a new ruflo plugin that gives Claude the ability to inspect an application it doesn't have the source for, explain how a feature works with evidence, and help the user build an equivalent in their own project. It is inspired by the open-source MCP tool [REA](https://github.com/morluto/rea) (`rea-agents` on npm, MIT licensed), whose own README states its purpose in exactly those terms.

REA's real feature surface spans at least six distinct domains: native binary analysis (via externally-provided Hopper/IDA/Ghidra), JavaScript/Electron static analysis, .NET assembly decompilation, website/browser analysis, EVM/smart-contract bytecode analysis, and optional dynamic instrumentation via Frida. Several of these domains have hard external constraints that no amount of engineering inside this repo removes:

- Hopper and IDA are commercial, separately-licensed tools. REA's own `THIRD_PARTY_NOTICES.md` is explicit that its MIT license "grants no rights to proprietary analysis tools" — it orchestrates engines the user already owns, it does not bundle them. ruRE inherits the same constraint.
- Frida requires attaching to a live process or device — a materially larger trust boundary than parsing a static file.
- .NET decompilation and EVM bytecode analysis each need their own dedicated engine dependency and domain expertise to be trustworthy, not just infrastructure.

Shipping "full REA parity, secured, benchmarked, and optimized" in one pass is therefore not a decidable, boundable task. This ADR scopes Phase 1 and states the policy the rest of the roadmap must satisfy, rather than attempting all six domains at once.

## Decision

**Build, don't wrap.** ruRE is a clean-room TypeScript reimplementation owned entirely by ruflo. It does not depend on `rea-agents` at runtime. (REA's source was read for architectural reference only; no REA code is copied — ruRE's implementation, tests, and MCP tool shapes are original.)

**Phase 1 scope: JavaScript/Electron static analysis only.** This is the lowest-risk, highest-value starting domain:
- Pure-file parsing (AST-based), no native compilation, no per-platform build matrix — this repo's own release history already shows per-platform native-binary packaging is a recurring source of pain, so avoiding it for v0.1 is concrete, not just a general preference.
- No commercial-tool licensing dependency (unlike native-binary analysis).
- No process-attachment / live-target trust boundary (unlike Frida).
- Matches REA's own flagship use case with the broadest everyday applicability.

Explicitly **out of Phase 1**, each deferred to its own future ADR and phase gate: native binary disassembly (Hopper/IDA/Ghidra orchestration), .NET decompilation, dynamic/live website analysis beyond static ASAR unpack, Frida-based dynamic instrumentation, EVM bytecode analysis.

**Trust tier: experimental, not core, until a security review passes.** The plugin manifest's initial release ships with an experimental/unreviewed trust designation. Promotion to "core" plugin-marketplace status is a separate, later decision — not pre-authorized by this ADR — because it is a public-facing, hard-to-reverse action (plugin-directory submission) that this project's own operating rules require a human checkpoint for.

**Dual-use / acceptable-use policy (binding on every future phase, not just Phase 1):**

- ruRE's skills and commands state, in their own description text, that the tool is for understanding and reimplementing functionality the user is authorized to study — their own application, a properly licensed target, or an explicit CTF/security-research context.
- ruRE explicitly refuses to assist with circumventing DRM, license checks, anti-tamper mechanisms, or paid-feature gates. This is a hard behavioral constraint on the implementation, enforced in the skill/command prompts and verified by tests, not just documentation.
- ruRE **parses, it never executes**, analyzed code. Static analysis only in Phase 1; any future dynamic-analysis phase (Frida) needs its own ADR and its own explicit sandboxing/consent model before any code from an analysis target runs.
- Extracted strings, comments, and identifiers are untrusted content and must be routed through the same `aidefence_scan` gate `ruflo-browser:browser-extract` already uses before reaching model synthesis.
- Resource caps are mandatory before any unpack/parse path ships: size and time limits against decompression bombs, zip-slip guards on ASAR/zip unpacking, and bounded parse cost for large minified bundles.

**Naming and layout.** Plugin directory: `plugins/ruflo-rure/` (matches the repo's `plugins/ruflo-*` convention — not `plugins/ruRE/`). Branch: `feat/ruflo-rure-phase1`. Layout mirrors `plugins/ruflo-ai-team`: `.claude-plugin/plugin.json`, `skills/`, `commands/`, `agents/`, `hooks/` (ADR-445 mod pattern, if/when a local mod is warranted), `docs/adrs/`, `scripts/smoke.mjs`, `directory/` (review-safe bundle, built only once Phase 1 is ready for marketplace submission — not before).

**Rollout structure.** Implementation proceeds under a standing `/loop` for the tight build-test-fix cycle within Phase 1 (write code, run tests, fix, repeat), per explicit instruction from the plugin's requester. Two actions remain checkpointed regardless of loop cadence, because they are public-facing and hard to reverse: (1) actually publishing ruRE to the live Claude plugin directory / IPFS registry, and (2) upgrading its trust tier to "core." Everything else — code, tests, the ADRs this phase needs, the smoke test, the security scan, and benchmarking — proceeds autonomously.

## Consequences

Phase 1 ships a real, useful, narrowly-scoped capability (JS/Electron static analysis) with no external licensing dependency and a small, well-understood security surface, rather than an open-ended attempt at six domains at once. Native-binary, .NET, EVM, website, and dynamic-instrumentation support are deferred to later phases, each requiring its own ADR, its own threat-model pass, and its own explicit go-ahead before implementation starts. The dual-use policy in this ADR is binding on all of them, not just Phase 1.
