// roo-readme.js - README for .roo directory

export function createRooReadme() {
  return `# .roo Directory - SPARC Development Environment

This directory contains the SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) development environment configuration and templates.

## Directory Structure

\`\`\`
.roo/
├── README.md           # This file
├── templates/          # Template files for common patterns
├── workflows/          # Predefined SPARC workflows
│   └── basic-tdd.json  # Basic TDD workflow
├── modes/              # Custom mode definitions (optional)
└── configs/            # Configuration files
\`\`\`

## SPARC Methodology

SPARC is a systematic approach to software development:

1. **Specification**: Define clear requirements and constraints
2. **Pseudocode**: Create detailed logic flows and algorithms  
3. **Architecture**: Design system structure and components
4. **Refinement**: Implement, test, and optimize using TDD
5. **Completion**: Integrate, document, and validate

## Usage with Claude-Flow

Use the claude-flow SPARC commands to leverage this environment:

\`\`\`bash
# List available modes
claude-flow sparc modes

# Run specific mode
claude-flow sparc run code "implement user authentication"

# Execute full TDD workflow  
claude-flow sparc tdd "payment processing system"

# Use custom workflow
claude-flow sparc workflow .roo/workflows/basic-tdd.json
\`\`\`

## Configuration

The main configuration is in \`.roomodes\` at the project root. This directory provides additional templates and workflows to support the SPARC development process.

## Customization

You can customize this environment by:
- Adding new workflow templates to \`workflows/\`
- Creating mode-specific templates in \`templates/\`
- Adding project-specific configurations in \`configs/\`

For more information, see: https://github.com/ruvnet/claude-code-flow/docs/sparc.md
`;
}