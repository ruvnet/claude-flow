#!/usr/bin/env bash
# ADR-404 Amendment 1 — end-to-end check of mods default-on in `ruflo init`,
# against the BUILT CLI and the real `claude`, with an isolated HOME and
# CLAUDE_CONFIG_DIR per scenario (never the real ~/.claude). Needs network
# (it clones github.com/ruvnet/ruflo) and is not part of `npm test`.
#
#   bash scripts/e2e-mods-init.sh                    # every scenario but the live load
#   RUFLO_E2E_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=… bash scripts/e2e-mods-init.sh
#                                                    # also 5: a live `claude -p "/ruflo-mods"`
#
# The live load needs a logged-in Claude: CLAUDE_CODE_OAUTH_TOKEN (from
# `claude setup-token`) or ANTHROPIC_API_KEY in the environment. Nothing is
# copied from ~/.claude and no credential is ever printed. Without the opt-in
# the step is reported as SKIP. Prints one PASS/FAIL line per assertion and
# exits 1 if any failed.
set -uo pipefail

CLI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$CLI_DIR/bin/cli.js"
[[ -f "$CLI_DIR/dist/src/index.js" ]] || { echo "build the CLI first (npm run build)"; exit 2; }
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || true)}"
[[ -x "$CLAUDE_BIN" ]] || { echo "no claude binary (set CLAUDE_BIN)"; exit 2; }
NODE_BIN="$(command -v node)"
STALE_TAG="${STALE_TAG:-v3.38.21}"
REPO_ROOT="$(cd "$CLI_DIR/../../.." && pwd)"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/ruflo-e2e-mods.XXXXXX")"
cleanup() {
  # The initialized projects' classic hooks start npx children (statusline,
  # funnel refresh); stop any still running in the scratch tree before removing it.
  for p in /proc/[0-9]*; do [[ "$(readlink "$p/cwd" 2>/dev/null)" == "$WORK"* ]] && kill "${p#/proc/}" 2>/dev/null; done
  [[ -n "${E2E_KEEP:-}" ]] || { sleep 1; chmod -R u+w "$WORK" 2>/dev/null; rm -rf "$WORK"; }
}
trap cleanup EXIT
unset CI VITEST CLAUDE_CONFIG_DIR

# Two PATHs: one where `claude` resolves, one where it does not. Both hold a
# fail-fast `codex` stub so init never runs a real `codex plugin marketplace add`.
mkdir -p "$WORK/bin-with" "$WORK/bin-without"
for d in bin-with bin-without; do printf '#!/bin/sh\nexit 1\n' > "$WORK/$d/codex"; chmod +x "$WORK/$d/codex"; ln -s "$NODE_BIN" "$WORK/$d/node"; done
ln -s "$CLAUDE_BIN" "$WORK/bin-with/claude"
BASE_PATH="/usr/local/bin:/usr/bin:/bin"
if PATH="$WORK/bin-without:$BASE_PATH" command -v claude >/dev/null; then echo "a claude is on $BASE_PATH; the negative scenario cannot run"; exit 2; fi

fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
section() { echo; echo "== $1"; }

# One isolated world per scenario: HOME, CLAUDE_CONFIG_DIR, project.
world() {
  local name="$1"
  W="$WORK/$name"; mkdir -p "$W/home" "$W/cfg" "$W/proj"
  export HOME="$W/home" CLAUDE_CONFIG_DIR="$W/cfg" USERPROFILE="$W/home" CODEX_HOME="$W/home/.codex"
  export PATH="$WORK/bin-with:$BASE_PATH"
}
ruflo() { (cd "$W/proj" && "$NODE_BIN" "$CLI" "$@"); }
cc() { (cd "$W/proj" && claude "$@"); }
# js <expr using s (settings.json), L (plugin list)>: evaluates to true/false.
js() { "$NODE_BIN" -e "
  const fs = require('fs');
  const rd = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return undefined; } };
  const s = rd('$W/proj/.claude/settings.json') ?? {};
  const L = rd('$W/plugin-list.json') ?? [];
  const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
  const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  const has = (id) => L.some((p) => p.id === id && p.enabled !== false);
  process.exit(($1) ? 0 : 1);"; }

MODS="['ruflo-mods@ruflo','ruflo-swarm@ruflo','ruflo-console@ruflo']"

# ---------------------------------------------------------------------------
section "1. fresh ruflo init (mods default-on, plugin install at project scope)"
world fresh
ruflo init --no-signup --no-global --no-codex-detect > "$W/init.log" 2>&1; rc=$?
check "init exits 0" "[[ $rc -eq 0 ]]"
check "settings.json enables all three plugins" "js \"$MODS.every((id) => s.enabledPlugins?.[id] === true)\""
check "settings.json declares extraKnownMarketplaces.ruflo" "js \"s.extraKnownMarketplaces?.ruflo?.source?.repo === 'ruvnet/ruflo'\""
check "settings.json sets CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1" "js \"s.env?.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS === '1'\""
check "classic hooks still written" "js \"JSON.stringify(s.hooks ?? {}).includes('hook-handler.cjs')\""
check "init ran marketplace add at project scope" "grep -q '✓ claude plugin marketplace add ruvnet/ruflo --scope project' '$W/init.log'"
check "init installed ruflo-mods, ruflo-swarm and ruflo-console" "grep -q '✓ claude plugin install ruflo-mods@ruflo --scope project' '$W/init.log' && grep -q '✓ claude plugin install ruflo-swarm@ruflo --scope project' '$W/init.log' && grep -q '✓ claude plugin install ruflo-console@ruflo --scope project' '$W/init.log'"
check "init states what loads and the rollout-switch fallback" "grep -q 'rollout switch off, they do nothing and the classic hooks keep every event' '$W/init.log'"
cc plugin list --json > "$W/plugin-list.json" 2>/dev/null
check "claude plugin list: ruflo-mods@ruflo installed and enabled" "js \"has('ruflo-mods@ruflo')\""
check "claude plugin list: ruflo-swarm@ruflo installed and enabled" "js \"has('ruflo-swarm@ruflo')\""
check "claude plugin list: ruflo-console@ruflo installed and enabled" "js \"has('ruflo-console@ruflo')\""
ruflo mods status --json > "$W/status.json" 2>/dev/null
check "mods status: ruflo-console loads (not pending)" "! grep -A3 'plugin ruflo-console@ruflo' '$W/status.json' | grep -q pending"
ruflo mods doctor > "$W/doctor.log" 2>&1; rc=$?
check "mods doctor exits 0" "[[ $rc -eq 0 ]]"
FRESH_W="$W"

# ---------------------------------------------------------------------------
section "2. stale marketplace clone ($STALE_TAG, before ruflo-mods) — doctor fails, upgrade repairs"
world stale
mkdir -p "$W/proj/.claude"
echo '{}' > "$W/proj/.claude/settings.json"
claude plugin marketplace add ruvnet/ruflo > "$W/seed.log" 2>&1
CLONE="$W/cfg/plugins/marketplaces/ruflo"
git -C "$CLONE" fetch -q --depth=1 origin tag "$STALE_TAG" && git -C "$CLONE" reset -q --hard "$STALE_TAG"
check "seeded clone is $STALE_TAG without plugins/ruflo-mods" "[[ ! -e '$CLONE/plugins/ruflo-mods' ]]"
ruflo init upgrade --mods --no-plugin-install > "$W/settings-only.log" 2>&1   # what 3.50.0 left behind: settings only
ruflo mods doctor > "$W/doctor-stale.log" 2>&1; rc=$?
check "mods doctor exits 1 on the stale clone" "[[ $rc -eq 1 ]]"
check "doctor names the stale clone and the unknown command" "grep -q 'is stale' '$W/doctor-stale.log' && grep -q '/ruflo-mods is an unknown command' '$W/doctor-stale.log'"
check "doctor prints the exact fix" "grep -q 'claude plugin marketplace update ruflo && claude plugin install ruflo-mods@ruflo --scope project' '$W/doctor-stale.log'"
ruflo doctor --component mods > "$W/doctor-component.log" 2>&1; rc=$?
check "ruflo doctor --component mods exits 1 too" "[[ $rc -eq 1 ]]"
ruflo init upgrade --mods > "$W/repair.log" 2>&1
check "upgrade --mods ran marketplace update" "grep -q '✓ claude plugin marketplace update ruflo' '$W/repair.log'"
check "the refreshed clone carries plugins/ruflo-mods" "[[ -f '$CLONE/plugins/ruflo-mods/.claude-plugin/plugin.json' ]]"
ruflo mods doctor > "$W/doctor-after.log" 2>&1; rc=$?
check "mods doctor exits 0 after the repair" "[[ $rc -eq 0 ]]"
cc plugin list --json > "$W/plugin-list.json" 2>/dev/null
check "claude plugin list now has ruflo-mods@ruflo" "js \"has('ruflo-mods@ruflo')\""

# ---------------------------------------------------------------------------
section "3. ruflo init upgrade --mods on an existing project keeps every user key"
world upgrade
mkdir -p "$W/proj/.claude"
cat > "$W/proj/.claude/settings.json" <<'JSON'
{
  "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo mine" }] }] },
  "env": { "MY_VAR": "keep" },
  "enabledPlugins": { "mine@elsewhere": true, "ruflo-swarm@ruflo": false },
  "permissions": { "allow": ["Bash(ls)"] }
}
JSON
cp "$W/proj/.claude/settings.json" "$W/user.json"
ruflo init upgrade --mods > "$W/upgrade1.log" 2>&1
U="$W/user.json"
check "user hooks, permissions and MY_VAR unchanged" "js \"same(s.hooks, rd('$U').hooks) && same(s.permissions, rd('$U').permissions) && s.env.MY_VAR === 'keep'\""
check "mine@elsewhere kept; ruflo-swarm left false (the user's choice)" "js \"s.enabledPlugins['mine@elsewhere'] === true && s.enabledPlugins['ruflo-swarm@ruflo'] === false\""
check "only the new keys added (mods, console, marketplace, env)" "js \"s.enabledPlugins['ruflo-mods@ruflo'] === true && s.enabledPlugins['ruflo-console@ruflo'] === true && s.extraKnownMarketplaces.ruflo && s.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS === '1'\""
check "ruflo-swarm (user set false) was not installed" "! grep -q 'plugin install ruflo-swarm@ruflo' '$W/upgrade1.log'"
check "upgrade reports what it added" "grep -q 'enabledPlugins\[\"ruflo-mods@ruflo\"\] = true' '$W/upgrade1.log'"
cp "$W/proj/.claude/settings.json" "$W/after1.json"
ruflo init upgrade --mods > "$W/upgrade2.log" 2>&1
check "re-run: settings JSON-equal (idempotent)" "js \"same(s, rd('$W/after1.json'))\""
check "re-run: reports nothing changed" "grep -q 'already enabled' '$W/upgrade2.log'"

# ---------------------------------------------------------------------------
section "4. --no-mods writes nothing; mods uninstall reverses exactly"
world nomods
ruflo init --no-mods --no-signup --no-global --no-codex-detect > "$W/init.log" 2>&1
check "--no-mods: no mod plugin, marketplace or env key" "js \"!s.enabledPlugins?.['ruflo-mods@ruflo'] && !s.extraKnownMarketplaces?.ruflo && !s.env?.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS\""
check "--no-mods: no install record" "[[ ! -e '$W/proj/.claude-flow/mods/install.json' ]]"
W="$WORK/upgrade"
ruflo mods uninstall > "$W/uninstall.log" 2>&1
check "uninstall after upgrade: settings JSON-equal to the user's original" "js \"same(s, rd('$W/user.json'))\""

# ---------------------------------------------------------------------------
section "6. no claude on PATH: init succeeds and prints the manual commands"
world noclaude
export PATH="$WORK/bin-without:$BASE_PATH"
ruflo init --no-signup --no-global --no-codex-detect > "$W/init.log" 2>&1; rc=$?
check "init exits 0 without claude" "[[ $rc -eq 0 ]]"
check "settings still enable the plugins" "js \"s.enabledPlugins?.['ruflo-mods@ruflo'] === true\""
check "init prints the manual commands" "grep -q 'No runnable claude binary on PATH' '$W/init.log' && grep -q 'claude plugin install ruflo-mods@ruflo --scope project' '$W/init.log'"

# ---------------------------------------------------------------------------
section "7. ruflo mods install --source local: this checkout as a directory marketplace (dogfooding)"
world local
ruflo mods install --source local --marketplace-path "$REPO_ROOT" > "$W/local.log" 2>&1; rc=$?
check "install --source local exits 0" "[[ $rc -eq 0 ]]"
check "settings.local.json declares a directory marketplace at the checkout" "$NODE_BIN -e \"const s=require('$W/proj/.claude/settings.local.json');process.exit(s.extraKnownMarketplaces.ruflo.source.source==='directory'&&s.extraKnownMarketplaces.ruflo.source.path==='$REPO_ROOT'?0:1)\""
check "ran marketplace add <checkout>, and no plugin install" "grep -q '✓ claude plugin marketplace add $REPO_ROOT --scope local' '$W/local.log' && ! grep -q 'claude plugin install' '$W/local.log'"
check "nothing was cloned into the config dir" "[[ ! -e '$W/cfg/plugins/marketplaces/ruflo' ]]"
ruflo mods doctor > "$W/doctor-local.log" 2>&1; rc=$?
check "mods doctor exits 0 and reports the directory source" "[[ $rc -eq 0 ]] && grep -q 'ruflo marketplace: directory $REPO_ROOT' '$W/doctor-local.log'"
LOCAL_W="$W"

# ---------------------------------------------------------------------------
section "5. live load: claude -p \"/ruflo-mods\" in the initialized project (RUFLO_E2E_LIVE=1)"
if [[ -z "${RUFLO_E2E_LIVE:-}" ]]; then
  echo "SKIP  live load: needs a logged-in Claude; set RUFLO_E2E_LIVE=1 with CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY"
elif [[ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}${ANTHROPIC_API_KEY:-}" ]]; then
  fail "live load: RUFLO_E2E_LIVE=1 but neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set"
else
  for target in "$FRESH_W" "$LOCAL_W"; do
    W="$target"; export HOME="$W/home" CLAUDE_CONFIG_DIR="$W/cfg" PATH="$WORK/bin-with:$BASE_PATH"
    label="$(basename "$W")"
    rm -f "$W/proj/.claude-flow/mods/session.json"
    (cd "$W/proj" && timeout 180 claude -p "/ruflo-mods" < /dev/null > "$W/live.txt" 2>&1)
    check "live ($label): /ruflo-mods answers in claude -p (owns: …)" "grep -q 'owns:' '$W/live.txt'"
    check "live ($label): the mod wrote its heartbeat" "[[ -f '$W/proj/.claude-flow/mods/session.json' ]]"
    sed -n '1,3p' "$W/live.txt" | sed 's/^/      /'
  done
fi

# ---------------------------------------------------------------------------
section "8. mods uninstall on the initialized project: claude plugin uninstall + settings keys"
W="$FRESH_W"; export HOME="$W/home" CLAUDE_CONFIG_DIR="$W/cfg" PATH="$WORK/bin-with:$BASE_PATH"
ruflo mods uninstall > "$W/uninstall.log" 2>&1; rc=$?
check "uninstall exits 0" "[[ $rc -eq 0 ]]"
check "ran claude plugin uninstall for ruflo-mods and ruflo-swarm at project scope" "grep -q '✓ claude plugin uninstall ruflo-mods@ruflo --scope project' '$W/uninstall.log' && grep -q '✓ claude plugin uninstall ruflo-swarm@ruflo --scope project' '$W/uninstall.log'"
cc plugin list --json > "$W/plugin-list.json" 2>/dev/null
check "claude plugin list no longer has ruflo-mods or ruflo-swarm" "js \"!has('ruflo-mods@ruflo') && !has('ruflo-swarm@ruflo')\""
check "settings.json has none of the mod keys" "js \"!s.enabledPlugins?.['ruflo-mods@ruflo'] && !s.extraKnownMarketplaces?.ruflo && !s.env?.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS\""
check "classic hooks still there" "js \"JSON.stringify(s.hooks ?? {}).includes('hook-handler.cjs')\""

echo
echo "$fails failure(s)"
[[ $fails -eq 0 ]]
