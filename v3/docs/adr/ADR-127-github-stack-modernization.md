# ADR-127 — GitHub Skills, Agents, and Init-Template Modernization: CI Guards, Supply-Chain Review, and Provenance

**Status**: Proposed (2026-05-21)
**Date**: 2026-05-21
**Authors**: claude (drafted with rUv)
**Related**: ADR-102 (plugin-hook-CLI flag regression CI guard), ADR-103 (witness temporal history), ADR-118 (AIDefence 2.3.0), ADR-125 (memory consolidation), ADR-126 (neural-trader substrate), ruflo issues #2017, #1922, #2078, #2086
**Supersedes**: nothing — extends the CI smoke pattern established by ADR-102 to the `.github` skills/agents surface

## Context

The `.github`-related surface in ruflo ships in two layers:

1. **Dogfood layer** — `.claude/skills/github-*/SKILL.md` (5 skills: code-review, multi-repo, project-management, release-management, workflow-automation), `.claude/agents/github/*.md` (13 agents), `.claude/helpers/github-{safe.js,setup.sh}`. These drive our own workflow daily.

2. **Init-template layer** — `v3/@claude-flow/cli/.claude/commands/github/*.md` (19 command files), `v3/@claude-flow/cli/.claude/helpers/github-{safe.js,setup.sh}`. These are materialized verbatim into every user project by `ruflo init`.

Both layers were last substantively updated on 2025-10-19 — seven months before this ADR. In the same period the project shipped ~10 targeted CI guard + supply-chain hardening PRs: #1922 (CWE-347 plugin registry signature), #2017 (pre-bash hook silent exit 0), #2046 (5-layer supply-chain audit), #2060 (Ed25519 CWE-347 pattern formalization), #2079 (attribution opt-in), #2086 (ruvllm WASM auto-init). None of those fixes touched the `.github` surface.

A read-only review of both layers reveals four categories of gap:

### Category A: Third-party Actions are mutable floating refs

Every workflow snippet in the skills and init-template commands uses `actions/checkout@v3` and `actions/setup-node@v3`. Both are mutable floating tags. `scripts/audit-supply-chain.mjs` (introduced in #2046, ADR-102 supply-chain hardening) tracks CVE + lockfile + allowlist + typosquat across npm packages but has zero coverage of the GitHub Actions surface. The `github-project-management` skill also recommends `ruvnet/swarm-action@v1` (skill line 976) — a first-party action that is also unpinned. The existing `smoke-plugin-registry-signature.mjs` proves that static-contract checks on text files are fast and reliably catch regressions; the same pattern applied to `uses:` lines would require under 30 lines of JavaScript.

### Category B: Unquoted GitHub event fields in `swarm-pr.md` / `swarm-issue.md`

`.claude/agents/github/swarm-pr.md` line 57 and its init-template copy interpolate `${{ github.event.comment.body }}` directly into a shell `if [[ ... ]]` test and a subsequent `--comment "${{ ... }}"` argument. Any PR comment containing shell metacharacters (`\`...\``, `$(...)`, `;`) would expand under that interpolation in a `pull_request` or `issue_comment` triggered workflow. The `github-project-management` skill has a correct "Security Considerations" section (skill lines 17-25) warning explicitly against this pattern, but the two agents implementing the warning do not follow it. `github-safe.js` (`.claude/helpers/github-safe.js`) already demonstrates the correct mitigation: write the body to a temp file and pass `--body-file`. The gap is that the agents don't route through that helper.

The class of failure — **silent success when the check was never run** — matches #2017 exactly: the pre-bash hook exited 0 on dangerous payloads not because the block was absent but because a TypeError was silently swallowed. Any future refactor of the GitHub agents faces the same swallow risk unless there is a behavioral smoke.

### Category C: No `tools:` restrictions on 12 of 13 agents

The `github-project-management` skill is the single artifact with `allowed-tools:` in its frontmatter. All other skills and all 13 agents omit the field entirely, meaning they run with the full tool namespace when materialized. This includes `WebFetch`, which can be pointed at any URL — including URLs embedded in issue bodies or PR descriptions.

The fix for #2017 added behavioral checks that drive real input payloads against both the dogfood and published-template copies of `hook-handler.cjs`. No analogous check exists for `github-safe.js`.

### Category D: Attribution footers are not gated on `--attribution` opt-in

`v3/@claude-flow/cli/src/init/settings-generator.ts` lines 55-60 (introduced in #2079) implement opt-in `Co-Authored-By` using a no-reply bot email. The 19 GitHub command files embed hardcoded `"🤖 Generated with Claude Code"` footers in PR/issue body templates, unconditionally. A user who runs `ruflo init` without `--attribution` still gets attribution injected into every PR or issue the GitHub agents post on their behalf.

## Decision

Land a four-phase modernization of the `.github` skills/agents/helpers/init-template surface, following the same deliver-a-runnable-artifact-per-phase discipline as ADR-125 and ADR-126.

### Phase 1 — Static-contract smokes and supply-chain extension (small; ships first)

**`scripts/smoke-github-safe-injection.mjs`** (new)

Generalizes `smoke-pre-bash-hook.mjs` (introduced for #2017) to the GitHub helper surface. Drives adversarial bodies through `github-safe.js` and asserts the body lands in the temp file verbatim, not shell-expanded. Runs against both copies:
- `.claude/helpers/github-safe.js` (dogfood)
- `v3/@claude-flow/cli/.claude/helpers/github-safe.js` (init template)

Test cases: body containing backticks, body containing `$()`, body containing semicolons, body longer than 256KB (must be rejected, not truncated), empty body (no-op path, exit 0).

**`scripts/smoke-github-actions-pins.mjs`** (new)

Static scan of three trees:
- `.claude/agents/github/*.md`
- `.claude/skills/github-*/SKILL.md`
- `v3/@claude-flow/cli/.claude/commands/github/*.md`

For every `uses:` line, asserts the ref is either (a) SHA-pinned (`uses: owner/repo@<40-hex>`) or (b) listed in a new `actions` key added to `.github/supply-chain/allowed-deps.json`. First offense: list the violating file + line. Fails on any violation. Zero runtime deps — pure `readFileSync` + regex.

**`.github/supply-chain/allowed-deps.json`** — add:
```json
"actions": {
  "allowed": ["actions/checkout", "actions/setup-node", "pnpm/action-setup"],
  "minimumVersion": {"actions/checkout": "v4", "actions/setup-node": "v4"}
}
```

**`v3-ci.yml` changes**

Add two smoke jobs gated by path filters:
```yaml
# Phase 1 smokes — gate on .github surface changes
on:
  push:
    paths:
      - '.claude/agents/github/**'
      - '.claude/skills/github-*/**'
      - 'v3/@claude-flow/cli/.claude/commands/github/**'
      - '.claude/helpers/github-safe.js'
      - 'v3/@claude-flow/cli/.claude/helpers/github-safe.js'
      - 'scripts/smoke-github-*.mjs'
      - '.github/supply-chain/allowed-deps.json'
```

Acceptance: both smokes exit 0 in CI on first commit.

### Phase 2 — Helper hardening and agent frontmatter (small)

Generalizes the `github-safe.js` hardening pattern and the `hook-handler.cjs` per-copy discipline to the remaining helpers.

**`github-safe.js` (both copies)** — add explicit `maxBuffer` cap (256KB, matching GitHub API `body` field limit) and reject oversized bodies before writing the temp file. Add a `GITHUB_SAFE_VERSION` constant so the injection smoke can assert the correct copy is installed. Add `set -e` equivalent (strict error handling) for the shell fallback path.

**`github-setup.sh` (both copies)** — add `set -euo pipefail`. Replace `gh auth status &> /dev/null` with a check that parses the output for scope sufficiency. Comment the security rationale.

**13 agent frontmatter `tools:` lines** — add explicit tool restrictions. Reference pattern: the `code-review-swarm.md` agent should list `Bash, Read, Grep, Glob, mcp__claude-flow__*` and explicitly omit `WebFetch`, `Write`. The `release-manager.md` and `release-swarm.md` agents may include `Write` (for CHANGELOG) but not `WebFetch`. No agent that processes GitHub-hosted content (issue bodies, PR descriptions, label names) should have `WebFetch` in its tool list.

**`swarm-pr.md` and `swarm-issue.md` (both dogfood and init-template copies)** — replace the unquoted `${{ github.event.comment.body }}` and `${{ github.event.label.name }}` interpolations with temp-file indirection following the `github-safe.js` pattern. Specifically:
```bash
# Before (vulnerable)
if [[ "${{ github.event.comment.body }}" == /swarm* ]]; then
  npx ruv-swarm github handle-comment --comment "${{ github.event.comment.body }}"

# After
COMMENT_BODY_FILE=$(mktemp)
printf '%s' "${{ github.event.comment.body }}" > "$COMMENT_BODY_FILE"
if grep -q '^/swarm' "$COMMENT_BODY_FILE"; then
  npx ruv-swarm github handle-comment --comment-file "$COMMENT_BODY_FILE"
fi
rm -f "$COMMENT_BODY_FILE"
```

Ties directly to the `github-safe.js` temp-file pattern already documented in `.claude/helpers/`.

Acceptance: `smoke-github-safe-injection.mjs` passes with the hardened copies; `grep -r 'github.event.comment.body.*--comment' .claude/agents/ v3/@claude-flow/cli/.claude/` returns no matches.

### Phase 3 — Action pin upgrade and deprecated-action smoke (small)

**`scripts/smoke-github-release-no-deprecated-action.mjs`** (new)

Asserts that no file in scope references:
- `actions/create-release@*` (archived)
- `softprops/action-gh-release@v1` (mutable floating)

And positively asserts that any workflow snippet containing `release` in its job name uses `gh release create` (the `gh` CLI path) rather than an Actions-based release step.

**Upgrade `@v3` → `@v4`** in all affected files: 5 agent files (`release-manager.md`, `release-swarm.md`, `swarm-pr.md`, `workflow-automation.md`, `repo-architect.md` — plus their init-template copies) and both skill files (`github-release-management/SKILL.md`, `github-code-review/SKILL.md`). This is a mechanical find-and-replace; the smoke in Phase 1 will catch future regressions.

The `ruvnet/swarm-action@v1` reference in `github-project-management/SKILL.md` (line 976) is either SHA-pinned to the current HEAD of that repo or replaced with the equivalent inline `run:` step. A SHA pin is preferred — it satisfies the allow-list check without removing the reference.

Acceptance: `smoke-github-actions-pins.mjs` passes against all files in scope; `smoke-github-release-no-deprecated-action.mjs` passes.

### Phase 4 — Attribution gate and `last-updated` stamps (small)

**Init-template command files** — gate the `🤖 Generated with` footer on the `attribution` option that `settings-generator.ts` already exposes. This is implemented via a new `ATTRIBUTION_FOOTER` variable in `helpers-generator.ts` that is set to an empty string by default and to the bot-identity string when `options.attribution === true`. Each of the 19 command files references the variable rather than hardcoding the footer.

This follows the precedent from `settings-generator.ts` lines 55-60 (introduced in #2079 / #2078). The bot email `ruflo-bot@users.noreply.github.com` applies to commit trailers; the PR/issue body footer should use `🤖 Generated with [RuFlo](https://github.com/ruvnet/ruflo)` (same PR footer already in `settings-generator.ts:60`) when attribution is opted in, and no footer otherwise.

**`Last Updated` stamps** on the four skill SKILL.md files are updated from 2025-10-19 to the date this ADR ships. A comment in each file notes: "update this date when you change the skill so the smoke can detect stale copies." This is convention, not enforced — no smoke needed.

Acceptance: `ruflo init` (without `--attribution`) produces command files with no `🤖` footer string in any PR/issue body template; `ruflo init --attribution` produces the `RuFlo` bot-identity footer.

## Why this is the right shape of fix

All four phases are connect-the-existing-pieces work:

- Phase 1 generalizes `smoke-pre-bash-hook.mjs` (pattern proven by #2017) to a new surface. No new architecture.
- Phase 2 generalizes the `github-safe.js` temp-file pattern (already shipped) to the agents that should have been using it. No new design.
- Phase 3 is a mechanical pin upgrade gated by a static smoke. The upgraded version (`@v4`) is already what our own `v3-ci.yml` uses (lines 154, 158, 163 of the workflow).
- Phase 4 mirrors the existing `settings-generator.ts` attribution logic into the helper generator. No new concept.

**Init-template constraint**: anything added to `ruflo init` output must work in an empty directory with only `node` and `gh` available. All four phases satisfy this: static markdown files and `.js`/`.sh` helpers — no new runtime dependencies installed into user projects.

## Consequences

### Positive

- `smoke-github-safe-injection.mjs` catches the class of regression (#2017 shape) on the GitHub helper surface for the first time.
- `smoke-github-actions-pins.mjs` catches any future commit that copies old `@v3` snippets from blog posts into the skill files — a very common doc-drift pattern.
- The `swarm-pr.md` / `swarm-issue.md` fix closes a prompt-injection path that could cause the GitHub Actions bot to execute attacker-controlled shell in a `pull_request` triggered workflow. The `github-project-management` skill already warned about this (skill lines 17-25); the gap was enforcement.
- Attribution opt-in is now consistent: `settings-generator.ts` and the command file footers both respond to the same `--attribution` flag.
- The supply-chain `allowed-deps.json` `actions` key extends an existing format that contributors already know how to update.

### Negative / trade-offs

- ADR-127 adds 3 new CI smoke jobs that gate every PR touching `.claude/agents/github/`, `.claude/skills/github-*/`, or `v3/@claude-flow/cli/.claude/commands/github/`. Purely-editorial PRs to those files (e.g. fixing a typo in a skill description) now run the smoke suite. The smokes are fast (static file reads, no npm install beyond root node_modules), but they add ~20–30 seconds to the pre-merge wall clock for any contributor touching those trees.
- The `ruvnet/swarm-action@v1` SHA-pin requires looking up the current HEAD SHA of that repo and re-doing this whenever the action is updated. Mitigation: add a note in `.github/supply-chain/allowed-deps.json` next to the entry.
- Phase 2's `tools:` frontmatter additions are a behavioral change for any consumer who has configured `ruflo init` output and relies on `WebFetch` being available in GitHub agents. The downgrade is intentional and documented, but it is a breaking change on the init-template surface.
- Phase 4's attribution gate is only enforced at `init` time. A user who edits their materialized command files after `init` can re-add the footer manually. This is acceptable — the commitment is to the default (`init` output without `--attribution` contains no footer), not to preventing all possible edits.

### Neutral

- The `@v3` → `@v4` pin upgrade is compatible with all runner images in `v3-ci.yml` (already running `@v4` for the main CI jobs). No runner image changes needed.
- The `github-setup.sh` `set -euo pipefail` addition is compatible with bash 3.x (macOS default), which the helper's current shebang (`#!/bin/bash`) already requires.

## Implementation Plan

| Phase | Deliverable | Files | Effort | Acceptance |
|---|---|---|---|---|
| 1 | Injection smoke + Actions pin smoke + CI wiring + supply-chain update | `scripts/smoke-github-safe-injection.mjs` (new), `scripts/smoke-github-actions-pins.mjs` (new), `.github/supply-chain/allowed-deps.json`, `.github/workflows/v3-ci.yml` | S | Both smokes exit 0 in CI; `v3-ci.yml` path filters trigger on agent/skill changes |
| 2 | Helper hardening + agent frontmatter + unquoted interpolation fix | `github-safe.js` × 2, `github-setup.sh` × 2, 13 agent files × 2 (dogfood + init-template) | M | `smoke-github-safe-injection.mjs` passes hardened copies; grep for unquoted interpolation returns 0 matches |
| 3 | Deprecated-action smoke + `@v3` → `@v4` pin upgrade | `scripts/smoke-github-release-no-deprecated-action.mjs` (new), 6 agent files × 2, 2 skill files | S | Both new smokes pass; `smoke-github-actions-pins.mjs` passes all in-scope files |
| 4 | Attribution gate in init-template + skill `Last Updated` stamps | `v3/@claude-flow/cli/src/init/helpers-generator.ts`, 19 command files, 4 skill files | S | `ruflo init` without `--attribution` produces no `🤖` footer; `ruflo init --attribution` produces bot-identity footer |

Recommended landing: Phases 1 + 3 in one PR (pure static checks + mechanical upgrades — no behavioral change). Phase 2 in its own PR (behavioral change to agents and helpers — needs explicit review). Phase 4 in its own PR (init-template behavior change).

## Acceptance Criteria

The ADR is considered fulfilled when all of the following hold against `@claude-flow/cli@3.8.0-alpha.X`:

1. `node scripts/smoke-github-safe-injection.mjs` exits 0 with adversarial bodies against both handler copies.
2. `node scripts/smoke-github-actions-pins.mjs` exits 0: all `uses:` refs in scope are SHA-pinned or on the allow-list.
3. `node scripts/smoke-github-release-no-deprecated-action.mjs` exits 0: no deprecated action references survive.
4. `grep -r 'github.event.comment.body.*--comment\|github.event.label.name.*[^"]' .claude/agents/github/ v3/@claude-flow/cli/.claude/commands/github/` returns 0 matches.
5. All 13 agent files have explicit `tools:` frontmatter; none include `WebFetch` in the set.
6. `ruflo init` (no `--attribution`) produces 19 command files with no `🤖 Generated with` string in any PR/issue body template.
7. `v3-ci.yml` path filters include `.claude/agents/github/**`, `.claude/skills/github-*/**`, and `v3/@claude-flow/cli/.claude/commands/github/**`.
8. No regression in the existing `pre-bash-hook-smoke`, `plugin-registry-signature-smoke`, or `ruvllm-wasm-auto-init-smoke` CI jobs.

## Out of Scope (Deferred)

- **ADR-128**: Provenance / witness signing for `gh release create` artifacts — generalizing the ADR-103 witness pattern to the release pipeline. This ADR establishes that the helper surface must _not_ recommend deprecated Actions; it does not yet mandate Ed25519-signed release artifacts.
- **ADR-129**: GitHub Apps token scoping — a separate decision about whether `ruflo init`-materialized workflows should request `contents: read` by default rather than inheriting the ambient `GITHUB_TOKEN` scopes. Gated on a broader permissions-minimization ADR.
- **ADR-130**: SBOM generation in the release workflow. The supply-chain audit covers npm dep CVEs; an SBOM is a separate artifact type requiring a separate decision on format (SPDX vs CycloneDX) and storage location.
- **Dynamic action pinning automation** (`dependabot.yml` or Renovate configuration for `uses:` refs) — net-new pattern with no prior art in this repo. Phase 3 does the manual upgrade; automation is a follow-on.
