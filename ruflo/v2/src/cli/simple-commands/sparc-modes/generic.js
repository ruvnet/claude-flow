// generic.js - Generic mode orchestration template
export function getGenericOrchestration(taskDescription, memoryNamespace) {
  return `
## Task Orchestration Steps

1. **Analysis** (10 mins)
   - Understand the task: "${taskDescription}"
   - Break down requirements
   - Identify deliverables
   - Store analysis: \`npx claude-flow memory store ${memoryNamespace}_analysis "..."\`

2. **Planning** (10 mins)
   - Create implementation plan
   - Define milestones
   - Set up project structure
   - Store plan: \`npx claude-flow memory store ${memoryNamespace}_plan "..."\`

3. **Implementation** (30 mins)
   - Execute the main task
   - Follow best practices
   - Keep code modular
   - Store progress: \`npx claude-flow memory store ${memoryNamespace}_implementation "..."\`

4. **Validation** (10 mins)
   - Test the solution
   - Verify requirements met
   - Document the work
   - Store validation: \`npx claude-flow memory store ${memoryNamespace}_validation "..."\`

5. **Deliverables**
   - Completed implementation
   - Documentation
   - Test results`;
}
