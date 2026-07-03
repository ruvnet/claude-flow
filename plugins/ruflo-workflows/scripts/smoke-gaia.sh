#!/usr/bin/env bash
# smoke-gaia.sh — validate the GAIA benchmark component of ruflo-workflows
# Tests structure, frontmatter, and end-to-end /gaia validate invocation.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

# ── plugin.json ──────────────────────────────────────────────────────────────

step "1. plugin.json at 0.4.0 with gaia keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.4.0" ]]; then bad "expected 0.4.0, got '$v'"; else
  miss=""
  for k in gaia benchmark hal-leaderboard evaluation; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. plugin.json has gaia component block with correct keys"
miss=""
for k in gaia-run gaia-submit gaia-validate gaia-history gaia-cost gaia-leaderboard; do
  grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
done
[[ -z "$miss" ]] && ok || bad "missing component entries:$miss"

# ── commands ─────────────────────────────────────────────────────────────────

step "3. all 7 gaia commands present with valid frontmatter"
miss=""
for cmd in gaia gaia-run gaia-submit gaia-leaderboard gaia-validate gaia-history gaia-cost; do
  f="$ROOT/commands/$cmd.md"
  [[ -f "$f" ]] || { miss="$miss missing-$cmd"; continue; }
  grep -q "^name:" "$f" || miss="$miss $cmd-no-name"
  grep -q "^description:" "$f" || miss="$miss $cmd-no-description"
done
[[ -z "$miss" ]] && ok || bad "$miss"

# ── skills ───────────────────────────────────────────────────────────────────

step "4. all 3 gaia skills present with valid frontmatter"
miss=""
for s in gaia-submission gaia-debugging gaia-architecture-comparison; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  grep -q "^name:" "$f" || miss="$miss $s-no-name"
  grep -q "^description:" "$f" || miss="$miss $s-no-description"
  grep -q "^allowed-tools:" "$f" || miss="$miss $s-no-allowed-tools"
done
[[ -z "$miss" ]] && ok || bad "$miss"

# ── no wildcard tool grants ───────────────────────────────────────────────────

step "5. no wildcard allowed-tools in gaia skills"
bad_skills=""
for f in "$ROOT"/skills/gaia-*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

# ── agents ───────────────────────────────────────────────────────────────────

step "6. both gaia agents present with model: sonnet"
miss=""
for a in gaia-benchmark-runner gaia-submission-coordinator; do
  f="$ROOT/agents/$a.md"
  [[ -f "$f" ]] || { miss="$miss missing-$a"; continue; }
  grep -q "^model: sonnet" "$f" || miss="$miss $a-no-model"
done
[[ -z "$miss" ]] && ok || bad "$miss"

# ── HAL schema referenced ─────────────────────────────────────────────────────

step "7. HAL-compatible result schema documented (task_id + model_answer)"
miss=""
for f in "$ROOT/commands/gaia-submit.md" "$ROOT/agents/gaia-submission-coordinator.md"; do
  grep -q '"task_id"' "$f" || miss="$miss $(basename $f)-no-task_id"
  grep -q '"model_answer"' "$f" || miss="$miss $(basename $f)-no-model_answer"
done
[[ -z "$miss" ]] && ok || bad "$miss"

# ── cost gate documented ──────────────────────────────────────────────────────

step "8. cost confirmation gate (5-dollar threshold) documented"
grep -qE '\$5|\$\{5' "$ROOT/commands/gaia-run.md" && grep -qE '\$5|\$\{5' "$ROOT/skills/gaia-submission/SKILL.md" \
  && ok || bad "cost gate missing from gaia-run.md or gaia-submission SKILL.md"

# ── Ed25519 signing referenced ────────────────────────────────────────────────

step "9. Ed25519 witness signing referenced in submit command + coordinator"
grep -q 'Ed25519\|witness\|manifest' "$ROOT/commands/gaia-submit.md" \
  && grep -q 'Ed25519\|witness\|manifest' "$ROOT/agents/gaia-submission-coordinator.md" \
  && ok || bad "Ed25519 signing not documented"

# ── memory namespaces ─────────────────────────────────────────────────────────

step "10. gaia-runs namespace used in run command + history command"
grep -q 'gaia-runs' "$ROOT/commands/gaia-run.md" \
  && grep -q 'gaia-runs' "$ROOT/commands/gaia-history.md" \
  && ok || bad "gaia-runs namespace not consistent"

# ── resumable runs documented ─────────────────────────────────────────────────

step "11. resumable benchmark (checkpoint) documented in gaia-run"
grep -qE 'checkpoint|resume|interrupt' "$ROOT/commands/gaia-run.md" \
  && ok || bad "resume support not documented in gaia-run.md"

# ── extensibility note ────────────────────────────────────────────────────────

step "12. multi-benchmark extensibility documented in skill or agent"
grep -qE 'SWE-bench|WebArena|HumanEval|extensib' "$ROOT/skills/gaia-submission/SKILL.md" \
  || grep -qE 'SWE-bench|WebArena|HumanEval|extensib' "$ROOT/skills/gaia-architecture-comparison/SKILL.md" \
  && ok || bad "extensibility not documented"

# ── original smoke test still passes ─────────────────────────────────────────

step "13. core plugin artifacts intact (skills + agent + command)"
# Re-run a subset: skills + agent + command for pre-existing artifacts
miss=""
for s in workflow-create workflow-run; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  grep -q "^name:" "$f" || miss="$miss $s-no-name"
done
[[ -f "$ROOT/agents/workflow-specialist.md" ]] || miss="$miss missing-workflow-specialist"
[[ -f "$ROOT/commands/workflow.md" ]] || miss="$miss missing-workflow-command"
[[ -z "$miss" ]] && ok || bad "$miss"

# ── CLI backend referenced ────────────────────────────────────────────────────

step "14. gaia-bench CLI backend referenced in commands"
grep -q 'gaia-bench' "$ROOT/commands/gaia-run.md" \
  && ok || bad "gaia-bench CLI not referenced in gaia-run.md"

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
