#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares 0.2.1 with new keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.2.1" ]]; then bad "expected 0.2.1, got '$v'"; else
  miss=""
  for k in mcp topologies worktree-isolation monitor-stream; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. both skills + 2 agents + 2 commands present with valid frontmatter"
miss=""
for s in swarm-init monitor-stream; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
for a in coordinator architect; do
  [[ -f "$ROOT/agents/$a.md" ]] || miss="$miss missing-agent-$a"
done
[[ -f "$ROOT/commands/swarm.md" ]] || miss="$miss missing-swarm-cmd"
[[ -f "$ROOT/commands/watch.md" ]] || miss="$miss missing-watch-cmd"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. all 4 swarm_* MCP tools referenced"
miss=""
for t in swarm_init swarm_status swarm_shutdown swarm_health; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

step "4. all 8 agent_* MCP tools referenced"
miss=""
for t in agent_spawn agent_execute agent_terminate agent_status agent_list agent_pool agent_health agent_update; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

step "5. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "6. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "7. swarm-state namespace claimed"
grep -q "swarm-state" "$ROOT/README.md" \
  && ok || bad "swarm-state namespace not claimed"

step "8. anti-drift defaults documented (hierarchical/specialized/raft + maxAgents 6-8)"
F="$ROOT/README.md"
miss=""
grep -q "hierarchical" "$F" || miss="$miss hierarchical"
grep -q "specialized" "$F" || miss="$miss specialized"
grep -q "raft" "$F" || miss="$miss raft"
grep -qE "6.{0,3}8|6 to 8|6-8" "$F" || miss="$miss maxAgents"
[[ -z "$miss" ]] && ok || bad "$miss"

step "9. 6 topologies documented (hierarchical/mesh/hierarchical-mesh/ring/star/adaptive)"
F="$ROOT/README.md"
miss=""
for top in hierarchical mesh hierarchical-mesh ring star adaptive; do
  grep -q "$top" "$F" || miss="$miss $top"
done
[[ -z "$miss" ]] && ok || bad "missing topologies:$miss"

step "10. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-swarm-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

step "11. no wildcard tool grants in skills"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
