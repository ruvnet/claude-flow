/**
 * MaestroSwarmCoordinator - Native Hive Mind Implementation
 * 
 * Replaces MaestroOrchestrator with native hive mind swarm coordination.
 * Uses specs-driven topology and SwarmOrchestrator for all task management.
 * Eliminates dual agent systems and leverages collective intelligence.
 */

import { EventEmitter } from 'events';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';

// Native hive mind components
import { HiveMind } from '../hive-mind/core/HiveMind.js';
import { Agent } from '../hive-mind/core/Agent.js';
import { ConsensusEngine } from '../hive-mind/integration/ConsensusEngine.js';
import { SwarmOrchestrator } from '../hive-mind/integration/SwarmOrchestrator.js';
import {
  HiveMindConfig,
  TaskSubmitOptions,
  AgentCapability,
  Task,
  ConsensusProposal
} from '../hive-mind/types.js';

// Core infrastructure
import { IEventBus } from '../core/event-bus.js';
import { ILogger } from '../core/logger.js';
import { SystemError } from '../utils/errors.js';

// Maestro types
import {
  MaestroWorkflowState,
  WorkflowPhase,
  MaestroSpec
} from './maestro-types.js';

export interface MaestroSwarmConfig {
  // Native hive mind configuration
  hiveMindConfig: HiveMindConfig;
  
  // Maestro-specific features
  enableConsensusValidation: boolean;
  enableLivingDocumentation: boolean;
  enableSteeringIntegration: boolean;
  
  // File system settings
  specsDirectory: string;
  steeringDirectory: string;
}

/**
 * Native Hive Mind Maestro Coordinator
 * Leverages specs-driven swarm topology for collective intelligence
 */
export class MaestroSwarmCoordinator extends EventEmitter {
  private hiveMind: HiveMind;
  private maestroState: Map<string, MaestroWorkflowState> = new Map();
  private specsDirectory: string;
  private steeringDirectory: string;
  
  constructor(
    private config: MaestroSwarmConfig,
    private eventBus: IEventBus,
    private logger: ILogger
  ) {
    super();
    
    this.specsDirectory = config.specsDirectory || join(process.cwd(), '.claude', 'claude-flow', 'maestro', 'specs');
    this.steeringDirectory = config.steeringDirectory || join(process.cwd(), '.claude', 'claude-flow', 'maestro', 'steering');
    
    this.setupEventHandlers();
    this.logger.info('MaestroSwarmCoordinator initialized with native hive mind');
  }
  
  /**
   * Initialize the specs-driven hive mind swarm
   */
  async initialize(): Promise<string> {
    try {
      // Create specs-driven hive mind with native topology
      const hiveMindConfig: HiveMindConfig = {
        name: 'maestro-specs-driven-swarm',
        topology: 'specs-driven',
        queenMode: 'strategic',
        maxAgents: 8,
        consensusThreshold: 0.66,
        memoryTTL: 86400000, // 24 hours
        autoSpawn: true,  // Automatically spawn topology agents
        enableConsensus: this.config.enableConsensusValidation,
        enableMemory: true,
        enableCommunication: true,
        ...this.config.hiveMindConfig
      };
      
      // Initialize native hive mind
      this.hiveMind = new HiveMind(hiveMindConfig);
      const swarmId = await this.hiveMind.initialize();
      
      // Initialize steering docs in swarm memory if enabled
      if (this.config.enableSteeringIntegration) {
        await this.initializeSteeringMemory();
      }
      
      this.logger.info(`Maestro specs-driven swarm initialized: ${swarmId}`);
      this.emit('initialized', { swarmId });
      
      return swarmId;
      
    } catch (error) {
      this.logger.error(`Failed to initialize maestro swarm: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Create specification using native requirements_analyst agent
   */
  async createSpec(featureName: string, initialRequest: string): Promise<void> {
    const featurePath = join(this.specsDirectory, featureName);
    await mkdir(featurePath, { recursive: true });
    
    // Initialize workflow state
    const workflowState: MaestroWorkflowState = {
      featureName,
      currentPhase: 'Requirements Clarification' as WorkflowPhase,
      currentTaskIndex: 0,
      status: 'running',
      lastActivity: new Date(),
      history: [{
        phase: 'Requirements Clarification' as WorkflowPhase,
        status: 'in-progress',
        timestamp: new Date()
      }]
    };
    
    this.maestroState.set(featureName, workflowState);
    
    // Submit requirements analysis task to native swarm
    const requirementsTask: TaskSubmitOptions = {
      description: `Generate comprehensive requirements for feature: ${featureName}`,
      priority: 'high',
      strategy: 'sequential',
      requiredCapabilities: ['requirements_analysis' as AgentCapability, 'user_story_creation' as AgentCapability, 'acceptance_criteria' as AgentCapability],
      metadata: {
        maestroFeature: featureName,
        maestroPhase: 'Requirements Clarification',
        initialRequest,
        outputFile: join(featurePath, 'requirements.md')
      }
    };
    
    // Use native SwarmOrchestrator through HiveMind
    const task = await this.hiveMind.submitTask(requirementsTask);
    await this.waitForTaskCompletion(task.id, 120000); // 2 minutes
    
    this.logger.info(`Created specification for '${featureName}' using native swarm`);
    this.eventBus.emit('maestro:spec_created', { featureName });
  }
  
  /**
   * Generate design using native design_architect agents with consensus
   */
  async generateDesign(featureName: string): Promise<void> {
    const state = this.maestroState.get(featureName);
    if (!state) {
      throw new SystemError(`No workflow state found for '${featureName}'`);
    }
    
    const featurePath = join(this.specsDirectory, featureName);
    const requirementsPath = join(featurePath, 'requirements.md');
    const requirementsContent = await readFile(requirementsPath, 'utf8');
    
    // Submit design generation task with consensus requirement
    const designTask: TaskSubmitOptions = {
      description: `Generate comprehensive technical design for ${featureName}`,
      priority: 'high',
      strategy: 'parallel',  // Multiple design_architect agents work in parallel
      requiredCapabilities: ['system_design' as AgentCapability, 'architecture' as AgentCapability, 'specs_driven_design' as AgentCapability],
      requireConsensus: this.config.enableConsensusValidation,
      maxAgents: 2,  // Use both design_architect agents
      metadata: {
        maestroFeature: featureName,
        maestroPhase: 'Research & Design',
        requirements: requirementsContent,
        outputFile: join(featurePath, 'design.md')
      }
    };
    
    // Native SwarmOrchestrator handles parallel execution and consensus
    const task = await this.hiveMind.submitTask(designTask);
    await this.waitForTaskCompletion(task.id, 300000); // 5 minutes
    
    // Update workflow state
    state.currentPhase = 'Research & Design' as WorkflowPhase;
    state.lastActivity = new Date();
    state.history.push({
      phase: 'Research & Design' as WorkflowPhase,
      status: 'completed',
      timestamp: new Date()
    });
    
    this.logger.info(`Generated design for '${featureName}' using native swarm consensus`);
    this.eventBus.emit('maestro:design_generated', { featureName });
  }
  
  /**
   * Generate tasks using native task_planner agent
   */
  async generateTasks(featureName: string): Promise<void> {
    const state = this.maestroState.get(featureName);
    if (!state) {
      throw new SystemError(`No workflow state found for '${featureName}'`);
    }
    
    const featurePath = join(this.specsDirectory, featureName);
    const designPath = join(featurePath, 'design.md');
    const designContent = await readFile(designPath, 'utf8');
    
    // Submit task planning to native task_planner agent
    const taskPlanningTask: TaskSubmitOptions = {
      description: `Generate implementation task breakdown for ${featureName}`,
      priority: 'high',
      strategy: 'sequential',
      requiredCapabilities: ['task_management' as AgentCapability, 'workflow_orchestration' as AgentCapability],
      metadata: {
        maestroFeature: featureName,
        maestroPhase: 'Implementation Planning',
        designContent,
        outputFile: join(featurePath, 'tasks.md')
      }
    };
    
    const task = await this.hiveMind.submitTask(taskPlanningTask);
    await this.waitForTaskCompletion(task.id, 180000); // 3 minutes
    
    // Update workflow state
    state.currentPhase = 'Implementation Planning' as WorkflowPhase;
    state.lastActivity = new Date();
    state.history.push({
      phase: 'Implementation Planning' as WorkflowPhase,
      status: 'completed',
      timestamp: new Date()
    });
    
    this.logger.info(`Generated tasks for '${featureName}' using native swarm planner`);
    this.eventBus.emit('maestro:tasks_generated', { featureName });
  }
  
  /**
   * Implement task using native implementation_coder agents
   */
  async implementTask(featureName: string, taskId: number): Promise<void> {
    const state = this.maestroState.get(featureName);
    if (!state) {
      throw new SystemError(`No workflow state found for '${featureName}'`);
    }
    
    const featurePath = join(this.specsDirectory, featureName);
    const tasksPath = join(featurePath, 'tasks.md');
    const tasksContent = await readFile(tasksPath, 'utf8');
    
    // Parse task description
    const taskLines = tasksContent.split('\n').filter(line => line.startsWith('- [ ]') || line.startsWith('- [x]'));
    if (taskId < 1 || taskId > taskLines.length) {
      throw new SystemError(`Invalid task ID ${taskId} for feature '${featureName}'`);
    }
    
    const taskDescription = taskLines[taskId - 1].substring(taskLines[taskId - 1].indexOf(']') + 2).trim();
    
    // Submit implementation task to native coders
    const implementationTask: TaskSubmitOptions = {
      description: `Implement task: ${taskDescription}`,
      priority: 'high',
      strategy: 'parallel',  // Multiple implementation_coder agents can work
      requiredCapabilities: ['code_generation' as AgentCapability, 'implementation' as AgentCapability],
      maxAgents: 2,
      metadata: {
        maestroFeature: featureName,
        maestroPhase: 'Task Execution',
        taskId,
        taskDescription,
        steeringContext: await this.getSteeringContext()
      }
    };
    
    const task = await this.hiveMind.submitTask(implementationTask);
    await this.waitForTaskCompletion(task.id, 600000); // 10 minutes
    
    // Mark task as completed in tasks.md
    const updatedTasksContent = tasksContent.replace(
      taskLines[taskId - 1],
      taskLines[taskId - 1].replace('- [ ]', '- [x]')
    );
    await writeFile(tasksPath, updatedTasksContent, 'utf8');
    
    // Update workflow state
    state.currentPhase = 'Task Execution' as WorkflowPhase;
    state.currentTaskIndex = taskId;
    state.lastActivity = new Date();
    
    this.logger.info(`Implemented task ${taskId} for '${featureName}' using native swarm`);
    this.eventBus.emit('maestro:task_implemented', { featureName, taskId, taskDescription });
  }
  
  /**
   * Review implemented tasks using native quality_reviewer agent
   */
  async reviewTasks(featureName: string): Promise<void> {
    const state = this.maestroState.get(featureName);
    if (!state) {
      throw new SystemError(`No workflow state found for '${featureName}'`);
    }
    
    const featurePath = join(this.specsDirectory, featureName);
    const tasksPath = join(featurePath, 'tasks.md');
    const tasksContent = await readFile(tasksPath, 'utf8');
    
    // Submit quality review task to native quality_reviewer agent
    const reviewTask: TaskSubmitOptions = {
      description: `Review implementation quality for ${featureName}`,
      priority: 'high',
      strategy: 'sequential',  // Sequential validation for consistency
      requiredCapabilities: ['code_review' as AgentCapability, 'quality_assurance' as AgentCapability, 'testing' as AgentCapability],
      metadata: {
        maestroFeature: featureName,
        maestroPhase: 'Quality Gates',
        tasksContent,
        steeringContext: await this.getSteeringContext()
      }
    };
    
    const task = await this.hiveMind.submitTask(reviewTask);
    await this.waitForTaskCompletion(task.id, 300000); // 5 minutes
    
    // Update workflow state
    state.currentPhase = 'Quality Gates' as WorkflowPhase;
    state.lastActivity = new Date();
    state.history.push({
      phase: 'Quality Gates' as WorkflowPhase,
      status: 'completed',
      timestamp: new Date()
    });
    
    this.logger.info(`Completed quality review for '${featureName}' using native quality_reviewer`);
    this.eventBus.emit('maestro:quality_review_completed', { featureName });
  }
  
  /**
   * Approve workflow phase with optional consensus
   */
  async approvePhase(featureName: string): Promise<void> {
    const state = this.maestroState.get(featureName);
    if (!state) {
      throw new SystemError(`No workflow state found for '${featureName}'`);
    }
    
    // Use native consensus if enabled
    if (this.config.enableConsensusValidation) {
      const consensusProposal: ConsensusProposal = {
        id: `maestro-phase-approval-${featureName}-${Date.now()}`,
        swarmId: (this.hiveMind as any).id,
        proposal: {
          action: 'approve_phase',
          featureName,
          currentPhase: state.currentPhase,
          details: `Approve completion of ${state.currentPhase} phase for ${featureName}`
        },
        requiredThreshold: 0.66,
        deadline: new Date(Date.now() + 300000), // 5 minutes
        taskId: `maestro-approval-${featureName}`,
        metadata: {
          type: 'phase_approval',
          featureName,
          phase: state.currentPhase
        }
      };
      
      // Submit for consensus validation
      const consensusEngine = (this.hiveMind as any).consensus as ConsensusEngine;
      const proposalId = await consensusEngine.createProposal(consensusProposal);
      const consensusResult = await this.waitForConsensusResult(proposalId, 300000);
      
      if (!consensusResult.achieved) {
        throw new SystemError(`Phase approval consensus failed: ${consensusResult.reason}`);
      }
    }
    
    // Progress to next phase
    const phaseProgression: Record<string, string> = {
      'Requirements Clarification': 'Research & Design',
      'Research & Design': 'Implementation Planning',
      'Implementation Planning': 'Task Execution',
      'Task Execution': 'Completed'
    };
    
    const nextPhase = phaseProgression[state.currentPhase];
    if (nextPhase) {
      state.currentPhase = nextPhase as WorkflowPhase;
      state.lastActivity = new Date();
      state.history.push({
        phase: nextPhase as WorkflowPhase,
        status: 'approved',
        timestamp: new Date()
      });
    }
    
    this.logger.info(`Approved phase transition for '${featureName}': ${state.currentPhase} -> ${nextPhase}`);
    this.eventBus.emit('maestro:phase_approved', { featureName, nextPhase });
  }
  
  /**
   * Get workflow state
   */
  getWorkflowState(featureName: string): MaestroWorkflowState | undefined {
    return this.maestroState.get(featureName);
  }
  
  /**
   * Create steering document in native swarm memory
   */
  async createSteeringDocument(domain: string, content: string): Promise<void> {
    if (!this.config.enableSteeringIntegration) {
      throw new SystemError('Steering integration is disabled');
    }
    
    // Store in native hive mind memory instead of files
    await this.hiveMind.memory.store(`steering/${domain}`, {
      content,
      domain,
      lastUpdated: new Date(),
      maintainer: 'steering_documenter'
    });
    
    // Notify all agents through native communication
    await this.hiveMind.communication.broadcast({
      type: 'steering_update',
      domain,
      content: content.substring(0, 200) + '...' // Summary for notification
    });
    
    this.logger.info(`Created steering document for '${domain}' in swarm memory`);
  }
  
  /**
   * Get steering context from swarm memory
   */
  private async getSteeringContext(): Promise<string> {
    if (!this.config.enableSteeringIntegration) {
      return 'No steering context available.';
    }
    
    try {
      // Retrieve all steering documents from swarm memory
      const steeringKeys = await this.hiveMind.memory.search('steering/*');
      const steeringDocs = await Promise.all(
        steeringKeys.map(key => this.hiveMind.memory.retrieve(key))
      );
      
      return steeringDocs
        .filter(doc => doc)
        .map(doc => `## ${doc.domain}\n${doc.content}`)
        .join('\n\n---\n\n');
        
    } catch (error) {
      this.logger.warn(`Failed to retrieve steering context: ${error instanceof Error ? error.message : String(error)}`);
      return 'Steering context temporarily unavailable.';
    }
  }
  
  /**
   * Initialize steering documents in swarm memory
   */
  private async initializeSteeringMemory(): Promise<void> {
    // Initialize default steering documents in memory
    const defaultSteering = {
      'product': 'Focus on user value and clear requirements specification.',
      'tech': 'Follow clean architecture patterns and maintainable code practices.',
      'workflow': 'Use specs-driven development with clear phase progression.'
    };
    
    for (const [domain, content] of Object.entries(defaultSteering)) {
      await this.hiveMind.memory.store(`steering/${domain}`, {
        content,
        domain,
        lastUpdated: new Date(),
        maintainer: 'system'
      });
    }
    
    this.logger.info('Initialized default steering documents in swarm memory');
  }
  
  /**
   * Wait for task completion using native swarm tracking
   */
  private async waitForTaskCompletion(taskId: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Task timeout: ${taskId}`));
      }, timeoutMs);
      
      const checkInterval = setInterval(async () => {
        try {
          const task = await this.hiveMind.getTask(taskId);
          
          if (task.status === 'completed') {
            clearTimeout(timeout);
            clearInterval(checkInterval);
            resolve(task.result ? JSON.parse(task.result) : {});
          } else if (task.status === 'failed') {
            clearTimeout(timeout);
            clearInterval(checkInterval);
            reject(new Error(`Task failed: ${task.error || 'Unknown error'}`));
          }
        } catch (error) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          reject(error);
        }
      }, 2000);
    });
  }
  
  /**
   * Wait for consensus result using native ConsensusEngine
   */
  private async waitForConsensusResult(proposalId: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Consensus timeout for proposal ${proposalId}`));
      }, timeoutMs);
      
      const checkInterval = setInterval(async () => {
        try {
          const consensusEngine = (this.hiveMind as any).consensus as ConsensusEngine;
          const status = await consensusEngine.getProposalStatus(proposalId);
          
          if (status.status === 'achieved') {
            clearTimeout(timeout);
            clearInterval(checkInterval);
            resolve({
              achieved: true,
              finalRatio: status.currentRatio,
              reason: 'Consensus achieved'
            });
          } else if (status.status === 'failed') {
            clearTimeout(timeout);
            clearInterval(checkInterval);
            resolve({
              achieved: false,
              finalRatio: status.currentRatio,
              reason: 'Consensus failed'
            });
          }
        } catch (error) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          reject(error);
        }
      }, 1000);
    });
  }
  
  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.eventBus.on('maestro:spec_created', this.handleSpecCreated.bind(this));
    this.eventBus.on('maestro:phase_approved', this.handlePhaseApproved.bind(this));
    this.eventBus.on('maestro:task_implemented', this.handleTaskImplemented.bind(this));
  }
  
  /**
   * Event handlers
   */
  private async handleSpecCreated(data: any): Promise<void> {
    this.logger.info(`Spec created via native swarm: ${JSON.stringify(data)}`);
  }
  
  private async handlePhaseApproved(data: any): Promise<void> {
    this.logger.info(`Phase approved via native consensus: ${JSON.stringify(data)}`);
  }
  
  private async handleTaskImplemented(data: any): Promise<void> {
    this.logger.info(`Task implemented via native swarm: ${JSON.stringify(data)}`);
  }
  
  /**
   * Shutdown coordinator and native swarm
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down MaestroSwarmCoordinator');
    
    if (this.hiveMind) {
      await this.hiveMind.shutdown();
      this.logger.info('Native hive mind swarm shutdown complete');
    }
    
    this.logger.info('MaestroSwarmCoordinator shutdown complete');
  }
}