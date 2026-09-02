#!/usr/bin/env node
/**
 * GitHub API Integration Module
 * Provides authentication, rate limiting, and API wrappers for GitHub workflow commands
 * 
 * Enhanced with GitHub CLI Safety Wrapper for secure command execution
 */

import { printSuccess, printError, printWarning, printInfo } from '../utils.js';
import { githubCli, GitHubCliSafe } from '../../utils/github-cli-safety-wrapper.js';

// GitHub API Configuration
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_RATE_LIMIT = 5000; // API calls per hour
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

class GitHubAPIClient {
  constructor(token = null) {
    this.token = token || process.env.GITHUB_TOKEN;
    this.rateLimitRemaining = GITHUB_RATE_LIMIT;
    this.rateLimitResetTime = null;
    this.lastRequestTime = 0;
    this.requestQueue = [];
    this.isProcessingQueue = false;
    
    // Initialize GitHub CLI safety wrapper
    this.cliSafe = new GitHubCliSafe({
      timeout: 60000,           // 1 minute timeout for CLI operations
      maxRetries: 3,
      enableRateLimit: true,
      enableLogging: false      // Can be enabled for debugging
    });
  }

  /**
   * Authentication Methods
   */
  async authenticate(token = null) {
    if (token) {
      this.token = token;
    }

    if (!this.token) {
      printError('GitHub token not found. Set GITHUB_TOKEN environment variable or provide token.');
      return false;
    }

    try {
      const response = await this.request('/user');
      if (response.success) {
        printSuccess(`Authenticated as ${response.data.login}`);
        return true;
      }
      return false;
    } catch (error) {
      printError(`Authentication failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Rate Limiting Management
   */
  async checkRateLimit() {
    if (this.rateLimitRemaining <= 1) {
      const resetTime = new Date(this.rateLimitResetTime);
      const now = new Date();
      const waitTime = resetTime.getTime() - now.getTime();

      if (waitTime > 0) {
        printWarning(`Rate limit exceeded. Waiting ${Math.ceil(waitTime / 1000)}s...`);
        await this.sleep(waitTime);
      }
    }
  }

  updateRateLimitInfo(headers) {
    this.rateLimitRemaining = parseInt(headers['x-ratelimit-remaining'] || '0');
    this.rateLimitResetTime = new Date((parseInt(headers['x-ratelimit-reset']) || 0) * 1000);
  }

  /**
   * Core API Request Method
   */
  async request(endpoint, options = {}) {
    await this.checkRateLimit();

    const url = endpoint.startsWith('http') ? endpoint : `${GITHUB_API_BASE}${endpoint}`;
    const headers = {
      Authorization: `token ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Claude-Flow-GitHub-Integration',
      ...options.headers,
    };

    const requestOptions = {
      method: options.method || 'GET',
      headers,
      ...options,
    };

    if (options.body) {
      requestOptions.body = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(url, requestOptions);
      this.updateRateLimitInfo(response.headers);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(`GitHub API error: ${data.message || response.statusText}`);
      }

      return {
        success: true,
        data,
        headers: response.headers,
        status: response.status,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: error.status || 500,
      };
    }
  }

  /**
   * Repository Operations
   */
  async getRepository(owner, repo) {
    return await this.request(`/repos/${owner}/${repo}`);
  }

  async listRepositories(options = {}) {
    const params = new URLSearchParams({
      sort: options.sort || 'updated',
      direction: options.direction || 'desc',
      per_page: options.perPage || 30,
      page: options.page || 1,
    });

    return await this.request(`/user/repos?${params}`);
  }

  async createRepository(repoData) {
    return await this.request('/user/repos', {
      method: 'POST',
      body: repoData,
    });
  }

  /**
   * Pull Request Operations
   */
  async listPullRequests(owner, repo, options = {}) {
    const params = new URLSearchParams({
      state: options.state || 'open',
      sort: options.sort || 'created',
      direction: options.direction || 'desc',
      per_page: options.perPage || 30,
      page: options.page || 1,
    });

    return await this.request(`/repos/${owner}/${repo}/pulls?${params}`);
  }

  async createPullRequest(owner, repo, prData) {
    return await this.request(`/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body: prData,
    });
  }

  async updatePullRequest(owner, repo, prNumber, prData) {
    return await this.request(`/repos/${owner}/${repo}/pulls/${prNumber}`, {
      method: 'PATCH',
      body: prData,
    });
  }

  async mergePullRequest(owner, repo, prNumber, mergeData) {
    return await this.request(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
      method: 'PUT',
      body: mergeData,
    });
  }

  async requestPullRequestReview(owner, repo, prNumber, reviewData) {
    return await this.request(`/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`, {
      method: 'POST',
      body: reviewData,
    });
  }

  /**
   * Issue Operations
   */
  async listIssues(owner, repo, options = {}) {
    const params = new URLSearchParams({
      state: options.state || 'open',
      sort: options.sort || 'created',
      direction: options.direction || 'desc',
      per_page: options.perPage || 30,
      page: options.page || 1,
    });

    if (options.labels) {
      params.append('labels', options.labels);
    }

    return await this.request(`/repos/${owner}/${repo}/issues?${params}`);
  }

  async createIssue(owner, repo, issueData) {
    return await this.request(`/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      body: issueData,
    });
  }

  async updateIssue(owner, repo, issueNumber, issueData) {
    return await this.request(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
      method: 'PATCH',
      body: issueData,
    });
  }

  async addIssueLabels(owner, repo, issueNumber, labels) {
    return await this.request(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
      method: 'POST',
      body: { labels },
    });
  }

  async assignIssue(owner, repo, issueNumber, assignees) {
    return await this.request(`/repos/${owner}/${repo}/issues/${issueNumber}/assignees`, {
      method: 'POST',
      body: { assignees },
    });
  }

  /**
   * Release Operations
   */
  async listReleases(owner, repo, options = {}) {
    const params = new URLSearchParams({
      per_page: options.perPage || 30,
      page: options.page || 1,
    });

    return await this.request(`/repos/${owner}/${repo}/releases?${params}`);
  }

  async createRelease(owner, repo, releaseData) {
    return await this.request(`/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      body: releaseData,
    });
  }

  async updateRelease(owner, repo, releaseId, releaseData) {
    return await this.request(`/repos/${owner}/${repo}/releases/${releaseId}`, {
      method: 'PATCH',
      body: releaseData,
    });
  }

  async deleteRelease(owner, repo, releaseId) {
    return await this.request(`/repos/${owner}/${repo}/releases/${releaseId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Workflow Operations
   */
  async listWorkflows(owner, repo) {
    return await this.request(`/repos/${owner}/${repo}/actions/workflows`);
  }

  async triggerWorkflow(owner, repo, workflowId, ref = 'main', inputs = {}) {
    return await this.request(
      `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
      {
        method: 'POST',
        body: { ref, inputs },
      },
    );
  }

  async listWorkflowRuns(owner, repo, options = {}) {
    const params = new URLSearchParams({
      per_page: options.perPage || 30,
      page: options.page || 1,
    });

    if (options.status) {
      params.append('status', options.status);
    }

    return await this.request(`/repos/${owner}/${repo}/actions/runs?${params}`);
  }

  /**
   * Branch Operations
   */
  async listBranches(owner, repo) {
    return await this.request(`/repos/${owner}/${repo}/branches`);
  }

  async createBranch(owner, repo, branchName, sha) {
    return await this.request(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: {
        ref: `refs/heads/${branchName}`,
        sha,
      },
    });
  }

  async getBranchProtection(owner, repo, branch) {
    return await this.request(`/repos/${owner}/${repo}/branches/${branch}/protection`);
  }

  async updateBranchProtection(owner, repo, branch, protection) {
    return await this.request(`/repos/${owner}/${repo}/branches/${branch}/protection`, {
      method: 'PUT',
      body: protection,
    });
  }

  /**
   * Webhook Operations
   */
  async listWebhooks(owner, repo) {
    return await this.request(`/repos/${owner}/${repo}/hooks`);
  }

  async createWebhook(owner, repo, webhookData) {
    return await this.request(`/repos/${owner}/${repo}/hooks`, {
      method: 'POST',
      body: webhookData,
    });
  }

  async updateWebhook(owner, repo, hookId, webhookData) {
    return await this.request(`/repos/${owner}/${repo}/hooks/${hookId}`, {
      method: 'PATCH',
      body: webhookData,
    });
  }

  async deleteWebhook(owner, repo, hookId) {
    return await this.request(`/repos/${owner}/${repo}/hooks/${hookId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Event Processing
   */
  async processWebhookEvent(event, signature, payload) {
    if (!this.verifyWebhookSignature(signature, payload)) {
      throw new Error('Invalid webhook signature');
    }

    const eventData = JSON.parse(payload);

    switch (event) {
      case 'push':
        return this.handlePushEvent(eventData);
      case 'pull_request':
        return this.handlePullRequestEvent(eventData);
      case 'issues':
        return this.handleIssuesEvent(eventData);
      case 'release':
        return this.handleReleaseEvent(eventData);
      case 'workflow_run':
        return this.handleWorkflowRunEvent(eventData);
      default:
        printInfo(`Unhandled event type: ${event}`);
        return { handled: false, event };
    }
  }

  verifyWebhookSignature(signature, payload) {
    if (!GITHUB_WEBHOOK_SECRET) {
      printWarning('GITHUB_WEBHOOK_SECRET not set. Skipping signature verification.');
      return true;
    }

    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
    hmac.update(payload);
    const expectedSignature = `sha256=${hmac.digest('hex')}`;

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  }

  /**
   * Event Handlers
   */
  async handlePushEvent(eventData) {
    printInfo(`Push event: ${eventData.commits.length} commits to ${eventData.ref}`);
    return { handled: true, event: 'push', data: eventData };
  }

  async handlePullRequestEvent(eventData) {
    const action = eventData.action;
    const pr = eventData.pull_request;
    printInfo(`Pull request ${action}: #${pr.number} - ${pr.title}`);
    return { handled: true, event: 'pull_request', action, data: eventData };
  }

  async handleIssuesEvent(eventData) {
    const action = eventData.action;
    const issue = eventData.issue;
    printInfo(`Issue ${action}: #${issue.number} - ${issue.title}`);
    return { handled: true, event: 'issues', action, data: eventData };
  }

  async handleReleaseEvent(eventData) {
    const action = eventData.action;
    const release = eventData.release;
    printInfo(`Release ${action}: ${release.tag_name} - ${release.name}`);
    return { handled: true, event: 'release', action, data: eventData };
  }

  async handleWorkflowRunEvent(eventData) {
    const action = eventData.action;
    const workflowRun = eventData.workflow_run;
    printInfo(`Workflow run ${action}: ${workflowRun.name} - ${workflowRun.conclusion}`);
    return { handled: true, event: 'workflow_run', action, data: eventData };
  }

  /**
   * Utility Methods
   */
  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  parseRepository(repoString) {
    const match = repoString.match(/^([^/]+)\/([^/]+)$/);
    if (!match) {
      throw new Error('Invalid repository format. Use: owner/repo');
    }
    return { owner: match[1], repo: match[2] };
  }

  formatDate(dateString) {
    return new Date(dateString).toLocaleString();
  }

  formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Safe GitHub CLI Methods
   * These methods use the GitHubCliSafe wrapper for secure command execution
   */

  /**
   * Create issue using GitHub CLI (safe alternative to createIssue API method)
   * @param {Object} issueData - Issue data
   * @returns {Promise<Object>} - CLI execution result
   */
  async createIssueCLI(issueData) {
    try {
      const result = await this.cliSafe.createIssue({
        title: issueData.title,
        body: issueData.body,
        labels: issueData.labels || [],
        assignees: issueData.assignees || []
      });
      
      printSuccess(`Issue created via CLI: ${issueData.title}`);
      return { success: true, data: result };
    } catch (error) {
      printError(`Failed to create issue via CLI: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create PR using GitHub CLI (safe alternative to createPullRequest API method)
   * @param {Object} prData - PR data
   * @returns {Promise<Object>} - CLI execution result
   */
  async createPullRequestCLI(prData) {
    try {
      const result = await this.cliSafe.createPR({
        title: prData.title,
        body: prData.body,
        base: prData.base || 'main',
        head: prData.head,
        draft: prData.draft || false
      });
      
      printSuccess(`PR created via CLI: ${prData.title}`);
      return { success: true, data: result };
    } catch (error) {
      printError(`Failed to create PR via CLI: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add issue comment using GitHub CLI
   * @param {number} issueNumber - Issue number
   * @param {string} body - Comment body
   * @returns {Promise<Object>} - CLI execution result
   */
  async addIssueCommentCLI(issueNumber, body) {
    try {
      const result = await this.cliSafe.addIssueComment(issueNumber, body);
      printSuccess(`Comment added to issue #${issueNumber}`);
      return { success: true, data: result };
    } catch (error) {
      printError(`Failed to add comment to issue #${issueNumber}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add PR comment using GitHub CLI
   * @param {number} prNumber - PR number
   * @param {string} body - Comment body
   * @returns {Promise<Object>} - CLI execution result
   */
  async addPRCommentCLI(prNumber, body) {
    try {
      const result = await this.cliSafe.addPRComment(prNumber, body);
      printSuccess(`Comment added to PR #${prNumber}`);
      return { success: true, data: result };
    } catch (error) {
      printError(`Failed to add comment to PR #${prNumber}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create release using GitHub CLI
   * @param {Object} releaseData - Release data
   * @returns {Promise<Object>} - CLI execution result
   */
  async createReleaseCLI(releaseData) {
    try {
      const result = await this.cliSafe.createRelease({
        tag: releaseData.tag_name,
        title: releaseData.name,
        body: releaseData.body,
        prerelease: releaseData.prerelease || false,
        draft: releaseData.draft || false
      });
      
      printSuccess(`Release created via CLI: ${releaseData.tag_name}`);
      return { success: true, data: result };
    } catch (error) {
      printError(`Failed to create release via CLI: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check GitHub CLI authentication and availability
   * @returns {Promise<boolean>} - True if CLI is ready to use
   */
  async checkCLIStatus() {
    try {
      const isAvailable = await this.cliSafe.checkGitHubCli();
      if (!isAvailable) {
        printWarning('GitHub CLI is not installed or not in PATH');
        return false;
      }

      const isAuthenticated = await this.cliSafe.checkAuthentication();
      if (!isAuthenticated) {
        printWarning('GitHub CLI is not authenticated. Run: gh auth login');
        return false;
      }

      printSuccess('GitHub CLI is ready for use');
      return true;
    } catch (error) {
      printError(`GitHub CLI status check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get GitHub CLI wrapper statistics
   * @returns {Object} - Usage statistics
   */
  getCLIStats() {
    return this.cliSafe.getStats();
  }

  /**
   * Cleanup CLI resources (call before shutdown)
   */
  async cleanupCLI() {
    await this.cliSafe.cleanup();
  }
}

// Export singleton instance
export const githubAPI = new GitHubAPIClient();
export default GitHubAPIClient;
