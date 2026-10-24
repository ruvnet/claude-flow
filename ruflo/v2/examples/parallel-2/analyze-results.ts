import * as fs from "fs/promises";
import * as path from "path";

interface AgentResult {
  agent: string;
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
}

interface ResultsSummary {
  totalAgents: number;
  successfulAgents: number;
  failedAgents: number;
  totalDuration: number;
  averageDuration: number;
}

interface FullResults {
  summary: ResultsSummary;
  results: AgentResult[];
  timestamp: string;
}

async function analyzeResults() {
  try {
    const resultsPath = path.join(__dirname, "results.json");
    const resultsData = await fs.readFile(resultsPath, "utf-8");
    const results: FullResults = JSON.parse(resultsData);

    console.log("📊 Claude-Flow Parallel Agent Test Results Analysis");
    console.log("=" .repeat(50));
    console.log(`\nTest completed at: ${new Date(results.timestamp).toLocaleString()}`);
    
    // Summary statistics
    console.log("\n📈 Summary Statistics:");
    console.log(`   Total Agents: ${results.summary.totalAgents}`);
    console.log(`   Successful: ${results.summary.successfulAgents} (${Math.round(results.summary.successfulAgents / results.summary.totalAgents * 100)}%)`);
    console.log(`   Failed: ${results.summary.failedAgents} (${Math.round(results.summary.failedAgents / results.summary.totalAgents * 100)}%)`);
    console.log(`   Total Duration: ${(results.summary.totalDuration / 1000).toFixed(2)}s`);
    console.log(`   Average Duration: ${(results.summary.averageDuration / 1000).toFixed(2)}s per agent`);

    // Performance analysis
    const sortedByDuration = [...results.results].sort((a, b) => b.duration - a.duration);
    
    console.log("\n⏱️  Performance Breakdown:");
    console.log("   Slowest agents:");
    sortedByDuration.slice(0, 3).forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.agent}: ${(result.duration / 1000).toFixed(2)}s`);
    });
    
    console.log("\n   Fastest agents:");
    sortedByDuration.slice(-3).reverse().forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.agent}: ${(result.duration / 1000).toFixed(2)}s`);
    });

    // Failure analysis
    const failures = results.results.filter(r => !r.success);
    if (failures.length > 0) {
      console.log("\n❌ Failed Agents:");
      failures.forEach(failure => {
        console.log(`   - ${failure.agent}: ${failure.error?.split('\n')[0] || 'Unknown error'}`);
      });
    }

    // Success analysis
    const successes = results.results.filter(r => r.success);
    if (successes.length > 0) {
      console.log("\n✅ Successful Agents:");
      successes.forEach(success => {
        const outputLines = success.output?.split('\n').length || 0;
        console.log(`   - ${success.agent}: Generated ${outputLines} lines of output`);
      });
    }

    // Parallel efficiency
    const sequentialTime = results.results.reduce((sum, r) => sum + r.duration, 0);
    const parallelEfficiency = (sequentialTime / results.summary.totalDuration * 100).toFixed(1);
    
    console.log("\n🚀 Parallel Execution Efficiency:");
    console.log(`   Sequential time (if run one by one): ${(sequentialTime / 1000).toFixed(2)}s`);
    console.log(`   Actual parallel time: ${(results.summary.totalDuration / 1000).toFixed(2)}s`);
    console.log(`   Efficiency gain: ${parallelEfficiency}%`);
    console.log(`   Time saved: ${((sequentialTime - results.summary.totalDuration) / 1000).toFixed(2)}s`);

    // Generate detailed report
    await generateDetailedReport(results);

  } catch (error) {
    console.error("Error analyzing results:", error);
    console.log("\nMake sure to run the parallel test first: npm run test:parallel");
  }
}

async function generateDetailedReport(results: FullResults) {
  const report = `# Claude-Flow Parallel Agent Test Report

Generated: ${new Date(results.timestamp).toLocaleString()}

## Executive Summary

- **Total Agents Tested**: ${results.summary.totalAgents}
- **Success Rate**: ${Math.round(results.summary.successfulAgents / results.summary.totalAgents * 100)}%
- **Total Execution Time**: ${(results.summary.totalDuration / 1000).toFixed(2)} seconds
- **Average Agent Duration**: ${(results.summary.averageDuration / 1000).toFixed(2)} seconds

## Detailed Results

| Agent | Status | Duration | Notes |
|-------|--------|----------|-------|
${results.results.map(r => 
  `| ${r.agent} | ${r.success ? '✅ Success' : '❌ Failed'} | ${(r.duration / 1000).toFixed(2)}s | ${r.error ? r.error.split('\n')[0] : 'Completed successfully'} |`
).join('\n')}

## Performance Analysis

### Execution Timeline
\`\`\`
${generateTimeline(results.results, results.summary.totalDuration)}
\`\`\`

### Efficiency Metrics
- Sequential execution time: ${(results.results.reduce((sum, r) => sum + r.duration, 0) / 1000).toFixed(2)}s
- Parallel execution time: ${(results.summary.totalDuration / 1000).toFixed(2)}s
- Efficiency gain: ${((results.results.reduce((sum, r) => sum + r.duration, 0) / results.summary.totalDuration - 1) * 100).toFixed(1)}%

## Recommendations

1. **Performance Optimization**: Focus on optimizing the slowest agents to improve overall execution time
2. **Error Handling**: Investigate and fix failures in any failed agents
3. **Resource Usage**: Monitor system resources during parallel execution to ensure optimal performance
4. **Scaling**: Consider batching agents based on their resource requirements

---
*Report generated by Claude-Flow Parallel Test Suite*
`;

  await fs.writeFile(path.join(__dirname, "detailed-report.md"), report);
  console.log("\n📄 Detailed report saved to detailed-report.md");
}

function generateTimeline(results: AgentResult[], totalDuration: number): string {
  const width = 60;
  const timeline: string[] = [];
  
  results.forEach(result => {
    const startRatio = 0; // Assuming all start at the same time
    const durationRatio = result.duration / totalDuration;
    const barLength = Math.max(1, Math.floor(durationRatio * width));
    const bar = "█".repeat(barLength);
    
    timeline.push(`${result.agent.padEnd(25)} |${bar}`);
  });
  
  return timeline.join('\n');
}

// Run the analysis
analyzeResults();