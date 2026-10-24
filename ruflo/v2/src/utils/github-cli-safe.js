/**
 * DEPRECATED: Use github-cli-safety-wrapper.js instead
 * This file is maintained for backward compatibility only
 * 
 * Safe GitHub CLI command execution utilities
 * Prevents shell injection and timeout issues with special characters
 */

import { 
  GitHubCliSafe, 
  githubCli, 
  safeGhCommand as newSafeGhCommand 
} from './github-cli-safety-wrapper.js';

/**
 * @deprecated Use GitHubCliSafe class from github-cli-safety-wrapper.js
 * Execute GitHub CLI command with safe body content handling
 * @param {string} command - The gh command (e.g., 'issue comment')
 * @param {string} target - Target (issue/PR number or repo)
 * @param {string} body - Body content that may contain special characters
 * @param {Object} options - Additional options
 * @returns {Promise<string>} - Command output
 */
export async function safeGhCommand(command, target, body, options = {}) {
  console.warn('safeGhCommand is deprecated. Use GitHubCliSafe from github-cli-safety-wrapper.js');
  
  try {
    const result = await newSafeGhCommand(command, target, body, options);
    return result.stdout;
  } catch (error) {
    throw error;
  }
}

/**
 * @deprecated This function is deprecated and will be removed
 * Execute command with timeout and proper cleanup
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<string>} - Command output
 */
function executeWithTimeout(command, args, timeout) {
  console.warn('executeWithTimeout is deprecated. Use GitHubCliSafe.executeWithTimeout instead');
  
  // Forward to new implementation via GitHubCliSafe
  const ghSafe = new GitHubCliSafe({ timeout });
  return ghSafe.executeWithTimeout(command.replace('gh ', ''), args.slice(1), { timeout });
}

/**
 * @deprecated Use gh object from github-cli-safety-wrapper.js
 * Safe methods for common GitHub CLI operations
 */
export const gh = {
  /**
   * @deprecated Use githubCli.addIssueComment instead
   * Create issue comment safely
   * @param {number|string} issue - Issue number
   * @param {string} body - Comment body
   * @param {Object} options - Additional options
   */
  async issueComment(issue, body, options = {}) {
    console.warn('gh.issueComment is deprecated. Use githubCli.addIssueComment instead');
    const result = await githubCli.addIssueComment(issue, body, options);
    return result.stdout;
  },
  
  /**
   * @deprecated Use githubCli.addPRComment instead
   * Create PR comment safely
   * @param {number|string} pr - PR number
   * @param {string} body - Comment body
   * @param {Object} options - Additional options
   */
  async prComment(pr, body, options = {}) {
    console.warn('gh.prComment is deprecated. Use githubCli.addPRComment instead');
    const result = await githubCli.addPRComment(pr, body, options);
    return result.stdout;
  },
  
  /**
   * @deprecated Use githubCli.createIssue instead
   * Create issue safely
   * @param {Object} params - Issue parameters
   */
  async createIssue({ title, body, labels = [], assignees = [] }) {
    console.warn('gh.createIssue is deprecated. Use githubCli.createIssue instead');
    const result = await githubCli.createIssue({ title, body, labels, assignees });
    return result.stdout;
  },
  
  /**
   * @deprecated Use githubCli.createPR instead
   * Create PR safely
   * @param {Object} params - PR parameters
   */
  async createPR({ title, body, base = 'main', head, draft = false }) {
    console.warn('gh.createPR is deprecated. Use githubCli.createPR instead');
    const result = await githubCli.createPR({ title, body, base, head, draft });
    return result.stdout;
  }
};

/**
 * Example usage:
 * 
 * import { gh } from './github-cli-safe.js';
 * 
 * // Safe issue comment with special characters
 * await gh.issueComment(123, 'Code: `npm install` and $(echo test)');
 * 
 * // Safe PR creation with complex body
 * await gh.createPR({
 *   title: 'Fix: Handle special characters',
 *   body: 'This fixes issues with `backticks` and .claude/agents/ paths',
 *   base: 'main'
 * });
 */