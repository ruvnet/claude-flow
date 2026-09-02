/**
 * Safe Hook Patterns - Templates for safe Claude Code hook configurations
 *
 * These patterns prevent infinite loops that could cost thousands of dollars
 * by avoiding recursive hook execution when hooks call 'claude' commands.
 */

/**
 * DANGEROUS PATTERN - DO NOT USE
 * This creates an infinite loop that can cost thousands of dollars!
 */
export const DANGEROUS_PATTERN_EXAMPLE = {
  name: 'DANGEROUS: Stop hook calling claude command',
  description: '❌ NEVER USE THIS - Creates infinite recursion loop',
  pattern: {
    hooks: {
      Stop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: 'claude -c -p "Update all changes to history.md"',
            },
          ],
        },
      ],
    },
  },
  problems: [
    '🚨 Creates infinite loop: Stop → claude command → Stop → claude command...',
    '💰 Can cost $3600+ per day by bypassing rate limits',
    '🚫 Makes system unresponsive',
    '⚡ No built-in protection in Claude Code',
  ],
};

/**
 * SAFE PATTERN 1: Flag-based updates
 * Set a flag instead of calling claude directly
 */
export const SAFE_FLAG_PATTERN = {
  name: 'Safe Pattern: Flag-based updates',
  description: '✅ Set flag when update needed, run manually',
  pattern: {
    hooks: {
      Stop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command:
                'bash -c \'echo "History update needed at $(date)" > ~/.claude/needs_update && echo "📝 History update flagged. Run: claude -c -p \\"Update history.md\\""\'',
            },
          ],
        },
      ],
    },
  },
  benefits: [
    '✅ No recursion - just sets a flag',
    '💰 Zero risk of infinite API calls',
    '🔄 User controls when update runs',
    '📝 Clear instructions for manual execution',
  ],
  usage: [
    '1. Hook sets flag when update is needed',
    '2. User sees notification',
    '3. User manually runs: claude -c -p "Update history.md"',
    '4. Update runs once safely',
  ],
};

/**
 * SAFE PATTERN 2: PostToolUse hooks instead of Stop hooks
 * React to specific tool usage rather than session end
 */
export const SAFE_POST_TOOL_PATTERN = {
  name: 'Safe Pattern: PostToolUse hooks',
  description: '✅ React to specific file operations instead of Stop events',
  pattern: {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Write|Edit|MultiEdit',
          hooks: [
            {
              type: 'command',
              command: "echo 'File modified: {file}' >> ~/.claude/modifications.log",
            },
          ],
        },
      ],
    },
  },
  benefits: [
    '✅ Only triggers on actual file changes',
    '🎯 More precise than Stop hooks',
    '📝 Logs specific modifications',
    '🔄 No risk of Stop hook recursion',
  ],
  usage: [
    '1. Triggers only when files are written/edited',
    '2. Logs the specific file that was modified',
    '3. Can be used for change tracking',
    '4. Safe to use with any logging command',
  ],
};

/**
 * SAFE PATTERN 3: Conditional execution with skip-hooks
 * Check for hook context before executing claude commands
 */
export const SAFE_CONDITIONAL_PATTERN = {
  name: 'Safe Pattern: Conditional execution with context check',
  description: '✅ Check if running in hook context before calling claude',
  pattern: {
    hooks: {
      Stop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command:
                'bash -c \'if [ -z "$CLAUDE_HOOK_CONTEXT" ]; then claude -c -p "Update history.md" --skip-hooks; else echo "Skipping update - in hook context"; fi\'',
            },
          ],
        },
      ],
    },
  },
  benefits: [
    '✅ Checks hook context before execution',
    '🛡️ Uses --skip-hooks flag for safety',
    '🔄 Prevents recursive hook calls',
    '📊 Provides clear feedback',
  ],
  usage: [
    '1. Checks CLAUDE_HOOK_CONTEXT environment variable',
    '2. Only runs claude if not in hook context',
    '3. Uses --skip-hooks to prevent triggering more hooks',
    '4. Shows clear message when skipping',
  ],
};

/**
 * SAFE PATTERN 4: Batch processing with scheduled execution
 * Accumulate changes and process them on a schedule
 */
export const SAFE_BATCH_PATTERN = {
  name: 'Safe Pattern: Batch processing with scheduled execution',
  description: '✅ Accumulate changes and process them separately',
  pattern: {
    hooks: {
      Stop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: 'echo "$(date): Session ended" >> ~/.claude/session_log.txt',
            },
          ],
        },
      ],
    },
  },
  additionalSetup: {
    cronJob: '# Add to crontab (run every hour):\n# 0 * * * * /path/to/update-history.sh',
    updateScript: `#!/bin/bash
# update-history.sh - Safe batch update script
LOCK_FILE="~/.claude/update.lock"
LOG_FILE="~/.claude/session_log.txt"

# Check if update is already running
if [ -f "$LOCK_FILE" ]; then
    echo "Update already in progress"
    exit 1
fi

# Create lock file
touch "$LOCK_FILE"

# Check if there are new sessions to process
if [ -f "$LOG_FILE" ] && [ -s "$LOG_FILE" ]; then
    echo "Processing accumulated changes..."
    claude -c -p "Update history.md with recent session data" --skip-hooks
    
    # Archive the log
    mv "$LOG_FILE" "~/.claude/session_log_$(date +%Y%m%d_%H%M%S).txt"
fi

# Remove lock file
rm "$LOCK_FILE"`,
  },
  benefits: [
    '✅ No risk of recursion',
    '⏰ Scheduled processing prevents overload',
    '🔒 Lock file prevents concurrent updates',
    '📦 Batches multiple sessions efficiently',
  ],
};

/**
 * SAFE PATTERN 5: Database/file-based queue system
 * Use external queue for processing commands
 */
export const SAFE_QUEUE_PATTERN = {
  name: 'Safe Pattern: Queue-based command processing',
  description: '✅ Queue commands for external processing',
  pattern: {
    hooks: {
      Stop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command:
                'echo \'{"command": "update-history", "timestamp": "\'$(date -Iseconds)\'", "session": "\'$CLAUDE_SESSION_ID\'"}\' >> ~/.claude/command_queue.jsonl',
            },
          ],
        },
      ],
    },
  },
  processor: `#!/usr/bin/env python3
# queue-processor.py - Safe command queue processor
import json
import subprocess
import time
import os
from pathlib import Path

QUEUE_FILE = Path.home() / '.claude' / 'command_queue.jsonl'
PROCESSING_INTERVAL = 300  # 5 minutes

def process_queue():
    if not QUEUE_FILE.exists():
        return
    
    # Read and clear queue atomically
    with open(QUEUE_FILE, 'r') as f:
        lines = f.readlines()
    
    # Clear the queue
    QUEUE_FILE.unlink()
    
    # Process commands
    for line in lines:
        try:
            cmd_data = json.loads(line.strip())
            if cmd_data['command'] == 'update-history':
                print(f"Processing history update for session {cmd_data['session']}")
                subprocess.run([
                    'claude', '-c', '-p', 'Update history.md', '--skip-hooks'
                ], check=True)
                time.sleep(2)  # Rate limiting
        except Exception as e:
            print(f"Error processing command: {e}")

if __name__ == '__main__':
    while True:
        try:
            process_queue()
            time.sleep(PROCESSING_INTERVAL)
        except KeyboardInterrupt:
            break`,
  benefits: [
    '✅ Complete separation of hook and claude execution',
    '⏰ Rate limited processing',
    '🔄 Handles multiple queued commands',
    '🛡️ No risk of infinite loops',
  ],
};

/**
 * Get all safe patterns for documentation generation
 */
export const ALL_SAFE_PATTERNS = [
  SAFE_FLAG_PATTERN,
  SAFE_POST_TOOL_PATTERN,
  SAFE_CONDITIONAL_PATTERN,
  SAFE_BATCH_PATTERN,
  SAFE_QUEUE_PATTERN,
];

/**
 * Generate safe hooks documentation
 */
export function generateSafeHooksGuide() {
  return `# 🛡️ Safe Hook Patterns for Claude Code

⚠️ **CRITICAL WARNING**: Stop hooks that call 'claude' commands create infinite loops that can cost thousands of dollars per day!

## 🚨 DANGEROUS PATTERN (NEVER USE)

${DANGEROUS_PATTERN_EXAMPLE.description}

\`\`\`json
${JSON.stringify(DANGEROUS_PATTERN_EXAMPLE.pattern, null, 2)}
\`\`\`

**Problems:**
${DANGEROUS_PATTERN_EXAMPLE.problems.map((p) => `- ${p}`).join('\n')}

---

## ✅ SAFE PATTERNS

${ALL_SAFE_PATTERNS.map(
  (pattern) => `
### ${pattern.name}

${pattern.description}

**Configuration:**
\`\`\`json
${JSON.stringify(pattern.pattern, null, 2)}
\`\`\`

**Benefits:**
${pattern.benefits.map((b) => `- ${b}`).join('\n')}

${
  pattern.usage
    ? `**Usage:**
${pattern.usage.map((u, i) => `${i + 1}. ${u}`).join('\n')}`
    : ''
}

${
  pattern.additionalSetup
    ? `**Additional Setup:**
${
  pattern.additionalSetup.cronJob
    ? `
**Cron Job:**
\`\`\`bash
${pattern.additionalSetup.cronJob}
\`\`\`
`
    : ''
}

${
  pattern.additionalSetup.updateScript
    ? `
**Update Script:**
\`\`\`bash
${pattern.additionalSetup.updateScript}
\`\`\`
`
    : ''
}`
    : ''
}

${
  pattern.processor
    ? `
**Queue Processor:**
\`\`\`python
${pattern.processor}
\`\`\`
`
    : ''
}

---
`,
).join('')}

## 🚀 Quick Migration Guide

### If you currently have this DANGEROUS pattern:
\`\`\`json
{
  "hooks": {
    "Stop": [{"hooks": [{"type": "command", "command": "claude -c -p 'Update history'"}]}]
  }
}
\`\`\`

### Replace with this SAFE pattern:
\`\`\`json
{
  "hooks": {
    "Stop": [{"hooks": [{"type": "command", "command": "touch ~/.claude/needs_update && echo 'Run: claude -c -p \"Update history\"'"}]}]
  }
}
\`\`\`

## 🛡️ Hook Safety Tools

Use claude-flow's built-in safety tools:

\`\`\`bash
# Check your configuration for dangerous patterns
claude-flow hook-safety validate

# Enable safe mode (skips all hooks)
claude-flow hook-safety safe-mode

# Check current safety status
claude-flow hook-safety status

# Reset circuit breakers if triggered
claude-flow hook-safety reset
\`\`\`

## 📚 Additional Resources

- Issue #166: https://github.com/ruvnet/claude-flow/issues/166
- Claude Code Hooks Documentation: https://docs.anthropic.com/en/docs/claude-code/hooks
- Reddit Discussion: https://www.reddit.com/r/ClaudeAI/comments/1ltvi6x/anyone_else_accidentally_create_an_infinite_loop/

---

**Remember**: When in doubt, use flag-based patterns or PostToolUse hooks instead of Stop hooks!
`;
}

export default {
  DANGEROUS_PATTERN_EXAMPLE,
  ALL_SAFE_PATTERNS,
  generateSafeHooksGuide,
};
