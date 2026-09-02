// ask.js - Ask mode orchestration template
export function getAskOrchestration(taskDescription, memoryNamespace) {
  return `
## ❓ Ask Mode - SPARC Navigation Guide

I'll help you navigate the SPARC methodology and determine the best approach for: "${taskDescription}"

## Understanding Your Request

Let me analyze your needs and guide you to the right SPARC mode:

### 1. **Project Phase Analysis** (5 mins)
   - What stage is your project in?
   - What type of help do you need?
   - What's your end goal?

### 2. **SPARC Mode Recommendations**

Based on your request, here are the relevant SPARC modes:

#### 📋 Planning & Design Modes:
- **\`spec-pseudocode\`** - For creating detailed specifications, requirements, and high-level logic
  - Use when: Starting a new feature, defining requirements, planning algorithms
  - Example: \`npx claude-flow sparc run spec-pseudocode "Create user authentication flow" --non-interactive\`

- **\`architect\`** - For system design, API boundaries, and service architecture
  - Use when: Designing system structure, defining APIs, planning microservices
  - Example: \`npx claude-flow sparc run architect "Design e-commerce platform architecture" --non-interactive\`

#### 🧠 Implementation Modes:
- **\`code\`** - For implementing features with clean architecture
  - Use when: Building new features, writing production code
  - Example: \`npx claude-flow sparc run code "Implement payment processing service" --non-interactive\`

- **\`tdd\`** - For test-first development with comprehensive coverage
  - Use when: Want high quality code, need test coverage, following TDD practices
  - Example: \`npx claude-flow sparc run tdd "Build shopping cart with TDD" --non-interactive\`

#### 🔧 Quality & Maintenance Modes:
- **\`debug\`** - For troubleshooting issues and fixing bugs
  - Use when: Something's broken, need to trace errors, fix runtime issues
  - Example: \`npx claude-flow sparc run debug "Fix memory leak in data processor" --non-interactive\`

- **\`security-review\`** - For security audits and vulnerability checks
  - Use when: Need security audit, checking for exposed secrets, compliance review
  - Example: \`npx claude-flow sparc run security-review "Audit user data handling" --non-interactive\`

- **\`refinement-optimization-mode\`** - For performance optimization and refactoring
  - Use when: Code needs optimization, files too large, performance issues
  - Example: \`npx claude-flow sparc run refinement-optimization-mode "Optimize database queries" --non-interactive\`

#### 📚 Documentation & Integration:
- **\`docs-writer\`** - For creating documentation and guides
  - Use when: Need README, API docs, user guides
  - Example: \`npx claude-flow sparc run docs-writer "Create API documentation" --non-interactive\`

- **\`integration\`** - For connecting services and ensuring system cohesion
  - Use when: Integrating components, connecting APIs, system integration
  - Example: \`npx claude-flow sparc run integration "Connect auth service to user service" --non-interactive\`

#### 🚀 Deployment & Operations:
- **\`devops\`** - For deployment, CI/CD, and infrastructure
  - Use when: Setting up deployment, configuring CI/CD, provisioning infrastructure
  - Example: \`npx claude-flow sparc run devops "Deploy to AWS with auto-scaling" --non-interactive\`

- **\`post-deployment-monitoring-mode\`** - For production monitoring
  - Use when: Setting up monitoring, configuring alerts, tracking metrics
  - Example: \`npx claude-flow sparc run post-deployment-monitoring-mode "Setup DataDog monitoring" --non-interactive\`

#### 🔐 Specialized Modes:
- **\`supabase-admin\`** - For Supabase database and auth management
  - Use when: Working with Supabase, setting up database, configuring auth
  - Example: \`npx claude-flow sparc run supabase-admin "Setup user authentication database" --non-interactive\`

- **\`mcp\`** - For MCP (Model Context Protocol) integrations
  - Use when: Integrating external tools via MCP, API connections
  - Example: \`npx claude-flow sparc run mcp "Integrate Stripe payment API" --non-interactive\`

### 3. **Workflow Recommendations**

For "${taskDescription}", I recommend this workflow:

\`\`\`bash
# Step 1: Define requirements
npx claude-flow sparc run spec-pseudocode "${taskDescription} - requirements and pseudocode" --non-interactive

# Step 2: Design architecture (if needed)
npx claude-flow sparc run architect "${taskDescription} - system design" --non-interactive

# Step 3: Implement with TDD
npx claude-flow sparc run tdd "${taskDescription} - implementation" --non-interactive

# Step 4: Security review
npx claude-flow sparc run security-review "${taskDescription} - security audit" --non-interactive

# Step 5: Documentation
npx claude-flow sparc run docs-writer "${taskDescription} - documentation" --non-interactive
\`\`\`

### 4. **Best Practices Reminder**
When using any SPARC mode, remember:
✅ Keep files modular (< 500 lines)
✅ Never hardcode environment variables
✅ Use configuration files for env-specific values
✅ Write tests for critical functionality
✅ Document your decisions in memory

### 5. **Memory Management**
Track your progress across modes:
\`\`\`bash
# Store project context
npx claude-flow memory store ${memoryNamespace}_context "Working on: ${taskDescription}"

# Query previous work
npx claude-flow memory query ${memoryNamespace}

# List all memory entries
npx claude-flow memory list
\`\`\`

## Next Steps

Based on your request "${taskDescription}", which SPARC mode would you like to use? Or would you like me to help you break down your task into smaller, mode-specific subtasks?

Remember: The SPARC methodology ensures systematic, high-quality development. Each mode has a specific purpose - use them in combination for best results!`;
}
