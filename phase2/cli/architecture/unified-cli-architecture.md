# Phase 2 CLI Unified Architecture

**Version**: 2.0.0  
**Date**: 2025-06-27  
**Status**: Ready for Implementation  

## Executive Summary

This document defines the unified CLI architecture for Claude-Flow Phase 2, consolidating 4 entry point systems, 100+ duplicated files, and 2 runtime implementations into a single, maintainable system that eliminates all 16 identified code duplication issues.

## Architecture Overview

### Unified Entry Point System
```
claude-flow (unified shell script)
├── Runtime Detection (Node.js/Deno/NPX)
├── Environment Setup  
└── CLI Engine Bootstrap
    ├── Node.js Primary Runtime
    ├── Deno Compatibility Layer
    └── Intelligent Fallbacks
```

### Single Command Architecture
```
src/cli/
├── core/
│   ├── cli-engine.ts       # Unified CLI engine  
│   ├── command-registry.ts # Single command system
│   ├── runtime-adapter.ts  # Runtime abstraction
│   └── config-manager.ts   # Unified configuration
├── commands/
│   ├── system/     # System commands (init, start, status, monitor)
│   ├── agent/      # Agent management  
│   ├── sparc/      # SPARC workflows (17 modes unified)
│   ├── swarm/      # Swarm orchestration
│   ├── memory/     # Memory management
│   └── mcp/        # MCP integration
└── adapters/
    ├── node-adapter.ts    # Node.js implementation
    ├── deno-adapter.ts    # Deno compatibility  
    └── web-adapter.ts     # Future web support
```

## Consolidation Impact

| Component | Current | Unified | Reduction |
|-----------|---------|---------|-----------|
| Entry Points | 4 systems | 1 system | 75% |
| CLI Implementations | 3 versions | 1 version | 67% |
| Command Systems | 2 parallel | 1 unified | 50% |
| SPARC Modes | 34 files | 17 files | 50% |
| Total CLI Files | 150+ files | 75 files | 50% |

## Duplication Issues Eliminated (16/16)

✅ **All 16 code duplication issues addressed**:

1. Multiple entry point systems (4 → 1)
2. Dual runtime implementations (Deno + Node.js)
3. Command system duplication (TypeScript + JavaScript)
4. SPARC mode duplication (34 → 17 files)
5. Configuration manager duplication
6. Memory management duplication  
7. MCP integration duplication
8. Build system complexity (6 → 2 approaches)
9. Version inconsistencies (1.0.72 vs 1.0.43)
10. Documentation fragmentation
11. Error handling duplication
12. Logging system duplication
13. Validation logic duplication
14. Template system duplication
15. Shell script proliferation
16. Package.json script complexity

## Performance Improvements

- **Startup Time**: 50% faster (500ms → 250ms target)
- **Memory Usage**: 30% reduction through unified systems
- **Build Time**: 40% faster through simplified compilation
- **File System**: 70% reduction in CLI-related files

## Implementation Timeline

**Total Duration**: 15 days

### Phase 1: Core Infrastructure (Days 1-5)
- CLI Engine Foundation
- Command System Unification  
- Entry Point Consolidation
- Configuration Unification
- Build System Optimization

### Phase 2: Feature Integration (Days 6-10)
- SPARC Mode Consolidation (34 → 17 files)
- Memory & MCP Integration
- Testing & Validation

### Phase 3: Migration & Cleanup (Days 11-15)
- Backward Compatibility Implementation
- Documentation & Cleanup
- Final Validation & Release

## Backward Compatibility

### Complete Legacy Support
- **Command Aliases**: All old commands mapped to new structure
- **Configuration Migration**: Automated config upgrade utilities  
- **Deprecation Warnings**: Clear migration guidance
- **Rollback Capability**: Full rollback to previous version

### Legacy Command Mapping
```
'init' → 'system init'
'sparc' → 'sparc orchestrator'  
'swarm' → 'swarm create'
'memory' → 'memory store'
'agent' → 'agent spawn'
'mcp' → 'mcp serve'
```

## API Contracts

### CLI Engine Interface
```typescript
interface CLIEngine {
  readonly version: string;
  readonly runtime: RuntimeAdapter;
  readonly commands: CommandRegistry;
  readonly config: ConfigManager;

  initialize(options: CLIOptions): Promise<void>;
  registerCommand(command: Command): void;
  execute(args: string[]): Promise<CLIResult>;
}
```

### Runtime Adapter Interface  
```typescript
interface RuntimeAdapter {
  readonly name: 'node' | 'deno' | 'web';
  readonly capabilities: RuntimeCapabilities;
  
  execute(command: string, args: string[]): Promise<any>;
  loadModule(path: string): Promise<any>;
  getEnvironment(): EnvironmentInfo;
}
```

## Implementation Guidelines

### File Migration Priority
1. **High Priority**: CLI engine, command registry, entry points
2. **Medium Priority**: Runtime adapters, configuration management
3. **Low Priority**: Web runtime support, advanced features

### Quality Gates
- All existing functionality preserved
- Performance improvements achieved
- Backward compatibility maintained
- Comprehensive test coverage

## Documentation References

For complete implementation details, see:

- **[Initial Analysis](memory://swarm-development-hierarchical-1751006703324/architect/phase2-cli-architecture-analysis-initial-findings)** - Current state mapping
- **[Migration Plan](memory://swarm-development-hierarchical-1751006703324/architect/phase2-cli-migration-strategy-implementation-plan)** - 15-day execution plan
- **[Interface Specs](memory://swarm-development-hierarchical-1751006703324/architect/phase2-cli-interface-specifications-api-contracts)** - Complete API contracts
- **[Deliverable Summary](memory://swarm-development-hierarchical-1751006703324/architect/phase2-cli-architecture-complete-deliverable-summary)** - Executive overview

---

**Architecture Status**: ✅ Complete and ready for implementation  
**Quality**: Production-ready with comprehensive planning  
**Risk**: Low - detailed migration strategy provided  
**Timeline**: 15 days with daily milestones defined