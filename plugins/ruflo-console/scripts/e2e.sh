#!/usr/bin/env bash
# End-to-end test of ruflo-console against real ruflo state and a real Claude Code.
#
#   bash plugins/ruflo-console/scripts/e2e.sh [--target scratch|repo]
#
#   --target scratch (default)  a fresh throwaway project: `ruflo init` from this branch's CLI, then real state.
#   --target repo               this checkout itself: real state is made only with commands that write the gitignored
#                               .claude-flow/ and .swarm/ (never `ruflo init`, which rewrites tracked files), and git
#                               status must be the same before and after.
#
# Steps 1 and 5c-static run anywhere. Steps that start Claude Code need the person's login: they run only with
# RUFLO_E2E_LIVE=1, which copies ~/.claude/.credentials.json into an isolated CLAUDE_CONFIG_DIR (never the real
# ~/.claude) and shreds it on exit. Evidence lands in $RUFLO_E2E_DIR (default: a temp dir), results in results.md.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$PLUGIN/../.." && pwd)"
TARGET=scratch
[[ "${1:-}" == "--target" ]] && TARGET="${2:-scratch}"
[[ "$TARGET" == scratch || "$TARGET" == repo ]] || { echo "--target scratch|repo" >&2; exit 2; }
BASE="${RUFLO_E2E_DIR:-${TMPDIR:-/tmp}/ruflo-console-e2e}"
OUT="$BASE/$(date +%Y%m%dT%H%M%S)-$TARGET"
mkdir -p "$OUT"
CLAUDE="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
if [[ -f "$REPO/v3/@claude-flow/cli/dist/src/index.js" ]]; then CLI="node $REPO/v3/@claude-flow/cli/bin/cli.js"; else CLI="npx --offline -y @claude-flow/cli@latest"; fi
LIVE="${RUFLO_E2E_LIVE:-0}"
FAILED=0
CFG=""
# Issue ids carry the run, so a second run in the same project never collides with the first one's claims.
RUN="$(date +%s)"
PLUGINS=(--plugin-dir "$PLUGIN" --plugin-dir "$REPO/plugins/ruflo-mods" --plugin-dir "$REPO/plugins/ruflo-swarm")
# shellcheck source=e2e-lib.sh
source "$HERE/e2e-lib.sh"
trap 'tmux_stop; shred_config; write_results' EXIT

PROJ="$REPO"
[[ "$TARGET" == scratch ]] && PROJ="$OUT/project"
cli() { (cd "$PROJ" && $CLI "$@") >>"$OUT/cli.log" 2>&1; }
json() { node -e "$1" "$PROJ" 2>/dev/null; }

RUNTIME_DIRS="agents tasks claims swarm hive-mind"

# ---------------------------------------------------------------- 1. real ruflo state
if [[ "$TARGET" == repo ]]; then
  git -C "$REPO" status --porcelain >"$OUT/git-before.txt"
  git -C "$REPO" diff --stat -- .claude/helpers v3/@claude-flow/cli/.claude/helpers >"$OUT/helpers-before.txt"
  # ruflo's runtime stores are gitignored, so git cannot put them back: keep a copy and restore it at the end, or each
  # run's agents and claims pile up in the repo for the next run (and the next session) to see.
  for dir in $RUNTIME_DIRS; do
    [[ -d "$REPO/.claude-flow/$dir" ]] && mkdir -p "$OUT/runtime-before" && cp -a "$REPO/.claude-flow/$dir" "$OUT/runtime-before/"
  done
  # The repo's classic hooks start ruflo's worker daemon, which keeps rewriting the tracked agentdb.rvf.lock long after
  # the run. Note whether one was already running, so the run stops only a daemon it started.
  DAEMON_BEFORE=0
  kill -0 "$(cat "$REPO/.claude-flow/daemon.pid" 2>/dev/null || echo 0)" 2>/dev/null && DAEMON_BEFORE=1
else
  mkdir -p "$PROJ" && git -C "$PROJ" init -q
  check S1 "ruflo init (branch CLI) makes a ruflo project, classic hooks included" cli.log cli init --force
fi

check S1 "swarm init hierarchical" cli.log cli swarm init --topology hierarchical --max-agents 6 --strategy specialized
for name in e2e-coder e2e-tester e2e-reviewer; do check S1 "agent spawn $name" cli.log cli agent spawn --type "${name#e2e-}" --name "$name"; done
check S1 "task create" cli.log cli task create --type implementation --description "e2e: build the console"
check S1 "a task with hostile text (ESC, bidi override) is stored as given" cli.log cli task create --type implementation --description "$(printf 'evil\033[31m\u202eTEXT')"

# The agent store keeps type and id, not the --name given at spawn: agents are found by type, newest first.
AGENT() { json "const s=require(process.argv[1]+'/.claude-flow/agents/store.json');const a=Object.values(s.agents).filter(a=>a.agentType==='$1').at(-1);process.stdout.write(a?a.agentId:'')"; }
CODER="$(AGENT coder)"
TESTER="$(AGENT tester)"
TASK="$(json "const s=require(process.argv[1]+'/.claude-flow/tasks/store.json');const t=Object.values(s.tasks).filter(t=>String(t.description).startsWith('e2e: build')).at(-1);process.stdout.write(t?t.taskId:'')")"
[[ -n "$CODER" && -n "$TESTER" && -n "$TASK" ]] && pass S1 "agent and task ids read back from disk" cli.log || fail S1 "agent and task ids read back from disk" cli.log
exec_tool() { cli mcp exec -t "$1" -p "$2"; }
check S1 "claims_claim the task for e2e-coder" cli.log exec_tool claims_claim "{\"issueId\":\"$TASK\",\"claimant\":\"agent:$CODER:coder\"}"
release_two() { exec_tool claims_claim "{\"issueId\":\"e2e-issue-2-$RUN\",\"claimant\":\"agent:$TESTER:tester\"}" && exec_tool claims_release "{\"issueId\":\"e2e-issue-2-$RUN\",\"claimant\":\"agent:$TESTER:tester\"}"; }
handoff_three() { exec_tool claims_claim "{\"issueId\":\"e2e-issue-3-$RUN\",\"claimant\":\"agent:$CODER:coder\"}" && exec_tool claims_handoff "{\"issueId\":\"e2e-issue-3-$RUN\",\"from\":\"agent:$CODER:coder\",\"to\":\"agent:$TESTER:tester\"}"; }
mk_hive() { cli hive-mind init --topology hierarchical && cli hive-mind consensus --action propose --type design --value 'e2e: adopt the console'; }
mk_memory() { cli memory init; cli memory store --key e2e-k1 --value 'console e2e one' --namespace e2e && cli memory store --key e2e-k2 --value 'console e2e two' --namespace e2e && cli memory search --query 'console e2e'; }
# Policy administration (init, rules, budgets) refuses a non-interactive caller by design ("requires an interactive
# local terminal"); the e2e does not fake a terminal to get past that guard. It reads the policy status instead.
mk_policy() { cli policy status; }
check S1 "claims_claim + claims_release e2e-issue-2-$RUN" cli.log release_two
check S1 "claims_claim + claims_handoff e2e-issue-3-$RUN coder → tester" cli.log handoff_three
check S1 "hive-mind init + a proposal" cli.log mk_hive
check S1 "memory store x2 + search" cli.log mk_memory
check S1 "hooks route" cli.log cli hooks route --task "write unit tests for the parser" --format json
check S1 "policy status reads (adding a rule needs a person at a terminal, by design)" cli.log mk_policy
CLAIM_IDS="$(json "const s=require(process.argv[1]+'/.claude-flow/claims/claims.json');process.stdout.write(Object.keys(s.claims).join(','))")"
MEM_N="$( (cd "$PROJ" && $CLI memory stats --format json 2>/dev/null) | node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{const j=JSON.parse(t.slice(t.indexOf('{')));process.stdout.write(String(j.entries.total))})" 2>/dev/null)"
echo "claims=$CLAIM_IDS memory=$MEM_N coder=$CODER tester=$TESTER task=$TASK" >"$OUT/state.txt"
if [[ ",$CLAIM_IDS," == *",$TASK,"* && ",$CLAIM_IDS," == *",e2e-issue-3-$RUN,"* && ",$CLAIM_IDS," != *",e2e-issue-2-$RUN,"* ]]; then
  pass S1 "claims.json holds the claim and the handoff, not the released one" state.txt
else
  fail S1 "claims.json holds the claim and the handoff, not the released one" state.txt
fi

if [[ "$LIVE" != 1 ]]; then
  for step in S2 S3 S4 S5; do skip "$step" "needs RUFLO_E2E_LIVE=1 (starts Claude Code with the person's login)" -; done
  [[ "$TARGET" == repo ]] && { git -C "$REPO" status --porcelain >"$OUT/git-after.txt"; check S6 "git status unchanged by the run" git-after.txt diff -q "$OUT/git-before.txt" "$OUT/git-after.txt"; }
  exit $((FAILED > 0))
fi

# Claude Code keys a worktree's trust by its main checkout: seed both.
MAIN="$(cd "$PROJ" && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null | sed 's#/\.git$##')"
make_config "$PROJ" "$OUT/empty" ${MAIN:+"$MAIN"}

# ---------------------------------------------------------------- 2. headless: /ruflo answers from the real state
claude_p s2-status "$PROJ" "${PLUGINS[@]}" "/ruflo status"
check S2 "the module loaded" s2-status.log has "$OUT/s2-status.log" "hooks module ruflo-console@inline loaded"
check S2 "/ruflo registered and answered (topology, claims count)" s2-status.txt has "$OUT/s2-status.txt" "hierarchical"
claude_p s2-help "$PROJ" "${PLUGINS[@]}" "/ruflo help"
check S2 "/ruflo help lists the swarm subcommands" s2-help.txt has "$OUT/s2-help.txt" "/ruflo swarm pane|status|topology|claims|consensus"
claude_p s2-mods "$PROJ" "${PLUGINS[@]}" "/ruflo mods"
check S2 "/ruflo mods answered by ruflo-mods" s2-mods.txt has "$OUT/s2-mods.txt" "owns:"
claude_p s2-swarm "$PROJ" "${PLUGINS[@]}" "/ruflo swarm status"
check S2 "/ruflo swarm status answered by ruflo-swarm" s2-swarm.txt has "$OUT/s2-swarm.txt" "agents:"
claude_p s2-alias "$PROJ" "${PLUGINS[@]}" "/ruflo-console help"
check S2 "/ruflo-console is kept (ADR-406) and answers as /ruflo" s2-alias.txt has "$OUT/s2-alias.txt" "/ruflo swarm pane|status|topology|claims|consensus"
claude_p s2-view "$PROJ" "${PLUGINS[@]}" "/ruflo claims"
check S2 "headless /ruflo <view> answers the view as text" s2-view.txt has "$OUT/s2-view.txt" "$TASK"
claude_p s2-dump-overview "$PROJ" "${PLUGINS[@]}" "/ruflo dump overview"
check S2 "dump waits for its CLI probes (memory DB is measured, not 'asking')" s2-dump-overview.txt grep -qE "^memory DB +${MEM_N} entries" "$OUT/s2-dump-overview.txt"
claude_p s2-commands "$PROJ" "${PLUGINS[@]}" "/ruflo commands swarm"
check S2 "/ruflo commands browses the ADR-406 catalog" s2-commands.txt grep -qE "[0-9]+ of [0-9]+ commands in the ruflo command catalog \(ADR-406" "$OUT/s2-commands.txt"
claude_p s2-dump-swarm "$PROJ" "${PLUGINS[@]}" "/ruflo dump swarm"
check S2 "swarm view shows the real agents (ids from the store)" s2-dump-swarm.txt has "$OUT/s2-dump-swarm.txt" "$CODER"
claude_p s2-dump-claims "$PROJ" "${PLUGINS[@]}" "/ruflo dump claims"
check S2 "claims view shows the claim held by e2e-coder" s2-dump-claims.txt has "$OUT/s2-dump-claims.txt" "$TASK"
check S2 "claims view shows the handoff to the tester" s2-dump-claims.txt has "$OUT/s2-dump-claims.txt" "→ tester"
claude_p s2-dump-memory "$PROJ" "${PLUGINS[@]}" "/ruflo dump memory"
check S2 "memory view shows the CLI's entry count ($MEM_N)" s2-dump-memory.txt grep -qE "^entries +${MEM_N} " "$OUT/s2-dump-memory.txt"
for name in s2-status s2-help s2-mods s2-swarm s2-alias s2-view s2-commands s2-dump-overview s2-dump-swarm s2-dump-claims s2-dump-memory; do check S2 "no refused tree or failed hook ($name)" "$name.log" clean_log "$OUT/$name.log"; done

# ---------------------------------------------------------------- 3. interactive pane under tmux
tmux_start "$PROJ" "$OUT/s3.log" "${PLUGINS[@]}"
check S3 "the session starts (MCP servers rejected, prompt ready)" s3-open.txt settle_dialogs
tmux_cmd "/ruflo"
check S3 "/ruflo opens the pane holding the keys (title strip, tabs, keys on)" s3-open.txt wait_for s3-open "keys on" 20
tmux_keys 3
check S3 "hotkey 3 switches to Claims" s3-claims.txt wait_for s3-claims "Claims ─" 10
tmux_keys p
check S3 "hotkey p opens the palette" s3-palette.txt wait_for s3-palette "Palette ─" 10
tmux_keys Escape
sleep 1
tmux_cmd "/ruflo claims"
wait_for s3-claims2 "Claims ─" 10 >/dev/null
# Walk the selection to this run's claim: in the repo, other claims may come first.
for _ in $(seq 1 12); do
  tmux_shot s3-pick
  grep -q "picked claim $TASK" "$OUT/s3-pick.txt" && break
  tmux_keys j
  sleep 1
done
check S3 "j walks the selection to this run's claim" s3-pick.txt has "$OUT/s3-pick.txt" "picked claim $TASK"
tmux_keys l
check S3 "release asks to confirm" s3-confirm.txt wait_for s3-confirm "Confirm: release" 10
tmux_keys y
check S3 "release ran and the pane saw it on disk" s3-released.txt wait_for s3-released "· on disk" 30
AFTER="$(json "const s=require(process.argv[1]+'/.claude-flow/claims/claims.json');process.stdout.write(Object.keys(s.claims).join(','))")"
echo "claims after release: $AFTER" >>"$OUT/state.txt"
[[ ",$AFTER," != *",$TASK,"* ]] && pass S3 "re-read from disk: $TASK no longer claimed" state.txt || fail S3 "re-read from disk: $TASK still claimed" state.txt
tmux_cmd "/ruflo swarm"
wait_for s3-swarm "Swarm ─" 10 >/dev/null
sleep 1
mtimes() { stat -c %Y "$PROJ"/.claude-flow/agents/store.json "$PROJ"/.claude-flow/claims/claims.json "$PROJ"/.claude-flow/swarm/swarm-state.json 2>/dev/null | tr '\n' ' '; }
BEFORE_MT="$(mtimes)"
tmux_shot s3-anim-a
# The heartbeat and the title sweep each rest part of their cycle: up to eight captures over ~3 s, one must differ.
MOVED=0
for _ in $(seq 1 8); do
  sleep 0.35
  tmux_shot s3-anim-b
  if ! diff -q <(stable s3-anim-a) <(stable s3-anim-b) >/dev/null; then MOVED=1; break; fi
done
[[ "$BEFORE_MT" == "$(mtimes)" ]] && pass S3 "the swarm files did not change between the captures" state.txt || fail S3 "the swarm files changed between the captures" state.txt
if ((MOVED)); then pass S3 "captures differ while the data is unchanged (animation runs)" s3-anim-a.ansi; else fail S3 "eight captures over ~3 s identical: no animation" s3-anim-a.ansi; fi
tmux_cmd "/ruflo close"
sleep 2
tmux_shot s3-closed-a
sleep 1
tmux_shot s3-closed-b
if diff -q <(stable s3-closed-a) <(stable s3-closed-b) >/dev/null; then pass S3 "closed: two captures identical (animation stopped)" s3-closed-a.ansi; else fail S3 "closed: the screen still changes" s3-closed-a.ansi; fi
check S3 "no refused tree or failed hook" s3.log clean_log "$OUT/s3.log"
tmux_stop

# ---------------------------------------------------------------- 3b. inline placement at 100 columns
TMUX_COLUMNS=100 tmux_start "$PROJ" "$OUT/s3b.log" "${PLUGINS[@]}"
check S3b "100 columns: the session starts" s3b-start.txt settle_dialogs
tmux_cmd "/ruflo claims"
check S3b "100 columns: the pane seats inline (no dock) and opens on Claims" s3b-inline.txt wait_for s3b-inline "Claims ─" 20
INLINE_ROWS=$(awk '/╭/{s=NR} /╰/{e=NR} END{print (s && e) ? e-s-1 : 0}' "$OUT/s3b-inline.txt")
echo "inline pane at 100 columns: Claims asked for 30 rows, the layout gave $INLINE_ROWS" >"$OUT/s3b-rows.txt"
check S3b "100 columns: the whole pane is on screen, both borders (asked 30 rows, got $INLINE_ROWS)" s3b-inline.txt grep -q "╰" "$OUT/s3b-inline.txt"
check S3b "100 columns: given fewer rows, the controls stay on screen (compact: buttons under the tabs)" s3b-inline.txt has "$OUT/s3b-inline.txt" "[ Close ]"
check S3b "100 columns: the prompt is still on screen below the pane" s3b-inline.txt grep -q "^❯" "$OUT/s3b-inline.txt"
check S3b "no refused tree or failed hook" s3b.log clean_log "$OUT/s3b.log"
tmux_stop

# ---------------------------------------------------------------- 4. auto-start from project settings, no --plugin-dir
SETTINGS="$PROJ/.claude/settings.local.json"
[[ -f "$SETTINGS" ]] && cp "$SETTINGS" "$OUT/settings.local.json.before"
mkdir -p "$PROJ/.claude"
cat >"$SETTINGS" <<JSON
{
  "extraKnownMarketplaces": { "ruflo": { "source": { "source": "directory", "path": "$REPO" } } },
  "enabledPlugins": { "ruflo-mods@ruflo": true, "ruflo-swarm@ruflo": true, "ruflo-console@ruflo": true },
  "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" }
}
JSON
cp "$SETTINGS" "$OUT/settings.local.json"
tmux_start "$PROJ" "$OUT/s4.log"
settle_dialogs >/dev/null
check S4 "the band shows at session start" s4-start.txt wait_for s4-start "◆ ruflo ·" 40
check S4 "ruflo-console loaded from the directory marketplace (ruflo-console@ruflo)" s4.log has "$OUT/s4.log" "hooks module ruflo-console@ruflo loaded"
check S4 "the cockpit auto-opened (200 columns: it docks)" s4-start.txt wait_for s4-start "1: Ovr" 15
check S4 "it did not take the keys" s4-start.txt has "$OUT/s4-start.txt" "keys off"
check S4 "no refused tree or failed hook" s4.log clean_log "$OUT/s4.log"
tmux_stop
# After an interactive start the marketplace is known to this config, so a headless run loads from it too.
claude_p s4-plugins "$PROJ" "/ruflo dump plugins"
if grep -q "hooks module ruflo-console@ruflo loaded" "$OUT/s4-plugins.log"; then
  pass S4 "settings.local.json alone loads ruflo-console@ruflo from the directory marketplace" s4-plugins.log
else
  fail S4 "settings.local.json did not load ruflo-console@ruflo (see s4-plugins.log)" s4-plugins.log
fi
check S4 "plugins view lists the working tree's marketplace (40+ plugins)" s4-plugins.txt grep -qE "lists (4[0-9]|[5-9][0-9]) plugins" "$OUT/s4-plugins.txt"
if [[ -f "$OUT/settings.local.json.before" ]]; then cp "$OUT/settings.local.json.before" "$SETTINGS"; else rm -f "$SETTINGS"; fi

# ---------------------------------------------------------------- 5. negative paths
claude_p s5-classic "$PROJ" --model haiku "Reply with the single word ok."
check S5 "no mod loaded: classic hooks still fire (UserPromptSubmit)" s5-classic.log grep -qE "Hook UserPromptSubmit.*success" "$OUT/s5-classic.log"
check S5 "no mod loaded: no hooks module in the log" s5-classic.log lacks "$OUT/s5-classic.log" "hooks module ruflo-console"
check S5 "hostile task text rendered without ESC or bidi override" s2-dump-claims.txt bash -c "grep -q 'evil' '$OUT/s2-dump-claims.txt' && ! grep -qP '\x1b|\x{202e}' '$OUT/s2-dump-claims.txt'"
mkdir -p "$OUT/empty"
for view in overview swarm claims federation plugins learning metaharness memory cost timeline approvals events; do
  claude_p "s5-empty-$view" "$OUT/empty" "${PLUGINS[@]}" "/ruflo dump $view"
  check S5 "empty project: $view draws, nothing undefined or NaN" "s5-empty-$view.txt" bash -c "test -s '$OUT/s5-empty-$view.txt' && ! grep -qE 'undefined|NaN|TypeError' '$OUT/s5-empty-$view.txt'"
done
check S5 "empty project: overview says n/a, not 0" s5-empty-overview.txt has "$OUT/s5-empty-overview.txt" "n/a — no swarm on disk"

# ---------------------------------------------------------------- 6. the repo is untouched
if [[ "$TARGET" == repo ]]; then
  if ((DAEMON_BEFORE == 0)) && kill -0 "$(cat "$REPO/.claude-flow/daemon.pid" 2>/dev/null || echo 0)" 2>/dev/null; then
    (cd "$REPO" && timeout 60 node "$REPO/v3/@claude-flow/cli/bin/cli.js" daemon stop >>"$OUT/cli.log" 2>&1) && echo "stopped the ruflo daemon the run started" >>"$OUT/git-restored.txt"
  fi
  git -C "$REPO" status --porcelain >"$OUT/git-after.txt"
  git -C "$REPO" diff --stat -- .claude/helpers v3/@claude-flow/cli/.claude/helpers >"$OUT/helpers-after.txt"
  check S6 "git status unchanged (settings.local.json is gitignored and removed)" git-after.txt diff -q "$OUT/git-before.txt" "$OUT/git-after.txt"
  check S6 ".claude/helpers unchanged" helpers-after.txt diff -q "$OUT/helpers-before.txt" "$OUT/helpers-after.txt"
  check S6 "settings.local.json is gitignored" - git -C "$REPO" check-ignore -q .claude/settings.local.json
  # A tracked file the run changed (say ruflo's memory writing agentdb.rvf) is reported above, then put back, but only
  # when it was clean before the run: the run never discards a change it did not make.
  comm -13 <(sort "$OUT/git-before.txt") <(sort "$OUT/git-after.txt") | awk '$1 == "M" { print $2 }' | while read -r path; do
    git -C "$REPO" checkout -- "$path" && echo "restored $path" >>"$OUT/git-restored.txt"
  done
  for dir in $RUNTIME_DIRS; do
    rm -rf "${REPO:?}/.claude-flow/$dir"
    [[ -d "$OUT/runtime-before/$dir" ]] && cp -a "$OUT/runtime-before/$dir" "$REPO/.claude-flow/"
  done
  echo "restored .claude-flow/{${RUNTIME_DIRS// /,}} to their state before the run" >>"$OUT/git-restored.txt"
fi

echo "evidence: $OUT"
exit $((FAILED > 0))
