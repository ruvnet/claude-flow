/**
 * Dynamic Agent Loader - Reads agent definitions from .claude/agents/ directory
 * This is the single source of truth for all agent types in the system
 */

import { readFileSync, existsSync } from 'node:fs';
import { glob } from 'glob';
import { resolve, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';

// Legacy agent type mapping for backward compatibility
const LEGACY_AGENT_MAPPING = {
  analyst: 'code-analyzer',
  coordinator: 'task-orchestrator', 
  optimizer: 'perf-analyzer',
  documenter: 'api-docs',
  monitor: 'performance-benchmarker',
  specialist: 'system-architect',
  architect: 'system-architect',
} as const;

/**
 * Resolve legacy agent types to current equivalents
 */
function resolveLegacyAgentType(legacyType: string): string {
  return LEGACY_AGENT_MAPPING[legacyType as keyof typeof LEGACY_AGENT_MAPPING] || legacyType;
}

export interface AgentDefinition {
  name: string;
  type?: string;
  color?: string;
  description: string;
  capabilities?: string[];
  priority?: 'low' | 'medium' | 'high' | 'critical';
  hooks?: {
    pre?: string;
    post?: string;
  };
  content?: string; // The markdown content after frontmatter
}

export interface AgentCategory {
  name: string;
  agents: AgentDefinition[];
}

class AgentLoader {
  private agentCache: Map<string, AgentDefinition> = new Map();
  private categoriesCache: AgentCategory[] = [];
  private lastLoadTime = 0;
  private cacheExpiry = 60000; // 1 minute cache

  /**
   * Get the .claude/agents directory path
   */
  private getAgentsDirectory(): string {
    // Start from current working directory and walk up to find .claude/agents
    let currentDir = process.cwd();
    
    while (currentDir !== '/') {
      const claudeAgentsPath = resolve(currentDir, '.claude', 'agents');
      if (existsSync(claudeAgentsPath)) {
        return claudeAgentsPath;
      }
      currentDir = dirname(currentDir);
    }
    
    // Fallback to relative path
    return resolve(process.cwd(), '.claude', 'agents');
  }

  /**
   * Parse agent definition from markdown file
   */
  private parseAgentFile(filePath: string): AgentDefinition | null {
    try {
      const content = readFileSync(filePath, 'utf-8');
      
      // Split frontmatter and content
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!frontmatterMatch) {
        console.warn(`No frontmatter found in ${filePath}`);
        return null;
      }

      const [, yamlContent, markdownContent] = frontmatterMatch;
      const frontmatter = parseYaml(yamlContent);

      if (!frontmatter.name || !frontmatter.metadata?.description) {
        console.warn(`Missing required fields (name, metadata.description) in ${filePath}`);
        return null;
      }

      return {
        name: frontmatter.name,
        type: frontmatter.type,
        color: frontmatter.color,
        description: frontmatter.metadata.description,
        capabilities: frontmatter.metadata.capabilities || frontmatter.capabilities || [],
        priority: frontmatter.priority || 'medium',
        hooks: frontmatter.hooks,
        content: markdownContent.trim(),
      };
    } catch (error) {
      console.error(`Error parsing agent file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Load all agent definitions from .claude/agents directory
   */
  private async loadAgents(): Promise<void> {
    const agentsDir = this.getAgentsDirectory();
    
    if (!existsSync(agentsDir)) {
      console.warn(`Agents directory not found: ${agentsDir}`);
      return;
    }

    // Find all .md files in the agents directory
    const agentFiles = await glob('**/*.md', {
      cwd: agentsDir,
      ignore: ['**/README.md', '**/MIGRATION_SUMMARY.md'],
      absolute: true,
    });

    // Clear cache
    this.agentCache.clear();
    this.categoriesCache = [];

    // Track categories
    const categoryMap = new Map<string, AgentDefinition[]>();

    // Parse each agent file
    for (const filePath of agentFiles) {
      const agent = this.parseAgentFile(filePath);
      if (agent) {
        this.agentCache.set(agent.name, agent);
        
        // Determine category from file path
        const relativePath = filePath.replace(agentsDir, '');
        const pathParts = relativePath.split('/');
        const category = pathParts[1] || 'uncategorized'; // First directory after agents/
        
        if (!categoryMap.has(category)) {
          categoryMap.set(category, []);
        }
        categoryMap.get(category)!.push(agent);
      }
    }

    // Build categories array
    this.categoriesCache = Array.from(categoryMap.entries()).map(([name, agents]) => ({
      name,
      agents: agents.sort((a, b) => a.name.localeCompare(b.name)),
    }));

    this.lastLoadTime = Date.now();
  }

  /**
   * Check if cache needs refresh
   */
  private needsRefresh(): boolean {
    return Date.now() - this.lastLoadTime > this.cacheExpiry;
  }

  /**
   * Ensure agents are loaded and cache is fresh
   */
  private async ensureLoaded(): Promise<void> {
    if (this.agentCache.size === 0 || this.needsRefresh()) {
      await this.loadAgents();
    }
  }

  /**
   * Get all available agent types
   */
  async getAvailableAgentTypes(): Promise<string[]> {
    await this.ensureLoaded();
    const currentTypes = Array.from(this.agentCache.keys());
    const legacyTypes = Object.keys(LEGACY_AGENT_MAPPING);
    // Return both current types and legacy types, removing duplicates
    const combined = [...currentTypes, ...legacyTypes];
    const uniqueTypes = Array.from(new Set(combined));
    return uniqueTypes.sort();
  }

  /**
   * Get agent definition by name
   */
  async getAgent(name: string): Promise<AgentDefinition | null> {
    await this.ensureLoaded();
    // First try the original name, then try the legacy mapping
    return this.agentCache.get(name) || this.agentCache.get(resolveLegacyAgentType(name)) || null;
  }

  /**
   * Get all agent definitions
   */
  async getAllAgents(): Promise<AgentDefinition[]> {
    await this.ensureLoaded();
    return Array.from(this.agentCache.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get agents organized by category
   */
  async getAgentCategories(): Promise<AgentCategory[]> {
    await this.ensureLoaded();
    return this.categoriesCache;
  }

  /**
   * Search agents by capabilities, description, or name
   */
  async searchAgents(query: string): Promise<AgentDefinition[]> {
    await this.ensureLoaded();
    const lowerQuery = query.toLowerCase();
    
    return Array.from(this.agentCache.values()).filter(agent => {
      return (
        agent.name.toLowerCase().includes(lowerQuery) ||
        agent.description.toLowerCase().includes(lowerQuery) ||
        agent.capabilities?.some(cap => cap.toLowerCase().includes(lowerQuery)) ||
        false
      );
    });
  }

  /**
   * Check if an agent type is valid
   */
  async isValidAgentType(name: string): Promise<boolean> {
    await this.ensureLoaded();
    // First try the original name, then try the legacy mapping
    return this.agentCache.has(name) || this.agentCache.has(resolveLegacyAgentType(name));
  }

  /**
   * Get agents by category name
   */
  async getAgentsByCategory(category: string): Promise<AgentDefinition[]> {
    const categories = await this.getAgentCategories();
    const found = categories.find(cat => cat.name === category);
    return found?.agents || [];
  }

  /**
   * Force refresh the agent cache
   */
  async refresh(): Promise<void> {
    this.lastLoadTime = 0; // Force reload
    await this.loadAgents();
  }
}

// Singleton instance
export const agentLoader = new AgentLoader();

// Convenience functions
export const getAvailableAgentTypes = () => agentLoader.getAvailableAgentTypes();
export const getAgent = (name: string) => agentLoader.getAgent(name);
export const getAllAgents = () => agentLoader.getAllAgents();
export const getAgentCategories = () => agentLoader.getAgentCategories();
export const searchAgents = (query: string) => agentLoader.searchAgents(query);
export const isValidAgentType = (name: string) => agentLoader.isValidAgentType(name);
export const getAgentsByCategory = (category: string) => agentLoader.getAgentsByCategory(category);
export const refreshAgents = () => agentLoader.refresh();

// Export legacy mapping utilities
export { resolveLegacyAgentType, LEGACY_AGENT_MAPPING };