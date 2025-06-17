#!/usr/bin/env ts-node

/**
 * Run all agent test demonstrations
 * This script executes each agent test in sequence to show their capabilities
 */

import { CoordinatorTest } from './test-coordinator';
import { ResearcherTest } from './test-researcher';
import { DeveloperTest } from './test-developer';
import { AnalyzerTest } from './test-analyzer';
import { ReviewerTest } from './test-reviewer';
import { TesterTest } from './test-tester';
import { DocumenterTest } from './test-documenter';
import { MonitorTest } from './test-monitor';
import { SpecialistTest } from './test-specialist';

async function runAllTests() {
  console.log('🚀 CLAUDE-FLOW SWARM AGENT DEMONSTRATION\n');
  console.log('This demonstrates the capabilities of each agent type in the swarm system.\n');
  console.log('═'.repeat(60) + '\n');
  
  // Test 1: Coordinator
  console.log('1️⃣  COORDINATOR AGENT TEST');
  console.log('─'.repeat(60));
  const coordinator = new CoordinatorTest();
  await coordinator.orchestrateSwarmTask();
  await coordinator.monitorProgress();
  console.log('\n');
  
  // Test 2: Researcher
  console.log('2️⃣  RESEARCHER AGENT TEST');
  console.log('─'.repeat(60));
  const researcher = new ResearcherTest();
  await researcher.conductResearch('REST API best practices');
  await researcher.analyzeData([42, 38, 51, 47, 39, 52, 48, 45, 98, 41]);
  console.log('\n');
  
  // Test 3: Developer
  console.log('3️⃣  DEVELOPER AGENT TEST');
  console.log('─'.repeat(60));
  const developer = new DeveloperTest();
  const codeResult = await developer.generateCode('user authentication');
  console.log('Generated', codeResult.linesOfCode, 'lines of', codeResult.language, 'code');
  await developer.refactorCode('legacy authentication module');
  await developer.debugIssue('Token validation fails intermittently');
  console.log('\n');
  
  // Test 4: Analyzer
  console.log('4️⃣  ANALYZER AGENT TEST');
  console.log('─'.repeat(60));
  const analyzer = new AnalyzerTest();
  const metrics = {
    response_times: [245, 312, 198, 580, 225],
    error_counts: { '4xx': 12, '5xx': 3 },
    cpu_usage: [45.2, 52.1, 48.7, 61.3],
    memory_usage: [1024, 1156, 1298, 1402]
  };
  await analyzer.analyzePerformanceMetrics(metrics);
  await analyzer.analyzeCodeQuality('/src/modules/authentication');
  await analyzer.analyzeSecurityVulnerabilities();
  console.log('\n');
  
  // Test 5: Reviewer
  console.log('5️⃣  REVIEWER AGENT TEST');
  console.log('─'.repeat(60));
  const reviewer = new ReviewerTest();
  const samplePR = {
    title: 'Feature: Add user authentication',
    author: 'developer123',
    files: ['src/auth/login.ts', 'src/auth/logout.ts', 'tests/auth.test.ts']
  };
  await reviewer.performCodeReview(samplePR);
  await reviewer.reviewDocumentation('/docs/api-reference.md');
  await reviewer.validateQualityStandards('AuthenticationModule');
  console.log('\n');
  
  // Test 6: Tester
  console.log('6️⃣  TESTER AGENT TEST');
  console.log('─'.repeat(60));
  const tester = new TesterTest();
  const testResult = await tester.writeUnitTests('UserAuthentication');
  console.log('Created', testResult.testCases, 'test cases with', testResult.coverage, 'coverage');
  await tester.runIntegrationTests('Authentication System');
  await tester.runPerformanceTests('/api/v1/authenticate');
  console.log('\n');
  
  // Test 7: Documenter
  console.log('7️⃣  DOCUMENTER AGENT TEST');
  console.log('─'.repeat(60));
  const documenter = new DocumenterTest();
  const apiSpec = {
    name: 'User Authentication API',
    version: '1.0',
    endpoints: ['/auth/login', '/auth/validate', '/auth/refresh', '/auth/logout']
  };
  const docResult = await documenter.generateAPIDocumentation(apiSpec);
  console.log('Generated API docs with', docResult.endpoints, 'endpoints');
  await documenter.createUserGuide('User Authentication');
  await documenter.documentCodebase('AuthenticationModule');
  console.log('\n');
  
  // Test 8: Monitor
  console.log('8️⃣  MONITOR AGENT TEST');
  console.log('─'.repeat(60));
  const monitor = new MonitorTest();
  const healthResult = await monitor.monitorSystemHealth();
  console.log('System health:', healthResult.overallHealth + '%');
  await monitor.trackPerformanceMetrics();
  await monitor.trackErrorsAndAlerts();
  await monitor.trackUptime();
  console.log('\n');
  
  // Test 9: Specialist
  console.log('9️⃣  SPECIALIST AGENT TEST');
  console.log('─'.repeat(60));
  const specialist = new SpecialistTest();
  await specialist.provideMachineLearningExpertise('Customer churn prediction');
  await specialist.provideSecurityExpertise('User Authentication Module');
  const cloudRequirements = {
    application: 'E-commerce Platform',
    expectedUsers: 500000,
    regions: ['US', 'EU', 'Asia'],
    budget: '$3000/month'
  };
  const cloudResult = await specialist.provideCloudArchitectureExpertise(cloudRequirements);
  console.log('Cloud architecture designed with estimated cost:', cloudResult.monthlyCost);
  console.log('\n');
  
  // Summary
  console.log('═'.repeat(60));
  console.log('✅ ALL AGENT DEMONSTRATIONS COMPLETED');
  console.log('═'.repeat(60));
  console.log('\nSummary:');
  console.log('- Coordinator: Orchestration and task management');
  console.log('- Researcher: Information gathering and analysis');
  console.log('- Developer: Code generation and maintenance');
  console.log('- Analyzer: Data analysis and insights');
  console.log('- Reviewer: Quality assurance and validation');
  console.log('- Tester: Testing and validation');
  console.log('- Documenter: Documentation creation');
  console.log('- Monitor: System health and performance tracking');
  console.log('- Specialist: Domain-specific expertise');
  console.log('\nThese agents can work together in coordinated swarms');
  console.log('to solve complex software engineering challenges.');
}

// Execute all tests
runAllTests().catch(console.error);