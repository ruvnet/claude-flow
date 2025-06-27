#!/usr/bin/env ts-node

/**
 * Integration Test Monitor
 * Monitors Memory for TypeScript fixes from other agents and runs integration tests
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

interface FixReport {
  agentType: string;
  filesModified: string[];
  fixesApplied: number;
  timestamp: string;
  errors?: string[];
}

interface IntegrationTestResult {
  timestamp: string;
  baseline_errors: number;
  current_errors: number;
  new_errors: string[];
  resolved_errors: string[];
  conflicts: Array<{
    file: string;
    conflictType: string;
    agents: string[];
  }>;
}

class IntegrationTestMonitor {
  private readonly memoryKeys = [
    'typescript-fixes/type-definitions',
    'typescript-fixes/dependencies',
    'typescript-fixes/error-handlers',
    'typescript-fixes/annotations'
  ];

  private baselineErrors: Set<string> = new Set();
  private testResults: IntegrationTestResult[] = [];

  async captureBaseline(): Promise<void> {
    console.log('📊 Capturing baseline TypeScript errors...');
    try {
      const { stderr } = await execAsync('npm run typecheck');
      // TypeScript errors are reported to stderr
      this.parseErrors(stderr || '').forEach(err => this.baselineErrors.add(err));
    } catch (error: any) {
      // npm run typecheck returns non-zero exit code when there are errors
      if (error.stderr) {
        this.parseErrors(error.stderr).forEach(err => this.baselineErrors.add(err));
      }
    }
    console.log(`✅ Captured ${this.baselineErrors.size} baseline errors`);
  }

  private parseErrors(output: string): string[] {
    const errors: string[] = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      // Match TypeScript error format: file(line,col): error TSxxxx: message
      const errorMatch = line.match(/^(.+)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/);
      if (errorMatch) {
        errors.push(line.trim());
      }
    }
    
    return errors;
  }

  async checkMemoryForFixes(): Promise<FixReport[]> {
    const fixes: FixReport[] = [];
    
    // In a real implementation, this would query the Memory system
    // For now, we'll simulate checking for fixes
    console.log('🔍 Checking Memory for fixes from other agents...');
    
    // TODO: Implement actual Memory queries
    // This is a placeholder that would be replaced with actual Memory API calls
    
    return fixes;
  }

  async runIntegrationTest(): Promise<IntegrationTestResult> {
    console.log('🧪 Running integration test...');
    
    const currentErrors = new Set<string>();
    try {
      const { stderr } = await execAsync('npm run typecheck');
      this.parseErrors(stderr || '').forEach(err => currentErrors.add(err));
    } catch (error: any) {
      if (error.stderr) {
        this.parseErrors(error.stderr).forEach(err => currentErrors.add(err));
      }
    }

    // Calculate new and resolved errors
    const newErrors = Array.from(currentErrors).filter(err => !this.baselineErrors.has(err));
    const resolvedErrors = Array.from(this.baselineErrors).filter(err => !currentErrors.has(err));

    const result: IntegrationTestResult = {
      timestamp: new Date().toISOString(),
      baseline_errors: this.baselineErrors.size,
      current_errors: currentErrors.size,
      new_errors: newErrors,
      resolved_errors: resolvedErrors,
      conflicts: []
    };

    // Check for potential conflicts
    result.conflicts = await this.detectConflicts();

    this.testResults.push(result);
    return result;
  }

  private async detectConflicts(): Promise<IntegrationTestResult['conflicts']> {
    // This would analyze fixes from different agents to detect conflicts
    // For now, return empty array
    return [];
  }

  async generateReport(): Promise<void> {
    const report = {
      test_runs: this.testResults.length,
      total_baseline_errors: this.baselineErrors.size,
      latest_result: this.testResults[this.testResults.length - 1],
      all_results: this.testResults
    };

    const reportPath = path.join(process.cwd(), 'integration-test-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 Integration test report saved to: ${reportPath}`);

    // In production, this would store to Memory
    // Memory.store('typescript-fixes/integration-tests', report);
  }

  async monitor(): Promise<void> {
    console.log('🚀 Starting Integration Test Monitor...');
    
    // Capture baseline
    await this.captureBaseline();

    // Monitor loop
    let iteration = 0;
    const maxIterations = 20; // Prevent infinite loop in testing

    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n--- Iteration ${iteration} ---`);

      // Check for fixes
      const fixes = await this.checkMemoryForFixes();
      
      if (fixes.length > 0) {
        console.log(`📦 Found ${fixes.length} fix packages from other agents`);
        
        // Run integration test
        const result = await this.runIntegrationTest();
        
        console.log(`📊 Test Results:`);
        console.log(`  - Baseline errors: ${result.baseline_errors}`);
        console.log(`  - Current errors: ${result.current_errors}`);
        console.log(`  - New errors: ${result.new_errors.length}`);
        console.log(`  - Resolved errors: ${result.resolved_errors.length}`);
        console.log(`  - Conflicts detected: ${result.conflicts.length}`);

        if (result.new_errors.length > 0) {
          console.log('⚠️  New errors introduced! Notifying agents...');
          // Would notify other agents through Memory
        }

        if (result.conflicts.length > 0) {
          console.log('🔥 Conflicts detected! Coordination required...');
          // Would coordinate resolution through Memory
        }
      }

      // Generate report every 5 iterations
      if (iteration % 5 === 0) {
        await this.generateReport();
      }

      // Wait before next check (in production, this would be event-driven)
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Final report
    await this.generateReport();
    console.log('✅ Integration Test Monitor completed');
  }
}

// Run the monitor if executed directly
if (require.main === module) {
  const monitor = new IntegrationTestMonitor();
  monitor.monitor().catch(console.error);
}

export { IntegrationTestMonitor };
export type { FixReport, IntegrationTestResult };