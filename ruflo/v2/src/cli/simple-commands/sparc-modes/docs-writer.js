// docs-writer.js - Documentation Writer mode orchestration template
export function getDocsWriterOrchestration(taskDescription, memoryNamespace) {
  return `
## Task Orchestration Steps

1. **Documentation Planning** (10 mins)
   - Understand documentation needs: "${taskDescription}"
   - Identify target audience
   - Define documentation structure
   - List required sections
   - Store plan: \`npx claude-flow memory store ${memoryNamespace}_doc_plan "..."\`

2. **Content Creation** (25 mins)
   - Write clear, concise documentation
   - Include code examples
   - Add diagrams where helpful
   - Create API references
   - Store progress: \`npx claude-flow memory store ${memoryNamespace}_doc_content "..."\`

3. **User Guides** (15 mins)
   - Create quickstart guide
   - Write installation instructions
   - Document common use cases
   - Add troubleshooting section
   - Store guides: \`npx claude-flow memory store ${memoryNamespace}_user_guides "..."\`

4. **Review & Polish** (10 mins)
   - Check for clarity and accuracy
   - Verify code examples work
   - Add cross-references
   - Create table of contents

5. **Deliverables**
   - README.md with overview
   - docs/getting-started.md
   - docs/api-reference.md
   - docs/troubleshooting.md`;
}
