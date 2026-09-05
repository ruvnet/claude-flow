# ADR-128 — Init Bundle Reduce and Refactor: Skill Source-of-Truth, Plugin Deduplication Policy, and Optional Agent Categories

**Status**: Proposed (2026-05-21)
**Date**: 2026-05-21
**Authors**: claude (drafted with rUv)
**Related**: ADR-102 (supply-chain CI guards), ADR-103 (witness temporal history), ADR-127 (GitHub stack modernization), ruflo issues #2078, #2079, #2086
**Supersedes**: nothing — generalizes the init-bundle discipline established by ADR-127 to the full `.claude/` surface, and closes the skill source-of-truth gap that ADR-127's research surfaced

## Context

ADR-127 audited the `.github`-related subtree of the init bundle — 19 command files, 13 agents, 5 skills, 2 helpers — and landed a four-phase modernization. It was explicit about its scope boundary: *"ADR-127 covers one of 19+ subtrees."* During that research a second-order gap appeared: skills are paradoxically absent from the cli npm artifact even though `DEFAULT_INIT_OPTIONS` defaults them to `true`.

This ADR generalizes ADR-127's discipline to the full init bundle and fixes that skill source-of-truth gap as Phase 1.

### Current state of the bundle

`v3/@claude-flow/cli/.claude/` contains three directories — `agents/`, `commands/`, `helpers/` — plus `settings.json`. The `package.json` `"files"` array (`v3/@claude-flow/cli/package.json`) includes `.claude`, so everything in those directories ships in every published tarball.

As of commit `b4e177667`:

| Content | Files | Notes |
|---|---:|---|
| Init agents (23 subdirs) | 98 | `agents.all: true` default — all ship |
| Init commands (18 subdirs + 3 loose) | 176 | 88 reachable via `COMMANDS_MAP`; 87 orphaned |
| Init skills | **0** | No `skills/` dir in the package |

The 35 plugins in `plugins/*/` collectively ship 106 skills, 40 commands, and 45 agents. Nine agent files appear in both the init template and a plugin, all nine diverged (410–1,049 diff lines each).

### Gap 1: Skill source-of-truth is undefined

`copySkills()` (`executor.ts:889–935`) calls `findSourceDir('skills', ...)` (`executor.ts:1959–2021`). The function's primary path checks `packageRoot/.claude/skills` (line 1974); this directory does not exist, so the guard fails. The function then walks 10 directory levels up from `__dirname` looking for any ancestor that contains `.claude/skills/`. On the maintainer's machine this walk eventually reaches `~/.claude/skills/` (38 dogfood skills). On any other machine, or in CI, it finds nothing and `copySkills()` emits a silent error.

`DEFAULT_INIT_OPTIONS.skills.core`, `.agentdb`, `.github`, and `.v3` are all `true`. On a fresh install, all four default to copying skills — none of which copy. The `copySkills()` error path pushes to `result.errors` but `executeInit()` wraps the call in a try/catch that continues on error without surfacing the failure to the CLI output. A user who runs `ruflo init` on a clean machine gets no skills installed and no warning.

The 29 skill names in `SKILLS_MAP` (e.g. `swarm-orchestration`, `agentdb-advanced`, `github-code-review`) are references to directories that only exist in the dogfood `.claude/skills/`. They are not bundled in the npm package.

### Gap 2: Nine agents are forked and diverged

| Agent file | Init path | Plugin path | Divergence |
|---|---|---|---|
| `coder.md` | `agents/core/` | `ruflo-core` | 460 diff lines |
| `researcher.md` | `agents/core/` | `ruflo-core` | 411 diff lines |
| `reviewer.md` | `agents/core/` | `ruflo-core` | 527 diff lines |
| `tester.md` | `agents/core/` | `ruflo-testgen` | 527 diff lines |
| `memory-specialist.md` | `agents/v3/` | `ruflo-rag-memory` | 1,049 diff lines |
| `security-auditor.md` | `agents/v3/` | `ruflo-security-audit` | 785 diff lines |
| `sparc-orchestrator.md` | `agents/v3/` | `ruflo-sparc` | 261 diff lines |
| `goal-planner.md` | `agents/goal/` | `ruflo-goals` | 68 diff lines |
| `adr-architect.md` | `agents/v3/` | `ruflo-adr` | 191 diff lines |

There is no deduplication policy. A user who runs `ruflo init` and then `ruflo plugins install ruflo-core` ends up with two competing definitions of `coder.md` in their workspace. No collision warning is issued; the last-writer wins silently.

### Gap 3: Domain-specific agents and commands ship universally

Twelve agents in three subdirectories belong to verticals most projects never touch: `agents/flow-nexus/` (9 files), `agents/payments/` (1 file), `agents/data/` (2 files). All ship because `agents.all: true` is the default in `DEFAULT_INIT_OPTIONS` (`src/init/types.ts`).

`commands/flow-nexus/` (9 files) is in the template but has no key in `CommandsConfig` or `COMMANDS_MAP` — it is an orphaned directory, reachable only by `commands.all: true`. The broader orphan count is 87 of 176 command files: `agents/`, `coordination/`, `flow-nexus/`, `hive-mind/`, `memory/`, `pair/`, `stream-chain/`, `swarm/`, `training/`, `truth/`, `verify/`, `workflows/` all exist in the template with no corresponding `COMMANDS_MAP` entry.

### Gap 4: No CI gate covers the non-GitHub init surface

ADR-127 added `smoke-github-actions-pins.mjs` and `smoke-github-safe-injection.mjs`, covering the 13-agent, 5-skill, 19-command GitHub subtree. The remaining ~250 init files have no equivalent CI guard. The static-scan-across-N-trees pattern (`scripts/smoke-deprecated-actions.mjs`) is already proven and generalizes directly.

### Prior-art constraints

ADR-127 established one explicit init-template constraint that applies here: *"anything added to `ruflo init` output must work in an empty directory with only `node` and `gh` available."* ADR-127's Phase 4 also established the opt-in pattern for init defaults: `settings-generator.ts` lines 55–60 and `#2079` showed that init defaults should be opt-out-friendly. ADR-127's plug-and-play discipline (each phase ships a runnable artifact independently) applies here too.

## Decision

Land a five-phase reduction and refactor of the init bundle, following ADR-127's deliver-a-runnable-artifact-per-phase discipline.

### Policy: what belongs in init vs what belongs in plugins

**Init bundle owns:**
- Core swarm substrate agents: `agents/core/`, `agents/consensus/`, `agents/swarm/` (15 files total).
- Hooks surface agents: `agents/sparc/`, `agents/testing/` (6 files total).
- Core commands: the three loose `claude-flow-*.md` files and the 8 `CommandsConfig` categories already covered — `analysis`, `automation`, `github`, `hooks`, `monitoring`, `optimization`, `sparc` (85 files).
- Helper scripts: `helpers/` (no change).
- Settings and hooks: no change.
- Skills: the 29 named in `SKILLS_MAP.core`, `.agentdb`, `.github`, `.v3` — bundled inside the package (Phase 1).

**Plugins own:**
- Any agent, command, or skill that is domain-specific to a vertical: payments, flow-nexus, IoT, market data, healthcare, finance, legal, neural trading.
- Any agent that is the canonical definition for a plugin's own subject matter: `ruflo-core` owns `coder.md`, `ruflo-rag-memory` owns `memory-specialist.md`, etc.
- Any skill that is primarily useful to consumers of that plugin's MCP tools.

**Rule for forks**: when the same filename exists in both the init template and a plugin, the plugin's version is canonical. The init template's copy is deleted. No exceptions — split ownership is the root cause of 9 current divergences and will produce more.

**Rule for orphaned command dirs**: every subdirectory under `v3/@claude-flow/cli/.claude/commands/` must have a corresponding key in `COMMANDS_MAP` and `CommandsConfig`. Directories without a key are either deleted or promoted to a named key. Dead directories (no key, not wanted) are deleted.

### Deduplication algorithm (net-new — needs separate consideration for plugin installer)

When `ruflo plugins install <plugin>` runs and the plugin ships a file at `.claude/agents/X.md`:

1. If `~/.claude/agents/X.md` does not exist: write the plugin's version.
2. If `~/.claude/agents/X.md` exists and is byte-identical: no-op.
3. If `~/.claude/agents/X.md` exists and differs: **plugin wins**, backup the existing file to `~/.claude/agents/X.md.bak.{timestamp}`, write the plugin's version, log the conflict.

This algorithm is **net-new** — no plugin installer logic exists today. It is documented here as the target behavior but implemented as a separate work item after this ADR's phases ship. Until it ships, Phase 2's deletion of forked agents from the init template is the deduplication mechanism: users cannot get two competing versions if only one source exists.

### Phase 1 — Bundle skills inside the npm package

**Problem**: `findSourceDir('skills')` (`executor.ts:1974`) fails on every non-maintainer machine because `v3/@claude-flow/cli/.claude/skills/` does not exist.

**Fix**: create `v3/@claude-flow/cli/.claude/skills/` and populate it with the 29 skill directories named in `SKILLS_MAP`. The guard at `executor.ts:1974` already does the right thing for the `agents/` and `commands/` types — it checks `packageRoot/.claude/{type}` and returns early if found. Once `skills/` exists in the package, the same guard returns the correct path for skills with zero code changes.

The 29 skills to bundle come from `SKILLS_MAP` (`executor.ts:35–80`):
- `core` (8): `swarm-orchestration`, `swarm-advanced`, `sparc-methodology`, `hooks-automation`, `pair-programming`, `verification-quality`, `stream-chain`, `skill-builder`
- `agentdb` (7): `agentdb-advanced`, `agentdb-learning`, `agentdb-memory-patterns`, `agentdb-optimization`, `agentdb-vector-search`, `reasoningbank-agentdb`, `reasoningbank-intelligence`
- `github` (5): `github-code-review`, `github-multi-repo`, `github-project-management`, `github-release-management`, `github-workflow-automation`
- `v3` (9): `v3-cli-modernization`, `v3-core-implementation`, `v3-ddd-architecture`, `v3-integration-deep`, `v3-mcp-optimization`, `v3-memory-unification`, `v3-performance-optimization`, `v3-security-overhaul`, `v3-swarm-coordination`

The existing dogfood skills at `.claude/skills/` are the source. Where a skill name exists in both the dogfood layer and a plugin, the dogfood version is used for Phase 1. Phase 2 cleans up the plugin forks.

**Acceptance**: `npx @claude-flow/cli@latest init` on a machine with an empty `~/.claude/` installs all `SKILLS_MAP.core` skills without errors. `find v3/@claude-flow/cli/.claude/skills -name 'SKILL.md' | wc -l` >= 29 in CI.

This phase is self-contained. It does not change any init API, no command or agent is affected, and no user-facing behavior changes except skills now actually install.

### Phase 2 — Remove 9 forked agents; plugins become canonical

**Delete from `v3/@claude-flow/cli/.claude/agents/`**:
- `core/coder.md`, `core/researcher.md`, `core/reviewer.md` (forked from `ruflo-core`)
- `core/tester.md` (forked from `ruflo-testgen`)
- `v3/memory-specialist.md` (forked from `ruflo-rag-memory`)
- `v3/security-auditor.md` (forked from `ruflo-security-audit`)
- `v3/sparc-orchestrator.md` (forked from `ruflo-sparc`)
- `goal/goal-planner.md` (forked from `ruflo-goals`)
- `v3/adr-architect.md` (forked from `ruflo-adr`)

Remove the deleted basenames from the relevant `AGENTS_MAP` arrays in `executor.ts`. If a key's array becomes empty (e.g. `AGENTS_MAP.goal`), remove the key.

No behavioral change for users who have the relevant plugins installed; they already have the plugin's version. Users who do not have the plugins lose those 9 agents — they are available via `ruflo plugins install ruflo-core ruflo-rag-memory ruflo-security-audit ruflo-sparc ruflo-goals ruflo-adr ruflo-testgen`.

**Acceptance**: `comm -12 <(find v3/@claude-flow/cli/.claude/agents -name '*.md' -exec basename {} \;) <(find plugins -name '*.md' -path '*/agents/*' -exec basename {} \;)` returns empty. `smoke-init-bundle-dedup.mjs` (Phase 5 script, run locally) passes assertion 1.

### Phase 3 — Move domain-specific agents and commands to plugins; promote or delete orphaned command dirs

**Agents to remove** (move to plugins if not already there):
- `agents/flow-nexus/` (9 files) — owned by the flow-nexus integration surface, not a plugin today but should be created before or with this phase.
- `agents/payments/` (1 file) — same.
- `agents/data/` (2 files) — generic enough to either delete or move to `ruflo-core`.

Remove `flowNexus`, `payments`, `data` entries from `AGENTS_MAP`.

**Command dirs to address** (87 orphaned files):
- `commands/flow-nexus/` (9 files) — delete from init template; belongs to the flow-nexus plugin.
- `commands/hive-mind/` (12 files) — add `hiveMind` key to `COMMANDS_MAP` and `CommandsConfig`, default `true`. Hive-mind is a core swarm substrate, not domain-specific.
- `commands/swarm/` (17 files) — add `swarm` key, default `true`. Same rationale.
- `commands/memory/` (5 files) — add `memory` key, default `true`. Memory is substrate.
- `commands/agents/` (13 files) — add `agents` key, default `true`. Agent management is substrate.
- `commands/coordination/` (7 files) — add `coordination` key, default `true`.
- `commands/workflows/` (6 files) — add `workflows` key, default `true`.
- `commands/pair/` (7 files) — add `pair` key, default `false` (opt-in; pair programming is not universal).
- `commands/training/` (6 files) — add `training` key, default `false` (opt-in).
- `commands/stream-chain/` (2 files) — add `streamChain` key, default `false`.
- `commands/truth/` (1 file) — add `truth` key, default `false`.
- `commands/verify/` (2 files) — add `verify` key, default `false`.

**Acceptance**: `find v3/@claude-flow/cli/.claude/commands -mindepth 1 -maxdepth 1 -type d` lists only directories that have a corresponding `COMMANDS_MAP` key. `agents.all: true` produces <= 85 agents. `commands.all: true` produces no `flow-nexus` commands from the init template.

### Phase 4 — Flip `agents.all` default to `false`; right-size the default install

**Change `DEFAULT_INIT_OPTIONS`** in `src/init/types.ts`:
- `agents.all: false` (was `true`).
- Ensure `agents.core`, `agents.consensus`, `agents.swarm`, `agents.sparc`, `agents.testing` remain `true`.
- Change `agents.github`, `agents.v3`, `agents.optimization`, `agents.hiveMind` to `false` (opt-in via their named flags).

This mirrors the precedent from `#2079` — init defaults should be opt-in for non-substrate categories. The `--agents=github` and `--agents=all` flags provide the upgrade path.

**Expected outcome**: a default `ruflo init` installs ~24 agents (`core:5 + consensus:7 + swarm:3 + sparc:4 + testing:2 + browser:0 = ~21`; browser dir is currently empty) rather than 98. The full 85-agent set remains accessible via `ruflo init --agents=all`.

The `--all` flag and the `agents.all` key are NOT removed — `ruflo init --all` remains a supported pattern.

**Acceptance**: `ruflo init` (no flags) installs <= 30 agents. `ruflo init --agents=all` installs all agents in the template. Existing users who relied on `agents.all: true` are informed via a deprecation notice in the `ruflo migrate` command output.

### Phase 5 — Ship `smoke-init-bundle-dedup.mjs`; wire into CI

**`scripts/smoke-init-bundle-dedup.mjs`** (new):

Follows the `smoke-deprecated-actions.mjs` pattern (static `readFileSync` + regex, zero runtime deps beyond Node built-ins). Three assertions:

1. **No filename collision**: for every `.md` file in `v3/@claude-flow/cli/.claude/{agents,commands,skills}/`, assert its basename does not appear in any `plugins/*/{agents,commands,skills}/` directory. Fail on first violation, print the conflicting pair.

2. **SKILLS_MAP completeness**: for every skill name in `SKILLS_MAP` (all arrays), assert `v3/@claude-flow/cli/.claude/skills/{name}/SKILL.md` exists. Fail on any missing skill.

3. **COMMANDS_MAP coverage**: for every subdirectory in `v3/@claude-flow/cli/.claude/commands/`, assert its basename is a key in `COMMANDS_MAP` (parsed from `executor.ts` via regex). Fail on any orphaned directory.

**`v3-ci.yml`** (one new job, gated on path filter):
```yaml
paths:
  - 'v3/@claude-flow/cli/.claude/**'
  - 'plugins/**'
  - 'scripts/smoke-init-bundle-dedup.mjs'
  - 'v3/@claude-flow/cli/src/init/executor.ts'
```

**Acceptance**: smoke exits 0 in CI. A PR that adds a new forked agent or an orphaned command directory fails automatically.

## Why this shape

All five phases are connect-the-existing-pieces work:

- Phase 1 fixes a broken default by adding a directory that `findSourceDir()` already checks. No new logic.
- Phase 2 applies the "plugin is canonical" rule mechanically — delete files, update arrays.
- Phase 3 promotes orphaned command dirs to first-class `COMMANDS_MAP` keys using the same pattern that already works for `analysis`, `automation`, etc.
- Phase 4 follows the `#2079` / ADR-127 Phase 4 opt-in precedent — change a default from `all` to a curated subset.
- Phase 5 generalizes `smoke-deprecated-actions.mjs` to the init bundle, following the same static-scan pattern proven by ADR-102, ADR-127.

**Init-template constraint (from ADR-127)**: anything added or modified in `ruflo init` output must work in an empty directory with only `node` and `gh` available. All five phases satisfy this: bundled skill directories are static markdown files with no runtime deps; agent deletions reduce rather than add requirements; `COMMANDS_MAP` additions are code-path changes in the CLI itself.

## Consequences

### Positive

- Phase 1 closes a silent regression that has affected every user who ran `ruflo init` on a machine without a prior `~/.claude/skills/` — which is every fresh CI runner and every first-time user.
- Phase 2 eliminates 9 parallel maintenance burdens. The divergences (68–1,049 diff lines) are evidence that split ownership silently rots.
- Phase 3 reduces the default `ruflo init` command count from 88 to 88 (no change for defaults; orphaned dirs get proper keys or are deleted) and removes domain-specific clutter from the base install.
- Phase 4 reduces the default agent count from 98 to ~24. A user's `.claude/agents/` goes from a wall of 98 files across 23 directories to a curated substrate of ~21.
- Phase 5 makes the deduplication policy mechanically enforceable. Any future PR that violates the "one source of truth" rule fails CI automatically.

### Negative / trade-offs

- Phase 2 removes 9 agents from the init template. Users who have `ruflo init`-initialized projects and rely on, say, `coder.md` from the init template without having `ruflo-core` installed will find those agents missing after upgrading. Mitigation: `ruflo migrate` should detect removed agents and print install suggestions.
- Phase 3's promotion of orphaned command dirs adds 8 new keys to `CommandsConfig` and `COMMANDS_MAP`. This is an API surface increase in the types file, though it is purely additive.
- Phase 4's `agents.all: false` change is a breaking default change. Users who relied on the current all-agents behavior must pass `--agents=all` explicitly. The `ruflo migrate` command must warn on upgrade.
- The deduplication algorithm (plugin installer conflict resolution) is net-new with no prior art in the repo. It is documented in this ADR but deferred to a separate implementation. Until it ships, the Phase 2 deletion is the mechanism.

### Neutral

- The 87 orphaned command files that exist in the template tarball but are never installed by `copyCommands()` are addressed by Phase 3. Until Phase 3 ships, they continue to occupy space in the tarball but have no user-visible effect.
- `findSourceDir()` walk-up logic (lines 1982–2006) can be simplified in a follow-up once Phase 1 lands and the packageDotClaude guard reliably returns early for all three types. That simplification is not required for any phase to ship.

## Implementation Plan

| Phase | Files changed | Estimated size | Dependency |
|---|---|---:|---|
| 1 — Bundle skills | `v3/@claude-flow/cli/.claude/skills/` (new, 29 dirs) + CI assertion | small | none |
| 2 — Remove 9 forked agents | 9 deletions + `executor.ts` `AGENTS_MAP` | small | Phase 1 complete |
| 3 — Domain agents/commands | 12 deletions + 8–11 `COMMANDS_MAP` additions | medium | Phase 2 complete |
| 4 — Flip `agents.all` default | `types.ts` 1 line + migrate warning | small | Phase 3 complete |
| 5 — Smoke + CI | `scripts/smoke-init-bundle-dedup.mjs` + `v3-ci.yml` | small | Phase 4 complete |

Net-new work deferred to a separate issue: plugin installer deduplication algorithm (conflict resolution when plugin and existing file differ).
