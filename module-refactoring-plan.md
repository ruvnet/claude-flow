# Module Boundary Refactoring Plan

## Current Module Structure

The codebase currently has the following main modules:
- `/src/cli` - CLI related functionality
- `/src/coordination` - Coordination system
- `/src/core` - Core orchestrator functionality
- `/src/enterprise` - Enterprise features
- `/src/mcp` - MCP server functionality
- `/src/memory` - Memory management
- `/src/migration` - Migration utilities
- `/src/persistence` - Database persistence
- `/src/swarm` - Swarm functionality
- `/src/task` - Task management
- `/src/terminal` - Terminal management
- `/src/types` - Type definitions
- `/src/utils` - Utility functions
- `/src/agents` - Agent management

## Identified Issues

### 1. Cross-Module Dependencies
- CLI commands directly importing from coordination, memory, and other modules
- No clear dependency hierarchy
- Circular dependency risks

### 2. Barrel Export Issues
- Some index.ts files contain implementation code (e.g., MCPIntegrationFactory in mcp/index.ts)
- Inconsistent export patterns across modules
- Missing barrel exports for some modules (core, agents, migration)

### 3. Module Boundary Violations
- CLI commands accessing internal implementation details of other modules
- Direct imports bypassing module interfaces
- No clear separation between public API and internal implementation

## Proposed Module Architecture

### Dependency Hierarchy (top to bottom)
```
┌─────────────────────────────────────────────────┐
│                    /types                       │ (Pure types, no dependencies)
├─────────────────────────────────────────────────┤
│                    /utils                       │ (Utilities, depends only on types)
├─────────────────────────────────────────────────┤
│   /core      /memory      /persistence         │ (Core services)
├─────────────────────────────────────────────────┤
│ /agents  /coordination  /task  /terminal       │ (Business logic)
├─────────────────────────────────────────────────┤
│        /swarm        /mcp       /migration     │ (Feature modules)
├─────────────────────────────────────────────────┤
│              /enterprise                        │ (Premium features)
├─────────────────────────────────────────────────┤
│                    /cli                         │ (User interface)
└─────────────────────────────────────────────────┘
```

### Module Contracts

Each module should expose a clear public API through its index.ts file:

1. **Types Module** - Pure type definitions only
2. **Utils Module** - Stateless utility functions
3. **Core Module** - Core orchestrator, event bus, logger
4. **Memory Module** - Memory management interface
5. **Persistence Module** - Database abstraction layer
6. **Agents Module** - Agent management and registry
7. **Coordination Module** - Task coordination and scheduling
8. **Task Module** - Task creation and management
9. **Terminal Module** - Terminal abstraction
10. **Swarm Module** - Swarm orchestration
11. **MCP Module** - MCP server implementation
12. **Migration Module** - Migration utilities
13. **Enterprise Module** - Enterprise features
14. **CLI Module** - Command-line interface

## Refactoring Steps

### Phase 1: Create Module Interfaces
1. Define clear public APIs for each module
2. Create proper barrel exports (index.ts) for all modules
3. Move implementation details out of index.ts files

### Phase 2: Fix Dependency Direction
1. Ensure CLI only imports from feature modules' public APIs
2. Remove cross-module internal dependencies
3. Use dependency injection for module coupling

### Phase 3: Implement Module Boundaries
1. Create facade patterns for complex modules
2. Use interfaces to define contracts
3. Implement proper encapsulation

### Phase 4: Clean Import Paths
1. Update all imports to use barrel exports
2. Remove relative imports crossing module boundaries
3. Use absolute imports from module roots

## Implementation Priority

1. **Critical**: Fix CLI commands importing internal module details
2. **High**: Create missing barrel exports (core, agents, migration)
3. **High**: Clean up MCP index.ts implementation code
4. **Medium**: Establish clear module interfaces
5. **Low**: Optimize import paths throughout codebase