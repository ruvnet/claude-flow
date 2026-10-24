/**
 * GitHubInit - GitHub integration initialization mode
 * Sets up GitHub integration with repository management and workflows
 */

import { IInitMode, InitConfig, InitResult } from '../types/interfaces.js';

export class GitHubInit implements IInitMode {
  getDescription(): string {
    return 'GitHub integration initialization with repository management, PR automation, and workflow coordination';
  }

  getRequiredComponents(): string[] {
    return ['ConfigManager', 'DatabaseManager', 'TopologyManager', 'AgentRegistry', 'MCPIntegrator'];
  }

  validate(): boolean {
    // Check if GitHub token is available
    return !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
  }

  async initialize(config: InitConfig): Promise<InitResult> {
    const components: string[] = [];

    try {
      // Validate GitHub configuration
      if (!this.validate()) {
        throw new Error('GitHub token not found. Set GITHUB_TOKEN or GH_TOKEN environment variable.');
      }

      // Basic initialization
      if (config.configManager) {
        components.push('ConfigManager');
      }

      if (config.databaseManager) {
        await config.databaseManager.initialize();
        components.push('DatabaseManager');
      }

      // Use hierarchical topology for GitHub workflows
      if (config.topologyManager) {
        await config.topologyManager.configure('hierarchical', []);
        components.push('TopologyManager');
      }

      if (config.agentRegistry) {
        await config.agentRegistry.initialize();
        components.push('AgentRegistry');
      }

      // Spawn GitHub-specific agents
      if (config.agentRegistry) {
        // PR management agent
        await config.agentRegistry.spawn('coordinator', {
          capabilities: ['github-pr', 'code-review', 'workflow-management'],
          metadata: { specialization: 'github-pr-manager' }
        });

        // Repository analysis agent
        await config.agentRegistry.spawn('analyst', {
          capabilities: ['repository-analysis', 'code-quality', 'security-audit'],
          metadata: { specialization: 'repo-analyzer' }
        });

        // Issue tracking agent
        await config.agentRegistry.spawn('coordinator', {
          capabilities: ['issue-tracking', 'project-management', 'triage'],
          metadata: { specialization: 'issue-manager' }
        });

        // Release coordination agent
        await config.agentRegistry.spawn('coordinator', {
          capabilities: ['release-management', 'versioning', 'deployment'],
          metadata: { specialization: 'release-coordinator' }
        });

        // Code review agent
        await config.agentRegistry.spawn('reviewer', {
          capabilities: ['code-review', 'security-check', 'best-practices'],
          metadata: { specialization: 'code-reviewer' }
        });

        components.push('GitHubAgents');
      }

      // Initialize GitHub MCP integration
      if (config.mcpIntegrator) {
        await config.mcpIntegrator.initialize();

        // Test GitHub MCP functions
        const githubStatus = await config.mcpIntegrator.executeCommand({
          tool: 'claude-flow',
          function: 'github_repo_analyze',
          parameters: { repo: 'test/repo', analysis_type: 'code_quality' }
        });

        if (githubStatus.success) {
          components.push('GitHubMCP');
        }
      }

      // Set up GitHub-specific memory namespace
      if (config.databaseManager) {
        await config.databaseManager.store('github-config', {
          initialized: true,
          mode: 'github',
          features: ['pr-automation', 'issue-tracking', 'code-review', 'release-management'],
          timestamp: new Date().toISOString()
        }, 'github');
        components.push('GitHubMemory');
      }

      return {
        success: true,
        mode: 'github',
        components,
        topology: 'hierarchical',
        message: 'GitHub integration initialization completed successfully',
        metadata: {
          githubIntegration: true,
          prAutomation: true,
          codeReview: true,
          issueTracking: true,
          releaseManagement: true
        }
      };

    } catch (error) {
      return {
        success: false,
        mode: 'github',
        components,
        error: error instanceof Error ? error.message : String(error),
        message: 'GitHub initialization failed'
      };
    }
  }
}