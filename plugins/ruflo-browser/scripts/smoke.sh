#!/usr/bin/env bash
# Structural smoke test for ruflo-browser plugin v0.2.1.
# Verifies the file inventory, frontmatter, ADR cross-references, and
# AgentDB-namespace coverage that ADR-0001 contracts. Does NOT exercise
# the live MCP browser tools — the full Verification §1-§7 contract
# requires the planned browser_session_* tools and the replay spike,
# both pending.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

# 1. plugin.json version + keywords
step "plugin.json declares version 0.2.1 with new keywords"
v=$(grep -E '"version"[[:space:]]*:' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.2.1" ]]; then
  bad "expected 0.2.1, got '$v'"
else
  missing=""
  for kw in rvf replay trajectory agentdb aidefence; do
    grep -q "\"$kw\"" "$ROOT/.claude-plugin/plugin.json" || missing="$missing $kw"
  done
  [[ -z "$missing" ]] && ok || bad "missing keywords:$missing"
fi

# 2. All 8 skills present
step "all 8 skills (browser-record/replay/extract/login/form-fill/screenshot-diff/auth-flow/test) exist"
missing=""
for s in browser-record browser-replay browser-extract browser-login browser-form-fill browser-screenshot-diff browser-auth-flow browser-test; do
  [[ -f "$ROOT/skills/$s/SKILL.md" ]] || missing="$missing $s"
done
[[ -z "$missing" ]] && ok || bad "missing:$missing"

# 3. Each skill has valid YAML frontmatter (name + description + allowed-tools)
step "every skill has name/description/allowed-tools frontmatter"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  for k in "name:" "description:" "allowed-tools:"; do
    grep -q "^$k" "$f" || bad_skills="$bad_skills $(basename $(dirname "$f"))(missing-$k)"
  done
done
[[ -z "$bad_skills" ]] && ok || bad "$bad_skills"

# 4. browser-scrape is a deprecation shim (must mention "deprecated")
step "browser-scrape is a deprecation shim pointing at browser-extract"
if grep -qi "deprecated" "$ROOT/skills/browser-scrape/SKILL.md" \
   && grep -q "browser-extract" "$ROOT/skills/browser-scrape/SKILL.md"; then
  ok
else
  bad "shim does not flag deprecation or does not reference browser-extract"
fi

# 5. Verb-dispatcher command covers all 7 verbs
step "/ruflo-browser command covers ls/show/replay/export/fork/purge/doctor"
missing=""
for v in 'ls' 'show' 'replay' 'export' 'fork' 'purge' 'doctor'; do
  grep -qE "\\*\\*$v\b" "$ROOT/commands/ruflo-browser.md" || missing="$missing $v"
done
[[ -z "$missing" ]] && ok || bad "missing verbs:$missing"

# 6. Agent references the 4 AgentDB namespaces
step "browser-agent references all 4 AgentDB namespaces"
missing=""
for n in browser-sessions browser-selectors browser-templates browser-cookies; do
  grep -q "$n" "$ROOT/agents/browser-agent.md" || missing="$missing $n"
done
[[ -z "$missing" ]] && ok || bad "missing namespaces:$missing"

# 7. Agent enforces the 3 AIDefence gates
step "browser-agent declares the 3 AIDefence gates"
missing=""
for g in aidefence_has_pii aidefence_scan aidefence_is_safe; do
  grep -q "$g" "$ROOT/agents/browser-agent.md" || missing="$missing $g"
done
[[ -z "$missing" ]] && ok || bad "missing gate refs:$missing"

# 8. Agent uses ruvector trajectory hooks
step "browser-agent wires ruvector trajectory-begin/step/end"
missing=""
for h in trajectory-begin trajectory-step trajectory-end; do
  grep -q "$h" "$ROOT/agents/browser-agent.md" || missing="$missing $h"
done
[[ -z "$missing" ]] && ok || bad "missing trajectory hooks:$missing"

# 9. ADR file exists with status Proposed
step "ADR-0001 exists and is Proposed"
adr="$ROOT/docs/adrs/0001-browser-skills-architecture.md"
if [[ -f "$adr" ]] && grep -qE "^status:[[:space:]]*Proposed" "$adr"; then
  ok
else
  bad "ADR missing or status != Proposed"
fi

# 10. ADR documents the load-bearing replay risk
step "ADR Verification §4 flags the replay-fidelity risk"
if grep -q "load-bearing" "$adr" && grep -q "replay" "$adr" && grep -q "drift" "$adr"; then
  ok
else
  bad "ADR Verification §4 missing the replay risk callout"
fi

# 11. README enumerates all 8 skills + verb dispatcher
step "README enumerates all 8 skills + verb dispatcher"
missing=""
for tok in browser-record browser-replay browser-extract browser-login browser-form-fill browser-screenshot-diff browser-auth-flow browser-test 'ls' 'doctor'; do
  grep -q "$tok" "$ROOT/README.md" || missing="$missing $tok"
done
[[ -z "$missing" ]] && ok || bad "missing:$missing"

# 12. The 5 browser_session_* lifecycle tools are present in the CLI source
step "5 browser_session_* lifecycle tools registered in mcp-tools"
TOOLS_FILE="$ROOT/../../v3/@claude-flow/cli/src/mcp-tools/browser-session-tools.ts"
if [[ ! -f "$TOOLS_FILE" ]]; then
  bad "browser-session-tools.ts not found at $TOOLS_FILE"
else
  missing=""
  for t in browser_session_record browser_session_end browser_session_replay browser_template_apply browser_cookie_use; do
    grep -q "name: '$t'" "$TOOLS_FILE" || missing="$missing $t"
  done
  if [[ -n "$missing" ]]; then
    bad "missing tool definitions:$missing"
  else
    grep -q 'browserSessionTools' "$ROOT/../../v3/@claude-flow/cli/src/mcp-client.ts" \
      && ok || bad "browserSessionTools not imported in mcp-client.ts"
  fi
fi

# 13. allowed-tools enumerated explicitly per skill (no skill claims '*' or omits the list)
step "no skill grants wildcard tool access"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  if grep -q '^allowed-tools:[[:space:]]*\*' "$f"; then
    bad_skills="$bad_skills $(basename $(dirname "$f"))"
  fi
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
