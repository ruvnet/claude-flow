/**
 * GitIgnore updater for Claude Flow initialization
 * Ensures Claude Flow generated files are properly ignored
 */

import { existsSync, readTextFile, writeTextFile } from '../../node-compat.js';

/**
 * Default gitignore entries for Claude Flow
 */
const CLAUDE_FLOW_GITIGNORE_ENTRIES = `
# Claude Flow generated files
.claude/settings.local.json
.mcp.json
claude-flow.config.json
.swarm/
.hive-mind/
.claude-flow/
memory/
coordination/
memory/claude-flow-data.json
memory/sessions/*
!memory/sessions/README.md
memory/agents/*
!memory/agents/README.md
coordination/memory_bank/*
coordination/subtasks/*
coordination/orchestration/*
*.db
*.db-journal
*.db-wal
*.sqlite
*.sqlite-journal
*.sqlite-wal
claude-flow
# Removed Windows wrapper files per user request
hive-mind-prompt-*.txt
`;

/**
 * Update or create .gitignore with Claude Flow entries
 * @param {string} workingDir - The working directory
 * @param {boolean} force - Whether to force update even if entries exist
 * @param {boolean} dryRun - Whether to run in dry-run mode
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function updateGitignore(workingDir, force = false, dryRun = false) {
  const gitignorePath = `${workingDir}/.gitignore`;

  try {
    let gitignoreContent = '';
    let fileExists = false;

    // Check if .gitignore exists
    if (existsSync(gitignorePath)) {
      fileExists = true;
      gitignoreContent = await readTextFile(gitignorePath);
    }

    // Check if Claude Flow section already exists
    const claudeFlowMarker = '# Claude Flow generated files';
    if (gitignoreContent.includes(claudeFlowMarker) && !force) {
      return {
        success: true,
        message: '.gitignore already contains Claude Flow entries',
      };
    }

    // Prepare the new content
    let newContent = gitignoreContent;

    // Remove existing Claude Flow section if force updating
    if (force && gitignoreContent.includes(claudeFlowMarker)) {
      const startIndex = gitignoreContent.indexOf(claudeFlowMarker);
      const endIndex = gitignoreContent.indexOf('\n# ', startIndex + 1);
      if (endIndex !== -1) {
        newContent =
          gitignoreContent.substring(0, startIndex) + gitignoreContent.substring(endIndex);
      } else {
        // Claude Flow section is at the end
        newContent = gitignoreContent.substring(0, startIndex);
      }
    }

    // Add Claude Flow entries
    if (!newContent.endsWith('\n') && newContent.length > 0) {
      newContent += '\n';
    }
    newContent += CLAUDE_FLOW_GITIGNORE_ENTRIES;

    // Write the file
    if (!dryRun) {
      await writeTextFile(gitignorePath, newContent);
    }

    return {
      success: true,
      message: fileExists
        ? (dryRun ? '[DRY RUN] Would update' : 'Updated') +
          ' existing .gitignore with Claude Flow entries'
        : (dryRun ? '[DRY RUN] Would create' : 'Created') + ' .gitignore with Claude Flow entries',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to update .gitignore: ${error.message}`,
    };
  }
}

/**
 * Check if gitignore needs updating
 * @param {string} workingDir - The working directory
 * @returns {Promise<boolean>}
 */
export async function needsGitignoreUpdate(workingDir) {
  const gitignorePath = `${workingDir}/.gitignore`;

  if (!existsSync(gitignorePath)) {
    return true;
  }

  try {
    const content = await readTextFile(gitignorePath);
    return !content.includes('# Claude Flow generated files');
  } catch {
    return true;
  }
}

/**
 * Get list of files that should be gitignored
 * @returns {string[]}
 */
export function getGitignorePatterns() {
  return CLAUDE_FLOW_GITIGNORE_ENTRIES.split('\n')
    .filter((line) => line.trim() && !line.startsWith('#') && !line.startsWith('!'))
    .map((line) => line.trim());
}
