// integration.js - System Integrator mode orchestration template
export function getIntegrationOrchestration(taskDescription, memoryNamespace) {
  return `
## Task Orchestration Steps

1. **Integration Analysis** (10 mins)
   - Review integration requirements: "${taskDescription}"
   - Identify components to connect
   - Map data flows between systems
   - Check compatibility requirements
   - Store analysis: \`npx claude-flow memory store ${memoryNamespace}_integration_analysis "..."\`

2. **Interface Development** (20 mins)
   - Create integration adapters
   - Implement data transformers
   - Build connection handlers
   - Add retry mechanisms
   - Store interfaces: \`npx claude-flow memory store ${memoryNamespace}_interfaces "..."\`

3. **System Connection** (20 mins)
   - Wire up components
   - Configure communication channels
   - Implement error handling
   - Add monitoring hooks
   - Store configuration: \`npx claude-flow memory store ${memoryNamespace}_connections "..."\`

4. **End-to-End Testing** (15 mins)
   - Test data flow scenarios
   - Verify error handling
   - Check performance metrics
   - Validate data integrity

5. **Directory Safety**
   - **IMPORTANT**: All integration files should be created in the current working directory
   - **DO NOT** create files in system directories or node_modules
   - For named projects, create a subdirectory: \`mkdir project-name && cd project-name\`
   - Use relative paths from your working directory
   - Suggested structure for integration code:
     \`\`\`
     ./ (current directory)
     ├── integrations/
     │   ├── adapters/
     │   ├── transformers/
     │   └── handlers/
     ├── config/
     └── tests/
         └── integration/
     \`\`\`

6. **Deliverables**
   - Integration layer code
   - Configuration templates
   - Integration test suite
   - Deployment guide`;
}
