// tutorial.js - SPARC Tutorial mode orchestration template
export function getTutorialOrchestration(taskDescription, memoryNamespace) {
  return `
## 📘 SPARC Tutorial - Learn by Building

Welcome to the SPARC development methodology tutorial! I'll guide you through building "${taskDescription}" using systematic SPARC practices.

## SPARC Overview

**SPARC** stands for:
- **S**pecification: Define what to build
- **P**seudocode: Plan the logic
- **A**rchitecture: Design the structure
- **R**efinement: Build with quality
- **C**ompletion: Integrate and deploy

## Tutorial Structure

### Phase 1: Specification (20 mins)
Let's start by properly specifying what we're building:

\`\`\`bash
# Store our learning objective
npx claude-flow memory store ${memoryNamespace}_tutorial_start "Learning SPARC by building: ${taskDescription}"

# Use spec-pseudocode mode to define requirements
npx claude-flow sparc run spec-pseudocode "Tutorial project: ${taskDescription} - create detailed specifications" --non-interactive
\`\`\`

**What you'll learn:**
- How to break down requirements
- Writing clear specifications
- Identifying edge cases
- Creating testable acceptance criteria

**Key principles:**
- Be specific about inputs/outputs
- Consider error scenarios
- Define success metrics
- No implementation details yet

### Phase 2: Architecture (20 mins)
Now let's design a scalable system:

\`\`\`bash
# Query our specifications
npx claude-flow memory query ${memoryNamespace}_requirements

# Design the architecture
npx claude-flow sparc run architect "Tutorial: Design architecture for ${taskDescription}" --non-interactive
\`\`\`

**What you'll learn:**
- Creating modular designs
- Defining service boundaries
- Planning data flows
- Security considerations

**Key principles:**
- Keep modules under 500 lines
- Separate concerns clearly
- Plan for extensibility
- Never hardcode secrets

### Phase 3: Test-Driven Development (30 mins)
Implement with TDD for quality:

\`\`\`bash
# Start with tests
npx claude-flow sparc run tdd "Tutorial: Implement ${taskDescription} with TDD" --non-interactive

# Follow Red-Green-Refactor cycle:
# 1. Red: Write failing tests
# 2. Green: Make tests pass
# 3. Refactor: Improve code quality
\`\`\`

**What you'll learn:**
- Writing tests first
- London School TDD
- Test doubles (mocks, stubs)
- Achieving high coverage

**TDD Cycle Practice:**
1. Write a failing test for one feature
2. Implement minimum code to pass
3. Refactor while keeping tests green
4. Repeat for next feature

### Phase 4: Code Implementation (30 mins)
Build the full implementation:

\`\`\`bash
# Implement based on TDD foundation
npx claude-flow sparc run code "Tutorial: Complete implementation of ${taskDescription}" --non-interactive

# Store progress
npx claude-flow memory store ${memoryNamespace}_implementation_progress "Core features complete, working on edge cases"
\`\`\`

**What you'll learn:**
- Clean architecture principles
- Dependency injection
- Error handling patterns
- Configuration management

**Best practices to follow:**
- Use environment variables properly
- Implement comprehensive logging
- Add input validation
- Handle errors gracefully

### Phase 5: Security & Quality (20 mins)
Ensure security and quality:

\`\`\`bash
# Security audit
npx claude-flow sparc run security-review "Tutorial: Security review of ${taskDescription}" --non-interactive

# Code optimization
npx claude-flow sparc run refinement-optimization-mode "Tutorial: Optimize ${taskDescription}" --non-interactive
\`\`\`

**What you'll learn:**
- Identifying security vulnerabilities
- OWASP best practices
- Performance optimization
- Code refactoring techniques

### Phase 6: Documentation (15 mins)
Document your work:

\`\`\`bash
# Create comprehensive docs
npx claude-flow sparc run docs-writer "Tutorial: Document ${taskDescription}" --non-interactive
\`\`\`

**What you'll learn:**
- Writing clear README files
- API documentation
- User guides
- Troubleshooting sections

### Phase 7: Integration & Deployment (20 mins)
Bring it all together:

\`\`\`bash
# Integrate components
npx claude-flow sparc run integration "Tutorial: Integrate all components of ${taskDescription}" --non-interactive

# Set up deployment
npx claude-flow sparc run devops "Tutorial: Deploy ${taskDescription}" --non-interactive
\`\`\`

**What you'll learn:**
- Component integration
- CI/CD setup
- Deployment strategies
- Monitoring configuration

## Interactive Exercises

### Exercise 1: Memory Management
Practice using Claude-Flow memory:
\`\`\`bash
# Store different types of information
npx claude-flow memory store ${memoryNamespace}_decisions "Chose PostgreSQL for data persistence due to ACID requirements"
npx claude-flow memory store ${memoryNamespace}_blockers "Need clarification on authentication requirements"

# Query your stored information
npx claude-flow memory query ${memoryNamespace}_decisions
\`\`\`

### Exercise 2: Mode Coordination
Practice coordinating between modes:
\`\`\`bash
# Start with spec
npx claude-flow sparc run spec-pseudocode "Define user registration flow" --non-interactive

# Then architecture
npx claude-flow sparc run architect "Design registration service" --non-interactive

# Then TDD implementation
npx claude-flow sparc run tdd "Implement registration with tests" --non-interactive
\`\`\`

### Exercise 3: Debugging Practice
Practice debugging workflow:
\`\`\`bash
# Simulate a bug
npx claude-flow sparc run debug "Tutorial: Fix registration validation bug" --non-interactive
\`\`\`

## Mental Models for SPARC

### 1. **The Building Model**
Think of SPARC like constructing a building:
- Specification = Blueprint
- Pseudocode = Foundation plan
- Architecture = Structural design
- Refinement = Quality construction
- Completion = Final inspection

### 2. **The Iteration Model**
Each SPARC cycle improves the system:
- First pass: Core functionality
- Second pass: Edge cases
- Third pass: Optimization
- Continuous: Improvements

### 3. **The Quality Gate Model**
Each phase has exit criteria:
- Spec complete? → Clear requirements
- Architecture sound? → Scalable design
- Tests passing? → Quality code
- Security reviewed? → Safe to deploy

## Common Pitfalls to Avoid

1. **Skipping Specification**
   - ❌ Jumping straight to code
   - ✅ Define requirements first

2. **Monolithic Design**
   - ❌ One large file/component
   - ✅ Modular < 500 line files

3. **Hardcoding Values**
   - ❌ API keys in code
   - ✅ Environment configuration

4. **Ignoring Tests**
   - ❌ Testing after implementation
   - ✅ TDD from the start

5. **Poor Documentation**
   - ❌ Code without context
   - ✅ Comprehensive guides

## Tutorial Completion

Congratulations! You've learned SPARC by building "${taskDescription}". 

### Review your journey:
\`\`\`bash
# See all your stored learnings
npx claude-flow memory query ${memoryNamespace}_tutorial

# Check your implementation
npx claude-flow status
\`\`\`

### Next steps:
1. Try building another feature using SPARC
2. Experiment with different mode combinations
3. Create your own SPARC workflow templates
4. Share your learnings with the team

Remember: SPARC is about systematic, quality development. Each mode serves a purpose - use them wisely to build amazing software!

## Quick Reference Card

\`\`\`bash
# SPARC Quick Commands
npx claude-flow sparc run spec-pseudocode "Define X" --non-interactive      # Requirements
npx claude-flow sparc run architect "Design X" --non-interactive            # Architecture
npx claude-flow sparc run tdd "Build X with tests" --non-interactive       # TDD
npx claude-flow sparc run code "Implement X" --non-interactive             # Clean code
npx claude-flow sparc run debug "Fix X issue" --non-interactive            # Debugging
npx claude-flow sparc run security-review "Audit X" --non-interactive      # Security
npx claude-flow sparc run docs-writer "Document X" --non-interactive       # Documentation
npx claude-flow sparc run integration "Connect X" --non-interactive        # Integration
npx claude-flow sparc run devops "Deploy X" --non-interactive              # Deployment
\`\`\`

Happy SPARC coding! 🚀`;
}
