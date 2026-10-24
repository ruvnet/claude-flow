# ReasoningBank Integration with Claude Code Hooks

## Overview

This guide shows how to integrate ReasoningBank's self-learning memory system into Claude Code's hook lifecycle, enabling automatic pattern learning, retrieval, and confidence updates.

## Integration Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Claude Code Hook Lifecycle                  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  PreToolUse (Before Operations)                         │
│  ├─ Query ReasoningBank for relevant patterns           │
│  ├─ Inject context into operation                       │
│  └─ Load confidence scores                              │
│                                                          │
│  PostToolUse (After Operations)                         │
│  ├─ Store new patterns from successful operations       │
│  ├─ Update confidence based on outcomes                 │
│  └─ Track usage statistics                              │
│                                                          │
│  Stop (Session End)                                      │
│  ├─ Consolidate memories                                │
│  ├─ Remove duplicates                                   │
│  └─ Export session learnings                            │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Hook Configuration

### Complete `.claude/settings.json` with ReasoningBank

```json
{
  "env": {
    "CLAUDE_FLOW_AUTO_COMMIT": "false",
    "CLAUDE_FLOW_AUTO_PUSH": "false",
    "CLAUDE_FLOW_HOOKS_ENABLED": "true",
    "CLAUDE_FLOW_TELEMETRY_ENABLED": "true",
    "CLAUDE_FLOW_REMOTE_EXECUTION": "true",
    "CLAUDE_FLOW_CHECKPOINTS_ENABLED": "true",
    "REASONINGBANK_ENABLED": "true"
  },
  "permissions": {
    "allow": [
      "Bash(npx claude-flow:*)",
      "Bash(npm run lint)",
      "Bash(npm run test:*)",
      "Bash(npm test:*)",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push)",
      "Bash(git config:*)",
      "Bash(git tag:*)",
      "Bash(git branch:*)",
      "Bash(git checkout:*)",
      "Bash(git stash:*)",
      "Bash(jq:*)",
      "Bash(node:*)",
      "Bash(which:*)",
      "Bash(pwd)",
      "Bash(ls:*)"
    ],
    "deny": [
      "Bash(rm -rf /)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "comment": "Retrieve relevant patterns before bash commands",
            "command": "cat | jq -r '.tool_input.command // empty' | tr '\\n' '\\0' | xargs -0 -I {} bash -c 'CMD=\"{}\"; CONTEXT=$(npx claude-flow@alpha memory query \"$CMD\" --reasoningbank --limit 3 --format json 2>/dev/null || echo \"{}\"); echo \"📚 ReasoningBank Context: $CONTEXT\" >&2; npx claude-flow@alpha hooks pre-command --command \"$CMD\" --validate-safety true --prepare-resources true --context \"$CONTEXT\"'"
          }
        ]
      },
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "comment": "Load file patterns before editing",
            "command": "cat | jq -r '.tool_input.file_path // .tool_input.path // empty' | tr '\\n' '\\0' | xargs -0 -I {} bash -c 'FILE=\"{}\"; EXT=\"${FILE##*.}\"; CONTEXT=$(npx claude-flow@alpha memory query \"$EXT file patterns\" --namespace code --reasoningbank --limit 2 --format json 2>/dev/null || echo \"{}\"); echo \"📚 Code Patterns: $CONTEXT\" >&2; npx claude-flow@alpha hooks pre-edit --file \"$FILE\" --auto-assign-agents true --load-context true --reasoning-context \"$CONTEXT\"'"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "comment": "Store successful bash patterns",
            "command": "cat | jq -r '.tool_input.command // empty, .result.exit_code // \"unknown\"' | tr '\\n' '\\0' | xargs -0 bash -c 'set -- $0 $1; CMD=\"$1\"; EXIT=\"$2\"; if [ \"$EXIT\" = \"0\" ]; then DESC=\"Successful command: $CMD\"; npx claude-flow@alpha memory store \"cmd_$(echo -n \"$CMD\" | md5sum | cut -d\\\" \\\" -f1)\" \"$DESC\" --namespace commands --reasoningbank --confidence 0.6 2>/dev/null; fi; npx claude-flow@alpha hooks post-command --command \"$CMD\" --track-metrics true --store-results true --exit-code \"$EXIT\"'"
          }
        ]
      },
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "comment": "Store code patterns after editing",
            "command": "cat | jq -r '.tool_input.file_path // .tool_input.path // empty, (.tool_input.new_string // .tool_input.content // empty | split(\"\\n\") | length | tostring)' | tr '\\n' '\\0' | xargs -0 bash -c 'set -- $0 $1; FILE=\"$1\"; LINES=\"$2\"; if [ -f \"$FILE\" ]; then EXT=\"${FILE##*.}\"; PATTERN=\"Edited $EXT file with $LINES lines\"; npx claude-flow@alpha memory store \"edit_${EXT}_$(date +%s)\" \"$PATTERN\" --namespace code --reasoningbank --confidence 0.5 2>/dev/null; fi; npx claude-flow@alpha hooks post-edit --file \"$FILE\" --format true --update-memory true'"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "manual",
        "hooks": [
          {
            "type": "command",
            "comment": "Query session patterns before compact",
            "command": "/bin/bash -c 'INPUT=$(cat); CUSTOM=$(echo \"$INPUT\" | jq -r \".custom_instructions // \\\"\\\"\"); SESSION_PATTERNS=$(npx claude-flow@alpha memory list --namespace session --reasoningbank --limit 5 2>/dev/null || echo \"No patterns\"); echo \"🔄 PreCompact Guidance:\"; echo \"📋 IMPORTANT: Review CLAUDE.md and session patterns:\"; echo \"$SESSION_PATTERNS\"; if [ -n \"$CUSTOM\" ]; then echo \"🎯 Custom: $CUSTOM\"; fi; echo \"✅ Ready for compact\"'"
          }
        ]
      },
      {
        "matcher": "auto",
        "hooks": [
          {
            "type": "command",
            "comment": "Auto-compact with reasoning context",
            "command": "/bin/bash -c 'TOP_PATTERNS=$(npx claude-flow@alpha memory query \"important patterns\" --reasoningbank --limit 3 2>/dev/null || echo \"None\"); echo \"🔄 Auto-Compact with ReasoningBank:\"; echo \"📚 Top Patterns: $TOP_PATTERNS\"; echo \"✅ Auto-compact proceeding\"'"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "comment": "Consolidate ReasoningBank at session end",
            "command": "bash -c 'echo \"🧠 Consolidating ReasoningBank memory...\"; npx claude-flow@alpha memory consolidate --reasoningbank --threshold 0.9 --prune-low-confidence 0.2 2>/dev/null || echo \"Consolidation skipped\"; npx claude-flow@alpha hooks session-end --generate-summary true --persist-state true --export-metrics true; echo \"✅ Session ended with ReasoningBank update\"'"
          }
        ]
      }
    ]
  },
  "includeCoAuthoredBy": true,
  "enabledMcpjsonServers": ["claude-flow", "ruv-swarm"],
  "statusLine": {
    "type": "command",
    "command": ".claude/statusline-command.sh"
  }
}
```

## Simplified Configuration (Minimal)

If you want a lighter integration:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "comment": "Query patterns before editing",
            "command": "cat | jq -r '.tool_input.file_path // .tool_input.path // empty' | xargs -I {} bash -c 'npx claude-flow@alpha memory query \"{}\" --reasoningbank --limit 2 2>&1 | grep -q \"Found\" && echo \"📚 Found relevant patterns\" || echo \"📝 No patterns yet\"'"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "comment": "Store successful edits",
            "command": "cat | jq -r '.tool_input.file_path // .tool_input.path // empty' | xargs -I {} bash -c 'FILE=\"{}\"; [ -f \"$FILE\" ] && npx claude-flow@alpha memory store \"edit_$(basename $FILE)_$(date +%s)\" \"Edited: $FILE\" --namespace code --reasoningbank 2>/dev/null || true'"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "comment": "Consolidate at session end",
            "command": "npx claude-flow@alpha memory consolidate --reasoningbank 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

## Available ReasoningBank Commands for Hooks

### Storage Operations

```bash
# Store a pattern
npx claude-flow@alpha memory store <key> <value> \
  --namespace <namespace> \
  --reasoningbank \
  --confidence 0.5

# Store with metadata
npx claude-flow@alpha memory store bug_fix_123 \
  "Fixed CORS by adding middleware" \
  --namespace debugging \
  --reasoningbank \
  --confidence 0.6 \
  --metadata '{"file": "server.js", "line": 45}'
```

### Retrieval Operations

```bash
# Query semantically
npx claude-flow@alpha memory query "authentication patterns" \
  --reasoningbank \
  --limit 3 \
  --format json

# Query with filters
npx claude-flow@alpha memory query "bug fixes" \
  --namespace debugging \
  --reasoningbank \
  --min-confidence 0.7
```

### List Operations

```bash
# List all patterns
npx claude-flow@alpha memory list --reasoningbank

# List by namespace
npx claude-flow@alpha memory list \
  --namespace commands \
  --reasoningbank \
  --limit 10
```

### Consolidation

```bash
# Consolidate memories (remove duplicates, prune low-confidence)
npx claude-flow@alpha memory consolidate \
  --reasoningbank \
  --threshold 0.9 \
  --prune-low-confidence 0.2

# Consolidate specific namespace
npx claude-flow@alpha memory consolidate \
  --namespace debugging \
  --reasoningbank
```

### Statistics

```bash
# Get ReasoningBank statistics
npx claude-flow@alpha memory stats --reasoningbank
```

## Hook Execution Flow

### Example: Code Editing with ReasoningBank

```
1. PreToolUse Hook (Write tool)
   ├─ Extract: file_path = "src/api/server.js"
   ├─ Query: npx claude-flow memory query "server.js api patterns"
   ├─ Result: Found 2 patterns with 85% confidence
   └─ Inject: Context added to operation

2. User Edit Operation
   ├─ Claude Code applies the edit
   └─ Result: Success (no errors)

3. PostToolUse Hook (Write tool)
   ├─ Extract: file_path, exit_code = 0
   ├─ Store: npx claude-flow memory store "edit_server_1729123456"
   ├─ Pattern: "Successfully edited server.js API endpoint"
   └─ Initial confidence: 0.5

4. Future Query (Same File)
   ├─ Query: "server.js patterns"
   ├─ Retrieve: Previous pattern with updated confidence
   └─ Confidence: 0.5 → 0.6 (after successful reuse)
```

## Namespace Organization

Recommended namespace structure:

```
commands/       # Bash command patterns
code/          # Code editing patterns
debugging/     # Bug fixes and solutions
api/           # API design patterns
database/      # Database query patterns
security/      # Security best practices
performance/   # Performance optimizations
testing/       # Test patterns
deployment/    # Deployment procedures
session/       # Current session patterns
```

## Best Practices

### 1. **Conditional Storage** (Only store successes)

```bash
if [ "$EXIT_CODE" = "0" ]; then
  npx claude-flow@alpha memory store "pattern" "description" --reasoningbank
fi
```

### 2. **Error Handling** (Don't break hooks on failure)

```bash
npx claude-flow@alpha memory query "pattern" --reasoningbank 2>/dev/null || echo "{}"
```

### 3. **Format Detection** (Store file-type specific patterns)

```bash
EXT="${FILE##*.}"
npx claude-flow@alpha memory store "edit_${EXT}" "Pattern for $EXT files"
```

### 4. **Confidence Management**

```bash
# New patterns: 0.5 (neutral)
--confidence 0.5

# Proven patterns: 0.7-0.9
--confidence 0.8

# Experimental: 0.3-0.4
--confidence 0.3
```

## Performance Considerations

### Hook Latency

ReasoningBank operations are fast:
- **Query**: 2-6ms (with domain filter)
- **Store**: 1-2ms (single pattern)
- **Consolidate**: 100-200ms (1000 patterns)

### Optimization Tips

1. **Limit results**: Use `--limit 3` for faster queries
2. **Filter namespaces**: Use `--namespace` to reduce search space
3. **Async consolidation**: Run consolidation only at Stop hook
4. **Error suppression**: Use `2>/dev/null` to avoid hook failures

## Testing Your Integration

### 1. Test PreToolUse Hook

```bash
# Trigger a Write operation and check for pattern retrieval
echo '{"tool_input": {"file_path": "test.js"}}' | \
  jq -r '.tool_input.file_path' | \
  xargs -I {} npx claude-flow@alpha memory query "{}"
```

### 2. Test PostToolUse Hook

```bash
# Simulate successful edit and storage
echo '{"tool_input": {"file_path": "test.js"}, "result": {"exit_code": 0}}' | \
  jq -r '.tool_input.file_path' | \
  xargs -I {} npx claude-flow@alpha memory store "edit_test_$(date +%s)" \
    "Edited: {}" --namespace code --reasoningbank
```

### 3. Verify Storage

```bash
# Check stored patterns
npx claude-flow@alpha memory list --namespace code --reasoningbank
```

### 4. Test Consolidation

```bash
# Run manual consolidation
npx claude-flow@alpha memory consolidate --reasoningbank --threshold 0.9
```

## Troubleshooting

### Hook Not Executing

**Check**: Hooks enabled in environment
```json
"CLAUDE_FLOW_HOOKS_ENABLED": "true"
```

### No Patterns Found

**Solution**: Verify ReasoningBank is initialized
```bash
npx claude-flow@alpha memory stats --reasoningbank
```

### Slow Hook Execution

**Solution**: Add timeouts and limits
```bash
timeout 5s npx claude-flow@alpha memory query "pattern" --limit 3
```

### Pattern Duplication

**Solution**: Run consolidation more frequently
```bash
npx claude-flow@alpha memory consolidate --reasoningbank --threshold 0.95
```

## Advanced: Custom Hook Scripts

Create `.claude/hooks/reasoningbank-pre.sh`:

```bash
#!/bin/bash
# Custom ReasoningBank pre-hook

FILE="$1"
NAMESPACE="${2:-code}"

# Extract file context
EXT="${FILE##*.}"
FILENAME=$(basename "$FILE")

# Query relevant patterns
PATTERNS=$(npx claude-flow@alpha memory query \
  "$EXT $FILENAME" \
  --namespace "$NAMESPACE" \
  --reasoningbank \
  --limit 5 \
  --format json 2>/dev/null)

# Format output
if echo "$PATTERNS" | jq -e '.results | length > 0' > /dev/null 2>&1; then
  echo "📚 Found $(echo "$PATTERNS" | jq '.results | length') relevant patterns"
  echo "$PATTERNS" | jq -r '.results[] | "  • \(.key): \(.confidence * 100 | round)%"'
else
  echo "📝 No patterns yet - this will be a learning opportunity"
fi
```

Usage in `.claude/settings.json`:
```json
{
  "type": "command",
  "command": "cat | jq -r '.tool_input.file_path' | xargs -I {} .claude/hooks/reasoningbank-pre.sh {}"
}
```

## Integration Benefits

### 1. **Automatic Learning**
- Every successful operation stores a pattern
- Confidence increases with repeated success
- Failed patterns naturally get pruned

### 2. **Context-Aware Operations**
- Pre-hooks retrieve relevant past experiences
- Operations guided by proven patterns
- Reduced trial-and-error

### 3. **Cumulative Intelligence**
- Knowledge compounds over time
- Cross-session memory retention
- Team-wide pattern sharing (with shared database)

### 4. **Zero Overhead**
- Sub-10ms latency for most operations
- Async consolidation at session end
- No impact on Claude Code performance

## Example Session Flow

```
Session Start
├─ Claude Code loads
├─ Hooks initialized with ReasoningBank support
└─ Memory database ready (~/.swarm/memory.db)

Task 1: Edit API endpoint
├─ PreToolUse: Query "api endpoint patterns"
│   └─ Found: 3 patterns (avg confidence: 78%)
├─ Edit: User makes changes
└─ PostToolUse: Store "edit_api_1234567890"
    └─ Initial confidence: 50%

Task 2: Fix CORS error
├─ PreToolUse: Query "CORS error fix"
│   └─ Found: 1 pattern (confidence: 92%)
├─ Fix: Apply proven solution
└─ PostToolUse: Update pattern confidence
    └─ Confidence: 92% → 95% (successful reuse)

Task 3: Similar API endpoint
├─ PreToolUse: Query "api endpoint patterns"
│   └─ Found: 4 patterns (avg confidence: 82%)
│   └─ Includes Task 1 pattern (now 50% → 60% confidence)
├─ Edit: Apply learned pattern
└─ PostToolUse: Pattern reused successfully
    └─ Confidence: 60% → 72%

Session End
├─ Stop Hook: Consolidate memories
│   ├─ Remove duplicates (threshold: 90%)
│   ├─ Prune low-confidence (<20%)
│   └─ Export session summary
└─ Result: 5 new patterns, 2 updated, 1 pruned
```

## Conclusion

ReasoningBank integration transforms Claude Code from a stateless tool into an intelligent, self-improving system that learns from every operation. Patterns stored in hooks enable:

- ✅ **Automatic context loading** before operations
- ✅ **Success pattern storage** after operations
- ✅ **Confidence-based learning** through repeated use
- ✅ **Zero-configuration** semantic search
- ✅ **Cross-session intelligence** accumulation

**Next Steps**:
1. Copy the configuration to `.claude/settings.json`
2. Restart Claude Code to load hooks
3. Perform some operations (edits, commands)
4. Check stored patterns: `npx claude-flow@alpha memory list --reasoningbank`
5. Watch intelligence compound over time! 🚀

---

**Related Documentation**:
- [ReasoningBank README](./README.md)
- [Architecture Guide](./architecture.md)
- [CLI Reference](./cli-reference.md)
- [Google Research Paper](./google-research.md)
