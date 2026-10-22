# Helpers for e2e.sh (sourced). Results, an isolated Claude Code config, tmux driving, and screen regions.
# Never prints a credential; the copied one is shredded by the EXIT trap e2e.sh installs.

RESULTS=()

result() { # status step assertion where
  RESULTS+=("| $2 | $3 | $1 | $4 |")
  printf '%-4s %-6s %s  (%s)\n' "$1" "$2" "$3" "$4"
}
pass() { result PASS "$@"; }
fail() { result FAIL "$@"; FAILED=$((FAILED + 1)); }
skip() { result SKIP "$@"; }

# check STEP ASSERTION WHERE COMMAND...: PASS when the command succeeds.
check() {
  local step="$1" what="$2" where="$3"
  shift 3
  if "$@" >/dev/null 2>&1; then pass "$step" "$what" "$where"; else fail "$step" "$what" "$where"; fi
}

has() { grep -qF -- "$2" "$1"; }   # has FILE TEXT
lacks() { ! grep -qF -- "$2" "$1"; }

write_results() {
  {
    echo "# ruflo-console e2e — target $TARGET — $(date -u +%FT%TZ)"
    echo
    echo "Claude Code $("$CLAUDE" --version 2>/dev/null | head -1) · CLI $($CLI --version 2>/dev/null | tail -1) · live=${RUFLO_E2E_LIVE:-0}"
    echo
    echo "| step | assertion | result | captured in |"
    echo "|---|---|---|---|"
    printf '%s\n' "${RESULTS[@]}"
  } >"$OUT/results.md"
}

# An isolated config dir: the person's login copied 0600 (shredded on exit), onboarding done, the project trusted,
# and the project's .mcp.json servers disabled (an `npx @claude-flow/cli@latest mcp start` server can rewrite helpers).
make_config() { # make_config PROJECT_DIR...
  CFG="$(mktemp -d "$OUT/cfg.XXXX")"
  install -m 600 "$HOME/.claude/.credentials.json" "$CFG/.credentials.json"
  local version
  version="$("$CLAUDE" --version 2>/dev/null | awk '{print $1}')"
  node - "$CFG/.claude.json" "$version" "$@" <<'NODE'
const fs = require('node:fs')
const [file, version, ...projects] = process.argv.slice(2)
const path = require('node:path')
// Claude Code offers the .mcp.json servers of the project and of every folder above it: all of them are disabled.
const serversOf = dir => {
  const out = []
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    try { out.push(...Object.keys(JSON.parse(fs.readFileSync(`${at}/.mcp.json`, 'utf8')).mcpServers ?? {})) } catch {}
    if (path.dirname(at) === at) return [...new Set(out)]
  }
}
const entry = dir => {
  const servers = serversOf(dir)
  return { hasTrustDialogAccepted: true, hasClaudeMdExternalIncludesApproved: true, hasClaudeMdExternalIncludesWarningShown: true, enabledMcpjsonServers: [], disabledMcpjsonServers: servers }
}
fs.writeFileSync(file, JSON.stringify({
  hasCompletedOnboarding: true, hasCompletedClaudeInChromeOnboarding: true, lastOnboardingVersion: version, lastReleaseNotesSeen: version, theme: 'dark',
  officialMarketplaceAutoInstallAttempted: true, shiftEnterKeyBindingInstalled: true, hasIdeOnboardingBeenShown: { vscode: true },
  projects: Object.fromEntries(projects.map(dir => [dir, entry(dir)])),
}, null, 2), { mode: 0o600 })
NODE
}

shred_config() {
  [[ -n "${CFG:-}" && -f "$CFG/.credentials.json" ]] && { shred -u "$CFG/.credentials.json" 2>/dev/null || rm -f "$CFG/.credentials.json"; }
  [[ -n "${CFG:-}" ]] && rm -rf "$CFG/projects" "$CFG/sessions" 2>/dev/null
  return 0
}

# claude_p NAME DIR ARGS...: one headless run in DIR with the isolated config; stdout to $OUT/NAME.txt, debug log to $OUT/NAME.log.
claude_p() {
  local name="$1" dir="$2"
  shift 2
  (cd "$dir" && CLAUDE_CONFIG_DIR="$CFG" timeout 180 "$CLAUDE" -p --debug-file "$OUT/$name.log" "$@" </dev/null >"$OUT/$name.txt" 2>&1)
}

# A refused tree or a failed hook of ours in a debug log.
clean_log() { ! grep -E "does not validate|ruflo-(console|mods|swarm)[^ ]*: .*(refused|failed)" "$1" | grep -vE "fs\.(stat|list|read)" | grep -q .; }

TMUX_SESSION="ruflo-e2e-$$"
# A private tmux server: other agents on this machine kill or reuse the default one.
TMUX_SOCKET="ruflo-e2e-$$"
tmux() { command tmux -L "$TMUX_SOCKET" "$@"; }
tmux_start() { # tmux_start DIR LOG ARGS...
  local dir="$1" log="$2"
  shift 2
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null
  tmux new-session -d -s "$TMUX_SESSION" -x "${TMUX_COLUMNS:-200}" -y 55 \
    "cd '$dir' && CLAUDE_CONFIG_DIR='$CFG' '$CLAUDE' --debug-file '$log' $* ; sleep 30"
}
# Answers the start-up dialogs as a cautious person would: rejects every project MCP server (Esc), so no
# `npx … mcp start` server runs (one can rewrite .claude/helpers), and keeps browser tools off. Returns once the
# prompt shows.
settle_dialogs() {
  local left=40
  while ((left > 0)); do
    tmux capture-pane -t "$TMUX_SESSION" -p >"$OUT/.settle.txt"
    if grep -q "new MCP servers found" "$OUT/.settle.txt"; then tmux send-keys -t "$TMUX_SESSION" Escape; sleep 1; continue; fi
    if grep -q "Claude in Chrome extension detected" "$OUT/.settle.txt"; then tmux send-keys -t "$TMUX_SESSION" Escape; sleep 1; continue; fi
    grep -q "Do you trust\|trust this folder" "$OUT/.settle.txt" && { tmux send-keys -t "$TMUX_SESSION" Down Enter; sleep 1; continue; }
    grep -q "❯" "$OUT/.settle.txt" && grep -q "⏵⏵\|? for shortcuts\|accept edits\|auto mode" "$OUT/.settle.txt" && return 0
    sleep 1
    left=$((left - 1))
  done
  return 1
}
tmux_keys() { tmux send-keys -t "$TMUX_SESSION" "$@"; }
# Types a slash command, lets the completion menu settle, and submits it.
tmux_cmd() { tmux send-keys -t "$TMUX_SESSION" -l "$1"; sleep 1; tmux send-keys -t "$TMUX_SESSION" Enter; }
tmux_shot() { tmux capture-pane -t "$TMUX_SESSION" -p -e >"$OUT/$1.ansi"; tmux capture-pane -t "$TMUX_SESSION" -p >"$OUT/$1.txt"; }
tmux_stop() { tmux kill-server 2>/dev/null; return 0; }

# wait_for FILE-PREFIX TEXT SECONDS: re-captures until the screen holds TEXT.
wait_for() {
  local shot="$1" text="$2" left="${3:-20}"
  while ((left > 0)); do
    tmux_shot "$shot"
    grep -qF -- "$text" "$OUT/$shot.txt" && return 0
    sleep 1
    left=$((left - 1))
  done
  return 1
}

# stable SHOT: a capture with colours (.ansi) minus the rows that change on their own (the status line's clock and any
# "Ns ago"), so two captures differ only where something was drawn anew: the animation, or new data.
stable() { grep -vE '⏱|[0-9]+[smhd] ago' "$OUT/$1.ansi"; }
