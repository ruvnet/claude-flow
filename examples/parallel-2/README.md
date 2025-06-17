# Claude-Flow Parallel Agent Testing

This example demonstrates how to run multiple Claude-Flow SPARC agents in parallel to test their capabilities and measure performance.

## Overview

The parallel test coordinator runs 8 different agent types simultaneously:
- **Specification Agent**: Creates detailed API specifications
- **Architecture Agent**: Designs system architectures
- **Code Agent**: Implements algorithms and data structures
- **TDD Agent**: Follows Test-Driven Development practices
- **Debug Agent**: Analyzes and fixes code issues
- **Documentation Agent**: Creates comprehensive documentation
- **Security Review Agent**: Analyzes security vulnerabilities
- **Integration Agent**: Plans system integration strategies

## Installation

```bash
# Navigate to the parallel-2 directory
cd examples/parallel-2

# Install dependencies
npm install
```

## Usage

### Run the Parallel Test
```bash
npm run test
```

This will:
1. Launch all agents in parallel
2. Execute their respective tasks
3. Save results to `results.json`

### Analyze Results
```bash
npm run analyze
```

This will:
1. Read the test results
2. Generate performance statistics
3. Create a detailed report in `detailed-report.md`

### Full Test Cycle
```bash
npm run test:full
```

This runs the complete test cycle: clean, test, and analyze.

## Test Configuration

Each agent is given a specific task designed to test its capabilities:

| Agent | Task Description |
|-------|-----------------|
| Specification | Create calculator API specification |
| Architecture | Design microservices for e-commerce |
| Code | Implement binary search tree |
| TDD | Create string utility library with tests |
| Debug | Analyze and fix memory leaks |
| Documentation | Create API documentation |
| Security | Review authentication implementation |
| Integration | Plan microservice integration |

## Understanding Results

### results.json
Contains raw test execution data:
- Agent execution times
- Success/failure status
- Output or error messages
- Overall statistics

### detailed-report.md
Provides comprehensive analysis:
- Executive summary
- Performance metrics
- Execution timeline
- Efficiency calculations
- Recommendations

## Performance Metrics

The test suite measures:
- **Individual agent duration**: Time taken by each agent
- **Parallel efficiency**: Comparison with sequential execution
- **Success rate**: Percentage of successful agent executions
- **Resource utilization**: Overall system performance

## Extending the Tests

To add new test cases:

1. Create a new test file in `test-agents/`:
```typescript
export const newTestCase = {
  name: "Test Name",
  description: "Test description",
  task: "Detailed task for the agent",
  expectedOutputs: ["Expected output 1", "Expected output 2"],
  validateOutput: (output: string): boolean => {
    // Validation logic
    return true;
  }
};
```

2. Add the test to `parallel-test.ts`:
```typescript
{
  name: "New Agent",
  mode: "agent-mode",
  task: "Your task description",
  priority: 1
}
```

## Troubleshooting

### Common Issues

1. **Agent timeout**: Increase timeout in `coordinator.ts` (default: 5 minutes)
2. **Missing results**: Ensure all agents complete before analyzing
3. **Permission errors**: Check write permissions for output files

### Debug Mode

To see detailed agent output, modify `coordinator.ts`:
```typescript
console.log(`Agent ${task.name} output:`, stdout);
```

## Architecture

```
parallel-2/
├── coordinator.ts       # Main coordination logic
├── parallel-test.ts     # Test configuration and runner
├── analyze-results.ts   # Results analysis tool
├── test-agents/        # Individual agent test cases
│   ├── spec-test.ts
│   ├── architect-test.ts
│   ├── code-test.ts
│   ├── tdd-test.ts
│   └── debug-test.ts
├── results.json        # Test execution results
└── detailed-report.md  # Analysis report
```

## Best Practices

1. **Resource Management**: Monitor system resources during parallel execution
2. **Task Complexity**: Balance task complexity across agents
3. **Error Handling**: Implement proper error recovery
4. **Logging**: Enable detailed logging for debugging
5. **Scaling**: Consider batching for large numbers of agents

## Contributing

To contribute new test cases or improvements:
1. Follow the existing test structure
2. Ensure tests are meaningful and measurable
3. Update documentation accordingly
4. Test thoroughly before submitting

## License

This example is part of the Claude-Flow project and follows the same license terms.