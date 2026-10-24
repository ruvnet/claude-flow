// mcp.js - MCP Integration mode orchestration template
export function getMcpOrchestration(taskDescription, memoryNamespace) {
  return `
## Task Orchestration Steps

1. **Integration Planning** (10 mins)
   - Understand integration needs: "${taskDescription}"
   - Identify MCP endpoints
   - Review API documentation
   - Plan data mappings
   - Store plan: \`npx claude-flow memory store ${memoryNamespace}_mcp_plan "..."\`

2. **Connection Setup** (15 mins)
   - Configure MCP servers
   - Set up authentication
   - Test connectivity
   - Implement error handling
   - Store config: \`npx claude-flow memory store ${memoryNamespace}_mcp_config "..."\`

3. **Data Integration** (20 mins)
   - Implement data transformers
   - Create API wrappers
   - Add validation layers
   - Build retry mechanisms
   - Store integration: \`npx claude-flow memory store ${memoryNamespace}_mcp_integration "..."\`

4. **Testing & Validation** (15 mins)
   - Test all endpoints
   - Verify data accuracy
   - Check error scenarios
   - Monitor performance

5. **Deliverables**
   - MCP integration code
   - Configuration files
   - API documentation
   - Integration tests`;
}
