import { ParallelCoordinator, AgentTask } from "./coordinator";

async function runParallelTest() {
  const coordinator = new ParallelCoordinator();

  // Define tasks for each agent type
  const agentTasks: AgentTask[] = [
    {
      name: "Specification",
      mode: "spec-pseudocode",
      task: "Create a simple calculator API specification with basic arithmetic operations",
      priority: 1
    },
    {
      name: "Architecture",
      mode: "architect",
      task: "Design the architecture for a REST API service with authentication",
      priority: 1
    },
    {
      name: "Code Implementation",
      mode: "code",
      task: "Implement a binary search algorithm in TypeScript",
      priority: 2
    },
    {
      name: "Test-Driven Development",
      mode: "tdd",
      task: "Create tests and implementation for a string utility library",
      priority: 2
    },
    {
      name: "Debugging",
      mode: "debug",
      task: "Analyze and fix a memory leak in a Node.js application",
      priority: 3
    },
    {
      name: "Documentation",
      mode: "docs-writer",
      task: "Create API documentation for a user management system",
      priority: 3
    },
    {
      name: "Security Review",
      mode: "security-review",
      task: "Review authentication implementation for vulnerabilities",
      priority: 2
    },
    {
      name: "Integration",
      mode: "integration",
      task: "Plan integration between microservices using message queues",
      priority: 3
    }
  ];

  console.log("🎯 Claude-Flow Parallel Agent Test");
  console.log("==================================");
  console.log(`Testing ${agentTasks.length} agents in parallel mode\n`);

  await coordinator.runParallelAgents(agentTasks);
}

// Run the test
runParallelTest().catch(console.error);