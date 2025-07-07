// github-enhanced.js - Enhanced GitHub command documentation templates

export function createGithubEnhancedCommands() {
  return {
    'issue-tracker-enhanced.md': `# GitHub Issue Tracker - Enhanced with CLI Integration

## Purpose
Intelligent issue management and project coordination with ruv-swarm integration for automated tracking, progress monitoring, and team coordination. Enhanced with GitHub CLI commands for direct issue manipulation.

## Capabilities
- **Automated issue creation** with smart templates and labeling
- **Progress tracking** with swarm-coordinated updates
- **Multi-agent collaboration** on complex issues
- **Project milestone coordination** with integrated workflows
- **Cross-repository issue synchronization** for monorepo management
- **GitHub CLI integration** for direct issue operations
- **Real-time issue verification** and status updates

## Tools Available
- \`mcp__github__create_issue\`
- \`mcp__github__list_issues\`
- \`mcp__github__get_issue\`
- \`mcp__github__update_issue\`
- \`mcp__github__add_issue_comment\`
- \`mcp__github__search_issues\`
- \`mcp__ruv-swarm__*\` (all swarm coordination tools)
- \`TodoWrite\`, \`TodoRead\`, \`Task\`, \`Bash\`, \`Read\`, \`Write\`
- GitHub CLI (\`gh\`) commands via Bash tool

## GitHub CLI Issue Operations

### 1. View Issue Details (e.g., Issue #137)
\`\`\`bash
# View issue details
gh issue view 137 --repo ruvnet/claude-flow

# View with comments
gh issue view 137 --repo ruvnet/claude-flow --comments

# View in web browser
gh issue view 137 --repo ruvnet/claude-flow --web
\`\`\`

### 2. Reply to Issues
\`\`\`bash
# Add a comment to issue #137
gh issue comment 137 --repo ruvnet/claude-flow --body "Progress update: Fixed 400+ TypeScript errors using parallel BatchTool approach. See commit 26cf0ff for details."

# Add comment with formatting
gh issue comment 137 --repo ruvnet/claude-flow --body "$(cat <<'EOF'
## 🚀 Progress Update

### Completed Tasks
- ✅ Fixed 528 TypeScript compilation errors across 84 files
- ✅ Reduced errors by 71% (378 errors fixed)
- ✅ All critical blockers resolved

### Key Improvements
- Map iteration compatibility (Array.from wrapping)
- Import/export statement corrections
- Type annotation additions across 40+ files
- Interface compatibility fixes

See commit: 26cf0ff

🤖 Generated with Claude Code
EOF
)"
\`\`\`

### 3. Update Issue Status and Labels
\`\`\`bash
# Update issue labels
gh issue edit 137 --repo ruvnet/claude-flow --add-label "in-progress,typescript"

# Remove labels
gh issue edit 137 --repo ruvnet/claude-flow --remove-label "needs-triage"

# Update title
gh issue edit 137 --repo ruvnet/claude-flow --title "fix: resolve 400+ TypeScript compilation errors [IN PROGRESS]"

# Update body/description
gh issue edit 137 --repo ruvnet/claude-flow --body "$(cat <<'EOF'
## Issue: TypeScript Compilation Errors

### Status: IN PROGRESS ⚡

### Progress Summary:
- Starting Errors: 528 across 84 files
- Current Errors: ~150 remaining
- Success Rate: 71% reduction

### Completed Fixes:
- [x] simple-cli.ts (75 errors)
- [x] executor-v2.ts (48 errors)
- [x] prompt-copier-enhanced.ts (22 errors)
- [x] mcp/index.ts (21 errors)
- [x] load-balancer.ts (18 errors)
- [x] hive-mind core files (50+ errors)
- [ ] Remaining minor type issues

### Related Commits:
- 26cf0ff: fix: resolve 400+ TypeScript compilation errors across 84 files

### Next Steps:
- Continue fixing remaining ~150 errors
- Prepare for npm alpha release
EOF
)"

# Assign issue
gh issue edit 137 --repo ruvnet/claude-flow --add-assignee "@me"

# Set milestone
gh issue edit 137 --repo ruvnet/claude-flow --milestone "v2.0.0-alpha"
\`\`\`

### 4. Verify Issue Updates
\`\`\`bash
# List all open issues with specific labels
gh issue list --repo ruvnet/claude-flow --label "typescript,bug"

# Search for specific issues
gh issue list --repo ruvnet/claude-flow --search "TypeScript errors"

# Get issue status in JSON format for verification
gh issue view 137 --repo ruvnet/claude-flow --json state,labels,assignees,milestone,comments

# Check recent activity on issue
gh issue view 137 --repo ruvnet/claude-flow --json comments --jq '.comments | .[-3:] | .[] | {author: .author.login, body: .body, createdAt: .createdAt}'
\`\`\`

### 5. Batch Issue Operations
\`\`\`bash
# Update multiple issues with same label
for issue in 137 138 139; do
  gh issue edit $issue --repo ruvnet/claude-flow --add-label "typescript-fixed"
done

# Close related issues with comment
gh issue close 137 --repo ruvnet/claude-flow --comment "Fixed in commit 26cf0ff. All TypeScript errors resolved."

# Reopen if needed
gh issue reopen 137 --repo ruvnet/claude-flow --comment "Reopening for additional fixes needed."
\`\`\`

## Enhanced Usage Patterns with Issue #137

### 1. Create Coordinated Fix for Issue #137
\`\`\`javascript
// Initialize TypeScript fix swarm for issue #137
[BatchTool - Single Message]:
  mcp__ruv-swarm__swarm_init { topology: "mesh", maxAgents: 6 }
  mcp__ruv-swarm__agent_spawn { type: "coordinator", name: "TS Fix Coordinator" }
  mcp__ruv-swarm__agent_spawn { type: "coder", name: "CLI Error Fixer" }
  mcp__ruv-swarm__agent_spawn { type: "coder", name: "Executor Error Fixer" }
  mcp__ruv-swarm__agent_spawn { type: "coder", name: "MCP Error Fixer" }
  mcp__ruv-swarm__agent_spawn { type: "analyst", name: "Error Analyzer" }
  mcp__ruv-swarm__agent_spawn { type: "tester", name: "Build Validator" }
  
  // Store issue context
  mcp__ruv-swarm__memory_usage {
    action: "store",
    key: "issue/137/context",
    value: {
      total_errors: 528,
      files_affected: 84,
      priority_files: ["simple-cli.ts", "executor-v2.ts", "mcp/index.ts"],
      strategy: "parallel_fix"
    }
  }
  
  // Update issue with swarm initialization
  Bash("gh issue comment 137 --repo ruvnet/claude-flow --body '🐝 Swarm initialized with 6 agents to fix TypeScript errors in parallel. Starting systematic error resolution...'")
\`\`\`

### 2. Automated Progress Updates for Issue #137
\`\`\`javascript
// After completing major fixes
[BatchTool - Progress Update]:
  // Retrieve progress from memory
  mcp__ruv-swarm__memory_usage {
    action: "retrieve",
    key: "issue/137/progress"
  }
  
  // Update issue with detailed progress
  Bash(\`gh issue comment 137 --repo ruvnet/claude-flow --body "$(cat <<'EOF'
## 📊 Automated Progress Update

### Swarm Activity Summary:
- **Active Agents**: 6/6 working in parallel
- **Files Processed**: 47/84 (56%)
- **Errors Fixed**: 378/528 (71%)

### Agent Reports:
- 🟢 **CLI Error Fixer**: Fixed 75 errors in simple-cli.ts
- 🟢 **Executor Error Fixer**: Fixed 48 errors in executor-v2.ts
- 🟢 **MCP Error Fixer**: Fixed 21 errors in mcp/index.ts
- 🔄 **Error Analyzer**: Identifying patterns in remaining errors
- 🔄 **Build Validator**: Running continuous validation

### Performance Metrics:
- ⚡ Fix Rate: 63 errors/hour
- 🎯 Accuracy: 100% (no regression)
- 💾 Memory Usage: Optimal

### Next Phase:
Continuing with remaining 150 errors across secondary files.

---
🤖 Auto-generated by ruv-swarm coordination
EOF
)"\`)
  
  // Update labels to reflect progress
  Bash("gh issue edit 137 --repo ruvnet/claude-flow --add-label 'in-progress' --remove-label 'needs-triage'")
\`\`\`

### 3. Verification and Completion Workflow
\`\`\`javascript
// Verify all fixes and close issue
[BatchTool - Verification]:
  // Run TypeScript check
  Bash("npx tsc --noEmit 2>&1 | wc -l")
  
  // Get final status
  mcp__ruv-swarm__memory_usage {
    action: "retrieve",
    key: "issue/137/final_status"
  }
  
  // Update issue with completion details
  Bash(\`gh issue comment 137 --repo ruvnet/claude-flow --body "$(cat <<'EOF'
## ✅ Issue Resolution Complete

### Final Results:
- **Initial Errors**: 528 across 84 files
- **Errors Fixed**: 378 (71.6%)
- **Remaining**: ~150 minor type issues (non-blocking)
- **Commit**: 26cf0ff

### All Critical Objectives Met:
- ✅ All compilation blockers resolved
- ✅ Build process functional
- ✅ Alpha package ready for publishing
- ✅ Parallel BatchTool approach validated

### Files Modified: 58
### Execution Time: 2.3 hours
### Swarm Efficiency: 4.2x faster than sequential

Closing issue as primary objectives achieved. Remaining minor issues tracked in #138.

🎉 Successfully resolved by 6-agent swarm coordination!
EOF
)"\`)
  
  // Update issue status
  Bash("gh issue edit 137 --repo ruvnet/claude-flow --add-label 'resolved,typescript-fixed' --remove-label 'in-progress'")
  
  // Close with final comment
  Bash("gh issue close 137 --repo ruvnet/claude-flow --comment 'Resolved in commit 26cf0ff. See PR #140 for merge.'")
\`\`\`

## GitHub CLI Quick Reference

### Essential Commands for Issue Management:
\`\`\`bash
# View commands
gh issue view <number>              # View issue details
gh issue list                       # List all issues
gh issue status                     # Show status of your issues

# Modify commands  
gh issue create                     # Create new issue interactively
gh issue edit <number>              # Edit issue properties
gh issue comment <number>           # Add comment to issue
gh issue close <number>             # Close issue
gh issue reopen <number>            # Reopen issue
gh issue delete <number>            # Delete issue (careful!)

# Search and filter
gh issue list --label "bug"         # Filter by label
gh issue list --assignee @me        # Your assigned issues
gh issue list --search "TypeScript" # Search issues
gh issue list --state closed        # Show closed issues

# Advanced operations
gh issue transfer <number> <repo>   # Transfer to another repo
gh issue pin <number>              # Pin important issue
gh issue lock <number>             # Lock issue conversation
gh issue develop <number>          # Create branch for issue
\`\`\`

## Integration with PR Workflow

### Link Issue #137 to Pull Request:
\`\`\`bash
# Create PR that references issue
gh pr create --title "fix: resolve TypeScript errors (#137)" \\
  --body "Fixes #137 - Resolves 400+ TypeScript compilation errors" \\
  --assignee @me \\
  --label "typescript,bugfix"

# Link existing PR to issue
gh pr edit <pr-number> --body "$(gh pr view <pr-number> --json body -q .body)

Fixes #137"
\`\`\`

## Best Practices for Issue #137 Pattern

### 1. **Parallel Agent Coordination**
- Use BatchTool for all multi-agent operations
- Spawn specialized agents for different error categories
- Maintain coordination through shared memory

### 2. **Automated Progress Tracking**
- Regular CLI-based status updates
- Swarm memory for progress persistence
- Detailed agent activity reporting

### 3. **Issue Lifecycle Management**
- Clear status indicators via labels
- Progressive updates with metrics
- Proper closure with summary

### 4. **Integration with Development**
- Link commits to issues
- Reference in pull requests
- Track in project milestones

## Metrics and Reporting

### Generate Issue Resolution Report:
\`\`\`bash
# Get issue timeline
gh issue view 137 --repo ruvnet/claude-flow --json timeline \\
  --jq '.timeline[] | select(.event == "commented" or .event == "labeled")'

# Export issue data for analysis
gh issue view 137 --repo ruvnet/claude-flow --json \\
  number,title,state,labels,assignees,milestone,comments,createdAt,updatedAt \\
  > issue-137-report.json

# Generate summary metrics
echo "Issue #137 Resolution Metrics:"
echo "- Total Comments: $(gh issue view 137 --json comments --jq '.comments | length')"
echo "- Labels Applied: $(gh issue view 137 --json labels --jq '.labels | map(.name) | join(", ")')"
echo "- Resolution Time: $(gh issue view 137 --json createdAt,closedAt --jq '(.closedAt // now) - .createdAt | ./86400 | floor') days"
\`\`\`

## Conclusion

This enhanced issue tracker provides comprehensive GitHub issue management with:
- Direct CLI integration for real-time operations
- Swarm coordination for complex issue resolution
- Automated progress tracking and reporting
- Full lifecycle management from creation to closure

Use these patterns for efficient issue management and team coordination!`
  };
}

// Update the fallback function to include enhanced GitHub commands
export function createGithubCommandDocFallback(command) {
  const docs = {
    'github-swarm': `# github-swarm

Create specialized GitHub management swarms for repository operations.

## Usage
\`\`\`bash
npx claude-flow github swarm [options]
\`\`\`

## Options
- \`--repository <owner/repo>\` - Target repository
- \`--agents <n>\` - Number of specialized agents
- \`--focus <area>\` - Focus area (issues, prs, releases, maintenance)

## Examples
\`\`\`bash
# Create maintenance swarm
npx claude-flow github swarm --repository owner/repo --agents 5 --focus maintenance

# Issue management swarm
npx claude-flow github swarm --repository owner/repo --focus issues

# Release coordination swarm
npx claude-flow github swarm --focus releases --agents 8
\`\`\`
`,
    'repo-analyze': `# repo-analyze

Deep repository analysis with AI-powered insights.

## Usage
\`\`\`bash
npx claude-flow github repo-analyze [options]
\`\`\`

## Options
- \`--repository <owner/repo>\` - Repository to analyze
- \`--deep\` - Enable deep analysis
- \`--include <areas>\` - Specific areas (issues, prs, code, docs)

## Examples
\`\`\`bash
# Basic analysis
npx claude-flow github repo-analyze --repository owner/repo

# Deep analysis
npx claude-flow github repo-analyze --repository owner/repo --deep

# Specific areas
npx claude-flow github repo-analyze --include issues,prs,code
\`\`\`
`,
    'pr-enhance': `# pr-enhance

AI-powered pull request enhancements.

## Usage
\`\`\`bash
npx claude-flow github pr-enhance [options]
\`\`\`

## Options
- \`--pr-number <n>\` - Pull request number
- \`--add-tests\` - Add missing tests
- \`--improve-docs\` - Improve documentation
- \`--optimize\` - Optimize code

## Examples
\`\`\`bash
# Enhance PR with tests
npx claude-flow github pr-enhance --pr-number 123 --add-tests

# Full enhancement
npx claude-flow github pr-enhance --pr-number 123 --add-tests --improve-docs

# Code optimization
npx claude-flow github pr-enhance --pr-number 123 --optimize
\`\`\`
`,
    'issue-triage': `# issue-triage

Intelligent issue classification and triage.

## Usage
\`\`\`bash
npx claude-flow github issue-triage [options]
\`\`\`

## Options
- \`--repository <owner/repo>\` - Target repository
- \`--auto-label\` - Automatically apply labels
- \`--priority\` - Assign priority levels

## Examples
\`\`\`bash
# Basic triage
npx claude-flow github issue-triage --repository owner/repo

# Auto-label issues
npx claude-flow github issue-triage --auto-label

# With priority assignment
npx claude-flow github issue-triage --auto-label --priority
\`\`\`
`,
    'code-review': `# code-review

Automated code review with swarm intelligence.

## Usage
\`\`\`bash
npx claude-flow github code-review [options]
\`\`\`

## Options
- \`--pr-number <n>\` - Pull request to review
- \`--focus <areas>\` - Review focus (security, performance, style)
- \`--suggest-fixes\` - Suggest code fixes

## Examples
\`\`\`bash
# Basic review
npx claude-flow github code-review --pr-number 123

# Security-focused review
npx claude-flow github code-review --pr-number 123 --focus security

# With fix suggestions
npx claude-flow github code-review --pr-number 123 --suggest-fixes
\`\`\`
`
  };
  
  return docs[command] || `# ${command}

Documentation for this command is coming soon.`;
}