#!/usr/bin/env node
/**
 * GitHub init command - Initialize GitHub-specific hooks and checkpoint system
 */

import { existsSync } from 'fs';
import { access, constants, mkdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { printSuccess, printError, printWarning, printInfo } from '../../utils.js';
import { spawn } from 'child_process';
import { promisify } from 'util';
const exec = promisify(spawn);

/**
 * Create GitHub-specific checkpoint hooks
 */
async function createGitHubCheckpointHooks() {
  const helpersDir = join(process.cwd(), '.claude', 'helpers');
  const checkpointHooksPath = join(helpersDir, 'github-checkpoint-hooks.sh');
  
  const content = `#!/bin/bash
# GitHub-specific checkpoint hook functions for Claude settings.json

# Function to handle pre-edit checkpoints
pre_edit_checkpoint() {
    local tool_input="$1"
    local file=$(echo "$tool_input" | jq -r '.file_path // empty')
    
    if [ -n "$file" ]; then
        local checkpoint_branch="checkpoint/pre-edit-$(date +%Y%m%d-%H%M%S)"
        local current_branch=$(git branch --show-current)
        
        # Create checkpoint
        git add -A
        git stash push -m "Pre-edit checkpoint for $file" >/dev/null 2>&1
        git branch "$checkpoint_branch"
        
        # Store metadata
        mkdir -p .claude/checkpoints
        cat > ".claude/checkpoints/$(date +%s).json" <<EOF
{
  "branch": "$checkpoint_branch",
  "file": "$file",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "type": "pre-edit",
  "original_branch": "$current_branch"
}
EOF
        
        # Restore working directory
        git stash pop --quiet >/dev/null 2>&1 || true
        
        echo "✅ Created checkpoint: $checkpoint_branch for $file"
    fi
}

# Function to handle post-edit checkpoints with GitHub release
post_edit_checkpoint() {
    local tool_input="$1"
    local file=$(echo "$tool_input" | jq -r '.file_path // empty')
    
    if [ -n "$file" ] && [ -f "$file" ]; then
        # Check if file was modified - first check if file is tracked
        if ! git ls-files --error-unmatch "$file" >/dev/null 2>&1; then
            # File is not tracked, add it first
            git add "$file"
        fi
        
        # Now check if there are changes
        if git diff --cached --quiet "$file" 2>/dev/null && git diff --quiet "$file" 2>/dev/null; then
            echo "ℹ️  No changes to checkpoint for $file"
        else
            local tag_name="checkpoint-$(date +%Y%m%d-%H%M%S)"
            local current_branch=$(git branch --show-current)
            
            # Create commit
            git add "$file"
            if git commit -m "🔖 Checkpoint: Edit $file

Automatic checkpoint created by Claude
- File: $file
- Branch: $current_branch
- Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)

[Auto-checkpoint]" --quiet; then
                # Create tag only if commit succeeded
                git tag -a "$tag_name" -m "Checkpoint after editing $file"
                
                # Store metadata
                mkdir -p .claude/checkpoints
                local diff_stats=$(git diff HEAD~1 --stat | tr '\\n' ' ' | sed 's/"/\\\\"/g')
                cat > ".claude/checkpoints/$(date +%s).json" <<EOF
{
  "tag": "$tag_name",
  "file": "$file",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "type": "post-edit",
  "branch": "$current_branch",
  "diff_summary": "$diff_stats"
}
EOF
                
                echo "✅ Created checkpoint: $tag_name for $file"
            else
                echo "ℹ️  No commit created (no changes or commit failed)"
            fi
        fi
    fi
}

# Function to handle task checkpoints with GitHub release
task_checkpoint() {
    local user_prompt="$1"
    local task=$(echo "$user_prompt" | head -c 100 | tr '\\n' ' ')
    
    if [ -n "$task" ]; then
        local checkpoint_name="task-$(date +%Y%m%d-%H%M%S)"
        
        # Commit current state
        git add -A
        git commit -m "🔖 Task checkpoint: $task..." --quiet || true
        
        # Create GitHub release if gh CLI is available
        if command -v gh &> /dev/null; then
            echo "🚀 Creating GitHub release for checkpoint..."
            gh release create "$checkpoint_name" \\
                --title "Checkpoint: $(date +'%Y-%m-%d %H:%M')" \\
                --notes "Task: $task

## Checkpoint Details
- Branch: $(git branch --show-current)
- Commit: $(git rev-parse HEAD)
- Files changed: $(git diff HEAD~1 --stat | wc -l) files

## Rollback Instructions
\`\`\`bash
# To rollback to this checkpoint:
git checkout $checkpoint_name
\`\`\`" \\
                --prerelease || echo "⚠️  Failed to create GitHub release"
        fi
        
        # Store metadata
        mkdir -p .claude/checkpoints
        cat > ".claude/checkpoints/task-$(date +%s).json" <<EOF
{
  "checkpoint": "$checkpoint_name",
  "task": "$task",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "commit": "$(git rev-parse HEAD)",
  "github_release": "$(command -v gh &> /dev/null && echo 'true' || echo 'false')"
}
EOF
        
        echo "✅ Created task checkpoint: $checkpoint_name"
    fi
}

# Function to handle session end with GitHub summary
session_end_checkpoint() {
    local session_id="session-$(date +%Y%m%d-%H%M%S)"
    local summary_file=".claude/checkpoints/summary-$session_id.md"
    
    mkdir -p .claude/checkpoints
    
    # Create detailed summary
    cat > "$summary_file" <<EOF
# Session Summary - $(date +'%Y-%m-%d %H:%M:%S')

## Checkpoints Created
$(find .claude/checkpoints -name '*.json' -mtime -1 -exec basename {} \\; | sort)

## Files Modified
$(git diff --name-only $(git log --format=%H -n 1 --before="1 hour ago" 2>/dev/null) 2>/dev/null || echo "No files tracked")

## Recent Commits
$(git log --oneline -10 --grep="Checkpoint" || echo "No checkpoint commits")

## GitHub Releases Created
$(gh release list --limit 10 | grep "checkpoint-" || echo "No GitHub releases")

## Rollback Instructions
To rollback to a specific checkpoint:
\`\`\`bash
# List all checkpoints
git tag -l 'checkpoint-*' | sort -r

# List GitHub releases
gh release list

# Rollback to a checkpoint
git checkout checkpoint-YYYYMMDD-HHMMSS

# Or download release
gh release download checkpoint-YYYYMMDD-HHMMSS

# Or reset to a checkpoint (destructive)
git reset --hard checkpoint-YYYYMMDD-HHMMSS
\`\`\`
EOF
    
    # Create final checkpoint
    git add -A
    git commit -m "🏁 Session end checkpoint: $session_id" --quiet || true
    git tag -a "session-end-$session_id" -m "End of Claude session"
    
    # Create GitHub session summary if gh is available
    if command -v gh &> /dev/null; then
        echo "📊 Creating GitHub session summary..."
        gh release create "session-$session_id" \\
            --title "Session Summary: $(date +'%Y-%m-%d %H:%M')" \\
            --notes-file "$summary_file" \\
            --prerelease || echo "⚠️  Failed to create GitHub session summary"
    fi
    
    echo "✅ Session summary saved to: $summary_file"
    echo "📌 Final checkpoint: session-end-$session_id"
}

# Main entry point
case "$1" in
    pre-edit)
        pre_edit_checkpoint "$2"
        ;;
    post-edit)
        post_edit_checkpoint "$2"
        ;;
    task)
        task_checkpoint "$2"
        ;;
    session-end)
        session_end_checkpoint
        ;;
    *)
        echo "Usage: $0 {pre-edit|post-edit|task|session-end} [input]"
        exit 1
        ;;
esac
`;
  
  await writeFile(checkpointHooksPath, content, { mode: 0o755 });
  return checkpointHooksPath;
}

/**
 * Create GitHub-specific settings.json
 */
async function createGitHubSettingsJson() {
  const settingsPath = join(process.cwd(), '.claude', 'settings.json');
  
  const settings = {
    env: {
      CLAUDE_FLOW_AUTO_COMMIT: 'false',
      CLAUDE_FLOW_AUTO_PUSH: 'false',
      CLAUDE_FLOW_HOOKS_ENABLED: 'true',
      CLAUDE_FLOW_TELEMETRY_ENABLED: 'true',
      CLAUDE_FLOW_REMOTE_EXECUTION: 'true',
      CLAUDE_FLOW_GITHUB_INTEGRATION: 'true',
      CLAUDE_FLOW_CHECKPOINTS_ENABLED: 'true',
      CREATE_GH_RELEASE: 'true'
    },
    permissions: {
      allow: [
        'Bash(npx claude-flow *)',
        'Bash(npm run lint)',
        'Bash(npm run test:*)',
        'Bash(npm test *)',
        'Bash(git status)',
        'Bash(git diff *)',
        'Bash(git log *)',
        'Bash(git add *)',
        'Bash(git commit *)',
        'Bash(git push)',
        'Bash(git config *)',
        'Bash(git tag *)',
        'Bash(git branch *)',
        'Bash(git checkout *)',
        'Bash(git stash *)',
        'Bash(git reset *)',
        'Bash(git rev-parse *)',
        'Bash(git ls-files *)',
        'Bash(gh *)',
        'Bash(node *)',
        'Bash(which *)',
        'Bash(pwd)',
        'Bash(ls *)',
        'Bash(jq *)',
        'Bash(test *)',
        'Bash(find *)',
        'Bash(grep *)',
        'Bash(sed *)',
        'Bash(awk *)',
        'Bash(curl *)',
        'Bash(mkdir *)',
        'Bash(cd *)',
        'Bash(cat *)',
        'Bash(echo *)',
        'Bash(npx claude-flow@alpha *)',
        'Bash(./claude-flow *)',
        'Bash(./.claude/helpers/*)'
      ],
      deny: [
        'Bash(rm -rf /)',
        'Bash(curl * | bash)',
        'Bash(wget * | sh)',
        'Bash(eval *)'
      ]
    },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            {
              type: 'command',
              command: 'cat | jq -r \'.tool_input.command // empty\' | tr \'\\n\' \'\\0\' | xargs -0 -I {} npx claude-flow@alpha hooks pre-command --command \'{}\' --validate-safety true --prepare-resources true'
            }
          ]
        },
        {
          matcher: 'Write|Edit|MultiEdit',
          hooks: [
            {
              type: 'command',
              command: 'cat | jq -r \'.tool_input.file_path // .tool_input.path // empty\' | tr \'\\n\' \'\\0\' | xargs -0 -I {} npx claude-flow@alpha hooks pre-edit --file \'{}\' --auto-assign-agents true --load-context true'
            },
            {
              type: 'command',
              command: 'bash .claude/helpers/github-checkpoint-hooks.sh pre-edit "{{tool_input}}"'
            }
          ]
        }
      ],
      PostToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            {
              type: 'command',
              command: 'cat | jq -r \'.tool_input.command // empty\' | tr \'\\n\' \'\\0\' | xargs -0 -I {} npx claude-flow@alpha hooks post-command --command \'{}\' --track-metrics true --store-results true'
            }
          ]
        },
        {
          matcher: 'Write|Edit|MultiEdit',
          hooks: [
            {
              type: 'command',
              command: 'cat | jq -r \'.tool_input.file_path // .tool_input.path // empty\' | tr \'\\n\' \'\\0\' | xargs -0 -I {} npx claude-flow@alpha hooks post-edit --file \'{}\' --format true --update-memory true'
            },
            {
              type: 'command',
              command: 'bash .claude/helpers/github-checkpoint-hooks.sh post-edit "{{tool_input}}"'
            }
          ]
        }
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: 'bash .claude/helpers/github-checkpoint-hooks.sh task "{{user_prompt}}"'
            }
          ]
        }
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: 'npx claude-flow@alpha hooks session-end --generate-summary true --persist-state true --export-metrics true'
            },
            {
              type: 'command',
              command: 'bash .claude/helpers/github-checkpoint-hooks.sh session-end'
            }
          ]
        }
      ],
      PreCompact: [
        {
          matcher: 'manual',
          hooks: [
            {
              type: 'command',
              command: '/bin/bash -c \'INPUT=$(cat); CUSTOM=$(echo "$INPUT" | jq -r ".custom_instructions // \"\""); echo "🔄 PreCompact Guidance:"; echo "📋 IMPORTANT: Review CLAUDE.md in project root for:"; echo "   • 54 available agents and concurrent usage patterns"; echo "   • Swarm coordination strategies (hierarchical, mesh, adaptive)"; echo "   • SPARC methodology workflows with batchtools optimization"; echo "   • Critical concurrent execution rules (GOLDEN RULE: 1 MESSAGE = ALL OPERATIONS)"; if [ -n "$CUSTOM" ]; then echo "🎯 Custom compact instructions: $CUSTOM"; fi; echo "✅ Ready for compact operation"\''
            }
          ]
        },
        {
          matcher: 'auto',
          hooks: [
            {
              type: 'command',
              command: '/bin/bash -c \'echo "🔄 Auto-Compact Guidance (Context Window Full):"; echo "📋 CRITICAL: Before compacting, ensure you understand:"; echo "   • All 54 agents available in .claude/agents/ directory"; echo "   • Concurrent execution patterns from CLAUDE.md"; echo "   • Batchtools optimization for 300% performance gains"; echo "   • Swarm coordination strategies for complex tasks"; echo "⚡ Apply GOLDEN RULE: Always batch operations in single messages"; echo "✅ Auto-compact proceeding with full agent context"\''
            }
          ]
        }
      ]
    },
    includeCoAuthoredBy: true,
    enabledMcpjsonServers: ['claude-flow', 'ruv-swarm']
  };
  
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));
  return settingsPath;
}

/**
 * Initialize GitHub-specific hooks and checkpoint system
 */
export async function githubInitCommand(flags = {}) {
  try {
    console.log('🐙 Initializing GitHub-specific hooks and checkpoint system...\n');
    
    // Check if we're in a git repository
    try {
      const { execSync } = await import('child_process');
      execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    } catch (error) {
      printError('❌ Not in a git repository. Please initialize git first.');
      return;
    }
    
    // Check if gh CLI is available
    let ghAvailable = false;
    try {
      const { execSync } = await import('child_process');
      execSync('gh --version', { stdio: 'ignore' });
      ghAvailable = true;
      printSuccess('✅ GitHub CLI detected');
    } catch (error) {
      printWarning('⚠️  GitHub CLI not found. Some features will be limited.');
      console.log('   Install gh: https://cli.github.com/');
    }
    
    // Create .claude directory structure
    const claudeDir = join(process.cwd(), '.claude');
    const helpersDir = join(claudeDir, 'helpers');
    const checkpointsDir = join(claudeDir, 'checkpoints');
    
    await mkdir(claudeDir, { recursive: true });
    await mkdir(helpersDir, { recursive: true });
    await mkdir(checkpointsDir, { recursive: true });
    
    // Check if settings.json already exists
    const settingsPath = join(claudeDir, 'settings.json');
    if (existsSync(settingsPath) && !flags.force) {
      printWarning('⚠️  settings.json already exists. Use --force to overwrite.');
      return;
    }
    
    // Create GitHub checkpoint hooks
    const hooksPath = await createGitHubCheckpointHooks();
    printSuccess(`✅ Created GitHub checkpoint hooks: ${hooksPath}`);
    
    // Copy standard checkpoint manager
    const checkpointManagerPath = join(helpersDir, 'checkpoint-manager.sh');
    const checkpointManagerContent = await readFile(
      join(dirname(import.meta.url).replace('file://', ''), '..', 'init', 'templates', 'commands', 'helpers', 'checkpoint-manager.sh'),
      'utf8'
    ).catch(() => {
      // Fallback content if template not found
      return `#!/bin/bash
# Checkpoint manager for Claude Flow
# Use github-checkpoint-hooks.sh for checkpoint operations
`;
    });
    
    await writeFile(checkpointManagerPath, checkpointManagerContent, { mode: 0o755 });
    printSuccess(`✅ Created checkpoint manager: ${checkpointManagerPath}`);
    
    // Create GitHub-specific settings.json
    await createGitHubSettingsJson();
    printSuccess(`✅ Created GitHub settings: ${settingsPath}`);
    
    // Initialize first checkpoint
    try {
      const { execSync } = await import('child_process');
      execSync(`bash ${hooksPath} task "Initialize GitHub checkpoint system"`, { stdio: 'inherit' });
      printSuccess('✅ Created initial checkpoint');
    } catch (error) {
      printWarning('⚠️  Could not create initial checkpoint: ' + error.message);
    }
    
    // Show completion message
    console.log('\n' + '='.repeat(60));
    printSuccess('🎉 GitHub hooks initialized successfully!');
    console.log('='.repeat(60) + '\n');
    
    console.log('📋 What\'s been set up:\n');
    console.log('  1. GitHub-specific checkpoint hooks in .claude/helpers/');
    console.log('  2. Automatic GitHub releases for checkpoints' + (ghAvailable ? ' ✅' : ' (requires gh CLI)'));
    console.log('  3. Enhanced rollback with GitHub integration');
    console.log('  4. Session summaries with GitHub releases');
    console.log('  5. Full GitHub CLI permissions in settings.json');
    
    console.log('\n🚀 Quick Start:\n');
    console.log('  1. Edit any file - automatic checkpoint created');
    console.log('  2. Start new tasks - task checkpoints with GitHub releases');
    console.log('  3. End sessions - comprehensive GitHub summary');
    
    console.log('\n📚 Checkpoint Management:\n');
    console.log('  # List all checkpoints');
    console.log('  .claude/helpers/checkpoint-manager.sh list');
    console.log('');
    console.log('  # View GitHub releases');
    console.log('  gh release list');
    console.log('');
    console.log('  # Rollback to checkpoint');
    console.log('  .claude/helpers/checkpoint-manager.sh rollback checkpoint-YYYYMMDD-HHMMSS');
    console.log('');
    console.log('  # Download release');
    console.log('  gh release download checkpoint-YYYYMMDD-HHMMSS');
    
    if (!ghAvailable) {
      console.log('\n⚠️  Note: Install GitHub CLI for full features:');
      console.log('  https://cli.github.com/');
    }
    
    console.log('\n💡 Pro tip: GitHub releases make it easy to share checkpoints with your team!');
    
  } catch (error) {
    printError(`❌ Failed to initialize GitHub hooks: ${error.message}`);
    console.error(error);
  }
}