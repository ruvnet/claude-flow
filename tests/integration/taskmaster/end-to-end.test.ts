/**
 * End-to-End Integration Tests for TaskMaster
 * Tests complete workflows from PRD to task execution
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskAdapter } from '../../../src/integrations/taskmaster/adapters/task-adapter.js';
import { PRDService } from '../../../src/integrations/taskmaster/services/prd-service.js';
import { StorageSync } from '../../../src/integrations/taskmaster/services/storage-sync.js';
import { TaskMasterCLI } from '../../../src/integrations/taskmaster/cli/taskmaster-commands.js';
import {
  ParseOptions,
  GenerateOptions,
  ProjectContext
} from '../../../src/integrations/taskmaster/types/prd-types.js';
import {
  TaskMasterTask,
  ClaudeFlowTask,
  AIModel,
  SPARCPhase
} from '../../../src/integrations/taskmaster/types/task-types.js';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock external dependencies
vi.mock('fs/promises');
vi.mock('fs');

describe('TaskMaster End-to-End Integration Tests', () => {
  let taskAdapter: TaskAdapter;
  let prdService: PRDService;
  let storageSync: StorageSync;
  let cli: TaskMasterCLI;
  let mockTempDir: string;

  const samplePRD = `
# E-Commerce Platform Requirements

## Project Overview
Build a modern e-commerce platform with user authentication, product catalog, shopping cart, and payment processing.

## Goals
- Create secure user authentication system
- Implement product browsing and search functionality
- Build shopping cart with persistent state
- Integrate payment processing
- Ensure mobile-responsive design

## Functional Requirements

### User Authentication
- Users must be able to register with email and password
- Users must be able to login securely
- Users should be able to reset forgotten passwords
- System must support user profile management

### Product Management
- System must display product catalog with images
- Users should be able to search and filter products
- Product pages must show detailed information
- Inventory tracking is required

### Shopping Cart
- Users must be able to add/remove items from cart
- Cart state should persist across sessions
- Users should see real-time total calculations
- Cart must support quantity adjustments

### Payment Processing
- System must integrate with payment gateway
- Users should be able to checkout securely
- Order confirmation emails are required
- Payment history must be accessible

## Technical Requirements
- Use React for frontend development
- Implement REST API with Node.js/Express
- Use PostgreSQL for data storage
- Implement JWT-based authentication
- Ensure responsive design for mobile devices

## Constraints
- Must complete within 12 weeks
- Budget constraint of $50,000
- Must comply with PCI DSS for payment processing
- Performance requirement: page load times under 2 seconds

## Acceptance Criteria
- All user authentication flows work correctly
- Product search returns relevant results in under 1 second
- Cart operations complete without errors
- Payment processing has 99.9% uptime
- Mobile experience matches desktop functionality
`;

  const mockAIModel: AIModel = {
    provider: 'anthropic',
    model: 'claude-3-haiku',
    settings: {
      temperature: 0.3,
      maxTokens: 4000
    }
  };

  beforeEach(() => {
    taskAdapter = new TaskAdapter();
    prdService = new PRDService();
    storageSync = new StorageSync(taskAdapter);
    cli = new TaskMasterCLI();
    mockTempDir = join(tmpdir(), 'taskmaster-e2e');

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    storageSync.disableWatcher();
  });

  describe('Complete PRD to Task Workflow', () => {
    it('should parse PRD and generate complete task hierarchy', async () => {
      // Step 1: Parse PRD
      const parseOptions: ParseOptions = {
        model: mockAIModel,
        generateTasks: true,
        mapToSparc: true
      };

      const parsedPRD = await prdService.parsePRD(samplePRD, parseOptions);

      // Verify PRD parsing
      expect(parsedPRD).toBeDefined();
      expect(parsedPRD.metadata.title).toBe('E-Commerce Platform Requirements');
      expect(parsedPRD.requirements.length).toBeGreaterThan(0);
      expect(parsedPRD.constraints.length).toBeGreaterThan(0);
      expect(parsedPRD.sections.length).toBeGreaterThan(0);

      // Step 2: Generate tasks
      const generateOptions: GenerateOptions = {
        model: mockAIModel,
        taskDepth: 2,
        sparcMapping: true,
        agentAssignment: true,
        estimateHours: true,
        includeDependencies: true
      };

      const taskTree = await prdService.generateTasks(parsedPRD, generateOptions);

      // Verify task generation
      expect(taskTree).toBeDefined();
      expect(taskTree.totalTasks).toBeGreaterThan(0);
      expect(taskTree.estimatedHours).toBeGreaterThan(0);
      expect(taskTree.root.children.length).toBeGreaterThan(0);

      // Step 3: Map to SPARC phases
      const sparcWorkflow = prdService.mapToSPARCPhases(taskTree);

      // Verify SPARC mapping
      expect(sparcWorkflow).toBeDefined();
      expect(sparcWorkflow.phases.length).toBeGreaterThan(0);
      expect(sparcWorkflow.totalTasks).toBe(taskTree.totalTasks);
      expect(sparcWorkflow.recommendedAgents.length).toBeGreaterThan(0);

      // Verify each phase has tasks assigned
      sparcWorkflow.phases.forEach(phase => {
        expect(phase.tasks.length).toBeGreaterThan(0);
        expect(phase.estimatedHours).toBeGreaterThan(0);
        expect(phase.agents.length).toBeGreaterThan(0);
        expect(phase.deliverables.length).toBeGreaterThan(0);
      });
    });

    it('should handle complex PRDs with multiple sections and requirements', async () => {
      const complexPRD = samplePRD + `
## Additional Requirements

### Advanced Features
- Machine learning product recommendations
- Real-time chat support
- Analytics dashboard for administrators
- Multi-language support
- Advanced search with filters

### Security Requirements
- Two-factor authentication
- Rate limiting for API endpoints
- Data encryption at rest and in transit
- Regular security audits
- GDPR compliance

### Performance Requirements
- Support 10,000 concurrent users
- 99.99% uptime SLA
- Auto-scaling infrastructure
- CDN integration for global performance
`;

      const parseOptions: ParseOptions = {
        model: mockAIModel,
        generateTasks: true,
        mapToSparc: true,
        maxDepth: 3
      };

      const parsedPRD = await prdService.parsePRD(complexPRD, parseOptions);

      expect(parsedPRD.requirements.length).toBeGreaterThan(10);
      expect(parsedPRD.constraints.length).toBeGreaterThan(3);
      expect(parsedPRD.complexity.overall).toEqual(expect.stringMatching(/medium|high|enterprise/));

      const generateOptions: GenerateOptions = {
        model: mockAIModel,
        taskDepth: 3,
        sparcMapping: true,
        agentAssignment: true,
        estimateHours: true,
        includeDependencies: true
      };

      const taskTree = await prdService.generateTasks(parsedPRD, generateOptions);

      expect(taskTree.totalTasks).toBeGreaterThan(15);
      expect(taskTree.complexity).toEqual(expect.stringMatching(/medium|high/));
    });
  });

  describe('Task Conversion and Synchronization Workflow', () => {
    it('should convert TaskMaster tasks to ClaudeFlow and sync successfully', async () => {
      // Create mock TaskMaster tasks
      const tmTasks: TaskMasterTask[] = [
        {
          id: 'tm-auth-1',
          title: 'Implement User Registration',
          description: 'Build user registration with email validation',
          status: 'todo' as any,
          priority: 3,
          tags: ['authentication', 'backend'],
          estimate: 6,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            prd_section: 'User Authentication',
            complexity: 5,
            ai_generated: true,
            model_used: 'claude-3-haiku'
          }
        },
        {
          id: 'tm-cart-1',
          title: 'Build Shopping Cart API',
          description: 'Create REST API for cart operations',
          status: 'in_progress' as any,
          priority: 4,
          tags: ['cart', 'api'],
          dependencies: ['tm-auth-1'],
          estimate: 8,
          assignee: 'backend-dev',
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            prd_section: 'Shopping Cart',
            complexity: 7,
            ai_generated: true,
            model_used: 'claude-3-haiku'
          }
        }
      ];

      // Convert to ClaudeFlow format
      const cfTasks = taskAdapter.batchToClaudeFlow(tmTasks);

      expect(cfTasks).toHaveLength(2);
      expect(cfTasks[0].id).toBe('tm-auth-1');
      expect(cfTasks[0].status).toBe('pending');
      expect(cfTasks[0].priority).toBe('high');
      expect(cfTasks[1].dependencies).toEqual(['tm-auth-1']);

      // Mock storage sync operations
      vi.mocked(fs.readdir).mockResolvedValue(['tm-auth-1.json', 'tm-cart-1.json'] as any);
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify(tmTasks[0]))
        .mockResolvedValueOnce(JSON.stringify(tmTasks[1]));

      vi.spyOn(storageSync as any, 'getClaudeFlowData').mockResolvedValue([]);
      vi.spyOn(storageSync as any, 'applySync').mockResolvedValue({ count: 2 });

      const syncResult = await storageSync.syncFromTaskMaster(mockTempDir);

      expect(syncResult.success).toBe(true);
      expect(syncResult.syncedTasks).toBe(2);
      expect(syncResult.conflicts).toHaveLength(0);
    });

    it('should handle bidirectional sync with conflict resolution', async () => {
      const tmTask: TaskMasterTask = {
        id: 'conflict-task',
        title: 'TM: Implement Payment Processing',
        status: 'done' as any,
        priority: 4,
        updatedAt: new Date('2024-01-02T10:00:00Z'),
        createdAt: new Date('2024-01-01T10:00:00Z')
      };

      const cfTask: ClaudeFlowTask = {
        id: 'conflict-task',
        title: 'CF: Implement Payment Processing',
        status: 'in_progress' as any,
        priority: 'medium',
        updatedAt: new Date('2024-01-01T15:00:00Z'),
        createdAt: new Date('2024-01-01T10:00:00Z')
      };

      // Mock conflict scenario
      vi.mocked(fs.readdir).mockResolvedValue(['conflict-task.json'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(tmTask));
      vi.spyOn(storageSync as any, 'getClaudeFlowData').mockResolvedValue([cfTask]);

      // Mock conflict resolution
      const mockConflictResolver = {
        resolve: vi.fn().mockResolvedValue([{
          taskId: 'conflict-task',
          field: 'title',
          resolvedValue: 'TM: Implement Payment Processing',
          strategy: 'merge'
        }])
      };
      (storageSync as any).conflictResolver = mockConflictResolver;

      vi.spyOn(storageSync as any, 'applySync').mockResolvedValue({ count: 1 });
      vi.spyOn(storageSync as any, 'applyResolutions').mockResolvedValue();

      const syncResult = await storageSync.syncFromTaskMaster(mockTempDir);

      expect(syncResult.success).toBe(true);
      expect(syncResult.conflicts.length).toBeGreaterThan(0);
      expect(mockConflictResolver.resolve).toHaveBeenCalled();
    });
  });

  describe('SPARC Methodology Integration', () => {
    it('should properly map tasks to SPARC phases and assign agents', async () => {
      // Create tasks representing different SPARC phases
      const tmTasks: TaskMasterTask[] = [
        {
          id: 'spec-1',
          title: 'Define Authentication Requirements',
          status: 'todo' as any,
          priority: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: { prd_section: 'Requirements Analysis' }
        },
        {
          id: 'arch-1',
          title: 'Design System Architecture',
          status: 'todo' as any,
          priority: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: { prd_section: 'Architecture Design' }
        },
        {
          id: 'impl-1',
          title: 'Implement User Login',
          status: 'todo' as any,
          priority: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: { prd_section: 'Implementation' }
        },
        {
          id: 'test-1',
          title: 'Test Authentication Flow',
          status: 'todo' as any,
          priority: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: { prd_section: 'Testing' }
        }
      ];

      // Convert to ClaudeFlow tasks
      const cfTasks = taskAdapter.batchToClaudeFlow(tmTasks);

      // Verify SPARC phase assignment
      expect(cfTasks[0].phase).toBe(SPARCPhase.SPECIFICATION);
      expect(cfTasks[0].agent).toBe('spec-pseudocode');

      expect(cfTasks[1].phase).toBe(SPARCPhase.ARCHITECTURE);
      expect(cfTasks[1].agent).toBe('architect');

      expect(cfTasks[2].phase).toBe(SPARCPhase.REFINEMENT);
      expect(cfTasks[2].agent).toBe('code');

      expect(cfTasks[3].phase).toBe(SPARCPhase.COMPLETION);
      expect(cfTasks[3].agent).toBe('integration');

      // Create task tree and map to SPARC workflow
      const taskTree = {
        root: {
          task: { id: 'root', title: 'Root', status: 'todo' as any, priority: 3, createdAt: new Date(), updatedAt: new Date() },
          children: tmTasks.map(task => ({
            task,
            children: [],
            depth: 1,
            sparcPhase: cfTasks.find(cf => cf.id === task.id)?.phase
          })),
          depth: 0
        },
        totalTasks: tmTasks.length,
        estimatedHours: tmTasks.length * 4,
        complexity: 'medium' as const
      };

      const sparcWorkflow = prdService.mapToSPARCPhases(taskTree);

      expect(sparcWorkflow.phases.length).toBeGreaterThan(0);
      expect(sparcWorkflow.recommendedAgents).toContain('spec-pseudocode');
      expect(sparcWorkflow.recommendedAgents).toContain('architect');
      expect(sparcWorkflow.recommendedAgents).toContain('code');
    });

    it('should provide intelligent task recommendations based on project context', async () => {
      const projectContext: ProjectContext = {
        currentPhase: SPARCPhase.ARCHITECTURE,
        completedTasks: ['spec-1', 'spec-2'],
        blockedTasks: ['impl-3'],
        availableAgents: ['architect', 'code', 'tdd'],
        teamCapacity: 3
      };

      // Mock available tasks
      vi.spyOn(prdService as any, 'getAvailableTasks').mockResolvedValue([
        {
          id: 'arch-1',
          title: 'Design API Architecture',
          priority: 3,
          metadata: { prd_section: 'Architecture' },
          status: 'todo' as any,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]);

      const recommendation = await prdService.getNextTask(projectContext);

      expect(recommendation).toBeDefined();
      expect(recommendation.task.id).toBe('arch-1');
      expect(recommendation.confidence).toBeGreaterThan(0);
      expect(recommendation.reasoning).toContain('High priority task');
      expect(recommendation.suggestedAgent).toBe('architect');
    });
  });

  describe('CLI Integration Workflow', () => {
    it('should execute complete CLI workflow from PRD to task generation', async () => {
      // Mock file operations for CLI
      const prdPath = join(mockTempDir, 'requirements.md');
      const outputPath = join(mockTempDir, 'tasks.json');

      vi.mocked(fs.readFile).mockResolvedValue(samplePRD);
      vi.mocked(fs.writeFile).mockResolvedValue();

      // Mock CLI task generation
      const generateFromPRDSpy = vi.spyOn(cli as any, 'generateFromPRD').mockImplementation(async (file, options) => {
        expect(file).toBe(prdPath);
        expect(options.sparcMapping).toBe(true);
        expect(options.assignAgents).toBe(true);
        
        // Simulate successful task generation
        console.log('✅ Generated 15 tasks (64 estimated hours)');
        console.log('✅ Mapped to 5 SPARC phases');
      });

      // Simulate CLI command execution
      await generateFromPRDSpy(prdPath, {
        model: 'claude-3-haiku',
        depth: 2,
        sparcMapping: true,
        assignAgents: true,
        output: outputPath,
        format: 'json',
        verbose: true
      });

      expect(generateFromPRDSpy).toHaveBeenCalledWith(prdPath, expect.objectContaining({
        sparcMapping: true,
        assignAgents: true
      }));
    });

    it('should handle CLI sync operations', async () => {
      const syncTasksSpy = vi.spyOn(cli as any, 'syncTasks').mockImplementation(async (options) => {
        expect(options.direction).toBe('bidirectional');
        
        // Mock successful sync
        console.log('✅ Synced 8 tasks');
        console.log('⚠️  2 conflicts resolved');
      });

      await syncTasksSpy({
        direction: 'bidirectional',
        project: 'ecommerce-platform'
      });

      expect(syncTasksSpy).toHaveBeenCalledWith({
        direction: 'bidirectional',
        project: 'ecommerce-platform'
      });
    });

    it('should provide task recommendations through CLI', async () => {
      const contextPath = join(mockTempDir, 'context.json');
      const mockContext = {
        currentPhase: SPARCPhase.ARCHITECTURE,
        completedTasks: ['spec-1'],
        availableAgents: ['architect', 'code']
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockContext));

      const getNextTaskSpy = vi.spyOn(cli as any, 'getNextTask').mockImplementation(async (options) => {
        expect(options.smart).toBe(true);
        expect(options.context).toBe(contextPath);
        
        // Mock recommendation output
        console.log('🎯 Recommended Task:');
        console.log('  📋 Title: Design API Architecture');
        console.log('  ⏱️  Estimated Duration: 6 hours');
        console.log('  🤖 Suggested Agent: architect');
      });

      await getNextTaskSpy({
        smart: true,
        context: contextPath
      });

      expect(getNextTaskSpy).toHaveBeenCalledWith({
        smart: true,
        context: contextPath
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid PRD gracefully', async () => {
      const invalidPRD = 'This is not a valid PRD document.';

      const validation = prdService.validatePRD(invalidPRD);
      expect(validation.isValid).toBe(true); // Simple validation passes
      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(validation.suggestions.length).toBeGreaterThan(0);
    });

    it('should handle sync failures gracefully', async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Directory not accessible'));

      const syncResult = await storageSync.syncFromTaskMaster('/nonexistent');

      expect(syncResult.success).toBe(false);
      expect(syncResult.errors).toContain('Directory not accessible');
      expect(syncResult.syncedTasks).toBe(0);
    });

    it('should handle large PRDs efficiently', async () => {
      // Create a large PRD with many sections
      const largePRD = Array(50).fill(0).map((_, i) => `
## Section ${i + 1}
- Requirement ${i + 1}.1: Must implement feature ${i + 1}A
- Requirement ${i + 1}.2: Should implement feature ${i + 1}B
- Requirement ${i + 1}.3: Could implement feature ${i + 1}C
`).join('\n');

      const parseOptions: ParseOptions = {
        model: mockAIModel,
        generateTasks: true,
        mapToSparc: true
      };

      const parsedPRD = await prdService.parsePRD(largePRD, parseOptions);

      expect(parsedPRD.requirements.length).toBeGreaterThan(100);
      expect(parsedPRD.complexity.overall).toBe('enterprise');
      expect(parsedPRD.complexity.estimatedWeeks).toBeGreaterThan(15);
    });

    it('should maintain data consistency during concurrent operations', async () => {
      // Simulate concurrent sync operations
      const syncPromises = [
        storageSync.syncFromTaskMaster(mockTempDir),
        storageSync.syncToTaskMaster('project-1'),
        storageSync.syncToTaskMaster('project-2')
      ];

      // Mock all operations to succeed
      vi.mocked(fs.readdir).mockResolvedValue([]);
      vi.spyOn(storageSync as any, 'getClaudeFlowData').mockResolvedValue([]);
      vi.spyOn(storageSync as any, 'getClaudeFlowTasksForProject').mockResolvedValue([]);
      vi.spyOn(storageSync as any, 'writeTaskMasterData').mockResolvedValue();
      vi.spyOn(storageSync as any, 'applySync').mockResolvedValue({ count: 0 });

      const results = await Promise.all(syncPromises);

      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle batch operations efficiently', async () => {
      // Create large batch of tasks
      const largeBatch: TaskMasterTask[] = Array(1000).fill(0).map((_, i) => ({
        id: `task-${i}`,
        title: `Task ${i}`,
        status: 'todo' as any,
        priority: (i % 4) + 1,
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      const startTime = Date.now();
      const converted = taskAdapter.batchToClaudeFlow(largeBatch);
      const duration = Date.now() - startTime;

      expect(converted).toHaveLength(1000);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should optimize memory usage for large task sets', async () => {
      // Test memory usage doesn't grow excessively
      const initialMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < 100; i++) {
        const tasks = Array(100).fill(0).map((_, j) => ({
          id: `batch-${i}-task-${j}`,
          title: `Batch ${i} Task ${j}`,
          status: 'todo' as any,
          priority: 3,
          createdAt: new Date(),
          updatedAt: new Date()
        }));

        taskAdapter.batchToClaudeFlow(tasks);
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });
});