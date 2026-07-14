#!/usr/bin/env bash
# Structural smoke test for ruflo-adr v0.4.0 (ADR-0001, ADR-0002).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

# 1. plugin.json bump + new keywords
step "1. plugin.json declares 0.4.0 with new keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.4.0" ]]; then
  bad "expected 0.4.0, got '$v'"
else
  miss=""
  for k in lifecycle compliance causal-graph mcp; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

# 2. All 5 skills present with valid frontmatter
step "2. skills (adr-create, adr-index, adr-review, adr-verify, adr-reindex) present with name/description/allowed-tools"
miss=""
for s in adr-create adr-index adr-review adr-verify adr-reindex; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -z "$miss" ]] && ok || bad "$miss"

# 3. command covers all 7 subcommands
step "3. /adr command covers all 7 subcommands"
F="$ROOT/commands/adr.md"
miss=""
for sub in 'adr create' 'adr list' 'adr status' 'adr supersede' 'adr check' 'adr graph' 'adr search'; do
  grep -q "$sub" "$F" || miss="$miss '${sub#adr }'"
done
[[ -z "$miss" ]] && ok || bad "missing:$miss"

# 4. Agent references REFERENCE.md (ADR-098 Part 2 token-diet pattern)
step "4. agent references REFERENCE.md (token-optimization pattern)"
grep -q "REFERENCE.md" "$ROOT/agents/adr-architect.md" \
  && ok || bad "REFERENCE.md cross-reference missing"

# 5. adr-patterns namespace used consistently
step "5. adr-patterns namespace referenced in agent + skills"
miss=""
grep -q "adr-patterns" "$ROOT/agents/adr-architect.md" || miss="$miss agent"
grep -q "adr-patterns" "$ROOT/skills/adr-create/SKILL.md" || miss="$miss adr-create"
grep -q "adr-patterns" "$ROOT/skills/adr-index/SKILL.md" || miss="$miss adr-index"
[[ -z "$miss" ]] && ok || bad "missing in:$miss"

# 6. README pins to @claude-flow/cli v3.6
step "6. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "Compatibility pin to v3.6 missing"

# 7. README has namespace coordination section
step "7. README defers to ruflo-agentdb ADR-0001 namespace convention"
grep -q "Namespace coordination" "$ROOT/README.md" \
  && grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

# 8. ADR file exists with status Proposed
step "8. ADR-0001 exists with status Proposed"
ADR="$ROOT/docs/adrs/0001-adr-plugin-pattern.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Proposed" "$ADR" \
  && ok || bad "ADR missing or status != Proposed"

# 9. REFERENCE.md exists and is non-empty
step "9. REFERENCE.md exists and is non-empty"
[[ -s "$ROOT/REFERENCE.md" ]] && ok || bad "REFERENCE.md missing or empty"

# 10. No wildcard tool grants
step "10. no skill grants wildcard tool access"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

# 11. import + verify scripts present, executable, parse cleanly
step "11. scripts/import.mjs and verify.mjs executable + syntax-clean"
miss=""
for s in import.mjs verify.mjs; do
  f="$ROOT/scripts/$s"
  [[ -x "$f" ]] || miss="$miss $s-not-executable"
  node --check "$f" 2>/dev/null || miss="$miss $s-syntax-error"
done
[[ -z "$miss" ]] && ok || bad "$miss"

# 12. shared parser lib handles both ADR formats + has issue-number false-positive
# guard (#2666: moved from import.mjs into lib/parse-adrs.mjs so reindex.mjs
# doesn't duplicate it — check the lib, and that import.mjs imports from it).
step "12. lib/parse-adrs.mjs supports v3 + plugin formats and strips issue numbers"
F="$ROOT/scripts/lib/parse-adrs.mjs"
miss=""
grep -q "extractAdrRefs" "$F" || miss="$miss no-extractAdrRefs"
grep -q "frontmatter\|YAML\|^---" "$F" || miss="$miss no-frontmatter-handling"
grep -q "#\\\\d+\|issue\|PR\\\\s*\\\\d" "$F" || miss="$miss no-issue-strip"
grep -q '\*\*Status\*\*' "$F" || miss="$miss no-v3-status-pattern"
grep -q "extractAdrRefs\|parseAdr" "$ROOT/scripts/import.mjs" || miss="$miss import.mjs-not-importing-lib"
[[ -z "$miss" ]] && ok || bad "$miss"

# 13. verify.mjs reports cycles + dangling refs and exits 1 on cycles
step "13. verify.mjs detects cycles + has fail-closed exit"
F="$ROOT/scripts/verify.mjs"
miss=""
grep -q "cycles" "$F" || miss="$miss no-cycle-detection"
grep -q "danglingRefs" "$F" || miss="$miss no-dangling-detection"
grep -q "process.exit(1)" "$F" || miss="$miss no-fail-exit"
[[ -z "$miss" ]] && ok || bad "$miss"

# 14. adr-index skill references the script (not direct MCP loop)
step "14. adr-index skill calls scripts/import.mjs"
F="$ROOT/skills/adr-index/SKILL.md"
grep -q "scripts/import\.mjs\|import\.mjs" "$F" \
  && ok || bad "skill does not invoke import.mjs"

# 15. adr-verify skill references verify.mjs
step "15. adr-verify skill calls scripts/verify.mjs"
F="$ROOT/skills/adr-verify/SKILL.md"
grep -q "scripts/verify\.mjs\|verify\.mjs" "$F" \
  && ok || bad "skill does not invoke verify.mjs"

# 16. reindex.mjs present, executable, syntax-clean (#2666)
step "16. scripts/reindex.mjs executable + syntax-clean"
F="$ROOT/scripts/reindex.mjs"
miss=""
[[ -x "$F" ]] || miss="$miss not-executable"
node --check "$F" 2>/dev/null || miss="$miss syntax-error"
[[ -z "$miss" ]] && ok || bad "$miss"

# 17. reindex.mjs purges via `memory purge`, rebuilds, and asserts a post-condition
step "17. reindex.mjs purges + rebuilds + checks a post-condition"
F="$ROOT/scripts/reindex.mjs"
miss=""
grep -q "memory', 'purge'" "$F" || miss="$miss no-purge-call"
grep -q "postCondition" "$F" || miss="$miss no-post-condition"
grep -q "process.exit(result.postCondition" "$F" || miss="$miss no-fail-exit"
[[ -z "$miss" ]] && ok || bad "$miss"

# 18. adr-reindex skill references reindex.mjs
step "18. adr-reindex skill calls scripts/reindex.mjs"
F="$ROOT/skills/adr-reindex/SKILL.md"
grep -q "scripts/reindex\.mjs\|reindex\.mjs" "$F" \
  && ok || bad "skill does not invoke reindex.mjs"

# 19. shared parser lib exists and both import.mjs + reindex.mjs use it (no duplicated parsing)
step "19. import.mjs and reindex.mjs share scripts/lib/parse-adrs.mjs"
miss=""
[[ -s "$ROOT/scripts/lib/parse-adrs.mjs" ]] || miss="$miss lib-missing"
grep -q "from './lib/parse-adrs.mjs'" "$ROOT/scripts/import.mjs" || miss="$miss import.mjs-not-using-lib"
grep -q "from './lib/parse-adrs.mjs'" "$ROOT/scripts/reindex.mjs" || miss="$miss reindex.mjs-not-using-lib"
[[ -z "$miss" ]] && ok || bad "$miss"

# 20. import.mjs and verify.mjs pass cwd to every memory subprocess call (#2666 point 2)
step "20. import.mjs + verify.mjs pass cwd: ROOT to every npx memory subprocess"
miss=""
imp_calls=$(grep -c "spawnSync('npx'" "$ROOT/scripts/import.mjs")
imp_cwd=$(grep -c "cwd: ROOT" "$ROOT/scripts/import.mjs")
[[ "$imp_calls" -gt 0 && "$imp_cwd" -ge "$imp_calls" ]] || miss="$miss import.mjs($imp_cwd/$imp_calls)"
ver_calls=$(grep -c "spawnSync('npx'" "$ROOT/scripts/verify.mjs")
ver_cwd=$(grep -c "cwd: ROOT" "$ROOT/scripts/verify.mjs")
[[ "$ver_calls" -gt 0 && "$ver_cwd" -ge "$ver_calls" ]] || miss="$miss verify.mjs($ver_cwd/$ver_calls)"
[[ -z "$miss" ]] && ok || bad "$miss"

# 21. ADR-0002 exists with status Accepted
step "21. ADR-0002 (reconcile deleted ADRs) exists with status Accepted"
ADR="$ROOT/docs/adrs/0002-reconcile-deleted-adrs.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR-0002 missing or status != Accepted"

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
