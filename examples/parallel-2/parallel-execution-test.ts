#!/usr/bin/env ts-node

/**
 * Parallel Execution Test - Demonstrates all agents working concurrently
 * This test shows how multiple agent types can work in parallel on different tasks
 */

import { CoordinatorAgent } from './coordinator-agent-test';
import { ResearcherAgent } from './researcher-agent-test';
import { DeveloperAgent } from './developer-agent-test';
import { AnalyzerAgent } from './analyzer-agent-test';
import { ReviewerAgent } from './reviewer-agent-test';
import { TesterAgent } from './tester-agent-test';
import { DocumenterAgent } from './documenter-agent-test';
import { MonitorAgent } from './monitor-agent-test';
import { SpecialistAgent } from './specialist-agent-test';

interface ParallelTaskResult {
  agentType: string;
  taskName: string;
  startTime: number;
  endTime: number;
  duration: number;
  result: any;
  status: 'success' | 'error';
  error?: any;
}

class ParallelExecutionOrchestrator {
  private results: ParallelTaskResult[] = [];
  private startTime: number = 0;

  async executeParallelTasks() {
    console.log('🚀 PARALLEL AGENT EXECUTION TEST');
    console.log('═'.repeat(60));
    console.log('Demonstrating all agent types working concurrently\n');
    
    this.startTime = Date.now();
    
    // Create all agent instances with unique IDs
    const agents = {
      coordinator: new CoordinatorAgent('coordinator-parallel-001'),
      researcher: new ResearcherAgent('researcher-parallel-001'),
      developer: new DeveloperAgent('developer-parallel-001'),
      analyzer: new AnalyzerAgent('analyzer-parallel-001'),
      reviewer: new ReviewerAgent('reviewer-parallel-001'),
      tester: new TesterAgent('tester-parallel-001'),
      documenter: new DocumenterAgent('documenter-parallel-001'),
      monitor: new MonitorAgent('monitor-parallel-001'),
      specialist: new SpecialistAgent('specialist-parallel-001')
    };

    // Define all parallel tasks
    const parallelTasks = [
      // Coordinator tasks
      this.wrapTask('coordinator', 'Orchestrate Authentication System', 
        agents.coordinator.orchestrateSwarmTask('Build authentication system', 5)),
      this.wrapTask('coordinator', 'Monitor Swarm Progress', 
        agents.coordinator.monitorProgress()),
      
      // Researcher tasks
      this.wrapTask('researcher', 'Research REST API Best Practices', 
        agents.researcher.conductResearch('REST API best practices')),
      this.wrapTask('researcher', 'Analyze Performance Data', 
        agents.researcher.analyzeData([42, 38, 51, 47, 39, 52, 48, 45, 98, 41])),
      
      // Developer tasks
      this.wrapTask('developer', 'Generate Authentication Code', 
        agents.developer.generateCode('user authentication')),
      this.wrapTask('developer', 'Refactor Payment Module', 
        agents.developer.refactorCode('legacy payment module')),
      
      // Analyzer tasks
      this.wrapTask('analyzer', 'Analyze System Performance', 
        agents.analyzer.analyzePerformanceMetrics({
          response_times: [245, 312, 198, 580, 225],
          error_counts: { '4xx': 12, '5xx': 3 },
          cpu_usage: [45.2, 52.1, 48.7, 61.3],
          memory_usage: [1024, 1156, 1298, 1402]
        })),
      this.wrapTask('analyzer', 'Security Vulnerability Scan', 
        agents.analyzer.analyzeSecurityVulnerabilities()),
      
      // Reviewer tasks
      this.wrapTask('reviewer', 'Review Pull Request', 
        agents.reviewer.performCodeReview({
          title: 'Feature: Add user authentication',
          author: 'developer123',
          files: ['src/auth/login.ts', 'src/auth/logout.ts', 'tests/auth.test.ts']
        })),
      this.wrapTask('reviewer', 'Validate Quality Standards', 
        agents.reviewer.validateQualityStandards('AuthenticationModule')),
      
      // Tester tasks
      this.wrapTask('tester', 'Write Unit Tests', 
        agents.tester.writeUnitTests('UserAuthentication')),
      this.wrapTask('tester', 'Run Performance Tests', 
        agents.tester.runPerformanceTests('/api/v1/authenticate')),
      
      // Documenter tasks
      this.wrapTask('documenter', 'Generate API Documentation', 
        agents.documenter.generateAPIDocumentation({
          name: 'User Authentication API',
          version: '1.0',
          endpoints: ['/auth/login', '/auth/validate', '/auth/refresh', '/auth/logout']
        })),
      this.wrapTask('documenter', 'Create User Guide', 
        agents.documenter.createUserGuide('User Authentication')),
      
      // Monitor tasks
      this.wrapTask('monitor', 'Monitor System Health', 
        agents.monitor.monitorSystemHealth()),
      this.wrapTask('monitor', 'Track Performance Metrics', 
        agents.monitor.trackPerformanceMetrics()),
      
      // Specialist tasks
      this.wrapTask('specialist', 'ML Analysis for Churn Prediction', 
        agents.specialist.provideMachineLearningExpertise('Customer churn prediction')),
      this.wrapTask('specialist', 'Security Architecture Review', 
        agents.specialist.provideSecurityExpertise('User Authentication Module'))
    ];

    console.log(`📊 Executing ${parallelTasks.length} tasks across ${Object.keys(agents).length} agent types...\n`);
    
    // Execute all tasks in parallel
    const results = await Promise.allSettled(parallelTasks);
    
    // Process and display results
    this.processResults(results);
  }

  private async wrapTask(agentType: string, taskName: string, promise: Promise<any>): Promise<ParallelTaskResult> {
    const startTime = Date.now();
    
    try {
      const result = await promise;
      const endTime = Date.now();
      
      const taskResult: ParallelTaskResult = {
        agentType,
        taskName,
        startTime,
        endTime,
        duration: endTime - startTime,
        result,
        status: 'success'
      };
      
      this.results.push(taskResult);
      return taskResult;
    } catch (error) {
      const endTime = Date.now();
      
      const taskResult: ParallelTaskResult = {
        agentType,
        taskName,
        startTime,
        endTime,
        duration: endTime - startTime,
        result: null,
        status: 'error',
        error
      };
      
      this.results.push(taskResult);
      return taskResult;
    }
  }

  private processResults(results: PromiseSettledResult<ParallelTaskResult>[]) {
    const totalDuration = Date.now() - this.startTime;
    
    console.log('\n' + '═'.repeat(60));
    console.log('📈 PARALLEL EXECUTION RESULTS');
    console.log('═'.repeat(60) + '\n');
    
    // Group results by agent type
    const resultsByAgent = new Map<string, ParallelTaskResult[]>();
    
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        const taskResult = result.value;
        if (!resultsByAgent.has(taskResult.agentType)) {
          resultsByAgent.set(taskResult.agentType, []);
        }
        resultsByAgent.get(taskResult.agentType)!.push(taskResult);
      }
    });
    
    // Display results by agent
    resultsByAgent.forEach((tasks, agentType) => {
      console.log(`\n🤖 ${agentType.toUpperCase()} AGENT:`);
      console.log('─'.repeat(40));
      
      tasks.forEach(task => {
        const status = task.status === 'success' ? '✅' : '❌';
        console.log(`${status} ${task.taskName}`);
        console.log(`   Duration: ${task.duration}ms`);
        if (task.status === 'error') {
          console.log(`   Error: ${task.error}`);
        }
      });
    });
    
    // Calculate statistics
    const successfulTasks = results.filter(r => r.status === 'fulfilled' && r.value.status === 'success').length;
    const failedTasks = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status === 'error')).length;
    const avgDuration = this.results.reduce((sum, r) => sum + r.duration, 0) / this.results.length;
    
    // Display summary
    console.log('\n' + '═'.repeat(60));
    console.log('📊 EXECUTION SUMMARY');
    console.log('═'.repeat(60));
    console.log(`Total Tasks: ${results.length}`);
    console.log(`Successful: ${successfulTasks} (${((successfulTasks/results.length)*100).toFixed(1)}%)`);
    console.log(`Failed: ${failedTasks} (${((failedTasks/results.length)*100).toFixed(1)}%)`);
    console.log(`Total Execution Time: ${totalDuration}ms`);
    console.log(`Average Task Duration: ${Math.round(avgDuration)}ms`);
    console.log(`Parallelization Efficiency: ${((avgDuration * results.length / totalDuration) * 100).toFixed(1)}%`);
    
    // Find longest and shortest tasks
    const sortedTasks = [...this.results].sort((a, b) => b.duration - a.duration);
    console.log(`\nLongest Task: ${sortedTasks[0].taskName} (${sortedTasks[0].duration}ms)`);
    console.log(`Shortest Task: ${sortedTasks[sortedTasks.length-1].taskName} (${sortedTasks[sortedTasks.length-1].duration}ms)`);
    
    console.log('\n✨ Parallel execution demonstrates significant time savings');
    console.log('   compared to sequential execution of the same tasks.');
  }
}

// Execute the parallel test
if (require.main === module) {
  const orchestrator = new ParallelExecutionOrchestrator();
  orchestrator.executeParallelTasks().catch(console.error);
}