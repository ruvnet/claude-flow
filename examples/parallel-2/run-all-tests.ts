#!/usr/bin/env ts-node

/**
 * Main test runner for all agent demonstrations
 * Shows both sequential and parallel execution modes
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

class AgentTestRunner {
  async runSequentialTests() {
    console.log('\n🔄 SEQUENTIAL EXECUTION MODE');
    console.log('═'.repeat(60));
    console.log('Running agent tests one after another...\n');
    
    const startTime = Date.now();
    const results = [];
    
    // Coordinator test
    console.log('1️⃣  Testing Coordinator Agent...');
    const coordinator = new CoordinatorAgent('coordinator-seq-001');
    results.push(await coordinator.orchestrateSwarmTask('Build authentication system', 3));
    
    // Researcher test
    console.log('2️⃣  Testing Researcher Agent...');
    const researcher = new ResearcherAgent('researcher-seq-001');
    results.push(await researcher.conductResearch('REST API best practices'));
    
    // Developer test
    console.log('3️⃣  Testing Developer Agent...');
    const developer = new DeveloperAgent('developer-seq-001');
    results.push(await developer.generateCode('user authentication'));
    
    // Analyzer test
    console.log('4️⃣  Testing Analyzer Agent...');
    const analyzer = new AnalyzerAgent('analyzer-seq-001');
    results.push(await analyzer.analyzePerformanceMetrics({
      response_times: [245, 312, 198, 580, 225],
      error_counts: { '4xx': 12, '5xx': 3 },
      cpu_usage: [45.2, 52.1, 48.7, 61.3],
      memory_usage: [1024, 1156, 1298, 1402]
    }));
    
    // Reviewer test
    console.log('5️⃣  Testing Reviewer Agent...');
    const reviewer = new ReviewerAgent('reviewer-seq-001');
    results.push(await reviewer.performCodeReview({
      title: 'Feature: Add user authentication',
      author: 'developer123',
      files: ['src/auth/login.ts', 'src/auth/logout.ts', 'tests/auth.test.ts']
    }));
    
    // Tester test
    console.log('6️⃣  Testing Tester Agent...');
    const tester = new TesterAgent('tester-seq-001');
    results.push(await tester.writeUnitTests('UserAuthentication'));
    
    // Documenter test
    console.log('7️⃣  Testing Documenter Agent...');
    const documenter = new DocumenterAgent('documenter-seq-001');
    results.push(await documenter.generateAPIDocumentation({
      name: 'User Authentication API',
      version: '1.0',
      endpoints: ['/auth/login', '/auth/validate', '/auth/refresh', '/auth/logout']
    }));
    
    // Monitor test
    console.log('8️⃣  Testing Monitor Agent...');
    const monitor = new MonitorAgent('monitor-seq-001');
    results.push(await monitor.monitorSystemHealth());
    
    // Specialist test
    console.log('9️⃣  Testing Specialist Agent...');
    const specialist = new SpecialistAgent('specialist-seq-001');
    results.push(await specialist.provideMachineLearningExpertise('Customer churn prediction'));
    
    const totalTime = Date.now() - startTime;
    
    console.log('\n✅ Sequential execution completed');
    console.log(`Total time: ${totalTime}ms`);
    console.log(`Tasks completed: ${results.length}`);
    
    return { mode: 'sequential', totalTime, taskCount: results.length };
  }

  async runParallelTests() {
    console.log('\n⚡ PARALLEL EXECUTION MODE');
    console.log('═'.repeat(60));
    console.log('Running all agent tests concurrently...\n');
    
    const startTime = Date.now();
    
    // Create all agents
    const agents = {
      coordinator: new CoordinatorAgent('coordinator-par-001'),
      researcher: new ResearcherAgent('researcher-par-001'),
      developer: new DeveloperAgent('developer-par-001'),
      analyzer: new AnalyzerAgent('analyzer-par-001'),
      reviewer: new ReviewerAgent('reviewer-par-001'),
      tester: new TesterAgent('tester-par-001'),
      documenter: new DocumenterAgent('documenter-par-001'),
      monitor: new MonitorAgent('monitor-par-001'),
      specialist: new SpecialistAgent('specialist-par-001')
    };
    
    // Execute all tasks in parallel
    const tasks = [
      agents.coordinator.orchestrateSwarmTask('Build authentication system', 3),
      agents.researcher.conductResearch('REST API best practices'),
      agents.developer.generateCode('user authentication'),
      agents.analyzer.analyzePerformanceMetrics({
        response_times: [245, 312, 198, 580, 225],
        error_counts: { '4xx': 12, '5xx': 3 },
        cpu_usage: [45.2, 52.1, 48.7, 61.3],
        memory_usage: [1024, 1156, 1298, 1402]
      }),
      agents.reviewer.performCodeReview({
        title: 'Feature: Add user authentication',
        author: 'developer123',
        files: ['src/auth/login.ts', 'src/auth/logout.ts', 'tests/auth.test.ts']
      }),
      agents.tester.writeUnitTests('UserAuthentication'),
      agents.documenter.generateAPIDocumentation({
        name: 'User Authentication API',
        version: '1.0',
        endpoints: ['/auth/login', '/auth/validate', '/auth/refresh', '/auth/logout']
      }),
      agents.monitor.monitorSystemHealth(),
      agents.specialist.provideMachineLearningExpertise('Customer churn prediction')
    ];
    
    console.log('🚀 Launching all agents simultaneously...');
    const results = await Promise.all(tasks);
    
    const totalTime = Date.now() - startTime;
    
    console.log('\n✅ Parallel execution completed');
    console.log(`Total time: ${totalTime}ms`);
    console.log(`Tasks completed: ${results.length}`);
    
    return { mode: 'parallel', totalTime, taskCount: results.length };
  }

  async runComparison() {
    console.log('🎯 CLAUDE-FLOW AGENT EXECUTION COMPARISON');
    console.log('═'.repeat(60));
    console.log('Comparing sequential vs parallel agent execution\n');
    
    // Run sequential tests
    const sequentialResult = await this.runSequentialTests();
    
    // Add a small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Run parallel tests
    const parallelResult = await this.runParallelTests();
    
    // Display comparison
    console.log('\n' + '═'.repeat(60));
    console.log('📊 PERFORMANCE COMPARISON');
    console.log('═'.repeat(60));
    console.log(`\nSequential Execution: ${sequentialResult.totalTime}ms`);
    console.log(`Parallel Execution: ${parallelResult.totalTime}ms`);
    console.log(`\nTime Saved: ${sequentialResult.totalTime - parallelResult.totalTime}ms`);
    console.log(`Speed Improvement: ${((sequentialResult.totalTime / parallelResult.totalTime) * 100).toFixed(1)}%`);
    console.log(`\nEfficiency Factor: ${(sequentialResult.totalTime / parallelResult.totalTime).toFixed(2)}x faster`);
    
    console.log('\n💡 KEY INSIGHTS:');
    console.log('- Parallel execution dramatically reduces total execution time');
    console.log('- All agents can work independently without conflicts');
    console.log('- Swarm architecture enables efficient resource utilization');
    console.log('- Suitable for complex, multi-faceted software engineering tasks');
  }

  async runIndividualAgentDemo(agentType: string) {
    console.log(`\n🤖 Running ${agentType.toUpperCase()} Agent Demo`);
    console.log('─'.repeat(40));
    
    switch (agentType.toLowerCase()) {
      case 'coordinator':
        const coordinator = new CoordinatorAgent();
        await coordinator.orchestrateSwarmTask('Build authentication system', 5);
        await coordinator.monitorProgress();
        break;
        
      case 'researcher':
        const researcher = new ResearcherAgent();
        await researcher.conductResearch('REST API best practices');
        await researcher.analyzeData([42, 38, 51, 47, 39, 52, 48, 45, 98, 41]);
        break;
        
      case 'developer':
        const developer = new DeveloperAgent();
        await developer.generateCode('user authentication');
        await developer.refactorCode('legacy payment module');
        break;
        
      case 'analyzer':
        const analyzer = new AnalyzerAgent();
        await analyzer.analyzePerformanceMetrics({
          response_times: [245, 312, 198, 580, 225],
          error_counts: { '4xx': 12, '5xx': 3 },
          cpu_usage: [45.2, 52.1, 48.7, 61.3],
          memory_usage: [1024, 1156, 1298, 1402]
        });
        break;
        
      case 'reviewer':
        const reviewer = new ReviewerAgent();
        await reviewer.performCodeReview({
          title: 'Feature: Add user authentication',
          author: 'developer123',
          files: ['src/auth/login.ts', 'src/auth/logout.ts', 'tests/auth.test.ts']
        });
        break;
        
      case 'tester':
        const tester = new TesterAgent();
        await tester.writeUnitTests('UserAuthentication');
        await tester.runPerformanceTests('/api/v1/authenticate');
        break;
        
      case 'documenter':
        const documenter = new DocumenterAgent();
        await documenter.generateAPIDocumentation({
          name: 'User Authentication API',
          version: '1.0',
          endpoints: ['/auth/login', '/auth/validate', '/auth/refresh', '/auth/logout']
        });
        break;
        
      case 'monitor':
        const monitor = new MonitorAgent();
        await monitor.monitorSystemHealth();
        await monitor.trackPerformanceMetrics();
        break;
        
      case 'specialist':
        const specialist = new SpecialistAgent();
        await specialist.provideMachineLearningExpertise('Customer churn prediction');
        await specialist.provideSecurityExpertise('User Authentication Module');
        break;
        
      default:
        console.log(`Unknown agent type: ${agentType}`);
    }
  }
}

// Main execution
if (require.main === module) {
  const runner = new AgentTestRunner();
  
  // Check command line arguments
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === 'compare') {
    // Run comparison by default
    runner.runComparison().catch(console.error);
  } else if (args[0] === 'sequential') {
    runner.runSequentialTests().catch(console.error);
  } else if (args[0] === 'parallel') {
    runner.runParallelTests().catch(console.error);
  } else if (args[0] === 'agent' && args[1]) {
    runner.runIndividualAgentDemo(args[1]).catch(console.error);
  } else {
    console.log('Usage:');
    console.log('  ts-node run-all-tests.ts [compare]    - Run comparison (default)');
    console.log('  ts-node run-all-tests.ts sequential   - Run sequential tests only');
    console.log('  ts-node run-all-tests.ts parallel     - Run parallel tests only');
    console.log('  ts-node run-all-tests.ts agent <type> - Run specific agent demo');
    console.log('\nAgent types: coordinator, researcher, developer, analyzer,');
    console.log('             reviewer, tester, documenter, monitor, specialist');
  }
}