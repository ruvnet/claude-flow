# ADR 399: Repository Local Git Execution Boundary

Status: Proposed

Date: 2026 09 20

Issue: #3380

## Context

RuFlo executes Git as part of workspace identity, worktree coordination, source state capture, diff classification, claims, status reporting, and development automation. Argument array execution prevents shell interpolation by RuFlo, but it does not neutralize behavior selected by repository local Git configuration.

Manifold Security disclosed the GitSpawn vulnerability class on 2026 09 01. A repository that arrives with its existing `.git/config` can set `core.fsmonitor` to an executable command. Git may execute that command during an ordinary index refresh caused by commands such as `git status` or `git diff`. The command runs as the host user and outside model tool approval or sandbox boundaries.

A normal network clone does not carry a source repository local `.git/config`. The relevant threat is a copied working repository, archive preserving `.git`, sync directory, backup restore, shared drive, removable media, or any equivalent path that preserves repository local configuration.

Direct review of RuFlo main at `a4f219935ff4035421bc01157a5a1abc74529ad2` found multiple production `git` subprocesses and no command line `core.fsmonitor=false` override.

## Decision

Create one reusable Git subprocess policy in `@claude-flow/security`.

Every migrated RuFlo controlled Git call prepends the command line configuration override:

`git -c core.fsmonitor=false -C <repository> ...`

Command line configuration has higher precedence than repository local configuration, so the repository cannot reenable `core.fsmonitor` for that invocation.

The primitive validates repository and argument strings for NUL bytes, uses `execFileSync` without a shell, bounds buffer size and timeout, hides spawned windows on Windows, and centralizes future Git hardening.

The first migration covers Codex worktree coordination and CLI workspace identity. Additional callers remain explicitly in scope before production promotion, including source state capture and diff classification.

## Non claims

This ADR does not claim that `core.fsmonitor` is the only command bearing Git configuration surface. The public GitSpawn disclosure describes another configuration path whose key was intentionally withheld. The new wrapper is therefore a policy concentration point, not proof that arbitrary repository local Git configuration is harmless.

This ADR does not make copied repositories trusted. Workspace trust, provenance, RVM capability enforcement, sandboxing, and credential isolation remain separate requirements.

This ADR does not modify Git itself and does not treat a clean Git status as evidence that repository configuration is safe.

## Security invariants

1. RuFlo must not execute a repository selected filesystem monitor while performing its own Git subprocess operations.
2. The safety override must be in the Git process argument vector, not global user configuration, because repository local configuration can override global configuration.
3. Model text and repository files cannot remove the command line override.
4. Git subprocesses still carry no execution authority beyond the host process identity and must remain inside the existing RVM and operating system boundaries.
5. A failure to apply the policy must fail the caller rather than silently retrying with raw Git.
6. Additional command bearing configuration surfaces discovered later must be added to the central policy and regression corpus.

## Falsification

The security test creates a repository with a repository local `core.fsmonitor` payload that writes a sentinel outside the repository. The raw Git control must execute the sentinel on a supported integration platform. The safe Git runner and migrated worktree coordinator must not execute it.

The candidate is rejected if the payload executes through any migrated path, if ordinary clean and dirty repository semantics change unexpectedly, or if the mitigation depends only on user global Git configuration.

Windows behavior must be reported separately if the functional payload fixture cannot execute there. Structural argument tests remain mandatory on every supported platform.

## Performance

The relevant performance metric is added subprocess argument and wrapper overhead, not Git index performance itself. Benchmark at least 10,000 safe argument constructions and a realistic clean repository status workload. Record operating system, Git version, Node version, repository size, baseline and candidate latency, p50, p95, variance, failures, and reproduction commands.

No performance improvement is required. Promotion should tolerate a small regression when the absolute cost is operationally negligible. A regression above 5 percent in median Git subprocess wall time on a representative repository requires review.

## Cross stack mapping

RuFlo uses the policy for repository introspection, worktrees, diff classification, and claims.

MetaHarness independently reproduces the malicious repository fixture and checks that evaluation workers cannot trigger repository selected host commands.

RVM remains the privileged effect boundary and should eventually bind repository trust state to execution capability.

RVF can carry repository source and trust evidence without turning it into authority.

RVForge should consume only repositories whose build and packaging subprocesses pass the same trust boundary.

Dream Machine and Autogenous inherit the policy for automated repository exploration and improvement loops.

Cognitum benefits when customer supplied code can be inspected without allowing repository local Git configuration to bypass the agent permission plane.

## Migration and rollback

The change is additive and contains no durable schema migration. Callers migrate from direct `execFileSync('git', ...)` use to the safe Git primitive. Rollback reverts the wrapper imports and helper without changing repositories, memory, events, federation state, or RVM state.

## Governance

No autonomous merge or deployment. Exact head CI, security workflows, dependency audit, CodeQL, independent MetaHarness reproduction, and human review are required. Remaining direct production Git callers must be enumerated before the issue can be closed.