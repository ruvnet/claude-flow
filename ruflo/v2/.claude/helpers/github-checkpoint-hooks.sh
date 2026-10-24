#!/bin/bash
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
                local diff_stats=$(git diff HEAD~1 --stat | tr '\n' ' ' | sed 's/"/\\"/g')
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
    local task=$(echo "$user_prompt" | head -c 100 | tr '\n' ' ')
    
    if [ -n "$task" ]; then
        local checkpoint_name="task-$(date +%Y%m%d-%H%M%S)"
        
        # Commit current state
        git add -A
        git commit -m "🔖 Task checkpoint: $task..." --quiet || true
        
        # Create GitHub release if gh CLI is available
        if command -v gh &> /dev/null; then
            echo "🚀 Creating GitHub release for checkpoint..."
            gh release create "$checkpoint_name" \
                --title "Checkpoint: $(date +'%Y-%m-%d %H:%M')" \
                --notes "Task: $task

## Checkpoint Details
- Branch: $(git branch --show-current)
- Commit: $(git rev-parse HEAD)
- Files changed: $(git diff HEAD~1 --stat | wc -l) files

## Rollback Instructions
```bash
# To rollback to this checkpoint:
git checkout $checkpoint_name
```" \
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
$(find .claude/checkpoints -name '*.json' -mtime -1 -exec basename {} \; | sort)

## Files Modified
$(git diff --name-only $(git log --format=%H -n 1 --before="1 hour ago" 2>/dev/null) 2>/dev/null || echo "No files tracked")

## Recent Commits
$(git log --oneline -10 --grep="Checkpoint" || echo "No checkpoint commits")

## GitHub Releases Created
$(gh release list --limit 10 | grep "checkpoint-" || echo "No GitHub releases")

## Rollback Instructions
To rollback to a specific checkpoint:
```bash
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
```
EOF
    
    # Create final checkpoint
    git add -A
    git commit -m "🏁 Session end checkpoint: $session_id" --quiet || true
    git tag -a "session-end-$session_id" -m "End of Claude session"
    
    # Create GitHub session summary if gh is available
    if command -v gh &> /dev/null; then
        echo "📊 Creating GitHub session summary..."
        gh release create "session-$session_id" \
            --title "Session Summary: $(date +'%Y-%m-%d %H:%M')" \
            --notes-file "$summary_file" \
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
