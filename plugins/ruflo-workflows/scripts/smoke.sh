#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares 0.5.1 with lifecycle keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.5.1" ]]; then bad "expected 0.5.1, got '$v'"; else
  miss=""
  for k in mcp workflow-templates pause-resume lifecycle; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. both skills + agent + command present with valid frontmatter"
miss=""
for s in workflow-create workflow-run; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -f "$ROOT/agents/workflow-specialist.md" ]] || miss="$miss missing-agent"
[[ -f "$ROOT/commands/workflow.md" ]] || miss="$miss missing-command"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. all 10 workflow_* MCP tools referenced"
miss=""
for t in workflow_create workflow_run workflow_execute workflow_status workflow_list workflow_pause workflow_resume workflow_cancel workflow_delete workflow_template; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

step "4. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "5. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "6. workflows-state namespace claimed"
grep -q "workflows-state" "$ROOT/README.md" \
  && ok || bad "workflows-state namespace not claimed"

step "7. lifecycle state machine documented (5 states)"
F="$ROOT/README.md"
miss=""
for state in created running paused completed cancelled; do
  grep -q "$state" "$F" || miss="$miss $state"
done
[[ -z "$miss" ]] && ok || bad "missing states:$miss"

step "8. lifecycle transitions documented (run/pause/resume/cancel)"
F="$ROOT/README.md"
miss=""
for trans in 'workflow_run' 'workflow_pause' 'workflow_resume' 'workflow_cancel'; do
  grep -q "$trans" "$F" || miss="$miss $trans"
done
[[ -z "$miss" ]] && ok || bad "missing transitions:$miss"

step "9. workflow_execute documented as stateless path"
F="$ROOT/README.md"
grep -q "workflow_execute" "$F" \
  && grep -qE "stateless|one-shot|fire-and-forget" "$F" \
  && ok || bad "stateless path not documented"

step "10. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-workflows-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR-0001 missing or status != Accepted"

step "11. no wildcard tool grants in skills"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

step "12. ADR-0002 exists with status Accepted"
ADR2="$ROOT/docs/adrs/0002-native-workflow-orchestration.md"
[[ -f "$ADR2" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR2" \
  && ok || bad "ADR-0002 missing or status != Accepted"

step "13. README documents native workflow orchestration"
F="$ROOT/README.md"
grep -q "Native Workflow Orchestration" "$F" \
  && grep -qF ".claude/workflows" "$F" \
  && grep -qF "Workflow({" "$F" \
  && ok || bad "native orchestration section incomplete"

step "14. four-hook API documented (agent/parallel/pipeline/phase)"
F="$ROOT/README.md"
miss=""
for hook in 'agent(' 'parallel(' 'pipeline(' 'phase('; do
  grep -qF "$hook" "$F" || miss="$miss $hook"
done
[[ -z "$miss" ]] && ok || bad "missing hooks:$miss"

step "15. plugin.json declares native-workflow keywords"
miss=""
for k in native-workflow agent-fanout pipeline parallel; do
  grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
done
[[ -z "$miss" ]] && ok || bad "missing native keywords:$miss"

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
