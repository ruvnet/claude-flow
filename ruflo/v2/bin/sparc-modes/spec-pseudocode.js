// spec-pseudocode.js - Specification Writer mode orchestration template
export function getSpecPseudocodeOrchestration(taskDescription, memoryNamespace) {
  return `
## Task Orchestration Steps

1. **Requirements Gathering** (15 mins)
   - Analyze request: "${taskDescription}"
   - Extract functional requirements
   - Identify constraints and edge cases
   - Define success criteria
   - Store requirements: \`npx claude-flow memory store ${memoryNamespace}_requirements "..."\`

2. **Specification Writing** (20 mins)
   - Create detailed specifications
   - Define input/output contracts
   - Document business rules
   - Specify error conditions
   - Store specs: \`npx claude-flow memory store ${memoryNamespace}_specifications "..."\`

3. **Pseudocode Development** (20 mins)
   - Write high-level algorithms
   - Define data structures
   - Map process flows
   - Include TDD anchors
   - Store pseudocode: \`npx claude-flow memory store ${memoryNamespace}_pseudocode "..."\`

4. **Modular Design** (10 mins)
   - Break into logical modules
   - Define module interfaces
   - Plan testing approach
   - Create phase structure

5. **Deliverables**
   - phase_1_requirements.md
   - phase_2_pseudocode.md
   - phase_3_modules.md
   - phase_4_testing.md`;
}
