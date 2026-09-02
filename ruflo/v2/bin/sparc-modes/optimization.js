// optimization.js - Optimizer mode orchestration template
export function getOptimizationOrchestration(taskDescription, memoryNamespace) {
  return `
## Task Orchestration Steps

1. **Performance Analysis** (15 mins)
   - Analyze optimization needs: "${taskDescription}"
   - Profile current performance
   - Identify bottlenecks
   - Review code quality metrics
   - Store analysis: \`npx claude-flow memory store ${memoryNamespace}_performance_analysis "..."\`

2. **Refactoring Plan** (10 mins)
   - Prioritize improvements
   - Plan refactoring approach
   - Identify quick wins
   - Estimate impact
   - Store plan: \`npx claude-flow memory store ${memoryNamespace}_refactor_plan "..."\`

3. **Code Optimization** (25 mins)
   - Refactor large files (>500 lines)
   - Optimize algorithms
   - Improve data structures
   - Enhance caching strategies
   - Store changes: \`npx claude-flow memory store ${memoryNamespace}_optimizations "..."\`

4. **Validation** (10 mins)
   - Run performance benchmarks
   - Verify functionality preserved
   - Check test coverage
   - Document improvements

5. **Deliverables**
   - Optimized codebase
   - Performance metrics
   - Refactoring documentation
   - Best practices guide`;
}
