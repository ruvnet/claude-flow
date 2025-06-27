# CI/CD Workflow Investigation and Remediation Mission

## CRITICAL: Check Basic-Memory First
Before beginning ANY investigation or implementation:
1. Use `mcp__basic-memory__search_notes` with query "phase 1 phase 2 remediation CI workflow" 
2. Use `mcp__basic-memory__recent_activity` to understand recent fixes and context
3. Review all related notes about TypeScript errors, Jest/Vitest issues, and workflow problems
4. Understand the FULL context of what has already been attempted and discovered

## Mission Overview
Coordinate a multi-phase swarm operation to investigate and fix critical CI/CD workflow failures in the claude-code-flow project, building upon previous remediation efforts documented in basic-memory.

## Phase 1: Root Cause Investigation (Research Team)

### Investigation Scope
1. **TypeScript Compilation Failures**
   - Analyze 174+ TypeScript errors across the codebase
   - Use code-reasoning MCP tool to understand type mismatches
   - Map error patterns and categorize by severity
   - Identify if errors are interconnected or isolated

2. **Test Infrastructure Analysis**
   - Investigate Jest configuration issues
   - Analyze memory/ subdirectory Vitest integration
   - Review test assertion failures across different platforms
   - Use context7 to understand testing framework best practices

3. **CI/CD Pipeline Architecture**
   - Examine GitHub Actions workflow configuration
   - Identify environment-specific failures (Ubuntu, macOS, Windows)
   - Analyze Node.js version compatibility issues
   - Review dependency conflicts and native module compilation

### Investigation Deliverables
- Comprehensive error categorization report
- Dependency graph of interconnected issues
- Priority matrix for fix implementation
- Risk assessment for each proposed solution

## Phase 2: Solution Implementation (Development Team)

### Implementation Strategy
1. **TypeScript Error Resolution**
   - Fix critical type errors blocking compilation
   - Update interfaces and type definitions
   - Ensure backward compatibility
   - Use code-reasoning for complex type inference issues

2. **Test Suite Stabilization**
   - Fix failing test assertions
   - Align Jest and Vitest configurations
   - Resolve platform-specific test issues
   - Implement proper coverage reporting

3. **CI/CD Pipeline Optimization**
   - Update workflow configurations
   - Ensure cross-platform compatibility
   - Optimize build and test performance
   - Implement proper error handling

### Implementation Guidelines
- Each agent MUST use MCP tools when beneficial:
  - **mcp__code-reasoning__code-reasoning**: For complex debugging and analysis
  - **mcp__context7__**: For framework-specific best practices
  - **mcp__zen__debug**: For systematic debugging approaches
  - **mcp__zen__codereview**: For validating fixes
  - **mcp__github__**: For checking workflow runs and logs

### Coordination Protocol
1. Investigation agents report findings to Memory using mcp__basic-memory__write_note
2. Implementation agents read investigation notes from Memory
3. Use TodoWrite extensively for task tracking
4. Parallel execution where possible, sequential where dependencies exist
5. Regular status updates through swarm monitoring

### Success Criteria
- All TypeScript compilation errors resolved
- All test suites passing on all platforms
- CI/CD workflow runs successfully (green status)
- No regression in existing functionality
- Clean, maintainable solutions (no band-aids)

### Critical Reminders
- **DO NOT** apply quick fixes that mask underlying issues
- **ALWAYS** understand root causes before implementing solutions
- **USE** MCP tools proactively for better analysis and solutions
- **COORDINATE** through Memory to avoid duplicate work
- **TEST** all changes locally before committing
- **DOCUMENT** significant findings and decisions in Memory

### Specific Focus Areas
1. **agent-registry.ts**: MemoryEntry vs AgentRegistryEntry type mismatch
2. **CLI commands**: Commander.js API usage issues
3. **Memory subsystem**: Vitest coverage path configuration
4. **Cross-platform**: Windows vs Unix path handling
5. **Native dependencies**: better-sqlite3 compilation with Node.js versions

Each agent should approach their assigned area with systematic investigation, leveraging all available tools, and maintaining clear communication through the Memory system.